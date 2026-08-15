# Phase 8 — `team.travel_burden` Definition Gate

## Definition decision · nothing implemented

| | |
|---|---|
| Commits | `travel_distance` `127da55` · verification `7f6e9a4` · integration design `ad73dae` |
| **Recommended definition** | **C-2 — distance + frequency, from travel-only inputs; recency deferred to a dedicated feature** |
| **New Layer-1 feature required** | **NOT for v1.0.0** (distance + frequency are both already carried by `travel_distance`). **YES eventually** if recency is wanted — a new `team.travel_recency`, specified in §6 but not built |
| **Implementation authorized** | **NO** — the numeric combination is a modelling gate (§17) |
| **Double-counting** | **avoided by construction** — `travel_burden` consumes travel-only inputs; recovery and workload enter preparedness once, at the composite (§4) |

Nothing was implemented. No registry entry, calculator, `feature_dependency`,
`feature_value`, migration, readiness change, DEC-2 change, or edit to
`travel_distance` / `travel_impact` / `travelLoad.ts`. No fatigue formula, no
distance band, no coefficient, no decay function.

---

## 1. Existing relevant inputs

The complete Layer-1 inventory (eight registered features; `recency`, `decay`,
and per-leg timing confirmed absent everywhere in `src/v2`):

| Feature | Layer | Carries travel? | Carries recency? |
|---|---|---|---|
| `team.travel_distance` | 1 | **yes** — the measurement | no (28-day aggregate) |
| `team.travel_impact` | 1 | yes (mean km/trip from home) | no |
| `team.rest_advantage` | 1 | **no** | partial — days since last *fixture* |
| `team.congestion_index` | 1 | no | no (28-day count) |
| `team.home_form` / `away_form` | 1 | no | no |
| `team.readiness_score` | 2 | no | no |
| `team.squad_stability` | 1 | registered, never calculated (R-1) | — |

Match-proximity to kickoff exists, but only in the driver: `as_of = K − offset`
for snapshot points `T_MINUS_7D / 3D / 1D / KICKOFF`. That shifts the *whole*
28-day window toward kickoff; it does **not** say when *within* the window the
travel happened.

## 2. Their exact semantics

| Input | Semantics | Provenance | Obs count | Already incorporates |
|---|---|---|---|---|
| `travel_distance.value` | sum of observed venue-to-venue legs over 28 d, seeded | DERIVED 3 | — | nothing (`consumed: []`) |
| `travel_distance.sample_observation_count` | number of **measurable legs** (incl. a 0 km leg between two known venues; excl. an unlocatable one) | — | is the count | nothing |
| `rest_advantage.value` | **days since the most recent completed fixture** (DEC-3, D-2) | OBSERVED 4 | 1 | nothing — but see §4 |
| `congestion_index.value` | 28-day completed-fixture count ÷ 2, V1 bands, `LOWER_IS_STRONGER` | DERIVED 3 | window count | nothing |

Crucially, **names do not imply semantics**: `rest_advantage` is *recovery since
the last match*, not *travel recency* (§6). `travel_impact` is a *home-radial mean
per trip*, not a total (§15).

## 3. Circularity audit

`travel_distance`, `rest_advantage`, `congestion_index` are all Layer 1 with
`consumed: []`. Any `travel_burden` built on them is a DAG — none has an outbound
feature edge, so no back-edge can form. `registry/order.ts`
(`DependencyCycleError`, LC-44) rejects cycles at declaration regardless. **No
cycle is possible along any input set considered here.** The only construction
that would create one — rest or congestion consuming a travel feature — does not
exist and is not proposed.

## 4. Double-counting audit — the decisive constraint

Legal DAGs can still double-count. Three cases, kept distinct:

- **(A) Cycle** — impossible (§3).
- **(B) Diamond** — legal. e.g. `readiness → {congestion, travel_burden}` and
  `travel_burden → congestion`. Acyclic, but…
- **(C) Semantic double-counting** — the real hazard. If `travel_burden` consumes
  `rest_advantage` and/or `congestion_index`, and a future `readiness` consumes
  `travel_burden` **alongside** `rest_advantage` / `congestion_index` directly,
  then recovery and workload each enter readiness through **two paths** and are
  counted twice.

**Resolution — a design rule, not a weighting patch:** `travel_burden` consumes
**travel-only inputs**. Recovery (`rest_advantage`) and workload
(`congestion_index`) are **not** inputs to `travel_burden`. They combine with
`travel_burden` at the **readiness composite**, where each concept enters exactly
once:

```
readiness_score(future) ← rest_advantage      (recovery, once)
                        ← congestion_index     (workload, once)
                        ← travel_burden         (travel,   once)
                              └── travel_distance  (+ travel_recency, if built)
```

