'use client';
// TEAM HISTORY (Phase E) — the whole recorded period on the History tab.
//
// Season record (temporal-performance season totals), a match-by-match mirrored bar chart
// of goals for / against with a W/D/L strip, the match log (per-fixture observations with
// xG/xGA), curated season statistics with coverage, and an honest earlier-seasons note.
// Everything is read verbatim from GET /teams/{id}/observations and /temporal-performance —
// no forecasts, no fabricated seasons, no zero-filled gaps. The chart carries an aria
// description and the match log is its accessible table equivalent.

import { useState } from 'react';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import type { TeamObservation, TeamTemporalPerformanceResponse } from '@/lib/v2/types';

const LOG_PAGE = 10;

function utcDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function resultColor(r: 'W' | 'D' | 'L' | null): string {
  return r === 'W' ? 'var(--edge)' : r === 'L' ? 'var(--risk)' : r === 'D' ? 'var(--muted)' : 'var(--faint)';
}
function matchFixture(o: TeamObservation, teamName: string) {
  return o.venueSide === 'home'
    ? { fixtureId: o.fixtureId, homeTeam: { name: teamName }, awayTeam: { name: o.opponent.name } }
    : { fixtureId: o.fixtureId, homeTeam: { name: o.opponent.name }, awayTeam: { name: teamName } };
}
function numOrDash(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
}

// Curated season-statistics keys (spec: possession, shots, shots on target, xG, big chances,
// corners, fouls, yellows). Only keys the payload actually supplies are shown.
const SEASON_STAT_SPECS: readonly { key: string; label: string }[] = [
  { key: 'ballPossession', label: 'Possession (avg %)' },
  { key: 'totalShotsOnGoal', label: 'Shots' },
  { key: 'shotsOnGoal', label: 'Shots on target' },
  { key: 'expectedGoals', label: 'xG' },
  { key: 'bigChanceCreated', label: 'Big chances created' },
  { key: 'cornerKicks', label: 'Corners' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'yellowCards', label: 'Yellow cards' },
];

