// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION ORCHESTRATOR — safe continuous regime over the EXISTING V2 stages
//
// The V2 pipeline already exists as separate, individually governed, idempotent CLI
// stages. This module owns ONLY the regime around them: sequencing, run identity,
// overlap prevention, stage dependency handling, per-stage success/failure recording,
// and operational logging. It builds NO ingestion engine, duplicates NO stage logic,
// and makes NO provider call — every stage is INJECTED as a `StageRunner`, so the
// sequencing is deterministic and unit-testable without a database or the provider.
//
// STAGE DEPENDENCY ORDER (the real repository graph; Team Preparedness is composed
// INSIDE snapshot sealing, so it is not a separate stage):
//   INGESTION → FEATURES → MODULES → SNAPSHOT(+preparedness) → ACCRUAL
//
// GOVERNANCE:
//   • A hard stage FAILURE (the stage threw / aborted) blocks every downstream stage,
//     which is recorded SKIPPED. The run status is FAILED.
//   • A stage's own PER-ITEM failures (feature/module `failures`, snapshot `failed`)
//     are NOT a hard failure — the stage was designed to isolate them and continue,
//     so downstream still runs. The orchestrator uses the stage's declared outcome,
//     never a re-interpretation of item counts.
//   • BUDGET_BLOCKED (only INGESTION spends provider quota) is recorded and NON-fatal:
//     the downstream stages make no provider calls and cannot fabricate (missing ≠ zero),
//     so they still run over whatever data exists. The run is flagged budgetBlocked.
//   • Overlap is impossible: the run holds an injected mutual-exclusion lock for its
//     whole duration; a second concurrent invocation observes ALREADY_RUNNING and does
//     nothing (no second pipeline, no double provider spend).
// ─────────────────────────────────────────────────────────────────────────────

export type StageName = 'INGESTION' | 'FEATURES' | 'MODULES' | 'SNAPSHOT' | 'ACCRUAL';

/** The canonical dependency order. SNAPSHOT composes Team Preparedness at seal. */
export const STAGE_ORDER: readonly StageName[] = ['INGESTION', 'FEATURES', 'MODULES', 'SNAPSHOT', 'ACCRUAL'];

export type StageOutcomeCode = 'OK' | 'FAILED' | 'BUDGET_BLOCKED';

/** What an injected stage reports back. `ok:false` is a HARD failure (stage aborted).
 *  `blocked:true` is a budget stop (provider quota exhausted) — non-fatal. `detail` is
 *  opaque operational metadata (counts, aggregate, error message) for logging only. */
export interface StageReport {
  readonly ok: boolean;
  readonly blocked?: boolean;
  readonly detail?: unknown;
}

export interface StageRunner {
  readonly name: StageName;
  readonly run: () => Promise<StageReport>;
}

export type StageStatus = StageOutcomeCode | 'SKIPPED';

export interface StageResult {
  readonly stage: StageName;
  readonly status: StageStatus;
  readonly durationMs: number;
  readonly detail?: unknown;
}

export type OrchestrationStatus = 'COMPLETED' | 'FAILED' | 'ALREADY_RUNNING';

export interface OrchestrationResult {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: OrchestrationStatus;
  readonly budgetBlocked: boolean;
  readonly failureStage: StageName | null;
  readonly stages: readonly StageResult[];
}

export interface OrchestratorEvent {
  readonly type:
    | 'ORCHESTRATION_START' | 'ALREADY_RUNNING'
    | 'STAGE_START' | 'STAGE_SUCCESS' | 'STAGE_FAILURE' | 'STAGE_BUDGET_BLOCK' | 'STAGE_SKIPPED'
    | 'ORCHESTRATION_COMPLETE';
  readonly runId: string;
  readonly stage?: StageName;
  readonly durationMs?: number;
  readonly status?: OrchestrationStatus;
  readonly detail?: unknown;
}

