'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { parseIdFromSlug, teamUrl } from '@/lib/urls';
import Link from 'next/link';
import {
  getMatchById, getTeamIntelligence, getTeamFormHistory,
  getTeamFixtureLoad, getTeamTravelLoad, getTeamSquadSnapshot, getTeamUpcomingMatches,
  getMatchWithLineups, getTeamPositionDepth, getMatchSignals,
} from '@/lib/queries';
import { computeMatchSignals } from '@/lib/signals';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';
import ReadinessGauge from '@/components/ReadinessGauge';
import ReadinessBreakdown, { ReadinessComponent } from '@/components/ReadinessBreakdown';
import { generateMatchInsight } from '@/lib/insights';
import FormString from '@/components/FormString';
import IntelligenceBar from '@/components/IntelligenceBar';
import SignalChip from '@/components/SignalChip';
import { SkeletonCard } from '@/components/SkeletonCard';
import { PredictedLineup } from '@/components/PredictedLineup';

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TYPE.label, fontSize: 10, marginBottom: 5 }}>{children}</div>;
}
function Mono({ children, size = 20, color }: { children: React.ReactNode; size?: number; color?: string }) {
  return <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: size, fontWeight: 700, color: color ?? COLORS.text, lineHeight: 1 }}>{children}</div>;
}

const MARKET_TABS = ['Overview', 'Betting Signals'];
const TEAM_TABS   = ['Form', 'Fixture Load', 'Squad', 'Intelligence'];

// ─── Helper: Map detailed positions to position groups ──────────────────────
function getPositionGroup(positionCode: string): string {
  const groupMap: Record<string, string> = {
    'GK': 'GK',
    'DC': 'DEF', 'DR': 'DEF', 'DL': 'DEF', 'D': 'DEF',
    'MC': 'MID', 'DM': 'MID', 'AM': 'MID', 'RW': 'MID',
    'LW': 'MID', 'ML': 'MID', 'MR': 'MID', 'M': 'MID',
    'ST': 'FWD', 'CF': 'FWD', 'F': 'FWD',
  };
  return groupMap[positionCode] || positionCode;
}

// ─── Helper: Aggregate position depth by group ──────────────────────────────
function aggregatePositionDepth(depthData: any[]) {
  const groups: Record<string, { total: number; available: number; injured: number }> = {
    GK: { total: 0, available: 0, injured: 0 },
    DEF: { total: 0, available: 0, injured: 0 },
    MID: { total: 0, available: 0, injured: 0 },
    FWD: { total: 0, available: 0, injured: 0 },
  };

  for (const item of depthData || []) {
    const group = getPositionGroup(item.position_code);
    if (groups[group]) {
      groups[group].total += item.player_count || 0;
      groups[group].available += item.available_count || 0;
      groups[group].injured += item.injured_count || 0;
    }
  }

  return groups;
}

