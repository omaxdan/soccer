# Phase 8 S-0-a-ii — FINAL: `team.travel_distance` semantic contract

**STATUS: APPROVED.** All five corrections (C-1…C-5) are resolved as directed
and are consistent with source. The contract is implementation-ready.
**Implementation and migration remain disabled.**

No source modified, no migration 023, `mv_module_travel` not recreated,
`travelLoad.ts` untouched, no `feature_dependency` or `feature_value` rows, no
fatigue formula, no decay, no invented return-home leg.

---

## 1. Executive decision

`team.travel_distance` is established as a **new canonical Layer-2 feature**
measuring **total observed venue-to-venue kilometres travelled in the preceding
28 × 86,400,000 ms**, reconstructed from the actual venues of played fixtures,
seeded from the most recent fixture before the window, with **no assumed
return-home leg**.

It **supersedes nothing yet**: `team.travel_impact` stays registered and
unmodified. The four defects D-i…D-iv are addressed by construction — home
fixtures are nodes (D-i), legs are venue-to-venue (D-ii), the window is elapsed
time (D-iii), and the metric is a **sum** (D-iv).

**Final source verification changed nothing material** and confirmed three things
that were assumptions until now — §3 seed availability, §14 registry vocabulary,
§14 calculator identity.

## 2. Final semantic definition

> **`team.travel_distance`** — the total great-circle distance, in whole
> kilometres, between the venues of a team's consecutively played fixtures,
> across the governed window, counting every leg whose two endpoints both have
> coordinates.

It is a **measurement of physical movement**. It is not a burden, not a fatigue
figure, and not a readiness contribution.

## 3. Exact window semantics

| Element | Value | Authority |
|---|---|---|
| Duration | **28 × 86,400,000 ms** | `fixtureLoad.ts:59` — adopted verbatim |
| Reference | **`as_of`** — application-owned, from `fixture.scheduled_kickoff_at` + snapshot offset, whole seconds | `calculators/types.ts` |
| Lower bound | **INCLUSIVE** — `kickoffAt >= as_of − 28×86,400,000` | `fixtureLoad.ts:168` |
| Upper bound | **EXCLUSIVE** — `before()` filters `kickoffAt < as_of` | `types.ts before()` |
| Timezone / DST | **None. Epoch-millisecond arithmetic** | by construction |
| Fixture set | **COMPLETED only** — `lifecycle_state_code = 'COMPLETED'` | `read/fixtures.ts:122` |
| Ordering | Read layer returns most-recent-first with a total order (`scheduled_kickoff_at DESC, fixture_id DESC`); the itinerary **reverses** it to walk chronologically | `read/fixtures.ts:144` |

**Window: `[ as_of − 28×86,400,000 ms , as_of )`.**

## 4. Itinerary and seeding semantics

**Nodes** are the venues of played fixtures, in chronological order.
**Legs** are the movements between consecutive nodes.
**`isHome` is never consulted.** A home fixture is a node like any other.

**Seed (C-2, as directed):** the chain begins at **the most recent played fixture
immediately preceding the window**. It contributes **only its venue as a starting
node**; its own earlier history is **not** included — the window stays bounded.

```
F0 = Away A   (immediately before the window)   ← SEED NODE ONLY
F1 = Away B   (in window)
F2 = Home     (in window)

Legs counted:  A→B ,  B→Home          (2 legs)
NOT counted:   anything before A
```

### Seed availability — verified, not assumed

The read layer returns `rank_on_side <= 10 OR within 28 days`, where the rank is
**per side**. The seed sits at overall position N+1 for N in-window fixtures, so
its side-rank is at most N+1. **It is missed only if a team played more than ten
fixtures on one side inside the window** — more than twenty fixtures in 28 days,
which is not physically possible. **The seed is reliably available with no
read-layer change.** Where no prior fixture exists at all, there is no seed and
the chain begins at the first in-window fixture.

## 5. Distance calculation and rounding