This removes double-counting **by construction** rather than by tuning
coefficients later, which is why it is preferred over any burden model that folds
rest or congestion inside itself.

## 5. Observation-count decision

`900 km / 1 leg`, `/2`, `/5` are genuinely different exposures, and the count is
**required** — but **not** as "more legs ⇒ proportionally more burden." Two facts
matter and the architecture already carries both:

- **total distance** — `travel_distance.value`;
- **leg count** — `travel_distance.sample_observation_count`.

**Decision: `travel_burden` consumes both the value and the observation count of
`travel_distance`.** No new Layer-1 feature is needed for frequency — it is
already the verified observation count (doc 65 §7). Whether burden emphasises
km-per-leg (one long haul) or leg-frequency (many hops) is a **modelling choice
for §17**, not invented here; both raw quantities reach the calculator so either
can be expressed without changing `travel_distance`.

Under DEC-5, `travel_burden.sample_observation_count = MIN(consumed counts)`. With
`travel_distance` as the only counted input, that is the leg count itself — which
is the honest evidence volume for a travel characterisation.

## 6. Recency decision — the hardest question

Compare `3 000 km yesterday` vs `7 days ago` vs `27 days ago`. Three findings:

1. **`rest_advantage` is NOT travel recency and must not be substituted for it.**
   It measures days since the last *fixture*, regardless of whether that fixture
   involved travel or whether its venue is locatable. It is, at best, case (2)
   *partial*: it tells you the last match was yesterday, but nothing about *how
   far* the most recent leg was. `3 000 km with last fixture yesterday` and
   `200 km with last fixture yesterday` share `rest_advantage = 1`. Using it
   inside `travel_burden` would be case (3) *incorrectly substituting recovery
   for travel recency*, and — because readiness also consumes `rest_advantage`
   directly — case (4) *double-counting* (§4). **Excluded.**
2. **`travel_distance` cannot expose recency** and must not be made to: it is a
   locked 28-day aggregate, and per-leg timestamps are deliberately not exposed
   (doc 62). Forcing recency into it is prohibited.
3. **True recency therefore needs a dedicated representation.** The minimum
   semantic question a `team.travel_recency` feature would answer is *"how
   recently, and how far, did the team's most recent measurable leg occur"* — a
   distance-tagged recency, not a bare day count, because bare recency repeats
   `rest_advantage`'s blind spot.

**Decision: recency is OUT of `travel_burden` v1.0.0.** v1.0.0 is explicitly
**recency-blind** and its meaning must say so. A recency-sensitive burden is a
**future gate** requiring a new Layer-1 `team.travel_recency` (sources
`fixture`, `venue` — same as `travel_distance`; DERIVED, so no provenance cap;
per-leg vs summary to be decided in its own spec). It is **specified, not built.**
This obeys Step 5: do not force an aggregate to capture what it cannot.

## 7. Per-leg vs aggregate decision

| Option | Captures | Loses | New Layer-1? |
|---|---|---|---|
| A aggregate distance | total | frequency, recency | no |
| **B aggregate distance + leg count** | total + frequency | recency | **no** |
| C per-leg distance + timing | everything | — | **yes (large)** |
| D aggregate + most-recent-leg timing | total + partial recency | distribution of older legs | yes (small) |

`3 000 km yesterday` (Team A) vs `1 000 km × 3, 9 days apart` (Team B): an
aggregate **cannot** distinguish these on recency, and it should not pretend to.

**Decision: B for v1.0.0** (distance + frequency, no new feature), with C/D
reserved for the recency gate (§6). The aggregate's recency-blindness is a stated
limitation, not a defect papered over.

## 8. Window decision

`travel_distance` uses `28 × 86 400 000 ms` with a pre-window seed. **Decision:
`travel_burden` v1.0.0 inherits that window transitively** — it consumes
`travel_distance`, so it inherits the window `travel_distance` already applied;
it does **not** re-window and does **not** apply decay. No decay function is
invented (Step 6). If the future recency feature needs a shorter or nested
window, that window is specified with **that** feature, not retrofitted here.

## 9. NO VALUE policy

`NO VALUE ≠ zero burden` (LC-05, PD-07) must survive downstream:

| Condition | `travel_burden` |
|---|---|
| no `travel_distance` row (unmeasurable itinerary) | **no `travel_burden` row** |
| `travel_distance = 0 km`, count ≥ 1 (measured no-travel) | **a value** — 0 km travelled is a measurement, low burden is legitimate here |
| partial inputs | with travel-only inputs and `travel_distance` as the sole required input, "partial" does not arise for v1.0.0; if the recency feature is later added, apply the existing `teamReadiness` renormalise-or-suppress convention |

