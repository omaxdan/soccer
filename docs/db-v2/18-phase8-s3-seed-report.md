# PitchTerminal V2 — S-3 Vocabulary & Registry Seeding

Verification report for the S-3 subsystem, `beta/backend/src/v2/seed/`.

**Nothing in the approved schema was changed.** No table was added, no column altered, no constraint touched, no RLS policy weakened, no privilege granted. Every statement the subsystem issues is `INSERT … ON CONFLICT (<target>) DO NOTHING`; there is no update path, no upsert path and no delete path anywhere in it.

**Verified by execution, not by reading.** The database was rebuilt from empty, all nineteen migrations applied, the seed run three times, and the full backend suite run against the result.

---

## 1. Inventory as executed

The S-3 brief required a five-item inventory before implementation. This is that inventory as it stood when coding began, with what actually happened recorded against it.

### 1.1 Vocabulary tables found in migrations

Seventeen code-keyed governed vocabularies exist across the approved schema. **Thirteen are seeded by the migration set itself** — migrations `002_reference_vocabularies.sql` and `012_operations.sql` — and S-3 must not re-seed, amend or re-order them.

| Relation | Migration | Seeded by | S-3 action |
|---|---|---|---|
| `football.subject_kind` | 002 | migration | verify |
| `football.context_kind` | 002 | migration | verify |
| `football.provenance_class` | 002 | migration | verify |
| `football.snapshot_point` | 002 | migration | verify |
| `football.fixture_lifecycle_state` | 002 | migration | verify |
| `football.participation_state` | 002 | migration | verify |
| `football.registration_kind` | 002 | migration | verify |
| `football.unavailability_kind` | 002 | migration | verify |
| `football.statistics_domain` | 002 | migration | verify |
| `calibration.outcome_dimension` | 002 | migration | verify |
| `module.calibration_mode` | 002 | migration | verify |
| `module.module_status` | 002 | migration | verify |
| `operations.failure_class` | 012 | migration | verify |
| `football.currency` | 002 | **empty** | **seed — 14 rows** |
| `football.country` | 002 | **empty** | **seed — 24 rows** |
| `football.position` | 002 | **empty** | **seed — 11 rows** |
| `football.position_profile` | 004 | **empty** | **deliberately not seeded** — §4 |

Eight of the thirteen migration-owned vocabularies are referenced by foreign key from rows S-3 writes. Those eight are checked before any stage runs — see §5.1.

### 1.2 Registry tables found in migrations

| Relation | Migration | S-3 action |
|---|---|---|
| `feature.feature_calculator` | 003 | **seed — 5 rows** |
| `feature.feature_definition` | 006 | **seed — 7 rows** |
| `feature.feature_definition_context_kind` | 006 | **seed — 10 rows** |
| `feature.feature_version` | 006 | **seed — 7 rows** |
| `feature.feature_source` | 006 | not seeded — §4 |
| `feature.feature_dependency` | 006 | not seeded — §4 |
| `module.module_definition` | 008 | **seed — 13 rows** |
| `module.module_version` | 008 | **seed — 13 rows** |
| `module.verdict_composition_version` | 003 | **seed — 1 row** |
| `module.consensus_rule_version` | 003 | **seed — 1 row** |
| `module.model_output_type` | 002 | not seeded — §4 |
| `calibration.outcome_derivation_version` | 003 | not seeded — §4 |
| `product.entitlement_feature` | 011 | **seed — 13 rows** |
| `product.plan` | 011 | not seeded — §4 |
| `product.plan_entitlement` | 011 | not seeded — §4 |

The two composition version registries were **not optional**. `snapshot.match_snapshot` carries `verdict_composition_version_id` and `consensus_rule_version_id` as NOT NULL foreign keys, so with either registry empty nothing can be sealed at all. A sealed snapshot names the composition rule and the consensus rule in force when it was sealed, which is how a later reader tells whether two snapshots were produced under the same rules.

### 1.3 V1 concept → V2 registry entry

**Features.** Every feature seeded traces to a quantity V1 already computes. Nothing is invented.