| Step | Rule |
|---|---|
| Coordinates | `CalculationContext.venuesById`, populated by `readVenueLocations`, which filters `latitude IS NOT NULL AND longitude IS NOT NULL` — a venue without coordinates is simply **absent from the map** |
| Method | **Haversine great-circle**, `EARTH_RADIUS_KM = 6371` — the method already established and the only floating-point arithmetic in S-5 |
| Units | **Kilometres** |
| **Per-leg rounding** | **NONE.** Legs are summed at full precision |
| **Aggregate rounding** | **Round the total to the nearest whole kilometre** |
| Persisted | The resulting **integer** |

```
412.63 + 187.44 + 301.91  =  901.98 km   →  stored 902
```

**Why this closes C-3:** the current feature's floating-point safety rests on a
double selecting a *band* and an integer being stored. Rounding the aggregate
once preserves that property — `feature_value.value` still receives an exact
integer — while the sum keeps full precision so eight short legs cannot be
rounded away one at a time.

**Rounding boundary, for implementation:** `write/scale.ts` rounds once at the
write boundary to the definition's `value_scale`, and `ck_feature_definition__scale_bounded`
admits `value_scale = 0`. **So the aggregate rounding is achieved by declaring
`value_scale = 0` and letting the existing write layer round — the calculator
still returns an unrounded exact value**, and the *"a calculator returns an
UNROUNDED exact value"* contract is not violated. This is the one place where the
finalisation is more precise than the brief, and it resolves C-3 without an
exception.

## 6. Observation-count semantics

> **`sample_observation_count` = the number of MEASURABLE ITINERARY LEGS
> contributing to the value.**

Not fixtures. Not away fixtures. Not in-window fixtures.

| Sequence | Count |
|---|---|
| Home → Away | **1** |
| Away A → Away B → Home | **2** |
| Away A → Away A (same venue) | **1** — zero kilometres is a measured leg |
| A leg with an unmeasurable endpoint | **not counted**, and **not a zero** |

**Note against D-5c:** that decision defines a *module reading's* count as
`MIN(consumed)`. `travel_distance` **consumes no features** — `consumed: []` —
so, exactly as `travelLoad`, `formBackfill` and `fixtureLoad` do today, it sets
its own Layer-1 count directly. No conflict.

## 7. Missing-data / no-value semantics

| Condition | Behaviour |
|---|---|
| Either endpoint has no coordinates | **The leg is not measurable.** Excluded from both sum and count. **Never 0 km** |
| `venue_id IS NULL` | Same — the location is unknown. **No home-venue substitution** |
| No measurable legs at all | **Emit no feature value.** Not zero. PD-07: *"absence of a distance is the absence of a feature value row"*; LC-05 |
| No fixtures in the window and no seed | No value |

**The distinction that must not be lost:** *"the team did not travel"* (measured,
0 km, count ≥ 1) and *"we could not measure the travel"* (no value) are different
facts. Collapsing them is the class of error this programme has refused
throughout.

## 8. Neutral-venue semantics

**`is_neutral_venue` is not required and is not read.** The chain follows
`fixture.venue_id`, so a neutral fixture is a fixture at that venue — nothing
more. This is verified twice: the flag is absent from the read query's SELECT
list and from `CompletedFixture`, and the itinerary never needs it.

**A home fixture at a neutral ground is therefore handled correctly and
automatically** — the very case a home/away-flag-based model gets wrong.

**No substitution when `venue_id` is null**, which is what would have made the
flag necessary. That path is closed by §7.

## 9. Provenance

**DERIVED — rank 3**, on every value.

| Input | Class |
|---|---|
| Venue coordinates, fixture venue, kickoff | **OBSERVED** (4) |
| A leg between two observed venues | **DERIVED** (3) |
| The in-window total | **DERIVED** (3) |
| An assumed return-home leg | **INFERRED** (2) — **not used** |

`feature_definition.max_provenance_class_code` is NOT NULL and FK'd to
`football.provenance_class`, and `write/provenance.ts` applies
`min(ceiling, weakest input)`. Declaring the ceiling **DERIVED** means an
inferred leg could never enter this feature silently — the ceiling enforces the
decision rather than merely recording it.

## 10. Relationship to `travel_burden`

`travel_burden` is a **future, separate, normalised interpretation** of exposure —
distance **and** frequency **and** recovery. It would **consume**
`travel_distance` (and plausibly `rest_advantage`, `congestion_index`), making it
a composite whose `sample_observation_count` **would** fall under D-5c's
`MIN(consumed)` rule.

