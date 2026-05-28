import type { TargetCostSummary } from "../types";
import { formatCost, formatTokens } from "../types";
import styles from "./index.module.css";

interface Props {
  targets: TargetCostSummary[];
}

const TargetCostTable = ({ targets }: Props) => {
  if (targets.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.title}>目标费用统计</h3>
        <div className={styles.empty}>暂无目标数据</div>
      </div>
    );
  }

  const sorted = [...targets].sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>目标费用统计</h3>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>目标</th>
              <th className={`${styles.th} ${styles.num}`}>请求</th>
              <th className={`${styles.th} ${styles.num}`}>Tokens</th>
              <th className={`${styles.th} ${styles.num}`}>费用</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.targetId} className={styles.row}>
                <td className={styles.td}>{t.targetName}</td>
                <td className={`${styles.td} ${styles.num}`}>{t.requestCount}</td>
                <td className={`${styles.td} ${styles.num}`}>{formatTokens(t.totalTokens)}</td>
                <td className={`${styles.td} ${styles.num} ${styles.cost}`}>
                  {formatCost(t.totalCostUsd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TargetCostTable;
