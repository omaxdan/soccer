'use client';
import { useState, useEffect } from 'react';
import { toOne } from '@/lib/relations';
import { useParams } from 'next/navigation';
import { parseIdFromSlug, teamUrl } from '@/lib/urls';
import Link from 'next/link';
import {
  getMatchById, getTeamIntelligence, getTeamFormHistory,
  getTeamFixtureLoad, getTeamTravelLoad, getTeamSquadSnapshot, getTeamUpcomingMatches,
  getMatchWithLineups, getTeamPositionDepth, getMatchSignals, getTeamGoalDependency, getTeamInjuryImpact, getMatchComparisonExtras, getMatchKeyPlayers,
} from '@/lib/queries';
import { computeMatchSignals } from '@/lib/signals';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';
import ReadinessGauge from '@/components/ReadinessGauge';
import ReadinessBreakdown, { ReadinessComponent } from '@/components/ReadinessBreakdown';
import { generateMatchInsight, generateExecutiveSummary, generateNarrativeThreads, deriveRole, deriveCategory } from '@/lib/insights';
import TeamComparisonMatrix, { ComparisonRow } from '@/components/TeamComparisonMatrix';
import FormString from '@/components/FormString';
import SignalChip from '@/components/SignalChip';
import { SkeletonCard } from '@/components/SkeletonCard';
import { PredictedLineup } from '@/components/PredictedLineup';
import Tabs from '@/components/Tabs';
import RelatedPills from '@/components/RelatedPills';

function Card({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TYPE.label, fontSize: 10, marginBottom: 5 }}>{children}</div>;
}
function Mono({ children, size = 20, color }: { children: React.ReactNode; size?: number; color?: string }) {
  return <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: size, fontWeight: 700, color: color ?? COLORS.text, lineHeight: 1 }}>{children}</div>;
}

