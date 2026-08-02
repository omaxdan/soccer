# PitchTerminal V2 — Physical Database Design, Revision 1

**Phase 5.6 — Correction pass.** Document 08 Revision 1, incorporating the corrections required by the Phase 5.5 Physical Validation Review (document 09).

**Target platform.** PostgreSQL 16, Supabase-managed.

## Supersession

This document supersedes the named sections of document 08. Sections of document 08 not named here remain in force unchanged.

| Document 08 section | Status |
|---|---|
| §5.2 Design Principles | Superseded by §B.1 |
| §5.4 Physical Mapping Rules | Amended by §B.2 |
| §5.6 Identity Realisation | Superseded by §B.3 |
| §5.9 Constraint Realisation | Superseded by §B.5 |
| §5.9.7 Trigger Realisation | Superseded by §B.6 |
| §5.10 Partition Strategy | Amended by §B.4 |
| §5.14.5 Extensions | Amended by §A.13 |
| §5.15 Lifecycle Realisation | Amended by §B.9 |
| §5.17 Security Model | Amended by §B.7 |
| §5.18 Retention | Superseded by §B.9 |
| §5.20 Physical Entity Catalogue | Amended by §B.2 and the delta in §B.11 |
| §5.22 Migration Strategy | Superseded by §B.8 |
| §5.24.5 Autovacuum | Superseded by §B.9.5 |
| All other sections | **In force unchanged** |

**Scope discipline.** Every change in this document maps to a numbered Phase 5.5 finding. No architectural decision, logical entity, ownership rule, temporal model, snapshot philosophy, versioning principle, layer boundary, or entitlement structure is altered. The validation checklist in §C confirms this claim item by item.

**Scope exclusion.** This document contains no data definition language. Constraint rules are stated as rules; their expression is Phase 6.

---

# Part A — Correction Register

Seventeen corrections, each in the mandated form. Corrections are ordered by the finding sequence of document 09, blockers first.

---

## A.1 — F-01 Composite foreign keys to partitioned relations · **BLOCKER**

**Finding.** F-01. Foreign keys referencing a partitioned relation must be composite.

**Original design.** §5.6.7 stated that foreign keys reference the surrogate primary key of the parent, with composite foreign keys reserved for partition binding as an exceptional case.

**Problem.** PostgreSQL requires that a primary key or unique constraint on a partitioned relation include every partition key column. The primary key of a partitioned relation is therefore never the surrogate key alone. Every single-column foreign key declared against a partitioned parent has no matching unique constraint to reference, and cannot be created.

**Correction.** A foreign key referencing a partitioned relation is composite, comprising the parent's surrogate key and the parent's partition key. The referencing relation carries both columns. The referenced unique constraint contains both.

**Implementation rule.**

> **R-01.** Where a relation references a partitioned relation, it carries two columns: the parent's surrogate key and the parent's partition key. The foreign key is declared over both, referencing a unique constraint on the parent containing both. The composite partition-key binding pattern is the standard reference pattern for partitioned parents, not an exception.

> **R-02.** The denormalised partition key column on the referencing relation is named for the parent and its partition attribute, per the naming standard of §5.5.3, and is `NOT NULL` wherever the reference is mandatory.

> **R-03.** Where the referencing relation is co-partitioned with the parent on the same key, the partition key column already present serves the reference; no additional column is introduced.

**Affected relationships.**

| Referencing relation | Referenced relation | Columns forming the reference | Co-partitioned |
|---|---|---|---|
| `snapshot.snapshot_feature_state` | `feature.feature_value` | Cited value key, cited value as-of | No — schemes differ |
| `snapshot.snapshot_module_reading` | `module.module_reading` | Cited reading key, cited reading as-of | No — schemes differ |
| `snapshot.snapshot_feature_state` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_module_reading` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_verdict` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_model_output` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_completeness` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_version_component` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.snapshot_outcome_link` | `snapshot.match_snapshot` | Snapshot key, fixture partition date | Yes |
| `snapshot.match_snapshot` | `football.fixture` | Fixture key, fixture partition date | Yes |
| `module.module_evidence_item` | `feature.feature_value` | Cited value key, cited value as-of | No — schemes differ |
| `module.module_evidence_item` | `module.module_evidence` | Evidence key, reading as-of | Yes |
| `module.module_evidence` | `module.module_reading` | Reading key, reading as-of | Yes |
| `feature.feature_lineage` | `feature.feature_value` (produced) | Produced value key, produced value as-of | Yes |
| `feature.feature_lineage` | `feature.feature_value` (consumed) | Consumed value key, consumed value as-of | No — different partitions |
| `football.appearance`, `lineup`, `lineup_selection`, `match_event`, `result`, `result_revision`, `official_assignment`, `fixture_lifecycle_transition` | `football.fixture` | Fixture key, fixture partition date | Yes |
| `product.watchlist` | `football.fixture` | Fixture key, fixture partition date | No |

**Note on `product.watchlist`.** The relation is polymorphic. It carries a nullable fixture partition date column populated only for fixture-kind entries, with the composite foreign key declared over the fixture key and that column. The existing conditional check asserting that exactly the column corresponding to the declared entity kind is populated is extended to cover the partition date column.

**Reason.** Without this correction the specification cannot be implemented: the declared references have no valid target. The correction also produces a required input for A.3, since the cited artefact's as-of becomes present on sealed content rows.

---

## A.2 — F-20 Outcome revision identity · **BLOCKER**

**Finding.** F-20. The outcome link business key prevents the revision the model mandates.

**Original design.** §5.20.4 declared the business identity of `snapshot_outcome_link` as snapshot and outcome dimension, while §5.19 and Phase 4 LC-100 require that a result revision produces a new outcome link with the original retained.

**Problem.** A unique constraint over snapshot and dimension admits exactly one link per dimension. The mandated revision link cannot be written. Calibration would consequently be unable to distinguish a claim that was wrong from a claim measured against a score subsequently corrected.

**Correction.** The business identity gains a revision ordinal. Currency is expressed by ordinal succession, which requires no update to a sealed row and no predicate on a unique index.

**Implementation rule.**

> **R-04.** The business identity of `snapshot_outcome_link` is snapshot key, fixture partition date, outcome dimension code, and revision ordinal. Ordinal zero denotes the original linkage; higher ordinals denote successive revisions in chronological order.

> **R-05.** `snapshot_outcome_link` carries no mutable currency attribute. The relation is insert-only, in common with every other relation in the sealed schema, and no attribute of an existing row is ever altered.

> **R-06.** The prevailing outcome for a snapshot and dimension is the row bearing the **highest revision ordinal** for that snapshot and dimension. Supersession is expressed by the existence of a higher ordinal, not by a marker on the superseded row. The revision history is the full ordinal sequence in order.

> **R-07.** An explicit audit of transitions is held in the companion relation `snapshot_outcome_link_currency`, append-only, recording for each supersession the superseded ordinal, the superseding ordinal, the instant of supersession, and the reason — ordinarily a result revision. This relation carries the `superseded_at` semantics without requiring any update to a sealed row.

> **R-08.** A revision link and its currency transition row are inserted in one transaction, so the prevailing link and its audit are always consistent, and no interval exists in which supersession is recorded without its successor or the reverse. A supporting index over snapshot key, fixture partition date, outcome dimension code, and revision ordinal descending resolves the prevailing link as a single index entry, so currency resolution requires neither aggregation nor a marker.

**Reason.** Phase 4 LC-100 exists so that calibration can distinguish a wrong claim from a corrected measurement basis. Without revision links, every measurement over a population containing amended fixtures is silently misattributed.

**Why ordinal succession rather than a currency marker.** A marker column would require setting the superseded row's marker at the moment of supersession, which is an update to a sealed row. No exception to the sealed schema's insert-only posture is granted for any relation, because a single permitted update would defeat the schema-level privilege configuration that makes immutability administrable rather than merely intended. Ordinal succession expresses the same fact with no update: the prevailing link is simply the latest one, and the companion relation records the transition explicitly for audit. The construction is also free of the partial-unique-index prohibition entirely, since no predicate is required.

---

## A.3 — F-16 Temporal contamination protection

**Finding.** F-16. Temporal ordering of sealed content was unconstrained.

**Original design.** §5.12.5 specified four sealing preconditions: fixture open, no duplicate, referents retrievable, manifest complete.

**Problem.** Nothing prevented a snapshot from citing a feature value or module reading whose as-of instant postdates the snapshot's own. Such a snapshot would claim to represent what was known at a moment while incorporating information that did not then exist — the lookahead contamination the platform's evidential position exists to exclude, and which the Phase 1 audit identified in the previous platform's baseline cohort.

