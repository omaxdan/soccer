import { supabase } from './supabase';
import { toOne } from '@/lib/relations';
import { Match } from '@/types/match';
// ─── UTC DAY BOUNDARIES ────────────────────────────────────────────────────
// EXPLICIT UTC, never local timezone. Match dates are stored as timestamptz
// (UTC). The previous pattern (new Date(); date.setHours(0,0,0,0)) computes
// midnight in whatever timezone the browser/server happens to be running in,
// then converts to UTC for the query — for a UTC+3 environment, a match at
// 23:00 UTC falls AFTER that local day's UTC-converted window (ends 20:59:59
// UTC), so it's silently excluded from "today" even though it's
// unambiguously today in UTC. UTC is the only timezone with no ambiguity
// for a global, multi-region platform — every "today" boundary in this file
// anchors to it.
function getUTCDayBounds(date?: Date): { start: Date; end: Date } {
  const d = date ?? new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
}

// ─── TRACKED LEAGUE PAIRS — slug + country ───────────────────────────────────
// Mirrors src/config/trackedLeagues.ts from the backend.
// BOTH slug and country must match the tournaments table — slug alone is not
// enough because many countries share the same slug (e.g. 'premier-league').
export const TRACKED_PAIRS: Array<{ slug: string; country: string }> = [
  // England
  { slug: 'premier-league',        country: 'England' },
  { slug: 'championship',          country: 'England' },
  { slug: 'league-one',            country: 'England' },
  { slug: 'league-two',            country: 'England' },
  // Spain
  { slug: 'laliga',                country: 'Spain' },
  { slug: 'laliga-2',              country: 'Spain' },
  // Germany
  { slug: 'bundesliga',            country: 'Germany' },
  { slug: '2-bundesliga',          country: 'Germany' },
  // Italy
  { slug: 'serie-a',               country: 'Italy' },
  { slug: 'serie-b',               country: 'Italy' },
  // France
  { slug: 'ligue-1',               country: 'France' },
  // Netherlands
  { slug: 'eredivisie',            country: 'Netherlands' },
  // Portugal
  { slug: 'liga-portugal-betclic', country: 'Portugal' },
  // Belgium
  { slug: 'jupiler-pro-league',    country: 'Belgium' },
  // Turkey
  { slug: 'super-lig',             country: 'Turkey' },   // also matches 'Türkiye' via aliases
  // Scotland
  { slug: 'premiership',           country: 'Scotland' },
  // Russia
  { slug: 'premier-league',        country: 'Russia' },
  // Norway
  { slug: 'eliteserien',           country: 'Norway' },
  // Sweden
  { slug: 'allsvenskan',           country: 'Sweden' },
  // Switzerland
  { slug: 'super-league',          country: 'Switzerland' },
  // Austria
  { slug: 'bundesliga',            country: 'Austria' },
  // Ireland
  { slug: 'premier-division',      country: 'Ireland' },
  // Finland
  { slug: 'veikkausliiga',         country: 'Finland' },
  // Lithuania
  { slug: 'a-lyga',                country: 'Lithuania' },
  // Brazil
  { slug: 'brasileirao-serie-a',   country: 'Brazil' },
  { slug: 'brasileirao-serie-b',   country: 'Brazil' },
  // Argentina
  { slug: 'liga-profesional',      country: 'Argentina' },
  { slug: 'primera-nacional',      country: 'Argentina' },
  // Colombia
  { slug: 'primera-a-apertura',    country: 'Colombia' },
  // Uruguay
  { slug: 'primera-division',      country: 'Uruguay' },
  // Ecuador
  { slug: 'ligapro-serie-a',       country: 'Ecuador' },
  // North America
  { slug: 'mls',                   country: 'USA' },
  { slug: 'liga-mx',               country: 'Mexico' },
  // Africa
  { slug: 'premier-league',        country: 'Egypt' },
  { slug: 'premiership',           country: 'South Africa' },
  // Asia
  { slug: 'j1-league',             country: 'Japan' },
  { slug: 'j2-league',             country: 'Japan' },
  { slug: 'k-league-1',            country: 'South Korea' },
  { slug: 'k-league-2',            country: 'South Korea' },
  { slug: 'saudi-pro-league',      country: 'Saudi Arabia' },
  { slug: 'indian-super-league',   country: 'India' },
  { slug: 'cfa-super-league',      country: 'China' },
];

// Derived: slug-only list for the DB .in() pre-filter (broader, then narrowed by country in JS)
export const TRACKED_SLUGS = [...new Set(TRACKED_PAIRS.map(p => p.slug))];

// Known country name aliases — what the API stores vs what TRACKED_PAIRS uses
const COUNTRY_ALIASES: Record<string, string[]> = {
  'turkey':       ['türkiye', 'turkiye'],
  'south korea':  ['korea republic', 'republic of korea'],
  'usa':          ['united states', 'united states of america'],
  'czechia':      ['czech republic'],
  'netherlands':  ['holland'],
  'russia':       ['russian federation'],
  'iran':         ['ir iran'],
  'south africa': ['rsa'],
};

function countriesMatch(dbCategory: string, trackedCountry: string): boolean {
  const db = dbCategory.toLowerCase().trim();
  const tr = trackedCountry.toLowerCase().trim();
  if (db === tr) return true;                              // exact
  if (db.includes(tr) || tr.includes(db)) return true;   // substring
  const aliases = COUNTRY_ALIASES[tr] ?? [];              // known aliases
  return aliases.some(a => db === a || db.includes(a));
}

/** Returns true if a DB tournament row matches a tracked league (slug + country). */
export function isTrackedTournament(slug: string, category: string): boolean {
  const s = slug.toLowerCase();
  return TRACKED_PAIRS.some(
    p => p.slug.toLowerCase() === s && countriesMatch(category, p.country)
  );
}

// ─── MODULE-LEVEL CACHES ──────────────────────────────────────────────────────
// These survive per-server-process (Next.js worker) — not per-request.
// Safe because tracked leagues and team lists change only when cron runs.
let _namesCache: string[] | null = null;
let _teamIdsCache: number[] | null = null;

// ─── TRACKED COMPETITION NAMES ────────────────────────────────────────────────
// Resolves exact competition names from the DB tournaments table.
// Two-step: DB pre-filter by slug, then JS narrow by slug+category.
// Without the category check 'premier-league' would match Ethiopia, Lebanon,
// Faroe Islands, Mongolia, Somalia, Syria, Tanzania etc.
export async function getTrackedCompetitionNames(): Promise<string[]> {
  if (_namesCache && _namesCache.length > 0) return _namesCache;

  // Step 1: DB pre-filter by slug (broad, uses index)
  const { data, error } = await supabase
    .from('tournaments')
    .select('name, slug, category')
    .in('slug', TRACKED_SLUGS);

  if (error || !data || data.length === 0) {
    console.warn('[RIP] No tracked tournaments in DB — run sync:today first');
    return [];
  }

  // Step 2: Narrow — BOTH slug AND category must match a TRACKED_PAIRS entry
  _namesCache = data
    .filter((t: any) => isTrackedTournament(t.slug ?? '', t.category ?? ''))
    .map((t: any) => t.name);

  if (_namesCache.length === 0) {
    console.warn('[RIP] Slug+category filter returned 0. Check TRACKED_PAIRS country values vs tournaments.category in DB.');
  }
  return _namesCache;
}

// ─── TRACKED TEAM IDs ────────────────────────────────────────────────────────
// Returns internal team IDs that have played in at least one tracked competition.
// Used to filter team_intelligence, team_fixture_load, team_travel_load etc.
export async function getTrackedTeamIds(): Promise<number[]> {
  if (_teamIdsCache && _teamIdsCache.length > 0) return _teamIdsCache;

  const names = await getTrackedCompetitionNames();
  if (names.length === 0) return [];

  const ids = new Set<number>();
  const chunk = 50;

  for (let i = 0; i < names.length; i += chunk) {
    const { data } = await supabase
      .from('matches')
      .select('home_team_id, away_team_id')
      .in('competition', names.slice(i, i + chunk));

    for (const m of data ?? []) {
      if (m.home_team_id) ids.add(m.home_team_id);
      if (m.away_team_id) ids.add(m.away_team_id);
    }
  }

  _teamIdsCache = Array.from(ids);
  return _teamIdsCache;
}

// ─── FK JOIN SYNTAX ───────────────────────────────────────────────────────────
// Uses column names (e.g. !home_team_id) not FK constraint names.
// Both tables must have RLS public read policy — run SUPABASE_RLS_SETUP.sql.
//
// SCHEMA-COUPLING RULE (learned the hard way, 2026-07-03): NEVER add a
// column from a not-yet-applied migration to this shared select. PostgREST
// rejects the ENTIRE query for one unknown column, every page using
// MATCH_SELECT throws, and the pages' `.catch(() => [])` silently renders
// "no matches" platform-wide — which is exactly what happened when
// confidence_score/confidence_band were added here before migration 016 had
// been run. New/optional columns get their own small standalone query with
// a soft-fail (see getMatchConfidenceMap below), so a missing migration can
// only ever degrade one column, never blank every match page.
const MATCH_SELECT = `
  id, date, competition, season, status,
  home_team_id, away_team_id,
  home_team:teams!home_team_id(id, name, short_name, slug, country, crest_storage_path),
  away_team:teams!away_team_id(id, name, short_name, slug, country, crest_storage_path),
  venue:stadiums!venue_id(id, name, city, country, latitude, longitude, capacity, timezone),
  match_results(home_score, away_score, half_time_home_score, half_time_away_score, winner_team_id, status),
  match_intelligence(
    home_readiness, away_readiness, readiness_gap, congestion_factor,
    home_rest_days, away_rest_days,
    home_travel_distance_km, away_travel_distance_km, travel_advantage_score,
    home_active_competitions, away_active_competitions,
    predicted_home_goals, predicted_away_goals, predicted_scorelines
  ),
  match_travel_intelligence(
    home_team_distance_km, away_team_distance_km,
    travel_advantage_km, travel_advantage_team_id
  )
`;

