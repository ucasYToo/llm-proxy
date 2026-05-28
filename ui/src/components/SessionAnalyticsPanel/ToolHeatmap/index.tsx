import type { ToolUsageStats } from "../../../lib/api";

interface Props {
  data: ToolUsageStats[];
}

export default function ToolHeatmap({ data }: Props) {
  if (!data || data.length === 0) {
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
        暂无工具调用数据
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.callCount - a.callCount);
  const maxCount = sorted[0]?.callCount ?? 1;

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: 12,
        }}
      >
        <thead>
          <tr
            style={{
              borderBottom: "1px solid var(--border, #e8e6e1)",
              textAlign: "left",
            }}
          >
            <th style={thStyle}>工具</th>
            <th style={{ ...thStyle, width: "40%" }}>调用次数</th>
            <th style={{ ...thStyle, textAlign: "right" }}>平均耗时</th>
            <th style={{ ...thStyle, textAlign: "right" }}>错误</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const pct = (row.callCount / maxCount) * 100;
            return (
              <tr
                key={row.toolName}
                style={{ borderBottom: "1px solid var(--border-light, #f0ede8)" }}
              >
                <td style={tdStyle}>
                  <span
                    style={{
                      color: "var(--text, #1a1a1a)",
                      fontWeight: 500,
                    }}
                  >
                    {row.toolName}
                  </span>
                </td>
                <td style={tdStyle}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: 16,
                        background: "var(--bg-subtle, #f5f3ef)",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: "var(--accent, #D97757)",
                          borderRadius: 3,
                          opacity: 0.7,
                          transition: "width 0.4s var(--ease, ease)",
                          minWidth: row.callCount > 0 ? 2 : 0,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        color: "var(--text-secondary, #6b6560)",
                        fontSize: 11,
                        whiteSpace: "nowrap",
                        minWidth: 28,
                        textAlign: "right",
                      }}
                    >
                      {row.callCount}
                    </span>
                  </div>
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    color: "var(--text-secondary, #6b6560)",
                  }}
                >
                  {formatDuration(row.avgDurationMs)}
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: "right",
                    color:
                      row.errorCount > 0
                        ? "var(--error, #c4412b)"
                        : "var(--text-muted, #a09a93)",
                    fontWeight: row.errorCount > 0 ? 600 : 400,
                    background:
                      row.errorCount > 0
                        ? "var(--error-light, #fdf0ed)"
                        : "transparent",
                    borderRadius: row.errorCount > 0 ? 3 : 0,
                  }}
                >
                  {row.errorCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 10,
  fontWeight: 500,
  color: "var(--text-muted, #a09a93)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 8px",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
