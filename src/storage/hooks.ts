import { v4 } from "uuid";
import { getDb } from "./db";

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

export interface SessionSummary {
  sessionId: string;
  lastEventAt: string;
  lastEventName: string;
  eventCount: number;
  /** 该 session 最近一条事件的 cwd（来自 Claude Code hook payload） */
  cwd: string | null;
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

  return rows.map((r) => {
    const last = lastEventStmt.get(r.sessionId) as
      | { eventName: string }
      | undefined;
    const projectRoot =
      (projectRootStmt.get(r.sessionId) as { projectRoot: string } | undefined)
        ?.projectRoot ?? null;
    const earliestCwd =
      (earliestCwdStmt.get(r.sessionId) as { cwd: string } | undefined)?.cwd ??
      null;
    return {
      sessionId: r.sessionId,
      lastEventAt: r.lastEventAt,
      lastEventName: last?.eventName ?? "",
      eventCount: r.eventCount,
      cwd: projectRoot ?? earliestCwd,
    };
  });
};

export const clearHooks = (): void => {
  getDb().prepare(`DELETE FROM hooks`).run();
};
