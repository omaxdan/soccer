// ─────────────────────────────────────────────────────────────────────────────
// THE FEATURE PIPELINE
//
//   driver → eligible (fixture, snapshot point) pairs → team subjects
//     → Stage 1 (order derived) → commit
//     → Stage 2 → commit
//     → telemetry
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE TRANSACTION PER (CALCULATOR × SUBJECT BATCH)
//
// Not one per stage, and not one per value.
//
// Per value would make a value and its lineage separately committable, and a
// value whose lineage failed to commit is a value nobody can reproduce.
//
// Per stage would hold one transaction across the whole subject population,
// taking locks for its entire duration and losing every good batch to one bad
// subject.
//
// Within a transaction the order is forced by the foreign key: VALUES, then
// LINEAGE. A batch that fails rolls back entirely and the run continues — a
// half-written batch is worse than an absent one, because the next attempt would
// find some values present, skip them, and leave the result permanently partial
// under append-only.
//
// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 CANNOT BEGIN UNTIL STAGE 1 HAS COMMITTED
//
// Its inputs are read through `feature_value` on a different connection, and an
// uncommitted row is invisible from another connection however recently it was
// written. The stage loop is therefore sequential over `plan.stages`, and each
// stage's transactions have all committed before the next reads.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION ORDER IS DERIVED (§B.8), NEVER WRITTEN DOWN
//
// This file contains no ordered list of calculators. `deriveExecutionPlan` reads
// `feature_dependency` and returns the stages. Declaring a new edge changes the
// order by being declared — which mutation test 5 proves by inserting one and
// watching a calculator move between stages.
//
// ─────────────────────────────────────────────────────────────────────────────
// TELEMETRY: EVERY STAGE ATTRIBUTED, EVERY RELATION REPORTED
//
// `pt_pipeline_feature` holds SELECT and INSERT on `operations`, so unlike
// `pt_platform_admin` under finding S3-1 there is no unattributed path here.
//
// `write_record` is written PER RELATION, so a relation that received nothing is
// legible: "A job completing successfully while writing nothing is among the
// most dangerous states in a precompute platform and is invisible without this
// record."
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection, withRun } from '../db/tx';
import { withPipelineRun, operationalNow } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { recordWrite } from '../operations/writeRecord';
import { buildDiagnostic } from '../operations/failure';
import { assertRolesConfigured } from '../config/index';
import { loadRegistry, assertCalculatorCoverage, type Registry } from './registry/load';
import { declareRegistryInputs } from './registry/declare';
import { deriveExecutionPlan, featuresOfCalculator, type ExecutionPlan } from './registry/order';
import { selectBatches, type EligibilityOptions, type SubjectBatch } from './driver/eligibility';
import { readCompletedFixtures } from './read/fixtures';
import { readHomeVenues, readVenueLocations } from './read/venues';
import { readPriorValues } from './read/featureValues';
import { writeValues } from './write/values';
import { writeLineage } from './write/lineage';
import {
  CALCULATION_CONTEXT_KIND,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type SubjectMoment,
} from './calculators/types';
import { formBackfill } from './calculators/formBackfill';
import { fixtureLoad } from './calculators/fixtureLoad';
import { travelLoad } from './calculators/travelLoad';
import { teamReadiness } from './calculators/teamReadiness';
import { logger } from '../../utils/logger';

/** The only role S-5 authenticates as. */
export const FEATURE_ROLE = 'pt_pipeline_feature' as const;

/**
 * The implemented calculators.
 *
 * NOT AN EXECUTION ORDER — a set. The order comes from `feature_dependency`.
 * `squad_continuity` is deliberately absent (R-1): `team.squad_stability` stays
 * registered and is never calculated, because its registered meaning is
 * selection continuity and the lineup data that would measure it is not
 * ingested.
 */
export const CALCULATORS: readonly Calculator[] = [
  formBackfill,
  fixtureLoad,
  travelLoad,
  teamReadiness,
];

export interface FeatureRunOptions extends EligibilityOptions {
  /** Compute and report without writing. Opens no transaction that persists. */
  readonly dryRun?: boolean;
  /** Declare sources and dependencies before calculating. On by default. */
  readonly declare?: boolean;
  /** Overrides the run clock. Tests supply it; production does not. */
  readonly now?: Date;
}

export interface RelationCounts {
  examined: number;
  written: number;
  skipped: number;
  rejected: number;
}

export interface FeatureRunReport {
  readonly batches: number;
  readonly stages: readonly (readonly string[])[];
  readonly sequence: readonly string[];
  readonly counts: ReadonlyMap<string, RelationCounts>;
  readonly failures: number;
  readonly dryRun: boolean;
}

