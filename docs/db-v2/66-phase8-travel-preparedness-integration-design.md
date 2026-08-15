# Phase 8 — Travel Distance → Team Preparedness Integration

## Architecture decision report · DESIGN ONLY · nothing implemented

| | |
|---|---|
| **Commit** | `7f6e9a4` |
| **`travel_distance` empirical verification** | PASSED (doc 65) |
| **Implementation authorized** | **NO** — one design gate remains: the `travel_burden` definition decision |
| **Recommended interpretation layer** | **B — a new `team.travel_burden` derived feature** |
| **Migration required** | **NO** for the feature itself (registry rows + governed edges, as `travel_distance` was) |
| **Circularity** | **None**, and structurally impossible along the proposed edges — proven in §5 |

Nothing was implemented. No `feature_dependency` row, no `feature_value` row, no
migration, no schema change, no edit to `travel_distance`, `travel_impact`,
`travelLoad.ts`, readiness, `rest_advantage`, `congestion_index`, or DEC-2. No
fatigue formula, distance band or coefficient is proposed — those are the next
gate, not this one.

---

## 1. Current preparedness dependency graph

The graph is small and entirely legible. From `registry/declare.ts`
`FEATURE_DEPENDENCIES` (the source of truth for edges) and the calculators:

```
LAYER 1 — read football only, consume no feature (consumed: [])
  team.home_form          ← football.fixture, football.result
  team.away_form          ← football.fixture, football.result
  team.rest_advantage     ← football.fixture
  team.congestion_index   ← football.fixture
  team.travel_impact      ← football.fixture, football.team, football.venue
  team.travel_distance    ← football.fixture, football.venue        [NEW, verified]

LAYER 2 — composite, consumes features (the only lineage producer)
  team.readiness_score    ← team.rest_advantage
                          ← team.congestion_index
```

`feature_dependency` holds **exactly two edges**, both into `readiness_score`.
`team.squad_stability` is registered but never calculated (R-1). This is the
whole preparedness graph at the feature layer.

Team Preparedness as a *product surface* is **Layer 3** — a `module` reading,
gated on S-6, which is itself blocked on S-0 (D-1). Doc 34 §11 records the
governing rule for that surface: **no single combined "Team Preparedness"
number** — "three signals, three readings, each with its own evidence" (§29).
Travel would be one such signal, not a term folded into a scalar.

## 2. Current travel-related feature graph

| Feature | Layer | Consumes | Consumed by | Meaning |
|---|---|---|---|---|
| `team.travel_impact` | 1 | football only | **nothing** | mean km per away trip from home, banded → `100 − score`, `LOWER_IS_STRONGER` |
| `team.travel_distance` | 1 | football only | **nothing** | sum of observed venue-to-venue legs over 28 days, `km`, `UNSIGNED` |

Two Layer-1 measurements, neither consumed by anything. No travel interpretation
feature exists. `team.travel_burden` **does not exist**.

## 3. DEC-2's relationship to travel

**DEC-2 excludes travel entirely.** The readiness formula is:

```
rest_component       = clamp(rest_advantage / 7, 0, 1) × 100
congestion_component = 100 − congestion_index
readiness            = (50 × rest + 50 × congestion) / 100
```

No travel term. `teamReadiness.ts` states it in the negative: *"No form. No
travel. No stability. No fatigue. No rotation."*

## 4. Why DEC-2 excludes travel

Not an oversight — a governed decision, recorded in `teamReadiness.ts` and doc 23:

1. **No V2 input path existed.** V1's readiness carried a 15-point travel term
   sourced from `travel_fatigue_score`. Under DEC-1 (DECISION A) version 1.0.0 is
   the S-5 rule, not V1's, and at that time the only V2 travel feature was
   `travel_impact`, which `feature_dependency` never wired to readiness.
2. **Equal 50/50 weights were approved precisely because no evidence supports
   asymmetry** — "inventing one would assert a relationship nobody has measured."
   A travel weight would be exactly such an invention.
3. **Adding a term is a new `feature_version`, not an edit** — "a measured rate
   spanning two rules describes a system that never existed." DEC-2 is the frozen
   rule for 1.0.0.

The exclusion is therefore a *placeholder for a governed decision*, which is this
report's subject — not a defect to patch.

## 5. Circularity analysis — mandatory

**Question:** would `travel_distance → travel_burden → preparedness` create a
cycle with `rest_advantage`, `congestion_index`, `readiness_score`, form, or
opponent strength?

**Answer: no, and it is structurally impossible along the proposed edges.**

