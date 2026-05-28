import type { ModelCostSummary } from "../types";
import { formatCost } from "../types";
import styles from "./index.module.css";

interface Props {
  models: ModelCostSummary[];
}

// Color palette for model bars
const PALETTE = [
  "var(--accent)",
  "#6366F1", // indigo
  "#10B981", // emerald
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#06B6D4", // cyan
  "#EC4899", // pink
];

const ModelBreakdown = ({ models }: Props) => {
  if (models.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>模型费用分布</h3>
        <div className={styles.empty}>暂无模型数据</div>
      </div>
    );
  }

  const sorted = [...models].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  const maxCost = sorted[0]?.totalCostUsd ?? 0;

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>模型费用分布</h3>
      <div className={styles.list}>
        {sorted.map((model, i) => {
          const pct = maxCost > 0 ? (model.totalCostUsd / maxCost) * 100 : 0;
          const color = PALETTE[i % PALETTE.length];

          return (
            <div key={model.model} className={styles.row}>
              <div className={styles.rowHeader}>
                <span className={styles.modelName}>{model.model}</span>
                <span className={styles.cost}>{formatCost(model.totalCostUsd)}</span>
              </div>
              <div className={styles.track}>
                <div
                  className={styles.fill}
                  style={{
                    width: `${Math.max(pct, 1)}%`,
                    background: color,
                  }}
                />
              </div>
              <div className={styles.meta}>
                <span>{model.requestCount} 请求</span>
                <span>{(model.totalTokens / 1000).toFixed(1)}K tokens</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ModelBreakdown;
