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

export interface CwdRoute {
  cwd: string;
  targetId: string;
}

export interface Channel {
  id: string;
  name: string;
  activeTarget: string;
  cwdRoutes?: CwdRoute[];
}

export interface Project {
  cwd: string;
  remark: string | null;
  lastSeen: string;
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

export interface FeishuConfig {
  enabled?: boolean;
  webhookUrl?: string;
  secret?: string;
  events?: ChannelEvents;
}

export interface NotificationSettings {
  macos?: MacosNotifyConfig;
  dingtalk?: DingTalkConfig;
  feishu?: FeishuConfig;
  /** @deprecated 老扁平字段，仅做兼容读取 */
  stop?: boolean;
  /** @deprecated */
  subagentStop?: boolean;
  /** @deprecated */
  notification?: boolean;
}

export interface BudgetConfig {
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  alertThresholdPct?: number;
}

export type RemoteBridgeIngress = "longConnection" | "callbackUrl";
export type RemoteBridgePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";
export type RemoteBridgeDeliveryMode = "cli" | "channel" | "auto";

export interface RemoteBridgeConfig {
  enabled?: boolean;
  authToken?: string;
  web?: {
    enabled?: boolean;
    publicBaseUrl?: string;
  };
  allowedCwds?: string[];
  defaultCwd?: string;
  claudeCommand?: string;
  permissionMode?: RemoteBridgePermissionMode;
  deliveryMode?: RemoteBridgeDeliveryMode;
  feishu?: {
    enabled?: boolean;
    bots?: RemoteBridgeFeishuBotConfig[];
    appId?: string;
    appSecret?: string;
    encryptKey?: string;
    verificationToken?: string;
    ingress?: RemoteBridgeIngress;
    allowedUserIds?: string[];
    progressCard?: {
      enabled?: boolean;
      showPartialAnswer?: boolean;
      showToolEvents?: boolean;
    };
  };
}

export interface RemoteBridgeFeishuBotConfig {
  id?: string;
  name?: string;
  enabled?: boolean;
  defaultCwd?: string;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  allowedUserIds?: string[];
  progressCard?: {
    enabled?: boolean;
    showPartialAnswer?: boolean;
    showToolEvents?: boolean;
  };
}

export interface FeishuRemoteSkillStatus {
  botId?: string | null;
  botName?: string | null;
  cwd: string | null;
  installed: boolean;
  version: string | null;
  expectedVersion: string;
  needsUpdate: boolean;
  skillPath: string | null;
  helperPath: string | null;
  error?: string;
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
  remoteBridge?: RemoteBridgeConfig;
  budget?: BudgetConfig;
  serverPort?: number;
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
  agentId?: string | null;
  agentType?: string | null;
  cwd?: string | null;
}

export interface LogQueryResult {
  entries: LogEntry[];
  total: number;
}

export interface LogQueryParams {
  limit?: number;
  offset?: number;
  targetId?: string;
  agentId?: string;
  summary?: boolean;
}

export async function fetchConfig(): Promise<Config> {
  const res = await fetch("/api/query?type=config");
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}

export async function fetchLogs(
  limit = 50,
  offset = 0,
): Promise<LogQueryResult> {
  const res = await fetch(
    `/api/query?type=logs&limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error("Failed to fetch logs");
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
  if (params.agentId) searchParams.set("agentId", params.agentId);
  if (params.summary === false) searchParams.set("summary", "false");
  const res = await fetch(`/api/query?${searchParams}`);
  if (!res.ok) throw new Error("Failed to query logs");
  return res.json();
}

export async function fetchLogDetail(id: string): Promise<LogEntry> {
  const res = await fetch(`/api/query?type=log-detail&id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Log not found");
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

export async function getProjects(): Promise<Project[]> {
  const res = await fetch("/api/query?type=projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json();
  return data.projects;
}

export async function updateProjectRemarkApi(cwd: string, remark: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateProjectRemark", cwd, remark }),
  });
  if (!res.ok) throw new Error("Failed to update project remark");
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
  /** session_cwds 表中针对该 cwd 的用户备注；没有则 null */
  remark: string | null;
  /** Claude Code 自动生成的会话标题，缺失时退化为首条用户消息 */
  title: string | null;
  /** title 的来源：transcript = ai-title 事件；prompt = 首条用户消息 */
  titleSource: SessionTitleSource;
  /** 最近一次 Stop/SubagentStop hook 上带回的助手最终回复；没有则 null */
  lastAssistantMessage: string | null;
}

export type RemoteThreadStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting_permission"
  | "done"
  | "failed";
export type RemoteMessageDirection =
  | "inbound"
  | "outbound"
  | "system"
  | "permission";
export type RemoteMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed";

export interface RemoteThread {
  id: string;
  shortId: string;
  source: "web" | "feishu";
  sourceBotId: string | null;
  sourceThreadId: string | null;
  sourceUserId: string | null;
  sourceChatId: string | null;
  cwd: string | null;
  claudeSessionId: string | null;
  channelInstanceId: string | null;
  status: RemoteThreadStatus;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface RemoteMessage {
  id: string;
  threadId: string;
  direction: RemoteMessageDirection;
  source: "web" | "feishu";
  sourceBotId: string | null;
  sourceMessageId: string | null;
  sourceUserId: string | null;
  text: string;
  status: RemoteMessageStatus;
  error: string | null;
  raw: unknown;
  createdAt: string;
  deliveredAt: string | null;
}

export interface RemoteChannelInstance {
  id: string;
  pid: number | null;
  cwd: string | null;
  claudeSessionId: string | null;
  status: "online" | "offline";
  metadata: unknown;
  startedAt: string;
  lastSeenAt: string;
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
  if (!res.ok) throw new Error("Failed to fetch hooks");
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
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return res.json();
}

export async function fetchRemoteThreads(
  limit = 100,
): Promise<{ threads: RemoteThread[]; total: number }> {
  const res = await fetch(`/api/query?type=remote-threads&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch remote threads");
  return res.json();
}

export async function fetchRemoteMessages(
  threadId?: string,
  limit = 100,
): Promise<{ messages: RemoteMessage[]; total: number }> {
  const search = new URLSearchParams({
    type: "remote-messages",
    limit: String(limit),
  });
  if (threadId) search.set("threadId", threadId);
  const res = await fetch(`/api/query?${search}`);
  if (!res.ok) throw new Error("Failed to fetch remote messages");
  return res.json();
}

export async function fetchRemoteInstances(
  includeStale = false,
): Promise<{ instances: RemoteChannelInstance[] }> {
  const res = await fetch(
    `/api/query?type=remote-instances&includeStale=${includeStale ? "true" : "false"}`,
  );
  if (!res.ok) throw new Error("Failed to fetch remote instances");
  return res.json();
}

export async function sendRemoteMessageApi(params: {
  text: string;
  mode: "new" | "continue";
  threadId?: string;
  cwd?: string | null;
  claudeSessionId?: string | null;
  title?: string | null;
}): Promise<{ thread: RemoteThread; message: RemoteMessage; dispatched: boolean }> {
  const res = await fetch("/api/remote/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: params.text,
      mode: params.mode,
      threadId: params.threadId,
      cwd: params.cwd,
      claudeSessionId: params.claudeSessionId,
      title: params.title,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to send remote message");
  }
  const data = await res.json();
  return {
    thread: data.thread,
    message: data.message,
    dispatched: data.dispatched,
  };
}

export async function installRemoteBridgeChannelApi(
  cwd?: string | null,
): Promise<{ file: string; serverName: string; remoteBridge: RemoteBridgeConfig }> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "installRemoteBridgeChannel",
      cwd,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to install remote bridge channel");
  }
  return res.json();
}

export async function launchRemoteBridgeChannelApi(
  cwd?: string | null,
): Promise<{ mcpFile: string; command: string; ok: boolean; pid?: number }> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "launchRemoteBridgeChannel",
      cwd,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? err.command ?? "Failed to launch remote bridge channel");
  }
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
  if (!res.ok) throw new Error("Failed to fetch session timeline");
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
  if (!res.ok) throw new Error("Failed to fetch caffeinate state");
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

export async function testFeishu(
  webhookUrl?: string,
  secret?: string,
): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "testFeishu", webhookUrl, secret }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "飞书测试发送失败");
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

export async function updateRemoteBridge(
  remoteBridge: RemoteBridgeConfig,
): Promise<RemoteBridgeConfig> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "updateRemoteBridge", remoteBridge }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to update remote bridge");
  }
  const data = await res.json();
  return data.remoteBridge;
}

export async function testFeishuApp(botId?: string, chatId?: string): Promise<void> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "testFeishuApp", botId, chatId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "飞书应用测试失败");
  }
}

export async function fetchFeishuRemoteSkillStatuses(): Promise<{
  statuses: FeishuRemoteSkillStatus[];
}> {
  const res = await fetch("/api/query?type=remote-feishu-skill-status");
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "获取飞书 Skill 状态失败");
  }
  return res.json();
}

export async function installFeishuRemoteSkillApi(
  botId?: string | null,
): Promise<{ status: FeishuRemoteSkillStatus }> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "installRemoteFeishuSkill", botId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "安装飞书 Skill 失败");
  }
  return res.json();
}

export async function uninstallFeishuRemoteSkillApi(
  botId?: string | null,
): Promise<{ status: FeishuRemoteSkillStatus }> {
  const res = await fetch("/api/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "uninstallRemoteFeishuSkill", botId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "移除飞书 Skill 失败");
  }
  return res.json();
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
  decodeOutputTokens: number;
  totalDecodeMs: number;
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

export interface CodexSessionSummary {
  sessionId: string;
  lastEventAt: string;
  lastEventName: string;
  eventCount: number;
  promptCount: number;
  replyCount: number;
  cwd: string | null;
  model: string | null;
  title: string | null;
  lastAssistantMessage: string | null;
  traceBundleCount: number;
}

export interface CodexOverview {
  sessionCount: number;
  hookCount: number;
  promptCount: number;
  replyCount: number;
  traceBundleCount: number;
}

export interface CodexHookStatus {
  file: string;
  installed: boolean;
  events: string[];
}

export interface CodexStatus {
  hooks: CodexHookStatus;
  trace: CodexTraceStatus;
  databasePath: string;
  captureMode: "hooks+rollout-trace";
  preservesLogin: boolean;
}

export interface CodexTraceStatus {
  configured: boolean;
  configuredRoot: string | null;
  rootPath: string;
  maxBytes: number;
  usedBytes: number;
  bundleCount: number;
  restartRequired: true;
}

export interface CodexTraceEventSummary {
  kind: "trace";
  id: string;
  bundleId: string;
  seq: number;
  at: string;
  sessionId: string;
  threadId: string | null;
  turnId: string | null;
  eventType: string;
  category: "model" | "tool" | "lifecycle";
  summary: string;
  model: string | null;
  provider: string | null;
  hasPayload: boolean;
}

export type CodexTimelineEntry =
  | { kind: "hook"; at: string; hook: HookEntry }
  | CodexTraceEventSummary;

export interface CodexTraceEventDetail {
  event: Record<string, unknown>;
  payloads: Array<{ kind: string; path: string; content: unknown }>;
  bundlePath: string;
}

export async function fetchCodexStatus(): Promise<CodexStatus> {
  const res = await fetch("/api/codex/status");
  if (!res.ok) throw new Error("Failed to fetch Codex status");
  return res.json();
}

export async function installCodexHooksApi(): Promise<{ hooks: CodexHookStatus }> {
  const res = await fetch("/api/codex/setup/hooks", { method: "POST" });
  if (!res.ok) throw new Error("Failed to install Codex hooks");
  return res.json();
}

export async function fetchCodexHooks(
  params: { sessionId?: string; limit?: number } = {},
): Promise<{ entries: HookEntry[]; total: number }> {
  const search = new URLSearchParams({ limit: String(params.limit ?? 200) });
  if (params.sessionId) search.set("sessionId", params.sessionId);
  const res = await fetch(`/api/codex/hooks?${search}`);
  if (!res.ok) throw new Error("Failed to fetch Codex hooks");
  return res.json();
}

export async function fetchCodexSessions(): Promise<{
  sessions: CodexSessionSummary[];
}> {
  const res = await fetch("/api/codex/sessions");
  if (!res.ok) throw new Error("Failed to fetch Codex sessions");
  return res.json();
}

export async function fetchCodexTimeline(
  sessionId: string,
): Promise<{ entries: CodexTimelineEntry[] }> {
  const res = await fetch(
    `/api/codex/sessions/${encodeURIComponent(sessionId)}/timeline`,
  );
  if (!res.ok) throw new Error("Failed to fetch Codex timeline");
  return res.json();
}

export async function fetchCodexGlobalTimeline(): Promise<{
  entries: CodexTimelineEntry[];
}> {
  const res = await fetch("/api/codex/timeline?limit=300");
  if (!res.ok) throw new Error("Failed to fetch Codex timeline");
  return res.json();
}

export async function startCodexTraceCaptureApi(): Promise<{
  trace: CodexTraceStatus;
  message: string;
}> {
  const res = await fetch("/api/codex/traces/capture", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to start Codex raw logging");
  return data;
}

export async function stopCodexTraceCaptureApi(): Promise<{
  trace: CodexTraceStatus;
  message: string;
}> {
  const res = await fetch("/api/codex/traces/capture", { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to stop Codex raw logging");
  return data;
}

export async function fetchCodexTraceEventDetail(
  bundleId: string,
  seq: number,
): Promise<CodexTraceEventDetail> {
  const res = await fetch(
    `/api/codex/traces/${encodeURIComponent(bundleId)}/events/${seq}`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to read Codex trace payload");
  return data;
}

export async function fetchCodexOverview(): Promise<CodexOverview> {
  const res = await fetch("/api/codex/overview");
  if (!res.ok) throw new Error("Failed to fetch Codex overview");
  return res.json();
}

export async function clearCodexDataApi(): Promise<void> {
  const res = await fetch("/api/codex/data", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear Codex data");
}