const MIN_SAMPLE_SIZE_MATCHES = 4;

/** Minimum-sample-size filter: excludes fixtures where either team has
 *  played fewer than MIN_SAMPLE_SIZE_MATCHES games this season - early
 *  in a season (or for a newly-tracked team), readiness/strength/form
 *  numbers are built on too small a sample to be a reliable signal.
 *  team_season_statistics has one row PER SEASON per team, so this
 *  can't just filter on "any row with matches>=4" - takes the highest
 *  season_external_id per team (same pattern already used for player
 *  season stats a few functions up) so a stale prior-season row with
 *  a full 38 games doesn't incorrectly pass a team that's only played
 *  2 games in the CURRENT season.
 *  Worth knowing: this can substantially shrink match center content
 *  in the first few gameweeks of any tracked league's season, or for
 *  any newly-added team/competition - by design, not a bug, but a real
 *  content-volume tradeoff worth watching, especially with several
 *  leagues potentially starting their seasons at different times. */
async function filterBySampleSize<T extends { home_team_id: number; away_team_id: number }>(matches: T[]): Promise<T[]> {
  if (matches.length === 0) return matches;
  const teamIds = [...new Set(matches.flatMap(m => [m.home_team_id, m.away_team_id]).filter((id): id is number => id != null))];
  if (teamIds.length === 0) return matches;

  const { data } = await supabase
    .from('team_season_statistics')
    .select('team_id, season_external_id, matches')
    .in('team_id', teamIds);

  const latestByTeam = new Map<number, { season: number; played: number }>();
  for (const row of data ?? []) {
    const existing = latestByTeam.get(row.team_id);
    if (existing && existing.season >= (row.season_external_id ?? 0)) continue;
    latestByTeam.set(row.team_id, { season: row.season_external_id ?? 0, played: row.matches ?? 0 });
  }

  return matches.filter(m => {
    const homePlayed = latestByTeam.get(m.home_team_id)?.played ?? 0;
    const awayPlayed = latestByTeam.get(m.away_team_id)?.played ?? 0;
    return homePlayed >= MIN_SAMPLE_SIZE_MATCHES && awayPlayed >= MIN_SAMPLE_SIZE_MATCHES;
  });
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export async function getTodaysMatches() {
  const { start, end } = getUTCDayBounds();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches').select(MATCH_SELECT)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .not('status', 'in', `(${INACTIVE_MATCH_STATUSES.join(',')})`)
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data, error } = await q;
  if (error) throw error;
  return filterBySampleSize(data ?? []);
}

export async function getReadinessRankings(limit = 50) {
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_intelligence')
    .select(`team_id, readiness_score, form_index, congestion_score, travel_fatigue_score,
      active_competitions, last_5_points, last_10_points,
      team:teams!team_id(id, name, short_name, slug, country, crest_storage_path)`)
    .not('readiness_score', 'is', null)
    .order('readiness_score', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getMostCongestedTeams(limit = 5) {
  const today   = new Date().toISOString().split('T')[0];
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_fixture_load')
    .select(`team_id, matches_next_7_days, matches_next_14_days, congestion_score,
      team:teams!team_id(id, name, slug, country)`)
    .eq('snapshot_date', today)
    .order('matches_next_7_days', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data } = await q;
  return data ?? [];
}

export async function getTodayTravelAlerts() {
  const { start, end } = getUTCDayBounds();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches')
    .select(`id, competition, date, away_team_id,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name),
      match_travel_intelligence(away_team_distance_km, travel_advantage_km)`)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data } = await q;
  if (!data) return [];

  const filtered = data
    .filter((m: any) => (toOne(m.match_travel_intelligence)?.away_team_distance_km ?? 0) > 500)
    .sort((a: any, b: any) =>
      (toOne(b.match_travel_intelligence)?.away_team_distance_km ?? 0) -
      (toOne(a.match_travel_intelligence)?.away_team_distance_km ?? 0))
    .slice(0, 5);

  // team_intelligence has no direct FK path from matches for PostgREST to
  // embed (matches -> teams -> team_intelligence is two hops). Fetch the
  // away teams' precomputed travel_fatigue_score separately and assemble
  // in memory — this is relational joining, not calculation; the score
  // itself is already computed server-side by processTeamIntelligencePartial.
  const awayTeamIds = filtered.map((m: any) => m.away_team_id).filter(Boolean);
  const { data: intelRows } = awayTeamIds.length > 0
    ? await supabase.from('team_intelligence').select('team_id, travel_fatigue_score').in('team_id', awayTeamIds)
    : { data: [] };
  const fatigueByTeam = new Map((intelRows ?? []).map((r: any) => [r.team_id, r.travel_fatigue_score]));

  return filtered.map((m: any) => ({
    ...m,
    away_team_travel_fatigue_score: fatigueByTeam.get(m.away_team_id) ?? null,
  }));
}

// ─── DASHBOARD SUMMARY (precomputed — never calculated at runtime) ───────────
// CRITICAL: this reads platform_daily_summary, written once by
// process:dashboard-summary. The frontend must never derive these numbers
// itself (no .reduce()/.filter().length/.map(Set).size on raw rows) — see
// migration 007 and processDashboardSummary() in the backend repo.
export async function getDashboardSummary() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await supabase
    .from('platform_daily_summary')
    .select('*')
    .eq('summary_date', today)
    .single();
  return data ?? null;
}

export async function getLastSyncTime(): Promise<string | null> {
  const { data } = await supabase
    .from('team_intelligence').select('calculated_at')
    .order('calculated_at', { ascending: false }).limit(1).single();
  return data?.calculated_at ?? null;
}

// ─── MATCH CENTER ─────────────────────────────────────────────────────────────

/** Match statuses that mean "this will not be played (as scheduled)" —
 *  excluded from the main match lists to cut noise, surfaced instead on
 *  their own dedicated page (/matches/inactive). Both 'canceled' and
 *  'cancelled' spellings included because syncDateMasterFeed passes the
 *  source API's status string through verbatim with no normalization —
 *  cheaper to match both here than to risk missing one. */
export const INACTIVE_MATCH_STATUSES = ['postponed', 'cancelled', 'canceled', 'abandoned'];

export async function getMatchesForDate(date: string) {
  const { start, end } = getUTCDayBounds(new Date(date));
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches').select(MATCH_SELECT)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .not('status', 'in', `(${INACTIVE_MATCH_STATUSES.join(',')})`)
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data, error } = await q;
  if (error) throw error;
  return filterBySampleSize(data ?? []);
}

/** Postponed / cancelled / abandoned matches — the ones excluded from
 *  every main list. Window: past 14 days to next 30 (a postponed match's
 *  original date can be in the recent past while still being relevant). */
