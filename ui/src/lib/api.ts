export type TargetAuthType = "bearer" | "x-api-key" | "custom";

export interface TargetAuth {
  type: TargetAuthType;
  /** 仅当 type === "custom" 时生效 */
  headerName?: string;
  /** 纯 token 值，不含 "Bearer " 前缀 */
  value: string;
}

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPer1M: number;
  /** USD per 1M output tokens */
  outputPer1M: number;
  /** USD per 1M cache read tokens */
  cacheReadPer1M: number;
  /** USD per 1M cache write tokens */
  cacheWritePer1M: number;
}

export type PricingSource = "override" | "exact" | "family" | "default";

export interface ResolvedPricingResponse {
  model: string | null;
  pricing: ModelPricing;
  source: PricingSource;
  matchedKey: string | null;
}

export interface Target {
  id: string;
  name: string;
  url: string;
  headers: Record<string, string>;
  bodyParams: Record<string, any>;
  anthropicModel?: string;
  /** 认证配置（推荐方式）。若设置，会按 type 派生 header 并覆盖 headers 中同名键 */
  auth?: TargetAuth;
  /** 可选：每个 target 的定价覆盖（USD per 1M tokens） */
  pricing?: Partial<ModelPricing>;
}

export interface Channel {
  id: string;
  name: string;
  activeTarget: string;
}

export interface LogCollection {
  captureOriginalBody: boolean;
  captureRawStreamEvents: boolean;
  /** 日志最大保留条数，默认 300 */
  maxEntries?: number;
}

export interface ChannelEvents {
  stop?: boolean;
  subagentStop?: boolean;
  notification?: boolean;
}

export interface MacosNotifyConfig {
  enabled?: boolean;
  events?: ChannelEvents;
}

export interface DingTalkConfig {
  enabled?: boolean;
  accessToken?: string;
  secret?: string;
  events?: ChannelEvents;
}

export interface NotificationSettings {
  macos?: MacosNotifyConfig;
  dingtalk?: DingTalkConfig;
  /** @deprecated 老扁平字段，仅做兼容读取 */
  stop?: boolean;
  /** @deprecated */
  subagentStop?: boolean;
  /** @deprecated */
  notification?: boolean;
}

export interface Config {
  activeTarget: string;
  targets: Target[];
  logCollection: LogCollection;
  /** @deprecated 旧版备份字段，不再读写 */
  claudeCodeOriginalBaseUrl?: string;
  /** @deprecated 旧版备份字段，不再读写 */
  claudeCodeOriginalModel?: string;
  /** 当前接入 Claude Code 的通道 ID */
  claudeCodeChannelId?: string;
  /** 通道配置列表 */
  channels: Channel[];
  notifications?: NotificationSettings;
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
  /** 首包响应时间（从请求开始到首个流式 chunk 到达的毫秒数） */
  firstChunkMs?: number;
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
  sessionId?: string | null;
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

export const applyClaudeCodeProxy = async (channelId = "default", proxyPort?: number): Promise<void> => {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "applyClaudeCodeProxy", proxyPort, channelId }),
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

export async function addChannel(channel: Omit<Channel, "id"> & { id?: string }): Promise<Channel> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "addChannel", channel }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to add channel");
  }
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

export const refreshClaudeCodeStatus = async (): Promise<{
  ok: boolean;
  detected: boolean;
  channelId?: string;
  currentUrl: string | null;
  currentModel: string | null;
}> => {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "refreshClaudeCodeStatus" }),
  });
  if (!res.ok) throw new Error("Failed to refresh Claude Code status");
  return res.json();
};

export async function setChannelActiveTarget(channelId: string, targetId: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "setChannelActive", channelId, targetId }),
  });
  if (!res.ok) throw new Error("Failed to set channel active target");
}

export interface HookEntry {
  id: string;
  sessionId: string | null;
  eventName: string;
  toolName: string | null;
  cwd: string | null;
  projectRoot?: string | null;
  payload: unknown;
  createdAt: string;
}

export type TimelineEntry =
  | { kind: "hook"; at: string; hook: HookEntry }
  | { kind: "log"; at: string; log: LogEntry };

export type SessionTitleSource = "transcript" | "prompt" | null;

export interface SessionSummary {
  sessionId: string;
  lastEventAt: string;
  lastEventName: string;
  eventCount: number;
  cwd: string | null;
  /** Claude Code 自动生成的会话标题，缺失时退化为首条用户消息 */
  title: string | null;
  /** title 的来源：transcript = ai-title 事件；prompt = 首条用户消息 */
  titleSource: SessionTitleSource;
}

