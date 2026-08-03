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
import { configuredRoles, loadV2Config } from '../config/index';

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
  if (!hasV2Database()) return [];
  try {
    return configuredRoles();
  } catch {
    return [];
  }
}

/** A one-line reason for a skip, so the runner output explains itself. */
export function skipReason(): string {
  if (!hasV2Database()) {
    return 'PT_V2_DB_HOST / PT_V2_DB_NAME not set — V2 integration tests skipped';
  }
  if (testableRoles().length === 0) {
    return 'No PT_V2_DB_PASSWORD_* credentials configured — V2 integration tests skipped';
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
        'database and set PT_V2_DB_HOST, PT_V2_DB_NAME and the PT_V2_DB_PASSWORD_* secrets.'
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
