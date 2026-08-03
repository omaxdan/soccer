// ─────────────────────────────────────────────────────────────────────────────
// V2 PIPELINE ROLES — the seven principals of §B.7.1
//
// WHY SEVEN ROLES AND NOT ONE
// V1 uses a single Supabase service-role key for every job. On Supabase that
// role carries BYPASSRLS, which makes the entire privilege and policy matrix of
// migration 016 inert — every policy verified in Phase 6.1 §14 simply does not
// apply to it. One leaked credential grants unrestricted read and write across
// every table. Phase 7 recorded this as AC-06 and SEC-03.
//
// The approved architecture (R-57, A.14, §B.7.1) creates seven roles, each
// holding only the privileges its layer requires. That is what makes the
// following true, and none of it is true under a service key:
//
//   * the calibration role CANNOT create snapshots (R-67)
//   * the ingestion role holds NO UPDATE on the three append-only football
//     relations (P-06 — verified false for football.standing in Phase 6.1 §14.2)
//   * only the retention role holds DELETE on a thinnable relation, and only
//     under the session marker (R-20, R-22)
//
// WHY pt_owner AND pt_migration ARE ABSENT FROM THIS FILE
// Neither is an application principal. pt_owner owns every object and no
// process authenticates as it (§5.17.5, D-15). pt_migration holds data
// definition privilege and is exercised only through the migration process of
// §B.8. Giving application code a handle to either would defeat the separation
// they exist to create.
//
// WHAT THIS FILE DOES NOT DO
// It does not enforce anything. The capability table below is DOCUMENTATION AND
// TEST INPUT, not a runtime check. Enforcement is PostgreSQL's — the grants and
// policies of migration 016, asserted by fn_assert_access_correspondence(). If
// this file and the database ever disagree, the database is right. Duplicating
// the privilege matrix as a runtime guard would be exactly the kind of
// application-side rule the migration specification forbids (§5.4).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seven principals an application process may authenticate as.
 *
 * These strings are the actual PostgreSQL role names created by migration 001.
 * They are not configurable: the architecture names them, the grants of
 * migration 016 are attached to them, and the conformance assertions look for
 * them by name.
 */
export const PIPELINE_ROLES = [
  'pt_pipeline_ingestion',
  'pt_pipeline_feature',
  'pt_pipeline_module',
  'pt_pipeline_calibration',
  'pt_pipeline_projection',
  'pt_retention',
  'pt_platform_admin',
] as const;

export type PipelineRole = (typeof PIPELINE_ROLES)[number];

/** Access modes, matching the notation of migration 016's access specification. */
export type AccessMode = 'S' | 'I' | 'U' | 'D';

/** The seven design schemas. `public` is deliberately not among them. */
export const DESIGN_SCHEMAS = [
  'football',
  'feature',
  'module',
  'snapshot',
  'calibration',
  'product',
  'operations',
] as const;

export type DesignSchema = (typeof DESIGN_SCHEMAS)[number];

export interface RoleDefinition {
  /** The PostgreSQL role name. Fixed by the architecture. */
  readonly role: PipelineRole;

  /**
   * Suffix of the environment variable holding this role's password:
   * PT_V2_DB_PASSWORD_<envSuffix>. The username is NOT configurable, so only
   * the secret varies per deployment.
   */
  readonly envSuffix: string;

  /** One line, for logs and operator error messages. */
  readonly purpose: string;

  /**
   * Schemas this role holds any privilege on, and the modes it holds there.
   *
   * DOCUMENTATION AND TEST INPUT ONLY — see the header. The permission suite in
   * roles.test.ts asserts this table against pg_class.relacl, so a divergence
   * between this file and the deployed grants fails a test rather than
   * surfacing as a silent runtime denial.
   *
   * Where a role's modes differ per relation within a schema (ingestion's
   * SELECT+INSERT-only on the three append-only football relations, retention's
   * DELETE on five relations, calibration's INSERT on two snapshot relations)
   * this records the UNION across the schema. `relationExceptions` records the
   * narrowing, because those exceptions are the load-bearing part.
   */
  readonly access: Partial<Record<DesignSchema, readonly AccessMode[]>>;

  /**
   * Relations where this role's access is narrower than the schema-level entry
   * above. Each is a specific architectural guarantee, cited.
   */
  readonly relationExceptions?: readonly {
    readonly relation: string;
    readonly modes: readonly AccessMode[];
    readonly reason: string;
  }[];

