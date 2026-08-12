# Phase 8 — `team.travel_distance` implementation gate

S-0-a-ii FINAL is APPROVED (`a99cdfc`). This is the **implementation surface**,
identified before any code changes. **Nothing implemented.**

No source edited, no migration 023, `mv_module_travel` not recreated,
`travelLoad.ts` untouched, `travel_impact` untouched, no burden, no fatigue, no
decay, no inferred legs, no invented threshold, no `feature_dependency` or
`feature_value` rows, S-5 not run.

**Three findings from this pass** are recorded in §4 and §5; two require a small
change nobody had scoped, and one is an observation about `travel_impact` that is
deliberately left alone.

---

## 1. Existing files and modules to reuse

| Reused unchanged | Role |
|---|---|
| `feature/calculators/types.ts` | `Calculator`, `CalculationContext`, `CandidateValue`, `CompletedFixture`, `VenueLocation`, and **`before()`** — the strict `< as_of` bound |
| `feature/read/fixtures.ts` | Supplies `fixturesByTeam`, already returning ≥28 days **plus** the seed. **No change** |
| `feature/read/venues.ts` | Supplies `venuesById`, already filtering `latitude IS NOT NULL AND longitude IS NOT NULL`. **No change** |
| `feature/write/scale.ts` | Single rounding at the write boundary, `Exact` arithmetic |
| `feature/write/provenance.ts` | `min(ceiling, weakest)`; `resolveSampleCount`; `sampleMeetsThreshold` |
| `feature/write/values.ts` | The insert |
| `feature/pipeline.ts` | Registration list + `deriveExecutionPlan` |
| `feature/registry/load.ts` | Registry load, version-in-force resolution |
| `seed/featureRegistry.ts` | `CALCULATORS` and `FEATURES` |
| `seed/helpers.ts` | `seedRows`, `seedRowsResolvingParent`, insert-only |

**Copied, not imported: `haversineKm`.** It is a private function inside
`travelLoad.ts`. Importing it would couple the new calculator to the one being
superseded; exporting it would edit `travelLoad.ts`, which is forbidden. **The
plan is to reproduce the same formula and the same `EARTH_RADIUS_KM = 6371` in
the new calculator, and to assert equality between the two in a test** so the
duplication cannot silently diverge. *(If a later step is authorised to touch
`travelLoad.ts`, extracting it to a shared module is the cleaner end state.)*

## 2. The calculator pattern to follow

**`fixtureLoad.ts` is the closest model**, not `travelLoad.ts`:

- it applies the **same 28-day elapsed window** (`CONGESTION_WINDOW_MS`,
  `windowStart`, `>=`);
- it returns candidates for a Layer-1 feature with `consumed: []` and its **own**
  `sampleObservationCount`;
- it emits **no candidate** where the inputs do not support one.

The shape to follow exactly:

```
export const <name>: Calculator = {
  calculatorKey: '<key>',
  featureKeys: [TRAVEL_DISTANCE],
  calculate(context) { … return candidates; }
}
```

**Constraints inherited from the contract** (`calculators/types.ts`): no
`PoolClient`, **no clock** — `now()`, `Date.now()`, `new Date()` are forbidden by
R-2 obligation 6 — deterministic order, and an **unrounded** returned value.

## 3. New calculator registration

**A new row in `seed/featureRegistry.ts`'s `CALCULATORS`** — a 4-tuple
`[calculator_key, display_name, implementation_version, description]`, matching
the real `feature.feature_calculator` columns (`calculator_key`, `display_name`,
`implementation_version` NOT NULL; `description` nullable).

| Field | Value | Why |
|---|---|---|
| `calculator_key` | e.g. **`travel_itinerary`** | Must not be `travel_load`: that row is semantically bound to `travel_impact` and stays unchanged. One calculator row claiming two unrelated features would be false |
| `display_name` | *"Travel itinerary"* | convention |
| `implementation_version` | **`1.0.0`** | every existing row is `1.0.0` |
| `description` | Must state that it **supersedes** V1's away-only model, not that it carries V1 across | see §5 finding P-2 |