export default function MatchPage() {
  const { slug } = useParams<{ slug: string }>();
  const id = parseIdFromSlug(slug)?.toString() ?? '';
  const [data, setData]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]       = useState('Overview');
  const [teamTab, setTeamTab] = useState('Form');
  const [isPro]             = useState(true);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      try {
        const match = await getMatchWithLineups(parseInt(id));
        if (!match) {
          setLoading(false);
          return;
        }

        const homeId = match.home_team?.id;
        const awayId = match.away_team?.id;
        const homeLineup = match.home_lineup || [];
        const awayLineup = match.away_lineup || [];
        
        // ── Fetch position depth ──────────────────────────────────────────────
        const [hI, aI, hF, aF, hFix, aFix, hT, aT, hS, aS, hUp, aUp, hDepth, aDepth, storedSignals] = await Promise.all([
          getTeamIntelligence(homeId).catch(() => null),
          getTeamIntelligence(awayId).catch(() => null),
          getTeamFormHistory(homeId, 10).catch(() => []),
          getTeamFormHistory(awayId, 10).catch(() => []),
          getTeamFixtureLoad(homeId).catch(() => null),
          getTeamFixtureLoad(awayId).catch(() => null),
          getTeamTravelLoad(homeId).catch(() => null),
          getTeamTravelLoad(awayId).catch(() => null),
          getTeamSquadSnapshot(homeId).catch(() => null),
          getTeamSquadSnapshot(awayId).catch(() => null),
          getTeamUpcomingMatches(homeId).catch(() => []),
          getTeamUpcomingMatches(awayId).catch(() => []),
          getTeamPositionDepth(homeId).catch(() => []),
          getTeamPositionDepth(awayId).catch(() => []),
          getMatchSignals(parseInt(id)).catch(() => []),
        ]);
        
        setData({ 
          match, 
          homeIntel: hI, 
          awayIntel: aI, 
          homeForm: hF, 
          awayForm: aF, 
          homeFix: hFix, 
          awayFix: aFix, 
          homeTravel: hT, 
          awayTravel: aT, 
          homeSquad: hS, 
          awaySquad: aS, 
          homeUp: hUp, 
          awayUp: aUp,
          homeLineup,
          awayLineup,
          homeDepth: hDepth,
          awayDepth: aDepth,
          storedSignals,
        });
      } catch (error) {
        console.error('❌ Error loading match:', error);
      } finally { 
        setLoading(false); 
      }
    }
    load();
  }, [id]);

  if (loading) return <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>{Array(4).fill(0).map((_,i) => <SkeletonCard key={i} height={i===0?160:100} />)}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted }}>Match not found</div>;

  const { 
    match, 
    homeIntel, 
    awayIntel, 
    homeForm, 
    awayForm, 
    homeFix, 
    awayFix, 
    homeSquad, 
    awaySquad, 
    homeUp, 
    awayUp,
    homeLineup,
    awayLineup,
    homeDepth,
    awayDepth,
    storedSignals,
  } = data;
  
  const intel   = (match.match_intelligence as any[])?.[0];
  const travel  = (match.match_travel_intelligence as any[])?.[0];
  const result  = (match.match_results as any[])?.[0];
  const venue   = match.venue as any;
  const isLive  = match.status === 'live';
  const isDone  = match.status === 'finished';

  const homeResults = (homeForm as any[]).map((f: any) => f.result).reverse();
  const awayResults = (awayForm as any[]).map((f: any) => f.result).reverse();

  // Signals — PRECOMPUTED FIRST (process:match-signals, see backend
  // processDbOnly.ts), falling back to live computeMatchSignals() only
  // when this match hasn't been through that job yet (e.g. freshly
  // synced, or the daily cycle hasn't reached it). This is the same
  // "match_intelligence lags behind matches.id, fall back to baseline"
  // pattern already used elsewhere on this page — nothing regresses for
  // matches without a precomputed row, they just compute live exactly as
  // before until the next process:match-signals run catches up.
  const homeReadinessAny = intel?.home_readiness ?? homeIntel?.readiness_score ?? null;
  const awayReadinessAny = intel?.away_readiness ?? awayIntel?.readiness_score ?? null;
  const hasEnoughForSignals = homeReadinessAny != null && awayReadinessAny != null;

  const liveSignals = hasEnoughForSignals ? computeMatchSignals({
    home_readiness: homeReadinessAny,
    away_readiness: awayReadinessAny,
    readiness_gap: intel?.readiness_gap ?? (homeReadinessAny - awayReadinessAny),
    congestion_factor: intel?.congestion_factor ??
      ((homeIntel?.congestion_score != null && awayIntel?.congestion_score != null)
        ? (homeIntel.congestion_score + awayIntel.congestion_score) / 2
        : null),
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
    travel_advantage_km: travel?.travel_advantage_km,
    home_squad_depth:    homeIntel?.squad_depth_score,
    away_squad_depth:    awayIntel?.squad_depth_score,
    home_injury_burden:  homeIntel?.injury_burden_score,
    away_injury_burden:  awayIntel?.injury_burden_score,
    home_squad_stability: homeIntel?.squad_stability_score,
    away_squad_stability: awayIntel?.squad_stability_score,
  }) : [];

  const signals = (storedSignals && storedSignals.length > 0) ? storedSignals : liveSignals;

  // Readiness components
  const readinessComponents: ReadinessComponent[] = [
    {
      label: 'Form', weight: 30,
      homeScore: homeIntel?.form_index ?? null, awayScore: awayIntel?.form_index ?? null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Fixture Congestion', weight: 15,
      homeScore: homeIntel?.congestion_score != null ? 100 - homeIntel.congestion_score : null,
      awayScore: awayIntel?.congestion_score != null ? 100 - awayIntel.congestion_score : null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Travel Impact', weight: 15,
      homeScore: homeIntel?.travel_fatigue_score != null ? 100 - homeIntel.travel_fatigue_score : null,
      awayScore: awayIntel?.travel_fatigue_score != null ? 100 - awayIntel.travel_fatigue_score : null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Squad Stability', weight: 5,
      homeScore: homeIntel?.squad_stability_score ?? null, awayScore: awayIntel?.squad_stability_score ?? null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Injury Burden', weight: 5,
      homeScore: homeIntel?.injury_burden_score != null ? 100 - homeIntel.injury_burden_score : null,
      awayScore: awayIntel?.injury_burden_score != null ? 100 - awayIntel.injury_burden_score : null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Squad Depth', weight: 5,
      homeScore: homeIntel?.squad_depth_score ?? null, awayScore: awayIntel?.squad_depth_score ?? null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
    {
      label: 'Rest Days', weight: 5,
      homeScore: (intel?.home_rest_days ?? homeIntel?.rest_days_avg) != null
        ? Math.min(100, Math.round(((intel?.home_rest_days ?? homeIntel?.rest_days_avg) / 7) * 100)) : null,
      awayScore: (intel?.away_rest_days ?? awayIntel?.rest_days_avg) != null
        ? Math.min(100, Math.round(((intel?.away_rest_days ?? awayIntel?.rest_days_avg) / 7) * 100)) : null,
      homeTeam: match.home_team?.short_name ?? 'HOME', awayTeam: match.away_team?.short_name ?? 'AWAY',
    },
  ];

  const matchInsight = hasEnoughForSignals ? generateMatchInsight({
    homeTeam: match.home_team?.name ?? 'Home',
    awayTeam: match.away_team?.name ?? 'Away',
    homeReadiness: homeReadinessAny,
    awayReadiness: awayReadinessAny,
    readinessGap: intel?.readiness_gap ?? (homeReadinessAny - awayReadinessAny),
    homeFormIndex: homeIntel?.form_index,
    awayFormIndex: awayIntel?.form_index,
    homeRestDays: intel?.home_rest_days ?? homeIntel?.rest_days_avg,
    awayRestDays: intel?.away_rest_days ?? awayIntel?.rest_days_avg,
    awayTravelKm: intel?.away_travel_distance_km,
    homeCongestion: homeIntel?.congestion_score,
    awayCongestion: awayIntel?.congestion_score,
    homeInjuryBurden: homeIntel?.injury_burden_score,
    awayInjuryBurden: awayIntel?.injury_burden_score,
    homeSquadStability: homeIntel?.squad_stability_score,
    awaySquadStability: awayIntel?.squad_stability_score,
  }) : null;

  const signalsAreBaselineOnly = hasEnoughForSignals && !intel;
  const strongHome = signals.filter(s => s.direction === 'home' && s.strength >= 4);
  const strongAway = signals.filter(s => s.direction === 'away' && s.strength >= 4);

  // ─── Team Column Renderer ───────────────────────────────────────────────────
  const TeamColumn = ({ team, intel: ti, form, fix, squad, upcoming, depth }: any) => {
    // ── Aggregate position depth ──────────────────────────────────────────────
    const aggregatedDepth = aggregatePositionDepth(depth || []);
    const positionOrder = ['GK', 'DEF', 'MID', 'FWD'];

    return (
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {team?.name}
          <Link href={teamUrl(team)} style={{ fontSize: 11, color: COLORS.blue }}>View Team →</Link>
        </div>

        {/* Sub-tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 14 }}>
          {TEAM_TABS.map(t => (
            <button key={t} onClick={() => setTeamTab(t)} style={{
              padding: '5px 12px', fontSize: 10, fontWeight: 600,
              borderBottom: `2px solid ${teamTab===t?COLORS.green:'transparent'}`,
              color: teamTab===t?COLORS.green:COLORS.muted,
              textTransform: 'uppercase', letterSpacing: '0.07em', cursor: 'pointer',
            }}>{t}</button>
          ))}
        </div>

        {teamTab === 'Form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Label>Form Last 10</Label>
              <FormString results={(form as any[]).map((f: any) => f.result).reverse().slice(-10)} count={10} />
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div><Label>Last 5 Pts</Label><Mono size={22} color={scoreColor((ti?.last_5_points/15)*100)}>{ti?.last_5_points ?? '—'}<span style={{fontSize:12,color:COLORS.dim}}>/15</span></Mono></div>
              <div><Label>Last 10 Pts</Label><Mono size={22} color={scoreColor((ti?.last_10_points/30)*100)}>{ti?.last_10_points ?? '—'}<span style={{fontSize:12,color:COLORS.dim}}>/30</span></Mono></div>
              <div><Label>Form Index</Label><Mono size={22} color={scoreColor(ti?.form_index)}>{ti?.form_index ? Math.round(ti.form_index) : '—'}</Mono></div>
            </div>
            <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }}>
              <Label>Match History</Label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {(form as any[]).slice(0,8).map((f: any, i: number) => {
                  const m = f.match;
                  const col = f.result==='W'?COLORS.green:f.result==='D'?COLORS.amber:COLORS.red;
                  const opponent = m?.home_team?.name === team?.name ? m?.away_team?.name : m?.home_team?.name;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                      <div style={{ fontSize: 10, color: COLORS.dim, minWidth: 52 }}>{m?.date ? new Date(m.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '—'}</div>
                      <div style={{ fontSize: 11, color: COLORS.muted, flex: 1 }}>{opponent ?? '—'}</div>
                      <div style={{ background: col+'28', border:`1px solid ${col}60`, borderRadius:3, width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:col, fontFamily:'monospace' }}>{f.result}</div>
                      <div style={{ fontFamily:'monospace', fontSize:11, color:COLORS.muted, minWidth:32, textAlign:'right' }}>{f.goals_for}–{f.goals_against}</div>
                      <div style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:col, minWidth:12 }}>{f.points}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {teamTab === 'Fixture Load' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {fix ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[['Last 7d','matches_last_7_days',4],['Last 14d','matches_last_14_days',6],['Next 7d','matches_next_7_days',4],['Next 14d','matches_next_14_days',6]].map(([label,key,max]: any) => (
                    <div key={key} style={{ background:COLORS.surface2, borderRadius:8, padding:'10px 12px' }}>
                      <Label>{label}</Label>
                      <Mono size={24} color={scoreColor(100 - ((fix[key]??0)/max)*100)}>{fix[key] ?? '—'}</Mono>
                      <div style={{ height:4, background:COLORS.border, borderRadius:2, overflow:'hidden', marginTop:6 }}>
                        <div style={{ width:`${Math.min(100,((fix[key]??0)/max)*100)}%`, height:'100%', background:scoreColor(100-((fix[key]??0)/max)*100), borderRadius:2 }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:16 }}>
                  <div><Label>Avg Rest</Label><Mono size={18}>{fix.avg_rest_days?.toFixed(1) ?? '—'}<span style={{fontSize:11,color:COLORS.dim}}>d</span></Mono></div>
                  <div><Label>Min Rest</Label><Mono size={18} color={fix.min_rest_days<=2?COLORS.red:fix.min_rest_days<=3?COLORS.amber:COLORS.green}>{fix.min_rest_days ?? '—'}<span style={{fontSize:11,color:COLORS.dim}}>d</span></Mono></div>
                  <div><Label>Congestion</Label><Mono size={18} color={scoreColor(100-(fix.congestion_score??0))}>{fix.congestion_score ? Math.round(fix.congestion_score) : '—'}<span style={{fontSize:11,color:COLORS.dim}}>/100</span></Mono></div>
                </div>
                {(upcoming as any[]).length > 0 && (
                  <div>
                    <Label>Upcoming Fixtures (14d)</Label>
                    {(upcoming as any[]).slice(0,5).map((u: any, i: number) => {
                      const opp = u.home_team?.id === team?.id ? u.away_team?.name : u.home_team?.name;
                      const ha  = u.home_team?.id === team?.id ? 'H' : 'A';
                      return (
                        <div key={i} style={{ display:'flex', gap:10, padding:'5px 0', borderBottom:`1px solid ${COLORS.border}`, fontSize:11 }}>
                          <div style={{ color:COLORS.dim, minWidth:40 }}>{new Date(u.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</div>
                          <div style={{ flex:1, color:COLORS.muted }}>{u.competition}</div>
                          <div style={{ color:COLORS.text, fontWeight:600 }}>{opp}</div>
                          <div style={{ color:ha==='H'?COLORS.green:COLORS.amber, fontWeight:700, fontFamily:'monospace' }}>{ha}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : <div style={{ color:COLORS.dim, padding:20, textAlign:'center' }}>Run process:fixture-load first</div>}
          </div>
        )}

        {teamTab === 'Squad' && (
          <div>
            {squad ? (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {[
                    ['Squad Size', squad.players_count, 'players'],
                    ['Avg Age', squad.avg_age?.toFixed(1), 'yrs'],
                    ['Foreign', squad.foreign_players_count, ''],
                    ['Domestic', squad.domestic_players_count, ''],
                    ['Injured', squad.injured_player_count, ''],
                    ['Avg Value', squad.average_market_value ? `€${(squad.average_market_value / 1_000_000).toFixed(1)}M` : null, ''],
                  ].map(([label, val, unit]: any) => (
                    <div key={label} style={{ background:COLORS.surface2, borderRadius:8, padding:'10px 12px' }}>
                      <Label>{label}</Label>
                      <Mono size={22}>{val ?? '—'}{unit && <span style={{fontSize:11,color:COLORS.dim,marginLeft:3}}>{unit}</span>}</Mono>
                    </div>
                  ))}
                </div>
                
                {/* ── POSITION DEPTH ── */}
                <div style={{ marginTop: 12 }}>
                  <Label>Position Depth</Label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {positionOrder.map(pos => {
                      const data = aggregatedDepth[pos];
                      const available = data?.available || 0;
                      const total = data?.total || 0;
                      const injured = data?.injured || 0;
                      const pct = total > 0 ? Math.round((available / total) * 100) : 0;
                      
                      let color = COLORS.green;
                      if (pct < 60) color = COLORS.red;
                      else if (pct < 80) color = COLORS.amber;
                      
                      return (
                        <div key={pos} style={{
                          background: COLORS.surface2,
                          borderRadius: 6,
                          padding: '8px 10px',
                          textAlign: 'center',
                          border: `1px solid ${COLORS.border}`,
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase' }}>
                            {pos}
                          </div>
                          <div style={{ 
                            fontSize: 18, 
                            fontWeight: 700, 
                            color: COLORS.text,
                            marginTop: 2,
                          }}>
                            {total > 0 ? available : '—'}
                            {total > 0 && (
                              <span style={{ fontSize: 11, color: COLORS.dim, fontWeight: 400 }}>
                                /{total}
                              </span>
                            )}
                          </div>
                          {total > 0 && (
                            <div style={{ 
                              height: 3, 
                              background: COLORS.border, 
                              borderRadius: 2, 
                              marginTop: 4,
                              overflow: 'hidden',
                            }}>
                              <div style={{ 
                                width: `${pct}%`, 
                                height: '100%', 
                                background: color,
                                borderRadius: 2,
                              }} />
                            </div>
                          )}
                          {injured > 0 && (
                            <div style={{ 
                              fontSize: 11,
                              fontWeight: 800, 
                              color: COLORS.red, 
                              marginTop: 2,
                            }}>
                              {injured} injured
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding:24, textAlign:'center', border:`1px dashed ${COLORS.border}`, borderRadius:10 }}>
                <div style={{ fontSize:24, marginBottom:8 }}>🔒</div>
                <div style={{ color:COLORS.muted, fontSize:12, fontWeight:600 }}>Squad data pending</div>
                <div style={{ color:COLORS.dim, fontSize:11, marginTop:4 }}>Run sync:squads:tracked to populate</div>
              </div>
            )}
          </div>
        )}

        {teamTab === 'Intelligence' && (
          <div>
            <Label>Readiness Breakdown</Label>
            {[
              { label:'Form Index',        val:ti?.form_index,               weight:'25%', inverse:false, active:true },
              { label:'Congestion (inv)',  val:ti?.congestion_score,         weight:'25%', inverse:true,  active:true },
              { label:'Travel Fatigue (inv)',val:ti?.travel_fatigue_score,   weight:'20%', inverse:true,  active:true },
              { label:'Fatigue Index',     val:ti?.fatigue_index,            weight:'10%', inverse:false, active:!!ti?.fatigue_index },
              { label:'Squad Stability',   val:ti?.squad_stability_index,    weight:'10%', inverse:false, active:!!ti?.squad_stability_index },
              { label:'Rotation Pressure', val:ti?.rotation_pressure_index, weight:'10%', inverse:false, active:!!ti?.rotation_pressure_index },
            ].map((c, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${COLORS.border}` }}>
                <div style={{ flex:1, fontSize:11, color:c.active?COLORS.muted:COLORS.dim }}>{c.label}</div>
                <div style={{ fontSize:9, color:COLORS.dim, fontFamily:'monospace' }}>{c.weight}</div>
                {c.active ? (
                  <>
                    <div style={{ width:80, height:5, background:COLORS.border, borderRadius:2, overflow:'hidden' }}>
                      <div style={{ width:`${c.inverse ? 100-(c.val??0) : (c.val??0)}%`, height:'100%', background:c.inverse?scoreColor(100-(c.val??0)):scoreColor(c.val), borderRadius:2 }} />
                    </div>
                    <div style={{ fontFamily:'monospace', fontSize:12, fontWeight:700, color:c.inverse?scoreColor(100-(c.val??0)):scoreColor(c.val), minWidth:32, textAlign:'right' }}>{c.val?Math.round(c.val):'—'}</div>
                  </>
                ) : (
                  <div style={{ fontSize:10, color:COLORS.purple }}>🔒 Awaiting squad sync</div>
                )}
              </div>
            ))}
            <div style={{ marginTop:12, padding:'10px 14px', background:COLORS.surface2, borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:11, color:COLORS.muted }}>Partial Readiness (3/6 components)</div>
              <Mono size={22} color={scoreColor(ti?.readiness_score)}>{ti?.readiness_score ? Math.round(ti.readiness_score) : '—'}</Mono>
            </div>
          </div>
        )}
      </Card>
    );
  };

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── HERO: Match Header ── */}
      <Card>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
          <span style={{ background:(isLive?COLORS.red:isDone?COLORS.dim:COLORS.blue)+'20', color:isLive?COLORS.red:isDone?COLORS.dim:COLORS.blue, border:`1px solid ${(isLive?COLORS.red:isDone?COLORS.dim:COLORS.blue)}40`, borderRadius:4, padding:'1px 7px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>
            {isLive ? '● LIVE' : isDone ? 'FT' : new Date(match.date).toLocaleString()}
          </span>
          <span style={{ color:COLORS.muted, fontSize:13 }}>{match.competition}</span>
          {venue && <span style={{ color:COLORS.dim, fontSize:11 }}>• {venue.name}, {venue.city}</span>}
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-around' }}>
          {/* Home */}
          <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:20, fontWeight:700, color:COLORS.text }}>{match.home_team?.name}</div>
            <ReadinessGauge score={intel?.home_readiness ?? homeIntel?.readiness_score ?? null} label="READINESS" size={120} />
            {!intel?.home_readiness && homeIntel?.readiness_score != null && (
              <div style={{ fontSize: 9, color: COLORS.dim }}>baseline — match-specific pending</div>
            )}
            <FormString results={homeResults.slice(-5)} showPoints />
          </div>

          {/* VS / Score */}
          <div style={{ textAlign:'center', minWidth:120 }}>
            {(isDone || isLive) ? (
              <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:48, fontWeight:700, color:COLORS.text, lineHeight:1 }}>
                {result?.home_score ?? 0} – {result?.away_score ?? 0}
                {result?.half_time_home_score != null && (
                  <div style={{ fontSize:12, color:COLORS.dim, marginTop:4 }}>HT: {result.half_time_home_score}–{result.half_time_away_score}</div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize:24, color:COLORS.dim, fontWeight:700 }}>VS</div>
                {intel ? (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:22, fontWeight:700, color:scoreColor(Math.abs(intel.readiness_gap) > 15 ? 60 : 50) }}>Δ {intel.readiness_gap != null ? Math.abs(intel.readiness_gap) : '—'}</div>
                    <div style={{ fontSize:9, color:COLORS.dim, textTransform:'uppercase' }}>Readiness Gap</div>
                    {intel.readiness_gap != null && intel.readiness_gap !== 0 && (
                      <div style={{ fontSize:10, color:COLORS.green, marginTop:2 }}>
                        {intel.readiness_gap > 0 ? match?.home_team?.short_name : match?.away_team?.short_name} Advantage
                      </div>
                    )}
                  </div>
                ) : (homeIntel?.readiness_score != null && awayIntel?.readiness_score != null) ? (
                  <div style={{ marginTop:8 }}>
                    <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:22, fontWeight:700, color:scoreColor(50) }}>
                      Δ {Math.abs(homeIntel.readiness_score - awayIntel.readiness_score)}
                    </div>
                    <div style={{ fontSize:9, color:COLORS.dim, textTransform:'uppercase' }}>Readiness Gap (est.)</div>
                    <div style={{ fontSize:9, color:COLORS.dim, marginTop:2 }}>baseline only — match-specific pending</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Away */}
          <div style={{ textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:20, fontWeight:700, color:COLORS.text }}>{match.away_team?.name}</div>
            <ReadinessGauge score={intel?.away_readiness ?? awayIntel?.readiness_score ?? null} label="READINESS" size={120} />
            {!intel?.away_readiness && awayIntel?.readiness_score != null && (
              <div style={{ fontSize: 9, color: COLORS.dim }}>baseline — match-specific pending</div>
            )}
            <FormString results={awayResults.slice(-5)} showPoints />
          </div>
        </div>
      </Card>

      {/* ── 6 INTELLIGENCE METRIC CARDS ── */}
      {intel && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
          <Card style={{ padding:14 }}>
            <Label>Rest Advantage</Label>
            <IntelligenceBar homeValue={intel.home_rest_days} awayValue={intel.away_rest_days}
              homeLabel={match.home_team?.short_name} awayLabel={match.away_team?.short_name} max={10} unit="d" />
            <div style={{ marginTop:8, fontSize:10, fontWeight:700, color:COLORS.green }}>
              {intel.home_rest_days > intel.away_rest_days
                ? `HOME +${Math.abs(intel.home_rest_days - intel.away_rest_days).toFixed(1)} days`
                : intel.away_rest_days > intel.home_rest_days
                ? `AWAY +${Math.abs(intel.home_rest_days - intel.away_rest_days).toFixed(1)} days`
                : 'EQUAL'}
            </div>
          </Card>
          <Card style={{ padding:14 }}>
            <Label>Travel Burden</Label>
            <IntelligenceBar homeValue={travel?.home_team_distance_km ? Math.round(travel.home_team_distance_km) : null}
              awayValue={travel?.away_team_distance_km ? Math.round(travel.away_team_distance_km) : null}
              homeLabel={match.home_team?.short_name} awayLabel={match.away_team?.short_name} max={2000} inverse unit="km" />
          </Card>
          <Card style={{ padding:14 }}>
            <Label>Fixture Congestion</Label>
            <IntelligenceBar homeValue={homeIntel?.congestion_score ? Math.round(homeIntel.congestion_score) : null}
              awayValue={awayIntel?.congestion_score ? Math.round(awayIntel.congestion_score) : null}
              homeLabel={match.home_team?.short_name} awayLabel={match.away_team?.short_name} max={100} inverse />
          </Card>
          <Card style={{ padding:14 }}>
            <Label>Active Competitions</Label>
            <div style={{ display:'flex', justifyContent:'space-around', alignItems:'center', marginTop:8 }}>
              {[{label:match.home_team?.short_name, val:intel.home_active_competitions},{label:match.away_team?.short_name, val:intel.away_active_competitions}].map(t => (
                <div key={t.label} style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:26, fontWeight:700, color:(t.val??0)>2?COLORS.amber:COLORS.text }}>{t.val ?? '—'}</div>
                  <div style={{ fontSize:9, color:COLORS.dim }}>{t.label}</div>
                  {(t.val??0)>2 && <div style={{ fontSize:9, color:COLORS.amber }}>⚠ High load</div>}
                </div>
              ))}
            </div>
          </Card>
          <Card style={{ padding:14 }}>
            <Label>Travel Fatigue</Label>
            <IntelligenceBar homeValue={homeIntel?.travel_fatigue_score ? Math.round(homeIntel.travel_fatigue_score) : null}
              awayValue={awayIntel?.travel_fatigue_score ? Math.round(awayIntel.travel_fatigue_score) : null}
              homeLabel={match.home_team?.short_name} awayLabel={match.away_team?.short_name} max={100} inverse />
          </Card>
          <Card style={{ padding:14 }}>
            <Label>Form Last 5</Label>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:6 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:10, color:COLORS.muted }}>{match.home_team?.short_name}</span>
                <FormString results={homeResults.slice(-5)} size="sm" showPoints />
              </div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:10, color:COLORS.muted }}>{match.away_team?.short_name}</span>
                <FormString results={awayResults.slice(-5)} size="sm" showPoints />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── PAGE TABS ── */}
      <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${COLORS.border}` }}>
        {MARKET_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'8px 22px', fontSize:11, fontWeight:700,
            borderBottom:`2px solid ${tab===t?COLORS.green:'transparent'}`,
            color:tab===t?COLORS.green:COLORS.muted,
            textTransform:'uppercase', letterSpacing:'0.08em', cursor:'pointer',
          }}>{t}</button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'Overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {matchInsight && (
            <Card style={{ background: COLORS.blue+'0f', border: `1px solid ${COLORS.blue}30` }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:COLORS.blue }}>
                  💡 Key Insight
                </span>
              </div>
              <div style={{ fontSize:13, color:COLORS.text, lineHeight:1.6 }}>{matchInsight.text}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                <span style={{ fontSize:10, color:COLORS.dim }}>Confidence</span>
                <div style={{ flex:1, maxWidth:160, height:5, background:COLORS.border, borderRadius:3, overflow:'hidden' }}>
                  <div style={{
                    width:`${matchInsight.confidence}%`, height:'100%', borderRadius:3,
                    background: `linear-gradient(90deg, ${COLORS.red}, ${COLORS.amber}, ${COLORS.green})`,
                  }} />
                </div>
                <span style={{ fontSize:10, fontFamily:'"JetBrains Mono",monospace', color:COLORS.text, fontWeight:700 }}>{matchInsight.confidence}%</span>
              </div>
            </Card>
          )}

          <Card>
            <ReadinessBreakdown components={readinessComponents} />
          </Card>

          {/* ── PREDICTED LINEUPS ── */}
          {(homeLineup.length > 0 || awayLineup.length > 0) && (
            <Card>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Predicted Lineups
                </div>
                <div style={{ fontSize: 10, color: COLORS.dim, marginTop: 2 }}>
                  Based on season starts, form, and injury status • 4-4-2 formation
                </div>
              </div>
              <PredictedLineup
                homeTeam={match.home_team}
                awayTeam={match.away_team}
                lineups={{ home: homeLineup, away: awayLineup }}
              />
            </Card>
          )}

          {intel?.predicted_scorelines && intel.predicted_scorelines.length > 0 && (
            <Card>
              <div style={{ ...TYPE.sectionHeader, fontSize:11, marginBottom:10 }}>LIKELY SCORELINE</div>
              <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:14 }}>
                <div style={{ fontSize:12, color:COLORS.muted }}>
                  Expected goals:{' '}
                  <span style={{ fontFamily:'"JetBrains Mono",monospace', color:COLORS.text, fontWeight:700 }}>
                    {intel.predicted_home_goals?.toFixed(1) ?? '—'} – {intel.predicted_away_goals?.toFixed(1) ?? '—'}
                  </span>
                </div>
              </div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                {intel.predicted_scorelines.slice(0, 6).map((s: any, i: number) => (
                  <div
                    key={i}
                    style={{
                      background: i === 0 ? COLORS.green+'15' : COLORS.surface2,
                      border: `1px solid ${i === 0 ? COLORS.green+'40' : COLORS.border}`,
                      borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 64,
                    }}
                  >
                    <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:16, fontWeight:700, color: i === 0 ? COLORS.green : COLORS.text }}>
                      {s.home}–{s.away}
                    </div>
                    <div style={{ fontSize:10, color:COLORS.dim, marginTop:2 }}>{s.probability}%</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:10, color:COLORS.dim, marginTop:12 }}>
                Statistical estimate from each team's recent scoring/conceding form — independent Poisson model. Not a prediction of the actual result.
              </div>
            </Card>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
            <TeamColumn 
              team={match.home_team} 
              intel={homeIntel} 
              form={homeForm} 
              fix={homeFix} 
              squad={homeSquad} 
              upcoming={homeUp}
              depth={homeDepth}
            />
            <TeamColumn 
              team={match.away_team} 
              intel={awayIntel} 
              form={awayForm} 
              fix={awayFix} 
              squad={awaySquad} 
              upcoming={awayUp}
              depth={awayDepth}
            />
          </div>
        </div>
      )}

      {/* ── BETTING SIGNALS TAB ── */}
      {tab === 'Betting Signals' && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ background:COLORS.amber+'15', border:`1px solid ${COLORS.amber}30`, borderRadius:8, padding:'10px 16px', fontSize:12, color:COLORS.amber }}>
            ⚠ Intelligence signals are derived from precomputed data. Not betting advice. Please bet responsibly.
          </div>

          {signalsAreBaselineOnly && (
            <div style={{ background:COLORS.surface2, border:`1px solid ${COLORS.border}`, borderRadius:8, padding:'8px 16px', fontSize:11, color:COLORS.muted }}>
              ℹ These signals are estimated from each team's current baseline — match-specific
              intelligence (opponent strength, home advantage, motivation) hasn't been computed
              for this fixture yet. Precision will improve once it has.
            </div>
          )}

          {signals.length > 0 ? (
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {strongHome.length > 0 && <SignalChip label={`Strong Home Signal — ${strongHome[0].market}`} strength={strongHome[0].strength} direction="home" />}
              {strongAway.length > 0 && <SignalChip label={`Strong Away Signal — ${strongAway[0].market}`} strength={strongAway[0].strength} direction="away" />}
              {strongHome.length === 0 && strongAway.length === 0 && <SignalChip label="No strong signals detected" strength={1} direction="neutral" />}
            </div>
          ) : (
            <div style={{ padding:'24px', textAlign:'center', color:COLORS.dim, fontSize:12 }}>
              No signals available yet — neither team has readiness data computed. Run process:all-db once squad/season data has synced.
            </div>
          )}

          {[
            { title: 'MATCH MARKETS', filter: (s: any) => s.group === '1x2' },
            { title: 'GOAL MARKETS', filter: (s: any) => s.group === 'goals' },
            { title: 'COMPETITION MARKETS', filter: (s: any) => s.group === 'competition' },
            { title: 'HALF-TIME MARKETS', filter: (s: any) => s.group === 'halftime' },
            { title: 'CARD MARKETS', filter: (s: any) => s.group === 'cards' },
          ].map(({ title, filter }) => {
            const group = signals.filter(filter);
            if (group.length === 0) return null;
            return (
              <div key={title}>
                <div style={{ ...TYPE.sectionHeader, fontSize:10, marginBottom:8 }}>{title}</div>
                <Card style={{ padding:0, overflow:'hidden' }}>
                  <table style={{ width:'100%' }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                        {['Market','Signal','Strength','Intelligence Driver'].map(h => (
                          <th key={h} style={{ padding:'8px 14px', fontSize:9, color:COLORS.dim, textTransform:'uppercase', letterSpacing:'0.07em', textAlign:'left', fontWeight:600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((s, i) => {
                        const col = s.direction==='home'?COLORS.green:s.direction==='away'?COLORS.red:s.direction==='avoid'?COLORS.orange:COLORS.muted;
                        const isEdge = s.signal !== 'No Edge' && s.signal !== 'No Flag' && s.signal !== 'Balanced' && s.signal !== 'Level';
                        const isLocked = s.locked && !isPro;
                        const isBlurred = !isPro && i >= 3;
                        return (
                          <tr key={i} style={{
                            borderBottom:`1px solid ${COLORS.border}`,
                            background: i%2===0?'transparent':COLORS.surface2+'40',
                            position:'relative',
                          }}>
                            <td style={{ padding:'10px 14px', fontSize:12, fontWeight:600, color:COLORS.text, filter:isBlurred?'blur(4px)':'none' }}>
                              {s.market}
                              {isLocked && <span style={{ marginLeft:5, fontSize:9, color:COLORS.purple }}>🔒 PRO</span>}
                            </td>
                            <td style={{ padding:'10px 14px', filter:isBlurred?'blur(4px)':'none' }}>
                              <span style={{ background:(isEdge?col:COLORS.dim)+'20', color:isEdge?col:COLORS.dim, border:`1px solid ${isEdge?col:COLORS.dim}40`, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:700 }}>{s.signal}</span>
                            </td>
                            <td style={{ padding:'10px 14px', filter:isBlurred?'blur(4px)':'none' }}>
                              <div style={{ display:'flex', gap:2 }}>
                                {Array.from({length:6}).map((_,j) => (
                                  <div key={j} style={{ width:7, height:12, borderRadius:2, background:j<s.strength?(isEdge?col:COLORS.dim):COLORS.border }} />
                                ))}
                              </div>
                            </td>
                            <td style={{ padding:'10px 14px', fontSize:11, color:COLORS.muted, filter:isBlurred?'blur(4px)':'none' }}>{s.drivers}</td>
                            {isBlurred && (
                              <td style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:COLORS.surface+'90' }}>
                                <div style={{ background:COLORS.purple+'20', border:`1px solid ${COLORS.purple}40`, borderRadius:8, padding:'4px 14px', fontSize:11, color:COLORS.purple, fontWeight:700 }}>
                                  🔒 Unlock 47 more signals today →
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}