The decisive fact, verified in source: **every candidate input to a travel
interpretation is Layer 1 and consumes no feature.**

| Feature | `consumed:` in calculator | Reads a travel signal? |
|---|---|---|
| `team.rest_advantage` | `[]` (`fixtureLoad.ts`) | **No** — days since last fixture |
| `team.congestion_index` | `[]` (`fixtureLoad.ts`) | **No** — 28-day fixture count ÷ 2 |
| `team.travel_distance` | `[]` (`travelItinerary.ts`) | is the measurement |
| `team.readiness_score` | rest, congestion only | **No** |

Because `rest_advantage` and `congestion_index` read football relations directly
and consume **no feature at all**, a `travel_burden` that consumes them cannot
close a loop back to itself — they have no outbound feature edges to travel or to
anything else. The proposed shape:

```
travel_distance ─┐
rest_advantage ──┼─► travel_burden ─► (later) readiness / a Layer-3 reading
congestion_index ┘
```

is a DAG: all sources are Layer 1, the sink is new, no back-edge exists.
`registry/order.ts` (`DependencyCycleError`, `findFeatureCycle`, LC-44) would
reject a cycle at declaration time regardless, but here there is nothing to
reject. **The one thing that would create a cycle** — `rest_advantage` or
`congestion_index` consuming a travel feature — **does not occur**, and this
report does not propose introducing it.

One caution recorded, not a cycle: if a future `readiness_score` version consumed
**both** `travel_burden` **and** `congestion_index`, and `travel_burden` also
consumed `congestion_index`, that is a **diamond, not a cycle** — legal, but it
double-counts congestion. That is a weighting concern for the next gate, flagged
here so it is not discovered later.

## 6. Available travel inputs

Everything a governed burden model could compose **today**, all live and DERIVED
or better:

| Input | Source | Provenance | Carries |
|---|---|---|---|
| total travel distance | `team.travel_distance.value` | DERIVED (3) | km over the 28-day itinerary |
| measurable leg count | `team.travel_distance.sample_observation_count` | — | number of located legs |
| days since last fixture | `team.rest_advantage.value` | OBSERVED (4) | recency of the most recent match |
| fixture density | `team.congestion_index.value` | DERIVED (3) | 28-day workload band |

## 7. Missing inputs

Not available, and **must not be fabricated** to improve a model:

- **Leg timing within the window** — `travel_distance` deliberately answers a
  28-day *aggregate* question and does not expose per-leg timestamps. See §9.
- **Next-fixture timing / home-away of the upcoming match** — a forward-looking
  quantity S-5 forbids inside a calculator; only the driver's `as_of` offset
  encodes proximity to kickoff.
- **Travel mode / geography / time zones** — never ingested; INFERRED at best.
- **Minutes, rotation, squad load** — not registered; belong to fatigue, which is
  explicitly out of scope (doc 62 §8).

## 8. Is observation count required?

**Yes.** The prompt's own example is decisive and the architecture already
distinguishes it: **900 km / 1 leg ≠ 900 km / 5 legs.** `travel_distance` carries
`sample_observation_count = measurable leg count`, verified in doc 65 (§7: a 0 km
leg between two known venues counts; an unlocatable one does not).

A burden model must consume **both** value and count. The architecture expresses
the distinction cleanly — one long haul (count 1) versus five short hops
(count 5) are two different `(value, count)` pairs reaching the composite. Under
DEC-5 a composite's own `sample_observation_count` becomes
`MIN(consumed.count)`, so the count *propagates*; how burden should *weight*
km-per-leg is a modelling choice for the next gate, not discarded here.

## 9. Is time proximity required?

**Yes — and it is the single most important reason `travel_distance` must not be
touched.** `travel_distance` answers "how many measurable km in the last 28
days"; preparedness is match-specific. "3 000 km all 27 days ago" and "3 000 km
yesterday" are the same `travel_distance` value.

The architecture can distinguish them **without changing `travel_distance`**, two
ways, in order of fidelity:

1. **`rest_advantage`** already measures days since the most recent fixture — a
   direct recency proxy for *when the last travelling match was*. A burden model
   composing `travel_distance` with `rest_advantage` partly separates the two
   cases today, with zero new inputs.
2. **A separate match-specific burden feature** that weights legs by recency
   would separate them fully — but that needs per-leg timing, which is a **new
   measurement feature** (an itinerary that exposes leg timestamps), not an
   edit to `travel_distance`. **Recorded as a possible future feature, not
   proposed now.**