Plus **registration in `feature/pipeline.ts`'s calculator list** — the file's own
comment notes it *"contains no ordered list of calculators; `deriveExecutionPlan`
reads"* the registry, so adding the import and the array entry is the whole
wiring.

## 4. S-3 seed insertion

**One `FEATURES` entry** in `seed/featureRegistry.ts`. That single entry drives
four seeded relations, all insert-only and idempotent:

| Relation | What it gets |
|---|---|
| `feature.feature_calculator` | the new calculator row (§3) |
| `feature.feature_definition` | the ten registry columns, `feature_calculator_id` resolved from `calculator_key` |
| `feature.feature_definition_context_kind` | **`ALL_COMPETITIONS`** — the A.11 binding relation whose composite FK validates every value's (definition, context) pair |
| `feature.feature_version` | designation `1.0.0`, open effective period, rationale |

### ⚠ Finding P-2 — the version rationale is a single shared string, and it would be false here

`featureRegistry.ts` seeds **one hardcoded rationale for every feature**:

> *"Initial registration. Represents the V1 computation named in the definition's
> meaning, **carried across unchanged**. The calculator that implements it
> arrives in S-5."*

For `travel_distance` that statement is **untrue** — S-0-a established that V1's
model is defective and is explicitly superseded. Attaching it would repeat, in a
new row, exactly the authority conflict doc 22 recorded for S-5 and doc 25 for
S-6.

> **Required change: `featureRegistry.ts` must take a per-feature rationale**
> (a `versionRationale` field on the `FEATURES` entry, defaulting to today's
> string so the seven existing rows are byte-identical). **Small, additive, and
> it must not alter any existing row** — `seedRows` is insert-only, so a
> re-run leaves the seven untouched regardless.

### Finding P-1 — `feature_source` is **not** required

`featureRegistry.ts`'s header states that `feature_source` and
`feature_dependency` are deliberately unseeded: *"Neither is knowable until the
calculators exist… Seeding them now would be describing calculations nobody has
written."* All seven existing features are registered without them.

**So `travel_distance` needs neither, and doc 63 §15's open question is closed.**
That the seven now have calculators and still lack `feature_source` rows is a
**pre-existing** gap (LC-42/43), unchanged by this work and **not** created by it.

## 5. Feature-definition contract to register

| Column | Value | Notes |
|---|---|---|
| `feature_key` | **`team.travel_distance`** | satisfies `ck_feature_definition__key_namespaced` |
| `subject_kind_code` | **`TEAM`** | FK `football.subject_kind` |
| `display_name` | *"Travel distance"* | |
| `meaning` | Must state: successive played-fixture venues; 28×86,400,000 ms window; pre-window seed; **no inferred return-home leg**; supersedes V1's away-only model | this is where a reader finds the semantics |
| `unit` | **`km`** | new value; `days` sets the physical-unit precedent |
| `value_scale` | **`0`** | `ck_feature_definition__scale_bounded` admits 0–12; **this is what makes the aggregate round once at the write boundary** |
| `direction` | **`UNSIGNED`** (R-1, recommended) | `ck_feature_definition__direction_known` admits it; unused by all seven today |
| `max_provenance_class_code` | **`DERIVED`** | FK `football.provenance_class`; enforces §10 |
| `meaningful_sample_threshold` | **R-2 — OPEN. Not invented here** | `CHECK >= 0`. **NOT NULL, so registration cannot proceed without a value** |
| `feature_calculator_id` | resolved from `calculator_key` | §3 |
| `is_active` | `true` (column default) | |
| `contextKinds` | **`['ALL_COMPETITIONS']`** | matches all seven; D-3 restricts S-5 to this context |

> **R-2 is non-blocking for writing the calculator and blocking for
> registration**, because `meaningful_sample_threshold` is NOT NULL. The
> calculator, its tests and its review can all be completed first; the seed row
> cannot be inserted until a number is chosen.

### Finding P-3 — recorded, not acted on

`team.travel_impact`'s registered `meaning` already reads *"Accumulated travel
burden from recent away fixtures, **by distance and frequency**"* — which
describes something much closer to the corrected semantics than what
`travelLoad.ts` actually computes (a mean per trip from home, with no frequency
term at all). **The registry's stated intent and the implementation already
disagree.** Recorded as evidence that the implementation drifted from intent.
**`travel_impact` is not modified.**

