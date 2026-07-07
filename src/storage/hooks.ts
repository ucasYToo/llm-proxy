import { v4 } from "uuid";
import { getDb } from "./db";
import { getSessionCostQuick } from "./cost";
import { computeHealthScore, type HealthMetrics } from "../cost/health";
import { readAiTitle } from "../lib/transcript";

const HOOK_TRIM_THRESHOLD = 2500;
const HOOK_KEEP_AFTER_TRIM = 2000;

export interface HookEntry {
  id: string;
  sessionId: string | null;
  eventName: string;
  toolName: string | null;
  cwd: string | null;
  projectRoot: string | null;
  payload: unknown;
  createdAt: string;
}

export interface InsertHookInput {
  eventName: string;
  sessionId?: string | null;
  toolName?: string | null;
  cwd?: string | null;
  payload: unknown;
}

/**
 * 从 Claude Code transcript_path 反解项目根目录。
 * 例：/Users/x/.claude/projects/-Users-x-foo-bar/<sid>.jsonl → /Users/x/foo/bar
 * 注意：编码不可逆（项目名带 `-` 会被误拆），但作为分组键和显示名足够。
 */
export const projectRootFromTranscript = (
  transcriptPath: string | null | undefined,
): string | null => {
  if (!transcriptPath || typeof transcriptPath !== "string") return null;
  const m = transcriptPath.match(/[/\\]projects[/\\]([^/\\]+)[/\\]/);
  if (!m) return null;
  const encoded = m[1];
  return encoded.replace(/^-/, "/").replace(/-/g, "/");
};

const rowToEntry = (row: Record<string, unknown>): HookEntry => {
  const rawPayload = row.payload;
  let payload: unknown = null;
  if (typeof rawPayload === "string" && rawPayload.length > 0) {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      payload = rawPayload;
    }
  }
  return {
    id: row.id as string,
    sessionId: (row.sessionId as string | null) ?? null,
    eventName: row.eventName as string,
    toolName: (row.toolName as string | null) ?? null,
    cwd: (row.cwd as string | null) ?? null,
    projectRoot: (row.projectRoot as string | null) ?? null,
    payload,
    createdAt: row.createdAt as string,
  };
};

const trimHooks = (): void => {
  const db = getDb();
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM hooks`)
    .get() as { count: number };
  if (count <= HOOK_TRIM_THRESHOLD) return;
  db.prepare(
    `DELETE FROM hooks WHERE rowid NOT IN (
      SELECT rowid FROM hooks ORDER BY createdAt DESC LIMIT ?
    )`,
  ).run(HOOK_KEEP_AFTER_TRIM);
};

export const insertHook = (input: InsertHookInput): HookEntry => {
  const payloadObj =
    input.payload && typeof input.payload === "object"
      ? (input.payload as Record<string, unknown>)
      : null;
  const transcriptPath = payloadObj?.transcript_path as string | undefined;
  const projectRoot = projectRootFromTranscript(transcriptPath);

  const entry: HookEntry = {
    id: v4(),
    sessionId: input.sessionId ?? null,
    eventName: input.eventName,
    toolName: input.toolName ?? null,
    cwd: input.cwd ?? null,
    projectRoot,
    payload: input.payload,
    createdAt: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO hooks (id, sessionId, eventName, toolName, cwd, projectRoot, payload, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.id,
      entry.sessionId,
      entry.eventName,
      entry.toolName,
      entry.cwd,
      entry.projectRoot,
      JSON.stringify(entry.payload ?? null),
      entry.createdAt,
    );

  trimHooks();

  return entry;
};

export interface QueryHooksOptions {
  sessionId?: string;
  eventName?: string;
  limit?: number;
  offset?: number;
}

export const queryHooks = (
  opts: QueryHooksOptions = {},
): { entries: HookEntry[]; total: number } => {
  const { sessionId, eventName, limit = 100, offset = 0 } = opts;
  const filters: string[] = [];
  const args: unknown[] = [];

  if (sessionId) {
    filters.push("sessionId = ?");
    args.push(sessionId);
  }
  if (eventName) {
    filters.push("eventName = ?");
    args.push(eventName);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getDb();

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS count FROM hooks ${where}`)
    .get(...args) as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM hooks ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];

  return {
    entries: rows.map(rowToEntry),
    total: totalRow.count,
  };
};

