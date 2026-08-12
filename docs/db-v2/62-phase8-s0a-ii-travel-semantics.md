# Phase 8 S-0-a-ii — Travel semantics: governed specification

**Verdict: NEEDS REVISION.** The proposal's direction is right and is supported
by source on every material point but two. **One conflicts with an established
V2 convention** (calendar days vs elapsed milliseconds) and **one is
under-specified in a way that changes results** (the first leg of a window).
Both are stated below with the evidence and the smallest correction.

No code written, no migration, no `mv_module_travel`, no `feature_dependency` or
`feature_value` rows, `travelLoad.ts` unmodified, no fatigue formula, no decay,
no invented return-home event.

---

# 1. Is observed venue-to-venue itinerary derivable? **YES — with one read-layer extension**

Verified against source, not assumed.

| Requirement | Available to a calculator today? | Evidence |
|---|---|---|
| Fixtures for a team, both sides | **YES** | `CalculationContext.fixturesByTeam` — `TeamFixtureHistory.fixtures`. `isHome` is a field, **not a filter** — today's away-only behaviour is `travelLoad.ts`'s own `.filter()`, not the context's |
| Match venue per fixture | **YES** | `CompletedFixture.venueId: string \| null` |
| Kickoff instant | **YES** | `CompletedFixture.kickoffAt: Date`, from `scheduled_kickoff_at` (NOT NULL) |
| Venue coordinates | **YES** | `CalculationContext.venuesById` → `VenueLocation` |
| Home venue | **YES** | `homeVenueByTeam` |
| Deterministic order | **YES** | read query: `ORDER BY team_id, scheduled_kickoff_at DESC, fixture_id DESC` — most recent first, total order (R-2 obligation 1) |
| **28 days of history** | **YES — already returned** | `read/fixtures.ts:53`: `CONGESTION_WINDOW_DAYS = 28`, and the query unions a time-bounded branch precisely so a busy month is not truncated by the per-side rank |
| **`is_neutral_venue`** | **NO** | Absent from `FixtureRow` and `CompletedFixture`. Present in the database (NOT NULL) and in the test seeder only |

**Two findings that matter more than they look:**

**F-1 — The 28-day window needs no read-layer change.** `read/fixtures.ts`
already returns *"the most recent 10 home + 10 away + everything within 28
days"*, and its comment states why: *"a busy month can hold more than ten
fixtures on one side — so the query unions a separate time-bounded branch…
Deriving the congestion window from a rank would silently undercount exactly the
congested sides the feature exists to find."* **The exact argument applies to
travel**, and the data is already in the context.

**F-2 — `is_neutral_venue` is needed far less than the brief assumes.** §3.

---

# 2 & 3. Case handling, and what `is_neutral_venue` actually decides

## The governing principle

> **The itinerary is built from `venue_id` — where the match was actually played
> — and never from `isHome`.**

This is what makes most of the enumerated cases collapse to a single rule. A home
fixture is not assumed to be at the home ground; it is at whatever venue the
fixture records. A neutral tie is at its venue. **The home/away flag does not
enter the canonical metric at all**, which is precisely the defect (D-i, D-ii)
being corrected.

| Case | Handling | Why |
|---|---|---|
| **Home fixture** | **Included** as a location in the chain | Its venue is a place the team was. Excluding it is D-i |
| **Away fixture** | **Included**, identically | No special status |
| **Neutral fixture** | **Included**, identically | Its `venue_id` is the venue. No flag consulted |
| **Consecutive away** | One leg, venue→venue, **no return home inserted** | Rule 1 |
| **Consecutive at the same venue** | Leg of **0 km**, counted as a leg | §5 |
| **Missing coordinates** | The leg is **not measurable**. §5 |
| **Same-day / short gap** | **No special case in the canonical metric.** Distance is distance. Recovery is a *separate* concern already carried by `rest_advantage` / `congestion_index` | §8 |
| **Duplicate fixture** | Two rows, same identity → two legs, one spurious | §2.4 |

## 2.4 Duplicate and invalid fixtures

**U-9 is the controlling work.** `findFixtureByProviderIdentity` enforces one row
per `(provider_code, provider_external_id)` **in the writer**, and raises
`AmbiguousFixtureIdentityError` naming every partition when two exist — because
PostgreSQL cannot enforce it across partitions.

**Consequence for travel: a duplicate would insert a phantom 0 km leg** (same
venue, near-identical kickoff) and inflate the leg count. It is **not** the
travel calculator's job to detect it — the U-9 guard and the `default_partition_empty`
assertion own that. **The specification records the exposure rather than adding a
second, weaker check.** Ordering stays deterministic regardless: the read query's
`fixture_id DESC` tiebreak gives a total order even at identical kickoffs.

