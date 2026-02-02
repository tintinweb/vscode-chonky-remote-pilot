import { App, LogLevel } from '@slack/bolt';
import * as vscode from 'vscode';
import { ITransportProvider, ExternalMessage, TransportConfig } from './ITransportProvider';

export class SlackProvider implements ITransportProvider {
  readonly name = 'slack';
  
  private app: App | null = null;
  private _isConnected = false;
  private botUserId: string = '';
  
  private messageCallback: ((msg: ExternalMessage) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  
  // Cache user info to avoid repeated API calls
  private userCache: Map<string, string> = new Map();
  // Cache channel info to detect DMs vs channels
  private channelCache: Map<string, { isDM: boolean; name?: string }> = new Map();

  get isConnected(): boolean {
    return this._isConnected;
  }

  async connect(config: TransportConfig): Promise<void> {
    if (this._isConnected) {
      return;
    }

    const botToken = config.botToken as string;
    const appToken = config.appToken as string;

    if (!botToken || !appToken) {
      throw new Error('Slack requires both botToken (xoxb-...) and appToken (xapp-...)');
    }

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    // Get bot's own user ID for mention detection
    try {
      const authResult = await this.app.client.auth.test();
      this.botUserId = authResult.user_id || '';
      console.log(`[Slack] Bot user ID: ${this.botUserId}`);
    } catch (e) {
      console.warn('[Slack] Could not get bot info:', e);
    }

    // Listen for all messages
    this.app.message(async ({ message, client }) => {
      // Skip bot messages, message edits, deletes, etc.
      if (message.subtype) {
        return;
      }

      // TypeScript type guard for regular messages
      if (!('user' in message) || !('text' in message) || !message.text) {
        return;
      }

      const userId = message.user;
      const channelId = message.channel;
      const text = message.text;
      const ts = message.ts;

      // Get username from cache or fetch
      let username = this.userCache.get(userId);
      if (!username) {
        try {
          const userInfo = await client.users.info({ user: userId });
          username = userInfo.user?.real_name || userInfo.user?.name || userId;
          this.userCache.set(userId, username);
        } catch {
          username = userId;
        }
      }

      // Get channel info from cache or fetch (to detect DM vs channel)
      let channelInfo = this.channelCache.get(channelId);
      if (!channelInfo) {
        try {
          const convInfo = await client.conversations.info({ channel: channelId });
          const conv = convInfo.channel;
          // is_im = direct message, is_mpim = multi-party DM
          const isDM = conv?.is_im === true || conv?.is_mpim === true;
          const name = conv?.name || (isDM ? 'DM' : channelId);
          channelInfo = { isDM, name };
          this.channelCache.set(channelId, channelInfo);
        } catch {
          // Default to assuming it's a DM if we can't fetch info
          channelInfo = { isDM: true };
          this.channelCache.set(channelId, channelInfo);
        }
      }

      // Detect bot mention: <@BOT_USER_ID>
      const mentionsBot = this.botUserId 
        ? text.includes(`<@${this.botUserId}>`)
        : false;

      const externalMsg: ExternalMessage = {
        id: ts,
        chatId: channelId,
        userId: userId,
        username: username,
        content: text.trim(),
        timestamp: new Date(parseFloat(ts) * 1000),
        transport: 'slack',
        isDM: channelInfo.isDM,
        mentionsBot,
        channelName: channelInfo.isDM ? undefined : channelInfo.name
      };

      console.log(`[Slack] Message from ${username} in ${channelInfo.isDM ? 'DM' : channelInfo.name}: ${text}`);

      if (this.messageCallback) {
        this.messageCallback(externalMsg);
      }
    });

    // Handle errors
    this.app.error(async (error) => {
      console.error('[Slack] Error:', error);
      if (this.errorCallback) {
        this.errorCallback(new Error(String(error)));
      }
    });

    try {
      await this.app.start();
      this._isConnected = true;
      console.log('[Slack] Connected via Socket Mode!');
      vscode.window.showInformationMessage('✅ Slack connected!');
    } catch (error) {
      console.error('[Slack] Failed to start:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      try {
        await this.app.stop();
      } catch {
        // Ignore stop errors
      }
      this.app = null;
    }
    this._isConnected = false;
    this.userCache.clear();
    this.channelCache.clear();
    console.log('[Slack] Disconnected');
  }

  async sendMessage(chatId: string, text: string, replyTo?: string): Promise<void> {
    if (!this.app) {
      throw new Error('Slack not connected');
    }

    try {
      await this.app.client.chat.postMessage({
        channel: chatId,
        text: text,
        // Thread reply if we have a message to reply to
        ...(replyTo && { thread_ts: replyTo }),
      });
      console.log(`[Slack] Sent message to ${chatId}: ${text.substring(0, 50)}...`);
    } catch (error) {
      console.error('[Slack] Failed to send message:', error);
      throw error;
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    // Slack doesn't support typing indicators for bots
    // We could potentially add a reaction or use a "thinking" message
    // but for now we'll just skip it
  }

  onMessage(callback: (msg: ExternalMessage) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }
}

export const slackProvider = new SlackProvider();
