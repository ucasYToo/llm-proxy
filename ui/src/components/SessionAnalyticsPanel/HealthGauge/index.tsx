import type { HealthMetrics } from "../../../lib/api";

interface Props {
  metrics: HealthMetrics | null;
}

const metricColor = (value: number, invert = false): string => {
  const v = invert ? 100 - value : value;
  if (v >= 80) return "#22C55E";
  if (v >= 50) return "#F59E0B";
  return "#EF4444";
};

const formatPct = (v: number): string => `${v.toFixed(1)}%`;

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

export default function HealthGauge({ metrics }: Props) {
  if (!metrics || typeof metrics.successRate !== "number") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 80,
          color: "var(--text-muted, #a09a93)",
          fontSize: 13,
        }}
      >
        请求数不足（需 ≥ 5 次）
      </div>
    );
  }

  const items: { label: string; value: string; color: string }[] = [
    {
      label: "成功率",
      value: formatPct(metrics.successRate),
      color: metricColor(metrics.successRate),
    },
    {
      label: "错误率",
      value: formatPct(metrics.errorRate),
      color: metricColor(metrics.errorRate, true),
    },
    {
      label: "缓存命中率",
      value: metrics.cacheEfficiency !== null ? formatPct(metrics.cacheEfficiency) : "—",
      color: metrics.cacheEfficiency !== null ? metricColor(metrics.cacheEfficiency) : "var(--text-muted, #a09a93)",
    },
    {
      label: "首包延迟",
      value: metrics.avgFirstChunkMs !== null ? formatMs(metrics.avgFirstChunkMs) : "—",
      color: metrics.avgFirstChunkMs !== null
        ? metrics.avgFirstChunkMs <= 2000
          ? "#22C55E"
          : metrics.avgFirstChunkMs <= 5000
            ? "#F59E0B"
            : "#EF4444"
        : "var(--text-muted, #a09a93)",
    },
    {
      label: "工具成功率",
      value: metrics.toolSuccessRate !== null ? formatPct(metrics.toolSuccessRate) : "—",
      color: metrics.toolSuccessRate !== null ? metricColor(metrics.toolSuccessRate) : "var(--text-muted, #a09a93)",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px 20px",
        padding: "4px 0",
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 11,
              color: "var(--text-muted, #a09a93)",
            }}
          >
            {item.label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 18,
              fontWeight: 600,
              color: item.color,
            }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
