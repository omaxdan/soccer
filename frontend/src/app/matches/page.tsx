import { getTodaysMatches, getMatchesForDate, getTeamIntelligenceMap } from '@/lib/queries';
import { computeMatchSignals } from '@/lib/signals';
import { matchUrl } from '@/lib/urls';
import { COLORS, scoreColor } from '@/design/tokens';
import Link from 'next/link';

export const metadata = { title: 'Match Center | NinetyData RIP' };
export const revalidate = 900;

function toUTCDateStr(d: Date): string { return d.toISOString().split('T')[0]; }
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return toUTCDateStr(d);
}
function formatDisplayDate(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === shiftDate(todayStr, 1)) return 'Tomorrow';
  if (dateStr === shiftDate(todayStr, -1)) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

const DIR_COLOR = { home: COLORS.green, away: COLORS.blue, neutral: COLORS.dim, avoid: COLORS.red };

function SignalDots({ signals }: { signals: any[] }) {
  // Up to 3 dots, colored by the top signals' direction, strongest first.
  const top = [...signals].sort((a, b) => b.strength - a.strength).slice(0, 3);
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {top.map((s, i) => (
        <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: s.strength >= 3 ? DIR_COLOR[s.direction as keyof typeof DIR_COLOR] : COLORS.border }} />
      ))}
      {top.length === 0 && <span style={{ fontSize: 9, color: COLORS.dim }}>—</span>}
    </div>
  );
}