## 6. Inputs and dependencies

| Input | From | Change needed |
|---|---|---|
| Fixtures per team | `context.fixturesByTeam` | **none** |
| Venue coordinates | `context.venuesById` | **none** |
| `as_of` | `context.subjects[].asOf` | none |
| `homeVenueByTeam` | available and **deliberately unused** | none |
| `is_neutral_venue` | **not needed** | none |
| Prior feature values | **none** — `consumed: []` | none |

**No feature dependencies. No new read. No schema change.**

## 7. Read-layer contract

**Unchanged, and relied upon as-is:**

- `WHERE lifecycle_state_code = 'COMPLETED' AND scheduled_kickoff_at < $2` —
  the reference fixture can never appear;
- `rank_on_side <= 10 OR scheduled_kickoff_at >= as_of − 28 days` — supplies the
  window **and** the seed;
- `ORDER BY team_id, scheduled_kickoff_at DESC, fixture_id DESC` — a total order,
  most recent first;
- `venue_id` is selected and may be `NULL`.

**The calculator must not assume it receives only in-window fixtures** — the rank
branch returns older ones. It filters for itself. (Test **U**.)

## 8. Calculator input/output contract

**In:** `CalculationContext`. **Out:** `readonly CandidateValue[]`.

Per emitted candidate:

| Field | Value |
|---|---|
| `featureKey` | `'team.travel_distance'` |
| `teamId`, `asOf` | from the subject |
| `value` | **unrounded exact** aggregate kilometres |
| `sampleObservationCount` | **measurable leg count** (a number, never null) |
| `consumed` | **`[]`** |

Algorithm, stated as contract rather than code:

1. `before(history.fixtures, asOf)` — strict, already sorted most-recent-first.
2. Partition at `windowStart = asOf.getTime() − 28 × 86_400_000`: in-window is
   `kickoffAt >= windowStart`.
3. Seed = the **most recent fixture strictly before `windowStart`**, if any.
4. Node list = `[seed?] + in-window`, **reversed to chronological**.
5. Legs = consecutive node pairs. A leg is **measurable** iff both nodes have a
   non-null `venueId` present in `venuesById`.
6. Sum measurable legs at full precision; count them.
7. **Zero measurable legs ⇒ emit no candidate.**

## 9. Write-layer behaviour

**Unchanged.** `write/scale.ts` performs the single rounding to `value_scale = 0`
— whole kilometres — so `901.98 → 902`. `write/values.ts` inserts.

## 10. Provenance handling

**Unchanged mechanism.** `write/provenance.ts` applies `min(ceiling, weakest
input)`; with `consumed: []` there is no weakest input, so the ceiling governs:
`max_provenance_class_code = DERIVED` ⇒ every value is **DERIVED (rank 3)**.
The registry enforces the decision; the calculator asserts nothing.

## 11. Observation-count handling

`write/provenance.ts:129-140`: for a candidate with **empty** `consumed`, the
calculator's own `sampleObservationCount` is used directly; the `MIN(consumed)`
path applies only to composites. **So the measurable-leg count passes through
unmodified** — exactly as `fixtureLoad` and `travelLoad` do today.

`sampleMeetsThreshold = sampleObservationCount >= definition.meaningfulSampleThreshold`,
computed by the write layer. **The calculator does not evaluate it** (R-2's
openness therefore does not block the calculator).

## 12. No-value behaviour

**Emit no candidate** — never a zero, never a null value — when: no fixtures; no
in-window fixtures and no seed; a single node and no seed; or **no measurable
leg**. PD-07 and LC-05. The absent row is the statement.

## 13. Missing coordinates

A venue absent from `venuesById` (no coordinates, per `read/venues.ts`) or a
fixture with `venue_id IS NULL` makes **both adjacent legs unmeasurable**. They
are excluded from the sum **and** from the count. **Never converted to 0 km.**
**No home-venue substitution.**

## 14. Duplicate fixtures

