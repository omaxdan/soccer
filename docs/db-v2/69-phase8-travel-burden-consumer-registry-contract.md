# Phase 8 — `team.travel_burden` Consumer + Registry Contract Gate

## Final architecture decision · nothing implemented

| | |
|---|---|
| Prior gates | `travel_distance` `127da55` · verification `7f6e9a4` · architecture `ad73dae` · definition `32a0e33` · modelling `ca0bee5` |
| **First consumer** | **NONE YET** — the eventual home is a Layer-3 **Travel module** (gated on S-6), not `readiness_score` directly |
| **Implementation authorized** | **NO — NO CONSUMER, DO NOT IMPLEMENT** |
| **Registry contract** | fully specified below, ready to seed when a consumer exists |
| **Migration required** | **NONE** — registry rows + governed edges, exactly as `travel_distance` |

Nothing implemented. No registry seed, calculator, `feature_dependency`,
`feature_value`, migration, readiness/DEC-2 change, or edit to `travel_distance` /
`travel_impact` / `travelLoad.ts`. No `travel_recency`, no λ coefficient, no band.

---

## 1. Current consumers

The preparedness graph is two edges, both into the only composite:

```
team.readiness_score ← team.rest_advantage
                     ← team.congestion_index
```

`feature_dependency` holds exactly these two rows. Travel is absent. Nothing
consumes `travel_distance` or `travel_impact`. Above the feature layer, a **module**
(Layer 3, E3.03) reads `feature_value` through `module_evidence_item` and emits a
reading with `strength`, `confidence`, `module_status_code`, `verdict_text`, gated
by a `published_baseline` + `sample_gate`. No travel module is specified (S-6 is
blocked on S-0).

## 2. Proposed first consumer

**Option F — no consumer yet — with the eventual home identified as a Layer-3
Travel module (Option C), not `readiness_score` directly (A).**

The decisive fact from the modelling gate: with `λ = 0`, **`travel_burden`
carries no numerical information `travel_distance` does not already carry.** A
materialised `travel_burden` feature_value would be a byte-for-byte duplicate of
`travel_distance`'s value, with duplicate lineage, for zero added information —
exactly the "do not implement merely for completeness" the brief forbids.

The eventual consumer, when one exists, should be a **Travel module** because the
module layer supplies precisely what a raw measurement lacks and what travel
interpretation needs: an oriented `strength`, a `confidence`, an evidence set with
completeness counts, a calibratable `published_baseline`, and a `verdict_text` for
the Match Report. `readiness_score` is a bare weighted mean with none of that, and
doc 34 §11 already ruled preparedness is "three signals, three readings, each with
its own evidence," not one combined number — which points at a module reading, not
a fourth readiness term.

## 3. Consumer semantic question

The three questions belong at three layers, and must not be collapsed:

| Question | Layer |
|---|---|
| "how many measurable km / journeys did the team accumulate?" | **feature** — `travel_distance` (measurement) |
| "how burdensome is that travel, oriented and interpreted?" | **feature (Layer 2)** — `travel_burden` (characterisation) |
| "does recent travel materially reduce this team's preparedness, with what confidence and evidence?" | **module (Layer 3)** — a Travel module reading |
| "relative travel burden between the two sides in this fixture" | **report/synthesis** — a fixture-level comparison of two module readings |

`travel_burden` answers the second. The consumer that *needs* it is the third —
and it does not exist yet.

## 4. Feature vs module vs readiness placement

**feature → module → readiness/report**, not feature → readiness directly.

The V2 architecture supports this and rewards it: a module reading carries
evidence, confidence, sample-gating and calibration that a readiness weighted-mean
cannot. Reviving V1's "Travel Impact = 15%" as a direct readiness component would
(a) assert a weight with no evidence (the modelling gate showed λ itself is
unidentifiable, let alone a readiness weight), and (b) bypass the evidence/
calibration machinery that makes a travel claim explainable and verifiable. The
V1 weight is **not authoritative** and is not carried.

