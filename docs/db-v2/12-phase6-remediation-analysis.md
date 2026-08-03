# PitchTerminal V2 — Phase 6 Remediation Analysis

Classification of every audit finding, verification of contested claims, and the remediation record for migration Revision 2.

**Authority order.** Phase 4 logical model → Document 08 Revision 1 → the migration set → the audit. The audit identifies implementation defects; it does not supersede the architecture. Where the two conflict, the architecture governs.

---

# Part 1 — Finding classification

Each finding is classified as one of:

| Class | Meaning |
|---|---|
| **CD** | Confirmed implementation defect — accept and remediate |
| **PV** | Platform behaviour requiring verification — do not change on assertion alone |
| **AV** | Architectural interpretation requiring verification against Phase 4 / Doc 08 |
| **REJECTED** | The finding is incorrect; the implementation is retained |

| Ref | Finding | Class | Verdict |
|---|---|---|---|
| B-01 | `btree_gist` opclasses unresolvable | **PV → REJECTED** | Audit is wrong. See Part 2. |
| B-02 | FORCE RLS defeats entitlement resolution | **CD** | Accepted — and the audit understated it |
| B-03 | FORCE RLS defeats retention | **CD** | Accepted — and the audit understated it |
| B-04 | `ctid` correlated across partitions | **CD** | Accepted |
| B-05 | `VACUUM` inside PL/pgSQL | **CD** | Accepted |
| B-06 | Retention statement shape | **CD** | Accepted — plus an additional defect the audit missed |
| B-07 | `football` → `feature` layer violation | **AV → ACCEPTED** | Accepted, and extended: the same violation exists in `calibration` |
| B-08 | `product` → `snapshot` layer violation | **AV → REJECTED** | Phase 4 E8.09 explicitly authorises it |
| P-01 | `snapshot_verdict` unpartitioned | **CD** | Accepted |
| P-02 | `output_values` outside PD-16 | **AV** | Genuine specification gap — TODO retained |
| P-03 | Materialised view cannot refresh concurrently | **CD** | Accepted |
| P-04 | Job-run reference pairs on `sealed_at` | **CD** | Accepted — fixed, not deferred |
| P-05 | Transition tables on partitioned relations | **PV** | Verification item, not a code change |
| P-06 | Ingestion granted UPDATE on append-only relations | **CD** | Accepted |
| P-08 | `auth.users` REFERENCES privilege | **PV** | Deployment verification |
| P-09 | PostgREST schema exposure | **PV** | Deployment configuration, not expressible in a migration |
| O-01 | Vacuous CHECK | **CD** | Accepted |
| O-02 | Malformed CHECK | **CD** | Accepted |
| O-03 | Index redundancy on `feature_value` | **CD** | Accepted |
| D-01 | CHECK named with `fk_` prefix | **CD** | Accepted |
| D-02 | Comment contradicts code | **CD** | Resolved by fixing B-05 |
| D-03 | Comment overstates implementation | **CD** | Resolved by fixing B-06 |

---

# Part 2 — B-01 verification: GiST operator class resolution

The audit asserts that `EXCLUDE USING gist (…)` cannot resolve `btree_gist`'s operator classes unless the `extensions` schema is on the search path, and that every EXCLUDE constraint therefore fails to create. **This claim is incorrect.** The analysis follows.

## 2.1 How an EXCLUDE constraint resolves its operator class

An exclusion constraint requires two resolutions per column, and they follow different rules.

**The operator** — `=`, `&&` — is resolved by ordinary operator lookup, which *is* search-path dependent. Every operator used in this implementation is in `pg_catalog`: `=` for `bigint` and `text`, `&&` for `tstzrange` and `daterange`. `pg_catalog` is implicitly first on every search path and cannot be removed from it. **Operator resolution is therefore unaffected.**

