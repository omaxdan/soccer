# PitchTerminal V2 — Physical Validation Review

**Phase 5.5.** Design assurance review of the Phase 5 Physical Database Design (document 08) against PostgreSQL 16 and Supabase managed PostgreSQL.

**Purpose.** To determine whether the Phase 5 specification can safely and efficiently become migrations on the target platform. This review does not redesign the architecture, does not revisit logical decisions, and does not propose alternative models. It identifies where the specification is incompatible with the platform, internally inconsistent, or operationally hazardous, and states the minimum correction.

**Method.** Every design decision in document 08 was assessed against documented PostgreSQL 16 behaviour and Supabase platform constraints. Findings are classified by severity and by the stage at which they must be resolved.

**Outcome.** Stated in §12. Twenty-five findings are recorded, of which seventeen require correction before DDL and two are blockers. All are physical; none requires a change to the logical model, the architecture, or any Phase 4 guarantee.

---

## Finding conventions

| Reference | Meaning |
|---|---|
| `F-<nn>` | A review finding |
| **Blocker** | Prevents correct implementation; must be resolved before any DDL is authored |
| **Before DDL** | Must be resolved in the specification before DDL is authored |
| **Before production** | May be deferred past initial DDL but must be resolved before production use |
| **Optimisation** | Improves outcome; does not affect correctness |

---

# 1. PostgreSQL 16 Compatibility Review

## 1.1 Compatibility classification

| Design decision | Classification | Finding |
|---|---|---|
| Range partitioning | Supported directly | — |
| Composite foreign keys | Supported directly | F-01 |
| Exclusion constraints | Supported with modification | F-02 |
| Partial unique indexes | Supported with modification | F-03 |
| Block-range indexes | Supported directly | — |
| Covering indexes | Supported directly | — |
| Security barrier views | Supported with modification | F-04 |
| Materialised views | Supported with modification | F-05 |
| Concurrent index creation | Requires alternative implementation | F-06 |
| Not-valid constraints | Supported with modification | F-07 |
| Trigger enforcement | Supported directly | — |
| Absence of deferrable constraints | Supported directly | — |
| Generated identity columns | Supported directly | — |
| Generated columns as partition keys | **Not feasible** | F-08 |
| Row-level security policies | Supported with modification | F-09 |
| Security definer functions | Supported directly | — |

## 1.2 F-01 — Foreign keys to partitioned relations must be composite

**Decision.** §5.6.7 states that foreign keys reference the surrogate primary key of the parent, with composite keys used only for partition binding.

**Impact.** PostgreSQL requires that a primary key on a partitioned relation include every partition key column. The primary key of `feature_value` is therefore not the surrogate key alone but the surrogate key together with its as-of attribute; the same applies to `module_reading`, `fixture`, and every other partitioned relation. Consequently **every foreign key referencing a partitioned relation must be composite**, and every referencing relation must carry the referenced relation's partition key as an additional column.

This affects, at minimum:

| Referencing relation | Referenced relation | Additional column required |
|---|---|---|
| `snapshot.snapshot_feature_state` | `feature.feature_value` | Cited value's as-of |
| `snapshot.snapshot_module_reading` | `module.module_reading` | Cited reading's as-of |
| `module.module_evidence_item` | `feature.feature_value` | Cited value's as-of |
| `feature.feature_lineage` | `feature.feature_value` (twice) | Both endpoints' as-of |
| `snapshot.match_snapshot` | `football.fixture` | Fixture partition date — already specified |
| `product.watchlist` | `football.fixture` | Fixture partition date |

**Recommended implementation.** Restate §5.6.7 to declare that a foreign key referencing a partitioned relation is composite by necessity, comprising the surrogate key and the referenced relation's partition key. Add the corresponding columns to the entity catalogue in §5.20. The composite foreign key construction already specified in §5.8.4 for partition binding becomes the general case rather than the exception.

**Reason.** Without this correction the specification cannot be implemented as written: the declared single-column foreign keys have no matching unique constraint to reference.

**Secondary consequence.** Carrying the cited value's as-of on `snapshot_feature_state` enables the temporal ordering constraint identified in F-16, which is otherwise unenforceable declaratively. The correction therefore strengthens the design.

**Severity.** Blocker.

## 1.3 F-02 — Exclusion constraints require an additional extension

**Decision.** §5.9.5 specifies exclusion constraints combining scalar equality with range overlap — player with period, plan with feature and period, registry entry with period.

**Impact.** The default generalised search tree operator class does not support equality on scalar types. An exclusion constraint mixing scalar equality and range overlap requires the `btree_gist` extension, which §5.14.5 does not list.

**Recommended implementation.** Add `btree_gist` to the required extension inventory in §5.14.5, with the stated purpose of supporting mixed scalar and range exclusion constraints.

**Reason.** Without the extension the specified exclusion constraints cannot be created.

**Verification.** No exclusion constraint in the design is declared on a partitioned relation. PostgreSQL does not support exclusion constraints on partitioned relations, and this review confirms that `player_registration`, `player_availability`, `plan_entitlement`, and the version registries are all unpartitioned. No correction is required on this point.

**Severity.** Before DDL.

## 1.4 F-03 — Partial unique indexes are unavailable on partitioned relations

**Decision.** §5.20.4 specifies a partial unique index on `snapshot_model_output` to enforce that exactly one model is canonical per output type. §5.11.4 specifies partial indexes on several relations.

**Impact.** `snapshot_model_output` is partitioned. PostgreSQL does not permit a unique index on a partitioned relation to carry a predicate, so the canonical-designation constraint cannot be enforced as specified.

The remaining partial indexes in §5.11.4 are on unpartitioned relations — `player_registration`, `player_availability`, `subscription`, version registries — and are unaffected. The partial index on fixtures in the forward window is on a partitioned relation but is non-unique, which is permitted.

**Recommended implementation.** Relocate the canonical designation from the per-snapshot output row to the model registry, expressed as an effective-dated designation on the model version with an exclusion constraint preventing overlapping canonical periods per output type. Each snapshot output then records which model produced it, and canonicity at any instant is resolved from the registry.

**Reason.** This is where the designation logically belongs: Phase 4 E4.06 states that the canonical designation is data changeable without redefinition of anything else, which describes a registry attribute rather than a per-claim attribute. The correction realises the logical model more faithfully than the original specification, and it removes a per-row constraint that PostgreSQL cannot enforce.

**Note.** This is a physical relocation, not a logical change. Every Phase 4 guarantee concerning model output is preserved: outputs remain sealed, remain attributed to a named model and version, and remain individually calibrated.

**Severity.** Before DDL.

## 1.5 F-04 — Views require explicit invoker semantics

**Decision.** §5.14.2 specifies security barrier semantics for views exposed to narrower roles.

**Impact.** Security barrier addresses predicate leakage; it does not determine whose privileges and whose row-level security policies apply. A view in PostgreSQL executes with the privileges of its owner unless declared with invoker semantics, which PostgreSQL 15 introduced. A view over a row-level-security-protected relation, owned by a role that bypasses those policies, returns rows the querying principal is not entitled to.

**Recommended implementation.** Declare every view intended to enforce the querying principal's entitlement with invoker semantics in addition to security barrier. State in §5.14.2 that the two properties are independent and that both are required where a view crosses a privilege boundary.

**Reason.** Security barrier alone does not prevent the exposure it appears to address.

**Severity.** Before production.

## 1.6 F-05 — Materialised views do not honour row-level security

**Decision.** §5.13.3 serves the competition, module directory, and calibration read paths from materialised views. §5.17.3 relies on row-level security to confine calculated content to the product layer.

**Impact.** PostgreSQL does not apply row-level security to materialised views, and a materialised view's contents are determined by the privileges in force at refresh, not at read. A materialised view populated from `feature`, `module`, or `calibration` content and granted to an end-user role exposes that content in full, irrespective of the policies protecting its sources.

This is the most significant security finding in this review. It does not indicate a flaw in the security model; it indicates that one mechanism the model relies upon does not extend to one object type the design uses.

**Recommended implementation.** Three rules, added to §5.14.3:

