import * as vscode from 'vscode';

export interface ExternalMessage {
  id: string;
  chatId: string;
  userId: string;
  username?: string;
  content: string;
  timestamp: Date;
  transport: string;
  
  // Group chat support
  isDM: boolean;              // true if direct message, false if group/channel
  mentionsBot?: boolean;      // true if message mentions the bot
  channelName?: string;       // Name of channel/group (for display)
}

export interface TransportConfig {
  [key: string]: unknown;
}

export interface ITransportProvider {
  readonly name: string;
  readonly isConnected: boolean;

  connect(config: TransportConfig): Promise<void>;
  disconnect(): void;

  sendMessage(chatId: string, text: string, replyTo?: string): Promise<void>;
  sendTyping(chatId: string): Promise<void>;

  onMessage(callback: (msg: ExternalMessage) => void): void;
  onError(callback: (error: Error) => void): void;
}
