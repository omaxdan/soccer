// ─────────────────────────────────────────────────────────────────────────────
// STANDINGS STAGE — one call, one league table, one as-of date
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS STAGE DOES NOT WRITE. `recordStandings` DOES.
//
// It reads the provider's table, resolves each provider team id to the surrogate
// V2 already holds, and hands the rows to the existing writer. There is one
// standings writer in this codebase and this file is not it — the same
// discipline `ingestEvents` keeps with `resolveFixture`.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE CAPTURED RESPONSE ESTABLISHES  (Step A, doc evidence
// `season_standings__seasonId-87678__tournamentId-325.json`, sha256 15205f21e393)
//
//   { success, tournamentId, seasonId, totalTeams, standings[], source, timezone }
//
// `standings` is a FLAT array of 20 objects — one per team, positions 1–20, no
// grouping construct, no variant label, and no nested structure anywhere. Each
// row carries exactly ten scalars: position, teamId, teamName, played, won,
// drawn, lost, goalsFor, goalsAgainst, points.
//
// TWO THINGS THE RESPONSE DOES NOT CONTAIN, both NOT NULL in football.standing:
//
//   standing_variant  There is no HOME/AWAY split and no label. The table is
//                     demonstrably the overall one — every team's complete
//                     record, points = 3·won + drawn across all 20 rows — so
//                     TOTAL CLASSIFIES WHAT WAS OBSERVED rather than inferring
//                     anything. No HOME or AWAY row is written, and their
//                     absence stays visible as the coverage fact it is.
//
//   as_of_on          See below. It is the reason this stage takes a date
//                     instead of computing one.
//
// `teamName` is read by nobody. Canonical team identity is football.team, and a
// provider display string has no business competing with it.
//
// There is no goal-difference column in football.standing and the provider sends
// no goal-difference field. Nothing is derived.
//
// ─────────────────────────────────────────────────────────────────────────────
// as_of_on IS SUPPLIED, NOT DERIVED — AND IT IS NOT THE WINDOW
//
// `season_standings` takes NO historical parameter. It returns the provider's
// CURRENT table whatever window was requested. So a backfill run with
// `--to 2026-06-30` receives the August table, and stamping it 2026-06-30 would
// assert a June league table that never existed — a fabricated observation of
// the same class as a substituted 0–0 or an invented season period, and silent,
// because a wrong-dated table looks entirely plausible.
//
// The honest stamp is the UTC calendar date on which the snapshot was OBSERVED.
// The caller establishes it once per run and passes it here, so twenty rows
// cannot disagree about when they were seen.
//
// These are PROVIDER-OBSERVED SNAPSHOTS, not reconstructed history.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

import type { ProviderClient } from '../provider/client';
import { PROVIDER_CODE } from '../provider/config';
import { recordStandings, type ProviderStandingRow } from '../entities/standings';
import { IngestionCounts, findByProviderId } from '../write/index';
import { asRecord, externalId, nonNegativeInt } from '../normalise';
import type { StageCounts } from './schedule';
import { logger } from '../../../utils/logger';

/**
 * The only variant this endpoint supplies.
 *
 * `ck_standing__variant_known` admits TOTAL, HOME and AWAY. The captured
 * response carries one unlabelled table covering every fixture, so TOTAL is what
 * was observed. HOME and AWAY are not written and are not inferred.
 */
export const OBSERVED_VARIANT = 'TOTAL' as const;

/** The provider's envelope, kept loose because it is external data. */
interface StandingsResponse {
  readonly standings?: unknown;
}

/** One row as the provider sends it, before any resolution. */
export interface RawStandingRow {
  readonly teamProviderId: string;
  readonly position: number;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly points: number;
}

/**
 * Reads the provider table, refusing rows it cannot interpret.
 *
 * Shape failures are separated from write failures deliberately: a row missing a
 * team id is not a row the database should be asked about. `teamName` is
 * available here and is not carried forward.
 */