1. A materialised view granted to an end-user role contains only content that role is entitled to see in full. Entitlement-scoped content is not held in a materialised view.
2. Where entitlement scoping is required over materialised content, the materialised view is granted to no end-user role, and access is mediated by a view with invoker semantics and a policy-bearing relation, or by a projection relation which does support row-level security.
3. Every materialised view resides in the `product` schema, so that no object outside the product layer is reachable by an end-user role under any grant.

**Reason.** Without these rules the row-level security posture of §5.17.3 is incomplete for three declared read paths.

**Severity.** Before production. **Classified security-relevant.**

## 1.7 F-06 — Concurrent index creation is not available on partitioned relations

**Decision.** §5.22.2 states that indexes are created concurrently.

**Impact.** PostgreSQL does not support concurrent index creation directly on a partitioned relation. Creating an index on the parent takes a lock preventing writes to every partition for the duration of the build — unacceptable at the volumes projected for `feature_value` and `snapshot_feature_state`.

**Recommended implementation.** Specify the three-stage pattern for partitioned relations: create the index on the parent without recursion so that it exists as an invalid parent index; create the corresponding index concurrently on each partition; attach each partition index to the parent, at which point the parent index becomes valid. Add this to §5.22.2 as the mandated approach for partitioned relations, distinct from the single-step concurrent creation applicable to unpartitioned relations.

**Reason.** The specified approach is unavailable on precisely the relations where it matters most.

**Severity.** Before DDL.

## 1.8 F-07 — Not-valid creation does not apply to unique constraints

**Decision.** §5.22.2 states that constraints are created not-valid and validated separately.

**Impact.** PostgreSQL supports not-valid creation for check and foreign key constraints only. A unique constraint must be built and verified in a single operation, holding a lock for the duration.

**Recommended implementation.** Specify that a unique constraint on a populated relation is introduced by building a unique index concurrently and then adding the constraint using that index, which is a metadata operation. State in §5.22.2 that not-valid creation applies to check and foreign key constraints, and that unique constraints follow the index-first pattern.

**Reason.** The stated approach is not available for one of the three constraint classes it is applied to, and the alternative is materially different in execution.

**Severity.** Before DDL.

## 1.9 F-08 — A generated column cannot be a partition key

**Decision.** §5.9.6 states that where a partitioned relation's partition key is derived from an instant on the same row, the derivation is a generated column.

**Impact.** PostgreSQL prohibits the use of a generated column in a partition key. The rule as stated is not implementable.

**Assessment of actual exposure.** The design does not in practice depend on this rule. Temporal relations are partitioned directly on their as-of attribute, which is a plain column. Snapshot and fixture-scoped relations are partitioned on a denormalised partition date bound by composite foreign key, which is also a plain column. The rule in §5.9.6 is therefore incorrect but unused.

**Recommended implementation.** Remove the first application in §5.9.6 and replace it with a positive statement: a partition key is either a plain column already present in the business key, or a plain column denormalised from a parent and bound by composite foreign key. Retain the second application of generated columns, for access-path expressions, which is valid.

**Reason.** A specification that states an unimplementable rule will be discovered at implementation time and will cast doubt on adjacent rules that are correct.

**Severity.** Before DDL.

## 1.10 F-09 — Row-level security requires forcing and partition-level attention

**Decision.** §5.17.3 enables row-level security on every relation, and §5.17.5 assigns object ownership to a dedicated role that no application process authenticates as.

**Impact.** Two gaps remain.

First, a relation's owner bypasses row-level security unless the relation is declared to force it. The dedicated owner role narrows the exposure but does not eliminate it, since maintenance operations conducted as the owner would silently bypass policies.

Second, row-level security on a partitioned parent applies to queries addressing the parent. A query addressing a partition directly is governed by that partition's own policies. Since partitions inherit neither policies nor forced status automatically, direct partition access would be unprotected.

**Recommended implementation.** Add to §5.17.3: row-level security is forced on every relation carrying policies; and either policies are replicated to partitions, or no role other than the owner holds any privilege on a partition directly, with all access mediated through the parent. The second option is preferred, as it is administered once at schema level and does not require policy replication as partitions are created.

**Reason.** Without both, the stated posture that calculated content is unreachable by end-user roles is incomplete.

**Severity.** Before production. **Classified security-relevant.**

## 1.11 Confirmations

The following decisions are confirmed as supported directly and require no correction: range partitioning at the specified granularities; block-range indexes on partitioned relations, which propagate from the parent; covering indexes including on unique constraints; generated identity columns on partitioned parents, where the sequence resides on the parent; trigger enforcement of the four specified classes; the absence of deferrable constraints, which is achievable because §5.8.6 establishes an acyclic reference graph; and security definer functions with fixed search paths.

---

# 2. Supabase Compatibility Review

## 2.1 Role mapping

| Design role | Platform realisation | Assessment |
|---|---|---|
| `pipeline_ingestion` | Custom database role, direct connection | Creatable. Not reachable through the platform's data interface, which is correct — pipeline processes connect directly. |
| `pipeline_feature` | As above | As above |
| `pipeline_module` | As above | As above |
| `pipeline_calibration` | As above | As above |
| `pipeline_projection` | As above | As above |
| `platform_admin` | Custom database role, direct connection | Creatable. Administrative surfaces requiring end-user authentication must resolve administrative status from the principal's claims rather than by connecting as this role. |
| `authenticated` | Platform-provided | Exists. Reached by principals holding a valid session. |
| `anon` | Platform-provided | Exists. Reached by principals holding no session. |
| `service_role` | Platform-provided | Exists. **Not used by any application process, per §5.17.1.** |

**F-10 — Pipeline roles require explicit connection-path specification.**

**Decision.** §5.17.1 defines five pipeline roles without stating how they connect.

**Impact.** The platform's data interface resolves a principal to `anon`, `authenticated`, or `service_role` from session claims. Custom roles are not reachable by that path without issuing claims signed with the project secret, which is not the intended mechanism for backend processes. Pipeline processes must connect directly to the database using role credentials, and must do so in session mode rather than transaction-pooled mode, because bulk write paths depend on session-scoped state that transaction pooling does not preserve.

**Recommended implementation.** State in §5.17.1 that pipeline and administrative roles are direct-connection roles with credentials, connecting in session mode; and that the platform-provided roles are reached only through the platform's own authentication path.

**Reason.** Without this, an implementer may attempt to reach pipeline roles through the platform interface, which will either fail or require issuing custom claims — a materially different and less controlled arrangement.

**Severity.** Before DDL.

## 2.2 Ownership and privilege on managed PostgreSQL

The platform's administrative role is not an unrestricted superuser. Three consequences bear on this design:

| Constraint | Consequence |
|---|---|
| Event triggers are unavailable | No design element depends on them. Confirmed. |
| System configuration cannot be altered globally | Autovacuum and statistics configuration must be applied per relation rather than instance-wide. §5.24.5 already specifies per-relation configuration. Confirmed compatible. |
| Extensions are limited to an allowlist | All required extensions are within it. See §2.3. |
| Some schemas are platform-managed | The design creates no object in a platform-managed schema. Confirmed. |

**Object ownership.** §5.17.5 specifies a dedicated owner role. This is achievable and is compatible with the platform's migration mechanism, which executes as the administrative role and may create objects owned by another role.

## 2.3 Extension availability

| Extension | Purpose | Availability |
|---|---|---|
| Statement statistics | Access-path monitoring | Available; commonly pre-enabled |
| Cryptographic functions | Checksum computation | Available |
| Scheduled execution | Partition maintenance, retention, refresh | Available; executes within the primary database only |
| `btree_gist` | Mixed scalar and range exclusion constraints (F-02) | Available |
| Geospatial | Gated by PG-01 | Available |

All required extensions are supported. F-02's addition is satisfiable.

## 2.4 Statement timeouts and long operations

**F-11 — Migration and backfill operations require timeout accommodation.**

**Decision.** §5.22.4 specifies bounded, resumable backfills. §5.22.2 specifies lock timeouts on exclusive operations.

