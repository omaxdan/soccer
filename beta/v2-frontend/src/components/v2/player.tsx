// PLAYER ENTITY HUB — presentational components (read-only, SSR).
//
// A football-data terminal for one player: identity + team/competition context +
// availability + stored statistics + match participation + valuation, each rendered
// exactly as the API returns it. No new statistics, no age/derived computation, no
// prediction. Raw/descriptive evidence is badged "context"; nothing here is governed
// intelligence (the player endpoint exposes none). Nullable fields render as an em
// dash; absent substrate shows an honest empty state. Links use the route helpers.

import { Fragment } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, EmptyState } from '@/components/v2/ui';
import { playerMatchFixture } from '@/lib/v2/player';
import type {
  ApiTeamSummary, PlayerAvailabilityView, PlayerDetailResponse, PlayerMatchStatLine,
  PlayerRegistrationView, PlayerStatistics, PlayerValuationView,
} from '@/lib/v2/types';

function Tag() {
  return <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>;
}
function Eyebrow({ label, count }: { label: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{label}</p>
      <Tag />
      {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{count}</span>}
    </div>
  );
}
function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}
const th: React.CSSProperties = { textAlign: 'left', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' };
const td: React.CSSProperties = { padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap' };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p style={{ color: 'var(--text)', fontSize: 14, marginTop: 2 }}>{value}</p>
    </div>
  );
}

// ═══ IDENTITY + team/competition context ═════════════════════════════════════════

export function PlayerIdentityHeader({ player, currentTeam, competition, registration }: {
  player: PlayerDetailResponse['player'];
  currentTeam: ApiTeamSummary | null;
  competition: PlayerDetailResponse['competition'];
  registration: PlayerRegistrationView | null;
}) {
  const editionId = registration?.competitionEditionId ?? null;
  return (
    <header className="panel" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{player.fullName}</h1>
      {player.shortName && <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>{player.shortName}</p>}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 8 }}>
        {currentTeam ? <Link href={routes.team(currentTeam)} style={{ color: 'var(--cool)' }}>{currentTeam.name}</Link> : 'No current team'}
        {competition ? <> · <Link href={routes.competition(competition)} style={{ color: 'var(--cool)' }}>{competition.name}</Link></> : null}
        {competition && editionId ? <> · <Link href={routes.edition({ id: editionId, competition: { slug: competition.slug }, seasonLabel: competition.seasonLabel })} style={{ color: 'var(--cool)' }}>{competition.seasonLabel}</Link></> : competition ? ` · ${competition.seasonLabel}` : ''}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginTop: 12 }}>
        <div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Nationality</p>
          <p style={{ color: 'var(--text)', fontSize: 14, marginTop: 2 }}>
            {player.nationalityCode
              ? <Link href={routes.country({ code: player.nationalityCode })} style={{ color: 'var(--cool)' }}>{player.nationalityCode}</Link>
              : '—'}
          </p>
        </div>
        <Fact label="Date of birth" value={orDash(player.dateOfBirth)} />
        <Fact label="Height" value={player.heightCm === null ? '—' : `${player.heightCm} cm`} />
        <Fact label="Preferred foot" value={player.preferredFoot ? player.preferredFoot.toLowerCase() : '—'} />
      </div>
      {/* CONTEXT — current registration as recorded (kind + period). Verbatim; nothing derived. */}
      {registration && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Registration</p>
            <Tag />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginTop: 8 }}>
            <Fact label="Kind" value={orDash(registration.registrationKindCode)} />
            <Fact label="Registered from" value={orDash(registration.registrationFrom)} />
            <Fact label="Registered to" value={orDash(registration.registrationTo)} />
          </div>
        </div>
      )}
    </header>
  );
}

// ═══ AVAILABILITY (single current/most-recent spell) ═════════════════════════════════

