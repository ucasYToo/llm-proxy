import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getActiveTarget } from "@/lib/config";
import { createLog, updateLog } from "@/lib/logger";
import { extractTokenUsage, assembleAnthropicResponse, assembleOpenAIResponse } from "@/lib/responseAssembler";
import type { LogStatus } from "@/lib/types";

type Params = Promise<{ path: string[] }>;

const handler = async (req: NextRequest, { params }: { params: Params }) => {
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

  // 构建合并后的请求头
  const forwardHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    // 跳过逐跳传输头和 Next.js 内部头
    if (!["host", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });
  Object.assign(forwardHeaders, target.headers);

  // 构建合并后的请求体
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

  // 捕获原始请求头用于日志记录
  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  // 捕获修改后的请求头用于日志记录
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
      // @ts-expect-error Node 18+ 支持此选项
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

  // 构建响应头
  const resHeaders = new Headers();
  upstreamRes.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  if (isStream) {
    // 分流：将流传递给客户端的同时收集内容用于日志记录
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

        // 将 SSE 事件解析为结构化数据
        // 支持 "data: {...}"（OpenAI）和 "data:{...}"（Anthropic）两种格式
        let parsedEvents: unknown[] = [];
        try {
          const lines = fullContent.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            // 去除 "data:" 前缀（带或不带空格）
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
          // 保持 parsedEvents 为空
        }

        // 从 SSE 事件组装完整响应
        // 支持 OpenAI Chat Completions 和 Anthropic Messages 格式
        let assembledBody: unknown = undefined;
        try {
          if (parsedEvents.length > 0) {
            const firstEvent = parsedEvents[0] as Record<string, unknown>;

            if (firstEvent?.type === "message_start") {
              // Anthropic Messages API 格式
              assembledBody = assembleAnthropicResponse(parsedEvents);
            } else if (firstEvent?.object === "chat.completion.chunk" || firstEvent?.choices) {
              // OpenAI Chat Completions 格式
              assembledBody = assembleOpenAIResponse(parsedEvents);
            }
          }
        } catch {
          // 组装失败，保持 undefined
        }

        const responseBody = parsedEvents.length > 0 ? parsedEvents : fullContent;

        // 从组装后的响应中提取 token 用量
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
      // 管道失败时，仍然记录已有的数据
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

  // 非流式：缓冲并记录
  const resText = await upstreamRes.text();
  const durationMs = Date.now() - startMs;
  let resBodyLog: unknown = resText;
  try {
    resBodyLog = JSON.parse(resText);
  } catch {
    // 保持为文本
  }

  // 从非流式响应中提取 token 用量
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
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
