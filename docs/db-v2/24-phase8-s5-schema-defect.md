# PitchTerminal V2 — S-5 Finding S5-5: The Business Identity Cannot Detect a Duplicate

> **CORRECTED by migration `020_null_distinct_identities.sql`** (with rollback). Seven Class A constraints now carry `NULLS NOT DISTINCT`; the two Class B single-column alternate keys are deliberately unchanged. Verified by execution: duplicate detection works on both `feature.feature_value` and `module.module_reading`, and the S-5 suite reaches 103/103 once the two `todo` markers and the defect-characterisation test are removed. **No application code changed.**

**A genuine contradiction with the live database schema, found by executing the implementation. Reported rather than worked around, per the S-5 implementation brief.**

S-5 is **implemented and passing** apart from this. 103 tests: 101 pass, 0 fail, 2 marked `todo` against this finding.

---

## 1. The defect

`uq_feature_value__subject_context_definition_asof_version` — the constraint that **is** the business identity of a feature value — cannot fire. Two logically identical values both insert, and `ON CONFLICT … DO NOTHING` has nothing to catch.

The same defect is present on `module.module_reading`, which S-6 will depend on.

## 2. Why

The constraint is a plain `UNIQUE`:

```
UNIQUE (subject_kind_code, subject_team_id, subject_player_id, subject_fixture_id,
        subject_fixture_partition_on, subject_competition_edition_id,
        context_kind_code, context_competition_edition_id,
        feature_definition_id, as_of, feature_version_id)
  INCLUDE (value, provenance_class_code, sample_observation_count,
           sample_meets_threshold, feature_version_id)
```

PostgreSQL's default is **`NULLS DISTINCT`**: two rows with a NULL anywhere in the key are never equal, so the constraint does not consider them duplicates.

**Five of the eleven key columns are NULL for every value S-5 writes**, and they are not incidentally null — they are *forced* null by two CHECK constraints on the same table:

| Column | Forced NULL by |
|---|---|
| `subject_player_id` | `ck_feature_value__subject_exclusive`, for a `TEAM` subject |
| `subject_fixture_id` | same |
| `subject_fixture_partition_on` | same |
| `subject_competition_edition_id` | same |
| `context_competition_edition_id` | `ck_feature_value__context_edition_conditional`, for `ALL_COMPETITIONS` |

**The defect is total, not partial.** `ck_feature_value__subject_exclusive` requires exactly one of the four typed subject columns to be populated, so *every* row of *every* subject kind leaves at least three of them NULL. There is no combination of legal column values for which this constraint can detect a duplicate.

## 3. Evidence

Two identical logical rows, inserted twice with the named conflict target, as the table owner so no privilege interferes:

```
INSERT 0 1
INSERT 0 1
             outcome
----------------------------------
 rows for one logical identity: 2
```

The constraint definition, read from the catalogue, contains no `NULLS NOT DISTINCT`. **Nor does any other constraint in the database:**

```
SELECT count(*) FROM pg_constraint
 WHERE contype='u' AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%';
 → 0
```

So this is a systematic omission across the migration set, not a single mistake.

## 4. Blast radius

Unique constraints whose key contains nullable columns, from the live catalogue:

| Relation | Nullable key columns | Assessment |
|---|---|---|
| **`feature.feature_value`** | 6 | **Broken — total.** S-5's business identity |
| **`module.module_reading`** | 6 | **Broken — total.** Identical shape; S-6 will hit this |
| `product.watchlist` | 4 | Broken for any partial watchlist entry |
| `football.provider_statistic` | 2 | Broken where subject is not both player and team |
| `calibration.calibration_series` | 1 | Broken for un-scoped series |
| `product.p_team_state` | 1 | Broken for the all-competitions row |
| `product.user_preference` | 1 | Broken for the global preference row |
| `football.venue`, `football.official` | 1 each | Benign in practice — a NULL provider id means "no alternate key", and duplicates there are tolerable |

`feature.feature_lineage`, `feature_source` and `feature_dependency` are **unaffected** — every column in their unique keys is NOT NULL. S-5's lineage writes are correctly idempotent.

## 5. What it breaks in the approved specification

| Requirement | Source | Status |
|---|---|---|
| Recalculating the same subject/context/definition/`as_of` under the same version **conflicts and is skipped** | Doc 21 §5 | **Unattainable** |
| **Replay B** — a second run over unchanged reality writes **zero rows** | Doc 21 R-2, a MUST | **Unattainable** |
| Idempotency | Doc 21 §8, a listed guarantee | **Unattainable** |
| Supersession by version, never by overwrite | Doc 21 §5 | **Undermined** — version-in-identity is meaningless if the identity never matches |

In operation, every re-run would append a complete duplicate set. `feature_value` is the highest-volume relation in the design (`10⁸`–`10⁹`), it is append-only, and `pt_pipeline_feature` holds no DELETE — so duplicates would be **permanent and unbounded**, and the retention thinner would preserve one of each duplicate group per bucket rather than deduplicating them.

**Replay A is unaffected and passes.** Two clean runs produce identical output; the defect is that a *second* run against existing data does not recognise it.

## 6. What I did not do

- **Did not modify the schema or write a migration.** Forbidden, and the correction is the schema owner's.
- **Did not add an application-side existence check.** A check-then-insert is a race, would duplicate a database rule in TypeScript, and would paper over a defect the architecture should own. Doc 21 is explicit that the write path relies on the constraint "because a check-then-insert is a race and the constraint is not".
- **Did not weaken or delete the affected tests.** Tests 98 and 99 still assert what the specification requires and are marked `todo` with a reference here; they should start passing when the schema is corrected.
- **Did not continue past the finding into unrelated work.**

## 7. The correction, for the schema owner

One migration, adding `NULLS NOT DISTINCT` to the affected constraints. For `feature_value` that is a constraint drop and re-add — which on a partitioned relation rebuilds the index on every partition, so it should land **before** the relation carries volume. It is currently empty in every environment, which makes now the cheapest possible moment.

`module.module_reading` should be corrected in the same migration: it has the identical shape, is equally empty today, and S-6 is the next subsystem.

Two adjacent questions worth settling at the same time, both outside S-5's authority:

1. **Should the typed subject columns be replaced by a single subject reference?** Five nullable columns exist to express "exactly one of four kinds", and their nullability is the direct cause of this defect. `NULLS NOT DISTINCT` fixes the symptom; it does not revisit PD-03.
2. **Do the other six affected relations need the same treatment**, or is a NULL genuinely a distinct value in some of them? `football.venue.provider_external_id` is plausibly the latter.

## 8. Status of S-5

**Implemented, and complete apart from this.**

| | |
|---|---|
| Source files | 18, exactly the approved layout. No `squadContinuity.ts` |
| Features calculated | 6. `team.squad_stability` registered and never touched |
| Tests | 103 — 101 pass, 0 fail, **2 todo against this finding** |
| Full backend suite | 322 tests, 320 pass, 0 fail, 2 todo |
| Without a database | 181 tests, 181 pass |

Everything else specified is built and verified: derived execution order, exact arithmetic, single rounding boundary, provenance floor, `MIN(consumed)` sampling, lineage for readiness alone, the four temporary verification controls, privilege and lifecycle posture, leakage bounds, Replay A, and all six mutation tests.

**The one guarantee that cannot be delivered is idempotency, and it cannot be delivered by any amount of application code.**
