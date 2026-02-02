import * as vscode from 'vscode';
import { transportManager } from './transports/TransportManager';
import { remoteChatTool, setSecretStorage, setGlobalStoragePath } from './tools/remoteChat';
import { whatsappProvider } from './transports/WhatsAppProvider';
import { slackProvider } from './transports/SlackProvider';
import { discordProvider } from './transports/DiscordProvider';
import { challengeAuth } from './auth/ChallengeAuth';

export async function activate(context: vscode.ExtensionContext) {
	console.log('[🍣 Chonky RemotePilot] Extension activated');

	// Initialize authentication with persistence
	await challengeAuth.initialize(context.secrets);

	// Command to configure Telegram bot token
	const configureTelegramCmd = vscode.commands.registerCommand('chonky.remotepilot.configureTelegram', async () => {
		const token = await vscode.window.showInputBox({
			prompt: 'Enter your Telegram Bot Token (from @BotFather)',
			password: true,
			placeHolder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
		});

		if (token) {
			await context.secrets.store('telegram-bot-token', token);
			vscode.window.showInformationMessage('🍣 Telegram bot token saved!');
			console.log('[🍣 Chonky RemotePilot] Bot token stored');
		}
	});

	// Command to configure WhatsApp
	const configureWhatsAppCmd = vscode.commands.registerCommand('chonky.remotepilot.configureWhatsApp', async () => {
		const authPath = `${context.globalStorageUri.fsPath}/whatsapp-auth`;
		
		vscode.window.showInformationMessage('🍣 Starting WhatsApp connection... Check the Output panel for QR code.');
		
		try {
			// Create output channel for QR code display
			const outputChannel = vscode.window.createOutputChannel('🍣 RemotePilot WhatsApp');
			outputChannel.show();
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('🍣 WhatsApp Setup - Scan the QR code with WhatsApp');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('');
			outputChannel.appendLine('Open WhatsApp on your phone:');
			outputChannel.appendLine('  1. Go to Settings > Linked Devices');
			outputChannel.appendLine('  2. Tap "Link a Device"');
			outputChannel.appendLine('  3. Scan the QR code below');
			outputChannel.appendLine('');
			
			await whatsappProvider.connect({ authPath });
			outputChannel.appendLine('');
			outputChannel.appendLine('✅ WhatsApp connected successfully!');
			vscode.window.showInformationMessage('🍣 WhatsApp connected! Send a message to yourself to start.');
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to connect WhatsApp: ${error}`);
		}
	});

	// Command to configure Slack
	const configureSlackCmd = vscode.commands.registerCommand('chonky.remotepilot.configureSlack', async () => {
		// Show setup instructions first
		const proceed = await vscode.window.showInformationMessage(
			'🍣 Slack Setup: You need a Slack App with Socket Mode enabled.\n' +
			'1. Create app at api.slack.com/apps\n' +
			'2. Enable Socket Mode (get App Token xapp-...)\n' +
			'3. Add Bot Token Scopes: chat:write, im:history, im:read, users:read\n' +
			'4. Install to workspace (get Bot Token xoxb-...)',
			'Continue', 'Cancel'
		);

		if (proceed !== 'Continue') {
			return;
		}

		const botToken = await vscode.window.showInputBox({
			prompt: 'Enter your Slack Bot Token (starts with xoxb-)',
			password: true,
			placeHolder: 'xoxb-...'
		});

		if (!botToken) {
			return;
		}

		const appToken = await vscode.window.showInputBox({
			prompt: 'Enter your Slack App Token for Socket Mode (starts with xapp-)',
			password: true,
			placeHolder: 'xapp-...'
		});

		if (!appToken) {
			return;
		}

		await context.secrets.store('slack-bot-token', botToken);
		await context.secrets.store('slack-app-token', appToken);
		
		vscode.window.showInformationMessage('🍣 Slack tokens saved! Connecting...');

		try {
			await slackProvider.connect({ botToken, appToken });
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to connect Slack: ${error}`);
		}
	});

	// Command to configure Discord
	const configureDiscordCmd = vscode.commands.registerCommand('chonky.remotepilot.configureDiscord', async () => {
		// Show setup instructions first
		const proceed = await vscode.window.showInformationMessage(
			'🍣 Discord Setup:\n' +
			'1. Create app at discord.com/developers/applications\n' +
			'2. Add Bot and enable MESSAGE CONTENT INTENT\n' +
			'3. Copy Bot Token\n' +
			'4. Invite bot to server with OAuth2 URL Generator',
			'Continue', 'Cancel'
		);

		if (proceed !== 'Continue') {
			return;
		}

		const token = await vscode.window.showInputBox({
			prompt: 'Enter your Discord Bot Token',
			password: true,
			placeHolder: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OQ...'
		});

		if (!token) {
			return;
		}

		await context.secrets.store('discord-bot-token', token);
		vscode.window.showInformationMessage('🍣 Discord token saved! Connecting...');

		try {
			await discordProvider.connect({ token });
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to connect Discord: ${error}`);
		}
	});

	// Command to disconnect all transports
	const disconnectCmd = vscode.commands.registerCommand('chonky.remotepilot.disconnect', () => {
		transportManager.disconnect();
		vscode.window.showInformationMessage('🍣 Disconnected from all transports.');
	});

	// Register the tool
	console.log('[🍣 Chonky RemotePilot] Registering tool...');
	setSecretStorage(context.secrets);
	setGlobalStoragePath(context.globalStorageUri.fsPath);
	
	try {
		const toolDisposable = vscode.lm.registerTool('chonky_remotepilot', remoteChatTool);
		console.log('[🍣 Chonky RemotePilot] Tool registered');
		context.subscriptions.push(configureTelegramCmd, configureWhatsAppCmd, configureSlackCmd, configureDiscordCmd, disconnectCmd, toolDisposable);
	} catch (error) {
		console.error('[🍣 Chonky RemotePilot] Failed to register tool:', error);
		context.subscriptions.push(configureTelegramCmd, configureWhatsAppCmd, configureSlackCmd, configureDiscordCmd, disconnectCmd);
	}
}

export function deactivate() {
	transportManager.disconnect();
}
