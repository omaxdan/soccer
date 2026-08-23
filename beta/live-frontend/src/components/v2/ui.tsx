// V2 UI PRIMITIVES — small presentational components for the V2 analysis views.
// Read-only rendering of V2 API data. No data fetching, no calculation, no V1.

import type { ApiScore, ApiModuleReading, ApiFormFixture, ApiFeatureValue, ApiTeamFeatures } from '@/lib/v2/types';
import { formResult } from '@/lib/v2/types';

/** UTC kickoff, rendered compactly and unambiguously. */
export function Kickoff({ iso }: { iso: string }) {
  const d = new Date(iso);
  const s = d.toLocaleString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  });
  return <time dateTime={iso} className="tnum">{s} UTC</time>;
}

const STATUS_COLOR: Record<string, string> = {
  SUPPORTS: 'var(--edge)', NEUTRAL: 'var(--muted)', INACTIVE: 'var(--faint)',
};
function statusColor(status: string): string { return STATUS_COLOR[status] ?? 'var(--warn)'; }

/** Fixture status chip (SCHEDULED / COMPLETED / …). Text + color, never color alone. */
export function StatusChip({ status }: { status: string }) {
  const done = status === 'COMPLETED';
  const live = status === 'IN_PROGRESS';
  const color = done ? 'var(--muted)' : live ? 'var(--warn)' : 'var(--cool)';
  return (
    <span className="label-cap" style={{ color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 6px', fontSize: 10 }}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

/** Score, or an em dash when there is no result yet. */
export function Score({ score }: { score: ApiScore | null }) {
  if (!score) return <span className="mono" style={{ color: 'var(--faint)' }} aria-label="no score">—</span>;
  return <span className="mono tnum" style={{ fontWeight: 700 }}>{score.home}<span style={{ color: 'var(--faint)' }}>–</span>{score.away}</span>;
}

/** One W/D/L pill. Letter + color + aria-label, so it never relies on color alone. */
export function FormBadge({ fixture }: { fixture: ApiFormFixture }) {
  const r = formResult(fixture);
  const map = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' } as const;
  const color = r ? map[r] : 'var(--faint)';
  const label = r ?? '·';
  const full = r === 'W' ? 'Win' : r === 'D' ? 'Draw' : r === 'L' ? 'Loss' : 'No result';
  return (
    <span
      title={`${full} ${fixture.goalsFor ?? '-'}-${fixture.goalsAgainst ?? '-'} (${fixture.isHome ? 'home' : 'away'})`}
      aria-label={`${full}, ${fixture.goalsFor ?? '-'} to ${fixture.goalsAgainst ?? '-'}, ${fixture.isHome ? 'home' : 'away'}`}
      className="mono"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 4, fontSize: 12, fontWeight: 700,
        color, background: 'color-mix(in srgb, ' + color + ' 15%, transparent)',
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >{label}</span>
  );
}

/** A team's recent form as a left-to-right strip of W/D/L badges (most recent first). */
export function FormStrip({ fixtures }: { fixtures: ApiFormFixture[] }) {
  if (fixtures.length === 0) {
    return <p className="label-cap" style={{ color: 'var(--faint)' }}>No recent completed matches</p>;
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} role="list" aria-label="recent form, most recent first">
      {fixtures.map((f) => <div key={f.fixtureId} role="listitem"><FormBadge fixture={f} /></div>)}
    </div>
  );
}

/**
 * One module reading card. When `reading` is null the card is explicitly empty
 * ("Not enough data") — a missing reading is never rendered as a value.
 */
export function ReadingCard({ title, reading }: { title: string; reading: ApiModuleReading | null }) {
  if (!reading) {
    return (
      <div className="panel-raised" style={{ padding: 12, borderRadius: 8 }}>
        <p className="eyebrow">{title}</p>
        <p style={{ color: 'var(--faint)', marginTop: 6, fontSize: 13 }}>Not enough data yet</p>
      </div>
    );
  }
  const inactive = reading.status === 'INACTIVE';
  const color = statusColor(reading.status);
  return (
    <div className="panel-raised" style={{ padding: 12, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow">{title}</p>
        <span className="label-cap" style={{ color, fontWeight: 700 }} aria-label={`status ${reading.status}`}>
          {reading.status.toLowerCase()}
        </span>
      </div>
      <p style={{ marginTop: 6, fontSize: 13, color: inactive ? 'var(--faint)' : 'var(--text-secondary)' }}>
        {inactive ? (reading.inactiveReason ?? 'Not enough data yet') : (reading.verdictText ?? '—')}
      </p>
      <p className="label-cap tnum" style={{ marginTop: 8, color: 'var(--faint)', fontSize: 10 }}>
        sample {reading.sampleObservationCount}
        {reading.sampleMeetsThreshold ? '' : ' · below threshold'}
      </p>
    </div>
  );
}

/** Explicit empty state. */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ color: 'var(--muted)' }}>{message}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM INTELLIGENCE COMPARISON PANEL
// Surfaces persisted feature values (already computed by the V2 feature pipeline)
// as a home-vs-away comparison. It performs NO calculation — it displays values,
// applies the feature's ESTABLISHED direction only to highlight the leading side,
// and shows an honest state for missing / low-sample data. Never fabricates a
// value and never invents a composite score.
// ─────────────────────────────────────────────────────────────────────────────

/** direction 'up' = higher is better; 'down' = higher is worse (established semantics). */
type Direction = 'up' | 'down';
interface MetricSpec {
  label: string;
  unit: string;
  pick: (f: ApiTeamFeatures) => ApiFeatureValue | null;
  direction: Direction;
}
const METRICS: MetricSpec[] = [
  { label: 'Home form', unit: '/100', pick: (f) => f.homeForm, direction: 'up' },
  { label: 'Away form', unit: '/100', pick: (f) => f.awayForm, direction: 'up' },
  { label: 'Momentum', unit: 'pts', pick: (f) => f.momentum, direction: 'up' },
  { label: 'Rest', unit: 'days', pick: (f) => f.rest, direction: 'up' },
  { label: 'Congestion', unit: '/100', pick: (f) => f.congestion, direction: 'down' },
];

/** Rounds for display without inventing precision the value doesn't carry. */
function show(v: ApiFeatureValue): string {
  const n = v.value;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Which side leads on a metric per its established direction; null when not comparable. */
function leader(home: ApiFeatureValue | null, away: ApiFeatureValue | null, dir: Direction): 'home' | 'away' | null {
  if (!home || !away) return null;
  if (home.value === away.value) return null;
  const homeBetter = dir === 'up' ? home.value > away.value : home.value < away.value;
  return homeBetter ? 'home' : 'away';
}

function Cell({ v, lead }: { v: ApiFeatureValue | null; lead: boolean }) {
  if (!v) {
    return <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>Not enough data</span>;
  }
  const low = !v.sampleMeetsThreshold;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'inherit' }}>
      <span className="mono tnum" style={{ fontSize: 16, fontWeight: lead ? 700 : 500, color: lead ? 'var(--edge)' : 'var(--text)' }}>
        {show(v)}
      </span>
      {low && <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>low sample ({v.sampleObservationCount})</span>}
    </span>
  );
}

export function TeamIntelligencePanel({ home, away, homeName, awayName }: { home: ApiTeamFeatures; away: ApiTeamFeatures; homeName: string; awayName: string }) {
  return (
    <section aria-label="team intelligence comparison" className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
        <span className="label-cap" style={{ textAlign: 'right', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{homeName}</span>
        <span className="eyebrow" style={{ fontSize: 10 }} />
        <span className="label-cap" style={{ textAlign: 'left', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{awayName}</span>
      </div>
      <div role="table" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {METRICS.map((m) => {
          const h = m.pick(home);
          const a = m.pick(away);
          const lead = leader(h, a, m.direction);
          return (
            <div role="row" key={m.label} className="hairline" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <div style={{ textAlign: 'right' }}><Cell v={h} lead={lead === 'home'} /></div>
              <div style={{ textAlign: 'center', minWidth: 96 }}>
                <span className="label-cap" style={{ color: 'var(--muted)' }}>{m.label}</span>
                <span className="label-cap" style={{ display: 'block', color: 'var(--faint)', fontSize: 9 }}>{m.unit}{m.direction === 'down' ? ' · lower better' : ''}</span>
              </div>
              <div style={{ textAlign: 'left' }}><Cell v={a} lead={lead === 'away'} /></div>
            </div>
          );
        })}
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 8 }}>
        Supporting evidence — persisted V2 feature values. Highlight marks the stronger side per metric.
      </p>
    </section>
  );
}
