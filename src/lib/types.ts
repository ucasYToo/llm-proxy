export interface Target {
  id: string;
  name: string;
  /** Base URL including path prefix, e.g. https://api.openai.com/v1 */
  url: string;
  /** Extra headers merged into every proxied request */
  headers: Record<string, string>;
  /** Extra body fields merged into every proxied request body */
  bodyParams: Record<string, unknown>;
}

export interface LogCollection {
  /** 是否采集原始请求 body（来自客户端，未合并 bodyParams 前）。默认 false */
  captureOriginalBody: boolean;
  /** 是否采集原始流式事件数组（SSE 原始 data 列表）。默认 false */
  captureRawStreamEvents: boolean;
}

export interface Config {
  activeTarget: string;
  targets: Target[];
  logCollection: LogCollection;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type LogStatus = "pending" | "streaming" | "completed" | "error";

export interface LogEntry {
  id: string;
  timestamp: string;
  targetId: string;
  targetName: string;
  method: string;
  path: string;
  /** @deprecated Use originalRequestHeaders instead */
  requestHeaders?: Record<string, string>;
  /** @deprecated Use originalRequestBody instead */
  requestBody?: unknown;
  /** 原始请求 headers（来自客户端） */
  originalRequestHeaders: Record<string, string>;
  /** 原始请求 body（来自客户端） */
  originalRequestBody: unknown;
  /** 修改后请求 headers（实际发送给上游） */
  modifiedRequestHeaders: Record<string, string>;
  /** 修改后请求 body（实际发送给上游） */
  modifiedRequestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
  /** 流式响应组装后的完整数据（仅流式响应有值） */
  assembledResponseBody?: unknown;
  /** 预计算的 diff 结果（当 captureOriginalBody 关闭时存储，用于 Diff 视图） */
  precomputedDiff?: {
    headers: import("./jsonDiff").DiffEntry[];
    body: import("./jsonDiff").DiffEntry[];
  };
  durationMs: number;
  error?: string;
  /** 日志状态：pending-请求中, streaming-接收流中, completed-完成, error-错误 */
  status?: LogStatus;
  /** 首包响应时间（从请求开始到首个流式 chunk 到达的毫秒数） */
  firstChunkMs?: number;
  /** 请求开始时间戳（用于计算各种耗时） */
  startTime?: string;
  /** 提取的 token 使用量（从响应中提取） */
  tokenUsage?: TokenUsage;
}
