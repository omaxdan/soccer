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

// ─────────────────────────────────────────────────────────────────────────────
// RE-ANCHORED. V2 connects the way V1 does: ONE database connection, ONE
// credential, no PT-specific database identity to provision.
//
// The seven pipeline roles were a physical-design construction (R-57/R-58 in
// docs/db-v2/10, a DESIGN document) and appear nowhere in the V2 requirements
// (docs/db-v2/04). They required seven manually provisioned LOGIN roles, seven
// secrets and seven pools to run a system whose product objective is football
// intelligence. They are no longer part of how the application connects.
//
// `PipelineRole` survives as a LABEL — it names the layer a unit of work
// belongs to, which is real and useful in telemetry and in the access register
// that roles.test.ts checks against the deployed grants. It is no longer a
// connection identity and no longer selects a credential.
// ─────────────────────────────────────────────────────────────────────────────

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
  /**
   * Whether TLS certificate verification is enforced. TRUE by default.
   *
   * Exists so that turning verification OFF is a deployment decision that
   * appears in configuration and in `doctor:v2` output, rather than a literal
   * compiled into pool.ts where nothing reports it. A connection that does not
   * verify the server certificate is not protected against interception, and
   * the credential it presents is the one thing on the wire worth stealing.
   */
  readonly sslRejectUnauthorized: boolean;
  /**
   * Optional path to a PEM certificate authority bundle.
   *
   * The correct fix when a managed provider presents a certificate the system
   * trust store does not chain to — as opposed to disabling verification, which
   * is the incorrect fix for the same symptom.
   */
  readonly sslCaPath?: string;
  /**
   * Appended to the login name as `<role>.<suffix>`, or empty for none.
   *
   * WHY THIS EXISTS, AND WHY IT IS NOT A ROLE NAME.
   * Supabase's shared pooler (Supavisor) multiplexes many projects behind one
   * hostname and routes on a tenant identifier carried in the username: without
   * it the pooler answers `ENOIDENTIFIER no tenant identifier provided`. The
   * suffix is therefore CONNECTION ROUTING, not identity — PostgreSQL still
   * authenticates and reports the bare role, which is why `current_user` in the
   * health check is still compared against the role name.
   *
   * Role names remain non-configurable, exactly as roles.ts requires. This
   * configures the envelope the name travels in, not the name.
   *
   * Empty for a direct connection, which needs no tenant.
   */
  readonly userSuffix: string;
  /** The login name. One, for the whole application. */
  readonly user: string;
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
  /** The one application credential, absent until configured. */
  readonly credential?: string;
  /** Maximum pooled connections for the one pool. */
  readonly poolMax: number;
  /** Value of application_name, so pg_stat_activity attributes sessions. */
  readonly applicationNamePrefix: string;
}

/**
 * The default login name.
 *
 * `postgres` is the role a Supabase project already has and whose password the
 * operator already holds — the same practical arrangement V1 operates under.
 * Nothing needs provisioning for V2 to run.
 *
 * A deployment that wants the application to run under a narrower role sets
 * PT_V2_DB_USER. That is a deployment decision with a real consequence either
 * way, and `doctor:v2` reports which one is in force: on Supabase the `postgres`
 * role typically carries BYPASSRLS, which makes row-level policies inert for
 * THIS connection. Policies protecting `anon` and `authenticated` — the ones the
 * requirements are about (doc 04 B8 #33) — are unaffected, because the frontend
 * does not connect as this role.
 */
export const DEFAULT_DB_USER = 'postgres';

