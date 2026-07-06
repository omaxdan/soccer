import { sportsApiClient } from '../services/sportsApiClient';
import { resolveEndpoint } from '../constants/endpoints';
import { matchesRepository, matchResultsRepository } from '../repositories/MatchesRepository';
import { teamsRepository } from '../repositories/TeamsRepository';
import { transformMatch, transformMatchResult } from '../transformers/index';
import { logger } from '../utils/logger';
import { db } from '../db/client';

// ─── TOURNAMENT TEAM EVENTS SYNC ─────────────────────────────────────────────
// Fetches all fixtures for a tournament season from the SportsAPI Pro
// tournament/team-events endpoint and inserts them with the EXACT same logic
// as syncSchedule — team discovery, upsert, transformMatch, transformMatchResult,
// winner resolution. The endpoint returns the same fixture structure as the
// schedule feed, just scoped to a tournament rather than a date.
//
// Season ID resolution: follows the same DB-lookup pattern as syncStandings.
// The `seasonId=0` shortcut was assumed to mean "current season" but the API
// returns 404 for it — a real season external_id must be resolved from the
// seasons table first. Tournaments with no season in the DB are skipped with
// a warning (same graceful behaviour as syncStandings).
//
// Supported event types mirror the API's ?type= parameter:
//   total (default) — all home + away fixtures
//   home            — home fixtures only
//   away            — away fixtures only
//
// Country mode: when called with country names instead of tournament IDs,
// resolves those names against tournaments.country_id → countries.name in
// the DB, then syncs all matching tournaments. Mirrors the
// sync:squads:countries:v2 pattern for consistency.

export type TournamentEventType = 'total' | 'home' | 'away';

/** Resolves tournament external_ids → real season external_ids from the DB.
 *  Mirrors getTournamentSeasons() in syncStandings.ts exactly — seasons table,
 *  highest external_id per tournament = most recent season. */
async function resolveSeasonIds(
  tournamentExternalIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>(); // tournamentExternalId → seasonExternalId

  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, external_id')
    .in('external_id', tournamentExternalIds);
  if (!tournaments || tournaments.length === 0) return result;

  const internalIds = tournaments.map((t: any) => t.id);
  const { data: seasons } = await db
    .from('seasons')
    .select('external_id, tournament_id')
    .in('tournament_id', internalIds)
    .order('external_id', { ascending: false });

  // Highest season external_id = most recent season — same logic as syncStandings.
  const seasonByTournamentInternalId = new Map<number, number>();
  for (const s of seasons ?? []) {
    if (!seasonByTournamentInternalId.has(s.tournament_id)) {
      seasonByTournamentInternalId.set(s.tournament_id, s.external_id);
    }
  }

  for (const t of tournaments) {
    const seasonExternalId = seasonByTournamentInternalId.get(t.id);
    if (seasonExternalId) result.set(t.external_id, seasonExternalId);
  }

  return result;
}

// ─── ID-BASED SYNC ──────────────────────────────────────────────────────────

export async function syncTournamentEvents(
  tournamentExternalIds: number[],
  eventType: TournamentEventType = 'total',
): Promise<{
  tournamentsProcessed: number;
  totalMatches: number;
  totalTeams: number;
  errors: number;
}> {
  logger.info({ tournamentIds: tournamentExternalIds, eventType }, 'syncTournamentEvents started');

  // Resolve real season IDs from the DB — the API returns 404 for seasonId=0.
  // Tournaments with no season synced yet are skipped with a warning.
  // Same DB-lookup pattern as syncStandings.ts:getTournamentSeasons().
  const seasonMap = await resolveSeasonIds(tournamentExternalIds);
  const missingSeasons = tournamentExternalIds.filter(id => !seasonMap.has(id));
  if (missingSeasons.length > 0) {
    logger.warn(
      { missingSeasons },
      'No season found in DB for these tournament IDs — skipping them. Run sync:today or sync:discovery first to populate the seasons table.',
    );
  }

  let tournamentsProcessed = 0;
  let totalMatches = 0;
  let totalTeams = 0;
  let errors = 0;

  for (const tournamentId of tournamentExternalIds) {
    const seasonId = seasonMap.get(tournamentId);
    if (!seasonId) continue; // already warned above

    try {
      const result = await syncOneTournament(tournamentId, seasonId, eventType);
      tournamentsProcessed++;
      totalMatches += result.matchesProcessed;
      totalTeams   += result.teamsDiscovered;
      logger.info({ tournamentId, seasonId, ...result }, 'Tournament sync complete');
    } catch (err: any) {
      errors++;
      logger.error({ tournamentId, seasonId, err: err.message }, 'Tournament sync failed — continuing to next');
    }
  }

  logger.info({ tournamentsProcessed, totalMatches, totalTeams, errors }, 'syncTournamentEvents completed');
  return { tournamentsProcessed, totalMatches, totalTeams, errors };
}

