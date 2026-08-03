// ─────────────────────────────────────────────────────────────────────────────
// V2 CONFIGURATION
//
// WHY THIS IS A SEPARATE MODULE AND NOT AN EDIT TO src/config/index.ts
// The migration strategy is a strangler with a shadow pipeline (Phase 8 §1.3):
// V2 is built ALONGSIDE V1, and V1 must continue to function unchanged
// throughout. src/config/index.ts calls process.exit(1) in production when its
// required variables are absent. Adding V2's variables to that list would make
// every existing V1 deployment refuse to start until seven new secrets were
// provisioned — breaking V1 to build V2, which is precisely what the strategy
// exists to avoid.
//
// This module is therefore additive. No V1 file imports it, and nothing in V1
// changes behaviour because it exists.
//
// FAIL-FAST POSTURE
// V2 configuration is validated on first use, not at import. A process that
// only runs V1 jobs must not fail because V2 credentials are absent — during
// the shadow phase both pipelines share a host, and only the V2 entry points
// require V2 configuration. Once loaded, validation is strict and total:
// a missing password for a role a process is about to use is a hard failure
// with a message naming the exact variable, never a silent fallback.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PIPELINE_ROLES,
  passwordEnvVar,
  poolMaxEnvVar,
  roleDefinition,
  type PipelineRole,
} from '../db/roles';

/**
 * The PostgreSQL port that serves SESSION-MODE connections.
 *
 * NOT NEGOTIABLE, and the reason is architectural rather than stylistic.
 * R-58: "Pipeline connections operate in session mode, not transaction-pooled
 * mode, because bulk write paths depend on session-scoped state — including the
 * retention marker of R-21 and the timeout settings of A.15 — that transaction
 * pooling does not preserve."
 *
 * On Supabase, port 5432 is the direct connection and 6543 is the transaction
 * pooler. Pointing a pipeline at 6543 does not fail loudly: the retention
 * marker set by set_config(..., false) simply does not survive to the next
 * statement, the DELETE policy finds no marker, zero rows are removed, and the
 * run reports success. That is the same silent-failure class as B-03, and it is
 * why validateConnectionTarget() below rejects the pooler port outright.
 */
export const SESSION_MODE_PORT = 5432;

/** Ports known to serve pooled rather than session connections. */
const KNOWN_POOLER_PORTS = new Set([6543]);

export interface V2DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /** 'require' in every environment reachable over a network. */
  readonly ssl: boolean;
  /** Milliseconds to wait for a connection from the pool before failing. */
  readonly connectionTimeoutMs: number;
  /** Milliseconds an idle pooled connection is retained before release. */
  readonly idleTimeoutMs: number;
  /**
   * Whether to allow a non-standard port.
   *
   * Escape hatch for local development and CI, where PostgreSQL may run on any
   * port. Never set in a deployed environment: it disables the one check that
   * catches a pipeline pointed at a transaction pooler.
   */
  readonly allowNonSessionPort: boolean;
}

export interface V2Config {
  readonly database: V2DatabaseConfig;
  /** Role → password. Populated only for roles with a configured secret. */
  readonly credentials: Readonly<Partial<Record<PipelineRole, string>>>;
  /** Role → pool maximum, after applying any per-role override. */
  readonly poolMax: Readonly<Record<PipelineRole, number>>;
  /** Value of application_name, so pg_stat_activity attributes sessions. */
  readonly applicationNamePrefix: string;
}