**Impact.** The platform applies a statement timeout to roles reached through its data interface, and the migration mechanism may impose its own transaction wrapping. Two specific conflicts arise: concurrent index creation cannot execute inside a transaction block, and long backfill batches may exceed a role-level statement timeout.

**Recommended implementation.** State in §5.22 that migrations containing non-transactional operations are authored as separate migration units executed outside transaction wrapping; and that pipeline and migration roles carry role-level statement timeout settings appropriate to bulk operation, distinct from the settings applied to end-user roles.

**Reason.** Both conflicts produce migration failure rather than silent incorrectness, but both are avoidable by specification rather than by discovery.

**Severity.** Before DDL.

## 2.5 Confirmations

- **`service_role` is never used by application processes.** §5.17.1 states this and no other section contradicts it. Confirmed.
- **Row-level security remains effective**, subject to F-05 and F-09 being resolved. Without those corrections it is incomplete for materialised views and for direct partition access.
- **Migrations can run safely**, subject to F-06, F-07, and F-11. The forward-only, immutable, ordinalled approach of §5.22.1 is compatible with the platform's migration mechanism.
- **Schema exposure.** The design places no object in the default exposed schema. Whichever schemas are reachable through the platform's data interface must be configured explicitly, and only `product` should be so configured. This follows from §5.17.2 and requires no correction, but it is an implementation step that must not be omitted.

---

# 3. Schema and Ownership Review

## 3.1 Schema validation

```
Schema:               football
Owner:                schema owner role (no application process authenticates as it)
Writer:               pipeline_ingestion
Readers:              all pipeline roles, platform_admin, authenticated, anon
Forbidden references: feature, module, snapshot, calibration, product, operations
Validation:           PASS — no outbound reference outside itself; sole writer confirmed
```

```
Schema:               feature
Owner:                schema owner role
Writer:               pipeline_feature
Readers:              pipeline_module, pipeline_calibration, pipeline_projection, platform_admin
Forbidden references: module, snapshot, calibration, product, operations
Validation:           PASS — references football only; no end-user role holds any privilege
```

```
Schema:               module
Owner:                schema owner role
Writer:               pipeline_module
Readers:              pipeline_calibration, pipeline_projection, platform_admin
Forbidden references: snapshot, product, operations
Permitted references: feature, football, calibration (baseline resolution),
                      product.entitlement_feature (vocabulary declaration)
Validation:           PASS — the reference to product.entitlement_feature is a vocabulary
                      reference, not a dependency on product behaviour; the module engine
                      resolves no entitlement and reads no subscription
```

```
Schema:               snapshot
Owner:                schema owner role
Writer:               pipeline_module (insert only); pipeline_calibration (outcome links only)
Readers:              pipeline_calibration, pipeline_projection, platform_admin (read only)
Forbidden references: product
Validation:           PASS with correction — see F-12
```

```
Schema:               calibration
Owner:                schema owner role
Writer:               pipeline_calibration
Readers:              pipeline_module (baseline resolution), pipeline_projection, platform_admin
Forbidden references: product, feature
Validation:           PASS — the bidirectional dependency with module is at schema level only;
                      no relation pair is mutually referential (§5.8.6)
```

```
Schema:               product
Owner:                schema owner role
Writer:               authenticated (own rows, under policy), platform_admin,
                      pipeline_projection (projections only)
Readers:              authenticated, anon (under policy)
Forbidden references: none outbound beyond football and module vocabularies
Validation:           PASS — no schema references product; product is authoritative only for
                      user choice, entitlement, and configuration
```

```
Schema:               operations
Owner:                schema owner role
Writer:               every pipeline role (insert only)
Readers:              platform_admin
Forbidden references: all — operations holds no outbound foreign key to any authoritative relation
Validation:           PASS — telemetry observes without participating; no authoritative row
                      can be made to depend on a telemetry row's survival
```

## 3.2 F-12 — Outcome-link write authority requires relation-level granularity

**Decision.** §5.17.2 grants `pipeline_calibration` insert on snapshot outcome links only, while granting `pipeline_module` insert across the `snapshot` schema.

**Impact.** Privilege in PostgreSQL is granted per relation, not per schema with exceptions. The stated arrangement is expressible but requires that default schema-level grants be avoided in favour of explicit per-relation grants, otherwise `pipeline_calibration` receives insert on all snapshot relations by default grant.

**Recommended implementation.** State in §5.17.2 that no default privileges are configured on the `snapshot` schema and that every grant is per relation, with `pipeline_calibration` granted insert on the outcome link relation alone.

**Reason.** A schema-level default grant would give the calibration role the ability to create snapshots, which the ownership model forbids.

**Severity.** Before DDL.

## 3.3 Ownership assertions

| Assertion | Status |
|---|---|
| `operations` cannot own business data | **Confirmed.** No relation in `operations` holds a football, feature, module, or calibration fact. Its only inbound references are audit attributions from `snapshot` and `calibration`. |
| `product` cannot become a source of truth | **Confirmed.** Projections are verified reconstructible (§5.23.5) and excluded from backup (§5.18.6). The only authoritative product content is user choice, entitlement, and configuration. |
| `snapshot` remains immutable | **Confirmed, subject to F-13.** No role holds update or delete. Guards, restrict semantics, and checksum verification are specified. One attribute is missing — see F-13. |

---

# 4. Partitioning Review

## 4.1 Yearly-partitioned relations

| Relation | Partition key | Pruning | FK compatibility | Assessment |
|---|---|---|---|---|
| `fixture` | Fixture partition date | Effective — every fixture-scoped read supplies a date or a bounded window | All inbound FKs become composite (F-01) | **PASS** with F-01 |
| `fixture_lifecycle_transition` | Fixture partition date | Effective | Composite to fixture | PASS |
| `official_assignment` | Fixture partition date | Effective | Composite to fixture | PASS |
| `lineup`, `lineup_selection` | Fixture partition date | Effective | Composite to fixture | PASS |
| `appearance` | Fixture partition date | Effective for fixture-scoped reads; **weak for player-scoped reads** | Composite to fixture | See F-14 |
| `match_event` | Fixture partition date | Effective | Composite to fixture | PASS |
| `result`, `result_revision` | Fixture partition date | Effective | Composite to fixture | PASS |

**Yearly granularity assessment.** At the projected envelope, `appearance` reaches approximately ten million rows across ten yearly partitions, or one million rows per partition. This is well within the range PostgreSQL handles without sub-partitioning, and yearly granularity keeps the partition count low. Confirmed appropriate.

## 4.2 F-14 — Player-scoped access to appearances does not prune

**Decision.** `appearance` is partitioned by fixture partition date.

**Impact.** The dominant write-path read against appearances is player-scoped and window-bounded: trailing minutes over the last seven and thirty days, for a player. That read supplies a temporal bound and therefore prunes correctly. However, an unbounded player-history read — a career appearance profile — touches every partition.

**Assessment.** This is acceptable rather than defective. Unbounded career reads are not a declared production read path in §5.13.3; they arise in feature calculation, which executes under a pipeline role outside the read-serving path. The per-partition index on player supports the access, and ten partition scans against a one-million-row partition each is bounded work.

**Recommended implementation.** No structural change. State in §5.10.6 that the mandatory partition predicate rule applies to production read paths and that pipeline calculation paths may span partitions where a feature's definition requires an unbounded history.

**Severity.** Optimisation only.

## 4.3 Monthly-partitioned relations

| Relation | Partition key | Rows per partition at envelope | Assessment |
|---|---|---|---|
| `feature_value` | As-of | 10⁶ – 10⁷ average; **up to 5 × 10⁷ in recent partitions** | See §4.4 |
| `feature_lineage` | As-of, co-partitioned | 3 – 5 × the above | See §4.4 |
| `module_reading` | As-of | ~1.7 × 10⁵ | PASS |
| `module_evidence`, `module_evidence_item` | As-of, co-partitioned | ~8 × 10⁵ | PASS |
| `snapshot` relations | Fixture partition date | `snapshot_feature_state` ~1.5 × 10⁶ | PASS |
| `operations` relations | Occurrence instant | `write_record` ~10⁶ | PASS |