**Correction.** Both as-of instants are present on sealed content rows, each bound to its source by composite foreign key, and their ordering is enforced by same-row check.

**Implementation rule.**

> **R-09.** `snapshot_feature_state` and `snapshot_module_reading` each carry `snapshot_as_of` and `cited_as_of`, both `NOT NULL`.

> **R-10.** `cited_as_of` is bound to the cited artefact by the composite foreign key of R-01, so it cannot diverge from the artefact's actual as-of.

> **R-11.** `snapshot_as_of` is bound to the parent snapshot by a composite foreign key referencing a redundant unique constraint on `match_snapshot` over its surrogate key, its fixture partition date, and its as-of. It therefore cannot diverge from the snapshot's actual as-of.

> **R-12.** A check constraint on each relation asserts `cited_as_of <= snapshot_as_of`.

> **R-13.** A fifth sealing precondition is added to §5.12.5: no cited artefact's as-of exceeds the snapshot's as-of. The precondition is evaluated within the sealing transaction and is redundant with R-12; it is retained so that the sealing process fails with a diagnostic naming the offending citation rather than with a constraint violation naming only the constraint.

**Reason.** Both operands are bound to their sources declaratively, so the check is a same-row comparison of two trustworthy values. The cost is one additional column on each of two relations — one of which, `cited_as_of`, is required by A.1 in any case. The alternative would place the platform's central evidential guarantee in application logic, where a future writer unaware of the rule would silently violate it and the resulting contamination would be undetectable in the data.

---

## A.4 — F-17 Retention and thinning correction

**Finding.** F-17. Thinning was specified as partition detachment, contradicting the resolution-reduction rule it must implement.

**Original design.** §5.15.2 stated that temporal relations are thinned by partition detachment. §5.18.2 defined thinning as a reduction of temporal resolution within age bands, preserving the prevailing value at every retained boundary.

**Problem.** The two statements are incompatible. Detachment removes every row in a period, including the boundary values §5.18.2 requires be preserved. Executing thinning as specified would alter historical answers, which no retention process may do.

**Correction.** Thinning proceeds by deletion of eligible rows within partitions. Detachment is reserved for bounded operational content whose entire period is removed after aggregation.

**Implementation rule.**

> **R-14.** Thinning is the deletion of eligible rows within partitions, per the eligibility rule of §5.18.3 as amended by R-15. The partition remains attached and continues to serve reads.

> **R-15.** A row is eligible for deletion only when: no sealed relation references it; no retained lineage row cites it; it is not the prevailing value at a retained temporal boundary; and its relation appears in the retention inclusion list.

> **R-16.** Partition detachment applies solely to bounded operational content, and only after the aggregation of §5.19.8 has recorded that period's permanent summary.

> **R-17.** Thinnable relations are classified for maintenance purposes as **periodically modified**, not as pure append-only, because deletion produces dead tuples. Their autovacuum configuration follows §B.9.5.

> **R-18.** Referential enforcement of the first two eligibility conditions is by ordinary foreign key checking on delete, which is certain, rather than by the partition detachment behaviour whose confirmation A.17 requires.

**Reason.** As issued, the specification prescribed an operation that would destroy the historical answers it guarantees to preserve. The correction also improves the enforcement basis: deletion is subject to ordinary referential checking, which is certain, whereas detachment behaviour required verification.

**Consumer-visible property.** After thinning, a historical query returns the value prevailing at the retained resolution for that period, which may differ from the value that prevailed at finer resolution. This is a deliberate and accepted loss. It is stated in §B.9.3 as a property of thinned periods so that consumers of deep history know the resolution they receive.

---

## A.5 — F-22 Append guard retention exception

**Finding.** F-22. Append-only guards would block the retention process.

**Original design.** §5.9.7 specified that append-only guards raise unconditionally on update or delete.

**Problem.** Once A.4 establishes that thinning proceeds by deletion, an unconditional guard prevents retention from executing at all.

**Correction.** The guard permits deletion by the retention role operating under an explicit session marker, and by no other principal under any circumstance.

**Implementation rule.**

> **R-19.** The append-only guard raises on update unconditionally, without exception, for every principal.

> **R-20.** The append-only guard raises on delete unless both conditions hold: the executing role is the designated retention role, and the session carries the retention operation marker. Both are required; either alone is insufficient.

> **R-21.** The retention process sets the session marker at the start of a retention execution and clears it on completion. The marker is session-scoped and does not persist across connections.

> **R-22.** A schema conformance assertion confirms that no role other than the retention role holds delete privilege on any thinnable relation. This is the primary control; the guard's exception is the secondary control.

> **R-23.** The sealing guard on the `snapshot` schema admits **no exception whatsoever**. It raises on update and on delete for every principal including the retention role, because sealed content is never thinned.

**Reason.** Without the exception, retention cannot execute. Without its narrow scoping, the append-only guarantee would be weakened for every role rather than for one controlled process under an explicit marker. R-23 is stated separately and emphatically so that no implementer generalises the retention exception from thinnable relations to sealed ones.

---

## A.6 — F-13 Snapshot content checksum storage

**Finding.** F-13. The content checksum had no storage.

**Original design.** §5.15.4 recorded a content checksum at sealing and §5.23.4 verified it periodically, as the fourth control of PR-04. The entity catalogue defined no attribute to hold it.

**Problem.** The specified verification cannot be performed against a value that is not stored. Three of the four controls over sealed content were present; the retrospective detection control was absent.

**Correction.** The snapshot header carries the checksum and the identity of the algorithm that produced it.

**Implementation rule.**

> **R-24.** `match_snapshot` carries `content_checksum` and `checksum_algorithm_version_id`, both `NOT NULL`, the latter referencing the checksum algorithm version registry.

> **R-25.** The checksum is computed within the sealing transaction over a canonical serialisation of the aggregate's content — feature state, module readings, verdict, model outputs, completeness, and manifest — in a deterministic order defined by the algorithm version.

> **R-26.** The checksum is immutable after sealing, protected by the same schema-level privilege posture as all other snapshot content.

> **R-27.** Periodic verification recomputes the checksum under the algorithm version recorded on the row and compares. A mismatch raises a data-quality failure and is recorded as a permanent quality assertion result.

> **R-28.** A change of checksum algorithm registers a new algorithm version. Historical checksums remain interpretable because each row names the version that produced it. Existing rows are never recomputed under a new algorithm.

**Reason.** PR-04 specifies four independent controls over sealed content precisely because sealed claims are the platform's primary asset. The retrospective control detects modification that circumvented the other three — a scenario the design does not expect but does not rely on being impossible.

---

## A.7 — F-08 Removal of generated partition keys

**Finding.** F-08. A generated column cannot be a partition key.

**Original design.** §5.9.6 stated that where a partitioned relation's partition key is derived from an instant on the same row, the derivation is a generated column.

**Problem.** PostgreSQL prohibits the use of a generated column in a partition key. The rule as stated is not implementable. The design did not depend on it in practice, but a specification containing an unimplementable rule invites doubt about adjacent rules that are correct.

**Correction.** Partition keys are plain columns, in one of exactly two forms.

**Implementation rule.**

> **R-29.** A partition key is either a plain column already present in the relation's business key, or a plain column denormalised from a parent and bound to it by composite foreign key. No third form exists.

> **R-30.** Generated columns remain permitted for two purposes only: same-row derivations used in constraints, and same-row expressions supporting access paths. A generated column is never a partition key and never a foreign key column.

> **R-31.** Where a partition key is denormalised from a parent, the functional determination rule PD-05 applies: the partition key must be functionally determined by the business key, and the dependency is enforced by the composite foreign key of R-01.

**Reason.** The rule as issued is unimplementable. The corrected rule states what the design actually does and what PostgreSQL actually permits, and it aligns with the now-standard composite binding pattern of A.1.

---

## A.8 — F-03 Canonical model designation

**Finding.** F-03. A partial unique index is unavailable on a partitioned relation.

**Original design.** §5.20.4 specified a partial unique index on `snapshot_model_output` enforcing that exactly one model is canonical per output type.

**Problem.** `snapshot_model_output` is partitioned, and PostgreSQL does not permit a predicate on a unique index over a partitioned relation. The constraint cannot be enforced as specified. Beyond the platform restriction, a per-claim canonicity marker is the wrong location: canonicity is a property of the model at a point in time, not of an individual sealed output.

**Correction.** Canonical designation moves to the model registry, effective-dated, with overlap prevented by exclusion constraint.

**Implementation rule.**

