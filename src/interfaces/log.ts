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
  /** Claude Code 客户端发送的 session id（来自 x-claude-code-session-id header） */
  sessionId?: string | null;
  /** 子 agent ID（来自 x-claude-code-agent-id header），null 表示主 agent */
  agentId?: string | null;
  /** 子 agent 类型（如 Explore, Plan, code-reviewer），从 hooks 关联 */
  agentType?: string | null;
  /** 工作目录（从 session_cwds 关联） */
  cwd?: string | null;
}