let cached: V2Config | null = null;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received '${raw}'.`);
  }
  return parsed;
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalised = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true;
  if (['false', '0', 'no', 'off'].includes(normalised)) return false;
  throw new Error(`${name} must be a boolean; received '${raw}'.`);
}

/**
 * Rejects a connection target that cannot honour session-scoped state.
 *
 * Separated so the rule is testable without a live database and so the reason
 * appears in the error rather than only in this file.
 */
export function validateConnectionTarget(port: number, allowNonSessionPort: boolean): void {
  if (KNOWN_POOLER_PORTS.has(port)) {
    throw new Error(
      `PT_V2_DB_PORT is ${port}, which is a TRANSACTION POOLER port. V2 pipelines ` +
        'require SESSION-MODE connections (R-58): the retention marker of R-21 and the ' +
        'timeout settings of A.15 are session-scoped and a pooler does not preserve them. ' +
        'A pooled connection does not fail loudly — retention would delete nothing and ' +
        `report success. Use port ${SESSION_MODE_PORT}.`
    );
  }
  if (port !== SESSION_MODE_PORT && !allowNonSessionPort) {
    throw new Error(
      `PT_V2_DB_PORT is ${port}, not the expected session-mode port ${SESSION_MODE_PORT}. ` +
        'If this is a local or CI database on a non-standard port, set ' +
        'PT_V2_ALLOW_NON_SESSION_PORT=true. Never set that in a deployed environment.'
    );
  }
}

/**
 * Loads and validates V2 configuration.
 *
 * Connection parameters are required. Credentials are NOT: a process that uses
 * two roles should not be forced to hold the other five secrets, which is both
 * an operational nuisance and a needless widening of what a compromised host
 * yields. requireCredential() below is where absence becomes an error, at the
 * point of use and naming the role.
 */
export function loadV2Config(): V2Config {
  if (cached) return cached;

  const missing: string[] = [];
  const host = process.env.PT_V2_DB_HOST;
  const database = process.env.PT_V2_DB_NAME;
  if (!host) missing.push('PT_V2_DB_HOST');
  if (!database) missing.push('PT_V2_DB_NAME');
  if (missing.length > 0) {
    throw new Error(
      `V2 database configuration incomplete. Missing: ${missing.join(', ')}. ` +
        'See src/v2/README.md for the full variable list.'
    );
  }

  const allowNonSessionPort = boolFromEnv('PT_V2_ALLOW_NON_SESSION_PORT', false);
  const port = intFromEnv('PT_V2_DB_PORT', SESSION_MODE_PORT);
  validateConnectionTarget(port, allowNonSessionPort);

  const credentials: Partial<Record<PipelineRole, string>> = {};
  const poolMax = {} as Record<PipelineRole, number>;
  for (const role of PIPELINE_ROLES) {
    const secret = process.env[passwordEnvVar(role)];
    if (secret !== undefined && secret !== '') credentials[role] = secret;
    poolMax[role] = intFromEnv(poolMaxEnvVar(role), roleDefinition(role).defaultPoolMax);
  }

  cached = {
    database: {
      host: host as string,
      port,
      database: database as string,
      ssl: boolFromEnv('PT_V2_DB_SSL', true),
      connectionTimeoutMs: intFromEnv('PT_V2_DB_CONNECT_TIMEOUT_MS', 10_000),
      idleTimeoutMs: intFromEnv('PT_V2_DB_IDLE_TIMEOUT_MS', 30_000),
      allowNonSessionPort,
    },
    credentials,
    poolMax,
    applicationNamePrefix: process.env.PT_V2_APP_NAME ?? 'pitchterminal-v2',
  };
  return cached;
}

/**
 * The password for `role`, or a hard failure naming the variable to set.
 *
 * FAIL FAST, AT THE POINT OF USE. A pipeline that starts without its credential
 * and discovers the problem on its first write has already opened a job run and
 * possibly written telemetry; failing at pool construction keeps the failure
 * clean and the message actionable.
 */
export function requireCredential(role: PipelineRole): string {
  const secret = loadV2Config().credentials[role];
  if (!secret) {
    throw new Error(
      `No credential configured for role '${role}'. Set ${passwordEnvVar(role)}. ` +
        'Roles are created NOLOGIN by migration 001; LOGIN and credentials are granted ' +
        'through a secure channel outside version control — a migration file is not a ' +
        'place for a credential.'
    );
  }
  return secret;
}

/**
 * Reports which of the seven roles this process can authenticate as.
 *
 * Startup diagnostic. A process logs this once so an operator can see at a
 * glance whether the host holds more secrets than the work requires — which is
 * a finding, not a convenience.
 */
export function configuredRoles(): PipelineRole[] {
  const { credentials } = loadV2Config();
  return PIPELINE_ROLES.filter((r) => credentials[r] !== undefined);
}

/**
 * Asserts that every role in `required` has a credential.
 *
 * Call once at process start with the roles the process will actually use, so a
 * misconfiguration surfaces before any work begins rather than midway through a
 * pipeline run.
 */
export function assertRolesConfigured(required: readonly PipelineRole[]): void {
  const absent = required.filter((r) => loadV2Config().credentials[r] === undefined);
  if (absent.length > 0) {
    throw new Error(
      `V2 startup validation failed. Missing credentials for: ${absent.join(', ')}. ` +
        `Set ${absent.map(passwordEnvVar).join(', ')}.`
    );
  }
}

/** Test-only. Clears the memoised configuration so env changes take effect. */
export function resetV2ConfigForTesting(): void {
  cached = null;
}
