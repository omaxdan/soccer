# PitchTerminal V2 — Phase 6 Migration Implementation Audit

Audit of migrations 001–018 (`v2/migrations/`) against Document 08 Revision 1 (Phase 5.6), Phase 4, and PostgreSQL 16 / Supabase capability.

**Method.** All eighteen files reviewed as one implementation. Every finding names the file, the object, the violated rule, the governing specification reference, and the fix. Findings are classified only as BLOCKER, BEFORE PRODUCTION, OPTIMISATION, or DOCUMENTATION.

---

# Executive Summary

## Status: **FAIL**

The implementation is structurally faithful to the specification — schemas, identity composition, composite partitioned references, sealed posture, trigger inventory and constraint placement all conform. It is not deployable. Eight blockers were found, of which **one prevents the migrations from executing at all**, **two silently disable core guarantees at runtime**, and **two are layer-boundary violations that contradict Phase 4 ownership rules**.

The defects cluster in two places: the interaction between `FORCE ROW LEVEL SECURITY` and privileged functions, which was not considered when F-09 and F-21 were implemented together, and migration 018, which is the least rigorous file in the set.

## Findings by severity

| Severity | Count |
|---|---|
| **BLOCKER** | 8 |
| **BEFORE PRODUCTION** | 8 |
| **OPTIMISATION** | 3 |
| **DOCUMENTATION** | 3 |
| **Total** | 22 |

## Blockers at a glance

| Ref | Finding | File |
|---|---|---|
| B-01 | `btree_gist` operator classes unresolvable — every EXCLUDE constraint fails to create | 001 + 003, 004, 009, 011, 013 |
| B-02 | `FORCE ROW LEVEL SECURITY` defeats the entitlement resolution function; it returns nothing | 016 |
| B-03 | `FORCE ROW LEVEL SECURITY` defeats retention; thinning deletes nothing, silently | 016 + 018 |
| B-04 | `ctid` used to correlate rows across a partitioned relation | 018 |
| B-05 | `VACUUM` invoked inside a PL/pgSQL function | 018 |
| B-06 | Retention statement is `feature_value`-shaped but applied to module relations | 018 |
| B-07 | Layer violation: three `football` relations reference `feature` | 004 |
| B-08 | Layer violation: `product.notification_intent` references `snapshot` | 011 |

---

# Migration-by-migration review

## 001_extensions.sql — **FAIL (B-01)**

Schemas, roles, timeout and timezone settings, and the `search_path = ''` posture are correct and match §B.7.1 and R-57 through R-60. Role creation is idempotent. Credentials are correctly excluded from version control.

**B-01 is seeded here.** `btree_gist` is installed into the `extensions` schema (R-56, correctly), but no migration establishes a `search_path` that includes it, and the roles are explicitly set to `search_path = ''`. Detail under the compatibility audit.

One further observation: `pg_cron` is created but §B.9.6's scheduled operations are left commented out in 018. That is a deliberate deferral, not a defect.

## 002_reference_vocabularies.sql — PASS

No enum types (PD-02, D-13) — verified across all eighteen files. Vocabulary shape is uniform. `fixture_lifecycle_state.is_open` correctly implements the protect-by-default posture (LC-14) with an `UNKNOWN` state seeding it. `module_status.is_engaged` correctly separates INACTIVE from NEUTRAL (LC-69). `provenance_class.strength_rank` supports the propagation assertion (LC-37).

Placement of `snapshot_point` and `currency` in `football` is correct: both are referenced from `football` and the layer rule forbids `football` referencing upward. **This is exactly the reasoning that B-07 shows was not applied consistently.**

The vocabulary-cardinality TODO is a genuine specification ambiguity; see the TODO review.

## 003_versions.sql — PASS with B-01 exposure

All ten version registries share one structure per §5.16.1. Predecessor self-reference is prevented. `uq_model_version__id_model` correctly anticipates the composite reference from `snapshot_model_output`.

Six EXCLUDE constraints here are subject to B-01.

Placement of `model`, `verdict_composition_version`, `consensus_rule_version` and `checksum_algorithm_version` in `module` is justified in the file header and is consistent with §5.3.3 — `snapshot → module` already exists.

## 004_football.sql — **FAIL (B-07)**

Layer-1 discipline is otherwise well observed: no computed attribute on `player`, no sufficiency gate on `provider_statistic`, `provider_statistic` identity correctly includes `affiliation_team_id` (LC-19), coordinates correctly paired and bounded, `player_valuation` correctly append-only with mandatory currency.

**B-07:** three foreign keys reference the `feature` schema — an upward reference the architecture forbids.

## 005_fixture.sql — PASS

The strongest file in the set. Plain partition columns (R-29), composite primary keys including the partition key (C-02), every child reference composite (R-01), `ON UPDATE RESTRICT` used deliberately to make the partition key immutable once children exist, co-partitioned families created in one loop with identical boundaries (§5.11.6), default partitions present on every relation.

`ck_fixture__partition_matches_kickoff` is poorly formed — see O-02.

