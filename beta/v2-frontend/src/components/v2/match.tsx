// MATCH ENTITY HUB — quantitative surfaces (read-only, SSR).
//
// Data-first panels for the five match sub-resources the page did not previously
// surface: result, team statistics, lineups, venue, lifecycle — plus a coverage
// grid. Observed evidence only: raw provider values passed through, nothing
// recomputed (no derived W/D/L, percentages, or verdicts). Nullable → em dash;
// absent/unsupported → honest state distinguished by the API's coverage flags.
// Links go through the route helpers. No travel/weather/H2H, no betting language.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, EmptyState } from '@/components/v2/ui';
import type {
  MatchResult, MatchLineups, MatchTeamStatistics, MatchLifecycle, MatchVenue,
  TeamLineup,
} from '@/lib/v2/types';

function Eyebrow({ label, kind = 'context', count }: { label: string; kind?: 'context' | 'governed'; count?: number }) {
  const color = kind === 'governed' ? 'var(--edge)' : 'var(--cool)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{label}</p>
      <span className="label-cap" style={{ color, border: `1px solid ${color}`, borderRadius: 4, padding: '0 5px', fontSize: 9 }}>{kind === 'governed' ? 'governed' : 'context'}</span>
      {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{count}</span>}
    </div>
  );
}
function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}
const th: React.CSSProperties = { textAlign: 'left', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' };
const tdL: React.CSSProperties = { padding: '4px 6px', color: 'var(--text)' };
const tdC: React.CSSProperties = { padding: '4px 6px', color: 'var(--text)', textAlign: 'center', whiteSpace: 'nowrap' };

// ═══ RESULT ═════════════════════════════════════════════════════════════════════════

function ScoreRow({ label, s }: { label: string; s: { home: number; away: number } | null }) {
  return (
    <tr>
      <td style={th}>{label}</td>
      <td style={tdC} className="tnum">{s ? s.home : '—'}</td>
      <td style={tdC} className="tnum">{s ? s.away : '—'}</td>
    </tr>
  );
}

export function MatchResultPanel({ result, coverage, homeName, awayName }: {
  result: MatchResult | null;
  coverage: { result: 'present' | 'absent' };
  homeName: string;
  awayName: string;
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Result" />
      {coverage.result === 'absent' || !result ? (
        <EmptyState message="No result recorded (not yet played, or unavailable)." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr><th style={th}></th><th style={{ ...th, textAlign: 'center' }}>{homeName}</th><th style={{ ...th, textAlign: 'center' }}>{awayName}</th></tr></thead>
            <tbody>
              <ScoreRow label="Full time" s={result.final} />
              <ScoreRow label="Half time" s={result.halfTime} />
              <ScoreRow label="Extra time" s={result.extraTime} />
              <ScoreRow label="Penalties" s={result.penalties} />
            </tbody>
          </table>
          {result.confirmedAt && <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>confirmed <Kickoff iso={result.confirmedAt} /></p>}
        </div>
      )}
    </section>
  );
}

// ═══ TEAM STATISTICS (per period, side-by-side; raw provider values) ════════════════

export function MatchTeamStatisticsPanel({ teamStatistics, homeName, awayName }: {
  teamStatistics: MatchTeamStatistics;
  homeName: string;
  awayName: string;
}) {
  const { periods, coverage } = teamStatistics;
  return (
    <section className="space-y-2">
      <Eyebrow label="Team statistics" />
      {coverage.teamStatistics === 'absent' || periods.length === 0 ? (
        <EmptyState message="No team statistics recorded." />
      ) : (
        <div className="space-y-3">
          {periods.map((p) => (
            <div key={p.period} className="space-y-1">
              <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Period: {p.period}</p>
              <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                  <thead><tr><th style={th}>Statistic</th><th style={{ ...th, textAlign: 'center' }}>{homeName}</th><th style={{ ...th, textAlign: 'center' }}>{awayName}</th></tr></thead>
                  <tbody>
                    {p.statistics.map((s) => (
                      <tr key={`${p.period}-${s.groupName}-${s.statisticKey}`}>
                        <td style={{ ...tdL, whiteSpace: 'normal' }}>{s.statisticName ?? s.statisticKey}</td>
                        <td style={tdC} className="tnum">{orDash(s.home.display ?? s.home.value)}</td>
                        <td style={tdC} className="tnum">{orDash(s.away.display ?? s.away.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {coverage.provider && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>source: {coverage.provider}{coverage.retrievedAt ? ' · retrieved ' : ''}{coverage.retrievedAt ? <Kickoff iso={coverage.retrievedAt} /> : null}</p>}
        </div>
      )}
    </section>
  );
}

// ═══ LINEUPS ════════════════════════════════════════════════════════════════════════

function LineupColumn({ side }: { side: TeamLineup | null }) {
  if (!side) return <EmptyState message="No lineup reported." />;
  const Row = ({ p }: { p: TeamLineup['starting'][number] }) => (
    <li style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12 }}>
      <span className="mono tnum" style={{ color: 'var(--faint)', minWidth: 22, textAlign: 'right' }}>{orDash(p.shirtNumber)}</span>
      <Link href={routes.player(p.player)} style={{ color: 'var(--cool)', textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player.fullName}</Link>
      <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{orDash(p.positionName ?? p.positionCode)}</span>
    </li>
  );
  return (
    <div className="panel" style={{ padding: 12 }}>
      <p className="label-cap" style={{ color: 'var(--muted)' }}>
        {side.team.name}{side.formation ? <span className="mono" style={{ color: 'var(--faint)', marginLeft: 6 }}>{side.formation}</span> : null}
      </p>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 8 }}>Starting XI · {side.starting.length}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>{side.starting.map((p) => <Row key={p.player.id} p={p} />)}</ul>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 8 }}>Substitutes · {side.substitutes.length}</p>
      {side.substitutes.length === 0
        ? <p className="label-cap" style={{ color: 'var(--faint)' }}>—</p>
        : <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>{side.substitutes.map((p) => <Row key={p.player.id} p={p} />)}</ul>}
    </div>
  );
}

export function MatchLineupsPanel({ lineups }: { lineups: MatchLineups }) {
  const both = !lineups.home && !lineups.away;
  return (
    <section className="space-y-2">
      <Eyebrow label="Lineups" />
      {lineups.coverage.lineups === 'absent' || both ? (
        <EmptyState message="No lineups reported for this fixture." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LineupColumn side={lineups.home} />
          <LineupColumn side={lineups.away} />
        </div>
      )}
    </section>
  );
}

// ═══ VENUE (context only — links to the canonical Venue page; no travel/weather) ═════

export function MatchVenuePanel({ matchVenue }: { matchVenue: MatchVenue }) {
  const v = matchVenue.venue;
  return (
    <section className="space-y-2">
      <Eyebrow label="Venue" />
      {matchVenue.coverage.venue === 'absent' || !v ? (
        <EmptyState message="No venue recorded for this fixture." />
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <p style={{ color: 'var(--text)', fontWeight: 600 }}>
            <Link href={routes.venue(v)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{v.name}</Link>
            {matchVenue.isNeutralVenue ? <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 8 }}>neutral</span> : null}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginTop: 10 }}>
            <Fact label="City" value={orDash(v.city)} />
            <Fact label="Country" value={orDash(v.countryCode)} />
            <Fact label="Capacity" value={orDash(v.capacity)} />
            <Fact label="Surface" value={orDash(v.surface)} />
            <Fact label="Coordinates" value={v.latitude !== null && v.longitude !== null ? `${v.latitude}, ${v.longitude}` : '—'} />
            <Fact label="Elevation (m)" value={orDash(v.elevationMetres)} />
            <Fact label="Timezone" value={orDash(v.timezoneName)} />
          </div>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p className="mono tnum" style={{ color: 'var(--text)', fontSize: 12, marginTop: 2 }}>{value}</p>
    </div>
  );
}

// ═══ LIFECYCLE ══════════════════════════════════════════════════════════════════════

export function MatchLifecyclePanel({ lifecycle }: { lifecycle: MatchLifecycle }) {
  const { transitions, coverage } = lifecycle;
  return (
    <section className="space-y-2">
      <Eyebrow label="Lifecycle" count={transitions.length} />
      {coverage.transitions === 'absent' || transitions.length === 0 ? (
        <EmptyState message="No lifecycle transitions recorded." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>When</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Provider</th></tr></thead>
            <tbody>
              {transitions.map((t, i) => (
                <tr key={`${t.transitionedAt}-${i}`}>
                  <td style={tdL} className="tnum"><Kickoff iso={t.transitionedAt} /></td>
                  <td style={tdL}>{orDash(t.fromState?.displayName ?? t.fromState?.code)}</td>
                  <td style={tdL}>{t.toState.displayName ?? t.toState.code}</td>
                  <td style={tdL}>{orDash(t.providerStatusRaw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ COVERAGE (honest present/absent/not-supported grid) ════════════════════════════

export function MatchCoverage({ flags }: { flags: readonly [string, 'present' | 'absent' | 'partial' | 'not-supported'][] }) {
  const color = (s: string) => s === 'present' ? 'var(--edge)' : s === 'not-supported' ? 'var(--faint)' : s === 'partial' ? 'var(--muted)' : 'var(--faint)';
  return (
    <section className="space-y-2">
      <Eyebrow label="Coverage" />
      <div className="panel" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {flags.map(([label, state]) => (
          <span key={label} className="label-cap" style={{ fontSize: 10, color: color(state) }}>{label}: {state}</span>
        ))}
      </div>
    </section>
  );
}
