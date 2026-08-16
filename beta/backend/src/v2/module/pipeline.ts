// ─────────────────────────────────────────────────────────────────────────────
// THE S-6 MODULE ENGINE
//
//   driver → (team, edition, as_of) subjects → per module:
//     resolve version → read declared feature inputs → assemble reading
//       (SUPPORTS / NEUTRAL / CONTRADICTS, or INACTIVE when an input is absent)
//     → write reading + evidence + items → telemetry
//
// REUSABLE, NOT SPECIAL-CASED. The engine holds no module logic: a module is a
// pure `ModuleCalculator` reconciled against the registry, exactly as S-5 treats
// feature calculators. `home_away_split` is merely the first entry in
// `MODULE_CALCULATORS`.
//
// ONE TRANSACTION PER (MODULE × BATCH), reads and writes together — the S-5
// discipline one layer up. Reading, evidence and items are written in that one
// transaction; a batch failure is isolated and the run continues.
//
// SCOPE (frozen, S-6): strength/confidence NULL at 1.0.0 (D-5a/b); sample =
// MIN(consumed) (D-5c-i); no published_baseline (S-9); INACTIVE is silent and
// carries a reason; NO VALUE is never a zero.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection, withRun } from '../db/tx';
import { withPipelineRun, operationalNow } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { recordWrite } from '../operations/writeRecord';
import { buildDiagnostic } from '../operations/failure';
import { assertDatabaseConfigured } from '../config/index';
import { loadRegistry } from '../feature/registry/load';
import {
  selectScopedBatches,
  type EligibilityOptions,
  type ScopedSubjectBatch,
} from '../feature/driver/eligibility';
import { MODULE_STATUS, type ConsumedFeature, type ModuleCalculator } from './types';
import {
  loadModuleRegistry,
  resolveModuleVersion,
  type ModuleDefinition,
  type ModuleRegistry,
  type ModuleVersion,
} from './registry/load';
import { consumedKey, readConsumedFeatures } from './read/consumedFeatures';
import { writeReading, type ReadingToWrite } from './write/readings';
import { homeAwaySplit } from './calculators/homeAwaySplit';
import { logger } from '../../utils/logger';

/** The only role S-6 authenticates as. */
export const MODULE_ROLE = 'pt_pipeline_module' as const;

/** Absence of a declared input, recorded as the reason an INACTIVE reading was silent. */
export const INACTIVE_REASON_FEATURE_ABSENT = 'FEATURE_ABSENT';

/**
 * The implemented modules. NOT an execution order — a set. `home_away_split` is
 * the only one implemented; the other twelve stay registered and unproduced.
 */
export const MODULE_CALCULATORS: readonly ModuleCalculator[] = [homeAwaySplit];

export interface ModuleRunOptions extends EligibilityOptions {
  readonly dryRun?: boolean;
  readonly now?: Date;
  /** Test seam: override the module set. Production omits it. */
  readonly calculators?: readonly ModuleCalculator[];
}

export interface RelationCounts {
  examined: number;
  written: number;
  skipped: number;
  rejected: number;
}

