import { useState } from "react";

export interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  maxValue?: number;
  height?: number;
  barWidth?: number;
  showLabels?: boolean;
  showValues?: boolean;
  formatValue?: (v: number) => string;
  emptyText?: string;
}

export default function BarChart({
  data,
  maxValue,
  height = 160,
  barWidth,
  showLabels = true,
  showValues = false,
  formatValue = (v) => String(v),
  emptyText = "No data",
}: BarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted, #888)",
          fontFamily: "Outfit, sans-serif",
          fontSize: 14,
        }}
      >
        {emptyText}
      </div>
    );
  }

  const computedMax = maxValue ?? Math.max(...data.map((d) => d.value), 0);
  // Avoid division by zero when all values are 0
  const safeMax = computedMax > 0 ? computedMax : 1;

  return (
    <div>
      {/* Bar area */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          height,
          gap: 8,
        }}
      >
        {data.map((item, i) => {
          const pct = Math.max((item.value / safeMax) * 100, 0);
          const isHovered = hoveredIdx === i;

          return (
            <div
              key={i}
              style={{
                flex: barWidth ? "0 0 auto" : "1 1 0",
                width: barWidth,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                height: "100%",
                minWidth: 0,
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              {showValues && (
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "var(--text-muted, #888)",
                    marginBottom: 4,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatValue(item.value)}
                </div>
              )}
              <div
                style={{
                  width: "100%",
                  height: `${pct}%`,
                  background: item.color ?? "var(--accent, #D97757)",
                  borderRadius: "3px 3px 0 0",
                  opacity: isHovered ? 0.75 : 1,
                  transition: "opacity 0.15s ease",
                  minHeight: item.value > 0 ? 2 : 0,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Labels row */}
      {showLabels && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
          }}
        >
          {data.map((item, i) => (
            <div
              key={i}
              style={{
                flex: barWidth ? "0 0 auto" : "1 1 0",
                width: barWidth,
                textAlign: "center",
                fontSize: 11,
                fontFamily: "Outfit, sans-serif",
                color: "var(--text-muted, #888)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
