// ─────────────────────────────────────────────────────────────────────────────
// V2 database access — public surface
//
// Every V2 subsystem imports from here rather than reaching into the modules
// directly, so the seam between S-1 and everything built on it stays visible in
// import statements.
//
// NOTE FOR EVERY CALLER: sessions run with search_path = '' (§5.3.4). ALL SQL
// MUST BE SCHEMA-QUALIFIED — `SELECT … FROM feature.feature_value`, never
// `FROM feature_value`. Unqualified names will not resolve, which is intended.
// ─────────────────────────────────────────────────────────────────────────────

export {
  PIPELINE_ROLES,
  DESIGN_SCHEMAS,
  ROLE_DEFINITIONS,
  isPipelineRole,
  roleDefinition,
  rolesWithAccessTo,
  expectedModes,
  passwordEnvVar,
  poolMaxEnvVar,
  type PipelineRole,
  type DesignSchema,
  type AccessMode,
  type RoleDefinition,
} from './roles';

export {
  poolFor,
  checkHealth,
  checkAllConfiguredRoles,
  closeAllPools,
  installShutdownHandlers,
  poolStats,
  openPoolRoles,
  type HealthReport,
} from './pool';

export {
  withRun,
  withConnection,
  withSession,
  withSavepoint,
  registerJobLifecycle,
  isJobLifecycleInstalled,
  requireJobRun,
  TransactionError,
  type JobRunRef,
  type JobLifecycle,
  type JobContext,
  type JobOutcome,
  type RunOptions,
} from './tx';

export {
  loadV2Config,
  requireCredential,
  configuredRoles,
  assertRolesConfigured,
  validateConnectionTarget,
  SESSION_MODE_PORT,
  type V2Config,
  type V2DatabaseConfig,
} from '../config/index';
