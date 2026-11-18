import type { LogEntry } from "../interfaces";
import { readConfig } from "../config/store";
import { resolvePricing, calculateCost } from "./pricing";
import { createCostRecord, getBudgetStatus } from "../storage/cost";
import { broadcast } from "../server/sse";
import { getDb } from "../storage/db";
import { notify } from "../notify/macos";

/** Persist alongside the log; send budget notifications only after the transaction commits. */
export function persistLogCost(entry: LogEntry): (() => void) | undefined {
  const usage = entry.tokenUsage;
  if (
    entry.status !== "completed" ||
    !usage ||
    !(
      usage.inputTokens ||
      usage.outputTokens ||
      usage.totalTokens ||
      usage.cacheReadTokens ||
      usage.cacheCreationTokens
    )
  )
    return;
  // Resolve model name from target config
  const config = readConfig();
  const target = config.targets.find((t) => t.id === entry.targetId);
  const model = entry.captureModel ?? target?.anthropicModel ?? null;

  // Calculate cost
  const pricing = resolvePricing(model ?? undefined, target?.pricing);
  const costUsd = calculateCost(usage, pricing);

  // Insert cost record
  const previous = getDb()
    .prepare("SELECT costUsd FROM cost_records WHERE logId=?")
    .get(entry.id) as { costUsd: number } | undefined;
  const record = createCostRecord({
    logId: entry.id,
    timestamp: entry.timestamp,
    sessionId: entry.sessionId ?? null,
    targetId: entry.targetId,
    targetName: entry.targetName,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
    costUsd,
    durationMs: entry.durationMs ?? -1,
    firstChunkMs: entry.firstChunkMs ?? null,
    status: entry.status ?? "completed",
  });

  return () => {
    if (previous?.costUsd === costUsd) return;
    broadcast("cost", { record, costUsd });

    // Check budget alerts
    const budgetConfig = config.budget;
    if (budgetConfig?.dailyLimitUsd || budgetConfig?.monthlyLimitUsd) {
      const budgetStatus = getBudgetStatus(
        budgetConfig.dailyLimitUsd,
        budgetConfig.monthlyLimitUsd,
        budgetConfig.alertThresholdPct ?? 80,
      );

      if (budgetStatus.alertLevel === "warning") {
        broadcast("budget-alert", budgetStatus);
      } else if (budgetStatus.alertLevel === "exceeded") {
        broadcast("budget-alert", budgetStatus);
        const pct = Math.max(budgetStatus.dailyPct, budgetStatus.monthlyPct);
        notify(
          "Budget Alert",
          `Budget ${pct.toFixed(0)}% used ($${budgetStatus.dailyUsed.toFixed(2)} today)`,
          "Basso",
        );
      }
    }
  };
}