## 3. `is_neutral_venue` — the exact rule

**It has NO role in the canonical metric**, because the chain reads `venue_id`
directly. Evidence: nothing about a venue's neutrality changes where a match was
played.

**It becomes necessary in exactly one place — and only if a fallback is
authorised.** When `venue_id IS NULL` (the column is nullable), the team's
location for that fixture is unknown. One could substitute `team.home_venue_id`
for a *home* fixture. That substitution is:

- **valid only if the fixture is not at a neutral venue** — a "home" fixture at a
  neutral ground would be placed at the wrong location;
- **an INFERENCE, not an observation** — the fixture does not record it.

> **Recommendation: do NOT authorise the fallback in the canonical metric.**
> A null `venue_id` breaks the chain (§2, §5). That keeps the metric DERIVED
> throughout and needs no read-layer change for `is_neutral_venue`.

**Under that recommendation, `is_neutral_venue` is not required by this feature
at all**, and F-2's read-layer gap does not need closing. If the fallback is ever
wanted, exposing the column is a read-layer change (`FixtureRow` +
`CompletedFixture`), not a schema change.

---

# 4. The 28-day window — **CONFLICT C-1, and the correction**

## The proposal says "28 calendar days". V2's established convention is not calendar days.

`fixtureLoad.ts`, implemented and live:

```ts
const CONGESTION_WINDOW_MS = 28 * 86_400_000;              // :59
const windowStart = asOf.getTime() - CONGESTION_WINDOW_MS; // :167
const inWindow = played.filter((f) => f.kickoffAt.getTime() >= windowStart); // :168
```

**That is 28 × 86,400,000 milliseconds — a fixed 672-hour duration, computed on
epoch milliseconds.** It is not a calendar-day count, and the difference is not
academic: a calendar-day window requires a timezone, and across a DST boundary a
"28 calendar day" window is 671 or 673 hours. Two features on two different
definitions of the same window would be a silent inconsistency of exactly the
kind this programme has spent this phase removing.

> **Correction: adopt the existing convention verbatim — 28 × 86,400,000 ms
> back from `as_of`.** Same constant, same arithmetic, same file-level precedent.

### The exact semantics, all six answered

| Question | Answer | Source |
|---|---|---|
| **Reference timestamp** | **`as_of`**, the subject moment. Application-owned, derived by the driver from `fixture.scheduled_kickoff_at` plus a snapshot offset, truncated to whole seconds | `types.ts` SubjectMoment |
| **Timezone** | **None, by construction.** Epoch-millisecond arithmetic. DST-immune, locale-immune | `fixtureLoad.ts:167` |
| **Lower boundary** | **INCLUSIVE** — `kickoffAt >= windowStart` | `fixtureLoad.ts:168` |
| **Upper boundary** | **EXCLUSIVE** — `before()` filters `kickoffAt < asOf`, and the strictness is documented as load-bearing: *"at `KICKOFF` `as_of` equals the generating fixture's kickoff, so `<=` would let a value see the very fixture it is being calculated for"* | `types.ts` `before()` |
| **Is the current/upcoming fixture included?** | **NO, twice over.** The strict bound excludes it, and `fixturesByTeam` holds **completed** fixtures only (`lifecycle_state_code = 'COMPLETED'`) | both |
| **Exactly 28 days apart** | **INCLUDED** — `>=` at the boundary | `fixtureLoad.ts:168` |
| **Ordering** | Most recent first from the read layer; the itinerary must **reverse** it to walk chronologically | `read/fixtures.ts:144` |

**Window, stated once:** `[ as_of − 28×86,400,000 ms , as_of )` — closed below,
open above.

## C-2 — The first leg is undefined, and it changes the answer

The proposal gives `A→B + B→C + C→D` for a sequence, which yields **n−1 legs from
n fixtures** and **silently omits the journey to A**. For a team with one
in-window fixture it yields **zero legs and no value at all** — including for the
very case the correction was raised about: *away Wednesday, home Saturday* is two
fixtures and one leg, but *one away fixture then the upcoming home fixture* is one
in-window fixture and **no legs**.

Two options, both derivable, and this must be decided:

| | Option | Consequence | Provenance |
|---|---|---|---|
| **C-2a** | **Legs strictly between in-window fixtures.** n−1 legs | Simple, wholly observed. A single in-window fixture yields **no value** (PD-07 absence) | **DERIVED** |
| **C-2b** | **Seed from the most recent fixture before the window.** n legs | Captures the journey *into* the window. The seed fixture is a real observed fixture and **is available** — the read layer returns the last 10 per side regardless of the 28-day branch | **DERIVED** — the seed is observed, not inferred |

