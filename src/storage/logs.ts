import type { LogEntry, TokenUsage } from "../interfaces";
import { readConfig } from "../config/store";
import { jsonDiff } from "../core/diff";
import { getDb } from "./db";

const DEFAULT_MAX_ENTRIES = 500;

const JSON_COLUMNS = [
  "originalRequestHeaders",
  "originalRequestBody",
  "modifiedRequestHeaders",
  "modifiedRequestBody",
  "responseBody",
  "assembledResponseBody",
  "precomputedDiff",
] as const;

const SCALAR_COLUMNS = [
  "id",
  "timestamp",
  "targetId",
  "targetName",
  "method",
  "path",
  "responseStatus",
  "status",
  "durationMs",
  "firstChunkMs",
  "startTime",
  "error",
  "sessionId",
  "agentId",
  "agentType",
  "cwd",
] as const;

const TOKEN_COLUMNS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

const ALL_COLUMNS: string[] = [
  ...SCALAR_COLUMNS,
  ...TOKEN_COLUMNS,
  ...JSON_COLUMNS,
];

const applyLogCollectionFilter = (
  entry: LogEntry,
  preserveDiff = false,
): LogEntry => {
  const { logCollection } = readConfig();
  const filtered: LogEntry = { ...entry };

  if (!logCollection.captureOriginalBody) {
    if (!preserveDiff || !filtered.precomputedDiff) {
      filtered.precomputedDiff = {
        headers: jsonDiff(
          entry.originalRequestHeaders,
          entry.modifiedRequestHeaders,
        ),
        body: jsonDiff(entry.originalRequestBody, entry.modifiedRequestBody),
      };
    }
    filtered.originalRequestBody = null;
    filtered.originalRequestHeaders = {};
  }

  if (!logCollection.captureRawStreamEvents) {
    if (Array.isArray(filtered.responseBody)) {
      filtered.responseBody = null;
    }
  }

  return filtered;
};

const getMaxEntries = (): number => {
  const { logCollection } = readConfig();
  return logCollection.maxEntries ?? DEFAULT_MAX_ENTRIES;
};

const trimLogs = (): void => {
  const max = getMaxEntries();
  if (max <= 0) return;
  const threshold = Math.ceil(max * 1.25);
  const db = getDb();
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM logs`)
    .get() as { count: number };
  if (count <= threshold) return;
  db.prepare(
    `DELETE FROM logs WHERE rowid NOT IN (
      SELECT rowid FROM logs ORDER BY timestamp DESC LIMIT ?
    )`,
  ).run(max);
};

const entryToColumns = (
  entry: Partial<LogEntry>,
): Record<string, string | number | null> => {
  const out: Record<string, string | number | null> = {};

  for (const col of SCALAR_COLUMNS) {
    if (col in entry) {
      const val = (entry as Record<string, unknown>)[col];
      out[col] =
        val === undefined || val === null
          ? null
          : typeof val === "string" || typeof val === "number"
            ? val
            : String(val);
    }
  }

  if ("tokenUsage" in entry) {
    const usage = entry.tokenUsage ?? {};
    for (const col of TOKEN_COLUMNS) {
      out[col] = (usage as Record<string, number | undefined>)[col] ?? null;
    }
  }

  for (const col of JSON_COLUMNS) {
    if (col in entry) {
      const val = (entry as Record<string, unknown>)[col];
      out[col] = val === undefined ? null : JSON.stringify(val);
    }
  }

  return out;
};

const rowToEntry = (row: Record<string, unknown>): LogEntry => {
  const entry: Record<string, unknown> = {};
  for (const col of SCALAR_COLUMNS) {
    if (row[col] !== null && row[col] !== undefined) {
      entry[col] = row[col];
    }
  }

  const tokenUsage: TokenUsage = {};
  let hasTokens = false;
  for (const col of TOKEN_COLUMNS) {
    if (row[col] !== null && row[col] !== undefined) {
      (tokenUsage as Record<string, number>)[col] = row[col] as number;
      hasTokens = true;
    }
  }
  if (hasTokens) entry.tokenUsage = tokenUsage;

  for (const col of JSON_COLUMNS) {
    const raw = row[col];
    if (typeof raw === "string" && raw.length > 0) {
      try {
        entry[col] = JSON.parse(raw);
      } catch {
        entry[col] = raw;
      }
    } else if (raw === null || raw === undefined) {
      if (col === "originalRequestHeaders" || col === "modifiedRequestHeaders") {
        entry[col] = {};
      } else if (col === "originalRequestBody" || col === "responseBody") {
        entry[col] = null;
      }
    }
  }

  return entry as unknown as LogEntry;
};

export type LogChangeKind = "create" | "update";
export type LogChangeListener = (entry: LogEntry, kind: LogChangeKind) => void;

const logListeners: LogChangeListener[] = [];

export const onLogChange = (fn: LogChangeListener): void => {
  logListeners.push(fn);
};

const notifyLogChange = (entry: LogEntry, kind: LogChangeKind): void => {
  for (const fn of logListeners) {
    try {
      fn(entry, kind);
    } catch {
      // ignore listener errors
    }
  }
};

const resolveLogMeta = (entry: LogEntry): void => {
  if (!entry.sessionId) return;
  const db = getDb();
  if (!entry.cwd) {
    const row = db
      .prepare(`SELECT cwd FROM session_cwds WHERE sessionId = ? LIMIT 1`)
      .get(entry.sessionId) as { cwd: string } | undefined;
    if (row) entry.cwd = row.cwd;
  }
  if (entry.agentId && !entry.agentType) {
    const row = db
      .prepare(
        `SELECT json_extract(payload, '$.agent_type') AS t FROM hooks
         WHERE json_extract(payload, '$.agent_id') = ?
           AND json_extract(payload, '$.agent_type') IS NOT NULL LIMIT 1`,
      )
      .get(entry.agentId) as { t: string } | undefined;
    if (row) entry.agentType = row.t;
  }
};

export const createLog = (entry: LogEntry): void => {
  resolveLogMeta(entry);
  const filtered = applyLogCollectionFilter(entry);
  const cols = entryToColumns(filtered);
  const columnNames = ALL_COLUMNS.filter((c) => c in cols);
  const placeholders = columnNames.map(() => "?").join(", ");
  const values = columnNames.map((c) => cols[c]);

  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO logs (${columnNames.join(", ")}) VALUES (${placeholders})`,
  ).run(...values);

  trimLogs();

  const summaryRow = db
    .prepare(`SELECT ${SUMMARY_COLUMNS.join(", ")} FROM logs WHERE id = ?`)
    .get(entry.id) as Record<string, unknown> | undefined;
  if (summaryRow) notifyLogChange(rowToSummary(summaryRow), "create");
};

