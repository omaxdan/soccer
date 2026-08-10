// ─────────────────────────────────────────────────────────────────────────────
// SEED ORCHESTRATION
//
// ─────────────────────────────────────────────────────────────────────────────
// FOUR STAGES, ONE CONNECTION
//
// The four stages remain four stages. They no longer authenticate as four
// different database roles — the seven-role model was a physical-design
// construction absent from the V2 requirements, and V2 now connects with one
// ordinary credential, as V1 does.
//
// The role attached to each stage is a LABEL, kept because it records which
// layer the stage writes and it attributes the work in operational telemetry:
//
//     football vocabularies    -> ingestion layer
//     product entitlements     -> platform/administrative layer
//     feature registry         -> feature layer
//     module registry          -> module layer
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

// FIRST IMPORT, DELIBERATELY. Reads `.env` before anything else is evaluated —
// including `src/utils/logger`, which V2 modules import and which evaluates V1's
// config module on load. See `../config/env` for why this belongs at the entry
// point and why it must be first.
import '../config/env';

import { withConnection, withRun } from '../db/tx';
import { withPipelineRun } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { assertDatabaseConfigured } from '../config/index';
import { closeAllPools } from '../db/pool';
import { roleDefinition, type PipelineRole } from '../db/roles';
import { summarise, type SeedOutcome, type SeedReport } from './helpers';
import { seedVocabularies, verifyMigrationVocabularies } from './vocabulary';
import { seedFeatureRegistry } from './featureRegistry';
import { seedEntitlementFeatures, seedModuleRegistry } from './moduleRegistry';

/** The layers the bootstrap writes, in order. Labels, not credentials. */
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
 * Derived from the access register, which records what each layer was scoped to
 * hold. The entitlement stage's layer holds SELECT on operations and no INSERT,
 * so that stage runs unattributed — finding S3-1 in
 * docs/db-v2/18-phase8-s3-seed-report.md.
 *
 * With one connection this is no longer enforced by the server; it is retained
 * as the recorded intent, so behaviour did not change silently when the roles
 * did. Whether to attribute all four stages is a separate decision.
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
 * Runs every seed stage, in order.
 *
 * EACH STAGE IS ONE TRANSACTION. A stage that fails rolls back entirely and the
 * run stops — a half-seeded registry is worse than an unseeded one, because the
 * next attempt would find some rows present and skip them.
 *
 * Stages are NOT wrapped in one transaction across all four. That was originally
 * forced by four connections; it is now a deliberate choice, because a failure
 * partway leaves the earlier stages committed and re-running is the intended
 * recovery — which is what makes idempotency load-bearing rather than a nicety.
 */
export async function runAllSeeds(options: SeedRunOptions = {}): Promise<SeedReport> {
  assertDatabaseConfigured();
  if (options.attributed !== false) installOperationalLayer();

  // Precondition. Thirteen vocabularies belong to the migrations, and the
  // registries reference them by foreign key — a missing code must be reported
  // as a missing code, not discovered as a foreign key violation halfway through
  // a registry seed. Read-only.
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