**Non-uniformity.** Volume is not evenly distributed across partitions. Thinning reduces older partitions while recent partitions retain full resolution, so recent partitions are materially larger. The figures above reflect this.

## 4.4 `feature_value` — detailed assessment

**Monthly sufficiency.** At the lower bound of the volume envelope, one hundred million rows across one hundred and twenty partitions averages under one million rows per partition — comfortably within efficient range. At the upper bound of one billion rows, concentrated by thinning into recent partitions, a recent monthly partition may reach fifty million rows.

A fifty-million-row partition with the covering index of §5.11.3 remains efficient for the dominant access pattern, which is a bounded index scan returning one row per feature for one subject. It is not efficient for any access requiring a partition scan, and no declared read path requires one.

**Conclusion: monthly partitioning is sufficient at both bounds.** The gated decision PG-02 to defer sub-partitioning is **validated as correct**, and its default of no sub-partitioning should stand unless measurement contradicts it.

**Recommended trigger for revisiting.** Sub-partitioning by hash of subject should be introduced only if a single partition exceeds fifty million rows **and** access-path measurement shows index depth degrading the dominant path. Volume alone is not sufficient justification, because the dominant path's cost is logarithmic in partition size.

**Partition count.** Approximately one hundred and twenty partitions per monthly family across ten years. With eight monthly families and seven yearly families, total partition count approaches one thousand two hundred. This is manageable, with one caveat recorded as F-15.

## 4.5 F-15 — Partition count affects lock acquisition on non-pruning queries

**Decision.** §5.10.4 specifies monthly granularity yielding approximately one hundred and twenty partitions per family.

**Impact.** A query that cannot prune at planning time acquires locks on every partition of the relation. At one hundred and twenty partitions this is tolerable; the risk is that a query written without a partition predicate degrades not merely in scan cost but in lock acquisition and planning time, and does so silently.

**Recommended implementation.** Add to §5.24.3's prohibited patterns an explicit statement that a production read path lacking a partition predicate is a defect detectable by plan inspection, and add a schema conformance assertion in §5.23.2 that examines recorded statement statistics for partitioned-relation access without pruning.

**Reason.** The mandatory predicate rule of §5.10.6 is stated but has no detection mechanism. A rule without detection is a convention.

**Severity.** Before production.

## 4.6 Retention practicality

| Aspect | Assessment |
|---|---|
| Thinning by partition detachment | **Not achievable as stated.** Thinning reduces temporal resolution within a period; it does not remove whole periods. Detachment is available only for bounded operational content, which is removed wholly. See F-17. |
| Detachment blocked by inbound references | **Requires verification.** See F-18. |
| Aggregation before thinning | Correct and achievable. |
| Positive inclusion list | Correct; omission fails safe. |

## 4.7 F-17 — Thinning cannot be executed by partition detachment

**Decision.** §5.15.2 states that temporal relations are thinned "by partition detachment", while §5.18.2 defines thinning as a reduction of temporal resolution within age bands.

**Impact.** These two statements are inconsistent. Reducing resolution within a period requires removing selected rows from a partition, not detaching the partition. Detachment removes every row in the period, which would destroy the retained-boundary values that §5.18.2 requires be preserved.

**Recommended implementation.** Correct §5.15.2 to state that temporal relations are thinned by deletion of eligible rows within partitions, and that partition detachment applies only to bounded operational content whose entire period is removed after aggregation. Note the consequence: thinning produces dead tuples on relations otherwise free of them, so the autovacuum configuration of §5.24.5 must treat thinnable relations as periodically-updated rather than as pure append-only.

**Reason.** As written, the specification prescribes an operation that would destroy the historical answers §5.18.2 guarantees to preserve.

**Severity.** Before DDL. **This is the most consequential internal inconsistency identified in this review.**

## 4.8 F-18 — The detachment-blocking guarantee requires empirical verification

**Decision.** §5.8.7 and §5.18.3 assert that a partition cannot be detached while its rows are referenced by an inbound foreign key, and rely on this to make thinning eligibility structurally enforced rather than procedural.

**Impact.** This is a load-bearing claim: the safety of retention rests on it. PostgreSQL's behaviour on detaching a partition of a relation that is the target of a foreign key must be confirmed empirically against PostgreSQL 16 rather than assumed, and the confirmation must cover both the concurrent and the ordinary detachment forms.

**Recommended implementation.** Add a mandatory pre-implementation verification to §5.23: an empirical test establishing the behaviour, executed on the target platform version, with the result recorded. If detachment is not blocked, the eligibility determination of §5.18.3 must be enforced procedurally by the retention process, with a quality assertion detecting any orphaned citation — a materially weaker guarantee that must be stated as such rather than assumed away.

**Reason.** A structural guarantee resting on unverified platform behaviour is not a structural guarantee. Note that F-17's correction reduces the exposure, since thinning by row deletion is subject to ordinary referential checking, which is certain. The verification remains required for the operational content that is detached.

**Severity.** Before DDL.

---

# 5. Volume Validation

## 5.1 Storage estimation

Estimates assume the row widths implied by the entity catalogue, including the composite foreign key columns required by F-01, twenty-four bytes of row header, and alignment padding.

| Relation | Rows | Estimated row width | Heap | Indexes | Total |
|---|---|---|---|---|---|
| `feature_value` | 10⁸ | ~150 bytes | ~15 GB | ~12 GB | **~27 GB** |
| `feature_value` | 10⁹ | ~150 bytes | ~150 GB | ~120 GB | **~270 GB** |
| `feature_lineage` | 3 × 10⁸ | ~60 bytes | ~20 GB | ~18 GB | **~38 GB** |
| `feature_lineage` | 5 × 10⁹ | ~60 bytes | ~330 GB | ~300 GB | **~630 GB** |
| `snapshot_feature_state` | 1.8 × 10⁸ | ~90 bytes | ~17 GB | ~14 GB | **~31 GB** |
| `module_evidence_item` | 10⁸ | ~70 bytes | ~8 GB | ~7 GB | **~15 GB** |
| `write_record` | 10⁸ | ~60 bytes | ~7 GB | ~4 GB | **~11 GB** |
| All football relations | ~5 × 10⁷ | varies | ~10 GB | ~8 GB | **~18 GB** |
| All other relations | — | — | — | — | **~15 GB** |

| Scenario | Total estimated |
|---|---|
| **Lower bound** — 10⁸ feature values, 3 × 10⁸ lineage | **~155 GB** |
| **Upper bound** — 10⁹ feature values, 5 × 10⁹ lineage | **~990 GB** |

## 5.2 Dominant risks

**Risk 1 — Lineage is the largest object in the design.** At the upper bound, `feature_lineage` alone approaches two-thirds of a terabyte and exceeds `feature_value` itself. This follows from the three-to-five multiplier: every feature value cites several inputs.

Phase 4 LC-47 requires that lineage is never removed while the value it describes is retained, so lineage cannot be thinned independently. **The only lever on lineage volume is feature value volume**, which makes the temporal granularity decision the dominant cost driver in the entire design. This is stated in §5.24.1 but its magnitude is understated: the decision determines an eight-hundred-gigabyte range.

**Risk 2 — The upper bound is a materially different operational proposition.** A one-terabyte managed database is achievable but changes instance sizing, backup duration, restore time, and cost by an order of magnitude relative to the lower bound. This must be a deliberate decision rather than an emergent outcome.

**Risk 3 — Index overhead approaches heap size.** The covering index of §5.11.3 carries value, provenance, sample, and version as payload. This is correct for the dominant access path but nearly doubles the storage of the largest relation. It is a justified trade — heap access at these volumes would be materially worse — but it should be recognised as a deliberate doubling rather than discovered later.

**Risk 4 — Transaction identifier freeze on ageing append-only partitions.** Partitions that are written once and never touched still require freezing before wraparound. Without deliberate configuration, freeze activity will occur unpredictably against very large historical partitions.

## 5.3 F-19 — Freeze management on append-only partitions is unspecified

**Decision.** §5.24.5 relaxes vacuum thresholds for append-only relations and tightens analyse thresholds, and mentions freeze horizon management in §5.24.6 without specifying it.

