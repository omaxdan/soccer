// ─────────────────────────────────────────────────────────────────────────────
// V2 CONNECTION POOLS — one per pipeline role, session mode, direct PostgreSQL
//
// WHY NOT supabase-js
// Three reasons, each independently sufficient (Phase 8 §5.3):
//
//   1. NO TRANSACTIONS. PostgREST issues one statement per request. Snapshot
//      sealing is inherently multi-statement — header, manifest, feature states,
//      module readings, verdict, completeness must commit together or not at
//      all. V1 already discovered this: db/client.ts:33 records that a
//      delete()+insert() pair was "two PostgREST transactions".
//   2. NO SESSION STATE. The retention marker (R-21) and the timeouts (A.15)
//      are session-scoped. PostgREST has no session.
//   3. WRONG CREDENTIAL. The service role carries BYPASSRLS, which makes every
//      policy verified in Phase 6.1 §14 inert (Phase 7 SEC-03).
//
// V1's supabase-js client in src/db/client.ts is untouched and keeps working.
// This module is additive.
//
// WHY ONE POOL PER ROLE RATHER THAN ONE POOL WITH SET ROLE
// SET ROLE on a shared connection would be cheaper in slots and is the obvious
// shortcut. It is rejected because it is reversible: any code with access to
// that pool can issue RESET ROLE and recover the full privileges of the
// underlying login. The separation of §B.7.1 would then hold only as long as no
// caller made a mistake, which is the property the architecture exists to
// remove. Seven authenticated logins make the boundary structural.
//
// CONNECTION BUDGET (Phase 8 R-05, High)
// Session-mode connections are not multiplexed. Seven pools sized like ordinary
// application pools will exhaust a Supabase direct-connection cap. Defaults here
// total 20 across all seven roles and pools are created LAZILY, so a process
// that uses two roles holds two pools. Size deliberately during §13 Stage 2.
// ─────────────────────────────────────────────────────────────────────────────

import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { loadV2Config, requireCredential } from '../config/index';
import { PIPELINE_ROLES, roleDefinition, type PipelineRole } from './roles';
import { logger } from '../../utils/logger';

const pools = new Map<PipelineRole, Pool>();

/** True once shutdown has begun, so a late caller gets a clear error. */
let shuttingDown = false;

function buildPoolConfig(role: PipelineRole): PoolConfig {
  const cfg = loadV2Config();
  return {
    host: cfg.database.host,
    port: cfg.database.port,
    database: cfg.database.database,
    // The role name is the login name. Fixed by the architecture — see roles.ts
    // for why it is not configurable.
    user: role,
    password: requireCredential(role),
    ssl: cfg.database.ssl ? { rejectUnauthorized: true } : undefined,
    max: cfg.poolMax[role],
    // A pipeline that cannot get a connection should fail rather than queue
    // behind a saturated pool: the scheduler will retry the job, and a hung
    // process produces no telemetry and no failure row.
    connectionTimeoutMillis: cfg.database.connectionTimeoutMs,
    idleTimeoutMillis: cfg.database.idleTimeoutMs,
    // Attributes every session in pg_stat_activity to a role and a process, so
    // the connection budget of R-05 is observable rather than inferred.
    application_name: `${cfg.applicationNamePrefix}:${role}`,
    // search_path and TimeZone are pinned as CONNECTION STARTUP OPTIONS, not by
    // a SET after connect. See the note below for why that distinction matters,
    // and for why pinning them client-side is necessary at all.
    options: '-c search_path= -c timezone=UTC',
    // DELIBERATELY ABSENT: statement_timeout. Migration 001 sets it per role
    // with ALTER ROLE (A.15, R-64) and those settings apply on connect. Setting
    // it here would silently override an architectural decision with an
    // application default. The health check below VERIFIES the role settings
    // arrived rather than imposing its own.
  };
}

/**
 * True when PostgreSQL reports an empty search path.
 *
 * current_setting('search_path') renders the empty path as the two-character
 * string `""` — the quoted empty identifier — not as an empty string. Comparing
 * against '' looks right and is wrong, which is worth a named helper rather than
 * an inline comparison every caller has to get right.
 */