export async function fetchHooks(params: {
  sessionId?: string;
  eventName?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ entries: HookEntry[]; total: number }> {
  const search = new URLSearchParams({
    type: "hooks",
    limit: String(params.limit ?? 100),
    offset: String(params.offset ?? 0),
  });
  if (params.sessionId) search.set("sessionId", params.sessionId);
  if (params.eventName) search.set("eventName", params.eventName);
  const res = await fetch(`/api/query?${search}`);
  return res.json();
}

export async function fetchSessions(opts: {
  withinMs?: number;
  limit?: number;
} = {}): Promise<{ sessions: SessionSummary[] }> {
  const params = new URLSearchParams({ type: "sessions" });
  if (opts.withinMs !== undefined) params.set("withinMs", String(opts.withinMs));
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const res = await fetch(`/api/query?${params.toString()}`);
  return res.json();
}

export async function fetchSessionTimeline(
  sessionId: string,
  limit = 200,
): Promise<{ entries: TimelineEntry[] }> {
  const search = new URLSearchParams({
    type: "session-timeline",
    sessionId,
    limit: String(limit),
  });
  const res = await fetch(`/api/query?${search}`);
  return res.json();
}

export async function clearHooks(): Promise<void> {
  const res = await fetch("/api/query?type=hooks", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear hooks");
}

export interface CaffeinateState {
  supported: boolean;
  active: boolean;
}

export async function fetchCaffeinate(): Promise<CaffeinateState> {
  const res = await fetch("/api/query?type=caffeinate");
  return res.json();
}

export async function testDingTalk(
  accessToken?: string,
  secret?: string,
): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "testDingTalk", accessToken, secret }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "钉钉测试发送失败");
  }
}

export async function setCaffeinate(active: boolean): Promise<CaffeinateState> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "caffeinate", active }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to toggle caffeinate");
  }
  return res.json();
}

export async function updateNotifications(notifications: NotificationSettings): Promise<NotificationSettings> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateNotifications", notifications }),
  });
  if (!res.ok) throw new Error("Failed to update notifications");
  const data = await res.json();
  return data.notifications;
}

// ── Cost Analytics ──

export interface BudgetStatus {
  dailyUsed: number;
  dailyLimit?: number;
  dailyPct: number;
  monthlyUsed: number;
  monthlyLimit?: number;
  monthlyPct: number;
  alertLevel: "ok" | "warning" | "exceeded";
}

export interface TargetCostSummary {
  targetId: string;
  targetName: string;
  totalCostUsd: number;
  totalTokens: number;
  requestCount: number;
}

export interface ModelCostSummary {
  model: string;
  totalCostUsd: number;
  totalTokens: number;
  requestCount: number;
}

export interface TimeRangeCostPoint {
  period: string;
  totalCostUsd: number;
  totalTokens: number;
  requestCount: number;
}

export interface CostSummaryData {
  budget: BudgetStatus;
  totalCost: number;
  todayCost: number;
  byTarget: TargetCostSummary[];
  byModel: ModelCostSummary[];
  recentTrend: TimeRangeCostPoint[];
}

export async function fetchCostSummary(): Promise<CostSummaryData> {
  const res = await fetch("/api/query?type=cost-summary");
  if (!res.ok) throw new Error("Failed to fetch cost summary");
  return res.json();
}

/* ── Session Analytics ── */

export interface SessionCostSummary {
  sessionId: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  requestCount: number;
  avgDurationMs: number;
  avgFirstChunkMs: number;
}

export interface ToolUsageStats {
  toolName: string;
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  errorCount: number;
}

export interface TokenTimeSeriesPoint {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface SubagentRelation {
  agentId: string;
  agentType: string;
  parentSessionId: string;
  parentToolName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number | null;
}

export interface HealthMetrics {
  successRate: number;
  cacheEfficiency: number | null;
  avgFirstChunkMs: number | null;
  errorRate: number;
  toolSuccessRate: number | null;
  requestCount: number;
}

export interface SessionAnalyticsData {
  costSummary: SessionCostSummary | null;
  health: HealthMetrics | null;
  toolUsage: ToolUsageStats[];
  tokenTimeSeries: TokenTimeSeriesPoint[];
  subagents: SubagentRelation[];
}

export async function fetchSessionAnalytics(
  sessionId: string,
): Promise<SessionAnalyticsData> {
  const res = await fetch(
    `/api/query?type=session-analytics&sessionId=${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch session analytics");
  return res.json();
}

export async function fetchPricing(model?: string): Promise<ResolvedPricingResponse> {
  const search = new URLSearchParams({ type: "pricing" });
  if (model) search.set("model", model);
  const res = await fetch(`/api/query?${search}`);
  if (!res.ok) throw new Error("Failed to fetch pricing");
  return res.json();
}

export async function updateBudget(
  budget: { dailyLimitUsd?: number; monthlyLimitUsd?: number; alertThresholdPct?: number },
): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateBudget", budget }),
  });
  if (!res.ok) throw new Error("Failed to update budget");
}