const PAGE_TABS = ['Overview', 'Lineups', 'Squad', 'Narrative', 'Betting Signals'];
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
        const [hI, aI, hF, aF, hFix, aFix, hT, aT, hS, aS, hUp, aUp, hDepth, aDepth, storedSignals, hGoalDep, aGoalDep, hInjury, aInjury, matchExtras, matchKeyPlayers] = await Promise.all([
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
          getTeamGoalDependency(homeId).catch(() => null),
          getTeamGoalDependency(awayId).catch(() => null),
          getTeamInjuryImpact(homeId).catch(() => null),
          getTeamInjuryImpact(awayId).catch(() => null),
          getMatchComparisonExtras([homeId, awayId]).catch(() => new Map()),
          getMatchKeyPlayers(parseInt(id), homeId, awayId).catch(() => ({ home: [], away: [] })),
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
          homeGoalDep: hGoalDep,
          awayGoalDep: aGoalDep,
          homeInjury: hInjury,
          awayInjury: aInjury,
          matchExtras,
          matchKeyPlayers,
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
    homeGoalDep,
    awayGoalDep,
    homeInjury,
    awayInjury,
    matchExtras,
    matchKeyPlayers,
  } = data;
  
  const intel   = toOne(match.match_intelligence);
  const travel  = toOne(match.match_travel_intelligence);
  const result  = toOne(match.match_results);
  const venue   = match.venue as any;
  const isLive  = match.status === 'live';
  const isDone  = match.status === 'finished';


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

  // ─── Team Comparison Matrix data — consolidates data already fetched/
  // computed above (team_intelligence, team_goal_dependency,
  // team_injury_impact) plus the new lean getMatchComparisonExtras fetch
  // (strength rating, venue advantage, season goals) into one scannable
  // table, replacing several previously-scattered separate cards. ───────
  const homeExtras = matchExtras?.get(match.home_team_id);
  const awayExtras = matchExtras?.get(match.away_team_id);

  // Form strings — oldest-to-newest, same convention as getTeamComparisonExtras's
  // formPills builder elsewhere in this codebase (fetched newest-first, reversed).
  const homeFormString = (homeForm ?? []).slice(0, 5).map((f: any) => f.result).reverse().join('');
  const awayFormString = (awayForm ?? []).slice(0, 5).map((f: any) => f.result).reverse().join('');

  const comparisonRows: ComparisonRow[] = [
    { label: 'Readiness', homeValue: homeReadinessAny, awayValue: awayReadinessAny, higherIsBetter: true },
    { label: 'Form Index', homeValue: homeIntel?.form_index ?? null, awayValue: awayIntel?.form_index ?? null, higherIsBetter: true },
    { label: 'Congestion', homeValue: homeIntel?.congestion_score ?? null, awayValue: awayIntel?.congestion_score ?? null, higherIsBetter: false },
    { label: 'Strength Rating', homeValue: homeExtras?.strength_score ?? null, awayValue: awayExtras?.strength_score ?? null, higherIsBetter: true },
    { label: 'Venue Advantage', homeValue: homeExtras?.venue_advantage_score ?? null, awayValue: awayExtras?.venue_advantage_score ?? null, higherIsBetter: true },
    { label: 'Goals Scored', homeValue: homeExtras?.goals_scored ?? null, awayValue: awayExtras?.goals_scored ?? null, higherIsBetter: true },
    { label: 'Goals Conceded', homeValue: homeExtras?.goals_conceded ?? null, awayValue: awayExtras?.goals_conceded ?? null, higherIsBetter: false },
    { label: 'Squad Stability', homeValue: homeIntel?.squad_stability_score ?? null, awayValue: awayIntel?.squad_stability_score ?? null, higherIsBetter: true },
    { label: 'Squad Depth', homeValue: homeIntel?.squad_depth_score ?? null, awayValue: awayIntel?.squad_depth_score ?? null, higherIsBetter: true },
    { label: 'Injury Impact', homeValue: homeInjury?.total_importance_lost ?? 0, awayValue: awayInjury?.total_importance_lost ?? 0, higherIsBetter: false },
    { label: 'Predicted Goals', homeValue: intel?.predicted_home_goals ?? null, awayValue: intel?.predicted_away_goals ?? null, higherIsBetter: true, decimals: 2 },
  ];

  const executiveSummary = hasEnoughForSignals ? generateExecutiveSummary({
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
    homeStrengthRating: homeExtras?.strength_score,
    awayStrengthRating: awayExtras?.strength_score,
    homeGoalsScored: homeExtras?.goals_scored,
    awayGoalsScored: awayExtras?.goals_scored,
    homeGoalsConceded: homeExtras?.goals_conceded,
    awayGoalsConceded: awayExtras?.goals_conceded,
    homeInjuredCount: homeInjury?.injured_count ?? 0,
    awayInjuredCount: awayInjury?.injured_count ?? 0,
    homeTopScorerPct: homeGoalDep?.top_scorer_pct,
    awayTopScorerPct: awayGoalDep?.top_scorer_pct,
  }) : null;

  // ─── Narrative Threads — the numbered story-point block from the source
  // documents, built with the same "only fire when genuinely notable"
  // discipline as the executive summary above. ─────────────────────────
  const narrativeThreads = hasEnoughForSignals ? generateNarrativeThreads({
    homeTeam: match.home_team?.name ?? 'Home',
    awayTeam: match.away_team?.name ?? 'Away',
    homeReadiness: homeReadinessAny,
    awayReadiness: awayReadinessAny,
    readinessGap: intel?.readiness_gap ?? (homeReadinessAny - awayReadinessAny),
    homeFormIndex: homeIntel?.form_index,
    awayFormIndex: awayIntel?.form_index,
    homeStrengthRating: homeExtras?.strength_score,
    awayStrengthRating: awayExtras?.strength_score,
    homeGoalsScored: homeExtras?.goals_scored,
    awayGoalsScored: awayExtras?.goals_scored,
    homeGoalsConceded: homeExtras?.goals_conceded,
    awayGoalsConceded: awayExtras?.goals_conceded,
    homeInjuredCount: homeInjury?.injured_count ?? 0,
    awayInjuredCount: awayInjury?.injured_count ?? 0,
    homeTopScorerPct: homeGoalDep?.top_scorer_pct,
    awayTopScorerPct: awayGoalDep?.top_scorer_pct,
    homeLast5Points: (homeForm ?? []).slice(0, 5).reduce((s: number, f: any) => s + (f.points ?? 0), 0),
    awayLast5Points: (awayForm ?? []).slice(0, 5).reduce((s: number, f: any) => s + (f.points ?? 0), 0),
    homeVenueAdvantage: homeExtras?.venue_advantage_score,
    awayVenueAdvantage: homeExtras?.venue_advantage_score != null ? 100 - homeExtras.venue_advantage_score : null,
    homeTopScorerName: toOne(homeGoalDep?.players)?.short_name ?? toOne(homeGoalDep?.players)?.name ?? null,
    awayTopScorerName: toOne(awayGoalDep?.players)?.short_name ?? toOne(awayGoalDep?.players)?.name ?? null,
    homeKeyPlayers: (matchKeyPlayers?.home ?? []).map((p: any) => ({
      name: p.shortName ?? p.name, positionCode: p.positionCode, importance: p.importance, goals: p.goals, assists: p.assists,
    })),
    awayKeyPlayers: (matchKeyPlayers?.away ?? []).map((p: any) => ({
      name: p.shortName ?? p.name, positionCode: p.positionCode, importance: p.importance, goals: p.goals, assists: p.assists,
    })),
  }) : [];

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

      {/* ── HERO: Match Header — kept as the dual-gauge pattern (not
          QuoteHero, which models ONE entity's single number; a match is
          inherently two-sided, and the existing side-by-side gauges +
          gap/score already serve as this page's natural "hero" — the
          thing that answers "who's favored, by how much, what's the
          score" in one glance). Unchanged from the pre-redesign version. ── */}
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
          </div>
        </div>
      </Card>

      {/* ── PAGE TABS — real reusable Tabs.tsx (horizontally scrollable on
          narrow screens) replacing the old inline MARKET_TABS button row.
          Five tabs now instead of two: TeamColumn (previously ALWAYS
          visible above the tabs — the single biggest chunk of content on
          the page) moves into its own Squad tab; the old Overview tab's
          six stacked cards split into Overview / Lineups / Narrative so
          each tab is scannable on its own instead of one long scroll. ── */}
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />

      {/* ── OVERVIEW — the fast digest: summary, comparison, scoreline ── */}
      {tab === 'Overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {executiveSummary && (
            <Card style={{ background: COLORS.blue+'0f', border: `1px solid ${COLORS.blue}30` }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:COLORS.blue }}>
                  💡 Executive Summary
                </span>
              </div>
              <div style={{ fontSize:13, color:COLORS.text, lineHeight:1.6 }}>{executiveSummary}</div>
              {matchInsight && (
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
              )}
            </Card>
          )}

          <Card>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Team Comparison
              </div>
            </div>
            <TeamComparisonMatrix
              homeTeam={match.home_team?.short_name ?? match.home_team?.name ?? 'Home'}
              awayTeam={match.away_team?.short_name ?? match.away_team?.name ?? 'Away'}
              rows={comparisonRows}
              homeFormString={homeFormString}
              awayFormString={awayFormString}
            />
          </Card>

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
        </div>
      )}

      {/* ── LINEUPS — predicted XI + everything about who's playing and
          what it means: player importance, goal-dependency and injury
          impact ("Lineups and its related impact data"). ── */}
      {tab === 'Lineups' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
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

          {/* ── POSITION DEPTH — Block 3 from the source document
              ("Position Depth Analysis": total/injured/available per
              position). Was only ever shown buried inside each team's
              own Squad sub-tab (TeamColumn); genuinely belongs here too,
              alongside the lineup and injury data it's directly tied to. ── */}
          {(homeDepth?.length > 0 || awayDepth?.length > 0) && (
            <Card>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Position Depth
                </div>
                <div style={{ fontSize: 10, color: COLORS.dim, marginTop: 2 }}>
                  Available vs total players per position
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                {[
                  { team: match.home_team, depth: aggregatePositionDepth(homeDepth || []) },
                  { team: match.away_team, depth: aggregatePositionDepth(awayDepth || []) },
                ].map(({ team, depth }, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>
                      {team?.short_name ?? team?.name}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                      {['GK', 'DEF', 'MID', 'FWD'].map(pos => {
                        const d = depth[pos];
                        const pct = d.total > 0 ? Math.round((d.available / d.total) * 100) : 0;
                        const color = pct < 60 ? COLORS.red : pct < 80 ? COLORS.amber : COLORS.green;
                        return (
                          <div key={pos} style={{ background: COLORS.surface2, borderRadius: 6, padding: '6px 8px', textAlign: 'center', border: `1px solid ${COLORS.border}` }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase' }}>{pos}</div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginTop: 2 }}>
                              {d.total > 0 ? d.available : '—'}{d.total > 0 && <span style={{ fontSize: 10, color: COLORS.dim, fontWeight: 400 }}>/{d.total}</span>}
                            </div>
                            {d.injured > 0 && <div style={{ fontSize: 9, fontWeight: 700, color: COLORS.red, marginTop: 1 }}>{d.injured} out</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(homeGoalDep || awayGoalDep || homeInjury || awayInjury) && (
            <Card>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Squad Risk
                </div>
                <div style={{ fontSize: 10, color: COLORS.dim, marginTop: 2 }}>
                  Goal-scoring concentration and injury impact for each side
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                {[
                  { team: match.home_team, goalDep: homeGoalDep, injury: homeInjury },
                  { team: match.away_team, goalDep: awayGoalDep, injury: awayInjury },
                ].map(({ team, goalDep, injury }, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>
                      {team?.short_name ?? team?.name}
                    </div>
                    {goalDep ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                        <span style={{ color: COLORS.muted }}>
                          Top scorer{' '}
                          <span style={{ color: COLORS.dim }}>
                            ({toOne(goalDep.players)?.short_name ?? toOne(goalDep.players)?.name ?? '—'})
                          </span>
                        </span>
                        <span style={{
                          fontFamily: '"JetBrains Mono",monospace', fontWeight: 700,
                          color: goalDep.top_scorer_pct >= 35 ? COLORS.red : goalDep.top_scorer_pct >= 20 ? COLORS.amber : COLORS.green,
                        }}>
                          {goalDep.top_scorer_pct}%
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: COLORS.dim, marginBottom: 6 }}>Not yet computed</div>
                    )}
                    {injury ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <span style={{ color: COLORS.muted }}>
                          {injury.injured_count} out
                          {injury.no_replacement_positions && (
                            <span style={{ color: COLORS.red, fontWeight: 700 }}> · no cover: {injury.no_replacement_positions}</span>
                          )}
                        </span>
                        <span style={{
                          fontFamily: '"JetBrains Mono",monospace', fontWeight: 700,
                          color: injury.total_importance_lost >= 40 ? COLORS.red : injury.total_importance_lost >= 20 ? COLORS.amber : COLORS.green,
                        }}>
                          −{injury.total_importance_lost}
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: COLORS.green, fontWeight: 600 }}>✓ Healthy squad</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {((matchKeyPlayers?.home?.length ?? 0) > 0 || (matchKeyPlayers?.away?.length ?? 0) > 0) && (
            <Card>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  📊 Player Importance Comparison
                </div>
                <div style={{ fontSize: 10, color: COLORS.dim, marginTop: 2 }}>
                  Predicted-XI players at 16%+ importance — season goals/assists/rating, from real synced data
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    {['Player', 'Team', 'Importance', 'Category', 'Goals', 'Assists', 'Rating', 'Role'].map(h => (
                      <th key={h} style={{ padding: '6px 8px', textAlign: h === 'Player' ? 'left' : 'center', fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...(matchKeyPlayers?.home ?? []).map((p: any) => ({ ...p, team: match.home_team?.short_name ?? match.home_team?.name })),
                    ...(matchKeyPlayers?.away ?? []).map((p: any) => ({ ...p, team: match.away_team?.short_name ?? match.away_team?.name })),
                  ]
                    .sort((a, b) => b.importance - a.importance)
                    .map((p: any) => {
                      const role = deriveRole(p.positionCode, p.goals, p.assists);
                      const category = deriveCategory(p.importance);
                      return (
                        <tr key={p.playerId} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: '6px 8px', color: COLORS.text, fontWeight: 600 }}>{p.shortName ?? p.name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: COLORS.muted, fontSize: 11 }}>{p.team}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: p.importance >= 20 ? COLORS.green : COLORS.text2 }}>{p.importance.toFixed(1)}%</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
                              color: COLORS[category.color], background: COLORS[category.color]+'20',
                              border: `1px solid ${COLORS[category.color]}40`, borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap',
                            }}>
                              {category.label}
                            </span>
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{p.goals}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{p.assists}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{p.rating != null ? p.rating.toFixed(2) : '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 11, color: COLORS.text2, whiteSpace: 'nowrap' }}>{role.emoji} {role.label}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* ── SQUAD — the deep per-team Form/Fixture Load/Squad/Intelligence
          breakdown (TeamColumn). Was ALWAYS visible above the tabs before
          this redesign — the single biggest contributor to "the page is
          a wall of data" now lives behind one tap instead of loading
          unconditionally on every visit. ── */}
      {tab === 'Squad' && (
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
      )}

      {/* ── NARRATIVE — the story-point synthesis, kept separate from the
          fast Overview digest since it's meant to be read, not scanned. ── */}
      {tab === 'Narrative' && (
        <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
          {narrativeThreads.length > 0 && (
            <Card>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  🚨 Key Narrative Threads
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {narrativeThreads.map((t, i) => (
                  <div key={i} style={{ borderLeft: `2px solid ${COLORS.border}`, paddingLeft: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>
                      {i + 1}. {t.title} {t.emoji}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.text2, lineHeight: 1.6, marginBottom: 6 }}>{t.text}</div>
                    <div style={{ fontSize: 11, color: COLORS.dim, fontStyle: 'italic' }}>Impact: {t.impact}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── DETAILED READINESS BREAKDOWN — the weighted 7-component
              contribution numbers behind the Comparison Matrix's single
              Readiness row; supplementary detail, not primary content. ── */}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 0' }}>
              Detailed Readiness Breakdown
            </summary>
            <Card style={{ marginTop: 10 }}>
              <ReadinessBreakdown components={readinessComponents} />
            </Card>
          </details>
        </div>
      )}

      {/* ── BETTING SIGNALS TAB — unchanged from the pre-redesign version. ── */}
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

      {/* ── RELATED — pivot to either team's own "quote page" without
          navigating back through the matches list first. ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Related
        </div>
        <RelatedPills items={[
          {
            href: teamUrl({ id: match.home_team?.id, slug: match.home_team?.slug, name: match.home_team?.name }),
            label: match.home_team?.short_name ?? match.home_team?.name ?? 'Home',
            value: homeReadinessAny != null ? Math.round(homeReadinessAny) : undefined,
            valueColor: homeReadinessAny != null ? scoreColor(homeReadinessAny) : undefined,
          },
          {
            href: teamUrl({ id: match.away_team?.id, slug: match.away_team?.slug, name: match.away_team?.name }),
            label: match.away_team?.short_name ?? match.away_team?.name ?? 'Away',
            value: awayReadinessAny != null ? Math.round(awayReadinessAny) : undefined,
            valueColor: awayReadinessAny != null ? scoreColor(awayReadinessAny) : undefined,
          },
        ]} />
      </div>
    </main>
  );
}
