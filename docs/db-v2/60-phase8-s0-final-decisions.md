# Phase 8 S-0 — Final decision package: S-0-a, S-0-b, S-0-c, and the thirteen

Three governance questions resolved from evidence; **two of the three dissolve
rather than requiring a decision**, and one V1 defect was found in the process.
Final classification of all thirteen modules follows.

No implementation. **Migration 023 not created.** No S-6/S-7/S-8 code, no
provider call. `provider_statistic` and G-1 untouched.

**Principles held throughout:** V1 code is evidence, not specification. V1 golden
tests cannot override later V2 decisions. No obsolete `mv_*` view is recreated
merely because V1 used one.

---

# S-0-c — `readiness_tracker` acceptance criterion

## ⚠ The premise is wrong, and the error is mine

Doc 59 §5 stated that doc 15's golden-file test is *"impossible for
`readiness_tracker` by decision, since DEC-2 changed the formula deliberately"*.
**That inference was drawn from a shared name and it is false.**

```ts
// modules.ts:1155-1161 — evalReadinessTracker
const m = ctx.momentum;
const last5  = m?.last_5_points  ?? null;
const prior5 = m?.prior_5_points ?? null;
if (last5 == null || prior5 == null) return inactive(def, "…");
const { trend, change } = classifyTrend(last5, prior5);
```

**The module never reads `readiness_score`.** It reads `team_momentum` — last-five
points against the prior five. DEC-2 governs the *feature* `team.readiness_score`;
the *module* `readiness_tracker` consumes a points-momentum trend. **Same name,
different quantity, no conflict.**

## 1. DEC-2's authoritative readiness definition — for the record

```
rest_component       = clamp(rest_advantage_days / 7, 0, 1) × 100
congestion_component = 100 − congestion_index
readiness            = (50 × rest_component + 50 × congestion_component) / 100
```

Both absent → **no row** (PD-07); one absent → renormalise over the present
component and cite **one** lineage edge; exact `numeric`, rounded once at the
write boundary, half-up, to `value_scale = 2`.

## 2–3. Its inputs, and their recoverability

| Input | Definition | Recoverable? |
|---|---|---|
| `team.rest_advantage` | DEC-3: days since the most recent completed fixture | **YES — implemented and live** in S-5, and S-0 recovered V1's identical `calcRestDays` |
| `team.congestion_index` | DEC-3: completed fixtures in the previous 28 days, `rate = count / 2`, V1's original bands | **YES — implemented and live** (`fixtureLoad.ts:27-39`, V1's bands carried verbatim) |

**Both inputs already exist as calculated V2 features.** DEC-2's readiness needs
nothing from S-0.

## 4. A deterministic expected-value fixture — and a defect that forbids using V1's

**Tracing the module's own inputs uncovered a live V1 defect.**

```ts
// modules.ts:1077-1082 — classifyTrend
if (change >= 10) base = "SURGING"; else if (change <= -10) base = "CRASHING"; …
const trend = base === "STABLE" ? "STABLE (no change)" : `${base} (${signed})`;
return { trend, base, change, signed };

// modules.ts:1165 — evalReadinessTracker
trend === "Surging" ? "supports" : trend === "Crashing" ? "contradicts" : "neutral";
```

`classifyTrend` returns `trend` as **`"SURGING (+12)"`** — upper case, with the
delta appended. The module compares it against **`"Surging"`**. The two can never
be equal, on any input.

> **`evalReadinessTracker` returns `neutral` for every team, always.** The
> `supports` and `contradicts` branches are unreachable. The intended thresholds
> are in `base` (`"SURGING"`), which the module does not read.

There is a **second, independent** divergence: `processDbOnly.ts:3697-3700`
writes `team_momentum.trend` with **different** bands — `rising` at > 2,
`declining` at < −2 — which the module also does not use, because it recomputes
from the raw point totals.

**Consequence: a V1 golden-file comparison for this module would enshrine a bug**
— pinning `neutral` as the expected value for every fixture. This is the clearest
possible case of *V1 code is evidence, not specification*.

## 5. The smallest correct replacement

> **Component-level reconciliation against the governed rule, plus a V2 golden
> fixture derived from that rule — and NOT from V1 output.**

| Layer | Test | Why |
|---|---|---|
| **Inputs** | `last_5_points` / `prior_5_points` reconcile against `football.result` — a full window of five prior matches each, else null | The derivation is recovered (`processDbOnly.ts:3690-3706`), including *"with fewer than 5 prior matches, momentum is null rather than a misleadingly confident number"* |
| **Rule** | The status mapping is declared by **module version 1.0.0** under D-2, and the test asserts *that* rule | D-2 put the rule in the version contract; the test must follow it, not V1 |
| **Fixture** | A V2 golden fixture whose expected values are **derived from the declared rule**, with the boundary cases the rule names | Deterministic, and derived rather than invented |

