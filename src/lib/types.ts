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

export interface Config {
  activeTarget: string;
  targets: Target[];
}

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
  durationMs: number;
  error?: string;
}
