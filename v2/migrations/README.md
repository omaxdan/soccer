# PitchTerminal V2 — Migrations

Phase 6 implementation of **Document 08 Revision 1** (Phase 5.6 correction pass).

**Target:** PostgreSQL 16 on Supabase.

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

**Privileges are applied last** (016), after every object exists and every policy
is in force, so no window exists in which an object is reachable without its
policies.

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

## Before production

Ten `TODO: requires confirmation from Phase 5 schema catalogue` markers are
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

The **temporal granularity decision** left open in Phase 4 sets the retention
windows in `018` and determines total storage between roughly 150 GB and 1 TB.
The structure is correct at any setting.