**Impact.** Relaxing vacuum on relations that accumulate no dead tuples is correct for space reclamation and incorrect for freezing. A partition written in one month and never touched thereafter will eventually require an anti-wraparound vacuum, which will scan the entire partition at an unpredictable time.

**Recommended implementation.** Specify in §5.24.5 that a partition is frozen explicitly once it becomes inactive — that is, once the retention window has moved past it and no further writes are expected — as a scheduled maintenance operation, rather than being left to anti-wraparound. State this as a distinct operation from the vacuum and analyse cadences.

**Reason.** Deliberate freezing converts an unpredictable, large, uninterruptible scan into a scheduled one.

**Severity.** Before production.

## 5.4 Expected query performance

| Read path | Expected characteristic | Assessment |
|---|---|---|
| Match intelligence — sealed snapshot assembly | Partition-pruned, partition-wise gather of a few hundred rows across five co-partitioned relations | **Strong.** The heaviest declared read is bounded and index-served. |
| Prevailing feature values for one subject | Bounded index scan, one entry per feature, index-only | **Strong**, provided the covering index is present |
| Team read path | Projection-served | Strong |
| Competition read path | Materialised view | Strong, subject to F-05 |
| Calibration population selection | Spans partitions by design | Acceptable — executes under the calibration role outside the read-serving path |

No declared production read path requires a scan of a high-volume relation. Objective 3 of §5.1.1 is met.

---

# 6. Feature Value Model Review

## 6.1 Structural validation

| Element | Status |
|---|---|
| Mandatory columns — subject, context, as-of, calculated-at, version, provenance, sample | **Correct.** Present and not-null on every calculated relation; this is what makes LC-D structural. |
| Business unique constraint — subject, context, definition, as-of, version | **Correct**, and the partition key is a member, satisfying PD-05 trivially. |
| Covering index ordering | **Correct.** Subject and context lead because the dominant access retrieves many features for one subject, not one feature across many subjects. |
| Partitioning | **Correct**, monthly on as-of. Validated at both volume bounds (§4.4). |
| Lineage retention | **Correct but volume-dominant.** Bound to feature value retention by LC-47. |
| Thinning strategy | **Inconsistent as specified** — see F-17. |

## 6.2 Is storing every calculation appropriate?

**Assessment: yes, at the specified granularity, subject to the granularity decision being taken deliberately.**

Storing every calculation is what makes historical state resolution a query rather than a reconstruction, and it is the mechanism by which Phase 4 eliminates the destructive singleton pattern. Retreating from it would reintroduce the problem the architecture exists to solve.

The cost is bounded by the granularity decision, not by the principle. Storing every calculation at daily granularity and storing every calculation at hourly granularity differ by a factor of twenty-four in the largest relations in the design.

**Recommendation.** No change to the principle. The granularity decision is confirmed as the single highest-impact open decision in the programme, and it should be taken before DDL rather than after, because it determines instance sizing.

## 6.3 Should calculations be restricted to snapshot points?

**Assessment: no.**

Restricting calculation to snapshot points would reduce volume substantially — feature values would be produced only at four moments per fixture rather than continuously. It would also eliminate the platform's ability to answer what was true about a team on a date on which it did not play, which Phase 4 E5.02 requires and which team and competition read paths depend upon.

**Recommendation.** No change. The volume lever is granularity and thinning, not restriction of calculation to fixture moments.

## 6.4 Should unchanged values be suppressed?

**Assessment: the gated decision PG-03 is correctly framed; its default of no suppression should stand pending measurement.**

Suppression is attractive: many features will not change between consecutive calculations, and suppression would reduce both feature value and lineage volume proportionally to the unchanged fraction.

Two objections bear on it. First, the fact that a calculation ran and confirmed a value is itself information, and suppression makes the calculation history incomplete — §5.12.4 already recognises this. Second, and more significantly, suppression complicates prevailing-value resolution only trivially but complicates **lineage** materially: a suppressed value has no row to which lineage can attach, so the lineage of the confirming calculation is lost.

**Recommendation.** Retain the default of no suppression. If measurement shows a high unchanged fraction and volume proves problematic, adopt suppression only for values whose lineage is unchanged as well, and record the suppression in the write record so that calculation history remains interpretable — as PG-03 already specifies.

## 6.5 Does temporal thinning preserve historical answers?

**Assessment: yes as designed, no as specified. F-17 must be corrected.**

§5.18.2 requires that thinning preserve the prevailing value at every retained boundary, which is the correct rule: historical state resolution at any past instant continues to return the value that prevailed at that instant, at the retained resolution. This is a reduction in resolution, not a change in answer.

§5.15.2's statement that thinning proceeds by partition detachment contradicts this, because detachment removes the boundary values the rule requires be kept. The correction in F-17 resolves it.

**One residual property to state explicitly.** After thinning, a historical query returns the value prevailing at the retained resolution, which may differ from the value that prevailed at finer resolution. This is a deliberate and acceptable loss, but it should be stated in §5.18.2 as a property of thinned periods so that consumers of deep history understand what resolution they are receiving.

**Severity of the residual point.** Before production.

---

# 7. Snapshot Integrity Review

## 7.1 Sealed claim model validation

| Guarantee | Mechanism | Assessment |
|---|---|---|
| Update impossible | Privilege withheld schema-wide; sealing guard; no application path | **Confirmed**, subject to F-09's forcing correction |
| Delete impossible | As above | **Confirmed** |
| Checksum verification possible | §5.23.4 specifies the assertion | **Not achievable as specified** — see F-13 |
| Manifest completeness enforceable | Sealing precondition plus assertion | **Confirmed** |
| Version traversal possible | Foreign keys throughout; no restated designations | **Confirmed** |
| Atomic aggregate creation | Single transaction, ordered topologically | **Confirmed** |
| Referents protected from removal | Restrict semantics on every outbound reference | **Confirmed** |

## 7.2 F-13 — The content checksum has no storage

**Decision.** §5.15.4 records a content checksum at sealing, and §5.23.4 verifies it periodically as the fourth control of PR-04.

**Impact.** The entity catalogue in §5.20.4 defines no attribute to hold it. The specified verification cannot be performed against a value that is not stored.

**Recommended implementation.** Add to `match_snapshot` a not-null content checksum attribute, computed at sealing over a canonical serialisation of the aggregate's content, and a checksum algorithm version reference so that a change of algorithm is attributable and historical checksums remain interpretable.

**Reason.** PR-04 specifies four independent controls over sealed content. Without stored checksums, three are in place and the retrospective detection control is absent.

**Severity.** Before DDL.

## 7.3 F-16 — Temporal ordering of sealed content is unconstrained

**Decision.** §5.12.5 specifies the sealing preconditions: fixture open, no duplicate, referents retrievable, manifest complete.

**Impact.** Nothing prevents a snapshot from citing a feature value or module reading whose as-of instant is **later** than the snapshot's own as-of. A snapshot so constructed would claim to represent what was known at a moment while incorporating information that did not yet exist — precisely the lookahead contamination the platform's evidential positioning exists to exclude, and which the Phase 1 audit found in the previous platform's baseline cohort.

This is the most substantive missing constraint identified in this review.

**Recommended implementation.** With the cited value's as-of present on the sealed content row — a column required in any case by F-01 — the constraint becomes expressible as a same-row check comparing the cited as-of against the snapshot's as-of, provided the snapshot's as-of is also denormalised to the content row. Add both columns and the check to `snapshot_feature_state` and `snapshot_module_reading`, and add a corresponding sealing precondition to §5.12.5.

**Reason.** A declarative, same-row check is available and costs one additional column on each sealed content relation. The alternative — trusting the sealing process — places the platform's central evidential guarantee in application logic.

**Severity.** Before DDL. **This finding should be treated as the highest-value correction in the review**, because it closes a contamination path that would be undetectable in the resulting data.

## 7.4 F-20 — The outcome link business key prevents the revision it mandates

