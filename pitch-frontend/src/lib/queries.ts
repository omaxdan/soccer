import { db, LIVE } from "./supabase";
import type {
  MatchRow, TeamLite, MatchIntelligence, MatchOpportunity, MatchRisk,
  MarketSignal, TeamIntelligence, TeamGoalDependency, TeamInjuryImpact,
  TeamFormQuality, TeamVenuePerformance, TeamMomentum, PositionDepth,
  PredictedLineupPlayer, LeagueIntelligence, LeagueGapSummary,
  DailyBettingCard,  // ✅ Add this
} from "./types";
import * as M from "./mock";
import { normProb } from "./intel";
import { matchSlug, idFromParam } from "./slug";

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

// tournaments.country_id → countries; the nested join returns a country
// object, so flatten it to the country name string TournamentLite expects.
function normTournament(t: any): import("./types").TournamentLite | null {
  if (!t) return null;
  const country =
    typeof t.country === "string"
      ? t.country
      : t.country?.name ?? t.countries?.name ?? null;
  return {
    id: t.id, external_id: t.external_id, name: t.name, slug: t.slug ?? null,
    country, logo_storage_path: t.logo_storage_path ?? null,
  };
}

// ── Board: upcoming matches with attached intelligence ───
export async function getBoard(limit = 24): Promise<MatchRow[]> {
  const client = db();
  if (!client)
    return sortBoard(
      M.MOCK_MATCHES.map((m) => ({
        ...m,
        home_form: M.MOCK_TEAM_INTEL[m.home.id]?.last_5_results ?? null,
        away_form: M.MOCK_TEAM_INTEL[m.away.id]?.last_5_results ?? null,
      }))
    );

  const nowIso = new Date(Date.now() - 3 * 36e5).toISOString();
  const { data: matches, error } = await client
    .from("matches")
    .select(
      `id, external_match_id, date, status, competition,
       tournament:tournaments(id, external_id, name, slug, country:countries(id, name, alpha2)),
       home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
       away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
    )
    .gte("date", nowIso)
    .order("date", { ascending: true })
    .limit(limit);

  if (error || !matches || matches.length === 0) return sortBoard(M.MOCK_MATCHES);

  const ids = matches.map((m: any) => m.id);
  const teamIds = Array.from(new Set(matches.flatMap((m: any) => [m.home?.id, m.away?.id]).filter(Boolean)));
  const [intel, opp, risk, tIntel] = await Promise.all([
    client.from("match_intelligence").select("*").in("match_id", ids),
    client.from("match_opportunity").select("*").in("match_id", ids),
    client.from("match_risk_intelligence").select("*").in("match_id", ids),
    client.from("team_intelligence").select("team_id, last_5_results").in("team_id", teamIds),
  ]);

  const iMap = indexBy(intel.data, "match_id");
  const oMap = indexBy(opp.data, "match_id");
  const rMap = indexBy(risk.data, "match_id");
  const formMap = indexBy(tIntel.data, "team_id");

  const rows: MatchRow[] = matches.map((m: any) => ({
    id: m.id, external_match_id: m.external_match_id, date: m.date,
    status: m.status, competition: m.competition,
    tournament: normTournament(m.tournament),
    home: teamFromRow(m.home), away: teamFromRow(m.away),
    intel: iMap[m.id] ? normIntel(iMap[m.id]) : null,
    opportunity: oMap[m.id] ? normOpp(oMap[m.id]) : null,
    risk: rMap[m.id] ? normRisk(rMap[m.id]) : null,
    home_form: formMap[m.home?.id]?.last_5_results ?? null,
    away_form: formMap[m.away?.id]?.last_5_results ?? null,
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
       tournament:tournaments(id, external_id, name, slug, country:countries(id, name, alpha2)),
       home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
       away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
    )
    .eq("id", id)
    .single();
  if (error || !m) return M.MOCK_MATCHES.find((x) => x.id === id) ?? null;

  const homeTeam = teamFromRow(m.home);
  const awayTeam = teamFromRow(m.away);

  const [intel, opp, risk, signals, weather, result, halfTime,
    teamImpactHome, teamImpactAway, impactAdvantage, keyBattlesRaw,
    positionalMatchupsRaw, tacticalAdvantages, performanceComparison,
    substitutionImpact, squadDepthComparison,
    homeBetting, awayBetting, homeIntel, awayIntel, homeSeasonStats, awaySeasonStats] = await Promise.all([
    client.from("match_intelligence").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_opportunity").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_risk_intelligence").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_signals").select("*").eq("match_id", id).order("strength", { ascending: false }),
    client.from("match_weather").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_results").select("home_score, away_score").eq("match_id", id).maybeSingle(),
    client.from("match_half_time_intelligence").select("*").eq("match_id", id).maybeSingle(),
    client.from("team_match_impact").select("*").eq("match_id", id).eq("team_id", homeTeam.id).maybeSingle(),
    client.from("team_match_impact").select("*").eq("match_id", id).eq("team_id", awayTeam.id).maybeSingle(),
    client.from("match_impact_advantage").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_key_battles").select("*, home_player:players!match_key_battles_home_player_id_fkey(name), away_player:players!match_key_battles_away_player_id_fkey(name)").eq("match_id", id).order("importance_score", { ascending: false }),
    client.from("match_positional_matchups").select("*, home_player:players!match_positional_matchups_home_player_id_fkey(name), away_player:players!match_positional_matchups_away_player_id_fkey(name)").eq("match_id", id),
    client.from("match_tactical_advantages").select("*").eq("match_id", id),
    client.from("match_performance_comparison").select("*").eq("match_id", id).maybeSingle(),
    client.from("substitution_impact").select("*").eq("match_id", id).maybeSingle(),
    client.from("match_squad_depth_comparison").select("*").eq("match_id", id).maybeSingle(),
    // Team context for per-signal "why" evidence.
    client.from("team_betting_intelligence").select("*").eq("team_id", homeTeam.id).order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
    client.from("team_betting_intelligence").select("*").eq("team_id", awayTeam.id).order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
    client.from("team_intelligence").select("*").eq("team_id", homeTeam.id).maybeSingle(),
    client.from("team_intelligence").select("*").eq("team_id", awayTeam.id).maybeSingle(),
    client.from("team_season_statistics").select("*").eq("team_id", homeTeam.id).order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
    client.from("team_season_statistics").select("*").eq("team_id", awayTeam.id).order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const keyBattles = ((keyBattlesRaw.data as any[]) ?? []).map((b) => ({
    ...b, home_player_name: b.home_player?.name ?? null, away_player_name: b.away_player?.name ?? null,
  }));
  const positionalMatchups = ((positionalMatchupsRaw.data as any[]) ?? []).map((p) => ({
    ...p, home_player_name: p.home_player?.name ?? null, away_player_name: p.away_player?.name ?? null,
  }));

  return {
    id: m.id, external_match_id: m.external_match_id, date: m.date,
    status: m.status, competition: m.competition,
    tournament: normTournament(m.tournament),
    home: homeTeam, away: awayTeam,
    home_score: result.data?.home_score ?? null,
    away_score: result.data?.away_score ?? null,
    intel: intel.data ? normIntel(intel.data) : null,
    opportunity: opp.data ? normOpp(opp.data) : null,
    risk: risk.data ? normRisk(risk.data) : null,
    signals: (signals.data as MarketSignal[]) ?? [],
    weather: weather.data ?? null,
    halfTime: (halfTime.data as import("./types").MatchHalfTimeIntelligence) ?? null,
    teamImpact: { home: (teamImpactHome.data as any) ?? null, away: (teamImpactAway.data as any) ?? null },
    impactAdvantage: (impactAdvantage.data as any) ?? null,
    keyBattles, positionalMatchups,
    tacticalAdvantages: (tacticalAdvantages.data as any[]) ?? [],
    performanceComparison: (performanceComparison.data as any) ?? null,
    substitutionImpact: (substitutionImpact.data as any) ?? null,
    squadDepthComparison: (squadDepthComparison.data as any) ?? null,
    homeBetting: (homeBetting.data as any) ?? null,
    awayBetting: (awayBetting.data as any) ?? null,
    homeIntel: (homeIntel.data as any) ?? null,
    awayIntel: (awayIntel.data as any) ?? null,
    homeSeasonStats: (homeSeasonStats.data as any) ?? null,
    awaySeasonStats: (awaySeasonStats.data as any) ?? null,
  };
}

// Standalone half-time intelligence fetch (e.g. for a lighter widget).
export async function getMatchHalfTimeIntelligence(
  matchId: number
): Promise<import("./types").MatchHalfTimeIntelligence | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("match_half_time_intelligence").select("*").eq("match_id", matchId).maybeSingle();
  return (data as any) ?? null;
}

export async function getLineups(matchId: number): Promise<PredictedLineupPlayer[]> {
  const client = db();
  if (!client) {
    const m = M.MOCK_MATCHES.find((x) => x.id === matchId);
    if (!m) return [];
    return enrichLineup([...(M.MOCK_LINEUPS[m.home.id] ?? []), ...(M.MOCK_LINEUPS[m.away.id] ?? [])]);
  }
  // FIX: secondary_position/tertiary_position/shirt_number were being
  // selected directly off match_predicted_lineups, which has no such
  // columns (only id, match_id, team_id, player_id, position_code,
  // rank_in_position, matches_started, confidence, calculated_at — verified
  // against the live schema). PostgREST errored, the error was discarded,
  // and `data` came back null — which .map(...) ?? [] silently turned into
  // an empty array, rendering as "not published yet" despite 5,572 real
  // rows existing. Positions come from players.secondary_position/
  // tertiary_position; there is no shirt_number anywhere (players has
  // jersey_number) — mapped onto the same field name the UI expects.
  const { data, error } = await client
    .from("match_predicted_lineups")
    .select(`team_id, player_id, position_code, rank_in_position, confidence,
             player:players(id, name, short_name, position, secondary_position, tertiary_position, jersey_number, current_injury, injury_status, injury_reason, injury_return_days, market_value)`)
    .eq("match_id", matchId)
    .order("team_id", { ascending: true })
    .order("rank_in_position", { ascending: true });

  if (error) {
    console.error(`[getLineups] query failed for match ${matchId}:`, error.message);
    return [];
  }
  if (!data || data.length === 0) return [];

  return data.map((r: any) => ({
    team_id: r.team_id,
    player_id: r.player_id,
    position_code: r.position_code,
    secondary_position: r.player?.secondary_position ?? null,
    tertiary_position: r.player?.tertiary_position ?? null,
    rank_in_position: r.rank_in_position,
    confidence: r.confidence,
    shirt_number: r.player?.jersey_number ?? null,
    player: r.player,
  }));
}

// Demo lineups carry only a primary code; add plausible secondary/tertiary
// positions and shirt numbers so the pitch view demonstrates versatility.
// (In production these come straight from the warehouse.)
const ALT_POS: Record<string, [string, string?]> = {
  G: ["G"],
  D: ["DC", "DL"],
  M: ["DM", "AM"],
  F: ["RW", "ST"],
};
function enrichLineup(players: PredictedLineupPlayer[]): PredictedLineupPlayer[] {
  const perTeam: Record<number, number> = {};
  return players.map((p) => {
    const base = (p.position_code ?? "M").charAt(0).toUpperCase();
    perTeam[p.team_id] = (perTeam[p.team_id] ?? 0) + 1;
    const alts = ALT_POS[base] ?? [];
    // give ~60% of outfielders a secondary, ~30% a tertiary
    const seed = p.player_id % 10;
    const secondary = base !== "G" && seed < 6 ? alts[0] : undefined;
    const tertiary = base !== "G" && seed < 3 ? alts[1] : undefined;
    return {
      ...p,
      position_code: base === "F" ? (seed % 2 ? "RW" : "ST") : p.position_code,
      secondary_position: p.secondary_position ?? secondary,
      tertiary_position: p.tertiary_position ?? tertiary,
      shirt_number: p.shirt_number ?? perTeam[p.team_id],
    };
  });
}

// ── Slug-id resolvers (id is the source of truth) ───────
// The trailing numeric id in the URL is authoritative. We never query by a
// slug column (matches has none). A match/team/league that EXISTS but has
// incomplete intelligence still resolves — callers show a "processing" state
// rather than 404.
export async function getMatchBySlug(param: string): Promise<MatchRow | null> {
  const id = idFromParam(param);
  if (id != null) {
    const byId = await getMatch(id);
    if (byId) return byId;
    // fall back to external_match_id if the url carried the provider id
    const client = db();
    if (client) {
      const { data } = await client.from("matches").select("id").eq("external_match_id", id).maybeSingle();
      if (data) return getMatch(data.id);
    }
    return null;
  }
  // demo: no id in param → match computed slug
  const m = M.MOCK_MATCHES.find((x) => matchSlug(x) === param);
  return m ? getMatch(m.id) : null;
}

export async function getTeamBySlug(param: string): Promise<TeamLite | null> {
  const id = idFromParam(param);
  if (id != null) return getTeam(id);
  return null;
}

export async function getLeagueBySlug(param: string): Promise<{
  tournament: import("./types").TournamentLite;
  intel: LeagueIntelligence | null;
  gap: LeagueGapSummary | null;
} | null> {
  const id = idFromParam(param);
  if (id == null) return null;
  const leagues = await getLeagues();
  const gaps = await getLeagueGap();
  const li = leagues.find((l) => l.tournament_id === id);
  if (!li || !li.tournament) return null;
  const gap = gaps.find((g) => g.league_name.toLowerCase() === li.tournament!.name.toLowerCase()) ?? null;
  return { tournament: li.tournament, intel: li, gap };
}

// League table from tournament_standings — the source of truth for league
// membership. Latest season, standings_type='total', ordered by position.
export async function getLeagueStandings(tournamentId: number): Promise<import("./types").TournamentStanding[]> {
  const client = db();
  if (!client) return M.MOCK_STANDINGS[tournamentId] ?? [];
  // resolve latest season for this tournament
  const seasonRes = await client
    .from("tournament_standings")
    .select("season_external_id")
    .eq("tournament_id", tournamentId)
    .order("season_external_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const season = seasonRes.data?.season_external_id;
  let q = client
    .from("tournament_standings")
    .select(`position, matches, wins, draws, losses, scores_for, scores_against, points,
             team:teams!inner(${TEAM_COLS})`)
    .eq("tournament_id", tournamentId)
    .eq("standings_type", "total")
    .order("position", { ascending: true });
  if (season != null) q = q.eq("season_external_id", season);
  const { data } = await q;
  return (data as any[])?.map((r) => ({
    position: r.position, matches: r.matches, wins: r.wins, draws: r.draws, losses: r.losses,
    scores_for: r.scores_for, scores_against: r.scores_against, points: r.points,
    team: teamFromRow(r.team),
  })) ?? (M.MOCK_STANDINGS[tournamentId] ?? []);
}

// Teams participating in a league — scoped via standings so no cross-league
// leakage. Enriched per-team with intelligence for the Power Rankings tab.
export async function getLeagueTeams(tournamentId: number): Promise<
  { team: TeamLite; intel: TeamIntelligence | null; betting: import("./types").TeamBettingIntelligence | null }[]
> {
  const standings = await getLeagueStandings(tournamentId);
  if (standings.length === 0) return [];
  const client = db();
  if (!client) {
    return standings.map((s) => ({ team: s.team, intel: M.MOCK_TEAM_INTEL[s.team.id] ?? null, betting: null }));
  }
  const ids = standings.map((s) => s.team.id);
  const [{ data: intels }, { data: bettings }] = await Promise.all([
    client.from("team_intelligence").select("*").in("team_id", ids),
    client.from("team_betting_intelligence").select("*").in("team_id", ids)
      .order("season_external_id", { ascending: false }),
  ]);
  const iMap = indexBy(intels as any[], "team_id");
  // Multiple seasons possible per team; keep the first (most recent, per
  // the descending order above) — same dedup pattern used elsewhere for
  // season-scoped tables in this codebase.
  const bMap: Record<number, any> = {};
  for (const b of (bettings as any[]) ?? []) {
    if (!(b.team_id in bMap)) bMap[b.team_id] = b;
  }
  return standings.map((s) => ({ team: s.team, intel: iMap[s.team.id] ?? null, betting: bMap[s.team.id] ?? null }));
}

// Top players by importance_score (player_intelligence — team-context-free,
// unlike player_match_impact which is scoped to one fixture). Enriched with
// player_versatility where a row exists.
export async function getTeamKeyPlayers(teamId: number, limit = 6): Promise<{
  id: number; name: string; short_name: string | null; position: string | null;
  jersey_number: number | null; current_injury: boolean | null;
  importance_score: number | null; readiness_score: number | null; fatigue_score: number | null;
  goal_share_pct: number | null; assist_share_pct: number | null;
  versatility_score: number | null;
}[]> {
  const client = db();
  if (!client) return (M.MOCK_KEY_PLAYERS[teamId] ?? []).slice(0, limit);
  const { data: players, error } = await client
    .from("players")
    .select(`id, name, short_name, position, jersey_number, current_injury,
      player_intelligence!inner(importance_score, readiness_score, fatigue_score, goal_share_pct, assist_share_pct)`)
    .eq("team_id", teamId)
    .not("player_intelligence.importance_score", "is", null)
    .order("importance_score", { referencedTable: "player_intelligence", ascending: false })
    .limit(limit);
  if (error || !players || players.length === 0) return [];

  const ids = players.map((p: any) => p.id);
  const { data: versatility } = await client.from("player_versatility").select("player_id, versatility_score").in("player_id", ids);
  const vMap: Record<number, number | null> = {};
  for (const v of (versatility as any[]) ?? []) vMap[v.player_id] = v.versatility_score;

  return players.map((p: any) => {
    const pi = Array.isArray(p.player_intelligence) ? p.player_intelligence[0] : p.player_intelligence;
    return {
      id: p.id, name: p.name, short_name: p.short_name, position: p.position,
      jersey_number: p.jersey_number, current_injury: p.current_injury,
      importance_score: pi?.importance_score ?? null, readiness_score: pi?.readiness_score ?? null,
      fatigue_score: pi?.fatigue_score ?? null, goal_share_pct: pi?.goal_share_pct ?? null,
      assist_share_pct: pi?.assist_share_pct ?? null,
      versatility_score: vMap[p.id] ?? null,
    };
  });
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
  betting: import("./types").TeamBettingIntelligence | null;
  goalDep: TeamGoalDependency | null;
  injury: TeamInjuryImpact | null;
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  momentum: TeamMomentum | null;
  depth: PositionDepth[];
  motivation: import("./types").TeamMotivationData | null;
  versatility: import("./types").TeamVersatilityLatest | null;
}> {
  const client = db();
  if (!client) {
    return {
      intel: M.MOCK_TEAM_INTEL[id] ?? null,
      betting: null,
      goalDep: M.MOCK_GOAL_DEP[id] ?? null,
      injury: M.MOCK_INJURY_IMPACT[id] ?? null,
      formQuality: M.MOCK_FORM_QUALITY[id] ?? null,
      venue: M.MOCK_VENUE[id] ?? null,
      momentum: M.MOCK_MOMENTUM[id] ?? null,
      depth: M.MOCK_DEPTH[id] ?? [],
      motivation: M.MOCK_MOTIVATION[id] ?? null,
      versatility: null,
    };
  }
  const [intel, betting, goalDep, injury, formQuality, venue, momentum, depth, motivation, versatility] = await Promise.all([
    client.from("team_intelligence").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_betting_intelligence").select("*").eq("team_id", id)
      .order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
    client.from("team_goal_dependency").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_injury_impact").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_form_quality").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_venue_performance").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_momentum").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_position_depth").select("*").eq("team_id", id),
    client.from("team_motivation").select("*").eq("team_id", id).maybeSingle(),
    // team_versatility is per-MATCH (migration comment: rolling scalar lives
    // on team_intelligence.lineup_versatility_score instead) — this table
    // needs a specific match_id, so it has no single "current" row for a
    // team profile page. Most recent computed row stands in as a proxy.
    client.from("team_versatility").select("*").eq("team_id", id)
      .order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    intel: intel.data ?? null,
    betting: (betting.data as any) ?? null,
    goalDep: goalDep.data ?? null,
    injury: injury.data ?? null, formQuality: formQuality.data ?? null,
    venue: venue.data ?? null, momentum: momentum.data ?? null,
    depth: (depth.data as PositionDepth[]) ?? [],
    motivation: (motivation.data as any) ?? null,
    versatility: (versatility.data as any) ?? null,
  };
}

export async function getTeamUpcoming(id: number, limit = 5): Promise<MatchRow[]> {
  const board = await getBoard(40);
  return board.filter((m) => m.home.id === id || m.away.id === id).slice(0, limit);
}

// Next-N fixture difficulty (precomputed in team_fixture_difficulty).
export async function getFixtureDifficulty(teamId: number): Promise<import("./types").TeamFixtureDifficulty | null> {
  const client = db();
  if (!client) return M.MOCK_FIXTURE_DIFFICULTY[teamId] ?? null;
  const { data } = await client.from("team_fixture_difficulty").select("*").eq("team_id", teamId).maybeSingle();
  return (data as any) ?? null;
}

export async function getFixtureDifficultyMap(
  teamIds: number[]
): Promise<Record<number, import("./types").TeamFixtureDifficulty>> {
  const client = db();
  if (!client) {
    const out: Record<number, import("./types").TeamFixtureDifficulty> = {};
    teamIds.forEach((id) => { if (M.MOCK_FIXTURE_DIFFICULTY[id]) out[id] = M.MOCK_FIXTURE_DIFFICULTY[id]; });
    return out;
  }
  const { data } = await client.from("team_fixture_difficulty").select("*").in("team_id", teamIds);
  return indexBy(data as any[], "team_id");
}

// Raw season statistics → fed into the performance intelligence engine.
export interface TeamRecentFormRow {
  match_date: string;
  result: string;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  is_home: boolean | null;
  btts: boolean | null;
  half_time_score_for: number | null;
  half_time_score_against: number | null;
}
export async function getTeamRecentForm(id: number, limit = 8): Promise<TeamRecentFormRow[]> {
  const client = db();
  if (!client) return (M.MOCK_RECENT_FORM[id] ?? []).slice(0, limit);
  const { data } = await client
    .from("team_form_history")
    .select("match_date, result, goals_for, goals_against, points, is_home, btts, half_time_score_for, half_time_score_against")
    .eq("team_id", id)
    .order("match_date", { ascending: false })
    .limit(limit);
  return (data as TeamRecentFormRow[]) ?? [];
}

export async function getTeamSeasonStats(
  id: number
): Promise<import("./performance").TeamSeasonStats | null> {
  const client = db();
  if (!client) return M.MOCK_SEASON_STATS[id] ?? null;
  const { data } = await client
    .from("team_season_statistics")
    .select("*")
    .eq("team_id", id)
    .order("season_external_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // Map curated warehouse columns into the engine's superset shape. Fields
  // the table doesn't store are left undefined; the engine flags them.
  return {
    matches: data.matches ?? null,
    goals_scored: data.goals_scored ?? null,
    goals_conceded: data.goals_conceded ?? null,
    clean_sheets: data.clean_sheets ?? null,
    avg_possession: data.avg_possession ?? null,
    avg_rating: data.avg_rating ?? null,
    accurate_passes_pct: data.accurate_passes_pct ?? null,
    duels_won_pct: data.duels_won_pct ?? null,
    aerial_duels_won_pct: data.aerial_duels_won_pct ?? null,
    yellow_cards: data.yellow_cards ?? null,
    red_cards: data.red_cards ?? null,
    big_chances_created: data.big_chances_created ?? null,
    big_chances_missed: data.big_chances_missed ?? null,
    // extended raw fields — present only if the table has been widened
    shots: data.shots ?? null,
    shots_on_target: data.shots_on_target ?? null,
    shots_inside_box: data.shots_from_inside_the_box ?? null,
    goals_inside_box: data.goals_inside_box ?? null,
    goals_outside_box: data.goals_outside_box ?? null,
    headed_goals: data.headed_goals ?? null,
    left_foot_goals: data.left_foot_goals ?? null,
    right_foot_goals: data.right_foot_goals ?? null,
    long_balls_pct: data.long_balls_pct ?? null,
    crosses_pct: data.crosses_pct ?? null,
    big_chances: data.big_chances ?? null,
    shots_against: data.shots_against ?? null,
    shots_on_target_against: data.shots_on_target_against ?? null,
    big_chances_against: data.big_chances_against ?? null,
    errors_leading_to_goal: data.errors_leading_to_goal ?? null,
  };
}

// ── Leagues ──────────────────────────────────────────────
export async function getLeagues(): Promise<LeagueIntelligence[]> {
  const client = db();
  if (!client) return M.MOCK_LEAGUE_INTEL;
  const { data } = await client
    .from("league_intelligence")
    .select(`*, tournament:tournaments(id, external_id, name, slug, country:countries(id, name, alpha2), logo_storage_path)`)
    .order("avg_readiness", { ascending: false });
  if (!data) return M.MOCK_LEAGUE_INTEL;
  return (data as any[]).map((r) => ({ ...r, tournament: normTournament(r.tournament) })) as LeagueIntelligence[];
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

// Add this alongside your existing getBoard function
// In @/lib/queries.ts
export async function getBettingCard(): Promise<DailyBettingCard> {
  const client = db();
  if (!client) {
    return fallbackCard();
  }

  try {
    const { data, error } = await client.rpc("get_todays_betting_card");

    if (error) {
      console.error("Failed to fetch betting card:", error);
      return fallbackCard();
    }

    if (!data) {
      return fallbackCard();
    }

    return data as unknown as DailyBettingCard;
  } catch (err) {
    console.error("Betting card fetch error:", err);
    return fallbackCard();
  }
}

function fallbackCard(): DailyBettingCard {
  return {
    date: new Date().toISOString().split("T")[0],
    day: "Loading",
    summary: { singles: 0, doubles: 0, trebles: 0, daily_accs: 0, mega_accs: 0 },
    singles: [],
    accumulators: [],
  };
}