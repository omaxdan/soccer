import { VersusBar } from "./Meters";

// A single head-to-head intelligence row: label, home value, versus bar,
// away value, plus a plain-language "why" beneath.
export function ScorecardRow({
  label,
  home,
  away,
  format = (v) => (v == null ? "—" : String(Math.round(v))),
  why,
  invert = false,
  homeColor = "var(--edge)",
  awayColor = "var(--cool)",
  max = 100,
}: {
  label: string;
  home: number | null | undefined;
  away: number | null | undefined;
  format?: (v: number | null | undefined) => string;
  why?: string;
  invert?: boolean; // when lower is better (fatigue, injury, travel)
  homeColor?: string;
  awayColor?: string;
  max?: number;
}) {
  // For inverted metrics, the bar should reward the lower value.
  const h = home ?? 0;
  const a = away ?? 0;
  const barHome = invert ? Math.max(0, max - h) : h;
  const barAway = invert ? Math.max(0, max - a) : a;
  const homeBetter = invert ? h < a : h > a;

  return (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span
          className="mono w-10 text-right text-sm font-semibold tnum"
          style={{ color: homeBetter ? homeColor : "var(--text)" }}
        >
          {format(home)}
        </span>
        <div className="flex-1">
          <div className="mb-1 text-center label-cap">{label}</div>
          <VersusBar
            home={barHome}
            away={barAway}
            homeColor={homeColor}
            awayColor={awayColor}
            max={max}
          />
        </div>
        <span
          className="mono w-10 text-left text-sm font-semibold tnum"
          style={{ color: !homeBetter && h !== a ? awayColor : "var(--text)" }}
        >
          {format(away)}
        </span>
      </div>
      {why && <p className="mt-1.5 text-center text-[0.7rem] leading-snug text-muted">{why}</p>}
    </div>
  );
}