> **R-32.** `snapshot_model_output` carries no canonicity attribute. It records the model and model version that produced it, as before.

> **R-33.** The model registry carries a canonical designation relation keyed by output type and canonical period, referencing the model version designated canonical for that output type over that period.

> **R-34.** An exclusion constraint over output type code and canonical period prevents overlapping canonical periods for one output type. This requires the `btree_gist` extension of A.13.

> **R-35.** Canonicity at any instant is resolved from the registry by the instant falling within a canonical period. Canonicity of a historical snapshot output is resolved by its snapshot's as-of instant, so a change of canonical model does not retroactively alter which output was canonical when a claim was made.

> **R-36.** Every model output remains sealed, remains attributed to a named model and version, and remains individually calibrated, whether canonical or not.

**Reason.** The construction is unavailable on the platform, and the corrected location realises Phase 4 E4.06 more faithfully: the architecture states that the canonical designation is data changeable without redefinition of anything else, which describes a registry attribute rather than a per-claim attribute. R-35 preserves the historical property that matters — what was canonical then, not what is canonical now.

---

## A.9 — F-06 Index creation on partitioned relations

**Finding.** F-06. Concurrent index creation is unavailable on partitioned relations.

**Original design.** §5.22.2 stated that indexes are created concurrently.

**Problem.** PostgreSQL does not support concurrent index creation directly on a partitioned relation. Creating an index on the parent locks writes across every partition for the build duration, which is unacceptable on the relations where index creation matters most.

**Correction.** A four-stage pattern is mandated for partitioned relations, distinct from single-step concurrent creation on unpartitioned relations.

**Implementation rule.**

> **R-37.** For a partitioned relation, an index is created in four stages: the parent index definition is created without recursion, existing initially as invalid; the corresponding index is created concurrently on each partition; each partition index is attached to the parent; the parent index becomes valid automatically when the final partition index is attached.

> **R-38.** Stage two proceeds partition by partition, and is resumable. A failed concurrent creation leaves an invalid partition index, which is dropped before the partition is retried.

> **R-39.** The parent index is confirmed valid before the change is considered complete. An index left invalid conveys an availability the planner will not use.

> **R-40.** For an unpartitioned relation, single-step concurrent creation applies unchanged.

> **R-41.** Indexes on relations created empty during initial deployment are declared at relation creation, where no concurrency concern arises. The four-stage pattern applies to populated relations only.

**Reason.** The stated approach is unavailable on precisely the relations where lock avoidance is essential.

---

## A.10 — F-07 Unique constraint introduction

**Finding.** F-07. Not-valid creation does not apply to unique constraints.

**Original design.** §5.22.2 stated that constraints are created not-valid and validated separately.

**Problem.** PostgreSQL supports not-valid creation for check and foreign key constraints only. A unique constraint on a populated relation must be built and verified in a single locking operation.

**Correction.** The not-valid pattern is scoped to the constraint classes that support it, and a distinct pattern is mandated for unique constraints.

**Implementation rule.**

> **R-42.** Not-valid creation followed by separate validation applies to check constraints and foreign key constraints only.

> **R-43.** A unique constraint on a populated unpartitioned relation is introduced by creating a unique index concurrently, then adding the constraint using that existing index, which is a metadata operation holding a brief lock.

> **R-44.** A unique constraint on a partitioned relation is declared at relation creation while the relation is empty. Introducing one to a populated partitioned relation requires the expand-populate-migrate-contract pattern, because neither concurrent unique index creation nor not-valid creation is available there. The migration ordering of §B.8.5 creates partitioned relations with their constraints in place, so this case does not arise in initial deployment.

> **R-45.** Exclusion constraints follow the unique constraint rules: declared at creation, and introduced to populated relations only under the multi-phase pattern.

**Reason.** The stated approach is unavailable for one of the three constraint classes it was applied to, and the alternatives differ materially in execution and in lock profile.

---

## A.11 — F-23 Replacement of high-volume triggers

**Finding.** F-23. Two per-row triggers on the highest-volume relations are replaceable by declarative constraints.

**Original design.** §5.9.7 enforced baseline version matching and feature definition context validity by trigger, each performing an indexed registry lookup per row.

**Problem.** Both execute on the two highest-volume calculated relations — up to one billion executions during initial population. Both are also expressible declaratively, so their placement contravenes PR-09, which requires enforcement at the lowest capable layer.

**Correction.** Both become declarative, using redundant unique constraints on the parent and composite foreign keys from the child.

**Implementation rule.**

> **R-46 — Baseline version matching.** `published_baseline` carries a redundant unique constraint over its surrogate key and its module version. `module_reading` declares a composite foreign key over its cited baseline key and **its own** module version, referencing that constraint. Equality of the reading's module version and the cited baseline's module version is thereby enforced by the reference itself. No additional column and no trigger are required.

> **R-47 — Definition context validity.** A binding relation `feature_definition_context_kind` enumerates the permitted pairs of feature definition and context kind, with a unique constraint over both. `feature_value` declares a composite foreign key over its definition and its context kind referencing that constraint. A value at an invalid context is rejected by the reference.

> **R-48.** The binding relation is populated from the feature registry's declared valid contexts and is maintained as part of registry governance. It is a physical realisation of a declaration the logical model already contains; it introduces no new logical concept.

> **R-49.** Both triggers are removed. No trigger performs a per-row registry lookup on any relation projected to exceed ten million rows.

**Reason.** PR-09 requires the lowest capable layer, and both constraints are expressible declaratively once the binding constructs exist. The trigger implementations were the two most costly in the design, and removing them eliminates the per-row trigger burden on the billion-row write path entirely.

---

## A.12 — F-24 Provenance propagation scope

**Finding.** F-24. Provenance propagation granularity was unspecified.

**Original design.** §5.9.7 listed provenance propagation as a cross-relation invariant enforced by trigger, without stating granularity.

**Problem.** The default reading of a constraint-enforcing trigger is per-row. Evaluated per row, the check aggregates over each value's lineage individually — a correlated aggregation executed once per inserted value, which would dominate write cost on the largest relation in the design.

**Correction.** Statement-level evaluation over transition tables is mandated explicitly.

**Implementation rule.**

> **R-50.** The provenance propagation constraint is enforced by an after-insert, statement-level trigger using a transition table of the inserted rows, joined once against lineage.

> **R-51.** The trigger raises on the first violation and names the offending value, so that the diagnostic identifies the row rather than only the statement.

> **R-52.** Per-row enforcement of this constraint is prohibited.

> **R-53.** The constraint asserts that a value's provenance class is no stronger than the weakest class among the values in its lineage. Values with no lineage — those derived directly from reality — are exempt, because they have no inputs to be weaker than.

**Reason.** The distinction between per-row and statement-level evaluation is the difference between a viable write path and an unviable one at the projected volumes. It is stated explicitly because the default assumption is the wrong one.

---

## A.13 — F-02 Required extension

**Finding.** F-02. Exclusion constraints require an extension not listed.

**Original design.** §5.14.5 enumerated four extensions and did not include `btree_gist`.

**Problem.** The default generalised search tree operator class does not support scalar equality. Every exclusion constraint in the design combines scalar equality with range overlap, and none can be created without the extension.

**Correction.** The extension is added to the required inventory.

**Implementation rule.**

> **R-54.** `btree_gist` is a required extension. Its stated purpose is to support exclusion constraints combining scalar equality with range overlap.

> **R-55.** It is required by: player registration non-overlap; availability spell non-overlap; entitlement grant non-overlap; version effective period non-overlap; vocabulary effective period non-overlap; and the canonical model designation of A.8.

> **R-56.** The extension is installed in the platform's designated extension schema, not in a design schema, and its installation precedes any relation carrying an exclusion constraint in the migration ordering.

**Reason.** Without it the specified constraints cannot be created. A.8 adds a sixth dependency on it.

---

## A.14 — F-10 Pipeline role connection model

**Finding.** F-10. The connection path for pipeline roles was unspecified.

**Original design.** §5.17.1 defined five pipeline roles and one administrative role without stating how they connect.

**Problem.** The platform's data interface resolves a principal to one of its own roles from session claims. Custom roles are not reachable by that path without issuing claims signed with the project secret, which is not the intended mechanism for backend processes. An implementer could reasonably attempt either path.

**Correction.** The connection model is stated explicitly for both role classes.

**Implementation rule.**

> **R-57.** The five pipeline roles and the administrative role are **direct database connection roles**, authenticating with credentials over a direct connection. They are not reachable through the platform's authenticated session path and no claim is ever issued naming them.