## 006_feature_registry.sql — PASS

`feature_definition_context_kind` correctly realises R-47. The namespacing check on `feature_key` enforces LC-24 mechanically rather than by convention. `uq_feature_version__id_definition` and `uq_feature_definition__id_subject_kind` correctly anticipate the composite references from `feature_value`. `ck_feature_source__layer_one_only` enforces LC-43 declaratively.

## 007_feature_storage.sql — PASS

The seven mandatory attributes of C-05 are all present and `NOT NULL`. Subject exclusivity check is exhaustive across four kinds and correctly requires `subject_fixture_partition_on` with a FIXTURE subject (R-01). Context obligation check implements LC-39. Context validity is a composite foreign key, not a trigger (R-47) — verified: no context-validation trigger exists in 015.

`ck_feature_value__calculated_not_before_creation` is vacuous — see O-01.

## 008_module_storage.sql — PASS

`ck_module_reading__inactive_is_silent` is a good addition not required by the specification but consistent with it: an INACTIVE reading carries no strength and cites no baseline. `ck_module_definition__dimension_when_scored` correctly ties the outcome dimension to the calibration mode. Deferral of the baseline and evidence foreign keys to 014 is correct given the stage ordering.

## 009_calibration.sql — PASS with B-01 exposure

`uq_published_baseline__id_module_version` correctly realises R-46. `model_canonical_designation` correctly realises A.8 with the EXCLUDE constraint of R-34. `ck_calibration_result__suppressed_has_no_interval` implements LC-132. `measurement_provenance` correctly preserves the contaminated-cohort marking of LC-127.

Four EXCLUDE constraints subject to B-01.

## 010_snapshot.sql — PASS with one deviation (P-01) and one known gap (P-02)

A.2, A.3 and A.6 are all correctly realised. The `snapshot_as_of` binding via `uq_match_snapshot__id_partition_as_of` is exactly right: both operands of the contamination check are foreign-key bound, so neither can drift. The single CASCADE is correctly confined to composition within the sealed aggregate (PD-09). No canonicity attribute on `snapshot_model_output` (R-32) — verified.

**P-01:** `snapshot_verdict` is left unpartitioned, deviating from §5.10.2 which places all snapshot content in the monthly co-partitioned family.

**P-02:** `output_values jsonb` sits outside both circumstances PD-16 permits. Self-flagged in the file.

## 011_product.sql — **FAIL (B-08)**

Entitlement matrix with EXCLUDE (LC-150, LC-151), partial unique index for the live-subscription rule on an unpartitioned relation (LC-152, correctly avoiding F-03), watchlist with composite fixture reference and extended exclusivity check (A.1) — all correct.

`ck_read_model__scoped_content_not_materialised` is a notably good move: it enforces F-05 declaratively at the registry rather than by process discipline.

**B-08:** `notification_intent` references `snapshot.match_snapshot`, a direction §5.3.3 does not permit.

## 012_operations.sql — PASS

Isolation correctly maintained: no outbound foreign key to any authoritative relation. `failure_resolution` correctly modelled as a separate append-only relation rather than a mutable attribute. `formula_versions jsonb` is within PD-16 circumstance 2.

## 013_indexes.sql — PASS with B-01 exposure

Covering indexes correctly ordered subject-then-context-then-definition with `as_of DESC` (§5.11.3). BRIN on `calculated_at` only, correctly not on the partition key (§5.11.5). Partial index on `fixture` is non-unique, correctly avoiding F-03. The outcome-link ordinal-descending index correctly serves R-08.

`ix_player_registration__team_period` uses GiST over a scalar and a range — subject to B-01.

## 014_constraints.sql — PASS with one known gap (P-04)

R-46 and the three cross-scheme composite references are correctly deferred and correctly composite. `constraint_validation_progress` correctly realises the resumable per-partition validation of F-25. The A.9/A.10 patterns are recorded as binding guidance.

**P-04:** the `pipeline_job_run` reference pairs on `sealed_at`, self-flagged.

**D-01:** a CHECK constraint is named with the `fk_` prefix.

## 015_triggers.sql — PASS with one known gap (P-05)

Trigger inventory is closed and correct: exactly the five permitted classes, verified by full-file grep. The sealing guard admits no exception (R-23). The append guard requires both role and marker (R-20). The provenance trigger is statement-level with a transition table (R-50) and correctly exempts lineage-free values by inner join (R-53). No calculation trigger, no registry-lookup trigger, no per-row trigger on any relation above ten million rows (R-49).

**P-05:** transition-table support on partitioned relations, self-flagged.

## 016_security.sql — **FAIL (B-02, B-03)**

RLS enabled and forced on every non-partition relation, partition privileges revoked, policies created before grants, no schema default privileges on `snapshot`, no UPDATE or DELETE granted on `snapshot` to any role — all verified and all correct.

**The file is nonetheless the source of two blockers**, both arising from the same unconsidered interaction: `FORCE ROW LEVEL SECURITY` applies to the table owner, and both the entitlement function and the retention path execute as principals with no policy.

