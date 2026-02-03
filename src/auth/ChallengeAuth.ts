import * as vscode from 'vscode';
import { ExternalMessage } from '../transports/ITransportProvider';

interface PendingChallenge {
  key: string;
  expiresAt: number;
  attempts: number;
}

interface BlockedUser {
  until: number;
}

/**
 * A trusted user is someone who has authenticated via DM.
 * They can authorize the bot to participate in group channels.
 * Persisted across sessions.
 */
interface TrustedUser {
  transport: string;
  userId: string;
  username: string;
  dmChatId: string;  // Their DM channel for sending commands
  authenticatedAt: string;  // ISO string for JSON serialization
  lastActiveAt: string;     // ISO string - for expiry check
}

/**
 * An authorized channel is a group/channel where the bot can respond.
 * Only trusted users can authorize channels.
 * Session-only (not persisted).
 */
interface AuthorizedChannel {
  transport: string;
  channelId: string;
  channelName?: string;
  authorizedBy: string;  // TrustedUser key (transport:userId)
  authorizedAt: Date;
  mode: 'all' | 'mentions' | 'trusted-only';  // Who bot responds to
}

/**
 * Persisted data structure for SecretStorage
 */
interface PersistedAuthData {
  trustedUsers: { [key: string]: TrustedUser };
  version: number;
}

export type ChannelAuthResult = 
  | { allowed: true }
  | { allowed: false; reason: 'not-dm-authed' | 'channel-not-authorized' | 'not-trusted-in-channel' | 'no-mention' };

export class ChallengeAuth {
  // Legacy: chat-based auth (for backwards compat and simple DM auth)
  private authenticatedChats: Set<string> = new Set();
  private pendingChallenges: Map<string, PendingChallenge> = new Map();
  private blockedUsers: Map<string, BlockedUser> = new Map();

  // New: user-based trust system (persisted)
  private trustedUsers: Map<string, TrustedUser> = new Map();  // Key: transport:userId
  
  // Session-only: channel authorizations (reset on restart)
  private authorizedChannels: Map<string, AuthorizedChannel> = new Map();  // Key: transport:channelId
  
  // Channel discovery: map channel names to IDs (session-only)
  private seenChannels: Map<string, { channelId: string; channelName: string }> = new Map();  // Key: transport:channelName (lowercase)

  // Persistence
  private secretStorage: vscode.SecretStorage | null = null;
  private static readonly STORAGE_KEY = 'chonky-remotepilot-auth';
  private static readonly STORAGE_VERSION = 1;
  private static readonly TRUST_EXPIRY_DAYS = 30;

  private static readonly CHALLENGE_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

  private makeKey(transport: string, id: string): string {
    return `${transport}:${id}`;
  }

  private makeUserKey(transport: string, userId: string): string {
    return `${transport}:${userId}`;
  }

  private makeChannelKey(transport: string, channelId: string): string {
    return `${transport}:${channelId}`;
  }

  generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // ─────────────────────────────────────────────────────────────
  // PERSISTENCE
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize with SecretStorage for persistence
   */
  async initialize(secretStorage: vscode.SecretStorage): Promise<void> {
    this.secretStorage = secretStorage;
    await this.loadFromStorage();
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.secretStorage) {
      return;
    }

