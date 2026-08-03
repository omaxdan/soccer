# PitchTerminal V2 — S-5 Feature Calculation: Implementation Specification

**This document is the implementation contract for S-5.** It supersedes the open decisions of [document 20](./20-phase8-s5-feature-architecture.md); document 20's inventories, graphs and findings remain in force and are not restated here except where a decision changes them.

**No implementation code exists. This document contains no TypeScript and no SQL.**

---

## 0. Conformance language

Used throughout with exactly these meanings, and used consistently:

| Keyword | Meaning |
|---|---|
| **MUST** / **MUST NOT** | An absolute requirement. A violation is a defect, and §11 specifies a test that fails on it |
| **SHALL** | Synonym of MUST, used for behaviour the implementation performs rather than properties it holds |
| **SHOULD** | Strongly recommended. A deviation requires a recorded reason in the implementation |
| **MAY** | Genuinely optional; both choices are conformant |

Where this document says a thing is **DEFERRED**, that thing is out of S-5's scope entirely — not merely unimplemented, but forbidden to implement in S-5.

---

## 1. Resolved decisions

All six are resolved as directed. None is prevented by the approved architecture.

### D-1 — Temporal granularity: PER SNAPSHOT POINT — **ADOPTED**

`feature_value.as_of` SHALL be derived from `football.snapshot_point`, which is seeded by migration 002 and holds exactly four points:

| Code | `offset_before_kick` | Canonical |
|---|---|---|
| `T_MINUS_7D` | 7 days | no |
| `T_MINUS_3D` | 3 days | no |
| `T_MINUS_1D` | 1 day | no |
| `KICKOFF` | 00:00:00 | **yes** |

For a fixture with kickoff `K`, the four `as_of` instants are `K − 7d`, `K − 3d`, `K − 1d`, `K`.

**The offsets MUST be read from `football.snapshot_point`, not written into source.** The set is an open decision (Phase 4 D8) carrying a TODO marker in migration 002; hard-coding four offsets would silently diverge the moment the vocabulary changes. The relation is the authority.

**Subject is TEAM, not FIXTURE.** Each fixture yields values for both participants. One fixture therefore produces:

```
2 teams × 4 snapshot points × 6 features = 48 feature values
```

**Collision is possible and correct.** A team playing twice in a week may reach the same `as_of` instant from two different fixtures (`K₁ − 1d = K₂ − 7d`, say). The business identity does not include the fixture, so the second is a duplicate: it conflicts, is skipped, and the count is reported. This is the identity working, not a defect to route around.

#### Volume consequence

Under this decision the volume envelope of document 08 §5.24.1 (`10⁸`–`10⁹` rows, 150 GB–1 TB) is **not approached**. Stated with its assumptions so it can be checked rather than trusted:

| Assumption | Value |
|---|---|
| Fixtures per season across the 57 tracked leagues | ~17,000 |
| Values per fixture | 48 |
| Values per season | **~0.8 M** |
| Ten seasons | **~8 M** |
| Lineage rows per season (2 edges × readiness values only) | **~0.27 M** |

That is roughly **two orders of magnitude below the envelope's lower bound**. The envelope assumed a far larger definition set and finer granularity; six TEAM features at four points per fixture is a small relation by comparison. Implementation SHOULD record measured row counts after the first full run so the estimate is replaced by evidence.

#### Partition coverage

`feature.feature_value` and `feature.feature_lineage` are partitioned monthly from **2024-01 to 2028-12**, plus a DEFAULT partition. An `as_of` outside that range lands in the default partition, and **a non-empty default partition is a quality breach** (`default_partition_empty`, HIGH), not a silent condition.

`operations.fn_maintain_partitions()` extends the range forward. S-5 MUST NOT create partitions — it holds no DDL privilege and no such need. Implementation SHOULD assert at startup that the calculation window's `as_of` range falls inside a non-default partition, and fail loudly if not.

#### Eligibility — when a value may be calculated

**A value with `as_of = T` MUST NOT be calculated before `T` has passed.** Formally: a `(fixture, snapshot point)` pair is eligible only when `K − offset ≤ now()`.

Calculating earlier would read less reality than existed at `T` while labelling the result "as of `T`" — a claim the value cannot support, and one that append-only makes permanent under its version.

### D-2 — `team.rest_advantage` semantics — **FORMALLY DEFINED**

> **The value at `as_of` is the number of days since the team's most recent completed fixture before `as_of`.**

Binding clarifications, each of which would otherwise be interpreted two ways:

