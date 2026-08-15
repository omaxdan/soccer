# Phase 8 — `team.travel_burden` Combination-Rule Modelling Gate

## Quantitative modelling decision · nothing implemented

| | |
|---|---|
| Prior gates | `travel_distance` `127da55` · verification `7f6e9a4` · architecture `ad73dae` · definition `32a0e33` |
| **Preferred model family** | **additive-separable**: `burden = φ(distance) + λ · ψ(legs)` |
| **Coefficients fixable now** | `φ = identity` (linear), `ψ = legs − 1`, `λ` **structurally ≥ 0** |
| **Coefficient requiring calibration** | **`λ` (the fragmentation weight)** — and this dataset **cannot** identify it |
| **v1.0.0 recommendation** | **parameter-light: `λ` deferred (effectively 0)** — distance-dominant, leg count preserved as evidence |
| **Normalization** | **keep raw physical km-equivalent**; league-relativisation and 0–100 orientation happen downstream, not in the feature |
| **Implementation authorized** | **NO** |

Nothing implemented. No registry row, calculator, `feature_dependency`,
`feature_value`, migration, readiness/DEC-2 change, or edit to `travel_distance` /
`travel_impact` / `travelLoad.ts`. No arbitrary coefficient, band, or decay. No
`travel_recency`. No outcome modelling was run — S-9's architecture was inspected,
not exercised.

---

## 1. Real observed distribution

From the doc-65 replay universe (20 real Brasileirão teams, real provider
fixtures/venues/coordinates, verified `travel_distance` outputs) at
`as_of = 2026-08-11`. **All 20 teams have a value.** This is the honest sample; §4
and the limitations below bound what it can support.

| team | total km | legs | km/leg | max leg | min leg |
|---|---|---|---|---|---|
| Remo | 9270 | 4 | 2318 | 2474 | 2165 |
| Vitória | 6592 | 4 | 1648 | 2456 | 1221 |
| Chapecoense | 4662 | 4 | 1166 | 2150 | 338 |
| Bahia | 4365 | 4 | 1091 | 1212 | 971 |
| Cruzeiro | 4343 | 4 | 1086 | 1349 | 823 |
| São Paulo | 3854 | 3 | 1285 | 2400 | 338 |
| Vasco da Gama | 3648 | 3 | 1216 | 1219 | 1210 |
| Palmeiras | 3603 | 4 | 901 | 1466 | 336 |
| Flamengo | 3303 | 3 | 1101 | 1125 | 1053 |
| Atlético Mineiro | 3295 | 3 | 1098 | 2470 | 339 |
| Corinthians | 2955 | 3 | 985 | 1444 | 66 |
| Internacional | 2872 | 4 | 718 | 919 | 548 |
| Fluminense | 2585 | 4 | 646 | 1115 | 7 |
| Mirassol | 1962 | 3 | 654 | 687 | 587 |
| Grêmio | 1032 | 2 | 516 | 1032 | 0 |
| Athletico | 794 | 3 | 265 | 393 | 47 |
| Coritiba | 781 | 3 | 260 | 391 | 0 |
| Botafogo | 688 | 3 | 229 | 344 | 0 |
| Red Bull Bragantino | 676 | 3 | 225 | 338 | 0 |
| Santos | 332 | 2 | 166 | 332 | 0 |

Summary (n = 20 teams; 66 individual legs):

| quantity | min | p25 | median | mean | p75 | max |
|---|---|---|---|---|---|---|
| total km | 332 | 1032 | 3125 | 3081 | 4343 | 9270 |
| **leg count** | **2** | **3** | **3** | **3.3** | **4** | **4** |
| km/leg (team) | 166 | 516 | 943 | 879 | 1166 | 2318 |
| individual leg km | 0 | 344 | 888 | 934 | 1222 | 2474 |

Leg-count distribution: **{2: 2 teams, 3: 10, 4: 8}**. Zero-km legs: **5 of 66**
(measured no-travel between two known venues — real observations, doc 65 §7).

**Limitations, stated plainly.** One competition, one season, ten weeks, mid-year
window (a fuller season yields ~5–7 legs per 28 days). No European mid-week
schedule. Leg count spans **only 2–4** — the canonical `1 leg` and `5 leg` cases
from the brief **do not occur**. Brazil's geography is continental, so km/leg here
is high and unrepresentative of, say, England or Finland (§8).