| V2 `feature_key` | Calculator | V1 origin | Provenance ceiling |
|---|---|---|---|
| `team.home_form` | `form_backfill` | `team_form_history` filtered to `is_home`, surfaced as `team_intelligence.form_index` | DERIVED |
| `team.away_form` | `form_backfill` | `team_form_history` filtered to `NOT is_home` | DERIVED |
| `team.readiness_score` | `team_readiness` | `team_intelligence.readiness_score` | DERIVED |
| `team.rest_advantage` | `fixture_load` | `team_intelligence.rest_days_avg` | **OBSERVED** |
| `team.travel_impact` | `travel_load` | `team_intelligence.travel_fatigue_score` | DERIVED |
| `team.congestion_index` | `fixture_load` | `team_fixture_load` | DERIVED |
| `team.squad_stability` | `squad_continuity` | derived from `team_squads_snapshot` | DERIVED |

Home and away form are held **separately** rather than as one form index with a split flag, because collapsing them destroys the distinction the Home/Away Split module exists to report.

`team.rest_advantage` is the one OBSERVED feature: it is arithmetic over recorded kickoff times, not an estimate. That ceiling is load-bearing — the statement-level provenance trigger of migration 015 (A.12) refuses a derived value claiming a class stronger than the weakest in its lineage.

The five calculators each name the V1 job that computes their features today (`jobs/processForm.ts`, `processTeamIntelligencePartial`, `processTeamFixtureLoad`, `processTeamTravelLoad` / `processMatchTravelIntelligence`, and the `team_squads_snapshot` path). A calculator is the unit of implementation; a feature definition is the unit of meaning. Several features share a calculator where one V1 processor produces them together — which is how the code is organised now, not a shape S-3 imposed.

**Modules.** Nine of the thirteen approved modules carry a V1 counterpart forward; four are newly approved.

| V2 `module_key` | V1 key | Status |
|---|---|---|
| `home_away_split` | `home_away` | active |
| `readiness_tracker` | `readiness` | active |
| `consistency_index` | `consistency` | active |
| `giant_killer_index` | `giant_killer` | active |
| `travel_impact` | `travel` | active |
| `rest_advantage` | `rest` | active |
| `league_goal_profiles` | `league_goals` | active |
| `form_gap_accuracy` | `form_gap` | active |
| `confidence_calibration` | `confidence` | active |
| `squad_stability` | — | **inactive** |
| `historical_advantage` | — | **inactive** |
| `risk_assessment` | — | **inactive** |
| `match_context` | — | **inactive** |

Four V1 modules are **retired and not seeded**: `btts_fatigue`, `halftime`, `clean_sheet`, `weather`. They are recorded in source as `RETIRED_V1_MODULE_KEYS` and asserted absent by the test suite, so their omission is a checked fact rather than an oversight nobody would notice.

**Entitlements.** Thirteen `product.entitlement_feature` rows, one per module, with keys carried across from V1's `FEATURE_BY_MODULE` map so an existing subscription continues to mean what it meant.

### 1.4 Unresolved TODOs in migrations

Eleven `TODO: requires confirmation from Phase 5 schema catalogue` markers remain across migrations 001, 002, 004, 005, 006, 010, 015 and 018. Every one is a **documentation marker** carried forward from the Phase 6.1 remediation, retained deliberately as an open specification ambiguity. **None blocks S-3, and none was resolved or removed by it** — resolving a schema-catalogue ambiguity is not a seed's business.

Two are worth naming because they touch relations S-3 writes or deliberately declines to write:

- **`006_feature_registry.sql:173`** — records that LC-44 (acyclicity over `feature_dependency`) is enforced by the validation assertion of migration 018 rather than by constraint, and that the residual enforcement point needs confirming. It is another reason not to populate `feature_dependency` until the calculators exist: the validation it gates has an open question against it. **S-3 writes no `feature_dependency` row, so nothing it does depends on the answer.**
- **`002_reference_vocabularies.sql:140`** — the snapshot point set is an open decision (Phase 4 D8; doc 08 §5.25.4) and the four seeded points are the architecture's proposal. `football.snapshot_point` is migration-owned, so S-3 **verifies** those four codes and writes none of them. If the set changes before production, it changes in the migration and the verification list in `vocabulary.ts` follows it.

The remaining nine concern extensions, football entity shape, fixture shape, snapshot commentary, trigger scope and the pg_cron maintenance cadence. None touches a relation S-3 reads or writes.

`014_constraints.sql:91` mentions a TODO only to record that it was **resolved and withdrawn** during Phase 6.1. It is not open.