    try {
      const data = await this.secretStorage.get(ChallengeAuth.STORAGE_KEY);
      if (!data) {
        console.log('[Auth] No persisted auth data found');
        return;
      }

      const parsed: PersistedAuthData = JSON.parse(data);
      if (parsed.version !== ChallengeAuth.STORAGE_VERSION) {
        console.log('[Auth] Auth data version mismatch, resetting');
        return;
      }

      // Load trusted users, checking for expiry
      const now = new Date();
      let loadedCount = 0;
      let expiredCount = 0;

      for (const [key, user] of Object.entries(parsed.trustedUsers)) {
        const lastActive = new Date(user.lastActiveAt);
        const daysSinceActive = (now.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActive > ChallengeAuth.TRUST_EXPIRY_DAYS) {
          expiredCount++;
          console.log(`[Auth] Trust expired for ${user.transport}/@${user.username} (${Math.floor(daysSinceActive)} days inactive)`);
          continue;
        }

        this.trustedUsers.set(key, user);
        // Also add to legacy authenticatedChats for DM access
        this.authenticatedChats.add(this.makeKey(user.transport, user.dmChatId));
        loadedCount++;
      }

      console.log(`[Auth] Loaded ${loadedCount} trusted users (${expiredCount} expired)`);
      
      // Save back without expired users
      if (expiredCount > 0) {
        await this.saveToStorage();
      }
    } catch (error) {
      console.error('[Auth] Failed to load persisted auth data:', error);
    }
  }

  private async saveToStorage(): Promise<void> {
    if (!this.secretStorage) {
      return;
    }

    try {
      const data: PersistedAuthData = {
        trustedUsers: Object.fromEntries(this.trustedUsers),
        version: ChallengeAuth.STORAGE_VERSION
      };
      await this.secretStorage.store(ChallengeAuth.STORAGE_KEY, JSON.stringify(data));
      console.log(`[Auth] Saved ${this.trustedUsers.size} trusted users to storage`);
    } catch (error) {
      console.error('[Auth] Failed to save auth data:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // TRUSTED USER MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if a user is trusted (authenticated via DM)
   */
  isUserTrusted(transport: string, userId: string): boolean {
    return this.trustedUsers.has(this.makeUserKey(transport, userId));
  }

  /**
   * Get a trusted user's info
   */
  getTrustedUser(transport: string, userId: string): TrustedUser | undefined {
    return this.trustedUsers.get(this.makeUserKey(transport, userId));
  }

  /**
   * Trust a user after successful DM authentication
   */
  async trustUser(transport: string, userId: string, username: string, dmChatId: string): Promise<void> {
    const key = this.makeUserKey(transport, userId);
    const now = new Date().toISOString();
    this.trustedUsers.set(key, {
      transport,
      userId,
      username,
      dmChatId,
      authenticatedAt: now,
      lastActiveAt: now
    });
    console.log(`[Auth] Trusted user: ${transport}/@${username} (${userId})`);
    await this.saveToStorage();
  }

  /**
   * Update last active time for a trusted user
   */
  async touchUser(transport: string, userId: string): Promise<void> {
    const key = this.makeUserKey(transport, userId);
    const user = this.trustedUsers.get(key);
    if (user) {
      user.lastActiveAt = new Date().toISOString();
      // Don't save on every message, but update in memory
    }
  }

  /**
   * Revoke trust for a user
   */
  async untrustUser(transport: string, userId: string): Promise<boolean> {
    const key = this.makeUserKey(transport, userId);
    const user = this.trustedUsers.get(key);
    if (user) {
      // Also revoke all channels they authorized
      for (const [channelKey, channel] of this.authorizedChannels) {
        if (channel.authorizedBy === key) {
          this.authorizedChannels.delete(channelKey);
        }
      }
      // Remove from legacy auth
      this.authenticatedChats.delete(this.makeKey(transport, user.dmChatId));
      this.trustedUsers.delete(key);
      console.log(`[Auth] Untrusted user: ${transport}/${userId}`);
      await this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Get all trusted users, optionally filtered by transport
   */
  getAllTrustedUsers(transport?: string): TrustedUser[] {
    const users = Array.from(this.trustedUsers.values());
    if (transport) {
      return users.filter(u => u.transport === transport);
    }
    return users;
  }

  // ─────────────────────────────────────────────────────────────
  // CHANNEL AUTHORIZATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Authorize the bot to respond in a channel
   * Only trusted users can do this
   */
  authorizeChannel(
    transport: string, 
    channelId: string, 
    authorizedByUserId: string,
    channelName?: string,
    mode: 'all' | 'mentions' | 'trusted-only' = 'mentions'
  ): boolean {
    const userKey = this.makeUserKey(transport, authorizedByUserId);
    if (!this.trustedUsers.has(userKey)) {
      return false;  // Only trusted users can authorize channels
    }

    const channelKey = this.makeChannelKey(transport, channelId);
    this.authorizedChannels.set(channelKey, {
      transport,
      channelId,
      channelName,
      authorizedBy: userKey,
      authorizedAt: new Date(),
      mode
    });

    console.log(`[Auth] Channel authorized: ${transport}/${channelName || channelId} by ${authorizedByUserId} (mode: ${mode})`);
    return true;
  }

  /**
   * Revoke bot access to a channel
   * Only the user who authorized it (or any trusted user) can revoke
   */
  revokeChannel(transport: string, channelId: string, byUserId: string): boolean {
    const channelKey = this.makeChannelKey(transport, channelId);
    const channel = this.authorizedChannels.get(channelKey);
    
    if (!channel) {
      return false;
    }

    const userKey = this.makeUserKey(transport, byUserId);
    // Only trusted users can revoke
    if (!this.trustedUsers.has(userKey)) {
      return false;
    }

    this.authorizedChannels.delete(channelKey);
    console.log(`[Auth] Channel revoked: ${transport}/${channelId} by ${byUserId}`);
    return true;
  }

  /**
   * Check if a channel is authorized
   */
  isChannelAuthorized(transport: string, channelId: string): boolean {
    return this.authorizedChannels.has(this.makeChannelKey(transport, channelId));
  }

  /**
   * Get channel authorization details
   */
  getChannelAuth(transport: string, channelId: string): AuthorizedChannel | undefined {
    return this.authorizedChannels.get(this.makeChannelKey(transport, channelId));
  }

  /**
   * Get all authorized channels for a transport
   */
  getAuthorizedChannels(transport: string): AuthorizedChannel[] {
    return Array.from(this.authorizedChannels.values())
      .filter(c => c.transport === transport);
  }

  /**
   * Track a channel we've seen (for name-based authorization)
   */
  trackChannel(transport: string, channelId: string, channelName?: string): void {
    if (!channelName) {
      return;
    }
    const key = this.makeKey(transport, channelName.toLowerCase());
    this.seenChannels.set(key, { channelId, channelName });
  }

  /**
   * Find channel ID by name
   */
  findChannelByName(transport: string, channelName: string): { channelId: string; channelName: string } | undefined {
    // Try exact match first
    let key = this.makeKey(transport, channelName.toLowerCase());
    let channel = this.seenChannels.get(key);
    if (channel) {
      return channel;
    }
    
    // Try partial match (e.g., "general" matches "#general")
    for (const [k, ch] of this.seenChannels) {
      if (k.startsWith(`${transport}:`) && ch.channelName.toLowerCase().includes(channelName.toLowerCase())) {
        return ch;
      }
    }
    
    return undefined;
  }

  // ─────────────────────────────────────────────────────────────
  // MESSAGE PERMISSION CHECK
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if the bot should respond to a message.
   * This is the main entry point for permission checks.
   */
  canRespondTo(msg: ExternalMessage): ChannelAuthResult {
    const { transport, chatId, userId, isDM, mentionsBot } = msg;

    // DMs: check if chat is authenticated (legacy) OR user is trusted
    if (isDM) {
      const chatAuthed = this.isAuthenticated(transport, chatId);
      const userTrusted = this.isUserTrusted(transport, userId);
      
      if (chatAuthed || userTrusted) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'not-dm-authed' };
    }

    // Group/Channel: check authorization
    const channelAuth = this.getChannelAuth(transport, chatId);
    if (!channelAuth) {
      return { allowed: false, reason: 'channel-not-authorized' };
    }

    // Check based on channel mode
    const userTrusted = this.isUserTrusted(transport, userId);

    switch (channelAuth.mode) {
      case 'all':
        // Anyone can talk in this channel
        return { allowed: true };
        
      case 'trusted-only':
        // Only trusted users
        if (userTrusted) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'not-trusted-in-channel' };
        
      case 'mentions':
      default:
        // Trusted users always allowed, others need to mention bot
        if (userTrusted || mentionsBot) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'no-mention' };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // LEGACY CHAT-BASED AUTH (kept for backwards compat & DM auth)
  // ─────────────────────────────────────────────────────────────

  isAuthenticated(transport: string, chatId: string): boolean {
    return this.authenticatedChats.has(this.makeKey(transport, chatId));
  }

  isBlocked(transport: string, chatId: string): boolean {
    const key = this.makeKey(transport, chatId);
    const blocked = this.blockedUsers.get(key);
    if (!blocked) {
      return false;
    }
    if (Date.now() > blocked.until) {
      this.blockedUsers.delete(key);
      return false;
    }
    return true;
  }

  getBlockTimeRemaining(transport: string, chatId: string): number {
    const key = this.makeKey(transport, chatId);
    const blocked = this.blockedUsers.get(key);
    if (!blocked) {
      return 0;
    }
    return Math.ceil((blocked.until - Date.now()) / 1000 / 60);
  }

  hasPendingChallenge(transport: string, chatId: string): boolean {
    const key = this.makeKey(transport, chatId);
    const challenge = this.pendingChallenges.get(key);
    if (!challenge) {
      return false;
    }
    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(key);
      return false;
    }
    return true;
  }

  createChallenge(transport: string, chatId: string, username: string): string {
    const key = this.makeKey(transport, chatId);
    const code = this.generateCode();
    
    this.pendingChallenges.set(key, {
      key: code,
      expiresAt: Date.now() + ChallengeAuth.CHALLENGE_EXPIRY_MS,
      attempts: 0
    });

    // Show in VS Code
    vscode.window.showInformationMessage(`🔐 @${username} auth code: ${code}`);
    console.log(`[Auth] Challenge for ${transport}/@${username} (${chatId}): ${code}`);

    return code;
  }

  /**
   * Verify a challenge response.
   * On success, also trusts the user (if isDM).
   * @returns 'success' | 'expired' | 'wrong' | 'blocked'
   */
  async verifyChallenge(
    transport: string, 
    chatId: string, 
    response: string, 
    userId: string,
    username: string,
    isDM: boolean = true
  ): Promise<'success' | 'expired' | 'wrong' | 'blocked'> {
    const key = this.makeKey(transport, chatId);
    const challenge = this.pendingChallenges.get(key);

    if (!challenge) {
      return 'expired';
    }

    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(key);
      return 'expired';
    }

    if (response === challenge.key) {
      this.pendingChallenges.delete(key);
      this.authenticatedChats.add(key);
      
      // Also trust the user if this is a DM
      if (isDM) {
        await this.trustUser(transport, userId, username, chatId);
      }
      
      console.log(`[Auth] ${transport}/@${username} (${chatId}) authenticated`);
      vscode.window.showInformationMessage(`✅ ${transport} user @${username} authenticated`);
      return 'success';
    }

    // Wrong code
    challenge.attempts++;
    const remaining = ChallengeAuth.MAX_ATTEMPTS - challenge.attempts;

    if (remaining <= 0) {
      this.pendingChallenges.delete(key);
      this.blockedUsers.set(key, {
        until: Date.now() + ChallengeAuth.BLOCK_DURATION_MS
      });
      console.log(`[Auth] ${transport}/@${username} (${chatId}) blocked`);
      vscode.window.showWarningMessage(`⚠️ ${transport} user @${username} blocked after failed auth`);
      return 'blocked';
    }

    return 'wrong';
  }

  getAttemptsRemaining(transport: string, chatId: string): number {
    const key = this.makeKey(transport, chatId);
    const challenge = this.pendingChallenges.get(key);
    if (!challenge) {
      return 0;
    }
    return ChallengeAuth.MAX_ATTEMPTS - challenge.attempts;
  }

  clearOnConnect(): void {
    this.blockedUsers.clear();
    this.pendingChallenges.clear();
    // Keep authenticated users and trusted users
  }

  reset(): void {
    this.authenticatedChats.clear();
    this.pendingChallenges.clear();
    this.blockedUsers.clear();
    this.trustedUsers.clear();
    this.authorizedChannels.clear();
  }
}

export const challengeAuth = new ChallengeAuth();