1. **"Completed"** means `fixture.lifecycle_state_code = 'COMPLETED'`. Not the provider's string, not "kickoff has passed" — LC-14 requires branching on the platform vocabulary.
2. **"Before `as_of`"** is strict: `scheduled_kickoff_at < as_of`. At the `KICKOFF` point this excludes the fixture generating the `as_of`, which is required — a team has not rested since a match it has not played.
3. **The unit is days**, `value_scale = 1`, so one decimal place. The quantity is `(as_of − previous_kickoff)` expressed in days, computed in UTC.
4. **A team with no completed fixture before `as_of` produces NO ROW.** Not zero, not a large sentinel. PD-07: absence of a fact is the absence of a row. A newly promoted side at season start genuinely has no rest figure under this definition.
5. `sample_observation_count` is **1** when a previous fixture exists — the value rests on exactly one observation. The declared threshold is 1, so `sample_meets_threshold` is `true` whenever a row exists.
6. **Provenance is `OBSERVED`**, matching the registry ceiling. It is arithmetic over recorded kickoff instants with no estimation, and it consumes no other feature, so no lineage floor applies.

This definition requires **no registry change**. It is consistent with the subject kind (TEAM) and the meaning S-3 recorded.

### D-3 — Contexts: `ALL_COMPETITIONS` only — **ADOPTED**

S-5 SHALL calculate values at `context_kind_code = 'ALL_COMPETITIONS'` exclusively.

`context_competition_edition_id` MUST be NULL for every value S-5 writes, which `ck_feature_value__context_edition_conditional` independently requires for any kind other than `COMPETITION_SCOPED`.

The `COMPETITION_SCOPED` bindings on `team.home_form`, `team.away_form` and `team.congestion_index` **remain registered and valid**. Nothing is retracted, no registry row changes, and adding those values later is additive. **DEFERRED.**

### D-4 — Forward-only by default, replay by explicit invocation — **ADOPTED**

Default operation SHALL calculate eligible pairs within a forward window from `now()`.

Historical replay SHALL exist **only** as an explicit CLI invocation, and SHALL use **the same calculation pipeline** — the same calculators, the same write path, the same attribution. It MUST NOT be a second implementation.

The distinction is entirely in the driver: which `(fixture, snapshot point)` pairs enter the work list. Forward operation selects pairs newly eligible since the last run; replay selects pairs within an explicit bounded range.

**Honest caveat, stated because it will otherwise be discovered:** S-4 ingests forward-only. Replay can only calculate over football reality that was actually ingested, so at cut-over there is little history to replay. Replay becomes useful as ingested history accumulates, or if S-4's backfill is later exercised.

### D-5 — Sequential execution within Stage 1 — **ADOPTED**

Stage 1's four calculators SHALL execute **sequentially**. Parallelism MUST NOT be introduced until timing evidence from §11 exists.

The connection arithmetic, stated exactly:

| Fact | Value |
|---|---|
| `pt_pipeline_feature` default pool maximum | **4** |
| Connections per attributed run (control + work) | **2** |
| Concurrent attributed runs the pool permits | **2** |
| Stage 1 calculators | **4** |

Full parallelism would need eight connections against a pool of four and would block, not fail — the S-2 experience showed that a starved pool presents as a hang rather than an error. Two-way parallelism would fit, but pool maxima are *"deliberately small (20 across all seven)"* and R-05 registers slot exhaustion as a High risk. Sequential is correct until measured.

### D-6 — `verify.ts` residual controls — **ADOPTED**

S-5 SHALL implement four verification commands corresponding to registered-but-unimplemented quality checks (finding S5-2):

| Command | Registered check | Severity | What it asserts |
|---|---|---|---|
| `feature_scale_conformance` | ✔ registered | HIGH | Every `feature_value.value` conforms to the `value_scale` its definition declares |
| `provenance_propagation` | ✔ registered | HIGH | No value carries a provenance class stronger than the weakest in its lineage |
| `feature_dependency_acyclic` | ✔ registered | **BLOCKING** | The declared dependency graph contains no cycle |
| `orphan_absence` | ✔ registered | HIGH | No value references a retired definition or an unregistered version |

**These are TEMPORARY IMPLEMENTATION CONTROLS.** They exist because the corresponding assertions are declared in `operations.quality_check` but have no executable implementation. Each MUST carry, in its own documentation, a statement that it is a stand-in for a database-side assertion and SHOULD be removed when that assertion is implemented.

**They MUST NOT duplicate a database constraint.** Each of the four covers a rule the schema does *not* enforce:

| Command | Why it is not duplication |
|---|---|
| `feature_scale_conformance` | *"Cannot be enforced on the value column by CHECK, because a check constraint may not reference another relation"* — the design names it a residual enforcement point |
| `provenance_propagation` | The A.12 trigger cannot fire (S5-1). There is no database rule to duplicate |
| `feature_dependency_acyclic` | LC-44 is *"validated, not triggered"*, and the validation does not exist |
| `orphan_absence` | No constraint expresses "retired definition"; `is_active` is a flag, not a reference |

