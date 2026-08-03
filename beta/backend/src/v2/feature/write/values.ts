// ─────────────────────────────────────────────────────────────────────────────
// THE WRITE BOUNDARY — feature.feature_value
//
// Everything that must happen exactly once happens here: rounding, provenance
// resolution, threshold evaluation, and the `calculated_at` clock read. Four
// calculators do none of it, which is what keeps them consistent rather than
// four times reimplemented.
//
// ─────────────────────────────────────────────────────────────────────────────
// APPEND-ONLY, WITH THE CONFLICT TARGET NAMED
//
// `ON CONFLICT ON CONSTRAINT uq_feature_value__subject_context_definition_asof_version
// DO NOTHING`.
//
// Named, never bare. A bare `DO NOTHING` swallows EVERY constraint violation —
// the composite version/definition binding (C-09), the subject-exclusivity check
// (PD-03, LC-35), the context obligation (LC-39), the sample non-negativity
// check — each of which means the calculator is wrong and must be heard. Naming
// the constraint keeps exactly one condition quiet: the row already exists.
//
// There is no UPDATE path and no DELETE path in this module, and none may be
// added. `pt_pipeline_feature` holds SELECT and INSERT on schema `feature` and
// nothing else, and `tr_feature_value__append_guard` refuses an UPDATE from
// every principal without exception.
//
// ─────────────────────────────────────────────────────────────────────────────
// VERSION IDENTITY: SUPERSESSION IS BY NEW ROW, NEVER BY OVERWRITE
//
// `feature_version_id` is INSIDE the business identity. Recalculating the same
// subject, context, definition and `as_of` under the SAME version conflicts and
// is skipped; under a NEW version it is a new row and both coexist, each
// addressable and each attributed to the rule that produced it.
//
// `calculated_at` is deliberately NOT in the identity, which is what makes
// re-running idempotent: a value calculated twice keeps the `calculated_at` of
// the row that exists.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { CALCULATION_CONTEXT_KIND, type CandidateValue } from '../calculators/types';
import type { FeatureDefinition, Registry } from '../registry/load';
import { resolve } from './provenance';
import { roundHalfUp, toNumericString } from './scale';

/** A candidate that was actually inserted, with the identity lineage needs. */
export interface WrittenValue {
  readonly valueId: string;
  readonly candidate: CandidateValue;
}

export interface ValueWriteResult {
  readonly examined: number;
  readonly written: number;
  readonly skipped: number;
  readonly writtenValues: readonly WrittenValue[];
}

/**
 * Deterministic candidate order.
 *
 * Not cosmetic: a stable insert order makes the statement itself identical
 * between runs, which is what R-2's replay guarantee rests on. Sorting by the
 * business identity — feature, subject, instant — rather than by whatever order
 * a calculator's loops happened to produce.
 */
function compareCandidates(a: CandidateValue, b: CandidateValue): number {
  if (a.featureKey !== b.featureKey) return a.featureKey < b.featureKey ? -1 : 1;
  if (a.teamId !== b.teamId) return a.teamId < b.teamId ? -1 : 1;
  return a.asOf.getTime() - b.asOf.getTime();
}

/**
 * Writes candidate values, skipping any already present.
 *
 * `calculatedAt` is supplied by the caller rather than read here, so one
 * instant covers a whole batch and the value is testable. It is the ONLY
 * current-time value in the write path — `as_of` comes from the driver and is
 * never `now()`.
 *
 * Returns the rows actually inserted. Skipped rows are excluded deliberately:
 * their lineage was written when they were, in the same transaction, so
 * re-deriving it would be an attempt to insert edges that already exist.
 */
