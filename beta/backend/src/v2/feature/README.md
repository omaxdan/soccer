# S-5 — Feature Calculation

Calculates governed features from V2 football reality. Writes `feature.feature_value` and `feature.feature_lineage` as `pt_pipeline_feature`.

```bash
npm run feature:v2                                  # forward, from now
npm run feature:v2 -- calculate --dry-run           # compute, write nothing
npm run feature:v2 -- replay --from 2026-09-01 --to 2026-09-30
npm run feature:v2 -- verify                        # the four temporary controls
```

> ### ⚠ Known limitation — finding S5-5
>
> **Replay B cannot pass until the schema replaces nullable UNIQUE constraints with NULLS NOT DISTINCT.**
>
> `uq_feature_value__subject_context_definition_asof_version` is a plain `UNIQUE` without `NULLS NOT DISTINCT`, and five of its eleven key columns are *forced* NULL by the table's own CHECK constraints. Under PostgreSQL's default `NULLS DISTINCT` it can never detect a duplicate, so **`ON CONFLICT DO NOTHING` has nothing to catch and re-running is not idempotent**.
>
> This is a **schema-owner issue**, outside S-5 ownership. It is recorded in [document 24](../../../../docs/db-v2/24-phase8-s5-schema-defect.md) with evidence, blast radius and a proposed correction. Two tests are marked `todo` against it and still assert what the specification requires.
>
> **Do not work around it in application code.** No existence check, no `SELECT`-then-`INSERT`, no uniqueness emulated in TypeScript: a check-then-insert is a race and the constraint is not, and any of those would duplicate a database rule while hiding the defect.

## Six features, four calculators

| Feature | Calculator | Stage | Unit | Scale | Provenance ceiling |
|---|---|---|---|---|---|
| `team.home_form` | `form_backfill` | 1 | index | 2 | DERIVED |
| `team.away_form` | `form_backfill` | 1 | index | 2 | DERIVED |
| `team.rest_advantage` | `fixture_load` | 1 | days | 1 | **OBSERVED** |
| `team.congestion_index` | `fixture_load` | 1 | index | 2 | DERIVED |
| `team.travel_impact` | `travel_load` | 1 | index | 2 | DERIVED |
| `team.readiness_score` | `team_readiness` | **2** | index | 2 | DERIVED |

**`team.squad_stability` is registered and never calculated** (R-1). Its registered meaning is *selection* continuity, which needs lineup data S-4 does not ingest; the available substitute measures squad *membership*, a different quantity. It has no calculator, no `feature_source` row and no values. The absence is visible in `operations.v_freshness`, where a wrong value would report as fresh.

## The formulae, and where each comes from

| Feature | Rule | Origin |
|---|---|---|
| form | `(pts₅/15)×100 × 0.7 + (pts₁₀/30)×100 × 0.3` | **V1, carried across unchanged.** The 0.7/0.3 weighting operates inside the 10-fixture window |
| rest | days since the most recent completed fixture | **D-2.** V1's mean-of-last-four-gaps is superseded |
| congestion | `rate = count₂₈ / 2`, then V1's band table | **DEC-3 transform.** V1's window was forward-looking, which S-5 forbids outright |
| travel | mean km per trip over the last 5 away fixtures, V1's band table, then `100 − score` | **V1, carried across unchanged.** `avgKm14` is a per-trip mean, verified in source |
| readiness | `(50 × clamp(rest/7,0,1)×100 + 50 × (100 − congestion)) / 100` | **DEC-2.** Approved weights; V1 gave rest no weight, so nothing existed to inherit |

Normalisation is by the **full window** — 15 is five matches at three points, 30 is ten — so short history reads as weak form rather than perfect form on thin evidence. That is V1's behaviour, carried across deliberately.

## Execution order is derived, never written down

There is no ordered list of calculators anywhere in this subsystem. `deriveExecutionPlan` reads `feature_dependency` and topologically sorts it, ties broken by `calculator_key` ascending. Declaring a new edge changes the order by being declared — proven by a mutation test that inserts one and watches a calculator move between stages.

V1's fifty-edge graph "lived entirely in the ordering of calls within one orchestration process … completely invisible to the model, such that a missing input produced empty values rather than an error."

## Determinism

Six obligations, each a way the property can be lost:

1. **Total `ORDER BY`** on every query feeding a calculation.
2. **Exact arithmetic** — `Exact` (bigint units + scale) throughout. `feature_value.value` never sees a JavaScript `number`. There is no `fromNumber`, deliberately.
3. **One rounding boundary** — half-up, at the write. Rounding twice moves 1.4449 to 1.45 where once gives 1.44.
4. **Deterministic topological sort.**
5. **`as_of` derived arithmetically**, truncated to whole seconds, and the application's own value used everywhere including lineage (**ER-01**).
6. **No wall clock inside a calculator.** Enforced by a source scan in the test suite.

The single exception is the haversine in `travel_load`: there is no exact trigonometry. It is IEEE 754 and deterministic, and it only selects a **band** — the stored value is `100 − band`, an integer, so no float reaches the column.

## Replay guarantees

Two scenarios, and they have different statuses.

**Replay A — two clean runs over identical reality produce identical output. ✅ PASSES.**

Values, lineage, provenance classes, sample counts, skipped counts and execution order are all identical. **`calculated_at` is the only permitted difference**, and `id` is excluded from comparison because it is drawn from a sequence that does not reset — identity is the business key, and the business key is compared in full. Lineage is compared by the **natural keys of both endpoints**, never by surrogate id, for the same reason.

