import * as assert from 'assert';
import * as vscode from 'vscode';
import { TransportManager } from '../transports/TransportManager';
import { ITransportProvider, ExternalMessage } from '../transports/ITransportProvider';
import { challengeAuth } from '../auth/ChallengeAuth';

class MockTransport implements ITransportProvider {
	readonly name = 'mock';
	private _isConnected = false;
	private _messageCallback: ((msg: ExternalMessage) => void) | null = null;
	private _errorCallback: ((error: Error) => void) | null = null;
	
	sentMessages: Array<{ chatId: string; text: string; replyTo?: string }> = [];
	typingCalls: string[] = [];

	get isConnected(): boolean {
		return this._isConnected;
	}

	async connect(): Promise<void> {
		this._isConnected = true;
	}

	disconnect(): void {
		this._isConnected = false;
		this.sentMessages = [];
		this.typingCalls = [];
	}

	onMessage(callback: (msg: ExternalMessage) => void): void {
		this._messageCallback = callback;
	}

	onError(callback: (error: Error) => void): void {
		this._errorCallback = callback;
	}

	async sendMessage(chatId: string, text: string, replyTo?: string): Promise<void> {
		this.sentMessages.push({ chatId, text, replyTo });
	}

	async sendTyping(chatId: string): Promise<void> {
		this.typingCalls.push(chatId);
	}

	// Helper to simulate incoming message
	simulateMessage(msg: Partial<ExternalMessage>): void {
		if (this._messageCallback) {
			const fullMsg: ExternalMessage = {
				id: msg.id || 'test-msg',
				chatId: msg.chatId || 'test-chat',
				userId: msg.userId || 'test-user',
				username: msg.username || 'testuser',
				content: msg.content || 'test message',
				timestamp: msg.timestamp || new Date(),
				transport: msg.transport || 'mock',
				isDM: msg.isDM ?? true,
				mentionsBot: msg.mentionsBot,
				channelName: msg.channelName
			};
			this._messageCallback(fullMsg);
		}
	}

	getLastMessage(): { chatId: string; text: string; replyTo?: string } | undefined {
		return this.sentMessages[this.sentMessages.length - 1];
	}

	clearMessages(): void {
		this.sentMessages = [];
		this.typingCalls = [];
	}
}