### 1.5 Seed execution order

Order is **forced by the reference graph**, not chosen:

```
1. football vocabularies   (currency, country, position)     pt_pipeline_ingestion
2. product entitlements    (entitlement_feature)             pt_platform_admin
3. feature registry        (calculator → definition →        pt_pipeline_feature
                            context binding → version)
4. module registry         (composition versions →           pt_pipeline_module
                            definition → version)
```

Step 2 must precede step 4 because `module.module_definition.entitlement_feature_key` is NOT NULL with a foreign key onto `product.entitlement_feature`. Step 3's internal order is likewise forced: `feature_definition` resolves `feature_calculator_id`, and both `feature_definition_context_kind` and `feature_version` resolve `feature_definition_id`.

Preceding all four is a read-only precondition check (§5.1).

---

## 2. Approved decisions and how each was implemented

Three decisions were put to the architecture owner before implementation. All three were answered, and two of the answers overrode the framing offered.

### Decision 1 — vocabulary scope

> *Seed a canonical minimum — ISO countries + standard football positions. **Do not seed `position_profile`; defer until governed meaning exists.***

Implemented exactly. `football.currency` (14), `football.country` (24) and `football.position` (11) are seeded; `football.position_profile` is left empty with the reason recorded in source.

The country list is a **minimum, not the full 249-entry ISO set**. Every code is a nation with a league or national side the platform may plausibly cover. Loading all of ISO 3166 would put codes in a governed vocabulary that nothing will ever reference — and a vocabulary nobody governs is precisely the V1 pattern V2 replaces. S-4 adds a code when a competition genuinely requires one, under the same governance.

Two details are deliberate rather than incidental:

- **`minor_unit` is stored on every currency.** JPY subdivides into zero decimal places. A yen valuation divided by 100 is wrong by two orders of magnitude, and a cross-currency comparison without the minor unit is a comparison of different things.
- **`position_group` is stored explicitly** rather than derived from the code. V1 got this wrong once by prefix-matching position codes, where `'RB'` matched on `'R'` and dropped every full-back out of the defensive bucket. Storing the group removes the opportunity.

`SC`/`SCO` is carried alongside `GB`/`GBR` because the Scottish association is distinct from the UK state code, and the competition record needs to name it.

### Decision 2 — product scope

> *Seed `entitlement_feature` only. **Do not seed `product.plan` or `plan_entitlement` in S-3.***

Implemented exactly. Thirteen entitlement features, no plans, no plan entitlements.

`entitlement_feature` was not optional — `module_definition.entitlement_feature_key` is NOT NULL with a foreign key onto it, so the module registry cannot exist without it. Plans and plan entitlements are commercial configuration: pricing, tiers, billing. S-3 establishes what features exist and which module requires which; it does not establish what anything costs.

Every entitlement row's `meaning` names `product.fn_resolve_entitlements` as the sole resolution path (F-21), so the constraint is recorded where the next reader will find it.

### Decision 3 — module registration

> *Seed the approved 13 module set. **Register new modules with version identity but inactive evaluation logic until S-6. Treat omitted V1 modules as retired and do not seed them.***

Implemented exactly. Thirteen definitions and thirteen versions at `1.0.0`; the four newly approved modules carry `is_active = false`; the four omitted V1 modules are absent.

`is_active = false` is the honest state for a registered module with no evaluation logic: it exists, it is addressable, and it produces nothing yet. The alternative — registering it active and having it silently emit no readings — is the exact class of silent absence the S-2 operational layer exists to make visible.

The four new modules are `CONTEXTUAL` with a NULL outcome dimension. Assigning an outcome dimension to a module that produces nothing would assert a measurement intention nobody has designed. `ck_module_definition__outcome_dimension_conditional` enforces both-or-neither, so the pairing is the database's rule and not a convention this seed follows.

Two active modules are also `CONTEXTUAL`, and that is not a lesser status. `consistency_index` reports volatility — a property of a side, not a prediction of a result. `confidence_calibration` measures the platform's own reliability; scoring it against a match result would be a category error.

---

## 3. Findings

### S3-1 — `pt_platform_admin` cannot write its own operational telemetry

**Status: recorded, not worked around. No change requested to the approved schema.**

