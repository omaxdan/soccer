# PitchTerminal V2 — Physical Database Design

**Phase 5.** Engineering specification translating the Phase 4 logical data model into a physical design for PostgreSQL 16 under Supabase.

**Target platform.** PostgreSQL 16, Supabase-managed, with the `auth` schema and its role hierarchy present as an external dependency.

**Normative status.** This document is binding on implementation. Where it states a rule, that rule is a requirement. Where it identifies a decision as gated on measurement, that decision is deferred and the gating measurement is named.

**Scope exclusions.** This document contains no data definition language, no migration scripts, no procedural code, and no interface or presentation design. Illustrative fragments appear only where a physical concept cannot be stated precisely in prose, and are marked as illustrative.

**Relationship to Phase 4.** Phase 4 states what the platform holds and what must be true of it. Phase 5 states how PostgreSQL realises those statements. No physical decision in this document alters, weakens, or reinterprets a logical guarantee. Where a physical mechanism cannot fully enforce a logical constraint, this document names the residual enforcement point and the validation that covers it.

---

## Reference conventions

| Reference form | Meaning |
|---|---|
| `E<n>.<m>` | A logical entity as defined in Phase 4 |
| `LC-<nn>` | A logical constraint as enumerated in Phase 4 §4.15 |
| `LC-A` … `LC-E` | The five cross-cutting logical constraints |
| `PR-<nn>` | A physical design principle stated in §5.2 |
| `PD-<nn>` | A physical decision recorded in this document |
| `PG-<nn>` | A gated decision, deferred pending a named measurement |

---

# 5.1 Purpose

## 5.1.1 Objectives

The physical design has six objectives, stated in priority order. Where they conflict, the earlier prevails.

1. **Preserve every logical guarantee.** Ownership, lifecycle, versioning, identity, constraint, layer boundary, immutability, and temporal behaviour are realised without exception. A physical convenience that weakens a guarantee is rejected.
2. **Make guarantees enforceable by the database.** A guarantee upheld only by application discipline degrades at the first unfamiliar writer. Enforcement is placed at the lowest layer capable of expressing it, and privilege is withheld wherever a capability is not required.
3. **Establish predictable access paths.** Every read path named in this document resolves through a declared access path with bounded cost characteristics. No production read path depends on a sequential scan of a high-volume relation.
4. **Support the stated growth envelope.** The design accommodates ten years of history across the platform's coverage target without structural revision.
5. **Preserve auditability.** Every stored fact traces to the execution that produced it and the rule version that governed it, by reference traversal rather than by restated attribute.
6. **Separate write concerns from read concerns.** Write paths optimise for correctness, atomicity, and idempotence. Read paths optimise for latency and are served from structures that are rebuildable without loss.

## 5.1.2 Realisation without redesign

The logical model is treated as fixed. Physical design exercises discretion in four areas only:

| Area of discretion | Bound |
|---|---|
| Representation | How a logical construct is expressed as a relation, type, or constraint |
| Enforcement placement | Which mechanism upholds a logical constraint |
| Physical organisation | Partitioning, indexing, storage layout, and access paths |
| Operational policy | Refresh cadence, retention execution, maintenance scheduling |

Four areas are outside physical discretion entirely: the set of logical entities, their identity composition, their lifecycle class, and the constraints enumerated in Phase 4 §4.15.

## 5.1.3 Controlled denormalisation

Physical design introduces denormalisation in exactly two circumstances, each subject to a mandatory condition:

| Circumstance | Condition |
|---|---|
| A partition key must be present on the partitioned relation | The denormalised attribute is bound to its source by a composite foreign key referencing a redundant unique key on the parent, so consistency is enforced declaratively rather than by convention |
| An access path requires an attribute not otherwise present | The attribute is derived by a generated column from attributes of the same row, or is bound as above |

Denormalisation introduced by any other justification is prohibited. This preserves LC-C: a denormalised attribute is a physical representation of a fact whose owner is unchanged, never a second owner.

## 5.1.4 Residual enforcement

Certain logical constraints cannot be expressed declaratively in PostgreSQL. For each, this document names three things: the mechanism that enforces it, the privilege configuration that narrows the opportunity for violation, and the validation in §5.23 that detects violation should it occur. A constraint with no named enforcement is a defect in this document, and §5.25 asserts that none remains.

---

# 5.2 Design Principles

Nine physical engineering principles. Every subsequent decision in this document derives from one or more.

## PR-01 — Business identity is realised, not replaced

Every relation carries a surrogate primary key for referential stability and, separately, a unique constraint expressing the business identity stated in Phase 4 §4.14. The surrogate key exists to make references stable and narrow; it does not constitute identity and never substitutes for the business key.

A relation whose business identity is not expressed as a unique constraint is incorrectly realised.

## PR-02 — Append-only is enforced by privilege, not by convention

For every relation whose lifecycle class forbids modification, `UPDATE` and `DELETE` privileges are withheld from all roles capable of connecting, and a row-level guard raises on any attempt that circumvents privilege configuration.

Withholding privilege is the primary control. The guard is the secondary control, and exists because privilege configuration is a deployment artefact that can drift.

## PR-03 — Partition keys are immutable and locally present

Every partitioned relation is partitioned on an attribute that is immutable for the lifetime of the row and physically present on the row. Where the natural partitioning axis originates on a parent relation, the attribute is denormalised under §5.1.3 and bound by composite foreign key.

Partitioning on a mutable attribute is prohibited: a row whose partition key changes must be relocated, and relocation is a delete and an insert, which contradicts the append-only and sealed lifecycle classes.

## PR-04 — Sealed data is physically unmodifiable

Relations in the sealed lifecycle class are protected by four concurrent mechanisms: withheld modification privilege, a row-level guard, absence of any application path capable of modification, and a validation assertion that detects modification retrospectively.

This is deliberate redundancy. Sealed claims are the platform's primary asset, and their protection is not delegated to a single mechanism.

## PR-05 — Version identity is referenced, never restated

Version identity is realised exclusively as a foreign key to a version registry relation. No relation carries a version designation as a text attribute.

This realises Phase 4 §4.13.2 physically. A restated designation cannot be traversed, cannot be validated, and goes stale silently.

## PR-06 — Every read path is declared and measured

Each read path named in §5.13 has a declared access path, a declared latency expectation, and a declared refresh strategy where it is served from a projection. A read path introduced without these is unspecified and is outside this design.

## PR-07 — Projections are rebuildable and hold no authority

Every projection and materialised view is reconstructible from authoritative relations. None carries an attribute whose value cannot be derived from them.

This realises LC-144 and LC-145. Any projection failing this test holds information nothing else holds and is misclassified.

## PR-08 — Write and read concerns are separated by structure and privilege

Write paths address authoritative relations exclusively. Read paths address projections and declared views in preference to authoritative relations. Roles are granted the narrower of the two capabilities appropriate to their function.

## PR-09 — Enforcement is placed at the lowest capable layer

The enforcement hierarchy is, in descending order of preference: column definition, declarative constraint, exclusion constraint, generated column, trigger, privilege configuration, application logic with a corresponding validation assertion.

A constraint enforced higher in the hierarchy than necessary is incorrectly realised.

---

# 5.3 Physical Schemas

## 5.3.1 Schema inventory

Seven schemas are defined, corresponding to the logical layers and cross-cutting owners of Phase 4. Schema boundaries are the primary physical expression of ownership and of layer separation.

| Schema | Logical layer | Owning process class | Contents |
|---|---|---|---|
| `football` | Layer 1 — Football Reality | Ingestion | Provider-reported entities and their governed vocabularies |
| `feature` | Layer 2 — Feature Engine | Feature calculation | Feature registry, versions, values, lineage |
| `module` | Layer 3 — Module Engine | Module calculation | Module registry, versions, readings, evidence |
| `snapshot` | Match Intelligence | Module calculation | Sealed snapshots and all sealed content |
| `calibration` | Calibration | Calibration | Runs, results, series, baselines, populations |
| `product` | Layer 4 — Product | Product and user action | Plans, entitlement, subscriptions, preferences, read models |
| `operations` | Operational | Operations | Pipeline telemetry, quality, coverage, aggregates |

The Supabase-managed `auth` schema is an external dependency. No object in this design is created within it, and references to user identity resolve to `auth.users`.

## 5.3.2 Schema responsibilities

**`football`.** Holds what providers reported. No relation in this schema carries an attribute computed by the platform. Written exclusively by the ingestion role. Read by every calculation role.

**`feature`.** Holds every calculated quantity. Contains the feature registry and its governance relations, the version registry, the feature value relation and its partitions, and lineage. Written exclusively by the feature calculation role. Reads `football`; reads no schema above itself.

**`module`.** Holds judgement. Contains the module registry, version registry, readings, evidence, and the governed status vocabulary. Written exclusively by the module calculation role. Reads `feature` and `calibration` — the latter for baseline resolution only, which is a read of a cross-cutting owner and not an upward layer reference.

**`snapshot`.** Holds sealed claims. Every relation in this schema is in the sealed lifecycle class without exception, which permits a uniform privilege posture: no role holds `UPDATE` or `DELETE` on any object in this schema. Written by the module calculation role via insert only.

Placing sealed content in a dedicated schema rather than alongside its unsealed counterparts is a deliberate physical decision (**PD-01**). It makes the sealing boundary a schema boundary, so protection is administered once at schema level rather than per relation, and a relation added to this schema inherits protection by construction.

**`calibration`.** Holds measurement. Reads `snapshot` and `football`. Written exclusively by the calibration role. Never writes a claim.

**`product`.** Holds commercial and user data, and the read model registry with its projections. The only schema exposed to end-user roles. The only schema with substantial row-level security.

**`operations`.** Holds telemetry. Written by every pipeline role. Read by administrative roles. Referenced by `snapshot` and `calibration` for execution attribution, which is the sole direction in which an authoritative relation depends on an operational one, and exists solely for auditability.

## 5.3.3 Cross-schema reference policy

Cross-schema references are permitted only in the directions enumerated below. Any other cross-schema foreign key is a layer violation.

| From schema | May reference | Justification |
|---|---|---|
| `feature` | `football` | Subject and context resolution; declared sources |
| `module` | `feature`, `football`, `calibration` | Evidence citation; subject resolution; baseline reference |
| `snapshot` | `module`, `feature`, `football`, `operations` | Sealed resolution; fixture anchoring; execution attribution |
| `calibration` | `snapshot`, `module`, `football`, `operations` | Population selection; series keying; outcome derivation |
| `product` | `football`, `module` | Watchlist targets; entitlement requirement declaration |
| `operations` | none | Operations observes without depending |

No schema references `product`. No schema references `snapshot` except `calibration`. `football` references nothing outside itself.

## 5.3.4 Search path policy

No role is configured with a permissive search path. All object references are schema-qualified. This prevents accidental resolution across a schema boundary and makes layer violations visible in static inspection of any statement.

---

# 5.4 Physical Mapping Rules

Each logical construct kind defined in Phase 4 maps to a physical realisation by a fixed rule. The rule is applied without exception; a construct realised otherwise is incorrectly realised.

## 5.4.1 Entity

**Rule.** A base relation.

| Aspect | Realisation |
|---|---|
| Primary key | Surrogate, per §5.6.2 |
| Business identity | Unique constraint over the identity attributes stated in Phase 4 §4.14 |
| Relationships | Foreign keys per §5.8 |
| Mandatory attributes | `NOT NULL` |
| Lifecycle | Privilege configuration and guards per §5.15 |

An entity in the temporal or sealed class is additionally partitioned where §5.10 designates it.

## 5.4.2 Reference vocabulary

**Rule.** A base relation with a stable textual code as its business key, never a PostgreSQL enumerated type.

**Justification (PD-02).** Phase 4 LC-10 requires that a vocabulary entry's meaning is never redefined in place, that retired entries persist, and that sealed claims may reference entries indefinitely. Enumerated types cannot express retirement, cannot carry effective dating, cannot carry the descriptive attributes a governed vocabulary requires, and cannot be referenced by a foreign key. A lookup relation expresses all four.

**Standard attributes.** Every vocabulary relation carries a stable code, a display designation, a meaning statement, an active indicator, and an effective period. Retirement is expressed by closing the effective period, never by deletion.

**Referencing.** Referenced by foreign key on the code, not on a surrogate key. This is the sole exception to §5.6.2, and it is made because vocabulary codes are stable by constraint, narrow, and legible in diagnostic inspection of high-volume relations.

## 5.4.3 Value object

**Rule.** A group of columns on the owning entity's relation, never a separate relation.

**Justification.** A value object has no independent identity by definition. Realising it as a relation would create identity where the logical model states none exists, and would require a join to reconstruct a fact that belongs to a single row.

**Applies to.** Feature provenance, feature sample, module headline, module verdict, confidence interval.

**Naming.** Columns of a value object share a common prefix derived from the value object's name, so the grouping remains legible.

## 5.4.4 Identity component

**Rule.** Columns participating in the owning entity's business unique constraint.

**Applies to.** Subject reference, feature context, module baseline reference.

**Subject reference realisation (PD-03).** Realised as a subject-kind column referencing the subject-kind vocabulary, plus one nullable typed foreign key column per subject kind, with a check constraint asserting that exactly the column corresponding to the declared kind is populated.

This is chosen over a single untyped identifier column because it preserves referential integrity to the subject, which an untyped column cannot. Phase 4 LC-35 requires that a subject reference resolves to an entity of the declared kind; only a typed foreign key enforces this declaratively.

**Feature context realisation.** Realised as a context-kind column referencing the context-kind vocabulary, plus a nullable competition edition foreign key, with a check constraint asserting that the edition is present when and only when the kind is competition-scoped. This realises LC-38 and LC-39.

## 5.4.5 Derived view

**Rule.** A view where the derivation is inexpensive and always current; a materialised view or projection relation where it is not.

**Prohibition.** A derived view is never realised as a base relation written by application logic. That would create a second owner for facts whose owner lies elsewhere, contradicting LC-C.

**Registration.** Every derived view is registered in the read model registry (§5.13.2) with its sources, its refresh strategy, and its freshness tolerance, satisfying LC-105 and LC-141.

## 5.4.6 Disposable projection

**Rule.** A materialised view where the refresh is a complete recomputation; a projection relation written by a refresh process where the refresh is incremental.

| Property | Realisation |
|---|---|
| Rebuildability | Registered rebuild definition; validated per §5.23.5 |
| Authority | None. No attribute not derivable from sources |
| Staleness | A refresh state relation records last refresh, source watermark, and the read model version applied |
| Concurrency | Materialised views intended for concurrent refresh carry a unique index, without which concurrent refresh is unavailable |

Projections are excluded from backup retention policy on the grounds that they are reconstructible; this is stated in §5.18.

## 5.4.7 Historical entity

**Rule.** A base relation in the append-only class, exempt from all thinning, and excluded from every retention process.

**Realisation.** Exemption is expressed positively: retention processes operate on an explicit inclusion list, never on an exclusion list. A relation not named in a retention policy is never thinned, so omission fails safe.

## 5.4.8 Temporal entity

**Rule.** A base relation carrying an as-of attribute within its business unique constraint, partitioned by range on that attribute, with modification privilege withheld.

**Current-state resolution.** The prevailing value for a subject is the row with the greatest as-of not exceeding the requested instant, per business key excluding as-of. Access paths supporting this pattern are specified in §5.11.3.

**Thinning eligibility.** A row is eligible for thinning only when no sealed relation references it directly and no retained lineage row cites it, realising LC-31 and LC-B. The eligibility determination is specified in §5.18.3.

## 5.4.9 Sealed entity

**Rule.** A base relation in the `snapshot` schema, or otherwise designated sealed, with `UPDATE` and `DELETE` withheld from every role, protected by a row-level guard, partitioned by range on an immutable temporal attribute, and excluded from every retention process.

**Insert-only writes.** Sealed relations are written by insert exclusively. No upsert construct is permitted against a sealed relation, because the conflict path of an upsert is an update.

**Referential protection.** A sealed relation's foreign keys to non-sealed relations are declared with restrict semantics, so a referenced row cannot be removed while a sealed claim cites it. This realises LC-31 and LC-80 declaratively rather than procedurally.

## 5.4.10 Mapping summary

