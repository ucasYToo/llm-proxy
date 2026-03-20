import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getActiveTarget } from "@/lib/config";
import { appendLog } from "@/lib/logger";

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

  // Capture original request headers for logging
  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  // Capture modified headers for logging
  const modifiedHeaders: Record<string, string> = { ...forwardHeaders };

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
    appendLog({
      id: logId,
      timestamp: new Date().toISOString(),
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
      durationMs,
      error: String(err),
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
    const decoder = new TextDecoder();
    const { readable, writable } = new TransformStream({
      transform(chunk, controller) {
        chunks.push(decoder.decode(chunk, { stream: true }));
        controller.enqueue(chunk);
      },
      flush() {
        // Stream finished — log the collected content
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

        appendLog({
          id: logId,
          timestamp: new Date().toISOString(),
          targetId: target.id,
          targetName: target.name,
          method: req.method,
          path: `/${path.join("/")}`,
          originalRequestHeaders: originalHeaders,
          originalRequestBody: originalBody,
          modifiedRequestHeaders: modifiedHeaders,
          modifiedRequestBody: modifiedBody,
          responseStatus: upstreamRes.status,
          responseBody,
          assembledResponseBody: assembledBody,
          durationMs,
        });
      },
    });

    upstreamRes.body!.pipeTo(writable).catch(() => {
      // If pipe fails, still log what we have
      const fullContent = chunks.join("");
      const durationMs = Date.now() - startMs;
      appendLog({
        id: logId,
        timestamp: new Date().toISOString(),
        targetId: target.id,
        targetName: target.name,
        method: req.method,
        path: `/${path.join("/")}`,
        originalRequestHeaders: originalHeaders,
        originalRequestBody: originalBody,
        modifiedRequestHeaders: modifiedHeaders,
        modifiedRequestBody: modifiedBody,
        responseStatus: upstreamRes.status,
        responseBody: fullContent || "[stream-error]",
        durationMs,
        error: "Stream pipe failed",
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

  appendLog({
    id: logId,
    timestamp: new Date().toISOString(),
    targetId: target.id,
    targetName: target.name,
    method: req.method,
    path: `/${path.join("/")}`,
    originalRequestHeaders: originalHeaders,
    originalRequestBody: originalBody,
    modifiedRequestHeaders: modifiedHeaders,
    modifiedRequestBody: modifiedBody,
    responseStatus: upstreamRes.status,
    responseBody: resBodyLog,
    durationMs,
  });

  return new NextResponse(resText, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
}

/**
 * Assemble Anthropic Messages API streaming events into a complete response.
 * Events: message_start, content_block_start, content_block_delta, content_block_stop,
 *         message_delta, message_stop
 */
function assembleAnthropicResponse(events: unknown[]): Record<string, unknown> {
  let message: Record<string, unknown> = {};
  const contentBlocks: Record<string, unknown>[] = [];
  let currentBlockIndex = -1;
  let currentText = "";

  for (const event of events) {
    const e = event as Record<string, unknown>;
    switch (e.type) {
      case "message_start": {
        const msg = e.message as Record<string, unknown> | undefined;
        if (msg) {
          message = { ...msg };
        }
        break;
      }
      case "content_block_start": {
        currentBlockIndex = (e.index as number) ?? contentBlocks.length;
        const block = (e.content_block as Record<string, unknown>) ?? {};
        contentBlocks[currentBlockIndex] = { ...block };
        // Initialize currentText based on block type
        if (block.type === "thinking") {
          currentText = (block.thinking as string) ?? "";
        } else {
          currentText = (block.text as string) ?? "";
        }
        break;
      }
      case "content_block_delta": {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          currentText += delta.text;
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          currentText += delta.thinking;
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          currentText += delta.partial_json;
        } else if (delta?.type === "signature_delta" && typeof delta.signature === "string") {
          // Store signature on the block directly
          if (currentBlockIndex >= 0 && contentBlocks[currentBlockIndex]) {
            contentBlocks[currentBlockIndex].signature = delta.signature;
          }
        }
        break;
      }
      case "content_block_stop": {
        if (currentBlockIndex >= 0 && contentBlocks[currentBlockIndex]) {
          const block = contentBlocks[currentBlockIndex];
          if (block.type === "text") {
            block.text = currentText;
          } else if (block.type === "thinking") {
            block.thinking = currentText;
          } else if (block.type === "tool_use") {
            try {
              block.input = JSON.parse(currentText);
            } catch {
              block.input = currentText;
            }
          }
        }
        currentText = "";
        break;
      }
      case "message_delta": {
        const delta = e.delta as Record<string, unknown> | undefined;
        if (delta) {
          Object.assign(message, delta);
        }
        const usage = e.usage as Record<string, unknown> | undefined;
        if (usage) {
          message.usage = {
            ...((message.usage as Record<string, unknown>) ?? {}),
            ...usage,
          };
        }
        break;
      }
    }
  }

  message.content = contentBlocks;
  return message;
}

/**
 * Assemble OpenAI Chat Completions streaming chunks into a complete response.
 */
function assembleOpenAIResponse(events: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const choicesMap: Map<number, Record<string, unknown>> = new Map();

  for (const event of events) {
    const e = event as Record<string, unknown>;
    if (!result.id && e.id) result.id = e.id;
    if (!result.model && e.model) result.model = e.model;
    if (!result.created && e.created) result.created = e.created;

    const choices = e.choices as Array<Record<string, unknown>> | undefined;
    if (!choices) continue;

    for (const choice of choices) {
      const idx = (choice.index as number) ?? 0;
      if (!choicesMap.has(idx)) {
        choicesMap.set(idx, { index: idx, message: { role: "assistant", content: "" } });
      }
      const accumulated = choicesMap.get(idx)!;
      const accMsg = accumulated.message as Record<string, unknown>;
      const delta = choice.delta as Record<string, unknown> | undefined;

      if (delta) {
        if (typeof delta.content === "string") {
          accMsg.content = ((accMsg.content as string) ?? "") + delta.content;
        }
        if (delta.role) accMsg.role = delta.role;
        if (delta.tool_calls) {
          // Accumulate tool calls
          if (!accMsg.tool_calls) accMsg.tool_calls = [];
          const existingCalls = accMsg.tool_calls as Array<Record<string, unknown>>;
          const newCalls = delta.tool_calls as Array<Record<string, unknown>>;
          for (const tc of newCalls) {
            const tcIdx = (tc.index as number) ?? 0;
            if (!existingCalls[tcIdx]) {
              existingCalls[tcIdx] = { ...tc };
              const fn = existingCalls[tcIdx].function as Record<string, unknown> | undefined;
              if (fn) existingCalls[tcIdx].function = { ...fn };
            } else {
              const existing = existingCalls[tcIdx];
              const fn = tc.function as Record<string, unknown> | undefined;
              if (fn) {
                const existingFn = (existing.function ?? {}) as Record<string, unknown>;
                if (typeof fn.arguments === "string") {
                  existingFn.arguments = ((existingFn.arguments as string) ?? "") + fn.arguments;
                }
                if (fn.name) existingFn.name = fn.name;
                existing.function = existingFn;
              }
            }
          }
        }
      }

      if (choice.finish_reason) accumulated.finish_reason = choice.finish_reason;
    }

    if (e.usage) result.usage = e.usage;
  }

  result.object = "chat.completion";
  result.choices = Array.from(choicesMap.values()).sort(
    (a, b) => (a.index as number) - (b.index as number)
  );

  return result;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
