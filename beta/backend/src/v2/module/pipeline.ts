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
  selectBatches,
  selectScopedBatches,
  type EligibilityOptions,
  type ScopedSubjectBatch,
  type SubjectBatch,
} from '../feature/driver/eligibility';
import {
  CALCULATION_CONTEXT_KIND,
  COMPETITION_SCOPED_CONTEXT_KIND,
  ALL_COMPETITIONS_SCOPE,
  type CalculationScope,
} from '../feature/calculators/types';
import { selectFixtureBatches, type FixtureBatch } from './driver/fixtureEligibility';
import {
  MODULE_STATUS,
  homeInputKeys,
  awayInputKeys,
  type ConsumedFeature,
  type ModuleCalculator,
  type FixtureModuleCalculator,
} from './types';
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
import { readinessTracker } from './calculators/readinessTracker';
import { restAdvantage } from './calculators/restAdvantage';
import { formGapAccuracy } from './calculators/formGapAccuracy';
import { travelImpact } from './calculators/travelImpact';
import { logger } from '../../utils/logger';

/** The only role S-6 authenticates as. */
export const MODULE_ROLE = 'pt_pipeline_module' as const;

/** Absence of a declared input, recorded as the reason an INACTIVE reading was silent. */
export const INACTIVE_REASON_FEATURE_ABSENT = 'FEATURE_ABSENT';

/**
 * The implemented modules. NOT an execution order — a set. Two are implemented
 * (`home_away_split` COMPETITION_SCOPED, `readiness_tracker` ALL_COMPETITIONS —
 * proving E-i routes both scopes generically); the other eleven stay registered
 * and unproduced. This array is the D-3 declaration site — a module is produced
 * only when it is both registered active AND listed here.
 */
export const MODULE_CALCULATORS: readonly ModuleCalculator[] = [homeAwaySplit, readinessTracker];

/**
 * The implemented FIXTURE-subject comparison modules (S-6.x). A SET, produced only
 * when both registered active AND listed here. `rest_advantage` is the first
 * (symmetric — both sides consume `team.rest_advantage`); `form_gap_accuracy` is the
 * second (asymmetric — home reads `team.home_form`, away reads `team.away_form`);
 * `travel_impact` is the third (symmetric — both sides consume `team.travel_distance`,
 * home-relative differential per S-6 Decision 2). All emit a categorical 1.0.0
 * finding with strength/confidence/baseline NULL (S-9 out of scope).
 */
export const FIXTURE_MODULE_CALCULATORS: readonly FixtureModuleCalculator[] = [restAdvantage, formGapAccuracy, travelImpact];

export interface ModuleRunOptions extends EligibilityOptions {
  readonly dryRun?: boolean;
  readonly now?: Date;
  /** Test seam: override the TEAM module set. Production omits it. */
  readonly calculators?: readonly ModuleCalculator[];
  /** Test seam: override the FIXTURE module set. Production omits it. */
  readonly fixtureCalculators?: readonly FixtureModuleCalculator[];
}

/**
 * One (as_of, team-set) unit at one scope — the engine's scope-neutral batch.
 *
 * COMPETITION_SCOPED batches carry the edition (from `selectScopedBatches`);
 * ALL_COMPETITIONS batches carry `null` (from `selectBatches`). Normalizing both
 * to this one shape is what lets a single pipeline drive both scopes.
 */
interface ModuleBatch {
  readonly asOf: Date;
  readonly competitionEditionId: string | null;
  readonly teamIds: readonly string[];
  readonly snapshotPointCodes: readonly string[];
}

