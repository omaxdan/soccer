// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY LOADING
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DATABASE IS THE REGISTRY. THIS FILE HAS NO COPY OF IT.
//
// Nothing here hard-codes a feature key, a scale, a direction, a provenance
// ceiling, a sample threshold, a context binding or a snapshot offset. Every one
// of those is a row S-3 wrote, and a hard-coded copy would be the version the
// calculator believed while the database held another.
//
// The only feature keys written into S-5 source are the ones each calculator
// CLAIMS — and load-time reconciliation (§ assertCalculatorCoverage) proves the
// claims and the registry agree, so a drift fails at startup rather than
// producing values under a definition nobody registered.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHICH VERSION PRODUCED A VALUE
//
// The version in force AT CALCULATION TIME, not at `as_of`.
//
// LC-32 makes `calculated_at` independent of `as_of`: "A value calculated today
// describing a moment last year is legitimate backfill." The rule that produced
// such a value is the rule running today, so a replay of a fixture from before
// the registry was seeded is still attributed to the current version — which is
// true, and is what makes the backfill legible as backfill.
//
// The current version is selected as the one with an OPEN effective period.
// `ex_feature_version__periods_do_not_overlap` guarantees at most one per
// definition, so the selection is unambiguous without reading a clock.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** A feature definition, exactly as the registry holds it. */
export interface FeatureDefinition {
  readonly id: string;
  readonly featureKey: string;
  readonly subjectKindCode: string;
  readonly unit: string;
  /** Decimal places. The single rounding boundary rounds to this. */
  readonly valueScale: number;
  readonly direction: 'HIGHER_IS_STRONGER' | 'LOWER_IS_STRONGER' | 'UNSIGNED';
  /** The strongest provenance class a value of this feature may ever claim. */
  readonly maxProvenanceClassCode: string;
  readonly meaningfulSampleThreshold: number;
  readonly isActive: boolean;
  readonly calculatorId: string;
  readonly calculatorKey: string;
  /** The version in force, and the one every value written now is attributed to. */
  readonly versionId: string;
  readonly versionDesignation: string;
  /** Context kinds this definition is permitted at (A.11 binding relation). */
  readonly contextKinds: readonly string[];
}

/** A snapshot point, from `football.snapshot_point`. */
export interface SnapshotPoint {
  readonly code: string;
  /** Seconds before kickoff. Derived from the stored interval, never assumed. */
  readonly offsetSeconds: number;
  readonly isCanonical: boolean;
}

/** One declared feature → feature edge. */
export interface DependencyEdge {
  readonly consumerFeatureKey: string;
  readonly consumedFeatureKey: string;
  readonly consumerContextKindCode: string;
  readonly consumedContextKindCode: string;
}

/** Everything S-5 needs to know, loaded once per run. */
export interface Registry {
  readonly definitionsByKey: ReadonlyMap<string, FeatureDefinition>;
  readonly snapshotPoints: readonly SnapshotPoint[];
  readonly dependencies: readonly DependencyEdge[];
  /** Provenance class strength ranks, for the weakest-input rule (LC-37). */
  readonly provenanceRankByCode: ReadonlyMap<string, number>;
}

/**
 * Loads every registry row S-5 reads.
 *
 * Runs as `pt_pipeline_feature`, which holds SELECT on `feature` and `football`.
 * Read-only throughout — this module issues no INSERT and no UPDATE, and the
 * role holds no UPDATE on the registry in any case.
 */
export async function loadRegistry(tx: PoolClient): Promise<Registry> {
  const [definitions, snapshotPoints, dependencies, provenance] = [
    await loadDefinitions(tx),
    await loadSnapshotPoints(tx),
    await loadDependencies(tx),
    await loadProvenanceRanks(tx),
  ];

  return {
    definitionsByKey: definitions,
    snapshotPoints,
    dependencies,
    provenanceRankByCode: provenance,
  };
}

async function loadDefinitions(tx: PoolClient): Promise<Map<string, FeatureDefinition>> {
  // The version join takes the OPEN period — see the header. A definition with
  // no open version is a registry state S-5 cannot write against, and the
  // reconciliation below turns that into a clear failure rather than a silently
  // absent feature.
  const { rows } = await tx.query<{
    id: string;
    feature_key: string;
    subject_kind_code: string;
    unit: string;
    value_scale: number;
    direction: string;
    max_provenance_class_code: string;
    meaningful_sample_threshold: number;
    is_active: boolean;
    calculator_id: string;
    calculator_key: string;
    version_id: string | null;
    version_designation: string | null;
    context_kinds: string[];
  }>(
    `SELECT d.id::text,
            d.feature_key,
            d.subject_kind_code,
            d.unit,
            d.value_scale,
            d.direction,
            d.max_provenance_class_code,
            d.meaningful_sample_threshold,
            d.is_active,
            c.id::text  AS calculator_id,
            c.calculator_key,
            v.id::text  AS version_id,
            v.designation AS version_designation,
            COALESCE(
              (SELECT array_agg(k.context_kind_code ORDER BY k.context_kind_code)
                 FROM feature.feature_definition_context_kind k
                WHERE k.feature_definition_id = d.id),
              ARRAY[]::text[]
            ) AS context_kinds
       FROM feature.feature_definition d
       JOIN feature.feature_calculator c ON c.id = d.feature_calculator_id
       LEFT JOIN feature.feature_version v
              ON v.feature_definition_id = d.id
             AND upper_inf(v.effective_period)
      ORDER BY d.feature_key`
  );

  const byKey = new Map<string, FeatureDefinition>();
  for (const row of rows) {
    if (row.version_id === null) {
      throw new Error(
        `feature '${row.feature_key}' has no version with an open effective period. ` +
          'S-5 attributes every value to the version in force at calculation time, ' +
          'and cannot proceed without one.'
      );
    }
    byKey.set(row.feature_key, {
      id: row.id,
      featureKey: row.feature_key,
      subjectKindCode: row.subject_kind_code,
      unit: row.unit,
      valueScale: row.value_scale,
      direction: row.direction as FeatureDefinition['direction'],
      maxProvenanceClassCode: row.max_provenance_class_code,
      meaningfulSampleThreshold: row.meaningful_sample_threshold,
      isActive: row.is_active,
      calculatorId: row.calculator_id,
      calculatorKey: row.calculator_key,
      versionId: row.version_id,
      versionDesignation: row.version_designation as string,
      contextKinds: row.context_kinds,
    });
  }
  return byKey;
}