/**
 * Milliseconds allowed for one connection attempt to complete.
 *
 * RAISED FROM 10 000 ON MEASUREMENT, not on preference. A staged handshake
 * trace against the deployed Supabase pooler recorded:
 *
 *     1945 ms  TCP connected
 *     2574 ms  server replied 'S' to the SSLRequest
 *     3270 ms  TLS established (TLSv1.3, authorized)
 *    14125 ms  authenticated as postgres, server 17.6
 *
 * The network handshake takes ~3.3 s; the remaining ~11 s is the pooler
 * authenticating and opening its own connection to the tenant database. That is
 * a property of a shared pooler on a cold tenant, not of the network, and no
 * client setting shortens it.
 *
 * WHY 30 000 AND NOT 15 000. The two observed successful connections took
 * 4 259 ms and 14 125 ms. A 15 000 ms budget clears the slower of them by
 * 875 ms — six per cent — which is a coin toss dressed as a configuration
 * value. 30 000 is roughly twice the observed worst case, so a run somewhat
 * worse than anything yet measured still completes.
 *
 * THE ASYMMETRY THAT DECIDES IT. Since acquisition retries (3 attempts, 2s then
 * 5s), a budget that is too SHORT guarantees failure — every attempt is killed
 * at the same deadline, so three tries cannot succeed where one could not. A
 * budget that is too LONG merely delays the report of a genuine outage. The
 * worst case stays bounded at 3 x 30 s + 7 s of backoff.
 *
 * FOR SCALE: V1 sets no network timeout whatsoever, so its reads inherit
 * undici's defaults — minutes, not seconds. 30 s is still an order of magnitude
 * stricter than the path that has been in production all along.
 *
 * No design document specifies a connect timeout; the previous 10 000 was an
 * implementation choice, so raising it contradicts no requirement.
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

/**
 * The BASE login, with any pooler tenant already present removed.
 *
 * THE CONFIGURATION MODEL IS EXPLICIT: `PT_V2_DB_USER` is the base login and
 * `PT_V2_DB_USER_SUFFIX` is the Supavisor tenant, and the two are joined once at
 * connection time. A provider's dashboard hands out the JOINED form
 * (`postgres.<project-ref>`), so an operator who pastes that into
 * `PT_V2_DB_USER` while also setting the suffix would otherwise get
 * `postgres.<ref>.<ref>` — a login matching no role, and a failure that reads as
 * an authentication problem rather than a configuration one.
 *
 * Normalising here rather than at the join keeps the model intact: whichever
 * form was pasted, `database.user` is the base login and the suffix is applied
 * exactly once. It is also idempotent — normalising an already-normal value
 * changes nothing.
 */
export function baseLogin(configured: string, suffix: string): string {
  const user = configured.trim();
  if (suffix === '') return user;
  const joined = `.${suffix}`;
  return user.endsWith(joined) ? user.slice(0, -joined.length) : user;
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

  const secret = process.env.PT_V2_DB_PASSWORD;
  const userSuffix = (process.env.PT_V2_DB_USER_SUFFIX ?? '').trim().replace(/^\.+/, '');

  cached = {
    database: {
      host: host as string,
      port,
      database: database as string,
      ssl: boolFromEnv('PT_V2_DB_SSL', true),
      sslRejectUnauthorized: boolFromEnv('PT_V2_DB_SSL_REJECT_UNAUTHORIZED', true),
      sslCaPath: process.env.PT_V2_DB_SSL_CA || undefined,
      // A leading dot is stripped so that pasting either `ref` or `.ref` from a
      // provider's connection string produces `role.ref` and never `role..ref`.
      userSuffix,
      user: baseLogin(process.env.PT_V2_DB_USER || DEFAULT_DB_USER, userSuffix),
      connectionTimeoutMs: intFromEnv('PT_V2_DB_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS),
      idleTimeoutMs: intFromEnv('PT_V2_DB_IDLE_TIMEOUT_MS', 30_000),
      allowNonSessionPort,
    },
    credential: secret === undefined || secret === '' ? undefined : secret,
    poolMax: intFromEnv('PT_V2_POOL_MAX', 10),
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
export function requireCredential(): string {
  const secret = loadV2Config().credential;
  if (!secret) {
    throw new Error(
      'No database credential configured. Set PT_V2_DB_PASSWORD. ' +
        'This is the ordinary database password for the login named by PT_V2_DB_USER ' +
        `(default '${DEFAULT_DB_USER}') — the same credential V1 operates with. ` +
        'Quote it in .env: an unquoted value containing # is silently truncated.'
    );
  }
  return secret;
}

/** True when this process holds everything it needs to open a connection. */
export function isDatabaseConfigured(): boolean {
  try {
    return loadV2Config().credential !== undefined;
  } catch {
    return false;
  }
}

/**
 * Asserts that the database is configured, before any work begins.
 *
 * Call once at process start, so a misconfiguration surfaces immediately rather
 * than midway through a pipeline run with an operational record already open.
 */
export function assertDatabaseConfigured(): void {
  requireCredential();
}

/** Test-only. Clears the memoised configuration so env changes take effect. */
export function resetV2ConfigForTesting(): void {
  cached = null;
}
