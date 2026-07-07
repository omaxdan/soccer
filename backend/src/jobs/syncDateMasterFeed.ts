import { sportsApiClient } from '../services/sportsApiClient';
import { isTrackedLeague, isTrackedBySlug, TRACKED_LEAGUES, findTrackedLeague } from '../config/trackedLeagues';
import { resolveEndpoint } from '../constants/endpoints';
import { db } from '../db/client';
import { logger } from '../utils/logger';

/**
 * SCHEDULE AS MASTER FEED
 *
 * One GET /schedule/{date} call populates 8 tables:
 *   countries, tournaments, seasons, teams, stadiums,
 *   matches, match_results, and sets matches.venue_id
 *
 * Why this works:
 *   Every SportsAPI event already embeds full objects for
 *   tournament, season, category (country), homeTeam, awayTeam,
 *   venue (with coordinates), scores, and winnerCode.
 *
 * Rate limit benefit:
 *   Old: separate /tournaments + /seasons + /schedule calls
 *   New: ONE /schedule call does everything (discovery is free)
 *
 * In-memory deduplication:
 *   With 408 events sharing the same tournaments/seasons/countries,
 *   we deduplicate using Maps before writing to the DB.
 *   408 events → maybe 50 unique tournaments, 10 countries, etc.
 *   Result: far fewer DB round-trips.
 */

interface MasterFeedResult {
  date: string;
  eventsProcessed: number;
  countries: number;
  tournaments: number;
  seasons: number;
  teams: number;
  stadiums: number;
  matches: number;
  matchResults: number;
  durationMs: number;
  error?: string;
}

// ─── Entity shape maps ────────────────────────────────────────────────────────

interface ExtractedCountry {
  name: string;
  alpha2: string | null;
  slug: string | null;
}

interface ExtractedTournament {
  external_id: number;
  name: string;
  slug: string | null;
  category_name: string | null; // resolved to country_id after country upsert
  category: string | null;
}

interface ExtractedSeason {
  external_id: number;
  name: string | null;
  year: string | null;
  tournament_external_id: number | null; // resolved to tournament_id after upsert
}

interface ExtractedTeam {
  external_id: number;
  name: string;
  short_name: string | null;
  country: string | null;
  slug: string | null;
}

interface ExtractedStadium {
  external_id: number;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  capacity: number | null;
}

interface ExtractedMatch {
  external_match_id: number;
  home_team_external_id: number;
  away_team_external_id: number;
  venue_external_id: number | null;
  date: string;
  competition: string | null;
  season: string | null;
  status: string;
}

interface ExtractedMatchResult {
  match_external_id: number;
  match_date: string;  // denormalized — see migration 007, no join required for "when"
  home_score: number | null;
  away_score: number | null;
  half_time_home_score: number | null;
  half_time_away_score: number | null;
  winner_home: boolean;
  winner_away: boolean;
  status: string;
}

// ─── Status code map ──────────────────────────────────────────────────────────

const STATUS_MAP: Record<number, string> = {
  0: 'scheduled',
  6: 'live', 7: 'live',
  31: 'halftime',
  40: 'live', 41: 'live', 50: 'live',
  60: 'postponed',
  70: 'cancelled',
  80: 'interrupted',
  90: 'abandoned',
  100: 'finished',
  110: 'finished',
  120: 'finished',
};

// ─── Helper: resolve primary country for a tournament ────────────────────────

/**
 * Given a tournament name and category (country), resolves the primary country
 * that should be stored in the teams.country column.
 *
 * For single-country leagues (England's Premier League), returns the country.
 * For multi-country leagues (MLS = USA + Canada, EFL = England + Wales),
 * returns the PRIMARY country (first in the array).
 *
 * This prevents the leak where Cardiff City (Wales-based) was being stored
 * as country='Wales' instead of country='England' (the league's primary country).
 *
 * NOTE: stadiums are still stored with their actual geographic country, as
 * that's correct — a Welsh stadium stays country='Wales'. Only teams get
 * normalized to the league's primary country so they appear in a single
 * country bucket when filtering/aggregating in the UI.
 */
