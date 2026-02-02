import * as assert from 'assert';
import * as vscode from 'vscode';
import { challengeAuth } from '../auth/ChallengeAuth';

suite('ChallengeAuth Test Suite', () => {
	vscode.window.showInformationMessage('Running ChallengeAuth tests');

	setup(() => {
		// Reset auth state before each test
		challengeAuth.reset();
	});

	test('Should generate 6-digit code', () => {
		const code = challengeAuth.generateCode();
		assert.strictEqual(code.length, 6);
		assert.ok(/^\d{6}$/.test(code));
	});

	test('Should create and verify challenge', async () => {
		const code = challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		assert.ok(challengeAuth.hasPendingChallenge('telegram', 'chat123'));
		
		const result = await challengeAuth.verifyChallenge(
			'telegram',
			'chat123',
			code,
			'user123',
			'testuser',
			true
		);
		
		assert.strictEqual(result, 'success');
		assert.ok(challengeAuth.isAuthenticated('telegram', 'chat123'));
	});

	test('Should reject wrong challenge code', async () => {
		challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		const result = await challengeAuth.verifyChallenge(
			'telegram',
			'chat123',
			'000000',
			'user123',
			'testuser',
			true
		);
		
		assert.strictEqual(result, 'wrong');
		assert.strictEqual(challengeAuth.isAuthenticated('telegram', 'chat123'), false);
	});

	test('Should block after max attempts', async () => {
		challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		// Try 3 times with wrong code
		await challengeAuth.verifyChallenge('telegram', 'chat123', '000000', 'user123', 'testuser', true);
		await challengeAuth.verifyChallenge('telegram', 'chat123', '000000', 'user123', 'testuser', true);
		const result = await challengeAuth.verifyChallenge('telegram', 'chat123', '000000', 'user123', 'testuser', true);
		
		assert.strictEqual(result, 'blocked');
		assert.ok(challengeAuth.isBlocked('telegram', 'chat123'));
	});

	test('Should trust user after successful DM auth', async () => {
		const code = challengeAuth.createChallenge('telegram', 'chat123', 'testuser');
		
		await challengeAuth.verifyChallenge(
			'telegram',
			'chat123',
			code,
			'user123',
			'testuser',
			true // isDM
		);
		
		assert.ok(challengeAuth.isUserTrusted('telegram', 'user123'));
		
		const user = challengeAuth.getTrustedUser('telegram', 'user123');
		assert.ok(user);
		assert.strictEqual(user.username, 'testuser');
		assert.strictEqual(user.dmChatId, 'chat123');
	});

	test('Should not allow unauthorized channel messages', () => {
		const result = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'channel123',
			userId: 'user123',
			username: 'testuser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		
		assert.strictEqual(result.allowed, false);
		assert.strictEqual(result.reason, 'channel-not-authorized');
	});

	test('Should allow mentions in authorized channel (mentions mode)', async () => {
		// First, trust the user
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		
		// Authorize a channel
		challengeAuth.authorizeChannel('telegram', 'channel123', 'user123', 'testchannel', 'mentions');
		
		// Non-mention should be rejected
		const nonMention = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'channel123',
			userId: 'other456',
			username: 'otheruser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		
		assert.strictEqual(nonMention.allowed, false);
		assert.strictEqual(nonMention.reason, 'no-mention');
		
		// Mention should be allowed
		const withMention = challengeAuth.canRespondTo({
			id: 'msg2',
			chatId: 'channel123',
			userId: 'other456',
			username: 'otheruser',
			content: 'hello @bot',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: true
		});
		
		assert.strictEqual(withMention.allowed, true);
	});

	test('Should allow all messages in all mode', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'channel123', 'user123', 'testchannel', 'all');
		
		const result = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'channel123',
			userId: 'anyone',
			username: 'anyuser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		
		assert.strictEqual(result.allowed, true);
	});

	test('Should only allow trusted users in trusted-only mode', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'channel123', 'user123', 'testchannel', 'trusted-only');
		
		// Trusted user allowed
		const trustedResult = challengeAuth.canRespondTo({
			id: 'msg1',
			chatId: 'channel123',
			userId: 'user123',
			username: 'testuser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		
		assert.strictEqual(trustedResult.allowed, true);
		
		// Non-trusted user rejected
		const untrustedResult = challengeAuth.canRespondTo({
			id: 'msg2',
			chatId: 'channel123',
			userId: 'other456',
			username: 'otheruser',
			content: 'hello',
			timestamp: new Date(),
			transport: 'telegram',
			isDM: false,
			mentionsBot: false
		});
		
		assert.strictEqual(untrustedResult.allowed, false);
		assert.strictEqual(untrustedResult.reason, 'not-trusted-in-channel');
	});

	test('Should revoke channel authorization', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'channel123', 'user123', 'testchannel', 'all');
		
		assert.ok(challengeAuth.isChannelAuthorized('telegram', 'channel123'));
		
		const revoked = challengeAuth.revokeChannel('telegram', 'channel123', 'user123');
		assert.strictEqual(revoked, true);
		assert.strictEqual(challengeAuth.isChannelAuthorized('telegram', 'channel123'), false);
	});

	test('Should revoke all channels when user is untrusted', async () => {
		await challengeAuth.trustUser('telegram', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('telegram', 'channel1', 'user123', 'testchannel1', 'all');
		challengeAuth.authorizeChannel('telegram', 'channel2', 'user123', 'testchannel2', 'mentions');
		
		assert.strictEqual(challengeAuth.getAuthorizedChannels('telegram').length, 2);
		
		await challengeAuth.untrustUser('telegram', 'user123');
		
		assert.strictEqual(challengeAuth.isUserTrusted('telegram', 'user123'), false);
		assert.strictEqual(challengeAuth.getAuthorizedChannels('telegram').length, 0);
	});
});