Implementation MUST NOT add a check for anything PostgreSQL already enforces — subject exclusivity, context obligation, the version/definition binding, sample non-negativity, foreign keys. A violation of those MUST surface as a named constraint failure.

`verify.ts` SHALL run as `pt_platform_admin` for read breadth where cross-schema reads are needed, and MUST NOT write anything.

---

## 2. Architectural refinements

### R-1 — `team.squad_stability` is NOT calculated — **S-5 ships SIX features**

Finding S5-3 is resolved as an explicit implementation decision.

**S-5 SHALL NOT calculate `team.squad_stability`.** No `feature_value` row is written for it, under any version, at any context, in forward operation or in replay.

| Aspect | Disposition |
|---|---|
| `feature_definition` row | **Remains registered.** Not deleted, not deactivated — S-5 holds no UPDATE on the registry regardless |
| `feature_version` `1.0.0` | Remains registered |
| Context bindings | Remain registered |
| `feature_calculator` `squad_continuity` | Remains registered; **no implementation is written** |
| `feature_source` declaration | **MUST NOT be written** — declaring a source for a calculation that does not exist would assert a dependency nobody has |
| `feature_value` rows | **None, ever, in S-5** |

**Why the definition is not redefined.** Its registered meaning is *continuity of selection across recent fixtures*. Selection requires `football.lineup_selection` or `football.appearance`, neither of which S-4 ingests. The available substitute — `player_registration` — measures squad *membership* stability, a materially different quantity: a settled roster with heavy rotation scores high on one and low on the other. Calculating a different quantity under a registered name is precisely the drift the registry exists to prevent.

**The absence is visible, not silent.** `operations.v_freshness` left-joins every active definition to its values and reports `last_calculated_at` as NULL for `team.squad_stability`. A wrong value would report as fresh; an absent one reports as never calculated.

**S-5 therefore ships SIX calculated features across FOUR implemented calculators:**

| Calculator | Features | Stage |
|---|---|---|
| `form_backfill` | `team.home_form`, `team.away_form` | 1 |
| `fixture_load` | `team.rest_advantage`, `team.congestion_index` | 1 |
| `travel_load` | `team.travel_impact` | 1 |
| `team_readiness` | `team.readiness_score` | 2 |

The volume arithmetic of §1 D-1 uses six, not seven.

### R-2 — Deterministic replay

**A clean replay over identical football reality MUST produce an identical result.** This is the property that makes reproducibility real rather than nominal, and it is testable.

Two distinct scenarios, both required:

#### Replay A — two clean runs from empty over identical reality

Given identical `football` content and identical registry content, two independent runs from an empty `feature` schema MUST produce:

| Property | Requirement |
|---|---|
| Feature values | **Identical** in count and in every column except `id` and `calculated_at` |
| Lineage | **Identical** edge set, compared by the natural keys of both endpoints |
| Provenance | **Identical** `provenance_class_code` per value |
| Sample counts | **Identical** `sample_observation_count` and `sample_meets_threshold` |
| Skipped counts | **Identical** per relation |
| Execution order | **Identical** calculator sequence |
| `calculated_at` | **The only permitted difference** |

**`id` is necessarily different** and MUST be excluded from comparison: it is `GENERATED ALWAYS AS IDENTITY`, and two runs from empty draw from a sequence that does not reset. Excluding it is not a weakening — identity is the business key, and the business key is compared in full.

**Lineage MUST be compared by natural key, not surrogate id.** The comparison key is:

```
(produced feature_key, produced subject, produced as_of,
 consumed feature_key, consumed subject, consumed as_of)
```

Comparing `produced_value_id` directly would fail for the same sequence reason and would prove nothing about the edges.

#### Replay B — re-run against an already-populated schema

A second run over unchanged reality MUST write **zero rows** and report **every candidate as skipped**. No new value, no new lineage edge, no `id` consumed beyond what conflict resolution costs.

#### Determinism obligations this places on the implementation

These are requirements, not consequences — each is a way the property can be lost:

1. **Every query feeding a calculation MUST have a total `ORDER BY`.** Unordered reads may return rows in any order; a windowed aggregation over a differently ordered set can produce a different `numeric` result.
2. **All arithmetic reaching `value` MUST be exact.** `numeric` throughout (PD-06). No `Number`, no IEEE 754, in any path that reaches the column. Binary floating point makes the result depend on summation order, which is exactly what determinism forbids.
3. **Rounding MUST be applied once, at the write boundary**, to the declared `value_scale`, with a single stated rounding mode (half-up). Rounding twice at different points yields different results for the same inputs.
4. **The topological sort MUST be deterministic**, with ties broken by `calculator_key` ascending. Iteration order over a hash map is not a stable tie-break.
5. **`as_of` MUST be derived arithmetically** from `fixture.scheduled_kickoff_at` and the snapshot point offset, truncated to whole seconds, and MUST NOT be re-read from the database and reconverted (**ER-01**).
6. **No calculator may read the wall clock.** `now()`, `Date.now()` and `new Date()` MUST NOT appear in any calculation path. The only permitted use of current time is `calculated_at`, supplied at the write boundary, and eligibility selection in the driver.

Obligation 6 is the sharpest: a calculator that computed "days since" against the wall clock instead of against `as_of` would be non-deterministic *and* temporally incorrect, and both failures would look like small numeric drift.

#### ER-01 in S-5 — sharper than in S-4

S-4's exposure was mild: `fixture_partition_on` is a `date`, coarse enough to survive a round trip. **S-5's exposure is direct.** `as_of` is a `timestamptz` that participates in:

- the primary key `(id, as_of)`
- `uq_feature_value__id_as_of`, the target of every composite reference to a value
- both endpoints of `feature_lineage`
- the partition key

**The implementation MUST use its own `as_of` value when writing lineage, never a value read back from the database.** Deriving `as_of` from a provider-originated kickoff (whole seconds) and truncating to seconds makes the value round-trip-safe by construction rather than by luck.

### R-3 — Mutation test: execution order is derived, not hard-coded

**A mutation test MUST prove that execution order comes from `feature_dependency`.**

**Primary form — data mutation, in the database:**

1. Open a transaction as `pt_pipeline_feature`.
2. Assert the baseline order places `travel_load` in Stage 1.
3. **INSERT** a dependency edge declaring `team.travel_impact` consumes `team.rest_advantage`.
4. Reload the graph and recompute the order.
5. Assert `travel_load` has **moved to Stage 2**, after `fixture_load`.
6. `ROLLBACK`.

If the order were hard-coded, `travel_load` would not move and the test fails. This is the direct proof.

**INSERT is used rather than DELETE deliberately.** `pt_pipeline_feature` holds `INSERT` on schema `feature` and **no DELETE** — the test must work within the real privilege model, and `ROLLBACK` is what undoes it. A test needing DELETE would be a test the production role could not run.

**Complementary form — code mutation:** replacing the topological sort with a hard-coded array MUST fail the same test. Both forms are specified; the data mutation is the one that proves derivation.

### R-4 — Ambiguity review

Every previously underspecified behaviour is now fixed. The review found and closed the following:

| Ambiguity in doc 20 | Resolution here |
|---|---|
| Whether `as_of` offsets are read or hard-coded | **Read** from `football.snapshot_point` (§1 D-1) |
| Whether a value may be calculated before its `as_of` | **MUST NOT** (§1 D-1, eligibility) |
| Whether `KICKOFF` includes the generating fixture | **Excluded** — strict `<` (§1 D-2) |
| Whether `rest_advantage` counts from wall clock or `as_of` | **From `as_of`** (§1 D-2, R-2 obligation 6) |
| `sample_observation_count` for `rest_advantage` | **1** when a row exists (§1 D-2) |
| Rounding mode and where rounding happens | **Half-up, once, at the write boundary** (R-2 obligation 3) |
| Tie-breaking in the topological sort | **`calculator_key` ascending** (R-2 obligation 4) |
| Whether `squad_continuity` gets a `feature_source` row | **MUST NOT** (R-1) |
| How lineage is compared for replay | **By natural key of both endpoints** (R-2) |
| Whether `id` may differ across replays | **Yes, and MUST be excluded** (R-2) |
| Which role runs `verify.ts` | **`pt_platform_admin`**, read-only (§1 D-6) |
| Transaction granularity | **One per (calculator, subject batch)** (§4) |

**Keyword consistency has been checked across this document and document 20.** No requirement is stated as MUST in one place and SHOULD in another. Where document 20 said "recommendation", this document states the resolved obligation.

### R-5 — Compliance check against the seven invariants

Each implementation detail specified above was checked against all seven. No violation found.