suite('TransportManager Test Suite', () => {
	let manager: TransportManager;
	let mockTransport: MockTransport;

	setup(async () => {
		manager = new TransportManager();
		mockTransport = new MockTransport();
		challengeAuth.reset();
		
		// Register the mock transport
		manager.register(mockTransport);
		await mockTransport.connect();
	});

	teardown(() => {
		manager.disconnect();
		challengeAuth.reset();
	});

	test('Should handle 6-digit code authentication', async () => {
		// Create challenge
		const code = challengeAuth.createChallenge('mock', 'dm123', 'testuser');
		mockTransport.clearMessages();

		// Send correct 6-digit code
		const result = await challengeAuth.verifyChallenge(
			'mock',
			'dm123',
			code,
			'user123',
			'testuser',
			true
		);

		assert.strictEqual(result, 'success');
		assert.ok(challengeAuth.isAuthenticated('mock', 'dm123'));
		assert.ok(challengeAuth.isUserTrusted('mock', 'user123'));
	});

	test('Should reject 5-digit codes with reminder', async () => {
		challengeAuth.createChallenge('mock', 'dm123', 'testuser');
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'dm123',
			userId: 'user123',
			username: 'testuser',
			content: '12345', // 5 digits
			isDM: true
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		const lastMsg = mockTransport.getLastMessage();
		assert.ok(lastMsg);
		assert.ok(lastMsg.text.includes('exactly 6 digits'));
	});

	test('Should reject 7-digit codes with reminder', async () => {
		challengeAuth.createChallenge('mock', 'dm123', 'testuser');
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'dm123',
			userId: 'user123',
			username: 'testuser',
			content: '1234567', // 7 digits
			isDM: true
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		const lastMsg = mockTransport.getLastMessage();
		assert.ok(lastMsg);
		assert.ok(lastMsg.text.includes('exactly 6 digits'));
	});

	test('Should ignore non-numeric text during challenge', async () => {
		challengeAuth.createChallenge('mock', 'dm123', 'testuser');
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'dm123',
			userId: 'user123',
			username: 'testuser',
			content: 'hello world',
			isDM: true
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		// Should get no response (silently ignored)
		const messages = mockTransport.sentMessages;
		assert.strictEqual(messages.length, 0);
	});

	test('Should handle enable command from trusted user', async () => {
		// Trust the user first
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		
		// Enable command should authorize the channel
		const enableResult = challengeAuth.authorizeChannel('mock', 'general', 'user123', 'general', 'mentions');
		assert.strictEqual(enableResult, true);
		assert.ok(challengeAuth.isChannelAuthorized('mock', 'general'));
	});

	test('Should handle disable command from trusted user', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('mock', 'general', 'user123', 'general', 'all');
		
		const revokeResult = challengeAuth.revokeChannel('mock', 'general', 'user123');
		assert.strictEqual(revokeResult, true);
		assert.strictEqual(challengeAuth.isChannelAuthorized('mock', 'general'), false);
	});

	test('Should handle channels list from trusted user', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('mock', 'channel1', 'user123', 'channel1', 'all');
		challengeAuth.authorizeChannel('mock', 'channel2', 'user123', 'channel2', 'mentions');
		
		const channels = challengeAuth.getAuthorizedChannels('mock');
		assert.strictEqual(channels.length, 2);
		assert.ok(channels.some(c => c.channelId === 'channel1'));
		assert.ok(channels.some(c => c.channelId === 'channel2'));
	});

	test('Should handle trusted users list', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		await challengeAuth.trustUser('mock', 'user456', 'anotheruser', 'dm456');
		
		const users = challengeAuth.getAllTrustedUsers('mock');
		assert.strictEqual(users.length, 2);
		assert.ok(users.some(u => u.username === 'testuser'));
		assert.ok(users.some(u => u.username === 'anotheruser'));
	});

	test('Should handle revoke user', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		await challengeAuth.trustUser('mock', 'user456', 'victim', 'dm456');
		
		const revokeResult = await challengeAuth.untrustUser('mock', 'user456');
		assert.strictEqual(revokeResult, true);
		assert.strictEqual(challengeAuth.isUserTrusted('mock', 'user456'), false);
	});

	test('Should get list of trusted users for transport', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		await challengeAuth.trustUser('telegram', 'user456', 'teleuser', 'dm456');
		
		const mockUsers = challengeAuth.getAllTrustedUsers('mock');
		assert.strictEqual(mockUsers.length, 1);
		assert.strictEqual(mockUsers[0].username, 'testuser');
		
		const allUsers = challengeAuth.getAllTrustedUsers();
		assert.strictEqual(allUsers.length, 2);
	});

	test('Should ignore unauthorized group messages', async () => {
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'channel123',
			userId: 'user123',
			username: 'testuser',
			content: 'hello',
			isDM: false,
			mentionsBot: false,
			channelName: 'general'
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		// Should send no response
		assert.strictEqual(mockTransport.sentMessages.length, 0);
	});

	test('Should respond to bot mentions in authorized channel', async () => {
		await challengeAuth.trustUser('mock', 'user123', 'testuser', 'dm123');
		challengeAuth.authorizeChannel('mock', 'channel123', 'user123', 'general', 'mentions');
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'channel123',
			userId: 'other456',
			username: 'otheruser',
			content: '@bot help',
			isDM: false,
			mentionsBot: true,
			channelName: 'general'
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		// Should NOT ignore (message would be queued for the tool)
		// We can't directly test queueing, but we can verify no error response
		const messages = mockTransport.sentMessages;
		// No challenge should be sent for group messages
		const hasChallengeMsg = messages.some(m => m.text.includes('Authentication Required'));
		assert.strictEqual(hasChallengeMsg, false);
	});

	test('Should handle blocked user', async () => {
		// Block the user
		challengeAuth.createChallenge('mock', 'dm123', 'testuser');
		await challengeAuth.verifyChallenge('mock', 'dm123', '000000', 'user123', 'testuser', true);
		await challengeAuth.verifyChallenge('mock', 'dm123', '000000', 'user123', 'testuser', true);
		await challengeAuth.verifyChallenge('mock', 'dm123', '000000', 'user123', 'testuser', true);
		
		mockTransport.clearMessages();

		mockTransport.simulateMessage({
			chatId: 'dm123',
			userId: 'user123',
			username: 'testuser',
			content: 'hello',
			isDM: true
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		const lastMsg = mockTransport.getLastMessage();
		assert.ok(lastMsg);
		assert.ok(lastMsg.text.includes('blocked') || lastMsg.text.includes('Too many failed'));
	});
});