**Recommendation: C-2b.** It is still entirely observed, it uses data already in
the context, and it removes the discontinuity where a team's burden appears only
once it has two fixtures inside the window. The seed leg is excluded only when no
prior fixture exists at all.

---

# 5. Distance calculation

| Element | Specification | Source |
|---|---|---|
| **Coordinate source** | `CalculationContext.venuesById` — populated by `readVenueLocations`, which filters `latitude IS NOT NULL AND longitude IS NOT NULL`. **A venue without coordinates is simply absent from the map** | `read/venues.ts:69` |
| **Method** | **Haversine great-circle**, already implemented, `EARTH_RADIUS_KM = 6371` | `travelLoad.ts:87-98` |
| **Units** | **Kilometres** | established |
| **Floating point** | Haversine is *"the only such arithmetic in S-5"*, and it is permitted **only because nothing derived from it reaches a stored value except through a band**. **A stored `travel_distance` in km would break that guarantee** — see C-3 | `travelLoad.ts` header |
| **Rounding** | **Not in the calculator.** `write/scale.ts` rounds once at the write boundary, to the definition's `value_scale`. A calculator returns an unrounded exact value | `calculators/types.ts` |
| **Zero-distance movement** | A **legitimate leg of 0 km**, counted in the leg count. Two fixtures at one venue means the team did not travel — distinct from "did not play" | this spec |
| **Missing coordinates** | **The leg is not measurable.** LC-05: *"NULL coordinates yield no distance value — absence rather than a substituted value"*; PD-07. A leg with either endpoint absent from `venuesById` is **excluded**, and the exclusion must be **counted and reported**, never treated as 0 km | LC-05, PD-07 |
| **Null `venue_id`** | Same as missing coordinates — the location is unknown, the adjacent legs are unmeasurable | §3 |

## C-3 — A km distance cannot be stored the way `travel_impact` is

The current feature is safe in floating point **only because the double selects a
band and the stored value is an integer from a fixed table**. A `travel_distance`
in kilometres would store a haversine result directly, putting IEEE 754 into
`feature_value.value` for the first time.

**This is a real constraint, not a style point.** The options — round to whole
kilometres inside the calculator before returning; or define `value_scale = 0`
and let `write/scale.ts` round once — are **a governance question**, because the
first contradicts *"a calculator returns an UNROUNDED exact value"* and the
second is a registry decision. **Flagged, not resolved.**

---

# 6. Provenance

| Value | Class | Rank | Why |
|---|---|---|---|
| A venue's coordinates | **OBSERVED** | 4 | The provider stated them |
| A fixture's venue and kickoff | **OBSERVED** | 4 | Same |
| **A leg between two observed venues** | **DERIVED** | 3 | *"Calculated from observed facts"* |
| **Total in-window distance** | **DERIVED** | 3 | Sum of derived legs |
| **An assumed return-home leg** | **INFERRED** | 2 | *"Reconstructed by heuristic where no direct source exists"* — **not used** |
| A future `travel_burden` | **DERIVED at best** | ≤3 | Capped by its weakest input under S-5's `min(ceiling, weakest)` |

`feature_definition.max_provenance_class_code` exists and is NOT NULL, so the
ceiling is declared per feature and enforced by `write/provenance.ts`. **A
canonical metric declared `DERIVED` cannot silently ingest an inferred leg**,
which is the guarantee Rule 1 is really buying.

---

# 7. Why no inferred return-home leg

1. **It is unobservable.** No V2 relation records where a team was between
   matches. `football.fixture` records where matches were *played*.
2. **It would cap every dependant at INFERRED (rank 2)** under
   `min(ceiling, weakest input)` — including any future readiness contribution.
   A single heuristic leg would downgrade the whole chain.
3. **It is not needed for correctness of the thing being measured.** Observed
   venue-to-venue movement is a true lower bound on distance travelled. Understating
   is a coverage fact; inventing a leg is a fabricated observation, and this
   programme has refused that at every step — a substituted 0–0, an invented
   season period, a June league table.
4. **It remains available later, explicitly.** A separate INFERRED feature can
   model logistics without contaminating the canonical one.

---

# 8. The four concepts, kept apart