export async function getInactiveMatches() {
  const now = Date.now();
  const from = new Date(now - 14 * 86400000).toISOString();
  const to = new Date(now + 30 * 86400000).toISOString();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches').select(MATCH_SELECT)
    .gte('date', from).lte('date', to)
    .in('status', INACTIVE_MATCH_STATUSES)
    .order('date', { ascending: false });
  if (names.length > 0) q.in('competition', names);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Confidence scores for a set of matches — deliberately a SEPARATE query
 *  from MATCH_SELECT with a soft-fail, so that if migration 016 hasn't been
 *  applied yet (columns don't exist), only the CONF % column degrades to
 *  "—" instead of every match query on the platform failing. See the
 *  schema-coupling rule on MATCH_SELECT above. */
export async function getMatchConfidenceMap(
  matchIds: number[]
): Promise<Map<number, { score: number; band: string | null }>> {
  const result = new Map<number, { score: number; band: string | null }>();
  if (matchIds.length === 0) return result;
  try {
    const { data, error } = await supabase
      .from('match_intelligence')
      .select('match_id, confidence_score, confidence_band')
      .in('match_id', matchIds)
      .not('confidence_score', 'is', null);
    if (error || !data) return result;
    for (const r of data) {
      result.set(r.match_id, { score: r.confidence_score, band: r.confidence_band ?? null });
    }
  } catch {
    // Columns missing (migration 016 not applied) or transient failure —
    // degrade the one column, never the page.
  }
  return result;
}

// ─── MATCH INTELLIGENCE PAGE ──────────────────────────────────────────────────

export async function getMatchById(id: number): Promise<any> {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', id)
    .single();

  // PGRST116 = "no rows found" from .single() — a genuine, expected
  // "match not found" case. Any OTHER error (network failure, RLS
  // denial, malformed query) should throw and stay visible rather than
  // silently rendering as the same "not found" state — same pattern
  // used by getTeamIntelligence() elsewhere in this file.
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export interface MatchKeyPlayer {
  playerId: number;
  name: string;
  shortName: string | null;
  positionCode: string;
  importance: number;
  goals: number;
  assists: number;
  rating: number | null;
}

/** Every predicted-XI player above an importance threshold, for both
 *  sides of a match — the data the "Key Player Battle" narrative thread
 *  was only using a single name from (team_goal_dependency's top scorer
 *  by GOALS specifically). This pulls from player_intelligence.
 *  importance_score instead, which already blends goals/assists/minutes/
 *  quality and is position-aware (a goalkeeper can qualify on minutes+
 *  quality alone, exactly like the source document's "Key Goalkeeper"
 *  entries) — so a genuinely important defender or keeper surfaces here
 *  even with zero goals, not just the top scorer.
 *  Default threshold matches the specific ask: "at least above 16%".
 *
 *  MINIMUM-COUNT BACKFILL (added after a real report of only 1 player
 *  per team showing up): the query was never limited to 1 — it pushes
 *  every qualifying row with no artificial cap. The actual cause is
 *  upstream: processPlayerIntelligence() leaves importance_score NULL
 *  (not 0) for any player without a resolved player_season_statistics
 *  row, and squads with sparse stats coverage can leave only one or two
 *  players with a real, non-null score above the 16% cutoff. Backfilling
 *  with the next-highest NON-NULL-importance players (regardless of the
 *  16% threshold) up to minCount makes the tab robust to that sparsity
 *  — but it can only surface players who have SOME computed importance;
 *  it cannot invent a score for a player whose importance is genuinely
 *  null. If a team still shows very few players after this, the real
 *  fix is improving player_season_statistics coverage (sync:player-stats),
 *  not this query. */
export async function getMatchKeyPlayers(
  matchId: number,
  homeTeamId: number,
  awayTeamId: number,
  minImportance = 16,
  minCount = 3
): Promise<{ home: MatchKeyPlayer[]; away: MatchKeyPlayer[] }> {
  const empty = { home: [], away: [] };

  const { data: lineupRows, error: lineupErr } = await supabase
    .from('match_predicted_lineups')
    .select('team_id, player_id, position_code')
    .eq('match_id', matchId);
  if (lineupErr || !lineupRows || lineupRows.length === 0) return empty;

  const playerIds = lineupRows.map((r: any) => r.player_id);

  const [playersRes, intelRes, statsRes] = await Promise.all([
    supabase.from('players').select('id, name, short_name').in('id', playerIds),
    supabase.from('player_intelligence').select('player_id, importance_score').in('player_id', playerIds),
    supabase.from('player_season_statistics').select('player_id, team_id, season_external_id, goals, assists, total_rating, count_rating').in('player_id', playerIds),
  ]);

  const playerMap = new Map<number, any>((playersRes.data ?? []).map((p: any) => [p.id, p]));
  const intelMap = new Map<number, number>((intelRes.data ?? []).map((r: any) => [r.player_id, r.importance_score]));

  // Same "most recent season only" resolution used throughout this
  // codebase's backend (player_season_statistics genuinely accumulates
  // one row per season over time) — keep only the highest
  // season_external_id per player.
  const statsMap = new Map<number, any>();
  for (const s of statsRes.data ?? []) {
    const existing = statsMap.get(s.player_id);
    if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
    statsMap.set(s.player_id, s);
  }

  // Build EVERY lineup player with a non-null importance score first
  // (regardless of threshold) — the threshold filter and backfill both
  // operate on this same pool, so a player never appears twice.
  const homeAll: MatchKeyPlayer[] = [];
  const awayAll: MatchKeyPlayer[] = [];

  for (const row of lineupRows) {
    const importance = intelMap.get(row.player_id);
    if (importance == null) continue; // genuinely no score to work with — can't backfill this player
    const player = playerMap.get(row.player_id);
    if (!player) continue;
    const stat = statsMap.get(row.player_id);
    const rating = stat?.count_rating > 0 && stat?.total_rating > 0
      ? Math.round((stat.total_rating / stat.count_rating) * 100) / 100
      : null;

    const entry: MatchKeyPlayer = {
      playerId: row.player_id,
      name: player.name,
      shortName: player.short_name,
      positionCode: row.position_code,
      importance,
      goals: stat?.goals ?? 0,
      assists: stat?.assists ?? 0,
      rating,
    };
    if (row.team_id === homeTeamId) homeAll.push(entry);
    else if (row.team_id === awayTeamId) awayAll.push(entry);
  }

  homeAll.sort((a, b) => b.importance - a.importance);
  awayAll.sort((a, b) => b.importance - a.importance);

  // Primary: everyone above the threshold. Backfill: if that's fewer
  // than minCount, take the next-highest-importance players regardless
  // of threshold until minCount is reached (or the pool runs out).
  const selectSide = (all: MatchKeyPlayer[]): MatchKeyPlayer[] => {
    const primary = all.filter(p => p.importance >= minImportance);
    if (primary.length >= minCount) return primary;
    const primaryIds = new Set(primary.map(p => p.playerId));
    const backfill = all.filter(p => !primaryIds.has(p.playerId)).slice(0, minCount - primary.length);
    return [...primary, ...backfill];
  };

  return { home: selectSide(homeAll), away: selectSide(awayAll) };
}

export interface MatchWithLineups {
  id: number;
  date: string;
  competition: string;
  season: string;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_team: any;
  away_team: any;
  venue: any;
  match_results: any[];
  match_intelligence: any[];
  match_travel_intelligence: any[];
  match_predicted_lineups: any[];
  home_lineup: any[];
  away_lineup: any[];
}

export async function getMatchWithLineups(id: number): Promise<MatchWithLineups | null> {
  // Get match
  const { data: match, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', id)
    .single();
  
  if (error || !match) return null;

  // ── Get lineups with position data ──────────────────────────────────────
  const { data: lineups } = await supabase
    .from('match_predicted_lineups')
    .select(`
      team_id, 
      player_id, 
      position_code, 
      rank_in_position,
      matches_started, 
      confidence,
      calculated_at,
      players:player_id (
        id, 
        name, 
        position, 
        position_detailed,
        primary_position,
        secondary_position,
        tertiary_position,
        jersey_number, 
        current_injury
      )
    `)
    .eq('match_id', id)
    .order('rank_in_position', { ascending: true });

  // ── Build the result with all properties ────────────────────────────────
  const result: MatchWithLineups = {
    ...match,
    match_predicted_lineups: lineups || [],
    home_lineup: [],
    away_lineup: [],
  };

  result.home_lineup = (result.match_predicted_lineups || [])
    .filter((l: any) => l.team_id === result.home_team_id);
  
  result.away_lineup = (result.match_predicted_lineups || [])
    .filter((l: any) => l.team_id === result.away_team_id);

  return result;
}

// ─── PRECOMPUTED MATCH SIGNALS ──────────────────────────────────────────────
// Reads from match_signals — written by processMatchSignals() (backend),
// which ports the exact same logic that used to run live in the browser
// (see lib/signals.ts's computeMatchSignals — that function and its own
// input-building code are UNCHANGED and still used as a fallback below for
// any match that doesn't have a precomputed row yet).

export interface StoredSignal {
  market: string;
  group: string;
  signal: string;
  direction: string;
  strength: number;
  drivers: string | null;
  dataSource: string | null;
  locked: boolean;
}

/** Precomputed signals for one match. Empty array if none computed yet
 *  (e.g. match hasn't been through process:match-signals) — caller should
 *  fall back to the live computeMatchSignals() in that case. */
export async function getMatchSignals(matchId: number): Promise<StoredSignal[]> {
  const { data, error } = await supabase
    .from('match_signals')
    .select('market, signal_group, signal_text, direction, strength, drivers, data_source, locked')
    .eq('match_id', matchId);

  if (error || !data) return [];
  return data.map((r: any) => ({
    market: r.market,
    group: r.signal_group,
    signal: r.signal_text,
    direction: r.direction,
    strength: r.strength,
    drivers: r.drivers,
    dataSource: r.data_source,
    locked: r.locked,
  }));
}

/** Bulk variant for pages showing signals across many matches at once
 *  (e.g. the Betting Hub). Returns a Map keyed by match_id, each value the
 *  same shape getMatchSignals() returns for a single match. */
export async function getMatchSignalsForMatches(matchIds: number[]): Promise<Map<number, StoredSignal[]>> {
  const result = new Map<number, StoredSignal[]>();
  if (matchIds.length === 0) return result;

  const { data, error } = await supabase
    .from('match_signals')
    .select('match_id, market, signal_group, signal_text, direction, strength, drivers, data_source, locked')
    .in('match_id', matchIds);

  if (error || !data) return result;

  for (const r of data) {
    const entry: StoredSignal = {
      market: r.market,
      group: r.signal_group,
      signal: r.signal_text,
      direction: r.direction,
      strength: r.strength,
      drivers: r.drivers,
      dataSource: r.data_source,
      locked: r.locked,
    };
    if (!result.has(r.match_id)) result.set(r.match_id, []);
    result.get(r.match_id)!.push(entry);
  }
  return result;
}

/** Bulk lineup-versatility fetch for the matches list page — same
 *  calculation as PredictedLineup.tsx's per-match versatility badge
 *  (share of predicted-XI players with more than one listed position:
 *  primary/secondary/tertiary), just computed across every match in a
 *  day at once instead of one match at a time. Returns a Map keyed by
 *  match_id, each value a Map keyed by team_id -> versatility percentage
 *  (0-100), so the caller can look up home/away by their own team_id
 *  without this function needing to know which side is which. */
export async function getMatchLineupVersatility(matchIds: number[]): Promise<Map<number, Map<number, number>>> {
  const result = new Map<number, Map<number, number>>();
  if (matchIds.length === 0) return result;

  const { data, error } = await supabase
    .from('match_predicted_lineups')
    .select('match_id, team_id, players:player_id(primary_position, secondary_position, tertiary_position)')
    .in('match_id', matchIds);

  if (error || !data) return result;

  // Group raw rows by (match_id, team_id) first, then compute the percentage —
  // same two-pass shape as PredictedLineup.tsx's own calculation.
  const grouped = new Map<string, any[]>();
  for (const r of data) {
    const key = `${r.match_id}:${r.team_id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(toOne(r.players));
  }

  for (const [key, players] of grouped) {
    const [matchIdStr, teamIdStr] = key.split(':');
    const matchId = Number(matchIdStr);
    const teamId = Number(teamIdStr);
    const versatileCount = players.filter(p => {
      if (!p) return false;
      return [p.primary_position, p.secondary_position, p.tertiary_position].filter(Boolean).length > 1;
    }).length;
    const pct = players.length > 0 ? Math.round((versatileCount / players.length) * 100) : 0;
    if (!result.has(matchId)) result.set(matchId, new Map());
    result.get(matchId)!.set(teamId, pct);
  }

  return result;
}

export async function getTeamIntelligence(teamId: number) {
  const { data, error } = await supabase
    .from('team_intelligence').select('*').eq('team_id', teamId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

// ─── BULK TEAM INTELLIGENCE — fallback for match pages ────────────────────
// match_intelligence (per-match readiness) lags behind matches.id — a match
// synced after the last process:all-db run won't have a row yet, even
// though team_intelligence (each team's own baseline) is current. matches
// has no direct FK to team_intelligence for PostgREST to embed (two hops:
// matches -> teams -> team_intelligence), so this is a separate query +
export interface WatchlistTeamRow {
  id: number;
  name: string;
  short_name: string | null;
  slug: string | null;
  country: string | null;
  readiness_score: number | null;
  form_index: number | null;
  congestion_score: number | null;
  league: string | null;
  position: number | null;
}

export interface WatchlistMatchRow {
  id: number;
  date: string;
  competition: string;
  status: string;
  home_team: { name: string; short_name: string | null; slug: string | null } | null;
  away_team: { name: string; short_name: string | null; slug: string | null } | null;
  homeScore: number | null;
  awayScore: number | null;
  homeReadiness: number | null;
  awayReadiness: number | null;
}

/** Lean, targeted fetch for the /watchlist page's matches section — same
 *  "just enough to render a glance list with a link to the full detail
 *  page" scope as getWatchlistTeams below, not the full MATCH_SELECT
 *  richness the match detail page needs. home_team/away_team are shaped
 *  as objects (not flat strings) specifically so matchUrl() can build a
 *  correct link straight off this row — matches have no slug column of
 *  their own, matchUrl() derives the URL from each team's slug/name. */
export async function getWatchlistMatches(matchIds: number[]): Promise<WatchlistMatchRow[]> {
  if (matchIds.length === 0) return [];

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, date, competition, status,
      home_team:teams!home_team_id(name, short_name, slug),
      away_team:teams!away_team_id(name, short_name, slug),
      match_results(home_score, away_score),
      match_intelligence(home_readiness, away_readiness)
    `)
    .in('id', matchIds)
    .order('date', { ascending: false });

  if (error || !data) return [];

  return data.map((m: any) => {
    const result = toOne(m.match_results);
    const intel = toOne(m.match_intelligence);
    return {
      id: m.id,
      date: m.date,
      competition: m.competition,
      status: m.status,
      home_team: m.home_team ?? null,
      away_team: m.away_team ?? null,
      homeScore: result?.home_score ?? null,
      awayScore: result?.away_score ?? null,
      homeReadiness: intel?.home_readiness ?? null,
      awayReadiness: intel?.away_readiness ?? null,
    };
  });
}

export interface WatchlistTeamRow {
  id: number;
  name: string;
  short_name: string | null;
  slug: string | null;
  country: string | null;
  readiness_score: number | null;
  form_index: number | null;
  congestion_score: number | null;
  league: string | null;
  position: number | null;
}

/** Lean, targeted fetch for the /watchlist page — just enough to render a
 *  glance list with links to each team's full detail page, not the full
 *  richness getTeamIntelligenceList() builds for the main Team Intelligence
 *  table (travel, form pills, trend). Returns [] for an empty/missing ID
 *  list rather than erroring. */
export async function getWatchlistTeams(teamIds: number[]): Promise<WatchlistTeamRow[]> {
  if (teamIds.length === 0) return [];

  const [intelRes, standingsRes] = await Promise.all([
    supabase.from('team_intelligence')
      .select('team_id, readiness_score, form_index, congestion_score, team:teams!team_id(id, name, short_name, slug, country)')
      .in('team_id', teamIds),
    supabase.from('tournament_standings')
      .select('team_id, position, tournament:tournaments(name)')
      .in('team_id', teamIds),
  ]);

  const standingsMap = new Map<number, { position: number | null; league: string | null }>();
  for (const s of standingsRes.data ?? []) {
    if (!standingsMap.has(s.team_id)) {
      standingsMap.set(s.team_id, { position: s.position ?? null, league: (s.tournament as any)?.name ?? null });
    }
  }

  const intelByTeam = new Map<number, any>((intelRes.data ?? []).map((r: any) => [r.team_id, r]));

  // Preserve the order teamIds was given in (whatever order the caller's
  // Set iterated) rather than whatever order Supabase happens to return —
  // keeps the rendered list stable across reloads instead of jumping
  // around each time.
  return teamIds
    .map((id) => {
      const intel = intelByTeam.get(id);
      const team = intel?.team;
      if (!team) return null;
      const standing = standingsMap.get(id);
      return {
        id: team.id,
        name: team.name,
        short_name: team.short_name,
        slug: team.slug,
        country: team.country,
        readiness_score: intel?.readiness_score ?? null,
        form_index: intel?.form_index ?? null,
        congestion_score: intel?.congestion_score ?? null,
        league: standing?.league ?? null,
        position: standing?.position ?? null,
      };
    })
    .filter((r): r is WatchlistTeamRow => r != null);
}

// in-memory join, same pattern as getTodayTravelAlerts() uses already.
// Returns a Map keyed by team_id so callers can look up home/away directly.
export async function getTeamIntelligenceMap(teamIds: number[]): Promise<Map<number, any>> {
  if (teamIds.length === 0) return new Map();
  const { data } = await supabase
    .from('team_intelligence')
    .select('*')
    .in('team_id', [...new Set(teamIds)]);
  return new Map((data ?? []).map((t: any) => [t.team_id, t]));
}

export async function getTeamFormHistory(teamId: number, limit = 10) {
  const { data, error } = await supabase
    .from('team_form_history')
    .select(`result, goals_for, goals_against, points, created_at,
      match:matches!match_id(date, competition,
        home_team:teams!home_team_id(name),
        away_team:teams!away_team_id(name))`)
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function getTeamFixtureLoad(teamId: number) {
  const { data } = await supabase
    .from('team_fixture_load').select('*').eq('team_id', teamId)
    .order('snapshot_date', { ascending: false }).limit(1).single();
  return data ?? null;
}

export async function getTeamTravelLoad(teamId: number) {
  const { data } = await supabase
    .from('team_travel_load').select('*').eq('team_id', teamId)
    .order('snapshot_date', { ascending: false }).limit(1).single();
  return data ?? null;
}

export async function getTeamSquadSnapshot(teamId: number) {
  const { data } = await supabase
    .from('team_squads_snapshot').select('*').eq('team_id', teamId)
    .order('snapshot_date', { ascending: false }).limit(1).single();
  return data ?? null;
}

export async function getTeamUpcomingMatches(teamId: number, days = 14) {
  const now   = new Date().toISOString();
  const end   = new Date(Date.now() + days * 86400000).toISOString();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches')
    .select(`id, date, competition, status,
      home_team:teams!home_team_id(id, name),
      away_team:teams!away_team_id(id, name)`)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'scheduled')
    .gte('date', now).lte('date', end)
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data } = await q;
  return data ?? [];
}

/**
 * Daily readiness/form/congestion history for the Trend chart on Team
 * Detail. Reads team_intelligence_history (migration 010). Will return
 * few or zero points until the daily process job has run multiple times
 * — see backend/docs/SCHEMA_GAP_ANALYSIS.md.
 */
export async function getTeamIntelligenceTrend(teamId: number, days = 14) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('team_intelligence_history')
    .select('snapshot_date, readiness_score, form_index, congestion_score')
    .eq('team_id', teamId)
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: true });
  // Table may not exist yet if migration 010 hasn't been run — fail soft,
  // the page shows an honest "not enough history yet" message either way.
  if (error) return [];
  return data ?? [];
}