| Logical kind | Physical realisation | Partitioned | Modification privilege |
|---|---|---|---|
| Entity (mutable) | Base relation | No | Insert, update |
| Reference vocabulary | Lookup relation, code-keyed | No | Insert, update (governed) |
| Value object | Column group on owner | Inherits | Inherits |
| Identity component | Columns in business unique constraint | Inherits | Inherits |
| Derived view | View or materialised view | No | None |
| Disposable projection | Materialised view or projection relation | Where volume requires | Refresh process only |
| Historical entity | Base relation, append-only, retention-exempt | Where volume requires | Insert only |
| Temporal entity | Base relation, range-partitioned on as-of | Yes | Insert only |
| Sealed entity | Base relation in sealed schema | Yes | Insert only |

---

# 5.5 Naming Standards

One convention governs every physical object. Deviation is a defect.

## 5.5.1 General rules

| Rule | Statement |
|---|---|
| Case | Lower case throughout. No quoted identifiers. |
| Word separation | Single underscore between words. |
| Compound separation | Double underscore between semantic groups within a constraint or index name. |
| Number | Relations are named in the singular. |
| Abbreviation | Prohibited except for the approved list in §5.5.9. |
| Prefixing | Relations carry no schema-derived prefix; the schema provides the namespace. |
| Length | Identifiers do not exceed sixty-three bytes. Where a generated name would exceed this, the abbreviation rules of §5.5.9 apply in the order given. |

## 5.5.2 Relations

Named for the entity they realise, in the singular, without qualification by kind. A relation is not suffixed to indicate that it is a table.

Partitions of a partitioned relation are named as the parent relation followed by a partition suffix per §5.5.8.

## 5.5.3 Columns

| Kind | Convention |
|---|---|
| Surrogate primary key | `id` |
| Foreign key | Referenced relation name suffixed `_id`; where the role differs from the relation name, the role name suffixed `_id` |
| Instant | Suffix `_at` — always `timestamptz` |
| Calendar date | Suffix `_on` — always `date` |
| Period | Suffix `_period` — a range type |
| Vocabulary reference | Suffix `_code` |
| Boolean | Prefix `is_`, `has_`, or `was_` |
| Count | Suffix `_count` |
| Proportion expressed 0–1 | Suffix `_ratio` |
| Proportion expressed 0–100 | Suffix `_pct` |
| Monetary amount | Suffix `_amount`, accompanied by a sibling `_currency_code` |
| Measured quantity | Suffix denoting unit, for example `_km`, `_minutes`, `_metres` |
| Version reference | Suffix `_version_id` |
| Denormalised partition key | Suffix `_partition_on` or `_partition_at` |

The two proportion suffixes are distinguished because the previous platform mixed both representations under one naming pattern, making scale unrecoverable from the column name.

## 5.5.4 Constraints

| Kind | Pattern |
|---|---|
| Primary key | `pk_<relation>` |
| Unique | `uq_<relation>__<attribute list>` |
| Foreign key | `fk_<relation>__<referenced relation>` or `fk_<relation>__<role>` |
| Check | `ck_<relation>__<rule name>` |
| Exclusion | `ex_<relation>__<rule name>` |
| Not-null (where named) | Not named; expressed as a column property |

Rule names in check and exclusion constraints state the rule positively, in the affirmative form of what must hold.

## 5.5.5 Indexes

| Kind | Pattern |
|---|---|
| Non-unique | `ix_<relation>__<attribute list>` |
| Unique | `ux_<relation>__<attribute list>` |
| Partial | Pattern above, suffixed `__<predicate name>` |
| Expression | Pattern above, with the expression named rather than transcribed |
| BRIN | Pattern above, suffixed `__brin` |
| GIN | Pattern above, suffixed `__gin` |

An index whose method is not the default is always suffixed with its method, so that access-path review does not require inspection of index definitions.

## 5.5.6 Views, functions, triggers, policies

| Object | Pattern |
|---|---|
| View | `v_<subject>` |
| Materialised view | `mv_<subject>` |
| Projection relation | `p_<subject>` |
| Function | `fn_<verb>_<subject>` |
| Trigger function | `tf_<relation>__<event>` |
| Trigger | `tr_<relation>__<event>` |
| Row-level security policy | `pl_<relation>__<principal>__<action>` |

Projection relations are prefixed to distinguish them from authoritative relations in inspection, because the distinction governs whether the object may be dropped and rebuilt.

## 5.5.7 Sequences and types

Sequences are named `sq_<relation>__<column>`. Composite and domain types are named `ty_<subject>`. Range types, where custom, are named `rg_<subject>`.

## 5.5.8 Partitions

| Partition strategy | Suffix pattern |
|---|---|
| Range by month | `_p<YYYYMM>` |
| Range by year | `_p<YYYY>` |
| Hash | `_h<nnn>` |
| Default partition | `_pdefault` |

Every range-partitioned relation has a default partition. Its purpose is to accept rows that would otherwise be rejected, making a missing partition a detectable data condition rather than a write failure; §5.19.4 specifies the monitoring that reports a non-empty default partition as a quality breach.

## 5.5.9 Approved abbreviations

The following abbreviations are permitted and are the only ones permitted. Where an identifier must be shortened, they are applied in this order.

`id` (identifier) · `pct` (per cent) · `avg` (average) · `min` (minimum) · `max` (maximum) · `pk`, `uq`, `fk`, `ck`, `ex` (constraint kinds) · `ix`, `ux` (index kinds) · `mv` (materialised view) · `tf`, `tr` (trigger objects) · `pl` (policy) · `km` (kilometres) · `utc` (coordinated universal time)

## 5.5.10 Migration artefacts

Migration files are named with a zero-padded sequential ordinal, an underscore, and a verb-led description in lower snake case. The ordinal is allocated at authoring time and never reused. An applied migration is immutable; a correction is a subsequent migration, never an edit.

---

# 5.6 Identity Realisation

## 5.6.1 Identity kinds and their physical expression

| Logical identity kind (Phase 4 §4.14) | Physical expression |
|---|---|
| Stable identity | Surrogate primary key, plus a unique constraint over the natural identity attributes |
| Version identity | Foreign key to a version registry relation, participating in the business unique constraint |
| Temporal identity | An as-of column participating in the business unique constraint and serving as partition key |
| Context identity | Context-kind and competition-edition columns participating in the business unique constraint |
| Snapshot identity | Fixture, snapshot point, and version manifest columns participating in the business unique constraint |

## 5.6.2 Primary keys

**PD-04.** The default surrogate primary key is a `bigint` generated always as identity.

**Justification.** Every high-volume relation in this design is written by a single coordinating process, so the principal advantage of a client-generated identifier — insertion without coordination — does not arise. Against that, a `bigint` key is half the width of a universally unique identifier, produces monotonically increasing values that yield favourable index locality under bulk append, and reduces the width of every foreign key that references it. At the volumes projected in §5.24.1 this materially affects index size and cache residency.

**Exception.** Relations that participate in Supabase authentication carry `uuid` keys, because `auth.users` is keyed by `uuid` and the reference must match. This applies to the user-referencing relations of the `product` schema.

**Exception.** Reference vocabularies are keyed by their stable code, per §5.4.2.

## 5.6.3 Business keys

Every relation carries a unique constraint expressing the business identity stated in Phase 4. This constraint is the authoritative statement of identity; the surrogate key is a referential convenience.

Business keys are declared as constraints rather than as bare unique indexes, so that they are visible in constraint inspection and available as foreign key targets.

## 5.6.4 Business keys on partitioned relations

PostgreSQL requires that every unique constraint on a partitioned relation include all partition key columns. This interacts with business identity, and the interaction is governed by a rule.

**PD-05 — Functional determination rule.** Where a relation is partitioned and carries a business unique constraint, the partition key must be functionally determined by the attributes of that business key, and the functional dependency must itself be enforced physically.

Where this holds, including the partition key in the unique constraint preserves the strength of the business identity: no additional combination becomes permissible, because the partition key cannot vary independently of the business key attributes.

Two cases arise:

| Case | Realisation |
|---|---|
| The partition key is already a business key attribute | No action. The constraint is unchanged in strength. Applies to every temporal relation partitioned on its as-of attribute. |
| The partition key is denormalised from a parent | The denormalised column is bound to the parent by a composite foreign key referencing a redundant unique key on the parent, which enforces the functional dependency declaratively. |

A partitioned relation whose partition key is not functionally determined by its business key is incorrectly designed, because the resulting unique constraint would be weaker than the business identity it purports to express.

## 5.6.5 Composite identities

Composite business identities are declared as multi-column unique constraints in the attribute order specified below, which is chosen so that the constraint's supporting index also serves the dominant access path.

| Relation family | Business key column order |
|---|---|
| Feature value | Subject, context, feature definition, as-of descending, feature version |
| Module reading | Subject, context, module definition, as-of descending, module version |
| Snapshot | Fixture partition key, fixture, snapshot point, snapshot version |
| Snapshot content | Snapshot partition key, snapshot, referenced artefact |
| Calibration series | Module version, band, outcome dimension, context, snapshot point |

Subject and context precede definition in the temporal families because the dominant access is the retrieval of many features for one subject at one moment, not one feature across many subjects.

## 5.6.6 Alternate and candidate keys

Where a relation has more than one candidate key, one is designated the business key and expressed as a unique constraint; the remainder are expressed as additional unique constraints and designated alternate keys.

Provider-supplied external identifiers are alternate keys, never business keys. They are unique and are enforced as such, but identity does not depend on them, because a provider may reissue or retire an identifier without the entity changing.

## 5.6.7 Foreign keys

Foreign keys reference the surrogate primary key of the parent, except where the parent is a reference vocabulary, in which case they reference the code.

Composite foreign keys are used in one circumstance only: binding a denormalised partition key to its parent under PD-05.

## 5.6.8 Version identity realisation

Version identity is a foreign key to the corresponding version registry relation and participates in the business unique constraint of the relation carrying it. No relation stores a version designation as text (PR-05).

Snapshot version identity is a manifest rather than a single reference, and is realised as a dedicated relation enumerating one row per version component, described in §5.16.3.

## 5.6.9 Subject and context identity realisation

Subject identity is realised per §5.4.4: a subject-kind code, one nullable typed foreign key per subject kind, and a check constraint asserting that exactly the column corresponding to the declared kind is populated.

Context identity is realised as a context-kind code and a nullable competition edition reference, with a check constraint asserting that the reference is present when and only when the kind is competition-scoped.

Both constructs are deliberately wider than an untyped identifier column. The additional width is accepted because it is the only realisation under which the database itself can guarantee that a subject reference resolves to an entity of the declared kind, which Phase 4 LC-35 requires.

---

# 5.7 Attribute Strategy

## 5.7.1 Type selection

| Purpose | Type | Rule |
|---|---|---|
| Surrogate key | `bigint` | Generated always as identity |
| Authentication-linked key | `uuid` | Matches `auth.users` |
| Vocabulary code | `text` | Constrained by foreign key to the vocabulary relation |
| Instant | `timestamptz` | Universally; see §5.7.5 |
| Calendar date | `date` | Only where the calendar day is itself the fact |
| Period | `tstzrange` or `daterange` | For spells and effective periods; see §5.7.9 |
| Metric value | `numeric` | Never a binary floating-point type; see §5.7.2 |
| Count | `integer` or `bigint` | Sized to the projected maximum |
| Proportion | `numeric` | Scale per §5.7.2, with a check constraint bounding the range |
| Monetary amount | `numeric` | Always accompanied by a currency code; see §5.7.8 |
| Boolean | `boolean` | Never nullable where the attribute is meaningful; see §5.7.4 |
| Geographic coordinate | `numeric` | Fixed precision per §5.7.7 |
| Free text | `text` | No length-constrained character types |
| Opaque payload | `jsonb` | Only within the policy of §5.14.6 |

**Character types.** Length-constrained character types are not used. Length constraints, where they express a business rule, are expressed as check constraints, so that the rule is visible as a rule rather than encoded in a type declaration.

## 5.7.2 Numeric precision

**PD-06.** All metric values are stored as `numeric`. Binary floating-point types are not used for any stored value.

**Justification.** Calculated values are compared for equality during validation, aggregated during calibration, and reproduced during replay. Binary floating-point representation makes equality comparison unreliable and makes replay results dependent on aggregation order, which would compromise the reproducibility guarantee of Phase 4 §4.13.2.

**Declared precision.** Feature values are stored in an unconstrained `numeric` column. The scale appropriate to each feature is declared in the feature registry, per Phase 4 E2.02.

**Residual enforcement.** A check constraint cannot reference another relation, so registry-declared scale cannot be enforced declaratively on the value column. Scale conformance is enforced by the calculating process and validated by the quality check specified in §5.19.4. This is a named residual enforcement point under §5.1.4.

**Bounded proportions.** Where a value is bounded by definition, the bound is expressed as a check constraint on the relation carrying it. Feature values are not so constrained, because bounds vary by definition; their bounds are registry-declared and validated as above.

## 5.7.3 Enumerated types versus lookup relations

**PD-02 (restated).** Governed vocabularies are realised as lookup relations. PostgreSQL enumerated types are not used anywhere in this design.

**Justification.** Four requirements of Phase 4 cannot be met by an enumerated type: retirement of an entry without deletion (LC-10), effective dating of an entry, descriptive attributes on an entry, and referential integrity from referencing relations. A lookup relation meets all four. Additionally, adding a value to an enumerated type is a schema change subject to deployment sequencing, whereas adding a vocabulary entry is a data change, which correctly reflects that vocabularies are governed data rather than structure.

## 5.7.4 Null policy

**PD-07.** `NULL` means *not applicable* or *not known*. It never means zero, false, empty, or absent-and-therefore-default.

Four rules follow:

1. Every attribute whose logical model marks it mandatory is `NOT NULL`.
2. Absence of a calculated value is represented by the **absence of a row**, never by a row with a null value. This realises LC-97: absence is recorded as absence, and a null metric value would be indistinguishable from a calculated null.
3. A boolean attribute is `NOT NULL` wherever the underlying fact is binary. Where a third state is meaningful, it is represented by a vocabulary reference, not by a nullable boolean.
4. Where an attribute is nullable, the meaning of its nullity is stated in the relation's documented description, and a check constraint expresses any conditional obligation — for example, that a competition edition reference is present when and only when the context kind is competition-scoped.

## 5.7.5 Time and time zone rules

**PD-08.** Every instant is stored as `timestamptz`. The session time zone for all pipeline and calibration roles is UTC.

**Instants versus dates.** An attribute is a `date` only where the calendar day is itself the fact — a valuation as-of day, a standings as-of day, a snapshot calendar day. An attribute recording when something occurred is an instant.

**Derived calendar attributes.** Where a calendar attribute is derived from an instant for partitioning, the derivation is performed in UTC and is fixed at insert. Deriving in a local time zone would make the value dependent on session configuration and therefore not immutable, contravening PR-03.

**As-of and calculated-at.** Both are `timestamptz` and both are `NOT NULL` on every calculated relation, realising LC-32. They are never collapsed into a single attribute.

## 5.7.6 Ranges

Spells and effective periods are stored as range types rather than as separate start and end attributes.

| Application | Type |
|---|---|
| Player registration period | `daterange` |
| Player availability spell | `daterange` |
| Competition edition period | `daterange` |
| Entitlement grant effective period | `tstzrange` |
| Version effective period | `tstzrange` |
| Vocabulary entry effective period | `tstzrange` |

**Justification.** A range type admits an exclusion constraint, which is the only declarative mechanism in PostgreSQL capable of enforcing non-overlap. Phase 4 LC-08 requires that player registrations for one player do not overlap; separate start and end attributes cannot express this declaratively, and enforcing it procedurally would place a correctness guarantee in application logic unnecessarily.

**Boundary convention.** All ranges are half-open, inclusive of the lower bound and exclusive of the upper. An open-ended period is represented by an unbounded upper bound, never by a sentinel date.

## 5.7.7 Coordinates

Latitude is stored as `numeric(8,6)` and longitude as `numeric(9,6)`, both bounded by check constraints to their valid ranges. Fixed precision at six decimal places corresponds to approximately one-tenth of a metre, which exceeds the accuracy of any provider-supplied venue coordinate.

**PG-01 — Geospatial representation.** Whether a derived geography column is added to support distance calculation is gated on measurement of travel-feature calculation cost against the projected venue count. Where added, it is a generated column derived from the numeric coordinates, which remain authoritative; the derived column is never written directly and never becomes the source of a stored distance.

**Absence.** A venue lacking coordinates carries null coordinates and yields no distance value. LC-05 requires that the resulting calculation produce absence rather than a substituted value, which follows from PD-07 rule 2: absence of a distance is the absence of a feature value row.