export type SessionTitleSource = "transcript" | "prompt" | null;

export interface SessionSummary {
  sessionId: string;
  lastEventAt: string;
  lastEventName: string;
  eventCount: number;
  /** 该 session 启动时的 cwd（来自 Claude Code hook payload，整段会话内稳定） */
  cwd: string | null;
  /** session_cwds 表中针对该 cwd 的用户备注；没有则 null */
  remark: string | null;
  /** Claude Code 自动生成的会话标题；缺失时为首条非 slash UserPrompt；都拿不到则 null */
  title: string | null;
  /** title 的来源：transcript = ai-title 事件；prompt = 首条用户消息 */
  titleSource: SessionTitleSource;
  /** 最近一次 Stop/SubagentStop hook 上带回的助手最终回复；没有则 null */
  lastAssistantMessage: string | null;
  /** 来自 cost_records 的总费用（USD） */
  totalCostUsd?: number;
  /** 来自 cost_records 的总 token 数 */
  totalTokens?: number;
  /** 来自 cost_records 的请求数 */
  requestCount?: number;
  /** 健康度指标（各维度独立值），数据不足时为 null */
  healthScore?: HealthMetrics | null;
}

/**
 * 列出 session 摘要。
 * - withinMs > 0：只返回 lastEventAt 在 [now - withinMs, now] 内的 session。
 * - withinMs 为 undefined / <= 0：不按时间过滤，返回全部。
 * - limit：兜底上限（默认 200）。底层 hooks 表本身被 HOOK_TRIM_THRESHOLD 截断，
 *   所以这里主要是防御性约束。
 */
