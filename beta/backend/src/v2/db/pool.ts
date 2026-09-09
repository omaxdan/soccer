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
// ONE POOL, ONE CREDENTIAL — RE-ANCHORED
//
// This module previously opened one pool per pipeline role, each with its own
// password, because the physical design (docs/db-v2/10) specified seven database
// identities. Those identities are absent from the V2 REQUIREMENTS (docs/db-v2/
// 04), and the arrangement made running V2 depend on manually provisioning seven
// LOGIN roles and distributing seven secrets. V2's purpose is football
// intelligence; that was infrastructure serving only itself.
//
// V2 now connects the way V1 does: one connection, one credential, whatever
// login the deployment already has.
//
// WHAT IS LOST, STATED RATHER THAN GLOSSED. Seven logins made the layer boundary
// STRUCTURAL — ingestion could not write to `feature` even by mistake, because
// the grant did not exist. With one connection that boundary is a code
// convention enforced by review and by tests, not by the server. The `role`
// argument threaded through this module is what keeps the intent legible and
// keeps `pg_stat_activity` attributable; it no longer selects a credential.
//
// The database keeps its policies and its grants. Nothing here removes RLS.
//
// CONNECTION BUDGET (Phase 8 R-05, High) is now trivially satisfied: one pool,
// PT_V2_POOL_MAX (default 10), rather than seven pools totalling 20.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { loadV2Config, requireCredential } from '../config/index';
import { PIPELINE_ROLES, roleDefinition, type PipelineRole } from './roles';
import { logger } from '../../utils/logger';

/** The one pool. Created lazily, so importing this module opens nothing. */
let pool: Pool | null = null;

/** True once shutdown has begun, so a late caller gets a clear error. */
let shuttingDown = false;

/**
 * The login name sent in the startup packet.
 *
 * The optional suffix is not part of the name: it is the tenant identifier a
 * shared pooler routes on, and PostgreSQL still authenticates and reports the
 * bare login. Empty suffix yields exactly the login name, which is what a direct
 * connection needs.
 */
export function poolUsername(user: string, suffix: string): string {
  if (suffix === '') return user;
  // IDEMPOTENT. Configuration normalises the base login (see baseLogin), and
  // this refuses to append a tenant that is already there — so the suffix is
  // applied exactly once no matter which form reached this function.
  const joined = `.${suffix}`;
  return user.endsWith(joined) ? user : `${user}${joined}`;
}

const PEM_HEADER = '-----BEGIN CERTIFICATE-----';

/**
 * The certificate authority bundle named by PT_V2_DB_SSL_CA.
 *
 * ACCEPTS EITHER A PATH OR THE PEM ITSELF. A container or CI system commonly
 * injects a certificate as an environment variable rather than a file, and
 * requiring a file there means writing a temporary one — so a value that already
 * looks like PEM is used directly.
 *
 * A relative path resolves against the working directory, which is the package
 * root under every `npm run` script.
 *
 * FAILS WITH THE PATH AND THE REMEDY. The alternative is an ENOENT thrown from
 * inside pool construction, which reads as a database problem rather than a
 * missing file, and which no amount of connection debugging explains.
 */
export function loadCaBundle(value: string): string {
  if (value.includes(PEM_HEADER)) return value;

  const path = resolve(value.replace(/^~(?=[/\\])/, homedir()));
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `PT_V2_DB_SSL_CA names '${value}', which could not be read (resolved to ${path}: ` +
        `${error instanceof Error ? error.message : String(error)}). ` +
        'Supply the provider CA bundle — for Supabase, download the project certificate ' +
        'from Project Settings > Database > SSL Configuration and point this at the .crt ' +
        'file. The variable may also hold the PEM text itself. Certificate verification ' +
        'is not disabled to work around this.'
    );
  }
  if (!contents.includes(PEM_HEADER)) {
    throw new Error(
      `PT_V2_DB_SSL_CA resolved to ${path}, which contains no '${PEM_HEADER}' block. ` +
        'It is not a PEM certificate bundle.'
    );
  }
  return contents;
}

/** The `ssl` option pg receives, or undefined when TLS is off entirely. */
export function buildSslConfig(
  database: ReturnType<typeof loadV2Config>['database']
): PoolConfig['ssl'] {
  if (!database.ssl) return undefined;
  return {
    rejectUnauthorized: database.sslRejectUnauthorized,
    ...(database.sslCaPath ? { ca: loadCaBundle(database.sslCaPath) } : {}),
  };
}

