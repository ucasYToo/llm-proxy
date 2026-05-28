import { getDb } from "../storage/db";

/**
 * Session health metrics — individual indicators, no weighted composite.
 *
 * Returns null for sessions with < 5 requests (insufficient data).
 */
export interface HealthMetrics {
  /** 成功率 (%)：completed / total × 100 */
  successRate: number;
  /** 缓存命中率 (%)：cacheReadTokens / (cacheReadTokens + inputTokens) × 100，无数据时为 null */
  cacheEfficiency: number | null;
  /** 平均首包延迟 (ms)，无数据时为 null */
  avgFirstChunkMs: number | null;
  /** 错误率 (%)：errors / total × 100 */
  errorRate: number;
  /** 工具调用成功率 (%)：(total - errors) / total × 100，无数据时为 null */
  toolSuccessRate: number | null;
  /** 请求总数（供前端参考） */
  requestCount: number;
}

export const computeHealthScore = (sessionId: string): HealthMetrics | null => {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(inputTokens) AS inputTokens,
        SUM(cacheReadTokens) AS cacheReadTokens,
        AVG(firstChunkMs) AS avgFirstChunkMs
       FROM cost_records WHERE sessionId = ?`,
    )
    .get(sessionId) as Record<string, unknown>;

  const total = (row.total as number) ?? 0;
  if (total < 5) return null;

  const completed = (row.completed as number) ?? 0;
  const errors = (row.errors as number) ?? 0;
  const inputTokens = (row.inputTokens as number) ?? 0;
  const cacheReadTokens = (row.cacheReadTokens as number) ?? 0;
  const avgFirstChunkMs = (row.avgFirstChunkMs as number) ?? 0;

  const successRate = total > 0 ? (completed / total) * 100 : 100;
  const errorRate = total > 0 ? (errors / total) * 100 : 0;

  const totalInput = cacheReadTokens + inputTokens;
  const cacheEfficiency = totalInput > 0 ? (cacheReadTokens / totalInput) * 100 : null;

  // Tool success rate: PostToolUse (success) vs PostToolUseFailure (failure)
  const toolSuccessCount = db
    .prepare(`SELECT COUNT(*) AS c FROM hooks WHERE sessionId = ? AND eventName = 'PostToolUse'`)
    .get(sessionId) as { c: number };
  const toolFailCount = db
    .prepare(`SELECT COUNT(*) AS c FROM hooks WHERE sessionId = ? AND eventName = 'PostToolUseFailure'`)
    .get(sessionId) as { c: number };

  const toolTotal = (toolSuccessCount.c ?? 0) + (toolFailCount.c ?? 0);
  const toolSuccessRate = toolTotal > 0
    ? (toolSuccessCount.c / toolTotal) * 100
    : null;

  return {
    successRate: round(successRate),
    cacheEfficiency: cacheEfficiency !== null ? round(cacheEfficiency) : null,
    avgFirstChunkMs: avgFirstChunkMs > 0 ? Math.round(avgFirstChunkMs) : null,
    errorRate: round(errorRate),
    toolSuccessRate: toolSuccessRate !== null ? round(toolSuccessRate) : null,
    requestCount: total,
  };
};

const round = (n: number): number => Math.round(n * 10) / 10;