**Decision.** §5.20.4 declares the business identity of `snapshot_outcome_link` as snapshot and outcome dimension. §5.19 and Phase 4 LC-100 require that a result revision produces a **new** outcome link with the original retained.

**Impact.** These are contradictory. A unique constraint on snapshot and dimension permits exactly one link per dimension, so the mandated revision link cannot be written. The specification as issued would either reject revision links or, if the constraint were quietly omitted, permit unbounded duplication.

**Recommended implementation.** Extend the business identity to snapshot, outcome dimension, and revision ordinal, with the original link carrying ordinal zero. Add a partial unique index identifying the prevailing link per snapshot and dimension, so that consumers resolve the current outcome without scanning revisions. Note that `snapshot_outcome_link` is partitioned, so per F-03 the prevailing-link index cannot be both unique and partial; the prevailing designation is therefore expressed by a not-null superseded-at attribute with the current link identified by its absence, resolved by ordinal ordering.

**Reason.** Phase 4 LC-100 exists because calibration must distinguish a claim that was wrong from a claim measured against a figure that was later corrected. Without revision links that distinction is unavailable, and every measurement over a population containing amended fixtures is silently misattributed.

**Severity.** Blocker.

## 7.5 Additional constraints reviewed and confirmed present

| Constraint | Status |
|---|---|
| One verdict per snapshot per composition version | Present |
| No action, stake, or selection attribute on the verdict | Present by absence of any such column |
| Absence recorded rather than approximated | Present via the completeness relation |
| Snapshots exist only at registered points | Present via foreign key to the point vocabulary |
| Manifest enumerates every version in force | Present as precondition and assertion |
| Aggregate completeness | Present as assertion |

## 7.6 Constraints assessed as not required

**Consensus scope.** No constraint asserts that a verdict's consensus derives only from readings within the same snapshot. This is enforceable only by trigger at material cost, and it is covered by the aggregate completeness assertion of §5.23.4. **No correction required**; the residual is acceptable and is already covered.

---

# 8. Row-Level Security Review

## 8.1 Posture by content class

| Content class | Intended posture | Implementable | Findings |
|---|---|---|---|
| Football reality — readable by anonymous and authenticated principals | Permissive read policy | **Yes** | None |
| Feature, module, snapshot, calibration — not directly accessible | Enabled with no permitting policy; deny by default | **Yes**, subject to F-09 | F-09 |
| Product — accessible under entitlement | Policies consulting resolved entitlement | **Yes** | F-05, F-21 |
| Operations — administrative only | Enabled with no permitting policy | **Yes** | None |

## 8.2 Leakage assessment

Three potential leakage paths were assessed.

| Path | Assessment |
|---|---|
| Views over protected relations | **Leaks unless invoker semantics are declared.** F-04 corrects. |
| Materialised views over protected relations | **Leaks. Row-level security does not apply to materialised views.** F-05 corrects. |
| Direct partition access bypassing parent policies | **Leaks unless partition privileges are withheld or policies replicated.** F-09 corrects. |
| Function-mediated access under definer privileges | Does not leak — §5.17.6 requires fixed search paths and argument validation, and the definer set is enumerated by assertion |
| Projection relations | Do not leak — projection relations are ordinary relations and support policies normally |

With F-04, F-05, and F-09 applied, no leakage path remains open.

## 8.3 F-21 — Entitlement resolution within a policy requires a defined mechanism

**Decision.** §5.17.4 places entitlement enforcement at the projection boundary, with policies consulting the resolved entitlement of the requesting principal.

**Impact.** The specification does not state how a policy resolves entitlement. A policy expression that joins across the plan, entitlement matrix, subscription, and configuration flag on every row evaluation would be prohibitively expensive, since policy predicates are evaluated per row.

**Recommended implementation.** Specify a stable resolution function, marked as stable rather than volatile so that PostgreSQL evaluates it once per statement rather than once per row, returning the requesting principal's resolved entitlement set. Policies consult the function's result. State in §5.17.4 that the function is the sole entitlement resolution path, preserving Phase 4's single-resolution-path requirement.

**Reason.** Without a specified mechanism, an implementer will either write per-row joins, which will be slow, or resolve entitlement in the application, which contradicts the requirement that the flag and matrix govern at the database.

**Severity.** Before production.

## 8.4 Confirmations

- Entitlement checks occur at the projection boundary and not within the calculation layers, which hold no principal context. Confirmed correct.
- The platform configuration flag is evaluated within the policy expression, so beta posture governs at the database. Confirmed achievable through the resolution function of F-21.
- No end-user role holds any privilege on `feature`, `module`, `snapshot`, `calibration`, or `operations`. Confirmed by the privilege matrix.

---

# 9. Trigger Review

## 9.1 Trigger inventory

```
Trigger:           tr_<sealed relation>__seal_guard
Table:             every relation in schema snapshot
Event:             BEFORE UPDATE OR DELETE, FOR EACH ROW
Purpose:           Raises unconditionally; secondary control under PR-04
Performance risk:  None — never fires in correct operation
Alternative:       Privilege withdrawal alone; rejected, as privilege configuration can drift
```

```
Trigger:           tr_<temporal relation>__append_guard
Table:             feature_value, feature_lineage, module_reading, module_evidence,
                   module_evidence_item, standing, player_valuation, notification_intent,
                   operational relations
Event:             BEFORE UPDATE OR DELETE, FOR EACH ROW
Purpose:           Raises unconditionally; secondary control under PR-02
Performance risk:  None in normal operation. **Material during thinning** — see F-22
Alternative:       Privilege withdrawal alone; rejected for the same reason
```

```
Trigger:           tr_match_snapshot__lifecycle_guard
Table:             snapshot.match_snapshot
Event:             BEFORE INSERT, FOR EACH ROW
Purpose:           Rejects snapshot creation for a fixture not in the open lifecycle state;
                   protects by default on an unrecognised state
Performance risk:  One indexed lookup per snapshot creation; approximately 1.5 million
                   executions across the envelope. Negligible.
Alternative:       Sealing-process check; rejected, as this is the guarantee that survives
                   a future writer that does not know the rule
```

```
Trigger:           tr_module_reading__baseline_version_match
Table:             module.module_reading
Event:             BEFORE INSERT, FOR EACH ROW
Purpose:           Enforces LC-66 — a reading cites a baseline at its own module version
Performance risk:  One indexed lookup per reading; ~2 × 10⁷ executions. Acceptable.
Alternative:       Denormalise the baseline's module version onto the reading and enforce by
                   same-row check. **Recommended** — see F-23
```

```
Trigger:           tr_feature_value__provenance_propagation
Table:             feature.feature_value
Event:             AFTER INSERT, FOR EACH STATEMENT
Purpose:           Enforces LC-37 — provenance no stronger than the weakest lineage input
Performance risk:  **High if per-row.** Requires aggregation over lineage for each value.
Alternative:       Statement-level evaluation over the inserted set — mandated; see F-24
```

```
Trigger:           tr_feature_value__context_validity
Table:             feature.feature_value
Event:             BEFORE INSERT, FOR EACH ROW
Purpose:           Enforces LC-34 — context kind is among those the definition declares valid
Performance risk:  One indexed lookup per value against a small registry; **material at 10⁹ rows**
Alternative:       Denormalise the definition's valid context kinds and enforce by same-row
                   check. **Recommended** — see F-23
```

```
Trigger:           tr_watchlist__referential_defence
Table:             football.fixture, football.team, football.competition
Event:             AFTER DELETE, FOR EACH ROW
Purpose:           Removes watchlist entries referencing a removed entity (LC-155)
Performance risk:  None — reality entities are not deleted in normal operation
Alternative:       None; polymorphic references admit no declarative alternative
```

**Structured payload validation** is listed in the review scope. It is **not** a trigger in this design: §5.14.6 enforces the payload policy by design review and by the schema conformance assertion of §5.23.2, which inspects column types rather than values. This is correct — a trigger cannot detect that a payload column exists where it should not.

## 9.2 F-22 — Append guards conflict with thinning

**Decision.** Append-only guards raise unconditionally on delete. F-17's correction establishes that thinning proceeds by deletion of eligible rows.

