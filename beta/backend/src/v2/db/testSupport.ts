// ─────────────────────────────────────────────────────────────────────────────
// Test support for the V2 connection layer
//
// WHY TESTS SKIP RATHER THAN FAIL WHEN NO DATABASE IS PRESENT
// `npm test` runs `tsc --noEmit && node --test` across the whole backend and is
// expected to pass on a developer machine with no V2 database provisioned. The
// migration strategy requires V1 to keep working throughout (Phase 8 §1.3), and
// a V2 test that fails the shared suite would make V2 work block V1 work — the
// coupling the strangler strategy exists to avoid.
//
// So: when PT_V2_DB_HOST is absent the integration suites skip and say so. When
// it is present they run in full and failures are real. Pure-logic tests — role
// register consistency, port validation, configuration parsing — never skip,
// because they need no database and are the ones most likely to catch a
// refactoring mistake.
//
// CI MUST SET PT_V2_DB_HOST. A skipped suite is not a passing suite, and §12.1
// gates every build on the RLS and connection tests actually executing.
// ─────────────────────────────────────────────────────────────────────────────

import { PIPELINE_ROLES, type PipelineRole } from './roles';
import { isDatabaseConfigured, loadV2Config } from '../config/index';

/** True when this process has enough configuration to reach a V2 database. */
export function hasV2Database(): boolean {
  return Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
}

/**
 * Roles this process can actually authenticate as.
 *
 * Integration tests iterate this rather than PIPELINE_ROLES, so a developer who
 * has provisioned two roles locally gets two roles tested rather than five
 * failures about absent secrets.
 */
export function testableRoles(): PipelineRole[] {
  if (!hasV2Database() || !isDatabaseConfigured()) return [];
  // One connection now serves every layer, so every role label is exercisable
  // whenever the database is configured at all.
  return [...PIPELINE_ROLES];
}

/** A one-line reason for a skip, so the runner output explains itself. */
export function skipReason(): string {
  if (!hasV2Database()) {
    return 'PT_V2_DB_HOST / PT_V2_DB_NAME not set — V2 integration tests skipped';
  }
  if (testableRoles().length === 0) {
    return 'PT_V2_DB_PASSWORD not set — V2 integration tests skipped';
  }
  return '';
}

/**
 * Fails when the environment claims to be CI but no V2 database is configured.
 *
 * Guards against the failure mode where the whole V2 suite silently skips in the
 * pipeline and a green build means nothing was verified.
 */
export function assertCiHasDatabase(): void {
  const isCi = process.env.CI === 'true' || process.env.CI === '1';
  if (isCi && !hasV2Database()) {
    throw new Error(
      'CI is set but no V2 database is configured. The V2 integration suites would skip, ' +
        'and a skipped suite is not a passing suite (Phase 8 §12.1). Provision the test ' +
        'database and set PT_V2_DB_HOST, PT_V2_DB_NAME and PT_V2_DB_PASSWORD.'
    );
  }
}

/** Every role, for tests that assert over the whole register without connecting. */
export function allRoles(): readonly PipelineRole[] {
  return PIPELINE_ROLES;
}

