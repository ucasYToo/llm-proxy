export interface Target {
  id: string;
  name: string;
  /** Base URL，包含路径前缀，例如 https://api.openai.com/v1 */
  url: string;
  /** 额外的请求头，会合并到每个代理请求中 */
  headers: Record<string, string>;
  /** 额外的 Body 字段，会合并到每个代理请求体中 */
  bodyParams: Record<string, unknown>;
}

export interface LogCollection {
  /** 是否采集原始请求 body（来自客户端，未合并 bodyParams 前）。默认 false */
  captureOriginalBody: boolean;
  /** 是否采集原始流式事件数组（SSE 原始 data 列表）。默认 false */
  captureRawStreamEvents: boolean;
}

export interface Channel {
  id: string;
  name: string;
  /** 该通道当前选择的活动目标 ID */
  activeTarget: string;
}

export interface Config {
  activeTarget: string;
  targets: Target[];
  logCollection: LogCollection;
  /** 备份的 Claude Code 原始 ANTHROPIC_BASE_URL，用于一键还原 */
  claudeCodeOriginalBaseUrl?: string;
  /** 当前接入 Claude Code 的通道 ID */
  claudeCodeChannelId?: string;
  /** 通道配置列表 */
  channels: Channel[];
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
  /** @deprecated 请使用 originalRequestHeaders 替代 */
  requestHeaders?: Record<string, string>;
  /** @deprecated 请使用 originalRequestBody 替代 */
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
    headers: import("../core/diff").DiffEntry[];
    body: import("../core/diff").DiffEntry[];
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
