# Phase 8 S-0 — Module input recovery matrix

**The headline result: S-0 is largely recoverable from this repository, and doc
25's premise was wrong about where the inputs come from.**

The thirteen modules do **not** read thirteen materialised views. They read
**ordinary tables written by V1 backend jobs whose source is in this
repository** — `processDbOnly.ts`, `processExtendedIntelligence.ts`,
`processRiskOpportunity.ts`. **Exactly two `mv_*` views are read by any module**,
and only those two are genuinely missing.

No implementation. No migration created or applied. No S-6/S-7/S-8 code, no
provider call. `provider_statistic` and G-1 untouched.

---

## 0. Decisions recorded

**D-5c-i — CONFIRMED.** For module version 1.0.0,
`sample_observation_count = MIN(sample_observation_count of consumed feature
evidence)`. Recorded as a **module-version rule**, not a global definition of
"sample". Semantics as supplied: the count is the observed quantity; the
threshold is `module_version.minimum_sample_observation_count`;
`sample_meets_threshold` is the evaluation; **a NULL threshold means the version
has not declared one and must not silently mean zero**; counting cited values is
rejected; V1 `Baseline.sample` is not equivalent and must not be used; the
fixed-count-input consequence is accepted without compensating aggregation.

**AUTHORISED, PREPARED, NOT CREATED — three changes.**
`module_version.minimum_sample_observation_count` (nullable, non-negative CHECK,
no default, version-specific, immutable through the append-only posture);
`module_reading.inactive_reason` (nullable, present exactly when INACTIVE,
preserving the measurement-silence invariant); and the `module_version.rationale`
amendment recording the D-2 decision, **with no successor 1.0.1** since 1.0.0 has
produced no readings.

**Existing 1.0.0 rows get no threshold value** — none has been established by
governance, and populating zero is explicitly excluded.

> **I did not create the migration this turn.** The instruction closes with *"No
> implementation. Stop after the S-0 recovery matrix"*, so the authorisation is
> recorded and the DDL (docs 55 §D-6, 58 §2) is ready to become migration 023 on
> your word.

---

## 1. What V1 modules actually read — the correction that unblocks S-0

`beta/live-frontend/src/lib/queries.ts`, counted directly:

| Source read by the frontend | Kind | Writer in this repository? |
|---|---|---|
| `team_intelligence` ×6 | **table** | **YES** — `processDbOnly.ts` |
| `team_form_quality` ×5 | **table** | **YES** — `processExtendedIntelligence.ts` |
| `team_venue_performance` ×4 | **table** | **YES** — `processDbOnly.ts`, `processExtendedIntelligence.ts` |
| `match_intelligence` ×2 | **table** | **YES** — `processDbOnly.ts` |
| `matches`, `teams`, `players`, `tournament_standings`, … | **tables** | ingestion jobs |
| **`mv_module_travel`** ×2 | **materialised view** | **NO** |
| **`mv_match_scoring_probabilities`** ×2 | **materialised view** | **NO** |

**Doc 25 B-2 listed thirteen `mv_module_*` names as the blocker. Only two of them
are read by any module, and the other eleven names appear in `modules.ts` as
`sourceView` labels with no query behind them.** The derivations doc 15 §6.4 step
1 asks S-0 to "recover from production" are, for eleven of thirteen modules,
**already in the repository as TypeScript**.

---

## 2. Recovery matrix

**Status key:** **R** = recoverable, derivation established in this repo ·
**P** = partial · **U** = unrecoverable here · **DROP** = V1 module not carried
into V2 (no V2 module registered), so no recovery is owed.

### 2.1 TEAM-subject modules