/**
 * Key Players table — top players by readiness_score (migration 010
 * column). Falls back gracefully: players without a computed readiness
 * score (squad not synced, or processor hasn't run) are simply excluded
 * rather than shown with a fake value.
 */
export async function getTeamKeyPlayers(teamId: number, limit = 5) {
  // ── Get players ──────────────────────────────────────────────────────────
  const { data: players } = await supabase
    .from('players')
    .select('id, name, short_name, position, primary_position, date_of_birth, nationality_code, jersey_number, market_value, current_injury, injury_status, injury_reason, injury_return_days')
    .eq('team_id', teamId);
  
  if (!players || players.length === 0) return [];

  const playerIds = players.map((p: any) => p.id);

  // ── Get player intelligence ──────────────────────────────────────────────
  const { data: intel } = await supabase
    .from('player_intelligence')
    .select('player_id, readiness_score, fatigue_score, load_index, matches_last_7_days, minutes_last_7_days, importance_score, goal_share_pct, assist_share_pct')
    .in('player_id', playerIds);

  const intelMap = new Map<number, any>((intel ?? []).map((i: any) => [i.player_id, i]));

  // ── Get season statistics (for avg rating) ──────────────────────────────
  const { data: stats } = await supabase
    .from('player_season_statistics')
    .select('player_id, matches_started, appearances, minutes_played, goals, assists, total_rating, count_rating')
    .in('player_id', playerIds);

  const statsMap = new Map<number, any>((stats ?? []).map((s: any) => [s.player_id, s]));

  // ── Get active injuries ──────────────────────────────────────────────────
  const { data: injuries } = await supabase
    .from('player_injuries')
    .select('player_id, injury_reason, injury_status, expected_return_days, days_out, injury_severity_score')
    .in('player_id', playerIds)
    .eq('active', true);

  const injuryMap = new Map<number, any>((injuries ?? []).map((i: any) => [i.player_id, i]));

  // ── Get predicted lineups confidence for upcoming match ──────────────────
  // Find the next match for this team
  const now = new Date().toISOString();
  const { data: nextMatch } = await supabase
    .from('matches')
    .select('id')
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'scheduled')
    .gte('date', now)
    .order('date', { ascending: true })
    .limit(1)
    .single();

  let confidenceMap = new Map<number, number>();
  if (nextMatch) {
    const { data: lineups } = await supabase
      .from('match_predicted_lineups')
      .select('player_id, confidence')
      .eq('match_id', nextMatch.id)
      .eq('team_id', teamId);
    
    for (const l of lineups || []) {
      confidenceMap.set(l.player_id, l.confidence);
    }
  }

  const ageFromDob = (dob: string | null) => {
    if (!dob) return null;
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (365.25 * 86400000));
  };

  // ── Calculate avg rating from total/count ────────────────────────────────
  const calculateAvgRating = (stat: any): number | null => {
    if (!stat) return null;
    if (stat.count_rating && stat.count_rating > 0 && stat.total_rating) {
      return Math.round((stat.total_rating / stat.count_rating) * 100) / 100;
    }
    return null;
  };

  return players
    .map((p: any) => {
      const intel = intelMap.get(p.id);
      const stat = statsMap.get(p.id);
      const injury = injuryMap.get(p.id);
      const avgRating = calculateAvgRating(stat);
      const confidence = confidenceMap.get(p.id) || null;

      return {
        id: p.id,
        name: p.name,
        short_name: p.short_name,
        position: p.position,
        primary_position: p.primary_position,
        age: ageFromDob(p.date_of_birth),
        jersey_number: p.jersey_number,
        nationality_code: p.nationality_code,
        market_value: p.market_value,
        // ── Intelligence ──────────────────────────────────────────────────
        readiness_score: intel?.readiness_score || 0,
        fatigue_score: intel?.fatigue_score || 0,
        load_index: intel?.load_index || 0,
        matches_last_7_days: intel?.matches_last_7_days || 0,
        minutes_last_7_days: intel?.minutes_last_7_days || 0,
        importance_score: intel?.importance_score ?? null,
        goal_share_pct: intel?.goal_share_pct ?? null,
        assist_share_pct: intel?.assist_share_pct ?? null,
        // ── Season Stats ──────────────────────────────────────────────────
        matches_started: stat?.matches_started || 0,
        appearances: stat?.appearances || 0,
        minutes_played: stat?.minutes_played || 0,
        goals: stat?.goals || 0,
        assists: stat?.assists || 0,
        avg_rating: avgRating, // ← This is the key metric!
        // ── Confidence (from predicted lineups) ──────────────────────────
        confidence: confidence, // ← This is the key metric!
        // ── Injury Status ──────────────────────────────────────────────────
        current_injury: p.current_injury,
        injury_status: p.injury_status || injury?.injury_status || null,
        injury_reason: p.injury_reason || injury?.injury_reason || null,
        injury_return_days: p.injury_return_days || injury?.expected_return_days || null,
        injury_severity: injury?.injury_severity_score || null,
        days_out: injury?.days_out || 0,
      };
    })
    .filter((p: any) => p.readiness_score > 0 || p.avg_rating !== null) // Only show players with data
    .sort((a: any, b: any) => {
      // Sort by: 1. Confidence (if available), 2. Avg Rating, 3. Readiness
      const aConf = a.confidence || 0;
      const bConf = b.confidence || 0;
      if (aConf !== bConf) return bConf - aConf;
      
      const aRating = a.avg_rating || 0;
      const bRating = b.avg_rating || 0;
      if (aRating !== bRating) return bRating - aRating;
      
      return (b.readiness_score || 0) - (a.readiness_score || 0);
    })
    .slice(0, limit);
}