**Impact.** The guard as specified would block the retention process. The two mechanisms are in direct conflict once F-17 is applied.

**Recommended implementation.** The guard raises on delete except when the deleting role is the retention role and the session carries the retention marker set by the retention process. State the exception explicitly in §5.9.7, and add a schema conformance assertion confirming that no role other than the retention role holds delete privilege on a thinnable relation.

**Reason.** Without the exception, retention cannot execute. Without the narrow scoping of the exception, the append-only guarantee is weakened for all roles rather than for one controlled process.

**Severity.** Before DDL. **This finding arises from F-17 and must be resolved with it.**

## 9.3 F-23 — Two triggers should be replaced by same-row checks

**Decision.** Baseline version matching and context validity are enforced by trigger.

**Impact.** Both execute per row on the two highest-volume calculated relations. At the projected volumes this is up to one billion trigger executions during initial population, each performing an indexed lookup against a small registry relation.

**Recommended implementation.** Denormalise the referenced registry attribute onto the row and enforce by same-row check:

| Constraint | Denormalised attribute | Binding |
|---|---|---|
| Reading cites a baseline at its own module version | The baseline's module version | Composite foreign key to the baseline's unique key including its module version |
| Value's context kind is valid for its definition | The definition's permitted context kinds | Composite foreign key to a definition-and-context-kind relation |

The second is the cleaner construction: a relation enumerating permitted definition and context-kind pairs, referenced by composite foreign key from the value, replaces the trigger entirely with a declarative reference.

**Reason.** PR-09 requires enforcement at the lowest capable layer, and both constraints are expressible declaratively once the binding relation exists. The trigger implementations are therefore incorrectly placed under the design's own principle, and they are the two most costly triggers in the design.

**Severity.** Before DDL.

## 9.4 F-24 — Provenance propagation must be statement-level

**Decision.** §5.9.7 lists provenance propagation as a cross-relation invariant enforced by trigger, without specifying granularity.

**Impact.** Evaluated per row, the check aggregates over each value's lineage individually — a correlated aggregation executed up to one billion times. This would dominate write cost.

**Recommended implementation.** Specify statement-level evaluation over the transition table of inserted rows, joined once against lineage. State the requirement explicitly in §5.9.7, since the default assumption for a constraint-enforcing trigger is per-row.

**Reason.** The distinction is the difference between a viable write path and an unviable one.

**Severity.** Before DDL.

## 9.5 Trigger burden assessment

After F-23 and F-24 are applied, the residual per-row trigger burden on the two highest-volume relations is **nil**: the guards fire only on prohibited operations, and both value-checking triggers become declarative constraints. The remaining triggers execute at snapshot and reading volumes, which are two orders of magnitude lower.

This is the correct outcome. A design imposing per-row trigger execution on a billion-row write path would not meet its own performance objective.

---

# 10. Migration Strategy Review

## 10.1 Approach validation

| Property | Assessment |
|---|---|
| Forward-only | **Sound.** A down migration that removes a relation destroys a claim, which LC-B forbids. |
| Immutable once applied | **Sound**, and compatible with the platform's migration mechanism |
| Zero downtime | **Achievable**, subject to F-06, F-07, and F-11 |
| Expand, populate, migrate, contract | **Sound.** Correctly applied to renames, narrowing changes, and partitioning introduction |
| Ordinalled, never reused | Sound |
| Recorded with checksum | Sound |

## 10.2 Risk assessment by operation

| Operation | Risk | Mitigation |
|---|---|---|
| Creating a partitioned relation with its initial partitions | Low — the relation is empty | None required |
| Introducing partitioning to a populated relation | **High** — requires full data movement | Expand, populate, migrate, contract; the new partitioned relation is populated in bounded batches and the switch is a rename under a brief exclusive lock |
| Creating indexes on populated partitioned relations | **High** — concurrent creation unavailable at parent level | F-06's three-stage pattern, per partition |
| Validating foreign key constraints on 10⁸–10⁹ row relations | **High** — validation scans the referencing relation | Create not-valid, validate per partition, so each validation is bounded and interruptible |
| Backfilling `feature_lineage` | **Highest** — largest relation, composite foreign key checks against a partitioned parent | Batch by source partition; ensure the parent's supporting index is present before backfill begins; consider creating the foreign key not-valid and validating after |
| Backfilling `snapshot_feature_state` | **High** — 1.8 × 10⁸ rows with foreign keys crossing partitioning schemes | As above |
| Adding a unique constraint to a populated relation | Moderate | F-07's index-first pattern |
| Populating vocabularies and registries | Low | Ordinary inserts |

## 10.3 F-25 — Cross-scheme foreign key validation is the dominant migration cost

**Decision.** Sealed content references feature values and module readings, which are partitioned on a different key from the sealed content itself.

**Impact.** A foreign key from `snapshot_feature_state`, partitioned by fixture date, to `feature_value`, partitioned by as-of, cannot benefit from partition-wise validation: each check is a lookup into whichever partition of the parent holds the referenced row. At 1.8 × 10⁸ rows this is the single most expensive operation in any migration or backfill.

**Recommended implementation.** State in §5.22.4 that foreign keys crossing partitioning schemes are created not-valid and validated as a separate, resumable operation after backfill, and that validation proceeds partition by partition on the referencing side so that each unit is bounded and interruptible.

**Reason.** Performed inline, this validation would extend a migration beyond any reasonable maintenance window.

**Severity.** Before production. **Applies to initial population as well as to migration.**

## 10.4 Recommended migration ordering

Derived from the topological ordering of §5.8.6 and the dependency structure of the design.

| Stage | Content |
|---|---|
| 1 | Extensions; schemas; owner and pipeline roles without privileges |
| 2 | Reference vocabularies in every schema — country, position, statistics domain, module status, outcome dimension, snapshot point, provenance class, context kind, subject kind, currency |
| 3 | Version registries — feature, module, model, verdict composition, consensus, calibration, outcome derivation, read model, quality check |
| 4 | `football` structural relations — competition, edition, stage, venue, team, player and its dependents |
| 5 | `football` fixture-scoped relations with their yearly partitions |
| 6 | `feature` registry relations — definition, calculator, source, dependency, and the definition-and-context-kind binding relation of F-23 |
| 7 | `feature` value and lineage, partitioned, **without foreign keys to the value relation initially** |
| 8 | `module` registry and reading relations, partitioned |
| 9 | `calibration` relations — population, series, run, result, baseline, gate |
| 10 | `snapshot` relations, partitioned and co-partitioned |
| 11 | Cross-scheme foreign keys, created not-valid |
| 12 | `product` relations — plan, entitlement, matrix, subscription, user-owned relations |
| 13 | `operations` relations, partitioned |
| 14 | Indexes on empty relations; the three-stage pattern reserved for later population |
| 15 | Triggers and guards |
| 16 | Row-level security enablement, forcing, and policies |
| 17 | Privilege grants — per relation, no schema defaults |
| 18 | Read model registry, projections, materialised views |
| 19 | Scheduled maintenance registration — partition creation, retention, refresh, assertions |
| 20 | Foreign key validation, resumable, after any initial population |

**Two ordering rules of consequence.** Privilege grants are applied last, after every object exists and after policies are in force, so that no window exists in which an object is reachable without its policy. Foreign key validation is last, so that initial population is not gated on validation cost.

---

# 11. Implementation Blockers

