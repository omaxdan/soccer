// TEAM ENTITY HUB — presentational components (read-only, SSR).
//
// Numbers-first Layer-1/Layer-3 surfaces for the Team page. Strict separation:
//   IDENTITY   — who the team is (name, country, home venue, competitions).
//   CONTEXT    — competition participation, venue name, fixtures, players.
//   EVIDENCE   — raw match results, recent home/away fixtures, descriptive
//                performance FEATURES (persisted, not recomputed here).
//   INTELLIGENCE — the GOVERNED readiness reading only, clearly badged and never
//                merged with the evidence around it.
//
// Every value is rendered exactly as the API supplied it: no aggregation, ranking,
// zero-fill, prediction, probability, travel/distance, or betting language. Nullable
// fields render as an em dash. Links go through the centralized route helpers.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, EmptyState, EvidencePanel } from '@/components/v2/ui';
import { lineGoals, lineResult, lineMatchFixture } from '@/lib/v2/team';
import { formResult } from '@/lib/v2/types';
import type {
  ApiPlayerSummary, ApiTeamResult, CompetitionPerformance, PerformanceMetric,
  TeamAvailabilityRecord, TeamDetailResponse, TeamFixtureLine, TeamParticipation,
  TeamPerformanceOverall, TeamReadinessReading,
} from '@/lib/v2/types';

// ── shared bits ───────────────────────────────────────────────────────────────────

function Tag({ kind }: { kind: 'context' | 'governed' }) {
  const color = kind === 'governed' ? 'var(--edge)' : 'var(--cool)';
  return <span className="label-cap" style={{ color, border: `1px solid ${color}`, borderRadius: 4, padding: '0 5px', fontSize: 9 }}>{kind === 'governed' ? 'governed' : 'context'}</span>;
}

function Eyebrow({ label, kind = 'context', count }: { label: string; kind?: 'context' | 'governed'; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{label}</p>
      <Tag kind={kind} />
      {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{count}</span>}
    </div>
  );
}

function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function FormLetter({ res }: { res: 'W' | 'D' | 'L' | null }) {
  const map = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' } as const;
  const color = res ? map[res] : 'var(--faint)';
  return <span className="mono" style={{ fontWeight: 700, color, minWidth: 12, textAlign: 'center' }}>{res ?? '·'}</span>;
}