Seeding runs under the S-2 operational layer, so a bootstrap is accountable like any other pipeline execution. Three of the four stages are attributed. **The entitlement stage is not.**

`pt_platform_admin` is the only role holding INSERT on `product`, so the entitlement stage must run as it. But that role holds `SELECT` on `operations` — it *reads* telemetry and does not produce it. Opening a `pipeline_run` as that role fails with `permission denied for table pipeline_run`, which is how the finding surfaced.

**This is a deliberate posture, not a gap.** An administrative principal able to write pipeline runs could also write ones that never happened, and the operational record would stop being evidence. The correct disposition is to accept that one stage is unattributed, not to widen the role — so the stage runs with `withoutAttribution: true` and the fact is recorded here.

Attributability is derived from the role register rather than hard-coded:

```ts
function canRecordTelemetry(role: PipelineRole): boolean {
  return (roleDefinition(role).access.operations ?? []).includes('I');
}
```

A future grant change is picked up without editing `runAll.ts`, and the register is itself proven against the live catalogue by the S-1 permission suite — so the derivation cannot quietly drift from the database.

**Effect in practice:** thirteen `entitlement_feature` rows exist with no pipeline run naming who wrote them. The rows carry `created_at`, and the run that seeded the modules referencing them *is* attributed, so the bootstrap is bounded in time even where it is unattributed. No later subsystem depends on entitlement attribution.

**Recommendation to the architecture owner: none.** The posture is correct as it stands. If a future phase requires attributed product writes, the instrument is a `pt_pipeline_product` role with INSERT on `product` and `operations`, not an `INSERT` grant added to the administrative role.

### Why there is no single seed role

Not a finding — the architecture working as specified, recorded because it looks like friction and is not.

The privilege matrix of migration 016 assigns writes **by layer**, so no principal can seed everything:

| Stage | Role | Why that role |
|---|---|---|
| football vocabularies | `pt_pipeline_ingestion` | only role with INSERT on `football` |
| product entitlements | `pt_platform_admin` | only role with INSERT on `product` |
| feature registry | `pt_pipeline_feature` | only role with INSERT on `feature` |
| module registry | `pt_pipeline_module` | only role with INSERT on `module` |

`pt_platform_admin` holds SELECT on `feature` and `module`, plus UPDATE on five feature registry relations, and **no INSERT anywhere in either**. `pt_migration` holds SIU on three `operations` relations and nothing else.

A "seed role" holding INSERT across four schemas would be a new principal with broader privilege than any pipeline — which the S-3 constraints forbid, and which would undo the separation §B.7.1 exists to create. The orchestrator therefore opens four connections in turn, each as the role that owns the layer it writes.

Each stage is one transaction. A stage that fails rolls back entirely and the run stops. Stages are **not** wrapped in a single transaction across roles, because they are different principals on different connections — so a cross-stage failure leaves earlier stages committed. Re-running is the intended recovery, which is what makes idempotency load-bearing here rather than a nicety.

---

## 4. What is deliberately not seeded

| Relation | Reason |
|---|---|
| `football.position_profile` | Its governed meaning is defined by module logic that does not exist until S-6. Seeding it now would be inventing a vocabulary to fit a gap. Confirmed by Decision 1. |
| `module.model_output_type` | No model exists, so no output type is knowable. Guessing the codes would be invention. Not needed until S-7 writes `snapshot.snapshot_model_output`. |
| `feature.feature_source` | Describes which football relations a calculation reads. Not knowable until the calculators exist (S-5). |
| `feature.feature_dependency` | Describes which features a calculation consumes. Same reason, plus the open acyclicity marker of §1.4. |
| `product.plan` | Commercial configuration. Confirmed by Decision 2. |
| `product.plan_entitlement` | Commercial configuration. Confirmed by Decision 2. |
| `calibration.outcome_derivation_version` | S-9. Registering a derivation version before any derivation exists would attribute future outcomes to a rule nobody wrote. |

Every one of these is empty because the information does not exist yet, not because seeding it was hard. Populating any of them now would be describing work nobody has done — which is the failure mode S-3's "identity and version only" boundary exists to prevent.

Provider-specific position aliases and country name variants are also **not** seeded. A provider is a source of data, not the owner of the domain model; S-4 ingestion maps provider values onto these canonical references and rejects what it cannot map. Creating vocabulary dynamically from a feed is how V1 accumulated codes nobody governed.