## 5.7.8 Currency

Every monetary amount is accompanied by a currency code referencing an ISO 4217 vocabulary relation. A monetary amount without a currency reference is prohibited by `NOT NULL` on the currency column, realising LC-12.

Amounts are stored in the currency in which they were asserted. No conversion is stored. Conversion, where required, is a calculated feature with its own provenance and its own dependency on a rate source, which keeps an estimated conversion legible as an estimate.

## 5.7.9 Attribute grouping for value objects

Value objects are realised as column groups sharing a name prefix, per §5.4.3. Two are of particular note:

**Provenance.** Realised as a provenance class code referencing the provenance vocabulary, `NOT NULL` on every relation carrying a calculated value. This realises LC-36.

**Sample.** Realised as an observation count and a threshold-met indicator, both `NOT NULL` on every relation carrying a calculated value. Retaining the indicator alongside the count, rather than deriving it at read time, is deliberate: the threshold in force at calculation time is the one that governed the value, and a later change to the registry-declared threshold does not retroactively alter whether a historical value met the threshold that applied to it. This realises LC-40 and LC-41.

---

# 5.8 Referential Integrity

## 5.8.1 Declaration policy

Every logical relationship stated in Phase 4 §4.11 is realised as a declared foreign key. Relationships enforced by application logic alone are prohibited, with one exception stated in §5.8.6.

## 5.8.2 Referential action policy

**PD-09.** The default referential action is restrict on delete and restrict on update. Cascading deletion is permitted in exactly one circumstance and prohibited elsewhere.

| Relationship class | On delete | On update | Justification |
|---|---|---|---|
| Reference to a reality entity | Restrict | Restrict | Reality identities are permanent (LC-02). Deletion must fail while any reference exists. |
| Reference to a version registry | Restrict | Restrict | Versions persist permanently, including retired ones (LC-27). |
| Reference to a reference vocabulary | Restrict | Restrict | Vocabulary entries persist; retirement closes an effective period rather than deleting (LC-10). |
| Reference from a sealed relation | Restrict | Restrict | A sealed claim's referents may never be removed (LC-31, LC-80). |
| Reference from a temporal relation | Restrict | Restrict | Thinning eligibility is determined by §5.18.3, never by cascade. |
| Aggregate composition within a sealed snapshot | Cascade | Restrict | See below. |
| Reference to a user identity | Restrict | Restrict | Account deletion is a governed process, not a cascade. |

**The single cascade.** Composition within a sealed snapshot aggregate cascades on delete solely so that the aggregate remains internally consistent should a snapshot ever be removed by an authorised administrative act. In normal operation no snapshot is ever deleted (LC-81), and no role holds the privilege to delete one. The cascade exists to make an extraordinary administrative operation atomic, not to permit routine deletion.

**Update actions.** Restrict on update is universal because no primary key in this design is ever modified. Surrogate keys are generated and immutable; vocabulary codes are stable by constraint. A cascading update action would therefore be unreachable, and declaring one would imply a mutability that does not exist.

## 5.8.3 Nullability of foreign keys

A foreign key column is `NOT NULL` wherever the relationship is mandatory in the logical model. Optional relationships carry nullable foreign keys, and the meaning of nullity is stated per §5.7.4 rule 4.

Subject and context references are a special case: their columns are individually nullable because only one subject-kind column is populated at a time, and the obligation is expressed by check constraint rather than by nullability, per §5.4.4.

## 5.8.4 Composite foreign keys

Composite foreign keys occur in one circumstance: binding a denormalised partition key to its parent under PD-05. The parent carries a redundant unique constraint over its surrogate key and the partitioning attribute; the child references both.

This construction has two effects. It enforces the functional dependency that PD-05 requires, and it enables partition-wise joins between co-partitioned parent and child relations, which §5.11.6 relies upon.

## 5.8.5 Deferred constraints

**PD-10.** Constraints are declared immediate by default. Deferral is granted only where a single logical operation must establish a mutually referential state that cannot be ordered, and no such state exists in this design.

**Justification.** Deferred constraints move violation detection to transaction commit, which obscures the statement responsible and complicates diagnosis in bulk write paths. Since §5.8.6 establishes that the reference graph is acyclic, every write can be ordered so that referents precede referrers, and deferral is unnecessary.

## 5.8.6 Circular dependency avoidance

The physical reference graph is acyclic. Three structural properties guarantee this:

1. **Cross-schema references are unidirectional.** §5.3.3 enumerates permitted directions; no pair of schemas references one another.
2. **Within-schema references follow layer order.** Registry relations are referenced by value relations and never the reverse. Parent aggregates are referenced by their components and never the reverse.
3. **Self-referencing relations reference only earlier rows.** Version registry relations carry a predecessor reference, and a check constraint prevents self-reference. Competition stage may nest, and a nesting depth attribute with a check constraint prevents unbounded recursion.

**The one apparent cycle, resolved.** The `module` schema references `calibration` for baseline resolution, and `calibration` references `module` for version keying. This is not a cycle at relation level: module readings reference published baselines, and calibration series reference module versions. Baselines do not reference readings, and module versions do not reference series. The dependency between the two schemas is bidirectional; the dependency between any pair of relations is not.

**Ordering consequence.** Because the graph is acyclic, a topological ordering of relations exists and is the mandated order for both write sequencing (§5.12.2) and deployment sequencing (§5.22.5).

## 5.8.7 Referential integrity across partitioned relations

Foreign keys referencing a partitioned relation are supported in PostgreSQL 16 and are declared normally. Foreign keys **from** a partitioned relation are likewise declared on the parent and inherited by partitions.

**Consequence for detachment.** A partition cannot be detached while rows in it are referenced by a foreign key from outside. This is a desirable property rather than an obstacle: it prevents a retention process from detaching a partition containing values cited by a sealed claim, which realises LC-31 as a structural impossibility rather than as a procedural check.

---

# 5.9 Constraint Realisation

## 5.9.1 Enforcement mechanism selection

Mechanisms are selected in the order of PR-09. A constraint enforced by a mechanism lower in the hierarchy than necessary is incorrectly realised.

| Mechanism | Applies to |
|---|---|
| Column definition (`NOT NULL`, type, generated) | Mandatory presence; domain of representation; same-row derivation |
| `CHECK` | Value ranges; conditional obligations within a row; enumerated states not held in a vocabulary |
| `UNIQUE` | Business identity; alternate keys |
| `FOREIGN KEY` | Every declared relationship |
| `EXCLUDE` | Non-overlap of periods within a partition of rows |
| Generated column | Same-row derivation used in constraints or access paths |
| Trigger | Cross-row and cross-relation invariants; lifecycle guards |
| Privilege | Capability withdrawal, where the safest action is to make an operation unavailable |
| Application, with validation | Only where no mechanism above can express the rule |

## 5.9.2 Not-null realisation

Applied to every attribute the logical model marks mandatory. Of particular note, and applied without exception across every calculated relation: subject reference kind, context kind, as-of, calculated-at, version reference, provenance class, and observation count.

The universality of these seven is what makes LC-D — every calculated entity carries version, temporal, and context identity — a structural property rather than a convention.

## 5.9.3 Check realisation

| Constraint class | Realisation |
|---|---|
| Bounded values | Range check on the column |
| Conditional obligation | Check over the conditioning column and the conditioned column |
| Subject-kind exclusivity | Check asserting that exactly one typed subject column is populated and that it corresponds to the declared kind |
| Context-kind obligation | Check asserting the competition edition reference is present when and only when the kind is competition-scoped |
| Self-reference prohibition | Check asserting a predecessor reference differs from the row's own key |
| Range well-formedness | Check asserting a lower bound precedes an upper bound where both are present |

Check constraints are named for the rule they assert, expressed affirmatively, per §5.5.4.

## 5.9.4 Unique realisation

Business identity is expressed as a unique constraint on every relation. Alternate keys, including provider-supplied external identifiers, are expressed as additional unique constraints.

**Partial uniqueness.** Where uniqueness applies only to a subset of rows — at most one open registration per player and registration kind, at most one live subscription per user, at most one active version per registry entry — the rule is expressed as a unique index with a predicate rather than as a constraint, because PostgreSQL constraints do not admit predicates. Such indexes are named per §5.5.5 with the predicate suffix.

## 5.9.5 Exclusion realisation

Exclusion constraints enforce non-overlap of periods. They are the sole declarative mechanism capable of doing so and are used wherever the logical model requires it.

| Logical constraint | Realisation |
|---|---|
| LC-08 — player registrations do not overlap for one player and registration kind | Exclusion over player, registration kind, and period |
| Availability spells do not overlap for one player and unavailability kind | Exclusion over player, kind, and period |
| Entitlement grants do not overlap for one plan and entitlement feature | Exclusion over plan, feature, and period |
| Version effective periods do not overlap within one registry entry | Exclusion over registry entry and period |
| Vocabulary effective periods do not overlap within one code | Exclusion over code and period |

Exclusion constraints require an index method supporting the containment operator; the supporting index is created as part of the constraint and is not separately declared.

## 5.9.6 Generated column realisation

Generated columns are used for same-row derivations only, which is the limit of PostgreSQL's support. Two applications arise:

1. **Partition-key derivation from a same-row instant.** Where a partitioned relation's partition key is derived from an instant on the same row, the derivation is a generated column, guaranteeing immutability and consistency without a trigger.
2. **Access-path expressions.** Where an access path requires a normalised or truncated form of a same-row attribute, the form is a generated column rather than an expression index, so that the value is available to constraints as well as to access paths.

Where a partition key must be derived from a **parent** row, a generated column cannot express it, and the composite foreign key construction of §5.8.4 is used instead.

## 5.9.7 Trigger realisation

Triggers enforce what no declarative mechanism can. Four classes exist, and no others are permitted.

| Class | Purpose | Behaviour |
|---|---|---|
| **Sealing guard** | Prevents modification or deletion of a sealed row | Raises on update or delete, unconditionally |
| **Append-only guard** | Prevents modification or deletion of a temporal or append-only row | Raises on update or delete, unconditionally |
| **Lifecycle guard** | Prevents creation of a snapshot for a fixture that has left the open lifecycle state | Raises on insert where the condition holds |
| **Cross-relation invariant** | Enforces an invariant spanning relations that no constraint can express | Raises on violation |

**Guard posture.** The lifecycle guard follows the posture proven in the previous platform: it protects unless the fixture is explicitly in the open state, so an unrecognised or newly-introduced state seals by default. This realises LC-14 and LC-79.

**Prohibited uses.** Triggers do not populate values, do not maintain denormalised copies, do not write to other relations, and do not implement business calculation. A trigger that writes is a second owner, contravening LC-C.

**Cross-relation invariants enforced by trigger.** Three are required:

| Invariant | Logical constraint |
|---|---|
| A module reading cites a baseline whose module version equals the reading's own | LC-66 |
| A feature value's provenance class is no stronger than the weakest class among its lineage citations | LC-37 |
| A feature value's context kind is among those its definition declares valid | LC-34 |

Each is a cross-relation comparison that no check constraint can express, since check constraints cannot reference other relations.

## 5.9.8 Privilege as enforcement

Where the safest realisation of a rule is that an operation be unavailable, privilege is withheld rather than a guard relied upon. This applies to modification of sealed and temporal relations, to writing outside a role's owning schema, and to all data definition operations by pipeline roles.

Privilege is the primary control and the guard is secondary, per PR-02. The ordering matters: a withheld privilege prevents the operation from being attempted, while a guard detects it after the attempt begins.

## 5.9.9 Application enforcement with mandatory validation

Three rules cannot be enforced by any database mechanism at acceptable cost, and are enforced by the calculating process. Each carries a corresponding validation assertion in §5.23, and each is recorded here as a named residual enforcement point.

| Rule | Logical constraint | Validation |
|---|---|---|
| A feature value conforms to the scale declared in its registry entry | LC-22 | §5.23.2 assertion on scale conformance |
| A module reading consumes only features its definition declares as inputs | LC-56 | §5.23.2 assertion comparing evidence citations against declared inputs |
| The feature dependency graph is acyclic | LC-44 | §5.23.2 assertion on the declared dependency graph |

The third is enforceable in principle by a recursive trigger, but the enforcement would run on every registry modification and would scale with graph size; since the registry is modified rarely and under governance, validation at modification time is the proportionate mechanism.

## 5.9.10 Constraint validity

All constraints are created and maintained in a validated state. Constraints created as not-valid during a migration are validated before the migration is considered complete, per §5.22.4. A constraint left permanently not-valid is prohibited: it conveys an assurance the database is not providing.

---

# 5.10 Partition Strategy

## 5.10.1 Partitioning criteria

A relation is partitioned where at least two of the following hold:

1. Projected row count exceeds one hundred million within the growth envelope.
2. The dominant access pattern is bounded by a temporal predicate.
3. Retention operates on a temporal boundary, making detachment preferable to deletion.
4. The relation is co-partitioned with a parent to enable partition-wise joins.

A relation meeting fewer than two is not partitioned. Partitioning a small relation imposes planning cost without benefit.

## 5.10.2 Partitioned relations

| Relation family | Schema | Strategy | Key | Granularity |
|---|---|---|---|---|
| Feature value | `feature` | Range | As-of instant | Monthly |
| Feature lineage | `feature` | Range | As-of instant, denormalised from the produced value | Monthly, co-partitioned |
| Module reading | `module` | Range | As-of instant | Monthly |
| Module evidence, evidence item | `module` | Range | As-of instant, denormalised from the reading | Monthly, co-partitioned |
| Snapshot and all snapshot content | `snapshot` | Range | Fixture partition date, denormalised from the fixture | Monthly, co-partitioned across the schema |
| Appearance | `football` | Range | Fixture partition date | Yearly |
| Match event | `football` | Range | Fixture partition date | Yearly |
| Lineup selection | `football` | Range | Fixture partition date | Yearly |
| Pipeline job run, write record, failure, API usage | `operations` | Range | Occurrence instant | Monthly |

Relations not listed are unpartitioned.

## 5.10.3 Partition key selection

**Temporal relations.** Partitioned on their as-of attribute, which is already a business key component. No denormalisation arises and PD-05 is satisfied trivially.

**Snapshot relations.** Partitioned on a fixture partition date denormalised from the fixture and bound by composite foreign key, per §5.8.4. The fixture's scheduled instant is mutable while the fixture remains open, so the partition date is fixed at the point of first snapshot creation and is thereafter immutable for that fixture, which PR-03 requires. A fixture rescheduled across a partition boundary retains its original partition date; this is correct, because the snapshots describe a fixture as it was expected at the time, and Phase 4 E4.09 states that earlier snapshots of a rescheduled fixture are retained rather than reinterpreted.

**Fixture-scoped reality relations.** Partitioned on the same fixture partition date, bound identically. This co-partitions appearances, events, and lineup selections with one another.

**Operational relations.** Partitioned on the occurrence instant, which is immutable and locally present.

## 5.10.4 Granularity selection

**PD-11.** Monthly granularity is used for relations whose retention or access boundaries are measured in weeks to months. Yearly granularity is used for fixture-scoped reality relations, whose volume per year is moderate and which are never thinned.

Monthly partitioning across a ten-year envelope yields one hundred and twenty partitions per relation family, which is within the range PostgreSQL 16 plans efficiently given that the planner prunes on a leading partition key predicate.

**PG-02 — Sub-partitioning.** Whether feature value partitions are sub-partitioned by hash of subject is gated on measurement of per-partition row count once the temporal granularity decision recorded in Phase 4 as open is settled. Sub-partitioning is introduced only where a monthly partition exceeds one hundred million rows, since below that threshold the index-based access paths of §5.11.3 are sufficient and sub-partitioning would increase planning cost without proportionate benefit.

## 5.10.5 Partition lifecycle

| Stage | Behaviour |
|---|---|
| Creation | Partitions are created in advance by a scheduled maintenance operation, maintaining a forward buffer of not fewer than three intervals. |
| Population | Rows route to the partition matching their key. No routing logic exists outside the partition definitions. |
| Default partition | Every range-partitioned relation carries a default partition. Its purpose is to accept a row that would otherwise be rejected. |
| Detachment | Partitions eligible under §5.18 are detached concurrently before any further action. |
| Archival or removal | A detached partition is archived or dropped according to the retention class of its relation. |