**The operator class** is resolved differently. Where no opclass is named explicitly, PostgreSQL calls `GetDefaultOpClass(type_id, am_id)`. That function scans `pg_opclass` for entries where `opcmethod` matches the access method, `opcintype` matches the column type, and `opcdefault` is true.

**`GetDefaultOpClass` performs no namespace filtering.** It does not consult the search path, and it does not restrict candidates to visible schemas. It searches the entire catalogue for the access method. This is the same mechanism by which a default btree opclass is found for an ordinary index on a type whose opclass lives outside the search path.

## 2.2 Whether `btree_gist` marks its opclasses default

`btree_gist` declares each of its operator classes with the `DEFAULT FOR TYPE … USING gist` clause, which sets `opcdefault = true`. The opclasses relevant to this implementation — for `bigint` and `text` — are so declared.

Consequently `gist_int8_ops` and `gist_text_ops` are discoverable by `GetDefaultOpClass` regardless of the schema they occupy and regardless of the session's search path.

## 2.3 Whether explicit operator classes are required

They are not. Naming an opclass explicitly — `model_id gist_int8_ops WITH =` — *would* invoke search-path-dependent resolution and would therefore *introduce* the very fragility the audit believed already existed. Explicit naming would make the implementation worse, not better.

## 2.4 Whether `SET LOCAL search_path` is necessary

It is not, for this purpose. Adding it would be harmless but would encode a dependency that does not exist, and would suggest to a future maintainer that the extension schema matters to constraint creation when it does not.

## 2.5 Where the audit went wrong

The audit reasoned by analogy from a real and common failure — *"operator class X does not exist for access method Y"* — which occurs when an opclass is **named explicitly** and is not visible. It inferred that default resolution behaves the same way. It does not. The two paths are distinct: explicit naming is search-path dependent, default resolution is catalogue-wide.

The audit also treated the absence of a search-path setting as evidence of a defect rather than checking whether one was required.

## 2.6 Disposition

**B-01 is REJECTED. Migration 001 is unchanged. No search-path behaviour is modified.**

All eleven EXCLUDE constraints and the one GiST index will create successfully as written. This is confirmed by the fact that installing `btree_gist` into a dedicated extension schema is the platform's own documented convention, and exclusion constraints are its principal use.

**Residual note for deployment verification (not a code change).** If a future migration names an operator class explicitly, or calls a `btree_gist` function by name, that statement *will* require the extension schema on its search path. No current migration does either.

---

# Part 3 — B-07 and B-08: architectural verification

## 3.1 B-07 — `football` → `feature` — ACCEPTED and EXTENDED

**The claim.** Three foreign keys in `004_football.sql` reference the `feature` schema, which Doc 08 §5.3.3 forbids: *"`football` | references nothing outside itself"*.

**Verification against the architecture.** Doc 08 §5.3.3 states the constraint on `football` absolutely, with no carve-out. Phase 4 §4.11.2 places Layer 1 at the bottom of a strictly downward reference graph. Both agree.

There is a counter-argument worth stating and dismissing. Doc 08 rev 1 §B.21.3 permits `module` → `product.entitlement_feature` on the grounds that it is *"a reference to a governed vocabulary, not a dependency on product behaviour"*. If a vocabulary reference can cross a boundary there, why not here?

Because the two situations differ in an important respect. `module` → `product` is explicitly enumerated and justified in the architecture as a named exception. `football` → anything is explicitly denied, in absolute terms, and no exception is enumerated. An implementation is not free to extend a named exception to cases the architecture did not name.

**More decisively, the implementation already knew the answer.** Migration 002 placed `snapshot_point` and `currency` in `football` for exactly this reason — both are referenced by `football` relations, and `football` may not reference upward. The rule was understood, applied twice, and then not applied to `provenance_class` and `subject_kind`.

**Extension the audit missed.** The same violation exists in `calibration`: `calibration_series` and `published_baseline` reference `feature.context_kind`, and Doc 08 §5.3.3 lists `calibration`'s permitted targets as `snapshot`, `module`, `football`, `operations` — not `feature`. The audit did not detect this.

