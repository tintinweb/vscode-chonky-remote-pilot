import * as vscode from 'vscode';
import { transportManager } from '../transports/TransportManager';
import { telegramProvider } from '../transports/TelegramProvider';
import { whatsappProvider } from '../transports/WhatsAppProvider';
import { slackProvider } from '../transports/SlackProvider';
import { discordProvider } from '../transports/DiscordProvider';
import { ExternalMessage } from '../transports/ITransportProvider';
import { challengeAuth } from '../auth/ChallengeAuth';

interface RemoteChatInput {
  response?: string;
}

// Will be set by extension.ts
export let secretStorage: vscode.SecretStorage | null = null;
export let globalStoragePath: string | null = null;

export function setSecretStorage(storage: vscode.SecretStorage) {
  secretStorage = storage;
}

export function setGlobalStoragePath(path: string) {
  globalStoragePath = path;
}

// Initialize transport manager with providers
let initialized = false;
function ensureInitialized() {
  if (!initialized) {
    transportManager.register(telegramProvider);
    transportManager.register(whatsappProvider);
    transportManager.register(slackProvider);
    transportManager.register(discordProvider);
    initialized = true;
  }
}

export class RemoteChatTool implements vscode.LanguageModelTool<RemoteChatInput> {
  private lastMessage: ExternalMessage | null = null;

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RemoteChatInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { response } = options.input;
    
    if (response && this.lastMessage) {
      const transportIcon = this.lastMessage.transport === 'telegram' ? '📱' 
        : this.lastMessage.transport === 'whatsapp' ? '💬' 
        : this.lastMessage.transport === 'slack' ? '💼' 
        : this.lastMessage.transport === 'discord' ? '🎮' : '🔗';
      const requestPreview = this.lastMessage.content.length > 50 
        ? this.lastMessage.content.substring(0, 50) + '...' 
        : this.lastMessage.content;
      const responsePreview = response.length > 80 
        ? response.substring(0, 80) + '...' 
        : response;
      return {
        invocationMessage: `🧑‍✈️🍣 ${transportIcon} @${this.lastMessage.username}: "${requestPreview}"\n   ↳ "${responsePreview}"`,
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
    
    ensureInitialized();

    // Auto-connect transports if not connected
    if (!transportManager.isConnected) {
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

      challengeAuth.clearOnConnect();
      let anyConnected = false;

      // Try connecting Telegram
      const botToken = await secretStorage.get('telegram-bot-token');
      if (botToken) {
        try {
          await telegramProvider.connect({ token: botToken });
          console.log('[RemoteChat] Auto-connected to Telegram');
          anyConnected = true;
        } catch (error) {
          console.error('[RemoteChat] Failed to connect to Telegram:', error);
        }
      }

      // Try connecting WhatsApp
      if (globalStoragePath) {
        const whatsappAuthPath = `${globalStoragePath}/whatsapp-auth`;
        const fs = await import('fs');
        // Check if whatsapp auth folder exists (has been configured before)
        if (fs.existsSync(whatsappAuthPath)) {
          try {
            await whatsappProvider.connect({ authPath: whatsappAuthPath });
            console.log('[RemoteChat] Auto-connected to WhatsApp');
            anyConnected = true;
          } catch (error) {
            console.error('[RemoteChat] Failed to connect to WhatsApp:', error);
          }
        }
      }

      // Try connecting Slack
      const slackBotToken = await secretStorage.get('slack-bot-token');
      const slackAppToken = await secretStorage.get('slack-app-token');
      if (slackBotToken && slackAppToken) {
        try {
          await slackProvider.connect({ botToken: slackBotToken, appToken: slackAppToken });
          console.log('[RemoteChat] Auto-connected to Slack');
          anyConnected = true;
        } catch (error) {
          console.error('[RemoteChat] Failed to connect to Slack:', error);
        }
      }

      // Try connecting Discord
      const discordToken = await secretStorage.get('discord-bot-token');
      if (discordToken) {
        try {
          await discordProvider.connect({ token: discordToken });
          console.log('[RemoteChat] Auto-connected to Discord');
          anyConnected = true;
        } catch (error) {
          console.error('[RemoteChat] Failed to connect to Discord:', error);
        }
      }

      if (!anyConnected) {
        return {
          content: [
            new vscode.LanguageModelTextPart(JSON.stringify({
              error: true,
              message: 'No transports configured. Run "Chonky RemotePilot: Configure [Telegram/WhatsApp/Slack/Discord]"'
            }))
          ]
        };
      }
    }

    // If response provided, send it to last chat
    if (response && this.lastMessage) {
      try {
        await transportManager.sendMessage(
          this.lastMessage.chatId,
          this.lastMessage.transport,
          response,
          this.lastMessage.id
        );
        console.log(`[RemoteChat] Sent response to ${this.lastMessage.transport}:${this.lastMessage.chatId}`);
      } catch (error) {
        console.error('[RemoteChat] Failed to send response:', error);
        vscode.window.showErrorMessage(`Failed to send message: ${error}`);
      }
    }

    // Wait for next incoming message from any transport
    try {
      console.log('[RemoteChat] Waiting for next message...');
      this.lastMessage = await transportManager.waitForMessage(token);

      // Show "typing" indicator while agent processes
      await transportManager.sendTyping(this.lastMessage.chatId, this.lastMessage.transport);

      const msgContent = this.lastMessage.content;
      const from = this.lastMessage.username || this.lastMessage.chatId;
      const transport = this.lastMessage.transport;
      
      return {
        content: [
          new vscode.LanguageModelTextPart(
`📩 REMOTE USER MESSAGE
From: @${from} (${transport})
Message: "${msgContent}"

⚠️ IMMEDIATE ACTION REQUIRED: 
You are acting as a remote assistant for @${from} via ${transport}.
DO NOT ask the VS Code user for permission or confirmation.
Process the request, then ALWAYS call chonky_remotepilot with your response.

CRITICAL: After responding, you MUST call chonky_remotepilot again WITHOUT the response parameter to listen for the next message.
NEVER stop listening unless the remote user explicitly says "stop", "quit", "exit", or similar.
This is a continuous automated chat bridge - keep the conversation loop active.`
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