// ─── COUNTRY-BASED SYNC ─────────────────────────────────────────────────────
// Resolves country names to tournament external_ids via
// tournaments JOIN countries, then delegates to syncTournamentEvents.
// Mirrors the sync:squads:countries:v2 pattern: accepts comma-separated
// country names, case-insensitive, finds all tournaments whose
// country_id → countries.name matches one of the supplied names.

export async function syncTournamentEventsByCountries(
  countries: string[],
  eventType: TournamentEventType = 'total',
): Promise<{
  countriesResolved: number;
  tournamentsFound: number;
  tournamentsProcessed: number;
  totalMatches: number;
  totalTeams: number;
  errors: number;
}> {
  const lower = countries.map(c => c.toLowerCase().trim());
  logger.info({ countries, eventType }, 'syncTournamentEventsByCountries — resolving tournaments from DB');

  // tournaments.country_id → countries.name join, case-insensitive match.
  // tournaments stores a country FK (not a denormalized country text column),
  // so we join to countries to get the name.
  const { data: rows, error } = await db
    .from('tournaments')
    .select('external_id, name, countries!country_id(name)')
    .not('external_id', 'is', null);

  if (error) throw new Error(`Country tournament lookup failed: ${error.message}`);

  // toOne: PostgREST may embed the countries relation as an object or a
  // single-element array depending on the query shape; handle both.
  const toOne = <T>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  const matched = (rows ?? []).filter((r: any) => {
    const countryName = (toOne(r.countries) as any)?.name ?? '';
    return lower.includes(countryName.toLowerCase());
  });

  if (matched.length === 0) {
    logger.warn({ countries }, 'No tournaments found for these countries. Ensure sync:tournaments has run.');
    return { countriesResolved: lower.length, tournamentsFound: 0, tournamentsProcessed: 0, totalMatches: 0, totalTeams: 0, errors: 0 };
  }

  const externalIds: number[] = matched.map((r: any) => r.external_id);
  logger.info({ countries, tournamentsFound: externalIds.length, externalIds }, 'Resolved tournaments — starting sync');

  const result = await syncTournamentEvents(externalIds, eventType);
  return {
    countriesResolved: lower.length,
    tournamentsFound: externalIds.length,
    ...result,
  };
}

// ─── PER-TOURNAMENT INNER FUNCTION ──────────────────────────────────────────
// Exact same insertion logic as syncSchedule — kept deliberately parallel
// so a diff between this function and syncSchedule's body makes any
// divergence immediately visible.

