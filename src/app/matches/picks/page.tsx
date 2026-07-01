import { getTodaysMatches, getMatchesForDate, getTeamIntelligenceMap } from '@/lib/queries';
import { computeMatchSignals } from '@/lib/signals';
import { matchUrl, teamUrl } from '@/lib/urls';
import { COLORS, scoreColor } from '@/design/tokens';
import Link from 'next/link';

export const metadata = { title: 'Match Picks — NinetyData' };
export const revalidate = 1800;

// ── Scoring ────────────────────────────────────────────────────────────────
// Each match gets a composite "intelligence score" that measures how much
// actionable signal it has — not which team is "better", but how much
// CONTRAST there is between the two sides across all dimensions.
// A match where both teams have identical readiness/form/travel is low-value
// from a tipster perspective even if both are strong teams.

interface ScoredMatch {
  match: any;
  intel: any;
  homeIntel: any;
  awayIntel: any;
  travel: any;
  signals: any[];
  scores: {
    readinessGap: number;   // 0–40  — primary driver
    restEdge: number;       // 0–20  — rest day differential
    travelBurden: number;   // 0–20  — away travel disadvantage
    congestion: number;     // 0–10  — fixture congestion contrast
    formContrast: number;   // 0–10  — form index differential
    total: number;          // 0–100
  };
  tier: 'STRONG' | 'MODERATE' | 'WEAK';
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function toUTCDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatDisplayDate(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === shiftDate(todayStr, 1)) return 'Tomorrow';
  if (dateStr === shiftDate(todayStr, -1)) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00Z')
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function scoreMatch(m: any, homeIntel: any, awayIntel: any): ScoredMatch['scores'] {
  const intel  = m.match_intelligence?.[0];
  const travel = m.match_travel_intelligence?.[0];

  // Readiness gap — most important signal (0–40 pts)
  const gap = Math.abs(
    intel?.readiness_gap ??
    ((homeIntel?.readiness_score ?? 0) - (awayIntel?.readiness_score ?? 0))
  );
  const readinessGap = Math.min(40, Math.round(gap * 1.5));

  // Rest edge — rest day differential (0–20 pts)
  const restDiff = Math.abs((intel?.home_rest_days ?? homeIntel?.rest_days_avg ?? 0)
    - (intel?.away_rest_days ?? awayIntel?.rest_days_avg ?? 0));
  const restEdge = Math.min(20, Math.round(restDiff * 5));

  // Travel burden — away team distance creates real disadvantage (0–20 pts)
  const awayKm = travel?.away_team_distance_km ?? intel?.away_travel_distance_km ?? 0;
  const travelBurden = awayKm > 1500 ? 20
    : awayKm > 800 ? 14
    : awayKm > 400 ? 7
    : 0;

  // Congestion contrast — one team significantly more congested (0–10 pts)
  const homeCong = homeIntel?.congestion_score ?? 0;
  const awayCong = awayIntel?.congestion_score ?? 0;
  const congestion = Math.min(10, Math.round(Math.abs(homeCong - awayCong) / 10));

  // Form contrast — clear form differential between sides (0–10 pts)
  const homeForm = homeIntel?.form_index ?? 0;
  const awayForm = awayIntel?.form_index ?? 0;
  const formContrast = Math.min(10, Math.round(Math.abs(homeForm - awayForm) / 8));

  const total = readinessGap + restEdge + travelBurden + congestion + formContrast;
  return { readinessGap, restEdge, travelBurden, congestion, formContrast, total };
}

function tier(total: number): ScoredMatch['tier'] {
  if (total >= 45) return 'STRONG';
  if (total >= 25) return 'MODERATE';
  return 'WEAK';
}

const TIER_COLOR   = { STRONG: '#00e676', MODERATE: '#ffb300', WEAK: '#555570' };
const TIER_BG      = { STRONG: '#00e67615', MODERATE: '#ffb30015', WEAK: 'transparent' };
const TIER_BORDER  = { STRONG: '#00e67630', MODERATE: '#ffb30030', WEAK: 'var(--border)' };

// ── Page ───────────────────────────────────────────────────────────────────

export default async function MatchPicksPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tier?: string }>;
}) {
  const params     = await searchParams;
  const todayStr   = toUTCDateStr(new Date());
  const prevDate   = shiftDate(todayStr, -1);
  const nextDate   = shiftDate(todayStr, 1);

  // Resolve and validate date param (same ±7 day window as matches page)
  let activeDateStr = todayStr;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    const diff = Math.round(
      (new Date(params.date + 'T12:00:00Z').getTime() - new Date(todayStr + 'T12:00:00Z').getTime()) / 86400000
    );
    if (diff >= -7 && diff <= 7) activeDateStr = params.date;
  }

  const tierFilter = (params.tier ?? 'all').toUpperCase() as 'STRONG' | 'MODERATE' | 'ALL';
  const isToday    = activeDateStr === todayStr;

  const rawMatches = await (isToday
    ? getTodaysMatches()
    : getMatchesForDate(activeDateStr)
  ).catch(() => []);

  const teamIds = (rawMatches as any[]).flatMap((m: any) => [m.home_team_id, m.away_team_id]).filter(Boolean);
  const tiMap   = await getTeamIntelligenceMap(teamIds);

  // Score, classify and sort every match
  const scored: ScoredMatch[] = (rawMatches as any[])
    .filter((m: any) => m.status !== 'finished') // picks are pre-match only
    .map((m: any) => {
      const intel     = m.match_intelligence?.[0];
      const travel    = m.match_travel_intelligence?.[0];
      const homeIntel = tiMap.get(m.home_team_id);
      const awayIntel = tiMap.get(m.away_team_id);
      const scores    = scoreMatch(m, homeIntel, awayIntel);
      const matchTier = tier(scores.total);

      const signals = computeMatchSignals({
        home_readiness: intel?.home_readiness ?? homeIntel?.readiness_score,
        away_readiness: intel?.away_readiness ?? awayIntel?.readiness_score,
        readiness_gap:  intel?.readiness_gap,
        congestion_factor: intel?.congestion_factor,
        home_rest_days: intel?.home_rest_days ?? homeIntel?.rest_days_avg,
        away_rest_days: intel?.away_rest_days ?? awayIntel?.rest_days_avg,
        home_travel_distance_km: intel?.home_travel_distance_km,
        away_travel_distance_km: intel?.away_travel_distance_km,
        home_active_competitions: intel?.home_active_competitions ?? homeIntel?.active_competitions,
        away_active_competitions: intel?.away_active_competitions ?? awayIntel?.active_competitions,
        home_form_index:    homeIntel?.form_index,
        away_form_index:    awayIntel?.form_index,
        home_travel_fatigue: homeIntel?.travel_fatigue_score,
        away_travel_fatigue: awayIntel?.travel_fatigue_score,
        home_congestion:    homeIntel?.congestion_score,
        away_congestion:    awayIntel?.congestion_score,
        home_last_5_pts:    homeIntel?.last_5_points,
        away_last_5_pts:    awayIntel?.last_5_points,
        home_squad_depth:   homeIntel?.squad_depth_score,
        away_squad_depth:   awayIntel?.squad_depth_score,
        home_injury_burden: homeIntel?.injury_burden_score,
        away_injury_burden: awayIntel?.injury_burden_score,
        home_squad_stability: homeIntel?.squad_stability_score,
        away_squad_stability: awayIntel?.squad_stability_score,
        travel_advantage_km: travel?.travel_advantage_km,
      });

      return { match: m, intel, homeIntel, awayIntel, travel, signals, scores, tier: matchTier };
    })
    .sort((a, b) => b.scores.total - a.scores.total);

  const filtered = tierFilter === 'ALL'
    ? scored
    : scored.filter(s => s.tier === tierFilter);

  const strongCount    = scored.filter(s => s.tier === 'STRONG').length;
  const moderateCount  = scored.filter(s => s.tier === 'MODERATE').length;
  const displayDate    = formatDisplayDate(activeDateStr, todayStr);

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>
            🎯 Match Picks
          </div>
          <Link href="/matches" style={{ fontSize: 11, color: 'var(--dim)', textDecoration: 'none' }}>
            View Intelligence Table →
          </Link>
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 4 }}>
          {displayDate} · Matches ranked by intelligence signal strength
        </div>
      </div>

      {/* Date nav pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[-3, -2, -1, 0, 1, 2, 3].map(offset => {
          const ds    = shiftDate(todayStr, offset);
          const label = offset === 0 ? 'Today'
            : offset === 1 ? 'Tomorrow'
            : offset === -1 ? 'Yesterday'
            : new Date(ds + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          const active = ds === activeDateStr;
          return (
            <Link key={ds}
              href={ds === todayStr ? '/matches/picks' : `/matches/picks?date=${ds}${tierFilter !== 'ALL' ? `&tier=${params.tier}` : ''}`}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, textDecoration: 'none',
                fontWeight: active ? 700 : 400,
                background: active ? '#6060cc' : 'var(--surface2)',
                color: active ? '#fff' : 'var(--dim)',
                border: `1px solid ${active ? '#6060cc' : 'var(--border)'}`,
              }}
            >{label}</Link>
          );
        })}
      </div>

      {/* Tier filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filter:</span>
        {(['ALL', 'STRONG', 'MODERATE'] as const).map(t => {
          const active = (tierFilter === 'ALL' && t === 'ALL') || tierFilter === t;
          const count  = t === 'ALL' ? scored.length : t === 'STRONG' ? strongCount : moderateCount;
          return (
            <Link key={t}
              href={`/matches/picks${activeDateStr !== todayStr ? `?date=${activeDateStr}&` : '?'}tier=${t.toLowerCase()}`}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 11, textDecoration: 'none',
                fontWeight: active ? 700 : 400,
                background: active ? (t === 'STRONG' ? '#00e67625' : t === 'MODERATE' ? '#ffb30025' : 'var(--surface2)') : 'transparent',
                color: active ? (t === 'STRONG' ? '#00e676' : t === 'MODERATE' ? '#ffb300' : 'var(--text)') : 'var(--dim)',
                border: `1px solid ${active ? (t === 'STRONG' ? '#00e67640' : t === 'MODERATE' ? '#ffb30040' : 'var(--border)') : 'transparent'}`,
              }}
            >{t} ({count})</Link>
          );
        })}
      </div>

      {/* Match cards */}
      {filtered.length === 0 && (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
          {scored.length === 0
            ? `No pre-match fixtures for ${displayDate} — try syncing: sync:today`
            : `No ${tierFilter.toLowerCase()} signal matches for ${displayDate}`}
        </div>
      )}

      {filtered.map(({ match: m, intel, homeIntel, awayIntel, signals, scores, tier: matchTier }) => {
        const gap = Math.abs(intel?.readiness_gap ?? ((homeIntel?.readiness_score ?? 0) - (awayIntel?.readiness_score ?? 0)));
        const advantageSide = (intel?.readiness_gap ?? ((homeIntel?.readiness_score ?? 0) - (awayIntel?.readiness_score ?? 0))) > 0 ? 'home' : 'away';
        const time = new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
        const topSignals = signals.filter((s: any) => s.strength >= 3).slice(0, 3);
        const homeR = intel?.home_readiness ?? homeIntel?.readiness_score;
        const awayR = intel?.away_readiness ?? awayIntel?.readiness_score;

        return (
          <div key={m.id} style={{
            background: TIER_BG[matchTier], border: `1px solid ${TIER_BORDER[matchTier]}`,
            borderRadius: 12, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Row 1: tier badge + competition + time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                color: TIER_COLOR[matchTier], background: TIER_COLOR[matchTier] + '20',
                border: `1px solid ${TIER_COLOR[matchTier]}40`,
                borderRadius: 4, padding: '2px 8px',
              }}>{matchTier}</span>
              <span style={{ fontSize: 11, color: 'var(--dim)' }}>{m.competition}</span>
              <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', fontSize: 11, color: 'var(--dim)' }}>{time}</span>
            </div>

            {/* Row 2: teams + readiness gauges + score bar */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16, alignItems: 'center' }}>
              {/* Home */}
              <div>
                <Link href={teamUrl(m.home_team)} style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', textDecoration: 'none' }}>
                  {m.home_team?.name}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 22, fontWeight: 800, color: scoreColor(homeR) }}>
                    {homeR != null ? Math.round(homeR) : '—'}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase' }}>READINESS</div>
                  {homeR != null && (
                    <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 4 }}>
                      <div style={{ width: `${homeR}%`, height: '100%', background: scoreColor(homeR), borderRadius: 4 }} />
                    </div>
                  )}
                </div>
              </div>

              {/* Gap indicator */}
              <div style={{ textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 4 }}>GAP</div>
                <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 24, fontWeight: 800, color: scoreColor(Math.min(100, gap * 2)) }}>
                  {Math.round(gap)}
                </div>
                <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>
                  {advantageSide === 'home' ? (m.home_team?.short_name ?? 'Home') : (m.away_team?.short_name ?? 'Away')} edge
                </div>
                <Link href={matchUrl(m)} style={{
                  display: 'inline-block', marginTop: 8,
                  fontSize: 10, color: 'var(--blue)', textDecoration: 'none',
                }}>Full Intel →</Link>
              </div>

              {/* Away */}
              <div style={{ textAlign: 'right' }}>
                <Link href={teamUrl(m.away_team)} style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', textDecoration: 'none' }}>
                  {m.away_team?.name}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
                  {awayR != null && (
                    <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 4, display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ width: `${awayR}%`, height: '100%', background: scoreColor(awayR), borderRadius: 4 }} />
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase' }}>READINESS</div>
                  <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 22, fontWeight: 800, color: scoreColor(awayR) }}>
                    {awayR != null ? Math.round(awayR) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: score breakdown + top signals */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {/* Score breakdown */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Readiness', v: scores.readinessGap, max: 40 },
                  { label: 'Rest',      v: scores.restEdge,     max: 20 },
                  { label: 'Travel',    v: scores.travelBurden, max: 20 },
                  { label: 'Congestion', v: scores.congestion,  max: 10 },
                  { label: 'Form',      v: scores.formContrast, max: 10 },
                ].map(({ label, v, max }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                    <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 4 }}>
                      <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: v > 0 ? TIER_COLOR[matchTier] : 'transparent', borderRadius: 4 }} />
                    </div>
                    <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{v}/{max}</div>
                  </div>
                ))}
                <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: 10 }}>
                  <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', marginBottom: 2 }}>TOTAL</div>
                  <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 15, fontWeight: 700, color: TIER_COLOR[matchTier] }}>{scores.total}</div>
                </div>
              </div>

              {/* Top signals */}
              {topSignals.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {topSignals.map((s: any, i: number) => (
                    <div key={i} style={{
                      fontSize: 10, padding: '3px 8px', borderRadius: 6,
                      background: s.direction === 'home' ? '#00e67615'
                        : s.direction === 'away' ? '#ff174415'
                        : 'var(--surface2)',
                      border: `1px solid ${s.direction === 'home' ? '#00e67630' : s.direction === 'away' ? '#ff174430' : 'var(--border)'}`,
                      color: s.direction === 'home' ? '#00e676' : s.direction === 'away' ? '#ff6666' : 'var(--dim)',
                    }}>
                      {s.market}: {s.signal}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {scored.length > 0 && (
        <div style={{ fontSize: 10, color: 'var(--dim)', textAlign: 'center', paddingTop: 8 }}>
          Scores weighted: Readiness gap (40pts max) · Rest edge (20) · Travel burden (20) · Congestion contrast (10) · Form contrast (10)
          · Not betting advice
        </div>
      )}
    </main>
  );
}