**P-06:** ingestion is granted UPDATE on all `football` relations, including three that carry an append-only guard.

## 017_views.sql — PASS with one defect (P-03)

Read-model registrations are complete and the strategy assignments correctly respect F-05: `landing`, `team` and `match_intelligence` hold scoped content and are not materialised views. Views correctly declare both `security_invoker` and `security_barrier` (F-04). `fn_team_state` correctly realises E5.01–E5.04 as a query rather than a relation, with `DISTINCT ON` returning the prevailing value under the version in force (LC-107).

**P-03:** `mv_module_directory`'s unique index includes a nullable column, which does not guarantee uniqueness and will fail concurrent refresh.

## 018_maintenance.sql — **FAIL (B-03, B-04, B-05, B-06)**

The weakest file in the set. Partition maintenance, the retention policy registry with positive inclusion (PD-19), the quality-check registrations including the A.17 detachment verification, and the coverage and freshness views are all correct.

The retention and freeze functions are not implementable as written.

---

# Correction audit (A.1 – A.17)

| Ref | Correction | Status | Migration(s) | Note |
|---|---|---|---|---|
| **A.1** | Composite FKs to partitioned relations | **Implemented, correct** | 005, 007, 008, 010, 011, 014 | Zero single-column references to a partitioned parent, verified by grep. Redundant unique constraints present on all five parents. Applied consistently including to the FIXTURE subject reference in `feature_value` and `module_reading`, which the correction register did not explicitly enumerate. |
| **A.2** | Outcome revision identity | **Implemented, correct** | 010, 013 | Revision ordinal in the business key; no currency attribute; ordinal succession; append-only currency companion with both endpoint references; supporting index ordinal-descending (R-08). Insert-only posture preserved throughout. |
| **A.3** | Temporal contamination protection | **Implemented, correct** | 010 | Both as-of columns present and NOT NULL; `snapshot_as_of` bound by composite FK to `uq_match_snapshot__id_partition_as_of`; `cited_as_of` bound by the A.1 reference added in 014; same-row check present on both content relations. The equivalent check is also correctly applied one layer down on `module_evidence_item` and `feature_lineage`. |
| **A.4** | Thinning by deletion, not detachment | **Partially implemented — INCORRECT** | 018 | The policy registry and the rule statement are correct. The executable function is not: see B-04 and B-06. Detachment is correctly confined to bounded operational content. |
| **A.5** | Append guard retention exception | **Implemented, correct in the guard — DEFEATED at runtime** | 015, 016, 018 | The guard logic is exactly R-19/R-20: UPDATE raises unconditionally, DELETE requires both role and marker, sealed relations admit no exception. R-22's privilege assertion is registered. However B-03 means the DELETE never reaches the guard. |
| **A.6** | Content checksum storage | **Partially implemented** | 003, 010, 018 | Columns present and NOT NULL; algorithm version registry present and seeded; immutability inherited from the sealed posture. The verification function returns NULL pending the canonical serialisation, which is self-flagged. Storage is correct; verification is not yet operative. |
| **A.7** | Plain partition keys | **Implemented, correct** | 005, 007, 008, 010, 011, 012 | Zero generated columns anywhere in the implementation, verified by grep. Every partition key is either a business key member or denormalised and bound by composite FK. |
| **A.8** | Canonical designation in the registry | **Implemented, correct** | 009, 010 | `model_canonical_designation` with EXCLUDE per output type; no canonicity attribute on the sealed output; R-35's resolution-by-snapshot-as-of documented. Subject to B-01 at creation time. |
| **A.9** | Partitioned index creation pattern | **Implemented as guidance, correct** | 013, 014 | R-41 correctly applied: relations are empty at deployment so indexes are declared normally. The four-stage pattern is recorded in 014 as binding for populated relations. |
| **A.10** | Unique constraint introduction | **Implemented as guidance, correct** | 014 | NOT VALID correctly scoped to CHECK and FOREIGN KEY; index-first pattern for unique on unpartitioned; multi-phase for partitioned. |
| **A.11** | Two triggers replaced by composite FKs | **Implemented, correct** | 006, 007, 009, 014 | Both replacements verified. `published_baseline(id, module_version_id)` makes baseline-version matching declarative with no extra column. `feature_definition_context_kind` makes context validity declarative. Neither trigger exists in 015. Per-row trigger burden on the four largest relations is nil. |
| **A.12** | Statement-level provenance | **Implemented, correct** | 015 | `AFTER INSERT ... REFERENCING NEW TABLE ... FOR EACH STATEMENT`. Single join against lineage. R-53 exemption via inner join. Platform support self-flagged (P-05). |
| **A.13** | `btree_gist` | **Implemented — INCORRECT** | 001 | The extension is installed. It is not resolvable by the sessions that create the constraints depending on it. See B-01. |
| **A.14** | Pipeline role connection model | **Implemented, correct** | 001 | Roles created NOLOGIN with credentials deferred to a secure channel; session-mode requirement and timeout settings documented and applied. |
| **A.15** | Migration timeouts and classes | **Partially implemented** | 001, 014, 018 | Role-level timeouts applied. The transactional/non-transactional split is documented in 014 but **not structurally realised**: 018 places `VACUUM` inside a function rather than in a non-transactional migration unit (B-05). |
| **A.16** | Per-relation snapshot grants | **Implemented, correct** | 016 | Zero `ALTER DEFAULT PRIVILEGES` anywhere. Calibration holds INSERT on the two outcome-link relations only. No role holds UPDATE or DELETE on the schema. Conformance assertion registered. |
| **A.17** | Detachment verification | **Implemented, correct** | 018 | Registered as a BLOCKING quality check with a 365-day cadence and the R-74 fallback documented. |