**Not specified here. Not implemented. No registry row proposed.**

## 11. Relationship to `travel_impact`

| | |
|---|---|
| Today | Registered, active, `unit = index`, `value_scale = 2`, `direction = LOWER_IS_STRONGER`, `max_provenance_class_code = DERIVED`, `meaningful_sample_threshold = 3`, calculator `travel_load` |
| Change made now | **NONE.** Not renamed, not retired, not reinterpreted, not modified |
| Future | Becomes the **downstream contribution of travel burden to preparedness**. Its current implementation is superseded when `travel_burden` is specified — by `is_active = false`, never by renaming a governed key |

**Nothing consumes it** — `feature_dependency` holds 0 rows, `feature_value`
holds 0 rows, DEC-2's readiness is rest + congestion only. It can stand unchanged
indefinitely at zero cost.

## 12. Why this is not a fatigue calculation

Fatigue is a **characterisation** over travel **plus** workload, rest,
congestion, player minutes, rotation and squad availability. `travel_distance` is
a **measurement of one physical quantity**.

Three concrete consequences, so the boundary is operational rather than
rhetorical:

1. **Short gaps get no special treatment.** Two fixtures a day apart and two a
   fortnight apart contribute the same kilometres. Recovery is
   `team.rest_advantage` and `team.congestion_index`, both live.
2. **No decay.** Flat window, as directed.
3. **Direction is not asserted.** §14 recommends `UNSIGNED` — a distance is not
   a strength claim.

## 13. Adversarial test matrix

Window = `[as_of − 28×86,400,000 ms, as_of)`. `H`/`A`/`N` = home/away/neutral.
All fixtures COMPLETED unless stated.

| # | Fixture sequence | In window | Seed | Itinerary legs | Measurable | Distance behaviour | Count | Value? | Prov. |
|---|---|---|---|---|---|---|---|---|---|
| **A** | H₁ → A → H₂ | all three | none (or prior) | V(H₁)→V(A), V(A)→V(H₂) | 2 | out **and** return, both **observed** | **2** | yes | DERIVED |
| **B** | A_A → A_B | both | none | V(A)→V(B) | 1 | direct leg only; **no A→home→B** | **1** | yes | DERIVED |
| **C** | A → H | both | none | V(A)→V(H) | 1 | **non-zero.** Today's code scores 0 — **D-i corrected** | **1** | yes | DERIVED |
| **D** | H → H | both | none | V(H)→V(H) | 1 | **0 km** | **1** | **yes** — 0 is a measurement | DERIVED |
| **E** | H → N | both | none | V(H)→V(N) | 1 | normal leg; flag not read | **1** | yes | DERIVED |
| **F** | A → N | both | none | V(A)→V(N) | 1 | identical treatment to E | **1** | yes | DERIVED |
| **G** | N → A | both | none | V(N)→V(A) | 1 | identical | **1** | yes | DERIVED |
| **H** | A_A → A_A (same venue) | both | none | V(A)→V(A) | 1 | **0 km** | **1** | yes | DERIVED |
| **I** | 5 fixtures in 10 days | all 5 | F₀ if present | 4 (+1 seed leg) | up to 5 | **high** sum | **4–5** | yes | DERIVED |
| **J** | 5 fixtures over 5 months | typically 1 | F₀ **outside** window | seed leg only | 1 | **low** sum. **I ≠ J — D-iii corrected** | **1** | yes | DERIVED |
| **K** | 900 km leg + several short | all | as applicable | all legs | all | sum **≫** any single leg. **D-iv corrected** — a mean would hide it | = legs | yes | DERIVED |
| **L** | One venue lacks coordinates | all | — | chain includes the node | **both adjacent legs excluded** | **never 0 km**; if **no** leg measurable → **no value** | measurable only | conditional | DERIVED |
| **M** | Duplicate fixture row | both copies | — | spurious **0 km** leg | +1 | distance unchanged, **count inflated by 1** | +1 | yes | DERIVED |
| **N** | Fixtures exactly 28×86,400,000 ms apart | **both — `>=` at the bound** | — | 1 leg | 1 | boundary is **inclusive** | **1** | yes | DERIVED |
| **O** | Fixture immediately before the window | **not in window** | **this is the seed** | seeds the first leg | 1 | contributes its **venue only**, not its own history | as counted | yes | DERIVED |
| **P** | Upcoming **home** fixture after recent away travel | prior fixtures only | as applicable | all in-window legs | all | **burden is non-zero at a home fixture.** The reference fixture is excluded twice over — not COMPLETED, and not `< as_of` | = legs | yes | DERIVED |

