// Lightweight SVG radar/spider chart — no charting library. Two overlaid
// polygons (home/away) across N axes, each value expected on a 0-100
// scale. Matches the existing dark theme: var(--ink) plot background,
// var(--line) grid, values passed in already computed by the caller.

export interface RadarChartProps {
  axes: string[];
  homeValues: number[];
  awayValues: number[];
  homeColor?: string;
  awayColor?: string;
  size?: number;
  homeLabel?: string;
  awayLabel?: string;
}

const RINGS = [0.25, 0.5, 0.75, 1];

function point(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function polygonPoints(cx: number, cy: number, maxR: number, values: number[], n: number): string {
  return values
    .map((v, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const r = (Math.max(0, Math.min(100, v ?? 0)) / 100) * maxR;
      const [x, y] = point(cx, cy, r, angle);
      return `${x},${y}`;
    })
    .join(" ");
}

export function RadarChart({
  axes,
  homeValues,
  awayValues,
  homeColor = "var(--edge)",
  awayColor = "var(--cool)",
  size = 200,
  homeLabel = "Home",
  awayLabel = "Away",
}: RadarChartProps) {
  const n = axes.length;
  if (n < 3) return null;

  const pad = 34; // room for axis labels
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - pad;

  const homePts = polygonPoints(cx, cy, maxR, homeValues, n);
  const awayPts = polygonPoints(cx, cy, maxR, awayValues, n);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        style={{ maxWidth: size, background: "var(--ink)" }}
        className="rounded-term"
        role="img"
        aria-label="Radar comparison chart"
      >
        {/* grid rings */}
        <g fill="none" stroke="var(--line)" strokeWidth="1">
          {RINGS.map((frac) => (
            <polygon
              key={frac}
              points={Array.from({ length: n }, (_, i) => {
                const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
                const [x, y] = point(cx, cy, maxR * frac, angle);
                return `${x},${y}`;
              }).join(" ")}
            />
          ))}
        </g>

        {/* axis spokes + labels */}
        {axes.map((label, i) => {
          const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
          const [x, y] = point(cx, cy, maxR, angle);
          const [lx, ly] = point(cx, cy, maxR + 14, angle);
          const anchor = Math.abs(Math.cos(angle)) < 0.2 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
          return (
            <g key={label}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="mono"
                fontSize="8"
                fill="var(--faint)"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* away polygon (drawn first, sits under home) */}
        <polygon points={awayPts} fill={awayColor} fillOpacity="0.18" stroke={awayColor} strokeWidth="1.5" />
        {/* home polygon */}
        <polygon points={homePts} fill={homeColor} fillOpacity="0.18" stroke={homeColor} strokeWidth="1.5" />
      </svg>
      <div className="mono flex items-center gap-4 text-[0.6rem] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: homeColor }} />
          {homeLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: awayColor }} />
          {awayLabel}
        </span>
      </div>
    </div>
  );
}
