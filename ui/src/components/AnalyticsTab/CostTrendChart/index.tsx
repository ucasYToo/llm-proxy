import BarChart from "../../shared/BarChart";
import type { TimeRangeCostPoint } from "../types";
import styles from "./index.module.css";

interface Props {
  trend: TimeRangeCostPoint[];
}

const formatDate = (period: string): string => {
  // period is ISO date like "2026-05-22" or "2026-05-22T00:00:00Z"
  const d = new Date(period);
  if (isNaN(d.getTime())) return period;
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const CostTrendChart = ({ trend }: Props) => {
  const chartData = trend.map((point) => ({
    label: formatDate(point.period),
    value: point.totalCostUsd,
  }));

  return (
    <div className={styles.card}>
      <h3 className={styles.title}>费用趋势（30天）</h3>
      <div className={styles.chartWrap}>
        <BarChart
          data={chartData}
          height={180}
          showLabels={trend.length <= 15}
          showValues={false}
          formatValue={(v) => `$${v.toFixed(2)}`}
          emptyText="暂无趋势数据"
        />
      </div>
    </div>
  );
};

export default CostTrendChart;