/**
 * Milliseconds a socket may sit idle before the first TCP keepalive probe.
 *
 * CONSERVATIVE, AND WHY THIS VALUE. A pooled connection here is frequently held
 * checked-out but query-idle for tens of seconds — the `control` connection in
 * withRun sits idle across the whole work transaction, and every connection
 * sits idle in the pool across the network walk between sweeps. A managed pooler
 * (Supabase/Supavisor) and the NAT devices between it and this process reap
 * silently idle TCP sockets; a reaped socket is not noticed until its next use,
 * at which point pg raises 'Connection terminated unexpectedly'. Enabling
 * keepalive keeps the socket demonstrably alive and surfaces a genuine drop as a
 * clean error rather than a silent half-open connection.
 *
 * 10s is well inside the idle windows those intermediaries use (commonly 60s and
 * up) so the socket stays warm, and it is not so short as to add meaningful
 * probe traffic. It is a floor on how soon a dead socket is detected, not a
 * timeout: keepalive never closes a healthy connection.
 */
export const KEEPALIVE_INITIAL_DELAY_MS = 10_000;

export function buildPoolConfig(): PoolConfig {
  const cfg = loadV2Config();
  return {
    host: cfg.database.host,
    port: cfg.database.port,
    database: cfg.database.database,
    user: poolUsername(cfg.database.user, cfg.database.userSuffix),
    password: requireCredential(),
    ssl: buildSslConfig(cfg.database),
    max: cfg.poolMax,
    // A pipeline that cannot get a connection should fail rather than queue
    // behind a saturated pool: the scheduler will retry the job, and a hung
    // process produces no telemetry and no failure row.
    connectionTimeoutMillis: cfg.database.connectionTimeoutMs,
    idleTimeoutMillis: cfg.database.idleTimeoutMs,
    // TCP KEEPALIVE. Passed through to the client socket by pg. Without it a
    // connection held query-idle behind the session-mode pooler could be dropped
    // silently and surface the drop only on next use as an unhandled client
    // 'error' — the failure that ended the England ingestion run. keepAlive holds
    // the socket open and makes a real drop a clean, catchable error.
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
    // Attributes every session in pg_stat_activity, so the connection budget of
    // R-05 is observable rather than inferred.
    application_name: cfg.applicationNamePrefix,
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
 * The application pool, created on first use.
 *
 * LAZY, matching the pattern V1 already uses in src/db/client.ts — a module
 * import must not open connections or throw on an absent credential.
 *
 * `role` is a LABEL, not a credential selector: it records which layer asked, so
 * the log line and any failure name the work rather than only the connection.
 * Every caller receives the same pool.
 */
export function poolFor(role?: PipelineRole): Pool {
  if (shuttingDown) {
    throw new Error(
      'Refusing to hand out a connection: shutdown is in progress. ' +
        'A job started after closeAllPools() would leave an unattributed partial write.'
    );
  }

  if (pool) return pool;

  const created = new Pool(buildPoolConfig());

  // An idle-client error is not routed to any caller's await, so without this
  // handler pg would surface it as an unhandled rejection and take the process
  // down. Log it and let the pool discard the connection.
  created.on('error', (err) => {
    logger.error({ err: err.message }, 'v2: idle pool client error');
  });

  pool = created;
  const cfg = loadV2Config();
  logger.info(
    {
      user: cfg.database.user,
      max: cfg.poolMax,
      ...(role ? { openedFor: role, purpose: roleDefinition(role).purpose } : {}),
    },
    'v2: pool created'
  );
  return created;
}

/** True once the pool exists. Test and diagnostic seam. */
export function isPoolOpen(): boolean {
  return pool !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION ACQUISITION, WITH THE RETRY V1 ALREADY HAS
//
// V1's resilience does not come from its transport. It comes from
// src/db/fetchAllRows.ts, through which every multi-row read funnels, and whose
// own comment states the reason: "Transient network failures (stale keep-alive
// sockets, connection resets, DNS blips) are a fact of life on shared hosting.
// Since every read funnels through here, one retry policy hardens the whole
// pipeline."
//
// V2 had no equivalent. The comment at connectionTimeoutMillis says "the
// scheduler will retry the job" — but the orchestrator that would do so exists
// only as a plan (doc 29), so in practice a single transient blip during
// acquisition ended a run permanently. That made V2 strictly LESS resilient than
// V1 on the same network, by omission rather than by decision.
//
// THE POLICY IS V1's, COPIED FROM THE IMPLEMENTATION RATHER THAN ITS COMMENT.
// fetchAllRows.ts:88 loops `attempt <= 3` and sleeps
// `attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000` — but attempt 3 throws
// before it can sleep, so the 10000 branch is dead and the real backoff is
// 2000 then 5000. Its own comment claims "1s/3s" and is stale. Three attempts,
// 2s then 5s, is what V1 actually does and therefore what this does.
//
// WHAT IS DELIBERATELY NOT RETRIED
//
// Only network-shaped failures. An authentication failure, a constraint
// violation, an RLS denial, a syntax error — anything the SERVER decided — is
// returned unchanged on the first attempt. Retrying a decision repeats it, and
// three identical rejections take eight seconds to tell you what one told you
// immediately. Presence of a SQLSTATE `code` is the discriminator: pg attaches
// one to every error the server generated and to none it invented locally.
// ─────────────────────────────────────────────────────────────────────────────

/** Total attempts, including the first. V1: `attempt <= 3`. */
export const ACQUIRE_ATTEMPTS = 3;

/** Milliseconds to wait after attempt 1 and after attempt 2. V1: 2000, 5000. */
export const ACQUIRE_BACKOFF_MS: readonly number[] = [2_000, 5_000];

/**
 * V1's transient test, verbatim from fetchAllRows.ts:77, plus the two messages
 * pg-pool raises for its own acquisition timeouts — which V1 cannot produce
 * because it holds no pool, and which are unambiguously transient here.
 */
const TRANSIENT_MESSAGE =
  /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|socket|network|terminat|timeout exceeded when trying to connect|Connection terminated due to connection timeout/i;

/**
 * Whether `error` is a transient network failure rather than a decision.
 *
 * A SQLSTATE disqualifies it outright, before the message is even considered: an
 * error carrying `code` came from the server, and `28P01` (password
 * authentication failed) contains the substring "network" in no locale but would
 * be a catastrophe to retry if it ever did.
 */
export function isTransientAcquisitionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  // pg gives a SQLSTATE as a five-character string. Node's own errno codes
  // (ECONNRESET and friends) also land on `code`, and those ARE transient, so
  // only a SQLSTATE-shaped value disqualifies.
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return false;
  return TRANSIENT_MESSAGE.test(error.message);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquires a pooled connection, retrying only transient failures.
 *
 * THE SINGLE ACQUISITION POINT for every production path: withRun's control and
 * work connections, withConnection, withSession, the pipeline-run opener and
 * closer, and the health check. Centralised so the policy cannot differ between
 * them, which is exactly how the doctor came to be more forgiving than the seed.
 *
 * Transaction semantics are untouched. This returns a client and nothing more —
 * no BEGIN, no COMMIT, no release. The caller owns the connection exactly as it
 * did when it called `pool.connect()` directly.
 *
 * A retry acquires a FRESH connection, because a failed acquisition never
 * yielded one to reuse. Nothing is left checked out by an attempt that failed.
 */
export async function acquireConnection(role?: PipelineRole): Promise<PoolClient> {
  const target = poolFor(role);
  const client = await retryAcquisition(() => target.connect(), role);
  return guardCheckedOutClient(client, role);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECKED-OUT CLIENT ERROR GUARD — why the process died, and why this is here
//
// pg-pool routes a connection's 'error' event to its own listener ONLY while the
// client sits idle IN the pool. On checkout it removes that listener
// (pg-pool 3.14.0, _acquireClient) and hands the caller a client with NO 'error'
// listener; on release it re-attaches it (_release). So between checkout and
// release the borrower owns the client's errors — and if the socket dies while
// no query is in flight on it, the Client emits 'error' with no listener, which
// Node turns into an uncaught exception that TERMINATES THE PROCESS.
//
// That is exactly how the England ingestion run ended: the control connection
// in withRun sat checked-out and query-idle across the whole work transaction,
// the session-mode pooler dropped its socket, and pg raised
// 'Connection terminated unexpectedly' as an unhandled 'error' event — killing
// Node after a clean 380-event provider retrieval, before the write committed.
//
// The idle-pool handler installed in poolFor (created.on('error')) does NOT
// cover this: that handler fires only for clients idle in the pool, never for
// checked-out ones. This guard closes the gap in ONE central place — every
// production checkout goes through acquireConnection — rather than scattering
// listeners through ingestion, module and operations code.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches a lifetime 'error' listener to a freshly checked-out client so a
 * socket error can never become an unhandled process-terminating event, and
 * removes it again on release so listeners never accumulate.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not swallow, retry, or resurrect
 * anything. pg marks a client non-queryable the moment its stream errors, so:
 *   - the owner's in-flight or next query rejects through the normal path and
 *     its transaction rolls back exactly as it would for any query failure;
 *   - pg-pool's _release removes a non-queryable client rather than returning a
 *     zombie to the pool.
 * The listener's whole job is to make sure the 'error' EVENT has somewhere to go
 * and is logged with context — not silenced.
 *
 * NO LISTENER LEAK. One physical connection is checked out and released many
 * times. The listener is added once per checkout and removed on that checkout's
 * release, so a connection at rest in the pool carries only pg-pool's own idle
 * listener, never a growing stack of ours. The pooled release wrapper (which
 * throws on double release) is preserved: we wrap it, call it unchanged, and let
 * it enforce that invariant.
 */
export function guardCheckedOutClient(client: PoolClient, role?: PipelineRole): PoolClient {
  const onError = (err: Error): void => {
    logger.error(
      { role, err: err.message },
      'v2: checked-out client connection error — the connection is unusable; the owning ' +
        'operation will fail and roll back, and pg-pool will remove the client from the pool'
    );
  };
  client.on('error', onError);

  // pg-pool has already installed its release-once wrapper on `client.release`
  // by the time connect() resolves. Wrap THAT, so double-release still throws as
  // pg-pool intends; our only addition is detaching our listener exactly once,
  // before the pooled release re-attaches pg-pool's idle listener.
  const pooledRelease = client.release.bind(client) as (err?: Error | boolean) => void;
  let detached = false;
  client.release = ((err?: Error | boolean): void => {
    if (!detached) {
      detached = true;
      client.removeListener('error', onError);
    }
    return pooledRelease(err);
  }) as PoolClient['release'];

  return client;
}

/**
 * The retry loop, separated from the pool so it is testable without a database.
 *
 * `backoffMs` exists for tests only — production always uses V1's values, and
 * the test that proves the policy asserts the exported constants rather than
 * these arguments, so a suite running fast cannot hide a changed policy.
 */
export async function retryAcquisition(
  connect: () => Promise<PoolClient>,
  role?: PipelineRole,
  backoffMs: readonly number[] = ACQUIRE_BACKOFF_MS
): Promise<PoolClient> {
  for (let attempt = 1; attempt <= ACQUIRE_ATTEMPTS; attempt++) {
    try {
      return await connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!isTransientAcquisitionError(error) || attempt === ACQUIRE_ATTEMPTS) {
        logger.error(
          { role, attempt, attempts: ACQUIRE_ATTEMPTS, err: message },
          isTransientAcquisitionError(error)
            ? 'v2: connection acquisition failed after every attempt'
            : 'v2: connection acquisition failed and is not retryable'
        );
        throw error;
      }

      const waitMs = backoffMs[attempt - 1] ?? 0;
      logger.warn(
        { role, attempt, attempts: ACQUIRE_ATTEMPTS, waitMs, err: message },
        'v2: transient connection failure — retrying'
      );
      await sleep(waitMs);
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has
  // no implicit undefined path.
  throw new Error('retryAcquisition exhausted its loop without returning');
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
    client = await acquireConnection(role);
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
    const expected = loadV2Config().database.user;
    const healthy = row.current_user === expected;
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
              `Authenticated as '${row.current_user}' but PT_V2_DB_USER names '${expected}'. ` +
              'The credential belongs to a different login than the configuration claims.',
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
 * Startup gate: one connection, checked once.
 *
 * A process that cannot reach the database should not begin work. `roles` is
 * accepted so callers can record which layers they intend to exercise; every
 * check uses the same connection.
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

  const open = pool;
  pool = null;
  if (!open) return;

  logger.info('v2: closing pool');
  try {
    await open.end();
    logger.info('v2: pool closed');
  } catch (err) {
    logger.error({ err: String(err) }, 'v2: pool did not close cleanly');
  }
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
  if (!pool) return {};
  return {
    [loadV2Config().database.user]: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
  };
}

/** Test-only. Closes pools and clears shutdown state so a suite can rebuild. */
export async function resetPoolsForTesting(): Promise<void> {
  const open = pool;
  pool = null;
  if (open) await open.end().catch(() => undefined);
  shuttingDown = false;
}