## 5. Double-counting analysis

The architecture from `ad73dae`/`32a0e33` remains correct and is re-affirmed:

```
travel_burden ← travel_distance            (travel only; + travel_recency later)

readiness/module ← rest_advantage          (recovery, once)
                 ← congestion_index         (workload, once)
                 ← travel_burden            (travel,   once)
```

`travel_burden` must consume **travel-only** inputs — never `rest_advantage` or
`congestion_index` — so recovery and workload enter the consumer exactly once.
This is a legal DAG (no cycle: all inputs are Layer-1 with `consumed: []`) **and**
free of semantic double-counting (the diamond that would double-count is the one
where `travel_burden` also consumes rest/congestion — explicitly excluded). No
change to this architecture is needed.

## 6. NO VALUE handling

Locked, end to end (LC-05, PD-07):

| input | `travel_burden` | consumer |
|---|---|---|
| `travel_distance` absent | **no row** | treats as a missing input — renormalise over present inputs, or (all absent) no reading |
| `travel_distance = 0 km`, count ≥ 1 | **a row, value 0 at the floor** | a real minimum-burden observation, distinguishable from absence |

Absence is never converted to zero, and a measured 0 km stays a row.

## 7. Provenance

`travel_distance` = DERIVED rank 3 → `travel_burden` = **DERIVED rank 3** under
`min(ceiling, weakest input)`. No INFERRED input is introduced; λ is a parameter,
not a data input, so it does not lower provenance.

## 8. Registry contract (specified, NOT seeded)

Using the real relations (`feature.feature_definition`, `feature_version`,
`feature_definition_context_kind`, `feature_source`, `feature_dependency`,
`feature_calculator`) and existing conventions:

| Slot | Value | Basis |
|---|---|---|
| `feature_key` | `team.travel_burden` | passes `ck_feature_definition__key_namespaced` |
| layer | 2 (composite; consumes a feature) | it reads `travel_distance` |
| `subject_kind_code` | `TEAM` | as all travel features |
| `display_name` | `Travel burden` | |
| `meaning` | "Oriented characterisation of recent travel exposure: `distance + λ·(legs−1)` over `travel_distance`'s 28-day window, `λ = 0` at v1.0.0 (fragmentation defined, not yet weighted — unidentifiable from current data). Higher = more burden. Consumes travel only; recovery and workload are combined by the consumer, not here." | doc 67/68 |
| `unit` | **`km`** for v1.0.0 (see §9) | free-text column; numerically km while λ=0 |
| `value_scale` | `0` | whole km, matching `travel_distance`; the calculator returns unrounded, write boundary rounds once |
| `direction` | `LOWER_IS_STRONGER` | §10 |
| `feature_calculator_id` | new `feature_calculator` `travel_burden` | S-3 registry row, not DDL |
| `max_provenance_class_code` | `DERIVED` | §7 |
| `meaningful_sample_threshold` | `1` | one measurable leg is one observation, mirroring `travel_distance`; MIN(consumed) = leg count |
| `is_active` | `true` on creation | |
| context kind | `ALL_COMPETITIONS` | via `feature_definition_context_kind`, as every current feature |
| `feature_source` | **none** | a composite declares dependencies, not football sources |
| `feature_dependency` | `team.travel_burden ← team.travel_distance` | one edge, keyed on the consumer version |
| `feature_version.designation` | `1.0.0` | |
| `feature_version.rationale` | "Initial registration. Additive-separable burden `distance + λ·(legs−1)`; `φ = identity`, `ψ = legs−1`, `λ = 0` — the fragmentation weight is unidentifiable from the current one-season universe (doc 68 §4) and is deferred to calibration, not invented. Numerically equals `travel_distance` at v1.0.0 while adding orientation and the governed λ slot." | |

## 9. Unit validation