**Default partition monitoring.** A non-empty default partition indicates that the forward buffer was exhausted or that a row carried an unexpected key. This is a quality breach reported by the check specified in §5.19.4, not a silent condition. A default partition is never permitted to accumulate.

**Detachment and referential integrity.** As stated in §5.8.7, a partition cannot be detached while its rows are referenced from outside. This makes it structurally impossible for retention to remove a value cited by a sealed claim, realising LC-31 and LC-B without procedural checking.

## 5.10.6 Pruning

Every read path in §5.13 that addresses a partitioned relation supplies a predicate on the partition key, so that pruning occurs at planning time where the predicate is constant and at execution time where it is parameterised.

**Mandatory predicate rule.** A query against a partitioned relation without a partition key predicate is prohibited in production read paths. Where a read genuinely spans all partitions — a calibration population selection, for example — it is executed by the calibration role under a maintenance path, not by a read-serving role.

## 5.10.7 Historical storage

Partitions beyond the active window are candidates for compression and for relocation to lower-cost storage where the platform provides it. Their content remains queryable; only the physical placement changes.

**Snapshot partitions are never removed.** Snapshot content is permanent per LC-81 and is excluded from every retention process, per §5.4.7's positive-inclusion rule. Ageing snapshot partitions may be compressed and relocated; they are not detached and dropped.

---

# 5.11 Index Strategy

## 5.11.1 Principles

1. Every index exists to serve a declared access path in §5.13 or a declared write-path lookup in §5.12.
2. Every unique constraint's supporting index is ordered to serve the dominant access path, so that one structure serves both purposes.
3. Indexes are added on evidence of need and removed on evidence of disuse; §5.11.8 specifies the lifecycle.
4. On partitioned relations, indexes are declared on the parent and propagate to partitions.

## 5.11.2 Clustered access

PostgreSQL provides no persistent clustered index. Physical ordering is instead achieved by two means:

**Insertion order.** Append-only and sealed relations are written in ascending order of their partition key, and within a bulk write in ascending order of business key. This produces near-perfect correlation between physical order and the leading business key columns, which makes range scans efficient and makes block-range indexes viable.

**Partitioning as coarse clustering.** Range partitioning on the temporal key achieves the principal benefit of clustering — physical co-location of temporally adjacent rows — at partition granularity.

No relation in this design is periodically reordered. Reordering rewrites the relation and takes a lock incompatible with continuous operation, and the insertion-order property makes it unnecessary.

## 5.11.3 Composite and covering indexes

**The dominant temporal access path.** Retrieval of the prevailing value for a set of features, for one subject, in one context, as of an instant. This is served by the business unique constraint's supporting index, ordered subject, context, feature definition, as-of descending.

Descending order on as-of is deliberate: with the leading columns fixed, the prevailing value is the first row encountered, so the access is a bounded scan of one index entry per feature rather than an aggregate over the subject's history.

**Covering.** The index includes the value, provenance class, observation count, and version reference as non-key payload, so that the dominant path is satisfied without visiting the heap. The payload is small and the resulting index remains substantially narrower than the relation.

**Equivalent structures.** The same ordering and covering pattern applies to module readings and to snapshot content, whose dominant paths are structurally identical.

## 5.11.4 Partial indexes

Partial indexes serve access paths qualified by a predicate satisfied by a small minority of rows.

| Access path | Predicate |
|---|---|
| Open player registrations | Registration period unbounded above |
| Open availability spells | Spell period unbounded above |
| Fixtures in the forward window | Lifecycle state open and scheduled instant in the future |
| Active version per registry entry | Effective period unbounded above |
| Live subscription per user | Status among the live states |
| Unlinked snapshots awaiting outcome | Absence of an outcome link |
| Unresolved failures | Resolution state unresolved |

Partial indexes are preferred to full indexes wherever the predicate is stable and selective, because they are smaller, cheaper to maintain, and impose no cost on rows outside the predicate.

## 5.11.5 Block-range indexes

Block-range indexes are used where a relation is large, physically correlated with the indexed attribute, and queried by range rather than by point.

| Relation | Attribute | Justification |
|---|---|---|
| Feature value | Calculated-at | Correlated by insertion order; queried by range during replay and audit |
| Module reading | Calculated-at | As above |
| Operational relations | Occurrence instant | Correlated by insertion order; queried by range during diagnosis |
| Snapshot content | Sealed-at | Correlated; queried by range during audit |

Block-range indexes are not used for the as-of attribute, because as-of is already the partition key and is served by partition pruning.

## 5.11.6 Partition-wise operations

Co-partitioning parent and child relations on the same key, bound by the composite foreign key of §5.8.4, permits the planner to join partition against corresponding partition rather than joining across whole relations. This applies to the snapshot aggregate, whose assembly for a single fixture is the heaviest read in the design, and to the feature value and lineage pair during replay.

Realising this requires that co-partitioned relations share partition boundaries exactly. Partition maintenance therefore creates partitions for a co-partitioned family as a single operation, never independently.

## 5.11.7 Inverted indexes

**PD-12.** Inverted indexes are used only for the opaque payload columns permitted by §5.14.6, and only where a declared diagnostic access path requires containment search over them.

No inverted index is created over any relation holding evidence, classifications, or entity references, because Phase 4 LC-64 requires those to be relational, and a requirement for containment search over such a column would indicate that the column is incorrectly typed.

## 5.11.8 Index lifecycle

| Stage | Rule |
|---|---|
| Proposal | An index is proposed with the access path it serves and the expected selectivity |
| Creation | Created concurrently in production; a failed concurrent creation leaves an invalid index which is dropped before retry |
| Validation | Confirmed to serve its access path by plan inspection before the change is considered complete |
| Monitoring | Usage statistics are reviewed on a scheduled cadence; §5.19 records the review |
| Retirement | An index with no recorded scans over two consecutive review periods, and no declared access path, is dropped |
| Documentation | The access path an index serves is recorded with the index; an undocumented index is a defect |

**Constraint-supporting indexes are exempt from retirement.** They exist to enforce a constraint, not to serve a read, and their scan count is not evidence of their necessity.

---

# 5.12 Write Architecture

## 5.12.1 Write path inventory

Six write paths exist. No other process writes to the database.

| Path | Role | Schemas written | Posture |
|---|---|---|---|
| Ingestion | Ingestion | `football`, `operations` | Insert and update |
| Feature calculation | Feature calculation | `feature`, `operations` | Insert only |
| Module calculation | Module calculation | `module`, `snapshot`, `operations` | Insert only |
| Calibration | Calibration | `calibration`, `snapshot` outcome links, `operations` | Insert only |
| Projection refresh | Projection refresh | `product` projections, `operations` | Refresh and replace |
| Product and user action | Authenticated and administrative | `product` | Insert, update, delete within policy |

## 5.12.2 Execution ordering

Execution order is **derived from the declared dependency graph**, not maintained by hand. The feature registry declares each definition's sources and dependencies; the module registry declares each module's feature inputs. A topological ordering of these declarations determines execution sequence.

This realises Phase 4's requirement that the dependency graph be data rather than call ordering. A missing input is a detectable precondition failure, because the declaration states that the input is required and the absence of a value for it is observable before calculation begins.

**Precondition evaluation.** Before a calculation executes, its declared inputs are evaluated for presence and freshness. A calculation whose preconditions are unmet does not execute and records a precondition failure, rather than executing and producing values derived from absent inputs.

## 5.12.3 Transaction boundaries

**PD-13.** The transaction boundary is the smallest unit that must be atomic to preserve a logical guarantee.

| Operation | Boundary | Justification |
|---|---|---|
| Ingestion of one provider response | One transaction per response | A partially-applied response would leave reality inconsistent |
| Feature calculation for one subject at one as-of | One transaction per subject | Values and their lineage must appear together (LC-46) |
| Feature calculation across many subjects | Batched, bounded by row count | Bounded batches limit lock duration and transaction age |
| Module reading with its evidence | One transaction | A reading without its evidence violates LC-61 |
| **Snapshot sealing** | **One transaction for the entire aggregate** | See §5.12.5 |
| Outcome linkage for one fixture | One transaction across all dimensions | Partial linkage would bias calibration |
| Calibration run with all results | One transaction | A partially-recorded run misrepresents its population |

**Batch sizing.** Bulk paths write in bounded batches. Batch size is a configured operational parameter, adjusted from measured transaction duration; the design does not fix it.

## 5.12.4 Append-only write mechanics

Append-only and temporal relations are written by insert exclusively. Upsert constructs are prohibited, because the conflict path of an upsert is an update and update privilege is withheld.

**Recalculation.** Recalculating a value produces a new row at a new as-of. Where a recalculation produces a value identical to the prevailing one, the row is still written: the fact that a calculation ran and confirmed the value is itself information, and suppressing it would make the calculation history incomplete.

**PG-03 — Identical-value suppression.** Whether identical consecutive values are suppressed to reduce volume is gated on measurement of the proportion of recalculations producing unchanged values. Suppression, if adopted, applies only to temporal relations not referenced by sealed claims, and must record the suppression in the calculation's write record so that the history remains interpretable.

## 5.12.5 Snapshot sealing

Sealing is the most consequential write in the design and is specified exactly.

**Atomicity.** A snapshot is created in a single transaction comprising its header, its feature state, its module readings, its verdict, its model outputs, its completeness record, and its version manifest. A partially-created snapshot would violate LC-78, which requires that feature state and module readings seal atomically together.

**Preconditions, evaluated within the sealing transaction.**

1. The fixture's lifecycle state is open. A fixture that has left the open state cannot receive a snapshot (LC-79), enforced by the lifecycle guard of §5.9.7.
2. No snapshot exists for this fixture, snapshot point, and version manifest. Enforced by the business unique constraint.
3. Every cited feature value and module reading exists and is retrievable.
4. The version manifest is complete: every component version in force is enumerated (LC-103).

**Ordering within the transaction.** Header, then version manifest, then feature state, then module readings and their sealed evidence, then model outputs, then completeness, then verdict. This order follows the topological ordering of §5.8.6, so no deferred constraint is required.

**Post-seal immutability.** On commit, the snapshot is immutable. No role holds modification privilege on the `snapshot` schema (§5.3.2), and the sealing guard raises on any attempt regardless of privilege. Together with the referential restriction of §5.8.7, this makes both the claim and everything it cites permanent.

**Fixture sealing.** When a fixture leaves the open lifecycle state, no further snapshots may be created for it. This is enforced by the lifecycle guard rather than by an application check, and follows the protect-by-default posture of §5.9.7.

## 5.12.6 Idempotency

**PD-14.** Every write path is idempotent with respect to its logical unit of work: re-executing it produces no additional rows and no modified rows.

| Path | Idempotency mechanism |
|---|---|
| Ingestion | Business unique constraint on the provider's alternate key; a re-ingested entity is recognised and its mutable attributes updated |
| Feature calculation | Business unique constraint including as-of and version; re-execution at the same as-of under the same version conflicts and is discarded |
| Module calculation | As above |
| Snapshot sealing | Business unique constraint on fixture, point, and manifest; a duplicate sealing attempt conflicts and the transaction is abandoned |
| Outcome linkage | Business unique constraint on snapshot and outcome dimension |
| Calibration | Business unique constraint on run, series, and band |

**Conflict handling on append-only relations.** Since update privilege is withheld, a conflict cannot be resolved by updating. The conflicting insert is discarded and the occurrence is recorded in the write record as a skipped row. A calculation encountering conflicts for every row it attempted has performed no work, which the write record makes visible.

**Idempotency is a property of the constraint, not of the calculating process.** This is deliberate: a process that loses idempotency through a defect is still prevented from producing duplicate rows.

## 5.12.7 Failure handling

| Failure class | Behaviour |
|---|---|
| Precondition unmet | Calculation does not execute; a precondition failure is recorded; dependent calculations are skipped and recorded as skipped |
| Constraint violation | Transaction rolls back; the violation is recorded with its constraint name; the batch is abandoned |
| Transient infrastructure fault | Transaction rolls back; retried per §5.12.8 |
| Upstream provider fault | Ingestion records an upstream failure; no partial data is written |
| Sealing precondition unmet | Snapshot is not created; the omission is recorded and surfaces in coverage reporting (§5.19.5) |

**No partial success.** A failed unit of work leaves no trace in the authoritative schemas. All evidence of the failure resides in `operations`, which is written in a separate transaction so that failure records survive the rollback of the work they describe.

**Gap visibility.** Because calculation is append-only and snapshots are sealed, a failed run leaves a permanent absence rather than a self-correcting one. Every failure therefore has a corresponding coverage consequence, and §5.19.5 specifies the reporting that makes it visible.

## 5.12.8 Retry behaviour

| Property | Rule |
|---|---|
| Eligibility | Only failures classified transient or upstream are retried |
| Strategy | Bounded exponential backoff with a bounded attempt count |
| Attribution | Each attempt is a distinct job run referencing the same pipeline run |
| Idempotency dependence | Retry is safe because the write path is idempotent (§5.12.6), not because the retry logic is careful |
| Exhaustion | Attempt exhaustion records an unresolved failure and does not silently abandon the work |

Failures classified as logic or data-quality are never retried automatically, because retrying a deterministic failure produces the same failure and obscures it in the operational record.

---

# 5.13 Read Architecture

## 5.13.1 Read path principles

1. Read paths address projections and declared views in preference to authoritative relations.
2. Every read path supplies a partition key predicate where it addresses a partitioned relation (§5.10.6).
3. No read path aggregates over an unbounded history at request time; historical aggregates are projections.
4. Read paths serving end users address the `product` schema; read paths serving administration may address others under an administrative role.

## 5.13.2 Read model registry

Every read path is registered, realising Phase 4 E8.01 and LC-141. The registry records the read model's identity, its version, its declared sources, its composition, the context at which each quantity is drawn, its refresh strategy, and its freshness tolerance.

A companion refresh-state relation records, per projection, the last refresh instant, the source watermark applied, and the read model version in force. This is what permits staleness to be reported against a projection rather than inferred.

**An unregistered read path is outside this design.** This prevents the recurrence of the condition found in the previous platform, where objects on primary read paths existed without definition in any controlled artefact.

## 5.13.3 Declared read paths

| Read path | Principal content | Strategy | Refresh |
|---|---|---|---|
| Landing | Fixtures in the forward window with headline verdict attributes | Projection relation | Incremental, on snapshot creation |
| Competition | Competition edition standing, aggregate features, fixtures in window | Materialised view | Scheduled |
| Team | Prevailing team features across contexts, recent and forthcoming fixtures, squad availability | Projection relation | Incremental, on feature write |
| Player | Player profile, registration, availability, statistics by domain, prevailing player features | View over authoritative relations | None required |
| Fixture | Fixture, participants, venue, officials, result | View over authoritative relations | None required |
| Match intelligence | The complete sealed snapshot aggregate for a fixture at a snapshot point | Direct, partition-pruned, partition-wise assembly | None |
| Module directory | Module registry with prevailing published baselines and their sample state | Materialised view | Scheduled |
| Calibration and reliability | Series trajectories, results, published baselines | Materialised view, administrative | Scheduled |
| Administration — users and entitlement | Product-layer relations under administrative policy | Direct | None |
| Administration — operations | Pipeline runs, failures, coverage, freshness, quality results | Views over `operations` | None |

**The match intelligence path is deliberately direct.** A sealed snapshot is immutable, so a projection would offer no consistency benefit; and because the snapshot aggregate is co-partitioned on the fixture partition date, assembly is a partition-pruned, partition-wise gather of a small number of rows within one partition per relation. Interposing a projection would add refresh machinery, staleness, and rebuild cost for no gain.

This is the direct correction of the previous platform's most costly read pattern, in which a single fixture required approximately thirty independent round trips with no projection layer.

## 5.13.4 Projection refresh

| Property | Rule |
|---|---|
| Trigger | Scheduled, or invoked by the pipeline on completion of the write that invalidates the projection |
| Concurrency | Materialised views intended for concurrent refresh carry a unique index; those without one are refreshed under an exclusive lock during a maintenance window |
| Atomicity | Projection relations are refreshed by building a replacement and substituting it atomically, never by in-place mutation, so readers never observe a partially-refreshed projection |
| Watermarking | Each refresh records the source watermark applied, so that incremental refresh resumes from a known point and staleness is measurable |
| Failure | A failed refresh leaves the previous projection intact and records a failure; a stale projection is preferable to an absent one |

## 5.13.5 Freshness reporting

Every projection exposes its refresh state. A read path serving content beyond its declared freshness tolerance reports the staleness rather than serving it silently.