const SUMMARY_COLUMNS = [
  ...SCALAR_COLUMNS,
  ...TOKEN_COLUMNS,
] as const;

const rowToSummary = (row: Record<string, unknown>): LogEntry => {
  const entry: Record<string, unknown> = {};
  for (const col of SCALAR_COLUMNS) {
    if (row[col] !== null && row[col] !== undefined) entry[col] = row[col];
  }
  const tokenUsage: TokenUsage = {};
  let hasTokens = false;
  for (const col of TOKEN_COLUMNS) {
    if (row[col] !== null && row[col] !== undefined) {
      (tokenUsage as Record<string, number>)[col] = row[col] as number;
      hasTokens = true;
    }
  }
  if (hasTokens) entry.tokenUsage = tokenUsage;
  entry.originalRequestHeaders = {};
  entry.modifiedRequestHeaders = {};
  return entry as unknown as LogEntry;
};

export const updateLog = (id: string, updates: Partial<LogEntry>): void => {
  const cols = entryToColumns(updates);
  const updateCols = Object.keys(cols).filter((c) => c !== "id");
  if (updateCols.length === 0) return;

  const setClause = updateCols.map((c) => `${c} = ?`).join(", ");
  const values = updateCols.map((c) => cols[c]);

  const db = getDb();
  const result = db
    .prepare(`UPDATE logs SET ${setClause} WHERE id = ?`)
    .run(...values, id);
  if (result.changes === 0) return;

  if (updates.status === "completed") {
    const row = db
      .prepare(`SELECT agentId, agentType, sessionId, cwd FROM logs WHERE id = ?`)
      .get(id) as Pick<LogEntry, "agentId" | "agentType" | "sessionId" | "cwd"> | undefined;
    if (row && (row.agentId && !row.agentType) || (row && !row.cwd)) {
      const patch: Partial<LogEntry> = { ...row };
      resolveLogMeta(patch as LogEntry);
      const fills: string[] = [];
      const fillVals: unknown[] = [];
      if (patch.agentType && !row!.agentType) { fills.push("agentType = ?"); fillVals.push(patch.agentType); }
      if (patch.cwd && !row!.cwd) { fills.push("cwd = ?"); fillVals.push(patch.cwd); }
      if (fills.length > 0) {
        db.prepare(`UPDATE logs SET ${fills.join(", ")} WHERE id = ?`).run(...fillVals, id);
      }
    }
  }

  const summaryRow = db
    .prepare(`SELECT ${SUMMARY_COLUMNS.join(", ")} FROM logs WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (summaryRow) notifyLogChange(rowToSummary(summaryRow), "update");
};

export const upsertLog = (entry: LogEntry): void => {
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM logs WHERE id = ?`)
    .get(entry.id);
  if (existing) {
    updateLog(entry.id, entry);
  } else {
    createLog(entry);
  }
};

export const appendLog = (entry: LogEntry): void => {
  upsertLog(entry);
};

export interface QueryLogsOptions {
  limit?: number;
  offset?: number;
  targetId?: string;
  sessionId?: string;
  agentId?: string;
  summary?: boolean;
}

export const queryLogs = (
  opts: QueryLogsOptions = {},
): {
  entries: LogEntry[];
  total: number;
} => {
  const { limit = 50, offset = 0, targetId, sessionId, agentId } = opts;
  const filters: string[] = [];
  const args: unknown[] = [];
  if (targetId) {
    filters.push("targetId = ?");
    args.push(targetId);
  }
  if (sessionId) {
    filters.push("sessionId = ?");
    args.push(sessionId);
  }
  if (agentId) {
    filters.push("agentId = ?");
    args.push(agentId);
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getDb();
  const useSummary = opts.summary ?? false;
  const columns = useSummary ? SUMMARY_COLUMNS.join(", ") : "*";
  const mapper = useSummary ? rowToSummary : rowToEntry;

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM logs ${where}`)
    .get(...args) as { count: number };

  const rows = db
    .prepare(
      `SELECT ${columns} FROM logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];

  return {
    entries: rows.map(mapper),
    total: totalRow.count,
  };
};

export const getLogDetail = (id: string): LogEntry | null => {
  const row = getDb()
    .prepare(`SELECT * FROM logs WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToEntry(row) : null;
};

export const clearLogs = (): void => {
  getDb().prepare(`DELETE FROM logs`).run();
};
