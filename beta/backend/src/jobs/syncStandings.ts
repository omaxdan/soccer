/**
 * STANDINGS SYNC — per-TOURNAMENT, not per-team.
 *
 * Source: GET /tournament/{tournamentId}/season/{seasonId}/standings
 *         (also /standings/home and /standings/away — not synced by default,
 *          see cadence note below)
 *
 * CONFIRMED SHAPE — flat array, via 5 real captured samples spanning 5
 * different countries/tiers (Egypt/band A, China/band B, South Korea/
 * band C, Lithuania/Discovery, Argentina/Mandated — see
 * backend/docs/api-samples/standings/*.json):
 *
 *   response.standings = [{ position, teamId, teamName, played, won,
 *                            drawn, lost, goalsFor, goalsAgainst, points }]
 *
 * This matches what the ORIGINAL pre-session code already correctly
 * expected — no fix was actually needed for this shape.
 *
 * CORRECTION — a prior version of this file mistakenly treated a
 * different-looking sample (nested team.id, a rows[] wrapper, matches/
 * wins/draws/losses/scoresFor/scoresAgainst field names, and a
 * `promotion` field) as an alternate shape THIS endpoint could return.
 * It wasn't. That sample was from SofaScore — a completely different
 * provider this file has never called (this file only ever calls
 * sportsApiClient, i.e. SportsAPI Pro). The two were never two shapes of
 * the same data; they were two unrelated providers. The grouped-shape
 * parsing and promotion capture built on that mistaken premise have been
 * removed. If a genuine SofaScore standings integration is ever wanted
 * (e.g. specifically to get promotion/relegation zone context, which
 * SportsAPI Pro's standings response does not carry at all), it would
 * need its own separate sync path calling that provider directly — not
 * bolted onto this file.
 *
 * MOTIVATION-CONTEXT ALTERNATIVE, not yet built: rather than relying on
 * a `promotion` label SportsAPI Pro doesn't provide, a real motivation
 * signal is derivable purely from what's already synced — points gap to
 * the position boundaries that matter (e.g. within N points of the top-3/
 * automatic-promotion cutoff, or within N points of the bottom-3/
 * relegation cutoff), computed against each tournament's own full table.
 * This needs its own formula design (what counts as "close," does it
 * vary by league size) and is flagged as a follow-up requiring sign-off,
 * same discipline as the team_strength_ratings formula change earlier
 * this project — not built here without that discussion first.
 *
 * Grouped-shape detection (looksGrouped below) is kept ONLY as a thin,
 * genuinely-unconfirmed defensive fallback — for a true multi-group/
 * conference league (e.g. MLS Eastern/Western) that SportsAPI Pro itself
 * might return differently. None of the 5 samples captured so far are
 * multi-group leagues, so this remains unconfirmed either way; kept
 * because it costs nothing to leave in, not because there's current
 * evidence for it.
 *
 * Lesson from this whole detour: a captured sample is only useful
 * evidence for what it actually came from. The api-samples logger (see
 * logApiSample below) exists to catch shape drift and per-tournament
 * variance empirically — but a sample still needs to be correctly
 * attributed to the right source before conclusions get drawn from it.
 *
 * This is the cheapest data point in the entire platform: one call per
 * tracked tournament returns the FULL league table for every team in it.
 * 42 tracked tournaments = 42 calls for complete league-position coverage,
 * versus the 766 calls a per-team approach would cost for the same coverage.
 *
 * Resolves the league_position gap in team_strength_ratings that's been
 * null since the original build — no standings source existed before this.
 *
 * CADENCE: weekly (42 calls/week ≈ 6/day) — standings change slowly enough
 * that daily refresh adds little value for the extra cost.
 *
 * Only 'total' standings synced by default. /standings/home and
 * /standings/away exist and would let team_venue_performance cross-validate
 * against official data instead of our internally-derived home/away splits
 * — left out for now to stay within budget (42 tournaments × 3 types = 126
 * calls would need an 18+ day cooldown to fit the remaining margin; revisit
 * if home/away accuracy becomes a priority).
 */

import { sportsApiClient } from '../services/sportsApiClient';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import { logApiSample } from '../utils/apiSamples';
import { getBandBySlug } from '../config/trackedLeagues';

const THROTTLE_MS = 2000;
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Resolves each tracked tournament's most recent season external_id. */
async function getTournamentSeasons(): Promise<
  Map<number, {
    tournamentId: number;
    tournamentExternalId: number;
    seasonExternalId: number;
    band: string | null;
  }>