| Module | V1 input field | V1 source / derivation | V2 candidate | Status | Gap |
|---|---|---|---|---|---|
| **readiness_tracker** | `TeamMomentum` trend | `team_intelligence.readiness_score` movement | `feature.team.readiness_score` over time | **P** | The *trend* banding (Surging/Crashing) is a `momentum` table field; the underlying score is recovered |
| ″ | `readiness_score` | **`processDbOnly.ts:1690-1712`** — weighted mean of 6 components: form 30, `100−congestion` 15, `100−travel_fatigue` 15, stability 5, `100−fatigue` 10, `100−rotation` 10; nulls dropped and weights renormalised | `feature.team.readiness_score` **exists** — but S-5 DEC-2 defines it as **rest 50 / congestion 50** | **P** | **Formula divergence, already governed** — doc 23 DEC-2 chose the two-component form deliberately. **Not a gap to close: a decision already taken** |
| **home_away_split** | `TeamVenuePerformance.home_win_pct`, `away_win_pct`, type, disparity | `team_venue_performance`, `processDbOnly.ts` / `processExtendedIntelligence.ts:577` | No V2 feature; derivable from `football.fixture` + `football.result` by venue side | **R** | Needs a new V2 feature definition; inputs all exist in Layer 1 |
| **consistency_index** | `TeamFormQuality.volatility` | **`processExtendedIntelligence.ts:369-379`** — **sample** stddev (÷ n−1, finding F5) of `goal_margin` over the window; null when n < 3 | `football.result` home/away goals per fixture | **R** | New feature definition; the ÷(n−1) choice and the n≥3 floor are recorded and must be carried |
| ″ | `consistency_profile` ("Erratic") | banding over `volatility` | — | **R** | Band boundaries are in `modules.ts`; recoverable |
| **giant_killer_index** | `giant_killer_score`, `flat_track_bully_score`, `ppg_vs_top/middle/bottom`, `matches_vs_*` | **`processExtendedIntelligence.ts:381-395`** — points-per-game partitioned by opponent tier, plus counts | `football.result` + `football.standing` for tiering | **R** | Tier boundaries (top/middle/bottom) must be recovered from the same file; `football.standing` supplies position |

### 2.2 FIXTURE-subject modules

| Module | V1 input field | V1 source / derivation | V2 candidate | Status | Gap |
|---|---|---|---|---|---|
| **rest_advantage** | `match_intelligence.home_rest_days`, `away_rest_days` | **`processDbOnly.ts:2105-2113`** — `calcRestDays`: days between this fixture's date and the team's **most recent prior match date**, rounded. Null when no prior match | `football.fixture.scheduled_kickoff_at` — a direct Layer-1 read | **R** | **Fully recoverable.** Note V2's `feature.team.rest_advantage` (DEC-3) is the *same* quantity: *"days since the most recent completed fixture"* |
| **travel_impact** | `ModuleTravelRow` — 6 fields | **`mv_module_travel`** | `football.venue` coordinates exist; `feature.team.travel_impact` exists (S-5) | **P** | **View definition missing.** But V2 computes travel from venue coordinates directly (`travelLoad.ts`), so the *quantity* is reproducible; the *V1 view's exact windowing* is not |
| ″ | `home_travel_distance_km`, `away_travel_distance_km` | `processDbOnly.ts:2310-2311` — from a `travel` map | `football.venue` lat/long | **R** | Distances are geometric and reproducible |
| **form_gap_accuracy** | `homeIntel.form_index`, `awayIntel.form_index` | **`processDbOnly.ts:1534-1543`** — `(pts₅/15)×100 × 0.70 + (pts₁₀/30)×100 × 0.30`, rounded; `last10Score` falls back to `last5Score` when fewer than 10 matches; null when no last-5 | `feature.team.home_form` / `away_form` — **S-5 carried this formula across unchanged** (doc 23 DEC-3) | **R** | **Already reproduced in V2.** The only difference is V2's home/away split, which the definition's own `meaning` states |
| **confidence_calibration** | `match_intelligence.confidence_score`, `confidence_band` | **`processDbOnly.ts:2283-2300`** — `50 + 50 × (weightedSum / weightUsed)`, clamped 0–100, 1 dp; **requires ≥ 4 components with data**; bands Elite ≥95, Strong ≥85, Moderate ≥70, Risky ≥55, else Avoid | No V2 feature | **P** | The **component set and weights** feeding `weightedSum` need extracting from the same function; the banding and the ≥4 gate are recovered verbatim |
| ″ | `bandBacktests` | `backtestConfidenceBands.ts` | `calibration.*` — this is S-9's job | **R** | Correctly relocates to calibration, not a module input |

### 2.3 COMPETITION_EDITION-subject module

| Module | V1 input field | V1 source / derivation | V2 candidate | Status | Gap |
|---|---|---|---|---|---|
| **league_goal_profiles** | `match_intelligence.predicted_home_goals`, `predicted_away_goals` | `processDbOnly.ts` | No V2 feature | **P** | **A predicted quantity, not an observation.** See §4 — this may not be legitimately carried |
| ″ | `LeagueGapSummary` — 8 fields | `tournament_standings` + aggregation | `football.standing` **exists and is live-proven** | **R** | Aggregation recoverable |

### 2.4 V1 modules NOT carried into V2 — no recovery owed