export function isEmptySearchPath(value: string | undefined): boolean {
  return value === '' || value === '""';
}

/**
 * WHY search_path IS PINNED, AND WHY AS A STARTUP OPTION
 *
 * §5.3.4: "No role is configured with a permissive search path. Every object
 * reference in application code is schema-qualified."
 *
 * PD-08: every pipeline session operates in UTC.
 *
 * Migration 001 sets BOTH search_path and timezone for the five pipeline roles
 * and for retention. IT SETS NEITHER FOR pt_platform_admin — verified against a
 * deployed database, where that role reported `"$user", public` and `Etc/UTC`
 * (the cluster defaults) rather than the values the architecture chose for the
 * other six. Both were found by the health check in pool.test.ts.
 *
 * Pinning them client-side makes the posture uniform across all seven WITHOUT
 * touching the approved schema: these are connection settings, not schema
 * changes, and they apply exactly the values migration 001 already assigns to
 * the other roles. The gap in 001 is recorded in src/v2/README.md for the
 * architecture owner; closing it there would be a schema change, which S-1 may
 * not make.
 *
 * The first implementation of this did it in a pool 'connect' handler with
 * `SET search_path = ''`. THAT WAS A RACE, and the test caught it: pg emits
 * 'connect' without awaiting the handler, so a caller could receive the client
 * and issue its first query before the SET landed. A connection whose search
 * path is pinned only *usually* is worse than one that is never pinned, because
 * it fails intermittently.
 *
 * The startup option `-c search_path=` has no such window. The server applies it
 * while establishing the connection, before any query can be issued, and it
 * costs no extra round trip.
 *
 * THE CONSEQUENCE FOR EVERY CALLER: ALL SQL MUST BE SCHEMA-QUALIFIED.
 * `SELECT … FROM feature_value` will not resolve; `FROM feature.feature_value`
 * will. That is intended, and checkHealth() verifies it per role.
 */

/**
 * The pool for `role`, created on first use.
 *
 * LAZY, matching the pattern V1 already uses in src/db/client.ts — a module
 * import must not open connections or throw on absent credentials, because a
 * process that imports this file to reach one role should not need the other
 * six secrets.
 */
export function poolFor(role: PipelineRole): Pool {
  if (shuttingDown) {
    throw new Error(
      `Refusing to create a pool for '${role}': shutdown is in progress. ` +
        'A job started after closeAllPools() would leave an unattributed partial write.'
    );
  }

  const existing = pools.get(role);
  if (existing) return existing;

  const pool = new Pool(buildPoolConfig(role));

  // An idle-client error is not routed to any caller's await, so without this
  // handler pg would surface it as an unhandled rejection and take the process
  // down. Log it and let the pool discard the connection.
  pool.on('error', (err) => {
    logger.error({ role, err: err.message }, 'v2: idle pool client error');
  });

  pools.set(role, pool);
  logger.info(
    { role, max: loadV2Config().poolMax[role], purpose: roleDefinition(role).purpose },
    'v2: pool created'
  );
  return pool;
}

export interface HealthReport {
  readonly role: PipelineRole;
  readonly healthy: boolean;
  /** The role PostgreSQL actually authenticated — must equal `role`. */
  readonly currentUser?: string;
  readonly serverVersion?: string;
  /** Resolved from ALTER ROLE (A.15, R-64). Absent means the setting is missing. */
  readonly statementTimeout?: string;
  readonly searchPath?: string;
  readonly timezone?: string;
  readonly latencyMs?: number;
  readonly error?: string;
}

/**
 * Verifies a role's pool end to end.
 *
 * This does more than `SELECT 1`, deliberately. Four things can be wrong in ways
 * that do not raise on connect and would otherwise surface much later as
 * confusing behaviour:
 *
 *   * AUTHENTICATED AS THE WRONG ROLE — a deployment could point two variables
 *     at one credential. current_user is checked against the expected role.
 *   * SESSION SETTINGS ABSENT — if ALTER ROLE never ran, a bulk job inherits the
 *     cluster statement_timeout instead of A.15's, and a long write is killed
 *     mid-pipeline.
 *   * PERMISSIVE search_path — resolves unqualified names against public,
 *     contrary to §5.3.4.
 *   * WRONG TIMEZONE — PD-08 requires every pipeline session in UTC. A session
 *     in local time silently shifts every date_trunc and every partition key.
 */