The distinction between "did not travel" (0 km, a value) and "travel
unmeasurable" (no row) is inherited directly from `travel_distance` and must not
be flattened.

## 10. Provenance decision

`min(ceiling, weakest input)`. Inputs for v1.0.0: `travel_distance` = DERIVED 3.
**`travel_burden` ceiling = DERIVED (rank 3); resolved = DERIVED 3.** A future
`travel_recency`, if DERIVED, preserves rank 3. **No INFERRED input is introduced
to enrich the model** — an INFERRED recency input would cap `travel_burden` (and
everything downstream) at rank 2, which is not worth a modelling nicety and is
explicitly refused.

## 11. Candidate definitions

### C-1 — Aggregate-only burden
- **Q:** how much did the team travel recently? **Inputs:** `travel_distance`
  only. **Captures:** total. **Cannot:** frequency, recency. **Obs:** leg count
  via MIN. **Recency:** none. **NO VALUE:** inherit. **Provenance:** DERIVED 3.
  **Circularity/double-count:** none. **Complexity:** trivial. **New L1:** no.
- **Weakness:** essentially `travel_distance` with a direction — risks being the
  forbidden `distance/constant` unless calibrated. Adds little.

### C-2 — Distance + frequency (RECOMMENDED)
- **Q:** how burdensome was the recent itinerary by distance **and** number of
  journeys? **Inputs:** `travel_distance.value` + its leg count. **Captures:**
  total + frequency (A vs B: 900/1 vs 900/5). **Cannot:** recency (stated).
  **Obs:** leg count. **Recency:** none — deferred. **NO VALUE:** inherit.
  **Provenance:** DERIVED 3. **Circularity/double-count:** none — travel-only.
  **Complexity:** low, no new feature. **New L1:** no.

### C-3 — Distance + frequency + recency
- **Q:** C-2 plus *when*. **Inputs:** C-2 + a new `team.travel_recency`.
  **Captures:** all three. **Cannot:** —. **Obs:** MIN across inputs.
  **Recency:** full. **NO VALUE:** renormalise/suppress per convention.
  **Provenance:** DERIVED 3 iff recency is DERIVED. **Circularity:** none.
  **Double-count:** none (travel-only). **Complexity:** high — needs a new,
  separately specified Layer-1 feature. **New L1:** **yes.**

### C-4 — Composite folding rest/congestion into burden
- **Q:** a travel-adjusted recovery score. **Inputs:** `travel_distance` +
  `rest_advantage` + `congestion_index`. **Captures:** travel + recovery +
  workload in one number. **Cannot:** be combined again in readiness without
  double-counting. **Double-count:** **HIGH** (§4). **REJECTED** — it is exactly
  the construction §4 exists to prevent.

## 12. Recommended definition

**C-2**, and after it, C-3 through a dedicated recency gate.

Ranked against the required priorities:
1. **semantic correctness** — distance + frequency is honestly what an aggregate
   can support; recency is not faked;
2. **non-circular** — travel-only, Layer-1 inputs;
3. **explainability** — "distance travelled and how many journeys" is
   one-sentence explainable;
4. **provenance** — DERIVED 3, no INFERRED contamination;
5. **preserves `travel_distance`** — consumes it unchanged, adds no window/decay;
6. **no double-counting** — recovery/workload enter readiness once (§4);
7. **validatable** — both inputs are empirically verified (doc 65);
8. **calibration-ready** — a clean travel-only signal is what S-9 can later
   calibrate against outcomes.

C-1 is too thin; C-4 double-counts; C-3 is the right *destination* but requires a
feature that must be specified on its own before it can be trusted. C-2 is the
strongest thing buildable now **without inventing a coefficient**, which is why
its *numeric* combination is still deferred to §17 rather than fixed here.

## 13. Eventual registry contract (specified, NOT seeded)

`team.travel_burden`:

| Slot | Proposed | Note |
|---|---|---|
| layer | 2 (composite; consumes `travel_distance`) | first travel-layer composite |
| subject_kind | TEAM | |
| unit | `index` | a characterisation, not km |
| value_scale | 2 | matches other indices (DEC-4) |
| direction | `LOWER_IS_STRONGER` | more burden = worse; **to confirm at §17** |
| max_provenance | DERIVED | §10 |
| meaningful_sample_threshold | **TBD at §17** | tied to how leg count is used |
| sources | none (composite) | inputs are `feature_dependency`, not `feature_source` |
| context kind | `ALL_COMPETITIONS` | as all current features |
| continuous vs banded | **continuous preferred** | bands would re-import the disowned V1 table (doc 60 §6) |
| cross-team comparable | yes, if continuous and unit-consistent | |
| version rationale | "characterisation of recent travel exposure by distance and frequency; recency-blind by decision; supersedes nothing" | |