export const recentSessions = (
  withinMs?: number,
  limit?: number,
): SessionSummary[] => {
  const useTime = typeof withinMs === "number" && withinMs > 0;
  const safeLimit = Math.min(
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : 200,
    249,
  );
  const where = useTime
    ? "WHERE sessionId IS NOT NULL AND createdAt >= ?"
    : "WHERE sessionId IS NOT NULL";
  const args: unknown[] = useTime
    ? [new Date(Date.now() - withinMs).toISOString(), safeLimit]
    : [safeLimit];
  const rows = getDb()
    .prepare(
      `SELECT
         sessionId,
         MAX(createdAt) AS lastEventAt,
         COUNT(*) AS eventCount
       FROM hooks
       ${where}
       GROUP BY sessionId
       ORDER BY lastEventAt DESC
       LIMIT ?`,
    )
    .all(...args) as Array<{
    sessionId: string;
    lastEventAt: string;
    eventCount: number;
  }>;

  const sessionIds = rows.map((r) => r.sessionId);
  if (sessionIds.length === 0) return [];

  const placeholders = sessionIds.map(() => "?").join(",");
  const enriched = getDb()
    .prepare(
      `WITH
        last_event AS (
          SELECT sessionId, eventName,
            ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY createdAt DESC, id DESC) AS rn
          FROM hooks WHERE sessionId IN (${placeholders})
        ),
        earliest_cwd AS (
          SELECT sessionId, cwd,
            ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY createdAt ASC) AS rn
          FROM hooks WHERE sessionId IN (${placeholders}) AND cwd IS NOT NULL
        ),
        transcript AS (
          SELECT sessionId, json_extract(payload, '$.transcript_path') AS tp,
            ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY createdAt DESC) AS rn
          FROM hooks WHERE sessionId IN (${placeholders}) AND json_extract(payload, '$.transcript_path') IS NOT NULL
        ),
        first_prompt AS (
          SELECT sessionId, json_extract(payload, '$.prompt') AS prompt,
            ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY createdAt ASC) AS rn
          FROM hooks WHERE sessionId IN (${placeholders}) AND eventName = 'UserPromptSubmit'
            AND json_extract(payload, '$.prompt') IS NOT NULL
            AND substr(json_extract(payload, '$.prompt'), 1, 1) != '/'
        ),
        last_assistant AS (
          SELECT sessionId, json_extract(payload, '$.last_assistant_message') AS lastAssistantMessage,
            ROW_NUMBER() OVER (PARTITION BY sessionId ORDER BY createdAt DESC, id DESC) AS rn
          FROM hooks WHERE sessionId IN (${placeholders})
            AND json_extract(payload, '$.last_assistant_message') IS NOT NULL
            AND json_extract(payload, '$.last_assistant_message') != ''
        )
      SELECT
        le.sessionId,
        le.eventName AS lastEventName,
        ec.cwd,
        sc.remark,
        t.tp AS transcriptPath,
        fp.prompt,
        la.lastAssistantMessage
      FROM last_event le
      LEFT JOIN earliest_cwd ec ON ec.sessionId = le.sessionId AND ec.rn = 1
      LEFT JOIN session_cwds sc ON sc.cwd = ec.cwd AND sc.remark IS NOT NULL AND sc.remark != ''
      LEFT JOIN transcript t ON t.sessionId = le.sessionId AND t.rn = 1
      LEFT JOIN first_prompt fp ON fp.sessionId = le.sessionId AND fp.rn = 1
      LEFT JOIN last_assistant la ON la.sessionId = le.sessionId AND la.rn = 1
      WHERE le.rn = 1`,
    )
    .all(
      ...sessionIds,
      ...sessionIds,
      ...sessionIds,
      ...sessionIds,
      ...sessionIds,
    ) as Array<{
    sessionId: string;
    lastEventName: string | null;
    cwd: string | null;
    remark: string | null;
    transcriptPath: string | null;
    prompt: string | null;
    lastAssistantMessage: string | null;
  }>;

  const enrichMap = new Map(enriched.map((e) => [e.sessionId, e]));

  return rows.map((r) => {
    const e = enrichMap.get(r.sessionId);
    const transcriptPath = e?.transcriptPath ?? null;
    let title: string | null = null;
    let titleSource: SessionTitleSource = null;
    const aiTitle = readAiTitle(transcriptPath);
    if (aiTitle) {
      title = aiTitle;
      titleSource = "transcript";
    } else if (e?.prompt?.trim()) {
      title = e.prompt.trim().slice(0, 80);
      titleSource = "prompt";
    }

    const cost = getSessionCostQuick(r.sessionId);
    const healthScore =
      cost.requestCount >= 5 ? computeHealthScore(r.sessionId) : null;

    return {
      sessionId: r.sessionId,
      lastEventAt: r.lastEventAt,
      lastEventName: e?.lastEventName ?? "",
      eventCount: r.eventCount,
      cwd: e?.cwd ?? null,
      remark: e?.remark ?? null,
      title,
      titleSource,
      lastAssistantMessage: e?.lastAssistantMessage ?? null,
      totalCostUsd: cost.totalCostUsd,
      totalTokens: cost.totalTokens,
      requestCount: cost.requestCount,
      healthScore,
    };
  });
};

export const clearHooks = (): void => {
  getDb().prepare(`DELETE FROM hooks`).run();
};

/* ── Analytics: Tool Usage ── */

export interface ToolUsageStats {
  toolName: string;
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  errorCount: number;
}

/**
 * Aggregate tool usage from PostToolUse (success) and PostToolUseFailure (failure) hooks.
 */