function getPrimaryLeagueCountry(
  tournamentName: string,
  tournamentSlug: string | undefined | null,
  categoryName: string | undefined | null
): string | null {
  // Try slug-based lookup first (most precise)
  if (tournamentSlug) {
    const league = TRACKED_LEAGUES.find(
      l => l.slug.toLowerCase() === (tournamentSlug?.toLowerCase() ?? '')
    );
    if (league?.country) {
      return Array.isArray(league.country) ? league.country[0] : league.country;
    }
  }

  // Fall back to name-based lookup
  const league = findTrackedLeague(tournamentName, categoryName);
  if (league?.country) {
    return Array.isArray(league.country) ? league.country[0] : league.country;
  }

  return null;
}

// ─── Extractor: single pass through all events ───────────────────────────────

function extractEntities(events: any[]) {
  const countries   = new Map<string, ExtractedCountry>();
  const tournaments = new Map<number, ExtractedTournament>();
  const seasons     = new Map<number, ExtractedSeason>();
  const teams       = new Map<number, ExtractedTeam>();
  const stadiums    = new Map<number, ExtractedStadium>();
  const matches:       ExtractedMatch[]       = [];
  let rejectedDueToMissingCategory = 0;
  const matchResults:  ExtractedMatchResult[] = [];

  for (const ev of events) {
    // ── STRICT FILTER — skip ALL entity extraction for non-tracked leagues ──
    // This is the primary gate. Only events from TRACKED_LEAGUES ever touch the DB.
    // Both slug-based (precise) and name-based (fallback) checks are used.
    // Country/category matching is MANDATORY (not best-effort) — see
    // trackedLeagues.ts countriesMatch() for why this must never silently
    // pass on missing data (prevents Ethiopia/Lebanon/Kazakhstan/etc.
    // 'Premier League' from being admitted alongside England's).
    if (!ev.id || !ev.homeTeam?.id || !ev.awayTeam?.id) continue;

    // ── uniqueTournament is the STABLE competition identity ─────────────────
    // ev.tournament.id / .name / .slug are STAGE-specific (change between
    // qualification rounds, group stages, and every new season).
    // ev.tournament.uniqueTournament.id / .name / .slug are the PERSISTENT
    // competition identity that TRACKED_LEAGUES slugs are defined against.
    // Confirmed via SofaScore response structure: a Champions League
    // qualifying match shows tournament.name = "UEFA Champions League,
    // Qualification" but uniqueTournament.name = "UEFA Champions League" —
    // using the stage-specific value would fail to match our tracked slugs
    // and would fragment the same competition into multiple DB rows each season.
    const uniqueT = ev.tournament?.uniqueTournament;
    const tournamentName = uniqueT?.name || ev.tournament?.name || '';
    const tournamentSlug = uniqueT?.slug || ev.tournament?.slug || '';
    const categoryName   = ev.tournament?.category?.name || '';

    const isTracked =
      (tournamentSlug && isTrackedBySlug(tournamentSlug, categoryName)) ||
      isTrackedLeague(tournamentName, categoryName);

    if (!isTracked) {
      // Diagnostic: if the NAME alone would have matched a tracked league
      // but category data is missing/empty, this event is being correctly
      // rejected per the strict policy — but it's worth surfacing in case
      // it indicates an API data gap rather than a genuinely untracked league.
      if (!categoryName && tournamentName) {
        const wouldMatchByNameOnly = TRACKED_LEAGUES.some(l =>
          tournamentName.toLowerCase().includes(l.apiNameMatch.toLowerCase())
        );
        if (wouldMatchByNameOnly) {
          rejectedDueToMissingCategory++;
          logger.debug({ tournamentName, tournamentSlug }, 'Rejected: name matches a tracked league but category data is missing — strict policy excludes it');
        }
      }
      continue; // Entire event skipped — no teams, no tournaments, nothing
    }

    // ── Country (from tournament.category) — only for tracked events ────
    const cat = ev.tournament?.category;
    if (cat?.name && !countries.has(cat.name)) {
      countries.set(cat.name, {
        name: cat.name,
        alpha2: cat.alpha2 || null,
        slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, '-'),
      });
    }

    // Resolve the PRIMARY country for teams in this league (not the team's
    // geographic country — Cardiff City is Wales-based but stored as country='England'
    // since that's the EFL's primary country). This prevents the multi-country leak.
    const leagueCountry = getPrimaryLeagueCountry(tournamentName, tournamentSlug, cat?.name);

    // ── Tournament ───────────────────────────────────────────────────────
    // external_id MUST be uniqueTournament.id — see comment block above and
    // the column comment in migration 007. Falls back to tournament.id only
    // if uniqueTournament is genuinely absent from this response (rare).
    const tournamentExternalId = uniqueT?.id ?? ev.tournament?.id;
    if (tournamentExternalId && !tournaments.has(tournamentExternalId)) {
      tournaments.set(tournamentExternalId, {
        external_id: tournamentExternalId,
        name: tournamentName,
        slug: tournamentSlug || null,
        category_name: cat?.name || null,
        category: cat?.name || null,
      });
    }

    // ── Season ───────────────────────────────────────────────────────────
    const s = ev.season;
    if (s?.id && !seasons.has(s.id)) {
      seasons.set(s.id, {
        external_id: s.id,
        name: s.name || null,
        year: s.year || null,
        tournament_external_id: tournamentExternalId || null,
      });
    }

    // ── Teams — only tracked-league teams ────────────────────────────────
    // Use the league's PRIMARY country (e.g., 'England' for EFL) instead of
    // the team's geographic country (e.g., 'Wales' for Cardiff City).
    for (const teamData of [ev.homeTeam, ev.awayTeam]) {
      if (teamData?.id && !teams.has(teamData.id)) {
        teams.set(teamData.id, {
          external_id: teamData.id,
          name: teamData.name,
          short_name: teamData.shortName || null,
          country: leagueCountry,
          slug: teamData.slug || null,
        });
      }
    }

    // ── Stadium / Venue — only for tracked matches ────────────────────────
    const v = ev.venue;
    if (v?.id && !stadiums.has(v.id)) {
      stadiums.set(v.id, {
        external_id: v.id,
        name: v.name,
        city: v.city?.name || null,
        country: v.country?.name || v.city?.country?.name || null,
        latitude: v.venueCoordinates?.latitude ?? null,
        longitude: v.venueCoordinates?.longitude ?? null,
        capacity: v.capacity || v.stadium?.capacity || null,
      });
    }

    const statusCode = ev.status?.code ?? 0;
    const status = STATUS_MAP[statusCode] || 'scheduled';
    const matchDate = new Date(ev.startTimestamp * 1000).toISOString();

    matches.push({
      external_match_id: ev.id,
      home_team_external_id: ev.homeTeam.id,
      away_team_external_id: ev.awayTeam.id,
      venue_external_id: v?.id || null,
      date: matchDate,
      competition: tournamentName || null,
      season: s?.name || null,
      status,
    });

    // ── Match Result ─────────────────────────────────────────────────────
    matchResults.push({
      match_external_id: ev.id,
      match_date: matchDate,  // denormalized — see migration 007
      home_score: ev.homeScore?.normaltime ?? ev.homeScore?.current ?? null,
      away_score: ev.awayScore?.normaltime ?? ev.awayScore?.current ?? null,
      half_time_home_score: ev.homeScore?.period1 ?? null,
      half_time_away_score: ev.awayScore?.period1 ?? null,
      winner_home: ev.winnerCode === 1,
      winner_away: ev.winnerCode === 2,
      status,
    });
  }

  return { countries, tournaments, seasons, teams, stadiums, matches, matchResults, rejectedDueToMissingCategory };
}

