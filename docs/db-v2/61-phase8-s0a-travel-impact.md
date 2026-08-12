# Phase 8 S-0-a — `travel_impact`: the away-only defect, and what V2 can actually derive

**The correction is accepted, and it goes further than stated: V2's own
`team.travel_impact` feature has the same defect, plus two more.** The
recommendation in [doc 60](./60-phase8-s0-final-decisions.md) — Option B, "use
the governed V2 feature" — is **withdrawn**, because the governed V2 feature
measures a distance characteristic and calls it an impact.

`mv_module_travel` is **not** recreated. No implementation, no migration, no
fatigue formula proposed.

---

## 1. What V1 did

Two separate V1 calculations, both away-anchored:

| | |
|---|---|
| **`processDbOnly.ts:818-833`** → `team_intelligence.travel_load_km`, `travel_fatigue_score` | `avgKm14` — a **mean per away trip**, banded |
| **`mv_module_travel`** (definition missing) | `away_km_7d/14d`, `home_km_7d/14d`, `away_trips_7d`, `away_fatigue_score`, `travel_gap_7d`, `travel_profile` |

The view's column names show it did track *both* sides over 7- and 14-day
windows — so V1's **view** was less away-only than V1's **table**. But its
weighting and its `travel_profile` thresholds are computed inside the view and
are **unrecoverable from this repository**, which is unchanged from doc 60.

## 2. Why it is insufficient — and the same test applied to V2

The correction as supplied: a team playing at home today may have played away
last week, travelled there, travelled back, and arrives carrying burden. Travel
must follow **movement history and successive match locations**, not the current
fixture's home/away flag.

**V2's `feature/calculators/travelLoad.ts` fails that test on three counts, read
directly from source:**

```ts
const WINDOW = 5;                                   // ← a COUNT of fixtures, not a period
const origin = context.venuesById.get(homeVenueId); // ← every trip measured from HOME
const awayFixtures = before(history.fixtures, subject.asOf)
  .filter((fixture) => !fixture.isHome)             // ← HOME FIXTURES DISCARDED
  .slice(0, WINDOW);
const meanKm = Math.round(sum / distances.length);  // ← a MEAN PER TRIP
```

| Defect | Consequence |
|---|---|
| **D-i · Away-only** | A home fixture contributes nothing. A side that played away on Wednesday and hosts on Saturday shows the same travel state as one that has been at home for a month. **This is exactly the correction's case.** |
| **D-ii · Star topology, never a chain** | Every trip is measured **home → away venue**. A back-to-back away pair (venue A → venue B) is measured as two independent radial trips from home, never as the leg actually flown. Return legs are implicit and never counted. |
| **D-iii · No time dimension at all** | `WINDOW = 5` counts *fixtures*, not days. Five away trips in a fortnight and five across five months produce the **identical value**. There is no recovery, no decay, no window. |
| **D-iv · A mean, so volume is invisible** | One 900 km trip and eight 900 km trips band identically. Cumulative burden cannot be expressed by a mean per trip. |

> **`team.travel_impact` currently answers: "how far from home are this team's
> recent away grounds, on average?"** That is a **distance characteristic of the
> fixture list**. It is not a burden, and it carries no fatigue content.

The naming compounds it: the feature is `LOWER_IS_STRONGER` and named *impact*,
which reads as burden, while computing a mean distance.

**None of this is a criticism of DEC-3.** DEC-3 ruled that V1's band table
*"carries across unchanged"* and it was right about the band table. The question
DEC-3 was asked was *which window*; it was never asked whether away-only was the
right topology.

## 3. What V2 already defines

| | |
|---|---|
| `feature.team.travel_impact` | Registered, active, `value_scale = 2`, `LOWER_IS_STRONGER`, **implemented and passing its tests** |
| Governed by | DEC-3 — *"V1 carried across unchanged"* |
| **Consumed by** | **Nothing.** `feature.feature_dependency` holds **0 rows**, and DEC-2's readiness is rest 50 / congestion 50 — `travel_impact` is not an input to it |

**Nothing downstream depends on it.** Correcting it breaks no feature, no module
and no reading — `feature.feature_value` holds 0 rows. **The cost of superseding
it is zero today and rises the moment S-5 runs against ingested reality.**

## 4. What information V2 already has — Option C's derivability

Checked against the live schema, not assumed:

| Requirement | Available? | Source |
|---|---|---|
| **Previous match location** | **YES** | `football.fixture.venue_id` → `football.venue`, ordered by `scheduled_kickoff_at` (NOT NULL) |
| **Current match location** | **YES** | same |
| **Distance between successive venues** | **YES** | `venue.latitude` / `longitude`, `ck_venue__coordinates_paired`; haversine already implemented |
| **Recent cumulative travel burden** | **YES, as a sum** | successive-leg distances over any period |
| **Relevant time window** | **YES** | `scheduled_kickoff_at` is NOT NULL — a **days** window is available, unlike today's fixture count |
| **Rest / recovery between trips** | **YES** | kickoff deltas; and `feature.team.rest_advantage` and `team.congestion_index` already compute exactly this, live |
| **Home venue** | **YES** | `football.team.home_venue_id` |
| **Neutral venues** | **YES** | `fixture.is_neutral_venue` NOT NULL — so a neutral tie is not mistaken for a home fixture |
| **Home return travel where applicable** | **PARTIALLY — see below** | |

### The one genuine gap, stated precisely

**A fixture list records where matches were played, not where the team was
between them.** Whether a side returned home between two away fixtures, or stayed
on the road, is **not observable from any V2 relation** — and it changes the
distance materially: A→home→B versus A→B.