---

## 5. Defects found by execution

Four, all in the S-3 implementation. None in the approved schema — **S-3 produced no migration findings.** Each was found by running the code against a real database, not by reading it.

### 5.1 Cross-schema verification ran under the wrong principal

The precondition check that confirms the migration-owned vocabularies hold the codes the registries reference was first run inside the ingestion stage. It failed with `permission denied for schema module`: `pt_pipeline_ingestion` holds USAGE on `football` and `operations` only, and `module.calibration_mode` is one of the eight vocabularies checked.

**Fix:** extracted `verifyMigrationVocabularies()` and ran it as `pt_platform_admin` via `withConnection`, before any stage. That role is the one principal with SELECT across every design schema — exactly what a cross-schema precondition needs, and exactly why it is the wrong role for the seeding itself.

The check exists at all because a missing vocabulary code must be reported *as* a missing code. Without it, the same condition surfaces as a foreign key violation halfway through a registry seed, naming a constraint rather than the absent code.

### 5.2 Telemetry privilege — finding S3-1

See §3. Found as `permission denied for table pipeline_run` on the entitlement stage.

### 5.3 Select-list ownership was split between helper and caller

`seedRowsResolvingParent` originally took a `parentExpression` and appended the remaining placeholders itself. Callers whose expression already named them produced `INSERT has more expressions than target columns`.

**Fix:** renamed to `selectList` and documented as the **complete** list, positionally matching `columns`, owned entirely by the caller. One place owns the list, and it is the caller — which is also the only place that knows where the resolved parent belongs in the column order.

### 5.4 A test hook assumed an unseeded database

The suite's `before()` hook asserted `totalInserted > 0`. It passed on a clean database and failed the moment the suite ran after `npm run seed:v2` — making the suite depend on arriving at an unseeded database, which no suite should require and nothing guarantees.

**Fix:** the hook seeds to a known end state and asserts nothing about that particular invocation. Idempotence is proven by the *second* and *third* runs against the fingerprint, which is the property that actually matters.

---

## 6. What the database owns, and what the seed does not check

The subsystem validates nothing. It does not check code formats, foreign keys, uniqueness, the `feature_key` namespacing, the outcome-dimension conditional, or provenance ceilings.

All of it is PostgreSQL's:

| Rule | Instrument |
|---|---|
| `feature_key` matches `^(team\|player\|fixture\|competition)\.[a-z0-9_]+$` | `ck_feature_definition__key_namespaced` |
| `value_scale` within 0–12 | `ck_feature_definition__scale_bounded` |
| outcome dimension present iff `OUTCOME_SCORED` | `ck_module_definition__outcome_dimension_conditional` |
| country code is two upper-case letters | `ck_country__code_is_iso3166_1` |
| every referenced vocabulary code exists | foreign keys |
| one effective version at a time | exclusion constraints on `effective_period` |
| a version is never rewritten | append-only guards (R-19/R-20) |

A seed that pre-checked any of these would duplicate a database rule in TypeScript and drift the moment a constraint changed. An invalid code reaches the database and is refused there; the failure is recorded by the S-2 operational layer with its SQLSTATE and constraint name.

The one thing the subsystem *does* check first is the presence of migration-owned vocabulary codes (§5.1) — and that is a precondition on the deployment, not a revalidation of a rule the database already enforces.

**The conflict target is always named.** `ON CONFLICT DO NOTHING` with no target swallows *every* constraint violation, including ones that mean the seed is wrong. Naming the target keeps a foreign key or check failure loud, which is the entire point of letting the database own validity.

---

## 7. Verification

### 7.1 Environment

PostgreSQL 16, rebuilt from empty. All nineteen migrations applied in sequence; `operations.fn_maintain_partitions()` returned 8. Seven pipeline roles configured with distinct credentials. Both conformance assertions — `fn_assert_access_correspondence()` and `fn_assert_security_posture()` — return 0.

### 7.2 First run

`npm run seed:v2` against a freshly migrated database:

