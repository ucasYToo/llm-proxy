import { useCallback, useEffect, useState } from "react";
import type { SessionAnalyticsData } from "../../lib/api";
import { fetchSessionAnalytics } from "../../lib/api";
import HealthGauge from "./HealthGauge";
import ToolHeatmap from "./ToolHeatmap";
import TokenTimeline from "./TokenTimeline";
import SubagentWaterfall from "./SubagentWaterfall";
import styles from "./index.module.css";

interface Props {
  sessionId: string;
  onClose: () => void;
}

export default function SessionAnalyticsPanel({ sessionId, onClose }: Props) {
  const [data, setData] = useState<SessionAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSessionAnalytics(sessionId);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>会话分析</span>
          <span className={styles.sessionId}>{sessionId}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ← 返回
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>加载分析数据…</span>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className={styles.error}>
          加载失败：{error}
          <button
            className="btnGhost btnSm"
            onClick={load}
            style={{ marginLeft: 12 }}
          >
            重试
          </button>
        </div>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {/* Overview: Cost + Health side by side */}
          <div className={styles.overviewRow}>
            <div className={styles.overviewCost}>
              <div className={styles.cardTitle}>费用概览</div>
              {data.costSummary ? (
                <CostSummaryView summary={data.costSummary} />
              ) : (
                <div
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 13,
                    fontStyle: "italic",
                    padding: "8px 0",
                  }}
                >
                  暂无费用数据
                </div>
              )}
            </div>
            <div className={styles.overviewHealth}>
              <div
                className={styles.cardTitle}
                style={{ alignSelf: "flex-start" }}
              >
                健康度
              </div>
              <HealthGauge metrics={data.health} />
            </div>
          </div>

          {/* Tool Heatmap */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>工具调用</div>
            <ToolHeatmap data={data.toolUsage} />
          </div>

          {/* Token Timeline */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Token 时序</div>
            <TokenTimeline data={data.tokenTimeSeries} />
          </div>

          {/* Subagent Waterfall */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>子代理生命周期</div>
            <SubagentWaterfall data={data.subagents} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Cost Summary Sub-component ── */

function CostSummaryView({
  summary,
}: {
  summary: NonNullable<SessionAnalyticsData["costSummary"]>;
}) {
  const {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    requestCount,
    avgDurationMs,
    avgFirstChunkMs,
    decodeOutputTokens,
    totalDecodeMs,
  } = summary;

  return (
    <>
      <div className={styles.costTotal}>
        ${totalCostUsd.toFixed(4)}
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>请求数</span>
          <span className={styles.statValue}>{requestCount}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Input</span>
          <span className={styles.statValue}>{formatTokens(totalInputTokens)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Output</span>
          <span className={styles.statValue}>{formatTokens(totalOutputTokens)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Cache Read</span>
          <span className={styles.statValue}>{formatTokens(totalCacheReadTokens)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>Cache Write</span>
          <span className={styles.statValue}>{formatTokens(totalCacheCreationTokens)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>平均耗时</span>
          <span className={styles.statValue}>{formatDuration(avgDurationMs)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>首包延迟</span>
          <span className={styles.statValue}>{formatDuration(avgFirstChunkMs)}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statLabel}>平均 TPS</span>
          <span className={styles.statValue}>{formatAvgTps(decodeOutputTokens, totalDecodeMs)}</span>
        </div>
      </div>
    </>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// 会话整体 decode 吞吐：流式请求的输出 token 总和 ÷ decode 时长总和
function formatAvgTps(decodeOutputTokens: number, totalDecodeMs: number): string {
  if (!decodeOutputTokens || totalDecodeMs <= 0) return "—";
  const tps = (decodeOutputTokens / totalDecodeMs) * 1000;
  return tps >= 100 ? `${Math.round(tps)}` : tps.toFixed(1);
}