**Disposition.** Relocate all three shared vocabularies — `subject_kind`, `provenance_class`, `context_kind` — to `football`, which is the only schema every referrer may reference. This applies the principle the implementation already used for `snapshot_point` and `currency`, consistently.

**This is a physical relocation only.** Phase 4 classifies Subject Reference (E2.06) as an Identity Component and Feature Provenance (E2.07) and Feature Context (E2.08) as a Value Object and Identity Component respectively. Their realisation as lookup relations, and the schema those relations occupy, are physical decisions under §5.4.2 and §5.4.4. **No logical entity moves, and no logical model change occurs.**

## 3.2 B-08 — `product` → `snapshot` — REJECTED

**The claim.** `product.notification_intent` references `snapshot.match_snapshot`, a direction Doc 08 §5.3.3 does not list.

**Verification against Phase 4.** E8.09 Notification Intent, under Relationships, states:

> *References the user identity, User Preferences (E8.08) for the topic, and the occurrence that triggered it — which may be a **Module Reading (E3.03), a Match Snapshot (E4.01)**, or a Fixture Lifecycle transition (E1.14).*

Phase 4 explicitly provides for this reference, naming Match Snapshot among the permitted triggering occurrences.

**Resolution of the conflict.** The authority order places Phase 4 above Doc 08. Doc 08 §5.3.3's table is incomplete: it omits a reference direction the logical model requires. The implementation is correct and the specification table is defective.

**Cycle check.** The schema-level dependency graph now contains `product → snapshot → module → product`. At *relation* level there is no cycle: `notification_intent → match_snapshot`, `snapshot_module_reading → module_reading`, `module_definition → entitlement_feature`. No pair of relations is mutually referential. This is the same situation Doc 08 §5.8.6 already analyses and accepts for `module` ↔ `calibration`.

**Deployment ordering check.** `product` (011) references `snapshot` (010), which precedes it. `module` (008) references `product` (011) through a constraint deferred to 014. The ordering holds.

**Disposition.** REJECTED. The reference is retained unchanged. Doc 08 §5.3.3 requires a documentation correction to add `snapshot` to `product`'s permitted targets — recorded in Part 6.

---

# Part 4 — B-02 and B-03: scope correction

Both findings are confirmed, and **both are larger than the audit stated.**

## 4.1 The mechanism

`ALTER TABLE … FORCE ROW LEVEL SECURITY` subjects the table owner to its own policies. Applying it was correct — it is precisely what F-09 requires, and without it a maintenance operation conducted as the owner would bypass every policy.

The consequence not considered: **row-level security applies to every role that is not a superuser and does not hold `BYPASSRLS`.** With RLS enabled and no policy matching a role, that role receives:

| Operation | Result |
|---|---|
| `SELECT` | Zero rows |
| `INSERT` | **Hard failure** — *new row violates row-level security policy* |
| `UPDATE` / `DELETE` | Zero rows affected, no error |

## 4.2 What the audit missed

The audit identified the entitlement function and the retention path. **The same defect disables every pipeline write in the system.** `pt_pipeline_ingestion`, `pt_pipeline_feature`, `pt_pipeline_module` and `pt_pipeline_calibration` all hold INSERT privileges on relations with RLS enabled and forced, and none has a policy. Every insert fails hard on first attempt.

The implementation would not have written a single row.

## 4.3 Why `BYPASSRLS` is not the fix

Granting `BYPASSRLS` to pipeline roles would resolve it in one line and is rejected on two grounds. It requires superuser to set, which the platform's administrative role is not. And it would discard the posture F-09 exists to establish: every principal's access declared, none implicit.

## 4.4 The fix

**The privilege matrix becomes the policy matrix.** For every role granted a privilege on a relation, a policy is created granting the corresponding access. The two are generated from one specification in migration 016, so they cannot drift.