`feature_definition.unit` is **free text** (`text NOT NULL`, no vocabulary table,
no CHECK) — `travel_distance` uses `km`, indices use `index`, rest uses `days`,
stability uses `ratio`. So `km-equivalent` **would be permitted without a
vocabulary extension**, but it is **not yet accurate**: at `λ = 0` every unit is a
real kilometre. **Recommendation: `unit = km` for v1.0.0**, and revisit to
`km-equivalent` only when `λ > 0` first mixes a non-km fragmentation term into the
value. Choosing `km-equivalent` now would advertise a composition the value does
not yet contain. No vocabulary change is required either way.

## 10. Direction validation

`LOWER_IS_STRONGER` is correct: less travel burden = better preparedness. Note the
deliberate contrast with `travel_distance`, which is `UNSIGNED` — a measurement
takes no stance on better/worse; `travel_burden` is the layer that *does*. This
orientation is a genuine Layer-2 addition even at λ=0. Orientation happens **at the
consumer**, exactly as readiness already orients its inputs
(`100 − congestion_index`, `clamp(rest/7,0,1)×100`) — the stored `travel_burden`
value stays the raw magnitude; the consumer inverts/normalises it. (That
orientation-at-read is also why a materialised `travel_burden` adds little over
`travel_distance` while λ=0 — see §12.)

## 11. λ future storage / validation location

**λ has no typed home in the schema, and this is a real finding.**
`feature_version` carries only `designation`, `effective_period`, `predecessor_id`,
`rationale` — no numeric-parameter column. There is no feature-level parameter
table. Consequences:

- **Where λ lives:** in the **calculator implementation for a given
  `feature_version`.** Changing λ is a rule change → a **new `feature_version`**
  (new `designation`, `rationale` records the value), the same governed path DEC-1
  established. It is not a data-driven knob.
- **S-9's role:** `calibration` validates **module bands → outcome rates**
  (`calibration_series` keyed by `module_version_id, band_code, …`;
  `calibration_result` records `hit_rate / baseline_rate / lift` under a
  `sample_gate`). It can validate λ **indirectly** — does a travel band computed
  with `λ > 0` discriminate outcomes better than `λ = 0`? — but it **cannot fit**
  λ; there is no regression mechanism in the schema. Fitting λ would need a future
  modelling mechanism that does not exist today.
- **Module configuration** is not a home for λ either — modules read feature
  values, they do not parameterise feature calculators.

So the honest position: λ moves from 0 only via a new `travel_burden`
`feature_version`, justified by evidence, with S-9 able to check the result but not
to derive the coefficient.

## 12. Cross-league normalization location

**Not at the feature layer.** `travel_burden` stays a raw physical quantity
(globally physical, calibration-ready). League/competition relativisation belongs
**downstream at the module/calibration layer**, where `calibration_series` and
`published_baseline` are already keyed by `context_competition_id` /
`context_kind_code` — the schema is built to hold per-competition baselines. This
matches the existing convention (raw features; orientation and context applied by
the consumer). No normalization is implemented here.

## 13. Whether implementation should happen now

**No.** Weighing the Step-12 factors:

| Factor | Verdict |
|---|---|
| explainability | a λ=0 `travel_burden` explains nothing `travel_distance` does not |
| provenance / lineage | duplicate DERIVED rows + duplicate lineage, no new evidence |
| future λ calibration | needs a *consumer and a module band*, not a materialised duplicate feature |
| redundant feature values | **materialising it now creates exactly the redundant values the brief warns against** |
| architecture stability | the contract is fixed here; seeding it later costs nothing (no migration) |
| S-5 readiness | S-5 can add the calculator in one step whenever a consumer appears |
| historical evidence | none of it requires the feature to exist before a consumer does |

The Layer-2 *boundary* is valuable as a **decided contract**; the Layer-2 *feature
value* is not valuable until something reads it. Fix the contract (done); defer the
rows.

