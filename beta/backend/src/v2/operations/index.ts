// ─────────────────────────────────────────────────────────────────────────────
// S-2 Operational layer — public surface
//
// Install once at process start:
//
//     import { installOperationalLayer } from './v2/operations';
//     installOperationalLayer();
//
// After that, every withRun() from S-1 is attributed: it opens a pipeline_run
// (or joins the ambient one), opens a pipeline_job_run, executes the business
// transaction, and records the outcome — with the lifecycle on a connection that
// survives a rollback of the work it describes.
//
// S-1's public contract is unchanged. Nothing here redesigns withRun,
// withConnection, withSession, withSavepoint or requireJobRun.
// ─────────────────────────────────────────────────────────────────────────────

export {
  withPipelineRun,
  currentRun,
  insertPipelineRun,
  ensureImplicitRun,
  codeRevision,
  runCloseCapability,
  type PipelineRunRef,
  type PipelineRunOptions,
  type TriggerKind,
  type RunOutcome,
} from './run';

export {
  installOperationalLayer,
  operationalJobLifecycle,
  type JobRunOutcome,
} from './jobLifecycle';

export {
  recordWrite,
  WriteAccumulator,
  type WriteCounts,
  type WriteTarget,
} from './writeRecord';

export {
  recordFailure,
  appendResolution,
  latestResolution,
  classifyFailure,
  isRetryable,
  buildDiagnostic,
  type FailureClass,
  type FailureRef,
  type ResolutionState,
} from './failure';

export {
  recordApiUsage,
  ApiUsageWindowBuilder,
  latestQuotaRemaining,
  type ApiUsageWindow,
} from './apiUsage';

export {
  withScheduledRun,
  listSchedules,
  isCronAvailable,
  recentScheduledExecutions,
  scheduleFired,
  ScheduleStorageUnavailableError,
  type ScheduleDefinition,
  type ScheduledExecution,
} from './schedule';
