import { db, LIVE } from "./supabase";
import type {
  MatchRow, TeamLite, MatchIntelligence, MatchOpportunity, MatchRisk,
  MarketSignal, TeamIntelligence, TeamGoalDependency, TeamInjuryImpact,
  TeamFormQuality, TeamVenuePerformance, TeamMomentum, PositionDepth,
  PredictedLineupPlayer, LeagueIntelligence, LeagueGapSummary,
} from "./types";
import * as M from "./mock";
import { normProb } from "./intel";

export { LIVE };

// The warehouse precomputes everything; the frontend is read-only. Each
// query attempts Supabase and cleanly falls back to demo intelligence,
// so the terminal renders whether or not credentials are configured.

const TEAM_COLS = "id, external_id, name, short_name, slug, crest_storage_path, country";

function teamFromRow(r: any): TeamLite {
  return {
    id: r.id, external_id: r.external_id, name: r.name,
    short_name: r.short_name, slug: r.slug,
    crest_storage_path: r.crest_storage_path, country: r.country,
  };
}

// ── Board: upcoming matches with attached intelligence ───
export async function getBoard(limit = 24): Promise<MatchRow[]> {
  const client = db();
  if (!client) return sortBoard(M.MOCK_MATCHES);

  const nowIso = new Date(Date.now() - 3 * 36e5).toISOString();
  const { data: matches, error } = await client
    .from("matches")
    .select(
      `id, external_match_id, date, status, competition,
       tournament:tournaments(id, external_id, name, slug, country),
       home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
       away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
    )
    .gte("date", nowIso)
    .order("date", { ascending: true })
    .limit(limit);

  if (error || !matches || matches.length === 0) return sortBoard(M.MOCK_MATCHES);

  const ids = matches.map((m: any) => m.id);
  const [intel, opp, risk] = await Promise.all([
    client.from("match_intelligence").select("*").in("match_id", ids),
    client.from("match_opportunity").select("*").in("match_id", ids),
    client.from("match_risk_intelligence").select("*").in("match_id", ids),
  ]);

  const iMap = indexBy(intel.data, "match_id");
  const oMap = indexBy(opp.data, "match_id");
  const rMap = indexBy(risk.data, "match_id");

  const rows: MatchRow[] = matches.map((m: any) => ({
    id: m.id, external_match_id: m.external_match_id, date: m.date,
    status: m.status, competition: m.competition,
    tournament: m.tournament ?? null,
    home: teamFromRow(m.home), away: teamFromRow(m.away),
    intel: iMap[m.id] ? normIntel(iMap[m.id]) : null,
    opportunity: oMap[m.id] ? normOpp(oMap[m.id]) : null,
    risk: rMap[m.id] ? normRisk(rMap[m.id]) : null,
  }));
  return sortBoard(rows);
}

function sortBoard(rows: MatchRow[]): MatchRow[] {
  return [...rows].sort(
    (a, b) =>
      (b.opportunity?.opportunity_score ?? -1) -
      (a.opportunity?.opportunity_score ?? -1)
  );
}

// ── Single match (full report) ───────────────────────────
export async function getMatch(id: number): Promise<MatchRow | null> {
  const client = db();
  if (!client) return M.MOCK_MATCHES.find((m) => m.id === id) ?? null;

  const { data: m, error } = await client
    .from("matches")
    .select(
      `id, external_match_id, date, status, competition, venue_id,
       tournament:tournaments(id, external_id, name, slug, country),
       home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
       away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
    )
    .eq("id", id)
    .single();
  if (error || !m) return M.MOCK_MATCHES.find((x) => x.id === id) ?? null;

  const [intel, opp, risk, signals, weather, result] = await Promise.all([
    client.from("match_intelligence").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_opportunity").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_risk_intelligence").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_signals").select("*").eq("match_id", id).order("strength", { ascending: false }),
    client.from("match_weather").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_results").select("home_score, away_score").eq("match_id", id).maybeSingle(),
  ]);

  return {
    id: m.id, external_match_id: m.external_match_id, date: m.date,
    status: m.status, competition: m.competition,
    tournament: (m.tournament as any) ?? null,
    home: teamFromRow(m.home), away: teamFromRow(m.away),
    home_score: result.data?.home_score ?? null,
    away_score: result.data?.away_score ?? null,
    intel: intel.data ? normIntel(intel.data) : null,
    opportunity: opp.data ? normOpp(opp.data) : null,
    risk: risk.data ? normRisk(risk.data) : null,
    signals: (signals.data as MarketSignal[]) ?? [],
    weather: weather.data ?? null,
  };
}