This realises Phase 4's requirement that the platform distinguish an absence of findings from an absence of calculation. The previous platform's read layer degraded to demonstration content when a query returned nothing, which made a silently empty structure indistinguishable from healthy data.

## 5.13.6 Caching

**PD-15.** Database-adjacent caching is limited to projections and materialised views. No separate cache tier holds authoritative data.

**Justification.** A cache tier introduces a second staleness domain and a second invalidation contract. Projections already provide the materialisation benefit, are registered, carry measurable staleness, and are rebuildable by definition. Introducing an additional tier would create a copy whose owner is unclear, contravening LC-C.

Caching outside the database is not addressed by this document.

---

# 5.14 Storage Layout

## 5.14.1 Relations

| Property | Rule |
|---|---|
| Fill factor | Default for append-only and sealed relations, which are never updated. Reduced for mutable relations subject to frequent update, to favour in-page update. |
| Column order | Fixed-width, non-nullable columns first, then variable-width, then nullable. This reduces per-row alignment padding, which is material at the projected volumes. |
| Oversized attribute storage | Default. No relation in this design stores an attribute large enough to warrant an explicit strategy, with the exception of opaque payloads (§5.14.6). |
| Tablespaces | Not used. The managed platform does not expose storage tiers as tablespaces. |

## 5.14.2 Views

Views are used where the derivation is inexpensive and must always be current, and where the view expresses a permitted read path (§5.13.3).

Security-barrier semantics are applied to any view exposed to a role narrower than the view's own privileges, so that predicate evaluation cannot leak rows the reader is not entitled to.

## 5.14.3 Materialised views

Used where a derivation is expensive and a bounded staleness is acceptable. Every materialised view is registered per §5.13.2 and carries a unique index where concurrent refresh is required.

Materialised views are excluded from backup retention (§5.18.6) on the grounds that they are reconstructible, which PR-07 guarantees.

## 5.14.4 Sequences

Sequences arise only as the implicit backing of identity columns. No sequence is used as a source of business meaning, because a sequence value is not an identity — it is an allocation, and gaps in it carry no information.

## 5.14.5 Extensions

| Extension | Purpose | Status |
|---|---|---|
| Statement statistics | Access-path monitoring and query-plan review | Required |
| Cryptographic functions | Digest computation for validation checksums (§5.23.4) | Required |
| Scheduled execution | Partition maintenance, retention, projection refresh | Required where platform-provided scheduling is not used |
| Geospatial | Distance calculation support | Gated by PG-01 |

No extension is adopted without a stated purpose. Extensions expand the platform's dependency surface and complicate version upgrades.

## 5.14.6 Structured payload policy

**PD-16.** Binary structured payloads are permitted in exactly two circumstances:

1. **Retained provider responses**, kept for audit and reprocessing, which are opaque by definition and are never queried by content in a production read path.
2. **Operational diagnostic detail**, which is heterogeneous by nature and whose structure is not known in advance.

Structured payloads are prohibited for evidence, classifications, entity references, narrative content, and any value that is queried, aggregated, joined, or explained. This realises LC-64 and prevents recurrence of the condition identified in the previous platform, where evidence, risk factors, and signals were held as opaque serialised content and were therefore displayable but not analysable.

**Enforcement.** The prohibition is enforced by design review rather than by a database mechanism, and is verified by the schema conformance assertion of §5.23.2, which reports any structured payload column outside the two permitted circumstances.

## 5.14.7 Large objects

Not used. Binary artefacts, where they arise, are held in the platform's object storage and referenced by path. No binary content is stored in a relation.

---

# 5.15 Lifecycle Realisation

Each Phase 4 lifecycle class maps to a fixed physical configuration. The configuration is applied without exception.

## 5.15.1 Mutable

| Aspect | Realisation |
|---|---|
| Privilege | Insert and update granted to the owning role; delete withheld except where a governed removal exists |
| Guards | None |
| Partitioning | None |
| Storage | Reduced fill factor where update frequency warrants |
| Retention | Not applicable; current state only |

Deletion privilege is withheld even on mutable relations, because Phase 4 provides for retirement by effective-period closure rather than by removal. Where a governed removal genuinely exists — a user exercising a data right — it is performed by an administrative role under an audited path.

## 5.15.2 Temporal

| Aspect | Realisation |
|---|---|
| Privilege | Insert only; update and delete withheld from every role |
| Guards | Append-only guard (§5.9.7) |
| Partitioning | Range on the as-of attribute |
| Identity | As-of participates in the business unique constraint |
| Access | Composite covering index ordered subject, context, definition, as-of descending (§5.11.3) |
| Retention | Thinning by partition detachment, subject to the eligibility rule of §5.18.3 |

**Current-state resolution is a query, not a relation.** No relation holds "current" values, because a current-state relation would be a second owner of facts the temporal relation already holds.

## 5.15.3 Append-only

Configured as temporal, except that partitioning is applied only where volume warrants it, and no as-of ordering is implied.

## 5.15.4 Sealed

| Aspect | Realisation |
|---|---|
| Privilege | Insert only; update and delete withheld from every role, administered at schema level (PD-01) |
| Guards | Sealing guard, unconditional (§5.9.7) |
| Partitioning | Range on an immutable temporal attribute, co-partitioned across the aggregate |
| Referential protection | Restrict semantics on every outbound reference (§5.8.2), so referents cannot be removed |
| Write mechanics | Insert only within a single transaction per aggregate (§5.12.5) |
| Retention | Excluded from every retention process, permanently |
| Verification | Content checksum recorded at sealing and verified periodically (§5.23.4) |

Four independent mechanisms protect sealed content, per PR-04. This redundancy is proportionate: sealed claims are the platform's primary asset and its evidential foundation.

## 5.15.5 Derived

| Aspect | Realisation |
|---|---|
| Structure | View, or materialised view where cost warrants |
| Privilege | No modification privilege; refresh privilege granted to the refresh role only |
| Registration | Registered per §5.13.2 with sources and refresh strategy |
| Authority | None; holds no attribute not derivable from sources |

## 5.15.6 Disposable

Configured as derived, with two additions: a recorded rebuild definition, and exclusion from backup retention on the grounds of reconstructibility.

The rebuild definition is verified by the projection reconstruction assertion of §5.23.5, which rebuilds each projection into a scratch relation and compares. A projection that cannot be reproduced from its declared sources holds authority it should not, and the assertion detects this.

## 5.15.7 Historical

| Aspect | Realisation |
|---|---|
| Privilege | Insert only |
| Guards | Append-only guard |
| Retention | Excluded from every retention process by omission from the inclusion list (§5.4.7) |
| Storage | Ageing partitions compressed and relocated; never detached and dropped |

Exemption from retention is expressed by omission from a positive inclusion list, so that a relation added without a retention decision defaults to permanent preservation. Omission fails safe.

## 5.15.8 Lifecycle transitions

| Transition | Physical mechanism |
|---|---|
| Mutable to sealed, on fixture lifecycle change | Lifecycle guard prevents further snapshot creation; fixture-scoped reality relations become effectively immutable through withdrawal of the ingestion path |
| Temporal to sealed, by reference | Referential restriction from the sealed relation prevents removal of the referenced row; no attribute changes |
| Derived to sealed, by materialisation | The derived content is inserted into a sealed relation; the derived form remains disposable |

**Sealing by reference is the important case.** A feature value becomes permanent not by any operation upon it, but because a sealed row references it and the reference is declared restrict. The value's own configuration is unchanged; its removability is what changes. This makes the promotion described in Phase 4 E4.03 a structural consequence rather than a procedural step.

**Transitions are monotonic.** No mechanism exists to move a relation from a more restrictive class to a less restrictive one. Doing so would require granting modification privilege on data that has been guaranteed immutable, which no operational procedure in this design provides for.

---

# 5.16 Version Realisation

## 5.16.1 Version registries

Each version line is realised as a registry relation: feature version, module version, model version, verdict composition version, consensus rule version, calibration version, outcome derivation version, read model version, quality check version, and notification trigger version.

Every registry relation shares one structure: a reference to the entity whose rule it versions, a version designation, an effective period, a predecessor reference, and a rationale. Sharing the structure makes version handling uniform across the design.

**Registration precedes use.** A version must exist in its registry before any row may reference it, enforced by foreign key. This realises LC-25 and prevents version identity from degrading into unvalidated text.

## 5.16.2 Reference, never restatement

Version identity is held exclusively as a foreign key (PR-05). No relation carries a version designation as text.

**Consequence for traversal.** Given any sealed claim, the chain from claim to verdict version, to module versions, to feature versions, to lineage, to the versions of consumed values, is traversable entirely by foreign key. Every hop resolves to a registered entity. This is what makes the reproducibility guarantee of Phase 4 §4.13.2 verifiable rather than asserted, and §5.23.3 specifies the assertion that verifies it.

## 5.16.3 Snapshot manifests

A snapshot is produced by many rules simultaneously, so its version identity is a manifest rather than a single reference. It is realised as a relation enumerating one row per version component, each identifying the component kind and the version referenced.

**Manifest completeness** is a sealing precondition (§5.12.5) and is verified by the assertion of §5.23.3, which confirms that every version referenced by any content of a snapshot appears in that snapshot's manifest. A manifest that omits a version in force would misrepresent the conditions under which the claim was made.

**Manifest identity.** The manifest participates in the snapshot's business identity, so two snapshots of one fixture at one point under different manifests are distinct rows rather than a conflict. This is the physical mechanism by which parallel version series coexist.

## 5.16.4 Historical replay

Replay reproduces a historical value or claim by re-executing a registered rule over the inputs recorded in lineage.

| Property | Realisation |
|---|---|
| Input identification | Lineage rows identify the exact input values consumed, not merely their definitions |
| Rule identification | The version reference identifies the rule that ran |
| Implementation identification | The producing job run records the code revision, distinguishing a rule change from an implementation change |
| Output comparison | Replay output is compared against the recorded value; §5.23.3 specifies the comparison |
| Isolation | Replay writes to a scratch schema, never to an authoritative relation |

Replay never writes to an authoritative schema. A replay that wrote would create a second claim indistinguishable from the original, defeating the purpose of the exercise.

## 5.16.5 Parallel versions

Two version lines may be active simultaneously, producing parallel values and parallel claims over the same subjects and moments.

| Aspect | Realisation |
|---|---|
| Coexistence | Version participates in the business unique constraint, so parallel rows do not conflict |
| Distinguishability | Every row carries its version reference; no aggregate mixes versions unless explicitly instructed |
| Calibration separation | Series are keyed by version (LC-135), so parallel lines are measured separately |
| Retirement | Closing a version's effective period stops production; existing rows and series persist |

**Backfill under a new version.** A new version applied over history produces new rows at historical as-of instants with current calculated-at instants. The two attributes together make backfilled content legible as reconstruction rather than as contemporaneous observation, realising Phase 4 §4.1.5 and §5.2's auditability objective.

## 5.16.6 Version identity versus implementation identity

Two identities are recorded and are never conflated.

| Identity | Recorded on | Answers |
|---|---|---|
| Formula version | The calculated row | Which rule was applied |
| Code revision | The pipeline run | Which implementation applied it |

Both are required. A rule may be reimplemented without changing, and an implementation may change behaviour without the rule changing. When output moves unexpectedly, distinguishing the two is the first diagnostic question, and it is unanswerable with only one recorded.

---

# 5.17 Security Model

## 5.17.1 Role inventory

| Role | Class | Purpose |
|---|---|---|
| `pipeline_ingestion` | Service | Writes `football`; records to `operations` |
| `pipeline_feature` | Service | Writes `feature`; reads `football`; records to `operations` |
| `pipeline_module` | Service | Writes `module` and `snapshot`; reads `feature`, `football`, `calibration`; records to `operations` |
| `pipeline_calibration` | Service | Writes `calibration` and snapshot outcome links; reads `snapshot`, `football`; records to `operations` |
| `pipeline_projection` | Service | Refreshes projections and materialised views; reads all schemas; records to `operations` |
| `platform_admin` | Administrative | Reads all schemas; writes governed configuration and vocabulary |
| `authenticated` | End user | Supabase-provided; reads permitted product content under policy; writes own product data |
| `anon` | End user | Supabase-provided; reads only content designated public |
| `service_role` | Platform | Supabase-provided; reserved for platform operations, not used by application processes |

**PD-17 — Least-privilege pipeline roles.** Each pipeline stage holds a distinct role granted only the privileges its stage requires. A single service identity for the whole pipeline would grant every stage the union of all privileges, which would make the layer boundaries of §5.3.3 unenforceable at runtime.

**Supabase service role.** The platform-provided service role bypasses row-level security. No application process authenticates as it. Pipeline processes authenticate as their stage-specific roles, which are subject to the same privilege configuration as any other role.

## 5.17.2 Privilege matrix

| Schema | Ingestion | Feature | Module | Calibration | Projection | Admin | Authenticated | Anon |
|---|---|---|---|---|---|---|---|---|
| `football` | Insert, update | Read | Read | Read | Read | Read, govern | Read via policy | Read via policy |
| `feature` | — | Insert | Read | Read | Read | Read, govern | — | — |
| `module` | — | — | Insert | Read | Read | Read, govern | — | — |
| `snapshot` | — | — | **Insert only** | Insert outcome links only | Read | **Read only** | — | — |
| `calibration` | — | — | Read | Insert | Read | Read, govern | — | — |
| `product` | — | — | — | — | Refresh projections | Read, administer | Read and write own, via policy | Read public, via policy |
| `operations` | Insert | Insert | Insert | Insert | Insert | Read | — | — |

**No role holds update or delete on `snapshot`.** This includes the administrative role. Administrative correction of a sealed claim is not provided for, because Phase 4 provides no circumstance in which a sealed claim is corrected — correction produces a new claim under a new version.

## 5.17.3 Row-level security strategy

| Schema | Posture |
|---|---|
| `product` | Enabled on every relation. User-owned relations restrict to the authenticated principal; commercial configuration is readable by all authenticated principals and writable only by administration. |
| `football` | Enabled with a permissive read policy for authenticated and anonymous principals. Reality is not confidential. |
| `feature`, `module`, `snapshot`, `calibration`, `operations` | Enabled with no policy granting end-user principals access. Calculated content reaches end users exclusively through `product` projections. |

**PD-18 — Enabled everywhere, permissive where appropriate.** Row-level security is enabled on every relation in every schema, including those no end-user role can reach. Enabling without a policy denies by default, so a future privilege grant made in error does not silently expose content.

This addresses a condition identified in the previous platform, where exactly one relation outside the product layer carried a policy and the security posture of the remainder was undocumented.

## 5.17.4 Entitlement enforcement

Entitlement is resolved through the plan, the entitlement matrix, the subscription, and the platform configuration flag — through nothing else (Phase 4 §4.9).

Enforcement is at the projection boundary: content requiring an entitlement is served from projections whose policies consult the resolved entitlement of the requesting principal. Entitlement is not enforced within the calculation layers, which have no user context and no concept of a principal.

**Beta posture.** The platform configuration flag that opens all capabilities regardless of subscription is evaluated within the policy expression, so the flag governs access at the database rather than only in the consuming application. This preserves the posture the previous platform established.

## 5.17.5 Object ownership

All objects are owned by a dedicated schema-owner role that no application process authenticates as. Application roles hold privileges granted to them and hold no ownership. Ownership confers the ability to alter or drop an object, which no application process requires.

Data definition privilege is held by the migration role alone and is exercised only through the migration process of §5.22.

## 5.17.6 Function security

Functions execute with invoker privileges by default. Definer privileges are granted only where a function must perform an action the invoker cannot, and every such function fixes its search path explicitly and validates its arguments. The set of definer-privilege functions is enumerated in the schema conformance assertion of §5.23.2, so that its growth is visible.

---

# 5.18 Retention

## 5.18.1 Retention classes

| Class | Applies to | Policy |
|---|---|---|
| **Permanent** | Sealed content; historical entities; calibration series and results; published baselines; quality assertion results; operational aggregates | Never removed. Compressed and relocated with age. |
| **Thinned** | Temporal feature values and module readings not referenced by sealed content | Reduced in temporal resolution beyond declared windows |
| **Bounded** | Operational detail | Detached and dropped beyond a declared window, after aggregation |
| **Reconstructible** | Projections and materialised views | No retention; excluded from backup |

