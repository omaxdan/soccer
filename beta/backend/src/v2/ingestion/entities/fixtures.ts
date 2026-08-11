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

/** A fixture already stored, found by provider identity alone. */
export interface StoredFixtureIdentity {
  readonly id: string;
  /** The partition this fixture was FILED IN at creation. Never recomputed. */
  readonly partitionOn: string;
  readonly lifecycleState: string;
}

/**
 * Raised when one provider fixture resolves to more than one stored row.
 *
 * THIS IS THE CORRUPTION U-9 DESCRIBES, caught in the act. It cannot be
 * resolved here: picking a row would attach today's result to an arbitrary half
 * of the fixture's history, and merging would need a DELETE that
 * `pt_pipeline_ingestion` does not hold. The identities and partitions are
 * carried on the error so the condition can be investigated with the two rows in
 * hand rather than rediscovered.
 */
export class AmbiguousFixtureIdentityError extends Error {
  constructor(
    readonly providerCode: string,
    readonly providerExternalId: string,
    readonly occurrences: readonly { readonly id: string; readonly partitionOn: string }[]
  ) {
    super(
      `Provider fixture ${providerCode}/${providerExternalId} resolves to ${occurrences.length} rows: ` +
        occurrences.map((row) => `id=${row.id} partition=${row.partitionOn}`).join(', ') +
        '. One provider fixture must have exactly one row. See doc 39 (U-9).'
    );
    this.name = 'AmbiguousFixtureIdentityError';
  }
}

/**
 * Finds a stored fixture by its provider identity, ACROSS EVERY PARTITION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS QUERY IS THE APPLICATION'S ENFORCEMENT POINT FOR AN INVARIANT POSTGRESQL
 * CANNOT ENFORCE.
 *
 * `uq_fixture__provider_external_id` is
 * `(provider_code, provider_external_id, fixture_partition_on)`, and the
 * partition key is in it because PostgreSQL requires every unique constraint on
 * a partitioned relation to contain every partition key column. `football.fixture`
 * is a hub entity with no parent to bind the dependency to, so nothing in the
 * database enforces that one provider fixture has one row. C-02 permits the
 * three-column constraint only on PD-05's premise — that the partition key is
 * functionally determined by the business key — and THIS FUNCTION IS WHAT MAKES
 * THAT PREMISE TRUE.
 *
 * There is deliberately NO PARTITION PREDICATE. Adding one would reintroduce
 * exactly the defect this exists to remove: a rescheduled fixture would be
 * looked for in the partition its NEW kickoff implies, found absent, and
 * inserted a second time. PostgreSQL scans every partition, each using the local
 * index behind the unique constraint, whose leading columns are precisely the
 * two searched here.
 *
 * The partition date is returned as TEXT, formatted in SQL. `date` arrives from
 * the driver as a JavaScript Date at LOCAL midnight, and converting that back to
 * a UTC calendar date shifts a day in any zone ahead of UTC — ER-01's hazard,
 * on the one column where a one-day error silently files the row in the wrong
 * partition.
 */
export async function findFixtureByProviderIdentity(
  tx: PoolClient,
  providerExternalId: string
): Promise<StoredFixtureIdentity | null> {
  const { rows } = await tx.query<{
    id: string;
    fixture_partition_on: string;
    lifecycle_state_code: string;
  }>(
    `SELECT id::text,
            to_char(fixture_partition_on, 'YYYY-MM-DD') AS fixture_partition_on,
            lifecycle_state_code
       FROM football.fixture
      WHERE provider_code = $1 AND provider_external_id = $2
      ORDER BY fixture_partition_on`,
    [PROVIDER_CODE, providerExternalId]
  );

  if (rows.length > 1) {
    throw new AmbiguousFixtureIdentityError(
      PROVIDER_CODE,
      providerExternalId,
      rows.map((row) => ({ id: row.id, partitionOn: row.fixture_partition_on }))
    );
  }

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    partitionOn: row.fixture_partition_on,
    lifecycleState: row.lifecycle_state_code,
  };
}

/**
 * The partition a fixture is written to.
 *
 * An EXISTING fixture keeps the partition it already has, whatever its kickoff
 * has since become. A NEW fixture derives one from the kickoff it was first
 * announced with. Pure, and separated from the write so the rule that U-9 turned
 * on can be tested without a database.
 */
