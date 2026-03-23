import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getActiveTarget } from "@/lib/config";
import { createLog, updateLog } from "@/lib/logger";
import { extractTokenUsage, assembleAnthropicResponse, assembleOpenAIResponse } from "@/lib/responseAssembler";
import type { LogStatus } from "@/lib/types";

type Params = Promise<{ path: string[] }>;

async function handler(req: NextRequest, { params }: { params: Params }) {
  const { path } = await params;
  const target = getActiveTarget();

  if (!target) {
    return NextResponse.json(
      { error: "No active target configured" },
      { status: 503 }
    );
  }

  const targetUrl = `${target.url.replace(/\/$/, "")}/${path.join("/")}`;
  const search = req.nextUrl.search;
  const fullUrl = search ? `${targetUrl}${search}` : targetUrl;

  // Build merged headers
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // Skip hop-by-hop and Next.js internal headers
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });
  Object.assign(forwardHeaders, target.headers);

  // Build merged body
  let requestBody: unknown = undefined;
  let originalBody: unknown = undefined;
  let modifiedBody: unknown = undefined;
  const contentType = req.headers.get("content-type") ?? "";

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (contentType.includes("application/json")) {
      const json = await req.json().catch(() => ({}));
      originalBody = json;
      const merged = { ...(json as Record<string, unknown>), ...target.bodyParams };
      modifiedBody = merged;
      requestBody = JSON.stringify(merged);
      forwardHeaders["content-type"] = "application/json";
    } else {
      const buffer = await req.arrayBuffer();
      originalBody = "[binary]";
      modifiedBody = "[binary]";
      requestBody = buffer;
    }
  }

  const startMs = Date.now();
  const logId = uuidv4();
  const startTime = new Date().toISOString();

  // Capture original request headers for logging
  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  // Capture modified headers for logging
  const modifiedHeaders: Record<string, string> = { ...forwardHeaders };

  // 1. 请求开始时立即创建日志（状态为 pending）
  createLog({
    id: logId,
    timestamp: startTime,
    startTime,
    targetId: target.id,
    targetName: target.name,
    method: req.method,
    path: `/${path.join("/")}`,
    originalRequestHeaders: originalHeaders,
    originalRequestBody: originalBody,
    modifiedRequestHeaders: modifiedHeaders,
    modifiedRequestBody: modifiedBody,
    responseStatus: 0,
    responseBody: null,
    durationMs: 0,
    status: "pending" as LogStatus,
  });

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(fullUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: requestBody as BodyInit | undefined,
      // @ts-expect-error Node 18+ supports this
      duplex: "half",
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    // 错误时更新日志
    updateLog(logId, {
      responseStatus: 0,
      durationMs,
      error: String(err),
      status: "error" as LogStatus,
    });
    return NextResponse.json(
      { error: "Upstream request failed", detail: String(err) },
      { status: 502 }
    );
  }

  const resContentType = upstreamRes.headers.get("content-type") ?? "";
  const isStream = resContentType.includes("text/event-stream");

  // Build response headers
  const resHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  if (isStream) {
    // Tee the stream: pass through to client while collecting content for logging
    const chunks: string[] = [];
    let firstChunkReceived = false;
    const decoder = new TextDecoder();
    
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        chunks.push(text);
        controller.enqueue(chunk);
        
        // 2. 首个 chunk 到达时更新状态
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const firstChunkMs = Date.now() - startMs;
          updateLog(logId, {
            firstChunkMs,
            status: "streaming" as LogStatus,
          });
        }
      },
      flush() {
        // Stream finished — 3. 更新最终状态
        const fullContent = chunks.join("");
        const durationMs = Date.now() - startMs;

        // Parse SSE events into structured data
        // Supports both "data: {...}" (OpenAI) and "data:{...}" (Anthropic) formats
        let parsedEvents: unknown[] = [];
        try {
          const lines = fullContent.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            // Strip "data:" prefix (with or without space)
            const payload = trimmed.startsWith("data: ")
              ? trimmed.slice(6)
              : trimmed.slice(5);
            if (payload === "[DONE]" || payload === "") continue;
            try {
              parsedEvents.push(JSON.parse(payload));
            } catch {
              parsedEvents.push(payload);
            }
          }
        } catch {
          // keep parsedEvents empty
        }

        // Assemble a complete response from SSE events
        // Supports OpenAI chat completions and Anthropic messages formats
        let assembledBody: unknown = undefined;
        try {
          if (parsedEvents.length > 0) {
            const firstEvent = parsedEvents[0] as Record<string, unknown>;

            if (firstEvent?.type === "message_start") {
              // Anthropic Messages API format
              assembledBody = assembleAnthropicResponse(parsedEvents);
            } else if (firstEvent?.object === "chat.completion.chunk" || firstEvent?.choices) {
              // OpenAI Chat Completions format
              assembledBody = assembleOpenAIResponse(parsedEvents);
            }
          }
        } catch {
          // assembly failed, leave as undefined
        }

        const responseBody = parsedEvents.length > 0 ? parsedEvents : fullContent;

        // Extract token usage from assembled response
        const tokenUsage = extractTokenUsage(assembledBody);

        // 更新最终状态
        updateLog(logId, {
          responseStatus: upstreamRes.status,
          responseBody,
          assembledResponseBody: assembledBody,
          durationMs,
          status: "completed" as LogStatus,
          tokenUsage,
        });
      },
    });

    upstreamRes.body!.pipeTo(writable).catch(() => {
      // If pipe fails, still log what we have
      const fullContent = chunks.join("");
      const durationMs = Date.now() - startMs;
      updateLog(logId, {
        responseStatus: upstreamRes.status,
        responseBody: fullContent || "[stream-error]",
        durationMs,
        error: "Stream pipe failed",
        status: "error" as LogStatus,
      });
    });

    return new NextResponse(readable, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  }

  // Non-streaming: buffer and log
  const resText = await upstreamRes.text();
  const durationMs = Date.now() - startMs;
  let resBodyLog: unknown = resText;
  try {
    resBodyLog = JSON.parse(resText);
  } catch {
    // keep as text
  }

  // Extract token usage from non-streaming response
  const tokenUsage = extractTokenUsage(resBodyLog);

  // 更新最终状态
  updateLog(logId, {
    responseStatus: upstreamRes.status,
    responseBody: resBodyLog,
    durationMs,
    status: "completed" as LogStatus,
    tokenUsage,
  });

  return new NextResponse(resText, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
