import { db } from '../db/client';
import { logger } from '../utils/logger';
import { TRACKED_LEAGUES } from '../config/trackedLeagues';
import { syncPlayerSeasonStatistics, syncTeamSeasonStatistics } from './syncSeasonStatistics';
import { syncStandings } from './syncStandings';

/**
 * Auto-resolves ONE representative team per tier band (A/B/C/Mandated/
 * Discovery) and runs player-stats + team-stats syncs against exactly
 * those teams in a single call — bypassing the normal cooldown/cap via
 * the existing multi-team override (see syncSeasonStatistics.ts). Also
 * runs a full standings sync (cheap — one call per tournament regardless,
 * ~42 calls total, already covers every band in one normal run).
 *
 * Built specifically to remove the manual "look up a team ID for each
 * band, then run sync:team-stats with all three IDs" friction — this
 * does the lookup automatically and runs the syncs in one command.
 *
 * Resolution strategy: for each unique band found in TRACKED_LEAGUES
 * (config-driven, not hardcoded to exactly A/B/C — new bands added there
 * are picked up automatically), take the FIRST tracked league entry with
 * that band, resolve its tournament in the DB via slug, then find any one
 * team currently in tournament_standings for that tournament. If a band's
 * tournament has no standings synced yet (sync:standings hasn't run, or
 * that specific league hasn't been captured), that band is skipped with
 * a clear warning — never silently drops it without explanation.
 *
 * Deliberately does NOT include squad sync here — squad sample logging
 * groups by team COUNTRY, not tier band (see apiSamples.ts docstring for
 * why), so a band-based team picker doesn't map cleanly onto it. Run
 * sync:squads:v2 separately if a squad sample is also wanted.
 */
export async function syncSampleBands(): Promise<{
  bandsAttempted: number;
  bandsResolved: number;
  teamsUsed: { band: string; league: string; teamExternalId: number }[];
  standings: Awaited<ReturnType<typeof syncStandings>>;
  playerStats: Awaited<ReturnType<typeof syncPlayerSeasonStatistics>>;
  teamStats: Awaited<ReturnType<typeof syncTeamSeasonStatistics>>;
}> {
  logger.info('syncSampleBands started — resolving one representative team per tier band');

  // One representative league per band, first match in TRACKED_LEAGUES
  // array order. Skips 'Mandated'/'Discovery' duplicates of the same band
  // already seen, same as skipping duplicate A/B/C entries.
  const seenBands = new Set<string>();
  const representativeLeagues: { band: string; slug: string; name: string }[] = [];
  for (const league of TRACKED_LEAGUES) {
    if (seenBands.has(league.band)) continue;
    seenBands.add(league.band);
    representativeLeagues.push({ band: league.band, slug: league.slug, name: league.name });
  }

  const teamsUsed: { band: string; league: string; teamExternalId: number }[] = [];

  for (const rep of representativeLeagues) {
    const { data: tournamentRows } = await db
      .from('tournaments')
      .select('id, name')
      .eq('slug', rep.slug)
      .limit(1);
    const tournament = tournamentRows?.[0];
    if (!tournament) {
      logger.warn({ band: rep.band, slug: rep.slug }, 'Band representative tournament not found in DB — has sync:today run for this league?');
      continue;
    }

    const { data: standingRows } = await db
      .from('tournament_standings')
      .select('team_id')
      .eq('tournament_id', tournament.id)
      .limit(1);
    const teamId = standingRows?.[0]?.team_id;
    if (!teamId) {
      logger.warn({ band: rep.band, tournament: tournament.name }, 'No standings synced for this tournament yet — run sync:standings first, skipping this band for now');
      continue;
    }

    const { data: teamRows } = await db
      .from('teams')
      .select('external_id')
      .eq('id', teamId)
      .limit(1);
    const teamExternalId = teamRows?.[0]?.external_id;
    if (!teamExternalId) {
      logger.warn({ band: rep.band, teamId }, 'Could not resolve external_id for picked team — skipping this band');
      continue;
    }

    teamsUsed.push({ band: rep.band, league: tournament.name, teamExternalId });
  }

  logger.info({ teamsUsed }, `Resolved ${teamsUsed.length}/${representativeLeagues.length} band representatives`);

  const teamExternalIds = teamsUsed.map(t => t.teamExternalId);

  // Standings: full run regardless (cheap, ~42 calls, already covers
  // every band in one normal call — no point scoping this one down).
  logger.info('Running full standings sync (covers all bands in one pass)...');
  const standings = await syncStandings();

  logger.info({ teamExternalIds }, 'Running player-stats + team-stats against band-representative teams...');
  const playerStats = teamExternalIds.length > 0
    ? await syncPlayerSeasonStatistics(undefined, teamExternalIds)
    : { teamsProcessed: 0, playersWritten: 0, skipped: 0, errors: 0 };
  const teamStats = teamExternalIds.length > 0
    ? await syncTeamSeasonStatistics(undefined, teamExternalIds)
    : { teamsProcessed: 0, written: 0, skipped: 0, errors: 0 };

  logger.info(
    { bandsResolved: teamsUsed.length, bandsAttempted: representativeLeagues.length },
    'syncSampleBands completed'
  );

  return {
    bandsAttempted: representativeLeagues.length,
    bandsResolved: teamsUsed.length,
    teamsUsed,
    standings,
    playerStats,
    teamStats,
  };
}