**No expected numbers are proposed here**, because 1.0.0's status rule has not yet
been declared — it is written when the calculator is, under D-2. The *shape* of
the test is settled; its constants come from the rule.

**Doc 15 §6.4 step 5 must be rescoped**, and not only for this module:
a golden comparison against V1 is legitimate **only where the V1 rule is being
carried across deliberately** — `form_gap_accuracy`, `consistency_index`,
`giant_killer_index`, `rest_advantage`. It is **invalid** where a V2 decision
superseded V1 (`travel_impact`, and `readiness_score` at the feature layer) and
**harmful** where V1 is defective (`readiness_tracker`).

---

# S-0-a — `travel_impact`

## 1–2. The exact V1 window and weighting

From `ModuleTravelRow` — *"columns confirmed against production"* — and
`evalTravel`:

| Element | Value | Established? |
|---|---|---|
| Windows | **7-day and 14-day**, cumulative km and trip counts, **for both sides** | **YES** — column names |
| Single-trip distance | `away_trip_km`, banded `<100 / 100–300 / 300–600 / 600+` | **YES** — `modules.ts:585-590` |
| **`away_fatigue_score` / `home_fatigue_score`** (0–100) | **weighting UNKNOWN** | **NO — computed inside the missing view** |
| **`travel_profile`** (6 classes) | **thresholds UNKNOWN** | **NO — computed inside the missing view** |
| `travel_gap_7d` | away cumulative − home cumulative over 7 days | **YES** — the type's own comment |

**The module's status derives from `travel_profile`** — a classification the view
computes and the module merely reads. That is the one thing not recoverable.

## 3. Governed, or implementation behaviour?

**Implementation behaviour.** No LC constraint, no doc-07 entity and no decision
record describes `travel_profile`, `away_fatigue_score`, or a 7/14-day window.
The only governed statement about travel is DEC-3, which concerns the **feature**.

## 4. What the V2 travel feature says

`feature/calculators/travelLoad.ts`: `travel_impact = 100 − band`, where the band
comes from **V1's own distance table** applied to the **mean km per trip** over
`WINDOW = 5` completed away fixtures. `LOWER_IS_STRONGER`. Null coordinates yield
**no value** (LC-05, PD-07). DEC-3 recorded this as *"V1 carried across
unchanged"* — the per-trip mean makes V1's band table window-agnostic.

## 5. Is the V1 module travel a distinct business concept?

**Yes, demonstrably.**

| | V2 `feature.team.travel_impact` | V1 `mv_module_travel` |
|---|---|---|
| Subject | **one team** | **one fixture, both sides** |
| Quantity | mean km **per trip**, banded | cumulative km over **7d and 14d**, plus trip counts, plus a fatigue score, plus a **differential** |
| Output | a single 0–100 value | a six-class **profile** |

They are not two implementations of one idea. The V2 feature is a *team burden*;
the V1 view is a *fixture-level differential*.

## 6. Would carrying V1's calculation violate a V2 decision?

**Two problems, one fatal:**

- The `BANDS` table carries `sample: 77/167/169/222` with
  `provenance: "unreplayed"` — hardcoded rates that doc 15 §6.3 sends to
  `calibration.published_baseline` behind a sample gate. **They are not module
  inputs and must not be ported as literals.**
- **V1's own verdict text refutes the band table:** *"Away win rate moves under
  three points across every distance band — **single-trip distance alone does not
  predict**."* Reproducing a discriminator its author recorded as
  non-discriminating would be carrying forward a known dead end.

## 7. Recommendation

> **Option B — derive `travel_impact` from V2's own governed travel feature.**

**Supported by:** DEC-3 already governs the V2 travel semantics and is
implemented and live; the V1 profile's weighting is **unrecoverable** from this
repository; the V1 band table is disowned by its own author; and its baselines
belong to calibration, not to the module.

**Consequence, stated plainly:** the V2 module will be a *team-level travel
burden* reading rather than V1's *fixture-level differential*. That is a
narrowing. If the differential is wanted, it is a **new V2 feature** — home and
away travel burden compared — built from `football.venue` coordinates, which
already carry it. **That is a product decision, not a recovery task**, and it is
the residual half of S-0-a.

---

# S-0-b — `league_goal_profiles`

## 1–3. What the module actually consumes

```ts
// modules.ts:988-1002 — evalLeagueGoals
const leagueBtts = num(s?.league_btts_pct ?? null);
const predTotal  = (intel?.predicted_home_goals ?? 0) + (intel?.predicted_away_goals ?? 0);
if (leagueBtts == null && !predTotal) return inactive(def, "No scoring profile published…");
const profile = leagueBtts == null ? "Unclassified"
  : leagueBtts >= 60 ? "Goal heavy" : leagueBtts <= 40 ? "Goal light" : "Moderate";
status: profile === "Moderate" || profile === "Unclassified" ? "neutral" : "supports"
```

