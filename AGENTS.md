# AGENTS.md

Instructions for Codex and other coding agents working in this repository.

## Scope

This file applies to the whole repository.

## Project

`llm-proxy-view` ships the `claude-proxy` CLI, a local proxy and dashboard for Claude Code. The 2.0 line adds Web/Feishu remote conversation support, Feishu progress cards, and an experimental MCP channel binary.

## Commands

Use these checks before handing work back:

```bash
npx tsc --noEmit
npm test -- --runInBand
npx vite build
```

For release or packaging work, also run:

```bash
npm run build
node bin/cli.js --help
```

Useful development commands:

```bash
npm run dev
npm run dev:ui
node bin/cli.js start --ui
node bin/cli.js hook status
node bin/cli.js channel status
```

`node bin/cli.js start --ui` 默认只输出启动摘要和异常请求；排查端点或请求日志时加 `--verbose`。

## Architecture Map

- `src/cli/`: Commander CLI commands.
- `src/server/`: Express server, API routes, SSE, and proxy routing.
- `src/storage/`: SQLite-backed persistence.
- `src/remote/`: Remote Bridge orchestration, Feishu input/output, progress aggregation, CLI fallback, channel hub.
- `src/channel/`: MCP channel process used by `claude-proxy-channel`.
- `ui/src/`: React dashboard.
- `app/macos-status-bar/`: Swift status bar helper.

Runtime state:

- `~/.claude-proxy/config.json`
- `~/.claude-proxy/logs.db`
- `~/.claude/settings.json`

## Working Rules

- Do not revert unrelated user changes.
- Prefer existing helpers in `src/config`, `src/storage`, `src/remote`, and `src/server`.
- Add SQLite migrations only at the end of `MIGRATIONS` in `src/storage/db.ts`.
- Keep channel/internal remote write APIs protected by `remoteBridge.authToken`; same-origin dashboard exceptions must not expose the token.
- Keep cwd validation strict through Dashboard-discovered projects, `remoteBridge.allowedCwds`, and each Feishu bot's `defaultCwd`.
- Do not expose Claude hidden thinking in UI, Feishu cards, logs, or docs.
- Feishu remote replies should not use topic replies; progress is one patched card and final output is normal text.
- In CLI delivery mode, an explicit `remote_reply` is the final text for that turn; do not also forward the CLI result.
- Feishu Remote Bridge may run multiple bots; preserve `sourceBotId` on threads/messages/cards so outbound text and card patches use the original bot, and keep each bot's `defaultCwd` independent.
- Feishu remote file return is handled by the Dashboard-installed project skill under each bot's `defaultCwd`; keep its API token-protected and keep file paths constrained to the remote thread cwd.
- Use the default `cli` Remote Bridge delivery mode unless a task explicitly targets Claude Code custom channels.

## Frontend Guidance

- Treat the dashboard as an operational console.
- Keep remote controls compact and close to project/session context.
- Avoid card-in-card layouts.
- Ensure long text truncates cleanly in event rows, session rows, and remote status labels.
- Make forms usable on narrow screens.

## Documentation

When changing user-visible behavior, update the relevant docs:

- `README.md` for usage and setup
- `CHANGELOG.md` for release notes
- `CLAUDE.md` for Claude Code working guidance
- `AGENTS.md` for agent working guidance

## Release Checklist

- Version is updated in `package.json` and `package-lock.json`.
- `README.md`, `CHANGELOG.md`, `CLAUDE.md`, and `AGENTS.md` match the current behavior.
- `npm run build` succeeds.
- Feishu Remote Bridge smoke path is understood: inbound text -> compact progress card -> final normal text, with optional skill-driven file upload back to Feishu.