**PD-19 — Positive inclusion.** Retention processes operate on an explicit inclusion list naming the relations they may act upon. A relation not named is never acted upon. Omission therefore fails safe, which is the correct default when the failure mode of the alternative is permanent loss of a claim.

## 5.18.2 Thinning of temporal content

Thinning reduces temporal resolution; it does not remove a subject's history.

| Age band | Resolution retained |
|---|---|
| Recent window | Every calculated value |
| Intermediate window | One value per subject, context, and definition per day |
| Beyond intermediate | One value per subject, context, and definition per week |

Exact window durations are an operational parameter dependent on the temporal granularity decision recorded as open in Phase 4, and are not fixed by this document.

**Thinning preserves the prevailing value at every retained boundary**, so that historical state resolution at any past instant continues to return the value that prevailed at that instant, at the retained resolution. Thinning that removed a boundary value would alter historical answers, which no retention process may do.

## 5.18.3 Thinning eligibility

A row is eligible for thinning only when all of the following hold:

1. No sealed relation references it.
2. No retained lineage row cites it.
3. It is not the prevailing value at a retained temporal boundary.
4. Its relation appears in the retention inclusion list.

**Structural enforcement of the first two conditions.** Referential restriction (§5.8.2) and the partition-detachment rule (§5.8.7) make removal of a referenced row impossible rather than merely prohibited. A retention process attempting to detach a partition containing referenced rows fails, and the failure is recorded. Eligibility is therefore enforced by the database, not by the correctness of the retention process.

This realises LC-31 and LC-B structurally.

## 5.18.4 Operational retention

| Content | Detail retained | Aggregate retained |
|---|---|---|
| Pipeline and job runs | Bounded window | Permanently |
| Write records | Bounded window | Permanently |
| Failures | Longer than successes | Permanently |
| External request consumption | Longest operational window, supporting capacity planning | Permanently |
| Quality assertion results | Permanently | Not applicable |

**The one operational exception.** A job run referenced by a sealed artefact is retained permanently regardless of the bounded window, because a sealed claim that cannot name its producing execution is not fully auditable. The reference is declared restrict, so the retention process cannot remove it.

## 5.18.5 Archival

Archival applies to permanent content whose access frequency has declined. Archived partitions remain attached and queryable; only their physical storage characteristics change. No archival step makes content unavailable, because Phase 4 provides no circumstance in which a permanent claim becomes inaccessible.

## 5.18.6 Backup scope

| Content | In backup scope |
|---|---|
| Authoritative relations in every schema | Yes |
| Registry and version relations | Yes |
| Sealed content | Yes, with the highest recovery priority |
| Projections and materialised views | No — reconstructible by PR-07 |
| Operational detail within its window | Yes |

Excluding projections reduces backup volume and recovery time. The exclusion is safe precisely because PR-07 is enforced and §5.23.5 verifies it; were a projection to hold non-derivable content, the exclusion would become a data-loss risk, which is why the verification is mandatory rather than advisory.

---

# 5.19 Operational Database Design

## 5.19.1 Pipeline run and job run

Realised as two relations in a parent-child relationship. The run records its trigger, scope, boundary instants, outcome, and code revision. The job run records the job identity, its scope, its boundary instants, its outcome, and the formula versions in force.

Both are referenced by sealed artefacts for execution attribution (§5.3.3), which is the sole direction in which an authoritative relation depends on an operational one.

Partitioned monthly on the occurrence instant. Retained per §5.18.4, with the permanent exception for sealed-artefact-referenced job runs.

## 5.19.2 Write records

Realised as a relation recording, per job run and target relation, the counts of rows examined, written, skipped, and rejected.

**Purpose.** A job completing successfully while writing nothing is among the most dangerous states in a precompute platform and is invisible without this record. Because conflict handling on append-only relations discards rather than updates (§5.12.6), a calculation encountering conflicts for every row it attempted reports zero written and a high skipped count, which is diagnostic.

## 5.19.3 Failures

Realised as a relation recording the failing job run, the classification, the affected entity where identifiable, the diagnostic, and a mutable resolution state.

The failure record is append-only; the resolution state is the sole mutable attribute, which is expressed as a separate resolution relation rather than as an update to the failure, preserving the append-only posture of the schema.

Classification governs retry eligibility (§5.12.8) and alerting. Transient and upstream failures are retried; logic and data-quality failures are not.

## 5.19.4 Quality checks and assertion results

Realised as a registered check relation and an append-only result relation, per Phase 4 E9.07 and E9.08.

**Registered checks include, at minimum:**

| Check | Verifies |
|---|---|
| Default partition occupancy | No range-partitioned relation has rows in its default partition (§5.10.5) |
| Feature value scale conformance | Values conform to registry-declared scale (§5.9.9) |
| Module input conformance | Evidence citations fall within declared module inputs (§5.9.9) |
| Dependency graph acyclicity | The declared feature dependency graph contains no cycle (§5.9.9) |
| Provenance propagation | No derived value carries a provenance class stronger than the weakest in its lineage |
| Manifest completeness | Every version referenced by snapshot content appears in that snapshot's manifest |
| Coverage completeness | Every fixture in window has the snapshots its cadence requires |
| Freshness conformance | Every registered feature is within its declared tolerance |
| Orphan absence | No calculated row references a retired definition or an unregistered version |
| Structured payload conformance | No structured payload column exists outside the two permitted circumstances (§5.14.6) |

Results are permanent, so degradation is visible as a trend rather than as an isolated event.

## 5.19.5 Coverage

Realised as a derived view comparing expected artefacts against produced artefacts, per fixture, snapshot point, competition, and period.

**Necessity.** Because calculation is append-only and snapshots are sealed, a failed run leaves a permanent absence, and absences are silent. Coverage reporting is the only mechanism by which a missing snapshot becomes visible; nothing raises when an artefact that should exist does not.

Coverage is recomputable for any past period, because its inputs are permanent.

## 5.19.6 Freshness

Realised as a derived view over the calculated-at instants of feature values, the declared sources of each feature definition, and the expected cadence.

Because sources are declared in the registry (Phase 4 E2.10), freshness is derivable rather than hand-maintained: a feature whose declared source has not been ingested is stale by derivation, with no relationship maintained separately.

Reported per context, since a value may be current at one context and stale at another.

## 5.19.7 External request consumption

Realised as an append-only relation recording requests by provider, endpoint, and window, with quota consumed, quota remaining, and throttling encountered.

Retained longest among operational content, because it answers capacity questions rather than incident questions. Ingestion is quota-bound rather than compute-bound, and an unmeasured binding constraint cannot be managed.

## 5.19.8 Operational aggregates

Realised as an append-only relation of period summaries, written before the corresponding detail is thinned. Permanent.

The write ordering is significant: aggregation precedes thinning within the same retention execution, so that no detail is removed before its contribution to the permanent record exists.

---

# 5.20 Physical Entity Catalogue

Every logical entity of Phase 4 and its physical realisation. Growth figures derive from the envelope of §5.24.1. Relations marked as not partitioned are candidates for partitioning only if measurement contradicts the projection.

**Column key.** *Growth* is the projected row count within the ten-year envelope. *Part.* indicates the partitioning strategy: `R-M` range monthly, `R-Y` range yearly, `—` unpartitioned. *Ret.* indicates retention class: `P` permanent, `T` thinned, `B` bounded, `R` reconstructible, `C` current-state only.

## 5.20.1 Schema `football`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E1.01 Country | country | Code | — | 10² | — | P | Code | Vocabulary structure |
| E1.02 Competition | competition | Provider identifier as alternate; surrogate key | country | 10³ | — | P | Alternate key; country | Identity permanence |
| E1.03 Competition Edition | competition_edition | Competition, season period | competition | 10⁴ | — | P | Competition, period | Period well-formedness; no overlap within competition |
| E1.04 Competition Stage | competition_stage | Edition, stage ordinal | competition_edition, self | 10⁵ | — | P | Edition, ordinal | Self-reference prohibition; depth bound |
| E1.05 Venue | venue | Provider identifier as alternate | country | 10⁴ | — | P | Alternate key; country | Coordinate range checks |
| E1.06 Team | team | Provider identifier as alternate | country, venue | 10⁴ | — | P | Alternate key; slug | Identity permanence |
| E1.07 Team Registration | team_registration | Team, edition | team, competition_edition | 10⁵ | — | P | Edition, team | Referential existence |
| E1.08 Player | player | Provider identifier as alternate | country | 10⁵ | — | P | Alternate key; name | No computed attribute |
| E1.09 Player Registration | player_registration | Player, team, period start | player, team, competition_edition | 10⁶ | — | P | Player, period; team, period | **Exclusion: no overlap per player and kind** |
| E1.10 Position Profile | position_profile | Player, position | player, position | 10⁶ | — | C | Player; position | Role ranking uniqueness per player |
| E1.10a Position | position | Code | — | 10¹ | — | P | Code | Vocabulary structure |
| E1.11 Player Availability | player_availability | Player, spell start | player, position | 10⁶ | — | P | Player, period; open-spell partial | **Exclusion: no overlap per player and kind** |
| E1.12 Player Valuation | player_valuation | Player, source, as-of day | player, currency | 10⁷ | — | P | Player, as-of descending | Currency mandatory |
| E1.13 Fixture | fixture | Provider identifier as alternate | competition_edition, competition_stage, venue, team ×2 | 4×10⁵ | R-Y | P | Partition date, kickoff; edition, kickoff; forward-window partial | Distinct participants; **redundant unique key for partition binding** |
| E1.14 Fixture Lifecycle State | fixture_lifecycle_state; fixture_lifecycle_transition | Code; fixture and transition instant | fixture | 10¹; 10⁶ | —; R-Y | P | Fixture, instant descending | Vocabulary structure; append-only |
| E1.15 Official Assignment | official_assignment | Fixture, official, role | fixture, official | 10⁶ | R-Y | P | Fixture; official | Composite partition binding |
| E1.15a Official | official | Provider identifier as alternate | country | 10⁴ | — | P | Alternate key | Vocabulary-adjacent |
| E1.16 Lineup | lineup; lineup_selection | Fixture, team; and player | fixture, team, player, position | 10⁶; 10⁷ | R-Y | P | Fixture, team; player | Formation stated once on lineup |
| E1.17 Appearance | appearance | Fixture, player | fixture, player, team, position | 10⁷ | R-Y | P | Fixture; player, partition date | Single participation state |
| E1.18 Match Event | match_event | Fixture, sequence | fixture, player, team | 10⁷ | R-Y | P | Fixture, sequence | Conditional on provider supply |
| E1.19 Result | result; result_revision | Fixture; and revision instant | fixture | 4×10⁵; 10⁴ | R-Y | P | Fixture | **Revisions recorded, never overwritten** |
| E1.20 Standing | standing | Edition, team, variant, as-of day | competition_edition, team | 10⁷ | — | P | Edition, as-of descending, team | Append-only |
| E1.21 Provider Statistic Record | provider_statistic | Subject, team, edition, domain, provider | player, team, competition_edition, statistics_domain | 10⁷ | — | P | Subject, edition, domain | **Team in identity**; no computed attribute |
| E1.22 Statistics Domain | statistics_domain | Code | — | 10¹ | — | P | Code | Vocabulary structure |

## 5.20.2 Schema `feature`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E2.01 Feature Registry | — | Realised as the collection of feature_definition | — | — | — | — | — | Registry is not a relation |
| E2.02 Feature Definition | feature_definition | Namespaced key | feature_calculator, subject_kind | 10² | — | P | Key; calculator | Key and meaning permanence; subject namespacing |
| E2.03 Feature Version | feature_version | Definition, designation | feature_definition, self | 10³ | — | P | Definition, effective period | **Exclusion: no overlapping effective periods**; self-reference prohibition |
| E2.04 Feature Calculator | feature_calculator | Calculator key | — | 10² | — | P | Key | One calculator per definition |
| E2.05 Feature Value | feature_value | Subject, context, definition, as-of, version | feature_definition, feature_version, subject entities, competition_edition | **10⁸–10⁹** | **R-M** | T | **Covering: subject, context, definition, as-of descending**; BRIN on calculated-at | Provenance and sample mandatory; context validity by trigger |
| E2.06 Subject Reference | — | Realised as columns on feature_value and module_reading | — | — | — | — | — | Typed foreign key per kind; exclusivity check |
| E2.07 Feature Provenance | — | Realised as a column group; vocabulary in provenance_class | — | — | — | — | — | Mandatory; propagation by trigger |
| E2.08 Feature Context | — | Realised as columns; vocabulary in context_kind | — | — | — | — | — | Edition present when and only when competition-scoped |
| E2.09 Feature Sample | — | Realised as a column group | — | — | — | — | — | Count and threshold indicator mandatory |
| E2.10 Feature Source | feature_source | Definition, source relation | feature_definition | 10³ | — | P | Definition | Layer-2-only declaration |
| E2.11 Feature Dependency | feature_dependency | Consumer, consumed | feature_definition ×2 | 10³ | — | P | Consumer; consumed | Acyclicity by validation |
| E2.12 Feature Lineage | feature_lineage | Produced value, consumed value | feature_value ×2 | **10⁹** | **R-M**, co-partitioned | T | Produced value; consumed value | **Prevents thinning of cited values** |

## 5.20.3 Schema `module`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E3.01 Module Registry | — | Realised as the collection of module_definition | — | — | — | — | — | Registry is not a relation |
| E3.02 Module Definition | module_definition | Module key | entitlement_feature, outcome_dimension | 10¹ | — | P | Key; display number | **Question permanence; display number never reused** |
| E3.02a Module Version | module_version | Definition, designation | module_definition, self | 10² | — | P | Definition, effective period | Exclusion on effective periods |
| E3.03 Module Reading | module_reading | Subject, context, definition, as-of, version | module_definition, module_version, subject entities, module_status, published_baseline | 10⁷ | **R-M** | T | Covering: subject, context, definition, as-of descending | Sample mandatory; baseline version match by trigger |
| E3.04 Module Evidence | module_evidence | Reading | module_reading | 10⁷ | R-M, co-partitioned | T | Reading | One per reading |
| E3.05 Module Evidence Item | module_evidence_item | Evidence, cited value | module_evidence, feature_value | **10⁸** | R-M, co-partitioned | T | Evidence; cited value | **Prevents thinning of cited values**; relational only |
| E3.06 Module Baseline Reference | — | Realised as a column on module_reading | published_baseline | — | — | — | — | Version equality enforced by trigger |
| E3.07 Module Status | module_status | Code | — | 10¹ | — | P | Code | **Inactive and neutral distinct** |
| E3.08 Module Headline | — | Realised as a column group on module_reading | — | — | — | — | — | Sealed with reading |
| E3.09 Module Verdict | — | Realised as a column group on module_reading | — | — | — | — | — | No action, stake, or selection attribute exists |
| E3.10 Module Consensus | mv_module_consensus | Subject, context, as-of | — | — | — | R | Subject, context | Derived; sealed copy resides in snapshot |

## 5.20.4 Schema `snapshot`

Every relation is sealed, co-partitioned monthly on the fixture partition date, and permanent.

| Logical entity | Relation | Identity | Principal references | Growth | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|
| E4.01 / E4.02 Match Snapshot, Header | match_snapshot | Partition date, fixture, snapshot point, manifest | fixture, snapshot_point, pipeline_job_run | 1.5×10⁶ | Partition date, fixture, point; sealed-at BRIN | **Insert only; lifecycle guard; manifest completeness** |
| E4.03 Snapshot Feature State | snapshot_feature_state | Snapshot, cited feature value | match_snapshot, feature_value | **2×10⁸** | Snapshot; cited value | Restrict on cited value; carries version, provenance, sample |
| E4.04 Snapshot Module Reading | snapshot_module_reading | Snapshot, cited reading | match_snapshot, module_reading | 2×10⁷ | Snapshot; cited reading | Individually addressable |
| E4.05 Snapshot Verdict | snapshot_verdict | Snapshot, verdict composition version | match_snapshot, version registry | 1.5×10⁶ | Snapshot | **No action or stake attribute exists**; confidence independent of edge magnitude |
| E4.06 Snapshot Model Output | snapshot_model_output | Snapshot, model, model version, output type | match_snapshot, model_version | 5×10⁶ | Snapshot; model version | Exactly one canonical per output type, by partial unique index |
| E4.07 Snapshot Completeness | snapshot_completeness; snapshot_completeness_item | Snapshot; and absent input | match_snapshot | 1.5×10⁶; 10⁷ | Snapshot | Absence recorded, never approximated |
| E4.08 Snapshot Outcome Link | snapshot_outcome_link | Snapshot, outcome dimension | match_snapshot, result, outcome_dimension, version registry | 10⁷ | Snapshot; dimension; unlinked partial | **Additive only; revision produces a new link** |
| E4.09 Snapshot Point | snapshot_point | Code | — | 10¹ | Code | In `football` as a shared vocabulary; meaning permanence |
| E4.10 Snapshot Version | snapshot_version_component | Snapshot, component kind, version | match_snapshot, version registries | 10⁷ | Snapshot | **Manifest completeness verified** |

