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

export const formatCost = (n: number): string => {
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};

export const formatTokens = (n: number): string => {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n > 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
};
