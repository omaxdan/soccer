// V2 UI PRIMITIVES — small presentational components for the V2 analysis views.
// Read-only rendering of V2 API data. No data fetching, no calculation, no V1.

import type { ApiScore, ApiModuleReading, ApiModuleEvidence, ApiEvidenceItem, ApiContributionDirection, ApiFormFixture, ApiRecentFormRow, ApiTeamRecentVenueForm, ApiFeatureValue, ApiTeamFeatures } from '@/lib/v2/types';
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

// Every module status has an explicit, descriptive presentation state — SUPPORTS,
// NEUTRAL and CONTRADICTS included, so CONTRADICTS never falls through to a generic
// fallback. These are descriptive categorical states, never predictions: CONTRADICTS
// is not AWAY_WIN and must never be presented as one.
const STATUS_COLOR: Record<string, string> = {
  SUPPORTS: 'var(--edge)', CONTRADICTS: 'var(--risk)', NEUTRAL: 'var(--muted)', INACTIVE: 'var(--faint)',
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

// ─────────────────────────────────────────────────────────────────────────────
// MODULE SUBSTRATE — the persisted inputs the reading actually consumed (PD-10).
// This is the module's OWN substrate: the feature values the module cited, with
// the contribution direction it persisted — NOT unrelated context placed nearby.
// It computes nothing: directions, values and counts are displayed exactly as
// persisted (a zero count / zero value stays), and a cited value with no
// resolvable number is shown honestly, never invented.
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTION_COLOR: Record<ApiContributionDirection, string> = {
  SUPPORTS: 'var(--edge)', CONTRADICTS: 'var(--risk)', NEUTRAL: 'var(--muted)',
};

/** Displays a cited value without inventing precision, or an em dash when absent. */
function citedValue(v: number | null): string {
  if (v === null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function EvidenceItemRow({ item }: { item: ApiEvidenceItem }) {
  const color = DIRECTION_COLOR[item.contributionDirection];
  const label = item.displayName ?? item.featureKey ?? 'input';
  return (
    <div role="listitem" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span className="label-cap" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline' }}>
        <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 11 }}>{citedValue(item.value)}</span>
        <span
          className="label-cap"
          style={{ color, fontWeight: 700, fontSize: 10 }}
          aria-label={`contribution ${item.contributionDirection.toLowerCase()}`}
        >{item.contributionDirection.toLowerCase()}</span>
      </span>
    </div>
  );
}

/**
 * The evidence behind one reading. Set-level line ("N of M inputs present", plus
 * below-threshold / estimated counts only when non-zero), then one row per cited
 * value. Renders nothing when the reading recorded no evidence.
 */
export function EvidencePanel({ evidence }: { evidence: ApiModuleEvidence | null }) {
  if (!evidence) return null;
  const { declaredInputCount, presentInputCount, belowThresholdInputCount, estimatedInputCount, items } = evidence;
  return (
    <div style={{ marginTop: 8, borderTop: '1px solid var(--hairline, rgba(128,128,128,0.2))', paddingTop: 6 }}>
      <p className="eyebrow" style={{ fontSize: 10 }}>Why? · Module substrate</p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 1 }}>the inputs this reading consumed</p>
      <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 2 }}>
        {presentInputCount} of {declaredInputCount} inputs present
        {belowThresholdInputCount > 0 ? ` · ${belowThresholdInputCount} below threshold` : ''}
        {estimatedInputCount > 0 ? ` · ${estimatedInputCount} estimated` : ''}
      </p>
      {items.length > 0 && (
        <div role="list" aria-label="cited evidence" style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
          {items.map((it, i) => <EvidenceItemRow key={`${it.featureKey ?? 'input'}-${i}`} item={it} />)}
        </div>
      )}
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
      {!inactive && <EvidencePanel evidence={reading.evidence} />}
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
        Related context — persisted V2 feature values (all competitions). Descriptive facts for interpretation,
        not the substrate of any single module. Highlight marks the stronger side per metric.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECENT VENUE FORM — CONTEXT ONLY (PD-11).
// Each team's five most recent completed HOME fixtures and five most recent
// completed AWAY fixtures, each row a plain fact: date · opponent · venue ·
// competition · score · W/D/L. This is descriptive CONTEXT — it is NOT a module
// input, NOT a feature, and NOT the calculation substrate of home_away_split
// (which reads the edition-cumulative venue population, unchanged). W/D/L is the
// presentation-only derivation; nothing here is a prediction. Every row is strictly
// before kickoff (enforced server-side, PD-7).
// ─────────────────────────────────────────────────────────────────────────────

/** Compact UTC date (e.g. "12 Aug"). */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/** A small inline W/D/L letter for a venue-form row (presentation only). */
function ResultLetter({ row }: { row: ApiRecentFormRow }) {
  const r = formResult(row);
  const map = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' } as const;
  const color = r ? map[r] : 'var(--faint)';
  const full = r === 'W' ? 'Win' : r === 'D' ? 'Draw' : r === 'L' ? 'Loss' : 'No result';
  return (
    <span className="mono" aria-label={full} title={full}
      style={{ fontWeight: 700, color, minWidth: 12, textAlign: 'center' }}>{r ?? '·'}</span>
  );
}

/** The rows for one venue side of one team. Honest empty / partial states. */
function VenueSide({ label, rows }: { label: string; rows: ApiRecentFormRow[] }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p className="label-cap" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>
          {rows.length === 0 ? 'no matches' : `${rows.length} of up to 5`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11, marginTop: 4 }}>No completed matches yet</p>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          {rows.map((row) => (
            <div role="listitem" key={row.fixtureId}
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 6, alignItems: 'baseline', fontSize: 11 }}>
              <span className="tnum" style={{ color: 'var(--faint)' }}>{shortDate(row.kickoffAt)}</span>
              <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.opponent.name}
                <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 4 }}>
                  {row.venueName ?? '—'} · {row.competition.name}
                </span>
              </span>
              <span className="mono tnum" style={{ color: 'var(--text-secondary)' }}>
                {row.goalsFor ?? '-'}–{row.goalsAgainst ?? '-'}
              </span>
              <ResultLetter row={row} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One team's recent venue form: Last 5 Home over Last 5 Away. */
export function TeamVenueForm({ name, form }: { name: string; form: ApiTeamRecentVenueForm }) {
  return (
    <div className="panel" style={{ padding: 12 }} aria-label={`${name} recent venue form`}>
      <p className="label-cap" style={{ color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>{name}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <VenueSide label="Last 5 Home" rows={form.lastHome} />
        <VenueSide label="Last 5 Away" rows={form.lastAway} />
      </div>
    </div>
  );
}

/** The full PD-11 Recent Venue Form surface for both teams. */
export function RecentVenueForm({ homeName, awayName, home, away }: { homeName: string; awayName: string; home: ApiTeamRecentVenueForm; away: ApiTeamRecentVenueForm }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <TeamVenueForm name={homeName} form={home} />
      <TeamVenueForm name={awayName} form={away} />
    </div>
  );
}