What V2 *does* have is everything needed to **decide** it: both venues, the home
venue, and the gap in days between kickoffs. A rule of the form *"a gap beyond N
days implies a return home"* is fully computable. **The inputs exist; the rule is
a governed choice, and inventing it is exactly what this step forbids.**

## 5. What is still missing

| Missing | Kind |
|---|---|
| The **itinerary rule** — when a return home is assumed | **Governance** |
| The **fatigue function** — how distance, frequency and recovery combine | **Governance.** Distance is observed/derived; burden is a characterisation, and summing kilometres is not fatigue |
| The **window** — days, and whether decayed | **Governance** |
| Whether **direction** matters (long-haul east/west, altitude) | **Out of scope** — no timezone or altitude data in V2 |
| `mv_module_travel`'s `travel_profile` thresholds and `away_fatigue_score` weighting | **Unrecoverable** — and now moot under any option but A |

**No physical input is missing. Every gap is a modelling decision.**

## 6. Is the corrected model already governed?

**No.** Nothing in doc 07, the LC set, doc 15 or any decision record describes
cumulative travel, successive-venue chains, return legs, or a recovery-weighted
burden. DEC-3 governs a band table over a per-trip mean and nothing else.

The **distinction** the correction draws, however, **is** already governed —
`football.provenance_class` separates `OBSERVED` (4), `DERIVED` (3), `INFERRED`
(2), `ESTIMATED` (1):

| Quantity | Provenance |
|---|---|
| Distance between two venues with coordinates | **DERIVED** — computed from observed facts |
| Cumulative distance over a window | **DERIVED** |
| **A return-home leg that no fixture records** | **INFERRED** — *"reconstructed by heuristic where no direct source exists"* |
| **A fatigue characterisation** | **DERIVED at best**, and only if every input is |

**A model including inferred return legs caps every downstream value at INFERRED
(rank 2)** under S-5's `min(ceiling, weakest input)` rule. That is a real,
governed cost of Option C and must be weighed rather than discovered later.

## 7. The three options

| | Option | Assessment |
|---|---|---|
| **A** | Reproduce V1's away-travel implementation | **Rejected.** Carries D-i–D-iv; the `mv_module_travel` weighting is unrecoverable; V1's own verdict text disowns its band table — *"single-trip distance alone does not predict"* |
| **B** | Keep the governed V2 feature as it stands | **Withdrawn as a recommendation.** It is governed, implemented and tested — but it shares D-i, D-ii, D-iii and D-iv, and answers a distance question while being named an impact |
| **C** | Corrected cumulative model over successive locations and recovery | **Every physical input exists.** Needs three governed rules, and the return-leg heuristic costs provenance rank |

### Recommendation

> **Adopt C as the target semantics; keep B in place until C is governed.**
>
> B is not wrong as *distance*, only mis-named as *impact*. Nothing consumes it,
> `feature_value` holds 0 rows, and no reading cites it, so it can stand
> unchanged while C is specified — and superseding it later costs nothing that is
> not already zero.

**Classification, corrected per instruction:**

> **`travel_impact` — RECOVERABLE, V2 SEMANTICS SUPERSEDE V1.**
> The V1 implementation is **preserved as historical evidence only**. It is not
> carried forward.

## 8. The minimum governance decision

> ### S-0-a-ii — Three rules, in dependency order
>
> **(1) The itinerary rule.** When is a return home assumed between two
> consecutive away fixtures? *(A day-gap threshold is computable from data V2
> already holds. Accepting that any assumed leg is **INFERRED**, and caps
> dependants at rank 2, is part of this decision — as is the alternative:
> count only observed venue-to-venue legs and accept an understated burden that
> stays **DERIVED**.)*
>
> **(2) The window.** How many **days** of movement history, and decayed or flat?
> *(V2 has `scheduled_kickoff_at` NOT NULL, so a day-window is available for the
> first time. `congestion_index` already uses 28 days; `rest_advantage` uses the
> latest gap.)*
>
> **(3) Burden versus distance.** Is `team.travel_impact` re-specified as a
> **burden** — distance **and** frequency **and** recovery — or split into an
> observed `travel_distance` and a derived `travel_burden`? *(The correction's own
> distinction. V2 has one column and one feature key today.)*

**Not required now:** whether a fixture-level travel *differential* becomes a new
feature (doc 60's residual S-0-a question). It depends on (1)–(3) and should be
decided after them.

---

## Summary as requested

| Question | Answer |
|---|---|
| **What V1 did** | Mean kilometres per **away** trip, measured from the home ground, banded; plus a view-side 7/14-day both-sides profile whose weighting is unrecoverable |
| **Why insufficient** | Away-only (D-i); star topology, no chained or return legs (D-ii); no time dimension (D-iii); a mean, so volume is invisible (D-iv) |
| **What V2 defines** | `team.travel_impact` = `100 −` band over the mean distance of the last 5 away grounds from home. Governed by DEC-3, implemented, **and sharing all four defects** |
| **What V2 has** | Every physical input: successive venues, coordinates, kickoff timestamps, home venue, neutral flag, and existing rest/congestion features |
| **What is missing** | Only modelling rules: the itinerary assumption, the window, and the burden function. **No data gap** |
| **Already governed?** | **No.** DEC-3 governs a band table over a per-trip mean and nothing more |
| **Minimum decision** | **S-0-a-ii**, three rules in order — itinerary, window, burden-versus-distance |

---

**No implementation. `mv_module_travel` not recreated. No fatigue formula
proposed. Migration 023 still not created. S-6 waits on S-0 under D-1.**
