import { v4 } from "uuid";
import { getDb } from "./db";
import { getSessionCostQuick } from "./cost";
import { computeHealthScore, type HealthMetrics } from "../cost/health";
import { readAiTitle } from "../lib/transcript";

const HOOK_TRIM_THRESHOLD = 500;
const HOOK_KEEP_AFTER_TRIM = 400;

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
    `DELETE FROM hooks WHERE id NOT IN (
      SELECT id FROM hooks ORDER BY createdAt DESC LIMIT ?
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
  /** 该 session 最近一条事件的 cwd（来自 Claude Code hook payload） */
  cwd: string | null;
  /** Claude Code 自动生成的会话标题；缺失时为首条非 slash UserPrompt；都拿不到则 null */
  title: string | null;
  /** title 的来源：transcript = ai-title 事件；prompt = 首条用户消息 */
  titleSource: SessionTitleSource;
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
  const safeLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : 200;
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

  const lastEventStmt = getDb().prepare(
    `SELECT eventName FROM hooks
     WHERE sessionId = ?
     ORDER BY createdAt DESC LIMIT 1`,
  );
  const projectRootStmt = getDb().prepare(
    `SELECT projectRoot FROM hooks
     WHERE sessionId = ? AND projectRoot IS NOT NULL
     ORDER BY createdAt DESC LIMIT 1`,
  );
  const earliestCwdStmt = getDb().prepare(
    `SELECT cwd FROM hooks
     WHERE sessionId = ? AND cwd IS NOT NULL
     ORDER BY createdAt ASC LIMIT 1`,
  );
  const transcriptPathStmt = getDb().prepare(
    `SELECT json_extract(payload, '$.transcript_path') AS tp FROM hooks
     WHERE sessionId = ? AND json_extract(payload, '$.transcript_path') IS NOT NULL
     ORDER BY createdAt DESC LIMIT 1`,
  );
  const firstPromptStmt = getDb().prepare(
    `SELECT json_extract(payload, '$.prompt') AS prompt FROM hooks
     WHERE sessionId = ? AND eventName = 'UserPromptSubmit'
       AND json_extract(payload, '$.prompt') IS NOT NULL
       AND substr(json_extract(payload, '$.prompt'), 1, 1) != '/'
     ORDER BY createdAt ASC LIMIT 1`,
  );

  return rows.map((r) => {
    const last = lastEventStmt.get(r.sessionId) as
      | { eventName: string }
      | undefined;
    const { projectRoot = null } =
      (projectRootStmt.get(r.sessionId) as { projectRoot: string } | undefined) ?? {};
    const { cwd: earliestCwd = null } =
      (earliestCwdStmt.get(r.sessionId) as { cwd: string } | undefined) ?? {};

    // Resolve title: prefer ai-title from transcript, fallback to first user prompt
    const { tp: transcriptPath = null } =
      (transcriptPathStmt.get(r.sessionId) as { tp: string | null } | undefined) ?? {};
    let title: string | null = null;
    let titleSource: SessionTitleSource = null;
    const aiTitle = readAiTitle(transcriptPath);
    if (aiTitle) {
      title = aiTitle;
      titleSource = "transcript";
    } else {
      const { prompt = null } =
        (firstPromptStmt.get(r.sessionId) as { prompt: string | null } | undefined) ?? {};
      if (prompt && prompt.trim()) {
        title = prompt.trim().slice(0, 80);
        titleSource = "prompt";
      }
    }

    // Enrich with cost data from cost_records
    const cost = getSessionCostQuick(r.sessionId);
    const healthScore =
      cost.requestCount >= 5 ? computeHealthScore(r.sessionId) : null;

    return {
      sessionId: r.sessionId,
      lastEventAt: r.lastEventAt,
      lastEventName: last?.eventName ?? "",
      eventCount: r.eventCount,
      cwd: projectRoot ?? earliestCwd,
      title,
      titleSource,
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