**Replay B — a second run over unchanged reality writes zero rows. ❌ CANNOT PASS.**

Blocked by finding S5-5 above. The business identity cannot detect a duplicate, so `ON CONFLICT DO NOTHING` never fires and every re-run appends a complete duplicate set. Because `feature_value` is append-only and `pt_pipeline_feature` holds no `DELETE`, those duplicates would be permanent.

The test remains in the suite, marked `todo`, still asserting what the specification requires. It should begin passing the moment the schema is corrected — at which point the characterisation test that documents the defect (test 102) will start failing, which is the intended signal that both should be removed.

## Append-only

No UPDATE path, no DELETE path, and `pt_pipeline_feature` holds neither privilege anywhere in schema `feature`. Every conflict target is **named**: a bare `DO NOTHING` would swallow the composite version/definition binding, subject exclusivity and the context obligation, each of which means the calculator is wrong.

Registry relations are read, never written — except `feature_source` and `feature_dependency`, which S-3 explicitly deferred to S-5 and which are written **additively, once**.

## Provenance

`min(registry ceiling, weakest lineage input)`, computed at the write boundary.

**This is the only enforcement of LC-37 that exists.** The A.12 trigger cannot fire (finding S5-1: lineage can only be written *after* its produced value, so the trigger's join always matches zero rows), and the compensating quality check has no implementation (S5-2). A mutation test exists because of that.

Sampling follows the same shape: `MIN(consumed.sample_observation_count)` (DEC-5) — a composite is no better *evidenced* than its thinnest input, exactly as it is no *stronger* than its weakest.

## `verify.ts` — a TEMPORARY architectural control

Document 21 D-6 requires these, and requires them to be understood as temporary. `operations.quality_check` registers fourteen assertions; **only two have executable implementations**, both covering security posture. The other twelve are declarations of intent with no code behind them (finding S5-2). This module stands in for the four that bear on S-5:

| Control | Stands in for | Registered severity |
|---|---|---|
| `feature_scale_conformance` | the registered check of the same name, unimplemented | HIGH |
| `provenance_propagation` | the A.12 trigger, which **cannot fire** (S5-1), *and* the registered check, unimplemented | HIGH |
| `feature_dependency_acyclic` | the registered check, unimplemented | **BLOCKING** |
| `orphan_absence` | the registered check, unimplemented | HIGH |

**These are temporary implementation controls pending future database-side enforcement.** Every `VerificationResult` carries `temporary: true` and a `standsInFor` string, so even a passing report says so. **Delete this module — do not extend it — when those assertions are implemented in the database.**

**None duplicates a database constraint**, which is the only reason any of them may exist. Each covers a rule the schema does *not* enforce: `value_scale` cannot be a CHECK because a check constraint may not reference another relation; the provenance trigger cannot fire; LC-44 is *"validated, not triggered"* and the validation is absent; and no constraint expresses "retired definition", since `is_active` is a flag rather than a reference.

Nothing here re-checks a foreign key, subject exclusivity, the context obligation, the version/definition binding or sample non-negativity. PostgreSQL owns those, and a violation must surface as a named constraint failure rather than as a finding from a script.

Read-only, as `pt_platform_admin` — the one principal with `SELECT` across every design schema, and one holding no `INSERT` on `feature`, so this module could not write even by mistake.

## Architecture

```
driver/eligibility.ts     (fixture, snapshot point) → as_of, from football.snapshot_point
        ↓                 offsets READ, never hard-coded; truncated to whole seconds
   subject batches        one instant, every team needing it
        ↓
registry/load.ts          definitions, versions, calculators, context bindings,
                          snapshot offsets, provenance ranks — all from the database
registry/order.ts         topological sort over feature_dependency
        ↓
   STAGE 1                form_backfill · fixture_load · travel_load   (sequential, D-5)
        ↓ commit
   STAGE 2                team_readiness                (reads what stage 1 committed)
        ↓ commit
write/                    scale → provenance → values → lineage
        ↓
operations.write_record   one per relation, per batch, on the control connection
```

**One transaction per (calculator × subject batch).** Not per stage — that would hold locks across the whole population and lose every good batch to one bad subject. Not per value — that would make a value and its lineage separately committable, and a value whose lineage failed to commit is one nobody can reproduce. Within a transaction the order is forced by the foreign key: **values, then lineage**.

**Stage 2 cannot begin until Stage 1 has committed**, because its inputs are read through `feature_value` on a different connection and an uncommitted row is invisible there.

**Sequential throughout** (D-5). `pt_pipeline_feature` has a pool maximum of 4 and an attributed run holds 2, so four concurrent calculators would need eight and would *block* rather than fail. Parallelise only once timing evidence exists.

## Not consumed

`read/availability.ts` is implemented and correct but **imported by nothing**. Doc 21 §2 listed availability as a readiness source; the final ADR superseded that with two feature inputs, so readiness has no Layer 1 source at all. The module is retained because the approved layout names it, and no `feature_source` row cites it.

## Testing

```bash
npm test                    # 181 declaration tests, no database
PT_V2_DB_HOST=… npm test    # plus persistence, privilege, lifecycle, leakage, replay
```

103 tests in this subsystem: **101 pass, 0 fail, 2 todo** (blocked by S5-5). Six mutation tests: wall clock, hard-coded ordering, dependency-graph derivation, bare `ON CONFLICT`, double rounding, provenance floor.
