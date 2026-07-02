/**
 * STANDINGS SYNC — per-TOURNAMENT, not per-team. Confirmed real structure.
 *
 * Source: GET /tournament/{tournamentId}/season/{seasonId}/standings
 *         (also /standings/home and /standings/away — not synced by default,
 *          see cadence note below)
 *
 * CONFIRMED via live testing: response shape is a FLAT array directly under
 * `standings` — NOT the nested {standings:[{rows:[...]}]} shape an earlier
 * sample response suggested. Field names also differ from that earlier
 * sample: `played`/`won`/`drawn`/`lost`/`goalsFor`/`goalsAgainst` (not
 * matches/wins/draws/losses/scoresFor/scoresAgainst), and `teamId` is a
 * direct field (not nested under `team.id`). SportsAPI Pro evidently
 * normalizes this endpoint's response differently than other endpoints —
 * confirmed against live data, not assumed from documentation.
 *
 * MULTI-GROUP / CONFERENCE STANDINGS (e.g. MLS Eastern/Western): NOT YET
 * CONFIRMED against real data. Worth noting: the flat-array shape above
 * was confirmed correct for SINGLE-group leagues specifically — the
 * nested {standings:[{rows:[...]}]} shape mentioned above as "an earlier
 * sample suggested" may well have been a genuine sample for a DIFFERENT
 * (multi-group) tournament, not simply wrong documentation. That earlier
 * guess wasn't necessarily incorrect in general — it may just not have
 * matched the specific single-group tournament that was live-tested at
 * the time. This is exactly the kind of ambiguity logApiSample() (see
 * below) resolves empirically instead of by further guessing — once a
 * real multi-group response has been captured to
 * backend/docs/api-samples/standings/, the shape-detection logic further
 * down in this file can be tightened to the confirmed exact field names.
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

      // ── MULTI-GROUP / CONFERENCE HANDLING ─────────────────────────────
      // Some leagues (e.g. MLS Eastern/Western Conference) split standings
      // into multiple groups within a single response. The confirmed
      // single-group shape is a flat array: response.standings = [{
      // position, teamId, teamName, played, won, ... }]. For multi-group
      // leagues, SportsAPI Pro's exact shape is NOT YET CONFIRMED against
      // real data — this handles the two most common patterns real sports
      // APIs use for this, detected at runtime rather than assumed:
      //
      //   Shape A: still flat, but each row carries a group identifier
      //            field (e.g. row.group / row.groupName / row.tableName)
      //   Shape B: top-level array of GROUP objects, each with its own
      //            nested rows array (e.g. group.rows / group.standings /
      //            group.table), rather than team rows directly
      //
      // Once a real multi-group response has been captured via
      // logApiSample above (check backend/docs/api-samples/standings/),
      // this detection can be tightened to the exact confirmed shape.
      // Until then: this tries both interpretations rather than guessing
      // one and silently breaking on the other.
      const topLevel = response?.standings ?? [];
      let standingsRows: { row: any; groupLabel: string }[] = [];

      if (topLevel.length > 0 && topLevel[0]?.teamId != null) {
        // Shape A (or plain single-group) — flat team rows. Look for an
        // optional per-row group field; default to 'total' when absent
        // (this is the confirmed single-group case, e.g. Premier League).
        standingsRows = topLevel.map((r: any) => ({
          row: r,
          groupLabel: (r.group ?? r.groupName ?? r.tableName ?? 'total').toString().toLowerCase().replace(/\s+/g, '_'),
        }));
      } else if (topLevel.length > 0) {
        // Shape B — array of group wrapper objects. Try common nested-
        // array field names and common group-name field names.
        for (const group of topLevel) {
          const nestedRows = group.rows ?? group.standings ?? group.table ?? group.teams ?? [];
          const groupLabel = (group.name ?? group.groupName ?? group.description ?? group.tableName ?? 'total')
            .toString().toLowerCase().replace(/\s+/g, '_');
          if (!Array.isArray(nestedRows) || nestedRows.length === 0) continue;
          for (const r of nestedRows) {
            standingsRows.push({ row: r, groupLabel });
          }
        }
        if (standingsRows.length === 0) {
          logger.warn(
            { tournamentId: ctx.tournamentId, topLevelSample: JSON.stringify(topLevel[0]).slice(0, 300) },
            'Standings response looked like grouped shape B but no recognized nested-rows field was found — see backend/docs/api-samples/standings/ for the captured sample to identify the real field names'
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

      // Resolve internal team IDs from the direct teamId field
      const teamExtIds = standingsRows.map(({ row }) => row.teamId).filter(Boolean);
      const { data: dbTeams } = await db
        .from('teams')
        .select('id, external_id')
        .in('external_id', teamExtIds);
      const teamIdMap = new Map(
        (dbTeams ?? []).map((t: any) => [t.external_id, t.id])
      );

      // Map API fields to DB columns (note the API field names: played, won, drawn, lost, goalsFor, goalsAgainst)
      // standings_type now carries the real group label (e.g. 'eastern_conference')
      // instead of a hardcoded 'total' for every row — see multi-group
      // handling above. Single-group leagues still get 'total' exactly as
      // before, unaffected by this change.
      const dbRows = standingsRows
        .filter(({ row }) => teamIdMap.has(row.teamId))
        .map(({ row: r, groupLabel }) => ({
          tournament_id: ctx.tournamentId,
          team_id: teamIdMap.get(r.teamId),
          season_external_id: ctx.seasonExternalId,
          standings_type: groupLabel,
          position: r.position ?? null,
          matches: r.played ?? null,          // API field is "played", DB column is "matches"
          wins: r.won ?? null,
          draws: r.drawn ?? null,
          losses: r.lost ?? null,
          scores_for: r.goalsFor ?? null,
          scores_against: r.goalsAgainst ?? null,
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