**Summary: 12 of 17 fully correct; 4 partially implemented; 1 (A.13) implemented but non-functional.** No correction was omitted or misunderstood. The failures are execution defects, not comprehension defects.

---

# PostgreSQL 16 compatibility audit

## B-01 — BLOCKER — `btree_gist` operator classes unresolvable

**File:** `001_extensions.sql`, affecting `003`, `004`, `009`, `011`, `013`
**Objects:** all eleven EXCLUDE constraints, plus `ix_player_registration__team_period`
**Rule violated:** R-54, R-56 · A.13
**Specification:** Doc 08 Rev 1 §A.13

`btree_gist` is installed into the `extensions` schema, correctly per R-56. Its operator classes — `gist_int8_ops`, `gist_text_ops` — are schema-qualified objects. An EXCLUDE constraint of the form `EXCLUDE USING gist (model_id WITH =, effective_period WITH &&)` resolves the operator class for `bigint` by searching the current `search_path`. If `extensions` is not on it, creation fails with *"data type bigint has no default operator class for access method gist"*.

Migration 001 sets `search_path = ''` on every pipeline role and establishes nothing for the migration session. The migrations are therefore dependent on an ambient search path that the implementation does not control and does not set.

**Fix.** Add to 001, after the extension is created and before any dependent object:

```
ALTER ROLE pt_migration SET search_path = 'extensions';
```

and prepend to each migration that creates a GiST-dependent object:

```
SET LOCAL search_path = 'extensions';
```

The `SET LOCAL` form is preferred because it is transaction-scoped and does not depend on role configuration surviving a platform change. Explicit schema-qualified operator classes are the alternative but are considerably more verbose.

## B-04 — BLOCKER — `ctid` correlated across a partitioned relation

**File:** `018_maintenance.sql`, lines 141–152
**Object:** `operations.fn_run_retention()`
**Rule violated:** R-14, R-15 · LC-B
**Specification:** Doc 08 Rev 1 §A.4, §B.9.2

The thinning statement computes `ctid` in a CTE over the partitioned parent and then correlates `t.ctid = r.ctid` in the DELETE. **`ctid` is unique only within a physical relation, not across a partitioned hierarchy.** Two rows in different partitions can share a `ctid`, so the DELETE will match rows it did not select — including rows outside the intermediate band and, potentially, prevailing boundary values.

This is a correctness defect of the most serious kind available to a retention process: it can destroy claims. It directly contravenes §B.9.2's requirement that thinning preserve the prevailing value at every retained boundary.

**Fix.** Correlate on the business key rather than a physical locator. The relation's surrogate key together with its partition key — `(id, as_of)` — is unique across the hierarchy and is already indexed as the primary key:

```
WITH ranked AS (
  SELECT id, as_of, row_number() OVER (...) AS rn
  FROM feature.feature_value WHERE ...
)
DELETE FROM feature.feature_value t
USING ranked r
WHERE t.id = r.id AND t.as_of = r.as_of AND r.rn > 1
```

## B-05 — BLOCKER — `VACUUM` inside a PL/pgSQL function

**File:** `018_maintenance.sql`, line 185
**Object:** `operations.fn_freeze_inactive_partitions(date)`
**Rule violated:** R-61, R-62 · A.15
**Specification:** Doc 08 Rev 1 §A.15, F-19

`VACUUM` cannot execute inside a transaction block, and every PL/pgSQL function body executes within one. The function will fail at runtime with *"VACUUM cannot be executed from a function"*.

The file's own comment at line 194 states this constraint and the implementation then violates it — the note was written and not applied.

**Fix.** Replace the function with a set-returning function that emits the partition names requiring freeze, and have the scheduled non-transactional job iterate and issue `VACUUM (FREEZE, ANALYZE)` per partition from outside any transaction. This preserves F-19's intent — scheduled rather than anti-wraparound freezing — while respecting R-62's requirement that non-transactional operations occupy their own migration or job units.

## B-06 — BLOCKER — retention statement shape does not match its targets

**File:** `018_maintenance.sql`, lines 137–155
**Object:** `operations.fn_run_retention()`
**Rule violated:** R-14
**Specification:** Doc 08 Rev 1 §A.4