> **R-58.** Pipeline connections operate in **session mode**, not transaction-pooled mode, because bulk write paths depend on session-scoped state — including the retention marker of R-21 and the timeout settings of A.15 — that transaction pooling does not preserve.

> **R-59.** The platform-provided roles are reached exclusively through the platform's own authentication path and are never used by a backend process.

> **R-60.** The platform's service role is used by no application process, as §5.17.1 already states. This correction adds no exception.

**Reason.** Without an explicit statement, an implementer may attempt to reach pipeline roles through the platform interface, which either fails or requires issuing custom claims — a materially different and less controlled arrangement than credentialed direct connection.

---

## A.15 — F-11 Migration timeout and transaction handling

**Finding.** F-11. Migration and backfill operations require timeout and transaction accommodation.

**Original design.** §5.22 specified bounded resumable backfills and lock timeouts on exclusive operations, without addressing transaction wrapping or role-level statement timeouts.

**Problem.** Two conflicts arise. Concurrent index creation cannot execute inside a transaction block, and migration mechanisms commonly wrap each migration in one. Long backfill batches and constraint validations may exceed a role-level statement timeout. Both produce migration failure rather than silent incorrectness, but both are avoidable by specification.

**Correction.** Transactional and non-transactional operations are separated, and bulk-operation timeout settings are specified.

**Implementation rule.**

> **R-61.** Migrations are authored in two classes. **Transactional migrations** contain only operations that execute within a transaction and are applied atomically. **Non-transactional migrations** contain operations that cannot, and are applied without transaction wrapping, each containing exactly one such operation.

> **R-62.** Non-transactional operations are: concurrent index creation, concurrent partition detachment, and any operation the platform documents as prohibited within a transaction block.

> **R-63.** A non-transactional migration is idempotent in effect and resumable, because it cannot roll back. It detects the applied state before acting.

> **R-64.** The migration role and the pipeline roles carry role-level statement timeout and lock timeout settings appropriate to bulk operation, distinct from the settings applied to end-user roles. Bulk settings permit long-running validation and backfill; lock timeouts remain short, so that an operation blocked behind a long transaction fails quickly rather than queueing.

> **R-65.** Long validations and backfills are executed in bounded, resumable batches irrespective of timeout settings, so that a timeout is a delay rather than a loss of progress.

**Reason.** Both conflicts are certain to arise and both are avoidable by specification rather than by discovery during deployment.

---

## A.16 — F-12 Snapshot schema privilege granularity

**Finding.** F-12. Schema-level default grants would over-privilege the calibration role.

**Original design.** §5.17.2 granted `pipeline_module` insert across the `snapshot` schema and `pipeline_calibration` insert on outcome links only.

**Problem.** PostgreSQL grants privilege per relation. Default privileges configured at schema level would grant `pipeline_calibration` insert on every snapshot relation, including `match_snapshot`, giving the calibration role the ability to create claims — which the ownership model forbids.

**Correction.** All grants on the `snapshot` schema are per relation, with no schema-level defaults.

**Implementation rule.**

> **R-66.** No default privileges are configured on the `snapshot` schema for any role. Every grant is explicit and per relation.

> **R-67.** `pipeline_calibration` holds insert on `snapshot_outcome_link` and its currency companion relation, and on no other relation in the schema. It holds select across the schema.

> **R-68.** `pipeline_module` holds insert on every snapshot relation except the outcome link relations, on which it holds select only.

> **R-69.** No role holds update or delete on any relation in the `snapshot` schema, including the administrative role and the retention role.

> **R-70.** A schema conformance assertion enumerates the grants on the `snapshot` schema and confirms conformance to R-66 through R-69. Grant drift on this schema is the highest-consequence privilege drift in the design and is therefore asserted rather than assumed.

**Reason.** A schema-level default grant would give the calibration role the ability to create snapshots. The assertion exists because the correct configuration is not self-evident from inspection of a running system.

---

## A.17 — F-18 Partition detachment verification

**Finding.** F-18. The detachment-blocking guarantee was asserted without verification.

**Original design.** §5.8.7 and §5.18.3 asserted that a partition cannot be detached while its rows are referenced by an inbound foreign key, and relied on this to make thinning eligibility structurally enforced.

**Problem.** A structural guarantee resting on unverified platform behaviour is not a structural guarantee. The claim is load-bearing for retention safety and must be confirmed empirically against the target version.

**Correction.** Verification is mandated as a deliverable, with a specified fallback.

**Implementation rule.**

> **R-71.** Before production use, an empirical verification is executed on the target platform version establishing whether a partition of a relation targeted by a foreign key can be detached while rows in that partition are referenced. The verification covers both ordinary and concurrent detachment.

> **R-72.** The result is recorded as a permanent quality assertion result, naming the platform version tested.

> **R-73.** Where detachment is confirmed to be blocked, §5.8.7's claim stands and detachment-based operations rely on it.

> **R-74.** Where detachment is **not** confirmed to be blocked, the retention process determines eligibility procedurally before detaching any partition, and a recurring integrity assertion detects any citation whose target is absent. The specification then states plainly that this eligibility is procedurally enforced rather than structurally guaranteed.

> **R-75.** A.4 materially reduces the exposure: thinning now proceeds by deletion, which is subject to ordinary referential checking and is certain. The verification remains required for the bounded operational content that is detached.

**Reason.** The safety of retention rested on an unverified assumption. A.4 removes most of the dependency; verification closes the remainder.

---

## A.18 — Corrections carried forward to production readiness

The following Phase 5.5 findings are classified before-production rather than pre-DDL. They are recorded here with their target stage and are reflected in the updated chapters of Part B where doing so costs nothing, so that the corrected specification is complete as a working document.

| Finding | Correction | Stage | Reflected in |
|---|---|---|---|
| F-05 | Materialised views hold no entitlement-scoped content; scoped content is served from projection relations, which support policies | Before production | §B.7.4 |
| F-09 | Row-level security is forced; direct partition privileges are withheld | Before production | §B.7.2 |
| F-04 | Views crossing a privilege boundary declare invoker semantics in addition to security barrier | Before production | §B.7.5 |
| F-21 | Entitlement resolves through a single stable function consulted by policies | Before production | §B.7.6 |
| F-25 | Foreign keys crossing partitioning schemes are created not-valid and validated per partition on the referencing side | Before production | §B.8.4 |
| F-15 | An assertion detects production reads against partitioned relations without pruning | Before production | §B.9.6 |
| F-19 | Partitions are frozen explicitly on becoming inactive | Before production | §B.9.5 |
| §6.5 of doc 09 | Thinned-period resolution is stated as a consumer-visible property | Before production | §B.9.3 |

---

# Part B — Corrected Chapters

---

## B.1 Physical Design Principles

Nine principles. PR-01 through PR-09 are restated with amendments; two are materially revised.

| Ref | Principle | Status |
|---|---|---|
| PR-01 | Business identity is realised, not replaced | Unchanged |
| PR-02 | Append-only is enforced by privilege, not by convention | **Amended** — see below |
| PR-03 | Partition keys are immutable and locally present | **Amended** — see below |
| PR-04 | Sealed data is physically unmodifiable | Unchanged; fourth control now has storage (A.6) |
| PR-05 | Version identity is referenced, never restated | Unchanged |
| PR-06 | Every read path is declared and measured | Unchanged |
| PR-07 | Projections are rebuildable and hold no authority | Unchanged |
| PR-08 | Write and read concerns are separated by structure and privilege | Unchanged |
| PR-09 | Enforcement is placed at the lowest capable layer | Unchanged; two violations corrected (A.11) |

**PR-02, amended.** For every relation whose lifecycle class forbids modification, update privilege is withheld from all roles without exception, and delete privilege is withheld from all roles except the retention role acting on thinnable relations under an explicit session marker. Row-level guards raise on any operation that circumvents privilege configuration. Sealed relations admit no delete exception for any principal.

**PR-03, amended.** Every partitioned relation is partitioned on a plain column that is immutable for the lifetime of the row and physically present on the row. The column is either already a member of the business key, or is denormalised from a parent and bound by composite foreign key. A generated column is never a partition key.

**PR-10, new.** *Declarative before procedural.* Where a constraint is expressible by a redundant unique constraint on a parent and a composite foreign key from a child, that construction is used in preference to a trigger. This is a corollary of PR-09, stated separately because two constraints in the original specification were placed at trigger level when a declarative construction was available (A.11).

---

## B.2 Entity Catalogue Rules

Rules governing how every entry in the catalogue is expressed. These supplement, and where they conflict override, the mapping rules of §5.4.

> **C-01.** Every relation carries a surrogate primary key and, separately, a unique constraint expressing its business identity.

