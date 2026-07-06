# claude-proxy

LLM Proxy CLI for Claude Code. It provides a local proxy gateway, multi-target routing, request/cost analytics, Claude Code hook capture, a web dashboard, and a remote bridge for continuing or creating Claude Code conversations from Web or Feishu.

Current release: **2.0.0**

## Features

- **Request proxy**: forward Claude Code API traffic to configured upstream providers.
- **Multi-channel routing**: run separate proxy channels and route projects to different targets.
- **Claude Code integration**: write proxy settings and hooks into Claude Code local settings.
- **Hook dashboard**: capture session lifecycle, tool use, notifications, subagents, and stop events.
- **Cost analytics**: record token usage and USD cost, with summaries by session, target, model, and time range.
- **Remote bridge**: create or continue Claude Code conversations from the dashboard or Feishu.
- **Feishu progress cards**: show a compact live progress card, then send the final answer as normal chat text.
- **Notifications**: macOS, DingTalk, and Feishu webhook notifications for selected hook events.
- **macOS status bar**: native status bar helper with current activity and daily cost.
- **Anti-sleep**: optional `caffeinate` support for long-running local tasks.

## Installation

```bash
npm install -g llm-proxy-view
```

Local development:

```bash
npm install
npm run build
node bin/cli.js --help
```

## Quick Start

```bash
# Start the service and dashboard on http://localhost:1998
claude-proxy start --ui

# Install Claude Code hooks so sessions appear in the dashboard
claude-proxy hook install --port 1998

# Open the dashboard, add an upstream target, then click "接入代理"
```

Common commands:

```bash
claude-proxy start --port 1998 --host localhost --ui
claude-proxy config list
claude-proxy logs --limit 20
claude-proxy hook status
claude-proxy channel status
```

## Web Dashboard

The dashboard is served from the proxy process when `--ui` is enabled.

- **Config**: manage upstream targets, auth, model mapping, channels, and CWD routes.
- **Logs**: inspect proxied requests, response timing, token usage, and captured SSE output.
- **Dashboard**: monitor Claude Code sessions by project, view live hook events, and send remote prompts.
- **Analytics**: review cost trends, model distribution, top sessions, and session health.
- **Status bar**: configure the macOS helper and anti-sleep behavior.

## Remote Bridge

Remote bridge lets a Web or Feishu message become a Claude Code prompt on the local machine.

### Delivery Modes

`remoteBridge.deliveryMode` supports:

- `cli`: default, uses `claude -p --output-format stream-json --verbose --include-partial-messages --include-hook-events`.
- `channel`: uses the experimental Claude Code MCP channel path when available.
- `auto`: prefers an online channel instance, then falls back to CLI.

The CLI fallback is the primary supported path in 2.0.0. The MCP channel path is kept for Claude Code channel experiments and requires Claude Code support for custom channels.

### Dashboard Flow

1. Start `claude-proxy start --ui`.
2. Open the dashboard and expand **飞书远程配置** / Remote Bridge settings.
3. Enable Remote Bridge.
4. Set `allowedCwds` and `defaultCwd`.
5. Use project cards or the session list to start a new remote conversation or continue an existing one.

### Feishu Flow

Feishu input uses a **self-built Feishu app with long connection**, not the old custom webhook robot.

Required app capabilities:

- receive `im.message.receive_v1` events
- send text messages
- send interactive cards
- patch previously sent interactive cards

Recommended setup:

1. Create a self-built Feishu app.
2. Enable bot capability and event subscription for received messages.
3. Copy `appId`, `appSecret`, optional `encryptKey`, and `verificationToken` into the dashboard Remote Bridge form.
4. Add the bot to a direct chat or group.
5. In groups, mention the bot for new prompts; direct messages continue the latest active thread by default.

Feishu commands:

```text
/help
/status
/projects
/new <project-alias-or-path> <prompt>
/continue <threadId> <prompt>
/use <threadId>
同意 <permissionId>
拒绝 <permissionId>
```

Progress display:

- one compact interactive card per inbound Feishu message
- card updates are throttled and coalesced to at most about one patch per second
- the card shows status, project, elapsed time, recent process events, tools, and errors
- the final Claude answer is sent as normal chat text, not as a card and not as a Feishu topic reply

### Optional MCP Channel

Install a project `.mcp.json` entry:

```bash
cd /path/to/project
claude-proxy channel install --scope project --port 1998
claude-proxy channel status
```

The registered server name is `claude-proxy-remote`, backed by the `claude-proxy-channel` binary. When Claude Code channels are available, start Claude Code with:

```bash
claude --dangerously-load-development-channels server:claude-proxy-remote
```