The function loops over every THINNED policy row and executes one `format()`-built statement whose `PARTITION BY` clause names `subject_kind_code, subject_team_id, …, feature_definition_id` — columns that exist on `feature.feature_value` and on none of `module.module_reading`, `module.module_evidence` or `module.module_evidence_item`. Three of the five THINNED policies will raise *"column does not exist"*.

The comment acknowledges that "the executable form is generated per relation" but no such generation exists.

**Fix.** Either add a thinning-key column list to `operations.retention_policy` and build the window clause from it, or provide one thinning function per relation family. The former keeps retention data-driven and is consistent with PD-19's registry approach.

## Constructs verified as correct

| Construct | Verdict |
|---|---|
| Range partitioning, monthly and yearly | Correct. Default partitions present throughout. |
| Composite primary keys including partition key | Correct on all nine partitioned families. |
| Composite foreign keys | Correct. Zero single-column references to a partitioned parent. |
| Redundant unique constraints | Correct. Five present, each serving a named composite reference. |
| CHECK constraints | Correct, with two poorly-formed instances (O-01, O-02). |
| FK actions | Correct. RESTRICT/RESTRICT throughout, one CASCADE within the sealed aggregate. |
| Partial unique index on a partitioned relation | Correctly avoided. The only partial unique index is on unpartitioned `product.subscription`. |
| Generated columns | Correctly absent. Zero occurrences. |
| Enum types | Correctly absent. Zero occurrences. |
| Identity columns on partitioned parents | Supported; sequence resides on the parent. |
| BRIN indexes on partitioned relations | Supported; declared on parent, propagate to partitions. |
| Covering indexes with INCLUDE | Supported on unique constraints and plain indexes. |
| Transition tables | Correct form; platform support on partitioned relations unverified (P-05). |
| `security_invoker` views | Supported from PostgreSQL 15. Correctly applied. |
| NOT VALID usage | Correctly scoped to CHECK and FOREIGN KEY only. |
| RLS enable and force | Correct syntax and correct scope. |

---

# Supabase compatibility audit

| Aspect | Verdict |
|---|---|
| Extensions | `btree_gist`, `pgcrypto`, `pg_stat_statements`, `pg_cron` are all within the platform allowlist. Installation into `extensions` is the platform convention. **Subject to B-01.** |
| Custom roles | Creatable. Correctly created NOLOGIN with credentials deferred. |
| Direct connection assumption | Correctly documented (R-57, R-58). Session-mode requirement stated. |
| `auth.users` references | Two FKs in 011. Requires REFERENCES privilege on `auth.users` for the creating role. See P-08. |
| `auth.uid()` in policies | Correctly schema-qualified and correctly wrapped in a scalar subquery, which is the recommended form for policy performance. |
| Owner privileges | `pt_owner` created NOLOGIN and never authenticated as. Correct per §5.17.5. |
| Migration compatibility | Files are transactional except where they should not be. See B-05 and P-09. |
| PostgREST schema exposure | Not addressed in any migration. See P-09. |

## P-08 — BEFORE PRODUCTION — `auth.users` REFERENCES privilege unverified

**File:** `011_product.sql`
**Objects:** `fk_subscription__user`, `fk_watchlist__user`, `fk_user_preference__user`, `fk_notification_intent__user`
**Fix.** Confirm the migration role holds REFERENCES on `auth.users` in the target project, and record the result. If it does not, the grant must be issued by a platform-privileged role before 011 is applied.

## P-09 — BEFORE PRODUCTION — PostgREST schema exposure not configured

**Files:** none — an omission across the set
**Rule:** §5.17.2, §B.7.2
The design places no object in the default exposed schema and intends only `product` to be reachable through the platform's data interface. No migration configures this, and it cannot be configured from within a migration.
**Fix.** Record the required project configuration — exposed schemas limited to `product` — as a deployment step alongside the migration sequence. Without it, either nothing is reachable or more is reachable than intended.

---

# Security audit

## B-02 — BLOCKER — `FORCE ROW LEVEL SECURITY` defeats entitlement resolution

**File:** `016_security.sql`
**Objects:** `product.fn_resolve_entitlements(uuid)`, `product.subscription`, `product.plan_entitlement`, `product.platform_setting`
**Rule violated:** F-21 · F-09
**Specification:** Doc 08 Rev 1 §B.7.2, §B.7.6

`FORCE ROW LEVEL SECURITY` subjects the table owner to its own policies — that is precisely its purpose, and applying it was correct (F-09). `fn_resolve_entitlements` is `SECURITY DEFINER` and owned by `pt_owner`, which is the owner of every relation it reads. It therefore executes subject to policies, and **no policy grants `pt_owner` anything**: the policies on `product.subscription` and `product.plan_entitlement` are scoped `TO authenticated` and `TO anon`.

The function returns the empty set for every principal. The projection policies that consult it then deny all scoped content. Every entitlement-gated read returns nothing, for everyone, silently.

The two corrections were each implemented correctly in isolation and are incompatible as combined.

