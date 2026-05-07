# Claude Slack Bot

A Slack bot powered by [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) that brings AI-powered assistance directly into your workspace. Uses Slack Bolt with Socket Mode for real-time messaging.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Slack App Setup](#slack-app-setup)
- [Configuration](#configuration)
- [Using the Bot in Slack](#using-the-bot-in-slack)
- [Integrations](#integrations)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

---

## Features

| Feature | Description |
|---------|-------------|
| **Conversational AI** | Chat with Claude directly in Slack threads or DMs |
| **Direct Messages** | Auto-responds to DMs without @mention, with full conversation history |
| **Multi-Source Search** | Automatically searches Memory, Atlassian, Google Drive, and NotebookLM with streaming results |
| **Thread Continuity** | Maintains context and session across all messages in a thread (1-hour TTL) |
| **Smart Memory** | Auto-summarizes channel activity daily and saves important information on request |
| **User Memory** | Personal notes saved per-user, separate from channel memory |
| **File Downloads** | Automatically downloads and processes Slack file attachments (PDFs, images, code, etc.) |
| **Slack Canvas Support** | Reads and includes Slack Canvas documents with HTML-to-markdown conversion |
| **Live Status Updates** | Shows what the bot is doing in real-time (e.g., "Searching Jira...") |
| **Dual Model Support** | Uses faster models for searches, smarter models for complex tasks |
| **Per-Channel Config** | Different settings, integrations, and models per channel |
| **Config Commands** | Watch/unwatch channels and users with simple commands |
| **Slack-Friendly Formatting** | Responses use Slack's mrkdwn format with emojis |

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated
- **Slack workspace** with admin permissions to install apps

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd claude-slack-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials (see Configuration section)

# Start the bot
./build-and-run.sh
```

### Running as a Service (macOS)

For always-on operation with a menu bar monitor, open the Xcode project in `Client/ClaudeBotMonitor.xcodeproj` and build the app. It provides:
- A native menu bar app with live console output
- Bot runs as a background service (launchd)
- Auto-restart on failure and system reboot
- Menu bar icon with Start/Stop/Restart controls

To uninstall: `./Client/uninstall.sh`

---

## Slack App Setup

### Step 1: Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name your app (e.g., "Claude Assistant") and select your workspace

### Step 2: Enable Socket Mode

1. Navigate to **Socket Mode** in the sidebar
2. Toggle **Enable Socket Mode** to ON
3. Click **Generate Token**, name it (e.g., "socket-token"), add scope `connections:write`
4. Copy the **App Token** (starts with `xapp-`) → save as `SLACK_APP_TOKEN`

### Step 3: Configure Bot Permissions

Navigate to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** and add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Receive @mention events |
| `channels:history` | Read public channel messages |
| `channels:read` | View channel information |
| `chat:write` | Send messages |
| `files:read` | Download file attachments |
| `files:write` | Upload files to channels/threads |
| `users:read` | View user profiles |
| `im:history` | Read DM conversation history |
| `im:read` | View DM information |
| `canvases:read` | Read Slack Canvas documents |

### Step 4: Enable Event Subscriptions

1. Navigate to **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Under **Subscribe to bot events**, add:
   - `app_mention`
   - `message.channels`
   - `message.im` (for DM support)

### Step 5: Install the App

1. Navigate to **Install App** → **Install to Workspace**
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → save as `SLACK_BOT_TOKEN`
3. Navigate to **Basic Information** → **App Credentials**
4. Copy the **Signing Secret** → save as `SLACK_SIGNING_SECRET`

### Step 6: Get Bot User ID

1. In Slack, find your bot in the member list or type `@YourBotName`
2. Click on the bot's name to view profile
3. Copy the **Member ID** (starts with `U`) → save as `BOT_USER_ID`

---

## Configuration

All configuration is managed through environment variables and per-channel config files.

### Required Settings (.env)

```bash
# Slack Credentials
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
BOT_USER_ID=UXXXXXXXXXX
```

### Optional Settings (.env)

```bash
# Claude Models (defaults)
CLAUDE_MODEL_THINKING=sonnet    # For complex responses
CLAUDE_MODEL_QUICK=haiku        # For searches and quick tasks

# Memory Settings
SUMMARY_SIZE_THRESHOLD=51200    # Auto-summarize after 50KB of messages

# Monitoring
MONITOR_WS_PORT=3847            # WebSocket port for Mac app
LOG_LEVEL=verbose               # error | warn | info | debug | verbose
```

### Per-Channel Configuration

Each channel can have its own configuration in `data/context/channels/{channel_id}/config.json`:

```json
{
  "type": "channel",
  "id": "C0A22229TM1",
  "name": "general",
  "displayName": "general",
  "claudeModelThinking": "sonnet",
  "claudeModelQuick": "haiku",
  "summaryThreshold": 51200,
  "jira": [
    { "project": "MYPROJECT", "site": "company.atlassian.net" }
  ],
  "confluence": [
    { "space": "DOCS", "spaceId": "1234567890", "cloudId": "uuid-here", "homepageId": "123" }
  ],
  "notebookLm": [
    { "url": "https://notebooklm.google.com/notebook/your-id", "name": "SOW", "description": "Project requirements", "profile": "minimal" }
  ]
}
```

### MCP Server Configuration

External integrations are configured in `.mcp.json`:

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.atlassian.com/v1/sse"]
    },
    "figma": {
      "type": "http",
      "url": "http://127.0.0.1:3845/mcp"
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

### Google Integration (Drive + NotebookLM)

The bot includes a combined Google skill at `.claude/skills/google/` that provides access to both Google Drive and NotebookLM with shared authentication.

**Setup:**

```bash
# Navigate to the skill directory
cd .claude/skills/google

# Install dependencies
pip install -r requirements.txt

# Setup authentication (opens browser for Google login)
python3 scripts/run.py auth_manager.py setup
```

**Configure in channel's `config.json`:**

```json
{
  "notebookLm": [
    {
      "url": "https://notebooklm.google.com/notebook/your-notebook-id",
      "name": "Project SOW",
      "description": "Statement of Work and requirements",
      "profile": "minimal"
    }
  ]
}
```

**Available commands:**

```bash
# Google Drive
python3 scripts/run.py drive_manager.py list                    # List root folder
python3 scripts/run.py drive_manager.py search --query "term"   # Search files
python3 scripts/run.py get_file.py --file-url "URL"             # Get file content

# NotebookLM
python3 scripts/run.py notebook_manager.py list                 # List notebooks
python3 scripts/run.py ask_question.py --question "Q" --notebook-url "URL"
```

The skill uses browser automation to access Google services, supporting Docs, Sheets, Slides, and NotebookLM queries.

### Atlassian Chrome Fallback

If MCP tools fail (404 errors, permission issues), use the Chrome-based fallback:

```bash
cd .claude/skills/atlassian && python3 scripts/run.py get_page.py --url "ATLASSIAN_URL"
```

**Setup authentication:**
```bash
cd .claude/skills/atlassian && python3 scripts/run.py auth_setup.py --url "https://your-site.atlassian.net"
```

---

## Using the Bot in Slack

### Starting a Conversation

Mention the bot to start a conversation:

```
@Claude What's the status of our project?
```

The bot will:
1. Show a live status indicator: `_Thinking... (2s)_`
2. Update status as it works: `_Searching Jira... (5s)_`
3. Stream results as they become available
4. Post the final response in a thread

### Direct Messages (DMs)

Chat with the bot privately via Direct Message - no @mention needed:

```
You: What's the project timeline?
Bot: Based on the project documentation...

You: Can you help me write a summary?
Bot: Here's a draft summary...
```

**DM Features:**
- Auto-responds to all messages (no @mention required)
- Full conversation history included for context
- Session continuity across the DM conversation
- Access to your personal user memory (`context.md`)

### Thread Replies

Once you've mentioned the bot in a thread, it will automatically respond to all follow-up messages in that thread - no need to @mention again. The bot maintains session context across all messages.

```
You: @Claude What tickets are assigned to me?
Bot: Here are your 5 open tickets...

You: Which one is highest priority?     ← No @mention needed
Bot: PROJ-123 is marked as Critical...
```

### File Attachments

Upload files when mentioning the bot, and it will automatically process them:

```
You: @Claude Can you review this code? [attached: main.py]
Bot: I've reviewed main.py. Here are my findings...
```

**Supported file types:**
- Code files (Python, JavaScript, TypeScript, etc.)
- Documents (PDF, Markdown, Text)
- Images (PNG, JPG, GIF, WebP, SVG)
- Data (JSON, CSV, XML, YAML)
- Notebooks (Jupyter .ipynb)

**Limits:** 50MB max file size, auto-cleanup after 1 hour

### Slack Canvas Support

The bot can read and include Slack Canvas documents in conversations:

**Automatic inclusion:**
- If a channel has an attached canvas, it's automatically included in conversations
- Canvas content is converted from HTML to markdown for processing

**Sharing a canvas:**
```
You: Can you summarize this? https://app.slack.com/docs/TXXXXXX/FXXXXXXXX
Bot: This canvas discusses...
```

**Supported canvas URL formats:**
- `https://app.slack.com/docs/TXXXXXXXX/FXXXXXXXX`
- `https://workspace.slack.com/docs/FXXXXXXXX`

### Config Commands

Manage watched channels and users:

```
@Claude watch <channel-link>         # Watch a channel
@Claude watch <user-mention>         # Watch a user
@Claude unwatch <id>                 # Stop watching
@Claude list watched                 # Show watched items
@Claude config list                  # Show all config
```

### Saving Information to Memory

Ask the bot to remember important information from a conversation:

**Channel Memory** (shared with everyone in the channel):
```
You: We decided to use PostgreSQL for the new project
You: @Claude remember this
Bot: Saved to this channel's memory!
```

**Personal Memory** (just for you):
```
You: My preferred timezone is JST
You: @Claude remember this for me
Bot: Saved to your personal memory!
```

**Trigger phrases:**
| Phrase | Saves to |
|--------|----------|
| "remember this" | Channel memory |
| "save this" | Channel memory |
| "remember this **for me**" | Personal memory |
| "save to **my** notes" | Personal memory |
| "note **for myself**" | Personal memory |

The bot will extract key information from the thread and save it to the appropriate memory for future reference.

**Clearing Memory:**
```
You: @Claude clear my memory
Bot: Cleared your personal memory!
```

**Safety Restrictions:**
| Action | Allowed |
|--------|---------|
| Clear your own personal memory | ✅ Yes |
| Clear channel memory | ❌ No (admin only) |
| Change settings | ❌ No |
| Access other users' memory | ❌ No |

The bot will refuse requests to delete channel memory or perform other restricted operations. Users can only manage their own personal memory.

### Multi-Source Search

When you ask about project information, the bot automatically searches across multiple sources:

```
You: @Claude What's the project timeline?

Bot: **From Confluence:**
Project kickoff was January 15th, targeting Q2 release...

*Searching Jira...*

**From Jira:**
Found Epic PROJ-100 "Q2 Release" with 12 child issues...

*Checking NotebookLM...*

**From NotebookLM:**
SOW specifies 3 milestones: Alpha (Feb), Beta (Mar), Release (Apr)...
```

**Queries that trigger multi-source search:**

| Category | Example Queries |
|----------|-----------------|
| Project Info | "What's the project plan?", "Show milestones" |
| Status | "What are we working on?", "Project status" |
| Tickets | "Open bugs", "My tickets", "Sprint progress" |
| Documentation | "Where's the API docs?", "Architecture diagram" |
| Team | "Who's on vacation?", "When's the retro?" |
| Requirements | "What does the SOW say about X?" |

### Search Priority

The bot searches sources in this order for optimal speed:

| Priority | Source | Speed | Best For |
|----------|--------|-------|----------|
| 1 | **Confluence** | 2-5s | Wiki pages, project docs, meeting notes |
| 2 | **Local Memory** | Instant | Previously discussed topics, saved decisions |
| 3 | **Atlassian Search** | 2-5s | Jira tickets, cross-product search |
| 4 | **Google Drive** | 2-5s | Shared documents, spreadsheets, presentations |
| 5 | **NotebookLM** | 3-8s | SOW, requirements, detailed specifications |

### Understanding Bot Status

The bot shows what it's doing in real-time:

| Status | Meaning |
|--------|---------|
| `_Thinking... (Xs)_` | Processing your request |
| `_Jira: Search Issues... (Xs)_` | Searching Jira |
| `_Reading file... (Xs)_` | Reading local memory or downloaded files |
| `_Fetching web page... (Xs)_` | Retrieving linked content |
| `_NotebookLM: Query... (Xs)_` | Querying project notebook |

---

## Integrations

### Atlassian (Jira + Confluence)

The bot can search and retrieve information from your Atlassian workspace:

**Jira capabilities:**
- Search issues by project, status, assignee
- Get issue details and comments
- Check sprint progress
- Find epics and milestones

**Confluence capabilities:**
- Search wiki pages
- Retrieve page content
- Find meeting notes and documentation

**Example queries:**
```
@Claude What bugs are open in the PROJ project?
@Claude Show me the architecture docs in Confluence
@Claude What did we decide in yesterday's meeting?
```

### Google (Drive + NotebookLM)

Access Google services for documents and source-grounded answers:

**Google Drive - Best for:**
- Shared documents (Docs, Sheets, Slides)
- Team files and resources
- Real-time collaborative documents

**NotebookLM - Best for:**
- Statement of Work (SOW) queries
- Requirements and specifications
- Contract details
- Historical project documentation

**Example queries:**
```
@Claude Read this Google Doc: [URL]
@Claude What's in this spreadsheet: [URL]
@Claude What does the SOW say about deliverables?
@Claude Check the requirements for user authentication
```

### Figma (Optional)

If configured, the bot can retrieve design context from Figma files.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Slack                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  @mention   │  │   Thread    │  │   File Attachments  │  │
│  │   Event     │  │   Replies   │  │   (auto-download)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Bolt App (Socket Mode)                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Event Handler                           │    │
│  │  • Deduplication  • Thread tracking  • Rate limiting│    │
│  │  • Session mgmt   • File download    • Config cmds  │    │
│  └──────────────────────────┬──────────────────────────┘    │
│                              │                               │
│  ┌───────────────────────────┼───────────────────────────┐  │
│  │            WebSocket Monitor (port 3847)              │  │
│  │                  → Mac Menu Bar App                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Claude Code CLI                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Local Memory │  │  Atlassian   │  │  Google (Drive   │   │
│  │  (fastest)   │  │   (MCP/Rovo) │  │  + NotebookLM)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │    Figma     │  │   Context7   │  │  Chrome Fallback │   │
│  │    (MCP)     │  │    (MCP)     │  │   (Atlassian)    │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Streaming Response                        │
│         Updates Slack message as results arrive              │
└─────────────────────────────────────────────────────────────┘
```

### Project Structure

```
claude-slack-bot/
├── src/
│   ├── bolt-app.ts              # Main Bolt app with event handlers
│   ├── claude/                  # Claude CLI integration
│   │   ├── trigger.ts           # Spawns Claude CLI process
│   │   ├── prompt-builder.ts    # Builds prompts for new/resumed sessions
│   │   ├── stream-parser.ts     # Parses JSON stream output
│   │   └── response-handler.ts  # Handles success/error responses
│   ├── slack/                   # Slack API integrations
│   │   ├── canvas.ts            # Slack Canvas fetching & HTML→markdown
│   │   ├── files.ts             # File attachment downloads
│   │   ├── history.ts           # Thread/DM history fetching
│   │   └── context.ts           # User/channel context resolution
│   ├── queue/                   # Request queuing
│   │   ├── claude-request.ts    # Per-channel Claude request queue
│   │   └── chat-update.ts       # Message update throttling (1s)
│   ├── config/                  # Configuration loading
│   │   ├── loader.ts            # Channel config loader
│   │   └── paths.ts             # Data directory paths
│   ├── state/                   # Runtime state management
│   │   └── index.ts             # Sessions, deduplication, tracking
│   ├── monitor/                 # Mac app integration
│   │   └── websocket.ts         # WebSocket server (port 3847)
│   ├── types/                   # TypeScript type definitions
│   │   └── index.ts             # Shared types
│   └── utils/                   # Utility functions
│       ├── config-manager.ts    # Watched channels/users management
│       ├── config-commands.ts   # Config commands (watch, unwatch, list)
│       ├── slack-links.ts       # Slack URL/link parsing
│       ├── detection.ts         # MCP query detection
│       ├── format.ts            # Tool name formatting
│       └── log.ts               # Structured logging
├── .claude/
│   └── skills/
│       ├── google/              # Google Drive + NotebookLM skill
│       │   ├── scripts/         # Python scripts for Google services
│       │   └── requirements.txt
│       └── atlassian/           # Atlassian Chrome fallback
│           └── scripts/         # Python scripts for Jira/Confluence
├── Client/                      # macOS menu bar monitor app
│   ├── ClaudeBotMonitor/        # Swift source code
│   ├── install.sh               # Build and install script
│   ├── uninstall.sh             # Uninstall script
│   └── com.claude-slack-bot.plist
├── data/                        # Runtime data (git-ignored)
│   ├── context/
│   │   ├── channels/{id}/       # Channel-specific data
│   │   │   ├── config.json      # Channel configuration
│   │   │   └── context.md       # Channel memory/notes
│   │   ├── users/{id}/          # User-specific data
│   │   │   ├── config.json
│   │   │   └── context.md       # User personal memory
│   │   └── default/             # Default fallback config
│   │       └── config.json
│   ├── messages/                # Raw message accumulation (daily summarization)
│   ├── logs/                    # Bot activity logs
│   ├── slack-files/             # Downloaded file cache (auto-cleaned hourly)
│   ├── config/                  # watched.json
│   └── system/                  # System logs
├── .mcp.json                    # MCP server configuration
├── CLAUDE.md                    # Bot behavior instructions
├── .env.example                 # Environment template
├── .env                         # Your configuration (git-ignored)
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript config
└── build-and-run.sh             # Build & startup script
```

### Memory System

**Automatic Summarization:**
1. Channel messages are logged to `data/messages/{channel_id}.txt`
2. When a new message arrives and there are messages from previous days, those are summarized
3. Summary is saved to `data/context/channels/{channel_id}/context.md`
4. Raw messages for the previous day(s) are cleared

**Channel Memory** (shared):
- Location: `data/context/channels/{channel_id}/context.md`
- Saved via "remember this" / "save this" phrases
- Available to all users in the channel

**User Memory** (personal):
- Location: `data/context/users/{user_id}/context.md`
- Saved via "remember this for me" / "my notes" phrases
- Private to the individual user

**Session Management:**
- Each thread gets a unique session ID
- Sessions allow Claude to resume context with `--resume`
- Sessions expire after 1 hour of inactivity
- Expired sessions are cleaned up every 10 minutes
- New users joining a thread get their context added automatically
- Channel canvas is automatically included in resumed sessions

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not responding | Check `BOT_USER_ID` matches your bot's actual ID |
| Bot not responding to DMs | Verify `im:history`, `im:read` scopes and `message.im` event |
| Socket disconnects | Normal behavior - bot auto-reconnects |
| Timeout errors | External services may be slow; try again (MCP queries get 240s) |
| Missing search results | Verify Atlassian/Google credentials are configured |
| File download fails | Check `files:read` scope is added to bot permissions |
| Canvas not loading | Check `canvases:read` scope is added to bot permissions |
| MCP tool errors | Try the Chrome fallback (see Atlassian Chrome Fallback section) |

### Logs

The bot logs all activity to the console:

**Channel mention:**
```
@mention in <#C0123456> from <@U0123456>:
   "What's the project status?"
   Thread: 1234567890.123456 (tracking for replies)
   Session: abc123 (resuming context)
   Files: 2 attached (downloading...)
   Triggering Claude Code CLI (haiku)... (with channel context + thread history)
   [stream] assistant
   Tool: Jira: Search Issues
   Response (8s): "Here's the current project status..."
   Posted reply to Slack thread
```

**DM conversation:**
```
DM from <@U0123456>:
   "Help me draft a summary"
   Session: def456 (new DM session)
   DM history: 15 messages
   Triggering Claude Code CLI (sonnet)... (with user context + DM history)
   [stream] assistant
   Response (3s): "Here's a draft summary..."
   Posted reply to DM
```

### Mac App Logs

The menu bar app connects via WebSocket on port 3847. If it's not connecting:
1. Check the bot is running
2. Verify `MONITOR_WS_PORT=3847` in `.env`
3. Check Console.app for ClaudeBotMonitor logs
