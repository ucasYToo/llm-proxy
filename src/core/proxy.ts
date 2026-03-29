import { v4 as uuidv4 } from "uuid";
import { getActiveTarget } from "../config/store";
import { createLog, updateLog } from "../storage/logs";
import {
  extractTokenUsage,
  assembleAnthropicResponse,
  assembleOpenAIResponse,
} from "./assemble";
import type { LogStatus } from "../config/types";

export interface ProxyRequest {
  method: string;
  path: string[];
  search: string;
  headers: Record<string, string>;
  body: unknown;
  contentType: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  isStream: boolean;
}

/**
 * 代理请求到上游服务器
 */
export const proxyRequest = async (
  req: ProxyRequest,
  onChunk?: (chunk: string) => void,
): Promise<ProxyResponse> => {
  const target = getActiveTarget();

  if (!target) {
    throw new Error("No active target configured");
  }

  const targetUrl = `${target.url.replace(/\/$/, "")}/${req.path.join("/")}`;
  const fullUrl = req.search ? `${targetUrl}${req.search}` : targetUrl;

  // 构建合并后的请求头
  const forwardHeaders: Record<string, string> = {};
  Object.assign(forwardHeaders, req.headers);
  Object.assign(forwardHeaders, target.headers);

  // 构建合并后的请求体
  let requestBody: unknown = undefined;
  let originalBody: unknown = undefined;
  let modifiedBody: unknown = undefined;

  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.contentType.includes("application/json")) {
      originalBody = req.body;
      const merged = {
        ...(req.body as Record<string, unknown>),
        ...target.bodyParams,
      };
      modifiedBody = merged;
      requestBody = JSON.stringify(merged);
      forwardHeaders["content-type"] = "application/json";
      forwardHeaders["content-length"] = new TextEncoder()
        .encode(requestBody as string)
        .byteLength.toString();
    } else {
      originalBody = "[binary]";
      modifiedBody = "[binary]";
      requestBody = req.body;
    }
  }

  const startMs = Date.now();
  const logId = uuidv4();
  const startTime = new Date().toISOString();

  // 捕获原始请求头用于日志记录
  const originalHeaders: Record<string, string> = { ...req.headers };

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
    path: `/${req.path.join("/")}`,
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
    throw new Error(`Upstream request failed: ${err}`);
  }

  const resContentType = upstreamRes.headers.get("content-type") ?? "";
  const isStream = resContentType.includes("text/event-stream");

  // 构建响应头
  const resHeaders: Record<string, string> = {};
  upstreamRes.headers.forEach((value, key) => {
    if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
      resHeaders[key] = value;
    }
  });

  if (isStream) {
    // 流式响应处理
    const chunks: string[] = [];
    let firstChunkReceived = false;
    const decoder = new TextDecoder();

    const reader = upstreamRes.body!.getReader();
    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }

          const text = decoder.decode(value, { stream: true });
          chunks.push(text);
          controller.enqueue(value);

          // 调用 chunk 回调
          if (onChunk) {
            onChunk(text);
          }

          // 2. 首个 chunk 到达时更新状态
          if (!firstChunkReceived) {
            firstChunkReceived = true;
            const firstChunkMs = Date.now() - startMs;
            updateLog(logId, {
              firstChunkMs,
              status: "streaming" as LogStatus,
            });
          }
        }
      },
    });

    // 等待流结束并处理日志
    const fullContent = await readStreamToString(stream);

    // 将 SSE 事件解析为结构化数据
    let parsedEvents: unknown[] = [];
    try {
      const lines = fullContent.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
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
    let assembledBody: unknown = undefined;
    try {
      if (parsedEvents.length > 0) {
        const firstEvent = parsedEvents[0] as Record<string, unknown>;

        if (firstEvent?.type === "message_start") {
          assembledBody = assembleAnthropicResponse(parsedEvents);
        } else if (
          firstEvent?.object === "chat.completion.chunk" ||
          firstEvent?.choices
        ) {
          assembledBody = assembleOpenAIResponse(parsedEvents);
        }
      }
    } catch {
      // 组装失败，保持 undefined
    }

    const responseBody = parsedEvents.length > 0 ? parsedEvents : fullContent;

    // 从组装后的响应中提取 token 用量
    const tokenUsage = extractTokenUsage(assembledBody);

    const durationMs = Date.now() - startMs;

    // 更新最终状态
    updateLog(logId, {
      responseStatus: upstreamRes.status,
      responseBody,
      assembledResponseBody: assembledBody,
      durationMs,
      status: "completed" as LogStatus,
      tokenUsage,
    });

    return {
      status: upstreamRes.status,
      headers: resHeaders,
      body: fullContent,
      isStream: true,
    };
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

  return {
    status: upstreamRes.status,
    headers: resHeaders,
    body: resBodyLog,
    isStream: false,
  };
};

/**
 * 将 ReadableStream 读取为字符串
 */
const readStreamToString = async (stream: ReadableStream): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return decoder.decode(result);
};