export const aggregateToolUsage = (sessionId?: string): ToolUsageStats[] => {
  const db = getDb();
  const sessionFilter = sessionId ? " AND sessionId = ?" : "";
  const args: unknown[] = sessionId ? [sessionId] : [];

  // Success events
  const successRows = db
    .prepare(
      `SELECT toolName, payload FROM hooks WHERE eventName = 'PostToolUse' AND toolName IS NOT NULL${sessionFilter} ORDER BY createdAt DESC`,
    )
    .all(...args) as Array<{ toolName: string; payload: string | null }>;

  // Failure events
  const failRows = db
    .prepare(
      `SELECT toolName, payload FROM hooks WHERE eventName = 'PostToolUseFailure' AND toolName IS NOT NULL${sessionFilter} ORDER BY createdAt DESC`,
    )
    .all(...args) as Array<{ toolName: string; payload: string | null }>;

  const statsMap = new Map<
    string,
    { callCount: number; totalDurationMs: number; errorCount: number }
  >();

  const getOrCreate = (toolName: string) => {
    let s = statsMap.get(toolName);
    if (!s) {
      s = { callCount: 0, totalDurationMs: 0, errorCount: 0 };
      statsMap.set(toolName, s);
    }
    return s;
  };

  for (const row of successRows) {
    const s = getOrCreate(row.toolName);
    let durationMs = 0;
    if (row.payload) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        durationMs = (payload.duration_ms as number) ?? 0;
      } catch {
        // ignore
      }
    }
    s.callCount += 1;
    s.totalDurationMs += durationMs;
  }

  for (const row of failRows) {
    const s = getOrCreate(row.toolName);
    let durationMs = 0;
    if (row.payload) {
      try {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        durationMs = (payload.duration_ms as number) ?? 0;
      } catch {
        // ignore
      }
    }
    s.callCount += 1;
    s.totalDurationMs += durationMs;
    s.errorCount += 1;
  }

  return Array.from(statsMap.entries())
    .map(([toolName, stats]) => ({
      toolName,
      callCount: stats.callCount,
      totalDurationMs: stats.totalDurationMs,
      avgDurationMs:
        stats.callCount > 0
          ? Math.round(stats.totalDurationMs / stats.callCount)
          : 0,
      errorCount: stats.errorCount,
    }))
    .sort((a, b) => b.callCount - a.callCount);
};

/* ── Analytics: Subagent Relations ── */

export interface SubagentRelation {
  agentId: string;
  agentType: string;
  parentSessionId: string;
  parentToolName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationMs: number | null;
}

/**
 * Infer subagent parent-child relationships from hook event ordering.
 * The hook immediately preceding SubagentStart in the same session
 * is typically the PreToolUse event for the tool that spawned it.
 */