**Cases the current implementation gets wrong and this contract fixes: C, I-vs-J,
K, P.** **Cases D and H** are the ones a naive implementation gets wrong in the
other direction, by emitting no value where 0 km is the correct measurement.

## 14. Required `feature_definition` contract

Every NOT NULL column of the **actual** relation, verified against
`information_schema` and `pg_constraint`.

| Column | Proposed | Why correct | Inherited convention? | Migration? |
|---|---|---|---|---|
| `feature_key` | **`team.travel_distance`** | Satisfies `ck_feature_definition__key_namespaced` (`^(team\|player\|fixture\|competition)\.[a-z0-9_]+$`) | yes — all 7 use `team.` | **no** |
| `subject_kind_code` | **`TEAM`** | A team travels. FK to `football.subject_kind` | yes — all 7 | no |
| `display_name` | e.g. *"Travel Distance"* | free text | yes | no |
| `meaning` | Must state the window, the seeding rule and the no-return-home decision | This is where the semantics live for a reader | yes | no |
| `unit` | **`km`** | Existing values are `index`, `days`, `ratio` — free text, and `days` sets the precedent for a physical unit | **new value, existing convention** | no |
| `value_scale` | **`0`** | Whole kilometres. `ck_feature_definition__scale_bounded` admits 0–12. **This is what makes §5's aggregate rounding work through the existing write layer** | new value, existing mechanism | no |
| `direction` | **`UNSIGNED`** ⚠ | `ck_feature_definition__direction_known` admits `HIGHER_IS_STRONGER`, `LOWER_IS_STRONGER`, `UNSIGNED`. **A distance is a measurement, not a strength claim** — asserting a direction would smuggle `travel_burden`'s judgement into `travel_distance`. **UNSIGNED is currently unused by all seven features** | vocabulary exists, unused | no |
| `feature_calculator_id` | **A NEW calculator row**, e.g. `travel_itinerary` | FK to `feature.feature_calculator` (`calculator_key`, `display_name`, `implementation_version` all NOT NULL). **Reusing `travel_load` would claim one calculator produces two semantically unrelated features**, and `travel_load` stays bound to `travel_impact` | yes — 5 rows exist | no |
| `max_provenance_class_code` | **`DERIVED`** | §9. FK to `football.provenance_class`. `rest_advantage` sets the `OBSERVED` precedent; the other six are `DERIVED` | yes | no |
| `meaningful_sample_threshold` | **OPEN — see below** | `CHECK >= 0`. Existing: 1, 3, 5 | yes | no |
| `is_active` | **`true`** on registration | — | yes | no |

**No column is invented and no migration is required** — every field exists.
Registration is an **S-3 seed insert**, insert-only per `seed/helpers.ts`.

**Two registry values remain genuinely open**, and both are small:

> **R-1 — `direction`: `UNSIGNED` or `LOWER_IS_STRONGER`?**
> Recommended `UNSIGNED`, on the §12 separation. `LOWER_IS_STRONGER` would be
> defensible but pre-judges what `travel_burden` exists to decide.

> **R-2 — `meaningful_sample_threshold`: what leg count is meaningful?**
> One leg is a real measurement, so `1` is defensible; `3` matches
> `congestion_index` and `readiness_score`. **A product decision, not derivable.**

## 15. Dependencies and inputs

| Input | Available today? |
|---|---|
| `CompletedFixture.venueId`, `.kickoffAt` | **yes** |
| `venuesById` (coordinate-bearing venues only) | **yes** |
| 28 days of history including the seed | **yes** — §4, no read-layer change |
| `homeVenueByTeam` | **available and DELIBERATELY UNUSED** |
| `is_neutral_venue` | **not needed** — §8 |
| Haversine | **yes** — already implemented |