export async function writeValues(
  tx: PoolClient,
  registry: Registry,
  candidates: readonly CandidateValue[],
  calculatedAt: Date
): Promise<ValueWriteResult> {
  if (candidates.length === 0) {
    return { examined: 0, written: 0, skipped: 0, writtenValues: [] };
  }

  const ordered = [...candidates].sort(compareCandidates);
  const parameters: unknown[] = [];
  const tuples: string[] = [];

  for (const candidate of ordered) {
    const definition = requireDefinition(registry, candidate.featureKey);
    const resolved = resolve(registry, definition, candidate);

    // THE SINGLE ROUNDING POINT. The candidate arrives at working precision and
    // is rounded once, half-up, to the scale the registry declares. Rounding in
    // a calculator and again here would be double rounding, which can move a
    // value by a full unit of the last place.
    const rounded = roundHalfUp(candidate.value, definition.valueScale);

    // Values are in range by construction — form and readiness are weighted
    // means of components already bounded to 0–100, congestion and travel select
    // from fixed band tables. NOT clamped here deliberately: a clamp would
    // silently repair a calculator defect that should instead be visible.
    const values = [
      candidate.asOf,
      calculatedAt,
      definition.id,
      definition.versionId,
      candidate.teamId,
      CALCULATION_CONTEXT_KIND,
      toNumericString(rounded),
      resolved.provenanceClassCode,
      resolved.sampleObservationCount,
      resolved.sampleMeetsThreshold,
    ];
    const base = parameters.length;
    parameters.push(...values);
    // EVERY column is cast explicitly. A `VALUES` list inside a CTE has no
    // target column to infer from, so an uncast parameter arrives as `unknown`
    // and the INSERT fails on a type it could have resolved anywhere else.
    tuples.push(
      `($${base + 1}::timestamptz, $${base + 2}::timestamptz, $${base + 3}::bigint, ` +
        `$${base + 4}::bigint, 'TEAM'::text, $${base + 5}::bigint, $${base + 6}::text, ` +
        `$${base + 7}::numeric, $${base + 8}::text, $${base + 9}::integer, $${base + 10}::boolean)`
    );
  }

  const { rows } = await tx.query<{ id: string; row_index: number }>(
    `WITH candidate (as_of, calculated_at, feature_definition_id, feature_version_id,
                     subject_kind_code, subject_team_id, context_kind_code, value,
                     provenance_class_code, sample_observation_count, sample_meets_threshold)
       AS (VALUES ${tuples.join(', ')}),
     numbered AS (
       SELECT c.*, row_number() OVER () - 1 AS row_index FROM candidate c
     ),
     inserted AS (
       INSERT INTO feature.feature_value
         (as_of, calculated_at, feature_definition_id, feature_version_id,
          subject_kind_code, subject_team_id, context_kind_code,
          context_competition_edition_id, value, provenance_class_code,
          sample_observation_count, sample_meets_threshold)
       SELECT n.as_of, n.calculated_at, n.feature_definition_id, n.feature_version_id,
              n.subject_kind_code, n.subject_team_id, n.context_kind_code,
              NULL, n.value, n.provenance_class_code,
              n.sample_observation_count, n.sample_meets_threshold
         FROM numbered n
         ORDER BY n.row_index
       ON CONFLICT ON CONSTRAINT uq_feature_value__subject_context_definition_asof_version
       DO NOTHING
       RETURNING id, feature_definition_id, subject_team_id, as_of
     )
     SELECT i.id::text, n.row_index::int
       FROM inserted i
       JOIN numbered n
         ON n.feature_definition_id = i.feature_definition_id
        AND n.subject_team_id = i.subject_team_id
        AND n.as_of = i.as_of
      ORDER BY n.row_index`,
    parameters
  );

  const writtenValues: WrittenValue[] = rows.map((row) => ({
    valueId: row.id,
    candidate: ordered[row.row_index],
  }));

  return {
    examined: ordered.length,
    written: writtenValues.length,
    skipped: ordered.length - writtenValues.length,
    writtenValues,
  };
}

function requireDefinition(registry: Registry, featureKey: string): FeatureDefinition {
  const definition = registry.definitionsByKey.get(featureKey);
  if (!definition) {
    throw new Error(
      `calculator produced a value for '${featureKey}', which is not registered. ` +
        'Every value must be attributable to a governed definition.'
    );
  }
  return definition;
}