**Do not alter `travel_distance` to answer the match-specific question.** If full
recency weighting is wanted, it is a new feature; the 28-day aggregate stays
boring and trustworthy.

## 10. How NO VALUE must propagate

**`travel_distance = NO VALUE` must never become 0 km or LOW burden.** This is the
S-0-a distinction (LC-05, PD-07) and it must survive downstream. NO VALUE means
"the team's recent itinerary is unmeasurable" — an away side whose venues lack
coordinates — not "the team did not travel." A measured 0 km (two fixtures at one
ground) is a *value*; absence is *absence*.

The existing convention is already correct and should be reused verbatim:
`teamReadiness.ts` renormalises over present components when one input is absent,
and emits **no row** when all are absent (PD-07). A `travel_burden` should do the
same:

- travel input absent, other inputs present → **renormalise over the present
  inputs**, cite only the edges actually consumed (instance-level lineage);
- travel the *only* intended input, and absent → **no row**, never a zero.

Whether travel absence should suppress a burden reading entirely or renormalise
is part of the §18 decision, because it depends on which other inputs the burden
model declares.

## 11. Provenance implications

`travel_distance` = DERIVED (rank 3). Under `write/provenance.ts`'s
`min(ceiling, weakest input)`:

| Input | Rank |
|---|---|
| `travel_distance` | DERIVED 3 |
| `congestion_index` | DERIVED 3 |
| `rest_advantage` | OBSERVED 4 |

A `travel_burden` consuming any of these resolves to **DERIVED (rank 3) at best**,
capped further by its own declared ceiling. **No provenance upgrade is possible
and none should be attempted.** No INFERRED (rank 2) input is available, and
**none should be introduced to enrich the model** — doing so would cap every
dependant at rank 2 for the sake of a modelling nicety.

## 12. Is `travel_burden` required?

**Yes, as the architectural *location* — but its *definition* is a separate,
unmade decision.**

- It must not live in `travel_distance`: that would collapse a physical
  measurement into an interpretation and break the very property doc 65 verified.
- It must not live in `readiness_score`: DEC-2 is frozen; a travel term is a new
  `feature_version`, and even then readiness is only one of three preparedness
  signals (doc 34 §11).
- It must not reuse `travel_impact` (§13).

So a **new Layer-2 derived feature `team.travel_burden`** is the governed home for
travel interpretation. But its formula — distance/leg weighting, recency handling,
NO VALUE policy, whether it is `LOWER_IS_STRONGER`, whether it bands or scales —
is **not specified and must not be invented** (the CRITICAL SEMANTIC RULE:
`travel_burden = travel_distance / constant` is prohibited absent an established
contract). **Location: decided. Definition: the next gate.**

## 13. Should `travel_impact` remain untouched?