**Not defended against here, deliberately.** U-9 owns fixture identity in the
writer (`findFixtureByProviderIdentity`, `AmbiguousFixtureIdentityError`). A
duplicate yields an extra **0 km** leg: distance unchanged, count **+1**. A
second, weaker check here would duplicate a rule that already has an owner. The
exposure is documented and tested (case **M**) so the behaviour is known rather
than discovered.

## 15. Same-venue consecutive fixtures

**A measurable leg of 0 km, counted.** Two matches at one ground means the team
did not travel between them — a measurement, distinct from an absence.

## 16. Neutral venues

**`is_neutral_venue` is never read.** The chain follows `venue_id`, so a neutral
fixture is a node like any other, and a *home* fixture at a neutral ground is
handled correctly without the flag. No read-layer change.

## 17. Pre-window seed

The most recent played fixture strictly before `windowStart`, contributing **its
venue as the first node only**. Its own earlier history is excluded — the window
stays bounded. Availability verified in doc 63 §4: the seed's side-rank is at
most N+1, so it falls outside `rank_on_side <= 10` only above twenty fixtures in
28 days.

## 18. The 28 × 86,400,000 ms boundary

```
windowStart = asOf.getTime() - 28 * 86_400_000
in-window   ⟺  kickoffAt.getTime() >= windowStart     // INCLUSIVE
upper bound ⟸  before() : kickoffAt < asOf            // EXCLUSIVE
```

Epoch-millisecond arithmetic; no timezone, no DST, no calendar days. Identical to
`fixtureLoad.ts:59,167,168`.

## 19. Test files

| File | Action |
|---|---|
| `src/v2/feature/__tests__/feature.test.ts` | **extend** — the calculator's own cases (all 24 below) |
| `src/v2/feature/__tests__/fixtures.ts` | **extend** — seed helpers for multi-venue itineraries with coordinates; today it seeds three venues and two teams |
| `src/v2/seed/__tests__/` | **extend** — `FEATURE_KEYS` / `CALCULATOR_KEYS` counts, and per-feature version rationale (P-2) |

**No new test file is required**; the suite is organised per subsystem, not per
calculator.

## 20. Acceptance criteria

1. **Structural:** `isHome` appears nowhere in the new calculator — asserted on
   source, in the manner of F-2's test 16a.
2. **Structural:** no `new Date()` / `Date.now()` / `now()` — R-2 obligation 6.
3. Window is `asOf − 28 * 86_400_000` with `>=`, and the existing strict
   `before()` above.
4. Seeded from the most recent pre-window fixture; its own history excluded.
5. Legs summed unrounded; the candidate's `value` is unrounded; `value_scale = 0`
   performs the single rounding.
6. An unmeasurable leg is excluded from sum **and** count, **never** 0 km; a
   0 km leg between two known venues **is** counted.
7. No measurable legs ⇒ no candidate.
8. `sampleObservationCount` = measurable legs; `consumed` is `[]`.
9. All 24 cases below pass.
10. Determinism: identical context ⇒ identical candidates in identical order.
11. **`travelLoad.ts` and `team.travel_impact` are unchanged** — asserted, not
    assumed.
12. Haversine parity: the new implementation equals `travelLoad`'s to full double
    precision on a fixed coordinate pair.
13. `tsc` clean; full suite failure set unchanged from baseline; `lint:reads`
    unchanged.

---

## Mandatory test matrix — 24 cases

All provenance **DERIVED**. `H`/`A`/`N` = home/away/neutral; venues in parentheses.