export default async function MatchCenter({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params   = await searchParams;
  const todayStr = toUTCDateStr(new Date());

  let activeDateStr = todayStr;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    const diff = Math.round((new Date(params.date + 'T12:00:00Z').getTime() - new Date(todayStr + 'T12:00:00Z').getTime()) / 86400000);
    if (diff >= -7 && diff <= 7) activeDateStr = params.date;
  }
  const isToday = activeDateStr === todayStr;

  const matches = await (isToday ? getTodaysMatches() : getMatchesForDate(activeDateStr)).catch(() => []);
  const teamIds = (matches as any[]).flatMap((m: any) => [m.home_team_id, m.away_team_id]).filter(Boolean);
  const teamIntelMap = await getTeamIntelligenceMap(teamIds);

  // Compute signals per match — same pattern as /matches/picks
  const enriched = (matches as any[]).map((m: any) => {
    const intel = m.match_intelligence?.[0];
    const homeIntel = teamIntelMap.get(m.home_team_id);
    const awayIntel = teamIntelMap.get(m.away_team_id);
    const signals = computeMatchSignals({
      home_readiness: intel?.home_readiness ?? homeIntel?.readiness_score,
      away_readiness: intel?.away_readiness ?? awayIntel?.readiness_score,
      readiness_gap: intel?.readiness_gap,
      congestion_factor: intel?.congestion_factor,
      home_rest_days: intel?.home_rest_days ?? homeIntel?.rest_days_avg,
      away_rest_days: intel?.away_rest_days ?? awayIntel?.rest_days_avg,
      home_travel_distance_km: intel?.home_travel_distance_km,
      away_travel_distance_km: intel?.away_travel_distance_km,
      home_active_competitions: intel?.home_active_competitions ?? homeIntel?.active_competitions,
      away_active_competitions: intel?.away_active_competitions ?? awayIntel?.active_competitions,
      home_form_index: homeIntel?.form_index,
      away_form_index: awayIntel?.form_index,
      home_travel_fatigue: homeIntel?.travel_fatigue_score,
      away_travel_fatigue: awayIntel?.travel_fatigue_score,
      home_congestion: homeIntel?.congestion_score,
      away_congestion: awayIntel?.congestion_score,
      home_last_5_pts: homeIntel?.last_5_points,
      away_last_5_pts: awayIntel?.last_5_points,
      home_squad_depth: homeIntel?.squad_depth_score,
      away_squad_depth: awayIntel?.squad_depth_score,
      home_injury_burden: homeIntel?.injury_burden_score,
      away_injury_burden: awayIntel?.injury_burden_score,
      home_squad_stability: homeIntel?.squad_stability_score,
      away_squad_stability: awayIntel?.squad_stability_score,
      travel_advantage_km: m.match_travel_intelligence?.[0]?.travel_advantage_km,
    });
    const topSignal = [...signals].filter(s => s.direction !== 'neutral').sort((a, b) => b.strength - a.strength)[0];
    const homeR = intel?.home_readiness ?? homeIntel?.readiness_score;
    const awayR = intel?.away_readiness ?? awayIntel?.readiness_score;
    const gap = homeR != null && awayR != null ? homeR - awayR : null;
    return { match: m, intel, homeIntel, awayIntel, signals, topSignal, homeR, awayR, gap,
             confidence: intel?.confidence_score ?? null, confidenceBand: intel?.confidence_band ?? null };
  }).filter(e => e.match.status !== 'finished');

  // Sort by absolute gap, largest first — matches the "highest signal" ordering the mockup implies
  enriched.sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));

  const topMatch = enriched[0];
  const displayDate = formatDisplayDate(activeDateStr, todayStr);

  // Readiness gap distribution buckets
  const gapBuckets = { strong: 0, moderate: 0, small: 0, negative: 0 };
  for (const e of enriched) {
    const g = e.gap != null ? Math.abs(e.gap) : null;
    if (g == null) continue;
    if (g >= 20) gapBuckets.strong++;
    else if (g >= 10) gapBuckets.moderate++;
    else if (g > 0) gapBuckets.small++;
    else gapBuckets.negative++;
  }
  const totalWithGap = gapBuckets.strong + gapBuckets.moderate + gapBuckets.small + gapBuckets.negative;

  const highestTravelAway = [...enriched].filter(e => e.intel?.away_travel_distance_km != null)
    .sort((a, b) => (b.intel.away_travel_distance_km ?? 0) - (a.intel.away_travel_distance_km ?? 0))[0];
  const restAdvantageCount = enriched.filter(e =>
    (e.intel?.home_rest_days ?? 0) - (e.intel?.away_rest_days ?? 0) >= 3
  ).length;
  const bigGapCount = enriched.filter(e => Math.abs(e.gap ?? 0) >= 20).length;

  // "Upcoming high signal" — replaces the mockup's odds-dependent "Upcoming
  // High Value Matches" panel. Same underlying idea (matches worth watching)
  // but honestly labeled as signal-driven, not value/edge against real odds,
  // since no odds provider is integrated anywhere in this codebase.
  const upcomingHighSignal = enriched
    .filter(e => Math.abs(e.gap ?? 0) >= 15)
    .slice(0, 3);

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Match Center</div>
          <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>All matches with readiness intelligence</div>
        </div>
        <Link href="/matches/picks" style={{ fontSize: 11, color: COLORS.blue, textDecoration: 'none' }}>View Match Picks →</Link>
      </div>

      {/* Date pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[-3, -2, -1, 0, 1, 2, 3].map(offset => {
          const ds = shiftDate(todayStr, offset);
          const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday'
            : new Date(ds + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          const active = ds === activeDateStr;
          return (
            <Link key={ds} href={ds === todayStr ? '/matches' : `/matches?date=${ds}`} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11, textDecoration: 'none',
              fontWeight: active ? 700 : 400,
              background: active ? COLORS.purple : COLORS.surface2,
              color: active ? '#fff' : COLORS.muted,
              border: `1px solid ${active ? COLORS.purple : COLORS.border}`,
            }}>{label}</Link>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.6fr 1fr', gap: 14 }}>
        {/* Main table */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.dim }}>
            {displayDate} · {enriched.length} matches
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: COLORS.surface2 }}>
                {['TIME', 'MATCH', 'COMP', 'HOME', 'AWAY', 'GAP', 'REST(H/A)', 'TRAVEL(A)', 'SIGNALS', 'PICK', 'CONF %'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'MATCH' || h === 'COMP' ? 'left' : 'center', fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enriched.map(({ match: m, homeR, awayR, gap, signals, topSignal, confidence, confidenceBand }) => {
                const time = new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
                const intel = m.match_intelligence?.[0];
                return (
                  <tr key={m.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{time}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <Link href={matchUrl(m)} style={{ color: COLORS.text, textDecoration: 'none', fontWeight: 600 }}>
                        {m.home_team?.short_name ?? m.home_team?.name} <span style={{ color: COLORS.dim, fontWeight: 400 }}>v</span> {m.away_team?.short_name ?? m.away_team?.name}
                      </Link>
                    </td>
                    <td style={{ padding: '8px 10px', color: COLORS.muted, fontSize: 10 }}>{m.competition}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(homeR) }}>{homeR != null ? Math.round(homeR) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(awayR) }}>{awayR != null ? Math.round(awayR) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {gap != null ? (
                        <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(Math.min(100, Math.abs(gap) * 2)) }}>{gap >= 0 ? '+' : ''}{Math.round(gap)}</span>
                      ) : <span style={{ color: COLORS.dim }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: COLORS.muted }}>
                      {intel?.home_rest_days != null ? intel.home_rest_days.toFixed(1) : '—'}/{intel?.away_rest_days != null ? intel.away_rest_days.toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: 10, color: (intel?.away_travel_distance_km ?? 0) > 500 ? COLORS.red : COLORS.muted }}>
                      {intel?.away_travel_distance_km != null ? `${Math.round(intel.away_travel_distance_km)}km` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}><SignalDots signals={signals} /></td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {topSignal ? (
                        <span style={{ fontSize: 10, fontWeight: 700, color: DIR_COLOR[topSignal.direction as keyof typeof DIR_COLOR] }}>
                          {topSignal.direction === 'home' ? '1' : topSignal.direction === 'away' ? '2' : topSignal.direction === 'avoid' ? '⚠' : '—'}
                        </span>
                      ) : <span style={{ color: COLORS.dim, fontSize: 10 }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }} title={confidenceBand ?? 'Not enough corroborating data yet — run process:all-db after migration 016'}>
                      {confidence != null ? (
                        <span style={{
                          fontFamily: '"JetBrains Mono",monospace', fontSize: 11, fontWeight: 700,
                          color: confidence >= 85 ? COLORS.green : confidence >= 70 ? COLORS.greenDim : confidence >= 55 ? COLORS.amber : COLORS.red,
                        }}>
                          {Math.round(confidence)}
                        </span>
                      ) : <span style={{ color: COLORS.dim, fontSize: 10 }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {enriched.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 32, textAlign: 'center', color: COLORS.dim }}>No pre-match fixtures for {displayDate}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {topMatch && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Top Match</div>
              <Link href={matchUrl(topMatch.match)} style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
                  <span style={{ color: COLORS.text, fontWeight: 700 }}>{topMatch.match.home_team?.short_name}</span>
                  <span style={{ color: COLORS.dim }}>vs</span>
                  <span style={{ color: COLORS.text, fontWeight: 700 }}>{topMatch.match.away_team?.short_name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                  <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 700, color: scoreColor(topMatch.homeR) }}>{topMatch.homeR != null ? Math.round(topMatch.homeR) : '—'}</div><div style={{ fontSize: 8, color: COLORS.dim }}>READINESS</div></div>
                  <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 700, color: scoreColor(Math.abs(topMatch.gap ?? 0) * 2) }}>{topMatch.gap != null ? Math.round(Math.abs(topMatch.gap)) : '—'}</div><div style={{ fontSize: 8, color: COLORS.dim }}>GAP</div></div>
                  <div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 700, color: scoreColor(topMatch.awayR) }}>{topMatch.awayR != null ? Math.round(topMatch.awayR) : '—'}</div><div style={{ fontSize: 8, color: COLORS.dim }}>READINESS</div></div>
                </div>
              </Link>
            </div>
          )}

          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Match Intelligence Insights</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
              {topMatch && <div style={{ display: 'flex', gap: 6 }}><span>📈</span><span style={{ color: COLORS.text2 }}><strong>{topMatch.match.home_team?.short_name ?? topMatch.match.home_team?.name}</strong> have the highest readiness advantage ({Math.round(Math.abs(topMatch.gap ?? 0))}) of any match {displayDate.toLowerCase()}.</span></div>}
              {highestTravelAway && <div style={{ display: 'flex', gap: 6 }}><span>✈</span><span style={{ color: COLORS.text2 }}><strong>{highestTravelAway.match.away_team?.short_name ?? highestTravelAway.match.away_team?.name}</strong> have the highest travel load ({Math.round(highestTravelAway.intel.away_travel_distance_km)}km) among away teams.</span></div>}
              {restAdvantageCount > 0 && <div style={{ display: 'flex', gap: 6 }}><span>📅</span><span style={{ color: COLORS.text2 }}>{restAdvantageCount} matches {displayDate.toLowerCase()} with 3+ rest days advantage for the home team.</span></div>}
              {bigGapCount > 0 && <div style={{ display: 'flex', gap: 6 }}><span>🟢</span><span style={{ color: COLORS.text2 }}>{bigGapCount} matches with readiness gap of 20+ {displayDate.toLowerCase()}.</span></div>}
            </div>
          </div>

          {totalWithGap > 0 && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Readiness Gap Distribution</div>
              <div style={{ position: 'relative', width: 90, height: 90, margin: '0 auto 10px' }}>
                <svg width={90} height={90} viewBox="0 0 100 100">
                  {(() => {
                    const segs = [
                      { count: gapBuckets.strong, color: COLORS.green },
                      { count: gapBuckets.moderate, color: COLORS.amber },
                      { count: gapBuckets.small, color: COLORS.orange },
                      { count: gapBuckets.negative, color: COLORS.red },
                    ];
                    let cum = 0;
                    return segs.map((s, i) => {
                      const start = (cum / totalWithGap) * 360; cum += s.count;
                      const end = (cum / totalWithGap) * 360;
                      const large = end - start > 180 ? 1 : 0;
                      const toXY = (deg: number) => { const r = (deg - 90) * Math.PI / 180; return [50 + 42 * Math.cos(r), 50 + 42 * Math.sin(r)]; };
                      const [x1, y1] = toXY(start); const [x2, y2] = toXY(end);
                      return <path key={i} d={`M 50 50 L ${x1} ${y1} A 42 42 0 ${large} 1 ${x2} ${y2} Z`} fill={s.color} opacity={0.85} />;
                    });
                  })()}
                  <circle cx={50} cy={50} r={26} fill={COLORS.surface} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 18, fontWeight: 700, color: COLORS.text }}>{totalWithGap}</div>
                  <div style={{ fontSize: 7, color: COLORS.dim }}>MATCHES</div>
                </div>
              </div>
              {[
                { label: '20+ Strong Edge', count: gapBuckets.strong, color: COLORS.green },
                { label: '10-20 Moderate Edge', count: gapBuckets.moderate, color: COLORS.amber },
                { label: '0-10 Small Edge', count: gapBuckets.small, color: COLORS.orange },
                { label: 'Negative Edge', count: gapBuckets.negative, color: COLORS.red },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, marginBottom: 4 }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />
                  <span style={{ color: COLORS.muted }}>{s.label}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{s.count} ({Math.round((s.count / totalWithGap) * 100)}%)</span>
                </div>
              ))}
            </div>
          )}

          {upcomingHighSignal.length > 0 && (
            <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Upcoming High-Signal Matches</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upcomingHighSignal.map(e => (
                  <Link key={e.match.id} href={matchUrl(e.match)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none', fontSize: 11 }}>
                    <span style={{ color: COLORS.text }}>{e.match.home_team?.short_name} vs {e.match.away_team?.short_name}</span>
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(Math.abs(e.gap ?? 0) * 2) }}>Gap: {Math.round(Math.abs(e.gap ?? 0))}</span>
                  </Link>
                ))}
              </div>
              <div style={{ fontSize: 9, color: COLORS.dim, marginTop: 8 }}>Signal-driven, not market odds — no odds provider integrated.</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