`unit`, `direction`, `threshold`, and the combination rule are the §17 gate.

## 14. Eventual dependency graph (proposed, NOT declared)

```
v1.0.0:
  team.travel_burden ← team.travel_distance          (value + obs count)

future recency gate:
  team.travel_recency ← football.fixture, football.venue   (NEW Layer-1)
  team.travel_burden  ← team.travel_distance
                      ← team.travel_recency

future preparedness gate (new readiness feature_version):
  team.readiness_score(vN) ← team.rest_advantage
                           ← team.congestion_index
                           ← team.travel_burden
```

`travel_impact` appears nowhere.

## 15. Relationship to `travel_impact`

**Leave permanently separate for now (A); eventual supersession (C) is a distinct
decision.** `travel_impact` is a home-radial mean-per-trip over 5 away fixtures;
`travel_burden` is a characterisation of the corrected venue-to-venue itinerary.
They answer different questions and `travel_burden` is not built from
`travel_impact`. If, once `travel_burden` is live and calibrated, `travel_impact`
is judged redundant, it is retired by `is_active = false` (never a rename of a
governed key) — a separate governed step, not this gate. **No change now.**

## 16. Relationship to DEC-2

**Unchanged.** DEC-2 is the frozen rule for `readiness_score` 1.0.0 (rest 50 /
congestion 50). Introducing `travel_burden` into readiness is a **new
`feature_version`**, decided at a future gate. **Do not** reuse V1's 15% travel
weight — V1 assigned it without evidence, and DEC-2's own logic ("no evidence
supports asymmetry") applies equally to a travel weight. The weight is a
calibration/governance decision, not an inheritance.

## 17. What requires a future gate

1. **The combination rule** — how `travel_distance.value` and its leg count fold
   into one `travel_burden` number (km-per-leg vs frequency emphasis), **without
   an invented coefficient**; ideally shaped by S-9 calibration against outcomes.
2. **`unit` / `direction` / `meaningful_sample_threshold`** confirmation (§13).
3. **The recency feature** `team.travel_recency` — its own definition gate
   (semantic question, window, per-leg vs summary, provenance) before C-3.
4. **Readiness integration** — a new `readiness_score` version and its weight
   (§16), plus the Layer-3 module surface (S-6-blocked).
5. **`travel_impact` disposition** (§15).

## 18. What must NOT be implemented yet

Everything. No registry seed, calculator, `feature_dependency`, `feature_value`,
migration, readiness change, DEC-2 change, or edit to `travel_distance` /
`travel_impact` / `travelLoad.ts`. No combination coefficient, no distance band,
no decay function, no recency feature. This gate fixes the **contract and input
set**; the numbers are the next gate.

---

## STATUS

- **travel_distance:** unchanged, locked (`127da55`, verified `7f6e9a4`)
- **travel_burden location:** Layer-2 composite, consuming travel-only inputs
- **Definition:** C-2 — characterisation of recent travel by **distance + frequency**; recency-blind in v1.0.0 by decision
- **Observation count:** REQUIRED — consume both `travel_distance.value` and its leg count; no new feature needed for frequency
- **Recency:** OUT of v1.0.0 — `rest_advantage` is recovery, not travel recency, and would double-count; true recency needs a new `team.travel_recency` (specified, not built)
- **Per-leg vs aggregate:** aggregate (distance + count) for v1.0.0; per-leg reserved for the recency gate
- **Window:** inherit `travel_distance`'s 28-day window transitively; no re-windowing, no decay
- **NO VALUE:** no `travel_burden` row when `travel_distance` is absent; 0 km (measured) remains a value; never flatten absence to zero (LC-05, PD-07)
- **Provenance:** DERIVED (rank 3); no upgrade; no INFERRED input introduced
- **Circularity:** none, and structurally impossible — all inputs Layer-1, consume no feature
- **Double-counting:** avoided by construction — travel-only inputs; recovery and workload enter readiness once, at the composite
- **travel_impact:** untouched; permanently separate for now; eventual `is_active = false` is a separate decision
- **DEC-2:** unchanged; travel enters readiness only via a future `feature_version`, no inherited 15% weight
- **New Layer-1 feature required:** NO for v1.0.0; YES (a `travel_recency`) only if/when recency is adopted
- **Recommended architecture:** `travel_burden ← travel_distance (distance + frequency)`, travel-only, DERIVED, continuous, recency deferred
- **Implementation authorized:** NO
- **Next gate:** the travel_burden **combination-rule** modelling decision (and, separately, the `travel_recency` definition gate) before any registry entry or `feature_dependency` row
