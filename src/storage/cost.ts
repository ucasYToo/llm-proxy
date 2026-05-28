import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";

const DEFAULT_MAX_RECORDS = 50_000;

/* ── Types ── */

export interface CostRecord {
  id: string;
  logId: string | null;
  timestamp: string;
  sessionId: string | null;
  targetId: string;
  targetName: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  firstChunkMs: number | null;
  status: string;
}

export interface CostQueryOptions {
  limit?: number;
  offset?: number;
  sessionId?: string;
  targetId?: string;
  since?: string;
  until?: string;
}

/* ── Aggregation Types ── */

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

export interface TimeRangeCostPoint {
  period: string;
  totalCostUsd: number;
  totalTokens: number;
  requestCount: number;
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

export interface BudgetStatus {
  dailyUsed: number;
  dailyLimit?: number;
  dailyPct: number;
  monthlyUsed: number;
  monthlyLimit?: number;
  monthlyPct: number;
  alertLevel: "ok" | "warning" | "exceeded";
}

export interface TokenTimeSeriesPoint {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/* ── Row Mapping ── */

const rowToRecord = (row: Record<string, unknown>): CostRecord => ({
  id: row.id as string,
  logId: (row.logId as string | null) ?? null,
  timestamp: row.timestamp as string,
  sessionId: (row.sessionId as string | null) ?? null,
  targetId: row.targetId as string,
  targetName: row.targetName as string,
  model: (row.model as string | null) ?? null,
  inputTokens: (row.inputTokens as number) ?? 0,
  outputTokens: (row.outputTokens as number) ?? 0,
  totalTokens: (row.totalTokens as number) ?? 0,
  cacheReadTokens: (row.cacheReadTokens as number) ?? 0,
  cacheCreationTokens: (row.cacheCreationTokens as number) ?? 0,
  costUsd: (row.costUsd as number) ?? 0,
  durationMs: (row.durationMs as number) ?? 0,
  firstChunkMs: (row.firstChunkMs as number | null) ?? null,
  status: (row.status as string) ?? "completed",
});

/* ── CRUD ── */

const trimCostRecords = (): void => {
  const db = getDb();
  const { count } = db
    .prepare(`SELECT COUNT(*) AS count FROM cost_records`)
    .get() as { count: number };
  const threshold = Math.ceil(DEFAULT_MAX_RECORDS * 1.1);
  if (count <= threshold) return;
  db.prepare(
    `DELETE FROM cost_records WHERE id NOT IN (
      SELECT id FROM cost_records ORDER BY timestamp DESC LIMIT ?
    )`,
  ).run(DEFAULT_MAX_RECORDS);
};

export const insertCostRecord = (record: CostRecord): void => {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO cost_records
       (id, logId, timestamp, sessionId, targetId, targetName, model,
        inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheCreationTokens,
        costUsd, durationMs, firstChunkMs, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.logId,
      record.timestamp,
      record.sessionId,
      record.targetId,
      record.targetName,
      record.model,
      record.inputTokens,
      record.outputTokens,
      record.totalTokens,
      record.cacheReadTokens,
      record.cacheCreationTokens,
      record.costUsd,
      record.durationMs,
      record.firstChunkMs,
      record.status,
    );
  trimCostRecords();
};

export const createCostRecord = (
  input: Omit<CostRecord, "id">,
): CostRecord => {
  const record: CostRecord = { id: uuidv4(), ...input };
  insertCostRecord(record);
  return record;
};

export const queryCostRecords = (
  opts: CostQueryOptions = {},
): { records: CostRecord[]; total: number } => {
  const { limit = 100, offset = 0, sessionId, targetId, since, until } = opts;
  const filters: string[] = [];
  const args: unknown[] = [];

  if (sessionId) {
    filters.push("sessionId = ?");
    args.push(sessionId);
  }
  if (targetId) {
    filters.push("targetId = ?");
    args.push(targetId);
  }
  if (since) {
    filters.push("timestamp >= ?");
    args.push(since);
  }
  if (until) {
    filters.push("timestamp <= ?");
    args.push(until);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getDb();

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM cost_records ${where}`)
    .get(...args) as { count: number };

  const rows = db
    .prepare(
      `SELECT * FROM cost_records ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset) as Record<string, unknown>[];

  return {
    records: rows.map(rowToRecord),
    total: totalRow.count,
  };
};

export const clearCostRecords = (): void => {
  getDb().prepare(`DELETE FROM cost_records`).run();
};

/* ── Aggregation: By Session ── */

export const aggregateCostBySession = (
  sessionId: string,
): SessionCostSummary | null => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        sessionId,
        SUM(costUsd) AS totalCostUsd,
        SUM(inputTokens) AS totalInputTokens,
        SUM(outputTokens) AS totalOutputTokens,
        SUM(cacheReadTokens) AS totalCacheReadTokens,
        SUM(cacheCreationTokens) AS totalCacheCreationTokens,
        COUNT(*) AS requestCount,
        AVG(durationMs) AS avgDurationMs,
        AVG(firstChunkMs) AS avgFirstChunkMs
       FROM cost_records WHERE sessionId = ?`,
    )
    .get(sessionId) as Record<string, unknown> | undefined;

  if (!row || (row.requestCount as number) === 0) return null;

  return {
    sessionId,
    totalCostUsd: (row.totalCostUsd as number) ?? 0,
    totalInputTokens: (row.totalInputTokens as number) ?? 0,
    totalOutputTokens: (row.totalOutputTokens as number) ?? 0,
    totalCacheReadTokens: (row.totalCacheReadTokens as number) ?? 0,
    totalCacheCreationTokens: (row.totalCacheCreationTokens as number) ?? 0,
    requestCount: (row.requestCount as number) ?? 0,
    avgDurationMs: (row.avgDurationMs as number) ?? 0,
    avgFirstChunkMs: (row.avgFirstChunkMs as number) ?? 0,
  };
};

/* ── Aggregation: By Time Range ── */

export const aggregateCostByTimeRange = (opts: {
  since: string;
  until?: string;
  granularity: "hour" | "day" | "week";
}): TimeRangeCostPoint[] => {
  const { since, until, granularity } = opts;
  const db = getDb();

  const formatStr =
    granularity === "hour"
      ? "%Y-%m-%dT%H:00"
      : granularity === "week"
        ? "%Y-W%W"
        : "%Y-%m-%d";

  const filters = ["timestamp >= ?"];
  const args: unknown[] = [since];
  if (until) {
    filters.push("timestamp <= ?");
    args.push(until);
  }

  const rows = db
    .prepare(
      `SELECT
        strftime('${formatStr}', timestamp) AS period,
        SUM(costUsd) AS totalCostUsd,
        SUM(totalTokens) AS totalTokens,
        COUNT(*) AS requestCount
       FROM cost_records
       WHERE ${filters.join(" AND ")}
       GROUP BY period ORDER BY period`,
    )
    .all(...args) as Record<string, unknown>[];

  return rows.map((row) => ({
    period: (row.period as string) ?? "",
    totalCostUsd: (row.totalCostUsd as number) ?? 0,
    totalTokens: (row.totalTokens as number) ?? 0,
    requestCount: (row.requestCount as number) ?? 0,
  }));
};

/* ── Aggregation: By Target ── */

export const aggregateCostByTarget = (): TargetCostSummary[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        targetId, targetName,
        SUM(costUsd) AS totalCostUsd,
        SUM(totalTokens) AS totalTokens,
        COUNT(*) AS requestCount
       FROM cost_records GROUP BY targetId ORDER BY totalCostUsd DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    targetId: (row.targetId as string) ?? "",
    targetName: (row.targetName as string) ?? "",
    totalCostUsd: (row.totalCostUsd as number) ?? 0,
    totalTokens: (row.totalTokens as number) ?? 0,
    requestCount: (row.requestCount as number) ?? 0,
  }));
};

/* ── Aggregation: By Model ── */

export const aggregateCostByModel = (): ModelCostSummary[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        COALESCE(model, 'unknown') AS model,
        SUM(costUsd) AS totalCostUsd,
        SUM(totalTokens) AS totalTokens,
        COUNT(*) AS requestCount
       FROM cost_records GROUP BY model ORDER BY totalCostUsd DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    model: (row.model as string) ?? "unknown",
    totalCostUsd: (row.totalCostUsd as number) ?? 0,
    totalTokens: (row.totalTokens as number) ?? 0,
    requestCount: (row.requestCount as number) ?? 0,
  }));
};

/* ── Budget Status ── */

export const getBudgetStatus = (
  dailyLimit?: number,
  monthlyLimit?: number,
  alertThresholdPct = 80,
): BudgetStatus => {
  const db = getDb();
  const now = new Date();

  // Today's start (UTC)
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).toISOString();

  // Month's start (UTC)
  const monthStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  ).toISOString();

  const dailyRow = db
    .prepare(
      `SELECT SUM(costUsd) AS used FROM cost_records WHERE timestamp >= ?`,
    )
    .get(todayStart) as { used: number | null };

  const monthlyRow = db
    .prepare(
      `SELECT SUM(costUsd) AS used FROM cost_records WHERE timestamp >= ?`,
    )
    .get(monthStart) as { used: number | null };

  const dailyUsed = dailyRow?.used ?? 0;
  const monthlyUsed = monthlyRow?.used ?? 0;

  const dailyPct = dailyLimit ? (dailyUsed / dailyLimit) * 100 : 0;
  const monthlyPct = monthlyLimit ? (monthlyUsed / monthlyLimit) * 100 : 0;

  let alertLevel: BudgetStatus["alertLevel"] = "ok";
  const maxPct = Math.max(dailyPct, monthlyPct);
  if (maxPct >= 100) {
    alertLevel = "exceeded";
  } else if (maxPct >= alertThresholdPct) {
    alertLevel = "warning";
  }

  return {
    dailyUsed,
    dailyLimit,
    dailyPct,
    monthlyUsed,
    monthlyLimit,
    monthlyPct,
    alertLevel,
  };
};

/* ── Token Time Series ── */

export const getTokenTimeSeries = (
  sessionId: string,
): TokenTimeSeriesPoint[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        strftime('%Y-%m-%dT%H:%M', timestamp) AS timestamp,
        SUM(inputTokens) AS inputTokens,
        SUM(outputTokens) AS outputTokens,
        SUM(cacheReadTokens) AS cacheReadTokens,
        SUM(cacheCreationTokens) AS cacheCreationTokens,
        SUM(costUsd) AS costUsd
       FROM cost_records WHERE sessionId = ?
       GROUP BY timestamp ORDER BY timestamp`,
    )
    .all(sessionId) as Record<string, unknown>[];

  return rows.map((row) => ({
    timestamp: (row.timestamp as string) ?? "",
    inputTokens: (row.inputTokens as number) ?? 0,
    outputTokens: (row.outputTokens as number) ?? 0,
    cacheReadTokens: (row.cacheReadTokens as number) ?? 0,
    cacheCreationTokens: (row.cacheCreationTokens as number) ?? 0,
    costUsd: (row.costUsd as number) ?? 0,
  }));
};

/* ── Session Cost Lookup (for enriching SessionSummary) ── */

export const getSessionCostQuick = (
  sessionId: string,
): { totalCostUsd: number; totalTokens: number; requestCount: number } => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        SUM(costUsd) AS totalCostUsd,
        SUM(totalTokens) AS totalTokens,
        COUNT(*) AS requestCount
       FROM cost_records WHERE sessionId = ?`,
    )
    .get(sessionId) as Record<string, unknown>;

  return {
    totalCostUsd: (row.totalCostUsd as number) ?? 0,
    totalTokens: (row.totalTokens as number) ?? 0,
    requestCount: (row.requestCount as number) ?? 0,
  };
};
