import type { BudgetStatus } from "../types";
import styles from "./index.module.css";

interface Props {
  budget: BudgetStatus;
}

const getBarColor = (level: "ok" | "warning" | "exceeded"): string => {
  switch (level) {
    case "exceeded":
      return "#EF4444";
    case "warning":
      return "#F59E0B";
    case "ok":
      return "var(--accent)";
  }
};

const BudgetCard = ({ budget }: Props) => {
  const hasDailyLimit = budget.dailyLimit != null && budget.dailyLimit > 0;
  const hasMonthlyLimit = budget.monthlyLimit != null && budget.monthlyLimit > 0;
  const hasBudget = hasDailyLimit || hasMonthlyLimit;

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>预算概览</h3>

      {!hasBudget ? (
        <div className={styles.noBudget}>
          <span className={styles.noBudgetIcon}>○</span>
          未设置预算
          <span className={styles.noBudgetHint}>配置预算后可在此查看用量</span>
        </div>
      ) : (
        <div className={styles.bars}>
          {hasDailyLimit && (
            <div className={styles.row}>
              <div className={styles.rowHeader}>
                <span className={styles.rowLabel}>今日</span>
                <span className={styles.rowAmount}>
                  ${budget.dailyUsed.toFixed(2)} / ${budget.dailyLimit!.toFixed(2)}
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{
                    width: `${Math.min(budget.dailyPct, 100)}%`,
                    background: getBarColor(budget.alertLevel),
                  }}
                />
              </div>
              <span className={styles.pct}>{budget.dailyPct.toFixed(0)}%</span>
            </div>
          )}

          {hasMonthlyLimit && (
            <div className={styles.row}>
              <div className={styles.rowHeader}>
                <span className={styles.rowLabel}>本月</span>
                <span className={styles.rowAmount}>
                  ${budget.monthlyUsed.toFixed(2)} / ${budget.monthlyLimit!.toFixed(2)}
                </span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{
                    width: `${Math.min(budget.monthlyPct, 100)}%`,
                    background: getBarColor(budget.alertLevel),
                  }}
                />
              </div>
              <span className={styles.pct}>{budget.monthlyPct.toFixed(0)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BudgetCard;