> **C-02.** For a partitioned relation, the primary key comprises the surrogate key and the partition key, and the business unique constraint includes the partition key. Under PD-05 the partition key is functionally determined by the business key, so inclusion does not weaken identity.

> **C-03.** For every reference to a partitioned relation, the referencing relation carries the parent's surrogate key **and** the parent's partition key, and declares a composite foreign key over both. (A.1)

> **C-04.** Where a referencing relation is co-partitioned with its parent, the partition key column already present serves the reference and no column is added.

> **C-05.** Every relation carrying a calculated value carries, without exception and all `NOT NULL`: subject reference kind with its typed subject columns, context kind with its conditional edition reference, as-of, calculated-at, version reference, provenance class, and observation count with threshold indicator.

> **C-06.** Every sealed content relation citing an artefact carries the cited artefact's as-of and its parent snapshot's as-of, both bound by composite foreign key, and a check asserting the cited as-of does not exceed the snapshot as-of. (A.3)

> **C-07.** No relation carries a version designation as text. Version identity is a foreign key.

> **C-08.** No relation carries a structured payload column outside the two circumstances of §5.14.6.

> **C-09.** Where a constraint requires equality between a child attribute and an attribute of a referenced parent, the parent carries a redundant unique constraint including that attribute and the child declares a composite foreign key. No trigger is used. (A.11)

> **C-10.** Every relation declares exactly one lifecycle class and exactly one retention class, and the two are consistent: no relation is both sealed and thinnable.

---

## B.3 Key Strategy

### B.3.1 Primary keys

| Relation class | Primary key |
|---|---|
| Unpartitioned | Surrogate identity integer |
| Partitioned | Surrogate identity integer **and** partition key |
| Authentication-linked | Platform identifier type, matching the authentication schema |
| Reference vocabulary | Stable code |

The identity sequence for a partitioned relation resides on the parent and is shared across partitions, which is supported and produces monotonically increasing values across the relation.

### B.3.2 Business keys

Declared as unique constraints in the attribute order specified below, chosen so that the supporting index also serves the dominant access path.

| Relation family | Business key |
|---|---|
| Feature value | Subject, context, definition, as-of descending, feature version |
| Module reading | Subject, context, definition, as-of descending, module version |
| Snapshot | Fixture partition date, fixture, snapshot point, snapshot version |
| Snapshot content | Fixture partition date, snapshot, cited artefact key, cited artefact as-of |
| **Snapshot outcome link** | **Fixture partition date, snapshot, outcome dimension, revision ordinal** (A.2) |
| Calibration series | Module version, band, outcome dimension, context, snapshot point |
| Feature lineage | Produced value key, produced value as-of, consumed value key, consumed value as-of |

### B.3.3 Redundant unique constraints

Redundant unique constraints exist solely to serve as composite foreign key targets. Each is declared on the parent and named for its purpose.

| Parent relation | Redundant unique constraint | Serves |
|---|---|---|
| `football.fixture` | Key, fixture partition date | All fixture-scoped references |
| `snapshot.match_snapshot` | Key, fixture partition date | Snapshot content references |
| `snapshot.match_snapshot` | Key, fixture partition date, as-of | Snapshot as-of binding (A.3) |
| `feature.feature_value` | Key, as-of | Lineage, evidence, sealed feature state |
| `module.module_reading` | Key, as-of | Evidence, sealed module reading |
| `calibration.published_baseline` | Key, module version | Baseline version matching (A.11) |
| `feature.feature_definition_context_kind` | Definition, context kind | Context validity (A.11) |

A redundant unique constraint is not an alternate key. It expresses no additional identity; it exists to make a composite reference declarable.

### B.3.4 Currency on insert-only partitioned relations

Where at most one row within a group must be current, the relation is partitioned, and the relation is insert-only, currency is expressed by **ordinal succession**: the prevailing row is the one bearing the highest ordinal within its group, and supersession is expressed by the existence of a higher ordinal rather than by a marker on the superseded row.

This construction is mandated wherever the requirement arises on a sealed or append-only partitioned relation, and applies to `snapshot_outcome_link` (A.2). It is preferred to a marker column for two reasons: setting a marker on supersession would be an update to an insert-only row, and no predicate is required, so the prohibition on partial unique indexes over partitioned relations does not arise.

A companion append-only relation records each transition explicitly where an audit of supersession is required.

---

## B.4 Partition Strategy

Unchanged in structure. Three amendments.

### B.4.1 Partition key form

A partition key is a plain column, either a business key member or denormalised from a parent and bound by composite foreign key. Generated columns are excluded. (A.7)

### B.4.2 Referential consequence

Because a partitioned relation's unique constraints include its partition key, every reference to it is composite, and every referencing relation carries the parent's partition key. This is the standard pattern. (A.1)

Co-partitioned families therefore reference one another using a partition key column that is already present, which is both the referential mechanism and the basis of partition-wise joins.

### B.4.3 Detachment scope

Partition detachment applies to bounded operational content only, after aggregation. Thinnable content is thinned by deletion within partitions and its partitions remain attached. (A.4)

Detachment behaviour under inbound references is verified before production, with the procedural fallback of R-74 where it is not confirmed. (A.17)

### B.4.4 Unchanged

Partitioned relation inventory, partition keys, granularities, forward buffer, default partition monitoring, pruning rules, and the sub-partitioning gate PG-02 — validated by document 09 §4.4 as correctly deferred — all stand as issued.

---

## B.5 Constraint Strategy

### B.5.1 Enforcement hierarchy

Unchanged in order. One class is added at the declarative tier.

| Rank | Mechanism |
|---|---|
| 1 | Column definition |
| 2 | Check constraint |
| 3 | Unique constraint |
| 4 | Foreign key constraint |
| 5 | **Composite foreign key to a redundant unique constraint** — for cross-relation equality (new tier, A.11) |
| 6 | Exclusion constraint |
| 7 | Generated column |
| 8 | Trigger |
| 9 | Privilege |
| 10 | Application, with mandatory validation assertion |

Rank 5 is inserted above exclusion constraints because it enforces cross-relation equality declaratively, which was previously placed at rank 8.

### B.5.2 Constraints introduced by this revision

| Constraint | Relation | Class | Finding |
|---|---|---|---|
| Cited as-of does not exceed snapshot as-of | `snapshot_feature_state`, `snapshot_module_reading` | Check | A.3 |
| Snapshot as-of matches parent | Both above | Composite foreign key | A.3 |
| Cited artefact as-of matches source | Both above, `module_evidence_item`, `feature_lineage` | Composite foreign key | A.1 |
| Outcome link revision identity | `snapshot_outcome_link` | Unique | A.2 |
| Prevailing outcome link is the highest ordinal | `snapshot_outcome_link` | Ordinal succession; supporting index | A.2 |
| Reading cites baseline at own module version | `module_reading` | Composite foreign key | A.11 |
| Value context kind valid for definition | `feature_value` | Composite foreign key | A.11 |
| Canonical periods do not overlap per output type | Model canonical designation | Exclusion | A.8 |
| Checksum and algorithm version present | `match_snapshot` | Not-null | A.6 |

### B.5.3 Constraints removed by this revision

| Constraint | Reason |
|---|---|
| Partial unique index on snapshot model output canonicity | Unavailable on a partitioned relation; relocated to the registry (A.8) |
| Trigger enforcing baseline version match | Replaced by composite foreign key (A.11) |
| Trigger enforcing context validity | Replaced by composite foreign key (A.11) |

### B.5.4 Residual application enforcement

Three rules remain enforced by the calculating process, each with a validation assertion. This is unchanged from the original specification except that two former members of this set have become declarative.

| Rule | Validation |
|---|---|
| Feature value conforms to registry-declared scale | Scale conformance assertion |
| Module reading consumes only declared inputs | Input conformance assertion |
| Feature dependency graph is acyclic | Acyclicity assertion |

---

## B.6 Trigger Strategy

### B.6.1 Permitted trigger classes

Four classes. No trigger outside these classes is permitted.

| Class | Purpose |
|---|---|
| Sealing guard | Prevents modification or deletion of sealed content |
| Append-only guard | Prevents modification of temporal content; prevents deletion except by retention |
| Lifecycle guard | Prevents snapshot creation for a fixture outside the open state |
| Statement-level invariant | Enforces a cross-relation invariant no declarative construction can express |

### B.6.2 Complete trigger inventory

