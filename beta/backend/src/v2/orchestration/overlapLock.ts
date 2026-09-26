// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR OVERLAP LOCK — session-level PostgreSQL advisory lock
//
// Guarantees at most one production pipeline run for the regime at any instant. The
// lock is SESSION-scoped (not transaction-scoped) because a run spans many independent
// stage transactions, so it is held on ONE dedicated connection for the whole run and
// released in the orchestrator's finally. A crashed process drops its connection, and
// PostgreSQL releases the session lock automatically — so the lock is always eventually
// releasable without a table or application memory. A second concurrent invocation gets
// `acquired:false` (→ ALREADY_RUNNING) and starts no pipeline and spends no budget.
// ─────────────────────────────────────────────────────────────────────────────

import { acquireConnection } from '../db/pool';
import { INGESTION_ROLE } from '../ingestion/pipeline';
import type { PipelineRole } from '../db/roles';
import type { AcquiredLock } from './productionOrchestrator';

/** Deterministic regime key — the single production pipeline. */
export const ORCHESTRATOR_LOCK_KEY = 'pt_v2_production_orchestrator';
export const TRY_LOCK_SQL = `SELECT pg_try_advisory_lock(hashtext($1::text)) AS acquired`;
export const UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtext($1::text)) AS released`;

/** Acquire the regime lock on a held connection. Non-blocking: returns acquired:false
 *  immediately if another run holds it. `release` unlocks and returns the connection. */
export async function acquireOrchestratorLock(role: PipelineRole = INGESTION_ROLE): Promise<AcquiredLock> {
  const client = await acquireConnection(role);
  try {
    const res = await client.query<{ acquired: boolean }>(TRY_LOCK_SQL, [ORCHESTRATOR_LOCK_KEY]);
    if (res.rows[0]?.acquired !== true) {
      client.release();
      return { acquired: false, release: async () => {} };
    }
    return {
      acquired: true,
      release: async () => {
        try { await client.query(UNLOCK_SQL, [ORCHESTRATOR_LOCK_KEY]); } finally { client.release(); }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}