**Yes — untouched, per doc 63 §11.** Its registry meaning (mean km/trip from home,
banded, `LOWER_IS_STRONGER`, scale 2, threshold 3, DERIVED); its calculator
(`travelLoad.ts`, V1's band table over 5 away fixtures); its provenance; and its
zero consumers all stand. It is **not** reusable as the interpretation layer:

| | `travel_impact` | corrected model |
|---|---|---|
| subject/quantity | mean km per trip **from home** | sum of observed **venue-to-venue** legs |
| window | 5 away fixtures (count) | 28 days (elapsed) |
| defects | the four S-0-a defects, by design | refuted empirically (doc 65 §10) |

Its semantics **conflict** with the corrected travel model. The earlier audit
established that discrepancy; **this task does not silently repair it.** If
`travel_impact` is eventually superseded, that is a **separate decision**,
executed by `is_active = false` (never a rename of a governed key) — recorded
here, not taken here.

## 14. Exact proposed dependency graph

Proposed for the **next gate's** decision, not for declaration now:

```
team.travel_distance   ─┐
team.rest_advantage    ─┼─►  team.travel_burden        [NEW Layer-2 feature]
team.congestion_index  ─┘

(FUTURE, separate governed decision — NOT proposed here:)
team.travel_burden     ─►  readiness_score v2  OR  a Layer-3 preparedness reading
```

The exact input set for `travel_burden` (all three, or a subset) is part of §18.
`travel_impact` appears nowhere in the graph and gains no edges.

## 15. Exact proposed feature(s)

**One**, and only its *identity slots* are proposed — never its formula:

- **`team.travel_burden`** — `subject_kind = TEAM`, `unit` TBD (index vs a
  normalised ratio), `value_scale` TBD, `direction` TBD (almost certainly
  `LOWER_IS_STRONGER`, but that is a decision), `max_provenance = DERIVED`,
  `meaningful_sample_threshold` TBD, calculator `travel_burden` (new),
  `contextKinds = [ALL_COMPETITIONS]`.

Everything marked TBD is the next gate. No other feature is proposed. No
calculator is written.

## 16. Deliberately out of scope

- Any **fatigue** feature (travel + workload + minutes + rotation) — doc 62 §8.
- Any **distance band, coefficient, or `distance / constant`** formula.
- A **home/away travel differential** (V1's fixture-level `travel_profile`) — a
  new product feature, "a product decision, not a recovery task" (doc 60 §7).
- A **recency-weighted per-leg** itinerary feature (§9) — future, if wanted.
- **Superseding `travel_impact`** — separate decision (§13).
- Any change to **DEC-2**, readiness, or the Layer-3 module surface (S-6-blocked).

## 17. Would a migration eventually be required?

**No schema migration for `travel_burden` itself.** A new feature is
`feature_definition` + `feature_version` registry rows (S-3) and governed
`feature_dependency` inserts — exactly the path `travel_distance` took, which
added no DDL. `pt_platform_admin` already holds the grants for
`feature_definition`, `feature_calculator`, `feature_source` and
`feature_dependency`; `feature_version` insertion follows the same `pt_owner`
path already noted for the DEC-2 rationale amendment.

(Migration 023, authorized earlier, concerns `module_version` /
`module_reading` at the S-6 layer and is **unrelated** to a feature-layer
`travel_burden`.)

## 18. Can S-5 consume travel immediately, or is another gate required?

**Another design gate is required.** S-5 cannot consume travel today, because the
*interpretation contract* does not exist. The remaining gate must decide, without
inventing coefficients under time pressure:

1. **Inputs** — `travel_burden` = f(`travel_distance` [+ `rest_advantage`]
   [+ `congestion_index`])? Which, and why each earns its place (§5 diamond
   caution, §11 provenance floor).
2. **Distance × frequency** — how `(value, leg_count)` combine (§8); no
   `distance / constant` absent evidence.
3. **Recency** — accept `rest_advantage` as the proxy (§9.1), or commit to a
   future per-leg feature (§9.2).
4. **NO VALUE policy** — renormalise vs suppress (§10), fixed by the input set.
5. **Registry slots** — `unit`, `value_scale`, `direction`, threshold (§15).
6. **Only then**: declare edges, register, and let S-5 compute.

Until those are decided, no `feature_dependency` row should be created.

---

## STATUS

- **travel_distance empirical verification:** PASSED (doc 65) — 20 teams, 6 `as_of`, 94 candidates, 0 discrepancies
- **Current travel consumer:** NONE — `feature_dependency` has 0 travel edges; `travel_impact` and `travel_distance` are both unconsumed
- **Current preparedness consumer:** `team.readiness_score` (DEC-2), consuming `rest_advantage` + `congestion_index` only
- **DEC-2 travel status:** EXCLUDED by governed decision — no travel term; adding one is a new `feature_version`
- **Circularity:** NONE, and structurally impossible along the proposed edges — every candidate input is Layer 1 and consumes no feature; rest/congestion read no travel signal
- **Observation count required:** YES — 900 km/1 leg ≠ 900 km/5 legs; `travel_distance` already carries leg count and it propagates via DEC-5 MIN
- **Time proximity required:** YES — `rest_advantage` is the available recency proxy; full per-leg recency needs a NEW feature, never an edit to `travel_distance`
- **NO VALUE behavior:** propagate as ABSENCE — renormalise over present inputs, or no row; never 0 km, never LOW burden (LC-05, PD-07)
- **Provenance:** `travel_burden` resolves to DERIVED (rank 3) at best; no upgrade; introduce no INFERRED input
- **travel_impact:** UNTOUCHED (doc 63 §11); semantics conflict with the corrected model; any supersession is a separate `is_active = false` decision
- **travel_burden required:** YES as the location; its DEFINITION is unmade and must not be invented here
- **Proposed dependency:** `travel_burden ← travel_distance [+ rest_advantage] [+ congestion_index]`; `travel_impact` gains no edge
- **Migration required eventually:** NO for the feature (registry rows + governed edges, as `travel_distance` was); migration 023 is a separate S-6 concern
- **Implementation authorized:** NO
- **Next gate:** the `team.travel_burden` DEFINITION decision — inputs, distance×frequency handling, recency, NO VALUE policy, and registry slots — before any `feature_dependency` row is created
