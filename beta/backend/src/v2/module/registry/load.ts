// ─────────────────────────────────────────────────────────────────────────────
// MODULE REGISTRY LOAD (S-6)
//
// Reads the governed module identities and their versions. The engine holds NO
// module list of its own — a module is calculated only when it is registered
// active AND has an implemented calculator, exactly as S-5 reconciles feature
// calculators against the feature registry.
//
// Version selection is per `as_of`: a reading is attributed to the module version
// whose effective period contains its instant, so a reading always names the rule
// that produced it (LC-53/LC-135). `minimum_sample_observation_count` (migration
// 023) travels with the version because the threshold is the version's.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

export interface ModuleDefinition {
  readonly moduleKey: string;
  readonly moduleDefinitionId: string;
  readonly subjectKindCode: string;
  readonly calibrationModeCode: string;
  readonly outcomeDimensionCode: string | null;
  readonly isActive: boolean;
}

export interface ModuleVersion {
  readonly moduleVersionId: string;
  readonly designation: string;
  readonly minimumSampleObservationCount: number;
}

export interface ModuleRegistry {
  readonly definitionsByKey: ReadonlyMap<string, ModuleDefinition>;
}

/** Loads every module definition. Versions are resolved per `as_of` (below). */
export async function loadModuleRegistry(tx: PoolClient): Promise<ModuleRegistry> {
  const { rows } = await tx.query<{
    module_key: string;
    id: string;
    subject_kind_code: string;
    calibration_mode_code: string;
    outcome_dimension_code: string | null;
    is_active: boolean;
  }>(
    `SELECT module_key, id::text, subject_kind_code, calibration_mode_code,
            outcome_dimension_code, is_active
       FROM module.module_definition
      ORDER BY display_number`
  );

  const definitionsByKey = new Map<string, ModuleDefinition>();
  for (const row of rows) {
    definitionsByKey.set(row.module_key, {
      moduleKey: row.module_key,
      moduleDefinitionId: row.id,
      subjectKindCode: row.subject_kind_code,
      calibrationModeCode: row.calibration_mode_code,
      outcomeDimensionCode: row.outcome_dimension_code,
      isActive: row.is_active,
    });
  }
  return { definitionsByKey };
}

/**
 * The module version in force for one definition at one instant.
 *
 * Selected by `effective_period @> as_of`, so a reading is attributed to the rule
 * that actually applied when it was taken. Returns null when no version covers
 * the instant — the engine then declines to compute rather than guessing a rule.
 */
export async function resolveModuleVersion(
  tx: PoolClient,
  moduleDefinitionId: string,
  asOf: Date
): Promise<ModuleVersion | null> {
  const { rows } = await tx.query<{
    id: string;
    designation: string;
    minimum_sample_observation_count: number;
  }>(
    `SELECT id::text, designation, minimum_sample_observation_count
       FROM module.module_version
      WHERE module_definition_id = $1
        AND effective_period @> $2::timestamptz
      ORDER BY lower(effective_period) DESC
      LIMIT 1`,
    [moduleDefinitionId, asOf]
  );
  if (rows.length === 0) return null;
  return {
    moduleVersionId: rows[0].id,
    designation: rows[0].designation,
    minimumSampleObservationCount: rows[0].minimum_sample_observation_count,
  };
}