> {
  const result = new Map<
    number,
    { tournamentId: number; tournamentExternalId: number; seasonExternalId: number; band: string | null }
  >();

  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, external_id, name, slug');
  if (!tournaments) return result;

  const { data: seasons } = await db
    .from('seasons')
    .select('external_id, tournament_id')
    .order('external_id', { ascending: false });

  const seasonByTournamentId = new Map<number, number>();
  for (const s of seasons ?? []) {
    if (!seasonByTournamentId.has(s.tournament_id)) {
      seasonByTournamentId.set(s.tournament_id, s.external_id);
    }
  }

  for (const t of tournaments) {
    const seasonExternalId = seasonByTournamentId.get(t.id);
    if (!seasonExternalId) continue;
    result.set(t.id, {
      tournamentId: t.id,
      tournamentExternalId: t.external_id,
      seasonExternalId,
      // NOTE: tier band (A/B/C/Mandated/Discovery) resolved via slug from
      // the static TRACKED_LEAGUES config — NOT from tournaments.category
      // in the DB, which stores country, not tier. See getBandBySlug()
      // docstring in config/trackedLeagues.ts for why these are different.
      band: getBandBySlug(t.slug ?? ''),
    });
  }

  return result;
}

export async function syncStandings(): Promise<{
  tournamentsProcessed: number;
  rowsWritten: number;
  skipped: number;
  errors: number;
}> {
  logger.info('syncStandings started — per-tournament, ~42 calls total');

  const tournamentSeasons = await getTournamentSeasons();
  if (tournamentSeasons.size === 0) {
    logger.warn(
      'No tournament/season pairs resolved — has sync:today run, and seasons been populated?'
    );
    return { tournamentsProcessed: 0, rowsWritten: 0, skipped: 0, errors: 0 };
  }

  let rowsWritten = 0,
    skipped = 0,
    errors = 0;

  for (const [, ctx] of tournamentSeasons) {
    try {
      // Correct endpoint: /tournament/{id}/season/{id}/standings
      // The stable tournament ID (uniqueTournament.id) is what our DB stores as external_id.
      const response = await sportsApiClient.get<any>(
        `/tournament/${ctx.tournamentExternalId}/season/${ctx.seasonExternalId}/standings`
      );

      // Capture one reference sample per tournament tier band — see
      // backend/docs/PLAYER_STATS_EXPANSION.md sibling doc for the same
      // pattern applied here. Zero extra API calls, soft-fails silently.
      await logApiSample('standings', ctx.band, response);

      // ── SHAPE DETECTION ──────────────────────────────────────────────
      // CONFIRMED FLAT via 5 real captured samples spanning 5 different
      // countries/tiers (Egypt/A, China/B, South Korea/C, Lithuania/
      // Discovery, Argentina/Mandated) — response.standings is a flat
      // array directly: [{ position, teamId, teamName, played, won,
      // drawn, lost, goalsFor, goalsAgainst, points }]. This matches
      // what the ORIGINAL pre-session code already correctly expected.
      //
      // CORRECTION TO EARLIER SESSION WORK: a "grouped" shape with
      // nested team.id, rows[], and a promotion field was earlier
      // mistaken for this same endpoint's alternate response format.
      // It was actually from SofaScore — a DIFFERENT provider this file
      // has never called (this file only ever calls sportsApiClient).
      // The two were never two shapes of the same data; they were two
      // different providers entirely. That grouped-shape handling and
      // the promotion capture built on top of it have been removed —
      // see git history if a genuine SofaScore standings integration is
      // ever wanted later (would need its own separate sync path, since
      // this file doesn't call that provider at all).
      //
      // Grouped-shape detection kept below ONLY as a thin defensive
      // fallback for a genuinely different, still-unconfirmed case — a
      // true multi-group/conference league (e.g. MLS Eastern/Western)
      // returned by SportsAPI Pro itself. None of the 5 tracked-band
      // representatives sampled so far are multi-group leagues, so this
      // remains unconfirmed either way; kept because it costs nothing
      // and protects against a real future case, not because there's
      // current evidence for it.
      const topLevel = response?.standings ?? [];
      let standingsRows: { row: any; groupLabel: string }[] = [];

      const looksFlat = topLevel.length > 0 && topLevel[0]?.teamId != null;
      const looksGrouped = topLevel.length > 0 && Array.isArray(topLevel[0]?.rows);

      if (looksFlat) {
        // Confirmed shape — see above.
        standingsRows = topLevel.map((r: any) => ({
          row: r,
          groupLabel: (r.group ?? r.groupName ?? r.tableName ?? 'total').toString().toLowerCase().replace(/\s+/g, '_'),
        }));
      } else if (looksGrouped) {
        // Unconfirmed defensive fallback — see comment block above.
        for (const group of topLevel) {
          const nestedRows = group.rows ?? group.standings ?? group.table ?? group.teams ?? [];
          const groupLabel = (group.type ?? group.name ?? group.groupName ?? group.description ?? group.tableName ?? 'total')
            .toString().toLowerCase().replace(/\s+/g, '_');
          if (!Array.isArray(nestedRows) || nestedRows.length === 0) continue;
          for (const r of nestedRows) {
            standingsRows.push({ row: r, groupLabel });
          }
        }
        if (standingsRows.length === 0) {
          logger.warn(
            { tournamentId: ctx.tournamentId, topLevelSample: JSON.stringify(topLevel[0]).slice(0, 300) },
            'Standings response looked like grouped shape but rows array was empty — see backend/docs/api-samples/standings/ for the captured sample'
          );
        }
      }

      if (standingsRows.length === 0) {
        skipped++;
        logger.warn(
          {
            tournamentId: ctx.tournamentId,
            topLevelKeys: Object.keys(response ?? {}),
            sample: JSON.stringify(response).slice(0, 300),
          },
          'Standings response had no rows — check shape against expected flat array'
        );
        await delay(THROTTLE_MS);
        continue;
      }

      // Resolve internal team IDs. CONFIRMED via 5 real samples spanning
      // 5 countries: team ID is a direct flat field (row.teamId), not
      // nested. Fallback to row.team.id kept for the unconfirmed grouped
      // case above — costs nothing.
      const extractTeamId = (r: any): number | null => r.teamId ?? r.team?.id ?? null;
      const teamExtIds = standingsRows.map(({ row }) => extractTeamId(row)).filter((id): id is number => id != null);
      const { data: dbTeams } = await db
        .from('teams')
        .select('id, external_id')
        .in('external_id', teamExtIds);
      const teamIdMap = new Map(
        (dbTeams ?? []).map((t: any) => [t.external_id, t.id])
      );

      // Map API fields to DB columns. CONFIRMED via 5 real samples
      // spanning Egypt/China/South Korea/Lithuania/Argentina: played/won/
      // drawn/lost/goalsFor/goalsAgainst — matching what the ORIGINAL
      // pre-session code already correctly expected. An earlier session
      // mistakenly treated a SofaScore sample (matches/wins/draws/losses/
      // scoresFor/scoresAgainst, plus a promotion field) as an alternate
      // shape of THIS SAME endpoint — it wasn't; that was a different
      // provider this file has never called. That capture logic has been
      // removed. See top-of-file docstring for the full correction.
      // SofaScore-style names kept as a harmless fallback only, in case
      // the genuinely-unconfirmed grouped case above ever fires.
      const dbRows = standingsRows
        .filter(({ row }) => teamIdMap.has(extractTeamId(row) ?? -1))
        .map(({ row: r, groupLabel }) => ({
          tournament_id: ctx.tournamentId,
          team_id: teamIdMap.get(extractTeamId(r)!),
          season_external_id: ctx.seasonExternalId,
          standings_type: groupLabel,
          position: r.position ?? null,
          matches: r.played ?? r.matches ?? null,
          wins: r.won ?? r.wins ?? null,
          draws: r.drawn ?? r.draws ?? null,
          losses: r.lost ?? r.losses ?? null,
          scores_for: r.goalsFor ?? r.scoresFor ?? null,
          scores_against: r.goalsAgainst ?? r.scoresAgainst ?? null,
          points: r.points ?? null,
          calculated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

      if (dbRows.length > 0) {
        const { error } = await db
          .from('tournament_standings')
          .upsert(dbRows, {
            onConflict: 'team_id,season_external_id,standings_type',
          });
        if (error) throw new Error(error.message);
        rowsWritten += dbRows.length;
      }

      logger.info(
        { tournamentId: ctx.tournamentId, teamsInTable: dbRows.length },
        'Standings synced'
      );
    } catch (error: any) {
      errors++;
      logger.error(
        { tournamentId: ctx.tournamentId, error: error.message },
        'Standings sync failed for tournament'
      );
    }

    await delay(THROTTLE_MS);
  }

  logger.info(
    { tournamentsProcessed: tournamentSeasons.size, rowsWritten, skipped, errors },
    'syncStandings completed'
  );
  return { tournamentsProcessed: tournamentSeasons.size, rowsWritten, skipped, errors };
}
