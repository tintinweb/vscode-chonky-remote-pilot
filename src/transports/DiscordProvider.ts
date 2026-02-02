import { Client, GatewayIntentBits, Events, Message, ChannelType } from 'discord.js';
import * as vscode from 'vscode';
import { ITransportProvider, ExternalMessage, TransportConfig } from './ITransportProvider';

export class DiscordProvider implements ITransportProvider {
  readonly name = 'discord';
  
  private client: Client | null = null;
  private _isConnected = false;
  private botUserId: string = '';
  
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
      throw new Error('Discord bot token required');
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,  // Privileged intent - must enable in Discord Developer Portal
      ],
    });

    // Handle incoming messages
    this.client.on(Events.MessageCreate, (message: Message) => {
      // Ignore bot's own messages
      if (message.author.bot) {
        return;
      }

      // Skip empty messages (attachments only, etc.)
      if (!message.content) {
        return;
      }

      // Detect if this is a DM
      const isDM = message.channel.type === ChannelType.DM;
      
      // Detect bot mention: <@BOT_USER_ID> or <@!BOT_USER_ID> (nickname mention)
      const mentionsBot = this.botUserId 
        ? message.content.includes(`<@${this.botUserId}>`) || 
          message.content.includes(`<@!${this.botUserId}>`) ||
          message.mentions.users.has(this.botUserId)
        : false;

      // Get channel name for non-DMs
      const channelName = isDM 
        ? undefined 
        : ('name' in message.channel ? (message.channel as any).name : `Channel ${message.channelId}`);

      const externalMsg: ExternalMessage = {
        id: message.id,
        chatId: message.channelId,
        userId: message.author.id,
        username: message.author.username,
        content: message.content.trim(),
        timestamp: message.createdAt,
        transport: 'discord',
        isDM,
        mentionsBot,
        channelName
      };

      // Include guild info in log if from a server
      const location = message.guild 
        ? `${message.guild.name}#${channelName || 'unknown'}` 
        : 'DM';
      console.log(`[Discord] Message from ${message.author.username} in ${location}: ${message.content}`);

      if (this.messageCallback) {
        this.messageCallback(externalMsg);
      }
    });

    // Handle ready event
    this.client.once(Events.ClientReady, (readyClient) => {
      this.botUserId = readyClient.user.id;
      console.log(`[Discord] Logged in as ${readyClient.user.tag} (ID: ${this.botUserId})`);
      this._isConnected = true;
      vscode.window.showInformationMessage(`✅ Discord connected as ${readyClient.user.tag}!`);
    });

    // Handle errors
    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Error:', error);
      if (this.errorCallback) {
        this.errorCallback(error);
      }
    });

    // Handle disconnection
    this.client.on(Events.ShardDisconnect, () => {
      console.log('[Discord] Disconnected');
      this._isConnected = false;
    });

    try {
      await this.client.login(token);
    } catch (error) {
      console.error('[Discord] Failed to login:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this._isConnected = false;
    console.log('[Discord] Disconnected');
  }

  async sendMessage(chatId: string, text: string, _replyTo?: string): Promise<void> {
    if (!this.client) {
      throw new Error('Discord not connected');
    }

    try {
      const channel = await this.client.channels.fetch(chatId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Cannot send to channel ${chatId}`);
      }

      // Discord has 2000 char limit - split long messages
      const chunks = this.splitMessage(text, 2000);
      for (const chunk of chunks) {
        if ('send' in channel) {
          await (channel as any).send(chunk);
        }
      }
      console.log(`[Discord] Sent message to ${chatId}: ${text.substring(0, 50)}...`);
    } catch (error) {
      console.error('[Discord] Failed to send message:', error);
      throw error;
    }
  }

  async sendTyping(chatId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const channel = await this.client.channels.fetch(chatId);
      if (channel && 'sendTyping' in channel) {
        await (channel as any).sendTyping();
      }
    } catch (error) {
      console.warn('[Discord] Failed to send typing:', error);
    }
  }

  onMessage(callback: (msg: ExternalMessage) => void): void {
    this.messageCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Split a message into chunks that fit Discord's 2000 char limit.
   * Tries to split at newlines or spaces when possible.
   */
  private splitMessage(text: string, limit: number): string[] {
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }

      // Try to find a good split point (newline or space)
      let splitAt = limit;
      const newlineIdx = remaining.lastIndexOf('\n', limit);
      const spaceIdx = remaining.lastIndexOf(' ', limit);

      if (newlineIdx > limit * 0.5) {
        splitAt = newlineIdx + 1;
      } else if (spaceIdx > limit * 0.5) {
        splitAt = spaceIdx + 1;
      }

      chunks.push(remaining.substring(0, splitAt).trimEnd());
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }
}

export const discordProvider = new DiscordProvider();
