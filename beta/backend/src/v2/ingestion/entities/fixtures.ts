// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — fixture, fixture_lifecycle_transition, result, result_revision
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE THINGS V1 COLLAPSED INTO ONE COLUMN
//
// V1 wrote `matches.status`, overwritten on every sync. A fixture postponed on
// Tuesday and replayed in March showed 'finished' and nothing else: the
// postponement left no trace, and any measurement over a population containing
// it was silently wrong.
//
// V2 separates the three facts that column conflated:
//
//   fixture.lifecycle_state_code   the PLATFORM's state. Governs sealing (LC-14)
//   fixture.provider_status_raw    the provider's own string. Diagnosis only
//   fixture_lifecycle_transition   APPEND-ONLY history of every change
//
// The transition record is the one that has to be written by comparing against
// what is already stored, because a transition is a CHANGE and a feed reports
// only a current state. That comparison is this file's real work.
//
// ─────────────────────────────────────────────────────────────────────────────
// A CORRECTED SCORE IS A REVISION, NOT AN OVERWRITE
//
// LC-17: "Calibration must be able to distinguish a claim that was wrong from a
// claim measured against a figure later corrected; without this relation that
// distinction is unavailable and every measurement over a population containing
// amended fixtures is silently misattributed."
//
// So when a confirmed result's goals change, the PREVIOUS figures are appended
// to result_revision under an increasing ordinal before the result is updated.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE } from '../provider/config';
import { mapLifecycleState, isUnmappedLifecycle } from '../mapping/index';
import { IngestionCounts, insertAppendOnly, upsertMutable } from '../write/index';
import { fixturePartitionOn, nonNegativeInt, providerStatusRaw } from '../normalise';
import { logger } from '../../../utils/logger';

export interface ProviderFixture {
  readonly externalId: string;
  readonly competitionEditionId: string;
  readonly competitionStageId: string | null;
  readonly venueId: string | null;
  readonly isNeutralVenue: boolean;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly scheduledKickoffAt: Date;
  readonly providerStatusCode: number | null;
  readonly providerStatusRaw: unknown;
}

/** A fixture as stored, with everything a dependent write needs. */
export interface FixtureRef {
  readonly id: string;
  /** The partition key. Supplied by the application, never re-read (ER-01). */
  readonly partitionOn: string;
  readonly lifecycleState: string;
}

/**
 * Resolves a fixture and records any lifecycle change.
 *
 * THE PARTITION KEY IS NEVER UPDATED. It is part of the conflict target and is
 * listed as immutable, so a rescheduled fixture keeps the partition it was
 * created in — which is what `ck_fixture__partition_not_after_kickoff` is built
 * to permit, and what every child's ON UPDATE RESTRICT enforces.
 *
 * `ck_fixture__participants_distinct` refuses home = away. Not re-checked here:
 * PostgreSQL owns it, and a provider feed that reports a team playing itself is
 * a data condition that should surface as a constraint violation with a name
 * rather than as a silently skipped fixture.
 */
export async function resolveFixture(
  tx: PoolClient,
  fixture: ProviderFixture,
  counts: IngestionCounts
): Promise<FixtureRef> {
  const partitionOn = fixturePartitionOn(fixture.scheduledKickoffAt);
  const lifecycleState = mapLifecycleState(fixture.providerStatusCode);

  if (isUnmappedLifecycle(fixture.providerStatusCode)) {
    // Not counted as rejected — the row IS written, with UNKNOWN. But it seals
    // by default, so a mapping gap costs snapshots and must be visible.
    logger.warn(
      { fixture: fixture.externalId, providerStatus: fixture.providerStatusCode },
      'v2 ingestion: provider status unmapped, fixture recorded as UNKNOWN and will not accept snapshots'
    );
  }

  // The state before this write, needed to decide whether a transition occurred.
  const previous = await currentLifecycleState(tx, fixture.externalId, partitionOn);

  const row = await upsertMutable(tx, {
    relation: 'football.fixture',
    columns: [
      'provider_code',
      'provider_external_id',
      'fixture_partition_on',
      'competition_edition_id',
      'competition_stage_id',
      'venue_id',
      'is_neutral_venue',
      'home_team_id',
      'away_team_id',
      'scheduled_kickoff_at',
      'lifecycle_state_code',
      'provider_status_raw',
    ],
    values: [
      PROVIDER_CODE,
      fixture.externalId,
      partitionOn,
      fixture.competitionEditionId,
      fixture.competitionStageId,
      fixture.venueId,
      fixture.isNeutralVenue,
      fixture.homeTeamId,
      fixture.awayTeamId,
      fixture.scheduledKickoffAt,
      lifecycleState,
      providerStatusRaw(fixture.providerStatusRaw),
    ],
    conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
    immutableColumns: ['fixture_partition_on'],
    returning: ['id'],
  });

  const ref: FixtureRef = { id: String(row.id), partitionOn, lifecycleState };
  counts.examined += 1;
  counts.written += 1;

  if (previous === null || previous !== lifecycleState) {
    await recordLifecycleTransition(tx, ref, previous, lifecycleState, counts);
  }

  return ref;
}

