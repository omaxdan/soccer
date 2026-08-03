// ─────────────────────────────────────────────────────────────────────────────
// S-3 Vocabulary & Registry Seeding — public surface
//
//     import { runAllSeeds } from './v2/seed';
//     await runAllSeeds();
//
// Idempotent by construction: every statement is INSERT … ON CONFLICT DO
// NOTHING, and there is no update or delete path in the subsystem. Running it
// once and running it ten times produce the same rows, the same ids and the same
// timestamps.
// ─────────────────────────────────────────────────────────────────────────────

export { runAllSeeds, main, SEED_ROLES, type SeedRunOptions } from './runAll';

export {
  seedVocabularies,
  verifyMigrationVocabularies,
  MIGRATION_OWNED_VOCABULARIES,
  VOCABULARY_COUNTS,
} from './vocabulary';

export {
  seedFeatureRegistry,
  FEATURE_KEYS,
  CALCULATOR_KEYS,
  FEATURE_CONTEXT_PAIRS,
} from './featureRegistry';

export {
  seedEntitlementFeatures,
  seedModuleRegistry,
  MODULE_KEYS,
  ACTIVE_MODULE_KEYS,
  INACTIVE_MODULE_KEYS,
  ENTITLEMENT_KEYS,
  RETIRED_V1_MODULE_KEYS,
} from './moduleRegistry';

export {
  seedRows,
  seedRowsResolvingParent,
  assertVocabularyPresent,
  openEffectivePeriod,
  summarise,
  type SeedOutcome,
  type SeedReport,
} from './helpers';