function emptyCounts(): RelationCounts {
  return { examined: 0, written: 0, skipped: 0, rejected: 0 };
}

function accumulate(into: Map<string, RelationCounts>, relation: string, delta: Partial<RelationCounts>): void {
  const current = into.get(relation) ?? emptyCounts();
  current.examined += delta.examined ?? 0;
  current.written += delta.written ?? 0;
  current.skipped += delta.skipped ?? 0;
  current.rejected += delta.rejected ?? 0;
  into.set(relation, current);
}

/**
 * Runs the feature pipeline.
 *
 * The run clock is captured ONCE and passed down, so every eligibility decision
 * in one run is judged against the same instant. A clock read per batch could
 * make a pair eligible halfway through a run and produce a result that depends
 * on how long the run took.
 */
export async function runFeaturePipeline(options: FeatureRunOptions = {}): Promise<FeatureRunReport> {
  assertRolesConfigured([FEATURE_ROLE]);
  installOperationalLayer();

  const now = options.now ?? new Date();
  const counts = new Map<string, RelationCounts>();
  let failures = 0;

  // Registry and plan are loaded once, outside the write transactions. The
  // registry is "modified rarely and under governance", so a concurrent change
  // mid-run is not a case S-5 tries to detect — it is a case S-5 states it does
  // not handle.
  const { registry, plan, batches } = await withConnection(FEATURE_ROLE, async (tx) => {
    const loaded = await loadRegistry(tx);
    assertCalculatorCoverage(
      loaded,
      new Map(CALCULATORS.map((calculator) => [calculator.calculatorKey, calculator.featureKeys]))
    );
    const derived = deriveExecutionPlan(
      loaded,
      CALCULATORS.map((calculator) => calculator.calculatorKey)
    );
    const selected = await selectBatches(tx, loaded, now, options);
    return { registry: loaded, plan: derived, batches: selected };
  });

  logger.info(
    {
      batches: batches.length,
      stages: plan.stages.map((stage) => stage.calculatorKeys),
      dryRun: options.dryRun === true,
    },
    'v2 feature: plan derived'
  );

  if (options.declare !== false && options.dryRun !== true) {
    const declared = await withRun(FEATURE_ROLE, 'feature.declare', (tx) =>
      declareRegistryInputs(tx, registry)
    );
    accumulate(counts, 'feature.feature_source', {
      examined: declared.sourcesExamined,
      written: declared.sourcesWritten,
      skipped: declared.sourcesExamined - declared.sourcesWritten,
    });
    accumulate(counts, 'feature.feature_dependency', {
      examined: declared.dependenciesExamined,
      written: declared.dependenciesWritten,
      skipped: declared.dependenciesExamined - declared.dependenciesWritten,
    });
  }

  const byKey = new Map(CALCULATORS.map((calculator) => [calculator.calculatorKey, calculator]));

  await withPipelineRun(FEATURE_ROLE, 'v2.feature.calculate', async () => {
    // Stages strictly in sequence. Stage N+1 reads what stage N committed.
    for (const stage of plan.stages) {
      // D-5: SEQUENTIAL within a stage. `pt_pipeline_feature` has a pool maximum
      // of 4 and an attributed run holds 2, so four concurrent calculators would
      // need eight and would BLOCK rather than fail. Parallelise only once §7
      // timing evidence exists.
      for (const calculatorKey of stage.calculatorKeys) {
        const calculator = byKey.get(calculatorKey);
        if (!calculator) continue;

        for (const batch of batches) {
          try {
            const result = await runBatch(registry, calculator, batch, options.dryRun === true);
            for (const [relation, delta] of result) accumulate(counts, relation, delta);
          } catch (error) {
            failures += 1;
            logger.error(
              { calculatorKey, asOf: batch.asOf.toISOString(), error: buildDiagnostic(error) },
              'v2 feature: batch failed, continuing'
            );
          }
        }
      }
    }
  });

  return {
    batches: batches.length,
    stages: plan.stages.map((stage) => stage.calculatorKeys),
    sequence: plan.sequence,
    counts,
    failures,
    dryRun: options.dryRun === true,
  };
}

/**
 * One (calculator × subject batch) transaction.
 *
 * Reads happen inside the same transaction as the writes so the inputs and the
 * outputs describe one consistent snapshot of the database. A read outside it
 * could see a fixture that a concurrent ingestion had not yet committed when the
 * write ran, and the resulting value would describe a state that never existed
 * as a whole.
 */
