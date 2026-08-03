// ─────────────────────────────────────────────────────────────────────────────
// TYPE-LEVEL DECLARATIONS — feature_source and feature_dependency
//
// The two registry relations S-3 deferred: "Not knowable until the calculators
// exist, which is S-5." They exist now, so their inputs are declarable.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONLY REGISTRY WRITE IN S-5, AND IT IS ADDITIVE
//
// `INSERT … ON CONFLICT ON CONSTRAINT … DO NOTHING`. There is no update path and
// no delete path here, and `pt_pipeline_feature` holds no UPDATE or DELETE on
// schema `feature` to add one.
//
// `feature_definition`, `feature_version` and `feature_calculator` are NEVER
// written — not by this module, not by any other. They are S-3's, amended only
// through governance.
//
// ─────────────────────────────────────────────────────────────────────────────
// SOURCE vs DEPENDENCY
//
// "A SOURCE is a reality entity a feature reads; a DEPENDENCY is another feature
// it consumes. Conflating them makes the layer boundary unauditable."
//
// `ck_feature_source__layer_one_only` enforces `source_schema_name = 'football'`,
// so a source cannot be anything but Layer 1. The declarations below are what
// makes freshness derivable rather than hand-maintained — "a fatigue feature
// sourcing from appearances is stale whenever appearance ingestion has not run,
// and nobody maintains that relationship separately."
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO FEATURES DECLARE NO SOURCE, FOR DIFFERENT REASONS
//
//   team.readiness_score   A PURE COMPOSITE. Under the final ADR it consumes
//                          exactly two features and reads no Layer 1 relation,
//                          so it has no source to declare. Its inputs are
//                          dependencies, which is the distinction above.
//
//   team.squad_stability   NEVER CALCULATED (R-1). Declaring a source for a
//                          calculation that does not exist would assert a
//                          dependency nobody has — the same reason it gets no
//                          calculator.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { Registry } from './load';
import { CALCULATION_CONTEXT_KIND } from '../calculators/types';

/**
 * The Layer 1 relations each calculator reads.
 *
 * Maintained ALONGSIDE the calculators and proven against them by test: a
 * declaration that drifted from what a calculator actually reads would make
 * freshness report on the wrong relation, which is worse than not reporting.
 *
 * `team.squad_stability` is absent and must stay absent.
 */
export const FEATURE_SOURCES: Readonly<Record<string, readonly string[]>> = {
  // Result quality over completed fixtures — the fixture for the participation
  // and the result for the score.
  'team.home_form': ['fixture', 'result'],
  'team.away_form': ['fixture', 'result'],
  // Kickoff instants only. No result is read: rest is arithmetic over when a
  // side played, not how it did.
  'team.rest_advantage': ['fixture'],
  'team.congestion_index': ['fixture'],
  // Distance needs the fixture's venue, the team's home venue, and the
  // coordinates of both.
  'team.travel_impact': ['fixture', 'venue', 'team'],
};

/** Feature → feature edges. The consumer, and what it consumes. */
export const FEATURE_DEPENDENCIES: readonly {
  readonly consumer: string;
  readonly consumed: string;
}[] = [
  { consumer: 'team.readiness_score', consumed: 'team.rest_advantage' },
  { consumer: 'team.readiness_score', consumed: 'team.congestion_index' },
];

export interface DeclarationResult {
  readonly sourcesExamined: number;
  readonly sourcesWritten: number;
  readonly dependenciesExamined: number;
  readonly dependenciesWritten: number;
}

/**
 * Declares sources and dependencies for the current versions.
 *
 * Idempotent: a second run writes nothing. Both relations key on the CONSUMER
 * VERSION, so a new feature version declares its own inputs rather than
 * inheriting its predecessor's — which is the point, since a version exists
 * precisely because the rule changed and the inputs may have changed with it.
 */
export async function declareRegistryInputs(
  tx: PoolClient,
  registry: Registry
): Promise<DeclarationResult> {
  const sources = await declareSources(tx, registry);
  const dependencies = await declareDependencies(tx, registry);
  return { ...sources, ...dependencies };
}

async function declareSources(
  tx: PoolClient,
  registry: Registry
): Promise<Pick<DeclarationResult, 'sourcesExamined' | 'sourcesWritten'>> {
  const parameters: unknown[] = [];
  const tuples: string[] = [];

  // Sorted so the statement is identical between runs.
  for (const featureKey of Object.keys(FEATURE_SOURCES).sort()) {
    const definition = registry.definitionsByKey.get(featureKey);
    if (!definition) {
      throw new Error(
        `cannot declare sources for '${featureKey}': it is not registered. ` +
          'The declaration list and the registry must agree.'
      );
    }
    for (const relation of [...FEATURE_SOURCES[featureKey]].sort()) {
      const base = parameters.length;
      parameters.push(definition.id, definition.versionId, relation);
      tuples.push(`($${base + 1}::bigint, $${base + 2}::bigint, 'football', $${base + 3})`);
    }
  }

  if (tuples.length === 0) return { sourcesExamined: 0, sourcesWritten: 0 };

  const { rowCount } = await tx.query(
    `INSERT INTO feature.feature_source
       (feature_definition_id, feature_version_id, source_schema_name, source_relation_name)
     VALUES ${tuples.join(', ')}
     ON CONFLICT ON CONSTRAINT uq_feature_source__version_relation DO NOTHING`,
    parameters
  );

  return { sourcesExamined: tuples.length, sourcesWritten: rowCount ?? 0 };
}

async function declareDependencies(
  tx: PoolClient,
  registry: Registry
): Promise<Pick<DeclarationResult, 'dependenciesExamined' | 'dependenciesWritten'>> {
  const parameters: unknown[] = [];
  const tuples: string[] = [];

  const ordered = [...FEATURE_DEPENDENCIES].sort((a, b) =>
    a.consumer !== b.consumer
      ? a.consumer < b.consumer
        ? -1
        : 1
      : a.consumed < b.consumed
        ? -1
        : a.consumed > b.consumed
          ? 1
          : 0
  );

  for (const edge of ordered) {
    const consumer = registry.definitionsByKey.get(edge.consumer);
    const consumed = registry.definitionsByKey.get(edge.consumed);
    if (!consumer || !consumed) {
      throw new Error(
        `cannot declare dependency '${edge.consumer}' -> '${edge.consumed}': ` +
          'one of them is not registered.'
      );
    }
    const base = parameters.length;
    parameters.push(consumer.id, consumer.versionId, consumed.id);
    tuples.push(
      `($${base + 1}::bigint, $${base + 2}::bigint, $${base + 3}::bigint, ` +
        `'${CALCULATION_CONTEXT_KIND}', '${CALCULATION_CONTEXT_KIND}')`
    );
  }

  if (tuples.length === 0) return { dependenciesExamined: 0, dependenciesWritten: 0 };

  // LC-45: the context MAPPING is part of the declaration, not an assumption
  // inside the calculator. Both sides are ALL_COMPETITIONS under D-3.
  const { rowCount } = await tx.query(
    `INSERT INTO feature.feature_dependency
       (consumer_definition_id, consumer_version_id, consumed_definition_id,
        consumer_context_kind_code, consumed_context_kind_code)
     VALUES ${tuples.join(', ')}
     ON CONFLICT ON CONSTRAINT uq_feature_dependency__consumer_version_consumed DO NOTHING`,
    parameters
  );

  return { dependenciesExamined: tuples.length, dependenciesWritten: rowCount ?? 0 };
}
