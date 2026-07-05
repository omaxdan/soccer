// ─── CATEGORIZED TEAM COMPARISON — Overview tab landing layout ──────────────
// Per the 6-tab redesign spec: comparison rows grouped into four named
// categories, desktop 1-row/4-columns, mobile stacked. Edge shown as a
// colored pill: amber = home edge, blue = away edge, gray = even.
//
// Deliberately ZERO inline styles — this component is the flagship
// implementation of the "all styling class-based in globals.css"
// requirement (see .cmp-* rules there). Everything themes automatically
// via the CSS variables, in both light and dark mode.
import type { ComparisonRow } from '@/components/TeamComparisonMatrix';
import FormString from '@/components/FormString';

const CATEGORIES: { title: string; labels: string[] }[] = [
  { title: 'Match Context & Logistics', labels: ['Venue Advantage', 'Congestion'] },
  { title: 'Current Form & Momentum', labels: ['Last 5 Form', 'Readiness', 'Form Index'] },
  { title: 'Team Quality & Roster Health', labels: ['Strength Rating', 'Squad Stability', 'Squad Depth', 'Injury Impact', 'Injury Burden'] },
  { title: 'Statistical Outputs & Projections', labels: ['Goals Scored', 'Goals Conceded', 'Predicted Goals'] },
];

const LOWER_IS_BETTER_NOTE = new Set(['Congestion', 'Goals Conceded', 'Injury Impact', 'Injury Burden']);

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export default function CategorizedComparison({
  rows, homeTeam, awayTeam, homeFormString, awayFormString,
}: {
  rows: ComparisonRow[];
  homeTeam: string;
  awayTeam: string;
  homeFormString?: string;
  awayFormString?: string;
}) {
  const byLabel = new Map(rows.map(r => [r.label, r]));

  const renderRow = (label: string) => {
    // 'Last 5 Form' is synthetic — built from the form strings, not a numeric row
    if (label === 'Last 5 Form') {
      if (!homeFormString && !awayFormString) return null;
      return (
        <div className="cmp-row" key={label}>
          <div className="cmp-row-label">Last 5 Form</div>
          <div className="cmp-row-values">
            {homeFormString ? <FormString results={homeFormString.split('')} size="sm" /> : <span className="cmp-val mono">—</span>}
            <span className="cmp-vs">vs</span>
            {awayFormString ? <FormString results={awayFormString.split('')} size="sm" /> : <span className="cmp-val mono">—</span>}
          </div>
        </div>
      );
    }

    const r = byLabel.get(label);
    if (!r || (r.homeValue == null && r.awayValue == null)) return null;

    const h = r.homeValue, a = r.awayValue;
    let edge: 'home' | 'away' | 'even' = 'even';
    let diff = 0;
    let isStrong = false;
    if (h != null && a != null && h !== a) {
      diff = Math.abs(h - a);
      const homeBetter = r.higherIsBetter ? h > a : h < a;
      edge = homeBetter ? 'home' : 'away';
      // Relative gap, not absolute — Strength Rating (0-100 scale) and
      // Predicted Goals (0-4ish scale) can't share one fixed threshold.
      // >=30% of the larger value reads as a genuinely lopsided gap
      // (verified against the real screenshot data: Strength 10v81 ->
      // 88% relative, flagged; Squad Stability 100v99 -> 1%, not flagged).
      const relativeDiff = diff / Math.max(Math.abs(h), Math.abs(a), 1);
      isStrong = relativeDiff >= 0.3;
    }
    const edgeText = edge === 'even'
      ? 'Even'
      : `${edge === 'home' ? homeTeam : awayTeam} +${Number.isInteger(diff) ? diff : diff.toFixed(1)}`;

    return (
      <div className="cmp-row" key={label}>
        <div className="cmp-row-label">
          {label}
          {LOWER_IS_BETTER_NOTE.has(label) && <span className="cmp-note"> · lower is better</span>}
        </div>
        <div className="cmp-row-values">
          <span className={`cmp-val mono ${edge === 'home' && isStrong ? 'cmp-val-strong' : ''}`}>{fmt(h)}</span>
          <span className="cmp-vs">vs</span>
          <span className={`cmp-val mono ${edge === 'away' && isStrong ? 'cmp-val-strong' : ''}`}>{fmt(a)}</span>
        </div>
        <span className={`cmp-edge cmp-edge-${edge}${isStrong ? ' cmp-edge-strong' : ''}`}>{edgeText}</span>
      </div>
    );
  };

  return (
    <div className="cmp-categories">
      {CATEGORIES.map(cat => {
        const rendered = cat.labels.map(renderRow).filter(Boolean);
        if (rendered.length === 0) return null;
        return (
          <div className="cmp-category" key={cat.title}>
            <div className="cmp-category-title">{cat.title}</div>
            <div className="cmp-category-rows">{rendered}</div>
          </div>
        );
      })}
      <div className="cmp-legend">
        <span className="cmp-edge cmp-edge-home">{homeTeam}</span>
        <span className="cmp-edge cmp-edge-away">{awayTeam}</span>
        <span className="cmp-edge cmp-edge-even">Even</span>
      </div>
    </div>
  );
}
