'use client';
import { scoreColor, COLORS } from '@/design/tokens';
import Sparkline from './Sparkline';

interface Props {
  /** The headline metric — e.g. a readiness score, confidence %. */
  value: number | null;
  label: string;
  /** Directional change vs some prior reference point (yesterday, last
   *  snapshot, baseline) — the "+1.41%" line under a stock's price. */
  change?: number | null;
  changeLabel?: string;
  /** Optional trend history for the sparkline underneath — omit entirely
   *  if there's no history yet (e.g. a brand new team snapshot); this
   *  component doesn't force a chart to exist. */
  trend?: { value: number | null }[];
  /** Suffix appended to the big number, e.g. '%' for a confidence score. */
  suffix?: string;
}

/** The mobile-first "hero" pattern from a stock quote page: one big
 *  number, colored by direction/quality, a directional delta line under
 *  it, and an optional sparkline. This is deliberately NOT the circular
 *  ReadinessGauge used elsewhere in this app (kept as-is, used
 *  extensively already) — a flat, large number is what actually reads
 *  in under a second on a small screen, which is the whole point of
 *  this pattern. Complements the gauge rather than replacing it. */
export default function QuoteHero({ value, label, change, changeLabel, trend, suffix = '' }: Props) {
  const color = value != null ? scoreColor(value) : COLORS.dim;
  const changeColor = change == null ? COLORS.dim : change >= 0 ? COLORS.green : COLORS.red;
  const changeArrow = change == null ? '' : change >= 0 ? '▲' : '▼';

  return (
    <div className="rip-hero">
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.dim, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 44, fontWeight: 800, color, lineHeight: 1 }}>
            {value != null ? Math.round(value) : '—'}{suffix}
          </div>
          {change != null && (
            <div style={{ fontSize: 14, fontWeight: 700, color: changeColor }}>
              {changeArrow} {Math.abs(change).toFixed(1)}{suffix} {changeLabel && <span style={{ fontSize: 11, color: COLORS.dim, fontWeight: 400 }}>{changeLabel}</span>}
            </div>
          )}
        </div>
      </div>
      {trend && trend.length > 0 && <Sparkline data={trend} />}
    </div>
  );
}