If Claude Code reports that channels are unavailable, use the default `cli` delivery mode.

## Configuration

Persistent config lives in:

```text
~/.claude-proxy/config.json
```

Important `remoteBridge` fields:

```json
{
  "remoteBridge": {
    "enabled": true,
    "authToken": "local-shared-token",
    "web": {
      "enabled": true,
      "publicBaseUrl": "https://your-dashboard.example"
    },
    "allowedCwds": ["/Users/me/workspace/project"],
    "defaultCwd": "/Users/me/workspace/project",
    "claudeCommand": "claude",
    "permissionMode": "default",
    "deliveryMode": "cli",
    "feishu": {
      "enabled": true,
      "appId": "...",
      "appSecret": "...",
      "encryptKey": "...",
      "verificationToken": "...",
      "ingress": "longConnection",
      "allowedUserIds": [],
      "progressCard": {
        "enabled": true,
        "showToolEvents": true
      }
    }
  }
}
```

Security notes:

- Channel/internal Remote APIs require `remoteBridge.authToken`. Same-origin dashboard actions use the local server session boundary and do not expose the token to the browser config payload.
- Do not expose the dashboard publicly without an access-controlled tunnel or reverse proxy.
- Keep `allowedCwds` narrow. Empty `allowedCwds` only allows the configured `defaultCwd`.
- Use `allowedUserIds` for Feishu deployments where group membership is not a sufficient trust boundary.

## Hook Management

```bash
claude-proxy hook install --port 1998
claude-proxy hook status
claude-proxy hook uninstall
```

Managed hook events:

```text
SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Notification /
SubagentStart / SubagentStop / Stop / SessionEnd
```

## Target And Channel Management

```bash
claude-proxy config list
claude-proxy config add --name "OpenAI" \
  --url "https://api.openai.com/v1" \
  --headers '{"Authorization":"Bearer sk-xxx"}' \
  --anthropic-model "claude-opus-4-7"
claude-proxy config set-active <target-id>
claude-proxy config delete <target-id>

claude-proxy config channel list
claude-proxy config channel add --name "default"
claude-proxy config channel set-active --channel <channelId> --target <targetName>
claude-proxy config channel add-cwd-route --channel <channelId> --cwd <path> --target <targetName>
claude-proxy config channel remove-cwd-route --channel <channelId> --cwd <path>
```

## API Endpoints

Selected public dashboard endpoints:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | health check |
| GET | `/api/query?type=config` | current config |
| GET | `/api/query?type=logs` | proxy logs |
| GET | `/api/query?type=hooks` | hook events |
| GET | `/api/query?type=sessions` | recent sessions |
| GET | `/api/query?type=remote-threads` | remote threads |
| GET | `/api/query?type=remote-messages` | remote messages |
| GET | `/api/query?type=remote-instances` | remote channel instances |
| GET | `/api/events` | dashboard SSE stream |
| POST | `/api/hooks/:event` | Claude Code hook callback |
| POST | `/api/set` | config mutations |
| POST | `/api/remote/send` | Web remote send |
| POST | `/api/remote/permission` | Web/Feishu permission verdict |
| ALL | `/:channelId?/proxy/*` | proxied upstream request |

Internal channel endpoints:

| Method | Path |
| --- | --- |
| POST | `/api/remote/channel/register` |
| GET | `/api/remote/channel/events` |
| POST | `/api/remote/channel/reply` |
| POST | `/api/remote/channel/delivery` |
| POST | `/api/remote/channel/permission-request` |
| POST | `/api/remote/channel/heartbeat` |
| POST | `/api/remote/channel/offline` |

## Storage

All runtime data is under `~/.claude-proxy/`:

```text
~/.claude-proxy/
├── config.json   # targets, channels, notifications, remoteBridge
└── logs.db       # logs, hooks, cost records, remote threads/messages/cards
```

SQLite tables include `logs`, `hooks`, `cost_records`, `session_cwds`, `projects`, `remote_threads`, `remote_messages`, `remote_channel_instances`, `remote_permissions`, and `remote_message_cards`.

## Development

```bash
npm install
npm run dev          # backend development mode
npm run dev:ui       # Vite UI development server
npm test             # Jest
npm run build        # TypeScript + UI + macOS status bar when available
npm run build:statusbar
```

Release checks used for 2.0.0:

```bash
npx tsc --noEmit
npm test -- --runInBand
npx vite build
```

## Tech Stack

- Node.js + TypeScript
- Express
- better-sqlite3
- Commander.js
- React + Vite
- Feishu Open Platform SDK
- Model Context Protocol SDK
- Swift status bar helper on macOS

## License

MIT
