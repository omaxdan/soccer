# PitchTerminal V2 — Migrations

**Revision 2.** Phase 6 implementation of **Document 08 Revision 1** (Phase 5.6
correction pass), with every accepted remediation from the Phase 6 audit applied.

**Target:** PostgreSQL 16 on Supabase.

**Verified by execution.** The complete set has been applied end to end to a live
PostgreSQL 16, each file inside a transaction, and every corrected behaviour
exercised against real data. See
[`docs/db-v2/13-phase6-revision-2-migration-set.md`](../../docs/db-v2/13-phase6-revision-2-migration-set.md) §14.

## Apply order

Strictly sequential. The ordering is §B.8.5 of document 08 rev 1 and follows the
topological ordering of the reference graph.

| # | File | Stage |
|---|---|---|
| 001 | `001_extensions.sql` | Extensions, schemas, roles. No privileges. |
| 002 | `002_reference_vocabularies.sql` | Governed vocabularies. No enum types. |
| 003 | `003_versions.sql` | Version registries. |
| 004 | `004_football.sql` | Layer 1 structural relations. |
| 005 | `005_fixture.sql` | Partitioned fixture-scoped relations. |
| 006 | `006_feature_registry.sql` | Feature registry, incl. the context-kind binding relation. |
| 007 | `007_feature_storage.sql` | `feature_value`, `feature_lineage`. |
| 008 | `008_module_storage.sql` | Module registry, readings, evidence. |
| 009 | `009_calibration.sql` | Calibration, baselines, canonical designation. |
| 010 | `010_snapshot.sql` | Sealed snapshot relations. |
| 011 | `011_product.sql` | Plans, entitlement, subscriptions, user data. |
| 012 | `012_operations.sql` | Telemetry. |
| 013 | `013_indexes.sql` | Access paths. |
| 014 | `014_constraints.sql` | Deferred cross-schema and cross-scheme references. |
| 015 | `015_triggers.sql` | The five permitted triggers. |
| 016 | `016_security.sql` | RLS enabled and forced, policies, then grants. |
| 017 | `017_views.sql` | Read models, views, projections, materialised views. |
| 018 | `018_maintenance.sql` | Partition creation, retention, freeze, checksum, assertions. |
| 019 | `019_operational_completion.sql` | Append-only completion for operational runs (S-2 M-1); admin failure-resolution grant (S-2 M-2). |

**Privileges are applied last** (016), after every object exists and every policy
is in force, so no window exists in which an object is reachable without its
policies. In Revision 2 that ordering is structural rather than editorial: the
privilege matrix and the policy matrix are one specification, expanded by
`operations.fn_apply_access`, which issues the policy before the grant it
governs. Migrations 017 and 018 call the same function for the relations they
create after 016 has run.

**Each file must be applied inside an explicit transaction.** Every file is
transactional and several — 016 and 018 in particular — close with assertions
that raise, so that a deployment failing the posture leaves no partial state.

## Conformance gates

Two assertions run during deployment and are available to the administrative
role afterwards. Both raise rather than report.

| Function | Asserts |
|---|---|
| `operations.fn_assert_access_correspondence()` | Every DML privilege held by a non-owner on a design relation has a policy covering that role and that command. Run at the end of 016, 017 and 018. |
| `operations.fn_assert_security_posture()` | RLS enabled and forced everywhere (PD-18, F-09); no UPDATE or DELETE on schema `snapshot` (R-69, R-23); no default privileges on `snapshot` (R-66); DELETE on thinnable relations held only by `pt_retention` (R-22). Run at the end of 018. |

They exist because the defect class they detect is silent: a role holding a
privilege with no policy reads zero rows or writes nothing and reports success.

## Rules verified in these files

| Rule | Status |
|---|---|
| No enum types (PD-02, D-13) | 0 occurrences |
| No generated column as partition key (A.7, R-29) | 0 occurrences |
| No partial unique index on a partitioned relation (F-03) | only on unpartitioned `product.subscription` |
| No schema default privileges on `snapshot` (A.16, R-66) | 0 occurrences |
| No UPDATE or DELETE granted on `snapshot` (R-69) | 0 occurrences |
| Every FK to a partitioned parent is composite (A.1, R-01) | 0 single-column references |
| Only the five permitted trigger classes (§B.6.1) | seal guard, append guard, lifecycle guard, provenance propagation (statement level), watchlist defence |

## Corrections realised

| Correction | Where |
|---|---|
| A.1 composite partitioned references | 005, 007, 008, 010, 011, 014 |
| A.2 outcome revision by ordinal succession | 010 |
| A.3 temporal contamination check | 010 |
| A.4 thinning by deletion, not detachment | 018 |
| A.5 append-guard retention exception | 015 |
| A.6 content checksum storage | 003, 010, 018 |
| A.7 plain partition keys | 005, 007, 008, 010 |
| A.8 canonical designation in the registry | 009, 010 |
| A.9 / A.10 index and constraint patterns | 014 |
| A.11 two triggers replaced by composite FKs | 006, 007, 009, 014 |
| A.12 statement-level provenance | 015 |
| A.13 `btree_gist` | 001 |
| A.14 pipeline role connection model | 001 |
| A.15 migration timeouts and classes | 001, 014 |
| A.16 per-relation snapshot grants | 016 |
| A.17 detachment verification | 018 |

## Idempotency

The set is a sequential first-run deployment; its ordering is a topological sort
of the reference graph. Within that model every construct that can be
re-applied safely is: extensions, schemas and roles are existence-guarded, all
functions and views are `CREATE OR REPLACE`, policies are dropped before being
created, partitions are existence-checked, and registry seeds carry
`ON CONFLICT DO NOTHING`.

## Before production

Eleven `TODO: requires confirmation from Phase 5 schema catalogue` markers are
present. They are questions, not omissions — each records a point where the
source specification is silent or self-inconsistent, rather than a decision made
silently. Locate with:

```
grep -rn "TODO: requires confirmation" .
```

Three warrant particular attention:

1. **`010` — `snapshot_model_output.output_values`** is a structured payload
   outside both circumstances permitted by PD-16. Doc 08 does not enumerate
   output attributes per output type. It must become columnar, or a per-type
   child relation, before production.
2. **`015` — statement-level triggers with transition tables on partitioned
   relations** must be verified against the target PostgreSQL 16 build. Pairs
   with the A.17 detachment verification as a mandatory pre-production platform
   check.
3. **`002` — vocabulary cardinality.** Doc 08 §5.9.5 implies multiple rows per
   code; §5.4.2 requires one. Implemented as one row per code because the
   foreign key requirement is load-bearing.

4. **Bounded retention is gated.** §B.9.4 removes bounded operational content by
   partition detachment, and A.17 / R-71 requires that behaviour to be verified
   empirically on the target build first — specifically whether a partition may
   be detached while an inbound foreign key references rows within it.
   `snapshot.match_snapshot` and `calibration.calibration_run` reference
   `operations.pipeline_job_run` with `RESTRICT` precisely so a job run cited by
   a sealed artefact outlives operational retention, which is exactly the case
   R-71 asks about. The registry declares the bounded policies; `fn_run_retention`
   raises a notice and detaches nothing until the verification is recorded.

The **temporal granularity decision** left open in Phase 4 sets the retention
windows in `018` and determines total storage between roughly 150 GB and 1 TB.
The structure is correct at any setting: retention delivers full resolution in
the recent window, daily in the intermediate window and weekly beyond, per
§B.9.3.