export function interpretStandings(response: StandingsResponse): {
  rows: RawStandingRow[];
  rejected: string[];
} {
  const raw = Array.isArray(response.standings) ? response.standings : [];
  const rows: RawStandingRow[] = [];
  const rejected: string[] = [];

  for (const candidate of raw) {
    const row = asRecord(candidate);
    if (!row) {
      rejected.push('standing entry was not an object');
      continue;
    }
    const teamProviderId = externalId(row.teamId);
    if (!teamProviderId) {
      rejected.push('standing row has no teamId');
      continue;
    }
    const numbers = {
      position: nonNegativeInt(row.position),
      played: nonNegativeInt(row.played),
      won: nonNegativeInt(row.won),
      drawn: nonNegativeInt(row.drawn),
      lost: nonNegativeInt(row.lost),
      goalsFor: nonNegativeInt(row.goalsFor),
      goalsAgainst: nonNegativeInt(row.goalsAgainst),
      points: nonNegativeInt(row.points),
    };
    const missing = Object.entries(numbers)
      .filter(([, value]) => value === null)
      .map(([name]) => name);
    if (missing.length > 0) {
      // A NEGATIVE count arrives here too: `nonNegativeInt` returns null for it,
      // so it is refused as a missing figure rather than written and left to a
      // CHECK. Either way it never reaches the table.
      rejected.push(`standing row for team ${teamProviderId} lacks ${missing.join(', ')}`);
      continue;
    }

    rows.push({
      teamProviderId,
      position: numbers.position!,
      played: numbers.played!,
      won: numbers.won!,
      drawn: numbers.drawn!,
      lost: numbers.lost!,
      goalsFor: numbers.goalsFor!,
      goalsAgainst: numbers.goalsAgainst!,
      points: numbers.points!,
    });
  }

  return { rows, rejected };
}

/** Fetches the table. One call, no paging — the endpoint declares no page. */
export async function fetchSeasonStandings(
  client: ProviderClient,
  competitionProviderId: string,
  seasonProviderId: string
): Promise<StandingsResponse> {
  return client.get<StandingsResponse>('season_standings', {
    tournamentId: competitionProviderId,
    seasonId: seasonProviderId,
  });
}

/**
 * Resolves every team and hands the table to `recordStandings`.
 *
 * NO SHELL TEAMS. `findByProviderId` reads and never writes, so a team the
 * standings mention and the fixture universe does not is REJECTED and counted.
 * Creating one here would produce a club with a name, a league position and no
 * fixtures — which is how V1 accumulated entities that existed only because
 * something referenced them.
 *
 * Verified against the capture: all 20 standings teams are exactly the 20 teams
 * the fixture sweep already wrote, so this rejects nothing for competition 325.
 * It is here for the competition where that is not true.
 */
export async function ingestStandings(
  tx: PoolClient,
  options: {
    readonly competitionEditionId: string;
    readonly asOfOn: string;
    readonly response: StandingsResponse;
  }
): Promise<StageCounts> {
  const counts = new IngestionCounts();
  const { rows, rejected } = interpretStandings(options.response);
  for (const reason of rejected) counts.reject(reason);

  const resolved: ProviderStandingRow[] = [];
  for (const row of rows) {
    const teamId = await findByProviderId(tx, 'football.team', PROVIDER_CODE, row.teamProviderId);
    if (!teamId) {
      counts.reject(`standings team ${row.teamProviderId} is not in football.team`);
      logger.warn(
        { team: row.teamProviderId, edition: options.competitionEditionId },
        'v2 ingestion: standings team not present, row not written and no team created'
      );
      continue;
    }
    resolved.push({
      teamId,
      position: row.position,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
    });
  }

  // THE EXISTING WRITER. It owns the `played = won + drawn + lost` rejection and
  // the append-only insert; nothing here duplicates either.
  await recordStandings(
    tx,
    options.competitionEditionId,
    OBSERVED_VARIANT,
    options.asOfOn,
    resolved,
    counts
  );

  logger.info(
    {
      edition: options.competitionEditionId,
      asOfOn: options.asOfOn,
      variant: OBSERVED_VARIANT,
      offered: resolved.length,
      written: counts.written,
      inserted: counts.inserted,
      updated: counts.updated,
      skipped: counts.skipped,
      rejected: counts.rejected,
    },
    'v2 ingestion: standings snapshot processed'
  );

  return { total: counts, byRelation: new Map([['football.standing', counts]]) };
}