**The predicted quantity is not load-bearing.** It appears in exactly two places:
an `OR` in the liveness guard, and a **display row**. It does **not** enter the
profile, the status, the baseline or the verdict.

The module's finding rests entirely on **`league_btts_pct`** — the observed share
of the competition's completed fixtures in which both teams scored. **An observed
historical rate, not a prediction.**

## 4–5. What LC-71 and E4.05 prohibit — and whether it bites

LC-71: *"No construct expresses a recommended action, stake, or selection."*
E4.05: the snapshot verdict is *"a characterization of the fixture, not a
prediction of its result."*

**The question dissolves.** Under D-2 a module's status is its own finding, and
this module's finding is the observed league rate. Dropping the predicted goals
changes the status on no input. There is nothing to legalise.

**And it could not be carried anyway:** `module_reading` has no column for a
displayed predicted scoreline — only `headline_text` and `verdict_text`, which
E3.08/E3.09 define as the module's conclusion.

## 6. Is there an observed-data alternative in V2?

**Yes, directly.** `league_btts_pct` = the share of `football.result` rows for a
competition edition where `home_goals > 0 AND away_goals > 0`. Both columns are
`NOT NULL` and **live-proven** (doc 46). No view, no prediction, no gap.

## 7. Governance decision required?

**No.** Determined by existing constraints: the prediction is not load-bearing,
it has no representation, and the observed alternative exists in Layer 1.
**Recorded as resolved, not deferred.**

---

# Final S-0 classification — all thirteen

| # | Module | Classification | Decision required |
|---|---|---|---|
| 1 | `home_away_split` | **RECOVERABLE — carry forward** | — |
| 2 | `readiness_tracker` | **RECOVERABLE — V2 semantics supersede V1** | — · V1 status logic is **defective** (unreachable branches); inputs recover cleanly, the rule is declared by version 1.0.0 |
| 3 | `consistency_index` | **RECOVERABLE — carry forward** | — · sample stddev ÷(n−1), n ≥ 3 |
| 4 | `giant_killer_index` | **RECOVERABLE — carry forward** | — · tier boundaries transcribed from `processExtendedIntelligence.ts` |
| 5 | `travel_impact` | **PARTIAL** | **Confirm Option B**, and decide whether a fixture-level travel differential is wanted as a **new** V2 feature |
| 6 | `rest_advantage` | **RECOVERABLE — carry forward** | — · V1 `calcRestDays` and V2 DEC-3 are the same quantity |
| 7 | `league_goal_profiles` | **RECOVERABLE — V2 semantics supersede V1** | — · BTTS rate from `football.result`; prediction dropped |
| 8 | `form_gap_accuracy` | **RECOVERABLE — carry forward** | — · 70/30 formula already reproduced by S-5 |
| 9 | `confidence_calibration` | **PARTIAL** | **Extract the component set and weights** from `processDbOnly.ts:2240-2300`; then confirm whether the ≥4-components gate and the five bands are carried |
| 10 | `squad_stability` | **PARTIAL** | Registered **inactive**, no V1 predecessor, no specification. **No decision needed until activation** |
| 11 | `historical_advantage` | **PARTIAL** | as above |
| 12 | `risk_assessment` | **PARTIAL** | as above |
| 13 | `match_context` | **PARTIAL** | as above |
| — | `btts_fatigue`, `clean_sheet`, `halftime`, `weather` | **NOT CARRIED** | Dropped by product decision; no recovery owed |

**UNRECOVERABLE: none.**

Of the nine **active** modules: **six recoverable outright**, **one recoverable
under superseding V2 semantics** (`league_goal_profiles`), **one recoverable with
a defective V1 rule discarded** (`readiness_tracker`), **two partial**
(`travel_impact`, `confidence_calibration`). The four inactive modules are
partial only in the sense that nothing has ever specified them.

---

# The minimum decisions still open

> **S-0-a-i — Confirm Option B for `travel_impact`**, and state whether a
> fixture-level travel differential is wanted as a new V2 feature or the module
> narrows to a team-level burden.

> **S-0-c-i — Confirm the rescoping of doc 15 §6.4 step 5:** a V1 golden
> comparison applies only where a V1 rule is deliberately carried across; V2
> golden fixtures derived from the declared rule apply everywhere else.

**Not decisions — transcription, and unblocked:** `confidence_calibration`'s
component weights, `giant_killer_index`'s tier boundaries.

**Still held, authorised, not created:** migration 023 —
`module_version.minimum_sample_observation_count`,
`module_reading.inactive_reason`, and the `module_version.rationale` amendment.

---

**No implementation. No migration created. S-6 still waits on S-0 under D-1, and
S-0's remaining work is now two confirmations and two transcriptions.**
