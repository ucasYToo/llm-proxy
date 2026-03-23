# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install    # Install dependencies
npm run dev    # Development server on http://localhost:1998
npm run build  # Production build
npm start      # Production server on http://localhost:1998
```

## Architecture Overview

This is a **Next.js 15 full-stack LLM API Proxy** that forwards requests to configured upstream LLM providers (OpenAI, Anthropic, etc.) with automatic header/body injection and request logging.

### Core Data Flow

```
Client → /proxy/{path} → Proxy Route → Upstream LLM API
                ↓
           Logger (async, non-blocking)
                ↓
           data/logs.json
```

### Key Architectural Patterns

**1. Catch-All Proxy Route** (`src/app/proxy/[...path]/route.ts`)
- All HTTP methods (GET, POST, PUT, etc.) handled by single handler
- Merges incoming request headers/body with configured `Target.headers` and `Target.bodyParams`
- Strips hop-by-hop headers (`host`, `connection`, `transfer-encoding`)
- Returns 503 if no active target configured

**2. Streaming Response Handling**
- Uses `TransformStream` to tee the response stream
- Client receives stream immediately (low latency)
- Stream chunks are captured for logging via `transform()` and `flush()` hooks
- Supports both OpenAI (`data: {...}`) and Anthropic (`data:{...}`) SSE formats

**3. File-Based JSON Persistence**
- Config stored in `data/config.json` (gitignored)
- Logs stored in `data/logs.json` (gitignored, max 300 entries)
- No database; all reads/writes are synchronous `fs` operations
- Logger handles missing files gracefully (returns empty array)

**4. Log Lifecycle (Async State Machine)**
- `pending`: Request initiated (`createLog`)
- `streaming`: First SSE chunk received (for stream responses)
- `completed`: Request finished successfully
- `error`: Request failed or stream pipe error
- Logs are created at request start and updated incrementally via `updateLog()`

**5. Response Assembly for Streams**
- `responseAssembler.ts` parses SSE chunks into structured responses
- Supports OpenAI Chat Completions and Anthropic Messages API formats
- Token usage extracted from both assembled streams and non-stream responses
- `assembledResponseBody` field contains the reconstructed complete response

**6. Log Collection Controls**
- `captureOriginalBody`: When false, original request headers/body are cleared and a `precomputedDiff` is stored instead
- `captureRawStreamEvents`: When false, raw SSE event arrays are cleared from logs
- These are configured per-config, not per-request

### API Routes

| Route | Purpose |
|-------|---------|
| `/proxy/[...path]` | Main proxy - forwards to active target's base URL |
| `/api/query?type=config` | Returns full config including targets |
| `/api/query?type=logs[&limit&offset&targetId]` | Paginated log query |
| `DELETE /api/query?type=logs` | Clear all logs |
| `POST /api/set` | Config mutations (setActive, addTarget, updateTarget, deleteTarget, updateLogCollection) |

### Type System

Key types in `src/lib/types.ts`:
- `Target`: Upstream LLM endpoint config (id, name, url, headers, bodyParams)
- `LogEntry`: Request/response record with both original and modified request data
- `TokenUsage`: Extracted from responses for analytics (input/output/cache tokens)

### Component Architecture

Client UI uses plain CSS modules (no UI library):
- `page.tsx`: Main layout with tab navigation (config/logs)
- `ConfigTab`: Target CRUD and activation UI
- `LogsTab`: Paginated log viewer with filters and detail panel
- `TargetForm`: Modal for add/edit target

All components are Client Components (`"use client"`) with data fetching via standard `fetch()`.

### Response Body Types in Logs

- Non-streaming: Parsed JSON object or raw text string
- Streaming: Array of parsed SSE event objects or `"[stream]"` if raw events not captured
- Error: Error message string
