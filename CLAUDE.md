# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

`llm-proxy-view` provides the `claude-proxy` CLI:

- a local LLM proxy for Claude Code requests
- multi-target and multi-channel routing
- Claude Code settings integration
- HTTP hook capture for Claude Code sessions
- SQLite-backed logs, hook events, cost records, and remote bridge state
- a React/Vite dashboard
- Web and Feishu remote conversation support for creating or continuing Claude Code sessions

Release target in this working tree: **2.0.0**.

## Common Commands

```bash
npm install
npm run dev
npm run dev:ui
npm test
npm test -- --runInBand
npx tsc --noEmit
npx vite build
npm run build
```

CLI smoke checks:

```bash
node bin/cli.js --help
node bin/cli.js start --help
node bin/cli.js hook status
node bin/cli.js channel status
```

Remote bridge local run:

```bash
claude-proxy start --ui
claude-proxy hook install --port 1998
claude-proxy channel install --scope project --port 1998
```

`claude-proxy start` 默认只输出启动摘要和异常请求；需要端点列表或每请求访问日志时加 `--verbose`。

## Architecture

```text
bin/
  cli.js                  # published CLI entry
  channel.js              # published MCP channel entry
src/
  cli/                    # Commander commands
  server/                 # Express server, API routes, SSE, proxy route
  core/                   # Claude Code settings/session helpers
  storage/                # SQLite persistence
  remote/                 # Web/Feishu/channel remote bridge domain logic
  channel/                # MCP channel server process
  notify/                 # macOS, DingTalk, Feishu webhook notifications
  cost/                   # pricing, aggregation, health
ui/
  src/                    # React dashboard
app/macos-status-bar/     # Swift status bar helper
```

Important runtime files:

```text
~/.claude-proxy/config.json
~/.claude-proxy/logs.db
~/.claude/settings.json
```

`config.json` stores targets, channels, notifications, budgets, and `remoteBridge`.
`logs.db` stores logs, hooks, cost records, projects, remote threads/messages/instances/permissions/cards.

## Remote Bridge Notes

Remote bridge has two delivery paths:

- `cli`: default production path, runs Claude Code print mode with stream JSON.
- `channel`: experimental MCP channel path for Claude Code channels when available.

Keep `cli` as the default unless a task explicitly targets custom channels. The current fallback command must include:

```text
-p --output-format stream-json --verbose --include-partial-messages --include-hook-events
```

Feishu input uses one or more self-built Feishu app long connections under `remoteBridge.feishu.bots`; each bot can bind its own `defaultCwd`. The old webhook robot remains only a notification output channel and cannot receive user messages.

Feishu output behavior:

- send one interactive progress card per inbound user message
- patch that same card with coalesced progress updates
- send the final Claude answer as normal text
- do not use Feishu `reply_in_thread` for remote progress or final answers
- preserve `sourceBotId` on Feishu remote threads/messages/cards so replies are sent by the same bot that received the inbound message

## API Surface

Dashboard query endpoints live in `src/server/routes.ts`.
Remote bridge internal endpoints live in `src/server/remote-routes.ts`.

Channel/internal Remote endpoints require `remoteBridge.authToken` through one of:

- `x-remote-bridge-token`
- `Authorization: Bearer <token>`

Same-origin dashboard calls may use the local server origin check for Web send/permission actions, but the token must not be returned in the public config payload. Do not add cross-origin remote write paths.

## Persistence

SQLite migrations are append-only in `src/storage/db.ts`.

Rules:

- Add new migrations at the end of `MIGRATIONS`.
- Do not reorder existing migrations.
- Keep `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and additive `ALTER TABLE` style migrations.
- Consider old local DBs that may already be at any previous `user_version`.

## Frontend Notes

The dashboard is a working console, not a marketing page. Keep layouts compact and scan-friendly.

Remote UI expectations:

- remote status belongs near project/session context
- composer should stay compact
- event rows should show event name plus one-line summary with ellipsis
- avoid nesting large cards inside cards
- keep forms usable on narrow screens

## Coding Conventions

- TypeScript strict mode is enabled.
- Prefer existing storage/config/service helpers over direct file or DB access.
- Use structured JSON parsing/building for Feishu card payloads and CLI stream events.
- Keep remote security boundaries explicit: cwd allowlist, token checks, optional Feishu user allowlist.
- Avoid hidden thought content in progress surfaces; show only observable events, tool names, statuses, errors, and final text.
- Do not revert unrelated user changes in this repository.

## Release Checklist

Before release:

```bash
npx tsc --noEmit
npm test -- --runInBand
npx vite build
npm run build
```

Also check:

- `package.json` and `package-lock.json` version match the release.
- `README.md`, `CHANGELOG.md`, `CLAUDE.md`, and `AGENTS.md` describe current behavior.
- `bin/cli.js` and `bin/channel.js` are executable and included in `package.json.files`.
- Remote Bridge Feishu behavior is card progress plus normal final text, not Feishu topics.