const th: React.CSSProperties = { textAlign: 'left', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' };
const td: React.CSSProperties = { padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap' };

// ═══ IDENTITY ══════════════════════════════════════════════════════════════════════

export function TeamIdentityHeader({ team, competitions }: {
  team: TeamDetailResponse['team'];
  competitions: TeamDetailResponse['competitions'];
}) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{team.name}</h1>
      <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>
        {orDash(team.shortName)}
        {team.countryCode ? <> · <Link href={routes.country({ code: team.countryCode })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{team.countryCode}</Link></> : null}
        {team.homeVenueName ? ` · ${team.homeVenueName}` : ''}
      </p>
      {competitions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {competitions.map((c) => (
            <Link
              key={c.editionId}
              href={routes.edition({ id: c.editionId, competition: { slug: c.competition.slug }, seasonLabel: c.seasonLabel })}
              className="label-cap"
              style={{ color: 'var(--cool)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 7px', textDecoration: 'none' }}
            >
              {c.competition.name} · {c.seasonLabel}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}

// ═══ PERFORMANCE SNAPSHOT — descriptive persisted features (context) ═════════════════

function MetricCell({ label, metric }: { label: string; metric: PerformanceMetric | null }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</span>
      <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700 }}>{metric ? orDash(metric.value) : '—'}</span>
      <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>
        {metric ? `${metric.unit} · n=${metric.sample.matches}${metric.sample.meetsThreshold ? '' : ' ·below thresh'}` : 'no sample'}
      </span>
    </div>
  );
}

export function TeamPerformanceSnapshot({ overall, coverage }: {
  overall: TeamPerformanceOverall;
  coverage: 'present' | 'partial' | 'absent';
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Descriptive performance" />
      {coverage === 'absent' ? (
        <EmptyState message="No descriptive performance features available yet." />
      ) : (
        <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
          <MetricCell label="Home form" metric={overall.homeForm} />
          <MetricCell label="Away form" metric={overall.awayForm} />
          <MetricCell label="Momentum" metric={overall.momentum} />
          <MetricCell label="Goal-margin vol." metric={overall.goalMarginVolatility} />
          <MetricCell label="Giant-killer PPG" metric={overall.giantKillerPpg} />
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Persisted descriptive features — not a governed reading.</p>
    </section>
  );
}

// ═══ COMPETITION CONTEXT — participation counts per governed edition ═════════════════

export function TeamCompetitionContext({ participation }: { participation: readonly TeamParticipation[] }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Competition context" count={participation.length} />
      {participation.length === 0 ? (
        <EmptyState message="No governed participation recorded yet." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr>
              <th style={th}>Competition</th><th style={th}>Season</th>
              <th style={th}>P</th><th style={th}>Completed</th><th style={th}>Scheduled</th><th style={th}>Postp.</th><th style={th}>Reg.</th>
            </tr></thead>
            <tbody>
              {participation.map((p) => (
                <tr key={p.competitionEditionId}>
                  <td style={td}><Link href={routes.competition(p.competition)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.competition.name}</Link></td>
                  <td style={td}>
                    <Link href={routes.edition({ id: p.competitionEditionId, competition: { slug: p.competition.slug }, seasonLabel: p.seasonLabel })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.seasonLabel}</Link>
                  </td>
                  <td style={td}>{p.fixturesTotal}</td><td style={td}>{p.completed}</td><td style={td}>{p.scheduled}</td><td style={td}>{p.postponed}</td>
                  <td style={td}>{p.registered ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ CURRENT FORM — recent completed results (evidence) ═════════════════════════════

export function TeamCurrentForm({ recentResults }: { recentResults: readonly ApiTeamResult[] }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Current form" count={recentResults.length} />
      {recentResults.length === 0 ? (
        <EmptyState message="No completed matches yet." />
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }} aria-label="recent result sequence">
            {recentResults.map((r) => <FormLetter key={r.fixtureId} res={formResult(r)} />)}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead><tr>
                <th style={th}>Date</th><th style={th}>Opponent</th><th style={th}>H/A</th><th style={th}>GF</th><th style={th}>GA</th><th style={th}>Res</th>
              </tr></thead>
              <tbody>
                {recentResults.map((r) => (
                  <tr key={r.fixtureId}>
                    <td style={td}><Kickoff iso={r.kickoffAt} /></td>
                    <td style={{ ...td, whiteSpace: 'normal' }}>{r.opponent.name}</td>
                    <td style={td}>{r.isHome ? 'H' : 'A'}</td>
                    <td style={td}>{orDash(r.goalsFor)}</td><td style={td}>{orDash(r.goalsAgainst)}</td>
                    <td style={td}><FormLetter res={formResult(r)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ═══ RECENT VENUE FORM CONTEXT — recent home / away fixtures (evidence, NOT a calc) ══

function VenueFormTable({ title, lines, teamName }: { title: string; lines: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <div className="space-y-1">
      <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{title}</p>
      {lines.length === 0 ? (
        <EmptyState message="None recorded." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Opponent</th><th style={th}>Res</th><th style={th}>GF</th><th style={th}>GA</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const { gf, ga } = lineGoals(l);
                return (
                  <tr key={l.fixtureId}>
                    <td style={td}><Kickoff iso={l.kickoffAt} /></td>
                    <td style={{ ...td, whiteSpace: 'normal' }}>
                      <Link href={routes.match(lineMatchFixture(l, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{l.opponent.name}</Link>
                    </td>
                    <td style={td}><FormLetter res={lineResult(l)} /></td>
                    <td style={td}>{orDash(gf)}</td><td style={td}>{orDash(ga)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TeamRecentVenueForm({ home, away, teamName }: { home: readonly TeamFixtureLine[]; away: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Recent venue form context" />
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Recent home/away fixtures — supporting evidence, not a home/away calculation.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <VenueFormTable title="Recent home matches" lines={home} teamName={teamName} />
        <VenueFormTable title="Recent away matches" lines={away} teamName={teamName} />
      </div>
    </section>
  );
}

// ═══ HOME / AWAY performance features (context) ═════════════════════════════════════

export function TeamHomeAwaySplit({ overall, byCompetition }: {
  overall: TeamPerformanceOverall;
  byCompetition: readonly CompetitionPerformance[];
}) {
  const hasScoped = byCompetition.some((c) => c.homeWinRate || c.awayWinRate);
  return (
    <section className="space-y-2">
      <Eyebrow label="Home / away form" />
      <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <MetricCell label="Home form" metric={overall.homeForm} />
        <MetricCell label="Away form" metric={overall.awayForm} />
      </div>
      {hasScoped && (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Season</th><th style={th}>Home win rate</th><th style={th}>Away win rate</th></tr></thead>
            <tbody>
              {byCompetition.map((c) => (
                <tr key={c.edition.id}>
                  <td style={td}>{c.edition.competition.name} · {c.edition.seasonLabel}</td>
                  <td style={td}>{c.homeWinRate ? `${orDash(c.homeWinRate.value)} (n=${c.homeWinRate.sample.matches})` : '—'}</td>
                  <td style={td}>{c.awayWinRate ? `${orDash(c.awayWinRate.value)} (n=${c.awayWinRate.sample.matches})` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ READINESS — the GOVERNED reading (intelligence), kept separate from evidence ════

export function TeamReadinessPanel({ readiness, coverage }: {
  readiness: TeamReadinessReading | null;
  coverage: { readiness: 'present' | 'absent'; readinessIsGoverned: true };
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Team readiness" kind="governed" />
      {coverage.readiness === 'absent' || !readiness ? (
        <EmptyState message="No governed readiness reading available." />
      ) : (
        <>
          <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Status</span>
              <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>{readiness.status}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Strength</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{orDash(readiness.strength)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Confidence</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{orDash(readiness.confidence)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Sample</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{readiness.sample.matches}{readiness.sample.meetsThreshold ? '' : ' ·below thresh'}</span>
            </div>
          </div>
          {readiness.verdictText && <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{readiness.verdictText}</p>}
          {readiness.inactiveReason && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>Inactive: {readiness.inactiveReason}</p>}
          <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>as of <Kickoff iso={readiness.asOf} /></p>
          {readiness.evidence && (
            <div className="space-y-1">
              <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Supporting evidence</p>
              <EvidencePanel evidence={readiness.evidence} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ═══ PLAYERS — squad + current availability (context) ═══════════════════════════════

export function TeamPlayers({ squad, availability }: { squad: readonly ApiPlayerSummary[]; availability: readonly TeamAvailabilityRecord[] }) {
  const currentByPlayer = new Map(availability.filter((a) => a.current).map((a) => [a.playerId, a]));
  return (
    <section className="space-y-2">
      <Eyebrow label="Squad" count={squad.length} />
      {squad.length === 0 ? (
        <EmptyState message="No squad registered yet." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Player</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {squad.map((p) => {
                const unavailable = currentByPlayer.get(p.id);
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, whiteSpace: 'normal' }}><Link href={routes.player(p)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.fullName}</Link></td>
                    <td style={td}>{unavailable ? <span style={{ color: 'var(--risk)' }}>{unavailable.unavailabilityKindCode}</span> : <span className="label-cap" style={{ color: 'var(--faint)' }}>available</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ MATCH HISTORY + UPCOMING — fixture lines (context/evidence) ════════════════════

function FixtureTable({ lines, teamName, showScore }: { lines: readonly TeamFixtureLine[]; teamName: string; showScore: boolean }) {
  return (
    <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
      <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
        <thead><tr>
          <th style={th}>Date</th><th style={th}>Competition</th><th style={th}>Opponent</th><th style={th}>H/A</th>
          {showScore ? <><th style={th}>Score</th><th style={th}>Res</th></> : null}<th style={th}>Status</th>
        </tr></thead>
        <tbody>
          {lines.map((l) => {
            const { gf, ga } = lineGoals(l);
            return (
              <tr key={l.fixtureId}>
                <td style={td}><Kickoff iso={l.kickoffAt} /></td>
                <td style={{ ...td, whiteSpace: 'normal' }}>{l.competition.name}</td>
                <td style={{ ...td, whiteSpace: 'normal' }}>
                  <Link href={routes.match(lineMatchFixture(l, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{l.opponent.name}</Link>
                </td>
                <td style={td}>{l.isHome ? 'H' : 'A'}</td>
                {showScore ? <><td style={td}>{gf === null || ga === null ? '—' : `${gf}–${ga}`}</td><td style={td}><FormLetter res={lineResult(l)} /></td></> : null}
                <td style={td}><span className="label-cap" style={{ color: 'var(--faint)' }}>{l.status}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TeamMatchHistory({ recent, teamName }: { recent: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Match history" count={recent.length} />
      {recent.length === 0 ? <EmptyState message="No recent fixtures." /> : <FixtureTable lines={recent} teamName={teamName} showScore />}
    </section>
  );
}

export function TeamUpcomingFixtures({ upcoming, teamName }: { upcoming: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Upcoming fixtures" count={upcoming.length} />
      {upcoming.length === 0 ? <EmptyState message="No upcoming fixtures scheduled." /> : <FixtureTable lines={upcoming} teamName={teamName} showScore={false} />}
    </section>
  );
}
