'use client';
import { COLORS, scoreColor } from '@/design/tokens';

export interface StatGridItem {
  label: string;
  value: string | number | null;
  /** When set, colors the value using the score-band palette (green/amber/red)
   *  instead of plain text — for stats that are themselves a 0-100 score
   *  (form index, congestion) rather than a plain figure (goals scored). */
  scoreColored?: boolean;
  suffix?: string;
}

interface Props {
  items: StatGridItem[];
  dense?: boolean;
}

/** The "Key stats" section from a stock quote page — Open/High/Low/Mkt
 *  cap in a calm, dense, label-over-value grid. Uses .rip-stat-grid
 *  (repeat(auto-fit, minmax(...))) rather than a fixed column count, so
 *  it reflows continuously across any screen width with no per-page
 *  breakpoint tuning needed — the actual fix for the inline
 *  gridTemplateColumns pattern used everywhere else in this app that
 *  can't respond to a media query at all. */
export default function StatGrid({ items, dense }: Props) {
  return (
    <div className={`rip-stat-grid${dense ? ' dense' : ''}`}>
      {items.map((item, i) => (
        <div className="rip-stat" key={i}>
          <div className="rip-stat-label">{item.label}</div>
          <div className="rip-stat-value" style={{ color: item.scoreColored && typeof item.value === 'number' ? scoreColor(item.value) : COLORS.text }}>
            {item.value != null ? item.value : '—'}{item.value != null ? item.suffix ?? '' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