/** The read/write scope a calculator's declared `contextKind` resolves to for a batch. */
function scopeFor(calculator: ModuleCalculator, batch: ModuleBatch): CalculationScope {
  if (calculator.contextKind === COMPETITION_SCOPED_CONTEXT_KIND) {
    if (batch.competitionEditionId === null) {
      // A scoped calculator must only ever be routed a scoped batch.
      throw new Error(
        `module '${calculator.moduleKey}' is COMPETITION_SCOPED but was routed an ` +
          'ALL_COMPETITIONS batch (no edition). This is an engine routing error.'
      );
    }
    return { contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: batch.competitionEditionId };
  }
  return { contextKind: CALCULATION_CONTEXT_KIND, contextEditionId: null };
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
  readonly scope: CalculationScope;
  readonly teamId: string;
  readonly inputs: ReadonlyMap<string, ConsumedFeature>;
}): Omit<ReadingToWrite, 'calculatedAt'> {
  const { calculator, definition, version, asOf, scope, teamId, inputs } = params;
  const declaredInputCount = calculator.inputFeatureKeys.length;
  const presentInputCount = calculator.inputFeatureKeys.filter((k) => inputs.has(k)).length;

  const base = {
    moduleDefinitionId: definition.moduleDefinitionId,
    moduleVersionId: version.moduleVersionId,
    subjectTeamId: teamId,
    asOf,
    contextKindCode: scope.contextKind,
    contextEditionId: scope.contextEditionId,
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
 * Assembles the FIXTURE comparison reading from BOTH sides' resolved inputs — PURE.
 *
 * D-4a: a per-side input is TWO declared inputs, so declared = keys × 2 and the
 * reading is INACTIVE unless every declared input is present for BOTH sides (never
 * a fabricated zero). Otherwise the calculator speaks, the sample count is
 * MIN(consumed) across both sides (D-5c-i), and every cited value (home's and
 * away's) carries the finding's status — the favoured side lives in verdict_text,
 * not in a column (doc 56 C-3). Subject is the FIXTURE.
 */
export function assembleFixtureReading(params: {
  readonly calculator: FixtureModuleCalculator;
  readonly definition: ModuleDefinition;
  readonly version: ModuleVersion;
  readonly asOf: Date;
  readonly scope: CalculationScope;
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly homeInputs: ReadonlyMap<string, ConsumedFeature>;
  readonly awayInputs: ReadonlyMap<string, ConsumedFeature>;
}): Omit<ReadingToWrite, 'calculatedAt'> {
  const { calculator, definition, version, asOf, scope, fixtureId, fixturePartitionOn, homeInputs, awayInputs } = params;
  // Per-side keys: symmetric modules read the same keys on both sides (the default);
  // an asymmetric module (form_gap_accuracy) reads home_form for home, away_form for away.
  const homeKeys = homeInputKeys(calculator);
  const awayKeys = awayInputKeys(calculator);
  const declaredInputCount = homeKeys.length + awayKeys.length;
  const homePresent = homeKeys.filter((k) => homeInputs.has(k)).length;
  const awayPresent = awayKeys.filter((k) => awayInputs.has(k)).length;
  const presentInputCount = homePresent + awayPresent;

  const base = {
    moduleDefinitionId: definition.moduleDefinitionId,
    moduleVersionId: version.moduleVersionId,
    subjectKindCode: 'FIXTURE' as const,
    subjectTeamId: null,
    subjectFixtureId: fixtureId,
    subjectFixturePartitionOn: fixturePartitionOn,
    asOf,
    contextKindCode: scope.contextKind,
    contextEditionId: scope.contextEditionId,
    declaredInputCount,
    presentInputCount,
    belowThresholdInputCount: 0,
    estimatedInputCount: 0,
  };

  if (presentInputCount < declaredInputCount) {
    // INACTIVE — one or both sides missing an input. Silent, no items, no zero.
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

  const finding = calculator.evaluate({ home: homeInputs, away: awayInputs });
  // Sample = MIN(consumed) across both sides' own inputs (D-5c-i).
  let sampleObservationCount = Number.POSITIVE_INFINITY;
  for (const key of homeKeys) {
    sampleObservationCount = Math.min(sampleObservationCount, homeInputs.get(key)!.sampleObservationCount);
  }
  for (const key of awayKeys) {
    sampleObservationCount = Math.min(sampleObservationCount, awayInputs.get(key)!.sampleObservationCount);
  }

  // Every cited value (home's inputs then away's) carries the finding's status; the
  // favoured side lives in verdict_text, not a column (doc 56 C-3).
  const evidenceItems = [];
  for (const key of homeKeys) {
    const consumed = homeInputs.get(key)!;
    evidenceItems.push({ citedFeatureValueId: consumed.valueId, citedFeatureValueAsOf: consumed.asOf, contributionDirection: finding.status });
  }
  for (const key of awayKeys) {
    const consumed = awayInputs.get(key)!;
    evidenceItems.push({ citedFeatureValueId: consumed.valueId, citedFeatureValueAsOf: consumed.asOf, contributionDirection: finding.status });
  }

  return {
    ...base,
    statusCode: finding.status,
    verdictText: finding.verdictText,
    inactiveReason: null,
    sampleObservationCount,
    sampleMeetsThreshold: sampleObservationCount >= version.minimumSampleObservationCount,
    evidenceItems,
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
  const fixtureCalculators = options.fixtureCalculators ?? FIXTURE_MODULE_CALCULATORS;
  const counts = new Map<string, RelationCounts>();
  let failures = 0;

  // Which scopes does this run's calculator set require? Enumerate only those —
  // the ALL_COMPETITIONS and COMPETITION_SCOPED batch sets are produced by the two
  // sibling feature-layer selectors, and a calculator runs only against the set
  // matching its declared contextKind (never the other's rows).
  const needsScoped = calculators.some((c) => c.contextKind === COMPETITION_SCOPED_CONTEXT_KIND);
  const needsAllComp = calculators.some((c) => c.contextKind === CALCULATION_CONTEXT_KIND);

  const { moduleRegistry, scopedBatches, allCompBatches, fixtureBatches } = await withConnection(MODULE_ROLE, async (tx) => {
    const featureRegistry = await loadRegistry(tx); // snapshot points for enumeration
    const modules = await loadModuleRegistry(tx);
    // Reconcile: every calculator (TEAM and FIXTURE) must name a registered module.
    for (const calculator of [...calculators, ...fixtureCalculators]) {
      const definition = modules.definitionsByKey.get(calculator.moduleKey);
      if (!definition) {
        throw new Error(
          `module calculator '${calculator.moduleKey}' is not a registered module. ` +
            'Every reading must be attributable to a governed module.'
        );
      }
    }
    const scoped: readonly ScopedSubjectBatch[] = needsScoped
      ? await selectScopedBatches(tx, featureRegistry, now, options)
      : [];
    const allComp: readonly SubjectBatch[] = needsAllComp
      ? await selectBatches(tx, featureRegistry, now, options)
      : [];
    const fixtures: readonly FixtureBatch[] = fixtureCalculators.length > 0
      ? await selectFixtureBatches(tx, featureRegistry.snapshotPoints, now, options)
      : [];
    return { moduleRegistry: modules, scopedBatches: scoped, allCompBatches: allComp, fixtureBatches: fixtures };
  });

  // Normalize both sets to the scope-neutral ModuleBatch shape.
  const scopedModuleBatches: ModuleBatch[] = scopedBatches.map((b) => ({
    asOf: b.asOf,
    competitionEditionId: b.competitionEditionId,
    teamIds: b.teamIds,
    snapshotPointCodes: b.snapshotPointCodes,
  }));
  const allCompModuleBatches: ModuleBatch[] = allCompBatches.map((b) => ({
    asOf: b.asOf,
    competitionEditionId: null,
    teamIds: b.teamIds,
    snapshotPointCodes: b.snapshotPointCodes,
  }));

  logger.info(
    {
      scopedBatches: scopedModuleBatches.length,
      allCompBatches: allCompModuleBatches.length,
      modules: calculators.map((c) => c.moduleKey),
      dryRun: options.dryRun === true,
    },
    'v2 module: plan loaded'
  );

  await withPipelineRun(MODULE_ROLE, 'v2.module.generate', async () => {
    for (const calculator of calculators) {
      const definition = moduleRegistry.definitionsByKey.get(calculator.moduleKey)!;
      if (!definition.isActive) continue; // registered inactive → not produced

      // Route by declared scope — the anti-hardcoding guarantee.
      const batches =
        calculator.contextKind === COMPETITION_SCOPED_CONTEXT_KIND
          ? scopedModuleBatches
          : allCompModuleBatches;

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

    // FIXTURE-subject comparison modules — one reading per (fixture, as_of).
    for (const calculator of fixtureCalculators) {
      const definition = moduleRegistry.definitionsByKey.get(calculator.moduleKey)!;
      if (!definition.isActive) continue;
      for (const batch of fixtureBatches) {
        try {
          const result = await runFixtureModuleBatch(calculator, definition, batch, options.dryRun === true);
          for (const [relation, delta] of result) accumulate(counts, relation, delta);
        } catch (error) {
          failures += 1;
          logger.error(
            {
              moduleKey: calculator.moduleKey,
              fixtureId: batch.fixtureId,
              asOf: batch.asOf.toISOString(),
              error: buildDiagnostic(error),
            },
            'v2 module: fixture batch failed, continuing'
          );
        }
      }
    }
  });

  return {
    batches: scopedModuleBatches.length + allCompModuleBatches.length + fixtureBatches.length,
    modules: [...calculators, ...fixtureCalculators].map((c) => c.moduleKey),
    counts,
    failures,
    dryRun: options.dryRun === true,
  };
}

/** One (FIXTURE module × fixture) transaction. Reads both teams' inputs, writes one reading. */
async function runFixtureModuleBatch(
  calculator: FixtureModuleCalculator,
  definition: ModuleDefinition,
  batch: FixtureBatch,
  dryRun: boolean
): Promise<Map<string, RelationCounts>> {
  const relationCounts = new Map<string, RelationCounts>();
  // Scope for the inputs. A FIXTURE module declares ONE scope; rest_advantage is
  // ALL_COMPETITIONS. (COMPETITION_SCOPED fixture modules would bind the edition.)
  const scope: CalculationScope =
    calculator.contextKind === COMPETITION_SCOPED_CONTEXT_KIND
      ? { contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: batch.competitionEditionId }
      : ALL_COMPETITIONS_SCOPE;

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

      // Each side's declared inputs, at one instant and one scope. Symmetric modules
      // read the same keys on both sides; an asymmetric module (form_gap_accuracy)
      // reads home_form for home and away_form for away — the union is read once and
      // assigned to each side by its own declared keys.
      const homeKeys = homeInputKeys(calculator);
      const awayKeys = awayInputKeys(calculator);
      const allKeys = [...new Set([...homeKeys, ...awayKeys])];
      const consumed = await readConsumedFeatures(
        tx,
        allKeys,
        [batch.homeTeamId, batch.awayTeamId],
        batch.asOf,
        scope
      );
      const homeInputs = new Map<string, ConsumedFeature>();
      const awayInputs = new Map<string, ConsumedFeature>();
      for (const key of homeKeys) {
        const home = consumed.get(consumedKey(key, batch.homeTeamId));
        if (home) homeInputs.set(key, home);
      }
      for (const key of awayKeys) {
        const away = consumed.get(consumedKey(key, batch.awayTeamId));
        if (away) awayInputs.set(key, away);
      }

      const reading = assembleFixtureReading({
        calculator,
        definition,
        version,
        asOf: batch.asOf,
        scope,
        fixtureId: batch.fixtureId,
        fixturePartitionOn: batch.fixturePartitionOn,
        homeInputs,
        awayInputs,
      });

      if (dryRun) {
        accumulate(relationCounts, 'module.module_reading', { examined: 1, skipped: 1 });
        return;
      }

      const calculatedAt = operationalNow();
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

      await reportWrites(job, relationCounts);
    },
    { detail: { module: calculator.moduleKey, fixtureId: batch.fixtureId, asOf: batch.asOf.toISOString() } }
  );

  return relationCounts;
}

/** One (module × batch) transaction, at the calculator's declared scope. */
async function runModuleBatch(
  calculator: ModuleCalculator,
  definition: ModuleDefinition,
  batch: ModuleBatch,
  dryRun: boolean
): Promise<Map<string, RelationCounts>> {
  const relationCounts = new Map<string, RelationCounts>();
  const scope = scopeFor(calculator, batch);

  await withRun(
    MODULE_ROLE,
    `module.${calculator.moduleKey}`,
    async (tx: PoolClient, job) => {
      // Version resolution is scope-agnostic — a reading is attributed to the
      // version whose effective_period contains its as_of, whatever the scope.
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
        scope
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
          scope,
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
