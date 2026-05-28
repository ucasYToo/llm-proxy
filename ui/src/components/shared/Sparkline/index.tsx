export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

export default function Sparkline({
  data,
  width = 120,
  height = 32,
  color = "var(--accent, #D97757)",
  fillOpacity = 0.15,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  // Avoid division by zero when all values are identical
  const range = max - min || 1;

  // Inset by strokeWidth so the stroke isn't clipped at SVG edges
  const pad = strokeWidth;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;

  const points = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * chartW,
    y: pad + chartH - ((v - min) / range) * chartH,
  }));

  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Polygon: close the filled area from the last point down to the
  // baseline, across to the first point, and back up.
  const baseline = height - pad;
  const fillPoints = [
    `${points[0].x},${baseline}`,
    ...points.map((p) => `${p.x},${p.y}`),
    `${points[points.length - 1].x},${baseline}`,
  ].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
    >
      <polygon points={fillPoints} fill={color} fillOpacity={fillOpacity} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
