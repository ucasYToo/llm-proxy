import { v4 as uuidv4 } from "uuid";
import { getActiveTarget, readConfig } from "../config/store";
import { createLog, updateLog } from "../storage/logs";
import {
  extractTokenUsage,
  assembleAnthropicResponse,
  assembleOpenAIResponse,
} from "./assemble";
import type { LogStatus } from "../interfaces";

export interface ProxyRequest {
  method: string;
  path: string[];
  search: string;
  headers: Record<string, string>;
  body: unknown;
  contentType: string;
  /** 指定目标 ID，优先于 activeTarget 使用 */
  targetId?: string;
  /** 通道 ID，用于日志记录 */
  channelId?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  isStream: boolean;
}

export interface StreamWriter {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: Uint8Array): void;
  end(): void;
}

/**
 * 代理请求到上游服务器
 */
export const proxyRequest = async (
  req: ProxyRequest,
  streamWriter?: StreamWriter,
): Promise<ProxyResponse> => {
  // 如果指定了 targetId，则使用该目标；否则使用全局活动目标
  let target = getActiveTarget();
  if (req.targetId) {
    const config = readConfig();
    target = config.targets.find((t) => t.id === req.targetId) ?? null;
  }

  if (!target) {
    throw new Error("No active target configured");
  }

  const targetUrl = `${target.url.replace(/\/$/, "")}/${req.path.join("/")}`;
  const fullUrl = req.search ? `${targetUrl}${req.search}` : targetUrl;

  // 构建合并后的请求头（过滤掉 hop-by-hop 头和会导致冲突的头）
  // 注意：必须剥离 accept-encoding，否则 undici 不会自动解压上游响应，
  // 导致 body.getReader() / text() 拿到的是原始压缩字节（gzip/br/zstd），
  // 写入日志后表现为乱码。
  const hopByHopHeaders = new Set([
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "upgrade",
    "proxy-authorization",
    "proxy-connection",
    "accept-encoding",
    "content-length",
  ]);
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  Object.assign(forwardHeaders, target.headers);

  if (target.auth?.value) {
    const { type, headerName, value } = target.auth;
    const matchKey =
      type === "bearer"
        ? "authorization"
        : type === "x-api-key"
          ? "x-api-key"
          : (headerName?.toLowerCase() ?? "");
    if (matchKey) {
      for (const k of Object.keys(forwardHeaders)) {
        if (k.toLowerCase() === matchKey) delete forwardHeaders[k];
      }
    }
    if (type === "bearer") {
      forwardHeaders["Authorization"] = `Bearer ${value}`;
    } else if (type === "x-api-key") {
      forwardHeaders["x-api-key"] = value;
    } else if (type === "custom" && headerName) {
      forwardHeaders[headerName] = value;
    }
  }

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

  const findHeader = (name: string): string | null => {
    const key = Object.keys(originalHeaders).find(
      (k) => k.toLowerCase() === name,
    );
    return key ? (originalHeaders[key] ?? null) : null;
  };

  const sessionId = findHeader("x-claude-code-session-id");
  const agentId = findHeader("x-claude-code-agent-id");

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
    sessionId,
    agentId,
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
  // 剥离 content-encoding / content-length：undici 已经把响应体解压成明文，
  // 我们再原样返回明文给下游客户端，若保留这两个头会让客户端误以为还需要解压。
  const stripResHeaders = new Set([
    "transfer-encoding",
    "connection",
    "content-encoding",
    "content-length",
  ]);
  const resHeaders: Record<string, string> = {};
  upstreamRes.headers.forEach((value, key) => {
    if (!stripResHeaders.has(key.toLowerCase())) {
      resHeaders[key] = value;
    }
  });

  if (isStream) {
    if (streamWriter) {
      streamWriter.writeHead(upstreamRes.status, {
        ...resHeaders,
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
    }

    const parsedEvents: unknown[] = [];
    let firstChunkReceived = false;
    const decoder = new TextDecoder();
    let lineBuffer = "";

    const reader = upstreamRes.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (streamWriter) streamWriter.write(value);

      if (!firstChunkReceived) {
        firstChunkReceived = true;
        updateLog(logId, {
          firstChunkMs: Date.now() - startMs,
          status: "streaming" as LogStatus,
        });
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;
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
    }
    if (streamWriter) streamWriter.end();

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
      // 组装失败
    }

    const { logCollection } = readConfig();
    const responseBody =
      logCollection.captureRawStreamEvents && parsedEvents.length > 0
        ? parsedEvents
        : null;

    const tokenUsage = extractTokenUsage(assembledBody);
    const durationMs = Date.now() - startMs;

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
      body: null,
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

