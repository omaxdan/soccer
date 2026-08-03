// ─────────────────────────────────────────────────────────────────────────────
// SEED ORCHESTRATION
//
// ─────────────────────────────────────────────────────────────────────────────
// THERE IS NO SINGLE SEED ROLE, AND THAT IS THE ARCHITECTURE WORKING
//
// Four roles are required, because the privilege matrix of migration 016 assigns
// writes by LAYER rather than by task:
//
//     football vocabularies    -> pt_pipeline_ingestion
//     product entitlements     -> pt_platform_admin
//     feature registry         -> pt_pipeline_feature
//     module registry          -> pt_pipeline_module
//
// pt_platform_admin cannot seed the feature or module registries: it holds
// SELECT, plus UPDATE on five feature registry relations, and no INSERT
// anywhere in feature or module. pt_migration cannot either — it holds SIU on
// three operations relations and nothing else.
//
// A "seed role" holding INSERT across four schemas would be a new principal with
// broader privilege than any pipeline, which the S-3 constraints forbid and
// which would undo the separation §B.7.1 exists to create. So the orchestrator
// opens four connections in turn, each as the role that owns the layer it is
// writing.
//
// ORDER IS FORCED BY THE FOREIGN KEYS, not chosen:
//
//   1. football vocabularies      (currency, country, position)
//   2. product.entitlement_feature      <- module_definition.entitlement_feature_key
//   3. feature registry                 <- references football.subject_kind, context_kind
//   4. module registry                  <- references product.entitlement_feature (2)
//
// Step 2 must precede step 4 or the module seed fails on a foreign key. That is
// not a convention this file invents; it is the reference graph.
// ─────────────────────────────────────────────────────────────────────────────

import { withConnection, withRun } from '../db/tx';
import { withPipelineRun } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { assertRolesConfigured } from '../config/index';
import { closeAllPools } from '../db/pool';
import { roleDefinition, type PipelineRole } from '../db/roles';
import { summarise, type SeedOutcome, type SeedReport } from './helpers';
import { seedVocabularies, verifyMigrationVocabularies } from './vocabulary';
import { seedFeatureRegistry } from './featureRegistry';
import { seedEntitlementFeatures, seedModuleRegistry } from './moduleRegistry';

/** Every role the bootstrap authenticates as. */
export const SEED_ROLES: readonly PipelineRole[] = [
  'pt_pipeline_ingestion',
  'pt_platform_admin',
  'pt_pipeline_feature',
  'pt_pipeline_module',
];

interface SeedStage {
  readonly name: string;
  readonly role: PipelineRole;
  readonly jobKey: string;
  readonly run: (tx: Parameters<Parameters<typeof withRun>[2]>[0]) => Promise<SeedOutcome[]>;
}

/** The stages, in the order the reference graph requires. */
const STAGES: readonly SeedStage[] = [
  {
    name: 'football vocabularies',
    role: 'pt_pipeline_ingestion',
    jobKey: 'seed.vocabulary',
    run: seedVocabularies,
  },
  {
    name: 'product entitlement features',
    role: 'pt_platform_admin',
    jobKey: 'seed.entitlement',
    run: seedEntitlementFeatures,
  },
  {
    name: 'feature registry',
    role: 'pt_pipeline_feature',
    jobKey: 'seed.feature_registry',
    run: seedFeatureRegistry,
  },
  {
    name: 'module registry',
    role: 'pt_pipeline_module',
    jobKey: 'seed.module_registry',
    run: seedModuleRegistry,
  },
];

/**
 * Whether a role may write its own operational telemetry.
 *
 * NOT EVERY SEED ROLE CAN. pt_platform_admin holds SELECT on operations — it
 * READS telemetry and does not produce it, which is a deliberate posture rather
 * than a gap: an administrative principal that could write pipeline runs could
 * also write ones that never happened.
 *
 * The consequence is that the entitlement stage, which must run as that role
 * because it is the only one with INSERT on product, cannot open a pipeline run.
 * It executes unattributed. Recorded as finding S3-1 in
 * docs/db-v2/18-phase8-s3-seed-report.md rather than worked around by widening
 * the role.
 *
 * Derived from the role register rather than hard-coded, so a future grant
 * change is picked up without editing this file.
 */
function canRecordTelemetry(role: PipelineRole): boolean {
  return (roleDefinition(role).access.operations ?? []).includes('I');
}

export interface SeedRunOptions {
  /**
   * Install the S-2 operational layer so the bootstrap is attributed.
   *
   * On by default: a seed is a pipeline execution and there is no reason for it
   * to be the one execution nobody can account for. Tests that assert seeding in
   * isolation pass false.
   */
  readonly attributed?: boolean;
}

/**
 * Runs every seed stage, in order, each as its own role.
 *
 * EACH STAGE IS ONE TRANSACTION. A stage that fails rolls back entirely and the
 * run stops — a half-seeded registry is worse than an unseeded one, because the
 * next attempt would find some rows present and skip them.
 *
 * Stages are NOT wrapped in a single transaction across roles, because they are
 * on different connections as different principals. A cross-stage failure
 * therefore leaves earlier stages committed; re-running is safe and is the
 * intended recovery, which is what makes idempotency load-bearing rather than a
 * nicety.
 */
export async function runAllSeeds(options: SeedRunOptions = {}): Promise<SeedReport> {
  assertRolesConfigured(SEED_ROLES);
  if (options.attributed !== false) installOperationalLayer();

  // Precondition. Thirteen vocabularies belong to the migrations, and the
  // registries reference them by foreign key — a missing code must be reported
  // as a missing code, not discovered as a foreign key violation halfway through
  // a registry seed. Read-only, and run as the one role with SELECT across every
  // design schema.
  await withConnection('pt_platform_admin', verifyMigrationVocabularies);

  const outcomes: SeedOutcome[] = [];

  for (const stage of STAGES) {
    const stageOutcomes = canRecordTelemetry(stage.role)
      ? await withPipelineRun(stage.role, `seed.v2.${stage.jobKey}`, async () =>
          withRun(stage.role, stage.jobKey, async (tx) => stage.run(tx), {
            detail: { stage: stage.name },
          })
        )
      : await withRun(stage.role, stage.jobKey, async (tx) => stage.run(tx), {
          // See canRecordTelemetry(). pt_platform_admin reads operational
          // telemetry and does not produce it, so this stage is unattributed.
          withoutAttribution: true,
        });
    outcomes.push(...stageOutcomes);
  }

  return summarise(outcomes);
}

/**
 * CLI entry point — `npm run seed:v2`.
 *
 * Exits non-zero on failure so a deployment step fails rather than continuing
 * against a half-seeded database.
 */
export async function main(): Promise<void> {
  try {
    const report = await runAllSeeds();
    // eslint-disable-next-line no-console
    console.log(
      `\nv2 seed complete: ${report.totalInserted} inserted, ${report.totalSkipped} already present\n`
    );
    for (const outcome of report.outcomes) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${outcome.relation.padEnd(45)} +${String(outcome.inserted).padStart(3)}  ` +
          `(${outcome.skipped} present)`
      );
    }
    // eslint-disable-next-line no-console
    console.log('');
  } finally {
    await closeAllPools();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 seed FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