export const getSubagentRelations = (sessionId: string): SubagentRelation[] => {
  const db = getDb();

  // Get all hooks for this session, ordered by time
  const hooks = db
    .prepare(
      `SELECT eventName, toolName, payload, createdAt
       FROM hooks WHERE sessionId = ?
       ORDER BY createdAt ASC`,
    )
    .all(sessionId) as Array<{
    eventName: string;
    toolName: string | null;
    payload: string | null;
    createdAt: string;
  }>;

  // Find SubagentStart events and their preceding hooks
  const starts: Array<{
    agentId: string;
    agentType: string;
    parentToolName: string | null;
    startedAt: string;
  }> = [];

  for (let i = 0; i < hooks.length; i++) {
    if (hooks[i].eventName !== "SubagentStart") continue;

    let agentId = "";
    let agentType = "";
    const startPayload = hooks[i].payload;
    if (startPayload) {
      try {
        const payload = JSON.parse(startPayload) as Record<string, unknown>;
        agentId = (payload.agent_id as string) ?? "";
        agentType = (payload.agent_type as string) ?? "";
      } catch {
        // ignore
      }
    }

    // Find preceding PreToolUse hook as parent
    let parentToolName: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (hooks[j].eventName === "PreToolUse" && hooks[j].toolName) {
        parentToolName = hooks[j].toolName;
        break;
      }
    }

    starts.push({
      agentId,
      agentType,
      parentToolName,
      startedAt: hooks[i].createdAt,
    });
  }

  // Find SubagentStop events to match with starts
  const stopMap = new Map<string, { stoppedAt: string; durationMs: number }>();
  for (const hook of hooks) {
    if (hook.eventName !== "SubagentStop") continue;
    if (!hook.payload) continue;
    try {
      const payload = JSON.parse(hook.payload) as Record<string, unknown>;
      const agentId = (payload.agent_id as string) ?? "";
      if (agentId && !stopMap.has(agentId)) {
        // Try to compute duration from startedAt
        const start = starts.find((s) => s.agentId === agentId);
        const durationMs = start
          ? new Date(hook.createdAt).getTime() - new Date(start.startedAt).getTime()
          : 0;
        stopMap.set(agentId, {
          stoppedAt: hook.createdAt,
          durationMs: durationMs > 0 ? durationMs : 0,
        });
      }
    } catch {
      // ignore
    }
  }

  return starts.map((s) => {
    const stop = stopMap.get(s.agentId);
    return {
      agentId: s.agentId,
      agentType: s.agentType,
      parentSessionId: sessionId,
      parentToolName: s.parentToolName,
      startedAt: s.startedAt,
      stoppedAt: stop?.stoppedAt ?? null,
      durationMs: stop?.durationMs ?? null,
    };
  });
};

/* ── Activity Status: 状态栏红绿灯 ── */

export type ActivityState = "approval" | "running" | "recent" | "idle";

export interface ActivityStatus {
  /** approval=待审批, running=运行中, recent=刚结束3min内, idle=空闲 */
  state: ActivityState;
  /** approval/running 为 true（前端据此闪烁） */
  blinking: boolean;
  runningCount: number;
  approvalCount: number;
  /** 全局最近一次任务结束时间（ISO），无则 null */
  lastDoneAt: string | null;
  computedAt: string;
}

/** 单个会话「最新事件」摘要，喂给纯归约函数 */
export interface SessionLatest {
  eventName: string;
  /** Notification 事件的 message；其它事件为 null */
  message: string | null;
  /** Notification 事件的 notification_type；其它事件为 null */
  notificationType: string | null;
  /** 距今毫秒数 */
  ageMs: number;
}

/** 任务结束后多久内仍显示常绿 */
const RECENT_WINDOW_MS = 3 * 60 * 1000;
/** 运行类事件超过此龄视为僵死（Claude Code 异常退出），防止绿灯卡死 */
const RUNNING_STALE_MS = 15 * 60 * 1000;
/** 待审批等待人介入，给足时间但不无限 */
const APPROVAL_STALE_MS = 60 * 60 * 1000;
/** 只考虑最近一小时有活动的会话 */
const ACTIVITY_LOOKBACK_MS = 60 * 60 * 1000;

/** 表示「会话进行中」的事件（不含 SessionStart：用户尚未提交 prompt） */
const RUNNING_EVENTS = new Set([
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "SubagentStart",
  "SubagentStop",
]);

/** 标志「任务结束」的事件 */
const DONE_EVENTS = new Set(["Stop", "StopFailure", "SessionEnd"]);

/**
 * 判断一条 Notification 是否为「工具授权请求」。
 * Claude Code 授权通知形如 "Claude needs your permission to use Bash"；
 * 空闲通知 "Claude is waiting for your input" 不应命中。
 */
export const isApprovalNotification = (
  message: string | null,
  notificationType?: string | null,
): boolean => {
  // 仅匹配特定关键字；不要用 "tool"（会被 tool_use / tool_result 等误命中）
  if (message && /permission|approval/i.test(message)) return true;
  if (notificationType && /permission|approval/i.test(notificationType)) {
    return true;
  }
  return false;
};

