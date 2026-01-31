import * as vscode from 'vscode';
import { telegramProvider } from './telegram/TelegramProvider';
import { remoteChatTool, setSecretStorage } from './tools/remoteChat';

export function activate(context: vscode.ExtensionContext) {
	console.log('[🍣 Chonky RemotePilot] Extension activated');

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

	// Command to disconnect from Telegram
	const disconnectTelegramCmd = vscode.commands.registerCommand('chonky.remotepilot.disconnect', () => {
		telegramProvider.disconnect();
		vscode.window.showInformationMessage('🍣 Disconnected from Telegram.');
	});

	// Register the tool
	console.log('[🍣 Chonky RemotePilot] Registering tool...');
	setSecretStorage(context.secrets);
	
	try {
		const toolDisposable = vscode.lm.registerTool('chonky_remotepilot', remoteChatTool);
		console.log('[🍣 Chonky RemotePilot] Tool registered');
		context.subscriptions.push(configureTelegramCmd, disconnectTelegramCmd, toolDisposable);
	} catch (error) {
		console.error('[🍣 Chonky RemotePilot] Failed to register tool:', error);
		context.subscriptions.push(configureTelegramCmd, disconnectTelegramCmd);
	}
}

export function deactivate() {
	telegramProvider.disconnect();
}
