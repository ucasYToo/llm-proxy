import type { LogEntry } from "../interfaces";
import type { LogChangeKind } from "../storage/logs";
import { onLogChange } from "../storage/logs";
import { readConfig } from "../config/store";
import { resolvePricing, calculateCost } from "./pricing";
import { createCostRecord, getBudgetStatus } from "../storage/cost";
import { broadcast } from "../server/sse";
import { notify } from "../notify/macos";

/**
 * Initialize write-time cost capture.
 * Registers an onLogChange listener that creates cost_records
 * when a log entry reaches "completed" status with token usage data.
 *
 * Should be called once during server startup.
 */
export const initCostCapture = (): void => {
  onLogChange((entry: LogEntry, kind: LogChangeKind) => {
    // Only capture on update (when token data is populated after response)
    if (kind !== "update") return;
    if (entry.status !== "completed") return;
    if (!entry.tokenUsage) return;

    // Skip if no meaningful token data
    const usage = entry.tokenUsage;
    if (
      !usage.inputTokens &&
      !usage.outputTokens &&
      !usage.totalTokens
    ) {
      return;
    }

    try {
      // Resolve model name from target config
      const config = readConfig();
      const target = config.targets.find((t) => t.id === entry.targetId);
      const model = target?.anthropicModel ?? null;

      // Calculate cost
      const pricing = resolvePricing(model ?? undefined, target?.pricing);
      const costUsd = calculateCost(usage, pricing);

      // Insert cost record
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
        durationMs: entry.durationMs,
        firstChunkMs: entry.firstChunkMs ?? null,
        status: entry.status ?? "completed",
      });

      // Broadcast cost event via SSE for real-time UI updates
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
    } catch {
      // Silently ignore errors in cost capture to avoid disrupting proxy flow
    }
  });
};
