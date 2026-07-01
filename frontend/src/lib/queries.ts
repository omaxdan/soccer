import { supabase } from './supabase';

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
const MATCH_SELECT = `
  id, date, competition, season, status,
  home_team_id, away_team_id,
  home_team:teams!home_team_id(id, name, short_name, slug, country),
  away_team:teams!away_team_id(id, name, short_name, slug, country),
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

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export async function getTodaysMatches() {
  const { start, end } = getUTCDayBounds();
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches').select(MATCH_SELECT)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getReadinessRankings(limit = 50) {
  const teamIds = await getTrackedTeamIds();

  const q = supabase.from('team_intelligence')
    .select(`team_id, readiness_score, form_index, congestion_score, travel_fatigue_score,
      active_competitions, last_5_points, last_10_points,
      team:teams!team_id(id, name, short_name, slug, country)`)
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
    .filter((m: any) => (m.match_travel_intelligence?.[0]?.away_team_distance_km ?? 0) > 500)
    .sort((a: any, b: any) =>
      (b.match_travel_intelligence?.[0]?.away_team_distance_km ?? 0) -
      (a.match_travel_intelligence?.[0]?.away_team_distance_km ?? 0))
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

export async function getMatchesForDate(date: string) {
  const { start, end } = getUTCDayBounds(new Date(date));
  const names = await getTrackedCompetitionNames();

  const q = supabase.from('matches').select(MATCH_SELECT)
    .gte('date', start.toISOString()).lte('date', end.toISOString())
    .order('date', { ascending: true });
  if (names.length > 0) q.in('competition', names);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ─── MATCH INTELLIGENCE PAGE ──────────────────────────────────────────────────

export async function getMatchById(id: number) {
  const { data, error } = await supabase.from('matches')
    .select(MATCH_SELECT).eq('id', id).single();
  if (error) throw error;
  return data;
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

// ─── LEAGUE PAGE ──────────────────────────────────────────────────────────────

export async function getTrackedTournaments() {
  // Fetch all rows with matching slugs, then narrow by category in JS
  const { data } = await supabase
    .from('tournaments')
    .select('id, name, slug, category')
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

  const q = supabase.from('team_travel_load')
    .select(`team_id, km_last_30_days, travel_fatigue_score,
      away_matches_last_30_days, avg_trip_distance_km,
      team:teams!team_id(name, slug, country)`)
    .order('km_last_30_days', { ascending: false })
    .limit(limit);
  if (teamIds.length > 0) q.in('team_id', teamIds);

  const { data } = await q;
  return data ?? [];
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
  return (data ?? []).filter((m: any) => m.match_travel_intelligence?.[0]);
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
  const query   = supabase.from('teams').select('id, name, short_name, slug, country')
    .ilike('name', `%${q}%`).limit(limit);
  if (teamIds.length > 0) query.in('id', teamIds);
  const { data } = await query;
  return data ?? [];
}

export async function searchTournaments(q: string, limit = 10) {
  const { data } = await supabase.from('tournaments')
    .select('id, name, slug, category')
    .in('slug', TRACKED_SLUGS)
    .ilike('name', `%${q}%`)
    .limit(limit);
  return (data ?? []).filter((t: any) => isTrackedTournament(t.slug ?? '', t.category ?? ''));
}
