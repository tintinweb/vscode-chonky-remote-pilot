import * as vscode from 'vscode';
import { ITransportProvider, ExternalMessage } from './ITransportProvider';
import { challengeAuth } from '../auth/ChallengeAuth';

export class TransportManager {
  private transports: Map<string, ITransportProvider> = new Map();
  private messageQueue: ExternalMessage[] = [];
  private waitingResolver: ((msg: ExternalMessage) => void) | null = null;

  register(provider: ITransportProvider): void {
    this.transports.set(provider.name, provider);
    
    provider.onMessage((msg) => this.handleMessage(msg));
    provider.onError((error) => {
      console.error(`[TransportManager] Error from ${provider.name}:`, error);
    });

    console.log(`[TransportManager] Registered transport: ${provider.name}`);
  }

  /**
   * Handle admin commands from trusted users in DM
   * Returns true if command was handled, false if not a command
   */
  private async handleAdminCommand(msg: ExternalMessage, transport: ITransportProvider): Promise<boolean> {
    // Commands only work in DM from trusted users
    if (!msg.isDM) {
      return false;
    }

    const trusted = challengeAuth.getTrustedUser(msg.transport, msg.userId);
    if (!trusted) {
      return false;
    }

    const content = msg.content.trim().toLowerCase();
    const parts = content.split(/\s+/);
    const command = parts[0];

    // Enable channel: "enable #channel-name" or "enable channelId"
    if (command === 'enable' && parts.length >= 2) {
      const channelRef = parts[1].replace(/^#/, '');
      const mode = (parts[2] as 'all' | 'mentions' | 'trusted-only') || 'mentions';
      
      // Try to find channel by name or use as ID directly
      const foundChannel = challengeAuth.findChannelByName(msg.transport, channelRef);
      const channelId = foundChannel?.channelId || channelRef;
      const channelName = foundChannel?.channelName || channelRef;
      
      challengeAuth.authorizeChannel(
        msg.transport,
        channelId,
        msg.userId,
        channelName,
        mode
      );
      
      if (foundChannel) {
        await transport.sendMessage(
          msg.chatId,
          `✅ Channel "${channelName}" enabled in ${mode} mode.\n\nModes:\n• all - respond to everyone\n• mentions - only when @mentioned\n• trusted-only - only trusted users`
        );
      } else {
        await transport.sendMessage(
          msg.chatId,
          `✅ Channel "${channelRef}" enabled in ${mode} mode.\n\n⚠️ Note: Channel not found in recent messages. Make sure the bot can see messages in this channel.\n\nModes:\n• all - respond to everyone\n• mentions - only when @mentioned\n• trusted-only - only trusted users`
        );
      }
      return true;
    }

    // Disable channel: "disable #channel-name"
    if (command === 'disable' && parts.length >= 2) {
      const channelRef = parts.slice(1).join(' ').replace(/^#/, '');
      
      if (challengeAuth.revokeChannel(msg.transport, channelRef, msg.userId)) {
        await transport.sendMessage(msg.chatId, `✅ Channel "${channelRef}" disabled.`);
      } else {
        await transport.sendMessage(msg.chatId, `❌ Channel "${channelRef}" was not enabled.`);
      }
      return true;
    }

    // List channels: "channels"
    if (command === 'channels' || command === 'list') {
      const channels = challengeAuth.getAuthorizedChannels(msg.transport);
      if (channels.length === 0) {
        await transport.sendMessage(msg.chatId, '📋 No channels enabled yet.\n\nUse "enable channel-name" to enable a channel.');
      } else {
        const list = channels.map(c => `• ${c.channelName || c.channelId} (${c.mode})`).join('\n');
        await transport.sendMessage(msg.chatId, `📋 *Enabled Channels:*\n\n${list}`);
      }
      return true;
    }

    // List trusted users: "trusted"
    if (command === 'trusted') {
      const users = challengeAuth.getAllTrustedUsers(msg.transport);
      if (users.length === 0) {
        await transport.sendMessage(msg.chatId, '👥 No trusted users yet.');
      } else {
        const list = users.map(u => {
          const since = new Date(u.authenticatedAt).toLocaleDateString();
          return `• @${u.username} (since ${since})`;
        }).join('\n');
        await transport.sendMessage(msg.chatId, `👥 *Trusted Users:*\n\n${list}`);
      }
      return true;
    }

    // Revoke user trust: "revoke @username" or "revoke userId"
    if (command === 'revoke' && parts.length >= 2) {
      const userRef = parts[1].replace(/^@/, '');
      
      // Find user by username or userId
      const users = challengeAuth.getAllTrustedUsers(msg.transport);
      const targetUser = users.find(u => 
        u.username.toLowerCase() === userRef.toLowerCase() || 
        u.userId === userRef
      );

      if (!targetUser) {
        await transport.sendMessage(msg.chatId, `❌ User "${userRef}" not found in trusted users.`);
        return true;
      }

      // Prevent self-revoke
      if (targetUser.userId === msg.userId) {
        await transport.sendMessage(msg.chatId, `❌ You cannot revoke your own trust.`);
        return true;
      }

      if (await challengeAuth.untrustUser(msg.transport, targetUser.userId)) {
        await transport.sendMessage(msg.chatId, `✅ User @${targetUser.username} is no longer trusted.`);
      } else {
        await transport.sendMessage(msg.chatId, `❌ Failed to revoke trust for "${userRef}".`);
      }
      return true;
    }

    // Help command
    if (command === 'help') {
      await transport.sendMessage(msg.chatId, 
        `🤖 *Admin Commands*\n\n` +
        `*Channels:*\n` +
        `• enable channel [mode] - Enable channel\n` +
        `  Modes: all, mentions (default), trusted-only\n` +
        `• disable channel - Disable channel\n` +
        `• channels - List enabled channels\n\n` +
        `*Users:*\n` +
        `• trusted - List trusted users\n` +
        `• revoke @user - Remove trusted user\n\n` +
        `• help - Show this message`
      );
      return true;
    }

    return false;
  }

  private async handleMessage(msg: ExternalMessage): Promise<void> {
    const transport = this.transports.get(msg.transport);
    if (!transport) {
      console.error(`[TransportManager] Unknown transport: ${msg.transport}`);
      return;
    }

    const username = msg.username || msg.chatId;

    // Check if blocked
    if (challengeAuth.isBlocked(msg.transport, msg.chatId)) {
      const mins = challengeAuth.getBlockTimeRemaining(msg.transport, msg.chatId);
      await transport.sendMessage(msg.chatId, `⛔ Too many failed attempts. Try again in ${mins} minute(s).`);
      return;
    }

    // For DMs: Check if authenticated
    if (msg.isDM && challengeAuth.isAuthenticated(msg.transport, msg.chatId)) {
      // Check for admin commands first
      const wasCommand = await this.handleAdminCommand(msg, transport);
      if (wasCommand) {
        return;
      }

      // Not a command - forward to agent
      console.log(`[TransportManager] DM from ${msg.transport}/@${username}: ${msg.content}`);
      
      if (this.waitingResolver) {
        this.waitingResolver(msg);
        this.waitingResolver = null;
      } else {
        this.messageQueue.push(msg);
      }
      return;
    }

    // For group messages: Track channel and check permission
    if (!msg.isDM) {
      // Track this channel for name-based authorization
      challengeAuth.trackChannel(msg.transport, msg.chatId, msg.channelName);
      
      const permission = challengeAuth.canRespondTo(msg);
      
      if (!permission.allowed) {
        console.log(`[TransportManager] Ignoring group message: ${permission.reason}`);
        // Silent ignore - don't spam in the channel
        return;
      }

      // Permission granted - forward to agent
      console.log(`[TransportManager] Group message from ${msg.transport}/@${username} in ${msg.channelName}: ${msg.content}`);
      
      if (this.waitingResolver) {
        this.waitingResolver(msg);
        this.waitingResolver = null;
      } else {
        this.messageQueue.push(msg);
      }
      return;
    }

    // DM not authenticated - check for pending challenge
    if (challengeAuth.hasPendingChallenge(msg.transport, msg.chatId)) {
      const input = msg.content.trim();
      
      // Only handle numeric input
      if (!/^\d+$/.test(input)) {
        // Not numeric - ignore silently
        return;
      }

      // If close to 6 digits (5 or 7), remind them
      if (input.length === 5 || input.length === 7) {
        await transport.sendMessage(
          msg.chatId,
          '🔐 The code is exactly 6 digits. Please check and try again.'
        );
        return;
      }

      // Only treat exactly 6 digits as an attempt
      if (input.length !== 6) {
        return;
      }

      const result = await challengeAuth.verifyChallenge(
        msg.transport, 
        msg.chatId, 
        input, 
        msg.userId,
        username,
        msg.isDM
      );
      
      switch (result) {
        case 'success':
          await transport.sendMessage(
            msg.chatId, 
            '✅ Authenticated! You are now trusted.\n\n' +
            'You can:\n' +
            '• Send messages directly to the agent\n' +
            '• Use `enable #channel` to authorize channels\n' +
            '• Use `help` for more commands'
          );
          return;
        case 'expired':
          await transport.sendMessage(msg.chatId, '⏰ Challenge expired. Send any message to get a new code.');
          return;
        case 'blocked':
          await transport.sendMessage(msg.chatId, '⛔ Too many failed attempts. You are blocked for 5 minutes.');
          return;
        case 'wrong':
          const remaining = challengeAuth.getAttemptsRemaining(msg.transport, msg.chatId);
          await transport.sendMessage(msg.chatId, `❌ Wrong code. ${remaining} attempt(s) remaining.`);
          return;
      }
    }

    // New user in DM - create challenge
    challengeAuth.createChallenge(msg.transport, msg.chatId, username);
    await transport.sendMessage(
      msg.chatId,
      `🔐 *Authentication Required*\n\nA code has been shown in VS Code. Please enter it here.\n\n_Code expires in 2 minutes. 3 attempts allowed._`
    );
  }

  get isConnected(): boolean {
    for (const transport of this.transports.values()) {
      if (transport.isConnected) {
        return true;
      }
    }
    return false;
  }

  getConnectedTransports(): string[] {
    const connected: string[] = [];
    for (const [name, transport] of this.transports) {
      if (transport.isConnected) {
        connected.push(name);
      }
    }
    return connected;
  }

  async waitForMessage(token: vscode.CancellationToken): Promise<ExternalMessage> {
    // Check queue first
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    return new Promise((resolve, reject) => {
      this.waitingResolver = resolve;

      token.onCancellationRequested(() => {
        this.waitingResolver = null;
        reject(new Error('Cancelled'));
      });
    });
  }

  async sendMessage(chatId: string, transport: string, text: string, replyTo?: string): Promise<void> {
    const provider = this.transports.get(transport);
    if (!provider) {
      throw new Error(`Transport not found: ${transport}`);
    }
    if (!provider.isConnected) {
      throw new Error(`Transport not connected: ${transport}`);
    }
    await provider.sendMessage(chatId, text, replyTo);
  }

  async sendTyping(chatId: string, transport: string): Promise<void> {
    const provider = this.transports.get(transport);
    if (provider?.isConnected) {
      await provider.sendTyping(chatId);
    }
  }

  disconnect(): void {
    for (const transport of this.transports.values()) {
      transport.disconnect();
    }
  }
}

export const transportManager = new TransportManager();
