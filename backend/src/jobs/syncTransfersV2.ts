/**
 * TRANSFERS SYNC V2 — dedicated endpoint, confirmed real response structure.
 *
 * Source: GET /teams/{teamId}/transfers
 * (CONFIRMED via live testing — "teams" plural, matching the convention
 *  used by standings/statistics/squad-sync on SportsAPI Pro's proxy API.
 *  Note this differs from SofaScore's own direct API, which uses singular
 *  "team" — the proxy and the underlying service don't share path
 *  conventions, confirmed now across four separate endpoints.)
 * Confirmed fields: transfersIn[] / transfersOut[], each with player,
 * transferFrom, transferTo, fromTeamName, toTeamName, type (numeric code),
 * transferFee, transferFeeDescription, transferDateTimestamp, transferFeeRaw.
 *
 * One call returns BOTH directions for that team — confirmed from the
 * sample response (transfersIn present at top level).
 *
 * CADENCE: NOT a recurring daily/weekly job. Transfer windows close on
 * different dates by country (England/Spain ~Aug 31, Brazil/Argentina on
 * their own calendar, MLS has two windows, etc.) — see the country-clustered
 * burst strategy. Run this manually or via a DATED cron a day or two after
 * a specific region's window closes, scoped to that region's teams only.
 *
 * Usage:
 *   npx ts-node src/cli.ts sync:transfers "Brazil"
 *   npx ts-node src/cli.ts sync:transfers "England,Spain,Germany,Italy,France"
 *   npx ts-node src/cli.ts sync:transfers          (all tracked teams — only
 *                                                    for a true full backfill,
 *                                                    NOT a recurring command)
 */

import { sportsApiClient } from '../services/sportsApiClient';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import { logApiSample } from '../utils/apiSamples';

const THROTTLE_MS = 2000;
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface RawTransferEntry {
  player: { id: number; name: string };
  transferFrom?: { id: number; name: string };
  transferTo?: { id: number; name: string };
  fromTeamName?: string;
  toTeamName?: string;
  type?: number;
  transferFeeRaw?: { value: number; currency: string };
  transferDateTimestamp?: number;
}

async function getTeamsForCountries(countries?: string[]): Promise<any[]> {
  let query = db.from('teams').select('id, external_id, name, country');
  if (countries && countries.length > 0) {
    query = query.in('country', countries);
  }
  const { data } = await query;
  return data ?? [];
}

export async function syncTransfersForTeams(countries?: string[]): Promise<{
  teamsProcessed: number;
  transfersWritten: number;
  errors: number;
}> {
  const teams = await getTeamsForCountries(countries);
  logger.info({ countries: countries ?? 'ALL', teamCount: teams.length }, 'syncTransfersV2 started');

  let transfersWritten = 0, errors = 0;

  for (const team of teams) {
    try {
      const response = await sportsApiClient.get<any>(`/teams/${team.external_id}/transfers`);

      // Full reference sample, zero extra API calls. Grouped by
      // team.country, same reasoning as squad sync — this loop runs
      // per-team without resolving which tracked tournament/tier band a
      // team belongs to, so country is what's cheaply available here.
      // See apiSamples.ts docstring for the full band-vs-country
      // grouping reasoning.
      await logApiSample('transfers', team.country, response);

      const allEntries: RawTransferEntry[] = [
        ...(response?.transfersIn ?? []),
        ...(response?.transfersOut ?? []),
      ];

      if (allEntries.length === 0) {
        await delay(THROTTLE_MS);
        continue;
      }

      // Resolve internal player IDs
      const playerExtIds = allEntries.map(e => e.player?.id).filter(Boolean);
      const { data: dbPlayers } = await db
        .from('players')
        .select('id, external_id')
        .in('external_id', playerExtIds);
      const playerIdMap = new Map((dbPlayers ?? []).map((p: any) => [p.external_id, p.id]));

      // Resolve internal team IDs for from/to (nullable — fine if not tracked)
      const teamExtIds = allEntries
        .flatMap(e => [e.transferFrom?.id, e.transferTo?.id])
        .filter((id): id is number => !!id);
      const { data: dbTeams } = await db
        .from('teams')
        .select('id, external_id')
        .in('external_id', teamExtIds.length > 0 ? teamExtIds : [-1]);
      const teamIdMap = new Map((dbTeams ?? []).map((t: any) => [t.external_id, t.id]));

      const rows = allEntries
        .filter(e => playerIdMap.has(e.player?.id) && e.transferDateTimestamp)
        .map(e => ({
          player_id:             playerIdMap.get(e.player.id),
          from_team_id:           e.transferFrom?.id ? (teamIdMap.get(e.transferFrom.id) ?? null) : null,
          to_team_id:             e.transferTo?.id   ? (teamIdMap.get(e.transferTo.id)   ?? null) : null,
          transfer_date:          new Date(e.transferDateTimestamp! * 1000).toISOString().split('T')[0],
          transfer_fee:           e.transferFeeRaw?.value ?? null,
          transfer_fee_currency:  e.transferFeeRaw?.currency ?? null,
          transfer_type:          e.type ?? null,
          source:                 'transfers_api', // exact data — distinguishes from the squad_diff heuristic
        }));

      if (rows.length > 0) {
        // Dedupe against existing rows for this player+date (avoid re-inserting
        // the same transfer if this team appears in multiple country bursts)
        const { error } = await db
          .from('player_transfers')
          .upsert(rows, { onConflict: 'player_id,transfer_date', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        transfersWritten += rows.length;
      }

      logger.info({ teamId: team.id, teamName: team.name, transfersFound: rows.length }, 'Transfers synced');
    } catch (error: any) {
      errors++;
      logger.error({ teamId: team.id, teamName: team.name, error: error.message }, 'Transfer sync failed for team');
    }

    await delay(THROTTLE_MS);
  }

  logger.info({ teamsProcessed: teams.length, transfersWritten, errors }, 'syncTransfersV2 completed');
  return { teamsProcessed: teams.length, transfersWritten, errors };
}
