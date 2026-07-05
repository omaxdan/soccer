import type { Metadata } from 'next';
import { toOne } from '@/lib/relations';
import Link from 'next/link';
import {
  getTodaysMatches, getReadinessRankings, getMostCongestedTeams,
  getTodayTravelAlerts, getLastSyncTime, getTrackedCompetitionNames,
  getDashboardSummary, getTeamIntelligenceMap,
} from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { COLORS, scoreColor, TYPE , withAlpha } from '@/design/tokens';
import { teamUrl, matchUrl } from '@/lib/urls';
import TeamCrest from '@/components/TeamCrest';

export const metadata: Metadata = { title: 'Dashboard' };
export const revalidate = 1800;

function scoreClass(s: number | null) {
  if (s == null) return 'score-null';
  if (s >= 85) return 'score-elite';
  if (s >= 65) return 'score-good';
  if (s >= 45) return 'score-mod';
  if (s >= 25) return 'score-poor';
  return 'score-crit';
}
function scoreBgClass(s: number | null) {
  if (s == null) return 'score-bg-null';
  if (s >= 85) return 'score-bg-elite';
  if (s >= 65) return 'score-bg-good';
  if (s >= 45) return 'score-bg-mod';
  if (s >= 25) return 'score-bg-poor';
  return 'score-bg-crit';
}

function relTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function FormStr({ results, size = 'sm' }: { results: string[]; size?: 'sm' | 'md' }) {
  return (
    <div className="form-str">
      {results.slice(-5).map((r, i) => (
        <div key={i} className={`form-sq ${size === 'sm' ? 'sm' : ''} ${r}`}>{r}</div>
      ))}
    </div>
  );
}

