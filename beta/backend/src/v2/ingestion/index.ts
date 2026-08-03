// ─────────────────────────────────────────────────────────────────────────────
// S-4 Ingestion foundation — public surface
//
//     import { ingestSchedule } from './v2/ingestion';
//
//     await ingestSchedule();                          // today, attributed
//     await ingestSchedule({ from, to });              // a bounded range
//
// Writes schema football and nothing else, as pt_pipeline_ingestion. Every stage
// is attributed: unlike pt_platform_admin under finding S3-1, the ingestion role
// holds SELECT and INSERT on operations, so there is no unattributed path here.
//
// WHAT THIS SUBSYSTEM DOES NOT DO
//   - calculate features, evaluate modules, seal snapshots, or write calibration
//     (structurally impossible: no USAGE on those schemas)
//   - create vocabulary rows (mapping refuses; it never inserts)
//   - modify the S-3 seeded registries
//   - delete anything (the role holds no DELETE on football at all)
// ─────────────────────────────────────────────────────────────────────────────

export {
  ingestSchedule,
  INGESTION_ROLE,
  type IngestionReport,
  type ScheduleIngestionOptions,
} from './pipeline';

export {
  PROVIDER_CODE,
  loadProviderConfig,
  dailyQuota,
  resetProviderConfigForTesting,
  type ProviderConfig,
} from './provider/config';

export {
  ProviderClient,
  ProviderRequestError,
} from './provider/client';

export {
  ENDPOINTS,
  DELIBERATELY_NOT_INGESTED,
  resolvePath,
  type EndpointKey,
  type EndpointCostClass,
  type EndpointDefinition,
} from './provider/endpoints';

export {
  mapCountry,
  mapCurrency,
  mapLifecycleState,
  mapPosition,
  mapPrimaryPosition,
  mapRegistrationKind,
  mapUnavailabilityKind,
  isUnmappedLifecycle,
  type MappingResult,
} from './mapping/index';

export {
  IngestionCounts,
  insertAppendOnly,
  upsertMutable,
  findByProviderId,
} from './write/index';

export {
  fixturePartitionOn,
  fromUnixSeconds,
  slugify,
  toIsoDate,
  utcDateString,
  nonNegativeInt,
  providerStatusRaw,
} from './normalise';

export { ingestScheduleDate, type StageCounts } from './stages/schedule';

export {
  recordRegistration,
  recordUnavailability,
  recordValuations,
  closeResolvedSpells,
  type BoundaryEvidence,
} from './entities/squad';

export { recordStandings, type StandingVariant } from './entities/standings';