export interface AcquiredLock {
  readonly acquired: boolean;
  readonly release: () => Promise<void>;
}

export interface OrchestratorDeps {
  /** Stages in the caller's intended order; the orchestrator asserts it equals STAGE_ORDER. */
  readonly stages: readonly StageRunner[];
  /** Mutual exclusion for the whole run. Production wires this to a session advisory lock. */
  readonly acquireLock: () => Promise<AcquiredLock>;
  readonly runId?: string;
  readonly clock?: () => Date;
  readonly log?: (event: OrchestratorEvent) => void;
}

const noop = (): void => {};

/** Runs the stages in dependency order under a mutual-exclusion lock. Pure control flow:
 *  no DB, no provider, no stage logic. Deterministic given its injected deps. */
export async function runProductionPipeline(deps: OrchestratorDeps): Promise<OrchestrationResult> {
  const clock = deps.clock ?? (() => new Date());
  const log = deps.log ?? noop;
  const runId = deps.runId ?? `orch-${clock().toISOString()}`;

  // Guard: the injected stage list must be exactly the governed order — no reordering,
  // no missing stage, no duplicate. This prevents an accidental out-of-order regime.
  const names = deps.stages.map((s) => s.name);
  if (names.length !== STAGE_ORDER.length || names.some((n, i) => n !== STAGE_ORDER[i])) {
    throw new Error(`orchestrator stages must be exactly [${STAGE_ORDER.join(', ')}], received [${names.join(', ')}]`);
  }

  const startedAt = clock();
  const lock = await deps.acquireLock();
  if (!lock.acquired) {
    log({ type: 'ALREADY_RUNNING', runId });
    const iso = startedAt.toISOString();
    return { runId, startedAt: iso, completedAt: iso, status: 'ALREADY_RUNNING', budgetBlocked: false, failureStage: null, stages: [] };
  }

  const results: StageResult[] = [];
  let failureStage: StageName | null = null;
  let budgetBlocked = false;
  try {
    log({ type: 'ORCHESTRATION_START', runId });
    for (const stage of deps.stages) {
      if (failureStage !== null) {
        // A prior stage hard-failed: every downstream stage is skipped, never run.
        results.push({ stage: stage.name, status: 'SKIPPED', durationMs: 0 });
        log({ type: 'STAGE_SKIPPED', runId, stage: stage.name });
        continue;
      }
      const t0 = clock().getTime();
      log({ type: 'STAGE_START', runId, stage: stage.name });
      let report: StageReport;
      try {
        report = await stage.run();
      } catch (err) {
        report = { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
      const durationMs = clock().getTime() - t0;
      if (!report.ok) {
        failureStage = stage.name;
        results.push({ stage: stage.name, status: 'FAILED', durationMs, detail: report.detail });
        log({ type: 'STAGE_FAILURE', runId, stage: stage.name, durationMs, detail: report.detail });
      } else if (report.blocked) {
        budgetBlocked = true;
        results.push({ stage: stage.name, status: 'BUDGET_BLOCKED', durationMs, detail: report.detail });
        log({ type: 'STAGE_BUDGET_BLOCK', runId, stage: stage.name, durationMs, detail: report.detail });
        // Non-fatal: downstream stages are provider-free and cannot fabricate — continue.
      } else {
        results.push({ stage: stage.name, status: 'OK', durationMs, detail: report.detail });
        log({ type: 'STAGE_SUCCESS', runId, stage: stage.name, durationMs, detail: report.detail });
      }
    }
  } finally {
    // Always release — on success, on failure, and on an unexpected throw.
    await lock.release();
  }

  const completedAt = clock();
  const status: OrchestrationStatus = failureStage !== null ? 'FAILED' : 'COMPLETED';
  log({ type: 'ORCHESTRATION_COMPLETE', runId, status });
  return {
    runId, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(),
    status, budgetBlocked, failureStage, stages: results,
  };
}