| Concept | Definition | Nature | Status |
|---|---|---|---|
| **Physical travel distance** | Sum of observed venue-to-venue legs in the window | **Measurement**, DERIVED | Specified here |
| **Travel burden** | A normalised interpretation of exposure — distance **and** frequency **and** recovery | **Characterisation** | **Not specified. Deliberately** |
| **Fatigue** | Broader still: travel + workload + recovery + congestion + minutes + rotation | **Characterisation**, multi-input | **Out of scope.** Explicitly disclaimed |
| **Travel impact / readiness contribution** | How burden contributes to preparedness | **Composite** | Not specified; DEC-2's readiness consumes rest + congestion only |

**Recovery is already measured and must not be re-implemented here.**
`team.rest_advantage` (days since the most recent completed fixture, DEC-3) and
`team.congestion_index` (28-day count ÷ 2 against V1's bands, DEC-3) are live.
A burden model composes them; it does not recompute them.

---

# 9. Naming — **NEEDS A DECISION, and the existing name is the problem**

| Name | State |
|---|---|
| `team.travel_impact` | **Registered, active, `direction = LOWER_IS_STRONGER`, `value_scale = 2`, implemented, tested** — and measuring a mean distance from home |
| `team.travel_distance` | **Does not exist** |
| `team.travel_burden` | **Does not exist** |

Creating either new key requires a `feature_definition` row with **eleven NOT NULL
columns** — `feature_key`, `subject_kind_code`, `display_name`, `meaning`,
`unit`, `value_scale`, `direction`, `feature_calculator_id`,
`max_provenance_class_code`, `meaningful_sample_threshold`, `is_active` — i.e. an
S-3 registry decision, **not a rename**.

**Recommendation, for decision:**

> Introduce **`team.travel_distance`** as the canonical measurement (unit `km`,
> `direction` = higher-is-more-travel, `max_provenance_class_code = DERIVED`),
> and **leave `team.travel_impact` registered but retire it from calculation**
> when `travel_burden` is specified.
>
> **Do not rename `travel_impact`.** `feature_value` rows reference
> `feature_definition_id`, and although there are **0 rows today**, LC-02's
> principle and the registry's insert-only seeding posture make renaming a
> governed key the wrong instrument. Retirement is `is_active = false`, which the
> column exists for.

**No schema change is proposed and none is created.**

---

# 10. Adversarial test cases — BEFORE implementation

Every case assumes the **corrected** rules: venue-chain from `venue_id`, window
`[as_of − 28×86,400,000 ms, as_of)`, C-2b seeding, no return-home leg.

Notation: `H`/`A`/`N` = home/away/neutral fixture; `→` = a counted leg.

| # | Scenario | Expected itinerary | Included | Excluded | Provenance | Qualitative result |
|---|---|---|---|---|---|---|
| **A** | Home → Away → Home | V(H₁) → V(A) → V(H₂) | 2 legs: out and back | none | DERIVED | **The return IS counted** — because H₂ was played at the home venue and observed. Not an inferred leg |
| **B** | Away A → Away B | V(A) → V(B) | 1 leg, A→B direct | any A→home→B routing | DERIVED | Understates if they went home. **Accepted, and stated** |
| **C** | Away → Home | V(A) → V(H) | 1 leg | none | DERIVED | **The D-i case.** Current code scores this 0; corrected scores the return |
| **D** | Home → Home | V(H) → V(H) | 1 leg of **0 km** | none | DERIVED | Distance 0, **leg count 1**. Distinguishable from "no fixtures" |
| **E** | Home → Neutral | V(H) → V(N) | 1 leg | none | DERIVED | `is_neutral_venue` never consulted |
| **F** | Away → Neutral | V(A) → V(N) | 1 leg | none | DERIVED | Identical treatment to E |
| **G** | Neutral → Away | V(N) → V(A) | 1 leg | none | DERIVED | Identical |
| **H** | Away → Away, same venue | V(A) → V(A) | 1 leg of **0 km** | none | DERIVED | Two matches at one ground = no travel between them |
| **I** | 5 matches in 10 days | 4 legs (+1 seed under C-2b) | all | none | DERIVED | **High** cumulative distance and **high** leg count |
| **J** | 5 matches over 5 months | Only fixtures within 28 days of `as_of` | typically 0–1 legs + seed | the rest, **out of window** | DERIVED | **Low** exposure. **This is D-iii corrected** — I and J now differ |
| **K** | One 900 km leg + several short | All legs summed | all | none | DERIVED | Sum ≫ any single leg. **This is D-iv corrected** — a mean would hide it |
| **L** | A venue has no coordinates | Chain broken at that node | measurable legs only | **both** legs touching the node | DERIVED, **with an excluded-leg count** | Never 0 km. If **no** leg is measurable → **no value** (PD-07) |
| **M** | Duplicate fixture row | Two nodes, same venue, near-identical kickoff | a spurious **0 km** leg | — | DERIVED | Distance unaffected; **leg count inflated by 1**. Owned by U-9, not by this calculator |
| **N** | Fixtures exactly 28 days apart | Both **in window** | both | none | DERIVED | `>=` at the boundary — the older fixture is included |
| **O** | Fixture immediately before the reference | In window | its legs | **the reference fixture itself** | DERIVED | `before()` is strict; a fixture 1 second before `as_of` counts, the fixture *at* `as_of` never does |
| **P** | Upcoming fixture is **home** after recent away travel | Chain ends at the last **completed** fixture | all in-window legs | **the upcoming fixture** — not completed, and not before `as_of` | DERIVED | **The correction's headline case.** Burden is non-zero at a home fixture. Today's code returns the same value whether or not last week was away |

**Three cases the current implementation gets wrong and the correction fixes:
C, I-vs-J, and P.** **Case K** is fixed by summation rather than a mean.

### Cases the specification deliberately does NOT handle

| | Why |
|---|---|
| Same-day fixtures (two matches, one day) | Distance is distance. Recovery is `rest_advantage`'s concern (§8) |
| Direction of travel, time zones crossed, altitude | **No timezone or altitude data exists in V2.** Out of scope, not deferred |
| Mode of transport | Not recorded anywhere |

---

# Conflicts requiring your decision

| | Conflict | Smallest correction |
|---|---|---|
| **C-1** | *"28 calendar days"* vs the established `28 × 86,400,000 ms` | Adopt the existing constant. **Not calendar days** |
| **C-2** | The first leg of the window is undefined; `A→B+B→C` omits the journey into the window and yields nothing for a single in-window fixture | **C-2b** — seed from the most recent pre-window fixture, still fully observed |
| **C-3** | Storing kilometres puts IEEE 754 into `feature_value.value` for the first time; today's safety rests on a band-selected integer | Decide where the km is rounded — calculator (contradicts the unrounded-return contract) or `value_scale` (a registry decision) |
| **C-4** | `travel_distance` is a **new feature definition** with 11 NOT NULL columns, not a rename | An S-3 registry decision, after C-3 |
| **C-5** | `sample_observation_count` for a distance value is undefined — legs? fixtures? measurable legs? | Under **D-5c** it is *"the minimum sample among consumed evidence"*, but this feature consumes **no** features. **Its own count is a Layer-1 count and must be stated** |

**None of these is a reason to reject the direction. All five are answerable
without new data.**

---

# STATUS

- **Decision: NEEDS REVISION** — direction accepted; C-1 conflicts with an
  established convention and C-2 through C-5 are under-specified.
- **Itinerary rule:** **ACCEPTED with correction.** Observed successive
  venue-to-venue movement from `fixture.venue_id`, home/away/neutral treated
  identically, **plus C-2b seeding** from the most recent pre-window fixture.
- **Temporal window:** **ACCEPTED with correction.** `[as_of − 28×86,400,000 ms,
  as_of)` — **elapsed milliseconds, not calendar days**; inclusive below,
  exclusive above; reference is `as_of`; timezone-free by construction.
- **Weighting:** **ACCEPTED.** Flat, no decay. Sum of legs, **not a mean**
  (corrects D-iv).
- **Return-home assumption:** **NONE. ACCEPTED as proposed.** No inferred leg in
  the canonical metric. Any future logistics model is a separate, explicitly
  INFERRED feature.
- **Canonical metric:** total observed venue-to-venue kilometres in the window,
  reported with a measurable-leg count and an excluded-leg count.
- **Provenance: DERIVED (rank 3)** throughout. Never OBSERVED — it is computed.
  Never INFERRED — nothing is assumed.
- **Implementation permitted: NO.**
- **Migration permitted: NO.** Migration 023 remains uncreated.
- **Remaining unresolved questions:** C-1 (confirm elapsed-ms), C-2 (confirm
  seeding), C-3 (where kilometres are rounded), C-4 (the new registry row),
  C-5 (what the observation count counts). **Plus, unchanged from doc 61:**
  whether `travel_burden` is commissioned at all, and whether a fixture-level
  differential becomes a separate feature.

---

**No implementation code. No migration 023. `mv_module_travel` not recreated. No
`feature_dependency` or `feature_value` rows. `travelLoad.ts` unmodified. No
fatigue formula, no decay, no invented return-home event. The existing away-only
calculation is explicitly NOT adopted as the new semantic definition.**