## 5.20.5 Schema `calibration`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E7.01 Calibration Run | calibration_run | Run key | measurement_population, calibration_version, pipeline_job_run | 10⁴ | — | P | Population; instant descending | Sealed |
| E7.02 Calibration Result | calibration_result | Run, series, band | calibration_run, calibration_series | 10⁶ | — | P | Series, instant descending | **Time series, never replaced** |
| E7.03 Published Baseline | published_baseline | Module version, band, dimension, context, effective period | calibration_result, module_version | 10⁵ | — | P | Module version, band, effective period | **Gate failure marked unverified**; measurement provenance recorded |
| E7.04 Outcome Dimension | outcome_dimension | Code | version registry | 10¹ | — | P | Code | Derivation rule versioned |
| E7.05 Measurement Population | measurement_population | Population key | — | 10³ | — | P | Key | Sealed; completeness threshold declared |
| E7.06 Confidence Interval | — | Realised as a column group on calibration_result | — | — | — | — | — | **Suppressed where the count is pooled** |
| E7.07 Sample Gate | sample_gate | Series or definition, designation | module_definition | 10² | — | P | Subject | Versioned; evaluations recorded on results |
| E7.08 Calibration Series | calibration_series | Module version, band, dimension, context, snapshot point | module_version, outcome_dimension, snapshot_point | 10⁴ | — | P | Module version | **Keyed by module version**; never deleted |
| E7.09 Calibration Version | calibration_version | Designation | self | 10² | — | P | Effective period | Exclusion on effective periods |
| E7.10 Historical Reliability | mv_historical_reliability | Module version, band, dimension, context | — | — | — | R | Module version | Derived; never aggregates across versions |

## 5.20.6 Schema `product`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E8.01 Read Model | read_model; read_model_source | Read model key | — | 10² | — | P | Key | Versioned; sources declared |
| E8.02 Projection | projection_refresh_state; `p_*`, `mv_*` objects | Read model, scope | read_model | 10² | — | R | Read model | **Excluded from backup; rebuild verified** |
| E8.03 Plan | plan | Plan key | — | 10¹ | — | P | Key; rank | Identity permanence |
| E8.04 Entitlement Feature | entitlement_feature | Feature key | — | 10² | — | P | Key | Product-layer only |
| E8.05 Feature Matrix | plan_entitlement | Plan, entitlement feature, effective period | plan, entitlement_feature | 10³ | — | P | Plan; feature | **Exclusion: no overlapping grants** |
| E8.06 Subscription | subscription; subscription_event | User, plan, period start | auth user, plan | 10⁶ | — | P | User, period; live partial unique | **At most one live subscription per user** |
| E8.07 Watchlist | watchlist | User, entity kind, entity | auth user, football entities | 10⁷ | — | C | User; entity | **Referential defence per polymorphic target** |
| E8.08 User Preferences | user_preference | User, preference domain | auth user, competition | 10⁶ | — | C | User | User-owned under policy |
| E8.09 Notification Intent | notification_intent | User, occurrence, instant | auth user, triggering artefacts | 10⁸ | R-M | B | User, instant descending | Append-only; trigger rule versioned |

## 5.20.7 Schema `operations`

| Logical entity | Relation | Identity | Principal references | Growth | Part. | Ret. | Principal indexes | Notable constraints |
|---|---|---|---|---|---|---|---|---|
| E9.01 Pipeline Run | pipeline_run | Run key | — | 10⁵ | R-M | B | Instant descending; outcome partial | Code revision mandatory |
| E9.02 Pipeline Job Run | pipeline_job_run | Run, job execution | pipeline_run | 10⁷ | R-M | B, **P where sealed-referenced** | Run; job, instant descending | Formula versions recorded |
| E9.03 Write Record | write_record | Job run, target | pipeline_job_run | 10⁸ | R-M | B | Job run; target | Counts mandatory |
| E9.04 Failure | failure; failure_resolution | Failure key; and resolution instant | pipeline_job_run | 10⁶ | R-M | B, longer than successes | Job run; class; unresolved partial | **Classification mandatory; resolution appended, not updated** |
| E9.05 API Usage | api_usage | Provider, endpoint, window | — | 10⁷ | R-M | B, longest | Provider, window descending | Quota attributes mandatory |
| E9.06 Freshness | v_freshness | Definition, subject class, context | — | — | — | R | — | Derived from declared sources |
| E9.07 Quality Check | quality_check | Check key | version registry | 10² | — | P | Key | Versioned |
| E9.08 Integrity Assertion Result | quality_assertion_result | Check, execution instant | quality_check, pipeline_job_run | 10⁶ | R-M | P | Check, instant descending | **Permanent — trend visibility** |
| E9.09 Coverage Report | v_coverage | Scope, period | — | — | — | R | — | Recomputable for any past period |
| E9.10 Operational Aggregate | operational_aggregate | Period, kind, scope | — | 10⁵ | — | P | Period descending | **Written before detail is thinned** |

## 5.20.8 Catalogue observations

**The five dominant relations by volume** are feature lineage, feature value, snapshot feature state, module evidence item, and write record. All five are partitioned; four of the five are co-partitioned with a parent, enabling partition-wise assembly; and all five have a declared retention class.

**Every relation carrying a calculated value** carries, without exception: subject reference, context, as-of, calculated-at, version reference, provenance class, and observation count. This uniformity is what makes LC-D structural.

**No relation in the catalogue holds a metric whose owner lies elsewhere**, other than sealed resolutions in the `snapshot` schema, which name the entity they resolve and are therefore resolutions rather than duplicates under LC-C.

---

# 5.21 Physical Relationship Catalogue

## 5.21.1 Relationship classes

| Class | Cardinality | Referential action | Physical form |
|---|---|---|---|
| Vocabulary reference | Many to one | Restrict, restrict | Foreign key on code |
| Registry reference | Many to one | Restrict, restrict | Foreign key on surrogate key |
| Version reference | Many to one | Restrict, restrict | Foreign key participating in business identity |
| Subject reference | Many to one | Restrict, restrict | Typed foreign key per kind, with exclusivity check |
| Context reference | Many to optional one | Restrict, restrict | Nullable foreign key with conditional check |
| Parent-child composition | One to many | Restrict; cascade within a sealed aggregate | Foreign key on parent surrogate key |
| Partition binding | Many to one | Restrict, restrict | **Composite foreign key to a redundant unique key** |
| Sealed citation | Many to one | Restrict, restrict | Foreign key preventing removal of the cited row |
| Execution attribution | Many to one | Restrict, restrict | Foreign key to job run |

## 5.21.2 Cross-schema relationships

| From | To | Class | Cardinality | Purpose |
|---|---|---|---|---|
| `feature.feature_value` | `football` subject relations | Subject reference | Many to one | Identifies what a value describes |
| `feature.feature_value` | `football.competition_edition` | Context reference | Many to optional one | Identifies the competition scope |
| `feature.feature_source` | `football` relations | Declaration | Many to one | Declares provenance of inputs |
| `module.module_reading` | `feature` definitions | Registry reference | Many to one | Declared inputs |
| `module.module_evidence_item` | `feature.feature_value` | Sealed citation | Many to one | Cites the exact value that contributed |
| `module.module_reading` | `calibration.published_baseline` | Registry reference | Many to one | Cites the measured baseline in force |
| `module.module_definition` | `product.entitlement_feature` | Vocabulary reference | Many to one | Declares the entitlement required |
| `snapshot.match_snapshot` | `football.fixture` | Partition binding | Many to one | Anchors the claim and supplies the partition key |
| `snapshot.snapshot_feature_state` | `feature.feature_value` | Sealed citation | Many to one | Materialises and permanently protects the value |
| `snapshot.snapshot_module_reading` | `module.module_reading` | Sealed citation | Many to one | Materialises and permanently protects the reading |
| `snapshot.match_snapshot` | `operations.pipeline_job_run` | Execution attribution | Many to one | Traces the claim to its producing execution |
| `calibration.calibration_series` | `module.module_version` | Version reference | Many to one | Keys the series by the version measured |
| `calibration.snapshot_outcome_link` | `snapshot.match_snapshot` | Sealed citation | Many to one | Attaches outcome additively |
| `product.watchlist` | `football` entities | Polymorphic reference | Many to one | Target of a user's selection |

## 5.21.3 Dependency direction

Every cross-schema relationship above points **downward** in the layer order, with three deliberate exceptions previously stated and here restated for completeness:

1. **Module to entitlement feature** — a reference to a governed vocabulary, not a dependency on product behaviour. The module engine resolves no entitlement and reads no subscription.
2. **Calibration to snapshot** — calibration is a cross-cutting owner outside the layer stack, not a fifth layer. No boundary is crossed.
3. **Snapshot to job run** — an audit reference. The claim's meaning does not depend on it; only its traceability does.

The relationship the design forbids — a feature referencing a module reading — has no physical realisation. No foreign key exists in that direction and none may be added, because it would invert the layer order and introduce a cycle into the topological ordering that write sequencing and deployment sequencing both depend upon.

## 5.21.4 Ownership boundaries realised

| Boundary | Physical realisation |
|---|---|
| One owner per relation | Insert privilege granted to exactly one role per relation |
| Layer boundary | Cross-schema privilege matrix (§5.17.2) and permitted reference directions (§5.3.3) |
| Sealing boundary | Schema-level withdrawal of modification privilege (PD-01) |
| Calculation and calibration separation | Calibration holds no insert privilege on `feature`, `module`, or `snapshot` content other than outcome links |
| Product isolation | No schema references `product`; product reads through projections |
| Operational isolation | `operations` holds no outbound foreign key to any authoritative relation |

The final row is the physical statement that operations observes without participating: telemetry may reference nothing, so no authoritative row can be made to depend on a telemetry row's survival.

---

# 5.22 Migration Strategy

## 5.22.1 Migration properties

| Property | Rule |
|---|---|
| Versioned | Sequentially ordinalled; ordinals never reused |
| Immutable once applied | A correction is a subsequent migration, never an edit |
| Forward-only | No down migrations; a reversal is a forward migration that reverses effect |
| Idempotent in effect | Re-application detects the applied state and performs no work |
| Recorded | Application instant, applied-by, checksum, and duration recorded |
| Atomic | Each migration is a single transaction unless it contains an operation that cannot execute transactionally, in which case that operation is isolated in its own migration |

**Forward-only justification.** A down migration that removes a relation removes data, and Phase 4 LC-B forbids destroying a claim. Reversal by forward migration makes the reversal itself an auditable event rather than an erasure of one.

## 5.22.2 Zero-downtime rules

| Operation | Approach |
|---|---|
| Adding a relation | Direct; no existing path is affected |
| Adding a nullable column | Direct |
| Adding a column with a default | Direct in PostgreSQL 16, which does not rewrite the relation |
| Adding a constraint | Created not-valid, then validated separately, so that the initial creation does not hold a lock for the duration of verification |
| Adding an index | Created concurrently; a failed creation leaves an invalid index which is dropped before retry |
| Widening a type | Direct where the widening does not rewrite; otherwise by the multi-phase pattern of §5.22.3 |
| Renaming | Prohibited in a single step; performed by the multi-phase pattern |
| Removing a column or relation | Performed only after a deprecation period during which no path references it |

**Lock discipline.** Any operation requiring an exclusive lock declares a lock timeout and a bounded retry, so that a migration blocked behind a long-running transaction fails quickly rather than queueing behind itself and blocking all subsequent access.

## 5.22.3 Multi-phase changes

Changes that cannot be applied atomically without disruption follow a fixed four-phase pattern.

| Phase | Action |
|---|---|
| Expand | Introduce the new structure alongside the existing one |
| Populate | Backfill the new structure in bounded batches, recording progress |
| Migrate | Move read paths, then write paths, to the new structure |
| Contract | Remove the old structure after a deprecation period with no observed reference |

Each phase is a separate migration with a separate ordinal. The pattern applies to renames, narrowing type changes, identity changes, and partitioning introductions.

## 5.22.4 Backfills

| Property | Rule |
|---|---|
| Batching | Bounded batches with recorded progress, resumable from the last recorded position |
| Attribution | Executed under a pipeline job run, so writes are attributable per LC-159 |
| Idempotency | Guaranteed by the target's business unique constraint, not by backfill logic |
| Validation | Completion verified by an assertion comparing source and target populations |
| Constraint activation | Constraints created not-valid are validated only after backfill completes |

## 5.22.5 Historical reconstruction

Reconstruction produces values and claims at historical as-of instants from reality that is already present.

| Property | Rule |
|---|---|
| Version attribution | Produced under a registered version whose effective period covers the reconstruction |
| Temporal marking | Historical as-of with current calculated-at, making reconstruction distinguishable from contemporaneous observation |
| Ordering | Follows the topological ordering of §5.12.2; reality first, then features, then readings, then snapshots |
| Isolation | Executed under a dedicated job run against the same relations; no separate schema, since reconstructed content is legitimate content |
| Rate limiting | Bounded to protect concurrent operation |
| Population marking | Reconstructed content is identifiable, so calibration populations may include or exclude it explicitly |

The final property is material to the platform's evidential claims: Phase 4 records that reconstructed history and recorded history are different claims, and a calibration population that mixes them without saying so would misstate what was measured.

## 5.22.6 Deployment sequencing

Migrations are applied in ordinal order. Within a release, ordering follows the topological ordering of §5.8.6: vocabularies, then registries, then reality, then features, then modules, then snapshots, then calibration, then product, then operations.

**Privilege changes are applied last**, after the objects they govern exist. A privilege grant against a non-existent object fails, and a grant applied before an object is populated may expose an incomplete state.

**Projection rebuilds follow structural changes**, never precede them, and are executed as a separate step so that a failed rebuild does not fail the migration.

---

# 5.23 Validation Strategy

## 5.23.1 Validation classes

| Class | Frequency | Purpose |
|---|---|---|
| Constraint validation | On migration | Confirms declared constraints hold over existing data |
| Schema conformance | Scheduled | Confirms the physical schema conforms to this specification |
| Replay validation | Scheduled and on demand | Confirms recorded values are reproducible |
| Snapshot validation | Scheduled | Confirms sealed content is intact, complete, and unmodified |
| Projection reconstruction | Scheduled | Confirms projections hold no non-derivable content |
| Reconstruction validation | On reconstruction | Confirms reconstructed content is correctly attributed |

Every result is recorded as a quality assertion result (§5.19.4) and is therefore permanent, making degradation visible as a trend.

## 5.23.2 Schema conformance assertions

| Assertion | Confirms |
|---|---|
| Every relation carries a business unique constraint | PR-01 |
| Every calculated relation carries the seven mandatory attributes | LC-D, §5.9.2 |
| No relation carries a version designation as text | PR-05 |
| No structured payload column exists outside the two permitted circumstances | §5.14.6, LC-64 |
| Every partitioned relation's partition key is functionally determined by its business key | PD-05 |
| No role holds modification privilege on the `snapshot` schema | PD-01, PR-04 |
| Row-level security is enabled on every relation | PD-18 |
| Every index is documented with the access path it serves | §5.11.8 |
| Every definer-privilege function fixes its search path | §5.17.6 |
| Feature value scale conforms to registry declaration | §5.9.9 |
| Module evidence citations fall within declared module inputs | §5.9.9 |
| The declared feature dependency graph is acyclic | §5.9.9, LC-44 |
| The physical reference graph is acyclic | §5.8.6 |

## 5.23.3 Replay validation

Selects a sample of historical values, re-executes their recorded rule versions over their recorded lineage inputs in an isolated scratch schema, and compares the result against the recorded value.

**What a discrepancy indicates.** Either the rule implementation has changed without a version change — which the code revision recorded on the producing job run distinguishes — or lineage is incomplete, or the value was not produced by the rule it claims. All three are defects, and all three are otherwise invisible.