/** Squad composition by position group (GK/DEF/MID/FWD) for the donut chart. */
// Position depth per team — used by both Team Detail and Match pages.
// Selects the fuller column set (available_count, injured_count,
// total_market_value) even though Team Detail currently only reads
// position_code/player_count — was previously two near-identical
// functions (getTeamPositionBreakdown + getTeamPositionDepth) querying
// the same table with slightly different column sets; consolidated into
// this one, since the extra columns cost nothing to select and having a
// single canonical query is easier to maintain than two.
export async function getTeamPositionDepth(teamId: number) {
  const { data, error } = await supabase
    .from('team_position_depth')
    .select('position_code, player_count, available_count, injured_count, total_market_value')
    .eq('team_id', teamId);
  
  if (error) return [];
  return data ?? [];
}

/**
 * Next scheduled match with readiness gap — for the "Next Match" card.
 * Reuses match_intelligence when computed, falls back to team baseline
 * readiness on both sides same as everywhere else in this codebase.
 */
export async function getTeamNextMatch(teamId: number) {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('matches')
    .select(`id, date, competition, status,
      home_team_id, away_team_id,
      home_team:teams!home_team_id(id, name, short_name, slug),
      away_team:teams!away_team_id(id, name, short_name, slug),
      match_intelligence(home_readiness, away_readiness, readiness_gap)`)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .eq('status', 'scheduled')
    .gte('date', now)
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Reads team_fixture_difficulty — written by processFixtureDifficulty()
 *  (backend). Purely a read, no live-compute fallback needed here since
 *  this is a genuinely new metric (nothing computed this live before),
 *  unlike match_signals/league_intelligence which replaced an existing
 *  live computation. Returns null if not yet computed for this team. */
export async function getTeamFixtureDifficulty(teamId: number) {
  const { data, error } = await supabase
    .from('team_fixture_difficulty')
    .select('next_5_difficulty, next_10_difficulty, next_5_matches, next_10_matches')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Reads team_momentum — written by processTeamMomentum() (backend).
 *  Same "new metric, no live fallback needed" reasoning as
 *  getTeamFixtureDifficulty above. */
/** Lean bulk fetch of strength_score + venue_advantage_score + season
 *  goals for/against for 2+ teams — the pieces of an at-a-glance match
 *  comparison that weren't fetched anywhere on the match page before
 *  (team_strength_ratings and team_venue_performance were only ever read
 *  on the Team Detail page). Deliberately NOT reusing the heavier
 *  getTeamComparisonExtras() below — that also fetches 21-day upcoming
 *  fixtures, 5-match head-to-head, and full readiness trend history, none
 *  of which a match-page comparison table needs; pulling it wholesale
 *  here would add fetches, not reduce them, which was the whole point of
 *  this consolidation. team_season_statistics coverage is thin platform-
 *  wide (~55 rows as of the last audit) — goals_scored/goals_conceded
 *  come back null for most teams right now, handled gracefully by the
 *  comparison matrix component (renders "—", not a fake zero). */
export async function getMatchComparisonExtras(teamIds: number[]): Promise<Map<number, {
  strength_score: number | null;
  venue_advantage_score: number | null;
  goals_scored: number | null;
  goals_conceded: number | null;
}>> {
  const result = new Map<number, { strength_score: number | null; venue_advantage_score: number | null; goals_scored: number | null; goals_conceded: number | null }>();
  if (teamIds.length === 0) return result;
  const [strengthRes, venueRes, statsRes] = await Promise.all([
    supabase.from('team_strength_ratings').select('team_id, strength_score').in('team_id', teamIds),
    supabase.from('team_venue_performance').select('team_id, venue_advantage_score').in('team_id', teamIds),
    supabase.from('team_season_statistics').select('team_id, goals_scored, goals_conceded').in('team_id', teamIds),
  ]);
  const venueMap = new Map<number, number | null>((venueRes.data ?? []).map((r: any) => [r.team_id, r.venue_advantage_score]));
  const statsMap = new Map<number, { goals_scored: number | null; goals_conceded: number | null }>(
    (statsRes.data ?? []).map((r: any) => [r.team_id, { goals_scored: r.goals_scored, goals_conceded: r.goals_conceded }])
  );
  for (const id of teamIds) {
    const strength = (strengthRes.data ?? []).find((r: any) => r.team_id === id);
    const stats = statsMap.get(id);
    result.set(id, {
      strength_score: strength?.strength_score ?? null,
      venue_advantage_score: venueMap.get(id) ?? null,
      goals_scored: stats?.goals_scored ?? null,
      goals_conceded: stats?.goals_conceded ?? null,
    });
  }
  return result;
}

export async function getTeamMomentum(teamId: number) {
  const { data, error } = await supabase
    .from('team_momentum')
    .select('momentum_score, last_5_points, prior_5_points, trend')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Reads team_goal_dependency — written by processPlayerIntelligence()
 *  (backend), same season-scoped pass as player importance. Concentration
 *  risk, not "starters vs bench" — see that function's comments for why
 *  the starters-vs-bench framing was deliberately avoided (largely
 *  tautological, since predicted lineups are selected BY season form). */
export async function getTeamGoalDependency(teamId: number) {
  const { data, error } = await supabase
    .from('team_goal_dependency')
    .select('total_goals, total_assists, top_scorer_player_id, top_scorer_goals, top_scorer_pct, top_2_scorers_pct, top_scorer_no_backup, players:top_scorer_player_id(name, short_name)')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Reads team_injury_impact — SUM(importance_score) of currently-active
 *  injuries, correctly gated (see processPlayerIntelligence for why the
 *  source analysis this was built from had a real end_timestamp NULL bug
 *  that silently dropped open-ended injuries). Returns null (not zeros)
 *  when the team has no injured players, so the frontend can distinguish
 *  "genuinely healthy squad" from "not yet computed". */
export async function getTeamInjuryImpact(teamId: number) {
  const { data, error } = await supabase
    .from('team_injury_impact')
    .select('injured_count, total_importance_lost, goals_lost, assists_lost, no_replacement_positions, worst_absence_player_id, worst_absence_importance, players:worst_absence_player_id(name, short_name)')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

// ─── LEAGUE PAGE ──────────────────────────────────────────────────────────────

export async function getTrackedTournaments() {
  // Fetch all rows with matching slugs, then narrow by category in JS
  const { data } = await supabase
    .from('tournaments')
    .select('id, name, slug, category, logo_storage_path')
    .in('slug', TRACKED_SLUGS)
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  return (data ?? []).filter(
    (t: any) => isTrackedTournament(t.slug ?? '', t.category ?? '')
  );
}

export async function getLeagueTeams(tournamentName: string) {
  const { data } = await supabase
    .from('matches')
    .select(`home_team:teams!home_team_id(id, name, short_name, country),
             away_team:teams!away_team_id(id, name, short_name, country)`)
    .eq('competition', tournamentName)
    .limit(200);
  if (!data) return [];
  const map = new Map();
  data.forEach((m: any) => {
    [m.home_team, m.away_team].forEach((t: any) => { if (t) map.set(t.id, t); });
  });
  return Array.from(map.values());
}

// ─── TRAVEL HUB ───────────────────────────────────────────────────────────────

export async function getTravelBurdenRankings(limit = 10) {
  const teamIds = await getTrackedTeamIds();

  // team_travel_load accumulates SNAPSHOT rows over time (multiple rows
  // per team, one per processing run) — without deduping, a team with 4
  // snapshots appears 4 times in the ranking (real observed bug: Yunnan
  // Yukun rendered 4 identical rows). Fetch newest-first with headroom,
  // keep only each team's most recent snapshot, then cut to the limit.
  const q = supabase.from('team_travel_load')
    .select(`team_id, snapshot_date, km_last_30_days, travel_fatigue_score,
      away_matches_last_30_days, avg_trip_distance_km,
      team:teams!team_id(name, short_name, slug, country)`)
    .order('snapshot_date', { ascending: false })
    .limit(limit * 8);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data } = await q;
  const seen = new Set<number>();
  const deduped: any[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.team_id)) continue;
    seen.add(row.team_id);
    deduped.push(row);
  }
  deduped.sort((a, b) => (b.km_last_30_days ?? 0) - (a.km_last_30_days ?? 0));
  return deduped.slice(0, limit);
}

export async function getTodayTravelMatches() {
  const { start, end } = getUTCDayBounds();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches')
    .select(`id, competition, date,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name),
      match_travel_intelligence(home_team_distance_km, away_team_distance_km, travel_advantage_km)`)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data } = await q;
  return (data ?? []).filter((m: any) => toOne(m.match_travel_intelligence));
}

// ─── CONGESTION HUB ───────────────────────────────────────────────────────────

export async function getCongestionRankings(limit = 30) {
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_fixture_load')
    .select(`team_id, congestion_score, matches_last_7_days, matches_last_14_days,
      matches_next_7_days, matches_next_14_days, min_rest_days, avg_rest_days,
      team:teams!team_id(id, name, slug, country)`)
    .order('congestion_score', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data } = await q;
  return data ?? [];
}

export async function getWeekHeatmap() {
  const now  = new Date();
  const end  = new Date(now.getTime() + 7 * 86400000);
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches')
    .select(`date, home_team_id, away_team_id,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name)`)
    .gte('date', now.toISOString()).lte('date', end.toISOString())
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data } = await q;
  return data ?? [];
}

