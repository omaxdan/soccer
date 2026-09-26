// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION ORCHESTRATOR CLI — the single idempotent invocation
//
//   npm run orchestrate:v2 -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--max-calls N] [--dry-run]
//
// One invocation runs the CURRENT/ONGOING regime once, under the overlap lock, in the
// governed dependency order. It is meant to be triggered by an EXTERNAL scheduler (OS
// cron / platform scheduler) — there is no in-process daemon, matching how V2 is
// deployed (manual `tsx` CLIs). Overlap is prevented by the session advisory lock, so
// a slow run overlapping the next tick simply exits ALREADY_RUNNING.
//
// SCOPE: recurring current ingestion ONLY. It uses a small FORWARD/catch-up window and a
// bounded provider budget; it refuses a window that looks like the historical bootstrap
// (that remains a separate operator-controlled job, and the 7,500/day key is not assumed).
// The provider budget is enforced inside the ingestion stage's existing governor — this
// CLI never bypasses it.
// ─────────────────────────────────────────────────────────────────────────────

// MUST be first — loads env before anything reads process.env
import '../config/env';

import { runProductionPipeline, type StageRunner, type OrchestratorEvent } from './productionOrchestrator';
import { acquireOrchestratorLock } from './overlapLock';
import { runGovernedEditions } from '../ingestion/orchestration/governedEditions';
import { runFeaturePipeline } from '../feature/pipeline';
import { runModulePipeline } from '../module/pipeline';
import { runSnapshotSealing } from '../snapshot/driver';
import { runOutcomeAccrual } from '../calibration/driver';
import { closeAllPools } from '../db/pool';
import { logger } from '../../utils/logger';

const DAY_MS = 86_400_000;
/** Recurring window guards — anything wider/older is the historical bootstrap, not cron. */
const MAX_WINDOW_DAYS = 14;
const MAX_PAST_DAYS = 30;
const DEFAULT_MAX_CALLS = 150; // < the current 200/day aggregate; never assumes 7,500

interface OrchestratorArgs { from: Date; to: Date; maxCalls: number; dryRun: boolean }

function parseDate(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date '${v}' (expected YYYY-MM-DD)`);
  return d;
}

export function parseOrchestratorArgs(argv: readonly string[], now: Date = new Date()): OrchestratorArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // Default recurring window: yesterday (catch just-finished results) .. +3 days (upcoming).
  const from = parseDate(get('--from'), new Date(now.getTime() - DAY_MS));
  const to = parseDate(get('--to'), new Date(now.getTime() + 3 * DAY_MS));
  const rawMax = get('--max-calls');
  const maxCalls = rawMax === undefined ? DEFAULT_MAX_CALLS : Number(rawMax);
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new Error(`--max-calls must be a positive integer`);
  assertRecurringWindow(from, to, now);
  return { from, to, maxCalls, dryRun: argv.includes('--dry-run') };
}

/** Refuse a historical-bootstrap-shaped window in the recurring path. */
export function assertRecurringWindow(from: Date, to: Date, now: Date): void {
  if (to.getTime() < from.getTime()) throw new Error('--to must not precede --from');
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_WINDOW_DAYS) {
    throw new Error(`window exceeds ${MAX_WINDOW_DAYS} days — that is the historical bootstrap, not the recurring regime`);
  }
  if ((now.getTime() - from.getTime()) / DAY_MS > MAX_PAST_DAYS) {
    throw new Error(`--from is more than ${MAX_PAST_DAYS} days in the past — use the operator-controlled bootstrap, not cron`);
  }
}

/** Build the real stage runners. Provider quota is enforced inside INGESTION's governor;
 *  FEATURES/MODULES/SNAPSHOT/ACCRUAL make no provider calls. Per-item failures are detail,
 *  not hard failures; a thrown stage becomes a hard failure via the orchestrator's catch. */
export function buildStageRunners(args: OrchestratorArgs): StageRunner[] {
  return [
    { name: 'INGESTION', run: async () => {
      const r = await runGovernedEditions({ from: args.from, to: args.to, maxCalls: args.maxCalls });
      return {
        ok: r.aggregate !== 'FAILED',
        blocked: r.outcomes.some((o) => o.status === 'SKIPPED_BUDGET'),
        detail: { aggregate: r.aggregate, selected: r.selected, totalCallsSpent: r.totalCallsSpent },
      };
    } },
    { name: 'FEATURES', run: async () => {
      const r = await runFeaturePipeline({ dryRun: args.dryRun });
      return { ok: true, detail: { batches: r.batches, failures: r.failures } };
    } },
    { name: 'MODULES', run: async () => {
      const r = await runModulePipeline({ dryRun: args.dryRun });
      return { ok: true, detail: { batches: r.batches, failures: r.failures } };
    } },
    { name: 'SNAPSHOT', run: async () => {
      const r = await runSnapshotSealing({}); // Team Preparedness is composed here at seal
      return { ok: true, detail: { sealed: r.sealed, skipped: r.skipped, failed: r.failed } };
    } },
    { name: 'ACCRUAL', run: async () => {
      const r = await runOutcomeAccrual({ dryRun: args.dryRun });
      return { ok: true, detail: { considered: r.considered, linked: r.linked, superseded: r.superseded } };
    } },
  ];
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = parseOrchestratorArgs(argv);
  const log = (e: OrchestratorEvent): void => { logger.info({ orchestrator: e }, `v2 orchestrator: ${e.type}`); };
  const result = await runProductionPipeline({
    stages: buildStageRunners(args),
    acquireLock: acquireOrchestratorLock,
    log,
  });
  logger.info({ result }, 'v2 orchestrator: run finished');
  return result.status === 'FAILED' ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(async (code) => { await closeAllPools(); process.exit(code); })
    .catch(async (err) => {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'v2 orchestrator: fatal');
      await closeAllPools();
      process.exit(1);
    });
}