| # | Case | Legs | Distance | Count | Value? |
|---|---|---|---|---|---|
| **A** | H(v1) → A(v2) → H(v1) | v1→v2, v2→v1 | out **and** observed return | **2** | yes |
| **B** | A(v2) → A(v3) | v2→v3 | direct only; **no v2→home→v3** | **1** | yes |
| **C** | A(v2) → H(v1) | v2→v1 | **non-zero** — today's code gives 0 | **1** | yes |
| **D** | H(v1) → H(v1) | v1→v1 | **0 km** | **1** | **yes** |
| **E** | H(v1) → N(v4) | v1→v4 | normal | **1** | yes |
| **F** | A(v2) → N(v4) | v2→v4 | normal | **1** | yes |
| **G** | N(v4) → A(v2) | v4→v2 | normal | **1** | yes |
| **H** | A(v2) → A(v2) | v2→v2 | **0 km** | **1** | yes |
| **I** | 5 fixtures in 10 days | 4 (+seed leg) | **high** sum | 4–5 | yes |
| **J** | 5 fixtures over 5 months | seed leg only | **low** sum; **I ≠ J** | **1** | yes |
| **K** | 900 km + several short | all | sum **≫** any single leg | = legs | yes |
| **L** | One venue has no coordinates | adjacent legs **excluded** | never 0 km | measurable only | conditional |
| **M** | Duplicate fixture | +1 spurious **0 km** | unchanged | **+1** | yes |
| **N** | Exactly 28×86,400,000 ms apart | 1 | **inclusive** at the bound | **1** | yes |
| **O** | Fixture immediately before the window | seeds the first leg | contributes venue only | as counted | yes |
| **P** | Upcoming **home** fixture after away travel | all in-window | **non-zero at a home fixture**; reference fixture excluded twice over | = legs | yes |
| **Q** | Two measurable legs, one 0 km | 2 | sum = the non-zero one | **2** | yes |
| **R** | One in-window fixture **with** a seed | 1 | seed→fixture | **1** | yes |
| **S** | One in-window fixture, **no** seed | **0** | — | 0 | **NO VALUE** |
| **T** | Fixtures exist, **no measurable leg** | 0 | — | 0 | **NO VALUE** — not 0 km |
| **U** | Context includes out-of-window fixtures | in-window + seed only | older ones excluded | as counted | yes |
| **V** | Context arrives unsorted | identical to sorted | order-independent | identical | yes |
| **W** | Distinct fixtures, **same venue id** | legs of 0 km | 0 km each | counted | yes |
| **X** | Write-boundary rounding | — | `412.63+187.44+301.91 = 901.98` → **stored `902`**; calculator returns `901.98` | — | yes |

**Cases the current implementation fails: C, I-vs-J, K, P.**
**Cases a naive new implementation would fail: D, H, S, T, U, V, X.**

---

## STATUS

- **S-0-a-ii:** **APPROVED and LOCKED** (`a99cdfc`)
- **Implementation plan:** **COMPLETE — awaiting review**
- **New feature:** `team.travel_distance` — TEAM, `km`, `value_scale 0`,
  `max_provenance DERIVED`, context `ALL_COMPETITIONS`
- **New calculator:** **YES** — one row (e.g. `travel_itinerary`) + one module +
  one pipeline registration
- **Existing calculator affected:** **NONE.** `travelLoad.ts` untouched;
  haversine reproduced with a parity test rather than imported
- **Existing read layer affected:** **NONE** — window, seed and coordinate
  filtering are all already provided
- **Existing write layer affected:** **NONE** — rounding, provenance,
  observation count and threshold evaluation all work unmodified
- **Migration required:** **NO** — every registry column already exists
- **S-3 seed required:** **YES** — one `CALCULATORS` row and one `FEATURES`
  entry, driving four relations. **Plus finding P-2: `featureRegistry.ts` needs a
  per-feature version rationale**, because the shared one asserts a V1
  carry-across that is false for this feature
- **Feature dependency required:** **NO** — `consumed: []`, and
  `feature_dependency` remains deliberately unseeded
- **Feature value generation:** **NOT NOW.** S-5 not run
- **R-1 `direction`:** **UNSIGNED recommended**, awaiting confirmation
- **R-2 `meaningful_sample_threshold`:** **OPEN.** Non-blocking for the
  calculator and its tests; **blocking for registration**, since the column is
  NOT NULL
- **Tests required:** 24 cases, plus two structural assertions (`isHome` absent,
  no clock), a haversine parity test, and an unchanged-`travel_impact` assertion
- **Implementation permitted after review:** **NOT YET** — permitted once this
  plan is approved and **R-1** is confirmed; **R-2 may follow later**, before the
  seed row is inserted

---

**Nothing implemented. No source edited, no migration, `mv_module_travel` not
recreated, `travelLoad.ts` and `travel_impact` untouched, no burden, no fatigue,
no decay, no inferred return-home leg, no invented threshold, no
`feature_dependency` or `feature_value` rows, S-5 not run.**