export interface ModuleRunReport {
  readonly batches: number;
  readonly modules: readonly string[];
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
 * Assembles the reading for one team from its resolved inputs — PURE.
 *
 * If any declared input is absent the reading is INACTIVE: silent (no strength,
 * no baseline), carrying `inactive_reason = FEATURE_ABSENT`, sample count 0,
 * threshold not met, and NO evidence items (there was no finding to which a
 * feature could have contributed). The completeness counts still record what was
 * present, so the absence is legible (LC-62/LC-69). Otherwise the calculator
 * speaks and the sample count is `MIN(consumed)` (D-5c-i).
 */
export function assembleReading(params: {
  readonly calculator: ModuleCalculator;
  readonly definition: ModuleDefinition;
  readonly version: ModuleVersion;
  readonly asOf: Date;
  readonly competitionEditionId: string;
  readonly teamId: string;
  readonly inputs: ReadonlyMap<string, ConsumedFeature>;
}): Omit<ReadingToWrite, 'calculatedAt'> {
  const { calculator, definition, version, asOf, competitionEditionId, teamId, inputs } = params;
  const declaredInputCount = calculator.inputFeatureKeys.length;
  const presentInputCount = calculator.inputFeatureKeys.filter((k) => inputs.has(k)).length;

  const base = {
    moduleDefinitionId: definition.moduleDefinitionId,
    moduleVersionId: version.moduleVersionId,
    subjectTeamId: teamId,
    asOf,
    contextEditionId: competitionEditionId,
    declaredInputCount,
    presentInputCount,
    belowThresholdInputCount: 0,
    estimatedInputCount: 0,
  };

  if (presentInputCount < declaredInputCount) {
    // INACTIVE — insufficient data to speak. Never NEUTRAL, never a zero value.
    return {
      ...base,
      statusCode: MODULE_STATUS.INACTIVE,
      verdictText: null,
      inactiveReason: INACTIVE_REASON_FEATURE_ABSENT,
      sampleObservationCount: 0,
      sampleMeetsThreshold: false,
      evidenceItems: [],
    };
  }

  const finding = calculator.evaluate(inputs);
  let sampleObservationCount = Number.POSITIVE_INFINITY;
  for (const key of calculator.inputFeatureKeys) {
    sampleObservationCount = Math.min(sampleObservationCount, inputs.get(key)!.sampleObservationCount);
  }

  return {
    ...base,
    statusCode: finding.status,
    verdictText: finding.verdictText,
    inactiveReason: null,
    sampleObservationCount,
    sampleMeetsThreshold: sampleObservationCount >= version.minimumSampleObservationCount,
    evidenceItems: calculator.inputFeatureKeys.map((key) => {
      const consumed = inputs.get(key)!;
      return {
        citedFeatureValueId: consumed.valueId,
        citedFeatureValueAsOf: consumed.asOf,
        // Each cited input carries the finding's direction. home_away_split emits
        // only SUPPORTS/NEUTRAL; CONTRADICTS is available for future modules.
        contributionDirection: finding.status,
      };
    }),
  };
}

/**
 * Runs the module engine.
 *
 * The clock is captured once and passed down, so one instant governs the whole
 * run (the S-5 rule). Registry and batches load once outside the write
 * transactions.
 */
export async function runModulePipeline(options: ModuleRunOptions = {}): Promise<ModuleRunReport> {
  assertDatabaseConfigured();
  installOperationalLayer();

  const now = options.now ?? new Date();
  const calculators = options.calculators ?? MODULE_CALCULATORS;
  const counts = new Map<string, RelationCounts>();
  let failures = 0;

  const { moduleRegistry, batches } = await withConnection(MODULE_ROLE, async (tx) => {
    const featureRegistry = await loadRegistry(tx); // snapshot points for enumeration
    const modules = await loadModuleRegistry(tx);
    // Reconcile: a calculator must name a registered module (LC-28-style).
    for (const calculator of calculators) {
      const definition = modules.definitionsByKey.get(calculator.moduleKey);
      if (!definition) {
        throw new Error(
          `module calculator '${calculator.moduleKey}' is not a registered module. ` +
            'Every reading must be attributable to a governed module.'
        );
      }
    }
    const selected = await selectScopedBatches(tx, featureRegistry, now, options);
    return { moduleRegistry: modules, batches: selected };
  });

  logger.info(
    { batches: batches.length, modules: calculators.map((c) => c.moduleKey), dryRun: options.dryRun === true },
    'v2 module: plan loaded'
  );

  await withPipelineRun(MODULE_ROLE, 'v2.module.generate', async () => {
    for (const calculator of calculators) {
      const definition = moduleRegistry.definitionsByKey.get(calculator.moduleKey)!;
      if (!definition.isActive) continue; // registered inactive → not produced

      for (const batch of batches) {
        try {
          const result = await runModuleBatch(calculator, definition, batch, options.dryRun === true);
          for (const [relation, delta] of result) accumulate(counts, relation, delta);
        } catch (error) {
          failures += 1;
          logger.error(
            {
              moduleKey: calculator.moduleKey,
              asOf: batch.asOf.toISOString(),
              competitionEditionId: batch.competitionEditionId,
              error: buildDiagnostic(error),
            },
            'v2 module: batch failed, continuing'
          );
        }
      }
    }
  });

  return {
    batches: batches.length,
    modules: calculators.map((c) => c.moduleKey),
    counts,
    failures,
    dryRun: options.dryRun === true,
  };
}

/** One (module × scoped batch) transaction. */
async function runModuleBatch(
  calculator: ModuleCalculator,
  definition: ModuleDefinition,
  batch: ScopedSubjectBatch,
  dryRun: boolean
): Promise<Map<string, RelationCounts>> {
  const relationCounts = new Map<string, RelationCounts>();

  await withRun(
    MODULE_ROLE,
    `module.${calculator.moduleKey}`,
    async (tx: PoolClient, job) => {
      const version = await resolveModuleVersion(tx, definition.moduleDefinitionId, batch.asOf);
      if (!version) {
        logger.warn(
          { moduleKey: calculator.moduleKey, asOf: batch.asOf.toISOString() },
          'v2 module: no version covers as_of, skipping'
        );
        return;
      }

      const consumed = await readConsumedFeatures(
        tx,
        calculator.inputFeatureKeys,
        batch.teamIds,
        batch.asOf,
        batch.competitionEditionId
      );

      const readings = batch.teamIds.map((teamId) => {
        const inputs = new Map<string, ConsumedFeature>();
        for (const key of calculator.inputFeatureKeys) {
          const value = consumed.get(consumedKey(key, teamId));
          if (value) inputs.set(key, value);
        }
        return assembleReading({
          calculator,
          definition,
          version,
          asOf: batch.asOf,
          competitionEditionId: batch.competitionEditionId,
          teamId,
          inputs,
        });
      });

      if (dryRun) {
        accumulate(relationCounts, 'module.module_reading', {
          examined: readings.length,
          skipped: readings.length,
        });
        return;
      }

      const calculatedAt = operationalNow();
      for (const reading of readings) {
        const result = await writeReading(tx, { ...reading, calculatedAt });
        accumulate(relationCounts, 'module.module_reading', {
          examined: 1,
          written: result.written,
          skipped: result.skipped,
        });
        if (result.written === 1) {
          accumulate(relationCounts, 'module.module_evidence', { examined: 1, written: 1 });
          accumulate(relationCounts, 'module.module_evidence_item', {
            examined: reading.evidenceItems.length,
            written: reading.evidenceItems.length,
          });
        }
      }

      await reportWrites(job, relationCounts);
    },
    {
      detail: {
        module: calculator.moduleKey,
        asOf: batch.asOf.toISOString(),
        competitionEditionId: batch.competitionEditionId,
      },
    }
  );

  return relationCounts;
}

/** One `operations.write_record` per relation touched, on the control connection. */
async function reportWrites(
  job: Parameters<typeof recordWrite>[1],
  relationCounts: ReadonlyMap<string, RelationCounts>
): Promise<void> {
  await withConnection(MODULE_ROLE, async (control) => {
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

export type { ScopedSubjectBatch, ModuleRegistry };
