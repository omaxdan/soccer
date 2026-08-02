import { db, LIVE } from "./supabase";
import type {
  MatchRow, TeamLite, MatchIntelligence, MatchOpportunity, MatchRisk,
  MarketSignal, TeamIntelligence, TeamGoalDependency, TeamInjuryImpact,
  TeamFormQuality, TeamVenuePerformance, TeamMomentum, PositionDepth,
  PredictedLineupPlayer, LeagueIntelligence, LeagueGapSummary,
  DailyBettingCard,  // ✅ Add this
  MatchScoringProbabilities, ReadinessSnapshot,
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
export interface BoardWindow {
  /** Days before today to include. 0 = upcoming only, the board default. */
  daysBack?: number;
  /** Days after today to include. Omit for no forward bound. */
  daysForward?: number;
}

/**
 * `window` widens the fetch beyond the default "kickoff from three hours ago
 * onward". The schedule view needs past days for its date strip; without a
 * lower bound there is nothing behind today to navigate to.
 */
/**
 * Matches by id, with no date window at all — what getBoard() cannot do,
 * since every one of its callers relies on the window to keep the query
 * bounded. The watchlist needs the opposite: a saved match from three months
 * ago must still be fetchable, which a daysBack/daysForward filter would
 * always exclude regardless of how wide it was set.
 */
export async function getMatchesByIds(ids: number[]): Promise<MatchRow[]> {
  if (ids.length === 0) return [];
  const client = db();
  if (!client) return M.MOCK_MATCHES.filter((m) => ids.includes(m.id));
  try {
    const [matches, results] = await Promise.all([
      client
        .from("matches")
        .select(
          `id, external_match_id, date, status, competition,
           tournament:tournaments(id, external_id, name, slug, country:countries(id, name, alpha2)),
           home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
           away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
        )
        .in("id", ids),
      client.from("match_results").select("match_id, home_score, away_score").in("match_id", ids),
    ]);
    if (matches.error || !matches.data) return [];
    const resMap = new Map(((results.data as any[]) ?? []).map((r) => [r.match_id, r]));
    return sortBoard(
      (matches.data as any[]).map((m) => ({
        ...m,
        home_score: (resMap.get(m.id) as any)?.home_score ?? null,
        away_score: (resMap.get(m.id) as any)?.away_score ?? null,
      })) as MatchRow[]
    );
  } catch {
    return [];
  }
}

export async function getBoard(
  limit = 24,
  window?: BoardWindow
): Promise<MatchRow[]> {
  const client = db();
  if (!client)
    return sortBoard(
      M.MOCK_MATCHES.map((m) => ({
        ...m,
        home_form: M.MOCK_TEAM_INTEL[m.home.id]?.last_5_results ?? null,
        away_form: M.MOCK_TEAM_INTEL[m.away.id]?.last_5_results ?? null,
      }))
    );

  const DAY = 86_400_000;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const fromIso =
    window?.daysBack != null
      ? new Date(midnight.getTime() - window.daysBack * DAY).toISOString()
      : new Date(Date.now() - 3 * 36e5).toISOString();

  let query = client
    .from("matches")
    .select(
      `id, external_match_id, date, status, competition,
       tournament:tournaments(id, external_id, name, slug, country:countries(id, name, alpha2)),
       home:teams!matches_home_team_id_fkey(${TEAM_COLS}),
       away:teams!matches_away_team_id_fkey(${TEAM_COLS})`
    )
    .gte("date", fromIso);

  if (window?.daysForward != null) {
    query = query.lt(
      "date",
      new Date(midnight.getTime() + (window.daysForward + 1) * DAY).toISOString()
    );
  }

  const { data: matches, error } = await query
    .order("date", { ascending: true })
    .limit(limit);

  if (error || !matches || matches.length === 0) return sortBoard(M.MOCK_MATCHES);

  const ids = matches.map((m: any) => m.id);
  const teamIds = Array.from(new Set(matches.flatMap((m: any) => [m.home?.id, m.away?.id]).filter(Boolean)));
  // One batch, as before. team_intelligence widens from two columns to all of
  // them (same round trip), and four reads join it keyed on the id arrays that
  // were already computed above. Without these the dashboard cannot evaluate
  // modules 1-4, 11 or 12 at all, so the module filter reports 0 for them
  // however the predicate is written.
  const [intel, opp, risk, tIntel, tFormQ, tVenue, htIntel, scoring, travel, weatherRows, resultRows] = await Promise.all([
    client.from("match_intelligence").select("*").in("match_id", ids),
    client.from("match_opportunity").select("*").in("match_id", ids),
    client.from("match_risk_intelligence").select("*").in("match_id", ids),
    client.from("team_intelligence").select("*").in("team_id", teamIds),
    client.from("team_form_quality").select("*").in("team_id", teamIds),
    client.from("team_venue_performance").select("*").in("team_id", teamIds),
    client.from("match_half_time_intelligence").select("*").in("match_id", ids),
    client.from("mv_match_scoring_probabilities").select("*").in("match_id", ids),
    client.from("mv_module_travel").select("*").in("match_id", ids),
    client.from("match_weather").select("*").in("match_id", ids),
    // match_results is what getMatch reads for the detail hero. The board did
    // not fetch it at all, so every finished fixture rendered a dash.
    client.from("match_results").select("match_id, home_score, away_score").in("match_id", ids),
  ]);

  const iMap = indexBy(intel.data, "match_id");
  const oMap = indexBy(opp.data, "match_id");
  const rMap = indexBy(risk.data, "match_id");
  const formMap = indexBy(tIntel.data, "team_id");
  const fqMap = indexBy(tFormQ.data, "team_id");
  const venueMap = indexBy(tVenue.data, "team_id");
  const htMap = indexBy(htIntel.data, "match_id");
  const spMap = indexBy(scoring.data, "match_id");
  const tvMap = indexBy(travel.data, "match_id");
  const wMap = indexBy(weatherRows.data, "match_id");
  const resMap = indexBy(resultRows.data, "match_id");

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
    homeIntel: (formMap[m.home?.id] as any) ?? null,
    awayIntel: (formMap[m.away?.id] as any) ?? null,
    homeFormQuality: (fqMap[m.home?.id] as any) ?? null,
    awayFormQuality: (fqMap[m.away?.id] as any) ?? null,
    homeVenue: (venueMap[m.home?.id] as any) ?? null,
    awayVenue: (venueMap[m.away?.id] as any) ?? null,
    halfTime: (htMap[m.id] as any) ?? null,
    scoring: (spMap[m.id] as any) ?? null,
    travel: (tvMap[m.id] as any) ?? null,
    weather: (wMap[m.id] as any) ?? null,
    home_score: (resMap[m.id] as any)?.home_score ?? null,
    away_score: (resMap[m.id] as any)?.away_score ?? null,
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
function mapInjuries(rows: unknown): import("./types").PlayerInjuryRow[] {
  return ((rows as any[]) ?? []).map((p) => {
    const pi = Array.isArray(p.player_injuries) ? p.player_injuries[0] : p.player_injuries;
    return {
      player_id: p.id, name: p.name, short_name: p.short_name,
      injury_reason: pi?.injury_reason ?? null, injury_status: pi?.injury_status ?? null,
      expected_return_days: pi?.expected_return_days ?? null, days_out: pi?.days_out ?? null,
      injury_severity_score: pi?.injury_severity_score ?? null,
    };
  });
}

export async function getMatch(id: number): Promise<MatchRow | null> {
  const client = db();
  if (!client) return M.MOCK_MATCHES.find((m) => m.id === id) ?? null;

  const { data: m, error } = await client
    .from("matches")
    .select(
      `id, external_match_id, date, status, competition, venue_id,
       stadium:stadiums(name, city),
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
    homeBetting, awayBetting, homeIntel, awayIntel, homeSeasonStats, awaySeasonStats,
    homeFormQuality, awayFormQuality, homeVenue, awayVenue, travelRow,
    homeInj, awayInj, homeInjImpact, awayInjImpact] = await Promise.all([
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
    client.from("team_form_quality").select("*").eq("team_id", homeTeam.id).maybeSingle(),
    client.from("team_form_quality").select("*").eq("team_id", awayTeam.id).maybeSingle(),
    client.from("team_venue_performance").select("*").eq("team_id", homeTeam.id).maybeSingle(),
    client.from("team_venue_performance").select("*").eq("team_id", awayTeam.id).maybeSingle(),
    client.from("mv_module_travel").select("*").eq("match_id", id).maybeSingle(),
    client.from("players")
      .select("id, name, short_name, player_injuries!inner(injury_reason, injury_status, expected_return_days, days_out, injury_severity_score)")
      .eq("team_id", homeTeam.id).eq("player_injuries.active", true),
    client.from("players")
      .select("id, name, short_name, player_injuries!inner(injury_reason, injury_status, expected_return_days, days_out, injury_severity_score)")
      .eq("team_id", awayTeam.id).eq("player_injuries.active", true),
    client.from("team_injury_impact").select("*").eq("team_id", homeTeam.id).maybeSingle(),
    client.from("team_injury_impact").select("*").eq("team_id", awayTeam.id).maybeSingle(),
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
    venue: (m.stadium as any)?.name ?? null,
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
    homeFormQuality: (homeFormQuality.data as any) ?? null,
    awayFormQuality: (awayFormQuality.data as any) ?? null,
    homeVenue: (homeVenue.data as any) ?? null,
    awayVenue: (awayVenue.data as any) ?? null,
    travel: (travelRow.data as any) ?? null,
    homeInjuries: mapInjuries(homeInj.data),
    awayInjuries: mapInjuries(awayInj.data),
    homeInjuryImpact: (homeInjImpact.data as any) ?? null,
    awayInjuryImpact: (awayInjImpact.data as any) ?? null,
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

export async function getMatchScoringProbs(matchId: number): Promise<MatchScoringProbabilities | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("mv_match_scoring_probabilities")
    .select("*")
    .eq("match_id", matchId)
    .maybeSingle();
  return (data as MatchScoringProbabilities) ?? null;
}

export async function getLineups(matchId: number): Promise<PredictedLineupPlayer[]> {
  const client = db();
  if (!client) {
    const m = M.MOCK_MATCHES.find((x) => x.id === matchId);
    if (!m) return [];
    return enrichLineup([...(M.MOCK_LINEUPS[m.home.id] ?? []), ...(M.MOCK_LINEUPS[m.away.id] ?? [])]);
  }
  // Since migration 025 the backend lineup engine precomputes everything the
  // pitch view needs — the formation, the tactical slot, the player's natural
  // position, pitch coordinates, render order, and the score/suitability
  // behind the pick. All of it is selected here so nothing has to be inferred
  // client-side. Rows written before the engine ran carry NULLs in the new
  // columns; lib/formation.ts falls back to its own geometry for those.
  //
  // Historical note kept because it explains the shape of this function:
  // secondary_position/tertiary_position/shirt_number were once selected
  // directly off match_predicted_lineups, which has no such columns.
  // PostgREST errored, the error was discarded, and `data` came back null —
  // which .map(...) ?? [] silently turned into an empty array, rendering as
  // "not published yet" despite thousands of real rows existing. Those three
  // still come from players (jersey_number mapped onto shirt_number).
  const { data, error } = await client
    .from("match_predicted_lineups")
    .select(`team_id, player_id, position_code, position_group, tactical_position,
             natural_position, formation, lineup_order, x, y, role,
             weighted_score, suitability, is_captain, is_vice_captain,
             rank_in_position, confidence, matches_started, minutes_played,
             player:players(id, name, short_name, position, secondary_position, tertiary_position, jersey_number, current_injury, injury_status, injury_reason, injury_return_days, market_value)`)
    .eq("match_id", matchId)
    .order("team_id", { ascending: true })
    // lineup_order is the render order (1 = GK, 2 = RB, ...). rank_in_position
    // is a depth-chart rank WITHIN a position family and is not an ordering
    // for the XI as a whole; it stays as the fallback for pre-025 rows, which
    // have a null lineup_order.
    .order("lineup_order", { ascending: true, nullsFirst: false })
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
    position_group: r.position_group ?? null,
    tactical_position: r.tactical_position ?? null,
    natural_position: r.natural_position ?? null,
    formation: r.formation ?? null,
    lineup_order: r.lineup_order ?? null,
    x: r.x ?? null,
    y: r.y ?? null,
    role: r.role ?? null,
    weighted_score: r.weighted_score ?? null,
    suitability: r.suitability ?? null,
    is_captain: r.is_captain ?? null,
    is_vice_captain: r.is_vice_captain ?? null,
    secondary_position: r.player?.secondary_position ?? null,
    tertiary_position: r.player?.tertiary_position ?? null,
    rank_in_position: r.rank_in_position,
    confidence: r.confidence,
    matches_started: r.matches_started ?? null,
    minutes_played: r.minutes_played ?? null,
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
  strengthDashboard: import("./types").TeamStrengthDashboard | null;
  strengthRatings: import("./types").TeamStrengthRatings | null;
  playingStyle: import("./types").TeamPlayingStyle | null;
  strengths: import("./types").TeamStrengthItem[];
  weaknesses: import("./types").TeamWeaknessItem[];
  tacticalVariations: import("./types").TeamTacticalVariations | null;
  transferIntel: import("./types").TeamTransferIntelligence | null;
  injuries: import("./types").PlayerInjuryRow[];
  /** Evidence Maturity Framework — matches played this season, the count
   *  every historical-claim gate needs and nothing previously exposed. */
  seasonMatches: number | null;
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
      strengthDashboard: null,
      strengthRatings: null,
      playingStyle: null,
      strengths: [],
      weaknesses: [],
      tacticalVariations: null,
      transferIntel: null,
      injuries: [],
      seasonMatches: null,
    };
  }
  const [
    intel, betting, goalDep, injury, formQuality, venue, momentum, depth, motivation, versatility,
    strengthDashboard, strengthRatings, playingStyle, strengths, weaknesses, tacticalVariations, transferIntel, injuredPlayers,
    seasonStats,
  ] = await Promise.all([
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
    client.from("team_strength_dashboard").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_strength_ratings").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_playing_style").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_strengths").select("*").eq("team_id", id).order("score", { ascending: false }),
    client.from("team_weaknesses").select("*").eq("team_id", id).order("score", { ascending: true }),
    client.from("team_tactical_variations").select("*").eq("team_id", id).maybeSingle(),
    client.from("team_transfer_intelligence").select("*").eq("team_id", id).maybeSingle(),
    client.from("players")
      .select("id, name, short_name, player_injuries!inner(injury_reason, injury_status, expected_return_days, days_out, injury_severity_score)")
      .eq("team_id", id).eq("player_injuries.active", true),
    // Evidence Maturity Framework, Phase B: season matches played — the one
    // count missing from every table already fetched above. Added to this
    // EXISTING batch rather than a new query; every consumer of getTeamIntel
    // already pays for this round trip.
    client.from("team_season_statistics").select("matches, season_external_id").eq("team_id", id)
      .order("season_external_id", { ascending: false }).limit(1).maybeSingle(),
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
    strengthDashboard: (strengthDashboard.data as any) ?? null,
    strengthRatings: (strengthRatings.data as any) ?? null,
    playingStyle: (playingStyle.data as any) ?? null,
    strengths: (strengths.data as any) ?? [],
    weaknesses: (weaknesses.data as any) ?? [],
    tacticalVariations: (tacticalVariations.data as any) ?? null,
    transferIntel: (transferIntel.data as any) ?? null,
    injuries: ((injuredPlayers.data as any[]) ?? []).map((p) => {
      const pi = Array.isArray(p.player_injuries) ? p.player_injuries[0] : p.player_injuries;
      return {
        player_id: p.id, name: p.name, short_name: p.short_name,
        injury_reason: pi?.injury_reason ?? null, injury_status: pi?.injury_status ?? null,
        expected_return_days: pi?.expected_return_days ?? null, days_out: pi?.days_out ?? null,
        injury_severity_score: pi?.injury_severity_score ?? null,
      };
    }),
    seasonMatches: (seasonStats.data as any)?.matches ?? null,
  };
}

export async function getTeamUpcoming(id: number, limit = 5): Promise<MatchRow[]> {
  const board = await getBoard(40);
  return board.filter((m) => m.home.id === id || m.away.id === id).slice(0, limit);
}

// Current league position/points/GF/GA for a single team — same table as
// getLeagueStandings, filtered to one team's most recent season instead of
// a whole tournament. Powers the team page's quick League Position/PPG/GD
// cards.
export type TeamStanding = Omit<import("./types").TournamentStanding, "team">;
export async function getTeamStanding(teamId: number): Promise<TeamStanding | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client
    .from("tournament_standings")
    .select("position, matches, wins, draws, losses, scores_for, scores_against, points")
    .eq("team_id", teamId)
    .eq("standings_type", "total")
    .order("season_external_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TeamStanding) ?? null;
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
    description: "No picks available yet. Check back after the next data refresh.",
    summary: { 
      singles: 0, 
      bankers: 0,    // ✅ Added
      strongs: 0,    // ✅ Added
      days: 0,       // ✅ Added
      doubles: 0, 
      trebles: 0, 
      daily_accs: 0, 
      mega_accs: 0 
    },
    singles: [],
    accumulators: [],
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// Module directory counts
//
// COUNT(*) per module view. Uses head:true so PostgREST returns the count in
// the Content-Range header without transferring a single row — counting 1,386
// readiness rows by fetching them would be absurd, and fetchAllRows would
// paginate through all of them.
// ─────────────────────────────────────────────────────────────────────────────

import { MODULES, type ModuleKey } from "./modules";

export interface ModuleViewCount {
  key: ModuleKey;
  view: string;
  /** null means the view could not be read — see `error`. */
  count: number | null;
  error?: string;
}

/**
 * Ids of scheduled fixtures inside the rolling window the modules cover.
 * Match-scope counts are restricted to these so "firing now" means "in the
 * window", not "every row the view has ever held".
 */
export async function getUpcomingFixtureIds(days = 3): Promise<number[] | null> {
  const client = db();
  if (!client) return null;
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + days * 86_400_000);
  try {
    const { data, error } = await client
      .from("matches")
      .select("id")
      .eq("status", "scheduled")
      .gte("date", from.toISOString())
      .lt("date", to.toISOString());
    if (error || !data) return null;
    return (data as { id: number }[]).map((r) => r.id);
  } catch {
    return null;
  }
}

export async function getModuleViewCounts(
  fixtureIds?: number[] | null
): Promise<Record<ModuleKey, ModuleViewCount>> {
  const client = db();
  const empty = () =>
    MODULES.reduce(
      (acc, m) => ({
        ...acc,
        [m.key]: { key: m.key, view: m.source, count: null, error: "offline" },
      }),
      {} as Record<ModuleKey, ModuleViewCount>
    );
  if (!client) return empty();

  const entries = await Promise.all(
    MODULES.map(async (m): Promise<ModuleViewCount> => {
      try {
        let query = client.from(m.source).select("*", { count: "exact", head: true });
        // Team and league modules are one row per team / per competition, so a
        // fixture window does not apply to them. Match modules are windowed —
        // otherwise M12 reports 155 while the header says 140 fixtures exist,
        // and M13 counts weather rows for fixtures that have already been
        // played.
        if (m.scope === "match" && fixtureIds) {
          if (fixtureIds.length === 0) {
            return { key: m.key, view: m.source, count: 0 };
          }
          query = query.in("match_id", fixtureIds);
        }
        const { count, error } = await query;
        if (error) {
          // Most common cause by far: the materialized view exists but has no
          // GRANT SELECT to the anon role, so PostgREST cannot see it.
          return { key: m.key, view: m.source, count: null, error: error.message };
        }
        return { key: m.key, view: m.source, count: count ?? 0 };
      } catch (e) {
        return {
          key: m.key,
          view: m.source,
          count: null,
          error: e instanceof Error ? e.message : "unknown error",
        };
      }
    })
  );

  return entries.reduce(
    (acc, e) => ({ ...acc, [e.key]: e }),
    {} as Record<ModuleKey, ModuleViewCount>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Measured confidence bands
//
// backtest:bands writes one row per band to signal_backtests. Reading them
// here means the UI tracks the backtest instead of carrying a copy that goes
// stale the moment the job runs again — the 1,893-match table sat in the
// module registry for weeks after it was known to be wrong.
// ─────────────────────────────────────────────────────────────────────────────

export interface BandBacktest {
  band: string;
  rate: number;
  sample: number;
  hits: number;
  lift: number;
  /** Wilson 95% interval, as percentages. Null on any row written before migration 040. */
  ciLow: number | null;
  ciHigh: number | null;
  isCalibrated: boolean;
  evaluatedAt: string | null;
}

export async function getBandBacktests(): Promise<Record<string, BandBacktest>> {
  const client = db();
  if (!client) return {};
  try {
    const { data, error } = await client
      .from("signal_backtests")
      .select("rule_key, sample_size, hits, hit_rate, lift, ci_low, ci_high, is_calibrated, evaluated_at")
      .eq("market", "PICK_STRICT");
    if (error || !data) return {};
    const out: Record<string, BandBacktest> = {};
    for (const r of data as any[]) {
      const m = /^CBAND_(.+)$/.exec(r.rule_key ?? "");
      if (!m) continue;
      const band = m[1].charAt(0) + m[1].slice(1).toLowerCase();
      // A band with no matches behind it carries no rate. Publishing 0.0% on
      // n=0 would read as "never happens" rather than "never measured".
      if (!r.sample_size || r.sample_size <= 0) continue;
      out[band] = {
        band,
        rate: Number(r.hit_rate) * 100,
        sample: Number(r.sample_size),
        hits: Number(r.hits ?? 0),
        lift: Number(r.lift),
        ciLow: r.ci_low != null ? Number(r.ci_low) : null,
        ciHigh: r.ci_high != null ? Number(r.ci_high) : null,
        isCalibrated: r.is_calibrated === true,
        evaluatedAt: r.evaluated_at ?? null,
      };
    }
    return out;
  } catch {
    return {};
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Per-fixture player impact
//
// player_match_impact is already scoped to one match, so its scores carry the
// opponent context that player_intelligence deliberately does not. Everything
// the battles section ranks on is a column here — nothing is recomputed.
// ─────────────────────────────────────────────────────────────────────────────

export async function getMatchPlayerImpact(
  matchId: number
): Promise<import("./types").MatchPlayerImpact[]> {
  const client = db();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("player_match_impact")
      .select(
        `player_id, impact_score, importance_score, form_rating, goal_threat,
         assist_threat, creativity_score, defensive_contribution, impact_band,
         player:players(id, name, short_name, jersey_number, team_id, position, primary_position)`
      )
      .eq("match_id", matchId);
    if (error || !data) return [];
    return (data as any[])
      .filter((r) => r.player)
      .map((r) => ({
        player_id: r.player_id,
        team_id: r.player.team_id,
        name: r.player.name,
        short_name: r.player.short_name ?? null,
        jersey_number: r.player.jersey_number ?? null,
        position_code: r.player.primary_position ?? r.player.position ?? null,
        impact_score: r.impact_score ?? null,
        importance_score: r.importance_score ?? null,
        form_rating: r.form_rating ?? null,
        goal_threat: r.goal_threat ?? null,
        assist_threat: r.assist_threat ?? null,
        creativity_score: r.creativity_score ?? null,
        defensive_contribution: r.defensive_contribution ?? null,
        impact_band: r.impact_band ?? null,
      }));
  } catch {
    return [];
  }
}

/** Versatility scores for a set of players, where a row exists. */
export async function getPlayerVersatility(
  playerIds: number[]
): Promise<Record<number, number | null>> {
  const client = db();
  if (!client || playerIds.length === 0) return {};
  try {
    const { data, error } = await client
      .from("player_versatility")
      .select("player_id, versatility_score")
      .in("player_id", playerIds);
    if (error || !data) return {};
    const out: Record<number, number | null> = {};
    for (const v of data as any[]) out[v.player_id] = v.versatility_score ?? null;
    return out;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
//
// One read per page, over tables the platform already maintains. Nothing is
// generated: a team with no intelligence row simply carries nulls and the page
// shows them as unavailable rather than inventing a value.
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamDirectoryRow {
  id: number;
  name: string;
  short_name: string | null;
  country: string | null;
  /** Storage path the shared <Crest /> resolves; null falls back to initials. */
  crest_storage_path: string | null;
  readiness: number | null;
  form: number | null;
  adjustedForm: number | null;
  attack: number | null;
  defence: number | null;
  volatility: number | null;
  restDays: number | null;
  travelFatigue: number | null;
}

export interface TeamDirectoryResult {
  rows: TeamDirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Server-side search and pagination. Previously capped at 400 teams with no
 * way to reach anything past that — not "unpaginated", actually unreachable:
 * most of the platform's tracked teams could never appear on this page at
 * all. Base table stays team_intelligence (only teams the platform has
 * computed intelligence for are listed, same as before), ordered by
 * readiness_score — the page's existing default sort. A search term resolves
 * matching team ids first, via the trigram index already built for global
 * search (migration 036), then filters/paginates team_intelligence to that
 * set — still sorted by readiness among the matches, not by relevance, since
 * this page's whole point is browsing by strength, not fuzzy lookup.
 */
export async function getTeamDirectory(
  opts: { q?: string; page?: number; pageSize?: number } = {}
): Promise<TeamDirectoryResult> {
  const client = db();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (!client) return { rows: [], total: 0, page, pageSize };
  try {
    let matchingIds: number[] | null = null;
    if (opts.q && opts.q.trim().length >= 2) {
      const { data: matches } = await client
        .from("teams")
        .select("id")
        .or(`name.ilike.%${opts.q.trim()}%,short_name.ilike.%${opts.q.trim()}%`);
      matchingIds = ((matches as any[]) ?? []).map((r) => r.id);
      // A search with zero matches must produce zero rows, not "no filter" —
      // an empty .in() array would otherwise be dropped by PostgREST and
      // silently return everyone.
      if (matchingIds.length === 0) return { rows: [], total: 0, page, pageSize };
    }

    let intelQuery = client
      .from("team_intelligence")
      .select("team_id, readiness_score, form_index, rest_days_avg, travel_fatigue_score", { count: "exact" })
      .order("readiness_score", { ascending: false, nullsFirst: false });
    if (matchingIds) intelQuery = intelQuery.in("team_id", matchingIds);

    const { data: intel, count, error } = await intelQuery.range(from, to);
    if (error || !intel || intel.length === 0) return { rows: [], total: count ?? 0, page, pageSize };
    const ids = (intel as any[]).map((r) => r.team_id);

    const [teams, quality, dash] = await Promise.all([
      client.from("teams").select("id, name, short_name, country, crest_storage_path").in("id", ids),
      client
        .from("team_form_quality")
        .select("team_id, opponent_adjusted_form, volatility")
        .in("team_id", ids),
      client
        .from("team_strength_dashboard")
        .select("team_id, attack_rating, defense_rating")
        .in("team_id", ids),
    ]);

    const byId = <T extends { team_id?: number; id?: number }>(rows: T[] | null, key: "team_id" | "id") =>
      new Map((rows ?? []).map((r) => [(r as any)[key] as number, r]));
    const tMap = byId((teams.data as any[]) ?? [], "id");
    const qMap = byId((quality.data as any[]) ?? [], "team_id");
    const dMap = byId((dash.data as any[]) ?? [], "team_id");

    const rows = (intel as any[])
      .map((r) => {
        const t = tMap.get(r.team_id) as any;
        if (!t) return null;
        const q = qMap.get(r.team_id) as any;
        const d = dMap.get(r.team_id) as any;
        return {
          id: t.id,
          name: t.name,
          short_name: t.short_name ?? null,
          country: t.country ?? null,
          crest_storage_path: t.crest_storage_path ?? null,
          readiness: r.readiness_score ?? null,
          form: r.form_index ?? null,
          adjustedForm: q?.opponent_adjusted_form ?? null,
          attack: d?.attack_rating ?? null,
          defence: d?.defense_rating ?? null,
          volatility: q?.volatility ?? null,
          restDays: r.rest_days_avg ?? null,
          travelFatigue: r.travel_fatigue_score ?? null,
        } as TeamDirectoryRow;
      })
      .filter((r): r is TeamDirectoryRow => r !== null);
    return { rows, total: count ?? rows.length, page, pageSize };
  } catch {
    return { rows: [], total: 0, page, pageSize };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Players and search
// ─────────────────────────────────────────────────────────────────────────────

export interface PlayerDirectoryRow {
  id: number;
  name: string;
  short_name: string | null;
  jersey_number: number | null;
  position: string | null;
  team_id: number | null;
  team_name: string | null;
  team_crest: string | null;
  injured: boolean;
}

/** One batched read. Ordering is by team so the list reads as squads. */
export async function getPlayerDirectory(limit = 500): Promise<PlayerDirectoryRow[]> {
  const client = db();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("players")
      .select(
        "id, name, short_name, jersey_number, primary_position, position, current_injury, team_id, team:teams(id, name, crest_storage_path)"
      )
      .not("team_id", "is", null)
      .order("team_id")
      .limit(limit);
    if (error || !data) return [];
    return (data as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      short_name: p.short_name ?? null,
      jersey_number: p.jersey_number ?? null,
      position: p.primary_position ?? p.position ?? null,
      team_id: p.team_id ?? null,
      team_name: p.team?.name ?? null,
      team_crest: p.team?.crest_storage_path ?? null,
      injured: Boolean(p.current_injury),
    }));
  } catch {
    return [];
  }
}

export interface PlayerDetail {
  id: number;
  name: string;
  short_name: string | null;
  jersey_number: number | null;
  position: string | null;
  secondary_position: string | null;
  team: { id: number; name: string; crest_storage_path?: string | null } | null;
  injury: { reason: string | null; status: string | null; expectedReturnDays: number | null } | null;
  intelligence: Record<string, unknown> | null;
  season: Record<string, unknown> | null;
  versatility: number | null;
}

export async function getPlayerById(id: number): Promise<PlayerDetail | null> {
  const client = db();
  if (!client) return null;
  try {
    const { data: p } = await client
      .from("players")
      .select(
        "id, name, short_name, jersey_number, primary_position, secondary_position, position, current_injury, injury_reason, injury_status, injury_expected_return_days, team:teams(id, name, crest_storage_path)"
      )
      .eq("id", id)
      .maybeSingle();
    if (!p) return null;

    // Each of these is optional; a player with no intelligence row is still a
    // player, so nothing here is allowed to fail the page.
    const [intel, season, vers] = await Promise.all([
      client.from("player_intelligence").select("*").eq("player_id", id).maybeSingle(),
      client
        .from("player_season_statistics")
        .select("*")
        .eq("player_id", id)
        .order("season_external_id", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client.from("player_versatility").select("versatility_score").eq("player_id", id).maybeSingle(),
    ]);

    const row = p as any;
    return {
      id: row.id,
      name: row.name,
      short_name: row.short_name ?? null,
      jersey_number: row.jersey_number ?? null,
      position: row.primary_position ?? row.position ?? null,
      secondary_position: row.secondary_position ?? null,
      team: row.team ?? null,
      injury: row.current_injury
        ? {
            reason: row.injury_reason ?? null,
            status: row.injury_status ?? null,
            expectedReturnDays: row.injury_expected_return_days ?? null,
          }
        : null,
      intelligence: (intel.data as any) ?? null,
      season: (season.data as any) ?? null,
      versatility: (vers.data as any)?.versatility_score ?? null,
    };
  } catch {
    return null;
  }
}

export interface SearchHit {
  entityType: "team" | "league" | "player" | "match";
  entityId: number;
  title: string;
  subtitle: string;
  score: number;
}

/** Ranked search via the global_search function from migration 036. */
export async function globalSearch(q: string, limit = 20): Promise<SearchHit[]> {
  const client = db();
  if (!client || q.trim().length < 2) return [];
  try {
    const { data, error } = await client.rpc("global_search", {
      q: q.trim(),
      max_results: limit,
    });
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      title: r.title,
      subtitle: r.subtitle ?? "",
      score: Number(r.score ?? 0),
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Match Immutability Rule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The frozen pre-kickoff record for one match, if one was taken.
 *
 * A finished match's "Historical advantage" and "Historical confidence" must
 * display exactly what readiness_history froze before kickoff — never live
 * match_intelligence, which keeps recomputing as team state changes after the
 * match finishes. Fixing the backend's match-selection filter (see
 * jobs/processDbOnly.ts) stops FUTURE corruption of that live table; it does
 * not change what a finished match's page reads today. This is the read path
 * the actual display bug needs.
 *
 * Returns null when no snapshot exists — a match from before
 * archiveReadinessSnapshot existed, or one the job hasn't reached yet. The
 * caller must not silently treat that as "nothing to show": it means falling
 * back to live data, which the UI should say plainly rather than present as
 * frozen when it isn't.
 */
export async function getReadinessSnapshot(matchId: number): Promise<ReadinessSnapshot | null> {
  const client = db();
  if (!client) return null;
  try {
    const { data } = await client
      .from("readiness_history")
      .select("snapshot_at, predicted_pick, confidence_pct, predicted_gap")
      .eq("match_id", matchId)
      .maybeSingle();
    if (!data) return null;
    return {
      snapshotAt: (data as any).snapshot_at,
      predictedPick: (data as any).predicted_pick,
      confidencePct: Number((data as any).confidence_pct),
      readinessGap: Number((data as any).predicted_gap),
    };
  } catch {
    return null;
  }
}

/**
 * Elite/Strong/Moderate/Risky/Avoid from a confidence score, mirroring
 * beta/backend/src/lib/confidenceBand.ts's BAND_FLOOR thresholds
 * (95/85/70/55/0) exactly.
 *
 * This duplicates the backend's bandFor() — frontend and backend share no
 * TypeScript import graph anywhere in this codebase, a gap already flagged
 * earlier in this audit, not new here. What makes this specific duplication
 * defensible rather than the pattern the whole audit is about: it is a pure,
 * stateless classification of an ALREADY-FROZEN number
 * (readiness_history.confidence_pct), not a recomputation from live inputs.
 * Rounding a frozen number and classifying a frozen number carry the same
 * risk profile; this is the latter, not a second business-logic pipeline.
 */
export function bandForFrozenScore(score: number): "Elite" | "Strong" | "Moderate" | "Risky" | "Avoid" {
  if (score >= 95) return "Elite";
  if (score >= 85) return "Strong";
  if (score >= 70) return "Moderate";
  if (score >= 55) return "Risky";
  return "Avoid";
}