// ─── FORM HUB ─────────────────────────────────────────────────────────────────

export async function getFormPowerRankings(limit = 30) {
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_intelligence')
    .select(`team_id, form_index, last_5_points, last_10_points,
      team:teams!team_id(id, name, slug, country)`)
    .not('form_index', 'is', null)
    .order('form_index', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data } = await q;
  return data ?? [];
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

export async function searchTeams(q: string, limit = 10) {
  const teamIds = await getTrackedTeamIds();
  const query   = supabase.from('teams').select('id, name, short_name, slug, country, crest_storage_path')
    .ilike('name', `%${q}%`).limit(limit);
  if (teamIds.length > 0) query.in('id', teamIds);
  const { data } = await query;
  return data ?? [];
}

export async function searchTournaments(q: string, limit = 10) {
  const { data } = await supabase.from('tournaments')
    .select('id, name, slug, category, logo_storage_path')
    .in('slug', TRACKED_SLUGS)
    .ilike('name', `%${q}%`)
    .limit(limit);
  return (data ?? []).filter((t: any) => isTrackedTournament(t.slug ?? '', t.category ?? ''));
}

// ─── LEAGUE OVERVIEW ────────────────────────────────────────────────────────

export interface LeagueReadinessRow {
  tournament: { id: number; name: string; slug: string; category: string | null };
  teamCount: number;
  avgReadiness: number | null;
  avgForm: number | null;
  avgCongestion: number | null;
  avgTravel14d: number | null;
  avgRestDays: number | null;
  avgActiveComps: number | null;
}

/**
 * PRECOMPUTED FIRST — reads league_intelligence, written by
 * processLeagueIntelligence() (backend, see processDbOnly.ts). Falls back
 * to the live in-memory aggregation (renamed below to
 * computeLeagueReadinessRankingsLive) only if that table is empty — e.g.
 * process:league-intelligence hasn't run yet. This mirrors the same
 * "precomputed first, live fallback" pattern used for match signals (see
 * getMatchSignals / getMatchSignalsForMatches above).
 */
export async function getLeagueReadinessRankings(): Promise<LeagueReadinessRow[]> {
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, slug, category')
    .in('slug', TRACKED_SLUGS);
  if (!tournaments || tournaments.length === 0) return [];

  const tournamentIds = tournaments.map((t: any) => t.id);

  const { data: precomputed } = await supabase
    .from('league_intelligence')
    .select('tournament_id, team_count, avg_readiness, avg_form, avg_congestion, avg_travel_14d, avg_rest_days, avg_active_competitions')
    .in('tournament_id', tournamentIds);

  if (precomputed && precomputed.length > 0) {
    const precomputedMap = new Map<number, any>(precomputed.map((r: any) => [r.tournament_id, r]));
    return tournaments
      .map((t: any) => {
        const r = precomputedMap.get(t.id);
        return {
          tournament: t,
          teamCount: r?.team_count ?? 0,
          avgReadiness: r?.avg_readiness ?? null,
          avgForm: r?.avg_form ?? null,
          avgCongestion: r?.avg_congestion ?? null,
          avgTravel14d: r?.avg_travel_14d ?? null,
          avgRestDays: r?.avg_rest_days ?? null,
          avgActiveComps: r?.avg_active_competitions ?? null,
        };
      })
      .sort((a, b) => (b.avgReadiness ?? -1) - (a.avgReadiness ?? -1));
  }

  // Fallback — precomputed table empty (process:league-intelligence hasn't
  // run yet). Same live logic as before this change, unchanged.
  return computeLeagueReadinessRankingsLive(tournaments, tournamentIds);
}

async function computeLeagueReadinessRankingsLive(
  tournaments: any[],
  tournamentIds: number[]
): Promise<LeagueReadinessRow[]> {
  // Latest standings row per team per tournament — used purely to get the
  // team_id -> tournament_id mapping, not the standings data itself.
  const { data: standings } = await supabase
    .from('tournament_standings')
    .select('tournament_id, team_id')
    .in('tournament_id', tournamentIds);

  const teamIdsByTournament = new Map<number, Set<number>>();
  for (const s of standings ?? []) {
    if (!teamIdsByTournament.has(s.tournament_id)) teamIdsByTournament.set(s.tournament_id, new Set());
    teamIdsByTournament.get(s.tournament_id)!.add(s.team_id);
  }

  const allTeamIds = [...new Set((standings ?? []).map((s: any) => s.team_id))];
  if (allTeamIds.length === 0) {
    return tournaments.map((t: any) => ({
      tournament: t, teamCount: 0, avgReadiness: null, avgForm: null,
      avgCongestion: null, avgTravel14d: null, avgRestDays: null, avgActiveComps: null,
    }));
  }

  const { data: teamIntel } = await supabase
    .from('team_intelligence')
    .select('team_id, readiness_score, form_index, congestion_score, rest_days_avg, active_competitions')
    .in('team_id', allTeamIds);

  const { data: travelLoad } = await supabase
    .from('team_travel_load')
    .select('team_id, km_last_14_days')
    .in('team_id', allTeamIds)
    .order('snapshot_date', { ascending: false });

  const intelMap = new Map((teamIntel ?? []).map((t: any) => [t.team_id, t]));
  const travelMap = new Map<number, number>();
  for (const t of travelLoad ?? []) {
    if (!travelMap.has(t.team_id)) travelMap.set(t.team_id, t.km_last_14_days ?? 0);
  }

  const avg = (nums: (number | null | undefined)[]): number | null => {
    const valid = nums.filter((n): n is number => n != null);
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 10) / 10;
  };

  return tournaments.map((t: any) => {
    const teamIds = [...(teamIdsByTournament.get(t.id) ?? [])];
    const intels = teamIds.map(id => intelMap.get(id)).filter(Boolean);
    const travels = teamIds.map(id => travelMap.get(id));

    return {
      tournament: t,
      teamCount: teamIds.length,
      avgReadiness:   avg(intels.map((i: any) => i.readiness_score)),
      avgForm:        avg(intels.map((i: any) => i.form_index)),
      avgCongestion:  avg(intels.map((i: any) => i.congestion_score)),
      avgTravel14d:   avg(travels),
      avgRestDays:    avg(intels.map((i: any) => i.rest_days_avg)),
      avgActiveComps: avg(intels.map((i: any) => i.active_competitions)),
    };
  }).sort((a, b) => (b.avgReadiness ?? -1) - (a.avgReadiness ?? -1));
}

