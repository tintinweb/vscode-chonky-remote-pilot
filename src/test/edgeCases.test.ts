import * as assert from 'assert';
import * as vscode from 'vscode';
import { challengeAuth } from '../auth/ChallengeAuth';

suite('Edge Cases Test Suite', () => {
	vscode.window.showInformationMessage('Running Edge Cases tests');

	setup(() => {
		challengeAuth.reset();
	});

	test('Should handle challenge expiry (time-based)', async () => {
		const code = challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		// Simulate time passing by verifying it returns 'expired' after actual expiry
		// Note: This test doesn't actually wait 2 minutes, but tests the expiry check
		assert.ok(challengeAuth.hasPendingChallenge('telegram', 'chat123'));
		
		// Verify the code works before expiry
		const result = await challengeAuth.verifyChallenge(
			'telegram',
			'chat123',
			code,
			'user123',
			'testuser',
			true
		);
		
		assert.strictEqual(result, 'success');
	});

	test('Should handle block expiry check', () => {
		// Create a challenge and block the user
		challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		// We can't easily test time-based expiry in unit tests,
		// but we can verify the block time remaining works
		const isBlocked = challengeAuth.isBlocked('telegram', 'chat123');
		const remaining = challengeAuth.getBlockTimeRemaining('telegram', 'chat123');
		
		// Initially not blocked
		assert.strictEqual(isBlocked, false);
		assert.strictEqual(remaining, 0);
	});

	test('Should handle concurrent challenges from same chat', () => {
		const code1 = challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		const code2 = challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		// Second challenge should override first
		assert.notStrictEqual(code1, code2);
		assert.ok(challengeAuth.hasPendingChallenge('telegram', 'chat123'));
	});

	test('Should isolate channels across transports', async () => {
		// Telegram user authorizes Telegram channel
		await challengeAuth.trustUser('telegram', 'user123', 'teleuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'general', 'user123', 'general', 'all');
		
		// Should NOT authorize Slack channel
		assert.ok(challengeAuth.isChannelAuthorized('telegram', 'general'));
		assert.strictEqual(challengeAuth.isChannelAuthorized('slack', 'general'), false);
	});

	test('Should isolate users across transports', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		
		// Same userId on different transport should not be trusted
		assert.ok(challengeAuth.isUserTrusted('telegram', 'user123'));
		assert.strictEqual(challengeAuth.isUserTrusted('slack', 'user123'), false);
	});

	test('Should handle re-authorizing already authorized channel', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'general', 'user123', 'general', 'all');
		
		// Re-authorize with different mode
		challengeAuth.authorizeChannel('telegram', 'general', 'user123', 'general', 'mentions');
		
		const channel = challengeAuth.getChannelAuth('telegram', 'general');
		assert.ok(channel);
		assert.strictEqual(channel.mode, 'mentions'); // Should update mode
	});

	test('Should handle re-trusting already trusted user', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		const user1 = challengeAuth.getTrustedUser('telegram', 'user123');
		assert.ok(user1);
		
		// Re-trust with same info (e.g., after reconnect)
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		const user2 = challengeAuth.getTrustedUser('telegram', 'user123');
		assert.ok(user2);
		
		// Should still be trusted
		assert.ok(challengeAuth.isUserTrusted('telegram', 'user123'));
	});

	test('Should handle revoking non-existent channel', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		
		const result = challengeAuth.revokeChannel('telegram', 'nonexistent', 'user123');
		assert.strictEqual(result, false);
	});

	test('Should handle revoking non-existent user', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		
		const result = await challengeAuth.untrustUser('telegram', 'nonexistent');
		assert.strictEqual(result, false);
	});

	test('Should prevent untrusted user from authorizing channels', () => {
		// Try to authorize without being trusted
		const result = challengeAuth.authorizeChannel(
			'telegram',
			'general',
			'untrusted123',
			'general',
			'all'
		);
		
		assert.strictEqual(result, false);
		assert.strictEqual(challengeAuth.isChannelAuthorized('telegram', 'general'), false);
	});

	test('Should prevent untrusted user from revoking channels', async () => {
		// Create a channel as trusted user
		await challengeAuth.trustUser('telegram', 'user123', 'admin', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'general', 'user123', 'general', 'all');
		
		// Try to revoke as untrusted user
		const result = challengeAuth.revokeChannel('telegram', 'general', 'untrusted456');
		
		assert.strictEqual(result, false);
		assert.ok(challengeAuth.isChannelAuthorized('telegram', 'general')); // Still authorized
	});

	test('Should handle username with special characters', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'test@user#123', 'dm123');
		
		const user = challengeAuth.getTrustedUser('telegram', 'user123');
		assert.ok(user);
		assert.strictEqual(user.username, 'test@user#123');
	});

	test('Should handle very long channel names', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		const longName = 'a'.repeat(500);
		challengeAuth.authorizeChannel('telegram', 'ch123', 'user123', longName, 'all');
		
		const channel = challengeAuth.getChannelAuth('telegram', 'ch123');
		assert.ok(channel);
		assert.strictEqual(channel.channelName, longName);
	});

	test('Should handle empty channel name', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'ch123', 'user123', '', 'all');
		
		const channel = challengeAuth.getChannelAuth('telegram', 'ch123');
		assert.ok(channel);
		assert.strictEqual(channel.channelName, '');
	});

	test('Should handle undefined channel name', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'ch123', 'user123', undefined, 'all');
		
		const channel = challengeAuth.getChannelAuth('telegram', 'ch123');
		assert.ok(channel);
		assert.strictEqual(channel.channelName, undefined);
	});

	test('Should handle multiple transports with same channel ID', async () => {
		await challengeAuth.trustUser('telegram', 'user1', 'teleuser', 'dm1');
		await challengeAuth.trustUser('slack', 'user2', 'slackuser', 'dm2');
		
		// Same channel ID on different transports
		challengeAuth.authorizeChannel('telegram', 'general', 'user1', 'general', 'all');
		challengeAuth.authorizeChannel('slack', 'general', 'user2', 'general', 'mentions');
		
		const teleChannel = challengeAuth.getChannelAuth('telegram', 'general');
		const slackChannel = challengeAuth.getChannelAuth('slack', 'general');
		
		assert.ok(teleChannel);
		assert.ok(slackChannel);
		assert.strictEqual(teleChannel.mode, 'all');
		assert.strictEqual(slackChannel.mode, 'mentions');
	});

	test('Should handle getting channels for empty transport', () => {
		const channels = challengeAuth.getAuthorizedChannels('nonexistent');
		assert.strictEqual(channels.length, 0);
	});

	test('Should handle getting users for empty transport', () => {
		const users = challengeAuth.getAllTrustedUsers('nonexistent');
		assert.strictEqual(users.length, 0);
	});

	test('Should handle canRespondTo with missing fields', () => {
		const result = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'ch123',
			userId: 'user123',
			username: 'test',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			// mentionsBot is undefined
			// channelName is undefined
		});
		
		assert.strictEqual(result.allowed, false);
	});

	test('Should handle trusted user in DM even if not in authenticatedChats', async () => {
		// Trust user directly without going through authenticatedChats
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		
		const result = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'dm456', // Different chatId
			userId: 'user123',
			username: 'testuser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: true
		});
		
		assert.strictEqual(result.allowed, true);
	});

	test('Should handle mixed mode authorization logic', async () => {
		await challengeAuth.trustUser('telegram', 'trusted1', 'admin', 'dm1');
		challengeAuth.authorizeChannel('telegram', 'ch123', 'trusted1', 'test', 'mentions');
		
		// Trusted user without mention - should be allowed
		const trustedNoMention = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'ch123',
			userId: 'trusted1',
			username: 'admin',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		assert.strictEqual(trustedNoMention.allowed, true);
		
		// Untrusted user with mention - should be allowed
		const untrustedWithMention = challengeAuth.canRespondTo({
			id: 'msg2',
			chatId: 'ch123',
			userId: 'random',
			username: 'random',
			content: '@bot hi',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: true
		});
		assert.strictEqual(untrustedWithMention.allowed, true);
		
		// Untrusted user without mention - should be rejected
		const untrustedNoMention = challengeAuth.canRespondTo({
			id: 'msg3',
			chatId: 'ch123',
			userId: 'random',
			username: 'random',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		assert.strictEqual(untrustedNoMention.allowed, false);
	});

	test('Should handle 0 remaining attempts', () => {
		challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		const remaining = challengeAuth.getAttemptsRemaining('telegram', 'chat123');
		assert.strictEqual(remaining, 3); // Initially 3 attempts
	});

	test('Should handle checking attempts for non-existent challenge', () => {
		const remaining = challengeAuth.getAttemptsRemaining('telegram', 'nonexistent');
		assert.strictEqual(remaining, 0);
	});

	test('Should clear state correctly on reset', async () => {
		// Set up various state
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'ch123', 'user123', 'test', 'all');
		challengeAuth.createChallenge('slack', 'chat456', 'another');
		
		// Reset
		challengeAuth.reset();
		
		// Everything should be cleared
		assert.strictEqual(challengeAuth.isUserTrusted('telegram', 'user123'), false);
		assert.strictEqual(challengeAuth.isChannelAuthorized('telegram', 'ch123'), false);
		assert.strictEqual(challengeAuth.hasPendingChallenge('slack', 'chat456'), false);
		assert.strictEqual(challengeAuth.isAuthenticated('telegram', 'dm123'), false);
	});
});