/** The stored lifecycle state, or null when the fixture is new. */
async function currentLifecycleState(
  tx: PoolClient,
  providerExternalId: string,
  partitionOn: string
): Promise<string | null> {
  const { rows } = await tx.query<{ lifecycle_state_code: string }>(
    `SELECT lifecycle_state_code FROM football.fixture
      WHERE provider_code = $1 AND provider_external_id = $2 AND fixture_partition_on = $3`,
    [PROVIDER_CODE, providerExternalId, partitionOn]
  );
  return rows[0]?.lifecycle_state_code ?? null;
}

/**
 * Appends a lifecycle transition.
 *
 * APPEND-ONLY — ingestion holds S and I on this relation and no UPDATE, in the
 * grant, the policy and the trigger. `from_state_code` is nullable, which is how
 * the first transition (creation) is expressed: null → SCHEDULED.
 *
 * `transitioned_at` is the application's clock, not `now()`, and it is part of
 * `uq_fixture_lifecycle_transition__fixture_at`. Two syncs in the same second
 * observing the same change therefore write once; the second is skipped.
 */
async function recordLifecycleTransition(
  tx: PoolClient,
  fixture: FixtureRef,
  fromState: string | null,
  toState: string,
  counts: IngestionCounts
): Promise<void> {
  const result = await insertAppendOnly(tx, {
    relation: 'football.fixture_lifecycle_transition',
    columns: [
      'fixture_id',
      'fixture_partition_on',
      'from_state_code',
      'to_state_code',
      'transitioned_at',
    ],
    rows: [[fixture.id, fixture.partitionOn, fromState, toState, new Date()]],
    conflictTarget: ['fixture_partition_on', 'fixture_id', 'transitioned_at'],
  });
  counts.add(result);
}

export interface ProviderResult {
  readonly homeGoals: number | null;
  readonly awayGoals: number | null;
  readonly homeGoalsHalfTime: number | null;
  readonly awayGoalsHalfTime: number | null;
  readonly homeGoalsExtraTime: number | null;
  readonly awayGoalsExtraTime: number | null;
  readonly homePenalties: number | null;
  readonly awayPenalties: number | null;
}

/**
 * Records a result, appending a revision when a confirmed score changes.
 *
 * NOT WRITTEN FOR A FIXTURE THAT HAS NOT FINISHED. "A scheduled fixture has no
 * result, and modelling absence as empty attributes on the fixture would make
 * 'not yet played' and 'played, nil-nil' structurally identical." A live score
 * is not a result either — it is a score so far, and writing it would assert a
 * final figure that is not final.
 *
 * The paired CHECKs (`ck_result__half_time_paired`, `__extra_time_paired`,
 * `__penalties_paired`) require both sides of each pair or neither. Half a pair
 * is dropped, because one team's extra-time goals without the other's describes
 * nothing.
 */