// ─── LEAGUE DETAIL ──────────────────────────────────────────────────────────

export interface LeagueDetailTeamRow {
  id: number; name: string; short_name: string | null; slug: string | null; country: string | null;
  crest_storage_path: string | null;
  readiness_score: number | null; form_index: number | null; congestion_score: number | null;
  rest_days_avg: number | null; travel_fatigue_score: number | null;
}

export interface LeagueDetailData {
  tournament: { id: number; name: string; slug: string; category: string | null; logo_storage_path: string | null } | null;
  teams: LeagueDetailTeamRow[];
  seasonStats: {
    avgGoalsPerMatch: number | null;
    avgCleanSheetsPerMatch: number | null;
    avgRedCardsPerMatch: number | null;
    homeWinPct: number | null;
    awayWinPct: number | null;
  };
  fixtureCongestion: { team_id: number; name: string; matches_next_14_days: number | null }[];
}

/**
 * Full League Detail page data — teams joined via tournament_standings
 * (the accurate join path, not matches.competition text matching which
 * the previous version of this page used).
 */
export async function getLeagueDetail(tournamentId: number): Promise<LeagueDetailData> {
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, slug, category, logo_storage_path')
    .eq('id', tournamentId)
    .maybeSingle();

  const { data: standings } = await supabase
    .from('tournament_standings')
    .select('team_id, season_external_id')
    .eq('tournament_id', tournamentId);

  const teamIds = [...new Set((standings ?? []).map((s: any) => s.team_id))];
  if (teamIds.length === 0) {
    return { tournament, teams: [], seasonStats: { avgGoalsPerMatch: null, avgCleanSheetsPerMatch: null, avgRedCardsPerMatch: null, homeWinPct: null, awayWinPct: null }, fixtureCongestion: [] };
  }

  const { data: teamsData } = await supabase
    .from('teams')
    .select('id, name, short_name, slug, country, crest_storage_path')
    .in('id', teamIds);

  const { data: intel } = await supabase
    .from('team_intelligence')
    .select('team_id, readiness_score, form_index, congestion_score, rest_days_avg, travel_fatigue_score')
    .in('team_id', teamIds);

  const intelMap = new Map<number, any>((intel ?? []).map((i: any) => [i.team_id, i]));

  const teams: LeagueDetailTeamRow[] = (teamsData ?? []).map((t: any) => {
    const i = intelMap.get(t.id);
    return {
      ...t,
      readiness_score: i?.readiness_score ?? null,
      form_index: i?.form_index ?? null,
      congestion_score: i?.congestion_score ?? null,
      rest_days_avg: i?.rest_days_avg ?? null,
      travel_fatigue_score: i?.travel_fatigue_score ?? null,
    };
  }).sort((a, b) => (b.readiness_score ?? -1) - (a.readiness_score ?? -1));

  // Season stats — aggregate team_season_statistics for teams in this league
  const { data: seasonStatsRows } = await supabase
    .from('team_season_statistics')
    .select('team_id, matches, goals_scored, goals_conceded, clean_sheets, red_cards')
    .in('team_id', teamIds);

  const avg = (nums: (number | null | undefined)[]): number | null => {
    const valid = nums.filter((n): n is number => n != null);
    if (valid.length === 0) return null;
    return Math.round((valid.reduce((s, n) => s + n, 0) / valid.length) * 100) / 100;
  };

  const rows = seasonStatsRows ?? [];
  const totalMatches = rows.reduce((s: number, r: any) => s + (r.matches ?? 0), 0);
  const totalGoals = rows.reduce((s: number, r: any) => s + (r.goals_scored ?? 0), 0);
  const totalCleanSheets = rows.reduce((s: number, r: any) => s + (r.clean_sheets ?? 0), 0);
  const totalRedCards = rows.reduce((s: number, r: any) => s + (r.red_cards ?? 0), 0);

  const seasonStats = {
    avgGoalsPerMatch: totalMatches > 0 ? Math.round((totalGoals / totalMatches) * 100) / 100 : null,
    avgCleanSheetsPerMatch: totalMatches > 0 ? Math.round((totalCleanSheets / totalMatches) * 100) / 100 : null,
    avgRedCardsPerMatch: totalMatches > 0 ? Math.round((totalRedCards / totalMatches) * 100) / 100 : null,
    // Home/away win % needs team_venue_performance, not team_season_statistics
    homeWinPct: null as number | null,
    awayWinPct: null as number | null,
  };

  const { data: venuePerf } = await supabase
    .from('team_venue_performance')
    .select('team_id, home_win_pct, away_win_pct')
    .in('team_id', teamIds);
  seasonStats.homeWinPct = avg((venuePerf ?? []).map((v: any) => v.home_win_pct));
  seasonStats.awayWinPct = avg((venuePerf ?? []).map((v: any) => v.away_win_pct));

  // Fixture congestion — next 14 days per team, for the "Upcoming Fixture
  // Congestion" panel, top 5 busiest
  const { data: fixtureLoad } = await supabase
    .from('team_fixture_load')
    .select('team_id, matches_next_14_days')
    .in('team_id', teamIds)
    .order('snapshot_date', { ascending: false });

  const fixtureLoadMap = new Map<number, number>();
  for (const f of fixtureLoad ?? []) {
    if (!fixtureLoadMap.has(f.team_id)) fixtureLoadMap.set(f.team_id, f.matches_next_14_days ?? 0);
  }
  const teamNameMap = new Map(teams.map(t => [t.id, t.name]));
  const fixtureCongestion = [...fixtureLoadMap.entries()]
    .map(([team_id, matches_next_14_days]) => ({ team_id, name: teamNameMap.get(team_id) ?? 'Unknown', matches_next_14_days }))
    .sort((a, b) => (b.matches_next_14_days ?? 0) - (a.matches_next_14_days ?? 0))
    .slice(0, 5);

  return { tournament, teams, seasonStats, fixtureCongestion };
}

// ─── TEAM INTELLIGENCE LIST (Image 1) ──────────────────────────────────────