| Trigger | Relations | Event | Granularity | Volume of execution |
|---|---|---|---|---|
| Sealing guard | Every `snapshot` relation | Before update, delete | Row | Nil in correct operation |
| Append-only guard | Temporal and append-only relations | Before update, delete | Row | Nil except during retention |
| Lifecycle guard | `match_snapshot` | Before insert | Row | One per snapshot |
| Provenance propagation | `feature_value` | After insert | **Statement** | One per write statement |
| Watchlist referential defence | `fixture`, `team`, `competition` | After delete | Row | Nil in normal operation |

### B.6.3 Guard behaviour

> **Sealing guard.** Raises on update and on delete, for every principal, without exception. No role, session marker, or administrative circumstance modifies this behaviour. (R-23)

> **Append-only guard.** Raises on update for every principal without exception. Raises on delete unless the executing role is the retention role **and** the session carries the retention operation marker. (R-19, R-20)

> **Lifecycle guard.** Raises on insert where the fixture is not explicitly in the open lifecycle state, protecting by default on an unrecognised state.

### B.6.4 Statement-level enforcement

Provenance propagation is enforced after insert, at statement granularity, over a transition table of the inserted rows joined once against lineage. Per-row enforcement of this constraint is prohibited. (A.12)

### B.6.5 Prohibitions

- No trigger performs a per-row lookup against another relation on any relation projected to exceed ten million rows. (R-49)
- No trigger writes to any relation.
- No trigger populates a value.
- No trigger implements business calculation.

### B.6.6 Residual per-row trigger burden

After this revision, the per-row trigger burden on `feature_value`, `feature_lineage`, `module_evidence_item`, and `snapshot_feature_state` — the four largest relations in the design — is **nil**. The guards fire only on prohibited operations; the two value-checking triggers have become declarative constraints.

---

## B.7 Security Model

### B.7.1 Roles and connection model

| Role | Connection | Amendment |
|---|---|---|
| Five pipeline roles | **Direct database connection, credentialed, session mode** | A.14 |
| Administrative role | **Direct database connection, credentialed, session mode** | A.14 |
| Retention role | **Direct database connection, credentialed, session mode**, sets the retention marker | A.5 |
| Platform authenticated, anonymous roles | Platform authentication path only | — |
| Platform service role | Used by no application process | — |

The retention role is stated separately because A.5 gives it a capability no other role holds.

### B.7.2 Row-level security posture

> Row-level security is **enabled and forced** on every relation in every schema. Forcing is required because a relation's owner otherwise bypasses its policies, and maintenance conducted as the owner would then be unprotected. *(F-09, before production)*

> Direct privileges on partitions are withheld from every role other than the owner. All access is mediated through the partitioned parent, so parent policies govern. Policy replication to partitions is thereby unnecessary. *(F-09, before production)*

### B.7.3 Snapshot schema privileges

| Role | Privilege on `snapshot` |
|---|---|
| `pipeline_module` | Insert on every relation except the outcome link relations; select throughout |
| `pipeline_calibration` | Insert on the outcome link relation and its currency companion only; select throughout |
| `pipeline_projection` | Select only |
| Administrative | Select only |
| Retention | **None** |
| All others | None |

No default privileges are configured on this schema. Every grant is explicit and per relation. No role holds update or delete on any relation in the schema. A conformance assertion enumerates the grants and confirms this. (A.16)

### B.7.4 Materialised view constraint

> A materialised view granted to an end-user role contains only content that role may see in full. Entitlement-scoped content is never held in a materialised view, because row-level security does not apply to materialised views.

> Where entitlement scoping is required over materialised content, the content is held in a projection relation, which supports policies, rather than in a materialised view.

> Every materialised view resides in the `product` schema. *(F-05, before production)*

### B.7.5 View semantics

> A view crossing a privilege boundary declares invoker semantics in addition to security barrier. The two properties are independent: security barrier addresses predicate leakage, invoker semantics determines whose privileges and policies apply. Both are required. *(F-04, before production)*

### B.7.6 Entitlement resolution

> Entitlement resolves through a single function, marked stable so that it is evaluated once per statement rather than once per row. The function consults the plan, the entitlement matrix, the subscription, and the platform configuration flag, and returns the requesting principal's resolved entitlement set. Policies consult its result and nothing else. *(F-21, before production)*

This preserves the single-resolution-path requirement of the entitlement architecture without alteration.

### B.7.7 Unchanged

Role inventory, privilege matrix for all schemas other than `snapshot`, object ownership by a dedicated non-connecting role, function security rules, and beta-posture evaluation within the policy expression all stand as issued.

---

## B.8 Migration Strategy

### B.8.1 Migration classes

| Class | Contents | Application |
|---|---|---|
| **Transactional** | Operations executable within a transaction | Atomic; rolls back on failure |
| **Non-transactional** | Concurrent index creation; concurrent partition detachment; any operation the platform prohibits within a transaction block | Applied without wrapping; exactly one such operation per migration; idempotent and resumable |

Every migration remains forward-only, immutable once applied, sequentially ordinalled, and recorded with a checksum. (A.15)

### B.8.2 Constraint introduction patterns

| Constraint class | Populated unpartitioned relation | Populated partitioned relation | Empty relation |
|---|---|---|---|
| Check | Create not-valid, validate separately | Create not-valid, validate separately | Declare at creation |
| Foreign key | Create not-valid, validate separately | Create not-valid, validate per partition on the referencing side | Declare at creation |
| Unique | Create unique index concurrently, then add constraint using it | **Multi-phase pattern required** | Declare at creation |
| Exclusion | Multi-phase pattern | Multi-phase pattern | Declare at creation |

Not-valid creation applies to check and foreign key constraints only. (A.10)

### B.8.3 Index introduction patterns

| Relation | Pattern |
|---|---|
| Empty, any | Declare at creation |
| Populated, unpartitioned | Single-step concurrent creation |
| Populated, partitioned | **Four-stage pattern:** parent definition without recursion; concurrent creation per partition; attach each; confirm parent valid (A.9) |

The four-stage pattern is resumable per partition. A failed concurrent creation leaves an invalid partition index, which is dropped before that partition is retried.

### B.8.4 Backfill and validation

Unchanged in approach. Two additions.

> Foreign keys crossing partitioning schemes — sealed content to feature values and module readings — are created not-valid and validated as a separate resumable operation after backfill, proceeding partition by partition on the referencing side so that each unit is bounded and interruptible. This is the dominant cost in initial population as well as in migration. *(F-25, before production)*

> Every backfill and validation executes under a pipeline job run, in bounded resumable batches, irrespective of timeout configuration, so that a timeout is a delay rather than a loss of progress. (A.15)

### B.8.5 Deployment ordering

Amended from the original ordering to accommodate the new binding relations and the composite reference pattern.

| Stage | Content |
|---|---|
| 1 | Extensions, **including `btree_gist`** (A.13); schemas; owner, pipeline, retention and migration roles without privileges |
| 2 | Reference vocabularies in every schema |
| 3 | Version registries, **including the checksum algorithm version registry** (A.6) |
| 4 | `football` structural relations |
| 5 | `football` fixture and fixture-scoped relations, partitioned, with redundant unique constraints for composite binding |
| 6 | `feature` registry relations, **including `feature_definition_context_kind`** (A.11) |
| 7 | `feature` value and lineage, partitioned, with redundant unique constraints; lineage foreign keys deferred to stage 11 |
| 8 | `module` registry and reading relations, partitioned, with redundant unique constraints |
| 9 | `calibration` relations, **including `published_baseline` with its redundant unique constraint** (A.11) and the model canonical designation with its exclusion constraint (A.8) |
| 10 | `snapshot` relations, partitioned and co-partitioned, **with the checksum attributes** (A.6) and the outcome link revision identity (A.2) |
| 11 | Cross-scheme foreign keys, created not-valid |
| 12 | `product` relations |
| 13 | `operations` relations, partitioned |
| 14 | Indexes on empty relations |
| 15 | Triggers and guards, **including the retention exception** (A.5) |
| 16 | Row-level security enablement, **forcing**, and policies |
| 17 | Privilege grants — per relation, **no schema defaults on `snapshot`** (A.16) |
| 18 | Read model registry, projections, materialised views |
| 19 | Scheduled maintenance registration |
| 20 | Foreign key validation, resumable, after any initial population |
| 21 | **Detachment behaviour verification** and recording of the result (A.17) |

Two ordering rules are retained and one is added. Privilege grants are applied last, after every object exists and every policy is in force. Foreign key validation follows population. **Detachment verification precedes any retention execution**, so that the fallback of R-74 is selected before retention first runs rather than after.

---

## B.9 Maintenance Strategy

### B.9.1 Retention classes

Unchanged: permanent, thinned, bounded, reconstructible. Positive inclusion is retained — a relation not named in a retention policy is never acted upon.