## 14. Exact dependency graph

Proposed, for the gate that follows a real consumer — **not declared now:**

```
when a Travel module (or a new readiness version) needs it:
  team.travel_burden ← team.travel_distance          (one edge, λ=0)

later, if recency is adopted (separate gate):
  team.travel_burden ← team.travel_distance
                     ← team.travel_recency

Layer 3, when specified under S-6:
  module "Travel" reading  ─cites→ feature_value(team.travel_burden)
```

`travel_impact` appears nowhere; it stays untouched and separate (doc 63 §11), a
later `is_active = false` its only foreseeable change, decided elsewhere.

## 15. Migration requirement

**None.** Every slot in §8 is a registry row (`feature_definition`,
`feature_version`, `feature_definition_context_kind`, `feature_calculator`) or a
governed insert (`feature_source` — here none; `feature_dependency` — one edge).
`unit` is free text, so no vocabulary DDL. This is exactly the `travel_distance`
path, which required no migration. (Migration 023, authorised earlier, is an
unrelated S-6 `module_version`/`module_reading` concern.)

## 16. Remaining unresolved questions

- The **first real consumer**: a Travel module under S-6 (blocked on S-0), or a
  future `readiness_score` version — whichever is specified first.
- **λ**: its value (calibration), and the absence of any schema mechanism to
  *fit* it (§11).
- **`travel_recency`**: its own definition gate (doc 67 §6) before recency enters
  burden.
- **cross-league relativisation**: the downstream transform's exact form (§12).
- **`travel_impact` disposition**: eventual `is_active = false`, separate decision.
- **`unit` revisit** to `km-equivalent` if/when λ > 0 (§9).

## 17. Next gate

**A consumer-specification gate**, not an implementation gate: specify the
Layer-3 Travel module (its semantic role, evidence inputs, status/verdict
semantics, and whether it reads `travel_burden` or, while λ=0, `travel_distance`
directly) under S-6 — which itself waits on S-0. Only once a consumer concretely
declares `… ← team.travel_burden` and the Layer-2 signal carries information the
Layer-1 measurement does not (λ > 0, or recency joined, or a module needing the
oriented signal with its own confidence) does `travel_burden` implementation
become authorised.

---

## STATUS

- **travel_distance:** unchanged, locked, verified (`127da55` / `7f6e9a4`)
- **travel_burden definition:** distance + frequency, travel-only inputs (doc 67)
- **travel_burden model:** additive-separable `distance + λ·(legs−1)`, `λ = 0` at v1.0.0 (doc 68)
- **λ:** lives in the calculator per `feature_version` (no typed parameter slot exists); changed only via a new version; S-9 can validate it via module bands but cannot fit it
- **First consumer:** **NONE YET** — eventual home is a Layer-3 Travel module (S-6-blocked), not readiness directly
- **Consumer layer:** module (Layer 3), with feature → module → readiness/report placement
- **Registry contract:** specified in full (§8), ready to seed; not seeded
- **Unit:** `km` for v1.0.0 (free-text column; `km-equivalent` permitted but premature while λ=0)
- **Direction:** `LOWER_IS_STRONGER`, oriented at the consumer (contrast with `travel_distance` UNSIGNED)
- **Provenance:** DERIVED rank 3; no INFERRED input
- **NO VALUE:** absent `travel_distance` → no `travel_burden` row; measured 0 km → row at the floor
- **Double-counting:** avoided by construction — travel-only inputs; rest/congestion enter the consumer once
- **Cross-league normalization:** downstream at the module/calibration layer (keyed by competition), never in the feature
- **Implementation authorized:** **NO — NO CONSUMER, DO NOT IMPLEMENT**
- **Migration required:** NONE
- **Next gate:** consumer-specification gate — the Layer-3 Travel module under S-6 (blocked on S-0); implementation authorised only when a consumer declares `← team.travel_burden` and the Layer-2 signal adds information over Layer 1