  /**
   * Maximum pooled connections.
   *
   * DELIBERATELY SMALL. Session-mode connections occupy a real backend each and
   * are not multiplexed by a pooler (R-58, and see pool.ts for why session mode
   * is mandatory rather than preferred). Phase 8 R-05 registers connection-slot
   * exhaustion as a High risk: seven pools on a Supabase plan with a direct
   * connection cap will exhaust it if each is sized like an application pool.
   *
   * Pipelines run on a schedule and are largely serial, so a small pool is
   * sufficient. Override per deployment with PT_V2_POOL_MAX_<envSuffix> once the
   * slot budget of §13 Stage 2 is known.
   */
  readonly defaultPoolMax: number;

  /**
   * True when this role depends on state that lives for the life of the SESSION
   * rather than the transaction.
   *
   * Only retention does: R-21's marker is set by fn_run_retention() with
   * set_config(..., false) and must survive statement boundaries within the
   * run. R-58 names this as the reason pipeline connections operate in session
   * mode. A transaction pooler would silently break it — the delete would find
   * no marker and the policy would return zero rows, reporting success.
   */
  readonly requiresSessionState: boolean;
}

/**
 * The role register.
 *
 * Every `access` entry and every `relationExceptions` entry traces to migration
 * 016's access specification; the rule reference is given so a reader can find
 * the authority without leaving this file.
 */
