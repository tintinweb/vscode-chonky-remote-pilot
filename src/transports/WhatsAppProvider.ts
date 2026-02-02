import * as qrcode from 'qrcode-terminal';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ITransportProvider, ExternalMessage, TransportConfig } from './ITransportProvider';

// Dynamic import for ESM module
type WASocket = any;
type DisconnectReason = any;

async function loadBaileys() {
  const baileys = await import('@whiskeysockets/baileys');
  return baileys;
}

export class WhatsAppProvider implements ITransportProvider {
  readonly name = 'whatsapp';
  
  private socket: WASocket | null = null;
  private _isConnected = false;
  private authPath: string = '';
  
  private messageCallback: ((msg: ExternalMessage) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private qrCallback: ((qr: string) => void) | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(config: TransportConfig): Promise<void> {
    if (this._isConnected) {
      return;
    }

    // Auth state will be stored in extension's global storage
    this.authPath = config.authPath as string;
    if (!this.authPath) {
      throw new Error('WhatsApp auth path required');
    }

    // Ensure auth directory exists
    if (!fs.existsSync(this.authPath)) {
      fs.mkdirSync(this.authPath, { recursive: true });
    }

    const baileys = await loadBaileys();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(this.authPath);

    this.socket = baileys.default({
      auth: state,
      printQRInTerminal: false,
    });

    // Handle connection updates
    this.socket.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Show QR code for authentication
        console.log('[WhatsApp] QR Code received, display it to user');
        qrcode.generate(qr, { small: true }, (qrArt: string) => {
          console.log(qrArt);
        });
        
        // Show QR in VS Code
        vscode.window.showInformationMessage(
          '📱 WhatsApp QR Code ready! Check the terminal/output to scan.',
          'Show QR'
        ).then((selection) => {
          if (selection === 'Show QR') {
            // Create output channel to show QR
            const channel = vscode.window.createOutputChannel('WhatsApp QR');
            channel.clear();
            qrcode.generate(qr, { small: true }, (qrArt: string) => {
              channel.appendLine('Scan this QR code with WhatsApp:');
              channel.appendLine('');
              channel.appendLine(qrArt);
            });
            channel.show();
          }
        });

        if (this.qrCallback) {
          this.qrCallback(qr);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== baileys.DisconnectReason.loggedOut;
        
        console.log(`[WhatsApp] Connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}`);
        
        this._isConnected = false;
        
        if (shouldReconnect) {
          // Reconnect
          setTimeout(() => this.connect(config), 3000);
        } else {
          vscode.window.showWarningMessage('WhatsApp logged out. Run Configure WhatsApp to reconnect.');
        }
      } else if (connection === 'open') {
        this._isConnected = true;
        console.log('[WhatsApp] Connected!');
        vscode.window.showInformationMessage('✅ WhatsApp connected!');
      }
    });

    // Save credentials when updated
    this.socket.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.socket.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') {
        return;
      }

      for (const msg of messages) {
        // Skip non-text messages for now
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text;
        if (!text) {
          continue;
        }

        const chatId = msg.key.remoteJid || '';
        const pushName = msg.pushName || 'Unknown';
        
        // Check if this is a message to self (status@broadcast or own JID)
        const isStatusBroadcast = chatId === 'status@broadcast';
        if (isStatusBroadcast) {
          continue; // Skip status updates
        }
        
        // Detect if this is a DM or group chat
        // Group JIDs end with @g.us, individual JIDs end with @s.whatsapp.net
        const isDM = !chatId.endsWith('@g.us');
        
        // Get group subject/name for groups (if available from metadata)
        // Note: Full group info requires groupMetadata fetch, simplified here
        const channelName = !isDM ? chatId.split('@')[0] : undefined;

        const externalMsg: ExternalMessage = {
          id: msg.key.id || String(Date.now()),
          chatId: chatId,
          userId: chatId.split('@')[0], // Phone number
          username: pushName,
          content: text.trim(),
          timestamp: new Date(Number(msg.messageTimestamp) * 1000),
          transport: 'whatsapp',
          isDM,
          // WhatsApp doesn't have @mentions for bots the same way
          mentionsBot: false, 
          channelName
        };

        const location = isDM ? 'DM' : `Group ${channelName}`;
        console.log(`[WhatsApp] Message from ${pushName} in ${location}: ${text}`);

        if (this.messageCallback) {
          this.messageCallback(externalMsg);
        }
      }
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    this._isConnected = false;
    console.log('[WhatsApp] Disconnected');
  }

  async sendMessage(chatId: string, text: string, replyTo?: string): Promise<void> {
    if (!this.socket) {
      throw new Error('WhatsApp not connected');
    }

    try {
      // Don't use reply-to for now, it can cause issues
      await this.socket.sendMessage(chatId, { text });
      console.log(`[WhatsApp] Sent message to ${chatId}: ${text.substring(0, 50)}...`);
    } catch (error) {
      console.error(`[WhatsApp] Failed to send message:`, error);
      throw error;
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.socket) {
      return;
    }
    
    try {
      await this.socket.sendPresenceUpdate('composing', chatId);
      // Auto-stop composing after 3 seconds
      setTimeout(async () => {
        try {
          await this.socket?.sendPresenceUpdate('paused', chatId);
        } catch {
          // Ignore
        }
      }, 3000);
    } catch (error) {
      console.warn('[WhatsApp] Failed to send typing:', error);
    }
  }

  onMessage(callback: (msg: ExternalMessage) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onQR(callback: (qr: string) => void): void {
    this.qrCallback = callback;
  }
}

export const whatsappProvider = new WhatsAppProvider();