/** Connection summary for test diagnostics, with no secret in it. */
export function connectionSummary(): string {
  if (!hasV2Database()) return '(unconfigured)';
  const { database } = loadV2Config();
  return `${database.host}:${database.port}/${database.database} ssl=${database.ssl}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION-IDENTITY SAFETY GUARD FOR DB-CAPABLE TESTS (S-6 remediation)
//
// The incident: DB-capable test suites gate only on `hasV2Database()` (host +
// name present), so a process whose environment carries PRODUCTION `PT_V2_DB_*`
// (a developer shell or CI that sourced the production `.env`) will run those
// suites against production. The snapshot-sealing tests seed `module_reading`
// directly, which is how 175 anomalous rows reached production on 2026-09-01.
//
// This guard classifies the configured target FROM ENVIRONMENT IDENTITY ALONE —
// no connection, no `loadV2Config()` side effects — so it is a pure function of
// configuration and cannot itself touch a database.
//
// INVARIANT: a production database can NEVER become test-authorized. Production
// is recognized by the STABLE Supabase project (tenant) id — the shared pooler
// host is reused across projects, so host alone cannot classify — and the opt-in
// below is consulted ONLY for an already-recognized non-production identity, so
// no flag can convert production or an unknown target into an accepted one.
// ─────────────────────────────────────────────────────────────────────────────

/** The Supabase project (tenant) id of the production database — the stable invariant. */
const PRODUCTION_TENANT_ID = 'nwxafrvwimoyhcnvvuji';
/** The production Supabase pooler host — a corroborating production signal. */
const PRODUCTION_HOST = 'aws-0-eu-west-1.pooler.supabase.com';

/**
 * The ONLY variable that authorizes running DB tests, and only against an
 * ALREADY-recognized non-production identity. It is necessary, never sufficient:
 * `classifyDatabaseTarget()` decides production/unknown BEFORE this is consulted,
 * so setting it can never accept production or an unrecognized database.
 */
export const TEST_DB_OPT_IN = 'PT_V2_TEST_DB';

export type DatabaseTargetClass =
  | 'absent'
  | 'production'
  | 'recognized-nonproduction'
  | 'unknown';

/** A loopback/local host cannot be the remote production database. */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local')
  );
}

/**
 * Classifies the configured database from environment identity ALONE. Opens no
 * connection and calls no `loadV2Config()` (which validates port and could
 * throw); reads the identity env vars directly so the classification is total.
 */
export function classifyDatabaseTarget(): DatabaseTargetClass {
  if (!hasV2Database()) return 'absent';
  const host = (process.env.PT_V2_DB_HOST ?? '').trim().toLowerCase();
  const suffix = (process.env.PT_V2_DB_USER_SUFFIX ?? '').trim().replace(/^\.+/, '').toLowerCase();

  // Production first, and non-overridable: the tenant id is decisive; the prod
  // pooler host corroborates (a same-host staging project is over-blocked, which
  // is the fail-closed side to err on).
  if (suffix === PRODUCTION_TENANT_ID) return 'production';
  if (host === PRODUCTION_HOST) return 'production';

  // Positively recognized non-production.
  if (isLoopbackHost(host)) return 'recognized-nonproduction';

  // A remote host we cannot positively classify as non-production is refused.
  return 'unknown';
}

/**
 * The HARD safety boundary. Throws — never returns — when the configured target
 * is production or unknown/ambiguous, before any connection is opened. No
 * override can pass production. Safe to call from the test-runner preload and
 * from the per-suite gate; it is the single authoritative enforcement point.
 */
export function assertDatabaseTargetSafe(): void {
  const target = classifyDatabaseTarget();
  if (target === 'production') {
    throw new Error(
      'REFUSING to run DB-capable tests: the configured database is the PRODUCTION ' +
        'identity (Supabase project id / pooler host). This is NEVER overridable — ' +
        'no environment flag authorizes it. Unset PT_V2_DB_* or point them at a local ' +
        `test database. (${connectionSummary()})`
    );
  }
  if (target === 'unknown') {
    throw new Error(
      'REFUSING to run DB-capable tests (fail-closed): PT_V2_DB_* is set but the database ' +
        'identity is not positively recognized as non-production. Only a loopback/local test ' +
        'database is accepted; extend the recognized-non-production allowlist in testSupport.ts ' +
        `for a known CI database rather than overriding. (${connectionSummary()})`
    );
  }
  // 'absent' and 'recognized-nonproduction' may proceed.
}

/**
 * The single gate DB-capable suites use in place of the former inline
 * `Boolean(PT_V2_DB_HOST && PT_V2_DB_NAME)`:
 *   1. enforce the hard boundary (production / unknown → throw);
 *   2. skip (return false) when no DB is configured — unchanged behavior;
 *   3. run (return true) ONLY for a recognized non-production identity WITH the
 *      explicit `PT_V2_TEST_DB` opt-in; otherwise skip.
 */
export function testDatabaseReady(): boolean {
  assertDatabaseTargetSafe(); // production / unknown → throw (fail closed)
  if (classifyDatabaseTarget() !== 'recognized-nonproduction') return false; // absent → skip
  const optIn = (process.env[TEST_DB_OPT_IN] ?? '').trim().toLowerCase();
  return optIn === '1' || optIn === 'true';
}
