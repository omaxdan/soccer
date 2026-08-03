# S-5 — Feature Calculation

Calculates governed features from V2 football reality. Writes `feature.feature_value` and `feature.feature_lineage` as `pt_pipeline_feature`.

```bash
npm run feature:v2                                  # forward, from now
npm run feature:v2 -- calculate --dry-run           # compute, write nothing
npm run feature:v2 -- replay --from 2026-09-01 --to 2026-09-30
npm run feature:v2 -- verify                        # the four temporary controls
```

> ### ⚠ One guarantee is currently unattainable — finding S5-5
>
> `uq_feature_value__subject_context_definition_asof_version` is a plain `UNIQUE` without `NULLS NOT DISTINCT`, and five of its eleven key columns are *forced* NULL by the table's own CHECK constraints. Under PostgreSQL's default `NULLS DISTINCT` it can never detect a duplicate, so **`ON CONFLICT DO NOTHING` has nothing to catch and re-running is not idempotent**.
>
> No application code can fix this. It is recorded in [document 24](../../../../docs/db-v2/24-phase8-s5-schema-defect.md) with evidence and a proposed correction, and two tests are marked `todo` against it. **Do not add an existence check to work around it** — a check-then-insert is a race, and the constraint is not.

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

## Append-only

No UPDATE path, no DELETE path, and `pt_pipeline_feature` holds neither privilege anywhere in schema `feature`. Every conflict target is **named**: a bare `DO NOTHING` would swallow the composite version/definition binding, subject exclusivity and the context obligation, each of which means the calculator is wrong.

Registry relations are read, never written — except `feature_source` and `feature_dependency`, which S-3 explicitly deferred to S-5 and which are written **additively, once**.

## Provenance

`min(registry ceiling, weakest lineage input)`, computed at the write boundary.

**This is the only enforcement of LC-37 that exists.** The A.12 trigger cannot fire (finding S5-1: lineage can only be written *after* its produced value, so the trigger's join always matches zero rows), and the compensating quality check has no implementation (S5-2). A mutation test exists because of that.

Sampling follows the same shape: `MIN(consumed.sample_observation_count)` (DEC-5) — a composite is no better *evidenced* than its thinnest input, exactly as it is no *stronger* than its weakest.

## `verify.ts` — temporary

Four controls standing in for registered quality checks that have no database-side implementation: `feature_scale_conformance`, `provenance_propagation`, `feature_dependency_acyclic`, `orphan_absence`. Read-only, as `pt_platform_admin`.

**Delete this module when those assertions exist.** None duplicates a database constraint — each covers a rule the schema does not enforce.

## Not consumed

`read/availability.ts` is implemented and correct but **imported by nothing**. Doc 21 listed availability as a readiness source; the final ADR superseded that with two feature inputs, so readiness has no Layer 1 source at all. The module is retained because the approved layout names it, and no `feature_source` row cites it.

## Testing

```bash
npm test                    # 181 declaration tests, no database
PT_V2_DB_HOST=… npm test    # plus persistence, privilege, lifecycle, leakage, replay
```

103 tests in this subsystem: **101 pass, 0 fail, 2 todo** (blocked by S5-5). Six mutation tests: wall clock, hard-coded ordering, dependency-graph derivation, bare `ON CONFLICT`, double rounding, provenance floor.