```
v2 seed complete: 119 inserted, 0 already present

  football.currency                               + 14  (0 present)
  football.country                                + 24  (0 present)
  football.position                               + 11  (0 present)
  product.entitlement_feature                     + 13  (0 present)
  feature.feature_calculator                      +  5  (0 present)
  feature.feature_definition                      +  7  (0 present)
  feature.feature_definition_context_kind         + 10  (0 present)
  feature.feature_version                         +  7  (0 present)
  module.verdict_composition_version              +  1  (0 present)
  module.consensus_rule_version                   +  1  (0 present)
  module.module_definition                        + 13  (0 present)
  module.module_version                           + 13  (0 present)
```

Twelve relations, 119 rows.

### 7.3 Idempotence

Second and third runs, unchanged database:

```
v2 seed complete: 0 inserted, 119 already present
```

**Counts alone are not the proof.** A seed that deleted and re-inserted every row would report the same counts. The test suite therefore captures a fingerprint of every seeded relation's **surrogate ids and `created_at` values** before and after a repeat run and asserts byte equality. Ids are unchanged, timestamps are unchanged: the rows were not rewritten, they were not touched.

That property is what makes cross-stage recovery safe. A failure in stage 3 leaves stages 1 and 2 committed, and re-running completes the bootstrap without disturbing what already landed.

### 7.4 Tests

Twenty-two tests in `src/v2/seed/__tests__/seed.test.ts`, covering:

- every declared vocabulary and registry set, without a database (declaration tests)
- the four retired V1 module keys are absent
- the four newly approved modules are registered `is_active = false`
- the nine carried-forward modules are `is_active = true`
- entitlement keys match module definitions one-for-one
- every `OUTCOME_SCORED` module names an outcome dimension and every `CONTEXTUAL` one does not
- persistence: exact row counts in all twelve relations
- idempotence: id and `created_at` fingerprint equality across runs
- migration-owned vocabularies are present and were not written by S-3

Full backend suite against a V2 database: **161 tests, 161 pass, 0 fail, 0 cancelled, 0 skipped.**
Without a database: **71 tests, 71 pass** — the integration suites skip rather than fail, so V2 work never blocks V1 work.

`npx tsc --noEmit` clean.

### 7.5 Deliverables

| File | Lines |
|---|---|
| `src/v2/seed/index.ts` | 47 |
| `src/v2/seed/runAll.ts` | 200 |
| `src/v2/seed/helpers.ts` | 197 |
| `src/v2/seed/vocabulary.ts` | 216 |
| `src/v2/seed/featureRegistry.ts` | 298 |
| `src/v2/seed/moduleRegistry.ts` | 382 |
| `src/v2/seed/__tests__/seed.test.ts` | 420 |
| `src/v2/seed/README.md` | 101 |
| **Total** | **1,861** |

`package.json` gained one script, `seed:v2`. No other change outside `src/v2/`. **V1 remains untouched.**

---

## 8. Constraint compliance

| Constraint | Status | Evidence |
|---|---|---|
| No table added | Held | No DDL in the subsystem |
| No column added or altered | Held | No DDL in the subsystem |
| No constraint altered | Held | No DDL in the subsystem |
| RLS not weakened | Held | `fn_assert_security_posture()` returns 0 after seeding |
| No broader privileges granted | Held | Four existing roles used as-is; S3-1 accepted rather than granted around |
| No service role | Held | No reference in `src/v2/` |
| No `supabase-js` | Held | The subsystem imports only from `../db` |
| No role bypass | Held | Every write goes through `withRun(role, …)` |
| Database rules not duplicated in TypeScript | Held | §6 |
| Idempotent | Held | §7.3 |
| Migration-owned vocabularies not re-seeded | Held | Verified, never written — §1.1 |
| V1 untouched | Held | Only `package.json` changed outside `src/v2/` |

---

## 9. Standing after S-3

The registries the later subsystems depend on now exist:

- **S-4 (ingestion)** has `country`, `currency` and `position` to map provider values onto, and a governed vocabulary to reject against rather than extend.
- **S-5 (feature calculation)** has five calculators and seven definitions at version `1.0.0` to attribute values to, and `feature_source` / `feature_dependency` waiting to be populated with what the calculators actually read.
- **S-6 (module evaluation)** has thirteen definitions and thirteen versions to attribute readings to, four of them inactive and awaiting the logic that will justify promoting them.
- **S-7 (snapshots)** has the two composition version registries `snapshot.match_snapshot` requires as NOT NULL. Without them nothing could be sealed.

**Nothing beyond S-3 is implemented.**