export const ROLE_DEFINITIONS: Readonly<Record<PipelineRole, RoleDefinition>> = {
  pt_pipeline_ingestion: {
    role: 'pt_pipeline_ingestion',
    envSuffix: 'INGESTION',
    purpose: 'Writes schema football from provider feeds.',
    access: {
      football: ['S', 'I', 'U'],
      operations: ['S', 'I'],
    },
    relationExceptions: [
      {
        relation: 'football.standing',
        modes: ['S', 'I'],
        reason:
          'P-06. Append-only lifecycle class, carries the append guard of migration 015. ' +
          'Granting UPDATE would assert a capability the lifecycle class forbids.',
      },
      {
        relation: 'football.player_valuation',
        modes: ['S', 'I'],
        reason: 'P-06. Append-only lifecycle class.',
      },
      {
        relation: 'football.fixture_lifecycle_transition',
        modes: ['S', 'I'],
        reason:
          'P-06. Append-only lifecycle class. A fixture state change is an INSERTED ' +
          'transition, never a column update on the fixture.',
      },
    ],
    defaultPoolMax: 4,
    requiresSessionState: false,
  },

  pt_pipeline_feature: {
    role: 'pt_pipeline_feature',
    envSuffix: 'FEATURE',
    purpose: 'Writes schema feature. Reads football.',
    access: {
      feature: ['S', 'I'],
      football: ['S'],
      operations: ['S', 'I'],
    },
    defaultPoolMax: 4,
    requiresSessionState: false,
  },

  pt_pipeline_module: {
    role: 'pt_pipeline_module',
    envSuffix: 'MODULE',
    purpose: 'Writes schemas module and snapshot. Reads feature, football, calibration.',
    access: {
      module: ['S', 'I'],
      snapshot: ['S', 'I'],
      feature: ['S'],
      football: ['S'],
      calibration: ['S'],
      operations: ['S', 'I'],
    },
    relationExceptions: [
      {
        relation: 'snapshot.snapshot_outcome_link',
        modes: ['S'],
        reason:
          'Outcome linking belongs to calibration (R-67). The module role seals snapshots ' +
          'and does not attach outcomes to them.',
      },
      {
        relation: 'snapshot.snapshot_outcome_link_currency',
        modes: ['S'],
        reason:
          'R-67. The currency companion records which outcome ordinal prevails and is ' +
          'written by calibration alongside the link itself (A.2). The module role reads ' +
          'it and does not write it.',
      },
    ],
    defaultPoolMax: 4,
    requiresSessionState: false,
  },

  pt_pipeline_calibration: {
    role: 'pt_pipeline_calibration',
    envSuffix: 'CALIBRATION',
    purpose:
      'Writes schema calibration, and the two snapshot outcome-link relations only.',
    access: {
      calibration: ['S', 'I'],
      snapshot: ['S', 'I'],
      module: ['S'],
      football: ['S'],
      feature: ['S'],
      operations: ['S', 'I'],
    },
    relationExceptions: [
      {
        relation: 'snapshot.match_snapshot',
        modes: ['S'],
        reason:
          'R-67, THE LOAD-BEARING EXCEPTION. Calibration holds INSERT on the two ' +
          'outcome-link relations AND ON NO OTHER RELATION in schema snapshot. A ' +
          'schema-level default grant would have given the calibration role the ability ' +
          'to CREATE SNAPSHOTS. Do not consolidate this credential with the module role.',
      },
    ],
    defaultPoolMax: 2,
    requiresSessionState: false,
  },

  pt_pipeline_projection: {
    role: 'pt_pipeline_projection',
    envSuffix: 'PROJECTION',
    purpose: 'Refreshes product projections and materialised views.',
    access: {
      product: ['S', 'I', 'U', 'D'],
      football: ['S'],
      feature: ['S'],
      module: ['S'],
      snapshot: ['S'],
      calibration: ['S'],
      operations: ['S', 'I'],
    },
    relationExceptions: [
      {
        relation: 'product.p_landing',
        modes: ['S', 'I', 'U', 'D'],
        reason:
          'B-09. Granted with matching policies in migration 017 — the one place the ' +
          'privilege matrix of 016 could not reach, because the relation is created after ' +
          'it runs. Without the policy every projection refresh failed on its first insert.',
      },
      {
        relation: 'product.p_team_state',
        modes: ['S', 'I', 'U', 'D'],
        reason:
          'B-09. Created in migration 017 like p_landing, and granted with its policies by ' +
          'the same applicator. Projection relations are DISPOSABLE (LC-145) — dropping one ' +
          'loses nothing but recomputation — which is why the projection role holds DELETE ' +
          'here and nowhere else.',
      },
    ],
    defaultPoolMax: 3,
    requiresSessionState: false,
  },

  pt_retention: {
    role: 'pt_retention',
    envSuffix: 'RETENTION',
    purpose:
      'Sole holder of DELETE on thinnable relations, under the retention session marker.',
    access: {
      feature: ['S', 'D'],
      module: ['S', 'D'],
      operations: ['S', 'I'],
    },
    relationExceptions: [
      {
        relation: 'feature.feature_value',
        modes: ['S', 'D'],
        reason:
          'R-20/R-22. The DELETE policy carries the same session-marker condition the ' +
          'append guard enforces, so a delete without the marker is blocked at two layers. ' +
          'Verified in Phase 6.1 §14.3: a delete without the marker removed zero rows.',
      },
      {
        relation: 'feature.feature_lineage',
        modes: ['S', 'D'],
        reason:
          'R-20/R-22. Deleted BEFORE the values it describes: lineage travels with the ' +
          'value it produced (LC-47), and the ON DELETE RESTRICT on the consumed endpoint ' +
          'blocks removal of any value still cited by retained lineage. That ordering is ' +
          'the fix for B-06 and lives in fn_thin_feature_family.',
      },
      {
        relation: 'module.module_reading',
        modes: ['S', 'D'],
        reason:
          'R-20/R-22. The driving relation of the module family. Deleted LAST, after its ' +
          'evidence and evidence items — any other order raises on the RESTRICT chain, ' +
          'which is the point: the ordering is enforced, not assumed. A reading cited by ' +
          'sealed snapshot content cannot be removed at all.',
      },
      {
        relation: 'module.module_evidence',
        modes: ['S', 'D'],
        reason:
          'R-20/R-22. Deleted second in the module family, after its items and before the ' +
          'reading it belongs to.',
      },
      {
        relation: 'module.module_evidence_item',
        modes: ['S', 'D'],
        reason:
          'R-20/R-22. Deleted first in the module family — deepest child first, per ' +
          'fn_thin_module_family.',
      },
    ],
    // Two, not one. Retention itself is a single scheduled pass calling one
    // function and needs no concurrency — but withRun() holds a second
    // connection for the job lifecycle, which must commit outside the work
    // transaction so a failed run still leaves a record (see tx.ts). A maximum
    // of 1 would self-deadlock: the control connection takes the only slot and
    // the work connection waits until connectionTimeoutMillis.
    defaultPoolMax: 2,
    requiresSessionState: true,
  },

  pt_platform_admin: {
    role: 'pt_platform_admin',
    envSuffix: 'ADMIN',
    purpose: 'Reads every schema. Writes governed configuration and vocabulary.',
    access: {
      football: ['S'],
      feature: ['S', 'U'],
      module: ['S'],
      snapshot: ['S'],
      calibration: ['S'],
      product: ['S', 'I', 'U'],
      operations: ['S'],
    },
    relationExceptions: [
      {
        relation: 'feature.feature_value',
        modes: ['S'],
        reason:
          'B-11. The administrative role holds UPDATE on the five feature REGISTRY ' +
          'relations only. feature_value and feature_lineage are append-only and no ' +
          'principal updates them.',
      },
      {
        relation: 'snapshot.match_snapshot',
        modes: ['S'],
        reason:
          'R-69/R-23. No role holds UPDATE or DELETE on any relation in schema snapshot, ' +
          'the administrative and retention roles included. Asserted by ' +
          'fn_assert_security_posture(), verified to raise on breach in Phase 6.1 §14.4.',
      },
      {
        relation: 'operations.failure_resolution',
        modes: ['S', 'I'],
        reason:
          'S-2 finding M-2, granted by migration 019. failure_resolution records the TRIAGE ' +
          'HISTORY of a failure — OPEN, INVESTIGATING, RESOLVED, WONT_FIX — and that is an ' +
          'operator action. Migration 016 granted the administrative role SELECT only on ' +
          'operations, so resolutions had to be written by a pipeline role, and a pipeline ' +
          'resolving its own failures is not oversight. ' +
          'INSERT ONLY: the relation is append-only and carries the guard, so a history is ' +
          'the sequence of its rows and no amendment capability is conferred.',
      },
      {
        relation: 'operations.retention_policy',
        modes: ['S', 'I', 'U'],
        reason:
          'Migration 018 applies SELECT, INSERT and UPDATE here through fn_apply_access: ' +
          'pt_migration seeds the registry and pt_platform_admin maintains it thereafter. ' +
          'This is the ONE operations relation the administrative role writes — every ' +
          'other is read-only to it, because operational telemetry is a record of what ' +
          'happened and is not edited after the fact. ' +
          'FOUND BY THIS FILE\'S OWN PERMISSION TEST on its first run against a deployed ' +
          'database, which is exactly what that test exists for.',
      },
    ],
    defaultPoolMax: 2,
    requiresSessionState: false,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Type guard. Useful at the boundary where a role arrives as a string. */
export function isPipelineRole(value: unknown): value is PipelineRole {
  return typeof value === 'string' && (PIPELINE_ROLES as readonly string[]).includes(value);
}

/**
 * Resolves a role name to its definition.
 *
 * Throws rather than returning undefined: every caller in this codebase has a
 * compile-time-known role, so an unknown one at runtime means a configuration
 * or refactor error worth failing on immediately.
 */
export function roleDefinition(role: PipelineRole): RoleDefinition {
  const def = ROLE_DEFINITIONS[role];
  if (!def) {
    throw new Error(
      `Unknown pipeline role '${role}'. Known roles: ${PIPELINE_ROLES.join(', ')}`
    );
  }
  return def;
}

/** Every role holding any privilege on `schema`. Used by the permission suite. */
export function rolesWithAccessTo(schema: DesignSchema): PipelineRole[] {
  return PIPELINE_ROLES.filter((r) => ROLE_DEFINITIONS[r].access[schema] !== undefined);
}

/**
 * The modes `role` is expected to hold on `schema`, after applying any
 * relation-level narrowing.
 *
 * Returns the schema-level modes when the relation carries no exception. A
 * relation exception REPLACES the schema entry for that relation rather than
 * intersecting with it, which is how migration 016's include_only rules behave.
 */
export function expectedModes(
  role: PipelineRole,
  schema: DesignSchema,
  relation?: string
): readonly AccessMode[] {
  const def = roleDefinition(role);
  if (relation) {
    const qualified = `${schema}.${relation}`;
    const exception = def.relationExceptions?.find((e) => e.relation === qualified);
    if (exception) return exception.modes;
  }
  return def.access[schema] ?? [];
}

/**
 * The environment variable holding this role's password.
 *
 * The role NAME is fixed by the architecture and never comes from configuration
 * — only the secret is deployment-specific. A deployment that could rename the
 * role could also point the application at a role the grants do not describe.
 */
export function passwordEnvVar(role: PipelineRole): string {
  return `PT_V2_DB_PASSWORD_${roleDefinition(role).envSuffix}`;
}

/** The pool-size override variable for this role, if a deployment sets one. */
export function poolMaxEnvVar(role: PipelineRole): string {
  return `PT_V2_POOL_MAX_${roleDefinition(role).envSuffix}`;
}