| Invariant | Check | Result |
|---|---|---|
| **Append-only lifecycle** | No specified operation updates or deletes `feature_value` or `feature_lineage`. The only UPDATE anywhere in the spec is none. Duplicate handling is `ON CONFLICT DO NOTHING` on a named target | ✅ |
| **Privilege model** | Every specified operation is within `SELECT` on `football`, `SELECT, INSERT` on `feature`, `SELECT, INSERT` on `operations`. `verify.ts` reads only. The R-3 mutation test uses INSERT + ROLLBACK, never DELETE | ✅ |
| **Provenance model** | `min(registry ceiling, weakest lineage input)` computed at the write boundary; the ceiling is read from the registry, not assumed. Lineage recorded for readiness only, correctly | ✅ |
| **Registry ownership** | S-5 reads `feature_definition`, `feature_version`, `feature_calculator`, context bindings and **never writes them**. It writes only `feature_source` and `feature_dependency`, which S-3 explicitly deferred to S-5, plus values and lineage | ✅ |
| **Version identity** | `feature_version_id` is written on every value, sits inside the business identity, and is bound to its definition by composite FK. Supersession is by new version, never by overwrite | ✅ |
| **Temporal correctness** | Every window bounded by `as_of` with strict `<`; eligibility forbids calculating ahead of `as_of`; no calculator reads the wall clock; leakage tests in §11 | ✅ |
| **Security posture** | No service role. No `supabase-js`. One role. No USAGE on `module`, `snapshot`, `calibration`, `product`. No DDL. No privilege change | ✅ |

One detail deserves explicit note because it looks like a violation and is not: **S-5 writes `feature_source` and `feature_dependency`, which are registry relations.** This is within registry ownership because S-3 recorded them as deferred to S-5 — *"Not knowable until the calculators exist, which is S-5"* — and because `pt_pipeline_feature` holds INSERT on them by the schema-wide grant. S-5 writes them **once, additively**, and holds no UPDATE to amend them afterwards.

### R-6 — Finding responses

Every finding has an explicit implementation response. **Two remain unresolved at the schema level**, and that is stated rather than obscured.

| Finding | Severity | S-5 implementation response | Schema-level status |
|---|---|---|---|
| **S5-1** — A.12 provenance trigger cannot fire | Material | Compute `min(ceiling, weakest input)` at the write boundary; test it directly; **mutation-test it** (§11). `verify.ts provenance_propagation` provides detection | **UNRESOLVED.** Requires an architecture-owner decision. S-5 proposes no schema change |
| **S5-2** — 12 of 14 quality checks unimplemented | Material | `verify.ts` implements the four that bear on S-5 (§1 D-6), each marked temporary | **UNRESOLVED** for the other eight. S-5 addresses only its own four |
| **S5-3** — `squad_stability` has no ingested source | Scope | **Resolved.** Feature not calculated; definition remains registered; six features ship (R-1) | Resolved — no schema change needed |
| **S5-4** — calculator version not on the value | Minor | **No action.** Assessed correct by design: if the implementation changed the numbers, the rule changed and a new `feature_version` was required | Resolved — no change needed |

**S5-1 and S5-2 are not blockers for coding.** S-5 can compute both guarantees correctly and can detect drift in its own controls. What is missing is *database-side* enforcement, which S-5 is forbidden to add and which does not prevent implementation. They are carried into §12 as risks, not blockers.

---

## 3. Feature set as built

Six features, four calculators, `ALL_COMPETITIONS` only, four `as_of` points per fixture.

| # | `feature_key` | Calculator | Stage | Scale | Provenance | Threshold | Window | Lineage |
|---|---|---|---|---|---|---|---|---|
| 1 | `team.home_form` | `form_backfill` | 1 | 2 | DERIVED | 5 | last 10 completed home fixtures | none |
| 2 | `team.away_form` | `form_backfill` | 1 | 2 | DERIVED | 5 | last 10 completed away fixtures | none |
| 3 | `team.rest_advantage` | `fixture_load` | 1 | 1 | **OBSERVED** | 1 | most recent completed fixture | none |
| 4 | `team.congestion_index` | `fixture_load` | 1 | 2 | DERIVED | 3 | 28 days | none |
| 5 | `team.travel_impact` | `travel_load` | 1 | 2 | DERIVED | 3 | last 5 completed away fixtures | none |
| 6 | `team.readiness_score` | `team_readiness` | **2** | 2 | DERIVED | 3 | open spells at `as_of` | **2 edges** |

| — | `team.squad_stability` | *(registered, not implemented)* | — | — | — | — | — | — |

**Only feature 6 produces lineage**, consuming `team.rest_advantage` and `team.congestion_index` at `ALL_COMPETITIONS`. The other five have no feature inputs and correctly produce none — R-53 exempts them.

**Every window bound is strict (`<  as_of`) and computed in UTC.** A team with insufficient observations still produces a row if it has at least one; `sample_meets_threshold` records whether the declared threshold was met, and consumers decide what to do about it. A team with *no* qualifying observation produces **no row**.

---

## 4. Execution model

