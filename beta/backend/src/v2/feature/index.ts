// ─────────────────────────────────────────────────────────────────────────────
// S-5 Feature calculation — public surface
//
//     import { runFeaturePipeline } from './v2/feature';
//
//     await runFeaturePipeline();                          // forward, attributed
//     await runFeaturePipeline({ replayFrom, replayTo });  // explicit replay
//     await runFeaturePipeline({ dryRun: true });          // compute, write nothing
//
// Writes `feature.feature_value` and `feature.feature_lineage`, plus the
// type-level declarations S-3 deferred, as `pt_pipeline_feature`. Every stage is
// attributed: the role holds SELECT and INSERT on `operations`, so there is no
// unattributed path here.
//
// WHAT THIS SUBSYSTEM DOES NOT DO
//   - ingest provider data (S-4), evaluate modules (S-6), compose snapshots
//     (S-7) or calibrate (S-9) — structurally impossible: no USAGE on those
//     schemas
//   - write `feature_definition`, `feature_version` or `feature_calculator` —
//     the registry is S-3's, amended only through governance
//   - calculate `team.squad_stability` — registered, never implemented (R-1)
//   - update or delete anything
// ─────────────────────────────────────────────────────────────────────────────

export {
  runFeaturePipeline,
  CALCULATORS,
  FEATURE_ROLE,
  type FeatureRunOptions,
  type FeatureRunReport,
  type RelationCounts,
} from './pipeline';

export {
  loadRegistry,
  assertCalculatorCoverage,
  type Registry,
  type FeatureDefinition,
  type SnapshotPoint,
  type DependencyEdge,
} from './registry/load';

export {
  declareRegistryInputs,
  FEATURE_SOURCES,
  FEATURE_DEPENDENCIES,
  type DeclarationResult,
} from './registry/declare';

export {
  deriveExecutionPlan,
  findFeatureCycle,
  featuresOfCalculator,
  DependencyCycleError,
  type ExecutionPlan,
  type Stage,
} from './registry/order';

export {
  selectBatches,
  deriveAsOf,
  type SubjectBatch,
  type EligibilityOptions,
} from './driver/eligibility';

export {
  CALCULATION_CONTEXT_KIND,
  before,
  priorValueKey,
  type Calculator,
  type CalculationContext,
  type CandidateValue,
  type CompletedFixture,
  type ConsumedValueRef,
  type SubjectMoment,
  type TeamFixtureHistory,
  type VenueLocation,
} from './calculators/types';

export { formBackfill } from './calculators/formBackfill';
export { fixtureLoad } from './calculators/fixtureLoad';
export { travelLoad } from './calculators/travelLoad';
export { teamReadiness } from './calculators/teamReadiness';

export {
  add,
  clamp,
  compare,
  divide,
  exact,
  fromInt,
  fromString,
  maximum,
  minimum,
  multiply,
  roundHalfUp,
  subtract,
  toNumericString,
  ONE,
  ONE_HUNDRED,
  WORKING_SCALE,
  ZERO,
  type Exact,
} from './write/scale';

export { resolve as resolveProvenance, type ResolvedProvenance } from './write/provenance';
export { writeValues, type WrittenValue, type ValueWriteResult } from './write/values';
export { writeLineage, type LineageWriteResult } from './write/lineage';

export { readCompletedFixtures, readFixturesForEligibility } from './read/fixtures';
export { readHomeVenues, readVenueLocations } from './read/venues';
export { readPriorValues, countExistingValues } from './read/featureValues';
export { readSquadAvailability, type SquadAvailability } from './read/availability';

export {
  runAllVerifications,
  runVerification,
  VERIFICATIONS,
  type VerificationKey,
  type VerificationResult,
} from './verify';