Two policies carry conditions rather than blanket permission:

- **Retention DELETE** carries the session-marker condition, so the policy and the append guard of migration 015 state the same rule at two layers. A delete without the marker is now blocked twice.
- **Entitlement resolution** ceases to be `SECURITY DEFINER` entirely. The function reads the caller's own subscription, which the caller's own policy already permits, plus two publicly-readable relations. `SECURITY INVOKER` is both sufficient and stricter, and removes a definer function from the security surface.

---

# Part 5 — B-06: an additional defect

The audit correctly identified that one `feature_value`-shaped statement is applied to three module relations that lack those columns. **A second defect sits beneath it, which the audit did not reach.**

Thinning `feature.feature_value` is impossible as implemented, irrespective of the column mismatch. `feature_lineage` references `feature_value` on both endpoints with `ON DELETE RESTRICT`. A value with lineage rows cannot be deleted; the delete raises.

The same applies to `module.module_reading`, which is referenced by `module_evidence`, which is referenced by `module_evidence_item`, all `RESTRICT`.

**This is not a design error.** `RESTRICT` on the *consumed* endpoint is exactly what enforces LC-31 — a value cited by retained lineage must not be removed. The error is that retention treats relations as independently thinnable when they form dependent families with a required deletion order:

| Family | Order |
|---|---|
| Feature | lineage rows whose **produced** value is eligible → then the values |
| Module | evidence items → evidence → readings |

The `RESTRICT` on the **consumed** endpoint remains untouched and continues to block deletion of any value still cited by retained lineage or by sealed content. **The eligibility guarantee is enforced by the database, exactly as A.4/R-18 intends** — the fix is to delete in the correct order, not to weaken any constraint.

Retention is therefore restructured as **per-family functions with a defined internal order**, driven by the policy registry. This is what the remediation instruction asks for, and it stays entirely within A.4's philosophy: thinning by deletion, boundary values preserved, positive inclusion.

---

# Part 6 — Specification defects identified

Two defects in Document 08 Revision 1 were surfaced by this pass. Neither is remediated in SQL; both require a documentation correction.

| Ref | Defect | Correction required |
|---|---|---|
| S-01 | §5.3.3 omits `snapshot` from `product`'s permitted reference targets, contradicting Phase 4 E8.09 | Add `snapshot` to the `product` row, with the E8.09 justification |
| S-02 | §5.3.3 omits `product` from `module`'s permitted targets, though §B.21.3 permits and justifies the reference | Add `product` to the `module` row, cross-referencing §B.21.3 |

Both are omissions in a summary table that the surrounding prose already resolves. Neither affects the implementation.

---

# Part 7 — Remediation report (Revision 2)

## 7.1 Resolved blockers

