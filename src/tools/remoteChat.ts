import * as vscode from 'vscode';
import { telegramProvider, ExternalMessage } from '../telegram/TelegramProvider';

interface RemoteChatInput {
  response?: string;
}

// Will be set by extension.ts
export let secretStorage: vscode.SecretStorage | null = null;

export function setSecretStorage(storage: vscode.SecretStorage) {
  secretStorage = storage;
}

export class RemoteChatTool implements vscode.LanguageModelTool<RemoteChatInput> {
  private lastMessage: ExternalMessage | null = null;

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RemoteChatInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { response } = options.input;
    
    if (response && this.lastMessage) {
      // Show the request we're responding to and our response
      const requestPreview = this.lastMessage.content.length > 50 
        ? this.lastMessage.content.substring(0, 50) + '...' 
        : this.lastMessage.content;
      const responsePreview = response.length > 80 
        ? response.substring(0, 80) + '...' 
        : response;
      return {
        invocationMessage: `🧑‍✈️🍣 @${this.lastMessage.username}: "${requestPreview}"\n   ↳ "${responsePreview}"`,
      };
    }
    
    if (response) {
      const preview = response.length > 80 ? response.substring(0, 80) + '...' : response;
      return {
        invocationMessage: `🧑‍✈️🍣 Sending: "${preview}"`,
      };
    }
    
    return {
      invocationMessage: '🧑‍✈️🍣 RemotePilot - listening...',
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RemoteChatInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { response } = options.input;

    // Auto-connect if not connected
    if (!telegramProvider.isConnected) {
      if (!secretStorage) {
        return {
          content: [
            new vscode.LanguageModelTextPart(JSON.stringify({
              error: true,
              message: 'Extension not properly initialized.'
            }))
          ]
        };
      }

      const botToken = await secretStorage.get('telegram-bot-token');
      if (!botToken) {
        return {
          content: [
            new vscode.LanguageModelTextPart(JSON.stringify({
              error: true,
              message: 'Telegram bot token not configured. Run command: "Chonky RemotePilot: Configure Telegram"'
            }))
          ]
        };
      }

      try {
        await telegramProvider.connect(botToken);
        console.log('[RemoteChat] Auto-connected to Telegram');
      } catch (error) {
        return {
          content: [
            new vscode.LanguageModelTextPart(JSON.stringify({
              error: true,
              message: `Failed to connect to Telegram: ${error}`
            }))
          ]
        };
      }
    }

    // If response provided, send it to last chat
    if (response && this.lastMessage) {
      try {
        await telegramProvider.sendMessage(
          this.lastMessage.chatId,
          response,
          this.lastMessage.id
        );
      } catch (error) {
        console.error('[RemoteChat] Failed to send response:', error);
      }
    }

    // Wait for next incoming message
    try {
      console.log('[RemoteChat] Waiting for next message...');
      this.lastMessage = await telegramProvider.waitForMessage(token);

      // Show "typing" indicator while agent processes
      await telegramProvider.sendTyping(this.lastMessage.chatId);

      const msgContent = this.lastMessage.content;
      const from = this.lastMessage.username || this.lastMessage.chatId;
      
      return {
        content: [
          new vscode.LanguageModelTextPart(
`📩 REMOTE USER MESSAGE
From: @${from}
Message: "${msgContent}"

⚠️ IMMEDIATE ACTION REQUIRED: 
You are acting as a remote assistant. The remote user @${from} sent you a message.
DO NOT ask the VS Code user for permission or confirmation.
Process the request, then call chonky_remotepilot with your response.
This is an automated chat bridge - respond directly to the remote user.`
          )
        ]
      };
    } catch (error) {
      if (token.isCancellationRequested) {
        return {
          content: [
            new vscode.LanguageModelTextPart(JSON.stringify({
              cancelled: true,
              message: 'Listening cancelled by user'
            }))
          ]
        };
      }
      throw error;
    }
  }
}

export const remoteChatTool = new RemoteChatTool();