```
DRIVER
  select eligible (fixture, snapshot point) pairs
      forward:  newly eligible since last run, within the forward window
      replay:   explicit bounded range
  derive as_of = kickoff − offset, truncated to seconds
  expand to (team, as_of) subjects

STAGE 1  — sequential (D-5), order from feature_dependency (ties: calculator_key asc)
  form_backfill      → team.home_form, team.away_form
  fixture_load       → team.rest_advantage, team.congestion_index
  travel_load        → team.travel_impact
      ↓ committed
STAGE 2  — requires stage 1 committed
  team_readiness     → team.readiness_score  (+ lineage)
```

**Transaction boundary: one per (calculator, subject batch).** Within a transaction the order is forced by the foreign key — values first, then their lineage — because `feature_lineage.produced_value_id` references `feature_value(id, as_of)`.

**Stage 2 MUST NOT begin until Stage 1 has committed.** Its inputs are read through `feature_value` on a different connection, and uncommitted rows are invisible there.

**A batch that fails rolls back entirely** and the run continues to the next batch. A half-written batch is worse than an absent one: the next attempt would find some values present and skip them, leaving a permanently partial result under append-only.

**Attribution:** every stage runs under `withRun('pt_pipeline_feature', …)`. `pt_pipeline_feature` holds `SELECT, INSERT` on `operations`, so **there is no unattributed path in S-5** — the S3-1 situation does not recur. `operations.write_record` SHALL be written **per relation**, so a relation that received nothing is legible.

---

## 5. Duplicate handling — restated as contract

