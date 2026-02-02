# Chonky RemotePilot

<p align="center">
  <img src="img/chonky-remote-pilot-sticker.jpg" alt="Chonky RemotePilot" width="600">
</p>

Multi-transport chat bridge for VS Code Chat. Control your AI coding assistant remotely via Telegram, WhatsApp, Slack, or Discord.

> ⚠️ **EXPERIMENTAL - USE WITH CAUTION**
>
> This extension forwards messages from external chat platforms directly into your VS Code Copilot Chat session. Authenticated users can instruct the AI to **read files, edit code, run terminal commands**, and perform any action available to the AI assistant.
>
> **Only authorize users you fully trust.** Treat this like giving someone remote access to your development environment.

## Features

- 📱 **Multi-Transport** - Connect via Telegram, WhatsApp, Slack, and/or Discord
- 🔐 **Secure Authentication** - Challenge-response auth with 6-digit codes per transport
- ⌨️ **Typing Indicator** - Shows "typing..." while the AI processes your request
- 🔄 **Continuous Loop** - Maintains an active chat session until cancelled
- 🔒 **Secure Storage** - Credentials stored securely in VS Code

## Setup

### Telegram

1. Create a Telegram bot via [@BotFather](https://t.me/botfather) and get your bot token
2. Run command: `🧑‍✈️🍣 Chonky RemotePilot: Configure Telegram`
3. Enter your bot token
4. In VS Code Chat, type: **"chonky listen"** or **"start remote pilot"**
5. Send a message to your bot on Telegram
6. Enter the 6-digit auth code shown in VS Code
7. Start chatting!

### WhatsApp

1. Run command: `🧑‍✈️🍣 Chonky RemotePilot: Configure WhatsApp`
2. Scan the QR code shown in the Output panel with WhatsApp (Settings > Linked Devices)
3. In VS Code Chat, type: **"chonky listen"** or **"start remote pilot"**
4. Send a message to yourself (or the Saved Messages chat) on WhatsApp
5. Enter the 6-digit auth code shown in VS Code
6. Start chatting!

### Slack

1. Create a Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an **App-Level Token** (xapp-...)
3. Add Bot Token Scopes: `chat:write`, `im:history`, `im:read`, `users:read`
4. Enable Events and subscribe to `message.im`
5. Install app to your workspace and copy the **Bot Token** (xoxb-...)
6. Run command: `🧑‍✈️🍣 Chonky RemotePilot: Configure Slack`
7. Enter both tokens when prompted
8. In VS Code Chat, type: **"chonky listen"** or **"start remote pilot"**
9. DM the bot in Slack and enter the 6-digit auth code

### Discord

1. Create a Discord App at [discord.com/developers](https://discord.com/developers/applications)
2. Add a Bot and **enable MESSAGE CONTENT INTENT** (required!)
3. Copy the Bot Token
4. Use OAuth2 URL Generator to create invite link with scopes: `bot`
5. Add permissions: Send Messages, Read Message History, View Channels
6. Invite bot to your server
7. Run command: `🧑‍✈️🍣 Chonky RemotePilot: Configure Discord`
8. Enter your bot token
9. In VS Code Chat, type: **"chonky listen"** or **"start remote pilot"**
10. DM the bot or message in a channel, enter the 6-digit auth code

## Usage

Once authenticated via DM, you become a **trusted user** and can:

1. **Chat directly** - Send messages in DM and the AI will respond
2. **Enable channels** - Authorize group chats/channels for the bot
3. **Control access** - Set how the bot responds in each channel

### Admin Commands (in DM)

| Command | Description |
|---------|-------------|
| `enable #channel` | Enable a channel (default: mentions mode) |
| `enable #channel all` | Bot responds to everyone |
| `enable #channel mentions` | Bot responds when @mentioned |
| `enable #channel trusted-only` | Only trusted users can interact |
| `disable #channel` | Disable a channel |
| `channels` | List enabled channels |
| `trusted` | List all trusted users |
| `revoke @user` | Remove a trusted user |
| `help` | Show available commands |

### Group Chat Behavior

- **Unauthorized channels**: Bot silently ignores messages
- **Mentions mode**: Bot only responds when @mentioned
- **All mode**: Bot responds to any message
- **Trusted-only mode**: Only authenticated users can interact

**Note:** You can connect multiple transports simultaneously - messages from any authenticated transport will be processed.

## Commands

- `🧑‍✈️🍣 Chonky RemotePilot: Configure Telegram` - Set up your Telegram bot
- `🧑‍✈️🍣 Chonky RemotePilot: Configure WhatsApp` - Connect WhatsApp (scan QR code)
- `🧑‍✈️🍣 Chonky RemotePilot: Configure Slack` - Set up Slack (Socket Mode)
- `🧑‍✈️🍣 Chonky RemotePilot: Configure Discord` - Set up Discord bot
- `🧑‍✈️🍣 Chonky RemotePilot: Disconnect` - Stop all transports

## Transport Icons

| Transport | Icon |
|-----------|------|
| Telegram  | 📱   |
| WhatsApp  | 💬   |
| Slack     | 💼   |
| Discord   | 🎮   |

## Security

- **Challenge-Response Auth**: First-time users must enter a 6-digit code displayed in VS Code
- **Persistent Trust**: Trusted users are remembered across VS Code sessions (stored securely)
- **Auto-Expiry**: Trust expires after 30 days of inactivity (requires re-auth)
- **Session Channels**: Channel authorizations reset on VS Code restart (security)
- **Revokable Access**: Use `revoke @user` to remove trusted users anytime
- **Group Authorization**: Bot only responds in explicitly enabled channels
- **Per-Transport Auth**: Each transport requires separate authentication
- **Code Expiry**: Auth codes expire after 2 minutes
- **Rate Limiting**: 3 failed attempts = 5 minute block

## Requirements

- VS Code 1.107.0+
- For Telegram: A Telegram account and bot token
- For WhatsApp: A WhatsApp account on your phone
- For Slack: A Slack workspace and app with Socket Mode
- For Discord: A Discord account and bot token

## Supported Transports

- ✅ Telegram (node-telegram-bot-api)
- ✅ WhatsApp (Baileys)
- ✅ Slack (Bolt SDK + Socket Mode)
- ✅ Discord (discord.js)
- 🔜 Signal

## Release Notes

### 0.0.5

- Persistent trusted users (survives VS Code restart)
- 30-day auto-expiry for inactive users
- New commands: `trusted` (list users), `revoke @user` (remove trust)
- Channel authorizations remain session-only (security)

### 0.0.4

- Group chat authorization system
- Trusted users can enable/disable channels via DM commands
- Three channel modes: `all`, `mentions`, `trusted-only`
- Bot mention detection (@botname) for Telegram, Slack, Discord
- Silent ignore for unauthorized group messages

### 0.0.3

- Added Slack support via Bolt SDK with Socket Mode
- Added Discord support via discord.js
- Discord messages auto-split for 2000 char limit

### 0.0.2

- Added WhatsApp support via Baileys
- Multi-transport architecture
- Per-transport authentication

### 0.0.1

Initial release:
- Telegram bot integration
- Challenge-response authentication
- Auto-connect on tool invocation
- Typing indicators

## License

MIT