### B.9.2 Thinning execution

> Thinning is the deletion of eligible rows within partitions. The partition remains attached and continues to serve reads.

> Eligibility requires all four conditions of R-15. The first two are enforced by ordinary referential checking on delete, which is certain.

> Deletion is performed by the retention role under the retention session marker, which is the sole circumstance in which the append-only guard permits deletion. (A.4, A.5)

### B.9.3 Thinned-period resolution

> After thinning, a historical query returns the value prevailing at the retained resolution for that period, which may differ from the value that prevailed at finer resolution. This is a deliberate and accepted property of thinned periods, and is stated so that consumers of deep history know the resolution they receive. *(doc 09 §6.5, before production)*

Retained resolution by age band is unchanged: full resolution in the recent window, daily in the intermediate window, weekly beyond. The prevailing value at every retained boundary is preserved.

### B.9.4 Detachment

Applies to bounded operational content only, after the aggregation that records the period's permanent summary. Subject to the verification of A.17.

### B.9.5 Autovacuum configuration

Superseding §5.24.5. Three relation classes rather than two.

| Class | Vacuum | Analyse | Freeze |
|---|---|---|---|
| **Pure append-only** — sealed content, lineage, calibration results, operational aggregates | Relaxed; no dead tuples produced | Tightened; statistics must track rapid growth | **Explicit freeze on becoming inactive** |
| **Thinnable** — feature values, module readings, and their dependents in thinned age bands | **Standard; deletion produces dead tuples** | Tightened | Explicit freeze once past the thinning window |
| **Mutable** — reality relations, registries, product relations | Tightened; reduced fill factor | Standard | Standard |

> Thinnable relations are configured as periodically modified, not as pure append-only, because thinning produces dead tuples that require reclamation. (A.4, R-17)

> A partition is frozen explicitly once it becomes inactive — the retention window has passed it and no further writes or deletions are expected — as a scheduled operation, rather than being left to anti-wraparound. This converts an unpredictable large scan into a scheduled one. *(F-19, before production)*

### B.9.6 Maintenance operations

Unchanged, with two additions.

| Operation | Cadence | Addition |
|---|---|---|
| Partition creation | Scheduled, forward buffer of three intervals | Co-partitioned families created as one operation |
| Retention execution | Scheduled | Aggregation precedes thinning; thinning by deletion |
| Explicit partition freeze | Scheduled | **New** (F-19) |
| Projection refresh | Scheduled or event-driven | — |
| Statistics refresh | After bulk operations and on schedule | — |
| Index usage review | Scheduled | — |
| Validation assertions | Scheduled | Now includes checksum verification (A.6) and pruning conformance |
| **Pruning conformance assertion** | Scheduled | **New** — detects production reads against partitioned relations without a partition predicate *(F-15, before production)* |

Every maintenance operation executes under a pipeline job run.

---

## B.10 DDL Authoring Rules

Binding on Phase 6. These rules govern how the corrected specification becomes data definition language.

> **D-01.** Objects are created in the stage order of §B.8.5. Within a stage, order follows the topological ordering of the reference graph.

> **D-02.** Every relation is created with its primary key, business unique constraint, redundant unique constraints, check constraints, and not-null properties declared at creation. Constraints are added after creation only where a relation is populated.

> **D-03.** Every partitioned relation is created with its initial partitions and its forward buffer in the same migration as the parent, and with a default partition.

> **D-04.** Co-partitioned families are created in one migration with identical partition boundaries.

> **D-05.** Every foreign key to a partitioned relation is composite, referencing a unique constraint containing the parent's partition key. No single-column foreign key to a partitioned relation is authored.

> **D-06.** Redundant unique constraints are authored on the parent before any composite foreign key referencing them.

> **D-07.** Every constraint and index is named per §5.5.4 and §5.5.5. Generated names are prohibited.

> **D-08.** Concurrent operations are authored in non-transactional migrations containing exactly one such operation.

> **D-09.** No data definition language grants privilege at schema level on the `snapshot` schema. Grants are per relation.

> **D-10.** Row-level security is enabled and forced in the same statement group as policy creation, so no window exists in which a relation is enabled without policies or policied without forcing.

> **D-11.** Triggers are authored last among object types, after the constraints they supplement, so that a declarative constraint failure is never masked by a trigger failure during initial validation.

> **D-12.** Every check constraint expresses its rule affirmatively and is named for the rule it asserts.

> **D-13.** No enumerated type is created. Governed vocabularies are lookup relations.

> **D-14.** No generated column participates in a partition key or a foreign key.

> **D-15.** Every object is created owned by the schema owner role, with privileges granted subsequently and explicitly.

---

## B.11 Entity Catalogue Delta

Changes to §5.20. Entries not listed are unchanged.

| Relation | Change | Finding |
|---|---|---|
| `football.fixture` | Redundant unique constraint over key and partition date | A.1 |
| `football.appearance`, `lineup`, `lineup_selection`, `match_event`, `result`, `result_revision`, `official_assignment`, `fixture_lifecycle_transition` | Composite foreign key to fixture over key and partition date | A.1 |
| `feature.feature_value` | Composite foreign key to `feature_definition_context_kind` over definition and context kind; redundant unique constraint over key and as-of | A.1, A.11 |
| `feature.feature_definition_context_kind` | **New relation.** Enumerates permitted definition and context-kind pairs. Unpartitioned; permanent; ~10³ rows | A.11 |
| `feature.feature_lineage` | Both endpoint references composite over key and as-of | A.1 |
| `module.module_reading` | Composite foreign key to `published_baseline` over baseline key and the reading's own module version; redundant unique constraint over key and as-of | A.1, A.11 |
| `module.module_evidence_item` | Composite foreign key to `feature_value` over key and as-of | A.1 |
| `snapshot.match_snapshot` | Adds `content_checksum` and `checksum_algorithm_version_id`, both not-null. Redundant unique constraints over key with partition date, and over key with partition date and as-of | A.1, A.3, A.6 |
| `snapshot.snapshot_feature_state` | Adds `snapshot_as_of` and `cited_as_of`, both not-null; composite foreign keys binding both; check asserting cited does not exceed snapshot | A.1, A.3 |
| `snapshot.snapshot_module_reading` | As above | A.1, A.3 |
| `snapshot.snapshot_model_output` | Removes canonicity attribute and its partial unique index | A.8 |
| `snapshot.snapshot_outcome_link` | Business identity gains revision ordinal; no currency attribute; supporting index over snapshot, partition date, dimension and ordinal descending | A.2 |
| `snapshot.snapshot_outcome_link_currency` | **New relation.** Append-only audit of supersession transitions, preserving the insert-only posture of the sealed schema | A.2 |
| `calibration.published_baseline` | Redundant unique constraint over key and module version | A.11 |
| `calibration.model_canonical_designation` | **New relation.** Output type, canonical period, model version. Exclusion constraint preventing overlapping periods per output type. Unpartitioned; permanent; ~10² rows | A.8 |
| `product.watchlist` | Adds nullable fixture partition date; composite foreign key to fixture; conditional check extended | A.1 |
| Checksum algorithm version registry | **New relation.** Within the version registry family | A.6 |

**Four new relations** are introduced, all small, all unpartitioned, all permanent. Three are binding or registry relations realising declarations the logical model already contains; one preserves the insert-only posture of the sealed schema. **No new logical entity is introduced.**

---

# Part C — Validation Checklist

## C.1 No logical model changes introduced

| Logical construct | Change | Evidence |
|---|---|---|
| Logical entities | **None.** Four new physical relations are introduced; all four realise declarations the logical model already contains | §B.11 |
| Domain boundaries | **None.** Seven schemas unchanged | §5.3 in force |
| Schema ownership model | **None.** One owner per relation; ownership assignments unchanged | §B.7.3 refines grant granularity only |
| Data ownership rules | **None.** Insert privilege remains held by exactly one role per relation | §B.7.3 |
| Temporal model | **None.** As-of and calculated-at unchanged; temporal identity unchanged | §B.2 C-05 |
| Snapshot philosophy | **Strengthened, not changed.** Sealing unchanged; contamination path closed | §A.3 |
| Immutable evidence model | **Strengthened, not changed.** Checksum now storable; outcome revision now expressible without update | §A.6, §A.2 |
| Versioning principles | **None.** Version identity remains a foreign key; no version restated as text | §B.2 C-07 |
| Layer separation | **None.** Reference directions unchanged; no new cross-schema reference direction introduced | §5.3.3 in force |
| Product entitlement architecture | **None.** Single resolution path preserved; §B.7.6 specifies its mechanism without altering its structure | §B.7.6 |