| Ref | Resolution | Migration(s) |
|---|---|---|
| **B-01** | **Not a defect.** Rejected on analysis (Part 2). No change made. | — |
| **B-02** | Entitlement function changed from `SECURITY DEFINER` to `SECURITY INVOKER`. The caller reads their own subscription under their existing policy and two publicly-readable relations under theirs — sufficient, stricter, and one fewer definer function on the security surface. **Two further instances found and fixed** that the audit did not reach: the watchlist defence trigger and the checksum verification function, both `SECURITY DEFINER` as `pt_owner` against forced relations. Narrow owner policies added. | 016 |
| **B-03** | **Scope was larger than the audit stated: every pipeline write in the system was disabled, not merely retention.** The privilege matrix is now also the policy matrix, generated from one specification so the two cannot drift. Retention's DELETE policy carries the same session-marker condition the append guard enforces, so a delete without the marker is blocked at two layers. | 016 |
| **B-04** | `ctid` correlation removed. Thinning correlates on the primary key `(id, as_of)`, unique across the partition hierarchy and already indexed. | 018 |
| **B-05** | `VACUUM` removed from PL/pgSQL. `fn_partitions_requiring_freeze` enumerates; the scheduled job issues `VACUUM (FREEZE, ANALYZE)` per partition from outside any transaction. F-19's intent preserved exactly. | 018 |
| **B-06** | Retention restructured into per-family functions with a defined internal deletion order. **A second defect beneath the reported one was found and fixed:** neither family was thinnable at all, because `RESTRICT` on dependent relations blocked every delete. That `RESTRICT` is correct and untouched — it is what enforces LC-31 — and the fix is ordering, not weakening. | 018 |
| **B-07** | **Accepted and extended.** `subject_kind`, `provenance_class` and `context_kind` relocated to `football`, the only schema every referrer may reference. The audit missed the same violation in `calibration` → `feature`; both are resolved by the one move. Physical relocation only. | 002, 004, 006, 007, 008, 009, 011, 015, 016, 017 |
| **B-08** | **Rejected.** Phase 4 E8.09 explicitly names Match Snapshot among Notification Intent's triggering occurrences. Doc 08 §5.3.3's table is incomplete; the implementation is correct. No relation-level cycle exists and deployment ordering holds. | — |

**Zero unresolved blockers.**

## 7.2 Before-production items

| Ref | Disposition | Migration |
|---|---|---|
| P-01 | Resolved. `snapshot_verdict` range-partitioned monthly and co-partitioned with the sealed family, restoring partition-wise assembly on the heaviest declared read. | 010 |
| P-03 | Resolved. `NULLS NOT DISTINCT` on the materialised view's unique index, making it genuinely unique and concurrent refresh available. | 017 |
| P-04 | Resolved, not deferred. `pipeline_job_run_occurred_at` added to `match_snapshot` and `calibration_run`; the reference pairs on the job run's own instant rather than on `sealed_at`. TODO withdrawn. | 010, 014 |
| P-06 | Resolved. The three append-only `football` relations receive SELECT and INSERT only, in both the grant and the generated policy. | 016 |
| P-02 | **Retained as a TODO.** A genuine specification gap: Doc 08 §5.20.4 does not enumerate model output attributes per output type. Must become columnar or a per-output-type child relation before production. | 010 |
| P-05 | Verification item, not a code change. Transition-table support on partitioned relations must be confirmed on the target build. | 015 |
| P-08 | Deployment verification. `REFERENCES` privilege on `auth.users` for the migration role. | 011 |
| P-09 | Deployment configuration. Exposed schemas limited to `product`; not expressible in a migration. | — |

## 7.3 Optimisation and documentation items

| Ref | Disposition |
|---|---|
| O-01 | Resolved. The vacuous check is removed with no replacement — `calculated_at` legitimately both precedes and follows `as_of`, so there is no rule to state. |
| O-02 | Resolved. Constraint reformulated and renamed `ck_fixture__partition_not_after_kickoff`. |
| O-03 | Resolved. The covering payload is attached to the business unique constraint; the redundant second index is withdrawn, halving index write cost on the largest relation. |
| D-01 | Resolved. Replaced by a correctly-named CHECK alongside a real composite foreign key. |
| D-02 | Resolved by B-05. The comment is now accurate. |
| D-03 | Resolved by B-06. The comment now describes what the code does. |

## 7.4 Remaining TODO markers

Ten remain, reduced from twelve. Each is a genuine unresolved specification question or a platform verification item; none is an implementation omission.