export async function checkHealth(role: PipelineRole): Promise<HealthReport> {
  const startedAt = Date.now();
  let client: PoolClient | undefined;
  try {
    client = await poolFor(role).connect();
    const { rows } = await client.query<{
      current_user: string;
      server_version: string;
      statement_timeout: string;
      search_path: string;
      timezone: string;
    }>(
      `SELECT current_user,
              current_setting('server_version')     AS server_version,
              current_setting('statement_timeout')  AS statement_timeout,
              current_setting('search_path')        AS search_path,
              current_setting('TimeZone')           AS timezone`
    );
    const row = rows[0];
    const healthy = row.current_user === role;
    const report: HealthReport = {
      role,
      healthy,
      currentUser: row.current_user,
      serverVersion: row.server_version,
      statementTimeout: row.statement_timeout,
      searchPath: row.search_path,
      timezone: row.timezone,
      latencyMs: Date.now() - startedAt,
      ...(healthy
        ? {}
        : {
            error:
              `Authenticated as '${row.current_user}' but expected '${role}'. ` +
              'Check that each PT_V2_DB_PASSWORD_* variable holds its own role\'s secret.',
          }),
    };
    if (!healthy) logger.error(report, 'v2: health check failed — role mismatch');
    return report;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ role, err: message }, 'v2: health check failed');
    return { role, healthy: false, error: message, latencyMs: Date.now() - startedAt };
  } finally {
    client?.release();
  }
}

/**
 * Health-checks every role this process holds a credential for.
 *
 * Startup gate. A process that cannot reach the database as the roles it needs
 * should not begin work — R-05's failure mode is slot exhaustion, which
 * presents as intermittent connection errors mid-run and is far harder to
 * diagnose there than at startup.
 */
export async function checkAllConfiguredRoles(
  roles: readonly PipelineRole[]
): Promise<HealthReport[]> {
  return Promise.all(roles.map((r) => checkHealth(r)));
}

/**
 * Closes every open pool.
 *
 * GRACEFUL: pool.end() waits for in-flight queries to finish and refuses new
 * checkouts. `shuttingDown` then rejects any late poolFor(), so a job cannot
 * start against a closing pool and leave a write nothing will attribute.
 *
 * Idempotent, because signal handlers fire more than once often enough to
 * matter (SIGINT twice from an impatient operator is the common case).
 */
export async function closeAllPools(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const open = [...pools.entries()];
  pools.clear();
  if (open.length === 0) return;

  logger.info({ pools: open.map(([r]) => r) }, 'v2: closing pools');
  const results = await Promise.allSettled(open.map(([, pool]) => pool.end()));
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        { role: open[index][0], err: String(result.reason) },
        'v2: pool did not close cleanly'
      );
    }
  });
  logger.info('v2: all pools closed');
}

/**
 * Installs SIGINT/SIGTERM handlers that close pools before exit.
 *
 * OPT-IN rather than automatic on import. A library that installs process
 * handlers as a side effect of being imported is a library that surprises its
 * host — and the CLI, the test runner and a future long-running worker each
 * want different exit behaviour. Entry points call this; modules do not.
 */
export function installShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'v2: shutdown signal received');
    void closeAllPools().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

/** Diagnostic: current pool occupancy, for the connection budget of R-05. */
export function poolStats(): Record<string, { total: number; idle: number; waiting: number }> {
  const stats: Record<string, { total: number; idle: number; waiting: number }> = {};
  for (const [role, pool] of pools) {
    stats[role] = { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
  }
  return stats;
}

/** Test-only. Closes pools and clears shutdown state so a suite can rebuild. */
export async function resetPoolsForTesting(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.allSettled(open.map((p) => p.end()));
  shuttingDown = false;
}

/** Roles with a live pool. Used by the shutdown and diagnostic tests. */
export function openPoolRoles(): PipelineRole[] {
  return PIPELINE_ROLES.filter((r) => pools.has(r));
}
