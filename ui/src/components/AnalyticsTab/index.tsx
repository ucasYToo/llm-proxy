import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCostSummary } from "../../lib/api";
import type { CostSummaryData } from "./types";
import BudgetCard from "./BudgetCard";
import CostTrendChart from "./CostTrendChart";
import ModelBreakdown from "./ModelBreakdown";
import TargetCostTable from "./TargetCostTable";
import TopSessions from "./TopSessions";
import styles from "./index.module.css";

const REFRESH_INTERVAL = 30_000;

const AnalyticsTab = () => {
  const [data, setData] = useState<CostSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [budgetAlert, setBudgetAlert] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchCostSummary();
      setData(res);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [load]);

  // SSE listener for real-time cost and budget updates
  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;

    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { type?: string; data?: unknown };
        if (parsed.type === "cost") {
          // Refresh data when a new cost record is created
          void load();
        } else if (parsed.type === "budget-alert") {
          const alert = parsed.data as { alertLevel?: string; dailyPct?: number; monthlyPct?: number };
          const pct = Math.max(alert.dailyPct ?? 0, alert.monthlyPct ?? 0);
          if (alert.alertLevel === "exceeded") {
            setBudgetAlert(`预算已超出 ${pct.toFixed(0)}%`);
          } else if (alert.alertLevel === "warning") {
            setBudgetAlert(`预算预警：已使用 ${pct.toFixed(0)}%`);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [load]);

  if (loading && !data) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>加载费用数据…</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <p>加载失败：{error}</p>
          <button className="btnGhost btnSm" onClick={() => void load()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>暂无费用数据。开始使用代理后，费用统计将显示在这里。</div>
      </div>
    );
  }

  const hasData =
    data.totalCost > 0 ||
    data.byTarget.length > 0 ||
    data.byModel.length > 0 ||
    data.recentTrend.length > 0;

  if (!hasData) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>暂无费用数据。开始使用代理后，费用统计将显示在这里。</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {budgetAlert && (
        <div className={styles.alertBanner}>
          <span>⚠️ {budgetAlert}</span>
          <button
            className="btnGhost btnSm"
            onClick={() => setBudgetAlert(null)}
          >
            关闭
          </button>
        </div>
      )}

      <div className={styles.summaryBar}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>总费用</span>
          <span className={styles.summaryValue}>${data.totalCost.toFixed(2)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>今日费用</span>
          <span className={styles.summaryValue}>${data.todayCost.toFixed(2)}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>目标数</span>
          <span className={styles.summaryValue}>{data.byTarget.length}</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryLabel}>模型数</span>
          <span className={styles.summaryValue}>{data.byModel.length}</span>
        </div>
      </div>

      <div className={styles.grid}>
        <BudgetCard budget={data.budget} />
        <CostTrendChart trend={data.recentTrend} />
        <ModelBreakdown models={data.byModel} />
        <TargetCostTable targets={data.byTarget} />
        <TopSessions />
      </div>
    </div>
  );
};

export default AnalyticsTab;