/**
 * Loads the snapshot points and their offsets.
 *
 * THE OFFSETS ARE READ, NEVER WRITTEN INTO SOURCE. The point set is an open
 * decision (Phase 4 D8) carrying a TODO in migration 002; four offsets hard-coded
 * here would silently diverge the moment the vocabulary changed, and every
 * `as_of` in the system derives from them.
 *
 * `offset_before_kick` is an interval. It is converted to whole seconds in
 * PostgreSQL by `EXTRACT(EPOCH …)` rather than parsed from an interval string,
 * because interval formatting is locale- and setting-dependent and the epoch is
 * not.
 */
async function loadSnapshotPoints(tx: PoolClient): Promise<SnapshotPoint[]> {
  const { rows } = await tx.query<{ code: string; offset_seconds: string; is_canonical: boolean }>(
    `SELECT code,
            EXTRACT(EPOCH FROM offset_before_kick)::bigint::text AS offset_seconds,
            is_canonical
       FROM football.snapshot_point
      WHERE effective_to IS NULL
      ORDER BY offset_before_kick DESC, code`
  );
  return rows.map((row) => ({
    code: row.code,
    offsetSeconds: Number(row.offset_seconds),
    isCanonical: row.is_canonical,
  }));
}

/**
 * Loads the declared feature → feature edges.
 *
 * EXECUTION ORDER IS DERIVED FROM THESE (§B.8, §5.12.2). An empty result is
 * legitimate before `declare.ts` has run: it means every calculator is
 * independent, which the topological sort handles without special-casing.
 */
async function loadDependencies(tx: PoolClient): Promise<DependencyEdge[]> {
  const { rows } = await tx.query<{
    consumer_key: string;
    consumed_key: string;
    consumer_context: string;
    consumed_context: string;
  }>(
    `SELECT consumer.feature_key AS consumer_key,
            consumed.feature_key AS consumed_key,
            dep.consumer_context_kind_code AS consumer_context,
            dep.consumed_context_kind_code AS consumed_context
       FROM feature.feature_dependency dep
       JOIN feature.feature_definition consumer ON consumer.id = dep.consumer_definition_id
       JOIN feature.feature_definition consumed ON consumed.id = dep.consumed_definition_id
      ORDER BY consumer.feature_key, consumed.feature_key, dep.consumed_context_kind_code`
  );
  return rows.map((row) => ({
    consumerFeatureKey: row.consumer_key,
    consumedFeatureKey: row.consumed_key,
    consumerContextKindCode: row.consumer_context,
    consumedContextKindCode: row.consumed_context,
  }));
}

/**
 * Provenance class strength ranks.
 *
 * ESTIMATED=1 < INFERRED=2 < DERIVED=3 < OBSERVED=4. Read rather than assumed,
 * for the same reason as the snapshot offsets: the ordering is data.
 */
async function loadProvenanceRanks(tx: PoolClient): Promise<Map<string, number>> {
  const { rows } = await tx.query<{ code: string; strength_rank: number }>(
    `SELECT code, strength_rank FROM football.provenance_class ORDER BY strength_rank`
  );
  return new Map(rows.map((row) => [row.code, row.strength_rank]));
}

/**
 * Proves the implemented calculators and the registry agree.
 *
 * Three ways they can disagree, each of which produces wrong data silently and
 * is therefore refused loudly at startup instead:
 *
 *   1. A calculator claims a feature the registry does not hold — values would
 *      be written under a definition nobody governs.
 *   2. A claimed feature's registered calculator is a different one — LC-28
 *      states exactly one calculator owns a definition, and two writers for one
 *      feature is the ownership failure V2 exists to remove.
 *   3. A claimed feature is inactive — calculating a retired definition.
 *
 * DELIBERATELY NOT CHECKED: registered features with no implementation. That is
 * the normal, approved state of `team.squad_stability` (R-1), which stays
 * registered and produces nothing.
 */
export function assertCalculatorCoverage(
  registry: Registry,
  claims: ReadonlyMap<string, readonly string[]>
): void {
  const problems: string[] = [];

  for (const [calculatorKey, featureKeys] of claims) {
    for (const featureKey of featureKeys) {
      const definition = registry.definitionsByKey.get(featureKey);
      if (!definition) {
        problems.push(`calculator '${calculatorKey}' claims '${featureKey}', which is not registered`);
        continue;
      }
      if (definition.calculatorKey !== calculatorKey) {
        problems.push(
          `'${featureKey}' is registered to calculator '${definition.calculatorKey}' but claimed by ` +
            `'${calculatorKey}'. LC-28: exactly one calculator owns a definition.`
        );
      }
      if (!definition.isActive) {
        problems.push(`'${featureKey}' is registered inactive and must not be calculated`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`registry and implementation disagree:\n  - ${problems.join('\n  - ')}`);
  }
}