**Fix.** Add a permissive policy on each relation the resolution path reads, scoped to the function's execution principal:

```
CREATE POLICY pl_subscription__resolver__select ON product.subscription
  FOR SELECT TO pt_owner USING (true);
```

and equivalently on `product.plan_entitlement` and `product.platform_setting`. This keeps FORCE RLS in place — the owner remains subject to policy — while granting the resolution path exactly the read it requires and nothing else. Scoping the policy to a dedicated resolver role rather than `pt_owner` would narrow it further and is preferable if the additional role is acceptable.

## B-03 — BLOCKER — `FORCE ROW LEVEL SECURITY` defeats retention

**File:** `016_security.sql` with `018_maintenance.sql`
**Objects:** `feature.feature_value`, `feature.feature_lineage`, `module.module_reading`, `module.module_evidence`, `module.module_evidence_item`
**Rule violated:** R-14, R-20 · F-09
**Specification:** Doc 08 Rev 1 §A.4, §A.5, §B.9.2

The same interaction, with a worse failure mode. `pt_retention` is granted DELETE on the thinnable relations (correct, R-22) and `fn_run_retention` is `SECURITY INVOKER` so it executes as `pt_retention` (correct). But those relations have RLS enabled and forced, and **no policy exists for `pt_retention`**.

The DELETE therefore matches zero rows and returns success. Retention reports having thinned nothing, every run, without error. The append guard never fires because no row is ever presented to it — so the mechanism intended to prove retention is working is silent for the same reason retention is not working.

Storage grows without bound and the failure is invisible until it is a capacity incident.

**Fix.** Add a delete policy scoped to the retention role, carrying the same session-marker condition the guard enforces, so that the policy and the guard state the same rule:

```
CREATE POLICY pl_feature_value__retention__delete ON feature.feature_value
  FOR DELETE TO pt_retention
  USING (current_setting('pitchterminal.retention_operation', true) = 'true');
```

and equivalently on the other four thinnable relations. The pipeline roles additionally require SELECT and INSERT policies on the relations they write, which the current implementation likewise omits — the same defect applies to every pipeline write path and must be resolved as one change.

## Verified correct

| Control | Verdict |
|---|---|
| RLS enabled on every non-partition relation in all seven schemas | Correct |
| RLS forced on every such relation | Correct |
| Partition privileges revoked from PUBLIC | Correct; F-09's second limb satisfied |
| Policies created before grants | Correct; D-10 satisfied |
| No schema default privileges on `snapshot` | Correct; zero `ALTER DEFAULT PRIVILEGES` anywhere |
| No UPDATE or DELETE on `snapshot` for any role | Correct, verified by grep |
| Calibration INSERT confined to outcome-link relations | Correct; R-67 satisfied |
| Sealing guard admits no exception | Correct; R-23 satisfied |
| Object ownership held by a non-authenticating role | Correct |
| Definer functions fix `search_path` | Correct on all six |

## P-06 — BEFORE PRODUCTION — ingestion granted UPDATE on append-only relations

**File:** `016_security.sql` with `015_triggers.sql`
**Objects:** `football.standing`, `football.player_valuation`, `football.fixture_lifecycle_transition`
**Rule violated:** PR-02 · C-10
**Specification:** Doc 08 Rev 1 §B.9, §5.20.1

016 grants `SELECT, INSERT, UPDATE` on every `football` relation to `pt_pipeline_ingestion` via a loop. Three of those relations are in the append-only lifecycle class and carry the append guard from 015. The guard will reject the UPDATE, so the guarantee holds — but the privilege grant asserts a capability the lifecycle class forbids, which is exactly the drift PR-02 places privilege ahead of guards to prevent.

**Fix.** Exclude the three append-only relations from the loop and grant them `SELECT, INSERT` only.

---

# Performance audit

Only genuine implementation issues are reported.

## P-01 — BEFORE PRODUCTION — `snapshot_verdict` breaks co-partitioning

**File:** `010_snapshot.sql`
**Object:** `snapshot.snapshot_verdict`
**Rule violated:** §5.10.2 · §5.11.6
**Specification:** Doc 08 Rev 1 §B.4.4

Every other relation in the sealed family is monthly range-partitioned on `fixture_partition_on` and included in the co-partitioning loop. `snapshot_verdict` is not, on the stated grounds that it meets fewer than two of §5.10.1's criteria at 1.5 × 10⁶ rows.

The volume reasoning is sound in isolation and wrong in context: §B.13.3's match-intelligence read path depends on partition-wise assembly across the co-partitioned family, and an unpartitioned member forces a join across the whole relation rather than partition-against-partition. The heaviest declared read in the design is degraded to save partitions on its smallest member.

**Fix.** Partition `snapshot_verdict` on `fixture_partition_on` with the same monthly boundaries and add it to the co-partitioning loop and to `fn_maintain_partitions`. Its primary key becomes `(id, fixture_partition_on)` and the existing FK to `match_snapshot` is already composite.

## P-03 — BEFORE PRODUCTION — materialised view cannot refresh concurrently