| Situation | Behaviour |
|---|---|
| Same subject/context/definition/`as_of`/**version** | Conflict → **skipped**, reported |
| Same everything but a **new version** | **New row.** Both coexist; neither is overwritten |
| New `as_of` | New row |
| Re-recording a lineage edge | Conflict on `uq_feature_lineage__produced_consumed` → skipped |

`ON CONFLICT` MUST name its target. A bare `DO NOTHING` swallows every constraint violation, including the composite version/definition mismatch and the subject-exclusivity check — each of which means the calculator is wrong and must be heard.

`calculated_at` differing between runs does **not** break idempotency; it is not part of the business identity, and a value calculated twice retains the `calculated_at` of the row that exists.

---

## 6. Proposed layout — final

Unchanged from document 20 except as the decisions require. `squadContinuity.ts` is **removed** (R-1); `verify.ts` is **confirmed** (D-6).

```
src/v2/feature/
  index.ts                    public surface
  README.md

  registry/
    load.ts                   reads definitions, versions, calculators, context
                              bindings, and snapshot_point offsets FROM THE DATABASE
    declare.ts                writes feature_source and feature_dependency, once
    order.ts                  deterministic topological sort; ties by calculator_key

  calculators/
    types.ts                  the Calculator contract — PURE, no writes, no clock
    formBackfill.ts           team.home_form, team.away_form
    fixtureLoad.ts            team.rest_advantage, team.congestion_index
    travelLoad.ts             team.travel_impact
    teamReadiness.ts          team.readiness_score — the only consumer

  read/
    fixtures.ts               windowed reads bounded by as_of, total ORDER BY
    availability.ts           open spells and registrations at as_of
    venues.ts                 coordinates; NULL propagated, never substituted
    featureValues.ts          prior values for stage 2

  write/
    values.ts                 INSERT ... ON CONFLICT (<named target>) DO NOTHING
    lineage.ts                edges, after values, same transaction
    scale.ts                  half-up rounding to value_scale, once
    provenance.ts             min(registry ceiling, weakest lineage input)

  driver/
    eligibility.ts            (fixture, snapshot point) → as_of; forward and replay
  pipeline.ts                 stage orchestration, attribution, telemetry
  verify.ts                   the four temporary controls (D-6)
  cli.ts                      npm run feature:v2

  __tests__/
    feature.test.ts
```

**Calculators are pure**: they receive already-read inputs and return candidate values plus consumed-value references. They open no connections, issue no writes, record no telemetry and read no clock. That is what makes them testable without a database and keeps the append-only write path in exactly one place.

---

## 7. Verification plan — final

Six classes. Every MUST in this document maps to at least one.

### 7.1 Declaration tests — no database

- every implemented calculator claims only registered features; **`squad_continuity` is absent**
- exactly six features are claimed
- topological order is deterministic and stable across repeated calls
- ties break by `calculator_key` ascending
- scale rounding: half-up, applied once, per declared scale
- provenance resolution across all ceiling/input pairings
- no floating-point path reaches `value` — asserted by exact-arithmetic comparison
- window arithmetic is UTC and strict at the upper bound

### 7.2 Database tests

- values land with correct subject, context, version, provenance, sample fields
- `context_competition_edition_id` is NULL on every written value (D-3)
- lineage written for readiness and **for nothing else**
- **no `team.squad_stability` row exists after a full run** (R-1)
- `feature_source` rows are `football` only; **none for `squad_continuity`**
- `write_record` written per relation; a zero-write run is legible
- a team with no qualifying observation produces **no row**
- `as_of` values fall in non-default partitions

### 7.3 Privilege tests — against the live catalogue

- **no UPDATE** anywhere in schema `feature`
- **no DELETE** anywhere in schema `feature`
- **no USAGE** on `module`, `snapshot`, `calibration`, `product`
- **only SELECT** on `football`
- can write its own telemetry

### 7.4 Lifecycle tests

- `UPDATE` on `feature_value` is **refused** — grant, policy and guard
- `DELETE` on `feature_value` is **refused** without the retention marker
- a value under a new version coexists with its predecessor

### 7.5 Leakage tests

- a value `as_of T` MUST NOT include a fixture kicking off at or after `T`: seed fixtures either side, assert the value equals the one computed from the earlier set alone
- at `KICKOFF`, the generating fixture is excluded (D-2 clarification 2)
- readiness at `T` consumes only inputs with `as_of ≤ T`, agreeing with `ck_feature_lineage__consumed_not_after_produced`
- **a pair is not calculated before its `as_of`** (D-1 eligibility)

### 7.6 Deterministic replay tests (R-2)

- **Replay A**: two clean runs from empty over identical reality produce identical values, lineage (by natural key), provenance, sample counts, skipped counts and execution order; only `calculated_at` differs
- **Replay B**: re-run against a populated schema writes zero rows and skips everything

### 7.7 Mutation tests

| # | Mutation | Must fail |
|---|---|---|
| 1 | Remove the provenance floor (always claim the registry ceiling) | provenance test — **the only control that exists, given S5-1** |
| 2 | Remove scale rounding | scale conformance test — **the only control, given S5-2** |
| 3 | Widen a window to `≤ as_of` | leakage test |
| 4 | Replace the named `ON CONFLICT` target with a bare `DO NOTHING` | constraint-visibility test |
| 5 | **Insert a dependency edge; assert the order changes** (R-3) | order-derivation test — proves the order is not hard-coded |
| 6 | Replace the topological sort with a hard-coded array | same test as 5 |
| 7 | Read the wall clock instead of `as_of` in a calculator | replay determinism test |

---

## 8. Constraint compliance

| Constraint | Compliance |
|---|---|
| No implementation code | This document contains no TypeScript and no SQL |
| No migration modified | None touched |
| No schema change | Two findings remain open at the schema level; **neither is designed around** |
| No permission change | Grants are read and verified, never altered |
| No new vocabulary | `subject_kind`, `context_kind`, `provenance_class`, `snapshot_point` referenced by FK; none introduced |
| Append-only not weakened | No UPDATE or DELETE path in the design; verified at three layers |
| Database rules not duplicated | Only scale, provenance, acyclicity and orphan detection are in code, each because the schema delegates or cannot enforce |
| No module output | No USAGE on `module` |
| No snapshot composed | No USAGE on `snapshot` |
| No provider data ingested | `SELECT` on `football` only |
| No service role | `pt_pipeline_feature` throughout; `pt_platform_admin` read-only for `verify.ts` |
| Architecture not redesigned | Decisions resolved as directed; no structure changed |

---

## 9. Standing after S-5

Once implemented, S-6 will receive:

- **`feature.feature_value` populated for six TEAM features** at `ALL_COMPETITIONS`, at four snapshot points per fixture, each carrying subject, context, version, provenance and sample sufficiency.
- **`feature.feature_lineage`** recording the two readiness edges per readiness value.
- **`feature.feature_source` and `feature.feature_dependency` populated** for the four implemented calculators — making freshness derivable and execution order data.
- **`operations.v_freshness` meaningful**, reporting genuine staleness per context, and honestly reporting `team.squad_stability` as never calculated.
- **A read path for module inputs** — `pt_pipeline_module` holds `SELECT` on `feature`.
- **`verify.ts`**, four temporary controls that S-6 inherits and that should be retired when the database-side assertions are implemented.

S-6 will **NOT** receive: `team.squad_stability` values; PLAYER, FIXTURE or COMPETITION_EDITION features; `COMPETITION_SCOPED` values; or any feature sourcing lineups, appearances, match events or provider statistics.

**Nothing beyond S-5 is implemented, and S-5 itself is not implemented.**

---

## 10. Implementation Readiness

### Architecture completeness

**98%.**

| Area | Complete | Note |
|---|---|---|
| Feature and source inventory | 100% | Six features, four calculators, all windows and exclusions specified |
| Dependency graph and ordering | 100% | One edge, two stages, derivation and tie-breaking specified |
| Duplicate handling and supersession | 100% | Version-in-identity; conflict targets named |
| Provenance model | 100% | Two ceilings, computation point, lineage scope |
| Determinism and replay | 100% | Six obligations, two scenarios, comparison keys |
| Security and privilege | 100% | Verified against the live catalogue |
| Verification plan | 100% | Seven classes, seven mutations |
| Volume and partitioning | 95% | Estimate stated with assumptions; **replace with measurement** after first run |
| Calculator internals | **90%** | Windows, units, provenance and sample semantics are specified; the **precise weighting formulae** for form, congestion, travel and readiness are not |

The 2% is the last item, and it is deliberate. Weighting formulae are the calculators' internal business logic — the thing implementation writes. What this document fixes is everything a formula must respect: source relations, window bounds, scale, direction, provenance ceiling, sample semantics, determinism and exact arithmetic. **A formula chosen within those constraints cannot violate the architecture**, which is what makes it safe to leave to implementation rather than a gap.

### Remaining blockers

**None.**

Both material findings are unresolved *at the schema level*, and neither blocks coding:

| Item | Why not a blocker |
|---|---|
| S5-1 — provenance trigger cannot fire | S-5 computes provenance correctly and detects drift via `verify.ts`. The missing enforcement is a database-side gap the owner must close; implementation proceeds without it |
| S5-2 — quality checks unimplemented | Same. `verify.ts` covers S-5's four |

### Remaining assumptions

Stated so they can be checked rather than trusted:

1. **The four snapshot points are the production set.** Migration 002 carries a TODO recording the set as an open decision (Phase 4 D8). Reading offsets from the relation rather than source means a change is absorbed, but a change would alter volume proportionally.
2. **S-4 will have ingested enough completed fixtures** for windows of 10 fixtures / 28 days to be satisfiable. At cut-over, forward-only ingestion means most teams will not meet the thresholds initially, and values will correctly report `sample_meets_threshold = false`.
3. **`pt_pipeline_feature`'s pool maximum stays at 4.** D-5's sequential execution needs 2; the arithmetic changes if the maximum is lowered.
4. **`feature_value` partitions cover the calculation window.** True for 2024-01 through 2028-12; `fn_maintain_partitions()` extends forward and is not S-5's to run.
5. **The registry is not amended mid-run.** S-5 loads it once per run; a concurrent registry change by `pt_platform_admin` would not be seen. The registry is *"modified rarely and under governance"*, so this is acceptable — and stated.

### Implementation risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Late ingestion makes a value permanently wrong.** A value calculated at `as_of = T` over reality S-4 had not yet ingested cannot be corrected — append-only, same version | Medium | High | **Operational ordering**: ingestion for the window MUST complete before calculation runs. This is a scheduling dependency, not a code change. `operations.v_freshness` makes staleness visible. A genuine correction requires a new `feature_version`, which is the governed path |
| 2 | **Provenance drift undetected in production.** `verify.ts` runs on demand; nothing runs it automatically | Medium | High | Run `verify.ts` in the test suite and as a scheduled CLI step. Mutation test 1 protects the computation itself. **Residual risk remains until S5-1 is closed at the schema level** |
| 3 | **Floating point leaks into a formula.** Easy to introduce, hard to see, breaks determinism and calibration equality | Medium | High | Exact-arithmetic assertion in declaration tests; replay test 7.6 catches order-dependence; code review of every calculator |
| 4 | **Thin coverage at cut-over reads as failure.** Most teams below sample thresholds initially | High | Low | Expected and correct. `sample_meets_threshold = false` is the designed representation; consumers decide |
| 5 | **Sequential execution too slow at full coverage.** 17,000 fixtures × 4 points × 6 features | Low | Medium | Measure first (D-5). Two-way parallelism fits the current pool without any privilege or configuration change |
| 6 | **Default partition receives rows** if `as_of` falls outside 2024-01…2028-12 during replay of old fixtures | Low | Medium | Startup assertion on the window's `as_of` range; `default_partition_empty` is a registered HIGH check |

### Is S-5 ready for coding?

**Yes.**

Every decision is resolved. Every finding has an explicit response, and the two that remain open at the schema level are the architecture owner's to close and do not prevent implementation. Every invariant has been checked against every specified behaviour. Every MUST has a test.

Three things the implementer should carry into the first commit:

1. **The determinism obligations (R-2) are the hardest part**, and obligation 6 — no wall clock in a calculator — is the one most likely to be violated by accident.
2. **`verify.ts` is a temporary control** and must say so in its own documentation, or it will be mistaken for permanent architecture.
3. **Six features, not seven.** `squad_continuity` has no implementation and no `feature_source` row.