**Four new relations, each justified.**

| Relation | Realises | New logical concept? |
|---|---|---|
| `feature.feature_definition_context_kind` | The feature registry's declared valid contexts (Phase 4 E2.02) | No |
| `calibration.model_canonical_designation` | The canonical designation of Phase 4 E4.06 | No |
| `snapshot.snapshot_outcome_link_currency` | The supersession audit implied by Phase 4 LC-100 | No |
| Checksum algorithm version registry | A version line, in the pattern of Phase 4 §4.13.1 | No |

## C.2 No Phase 4 guarantees weakened

| Guarantee | Status after revision |
|---|---|
| Entity ownership — one owner per entity | **Preserved.** Grant granularity tightened (A.16) |
| One source of truth | **Preserved.** Denormalised columns are bound by composite foreign key and are therefore representations, not owners |
| Append-only | **Preserved.** Update forbidden without exception; delete permitted only to the retention role under marker, only on thinnable relations (A.5) |
| Sealed | **Preserved and strengthened.** No exception granted to any principal (R-23); fourth control now has storage (A.6); outcome revision achieved without any update (A.2) |
| Version ownership by reference | **Preserved.** No version restated; composite references carry keys, not designations |
| Temporal identity | **Preserved and strengthened.** Contamination check added (A.3) |
| Context identity | **Preserved.** Validity now enforced declaratively rather than by trigger (A.11) |
| Historical preservation | **Preserved.** Thinning corrected so that boundary values survive (A.4) |
| Derived versus authoritative | **Preserved.** Projection rules unchanged |
| Layer boundaries | **Preserved.** No new reference direction |
| Immutability of claims | **Preserved.** Strengthened by A.2, A.3, A.6 |
| Temporal behaviour — current state is a query | **Preserved.** No current-state relation introduced |

**No guarantee is weakened. Three are strengthened.**

## C.3 PostgreSQL 16 compatible

| Formerly incompatible | Resolved by |
|---|---|
| Single-column foreign keys to partitioned relations | A.1 |
| Partial unique index on a partitioned relation | A.8 |
| Generated column as partition key | A.7 |
| Exclusion constraints without the supporting extension | A.13 |
| Concurrent index creation on partitioned relations | A.9 |
| Not-valid creation of unique constraints | A.10 |
| Currency marker requiring update to a sealed row | A.2 |

Every construct in the revised specification is supported by PostgreSQL 16 as documented. The one behaviour not confirmed from documentation — partition detachment under inbound references — is subject to mandatory empirical verification with a specified fallback (A.17).

## C.4 Supabase compatible

| Concern | Resolution |
|---|---|
| Pipeline roles unreachable through the platform authentication path | Direct credentialed connection, session mode (A.14) |
| Transaction wrapping of concurrent operations | Non-transactional migration class (A.15) |
| Statement timeouts on bulk operations | Role-level bulk settings (A.15) |
| Extension availability | All required extensions within the platform allowlist, including `btree_gist` (A.13) |
| Platform service role usage | Used by no application process; unchanged |
| Schema-level default grants | Prohibited on `snapshot`; per-relation grants (A.16) |

## C.5 Partition strategy preserved

Partitioned relation inventory, partition keys, granularities, forward buffer, default partition monitoring, pruning rules, and the deferred sub-partitioning gate are unchanged. Three amendments concern the **form** of the partition key (plain, not generated), the **referential consequence** of partitioning (composite references), and the **scope of detachment** (bounded operational content only). None alters which relations are partitioned or on what.

## C.6 Snapshot immutability preserved

| Control | Status |
|---|---|
| Update privilege withheld from every role | Unchanged |
| Delete privilege withheld from every role, including retention | **Explicit** (R-23) |
| Sealing guard, no exception | **Explicit** (R-23) |
| Content checksum with periodic verification | **Now implementable** (A.6) |
| Referential restriction on outbound references | Unchanged |
| Outcome revision without update | **Achieved** (A.2) |

The revision **increases** the strength of this guarantee. The one construction that would have required an update to a sealed row was rejected in favour of ordinal succession, and no exception to the insert-only posture is granted anywhere in the schema.

## C.7 Historical evidence guarantees preserved

| Guarantee | Status |
|---|---|
| No claim destroyed | Preserved; thinning corrected to preserve boundary values (A.4) |
| Sealed claims permanent | Preserved; excluded from all retention |
| Outcome revision retains the original | **Now expressible** (A.2) |
| Reproducibility by version and lineage traversal | Preserved; composite references traverse identically |
| Calibration series keyed by version | Unchanged |
| Published rates carry sample or are marked unverified | Unchanged |
| **No future information in a historical claim** | **Newly guaranteed** (A.3) |

## C.8 No high-volume per-row triggers remain

| Relation | Projected rows | Per-row trigger burden after revision |
|---|---|---|
| `feature.feature_value` | 10⁸ – 10⁹ | **Nil** — context validity now declarative (A.11); provenance now statement-level (A.12) |
| `feature.feature_lineage` | 3 × 10⁸ – 5 × 10⁹ | **Nil** |
| `module.module_evidence_item` | 10⁸ | **Nil** |
| `snapshot.snapshot_feature_state` | 1.8 × 10⁸ | **Nil** — guards fire only on prohibited operations |
| `module.module_reading` | 2 × 10⁷ | **Nil** — baseline version match now declarative (A.11) |
| `snapshot.match_snapshot` | 1.5 × 10⁶ | One lifecycle guard per insert — acceptable at this volume |

**No trigger performs a per-row lookup against another relation on any relation projected to exceed ten million rows.** (R-49)

## C.9 Migration strategy can reach zero downtime

| Operation | Zero-downtime path |
|---|---|
| Relation creation | Direct; no existing path affected |
| Index on populated partitioned relation | Four-stage pattern, concurrent per partition (A.9) |
| Index on populated unpartitioned relation | Single-step concurrent creation |
| Check or foreign key constraint | Not-valid creation, separate validation (A.10) |
| Unique constraint, unpartitioned | Concurrent index then constraint using it (A.10) |
| Unique constraint, partitioned | Declared at creation while empty; multi-phase pattern otherwise (A.10) |
| Cross-scheme foreign key validation | Not-valid, resumable per-partition validation (F-25) |
| Backfill | Bounded, resumable, attributed (A.15) |
| Column addition | Direct in PostgreSQL 16 |
| Rename or narrowing change | Expand, populate, migrate, contract |

Every structural operation has a path that avoids a sustained exclusive lock. Lock timeouts remain short so that a blocked operation fails quickly rather than queueing.

## C.10 Ready for DDL authoring

| Readiness test | Status |
|---|---|
| Every logical entity has a physical realisation | §5.20 as amended by §B.11 |
| Every logical constraint has an enforcement mechanism | §5.25.2 as amended by §B.5 |
| Every residual enforcement point has a validation assertion | §B.5.4 |
| Every reference has a declared form, cardinality and action | §5.21 as amended by §B.3.3 |
| Every partitioned relation has a key, granularity and lifecycle | §B.4 |
| Every index serves a declared access path | §5.11 in force |
| Every relation has a lifecycle and retention class | §B.2 C-10 |
| Every role has a declared privilege set and connection model | §B.7 |
| Naming convention complete | §5.5 in force |
| Object creation order defined | §B.8.5 |
| DDL authoring rules defined | §B.10 |
| Every blocker resolved | §A.1, §A.2 |
| Every pre-DDL correction applied | §A.1 – §A.17 |

**Two items remain outstanding and are not blocking DDL authoring.** Eight before-production corrections are recorded in §A.18 and reflected in Part B. The temporal granularity decision from Phase 4 remains open; it determines instance sizing rather than structure, and should be settled before DDL is deployed rather than before it is authored.

---

## Revision control

| | |
|---|---|
| **Phase** | 5.6 — Physical Design Correction Pass |
| **Document** | 08 Revision 1 |
| **Corrects** | Document 08 Revision 0, per document 09 findings |
| **Corrections applied** | 17 pre-DDL, of which 2 blockers |
| **Carried forward** | 8 before-production, recorded in §A.18 and reflected in Part B |
| **New physical relations** | 4, none introducing a logical concept |
| **New implementation rules** | R-01 – R-75 |
| **New DDL authoring rules** | D-01 – D-15 |
| **Logical model changes** | **None** |
| **Phase 4 guarantees weakened** | **None** — three strengthened |
| **Status** | Ready for Phase 6 — DDL authoring and migration implementation |
| **Excludes** | Data definition language, migration scripts, procedural code |