async function runBatch(
  registry: Registry,
  calculator: Calculator,
  batch: SubjectBatch,
  dryRun: boolean
): Promise<Map<string, RelationCounts>> {
  const relationCounts = new Map<string, RelationCounts>();

  const candidates = await withRun(
    FEATURE_ROLE,
    `feature.${calculator.calculatorKey}`,
    async (tx: PoolClient, job) => {
      const context = await buildContext(tx, registry, calculator, batch);
      const produced = calculator.calculate(context);

      if (dryRun) {
        accumulate(relationCounts, 'feature.feature_value', {
          examined: produced.length,
          skipped: produced.length,
        });
        return produced;
      }

      // calculated_at supplied once for the whole batch, from the operational
      // clock — the only current-time value in the write path.
      const calculatedAt = operationalNow();
      const valueResult = await writeValues(tx, registry, produced, calculatedAt);
      accumulate(relationCounts, 'feature.feature_value', {
        examined: valueResult.examined,
        written: valueResult.written,
        skipped: valueResult.skipped,
      });

      // Lineage AFTER values, in the same transaction — forced by
      // fk_feature_lineage__produced_value.
      const lineageResult = await writeLineage(tx, valueResult.writtenValues);
      accumulate(relationCounts, 'feature.feature_lineage', {
        examined: lineageResult.examined,
        written: lineageResult.written,
        skipped: lineageResult.skipped,
      });

      // Telemetry on the CONTROL connection, outside this transaction, so a
      // record of what a batch did survives a rollback of the batch.
      await reportWrites(job, relationCounts);
      return produced;
    },
    { detail: { calculator: calculator.calculatorKey, asOf: batch.asOf.toISOString() } }
  );

  logger.debug(
    { calculator: calculator.calculatorKey, asOf: batch.asOf.toISOString(), candidates: candidates.length },
    'v2 feature: batch complete'
  );
  return relationCounts;
}

/**
 * Assembles everything the calculator may read.
 *
 * Stage 2's `priorValues` are loaded only for the features actually declared as
 * dependencies — read from the registry, not from a list here, so a new edge
 * changes what is loaded without an edit.
 */
async function buildContext(
  tx: PoolClient,
  registry: Registry,
  calculator: Calculator,
  batch: SubjectBatch
): Promise<CalculationContext> {
  const subjects: SubjectMoment[] = batch.teamIds.map((teamId) => ({ teamId, asOf: batch.asOf }));

  const fixturesByTeam = await readCompletedFixtures(tx, batch.teamIds, batch.asOf);
  const homeVenueByTeam = await readHomeVenues(tx, batch.teamIds);

  const venueIds = new Set<string>();
  for (const venueId of homeVenueByTeam.values()) if (venueId) venueIds.add(venueId);
  for (const history of fixturesByTeam.values()) {
    for (const fixture of history.fixtures) if (fixture.venueId) venueIds.add(fixture.venueId);
  }
  const venuesById = await readVenueLocations(tx, [...venueIds].sort());

  const consumedKeys = consumedFeatureKeys(registry, calculator);
  const priorValues =
    consumedKeys.length > 0
      ? await readPriorValues(tx, consumedKeys, batch.teamIds, batch.asOf, CALCULATION_CONTEXT_KIND)
      : new Map();

  return {
    definitions: registry.definitionsByKey,
    subjects,
    fixturesByTeam,
    homeVenueByTeam,
    venuesById,
    priorValues,
  };
}

/** The features this calculator's own features consume, per the declared graph. */
function consumedFeatureKeys(registry: Registry, calculator: Calculator): string[] {
  const owned = new Set(featuresOfCalculator(registry, calculator.calculatorKey).map((d) => d.featureKey));
  const consumed = new Set<string>();
  for (const edge of registry.dependencies) {
    if (owned.has(edge.consumerFeatureKey)) consumed.add(edge.consumedFeatureKey);
  }
  return [...consumed].sort();
}

/** One `operations.write_record` per relation touched. */
async function reportWrites(
  job: Parameters<typeof recordWrite>[1],
  relationCounts: ReadonlyMap<string, RelationCounts>
): Promise<void> {
  await withConnection(FEATURE_ROLE, async (control) => {
    for (const [relation, counts] of [...relationCounts].sort()) {
      const [schema, name] = relation.split('.');
      await recordWrite(control, job, { schema, relation: name }, {
        rowsExamined: counts.examined,
        rowsWritten: counts.written,
        rowsSkipped: counts.skipped,
        rowsRejected: counts.rejected,
      });
    }
  });
}

/** Re-exported so the CLI and tests do not reach into the module graph. */
export type { ExecutionPlan, SubjectBatch };