function signedGd(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

// ── match-by-match chart ────────────────────────────────────────────────────────────

function MatchChart({ observations }: { observations: readonly TeamObservation[] }) {
  const n = observations.length;
  if (n === 0) return null;
  const maxGoals = Math.max(1, ...observations.map((o) => Math.max(o.goalsFor ?? 0, o.goalsAgainst ?? 0)));
  const W = Math.max(320, n * 22);
  const H = 120, mid = H / 2, unit = (mid - 14) / maxGoals, bw = Math.max(6, (W / n) * 0.6);
  const wins = observations.filter((o) => o.result === 'W').length;
  const draws = observations.filter((o) => o.result === 'D').length;
  const losses = observations.filter((o) => o.result === 'L').length;
  return (
    <div className="panel" style={{ padding: 12, overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMinYMid meet"
        role="img" aria-label={`Goals for and against, match by match, ${n} matches, oldest to latest. ${wins} wins, ${draws} draws, ${losses} losses. Full detail is in the match log below.`}>
        <line x1="0" y1={mid} x2={W} y2={mid} stroke="var(--line)" strokeWidth="1" />
        {observations.map((o, i) => {
          const cx = (i + 0.5) * (W / n);
          const gf = o.goalsFor ?? 0, ga = o.goalsAgainst ?? 0;
          return (
            <g key={o.fixtureId}>
              <rect x={cx - bw / 2} y={mid - gf * unit} width={bw} height={gf * unit} fill="var(--edge)" opacity="0.85" />
              <rect x={cx - bw / 2} y={mid} width={bw} height={ga * unit} fill="var(--risk)" opacity="0.85" />
              <rect x={cx - bw / 2} y={H - 4} width={bw} height={4} fill={resultColor(o.result)} />
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <span className="label-cap" style={{ color: 'var(--edge)', fontSize: 9 }}>■ Goals for</span>
        <span className="label-cap" style={{ color: 'var(--risk)', fontSize: 9 }}>■ Goals against</span>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Bar under each match = result (W/D/L). Oldest → latest.</span>
      </div>
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────────

export function TeamHistory({ observations, season, teamName }: {
  observations: TeamObservation[];
  season: TeamTemporalPerformanceResponse['season'];
  teamName: string;
}) {
  const [showAll, setShowAll] = useState(false);

  if (observations.length === 0 && !season) {
    return (
      <section className="space-y-2">
        <p className="eyebrow">History</p>
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>Historical data not available yet.</p>
        </div>
      </section>
    );
  }

  const asc = observations; // observations arrive oldest → latest
  const log = [...observations].reverse(); // latest first for the log
  const visible = showAll ? log : log.slice(0, LOG_PAGE);
  const firstDate = asc[0]?.kickoffAt ?? null;
  const metricByKey = new Map((season?.metrics ?? []).map((m) => [m.metric, m]));
  const seasonStats = SEASON_STAT_SPECS.map((s) => ({ spec: s, m: metricByKey.get(s.key) })).filter((x) => x.m);

  const r = season?.results ?? null;

  return (
    <div className="space-y-4">
      {/* Season record */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Season record</p>
          {season && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{season.observationCount} matches · {season.scopeLabel}</span>}
        </div>
        {r ? (
          <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 12 }}>
            {[
              { k: 'W', v: r.wins }, { k: 'D', v: r.draws }, { k: 'L', v: r.losses },
              { k: 'Points', v: r.points }, { k: 'GF', v: r.goalsFor }, { k: 'GA', v: r.goalsAgainst },
              { k: 'GD', v: signedGd(r.goalDifference) },
            ].map((c) => (
              <div key={c.k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{c.v}</span>
                <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{c.k}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel" style={{ padding: 20, textAlign: 'center' }}><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>Season record not available yet.</p></div>
        )}
      </section>

      {/* Match by match */}
      {asc.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow">Match by match</p>
          <MatchChart observations={asc} />
        </section>
      )}

      {/* Match log */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Match log</p>
          <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{log.length}</span>
        </div>
        {log.length === 0 ? (
          <div className="panel" style={{ padding: 20, textAlign: 'center' }}><p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>No completed matches recorded yet.</p></div>
        ) : (
          <>
            <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 520 }}>
                <caption className="sr-only">Match log, latest first. This is the data behind the match-by-match chart.</caption>
                <thead><tr>
                  <th scope="col" style={thL}>Date</th>
                  <th scope="col" style={thL}>Opponent</th>
                  <th scope="col" style={thL}>Competition</th>
                  <th scope="col" style={thR}>Score</th>
                  <th scope="col" style={thR}>xG</th>
                  <th scope="col" style={thR}>xGA</th>
                  <th scope="col" style={thR}>Res</th>
                </tr></thead>
                <tbody>
                  {visible.map((o, i) => (
                    <tr key={o.fixtureId} style={{ background: i % 2 === 0 ? 'color-mix(in srgb, var(--raised) 30%, transparent)' : 'transparent' }}>
                      <td style={tdL} className="tnum">{utcDate(o.kickoffAt)}</td>
                      <td style={{ ...tdL, whiteSpace: 'normal' }}>
                        <Link href={routes.match(matchFixture(o, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{o.venueSide === 'home' ? 'v ' : '@ '}{o.opponent.name}</Link>
                      </td>
                      <td style={{ ...tdL, whiteSpace: 'normal', color: 'var(--text-secondary)' }}>{o.competition.name}</td>
                      <td style={tdR} className="tnum">{o.goalsFor === null || o.goalsAgainst === null ? '—' : `${o.goalsFor}–${o.goalsAgainst}`}</td>
                      <td style={tdR} className="tnum">{numOrDash(o.xg)}</td>
                      <td style={tdR} className="tnum">{numOrDash(o.xga)}</td>
                      <td style={{ ...tdR, color: resultColor(o.result), fontWeight: 700 }} className="mono">{o.result ?? '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {log.length > LOG_PAGE && (
              <button type="button" onClick={() => setShowAll((s) => !s)} className="hover:bg-raised"
                style={{ minHeight: 32, padding: '0 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
                {showAll ? 'Show fewer' : `Show all ${log.length}`}
              </button>
            )}
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Matches without xG coverage (e.g. cup ties) show — for xG / xGA, never a zero.</p>
          </>
        )}
      </section>

      {/* Season statistics */}
      {seasonStats.length > 0 && (
        <section className="space-y-2">
          <p className="eyebrow">Season statistics</p>
          <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {seasonStats.map(({ spec, m }) => (
              <div key={spec.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{spec.label}</span>
                <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700 }}>{numOrDash(m!.value)}</span>
                <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{m!.observations < m!.total ? `${m!.observations} of ${m!.total} matches` : `${m!.total} matches`}</span>
              </div>
            ))}
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Season totals/averages across all competitions, shown with coverage where below the full match count. Descriptive — not a rating.</p>
        </section>
      )}

      {/* Earlier seasons — honest, not faked */}
      <section className="space-y-2">
        <p className="eyebrow">Earlier seasons</p>
        <div className="panel" style={{ padding: 14 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            {firstDate ? `Records for this team start ${utcDate(firstDate)}. No earlier seasons are recorded.` : 'No earlier seasons are recorded.'}
          </p>
        </div>
      </section>
    </div>
  );
}

const thL: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 400, whiteSpace: 'nowrap' };
const thR: React.CSSProperties = { ...thL, textAlign: 'right' };
const tdL: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' };
const tdR: React.CSSProperties = { ...tdL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
