# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**claude-llm-proxy** is an LLM Proxy CLI tool that forwards LLM API requests through a local proxy server to upstream services (OpenAI, Anthropic, etc.). It supports configuration management, request/response logging with token usage statistics, and streaming response interception.

## Common Commands

### Development
```bash
npm install              # Install dependencies
npm run build           # Build TypeScript to dist/
npm run dev             # Run in development mode with tsx
npm test                # Run Jest tests
```

### CLI Usage
```bash
# Start proxy server
node bin/cli.js start [--port 3000] [--host 0.0.0.0] [--ui]

# Configuration management
node bin/cli.js config list
node bin/cli.js config add --name "OpenAI" --url "https://api.openai.com/v1" --headers '{"Authorization":"Bearer sk-xxx"}'
node bin/cli.js config set-active <target-id>
node bin/cli.js config delete <target-id>

# View logs
node bin/cli.js logs [--limit 10] [--json] [--target "OpenAI"]
node bin/cli.js clear-logs
```

### Building UI
```bash
npm run build:ui        # Build React UI in ui/
npm run build:all       # Build both backend and UI
```

## Architecture

### Code Structure

```
src/
├/                  # CLI commands (Commander.js)
│   ├── index.ts         # Main CLI entry point
│  └/
│       ├── start.ts     # Start server command
│       ├── config.ts    # Config management commands
│      └.ts        # Log viewing commands
├/               # Express server
│   ├── index.ts         # Server setup and middleware
│   ├── routes.ts        # API routes (/api/*)
│  └.ts           # Proxy route handler (/proxy/*)
├/                 # Core proxy logic
│   ├── proxy.ts         # Main proxy request handler
│   ├── assemble.ts      # Stream response assembly
│  └.ts            # JSON diff utilities
├/               # Configuration
│   ├── types.ts         # TypeScript type definitions
│  └.ts           # Config read/write operations
├/              # Data persistence
│  └.ts            # Log storage operations
└/                # Utilities
   └.ts          # Formatting utilities
```

### Key Components

1. **Proxy Flow**:
   - Requests to `/proxy/*` are forwarded to configured upstream targets
   - Headers and body params from target config are merged into requests
   - Responses (including SSE streams) are intercepted and logged

2. **Configuration**:
   - Stored in `~/.claude-proxy/config.json`
   - Multiple targets supported, each with URL, headers, body params
   - Active target determines where requests are forwarded

3. **Logging**:
   - Stored in `~/.claude-proxy/logs.json`
   - Captures request/response pairs, token usage, timing
   - Supports streaming response assembly from SSE events
   - Privacy controls: can disable original body/raw stream capture

4. **API Endpoints**:
   - `GET /api/query?type=config` - Get configuration
   - `GET /api/query?type=logs` - Get logs with pagination
   - `POST /api/set` - Modify configuration
   - `DELETE /api/query?type=logs` - Clear logs
   - `POST /api/shutdown` - Shutdown server
   - `ALL /proxy/*` - Proxy requests to upstream

### Data Types

Key types defined in `src/config/types.ts`:
- `Target`: Upstream API config (id, name, url, headers, bodyParams)
- `Config`: Main config structure (activeTarget, targets, logCollection)
- `LogEntry`: Request/response log with timing and token stats
- `TokenUsage`: Token consumption tracking

## Development Notes

- Uses TypeScript with strict mode, strict null checks enabled
- Path alias `@/*` maps to `src/*`
- Prettier formatting enforced via lint-staged on commit
- UI built with React + Vite, served from `ui/` directory
- Default port 1998, localhost binding

## Storage

All persistent data stored to `~/.claude-proxy/`:
- `config.json` - Target configurations
- `logs.json` - Request/response logs (max 100 entries, FIFO)