export function partitionForWrite(
  existing: StoredFixtureIdentity | null,
  scheduledKickoffAt: Date
): string {
  return existing ? existing.partitionOn : fixturePartitionOn(scheduledKickoffAt);
}

/**
 * Whether this write is a lifecycle transition, and from what.
 *
 * FIVE CASES, and the vocabulary already distinguishes all five — no new model
 * is introduced here:
 *
 *   genuinely new         previous null → a creation transition to whatever
 *                         state it arrived in. A backfilled fixture that is
 *                         already finished records `null → COMPLETED`, not a
 *                         SCHEDULED it was never in.
 *   refreshed, unchanged  previous equals current → NO transition. A feed
 *                         restating a state has reported no change.
 *   postponed → reopened  POSTPONED → SCHEDULED, which is the reschedule the
 *                         vocabulary means by "until rescheduled and reopened".
 *   already played        COMPLETED restated → no transition.
 *   already known         previous is the STORED state, never null, so no
 *                         `null → SCHEDULED` is fabricated for a fixture the
 *                         writer is merely meeting for the first time this run.
 *
 * That last case is the second half of U-9: the old implementation looked for
 * the previous state in the partition the NEW kickoff implied, found nothing,
 * and wrote a creation transition for a fixture months old.
 */
export function lifecycleTransitionFor(
  previous: string | null,
  next: string
): { readonly from: string | null; readonly to: string } | null {
  return previous === next ? null : { from: previous, to: next };
}

/**
 * Resolves a fixture and records any lifecycle change.
 *
 * THE PARTITION KEY IS NEVER RECOMPUTED. It is derived once, from the kickoff a
 * fixture was first announced with, and every later write reuses the stored
 * value — which is what `ck_fixture__partition_not_after_kickoff` is built to
 * permit, what `immutableColumns` guards in the update branch, and what every
 * child's ON UPDATE RESTRICT enforces.
 *
 * U-10, and it is NOT handled here. A fixture rescheduled EARLIER than its
 * original date has a kickoff below its immutable partition date, and
 * `ck_fixture__partition_not_after_kickoff` rejects the update. That failure is
 * left to PostgreSQL, loudly and by name. Catching it would mean either
 * advancing the partition — the corruption this function exists to prevent — or
 * swallowing a scheduling change the platform would then be wrong about. A loud
 * abort is the correct posture until U-10 is decided on its own terms.
 *
 * `ck_fixture__participants_distinct` refuses home = away. Not re-checked here:
 * PostgreSQL owns it, and a provider feed that reports a team playing itself is
 * a data condition that should surface as a constraint violation with a name
 * rather than as a silently skipped fixture.
 */
export async function resolveFixture(
  tx: PoolClient,
  fixture: ProviderFixture,
  counts: IngestionCounts,
  transitionCounts: IngestionCounts
): Promise<FixtureRef> {
  const lifecycleState = mapLifecycleState(fixture.providerStatusCode);

  if (isUnmappedLifecycle(fixture.providerStatusCode)) {
    // Not counted as rejected — the row IS written, with UNKNOWN. But it seals
    // by default, so a mapping gap costs snapshots and must be visible.
    logger.warn(
      { fixture: fixture.externalId, providerStatus: fixture.providerStatusCode },
      'v2 ingestion: provider status unmapped, fixture recorded as UNKNOWN and will not accept snapshots'
    );
  }

  // IDENTITY FIRST, PARTITION SECOND. The stored row is found by what identifies
  // the fixture — provider and external id — before anything derived from the
  // kickoff is consulted, because the kickoff is the part that moves.
  const existing = await findFixtureByProviderIdentity(tx, fixture.externalId);
  const partitionOn = partitionForWrite(existing, fixture.scheduledKickoffAt);
  const previous = existing?.lifecycleState ?? null;

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

  const transition = lifecycleTransitionFor(previous, lifecycleState);
  if (transition) {
    // ITS OWN COUNTER. Handing it `counts` attributed every transition write to
    // football.fixture, so a first-ever run reported 94 examined over 47
    // fixtures while fixture_lifecycle_transition reported 0 with 47 rows on
    // disk (F-2, doc 47 §5). Nothing about the write changed — only which bucket
    // the count lands in.
    await recordLifecycleTransition(tx, ref, transition.from, transition.to, transitionCounts);
  }

  return ref;
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