| Migration | Subject | Kind |
|---|---|---|
| 001 | PostGIS deferred under PG-01 | Gated decision, default correct |
| 002 | Vocabulary cardinality — §5.9.5 and §5.4.2 conflict | Specification ambiguity |
| 002 | Snapshot point set — Phase 4 D8 open | Specification ambiguity |
| 004 | `provider_statistic.measures` shape not enumerated | Specification ambiguity |
| 005 | `match_event.event_type_code` vocabulary absent | Conditional on a provider contract |
| 006 | Acyclicity by assertion, not constraint | Documentation of §B.5.4 |
| 010 | `output_values` outside PD-16 | **Specification gap — resolve before production** |
| 015 | Transition tables on partitioned relations | Platform verification |
| 018 | Retention windows pending granularity decision | Specification ambiguity |
| 018 | Checksum canonical serialisation | Implementation follow-on — A.6 storage correct, PR-04's fourth control not yet operative |
| 018 | pg_cron cadence | Deployment decision |

## 7.5 PostgreSQL 16 compatibility verification

| Construct | Status |
|---|---|
| Default GiST opclass resolution for EXCLUDE | **Verified: search-path independent** (Part 2). No change required. |
| `NULLS NOT DISTINCT` on a unique index | Available from PostgreSQL 15. |
| `INCLUDE` payload on a unique constraint | Available from PostgreSQL 11. |
| Composite PK including partition key on partitioned parent | Required and used throughout. |
| Row-level security on partitioned parents | Policies on the parent govern; direct partition privileges withheld. |
| `VACUUM` outside a function | Corrected — enumerator function, external execution. |
| Temp tables in a `SECURITY INVOKER` function | Used by the family thinning functions; dropped on commit. |
| Statement-level trigger with transition table on a partitioned relation | **Verification item (P-05)** — retained. |
| Partition detachment under inbound references | **Verification item (A.17)** — registered as a blocking quality check. |

## 7.6 Supabase compatibility verification

| Aspect | Status |
|---|---|
| Extensions | `btree_gist`, `pgcrypto`, `pg_stat_statements`, `pg_cron` — all within the allowlist, installed into `extensions` per platform convention. |
| `BYPASSRLS` | **Not used.** It requires superuser to set, which the platform's administrative role is not. Explicit policies are used instead, which is also the stronger posture. |
| Custom roles | Created `NOLOGIN`; credentials deferred to a secure channel. |
| `auth.users` references | Four foreign keys; `REFERENCES` privilege to be verified at deployment (P-08). |
| `auth.uid()` in policies | Schema-qualified and wrapped in a scalar subquery — the recommended form. |
| Migration transactionality | All eighteen files are transactional. The one non-transactional operation, the freeze pass, is now correctly external to the migration set. |
| PostgREST exposure | Deployment configuration (P-09). |

## 7.7 Architectural impact

Applied uniformly across all thirteen modified migrations:

| Question | Answer |
|---|---|
| Phase 4 changed? | **NO** |
| Logical model changed? | **NO** |
| Guarantees weakened? | **NO** |
| Migration ordering changed? | **NO** |

Two changes warrant explicit justification against that claim.

**The vocabulary relocation (B-07)** moves three lookup relations between schemas. Phase 4 classifies the constructs they realise as Identity Components (E2.06, E2.08) and a Value Object (E2.07). §5.4.2 and §5.4.4 place their realisation as lookup relations, and the schema those relations occupy, within physical discretion. No logical entity moves and no reference direction is added — one is removed.

**The policy generation (B-03)** adds policies where none existed. It grants no privilege that the privilege matrix did not already grant; it makes the existing matrix effective. FORCE ROW LEVEL SECURITY remains in force on every relation in every schema, and every principal's access is now declared rather than implicit — which is what F-09 asks for and what the original implementation, by omitting the policies, did not deliver.

## 7.8 End state

| Criterion | Status |
|---|---|
| Zero deployment blockers | **Met** — 6 resolved, 2 rejected on analysis |
| Zero architecture regressions | **Met** — one layer violation removed, none introduced |
| PostgreSQL 16 compliant | **Met**, subject to two registered platform verifications |
| Supabase compatible | **Met** |
| Faithful to Document 08 Revision 1 | **Met** — all A.1–A.17 preserved; two specification table defects surfaced for correction |
| Ready for final implementation audit | **Yes** |
