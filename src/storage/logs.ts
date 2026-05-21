import type { LogEntry, TokenUsage } from "../interfaces";
import { readConfig } from "../config/store";
import { jsonDiff } from "../core/diff";
import { getDb } from "./db";

const DEFAULT_MAX_ENTRIES = 400;

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
    `DELETE FROM logs WHERE id NOT IN (
      SELECT id FROM logs ORDER BY timestamp DESC LIMIT ?
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

export const createLog = (entry: LogEntry): void => {
  const filtered = applyLogCollectionFilter(entry);
  const cols = entryToColumns(filtered);
  const columnNames = ALL_COLUMNS.filter((c) => c in cols);
  const placeholders = columnNames.map(() => "?").join(", ");
  const values = columnNames.map((c) => cols[c]);

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO logs (${columnNames.join(", ")}) VALUES (${placeholders})`,
    )
    .run(...values);

  trimLogs();
  notifyLogChange(filtered, "create");
};

export const updateLog = (id: string, updates: Partial<LogEntry>): void => {
  const db = getDb();
  const existingRow = db.prepare(`SELECT * FROM logs WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existingRow) return;

  const existing = rowToEntry(existingRow);
  const merged: LogEntry = { ...existing, ...updates };
  const filtered = applyLogCollectionFilter(merged, true);
  const filteredCols = entryToColumns(filtered);

  const updateCols = ALL_COLUMNS.filter((c) => c in filteredCols && c !== "id");
  if (updateCols.length === 0) return;

  const setClause = updateCols.map((c) => `${c} = ?`).join(", ");
  const values = updateCols.map((c) => filteredCols[c]);

  db.prepare(`UPDATE logs SET ${setClause} WHERE id = ?`).run(...values, id);
  notifyLogChange(filtered, "update");
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
}

export const queryLogs = (
  opts: QueryLogsOptions = {},
): {
  entries: LogEntry[];
  total: number;
} => {
  const { limit = 50, offset = 0, targetId, sessionId } = opts;
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
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getDb();

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM logs ${where}`)
    .get(...args) as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM logs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];

  return {
    entries: rows.map(rowToEntry),
    total: totalRow.count,
  };
};

export const clearLogs = (): void => {
  getDb().prepare(`DELETE FROM logs`).run();
};
