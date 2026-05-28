import { useMemo } from "react";
import type { SubagentRelation } from "../../../lib/api";

interface Props {
  data: SubagentRelation[];
}

const PALETTE = [
  "var(--accent, #D97757)",
  "#5B8DEF",
  "#22C55E",
  "#A855F7",
  "#F59E0B",
  "#EC4899",
  "#14B8A6",
];

export default function SubagentWaterfall({ data }: Props) {
  const computed = useMemo(() => {
    if (!data || data.length === 0) return null;

    const starts = data.map((d) => new Date(d.startedAt).getTime());
    const ends = data.map((d) =>
      d.stoppedAt ? new Date(d.stoppedAt).getTime() : Date.now(),
    );

    const sessionStart = Math.min(...starts);
    const sessionEnd = Math.max(...ends);
    const totalDuration = sessionEnd - sessionStart || 1;

    // Assign colors by agentType
    const typeColorMap = new Map<string, string>();
    let colorIdx = 0;
    for (const item of data) {
      if (!typeColorMap.has(item.agentType)) {
        typeColorMap.set(item.agentType, PALETTE[colorIdx % PALETTE.length]);
        colorIdx++;
      }
    }

    const bars = data.map((item, i) => {
      const start = new Date(item.startedAt).getTime();
      const end = item.stoppedAt
        ? new Date(item.stoppedAt).getTime()
        : Date.now();
      const leftPct = ((start - sessionStart) / totalDuration) * 100;
      const widthPct = Math.max(
        ((end - start) / totalDuration) * 100,
        0.5, // minimum visible width
      );
      const color = typeColorMap.get(item.agentType) ?? PALETTE[0];
      const durationLabel = item.durationMs
        ? formatDuration(item.durationMs)
        : "运行中";

      return {
        key: item.agentId || `${item.agentType}-${i}`,
        agentType: item.agentType,
        parentToolName: item.parentToolName,
        leftPct,
        widthPct,
        color,
        durationLabel,
      };
    });

    return { bars, totalDuration };
  }, [data]);

  if (!computed) {
    return (
      <div
        style={{
          padding: "24px 0",
          textAlign: "center",
          color: "var(--text-muted, #a09a93)",
          fontFamily: "Outfit, sans-serif",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        无子代理记录
      </div>
    );
  }

  const { bars } = computed;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {bars.map((bar) => (
        <div
          key={bar.key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minHeight: 28,
          }}
        >
          {/* Label column */}
          <div
            style={{
              width: 140,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text, #1a1a1a)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {bar.agentType}
            </span>
            {bar.parentToolName && (
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: 10,
                  color: "var(--text-muted, #a09a93)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                via {bar.parentToolName}
              </span>
            )}
          </div>

          {/* Bar track */}
          <div
            style={{
              flex: 1,
              height: 20,
              background: "var(--bg-subtle, #f5f3ef)",
              borderRadius: 3,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 2,
                bottom: 2,
                left: `${bar.leftPct}%`,
                width: `${bar.widthPct}%`,
                minWidth: 4,
                background: bar.color,
                borderRadius: 2,
                opacity: 0.75,
                transition: "left 0.3s var(--ease, ease), width 0.3s var(--ease, ease)",
              }}
            />
          </div>

          {/* Duration */}
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: 11,
              color: "var(--text-muted, #a09a93)",
              whiteSpace: "nowrap",
              width: 60,
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            {bar.durationLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec}s`;
}