export function PlayerAvailabilityPanel({ availability }: { availability: PlayerAvailabilityView | null }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Availability" />
      {!availability ? (
        <EmptyState message="No availability record." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Type</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Expected return</th><th style={th}>Reason</th><th style={th}>Current</th></tr></thead>
            <tbody><tr>
              <td style={td}><span style={{ color: availability.current ? 'var(--risk)' : 'var(--text)' }}>{availability.unavailabilityKindCode}</span></td>
              <td style={td}>{availability.from ? <Kickoff iso={availability.from} /> : '—'}</td>
              <td style={td}>{availability.to ? <Kickoff iso={availability.to} /> : '—'}</td>
              <td style={td}>{availability.expectedReturnOn ? <Kickoff iso={availability.expectedReturnOn} /> : '—'}</td>
              <td style={{ ...td, whiteSpace: 'normal' }}>{orDash(availability.reason)}</td>
              <td style={td}>{availability.current ? '✓' : '—'}</td>
            </tr></tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ STATISTICS (stored provider stats — backend-derived aggregates only) ═══════════

export function PlayerStatisticsPanel({ statistics }: { statistics: PlayerStatistics }) {
  const empty = statistics.matchesRepresented === 0 && statistics.summary.length === 0;
  return (
    <section className="space-y-2">
      <Eyebrow label="Statistics" count={statistics.matchesRepresented} />
      {empty ? (
        <EmptyState message="No stored match statistics for this player." />
      ) : (
        <>
          <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
            <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead><tr><th style={th}>Statistic</th><th style={th}>Matches w/ value</th><th style={th}>Total</th><th style={th}>Mean</th></tr></thead>
              <tbody>
                {statistics.summary.map((s) => (
                  <tr key={s.statisticKey}>
                    <td style={{ ...td, whiteSpace: 'normal' }}>{s.statisticKey}</td>
                    <td style={td}>{s.matchesWithValue}</td>
                    <td style={td}>{orDash(s.numericTotal)}</td>
                    <td style={td}>{orDash(s.numericMean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Totals/means are backend-derived aggregates over stored rows — descriptive, not a governed score.</p>
          {statistics.editions.length > 0 && (
            <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
              <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
                <thead><tr><th style={th}>Competition</th><th style={th}>Season</th><th style={th}>Matches</th></tr></thead>
                <tbody>
                  {statistics.editions.map((e) => (
                    <tr key={e.competitionEditionId}>
                      <td style={td}><Link href={routes.competition(e.competition)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{e.competition.name}</Link></td>
                      <td style={td}><Link href={routes.edition({ id: e.competitionEditionId, competition: { slug: e.competition.slug }, seasonLabel: e.seasonLabel })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{e.seasonLabel}</Link></td>
                      <td style={td}>{e.matches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ═══ MATCH PARTICIPATION (recent stored match lines) ════════════════════════════════

export function PlayerMatchHistory({ recentMatches, currentTeam }: { recentMatches: readonly PlayerMatchStatLine[]; currentTeam: ApiTeamSummary | null }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Match participation" count={recentMatches.length} />
      {recentMatches.length === 0 ? (
        <EmptyState message="No stored match participation." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Season</th><th style={th}>Opponent</th><th style={th}>H/A</th><th style={th}>Score</th></tr></thead>
            <tbody>
              {recentMatches.map((m) => {
                // Link only when we can name the player's side for this fixture (current team);
                // resolution is by trailing fixtureId regardless, but we avoid a misleading pairing.
                const canLink = currentTeam !== null && m.teamId === currentTeam.id;
                return (
                  <Fragment key={m.fixtureId}>
                    <tr>
                      <td style={td}><Kickoff iso={m.kickoffAt} /></td>
                      <td style={td}>{m.seasonLabel}</td>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        {canLink
                          ? <Link href={routes.match(playerMatchFixture(m, currentTeam!.name))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{m.opponentName}</Link>
                          : m.opponentName}
                      </td>
                      <td style={td}>{m.isHome ? 'H' : 'A'}</td>
                      <td style={td}>{m.score ? `${m.score.home}–${m.score.away}` : '—'}</td>
                    </tr>
                    {m.statistics.length > 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0 6px 6px' }}>
                          {/* Per-match provider statistics — verbatim, progressively disclosed. Nothing computed. */}
                          <details>
                            <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{m.statistics.length} statistics</span>
                              <span className="label-cap" style={{ color: 'var(--cool)', fontSize: 9, marginLeft: 6 }}>toggle →</span>
                            </summary>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '2px 12px', marginTop: 6 }}>
                              {m.statistics.map((s) => (
                                <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, borderBottom: '1px solid var(--line)', padding: '1px 0' }}>
                                  <span className="label-cap" style={{ color: 'var(--faint)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.key}>{s.key}</span>
                                  <span className="mono" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>{orDash(s.value)}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ VALUATION (latest only — evidence) ═════════════════════════════════════════════

export function PlayerValuationPanel({ valuation }: { valuation: PlayerValuationView | null }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Valuation" />
      {!valuation ? (
        <EmptyState message="No stored valuation." />
      ) : (
        <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          <Fact label="Amount" value={`${valuation.amount}${valuation.currencyCode ? ` ${valuation.currencyCode}` : ''}`} />
          <Fact label="As of" value={valuation.asOfOn} />
          <Fact label="Source" value={orDash(valuation.sourceCode)} />
        </div>
      )}
    </section>
  );
}

// ═══ COVERAGE (honest present/absent, derived from field presence) ══════════════════

export function PlayerCoverage({ data }: { data: PlayerDetailResponse }) {
  const rows: [string, boolean][] = [
    ['registration', data.registration !== null],
    ['availability', data.availability !== null],
    ['statistics', data.statistics.matchesRepresented > 0],
    ['valuation', data.valuation !== null],
  ];
  return (
    <section className="space-y-2">
      <Eyebrow label="Coverage" />
      <div className="panel" style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {rows.map(([label, present]) => (
          <span key={label} className="label-cap" style={{ fontSize: 10, color: present ? 'var(--edge)' : 'var(--faint)' }}>
            {label}: {present ? 'present' : 'absent'}
          </span>
        ))}
      </div>
    </section>
  );
}