export interface TeamIntelRow {
  id: number; name: string; short_name: string | null; slug: string | null; country: string | null;
  crest_storage_path: string | null;
  league: string | null; position: number | null;
  readiness_score: number | null; form_index: number | null;
  congestion_score: number | null; rest_days_avg: number | null; active_competitions: number | null;
  travel_14d: number | null;
  form_pills: ('W' | 'D' | 'L')[];
  trend_7d: number | null; // readiness delta vs 7 days ago — null if insufficient history
}

/**
 * Full Team Intelligence list — readiness-ranked with league, form pills,
 * rest days, travel load, congestion, and a 7-day trend arrow. Trend uses
 * team_intelligence_history (migration 010); returns null (rendered as
 * "—", not a fake 0) for any team without a snapshot from ~7 days ago yet
 * — that table only started accumulating recently, so most teams won't
 * have a real trend for a while. Same honesty principle as every other
 * page built this session.
 */
export async function getTeamIntelligenceList(limit = 10000): Promise<TeamIntelRow[]> {
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_intelligence')
    .select(`team_id, readiness_score, form_index, congestion_score, rest_days_avg, active_competitions,
      team:teams!team_id(id, name, short_name, slug, country, crest_storage_path)`)
    .not('readiness_score', 'is', null)
    .order('readiness_score', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);
  const { data: intelRows } = await q;
  if (!intelRows || intelRows.length === 0) return [];

  const ids = intelRows.map((r: any) => r.team_id);

  const [travelRes, standingsRes, formRes, historyRes] = await Promise.all([
    supabase.from('team_travel_load').select('team_id, km_last_14_days').in('team_id', ids).order('snapshot_date', { ascending: false }),
    supabase.from('tournament_standings').select('team_id, position, tournament:tournaments(name)').in('team_id', ids),
    supabase.from('team_form_history').select('team_id, result, match_date').in('team_id', ids).order('match_date', { ascending: false }),
    supabase.from('team_intelligence_history').select('team_id, readiness_score, snapshot_date').in('team_id', ids).order('snapshot_date', { ascending: true }),
  ]);

  const travelMap = new Map<number, number>();
  for (const t of travelRes.data ?? []) {
    if (!travelMap.has(t.team_id)) travelMap.set(t.team_id, t.km_last_14_days ?? 0);
  }

  const standingsMap = new Map<number, { position: number | null; league: string | null }>();
  for (const s of standingsRes.data ?? []) {
    if (!standingsMap.has(s.team_id)) {
      standingsMap.set(s.team_id, { position: s.position ?? null, league: (s.tournament as any)?.name ?? null });
    }
  }

  const formMap = new Map<number, ('W' | 'D' | 'L')[]>();
  for (const f of formRes.data ?? []) {
    if (!formMap.has(f.team_id)) formMap.set(f.team_id, []);
    const arr = formMap.get(f.team_id)!;
    if (arr.length < 5 && (f.result === 'W' || f.result === 'D' || f.result === 'L')) arr.push(f.result);
  }

  // Trend: earliest snapshot ~7+ days old vs current readiness. If the
  // earliest available snapshot is LESS than 5 days old, there's not
  // enough history yet for a meaningful weekly trend — return null rather
  // than comparing today against itself or a 1-day-old point.
  const historyByTeam = new Map<number, { readiness_score: number; snapshot_date: string }[]>();
  for (const h of historyRes.data ?? []) {
    if (!historyByTeam.has(h.team_id)) historyByTeam.set(h.team_id, []);
    historyByTeam.get(h.team_id)!.push(h);
  }
  const trendMap = new Map<number, number | null>();
  const now = Date.now();
  for (const [teamId, points] of historyByTeam) {
    const earliest = points[0];
    if (!earliest) { trendMap.set(teamId, null); continue; }
    const daysAgo = (now - new Date(earliest.snapshot_date).getTime()) / 86400000;
    if (daysAgo < 5) { trendMap.set(teamId, null); continue; }
    const current = intelRows.find((r: any) => r.team_id === teamId)?.readiness_score;
    if (current == null || earliest.readiness_score == null) { trendMap.set(teamId, null); continue; }
    trendMap.set(teamId, Math.round((current - earliest.readiness_score) * 10) / 10);
  }

  return intelRows.map((r: any) => {
    const standing = standingsMap.get(r.team_id);
    return {
      id: r.team.id, name: r.team.name, short_name: r.team.short_name, slug: r.team.slug, country: r.team.country,
      crest_storage_path: r.team.crest_storage_path ?? null,
      league: standing?.league ?? null, position: standing?.position ?? null,
      readiness_score: r.readiness_score, form_index: r.form_index,
      congestion_score: r.congestion_score, rest_days_avg: r.rest_days_avg, active_competitions: r.active_competitions,
      travel_14d: travelMap.get(r.team_id) ?? null,
      form_pills: formMap.get(r.team_id) ?? [],
      trend_7d: trendMap.get(r.team_id) ?? null,
    };
  });
}

// ─── TEAM COMPARISON EXTRAS (Image 3) ──────────────────────────────────────

export interface TeamComparisonExtras {
  seasonStats: Record<number, any | null>;
  formPills: Record<number, ('W' | 'D' | 'L')[]>;
  ppg10: Record<number, number | null>;
  trend: Record<number, { date: string; readiness: number | null }[]>;
  upcoming: Record<number, any[]>;
  headToHead: { date: string; home_team_id: number; away_team_id: number; home_score: number | null; away_score: number | null }[];
}

/**
 * Bulk-fetches everything the Team Comparison page needs for two teams at
 * once, keyed by team_id so the page can look up either side. Two known
 * gaps deliberately NOT included here (see backend/docs/ recommendation):
 * shots/shots-on-target/dribbles-completed have zero source anywhere in
 * the schema or sync job, despite being present in the raw SofaScore
 * payload — rather than fake these, they're simply not part of the
 * comparison table. xG is approximated by summing player-level
 * expected_goals (the only xG source that exists); xGA has no source at
 * all (would need shot-location/defensive event data) and is also omitted.
 */
export async function getTeamComparisonExtras(teamAId: number, teamBId: number): Promise<TeamComparisonExtras> {
  const ids = [teamAId, teamBId];

  const [statsRes, formRes, xgRes, historyRes, h2hHomeRes, h2hAwayRes] = await Promise.all([
    supabase.from('team_season_statistics').select('*').in('team_id', ids),
    supabase.from('team_form_history').select('team_id, result, points, match_date').in('team_id', ids).order('match_date', { ascending: false }),
    supabase.from('player_season_statistics').select('team_id, expected_goals').in('team_id', ids),
    supabase.from('team_intelligence_history').select('team_id, snapshot_date, readiness_score').in('team_id', ids).order('snapshot_date', { ascending: true }),
    supabase.from('matches').select('id, date, home_team_id, away_team_id, match_results(home_score, away_score)').eq('home_team_id', teamAId).eq('away_team_id', teamBId).order('date', { ascending: false }).limit(5),
    supabase.from('matches').select('id, date, home_team_id, away_team_id, match_results(home_score, away_score)').eq('home_team_id', teamBId).eq('away_team_id', teamAId).order('date', { ascending: false }).limit(5),
  ]);

  const seasonStats: Record<number, any | null> = {};
  for (const id of ids) seasonStats[id] = (statsRes.data ?? []).find((s: any) => s.team_id === id) ?? null;

  // Team-level xG approximation — sum of all players' season expected_goals.
  const xgByTeam = new Map<number, number>();
  for (const p of xgRes.data ?? []) {
    if (p.expected_goals == null) continue;
    xgByTeam.set(p.team_id, (xgByTeam.get(p.team_id) ?? 0) + p.expected_goals);
  }
  for (const id of ids) {
    if (seasonStats[id]) seasonStats[id].approx_xg_total = xgByTeam.get(id) ?? null;
  }

  const formPills: Record<number, ('W' | 'D' | 'L')[]> = {};
  const ppg10: Record<number, number | null> = {};
  for (const id of ids) {
    const rows = (formRes.data ?? []).filter((f: any) => f.team_id === id).slice(0, 10);
    formPills[id] = rows.filter((r: any) => r.result === 'W' || r.result === 'D' || r.result === 'L').map((r: any) => r.result).reverse();
    ppg10[id] = rows.length > 0 ? Math.round((rows.reduce((s: number, r: any) => s + (r.points ?? 0), 0) / rows.length) * 100) / 100 : null;
  }

  const trend: Record<number, { date: string; readiness: number | null }[]> = {};
  for (const id of ids) {
    trend[id] = (historyRes.data ?? [])
      .filter((h: any) => h.team_id === id)
      .map((h: any) => ({ date: h.snapshot_date, readiness: h.readiness_score }));
  }

  const upcoming: Record<number, any[]> = {};
  for (const id of ids) {
    upcoming[id] = await getTeamUpcomingMatches(id, 21).catch(() => []);
  }

  const headToHead = [...(h2hHomeRes.data ?? []), ...(h2hAwayRes.data ?? [])]
    .map((m: any) => ({
      date: m.date, home_team_id: m.home_team_id, away_team_id: m.away_team_id,
      home_score: toOne(m.match_results)?.home_score ?? null,
      away_score: toOne(m.match_results)?.away_score ?? null,
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return { seasonStats, formPills, ppg10, trend, upcoming, headToHead };
}