export async function getLineups(matchId: number): Promise<PredictedLineupPlayer[]> {
  const client = db();
  if (!client) {
    const m = M.MOCK_MATCHES.find((x) => x.id === matchId);
    if (!m) return [];
    return [...(M.MOCK_LINEUPS[m.home.id] ?? []), ...(M.MOCK_LINEUPS[m.away.id] ?? [])];
  }
  const { data } = await client
    .from("match_predicted_lineups")
    .select(`team_id, player_id, position_code, rank_in_position, confidence,
             player:players(id, name, short_name, position, current_injury, injury_status, injury_reason, injury_return_days, market_value)`)
    .eq("match_id", matchId);
  return (data as any[])?.map((r) => ({ ...r, player: r.player })) ?? [];
}

// ── Team hub bundles ─────────────────────────────────────
export async function getTeam(id: number): Promise<TeamLite | null> {
  const client = db();
  if (!client) return M.MOCK_TEAMS.find((t) => t.id === id) ?? null;
  const { data } = await client.from("teams").select(TEAM_COLS).eq("id", id).maybeSingle();
  return data ? teamFromRow(data) : null;
}

export async function getTeamIntel(id: number): Promise<{
  intel: TeamIntelligence | null;
  goalDep: TeamGoalDependency | null;
  injury: TeamInjuryImpact | null;
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  momentum: TeamMomentum | null;
  depth: PositionDepth[];
}> {
  const client = db();
  if (!client) {
    return {
      intel: M.MOCK_TEAM_INTEL[id] ?? null,
      goalDep: M.MOCK_GOAL_DEP[id] ?? null,
      injury: M.MOCK_INJURY_IMPACT[id] ?? null,
      formQuality: M.MOCK_FORM_QUALITY[id] ?? null,
      venue: M.MOCK_VENUE[id] ?? null,
      momentum: M.MOCK_MOMENTUM[id] ?? null,
      depth: M.MOCK_DEPTH[id] ?? [],
    };
  }
  const [intel, goalDep, injury, formQuality, venue, momentum, depth] = await Promise.all([
    client.from("team_intelligence").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_goal_dependency").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_injury_impact").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_form_quality").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_venue_performance").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_momentum").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_position_depth").select("*").eq("team_id", id),
  ]);
  return {
    intel: intel.data ?? null, goalDep: goalDep.data ?? null,
    injury: injury.data ?? null, formQuality: formQuality.data ?? null,
    venue: venue.data ?? null, momentum: momentum.data ?? null,
    depth: (depth.data as PositionDepth[]) ?? [],
  };
}

export async function getTeamUpcoming(id: number, limit = 5): Promise<MatchRow[]> {
  const board = await getBoard(40);
  return board.filter((m) => m.home.id === id || m.away.id === id).slice(0, limit);
}

// ── Leagues ──────────────────────────────────────────────
export async function getLeagues(): Promise<LeagueIntelligence[]> {
  const client = db();
  if (!client) return M.MOCK_LEAGUE_INTEL;
  const { data } = await client
    .from("league_intelligence")
    .select(`*, tournament:tournaments(id, external_id, name, slug, country, logo_storage_path)`)
    .order("avg_readiness", { ascending: false });
  return (data as LeagueIntelligence[]) ?? M.MOCK_LEAGUE_INTEL;
}

export async function getLeagueGap(): Promise<LeagueGapSummary[]> {
  const client = db();
  if (!client) return M.MOCK_LEAGUE_GAP;
  const { data } = await client
    .from("league_gap_summary")
    .select("*")
    .order("total_picks", { ascending: false });
  return (data as LeagueGapSummary[]) ?? M.MOCK_LEAGUE_GAP;
}

// ── normalizers ──────────────────────────────────────────
function indexBy(rows: any[] | null, key: string): Record<number, any> {
  const out: Record<number, any> = {};
  (rows ?? []).forEach((r) => (out[r[key]] = r));
  return out;
}
function normIntel(r: any): MatchIntelligence {
  return {
    ...r,
    win_probability_home: normProb(r.win_probability_home),
    win_probability_draw: normProb(r.win_probability_draw),
    win_probability_away: normProb(r.win_probability_away),
    confidence_score: r.confidence_score != null ? normProb(r.confidence_score) : null,
  };
}
function normOpp(r: any): MatchOpportunity {
  return {
    match_id: r.match_id,
    opportunity_score: r.opportunity_score ?? 0,
    executive_brief: r.executive_brief ?? null,
    signals: Array.isArray(r.signals) ? r.signals : [],
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
    score_components: r.score_components ?? {},
  };
}
function normRisk(r: any): MatchRisk {
  return {
    match_id: r.match_id,
    risk_score: r.risk_score ?? 0,
    risk_band: r.risk_band ?? "MEDIUM",
    predictability_score: r.predictability_score ?? 0,
    risk_factors: Array.isArray(r.risk_factors) ? r.risk_factors : [],
  };
}
