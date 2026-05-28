import { useMemo } from "react";
import type { TokenTimeSeriesPoint } from "../../../lib/api";

interface Props {
  data: TokenTimeSeriesPoint[];
}

const LAYERS = [
  { key: "inputTokens", color: "#5B8DEF", label: "Input" },
  { key: "outputTokens", color: "var(--accent, #D97757)", label: "Output" },
  { key: "cacheReadTokens", color: "#22C55E", label: "Cache Read" },
  { key: "cacheCreationTokens", color: "#A855F7", label: "Cache Write" },
] as const;

type LayerKey = (typeof LAYERS)[number]["key"];

const CHART_HEIGHT = 200;
const PADDING = { top: 16, right: 16, bottom: 32, left: 56 };

export default function TokenTimeline({ data }: Props) {
  const computed = useMemo(() => {
    if (!data || data.length === 0) return null;

    const timestamps = data.map((d) => new Date(d.timestamp).getTime());
    const minTs = timestamps[0];
    const maxTs = timestamps[timestamps.length - 1];
    const timeRange = maxTs - minTs || 1;

    // Compute cumulative sums
    let cumInput = 0;
    let cumOutput = 0;
    let cumCacheRead = 0;
    let cumCacheWrite = 0;
    const cumulative = data.map((point) => {
      cumInput += point.inputTokens;
      cumOutput += point.outputTokens;
      cumCacheRead += point.cacheReadTokens;
      cumCacheWrite += point.cacheCreationTokens;
      return { inputTokens: cumInput, outputTokens: cumOutput, cacheReadTokens: cumCacheRead, cacheCreationTokens: cumCacheWrite };
    });

    const maxY = Math.max(
      ...cumulative.map((c) => c.inputTokens + c.outputTokens + c.cacheReadTokens + c.cacheCreationTokens),
      1,
    );

    return { cumulative, timestamps, minTs, maxTs, timeRange, maxY };
  }, [data]);

  if (!computed) {
    return (
      <div
        style={{
          height: CHART_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted, #a09a93)",
          fontFamily: "Outfit, sans-serif",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        暂无数据
      </div>
    );
  }

  const { cumulative, timestamps, minTs, maxTs, timeRange, maxY } = computed;
  const n = timestamps.length;

  const svgWidth = 600;
  const svgHeight = CHART_HEIGHT;
  const chartW = svgWidth - PADDING.left - PADDING.right;
  const chartH = svgHeight - PADDING.top - PADDING.bottom;

  // X scale: real time
  const xScale = (ts: number) => PADDING.left + ((ts - minTs) / timeRange) * chartW;
  const yScale = (v: number) => PADDING.top + chartH - (v / maxY) * chartH;

  // Build polygon points for each layer (bottom-up stacking, cumulative)
  const polygons = LAYERS.map((layer, layerIdx) => {
    const topPoints: string[] = [];
    const bottomPoints: string[] = [];

    for (let i = 0; i < n; i++) {
      const x = xScale(timestamps[i]);
      const point = cumulative[i];

      let top = 0;
      for (let j = 0; j <= layerIdx; j++) {
        top += point[LAYERS[j].key];
      }

      let bottom = 0;
      for (let j = 0; j < layerIdx; j++) {
        bottom += point[LAYERS[j].key];
      }

      topPoints.push(`${x},${yScale(top)}`);
      bottomPoints.push(`${x},${yScale(bottom)}`);
    }

    const points = [...topPoints, ...bottomPoints.reverse()].join(" ");
    return { ...layer, points };
  });

  const firstTs = formatAxisTime(timestamps[0]);
  const lastTs = formatAxisTime(timestamps[n - 1]);
  const maxLabel = formatTokenCount(maxY);

  return (
    <div>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width="100%"
        height={CHART_HEIGHT}
        style={{ display: "block", overflow: "visible" }}
        preserveAspectRatio="none"
      >
        {/* Y-axis gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = PADDING.top + chartH * (1 - pct);
          return (
            <line
              key={pct}
              x1={PADDING.left}
              y1={y}
              x2={PADDING.left + chartW}
              y2={y}
              stroke="var(--border-light, #f0ede8)"
              strokeWidth={1}
            />
          );
        })}

        {/* Stacked areas */}
        {polygons.map((poly) => (
          <polygon
            key={poly.key}
            points={poly.points}
            fill={poly.color}
            fillOpacity={0.6}
            stroke={poly.color}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ))}

        {/* Y-axis labels */}
        <text
          x={PADDING.left - 8}
          y={PADDING.top}
          textAnchor="end"
          dominantBaseline="central"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fill: "var(--text-muted, #a09a93)",
          }}
        >
          {maxLabel}
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + chartH}
          textAnchor="end"
          dominantBaseline="central"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fill: "var(--text-muted, #a09a93)",
          }}
        >
          0
        </text>

        {/* X-axis labels */}
        <text
          x={PADDING.left}
          y={svgHeight - 8}
          textAnchor="start"
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: 10,
            fill: "var(--text-muted, #a09a93)",
          }}
        >
          {firstTs}
        </text>
        {n > 1 && (
          <text
            x={PADDING.left + chartW}
            y={svgHeight - 8}
            textAnchor="end"
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 10,
              fill: "var(--text-muted, #a09a93)",
            }}
          >
            {lastTs}
          </text>
        )}
      </svg>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 12,
          flexWrap: "wrap",
        }}
      >
        {LAYERS.map((layer) => (
          <span
            key={layer.key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 11,
              color: "var(--text-secondary, #6b6560)",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: layer.color,
                opacity: 0.7,
                flexShrink: 0,
              }}
            />
            {layer.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatAxisTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
