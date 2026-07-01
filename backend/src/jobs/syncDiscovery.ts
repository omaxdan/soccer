import { sportsApiClient } from '../services/sportsApiClient';
import { resolveEndpoint } from '../constants/endpoints';
import { countriesRepository } from '../repositories/CountriesRepository';
import { tournamentsRepository } from '../repositories/TournamentsRepository';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import { Season } from '../types/index';

/**
 * Sync Tournaments
 *
 * Discovers all available tournaments and links them to countries.
 * Idempotent - safe to run multiple times.
 */
export async function syncTournaments(): Promise<{
  tournamentsProcessed: number;
  error?: string;
}> {
  logger.info('Starting tournaments sync');

  try {
    const endpoint = resolveEndpoint('tournaments');

    // ⏳ Rate‑limit protection
    await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds

    const response = await sportsApiClient.get<any>(endpoint);
    const tournaments = response.tournaments || response.data?.tournaments || [];
    logger.info({ count: tournaments.length }, 'Fetched tournaments');

    if (tournaments.length === 0) {
      return { tournamentsProcessed: 0 };
    }

    // Collect countries from tournament category
    const countrySet = new Map<string, { name: string; alpha2?: string; slug?: string }>();
    for (const t of tournaments) {
      const countryName = t.category?.name || t.country?.name;
      if (countryName) {
        countrySet.set(countryName, {
          name: countryName,
          alpha2: t.category?.alpha2 || t.country?.alpha2 || null,
          slug: countryName.toLowerCase().replace(/\s+/g, '-'),
        });
      }
    }

    // Ensure countries exist
    for (const [name, countryData] of countrySet) {
      const existing = await countriesRepository.findByName(name);
      if (!existing) {
        await countriesRepository.upsert(name, countryData);
      }
    }

    // Transform and upsert tournaments
    const transformed: any[] = [];
    for (const t of tournaments) {
      const countryName = t.category?.name || t.country?.name;
      let countryId: number | null = null;
      if (countryName) {
        const country = await countriesRepository.findByName(countryName);
        if (country) countryId = country.id;
      }

      transformed.push({
        external_id: t.id,
        name: t.name,
        slug: t.slug || t.name.toLowerCase().replace(/\s+/g, '-'),
        country_id: countryId,
        category: t.type || t.category?.name || null,
      });
    }

    await tournamentsRepository.upsertBatch(transformed);

    logger.info(
      { tournamentsProcessed: transformed.length },
      'Tournaments sync completed'
    );

    return { tournamentsProcessed: transformed.length };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Tournaments sync failed');
    return { tournamentsProcessed: 0, error: error.message };
  }
}

/**
 * Sync Seasons for a Tournament
 */
export async function syncSeasonsForTournament(
  tournamentExternalId: number
): Promise<{
  seasonsProcessed: number;
  error?: string;
}> {
  logger.debug({ tournamentExternalId }, 'Syncing seasons for tournament');

  try {
    const endpoint = resolveEndpoint('seasons');
    const response = await sportsApiClient.get<any>(endpoint);

    const allSeasons = response.seasons || response.data?.seasons || [];

    // Filter seasons for this tournament
    const tournamentSeasons = allSeasons.filter(
      (s: any) => s.league?.id === tournamentExternalId
    );

    if (tournamentSeasons.length === 0) {
      logger.debug(
        { tournamentExternalId },
        'No seasons found for tournament'
      );
      return { seasonsProcessed: 0 };
    }

    // Get tournament ID from DB
    const tournament = await tournamentsRepository.findByExternalId(
      tournamentExternalId
    );

    if (!tournament) {
      logger.warn({ tournamentExternalId }, 'Tournament not found in DB');
      return { seasonsProcessed: 0 };
    }

    // Upsert seasons
    const transformed: any[] = tournamentSeasons.map((s: any) => ({
      id: 0,
      external_id: s.id,
      name: s.name,
      year: s.year,
      tournament_id: tournament.id,
      created_at: new Date().toISOString(),
    }));

    const { error } = await db
      .from('seasons')
      .upsert(transformed, { onConflict: 'external_id' });

    if (error) {
      throw error;
    }

    logger.debug(
      { tournamentId: tournament.id, seasonsProcessed: transformed.length },
      'Seasons synced'
    );

    return { seasonsProcessed: transformed.length };
  } catch (error: any) {
    logger.error(
      { error: error.message, tournamentExternalId },
      'Seasons sync failed'
    );
    return { seasonsProcessed: 0, error: error.message };
  }
}

/**
 * Sync all seasons for all tournaments
 */
export async function syncAllSeasons(): Promise<{
  totalSeasons: number;
  failures: any[];
}> {
  logger.info('Starting full seasons sync');

  const tournaments = await tournamentsRepository.getAll();
  let totalSeasons = 0;
  const failures = [];

  for (const tournament of tournaments) {
    try {
      const result = await syncSeasonsForTournament(tournament.external_id);
      totalSeasons += result.seasonsProcessed;
    } catch (error: any) {
      failures.push({
        tournamentId: tournament.id,
        error: error.message,
      });
    }
  }

  logger.info(
    { totalSeasons, failures: failures.length },
    'Full seasons sync completed'
  );

  return { totalSeasons, failures };
}