## 2. The semantic question

Of the three candidates:

- **A "how much travel exposure occurred?"** — a magnitude question.
- **B "how fragmented was that exposure?"** — a shape question.
- **C "how burdensome is the combination?"** — a characterisation.

**`travel_burden` should answer C, built transparently on A with B as a
declared modifier** — not a hidden fatigue proxy. It must stay explainable ("this
side travelled 4 365 km across 4 journeys"), and its magnitude core (A) is the
part the data can actually support. B enters only as a separable, bounded term
whose weight is a calibration question — never as an opaque fatigue coefficient.
Fatigue (travel + workload + rest + minutes) remains explicitly out of scope
(doc 62 §8, doc 67).

## 3. Candidate models

For each: behaviour, and the constraint it satisfies or violates.

### M1 — distance only
`burden = φ(distance)`. Monotone in distance; **ignores frequency**. 0 km → floor.
Interpretable, DERIVED 3, no double-count. **Weakness:** discards leg count — the
brief's explicit prohibition, *unless* frequency is unidentifiable, in which case
M1 is the honest null (see §4).

### M2 — additive fragmentation penalty (PREFERRED FAMILY)
`burden = φ(distance) + λ · ψ(legs)`, `λ ≥ 0`, `ψ` monotone (e.g. `legs − 1`).
Distance ↑ → burden ↑; legs ↑ at equal distance → burden ↑ by `λ·Δψ`; `λ = 0`
collapses to M1 (the identifiable null); 0 km, 1 leg → floor. **Distance and
frequency stay separable**, which is exactly what a calibrator needs to estimate
`λ` independently. `λ` carries interpretable units (km-equivalent burden per extra
journey). No double-count: distance is not multiplied by legs.

### M3 — multiplicative fragmentation
`burden = φ(distance) · (1 + λ·(legs − 1))`. Monotone both ways, but the
fragmentation surcharge **scales with distance**, so at large `λ` it approaches
`distance × legs` — the double-count the brief forbids. Harder to explain (a
percentage-per-leg on distance), harder to calibrate (interaction term). Rejected
as the base family; M2 is its additive, non-interacting sibling.

### M4 — total + average leg length
`burden = f(distance, distance/legs)`. `distance/legs` is mean leg length, which
**falls** as legs rise at fixed total — so "more fragmentation" would *lower* a
term, the opposite of the intended sign, and the two arguments are algebraically
tangled (`distance/legs` is not independent of `distance`). Rejected: it reintroduces
the average-leg-length pitfall the definition gate already warned against.

### M5 — max-leg / longest-haul
`burden = φ(max_leg)` or `φ(distance) + λ·φ(max_leg)`. The single longest journey
is a defensible burden driver (doc-65 shows max legs up to 2474 km). But `max_leg`
is **not exposed** by `travel_distance` (only the aggregate and the count are), so
M5 requires a **new Layer-1 measurement** — out of scope here and noted as a
possible future input, not a v1.0.0 candidate.

| model | freq captured | double-count | new L1? | explainable | reduces to M1 |
|---|---|---|---|---|---|
| M1 | no | none | no | yes | — |
| **M2** | **yes, separable** | **none** | **no** | **yes** | **at λ=0** |
| M3 | yes, coupled | at large λ | no | weaker | at λ=0 |
| M4 | inverted sign | tangled | no | weak | no |
| M5 | via longest haul | none | **yes** | yes | — |

**No arbitrary constant is assigned.** `λ` is named as a parameter requiring
calibration, not pretended known.

## 4. Identifiability — the decisive empirical result

**Distance and frequency cannot be disentangled from this dataset.**

- Leg count spans **only 2–4** (median 3); the brief's `1 leg` and `5 leg`
  contrasts are absent.
- `corr(total_km, leg_count) = 0.668` — moderately **collinear**: in this data
  more distance largely *means* one more leg, so a fragmentation effect cannot be
  separated from a distance effect.
- Within-distance variation is only ±1 leg: at ~1000 km leg counts are {2,3,3,3,3};
  at ~3000 km {3,3,3,4,4}; at ~4000 km {3,3,4,4,4}. There is no pair like
  `3000 km / 1 leg` vs `3000 km / 5 legs` to estimate `λ` from.

**Conclusion: `λ` is not estimable from the current universe, and must not be
overfit to 20 teams.** This is the "not enough evidence yet" outcome the brief
names as acceptable. The definition (distance + frequency) stands; the **weight**
is uncalibrated. That is precisely why M2's *separability* matters: it lets
v1.0.0 ship the identifiable part (distance) with `λ` held at the null, and adopt
`λ > 0` later without redefining the feature.

## 5. Monotonicity

Constraints, each justified rather than assumed:

1. **Non-decreasing in distance** — more measurable km is never less travel
   exposure. **Justified**; core to concept A.
2. **Non-decreasing in leg count at equal distance** — this is exactly `λ ≥ 0`.
   **Weakly justified**: more separate journeys is *plausibly* no less burdensome
   than fewer for the same km (each trip adds boarding/transit overhead). It is
   *not* strongly justified that it is strictly more — hence `λ ≥ 0` (allowing 0),
   not `λ > 0`.
3. **Jointly increasing** — follows from 1 and 2.
4. **0 km / ≥1 leg = the floor, not zero-erasure** — a measured non-travelling
   itinerary is minimum burden, and must remain a *row at the floor*,
   distinguishable from NO VALUE (§12). Justified by LC-05/PD-07.

M2 satisfies all four for any `λ ≥ 0` with monotone `φ, ψ`.

## 6. Extreme-value behaviour

Observed extremes: one 9270 km outlier (Remo, 2.1× the p75); individual legs to
2474 km; five 0 km legs; repeated venues (Coritiba three times at one ground).

- A **raw linear `φ`** lets the single long-haul team dominate a raw scale — but
  that is *correct* at the feature layer: Remo genuinely travelled twice as far as
  anyone. The feature should **preserve** that, not clip it.
- **Do not clip arbitrarily.** There is no evidence for a saturation point; a cap
  would be an invented constant. If diminishing returns on distance exist
  (concave `φ`), that is a *calibration* finding, not a v1.0.0 assumption — so
  v1.0.0 uses `φ = identity` (the null) and leaves concavity to evidence.
- Domination is a **presentation/normalisation** concern, resolved downstream
  (§7) by relativising at the composite, not by mutilating the physical quantity.

## 7. Normalization

Options: (A) raw continuous, (B) league/team-relative, (C) 0–100 bounded, (D)
banded.

**Decision: (A) — keep `travel_burden` a raw, continuous, physical km-equivalent
quantity.** Reasoning:

- **Preserve information until the composite.** The brief and the existing
  architecture both favour this: `readiness_score` already orients its raw inputs
  *at the composite* (`clamp(rest/7,0,1)×100`, `100 − congestion`), not by
  pre-squashing each feature. `travel_distance` itself is stored raw (km, scale 0).
- **0–100 is not required of the feature.** Readiness's scale is applied by
  readiness, exactly as it is for rest and congestion. Pre-binning or pre-scaling
  `travel_burden` would discard the magnitude S-9 needs to calibrate against.
- This **refines** doc 67 §13's tentative `unit = index`: the modelling analysis
  favours a **raw km-equivalent** value with `direction = LOWER_IS_STRONGER`
  applied by the consumer, over a pre-normalised index. Banding, if ever wanted,
  belongs to the *module* layer where S-9 calibration operates on bands (§10).

## 8. Cross-league implications

3000 km means different things in Brazil, England, and Finland. A raw km burden is
**globally physical and honest**, but **not globally comparable as preparedness**.

**Decision: keep the feature globally physical; relativise per league/competition
downstream.** The feature stores the measured physical quantity (calibration-ready,
league-agnostic, reproducible). League-relative normalisation is a **separate
transform** at the module/preparedness/calibration layer, where
`calibration_series` is already keyed by `context_competition_id` and
`context_kind_code` — the schema is built to hold per-competition baselines. Baking
a league constant into the feature would (a) invent a constant and (b) destroy
cross-league physical comparability at the measurement layer. **No normalization
is implemented here.**

## 9. Calibration requirements

To freeze `λ` (and any concavity in `φ`), the evidence needed is variation the
current data lacks:

- itineraries with the **same total distance but materially different leg counts**
  (the `1` vs `5` contrast) — absent here;
- **multiple seasons** so leg counts reach the 5–7 range and decouple from
  distance;
- **outcome linkage** — whether fragmentation, holding distance fixed, actually
  moves the reliability of a downstream reading.

What would *justify* a numeric `λ` is a measured, reproducible association between
the fragmentation term and outcomes — not a formula that looks plausible. Until
then, `λ` stays a declared, uncalibrated parameter. **"Not enough evidence yet"
is the correct v1.0.0 answer.**

## 10. S-9 relationship

Inspected `v2/migrations/009_calibration.sql`. **S-9 calibrates module *bands*
against outcomes, not feature coefficients.** `calibration_series` is keyed by
`(module_version_id, band_code, outcome_dimension_code, context_kind_code,
context_competition_id, snapshot_point_code)` over a reproducible
`measurement_population`; `calibration_result` records
`observation_count / hit_rate / baseline_rate / lift` per band under a
`sample_gate` (LC-133: every published rate passes a declared gate or is marked
unverified).

Consequences for the four decisions the brief asks be kept separate:

- **A. Semantic definition** — decidable now (concept C, §2). **DECIDED.**
- **B. Mathematical form** — decidable now (M2 additive-separable, §3).
  **DECIDED as a family.**
- **C. Parameter calibration** (`λ`, concavity) — **NOT decidable now** (§4/§9).
  And note: S-9 as built does **not** fit a continuous feature coefficient — it
  measures band→outcome reliability. So `λ` is set by a *modelling* decision
  informed by evidence, or — the cleaner path — `travel_burden` stays continuous
  and the **bands a module builds on it** are what S-9 validates. Either way, the
  current schema does not regress a feature-level `λ`.
- **D. Readiness weighting** — a future `feature_version` decision (§16, doc 67),
  distinct from B and C.

## 11. Provenance

Inputs: `travel_distance` = DERIVED rank 3 (its observation count belongs to it).
Under `min(ceiling, weakest input)`, **`travel_burden` = DERIVED rank 3** for
every candidate model. No INFERRED input is introduced; `λ` is a *parameter*, not
a data input, so it does not lower provenance. Were a future `max_leg` (M5) or
`travel_recency` input INFERRED, it would cap `travel_burden` at rank 2 — an
explicit reason to keep those inputs DERIVED (measured from `fixture`/`venue`) or
omit them.

## 12. NO VALUE behaviour

`NO VALUE ≠ 0`, preserved end-to-end:

| input state | `travel_burden` |
|---|---|
| `travel_distance` absent (unmeasurable itinerary) | **no row** |
| `travel_distance = 0 km`, count ≥ 1 (measured no-travel) | **a row at the floor** — a real, minimum-burden observation, distinguishable from NO VALUE |

In M2 the floor is `φ(0) + λ·ψ(count)`; with `φ(0)=0` and `λ=0` that is exactly 0,
but it is a **stored 0 with a row**, categorically different from an absent row.
The model domain must never map absent → floor.

## 13. Explainability

M2 is fully explainable in a Match Report: *"This side travelled 4 365 km across
4 journeys in the last 28 days"* — magnitude and frequency both surfaced from the
same numbers, the burden value monotone in each, provenance DERIVED, evidence =
the measurable legs (doc 65). No opaque transform. A concave `φ` or a fitted `λ`
would each need a one-line justification in the report, which is why neither is
adopted without evidence.

## 14. Recommended model family

**M2, additive-separable**, in raw physical km-equivalent units, DERIVED rank 3,
`direction = LOWER_IS_STRONGER` applied by the consumer, continuous (not banded,
not pre-normalised), NO VALUE = absent row.

For **v1.0.0, remain deliberately parameter-light**: `φ = identity`, `ψ = legs−1`,
**`λ` held at the null (0)**, with the fragmentation term *defined and carried*
(leg count travels as the observation count) but *not yet weighted*, because it is
unidentifiable from current data (§4). This ships the identifiable magnitude core,
preserves frequency as evidence, and reserves `λ` for calibration without ever
redefining the feature.

An explicit alternative, and why it is second: **defer instantiating `travel_burden`
until the cross-league normalisation stance (§8) and at least one more season
exist.** With `λ = 0` and raw units, v1.0.0 is numerically monotone with
`travel_distance` (adding orientation and a governed hook, but little independent
signal). If the maintenance surface is judged not worth that yet, waiting is
defensible — the brief explicitly allows "not enough evidence yet" as *preferable*.
**Recommendation: adopt the M2 family now as the frozen semantic+form decision;
gate actual instantiation on the readiness-integration need, since travel_burden
earns its keep only once something consumes it.**

## 15. Parameters requiring calibration

- **`λ`** — the fragmentation weight. Unidentifiable from current data (§4);
  needs same-distance/different-frequency variation, multiple seasons, and
  outcome linkage (§9).
- **concavity of `φ`** — whether distance has diminishing burden returns. No
  evidence; `φ = identity` is the null.
- **any league-relative normalisation constant** — deferred to the downstream
  layer (§8), never baked into the feature.

## 16. Parameters that can be fixed now

- **model family**: additive-separable M2;
- **`φ = identity`** (linear) as the evidence-free null;
- **`ψ = legs − 1`** (journeys beyond the first) as the natural fragmentation term;
- **`λ ≥ 0`** structurally (monotonicity §5), **= 0 for v1.0.0**;
- **units**: raw physical km-equivalent (§7);
- **direction**: `LOWER_IS_STRONGER`, applied by the consumer;
- **provenance ceiling**: DERIVED rank 3;
- **NO VALUE**: absent row; measured 0 km = row at floor.

## 17. What remains undecided

`λ` and `φ`-concavity (calibration); cross-league normalisation strategy (§8);
whether to add `max_leg`/`travel_recency` inputs (new Layer-1 features, separate
gates); `meaningful_sample_threshold` and final `unit` slot for the registry;
readiness weight for `travel_burden` (a future `feature_version`, no inherited V1
15%); and whether to instantiate v1.0.0 now or on first consumer need (§14).

## 18. Exact next gate

Two parallel tracks, neither authorised here:

1. **Registry-contract finalisation for `travel_burden` v1.0.0** — confirm unit
   (raw km-equivalent per this gate, refining doc 67), scale, direction slot,
   `meaningful_sample_threshold`, version rationale — *then* an implementation gate
   for the calculator declaring `travel_burden ← travel_distance`. Contingent on a
   consumer existing (§14).
2. **The `travel_recency` definition gate** (doc 67 §6) — independent of this,
   required before any recency-sensitive burden.

Calibration of `λ` is downstream of both and of S-9 evidence that does not yet
exist.

---

## STATUS

- **Definition gate:** COMPLETE (doc 67) — distance + frequency, travel-only inputs
- **Real data examined:** YES — 20 teams, 66 legs, doc-65 replay universe; no fabrication; one-competition/one-season/ten-week limits stated
- **Distance/frequency identifiability:** **NOT identifiable** from current data — leg count 2–4 only, `corr(total, legs) = 0.668`, no same-distance/different-frequency contrast
- **Preferred model family:** additive-separable `burden = φ(distance) + λ·ψ(legs)`, raw km-equivalent, DERIVED
- **Coefficients fixed:** `φ = identity`, `ψ = legs − 1`, `λ ≥ 0` structurally, **`λ = 0` for v1.0.0**
- **Coefficients requiring calibration:** `λ` (fragmentation weight); `φ` concavity; any league constant
- **Normalization:** raw physical km-equivalent in the feature; league-relativisation and 0–100 orientation deferred downstream
- **Cross-league strategy:** globally physical feature; per-competition relativisation at the module/calibration layer (`calibration_series` already keyed by competition)
- **Provenance:** DERIVED rank 3; no INFERRED input; `λ` is a parameter, not a data input
- **NO VALUE:** absent `travel_distance` → no `travel_burden` row; measured 0 km → row at the floor, distinguishable from absence
- **S-9:** calibrates module **bands → outcome rates** under sample gates, not feature coefficients — so `λ` is a modelling decision informed by evidence, or bands-on-burden are what S-9 validates
- **Implementation authorized:** NO
- **Next gate:** `travel_burden` registry-contract finalisation + implementation gate (gated on a consumer), and separately the `travel_recency` definition gate; `λ` calibration downstream of both