// ─── Main Job ────────────────────────────────────────────────────────────────

export async function syncDateMasterFeed(date: string): Promise<MasterFeedResult> {
  const startTime = Date.now();
  logger.info({ date }, 'Master feed sync started');

  try {
    // ── 1. ONE API CALL ──────────────────────────────────────────────────
    const endpoint = resolveEndpoint('schedule', { date });
    const response = await sportsApiClient.get<any>(endpoint);
    const events: any[] = response.events || response.data?.events || [];

    if (events.length === 0) {
      logger.info({ date }, 'No events found for date');
      return emptyResult(date, startTime);
    }

    logger.info({ date, eventCount: events.length }, 'Events fetched — extracting all entities');

    // ── 2. SINGLE PASS: extract everything ──────────────────────────────
    const { countries, tournaments, seasons, teams, stadiums, matches, matchResults, rejectedDueToMissingCategory }
      = extractEntities(events);

    logger.info({
      countries: countries.size,
      tournaments: tournaments.size,
      seasons: seasons.size,
      teams: teams.size,
      stadiums: stadiums.size,
      matches: matches.length,
    }, 'Entities extracted — beginning ordered batch upserts');

    // ── 3. ROUND 1: No foreign key dependencies ──────────────────────────
    // Countries
    const countryRows = Array.from(countries.values()).map(c => ({
      name: c.name,
      alpha2: c.alpha2,
      slug: c.slug,
    }));
    if (countryRows.length > 0) {
      const { error } = await db.from('countries').upsert(countryRows, { onConflict: 'name' });
      if (error) throw new Error(`countries upsert: ${error.message}`);
    }

    // Stadiums (no FK deps)
    const stadiumRows = Array.from(stadiums.values()).map(s => ({
      external_id: s.external_id,
      name: s.name,
      city: s.city,
      country: s.country,
      latitude: s.latitude,
      longitude: s.longitude,
      capacity: s.capacity,
    }));
    if (stadiumRows.length > 0) {
      const { error } = await db.from('stadiums').upsert(stadiumRows, { onConflict: 'external_id' });
      if (error) throw new Error(`stadiums upsert: ${error.message}`);
    }

    // ── 4. ROUND 2: Needs countries ──────────────────────────────────────
    // Fetch country ID map
    const { data: dbCountries } = await db.from('countries').select('id, name');
    const countryIdMap = new Map<string, number>(
      (dbCountries || []).map((c: any) => [c.name, c.id])
    );

    // Tournaments
    const tournamentRows = Array.from(tournaments.values()).map(t => ({
      external_id: t.external_id,
      name: t.name,
      slug: t.slug,
      country_id: t.category_name ? (countryIdMap.get(t.category_name) ?? null) : null,
      category: t.category,
    }));
    if (tournamentRows.length > 0) {
      const { error } = await db.from('tournaments').upsert(tournamentRows, { onConflict: 'external_id' });
      if (error) throw new Error(`tournaments upsert: ${error.message}`);
    }

    // ── 5. ROUND 3: Needs tournaments ────────────────────────────────────
    const { data: dbTournaments } = await db.from('tournaments').select('id, external_id');
    const tournamentIdMap = new Map<number, number>(
      (dbTournaments || []).map((t: any) => [t.external_id, t.id])
    );

    // Seasons
    const seasonRows = Array.from(seasons.values()).map(s => ({
      external_id: s.external_id,
      name: s.name,
      year: s.year,
      tournament_id: s.tournament_external_id
        ? (tournamentIdMap.get(s.tournament_external_id) ?? null)
        : null,
    }));
    if (seasonRows.length > 0) {
      const { error } = await db.from('seasons').upsert(seasonRows, { onConflict: 'external_id' });
      if (error) throw new Error(`seasons upsert: ${error.message}`);
    }

    // ── 6. ROUND 4: Teams (needs countries, optionally stadiums) ─────────
    const teamRows = Array.from(teams.values()).map(t => ({
      external_id: t.external_id,
      name: t.name,
      short_name: t.short_name,
      country: t.country,
      slug: t.slug,
    }));
    if (teamRows.length > 0) {
      const { error } = await db.from('teams').upsert(teamRows, { onConflict: 'external_id' });
      if (error) throw new Error(`teams upsert: ${error.message}`);
    }

    // ── 7. ROUND 5: Matches (needs teams + stadiums) ─────────────────────
    // Batch-fetch all team internal IDs in ONE query
    const allTeamExtIds = Array.from(teams.keys());
    const { data: dbTeams } = await db
      .from('teams')
      .select('id, external_id')
      .in('external_id', allTeamExtIds);

    const teamIdMap = new Map<number, number>(
      (dbTeams || []).map((t: any) => [t.external_id, t.id])
    );

    // Batch-fetch stadium internal IDs
    const allStadiumExtIds = Array.from(stadiums.keys());
    const stadiumIdMap = new Map<number, number>();
    if (allStadiumExtIds.length > 0) {
      const { data: dbStadiums } = await db
        .from('stadiums')
        .select('id, external_id')
        .in('external_id', allStadiumExtIds);
      for (const s of dbStadiums || []) {
        stadiumIdMap.set(s.external_id, s.id);
      }
    }

    const matchRows = [];
    const matchExtIdSet = new Set<number>(); // deduplicate

    for (const m of matches) {
      if (matchExtIdSet.has(m.external_match_id)) continue;
      const homeId = teamIdMap.get(m.home_team_external_id);
      const awayId = teamIdMap.get(m.away_team_external_id);
      if (!homeId || !awayId) {
        logger.warn({ extId: m.external_match_id }, 'Skipping match - team IDs not resolved');
        continue;
      }
      matchExtIdSet.add(m.external_match_id);
      matchRows.push({
        external_match_id: m.external_match_id,
        home_team_id: homeId,
        away_team_id: awayId,
        venue_id: m.venue_external_id ? (stadiumIdMap.get(m.venue_external_id) ?? null) : null,
        date: m.date,
        competition: m.competition,
        season: m.season,
        status: m.status,
      });
    }

    if (matchRows.length > 0) {
      const { error } = await db.from('matches').upsert(matchRows, { onConflict: 'external_match_id' });
      if (error) throw new Error(`matches upsert: ${error.message}`);
    }

    // ── 8. ROUND 6: Match results (needs matches) ────────────────────────
    // Batch-fetch match internal IDs
    const allMatchExtIds = matchRows.map(m => m.external_match_id);
    const matchIdMap = new Map<number, number>();
    if (allMatchExtIds.length > 0) {
      const { data: dbMatches } = await db
        .from('matches')
        .select('id, external_match_id')
        .in('external_match_id', allMatchExtIds);
      for (const m of dbMatches || []) {
        matchIdMap.set(m.external_match_id, m.id);
      }
    }

    const resultRows = [];
    for (const r of matchResults) {
      const matchId = matchIdMap.get(r.match_external_id);
      if (!matchId) continue;

      // Determine winner_team_id using already-resolved team IDs
      const matchRow = matchRows.find(m => m.external_match_id === r.match_external_id);
      let winnerTeamId: number | null = null;
      if (r.winner_home && matchRow) winnerTeamId = matchRow.home_team_id;
      else if (r.winner_away && matchRow) winnerTeamId = matchRow.away_team_id;

      resultRows.push({
        match_id: matchId,
        match_date: r.match_date,  // denormalized — see migration 007
        home_score: r.home_score,
        away_score: r.away_score,
        half_time_home_score: r.half_time_home_score,
        half_time_away_score: r.half_time_away_score,
        winner_team_id: winnerTeamId,
        status: r.status,
      });
    }

    if (resultRows.length > 0) {
      const { error } = await db.from('match_results').upsert(resultRows, { onConflict: 'match_id' });
      if (error) throw new Error(`match_results upsert: ${error.message}`);
    }

    const durationMs = Date.now() - startTime;

    const result: MasterFeedResult = {
      date,
      eventsProcessed: events.length,
      countries: countries.size,
      tournaments: tournaments.size,
      seasons: seasons.size,
      teams: teams.size,
      stadiums: stadiums.size,
      matches: matchRows.length,
      matchResults: resultRows.length,
      durationMs,
    };

    if (rejectedDueToMissingCategory > 0) {
      logger.warn(
        { rejectedDueToMissingCategory },
        'Some events name-matched a tracked league but were excluded due to missing category data (strict policy) — check sample tournaments if this count seems high'
      );
    }

    logger.info(result, 'Master feed sync completed');
    return result;

  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logger.error({ date, error: error.message, durationMs }, 'Master feed sync failed');
    return { ...emptyResult(date, startTime), durationMs, error: error.message };
  }
}

/**
 * Sync a range of dates (e.g., next 7 days or backfill)
 */
export async function syncDateRange(
  startDate: string,
  endDate: string,
  delayBetweenCallsMs = 1500
): Promise<{ totalMatches: number; totalDays: number; errors: string[] }> {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const errors: string[] = [];
  let totalMatches = 0;
  let totalDays = 0;

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const result = await syncDateMasterFeed(dateStr);

    if (result.error) errors.push(`${dateStr}: ${result.error}`);
    totalMatches += result.matches;
    totalDays++;

    current.setDate(current.getDate() + 1);

    // Rate-limit buffer between days
    if (current <= end) {
      await new Promise(r => setTimeout(r, delayBetweenCallsMs));
    }
  }

  logger.info({ totalDays, totalMatches, errors: errors.length }, 'Date range sync completed');
  return { totalMatches, totalDays, errors };
}

function emptyResult(date: string, startTime: number): MasterFeedResult {
  return {
    date, eventsProcessed: 0,
    countries: 0, tournaments: 0, seasons: 0,
    teams: 0, stadiums: 0, matches: 0, matchResults: 0,
    durationMs: Date.now() - startTime,
  };
}