| V1 module | Reads | Status |
|---|---|---|
| `btts_fatigue` | `match_intelligence` rest days + `mv_match_scoring_probabilities.btts_pct` | **DROP** |
| `clean_sheet` | `mv_match_scoring_probabilities` | **DROP** |
| `halftime` | `match_half_time_intelligence` | **DROP** |
| `weather` | `match_weather` | **DROP** |

All four were deliberately dropped (doc 56 §7.1, `v1Key: null` in reverse). **The
two genuinely missing `mv_*` views are read predominantly by dropped modules** —
`mv_match_scoring_probabilities` by `clean_sheet` and `btts_fatigue` only. Only
`mv_module_travel` is missing for a module V2 still carries.

---

## 3. Summary by status

| Status | Count | Which |
|---|---|---|
| **R — recoverable, derivation in repo** | 6 of 9 active | rest_advantage, form_gap_accuracy, consistency_index, giant_killer_index, home_away_split, league_goal_profiles (standings half) |
| **P — partial** | 3 | readiness_tracker (trend banding), travel_impact (`mv_module_travel`), confidence_calibration (component weights) |
| **U — unrecoverable here** | **0 fields for any active module** | — |

**The one true production dependency for an active module is
`mv_module_travel`**, and even there V2 computes travel from venue coordinates
independently, so the dependency is on V1's *window and weighting*, not on the
quantity itself.

---

## 4. V1 logic that must NOT be carried into V2

Recorded as findings, not as recovery targets:

1. **`predicted_home_goals` / `predicted_away_goals`** — a *prediction*.
   LC-71 and E4.05 make V2's output *"a characterization of the fixture, not a
   prediction of its result"*. Carrying a predicted scoreline as a module input
   imports the thing V2 exists to exclude. **Governance question, §5.**
2. **`baseline: { rate: 62.5, sample: 1179, provenance: "unreplayed" }`** —
   hardcoded rates. Doc 15 §6.3: these become `calibration.published_baseline`
   behind a sample gate. **Not module inputs at all.**
3. **`provenance: "unreplayed"`** — V1's own comment admits the figures
   *"contain lookahead"* because finished matches were scored using **current**
   team form. Any V2 baseline must be re-measured point-in-time; the V1 numbers
   cannot be promoted.
4. **`readiness_score`'s six-component formula** — superseded by doc 23 DEC-2's
   two-component rule. Recovering V1's formula is useful as *evidence*, but S-5's
   decision governs.
5. **`rotation_pressure_index`** — V1's own comment flags it as *"partially
   derives from congestion+fatigue+depth — the resulting partial double-count is
   per spec, flagged for the backtest pass"*. A known double-count, acknowledged
   and unresolved.

---

## 5. Minimum unresolved governance questions

> **S-0-a — Is `mv_module_travel` recovered from production, or is
> `travel_impact` re-specified on V2's own travel feature?**
> V2 already computes travel from `football.venue` coordinates
> (`feature/calculators/travelLoad.ts`, live). Recovering the V1 view buys
> golden-file comparability against a V1 output whose baselines are themselves
> *"unreplayed"*. **Re-specifying may be the better answer, and it is your call,
> not a recovery task.**

> **S-0-b — May `league_goal_profiles` consume a predicted quantity at all?**
> Its V1 inputs are predicted goals (§4.1). If not, the module needs a different
> input or stays inactive.

> **S-0-c — Does the golden-file test of doc 15 §6.4 step 5 still apply?**
> It requires a V2 reading to match V1's *"exactly, given the same inputs"*. For
> `readiness_tracker` that is now **impossible by decision** — DEC-2 changed the
> formula deliberately. The test must be scoped to modules whose rule was carried
> across, or replaced with a weaker criterion.

**Not blocking S-0's remaining work:** extracting the `confidence_score`
component weights and the `giant_killer` tier boundaries, both of which are in
files already identified and are transcription rather than decision.

---

## 6. What this changes about D-1

D-1 said *"S-6 waits for S-0"*, and that stands. But **S-0's shape is now
known**: it is not a production-archaeology exercise across thirteen views. It is

- **transcription** for six modules — the derivations are in two TypeScript files;
- **one production recovery or one re-specification** — `mv_module_travel`;
- **two extractions** — confidence weights, tier boundaries;
- **three governance answers** — S-0-a, S-0-b, S-0-c.

**No field of any active V2 module is unrecoverable.**

---

**No implementation. No migration created or applied. Three authorised changes
prepared and held. S-6 still waits on S-0 under D-1.**