| Ref | Issue | Severity | Blocking? | Action |
|---|---|---|---|---|
| F-01 | Foreign keys to partitioned relations must be composite | Blocker | **Yes** | Restate §5.6.7; add partition key columns to referencing relations throughout §5.20 |
| F-20 | Outcome link business key prevents mandated revisions | Blocker | **Yes** | Add revision ordinal to the business identity; express prevailing link by superseded-at absence |
| F-16 | Temporal ordering of sealed content unconstrained | Before DDL | **Yes** | Denormalise cited and snapshot as-of; add same-row check; add sealing precondition |
| F-17 | Thinning specified as partition detachment contradicts resolution reduction | Before DDL | **Yes** | Correct §5.15.2 to deletion within partitions; adjust autovacuum posture for thinnable relations |
| F-22 | Append guards block the retention process | Before DDL | **Yes** | Scope the guard exception to the retention role under a session marker |
| F-13 | Content checksum has no storage | Before DDL | **Yes** | Add checksum and algorithm version attributes to `match_snapshot` |
| F-08 | Generated column stated as partition key is not permitted | Before DDL | **Yes** | Remove the rule from §5.9.6; restate partition keys as plain columns |
| F-03 | Partial unique index unavailable on a partitioned relation | Before DDL | **Yes** | Relocate canonical model designation to the model registry with an effective-dated exclusion constraint |
| F-06 | Concurrent index creation unavailable on partitioned relations | Before DDL | **Yes** | Specify the three-stage per-partition pattern |
| F-07 | Not-valid creation unavailable for unique constraints | Before DDL | **Yes** | Specify the index-first pattern for unique constraints |
| F-23 | Two per-row triggers should be declarative | Before DDL | **Yes** | Introduce binding relations; replace triggers with composite foreign keys and same-row checks |
| F-24 | Provenance propagation granularity unspecified | Before DDL | **Yes** | Specify statement-level evaluation over transition tables |
| F-02 | `btree_gist` absent from the extension inventory | Before DDL | **Yes** | Add to §5.14.5 |
| F-10 | Pipeline role connection path unspecified | Before DDL | **Yes** | State direct connection in session mode; platform roles reached only by the platform's authentication path |
| F-11 | Statement timeout and transaction wrapping conflicts | Before DDL | **Yes** | Separate non-transactional migrations; role-level timeout settings for bulk operation |
| F-12 | Schema-level default grants would over-privilege calibration | Before DDL | **Yes** | Per-relation grants; no schema defaults on `snapshot` |
| F-18 | Detachment-blocking guarantee unverified | Before DDL | **Yes** | Empirical verification on the target version; fall back to procedural eligibility with an assertion if unconfirmed |
| F-05 | Materialised views do not honour row-level security | Before production | No | Confine materialised views to non-entitlement-scoped content in `product`; mediate scoped content through projections |
| F-09 | Row-level security requires forcing and partition-level attention | Before production | No | Force policies; withhold direct partition privileges |
| F-04 | Views require explicit invoker semantics | Before production | No | Declare invoker semantics alongside security barrier |
| F-21 | Entitlement resolution mechanism unspecified | Before production | No | Specify a stable resolution function as the sole path |
| F-25 | Cross-scheme foreign key validation cost | Before production | No | Not-valid creation with resumable per-partition validation |
| F-15 | No detection for the mandatory partition predicate rule | Before production | No | Add an assertion over recorded statement statistics |
| F-19 | Freeze management on ageing append-only partitions unspecified | Before production | No | Schedule explicit freezing when a partition becomes inactive |
| §6.5 | Thinned-period resolution not stated to consumers | Before production | No | State the property in §5.18.2 |
| F-14 | Player-scoped appearance reads do not prune | Optimisation | No | No structural change; clarify that the predicate rule binds production read paths |
| PG-02 | Sub-partitioning of `feature_value` | Optimisation | No | **Validated as correctly deferred**; default of no sub-partitioning stands |
| PG-03 | Identical-value suppression | Optimisation | No | **Validated as correctly deferred**; default of no suppression stands |
| PG-01 | Geospatial representation | Optimisation | No | Unchanged; default of numeric coordinates stands |

**Seventeen corrections are required before DDL. Two of those are blockers.** Eight further corrections are required before production. Four items are optimisation only, three of which are the previously gated decisions, all of which this review validates as correctly deferred with their stated defaults.

---

# 12. Final Decision

## **B. APPROVED WITH REQUIRED CHANGES**

The Phase 5 Physical Database Design is sound in structure, internally coherent in almost all respects, and faithful to every Phase 4 guarantee. It is not implementable as issued.

Seventeen corrections must be applied to the specification before DDL is authored. **None requires a change to the architecture, the logical model, or any Phase 4 guarantee.** Every correction is a physical realisation detail: a platform capability the specification assumed and the platform does not provide, an internal inconsistency between two sections, or a missing attribute or constraint.

## 12.1 Mandatory changes

**Blockers — the specification is not implementable until these are corrected.**

1. **F-01.** Restate foreign keys to partitioned relations as composite by necessity, and add the required partition key columns to every referencing relation in the entity catalogue.
2. **F-20.** Add a revision ordinal to the outcome link business identity, and express the prevailing link by absence of a superseded-at instant.

**Before DDL — required for a correct and viable implementation.**

3. **F-16.** Denormalise the cited artefact's as-of and the snapshot's as-of onto sealed content rows; add a same-row check enforcing that cited content does not postdate the snapshot; add the corresponding sealing precondition.
4. **F-17.** Correct thinning to deletion of eligible rows within partitions; restrict partition detachment to bounded operational content; adjust the autovacuum posture for thinnable relations accordingly.
5. **F-22.** Scope the append-only guard's delete exception to the retention role under a session marker, and assert that no other role holds delete privilege on a thinnable relation.
6. **F-13.** Add content checksum and checksum algorithm version attributes to the snapshot header.
7. **F-08.** Remove the generated-column partition key rule; restate partition keys as plain columns, either present in the business key or denormalised and bound by composite foreign key.
8. **F-03.** Relocate the canonical model designation from the sealed output row to the model registry, effective-dated with an exclusion constraint.
9. **F-06.** Specify the three-stage per-partition pattern for index creation on partitioned relations.
10. **F-07.** Specify the index-first pattern for unique constraints on populated relations.
11. **F-23.** Introduce binding relations for baseline version matching and definition context validity; replace both triggers with composite foreign keys and same-row checks.
12. **F-24.** Specify statement-level evaluation for provenance propagation.
13. **F-02.** Add `btree_gist` to the required extension inventory.
14. **F-10.** State that pipeline and administrative roles are direct-connection roles operating in session mode.
15. **F-11.** Separate non-transactional operations into their own migration units; specify role-level statement timeouts for bulk operation.
16. **F-12.** Specify per-relation grants on the `snapshot` schema with no schema-level defaults.
17. **F-18.** Verify the partition detachment blocking behaviour empirically on the target platform version, and record the result; adopt procedural eligibility with a detecting assertion if the behaviour is not confirmed.

## 12.2 Assessment of the specification

Three properties of the specification are confirmed by this review and warrant explicit statement, because they are what make the corrections above tractable rather than structural.

**The layer and ownership model is enforceable as designed.** Schema boundaries, the privilege matrix, and the acyclic reference graph together make layer violations impossible rather than merely prohibited. No finding in this review concerns ownership, layering, or dependency direction.

**Every Phase 4 guarantee survives the corrections.** Not one of the seventeen changes weakens immutability, versioning, temporal identity, context identity, historical preservation, or single ownership. Two of them — F-16 and F-03 — strengthen the realisation of the logical model.

**The three gated decisions were correctly deferred.** Sub-partitioning, identical-value suppression, and geospatial representation are validated as optimisation questions with sound defaults, not as design gaps. The design is implementable and correct under all three defaults.

## 12.3 Outstanding dependency

The temporal granularity decision recorded as open in Phase 4 determines feature value volume within an order of magnitude and, through the lineage multiplier, determines total storage between approximately one hundred and fifty gigabytes and approximately one terabyte.

**This decision should be taken before DDL rather than after**, because it determines instance sizing, backup and restore duration, and cost by an order of magnitude. It does not affect the structure of the design, which is correct at both bounds, but it does affect the operational commitment being made.

---

## Document control

| | |
|---|---|
| **Phase** | 5.5 — Physical Validation Review |
| **Reviews** | Document 08 — V2 Physical Database Design |
| **Target platform** | PostgreSQL 16 under Supabase |
| **Findings** | 25 |
| **Blockers** | 2 |
| **Required before DDL** | 17 |
| **Required before production** | 8 |
| **Optimisation only** | 4 |
| **Outcome** | **B — Approved with required changes** |
| **Next** | Apply the seventeen corrections to document 08, then author DDL in the ordering of §10.4 |
