import * as vscode from 'vscode';
import TelegramBot from 'node-telegram-bot-api';

export interface ExternalMessage {
  id: string;
  chatId: string;
  userId: string;
  username?: string;
  content: string;
  timestamp: Date;
}

interface PendingChallenge {
  key: string;
  expiresAt: number;
  attempts: number;
}

interface BlockedUser {
  until: number;
}

export class TelegramProvider {
  private bot: TelegramBot | null = null;
  private messageQueue: ExternalMessage[] = [];
  private waitingResolver: ((msg: ExternalMessage) => void) | null = null;
  private _isConnected = false;
  
  // Authentication state
  private authenticatedChats: Set<string> = new Set();
  private pendingChallenges: Map<string, PendingChallenge> = new Map();
  private blockedUsers: Map<string, BlockedUser> = new Map();
  
  private static readonly CHALLENGE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  get isConnected(): boolean {
    return this._isConnected;
  }

  private generateKey(): string {
    // Generate a 6-digit numeric code (easy to type on mobile)
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private isBlocked(chatId: string): boolean {
    const blocked = this.blockedUsers.get(chatId);
    if (!blocked) {
      return false;
    }
    if (Date.now() > blocked.until) {
      this.blockedUsers.delete(chatId);
      return false;
    }
    return true;
  }

  private getBlockTimeRemaining(chatId: string): number {
    const blocked = this.blockedUsers.get(chatId);
    if (!blocked) {
      return 0;
    }
    return Math.ceil((blocked.until - Date.now()) / 1000 / 60); // minutes
  }

  async connect(token: string): Promise<void> {
    if (this._isConnected) {
      return;
    }

    // Clear any previous state on reconnect
    this.blockedUsers.clear();
    this.pendingChallenges.clear();
    
    const connectTime = Date.now();

    this.bot = new TelegramBot(token, { polling: true });

    this.bot.on('message', async (msg) => {
      if (!msg.text) {
        return;
      }

      // Ignore stale messages from before bot connected (queued by Telegram)
      const msgTime = msg.date * 1000;
      if (msgTime < connectTime - 5000) {
        console.log(`[Telegram] Ignoring stale message from ${msg.from?.username}: "${msg.text}"`);
        return;
      }

      const chatId = String(msg.chat.id);
      const username = msg.from?.username || msg.from?.first_name || 'Unknown';
      const text = msg.text.trim();

      // Check if blocked
      if (this.isBlocked(chatId)) {
        const mins = this.getBlockTimeRemaining(chatId);
        await this.bot?.sendMessage(chatId, `⛔ Too many failed attempts. Try again in ${mins} minute(s).`);
        return;
      }

      // Check if already authenticated
      if (this.authenticatedChats.has(chatId)) {
        // Pass message through to the tool
        const externalMsg: ExternalMessage = {
          id: String(msg.message_id),
          chatId: chatId,
          userId: String(msg.from?.id || 'unknown'),
          username: username,
          content: text,
          timestamp: new Date(msg.date * 1000)
        };

        console.log(`[Telegram] Message from authenticated user @${username}: ${text}`);

        if (this.waitingResolver) {
          this.waitingResolver(externalMsg);
          this.waitingResolver = null;
        } else {
          this.messageQueue.push(externalMsg);
        }
        return;
      }

      // Check if there's a pending challenge
      const challenge = this.pendingChallenges.get(chatId);
      
      if (challenge) {
        // Check if challenge expired
        if (Date.now() > challenge.expiresAt) {
          this.pendingChallenges.delete(chatId);
          await this.bot?.sendMessage(chatId, '⏰ Challenge expired. Send any message to get a new code.');
          return;
        }

        // Check if the response matches
        if (text === challenge.key) {
          this.pendingChallenges.delete(chatId);
          this.authenticatedChats.add(chatId);
          await this.bot?.sendMessage(chatId, '✅ Authenticated! You can now send messages to the agent.');
          console.log(`[Telegram] User @${username} (${chatId}) authenticated successfully`);
          
          // Notify VS Code
          vscode.window.showInformationMessage(`✅ Telegram user @${username} authenticated`);
          return;
        } else {
          // Wrong code
          challenge.attempts++;
          const remaining = TelegramProvider.MAX_ATTEMPTS - challenge.attempts;

          if (remaining <= 0) {
            // Block user
            this.pendingChallenges.delete(chatId);
            this.blockedUsers.set(chatId, {
              until: Date.now() + TelegramProvider.BLOCK_DURATION_MS
            });
            await this.bot?.sendMessage(chatId, '⛔ Too many failed attempts. You are blocked for 5 minutes.');
            console.log(`[Telegram] User @${username} (${chatId}) blocked after 3 failed attempts`);
            vscode.window.showWarningMessage(`⚠️ Telegram user @${username} blocked after 3 failed auth attempts`);
          } else {
            await this.bot?.sendMessage(chatId, `❌ Wrong code. ${remaining} attempt(s) remaining.`);
          }
          return;
        }
      }

      // New user - create challenge
      const key = this.generateKey();
      this.pendingChallenges.set(chatId, {
        key: key,
        expiresAt: Date.now() + TelegramProvider.CHALLENGE_EXPIRY_MS,
        attempts: 0
      });

      // Show code in VS Code - use modal to ensure visibility
      vscode.window.showInformationMessage(
        `🔐 @${username} auth code: ${key}`
      );

      // Also log to console for visibility
      console.log(`[Telegram] Auth challenge for @${username} (${chatId}): ${key}`);

      // Ask user to enter the code
      await this.bot?.sendMessage(chatId, 
        `🔐 *Authentication Required*\n\nA code has been shown in VS Code. Please enter it here.\n\n_Code expires in 2 minutes. 3 attempts allowed._`,
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.on('polling_error', (error) => {
      console.error('[Telegram] Polling error:', error.message);
    });

    this._isConnected = true;
    console.log('[Telegram] Bot connected and polling');
  }

  async waitForMessage(token: vscode.CancellationToken): Promise<ExternalMessage> {
    // Check queue first
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    // Wait for next message
    return new Promise((resolve, reject) => {
      this.waitingResolver = resolve;

      token.onCancellationRequested(() => {
        this.waitingResolver = null;
        reject(new Error('Cancelled'));
      });
    });
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

  async sendMessage(chatId: string, text: string, replyToMessageId?: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot not connected');
    }

    await this.bot.sendMessage(chatId, text, {
      reply_to_message_id: replyToMessageId ? parseInt(replyToMessageId) : undefined,
      parse_mode: 'Markdown'
    });

    console.log(`[Telegram] Sent message to ${chatId}: ${text.substring(0, 50)}...`);
  }

  disconnect(): void {
    if (this.bot) {
      this.bot.stopPolling();
      this.bot = null;
    }
    this._isConnected = false;
    this.messageQueue = [];
    this.waitingResolver = null;
    console.log('[Telegram] Bot disconnected');
  }
}

// Singleton instance
export const telegramProvider = new TelegramProvider();