**`feature_source` declarations:** `travel_distance` reads `football.fixture` and
`football.venue` — the same Layer-1 relations `travel_impact` already declares.
Whether new `feature_source` rows are required is part of the same S-3
registration and needs no schema change.

## 16. Explicitly out of scope

Fatigue in any form · `travel_burden` · `travel_impact`'s future role · decay or
weighting · inferred return-home legs · direction of travel, time zones crossed,
altitude (**no such data exists in V2**) · transport mode · same-day fixture
special-casing · fixture-level travel differentials (doc 61's residual question) ·
recreating `mv_module_travel` · modifying `travelLoad.ts`.

## 17. Implementation acceptance criteria

For the future implementation step, **not now**:

1. Legs are built from `venue_id`; **`isHome` appears nowhere** in the calculator
   — assertable structurally, as F-2's test 16a does.
2. The window is `as_of − 28 × 86_400_000` with `>=` at the lower bound and the
   existing strict `before()` above; **no `new Date()`, no `Date.now()`** (R-2
   obligation 6).
3. The chain is seeded from the most recent pre-window fixture, whose own history
   is excluded.
4. Legs are summed unrounded; the value is returned unrounded; `value_scale = 0`
   performs the single rounding at the write boundary.
5. An unmeasurable leg is excluded from **both** sum and count and is **never**
   0 km; a 0 km leg between two known venues **is** counted.
6. No measurable legs ⇒ **no candidate value**.
7. `sample_observation_count` = measurable legs; `consumed` is empty.
8. All sixteen §13 cases are covered by tests, with **C, D, H, I-vs-J, K, L, N,
   O and P** as the discriminating ones.
9. Determinism: identical context ⇒ identical candidates in identical order.
10. `travelLoad.ts` and `team.travel_impact` are **unchanged** by the work.

---

## STATUS

- **Decision: APPROVED**
- **Window:** `[ as_of − 28 × 86,400,000 ms , as_of )` — elapsed milliseconds,
  inclusive below, exclusive above, timezone- and DST-free by construction
- **Itinerary:** observed successive venue-to-venue movement from
  `fixture.venue_id`; home, away and neutral fixtures are nodes alike; `isHome`
  never consulted
- **Seed:** the most recent played fixture immediately preceding the window,
  contributing its venue as the starting node only; its own history excluded.
  **Availability verified against the read layer**
- **Return-home assumption:** **NONE.** No inferred leg in the canonical metric
- **Distance:** haversine great-circle, `EARTH_RADIUS_KM = 6371`, kilometres
- **Rounding:** legs summed at full precision; **the aggregate rounded once**, via
  `value_scale = 0` at the existing write boundary
- **Observation count:** the number of **measurable itinerary legs**
- **Missing-data behavior:** unmeasurable legs excluded from sum and count, never
  zero; no measurable legs ⇒ **no value** (PD-07 / LC-05); no home-venue
  substitution
- **Provenance:** **DERIVED (rank 3)**, with `max_provenance_class_code = DERIVED`
  enforcing it
- **Feature name:** **`team.travel_distance`** — new; `travel_burden` and
  `travel_impact` reserved for later, separate decisions
- **Existing `travel_impact`:** **unchanged** — not renamed, retired,
  reinterpreted or modified
- **Implementation permitted: NO**
- **Migration permitted: NO** — and **none is required**: every registry field
  already exists, so registration is an S-3 seed insert
- **Remaining unresolved questions:** **R-1** `direction` (`UNSIGNED`
  recommended) and **R-2** `meaningful_sample_threshold`. Both are registry
  values, neither blocks the contract. Unchanged from doc 61: whether
  `travel_burden` is commissioned, and whether a fixture-level differential
  becomes a separate feature.

---

**No source modified. No migration 023. `mv_module_travel` not recreated.
`travelLoad.ts` untouched. No `feature_dependency` or `feature_value` rows.
Nothing implemented. No decay, no fatigue formula, no invented return-home leg,
and the existing away-only calculation is explicitly NOT adopted.**
