export interface Target {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  bodyParams: Record<string, any>;
}

export interface Channel {
  id: string;
  name: string;
  activeTarget: string;
}

export interface LogCollection {
  captureOriginalBody: boolean;
  captureRawStreamEvents: boolean;
}

export interface Config {
  activeTarget: string;
  targets: Target[];
  logCollection: LogCollection;
  /** 备份的 Claude Code 原始 ANTHROPIC_BASE_URL，用于一键还原 */
  claudeCodeOriginalBaseUrl?: string;
  /** 通道配置列表 */
  channels: Channel[];
}

export type LogStatus = "pending" | "streaming" | "completed" | "error";

export interface DiffEntry {
  path: string;
  type: "added" | "removed" | "changed";
  oldValue?: unknown;
  newValue?: unknown;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  targetId: string;
  targetName: string;
  method: string;
  path: string;
  responseStatus: number;
  status?: LogStatus;
  durationMs: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  error?: string;
  modifiedRequestHeaders: Record<string, string>;
  modifiedRequestBody: unknown;
  originalRequestHeaders?: Record<string, string>;
  originalRequestBody?: unknown;
  assembledResponseBody?: unknown;
  precomputedDiff?: {
    headers: DiffEntry[];
    body: DiffEntry[];
  };
  responseBody?: unknown;
}

export interface LogQueryResult {
  entries: LogEntry[];
  total: number;
}

export interface LogQueryParams {
  limit?: number;
  offset?: number;
  targetId?: string;
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("/api/query?type=config");
  return res.json();
}

export async function fetchLogs(
  limit = 50,
  offset = 0,
): Promise<LogQueryResult> {
  const res = await fetch(
    `/api/query?type=logs&limit=${limit}&offset=${offset}`,
  );
  return res.json();
}

export async function queryLogs(
  params: LogQueryParams,
): Promise<LogQueryResult> {
  const searchParams = new URLSearchParams({
    type: "logs",
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0),
  });
  if (params.targetId) searchParams.set("targetId", params.targetId);
  const res = await fetch(`/api/query?${searchParams}`);
  return res.json();
}

export async function setActiveTarget(targetId: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setActive", targetId }),
  });
  if (!res.ok) throw new Error("Failed to set active target");
}

export async function addTarget(target: Omit<Target, "id">): Promise<Target> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "addTarget", target }),
  });
  if (!res.ok) throw new Error("Failed to add target");
  const data = await res.json();
  return data.target;
}

export async function updateTarget(target: Target): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateTarget", target }),
  });
  if (!res.ok) throw new Error("Failed to update target");
}

export async function deleteTarget(targetId: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "deleteTarget", targetId }),
  });
  if (!res.ok) throw new Error("Failed to delete target");
}

export async function clearLogs(): Promise<void> {
  const res = await fetch("/api/query?type=logs", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear logs");
}

export const applyClaudeCodeProxy = async (proxyPort = 1998): Promise<void> => {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "applyClaudeCodeProxy", proxyPort }),
  });
  if (!res.ok) throw new Error("Failed to apply Claude Code proxy");
};

export const restoreClaudeCodeProxy = async (): Promise<void> => {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restoreClaudeCodeProxy" }),
  });
  if (!res.ok) throw new Error("Failed to restore Claude Code proxy");
};

export async function addChannel(channel: Omit<Channel, "id">): Promise<Channel> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "addChannel", channel }),
  });
  if (!res.ok) throw new Error("Failed to add channel");
  const data = await res.json();
  return data.channel;
}

export async function updateChannel(channel: Channel): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateChannel", channel }),
  });
  if (!res.ok) throw new Error("Failed to update channel");
}

export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "deleteChannel", channelId }),
  });
  if (!res.ok) throw new Error("Failed to delete channel");
}

export async function setChannelActiveTarget(channelId: string, targetId: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setChannelActive", channelId, targetId }),
  });
  if (!res.ok) throw new Error("Failed to set channel active target");
}
