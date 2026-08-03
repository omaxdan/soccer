# S-3 — Vocabulary & Registry Seeding

Idempotent bootstrap of the governed vocabularies and registries the V2 pipelines reference.

```bash
npm run seed:v2
```

Running it once and running it ten times produce the same rows, the same ids and the same timestamps.

## What this subsystem is, and is not

**Is:** vocabulary seeding, registry seeding, governed codes, idempotent bootstrap.

**Is not:** ingestion, feature calculation, module evaluation, snapshots, calibration. The module registry records *identity and version*; the logic that produces readings arrives in S-6.

## Idempotence

Every statement is `INSERT … ON CONFLICT (<target>) DO NOTHING`. **There is no update path, no upsert path and no delete path in this subsystem, and none may be added.**

Vocabulary and registry rows are historical reference data. A sealed snapshot references the module version in force when it was sealed; a feature value references the definition that produced it. Rewriting either would silently restate what a past claim meant.

Retiring a code is done by closing its `effective_to` — an operation under governance, not something a bootstrap performs.

The conflict target is always named. `ON CONFLICT DO NOTHING` with no target swallows *every* constraint violation, including ones that mean the seed is wrong; naming it keeps a foreign key or check failure loud.

## Four roles, not one

The privilege matrix of migration 016 assigns writes by **layer**, so no single principal can seed everything:

| Stage | Role | Why |
|---|---|---|
| 1. football vocabularies | `pt_pipeline_ingestion` | the only role with INSERT on `football` |
| 2. product entitlements | `pt_platform_admin` | the only role with INSERT on `product` |
| 3. feature registry | `pt_pipeline_feature` | the only role with INSERT on `feature` |
| 4. module registry | `pt_pipeline_module` | the only role with INSERT on `module` |

`pt_platform_admin` holds SELECT on `feature` and `module` (plus UPDATE on five feature registry relations) and **no INSERT**. `pt_migration` holds SIU on three `operations` relations and nothing else. A "seed role" with INSERT across four schemas would be a new principal broader than any pipeline — which the S-3 constraints forbid.

**Order is forced by the reference graph**, not chosen: step 2 must precede step 4, because `module_definition.entitlement_feature_key` is NOT NULL with a foreign key onto `product.entitlement_feature`.

## What is seeded

| Relation | Rows | Note |
|---|---|---|
| `football.currency` | 14 | `minor_unit` matters — a yen valuation divided by 100 is wrong by two orders of magnitude |
| `football.country` | 24 | ISO 3166-1 alpha-2. A **minimum**, not the full 249-entry list |
| `football.position` | 11 | GK, CB, LB, RB, DM, CM, AM, LW, RW, CF, ST |
| `product.entitlement_feature` | 13 | one per module; keys carried from V1 so existing subscriptions keep meaning what they meant |
| `feature.feature_calculator` | 5 | each names the V1 job that computes its features today |
| `feature.feature_definition` | 7 | each traced to the V1 column it represents |
| `feature.feature_definition_context_kind` | 10 | A.11 binding relation |
| `feature.feature_version` | 7 | one per definition, `1.0.0` |
| `module.verdict_composition_version` | 1 | required NOT NULL by `snapshot.match_snapshot` |
| `module.consensus_rule_version` | 1 | required NOT NULL by `snapshot.match_snapshot` |
| `module.module_definition` | 13 | the approved set |
| `module.module_version` | 13 | one per module, `1.0.0` |
| **Total** | **119** | |

**Thirteen vocabularies are seeded by the migrations themselves** (002 and 012) and are *verified, never written*: `subject_kind`, `context_kind`, `provenance_class`, `snapshot_point`, `fixture_lifecycle_state`, `participation_state`, `registration_kind`, `unavailability_kind`, `statistics_domain`, `outcome_dimension`, `calibration_mode`, `module_status`, `failure_class`.

## What is deliberately not seeded

| Relation | Why |
|---|---|
| `football.position_profile` | Its governed meaning is defined by module logic that does not exist until S-6 |
| `module.model_output_type` | No model exists, so no output type is knowable. Not needed until S-7 |
| `feature.feature_source`, `feature_dependency` | Describe calculation inputs. Not knowable until the calculators exist (S-5) |
| `product.plan`, `plan_entitlement` | Commercial configuration — pricing, tiers, billing. A later phase |
| `calibration.outcome_derivation_version` | S-9 |

Seeding any of these now would be inventing data to fill a gap.

## The module set

Thirteen approved modules. Nine carry a V1 counterpart forward and are **active**; four are newly approved, registered with identity and version and **inactive** until S-6 implements them.

Four V1 modules — BTTS by Fatigue, Half-Time Trends, Clean Sheet Probability, Weather Impact — are **retired and not seeded**. Carrying them forward silently would make V1 the source of truth again.

`is_active = false` is the honest state for a registered module with no evaluation logic: it exists, it is addressable, and it produces nothing yet. Registering it active and having it silently emit no readings is the class of silent absence the operational layer exists to make visible.

## Attribution

Seeding runs under the S-2 operational layer, so a bootstrap is accountable like any other pipeline execution.

**Three of the four stages are attributed.** The entitlement stage is not: `pt_platform_admin` holds SELECT on `operations` — it reads telemetry and does not produce it — so a stage running as that role cannot open a pipeline run. Attributability is derived from the role register rather than hard-coded, so a future grant change is picked up automatically. Recorded as finding **S3-1** in `docs/db-v2/18-phase8-s3-seed-report.md`.

## What the database owns

This subsystem validates nothing. Codes, foreign keys, uniqueness, the `feature_key` namespacing, the outcome-dimension conditional — all are PostgreSQL's, and a seed that pre-checked would duplicate a database rule in TypeScript and drift the moment a constraint changed.

An invalid code reaches the database and is refused there. The failure is recorded by the S-2 operational layer with its SQLSTATE and constraint name.

## Testing

```bash
npm test                    # declaration tests only, no database needed
PT_V2_DB_HOST=… npm test    # plus persistence and idempotence
```

Twenty-two tests. The idempotence tests compare **surrogate ids and `created_at` fingerprints**, not just row counts — counts alone would pass even if the seed deleted and re-inserted every row on each run.
