# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

`llm-proxy-view` provides the `claude-proxy` CLI:

- a local LLM proxy for Claude Code requests
- multi-target and multi-channel routing
- Claude Code settings integration
- HTTP hook capture for Claude Code sessions
- a separate Codex hooks surface with optional local Rollout Trace inspection
- SQLite-backed logs, hook events, cost records, and remote bridge state
- a React/Vite dashboard
- Web and Feishu remote conversation support for creating or continuing Claude Code sessions

Release target in this working tree: **2.2.0**.

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
~/.claude-proxy/codex-logs.db
~/.claude-proxy/codex-rollout-traces/
~/.claude/settings.json
~/.codex/hooks.json
```

`config.json` stores targets, channels, notifications, budgets, and `remoteBridge`.
`logs.db` stores logs, hooks, cost records, projects, remote threads/messages/instances/permissions/cards.
`codex-logs.db` stores Codex hook events and Rollout Trace bundle path indexes; trace payload bodies remain in Codex-owned files and are read on demand. Do not merge it into the Claude database or Dashboard state.

## Codex Notes

The Codex dashboard is intentionally separate from the Claude dashboard. Codex Remote Bridge delivery is out of scope for now.

- Codex hooks are command handlers in `~/.codex/hooks.json` and relay to `/api/codex/hooks/:event` without blocking Codex when the dashboard is unavailable.
- Hook trust is currently managed through `/hooks` in the Codex CLI; the desktop App composer does not expose that slash command.
- Do not change Codex authentication, `openai_base_url`, `chatgpt_base_url`, or its model request path for logging.
- Build conversation summaries from `UserPromptSubmit` and root `Stop`; tool and lifecycle hooks remain visible in the event stream.
- Raw Rollout Trace capture is opt-in through `CODEX_ROLLOUT_TRACE_ROOT`, defaults off, and requires a full Codex restart after either toggle.
- Keep trace bundles under `~/.claude-proxy/codex-rollout-traces/`, enforce the 1 GB oldest-first budget, and store only bundle paths/index metadata in SQLite.
- Trace detail may render local Codex reasoning when the user explicitly enables capture; this exception does not relax the prohibition on exposing Claude hidden thinking.

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
- send user-requested files as Feishu file messages through the protected local remote API
- in CLI fallback, an explicit `remote_reply` is the sole final text reply for that turn; do not also forward the CLI result
- do not use Feishu `reply_in_thread` for remote progress or final answers
- preserve `sourceBotId` on Feishu remote threads/messages/cards so replies are sent by the same bot that received the inbound message
- install/update the project-local `feishu-remote` skill from Dashboard per Feishu bot `defaultCwd`; do not make users configure this through CLI

## API Surface

Dashboard query endpoints live in `src/server/routes.ts`; Codex-only endpoints live in `src/server/codex-routes.ts`.
Remote bridge internal endpoints live in `src/server/remote-routes.ts`.

Channel/internal Remote endpoints require `remoteBridge.authToken` through one of:

- `x-remote-bridge-token`
- `Authorization: Bearer <token>`

Same-origin dashboard calls may use the local server origin check for Web send/permission actions, but the token must not be returned in the public config payload. Do not add cross-origin remote write paths.

Feishu file upload uses `/api/remote/feishu/send-file` and requires `remoteBridge.authToken`. The CLI fallback child process receives the remote context in environment variables so the installed skill helper can call this API without exposing the token in argv or dashboard config.

## Persistence

Claude SQLite migrations are append-only in `src/storage/db.ts`. The physically separate Codex database owns its append-only migrations in `src/storage/codex.ts`.

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
