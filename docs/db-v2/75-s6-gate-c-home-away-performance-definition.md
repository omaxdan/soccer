# Phase 8 — S-6 Gate C: `team.home_away_performance` Definition & Audit

## Definition + architectural audit only · nothing implemented

| | |
|---|---|
| Prior | Gate A `52dd663` · migration 023 `0e4f9a8` · entry contract `fadd53c` |
| **Decision** | **IMPLEMENTATION NOT AUTHORIZED** — the V1 *formula* is fully recoverable, but faithful recovery needs a **window** decision and a **context** capability the current S-5 does not have. Neither is a coefficient/threshold invention; both are surfaced, not guessed. |
| **What is frozen** | win-rate formula, draw handling, no-value, two-features, orientation, provenance, observation count |
| **What blocks** | (1) window: V1 is **cumulative**, the V2 read layer caps at 10/side; (2) context: venue performance is governed **COMPETITION_SCOPED**, but S-5 computes **only ALL_COMPETITIONS** today |
| Next gate | **Gate C-i — a governance decision on window + context**, before any implementation |

Nothing implemented. No calculator, feature/registry row, dependency, module,
migration change, read/write-layer change, or touch to travel/readiness. This gate
revises one optimistic assumption in doc 73 (that the feature was "bounded
transcription with no modelling judgment") with source evidence.

---

## 1. Real data path

Verified in source. The signal is derivable from Layer-1 football relations, but
**not through the existing feature read path**:

| Need | Source | Available to S-5 today? |
|---|---|---|
| completed fixtures | `football.fixture` (`lifecycle_state_code='COMPLETED'`, `scheduled_kickoff_at < as_of`) | yes |
| result / goals | `football.result` (home/away goals; oriented to subject in `read/fixtures.ts`) | yes |
| home/away designation | `fixture.home_team_id` / `away_team_id` → `is_home` in the read | yes |
| team identity, kickoff | `fixture` | yes |
| competition context | `fixture.competition_edition_id` | **read, but S-5 does not calculate per-edition — §3** |
| **cumulative venue history** | all completed fixtures per side in scope before `as_of` | **NO — `readCompletedFixtures` caps at 10/side + 28d (§4)** |

Existing conventions confirmed: percentage/index features use `unit='index'`,
`value_scale=2`; `sample_observation_count` = fixtures the value rests on;
provenance via `min(ceiling, weakest input)`; sources declared in
`registry/declare.ts`; versions in `feature_version`. The nearest analogue,
`formBackfill` (`home_form`/`away_form`), establishes the venue-side patterns.

## 2. V1 semantic rule — recovered

Authoritative source: `processDbOnly.ts:2680–2711` (`processTeamVenuePerformance`),
plus doc 55 for the module rule that consumes it.

```ts
// processDbOnly.ts:2690-2691
const homeWin = h.matches > 0 ? +(h.wins / h.matches * 100).toFixed(1) : null;
const awayWin = a.matches > 0 ? +(a.wins / a.matches * 100).toFixed(1) : null;
// aggregation (2665-2678): over ALL rows of team_form_history joined to matches
//   s.matches++ per fixture; s.wins++ when result === 'W'
```

| Question | Answer | Class |
|---|---|---|
| What is "performance"? | **win rate** = `wins / matches × 100`, per venue side | **FROZEN** |
| win% / points% / other? | win% (there is also a PPG-based `venue_advantage_score`, but `evalHomeAway` consumes win-pct-derived disparity — §14) | **FROZEN** |
| home & away separate? | **yes** — two fields, and V2's convention makes them two features ("home and away are separate features, never one index with a split flag") | **FROZEN** |
| disparity definition | `home_win_pct − away_win_pct`; `evalHomeAway` gates on `\|disparity\| ≥ 40` (doc 55) | **FROZEN — but a MODULE concern (Gate D), not the feature (§7)** |
| disparity absolute or signed? | stored signed; module uses absolute for the threshold | **FROZEN (module)** |
| population / window | **cumulative** over `team_form_history` — **no rolling window, no explicit competition filter in the function** | **UNDECIDED for V2 — §4** |
| minimum sample | none in the feature; `null` only when `matches = 0` | **FROZEN** (threshold is the module's, §14) |
| insufficient observations | `matches = 0 → null` (NO VALUE) | **FROZEN** |
| draws | counted in `matches` (denominator), never in `wins` (numerator) | **FROZEN** |
| one feature or multiple? | **two** (home, away) — §8 | **FROZEN by V2 convention** |
| how `evalHomeAway` consumes it | `Neutral type → NEUTRAL · \|disparity\| ≥ 40 → SUPPORTS · else NEUTRAL` (doc 55) | **FROZEN (module, Gate D)** |

**No modelling invention is required for the formula.** The only genuinely
undecided parts are window (§4) and context (§3) — both scope decisions, not
coefficients.

## 3. V2 semantic conflicts & context

- **Overlap with `home_form`/`away_form`?** Related but distinct: form is a
  **weighted points%** over a **rolling 10** (`0.7·pts₅/15 + 0.3·pts₁₀/30`);
  venue performance is an **unweighted win%** over a **cumulative** population. Same
  venue-side split, different quantity and window. No collision — this is a new
  feature, not a duplicate.
- **Context kind — the governed answer is COMPETITION_SCOPED.** The `context_kind`
  vocabulary names it explicitly: *"COMPETITION_SCOPED … Form quality,
  opponent-adjusted strength, **venue performance**."* This is the governed home
  for this signal and it directly resolves the **S-0 cup-contamination** finding —
  a team's "home fortress" identity should reflect one competition edition, not
  mixed cup ties. Precedent: `home_form`/`away_form` are registered with **both**
  `ALL_COMPETITIONS` and `COMPETITION_SCOPED`.
- **The catch (§1, verified in `types.ts`):** `CALCULATION_CONTEXT_KIND =
  'ALL_COMPETITIONS'` — **S-5 computes only ALL_COMPETITIONS values today.** The
  COMPETITION_SCOPED bindings on the form features "remain registered and valid …
  adding those values later is additive," but **no feature has ever produced a
  COMPETITION_SCOPED value.** Faithful venue performance would be the *first*, which
  requires S-5 to gain edition-scoped calculation and to write
  `context_competition_edition_id` — an engine capability that does not exist. **A
  new context kind is NOT needed; the existing one is not yet computable.**

## 4. Mathematical contract (and the window gap)

Per venue side (home, away), over the population P defined by the §3/§C-i decision:

```
matches   = |{ f ∈ P : completed, kickoff < as_of }|
wins      = |{ f ∈ P : goalsFor > goalsAgainst }|      (draw ⇒ not a win; loss ⇒ not a win)
win_rate  = wins / matches × 100          when matches > 0
          = NO VALUE (no row)             when matches = 0        (PD-07, LC-05)
```

- **numerator:** wins on that side. **denominator:** matches on that side.
- **draws:** denominator only.
- **precision:** exact `numeric` at working scale in the calculator; unrounded
  until the write boundary (V2 contract). **write-time scale:** `value_scale = 2`
  (index convention; V1 stored 1 dp — V2's 2 dp is a superset, no information lost).
- **zero handling:** a side that played and never won is `win_rate = 0` **with a
  row** (a real observation), categorically distinct from NO VALUE (never played
  that side).
- **insufficient sample:** no feature-level suppression; the count travels and the
  module applies any threshold (§14).

**The window gap.** V1's population P is **cumulative** (all form history). The V2
read `readCompletedFixtures` returns only the **10 most recent per side** (+28-day
congestion). It therefore **cannot** supply a faithful cumulative venue win%.
Reusing the rolling-10 would silently change the quantity from a season-long
*identity* to a *recent* win% — a **reinterpretation of V1** the gate forbids. So
the window is a real decision with a real read-layer consequence (§C-i).

## 5. Observation count (D-5c-i)

`team.home_away_performance` is **non-composite** (reads football relations, not
features). Under the ratified D-5c-i, a non-composite feature's
`sample_observation_count` is **its own count, passed through unchanged** — here,
**`matches` on that side**. `MIN(consumed)` does not apply (no lineage, R-53
exemption). No new observation-count rule.

## 6. Provenance

**DERIVED (rank 3).** It is computed from `football.result` (OBSERVED, rank 4) but
is itself a derivation (a rate over counted fixtures). Under `min(ceiling, weakest
input)` the ceiling is DERIVED; there is no feature input to weaken it. **No
upgrade to OBSERVED** merely because the underlying goals are observed — the win
*rate* is derived, exactly as `home_form` is DERIVED though built from observed
results.

## 7. Orientation

**Per-side feature: `HIGHER_IS_STRONGER`** — a higher win rate on a given side is
unambiguously stronger. The **disparity, the "home-reliant/road-warrior" type, and
the `|disparity| ≥ 40` status are FIXTURE-of-comparison / MODULE concerns** and
must **not** leak into the team feature. The module `home_away_split` (TEAM
subject, Gate D) reads the team's two win-rate values, derives `disparity =
home − away` and the type, and applies `evalHomeAway`. The feature stays two clean,
oriented magnitudes.

## 8. Registry contract (specified, NOT seeded)

Two features, mirroring `home_form`/`away_form`. All fields verified against
`006_feature_registry.sql`.

| slot | `team.home_win_rate` | `team.away_win_rate` |
|---|---|---|
| feature_key | `team.home_win_rate` | `team.away_win_rate` |
| layer | 1 (reads football; `consumed: []`) | 1 |
| subject_kind | TEAM | TEAM |
| unit | `index` | `index` |
| value_scale | 2 | 2 |
| direction | `HIGHER_IS_STRONGER` | `HIGHER_IS_STRONGER` |
| max_provenance | DERIVED | DERIVED |
| meaningful_sample_threshold | **UNDECIDED** — tied to the window (§C-i); V1 has none at the feature | same |
| context kind | **COMPETITION_SCOPED** (governed) — pending §3 capability; ALL_COMPETITIONS only if the reinterpretation in §C-i is chosen | same |
| sources | `football.fixture`, `football.result` | same |
| calculator | new `venue_win_rate` (one calculator, two feature keys — the `formBackfill` pattern) | same |
| version | `1.0.0` | `1.0.0` |
| rationale | "Win rate by venue side, `wins/matches`, per V1 `processTeamVenuePerformance`; supplies `home_away_split`" | same |
| predecessor | none | none |

*(The feature key is rendered as two keys rather than the single
`team.home_away_performance` the gate named, because V2 forbids "one index with a
split flag" — §2/§7. This is a naming/shape decision the C-i note should ratify.)*

## 9. V1 golden policy (S-0-c-i)

`home_away_split` is a **carried-across** module — *if* the faithful cumulative +
COMPETITION_SCOPED definition is chosen, a V1 golden comparison is legitimate:

- **Compared:** `wins/matches × 100` per side, against V1's `team_venue_performance`
  rows.
- **Valid population:** teams/editions where V1's `team_form_history` and V2's
  completed-fixture set cover the **same** fixtures and the **same** competition
  scope — otherwise the comparison mixes populations (S-0-c-i's own caveat).
- **Acceptable divergence:** rounding only (V1 1 dp vs V2 2 dp) — ≤ 0.05 after
  aligning scale; itinerary/венue issues do not arise here.
- **Genuine regression:** any difference in `wins`, `matches`, or draw handling.

**If instead the reinterpreted window/context is chosen (§C-i Option B), the V1
golden becomes INVALID** (different population), and per S-0-c-i the test reverts to
V2 goldens derived from the declared rule. So the golden policy is **contingent on
the C-i decision** — which is itself a reason to take that decision first.

## 10. Adversarial test matrix

| # | Case | Expected (per the frozen formula) |
|---|---|---|
| 1 | all home wins (n home) | `home_win_rate = 100`, count n |
| 2 | all away wins | `away_win_rate = 100` |
| 3 | equal home/away performance | both rates equal; disparity 0 → module NEUTRAL |
| 4 | draws present | draws in denominator: 3 wins / 5 (2 draws) → 60 |
| 5 | zero observations one side | that side → **NO VALUE (no row)**; other side normal |
| 6 | one observation one side | rate ∈ {0,100}, count 1 — a row (threshold is the module's call) |
| 7 | unequal home/away counts | each rate over its own denominator; counts differ, both valid |
| 8 | insufficient total sample | still a row per side that played; consumer/module judges via count |
| 9 | cup + league contamination | **the crux** — ALL_COMPETITIONS mixes them; COMPETITION_SCOPED excludes cups (§3) |
| 10 | competition-scoped vs all | different values; S-5 must produce the intended context (§3) |
| 11 | duplicate fixtures | must be deduped by fixture identity; a double-count corrupts the rate |
| 12 | cancelled/unplayed | excluded (`lifecycle_state_code = 'COMPLETED'` only) |
| 13 | boundary dates | `kickoff < as_of` strict — the generating fixture never counts |
| 14 | exact 40 disparity | module SUPPORTS (`≥ 40`) — **Gate D**, feature just supplies the rates |
| 15 | just below 40 | module NEUTRAL — Gate D |
| 16 | just above 40 | module SUPPORTS — Gate D |
| 17 | zero vs NO VALUE | 0 (played, never won) is a row; NO VALUE (never played side) is no row |

Cases 9–10 are the ones the current data path cannot yet honour faithfully; 14–16
belong to the module, confirming the feature must not embed the threshold.

## 11. Implementation gate

**IMPLEMENTATION NOT AUTHORIZED.**

The formula is frozen and needs no invention, but **the V2 data path does not
support faithful recovery today**, and choosing a supported shortcut would
reinterpret V1 — which requires a governance decision, not a silent choice:

1. **Window** — V1 is cumulative; the read layer caps at 10/side. Either extend the
   read to a cumulative edition-to-date venue history, or consciously redefine the
   feature as recent-window (a reinterpretation, changing the module's meaning and
   its golden policy §9).
2. **Context** — venue performance is governed COMPETITION_SCOPED, but S-5 computes
   only ALL_COMPETITIONS. Either give S-5 competition-scoped calculation (this
   feature becomes the first), or register ALL_COMPETITIONS at v1.0.0 and accept
   cup contamination (the exact thing S-0 flagged).

These are genuine decisions with infrastructure consequences, so per the gate's own
rule they are **surfaced, not resolved**. This revises doc 73's expectation that the
feature was "bounded transcription with no modelling judgment": the *formula* is,
but the *scope/plumbing* is not.

## 12. Deferred / non-decisions

Deferred to Gate C-i: window (cumulative vs rolling); context (COMPETITION_SCOPED
capability vs ALL_COMPETITIONS-now); the one-vs-two-features naming; the
`meaningful_sample_threshold`. Not decided here: the module's disparity/type/status
(Gate D); any read-layer or S-5-engine change (their own gates); anything in
travel, readiness, DEC-2, or migration 023.

---

## STATUS

- **V1 rule recovered:** YES — `wins/matches × 100` per venue side, draws in denominator, cumulative, null on zero (`processDbOnly.ts:2711`)
- **Formula classification:** FROZEN
- **Window:** **UNDECIDED** — V1 cumulative; V2 read layer caps at 10/side (reinterpretation forbidden without a decision)
- **Context kind:** governed **COMPETITION_SCOPED** (vocabulary names "venue performance"), but S-5 computes ALL_COMPETITIONS only — **capability gap**
- **Overlap with home/away form:** none — win% vs weighted points%, cumulative vs rolling
- **Shape:** two features (`team.home_win_rate`, `team.away_win_rate`), not one index with a split flag
- **Observation count:** each side's `matches`; non-composite pass-through (D-5c-i)
- **Provenance:** DERIVED (no upgrade)
- **Orientation:** per-side HIGHER_IS_STRONGER; disparity/type/threshold stay at the module (no leak)
- **NO VALUE:** `matches = 0 → no row`; 0% (played, never won) is a real row
- **V1 golden policy:** valid only under the faithful (cumulative + COMPETITION_SCOPED) definition; else V2-derived goldens (S-0-c-i)
- **Modelling invention required:** NONE (formula); but scope decisions + infrastructure are
- **Implementation authorized:** **NO**
- **Next gate:** **Gate C-i — governance decision on window + context** (cumulative-edition COMPETITION_SCOPED with the required read/S-5 capability, vs a reinterpreted rolling ALL_COMPETITIONS v1.0.0), before Gate C-implementation and Gate D