/**
 * 把各会话「最新事件」按紧急度归约成一个全局灯状态。
 * 优先级：待审批 > 运行中 > 刚结束(3min内) > 空闲。纯函数，便于单测。
 * 返回值中的 lastDoneAt 恒为 null，由 getActivityStatus 用真实时间戳覆盖。
 */
export const computeActivityState = (
  sessions: SessionLatest[],
  lastDoneAgeMs: number | null,
  nowMs: number = Date.now(),
): ActivityStatus => {
  // 授权通知（且未僵死）→ 计为待审批
  const approvalCount = sessions.filter(
    (s) =>
      s.eventName === "Notification" &&
      isApprovalNotification(s.message, s.notificationType) &&
      s.ageMs < APPROVAL_STALE_MS,
  ).length;

  // 运行类事件（且未僵死）→ 计为运行中。Notification/Stop 等不在 RUNNING_EVENTS 中
  const runningCount = sessions.filter(
    (s) => RUNNING_EVENTS.has(s.eventName) && s.ageMs < RUNNING_STALE_MS,
  ).length;

  const base = {
    runningCount,
    approvalCount,
    lastDoneAt: null as string | null,
    computedAt: new Date(nowMs).toISOString(),
  };

  if (approvalCount > 0) return { ...base, state: "approval", blinking: true };
  if (runningCount > 0) return { ...base, state: "running", blinking: true };
  if (lastDoneAgeMs !== null && lastDoneAgeMs < RECENT_WINDOW_MS) {
    return { ...base, state: "recent", blinking: false };
  }
  return { ...base, state: "idle", blinking: false };
};

/**
 * 读取 hooks 表，归约出供状态栏使用的全局灯状态。
 */
export const getActivityStatus = (): ActivityStatus => {
  const db = getDb();
  const now = Date.now();
  const sinceIso = new Date(now - ACTIVITY_LOOKBACK_MS).toISOString();

  // 每个会话的最新一条 hook 事件（ROW_NUMBER 带 id 兜底，避免同毫秒并列导致重复/状态错乱）
  const rows = db
    .prepare(
      `SELECT eventName, payload, createdAt
       FROM (
         SELECT h.eventName AS eventName, h.payload AS payload, h.createdAt AS createdAt,
                ROW_NUMBER() OVER (
                  PARTITION BY h.sessionId ORDER BY h.createdAt DESC, h.id DESC
                ) AS rn
         FROM hooks h
         WHERE h.sessionId IS NOT NULL AND h.createdAt >= ?
       )
       WHERE rn = 1`,
    )
    .all(sinceIso) as Array<{
    eventName: string;
    payload: string | null;
    createdAt: string;
  }>;

  const sessions: SessionLatest[] = rows.map((r) => {
    let message: string | null = null;
    let notificationType: string | null = null;
    if (r.payload) {
      try {
        const p = JSON.parse(r.payload) as Record<string, unknown>;
        message = typeof p.message === "string" ? p.message : null;
        notificationType =
          typeof p.notification_type === "string" ? p.notification_type : null;
      } catch {
        // 忽略损坏的 payload
      }
    }
    return {
      eventName: r.eventName,
      message,
      notificationType,
      ageMs: now - new Date(r.createdAt).getTime(),
    };
  });

  // 全局最近一次结束时间（独立于「最新事件」，因为结束后可能又有 idle 通知覆盖）
  const doneRow = db
    .prepare(
      `SELECT MAX(createdAt) AS lastDoneAt FROM hooks WHERE eventName IN ('Stop', 'StopFailure')`,
    )
    .get() as { lastDoneAt: string | null } | undefined;
  const lastDoneAt = doneRow?.lastDoneAt ?? null;
  const lastDoneAgeMs = lastDoneAt
    ? now - new Date(lastDoneAt).getTime()
    : null;

  return { ...computeActivityState(sessions, lastDoneAgeMs, now), lastDoneAt };
};
