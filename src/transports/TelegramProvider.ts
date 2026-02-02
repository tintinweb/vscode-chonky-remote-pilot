import TelegramBot from 'node-telegram-bot-api';
import { ITransportProvider, ExternalMessage, TransportConfig } from './ITransportProvider';

export class TelegramProvider implements ITransportProvider {
  readonly name = 'telegram';
  
  private bot: TelegramBot | null = null;
  private _isConnected = false;
  private connectTime = 0;
  private botUsername: string = '';
  
  private messageCallback: ((msg: ExternalMessage) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(config: TransportConfig): Promise<void> {
    if (this._isConnected) {
      return;
    }

    const token = config.token as string;
    if (!token) {
      throw new Error('Telegram bot token required');
    }

    this.connectTime = Date.now();
    this.bot = new TelegramBot(token, { polling: true });

    // Get bot's own username for mention detection
    try {
      const me = await this.bot.getMe();
      this.botUsername = me.username || '';
      console.log(`[Telegram] Bot username: @${this.botUsername}`);
    } catch (e) {
      console.warn('[Telegram] Could not get bot info:', e);
    }

    this.bot.on('message', async (msg) => {
      if (!msg.text) {
        return;
      }

      // Ignore stale messages from before bot connected
      const msgTime = msg.date * 1000;
      if (msgTime < this.connectTime - 5000) {
        console.log(`[Telegram] Ignoring stale message from ${msg.from?.username}: "${msg.text}"`);
        return;
      }

      // Detect if this is a DM (private chat) or group
      const chatType = msg.chat.type;
      const isDM = chatType === 'private';
      
      // Detect bot mentions: @botusername or /command@botusername
      let mentionsBot = false;
      const text = msg.text;
      if (this.botUsername) {
        const mentionPattern = new RegExp(`@${this.botUsername}\\b`, 'i');
        const commandPattern = new RegExp(`^/\\w+@${this.botUsername}\\b`, 'i');
        mentionsBot = mentionPattern.test(text) || commandPattern.test(text);
      }
      // Also check for reply to bot's message
      if (msg.reply_to_message?.from?.username === this.botUsername) {
        mentionsBot = true;
      }

      const externalMsg: ExternalMessage = {
        id: String(msg.message_id),
        chatId: String(msg.chat.id),
        userId: String(msg.from?.id || 'unknown'),
        username: msg.from?.username || msg.from?.first_name || 'Unknown',
        content: text.trim(),
        timestamp: new Date(msg.date * 1000),
        transport: 'telegram',
        isDM,
        mentionsBot,
        channelName: isDM ? undefined : (msg.chat.title || `Chat ${msg.chat.id}`)
      };

      if (this.messageCallback) {
        this.messageCallback(externalMsg);
      }
    });

    this.bot.on('polling_error', (error) => {
      console.error('[Telegram] Polling error:', error.message);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    });

    this._isConnected = true;
    console.log('[Telegram] Bot connected and polling');
  }

  disconnect(): void {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
    this._isConnected = false;
    console.log('[Telegram] Bot disconnected');
  }

  async sendMessage(chatId: string, text: string, replyTo?: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot not connected');
    }

    await this.bot.sendMessage(chatId, text, {
      reply_to_message_id: replyTo ? parseInt(replyTo) : undefined,
      parse_mode: 'Markdown'
    });

    console.log(`[Telegram] Sent message to ${chatId}: ${text.substring(0, 50)}...`);
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.bot) {
      return;
    }
    try {
      await this.bot.sendChatAction(chatId, 'typing');
    } catch (error) {
      console.warn('[Telegram] Failed to send typing action:', error);
    }
  }

  onMessage(callback: (msg: ExternalMessage) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }
}

export const telegramProvider = new TelegramProvider();