async function syncOneTournament(
  tournamentId: number,
  seasonId: number,
  eventType: TournamentEventType,
): Promise<{ matchesProcessed: number; teamsDiscovered: number }> {
  const path = resolveEndpoint('tournament_team_events', {
    tournamentId,
    seasonId,
  });

  // ?type= is a query parameter, not a path parameter — pass via the
  // sportsApiClient.get() second argument (Record<string, any> params),
  // which Axios serialises as ?type=total etc. This matches how other
  // endpoints in this codebase append query params without hand-building
  // the URL string.
  const response = await sportsApiClient.get<any>(path, { type: eventType });

  // Real structure (confirmed from live response):
  //   response.data.tournamentTeamEvents = {
  //     [teamExternalId]: { [roundOrGroupId]: [ event, event, ... ] }
  //   }
  // Two levels of nesting before the event arrays. Each match appears twice
  // (once under homeTeam's entry, once under awayTeam's) — deduplicate by
  // event.id so every fixture is only inserted once.
  const tournamentTeamEvents = response?.data?.tournamentTeamEvents ?? {};
  const seenIds = new Set<number>();
  const fixtures: any[] = [];
  for (const teamRounds of Object.values(tournamentTeamEvents) as any[]) {
    for (const events of Object.values(teamRounds) as any[]) {
      for (const event of events as any[]) {
        if (event?.id && !seenIds.has(event.id)) {
          seenIds.add(event.id);
          fixtures.push(event);
        }
      }
    }
  }
  logger.info({ tournamentId, eventType, count: fixtures.length }, 'Fetched tournament fixtures');

  if (fixtures.length === 0) {
    logger.info({ tournamentId }, 'No fixtures returned for tournament');
    return { matchesProcessed: 0, teamsDiscovered: 0 };
  }

  // ── Extract unique teams (identical to syncSchedule) ────────────────────
  const teamMap = new Map<number, any>();
  for (const fixture of fixtures) {
    if (fixture.homeTeam?.id) teamMap.set(fixture.homeTeam.id, fixture.homeTeam);
    if (fixture.awayTeam?.id) teamMap.set(fixture.awayTeam.id, fixture.awayTeam);
  }

  // ── Upsert teams (identical to syncSchedule) ────────────────────────────
  const transformedTeams = Array.from(teamMap.values()).map((t: any) => ({
    external_id:  t.id,
    name:         t.name,
    short_name:   t.shortName || null,
    country:      t.country?.name || null,
    slug:         t.name.toLowerCase().replace(/\s+/g, '-'),
    created_at:   new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }));
  await teamsRepository.upsertBatch(transformedTeams as any[]);

  // ── Batch-resolve team external_id → internal id (identical to syncSchedule) ─
  const uniqueTeamExtIds = new Set<number>();
  for (const fixture of fixtures) {
    if (fixture.homeTeam?.id) uniqueTeamExtIds.add(fixture.homeTeam.id);
    if (fixture.awayTeam?.id) uniqueTeamExtIds.add(fixture.awayTeam.id);
  }
  const teamIdMap = new Map<number, any>();
  if (uniqueTeamExtIds.size > 0) {
    const teamsBatch = await teamsRepository.findByExternalIds(Array.from(uniqueTeamExtIds));
    for (const team of teamsBatch) teamIdMap.set(team.external_id, team);
  }

  // ── Transform matches (identical to syncSchedule) ───────────────────────
  const matches: any[] = [];
  const matchResults: Array<{ fixture: any; matchResult: any; homeTeam: any; awayTeam: any }> = [];

  for (const fixture of fixtures) {
    const homeTeam = teamIdMap.get(fixture.homeTeam?.id);
    const awayTeam = teamIdMap.get(fixture.awayTeam?.id);
    if (!homeTeam || !awayTeam) {
      logger.warn(
        { matchId: fixture.id, homeTeamExt: fixture.homeTeam?.id, awayTeamExt: fixture.awayTeam?.id },
        'Could not resolve team IDs for match — skipping',
      );
      continue;
    }
    const match = transformMatch(fixture);
    match.home_team_id = homeTeam.id;
    match.away_team_id = awayTeam.id;
    matches.push(match);

    const matchResult = transformMatchResult(match.id, fixture);
    matchResult.match_id = 0; // placeholder — resolved after batch upsert
    matchResults.push({ fixture, matchResult, homeTeam, awayTeam });
  }

  // ── Batch upsert matches (identical to syncSchedule) ────────────────────
  await matchesRepository.upsertBatch(matches);
  logger.debug({ count: matches.length, tournamentId }, 'Upserted matches');

  // ── Resolve match IDs + winner, upsert results (identical to syncSchedule) ─
  for (const { fixture, matchResult, homeTeam, awayTeam } of matchResults) {
    const match = await matchesRepository.findByExternalId(fixture.id);
    if (!match) {
      logger.warn({ externalId: fixture.id }, 'Match not found after upsert');
      continue;
    }
    matchResult.match_id = match.id;

    if (fixture.winnerCode === 1)      matchResult.winner_team_id = homeTeam.id;
    else if (fixture.winnerCode === 2) matchResult.winner_team_id = awayTeam.id;
    else                               matchResult.winner_team_id = null;

    await matchResultsRepository.upsert(matchResult);
  }

  return { matchesProcessed: matches.length, teamsDiscovered: teamMap.size };
}