**Manifest traversal assertion.** For a sample of sealed claims, every hop from verdict to module versions to feature versions to lineage to consumed values is traversed, confirming that every reference resolves to a registered entity. This verifies that the reproducibility chain of §5.16.2 is unbroken.

## 5.23.4 Snapshot validation

| Assertion | Confirms |
|---|---|
| Content checksum matches the value recorded at sealing | No modification has occurred |
| Manifest completeness | Every version referenced by content appears in the manifest (LC-103) |
| Aggregate completeness | Every snapshot has a header, feature state, readings, verdict, completeness record, and manifest (LC-78) |
| Citation resolution | Every cited value and reading remains present |
| Outcome linkage integrity | Every completed fixture's snapshots carry links for every dimension its modules address |
| Point conformance | Snapshots exist only at registered points (LC-101) |

The checksum assertion is the retrospective detection mechanism of PR-04's fourth control. Its purpose is to detect modification that circumvented the other three, which is a scenario the design does not expect but does not rely on being impossible.

## 5.23.5 Projection reconstruction validation

Rebuilds each projection into a scratch schema from its declared sources and compares against the live projection.

A projection that cannot be reproduced holds content not derivable from its sources, which contravenes PR-07 and LC-145. Because §5.18.6 excludes projections from backup on the strength of that guarantee, this validation is what makes the exclusion safe.

## 5.23.6 Reconstruction validation

| Assertion | Confirms |
|---|---|
| Version attribution | Every reconstructed row references a version whose effective period covers its as-of |
| Temporal marking | Calculated-at exceeds as-of, marking the row as reconstruction |
| No displacement | Reconstruction created no conflict with pre-existing rows |
| Population identification | Reconstructed content is identifiable for inclusion or exclusion in calibration populations |

## 5.23.7 Validation failure handling

A failed assertion records a result and raises a failure classified data-quality. Data-quality failures are never retried automatically (§5.12.8), because a deterministic assertion produces the same result on repetition and retrying would obscure it in the operational record.

A failed schema conformance assertion blocks the release in which it is detected. A failed replay, snapshot, or projection assertion raises for investigation and does not block, because it indicates a condition already present rather than one being introduced.

---

# 5.24 Performance Strategy

## 5.24.1 Growth envelope

Derived from the coverage target of one hundred or more competitions across a ten-year history.

| Basis | Value |
|---|---|
| Competitions | 10² |
| Fixtures per competition edition | 3.8 × 10² |
| Editions per competition | 10 |
| **Fixtures within the envelope** | **≈ 3.8 × 10⁵** |
| Snapshot points per fixture | 4 |
| **Sealed snapshots** | **≈ 1.5 × 10⁶** |
| Feature values sealed per snapshot | ≈ 1.2 × 10² |
| **Snapshot feature state rows** | **≈ 1.8 × 10⁸** |
| Module readings per snapshot | ≈ 1.3 × 10¹ |
| **Snapshot module reading rows** | **≈ 2.0 × 10⁷** |
| Evidence items per reading | ≈ 5 |
| **Module evidence item rows** | **≈ 1.0 × 10⁸** |
| Appearances per fixture | ≈ 2.6 × 10¹ |
| **Appearance rows** | **≈ 1.0 × 10⁷** |
| **Feature value rows** | **10⁸ – 10⁹, subject to the temporal granularity decision** |
| **Feature lineage rows** | **≈ 3 – 5 × feature value rows** |

**The gating unknown.** Feature value volume spans an order of magnitude depending on the temporal granularity decision recorded as open in Phase 4. The design accommodates both extremes — partitioning and retention are specified independently of the figure — but capacity planning cannot be completed until the decision is taken and the audit's outstanding volume measurements are supplied.

## 5.24.2 Growth assumptions

| Assumption | Consequence if violated |
|---|---|
| Coverage expands by competition, not by increasing fixtures per competition | Partition sizing remains proportionate; violation would concentrate growth within existing partitions |
| Snapshot cadence remains four points per fixture | Snapshot volume scales linearly with coverage; violation scales it multiplicatively |
| Feature definition count grows slowly | Feature value volume scales with subjects and moments, not with definitions; violation multiplies the dominant relation |
| Modules number in the low tens | Reading and evidence volume remain a small multiple of snapshot volume |
| Player-pair analysis, if adopted, is bounded to positional pairings | Unbounded pairing would produce a relation exceeding all others combined |

The final assumption restates a matter the audit flagged: the previous platform's per-fixture player-pair structure permitted a row per player pairing, and whether it was populated at that density is a measurement that must precede any decision to carry the family forward.

## 5.24.3 Query optimisation

| Practice | Rule |
|---|---|
| Partition pruning | Every production read supplies a partition key predicate (§5.10.6) |
| Index-only access | The dominant temporal path is served by a covering index (§5.11.3) |
| Partition-wise joins | Co-partitioned families are joined partition against partition (§5.11.6) |
| Plan stability | Parameterised paths are reviewed for plan stability; a path whose plan varies materially with parameter values is decomposed |
| Aggregate avoidance | No production read aggregates over an unbounded history; historical aggregates are projections |
| Batch bounds | Bulk write paths operate in bounded batches (§5.12.3) |

**Prohibited patterns.** Sequential scan of a partitioned relation in a production read path; unpartitioned access to feature values, module readings, or snapshot content; correlated subqueries over high-volume relations in read paths; and reliance on default statistics for a column with a materially skewed distribution.

## 5.24.4 Statistics

| Practice | Rule |
|---|---|
| Extended statistics | Declared for correlated column groups, particularly subject with context and definition with version, where independence assumptions would misestimate selectivity |
| Statistics target | Raised on columns whose distribution is skewed and which participate in access-path predicates |
| Refresh after bulk load | Statistics are refreshed explicitly after a bulk write or backfill, rather than awaiting the automatic threshold |
| Refresh after partition creation | A newly-created partition has no statistics; they are gathered after first population |

Extended statistics on subject with context are of particular consequence. The two are strongly correlated — a given subject participates in a small number of contexts — and the independence assumption would overestimate the cardinality of the combination and could favour a less selective path.

## 5.24.5 Autovacuum

| Relation class | Configuration |
|---|---|
| Append-only and sealed | Vacuum thresholds relaxed, since no dead tuples are produced; analyse thresholds tightened, since statistics must track rapid growth |
| Mutable, frequently updated | Vacuum thresholds tightened; fill factor reduced to favour in-page update |
| Partitioned | Configured per partition, so that active partitions are treated differently from historical ones |
| Operational | Standard, with a shorter analyse interval given continuous insertion |

**The append-only case is the significant one.** Relations that are never updated or deleted accumulate no dead tuples, so vacuum for space reclamation is unnecessary. They do require analyse to keep statistics current against rapid growth, and they require periodic vacuum to advance the transaction-identifier freeze horizon. Configuration therefore separates the two, rather than treating vacuum and analyse as a single cadence.

## 5.24.6 Maintenance operations

| Operation | Cadence | Notes |
|---|---|---|
| Partition creation | Scheduled, maintaining a forward buffer of not fewer than three intervals | Co-partitioned families created as a single operation (§5.11.6) |
| Retention execution | Scheduled | Aggregation precedes thinning within one execution (§5.19.8) |
| Projection refresh | Scheduled or event-driven | Concurrent where a unique index permits |
| Statistics refresh | After bulk operations and on schedule | |
| Index usage review | Scheduled | Feeds the index lifecycle of §5.11.8 |
| Validation assertions | Scheduled | Results permanent (§5.23) |
| Freeze horizon management | Scheduled | Particularly on append-only partitions, which age without being touched |

Every maintenance operation executes under a pipeline job run, so that maintenance activity is attributable on the same terms as calculation activity.

## 5.24.7 Connection and concurrency

Pipeline roles connect through a bounded pool sized to the write concurrency the design requires, which is modest: write paths are batch-oriented and sequential within a dependency layer.

Read-serving roles connect through the platform's pooling layer. Because the heaviest read — assembly of a sealed snapshot aggregate — is a partition-pruned gather of a small number of rows rather than a broad scan, read concurrency is bounded by connection availability rather than by database processing capacity.

This is a deliberate inversion of the previous platform's characteristic, in which a single fixture required approximately thirty independent round trips and the connection pool, rather than processing capacity, was the binding constraint.

---

# 5.25 Physical Design Summary

## 5.25.1 Preservation of logical guarantees

| Phase 4 guarantee | Physical realisation | Reference |
|---|---|---|
| **Entity ownership** — exactly one owner per entity | Insert privilege granted to exactly one role per relation; schema-level privilege matrix | §5.17.2, §5.21.4 |
| **One source of truth** — resolutions and projections are not owners | Sealed resolutions name the entity they resolve; projections are verified reconstructible | §5.4.6, §5.23.5 |
| **Append-only** — new statements never displace earlier ones | Update and delete privilege withheld; append-only guard; upsert prohibited | §5.15.2, §5.12.4 |
| **Sealed** — written once, permanently unmodifiable | Four concurrent controls: privilege, guard, absent path, checksum assertion | §5.15.4, §5.23.4 |
| **Version ownership** — owned and inherited by reference | Version identity is a foreign key exclusively; snapshot manifests enumerate components | §5.16.1–§5.16.3 |
| **Temporal identity** — the moment is part of identity | As-of in every business unique constraint; as-of and calculated-at separately mandatory | §5.6.5, §5.9.2 |
| **Context identity** — competition scope is part of identity | Context kind and edition columns in every business unique constraint, with conditional check | §5.6.9, §5.9.3 |
| **Historical preservation** — no claim is destroyed | Retention by positive inclusion; referential restriction; partition detachment blocked by references | §5.18.1, §5.18.3, §5.8.7 |
| **Derived versus authoritative** | Projections registered, verified reconstructible, excluded from backup | §5.13.2, §5.23.5, §5.18.6 |
| **Layer boundaries** — no upward reference | Schema privilege matrix; permitted reference directions; acyclic reference graph | §5.3.3, §5.8.6, §5.21.3 |
| **Immutability of claims** | Sealed schema with no modification privilege held by any role, including administrative | §5.17.2 |
| **Temporal behaviour** — current state is a query | No current-state relation exists; covering index serves prevailing-value resolution | §5.15.2, §5.11.3 |

## 5.25.2 Constraint enforcement coverage

Every logical constraint class of Phase 4 §4.15 has a named physical enforcement mechanism.

| Constraint group | Principal mechanism | Residual |
|---|---|---|
| Reality integrity (LC-01 – LC-19) | Foreign keys, checks, exclusion constraints, unique constraints | None |
| Registry governance (LC-20 – LC-28) | Foreign keys to registries; unique constraints; effective-period exclusions | None |
| Feature integrity (LC-29 – LC-47) | Composite unique constraints; not-null; privilege; triggers for cross-relation invariants | Scale conformance and dependency acyclicity, validated (§5.9.9) |
| Module governance (LC-48 – LC-54) | Foreign keys; unique constraints; permanence by absent update privilege | None |
| Reading and evidence (LC-55 – LC-74) | Relational evidence; not-null sample; trigger for baseline version equality | Input conformance, validated (§5.9.9) |
| Snapshot integrity (LC-75 – LC-104) | Schema-level privilege withdrawal; sealing and lifecycle guards; composite unique constraints; restrict semantics | None |
| Derived state (LC-105 – LC-118) | View and projection registration; reconstruction validation | None |
| Calibration integrity (LC-119 – LC-140) | Series keyed by version; append-only results; unique constraints; not-null interval and gate attributes | None |
| Product integrity (LC-141 – LC-158) | Row-level security; exclusion constraints on grants; partial unique index for live subscription; referential defence | None |
| Operational integrity (LC-159 – LC-173) | Not-null attribution; permanent retention of sealed-referenced job runs; permanent assertion results | None |
| Cross-cutting (LC-A – LC-E) | Acyclic reference graph; positive-inclusion retention; single insert privilege; seven mandatory attributes; sample or unverified marking | None |

Three residual enforcement points exist, each enforced by the calculating process and covered by a named validation assertion. No constraint lacks an enforcement mechanism.

## 5.25.3 Decisions recorded

| Reference | Decision |
|---|---|
| PD-01 | Sealed content occupies a dedicated schema, so protection is administered at schema level |
| PD-02 | Governed vocabularies are lookup relations; enumerated types are not used |
| PD-03 | Subject reference is realised as typed foreign keys with an exclusivity check |
| PD-04 | Default surrogate key is a generated identity integer; authentication-linked relations use the platform's identifier type |
| PD-05 | A partition key must be functionally determined by the business key, and the dependency enforced |
| PD-06 | Metric values are stored as exact numerics; binary floating point is not used |
| PD-07 | Absence of a calculated value is the absence of a row, never a null value |
| PD-08 | All instants are stored with time zone; pipeline sessions operate in coordinated universal time |
| PD-09 | Referential actions are restrict by default; one cascade exists, within sealed aggregates |
| PD-10 | Constraints are immediate; no deferral is granted |
| PD-11 | Monthly partitioning for calculated and operational content; yearly for fixture-scoped reality |
| PD-12 | Inverted indexes are confined to permitted opaque payloads |
| PD-13 | Transaction boundaries are the smallest unit preserving a logical guarantee |
| PD-14 | Idempotency is a property of business unique constraints, not of process logic |
| PD-15 | Caching is confined to registered projections |
| PD-16 | Structured payloads are permitted only for retained provider responses and operational diagnostics |
| PD-17 | Each pipeline stage holds a distinct least-privilege role |
| PD-18 | Row-level security is enabled on every relation in every schema |
| PD-19 | Retention operates on a positive inclusion list; omission fails safe |

## 5.25.4 Decisions gated on measurement

| Reference | Decision | Gating measurement |
|---|---|---|
| PG-01 | Geospatial representation for distance calculation | Travel-feature calculation cost against projected venue count |
| PG-02 | Sub-partitioning of feature value partitions | Per-partition row count, once temporal granularity is settled |
| PG-03 | Suppression of identical consecutive values | Proportion of recalculations producing unchanged values |

Each gated decision has a defined default: no geospatial column, no sub-partitioning, no suppression. The design is complete and implementable under every default; the gates concern optimisation, not correctness.

## 5.25.5 Dependencies outside this document

Five prerequisites identified in the Phase 1 audit remain outstanding. They do not block the specification, which is complete, but they do block capacity planning and the settlement of the gated decisions above.

1. A complete authoritative schema dump of the existing platform.
2. Definitions of the undefined read-path objects in the existing platform.
3. Volume measurements for the existing platform's highest-cardinality relations.
4. Orphan and integrity validation results for the existing data.
5. External request quota limits and current consumption.

Two decisions recorded as open in Phase 4 have direct physical consequences and are restated: the temporal granularity of feature calculation, which determines feature value volume within an order of magnitude, and the set of snapshot points, which determines snapshot volume proportionally.

## 5.25.6 Absence of remaining ambiguity

The specification is complete against the following tests:

| Test | Status |
|---|---|
| Every logical entity has a named physical realisation | §5.20 |
| Every logical constraint class has a named enforcement mechanism | §5.25.2 |
| Every residual enforcement point has a named validation | §5.9.9, §5.23 |
| Every relationship has a declared cardinality and referential action | §5.21 |
| Every partitioned relation has a declared key, granularity, and lifecycle | §5.10 |
| Every index serves a declared access path | §5.11 |
| Every read path has a declared strategy and refresh behaviour | §5.13 |
| Every relation has a declared lifecycle class and retention class | §5.15, §5.18, §5.20 |
| Every role has a declared privilege set | §5.17.2 |
| Every naming decision follows one convention | §5.5 |
| Every discretionary decision is recorded | §5.25.3 |
| Every deferred decision has a gating measurement and a default | §5.25.4 |

**What remains for implementation** is the expression of this specification in data definition language, the authoring of migrations in the sequence of §5.22.6, and the settlement of three gated optimisations against measurement. No design question remains open.

---

## Document control

| | |
|---|---|
| **Phase** | 5 — Physical Database Design |
| **Derives from** | Document 07 — V2 Logical Data Model |
| **Preceded by** | Documents 01–05 (audit), 06 (architecture blueprint) |
| **Followed by** | Phase 5.5 — Physical Validation Review |
| **Target platform** | PostgreSQL 16 under Supabase |
| **Status** | Binding engineering specification |
| **Contains** | 7 schemas · 9 design principles · 19 recorded decisions · 3 gated decisions · complete entity and relationship catalogues |
| **Excludes** | Data definition language · migration scripts · procedural code · interface and presentation design |