**File:** `017_views.sql`
**Object:** `ux_mv_module_directory__module_baseline`
**Rule violated:** §5.4.6 · §B.13.4
**Specification:** Doc 08 Rev 1 §5.14.3

The unique index covers `(module_definition_id, published_baseline_id)`, and `published_baseline_id` is nullable because the view is built on LEFT JOINs. Nulls are distinct under standard uniqueness, so the index does not guarantee row uniqueness. `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires genuine uniqueness and will fail where a module has no published baseline and more than one version row.

**Fix.** Either add `NULLS NOT DISTINCT` to the index — supported from PostgreSQL 15 — or restrict the view to modules having a published baseline and expose unbaselined modules through a separate path.

## O-01 — OPTIMISATION — vacuous CHECK constraint

**File:** `007_feature_storage.sql` · **Object:** `ck_feature_value__calculated_not_before_creation`
The constraint permits `calculated_at` up to a century before `as_of`, which excludes nothing meaningful and costs an evaluation on every insert into the largest relation in the design. Either express the intended rule — that `calculated_at` is not before `as_of` except for declared backfill — or remove it.

## O-02 — OPTIMISATION — malformed CHECK constraint

**File:** `005_fixture.sql` · **Object:** `ck_fixture__partition_matches_kickoff`
The first disjunct is subsumed by the second, so the constraint reduces to `fixture_partition_on <= kickoff date`. That is the correct rule for a rescheduled fixture, but it is stated redundantly and the equality case reads as though it were being enforced when it is not.

## O-03 — OPTIMISATION — index redundancy on `feature_value`

**File:** `013_indexes.sql` · **Objects:** `uq_feature_value__subject_context_definition_asof_version`, `ix_feature_value__subject_context_definition_asof`
The unique constraint's supporting index and the covering index share a long leading column prefix. §5.11.1 requires that a constraint's supporting index be ordered to serve the dominant access path so that one structure serves both purposes; here two structures are maintained on a relation projected at 10⁸–10⁹ rows, roughly doubling the index write cost. Assess whether the covering index's `INCLUDE` payload can be attached to the unique constraint instead.

## Assessed and found acceptable

| Concern | Assessment |
|---|---|
| Partition pruning | Every declared read path supplies a partition predicate. Player-scoped appearance reads span partitions by design and execute under a pipeline role, per F-14. |
| FK validation cost | Correctly deferred to 014 with the resumable per-partition mechanism of F-25. |
| Trigger cost | Nil per-row burden on the four largest relations. The lifecycle guard executes once per snapshot. |
| Write amplification | Acceptable given the covering-index trade, subject to O-03. |
| Lock risk at deployment | Nil; all relations are empty. |
| Migration downtime | Nil at initial deployment. |

---

# Documentation findings

## D-01 — DOCUMENTATION — CHECK constraint carries a foreign-key name prefix

**File:** `014_constraints.sql` · **Object:** `fk_calibration_run__pipeline_job_run_present`
**Rule violated:** §5.5.4
The constraint is a CHECK and must be named `ck_calibration_run__pipeline_job_run_present`. A name that misstates a constraint's kind defeats the purpose of the convention, which exists so that constraint inspection does not require reading definitions.

## D-02 — DOCUMENTATION — comment contradicts the code it annotates

**File:** `018_maintenance.sql` · **Object:** `operations.fn_freeze_inactive_partitions(date)`
The comment at line 194 states that `VACUUM` cannot run inside a transaction block; the function body at line 185 executes `VACUUM` inside a PL/pgSQL function, which is always a transaction block. The comment is correct and the code is not (B-05). Once B-05 is fixed the comment becomes accurate and should be retained.

## D-03 — DOCUMENTATION — retention function comment overstates what is implemented

**File:** `018_maintenance.sql` · **Object:** `operations.fn_run_retention()`
The trailing comment states that "the executable form is generated per relation". No such generation exists; one `feature_value`-shaped statement is applied to all five THINNED targets (B-06). The comment describes an intended design rather than the code beneath it, which is the most misleading form a comment can take. Correct it alongside B-06.

---

# Outstanding TODO review

Ten markers across nine files.

| # | File | Subject | Classification | Resolve before production? |
|---|---|---|---|---|
| 1 | 001 | PostGIS not installed pending PG-01 | Harmless documentation note | No — the gated default is correct |
| 2 | 002 | Vocabulary cardinality: §5.9.5 implies many rows per code, §5.4.2 requires one | **Specification ambiguity** | **Yes.** The implementation chose one row per code because the FK requirement is load-bearing. Confirm, then delete the marker. |
| 3 | 002 | Snapshot point set is the architecture's proposal | Specification ambiguity | **Yes.** Phase 4 D8 remains open and determines snapshot volume proportionally. |
| 4 | 004 | `provider_statistic.measures` held as opaque payload | **Specification ambiguity** | **Yes.** Doc 08 specifies domain partitioning but never enumerates measures. Within PD-16 circumstance 1 as written, so not a violation — but it defers a modelling decision that calibration will need. |
| 5 | 005 | `match_event.event_type_code` has no governed vocabulary | Specification ambiguity | No — the relation is conditional on a provider contract that does not exist. Revisit when it does. |
| 6 | 006 | Dependency acyclicity enforced by assertion, not constraint | Harmless documentation note | No — this restates §B.5.4 at the relation it governs. Correct placement. |
| 7 | 010 | `snapshot_model_output.output_values` outside PD-16 | **Architectural issue** | **Yes.** This is a known deviation from PD-16, self-declared. It must become columnar or a per-output-type child relation. |
| 8 | 014 | `pipeline_job_run` reference pairs on `sealed_at` | **Implementation omission** | **Yes.** Requires either a guarantee that the sealing transaction stamps both from one clock read, or a separate `job_run_occurred_at` column. The current form will reject valid inserts whenever the two differ by a microsecond. |
| 9 | 015 | Transition tables on partitioned relations unverified | **Implementation omission** | **Yes.** Pairs with A.17 as a mandatory platform verification. If unsupported, A.12's guarantee has no enforcement. |
| 10 | 018 | Retention windows pending the granularity decision | Specification ambiguity | **Yes** — though the structure is correct at any setting; only the storage envelope moves. |
| 11 | 018 | Checksum canonical serialisation not implemented | **Implementation omission** | **Yes.** A.6's storage is correct but PR-04's fourth control is not operative until the serialisation exists. |
| 12 | 018 | pg_cron schedules commented out | Harmless documentation note | No — scheduling is a deployment decision. |

**Seven require resolution before production.** Three are specification ambiguities inherited from Doc 08 rather than implementation defects; four are genuine implementation omissions.

---

# Final verdict

## **C — Rework required**

The implementation demonstrates faithful comprehension of the specification. All seventeen corrections were understood and sixteen are structurally realised; the schema architecture, identity composition, composite reference strategy, sealed posture, trigger inventory and constraint placement conform without deviation. Verified mechanically: zero enum types, zero generated partition keys, zero single-column references to partitioned parents, zero schema default privileges on `snapshot`, zero UPDATE or DELETE grants on `snapshot`, and exactly the five permitted trigger classes.

It nonetheless cannot be deployed.

**One blocker prevents execution.** B-01 causes every EXCLUDE constraint in the set to fail at creation, in five separate migrations.

**Two blockers silently disable guarantees the architecture depends on.** B-02 and B-03 arise from the same unexamined interaction: `FORCE ROW LEVEL SECURITY` was applied correctly per F-09, and privileged execution paths were designed correctly per F-21 and A.5, but the two were never evaluated together. Neither failure raises an error. Entitlement resolution returns nothing for everyone; retention deletes nothing, forever, reporting success. **This is the most consequential class of defect in the audit**, because both mechanisms are designed to be invisible when working and are indistinguishable from working when broken.

**Two blockers are layer violations** contradicting Phase 4 ownership rules that the rest of the implementation observes carefully — including, in migration 002, correctly placing two vocabularies in `football` for exactly the reason that was then not applied in 004.

**Three blockers sit in migration 018**, which is materially less rigorous than the seventeen files preceding it. Its retention function cannot execute against three of its five targets, correlates rows by a physical locator that is not unique across the partitions it operates on, and invokes `VACUUM` from a context that forbids it — in a file whose own comment states the prohibition.

### Required before re-audit

| Ref | Change |
|---|---|
| B-01 | Establish `extensions` on the migration search path; verify every EXCLUDE constraint creates |
| B-02 | Add resolver-scoped read policies on the three relations `fn_resolve_entitlements` reads |
| B-03 | Add retention-scoped DELETE policies carrying the session-marker condition, and pipeline-scoped SELECT/INSERT policies on every relation a pipeline role writes |
| B-04 | Correlate thinning on `(id, as_of)`, never on `ctid` |
| B-05 | Move `VACUUM` out of the function into a non-transactional job unit |
| B-06 | Make the thinning key data-driven from `retention_policy`, or provide one function per relation family |
| B-07 | Relocate `provenance_class` and `subject_kind` to `football`, or remove the three references from `football` relations |
| B-08 | Remove the `snapshot` reference from `notification_intent`, or route it through a permitted direction |

Eight before-production findings and the seven outstanding TODOs requiring resolution should be addressed in the same cycle.

**Nothing in this audit requires a change to the architecture, the logical model, or any Phase 4 guarantee.** Every fix is a correction to the SQL.

---

## Document control

| | |
|---|---|
| **Phase** | 6 — Migration Implementation Audit |
| **Audits** | `v2/migrations/001`–`018` |
| **Against** | Document 08 Revision 1 (Phase 5.6), Phase 4, PostgreSQL 16, Supabase |
| **Findings** | 22 — 8 blocker, 8 before production, 3 optimisation, 3 documentation |
| **Corrections fully correct** | 12 of 17 |
| **Verdict** | **C — Rework required** |
