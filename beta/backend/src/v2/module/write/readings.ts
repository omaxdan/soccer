// ─────────────────────────────────────────────────────────────────────────────
// THE MODULE WRITE BOUNDARY — module_reading + module_evidence + item(s)
//
// One reading, its single evidence set (LC-61), and one evidence item per cited
// value, written together. APPEND-ONLY with the conflict target NAMED: a re-run
// of the same (subject, context, definition, as_of, version) conflicts and is
// skipped, so recomputation is idempotent; any OTHER violation is heard.
//
// INVARIANTS ENFORCED HERE (matching the schema, not re-deciding it):
//   strength / confidence / published_baseline_id are NULL at 1.0.0 (D-5a/b, S-9
//   out of scope); an INACTIVE reading is silent (NULL strength/baseline) AND
//   carries an inactive_reason (migration 023); an engaged reading carries a
//   verdict and no inactive_reason.
//
// Evidence is written only when the reading is newly inserted — a skipped
// (already-present) reading already has its evidence from the run that wrote it.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

export interface EvidenceItemToWrite {
  readonly citedFeatureValueId: string;
  readonly citedFeatureValueAsOf: Date;
  readonly contributionDirection: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';
}

export interface ReadingToWrite {
  readonly moduleDefinitionId: string;
  readonly moduleVersionId: string;
  readonly subjectTeamId: string;
  readonly asOf: Date;
  readonly calculatedAt: Date;
  readonly contextEditionId: string;
  readonly statusCode: string;
  readonly verdictText: string | null;
  readonly inactiveReason: string | null;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly declaredInputCount: number;
  readonly presentInputCount: number;
  readonly belowThresholdInputCount: number;
  readonly estimatedInputCount: number;
  readonly evidenceItems: readonly EvidenceItemToWrite[];
}

export interface ReadingWriteResult {
  readonly written: number;
  readonly skipped: number;
}

/**
 * Writes one module reading with its evidence, skipping if it already exists.
 *
 * `strength`, `confidence` and `published_baseline_id` are hard NULL — the frozen
 * 1.0.0 contract, not a runtime choice. The reading is TEAM-subject and
 * COMPETITION_SCOPED, so the subject player/fixture/edition columns are NULL and
 * `context_competition_edition_id` carries the edition.
 */
export async function writeReading(
  tx: PoolClient,
  reading: ReadingToWrite
): Promise<ReadingWriteResult> {
  const inserted = await tx.query<{ id: string; as_of: Date }>(
    `INSERT INTO module.module_reading
       (as_of, calculated_at, module_definition_id, module_version_id,
        subject_kind_code, subject_team_id,
        context_kind_code, context_competition_edition_id,
        module_status_code, strength, confidence,
        sample_observation_count, sample_meets_threshold,
        published_baseline_id, headline_text, verdict_text, inactive_reason)
     VALUES
       ($1::timestamptz, $2::timestamptz, $3::bigint, $4::bigint,
        'TEAM', $5::bigint,
        'COMPETITION_SCOPED', $6::bigint,
        $7::text, NULL, NULL,
        $8::integer, $9::boolean,
        NULL, NULL, $10::text, $11::text)
     ON CONFLICT ON CONSTRAINT uq_module_reading__subject_context_definition_asof_version
     DO NOTHING
     RETURNING id::text, as_of`,
    [
      reading.asOf,
      reading.calculatedAt,
      reading.moduleDefinitionId,
      reading.moduleVersionId,
      reading.subjectTeamId,
      reading.contextEditionId,
      reading.statusCode,
      reading.sampleObservationCount,
      reading.sampleMeetsThreshold,
      reading.verdictText,
      reading.inactiveReason,
    ]
  );

  if (inserted.rows.length === 0) return { written: 0, skipped: 1 };

  const readingId = inserted.rows[0].id;
  const readingAsOf = inserted.rows[0].as_of;

  const evidence = await tx.query<{ id: string }>(
    `INSERT INTO module.module_evidence
       (reading_as_of, module_reading_id,
        declared_input_count, present_input_count,
        below_threshold_input_count, estimated_input_count)
     VALUES ($1::timestamptz, $2::bigint, $3::integer, $4::integer, $5::integer, $6::integer)
     RETURNING id::text`,
    [
      readingAsOf,
      readingId,
      reading.declaredInputCount,
      reading.presentInputCount,
      reading.belowThresholdInputCount,
      reading.estimatedInputCount,
    ]
  );
  const evidenceId = evidence.rows[0].id;

  for (const item of reading.evidenceItems) {
    await tx.query(
      `INSERT INTO module.module_evidence_item
         (reading_as_of, module_evidence_id,
          cited_feature_value_id, cited_feature_value_as_of, contribution_direction)
       VALUES ($1::timestamptz, $2::bigint, $3::bigint, $4::timestamptz, $5::text)`,
      [readingAsOf, evidenceId, item.citedFeatureValueId, item.citedFeatureValueAsOf, item.contributionDirection]
    );
  }

  return { written: 1, skipped: 0 };
}