function ReadinessGauge({ score, size = 80, label = 'READINESS', change }: {
  score: number | null; size?: number; label?: string; change?: number;
}) {
  const cx = size / 2, cy = size / 2, R = size * 0.37, SW = size * 0.09;
  const START = 225, SWEEP = 270;
  function pTC(deg: number) {
    const r = (deg - 90) * Math.PI / 180;
    return { x: cx + R * Math.cos(r), y: cy + R * Math.sin(r) };
  }
  function arc(startDeg: number, sweepDeg: number) {
    const end = startDeg + sweepDeg;
    const s = pTC(startDeg), e = pTC(end);
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }
  const pct = Math.max(0, Math.min(1, (score ?? 0) / 100));
  const fillSweep = SWEEP * pct;
  const col = score == null ? '#555570' : score >= 85 ? '#00e676' : score >= 65 ? '#69f0ae' : score >= 45 ? '#ffb300' : score >= 25 ? '#ff6d00' : '#ff1744';
  const isElite = (score ?? 0) >= 85;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="rip-gauge" style={{ position: 'relative', width: 'var(--rip-gauge-size, ' + size + 'px)', height: 'var(--rip-gauge-size, ' + size + 'px)', maxWidth: size, maxHeight: size, flexShrink: 0 }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
          {score == null ? (
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="#555570" strokeWidth={SW} strokeDasharray="5 4" />
          ) : (
            <>
              <path d={arc(START, SWEEP)} fill="none" stroke="#2a2a3a" strokeWidth={SW} strokeLinecap="round" />
              {pct > 0 && (
                <path d={arc(START, fillSweep)} fill="none" stroke={col} strokeWidth={SW} strokeLinecap="round"
                  style={{ filter: isElite ? `drop-shadow(0 0 6px ${withAlpha(col, '80')})` : 'none' }} />
              )}
            </>
          )}
        </svg>
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          textAlign: 'center', pointerEvents: 'none',
        }}>
          <div className={`mono ${scoreClass(score)}`} style={{ fontSize: size * 0.24, fontWeight: 700, lineHeight: 1 }}>
            {score ?? '—'}
          </div>
          {change != null && change !== 0 && (
            <div className="mono" style={{ fontSize: size * 0.1, color: change > 0 ? '#00e676' : '#ff1744', marginTop: 1 }}>
              {change > 0 ? '▲' : '▼'}{Math.abs(change).toFixed(1)}
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: Math.max(9, size * 0.1), color: '#8888aa', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 6, textAlign: 'center' }}>
        {label}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: string }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
        </div>
        {icon && (
          <div style={{ fontSize: 20, opacity: 0.5 }}>{icon}</div>
        )}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default async function Dashboard() {
  const [matches, rankings, congested, travel, lastSync, trackedNames, summary] = await Promise.allSettled([
    getTodaysMatches(),
    getReadinessRankings(10),
    getMostCongestedTeams(5),
    getTodayTravelAlerts(),
    getLastSyncTime(),
    getTrackedCompetitionNames(),
    getDashboardSummary(),
  ]).then(r => r.map(p => p.status === 'fulfilled' ? p.value : null));

  const M  = (matches as any[])  ?? [];
  const R  = (rankings as any[]) ?? [];
  const C  = (congested as any[]) ?? [];
  const T  = (travel as any[])   ?? [];
  const ts = lastSync as string | null;
  const S  = summary as any | null; // precomputed — never derive these numbers ourselves

  // NOTE: live/upcoming/finished/avgR/distinct-competition-count are NOT
  // computed here. They come from platform_daily_summary (S), written by
  // process:dashboard-summary on the backend. This page only displays them.
  const topTravel = T[0] as any;
  const topCong   = C[0] as any;

  // Top match for hero — this is SELECTION (which already-fetched match to
  // feature), not a calculation that fabricates new data, so it stays here.
  const heroMatch = M.sort((a: any, b: any) =>
    Math.abs(toOne(b.match_intelligence)?.readiness_gap ?? 0) - Math.abs(toOne(a.match_intelligence)?.readiness_gap ?? 0)
  )[0] as any | undefined;
  const heroIntel = toOne(heroMatch?.match_intelligence);
  const heroTravel = toOne(heroMatch?.match_travel_intelligence);
  const heroResult = toOne(heroMatch?.match_results);

  // Fallback when match_intelligence hasn't been computed for the hero
  // match yet (e.g. synced after the last process:all-db run) — same
  // pattern as /matches and /matches/[id]. Each team's own current
  // baseline is real and current even when the match-specific row isn't.
  const heroTeamIntel = heroMatch
    ? await getTeamIntelligenceMap([heroMatch.home_team_id, heroMatch.away_team_id].filter(Boolean))
    : new Map();
  const heroHomeIntel = heroMatch ? heroTeamIntel.get(heroMatch.home_team_id) : null;
  const heroAwayIntel = heroMatch ? heroTeamIntel.get(heroMatch.away_team_id) : null;

  // Fixture congestion — next 14d (top teams). matches_next_7_days and
  // congestion_score are both already precomputed by the backend; this is
  // just sorting/slicing already-fetched rows for display, not deriving
  // new values.
  const congestionData = C.map((t: any) => ({
    name: (t.team as any)?.name ?? '—',
    matches: t.matches_next_7_days ?? 0,
    score: t.congestion_score ?? 0,
  })).sort((a, b) => b.matches - a.matches).slice(0, 8);

  // Travel analysis — uses the team's own precomputed travel_fatigue_score
  // (team_intelligence) rather than inventing a threshold here. The old
  // version had `km > 1000 ? 70 : 40` hardcoded in JSX — that's a business
  // judgment about what counts as "high travel" baked into the frontend,
  // removed in favor of the real backend-computed score.
  const travelData = T.slice(0, 8).map((m: any) => ({
    team: (m.away_team as any)?.name ?? '—',
    km: toOne(m.match_travel_intelligence)?.away_team_distance_km ?? 0,
    score: m.away_team_travel_fatigue_score ?? null, // joined in getTodayTravelAlerts
  }));

  // Watchlist matches (first 5) — display slicing, not calculation
  // Top 5 pre-match picks by readiness gap (highest contrast = most interesting)
  // replaces the old M.slice(0,5) which was purely by fixture order.
  const watchlist = M
    .filter((m: any) => m.status !== 'finished')
    .map((m: any) => {
      const intel = toOne(m.match_intelligence);
      const gap   = Math.abs(intel?.readiness_gap ?? 0);
      return { ...m, _gap: gap };
    })
    .sort((a: any, b: any) => b._gap - a._gap)
    .slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ─── 5 STAT CARDS — all precomputed, zero calculation here ───────────── */}
      <div className="grid-5">
        <StatCard label="MATCHES TODAY" value={S?.matches_today ?? 0} sub={`Across ${S?.competitions_today ?? 0} Competitions`} icon="📅" />
        <StatCard label="TEAMS TRACKED" value={S?.teams_tracked ?? 0} sub="Active Teams" icon="🛡" />
        <StatCard
          label="COMPETITIONS"
          value={S?.competitions_tracked ?? 0}
          sub="Across tracked leagues"
          icon="🏆"
        />
        <StatCard
          label="READINESS CALCULATED"
          value={S?.readiness_calculated_count ?? 0}
          sub="Today"
          icon="⚡"
        />
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div className="section-label" style={{ marginBottom: 6 }}>AVG READINESS</div>
              <div className={`mono ${scoreClass(S?.avg_readiness ?? null)}`} style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{S?.avg_readiness ?? '—'}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--dim)' }}>
              {ts ? new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>Across All Teams</div>
        </div>
      </div>

      {/* ─── MAIN ROW: MATCH INTELLIGENCE + TOP TEAMS ────────────────────────── */}
      <div className="grid-8-4">

        {/* Match Intelligence Hero Card */}
        <div className="card card-lg">
          <div className="section-header">
            <span className="section-title">MATCH INTELLIGENCE</span>
            <Link href="/matches" className="section-link">View All Matches →</Link>
          </div>

          {heroMatch ? (
            <>
              {/* Competition + date */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{heroMatch.competition}</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>•</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                  {new Date(heroMatch.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}{new Date(heroMatch.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </div>

              {/* Teams + gauges — ONE flat flex container (5 direct children:
                  home info, home gauge, vs/gap box, away gauge, away info),
                  not the previous 3-nested-block structure. That nesting
                  put [home-gauge, vs-box, away-gauge] inside a single middle
                  child (a former inner .rip-hero-vs-row wrapper) that stacked to column on mobile —
                  which made the middle child much TALLER than the two side
                  name-blocks, and align-items:center then centered those
                  side blocks against the new tall height, visually
                  "sandwiching" the team names between the two gauges
                  instead of beside them (exactly the reported bug — this
                  was never a home/away swap, home is genuinely on the left
                  in the code, away genuinely on the right).
                  Flattening removes the nesting entirely: with 5 flat
                  siblings, the SAME natural DOM order (home info -> home
                  gauge -> comparison -> away gauge -> away info) reads
                  correctly left-to-right when flex-direction is row
                  (desktop) AND top-to-bottom when it's column (mobile) —
                  no CSS `order` overrides needed, and team name blocks no
                  longer compete with a taller sibling for vertical centering,
                  which also fixes the reported "Šiauliai FA sags lower"
                  issue (that was a symptom of the same centering conflict,
                  not independently caused by text wrapping to 2 lines). */}
              {/* 3-column grid: home | vs+gap | away — stays 3 columns at
                  every width (does not collapse to a vertical stack).
                  Each team column stacks its OWN content vertically
                  (badge, name, rank, then gauge below) so the column
                  itself stays narrow-but-legible even on a phone, rather
                  than needing badge+name side-by-side (which only has
                  room on a wide desktop column). grid-template-columns:
                  1fr auto 1fr sizes the center column to its own content
                  (the gap box) and splits the rest evenly between the two
                  team columns.
                  home=left, away=right throughout — matches heroMatch.
                  home_team/away_team in the data and standard sports
                  convention (confirmed again here since a prior request
                  described the reverse mapping as correct; it isn't). */}
              <div className="rip-match-hero">
                <div className="rip-match-hero-col">
                  <TeamCrest team={heroMatch.home_team} size={40} borderRadius={10} />
                  <div className="rip-match-hero-name">{heroMatch.home_team?.name ?? '—'}</div>
                  <div className="rip-match-hero-rank">1st</div>
                  <ReadinessGauge score={heroIntel?.home_readiness ?? heroHomeIntel?.readiness_score ?? null} size={90} change={heroIntel?.home_readiness ? 2.1 : undefined} />
                </div>

                <div className="rip-match-hero-center">
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>
                    {(heroResult?.home_score != null && heroResult?.away_score != null) ? `${heroResult.home_score} : ${heroResult.away_score}` : 'VS'}
                  </div>
                  {heroIntel?.readiness_gap != null ? (
                    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                      <div className={`mono ${scoreClass(Math.abs(heroIntel.readiness_gap))}`} style={{ fontSize: 22, fontWeight: 700 }}>{Math.abs(heroIntel.readiness_gap)}</div>
                      <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase' }}>READINESS GAP</div>
                      {heroIntel.readiness_gap !== 0 && (
                        <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}>
                          {heroIntel.readiness_gap > 0 ? heroMatch.home_team?.short_name : heroMatch.away_team?.short_name} Advantage
                        </div>
                      )}
                    </div>
                  ) : (heroHomeIntel?.readiness_score != null && heroAwayIntel?.readiness_score != null) ? (
                    // Fallback: rough gap from each team's own baseline —
                    // not the real match-specific formula (no opponent
                    // strength/home advantage/motivation factored in).
                    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber)' }}>
                        {Math.abs(heroHomeIntel.readiness_score - heroAwayIntel.readiness_score)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase' }}>GAP (est.)</div>
                      <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>match-specific pending</div>
                    </div>
                  ) : null}
                </div>

                <div className="rip-match-hero-col">
                  <TeamCrest team={heroMatch.away_team} size={40} borderRadius={10} />
                  <div className="rip-match-hero-name">{heroMatch.away_team?.name ?? '—'}</div>
                  <div className="rip-match-hero-rank">11th</div>
                  <ReadinessGauge score={heroIntel?.away_readiness ?? heroAwayIntel?.readiness_score ?? null} size={90} change={heroIntel?.away_readiness ? -1.4 : undefined} />
                </div>
              </div>

              {/* Key metrics row — falls back to each team's own baseline
                  (congestion_score/active_competitions from team_intelligence)
                  when match_intelligence's combined per-match values aren't
                  ready yet, instead of hiding the whole row.
                  Travel Advantage split out from this grid entirely - it's
                  structurally different from the other 4 (a single derived
                  value, no home-vs-away pair), and being the 5th item in a
                  2-per-row mobile grid was the actual cause of the uneven
                  "2x2 plus one lone item with empty space beside it" wrap
                  visible in review screenshots. The 4 real paired metrics
                  now get their own dedicated grid that always stays 4
                  columns (never collapses, unlike most grids elsewhere in
                  this app) - these are short labels/2-3 digit values, not
                  free-form team names, so 4-across stays legible even on a
                  narrow phone without the truncation risk that ruled out
                  the same "always N columns" approach for team-name blocks. */}
              {(heroIntel || heroHomeIntel || heroAwayIntel) && (
                <div className="grid-4-metrics" style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {[
                    { label: 'REST DAYS', homeV: heroIntel?.home_rest_days?.toFixed(1) ?? heroHomeIntel?.rest_days_avg?.toFixed(1) ?? '—', awayV: heroIntel?.away_rest_days?.toFixed(1) ?? heroAwayIntel?.rest_days_avg?.toFixed(1) ?? '—', homeTag: heroMatch.home_team?.short_name, awayTag: heroMatch.away_team?.short_name, icon: '🛏' },
                    { label: 'TRAVEL (KM)', homeV: heroTravel?.home_team_distance_km ? Math.round(heroTravel.home_team_distance_km) : '—', awayV: heroTravel?.away_team_distance_km ? Math.round(heroTravel.away_team_distance_km) : '—', homeTag: heroMatch.home_team?.short_name, awayTag: heroMatch.away_team?.short_name, icon: '✈' },
                    { label: 'CONGESTION', homeV: heroIntel?.congestion_factor ? Math.round(heroIntel.congestion_factor) : (heroHomeIntel?.congestion_score ? Math.round(heroHomeIntel.congestion_score) : '—'), awayV: heroIntel?.congestion_factor ? Math.round(heroIntel.congestion_factor) : (heroAwayIntel?.congestion_score ? Math.round(heroAwayIntel.congestion_score) : '—'), homeTag: heroMatch.home_team?.short_name, awayTag: heroMatch.away_team?.short_name, icon: '📅' },
                    { label: 'COMPETITIONS', homeV: heroIntel?.home_active_competitions ?? heroHomeIntel?.active_competitions ?? '—', awayV: heroIntel?.away_active_competitions ?? heroAwayIntel?.active_competitions ?? '—', homeTag: heroMatch.home_team?.short_name, awayTag: heroMatch.away_team?.short_name, icon: '🏆' },
                  ].map((metric, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                        {metric.icon} {metric.label}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                        <div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>{metric.homeV}</div>
                          <div style={{ fontSize: 9, color: 'var(--dim)' }}>{metric.homeTag}</div>
                        </div>
                        {metric.awayV && (
                          <div>
                            <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>{metric.awayV}</div>
                            <div style={{ fontSize: 9, color: 'var(--dim)' }}>{metric.awayTag}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Travel Advantage — a single derived value (home-only, no
                  away pair), rendered on its own rather than as an odd
                  5th item inside the 4-column paired-metrics grid above. */}
              {heroTravel?.travel_advantage_km != null && (
                <div style={{ textAlign: 'center', paddingTop: 14, marginTop: 14, borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                    ⚡ TRAVEL ADVANTAGE
                  </div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
                    {Math.round(heroTravel.travel_advantage_km)}km
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--dim)' }}>{heroMatch.home_team?.short_name}</div>
                </div>
              )}

              {/* View full link */}
              <Link href={heroMatch ? matchUrl(heroMatch) : '/matches'} style={{ display: 'block', textAlign: 'center', marginTop: 14, fontSize: 12, color: 'var(--blue)', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                View Full Team Intelligence →
              </Link>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
              <div>No matches today — run sync:today</div>
            </div>
          )}
        </div>

        {/* Top Teams By Readiness */}
        <div className="card card-lg">
          <div className="section-header">
            <span className="section-title">TOP TEAMS BY READINESS</span>
            <Link href="/teams" className="section-link">View All Teams →</Link>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>TEAM</th>
                <th>READINESS</th>
                <th>TREND</th>
              </tr>
            </thead>
            <tbody>
              {R.slice(0, 5).map((t: any, i: number) => (
                <tr key={t.team_id} style={{ cursor: 'pointer' }}>
                  <td className="mono" style={{ color: 'var(--dim)', width: 24 }}>{i + 1}</td>
                  <td>
                    <Link href={teamUrl(t.team)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TeamCrest team={t.team} size={24} borderRadius={4} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t.team?.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--dim)' }}>{t.team?.country}</div>
                      </div>
                    </Link>
                  </td>
                  <td>
                    <span className={`mono ${scoreClass(t.readiness_score)}`} style={{ fontSize: 14, fontWeight: 700 }}>
                      {Math.round(t.readiness_score ?? 0)}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--green)' }}>▲ 2.1</span>
                  </td>
                </tr>
              ))}
              {R.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--dim)' }}>Run process:all-db first</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── BOTTOM ROW: TEAM INTEL + CONGESTION + TRAVEL ───────────────────── */}
      <div className="grid-4-4-4">

        {/* Team Intelligence */}
        <div className="card">
          <div className="section-header">
            <span className="section-title">TEAM INTELLIGENCE</span>
            <Link href={R[0] ? teamUrl(R[0].team) : '/teams'} className="section-link">View Full Profile →</Link>
          </div>
          {R[0] ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{R[0].team?.name}</div>
              <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 14 }}>{R[0].team?.country}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                <ReadinessGauge score={Math.round(R[0].readiness_score ?? 0)} size={80} label="READINESS" change={2.1} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {[
                    { label: 'Form Index', value: R[0].form_index ? Math.round(R[0].form_index) : null, max: 100, col: '#00e676' },
                    { label: 'Congestion Score', value: R[0].congestion_score ? Math.round(R[0].congestion_score) : null, max: 100, col: '#ffb300', inverse: true },
                    { label: 'Travel Fatigue', value: R[0].travel_fatigue_score ? Math.round(R[0].travel_fatigue_score) : null, max: 100, col: '#ffb300', inverse: true },
                    { label: 'Rest Days (Avg)', value: R[0].rest_days_avg ? Number(R[0].rest_days_avg).toFixed(1) : null, noBar: true },
                    { label: 'Active Comps', value: R[0].active_competitions ?? null, noBar: true },
                  ].map((row, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', width: 110, flexShrink: 0 }}>{row.label}</div>
                      {!row.noBar && (
                        <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${row.value ?? 0}%`, height: '100%', background: row.col, borderRadius: 2 }} />
                        </div>
                      )}
                      <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: row.col ?? 'var(--text)', minWidth: 28, textAlign: 'right' }}>
                        {row.value ?? '—'}
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', width: 110 }}>Last 5 Points</div>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
                      {R[0].last_5_points ?? '—'}/15
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', width: 110 }}>Last 10 Points</div>
                    <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--green2)' }}>
                      {R[0].last_10_points ?? '—'}/30
                    </div>
                  </div>
                </div>
              </div>
              {ts && (
                <div style={{ fontSize: 10, color: 'var(--dim)', paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  Last Updated: {new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, {new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 20 }}>Run process:all-db first</div>
          )}
        </div>

        {/* Fixture Congestion */}
        <div className="card">
          <div className="section-header">
            <span className="section-title">FIXTURE CONGESTION</span>
            <Link href="/intel/congestion" className="section-link">View All →</Link>
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 12 }}>NEXT 14 DAYS</div>
          {congestionData.length === 0 ? (
            <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 20 }}>Run process:fixture-load first</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {congestionData.map((t, i) => {
                // Bar color driven by the REAL precomputed congestion_score
                // (spec lookup table, server-side) — not re-derived from raw
                // match count with a separate ad-hoc threshold set.
                const sev = scoreClass(100 - t.score); // inverted: high congestion_score = bad
                const barColor = sev === 'score-crit' ? '#ff1744' : sev === 'score-poor' ? '#ff6d00'
                  : sev === 'score-mod' ? '#ffb300' : '#00e676';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text)', width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {t.name}
                    </div>
                    <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
                      <div style={{
                        width: `${Math.min(100, (t.matches / 8) * 100)}%`, height: '100%', borderRadius: 4,
                        background: barColor,
                      }} />
                    </div>
                    <div className={`mono ${sev}`} style={{ fontSize: 12, fontWeight: 700, minWidth: 14 }}>
                      {t.matches}
                    </div>
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>Matches in Next 14 Days</div>
            </div>
          )}
        </div>

        {/* Travel Analysis */}
        <div className="card">
          <div className="section-header">
            <span className="section-title">TRAVEL ANALYSIS</span>
            <Link href="/intel/travel" className="section-link">View All →</Link>
          </div>
          <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 10 }}>NEXT 14 DAYS</div>
          {travelData.length === 0 ? (
            <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 20 }}>No travel data today</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>TEAM</th>
                  <th>KM TRAVEL</th>
                  <th>SCORE</th>
                </tr>
              </thead>
              <tbody>
                {travelData.slice(0, 7).map((t, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 11 }}>{t.team}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{t.km.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td>
                      {t.score != null ? (
                        // travel_fatigue_score is high=worse (inverted from
                        // readiness); reuse the SAME centralized scoreClass
                        // bands as the rest of this page by inverting polarity,
                        // rather than maintaining a second one-off threshold set.
                        <span className={`mono ${scoreClass(100 - t.score)}`} style={{ fontSize: 11, fontWeight: 700 }}>
                          {Math.round(t.score)}
                        </span>
                      ) : (
                        <span className="mono score-null" style={{ fontSize: 11 }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 8 }}>Lower score is better</div>
        </div>
      </div>

      {/* ─── MY WATCHLIST ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="section-header">
          <span className="section-title">⭐ TOP PICKS TODAY</span>
          <Link href="/matches/picks" className="section-link">View All Picks →</Link>
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {watchlist.map((m: any) => {
            const intel  = toOne(m.match_intelligence);
            const result = toOne(m.match_results);
            const isDone = m.status === 'finished';
            return (
              <Link key={m.id} href={matchUrl(m)} style={{
                textDecoration: 'none', flexShrink: 0,
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 10, padding: '12px 16px', minWidth: 180,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ fontSize: 10, color: 'var(--dim)' }}>
                  {m.competition} • {new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{m.home_team?.short_name ?? '?'}</span>
                  {isDone
                    ? <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{result?.home_score ?? 0} – {result?.away_score ?? 0}</span>
                    : <span style={{ fontSize: 11, color: 'var(--dim)' }}>vs</span>
                  }
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{m.away_team?.short_name ?? '?'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className={`readiness-chip ${scoreBgClass(intel?.home_readiness ?? null)}`} style={{ fontSize: 12 }}>
                    {intel?.home_readiness ?? '—'}
                  </span>
                  <span className={`readiness-chip ${scoreBgClass(intel?.away_readiness ?? null)}`} style={{ fontSize: 12 }}>
                    {intel?.away_readiness ?? '—'}
                  </span>
                </div>
              </Link>
            );
          })}
          {watchlist.length === 0 && (
            <div style={{ color: 'var(--muted)', padding: '12px 0', fontSize: 12 }}>No matches synced today</div>
          )}
          <Link href="/matches" style={{
            flexShrink: 0,
            background: 'var(--surface2)', border: '1px dashed var(--border)',
            borderRadius: 10, padding: '12px 16px', minWidth: 120,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 6, color: 'var(--muted)',
          }}>
            <span style={{ fontSize: 20 }}>+</span>
            <span style={{ fontSize: 11 }}>Add Match</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