export async function recordResult(
  tx: PoolClient,
  fixture: FixtureRef,
  result: ProviderResult,
  counts: IngestionCounts
): Promise<void> {
  if (fixture.lifecycleState !== 'COMPLETED') {
    counts.examined += 1;
    counts.skipped += 1;
    return;
  }

  const homeGoals = nonNegativeInt(result.homeGoals);
  const awayGoals = nonNegativeInt(result.awayGoals);
  if (homeGoals === null || awayGoals === null) {
    // A completed fixture with no score is a genuine data-quality condition, not
    // a nil-nil. Substituting zeroes would manufacture a result.
    counts.reject('completed fixture reported without a full-time score');
    logger.warn({ fixture: fixture.id }, 'v2 ingestion: completed fixture has no score, result not written');
    return;
  }

  const pair = <T>(a: T | null, b: T | null): [T | null, T | null] =>
    a !== null && b !== null ? [a, b] : [null, null];

  const [htHome, htAway] = pair(
    nonNegativeInt(result.homeGoalsHalfTime),
    nonNegativeInt(result.awayGoalsHalfTime)
  );
  const [etHome, etAway] = pair(
    nonNegativeInt(result.homeGoalsExtraTime),
    nonNegativeInt(result.awayGoalsExtraTime)
  );
  const [pkHome, pkAway] = pair(
    nonNegativeInt(result.homePenalties),
    nonNegativeInt(result.awayPenalties)
  );

  const existing = await existingResult(tx, fixture);

  // LC-17. A CONFIRMED result whose goals have changed is amended through a
  // revision record carrying the PREVIOUS figures. An unconfirmed result is
  // still settling and is simply updated — there is no claim to preserve yet.
  if (
    existing &&
    existing.confirmedAt !== null &&
    (existing.homeGoals !== homeGoals || existing.awayGoals !== awayGoals)
  ) {
    await appendResultRevision(tx, fixture, existing, counts);
  }

  await upsertMutable(tx, {
    relation: 'football.result',
    columns: [
      'fixture_id',
      'fixture_partition_on',
      'home_goals',
      'away_goals',
      'home_goals_half_time',
      'away_goals_half_time',
      'home_goals_extra_time',
      'away_goals_extra_time',
      'home_penalties',
      'away_penalties',
      'confirmed_at',
    ],
    values: [
      fixture.id,
      fixture.partitionOn,
      homeGoals,
      awayGoals,
      htHome,
      htAway,
      etHome,
      etAway,
      pkHome,
      pkAway,
      existing?.confirmedAt ?? new Date(),
    ],
    conflictTarget: ['fixture_partition_on', 'fixture_id'],
    immutableColumns: ['fixture_id', 'fixture_partition_on'],
  });

  counts.examined += 1;
  counts.written += 1;
}

interface StoredResult {
  readonly id: string;
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly confirmedAt: Date | null;
  readonly nextOrdinal: number;
}

async function existingResult(tx: PoolClient, fixture: FixtureRef): Promise<StoredResult | null> {
  const { rows } = await tx.query<{
    id: string;
    home_goals: number;
    away_goals: number;
    confirmed_at: Date | null;
    next_ordinal: string;
  }>(
    `SELECT r.id::text,
            r.home_goals,
            r.away_goals,
            r.confirmed_at,
            COALESCE((SELECT max(v.revision_ordinal) + 1
                        FROM football.result_revision v
                       WHERE v.result_id = r.id
                         AND v.fixture_partition_on = r.fixture_partition_on), 1)::text AS next_ordinal
       FROM football.result r
      WHERE r.fixture_id = $1 AND r.fixture_partition_on = $2`,
    [fixture.id, fixture.partitionOn]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
    confirmedAt: row.confirmed_at,
    nextOrdinal: Number(row.next_ordinal),
  };
}

/**
 * Appends the superseded figures under the next ordinal.
 *
 * A.2 ordinal succession, the same shape migration 019 used for run completion
 * and A.2 established for snapshot outcome revision. The ordinal is computed in
 * the same statement family that reads it, inside the work transaction, so two
 * concurrent revisions of one result cannot both claim ordinal 2 —
 * `uq_result_revision__result_ordinal` refuses the second.
 */
async function appendResultRevision(
  tx: PoolClient,
  fixture: FixtureRef,
  existing: StoredResult,
  counts: IngestionCounts
): Promise<void> {
  const result = await insertAppendOnly(tx, {
    relation: 'football.result_revision',
    columns: [
      'result_id',
      'fixture_partition_on',
      'revision_ordinal',
      'revised_at',
      'previous_home_goals',
      'previous_away_goals',
      'revision_reason',
    ],
    rows: [
      [
        existing.id,
        fixture.partitionOn,
        existing.nextOrdinal,
        new Date(),
        existing.homeGoals,
        existing.awayGoals,
        `Provider revised a confirmed score from ${existing.homeGoals}-${existing.awayGoals}. ` +
          'Recorded under LC-17 so calibration can distinguish a wrong claim from one measured ' +
          'against a figure later corrected.',
      ],
    ],
    conflictTarget: ['fixture_partition_on', 'result_id', 'revision_ordinal'],
  });
  counts.add(result);
  logger.info(
    { fixture: fixture.id, ordinal: existing.nextOrdinal },
    'v2 ingestion: confirmed result revised, previous figures preserved'
  );
}
