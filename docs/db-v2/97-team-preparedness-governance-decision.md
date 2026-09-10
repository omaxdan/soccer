# Team Preparedness — Governance Decision Record

**Type:** Governance / definition decision record. Nothing implemented.
**Status:** Authoritative record of the Team Preparedness product decisions approved at the governance checkpoint following the read-only Component Specification (Team Preparedness Phase 0 + spec).

> **Nothing was implemented by this record.** No `feature_definition`, `feature_version`,
> `feature_dependency`, `feature_value`, calculator, migration, registry seed, snapshot,
> S-9, API, or frontend change. No edit to `readiness_score`, `travel_impact`,
> `travel_distance`, `congestion_index`, `home_form`/`away_form`, `home_win_rate`/
> `away_win_rate`, or any calculator. `team.preparedness` and `team.preparedness_core`
> are **not** created. This record fixes decisions and contracts only.

| | |
|---|---|
| **Target feature (proposed, NOT created)** | `team.preparedness` — `subject_kind = TEAM`, per-fixture **as-of**, `contextKinds = [ALL_COMPETITIONS]` |
| **Existing `team.readiness_score` v1.0.0** | **Untouched and separate** (DEC-2: rest 50 / congestion 50). Not renamed, not redefined, not superseded |
| **Product direction** | D1 — pursue the broader 7-component Team Preparedness model |
| **Travel path** | **B** — keep the governed `team.travel_burden` track; `travel_impact` is **not** repurposed |
| **Weight policy** | **No silent renormalisation** — a deferred/unavailable component's weight is never auto-redistributed |
| **Reconciles** | docs 23 (DEC-2), 34, 66, 67, 68, 71 — no conflict (see §Travel reconciliation) |

---

## 1. Master contract (proposed `team.preparedness`)

Seven components, exact weights as approved. **No component is removed and no weight is renormalised.**

| # | Component | Weight | Governed input (this record) | Governance status |
|---|---|---|---|---|
| 1 | Form | 30 | `team.home_form` / `team.away_form` (venue-split, reuse) | **DEFINITION GOVERNED — implementable by reuse** |
| 2 | Opponent Strength | 20 | composite (PPG 30 / Win% 20 / Position 20 / Squad Quality 15 / Lineup Versatility 15) | **NOT YET GOVERNED — blocked** |
| 3 | Congestion | 15 | `team.congestion_index`, oriented `100 − index` (reuse) | **DEFINITION GOVERNED — implementable by reuse** |
| 4 | Travel | 15 | `team.travel_burden` (C-2), **not** `travel_impact` | **DEFINITION GOVERNED (C-2) — implementation pending** |
| 5 | Home/Venue | 10 | `team.home_win_rate` / `team.away_win_rate` (Option A, reuse) | **DEFINITION GOVERNED — implementable by reuse** |
| 6 | Squad Stability | 5 | (undefined) | **HUMAN DECISION REQUIRED — blocked** |
| 7 | Motivation | 5 | (none) | **DEFERRED** |

Team Preparedness is a **TEAM-subject, per-fixture as-of** feature and is explicitly permitted to
consume **governed opponent-side features** (a new dependency shape relative to `readiness_score`,
which reads only own-team features).

## 2. Governance coverage (corrected arithmetic — no invented percentage)

The composite is scored out of **100 weight points**. Category totals, with the denominator stated:

- **Definition governed** (input contract decided): Form 30 + Congestion 15 + Travel 15 + Home/Venue 10 = **70 of 100 weight points**.
  - Of those, **implementable now by reuse of existing governed features**: Form 30 + Congestion 15 + Home/Venue 10 = **55 of 100**.
  - **Definition governed but implementation pending** a downstream build: Travel 15 (`travel_burden` is definition-authorized only — see §5).
- **Definition NOT yet governed** (require product decisions and/or new governed features before they can be an input): Opponent Strength 20 + Squad Stability 5 + Motivation 5 = **30 of 100 weight points**.

The earlier read-only specification's statement that "35% is non-governable" is **incorrect and is superseded by this record.** No further percentage is asserted beyond these explicitly-denominated category totals.

## 3. Form (30) — DECISION
- Consume the **existing governed** venue-split features exactly; **no new blended form calculation** is created.
  - Home team's Form input → its `team.home_form`.
  - Away team's Form input → its `team.away_form`.
- Formula is the verified DEC-3 form (`0.7·(pts5/15·100) + 0.3·(pts10/30·100)`, full-window normalised, `meaningful_sample_threshold = 5`). **Unchanged; not re-derived.**

## 4. Congestion (15) — DECISION
- Consume the **existing** `team.congestion_index`; orient as **`100 − congestion_index`** (identical to the established `readiness_score` orientation, because the feature is `LOWER_IS_STRONGER`).
- Retain the existing **28-day backward** as-of semantics. No transform beyond orientation. No change to the feature.

## 5. Travel (15) — DECISION (Path B) and reconciliation of docs 66/67
- The Team Preparedness Travel input is **`team.travel_burden`** — **not** `team.travel_impact`.
- `team.travel_impact` v1.0.0 **remains untouched and is NOT repurposed** for preparedness (doc 66 §13; doc 63 §11). It keeps its registry meaning, calculator (`travelLoad.ts`), provenance, and zero consumers. Its eventual disposition (`is_active = false`, never a rename) stays a separate future decision.
- `team.travel_distance` **remains the underlying physical travel evidence** (doc 65 verified) and is unchanged.
- **`team.travel_burden` definition gate (doc 67) is hereby CLOSED with definition C-2:**
  - **distance + frequency, from travel-only inputs** — total distance = `travel_distance.value`; frequency (leg count) = `travel_distance.sample_observation_count`. **No new Layer-1 feature required** for v1.0.0.
  - **Recency-blind for v1.0.0** — recency is explicitly OUT; a future recency-sensitive burden requires a dedicated `team.travel_recency` feature at its own gate.
  - **Double-counting avoided by construction** — `travel_burden` consumes travel-only inputs; recovery (`rest_advantage`) and workload (`congestion_index`) enter preparedness once, at the composite.
- **This authorizes the DEFINITION only, not implementation.** The following remain OPEN gates and are **not** decided here:
  - the numeric **combination rule** (doc 68's additive-separable `φ(distance) + λ·ψ(legs)`, with `λ` deferred/≈0 for v1.0.0) — a modelling gate, unimplemented;
  - `unit` / `direction` (almost certainly `LOWER_IS_STRONGER`) / `meaningful_sample_threshold` confirmation;
  - readiness-integration and the Layer-3 module surface.
- **No conflict:** closing the C-2 *definition/input-set* is consistent with docs 66 (location = `travel_burden`), 67 (C-2 recommended), 68 (combination rule builds on this input set), and 71 (module #5 unchanged). Docs 72/79 only note `travel_burden` is unmaterialised (λ=0); nothing supersedes the track. The only "superseded" travel/readiness item on record is `readiness_score`'s V1 six-component formula (by DEC-2), which this record preserves.

## 6. Home/Venue (10) — DECISION (Option A)
- Home team's Home/Venue input → its `team.home_win_rate`; away team's → its `team.away_win_rate` (reuse the existing edition-scoped venue-side win-rate features).
- **No** home-advantage differential feature is created at this stage.

## 7. Opponent Strength (20) — DECISION (structure) / BLOCKED (inputs)
- Retain the internal weighting: **PPG 30 / Win% 20 / Position 20 / Squad Quality 15 / Lineup Versatility 15**.
- **Opponent PPG, Win%, and Position must first be governed as as-of features** before implementation. They do not exist as governed opponent-facing features today; the as-of standings-reconstruction *capability* exists (`giant_killer_ppg` uses each opponent's pre-match band) but a governed feature does not.
- **Opponent Position MUST use reconstructed pre-match standings, never the current `standing` table** (the primary leakage vector).
- **Squad Quality (15) and Lineup Versatility (15)** are player-dependent and remain **HUMAN DECISION REQUIRED** (§8/§9).
- Therefore Opponent Strength as a composite is **BLOCKED** until its sub-features are governed and the two player sub-inputs are defined. `team.opponent_strength` is **not** created here.

## 8. Squad Quality — HUMAN DECISION REQUIRED
- No market value, reputation, FIFA rating, transfer value, or any other **ungoverned proxy** may be invented. The repository has no governed quality source wired to this.
- A defensible definition **and** a governed source must be approved before implementation, along with the player/lineup corpus (§ below). Blocked.

## 9. Lineup Versatility — HUMAN DECISION REQUIRED
- An interpretation must **not** be selected merely because `lineup_selection.position_code` / `lineup.formation` exist. Candidate meanings (player positional versatility, formation variety, structural variation, bench versatility) require a governed choice, and a multi-fixture corpus per team. Blocked.

## 10. Squad Stability — HUMAN DECISION REQUIRED
- `team.squad_stability` remains declared-but-never-calculated (R-1). No calculator is created until its exact definition (e.g. starting-XI continuity / lineup-change rate / turnover) is approved, and a multi-fixture corpus exists. Blocked.

## 11. Motivation — DEFERRED
- No governed definition, feature, source, or evidence exists. **Do not invent** must-win, relegation pressure, title race, rivalry, fixture importance, or positional proxies (D2). To reopen: a product-owner-supplied governed definition **and** a verified evidence source. No placeholder calculator.

## 12. Weight handling — DECISION
- **No silent renormalisation.** If a component is deferred or unavailable, its weight is **not** automatically redistributed. Any weighting over a subset of components is itself a governed decision with an explicitly stated denominator.
- **No `team.preparedness_core`** and no interim second readiness score are created at this stage.

## 13. Final Preparedness feature — DECISION
- `team.preparedness` is **not** created until its declared contract is fully governed **and** all required inputs exist.
- Implementation follows the **derived-feature prerequisites first** (govern definitions → authorize/ingest corpus where needed → build derived features with as-of tests → then compose the feature).

## 14. Evidence / trust & as-of contract (mandatory)
- Every Team Preparedness input must consume a **governed derived feature**, never a raw provider table directly.
- Every final `team.preparedness` reading must preserve **lineage, feature versions, sample-observation counts, provenance class, and instance-level consumed-input information** (as `readiness_score` does). **PD-07: absence ≠ zero** — a missing input is a missing edge, never a substituted 0.
- **As-of rule:** for a fixture at kickoff **T**, only information observable at or before **T** may contribute. Forbidden: future results, current-table position for historical fixtures, future lineups, future availability, post-match player statistics, future travel/form/opponent state.

## 15. Human decisions still required to proceed
- Opponent Strength: govern the as-of opponent PPG / Win% / Position features and the composite.
- Squad Quality: definition + governed source.
- Lineup Versatility: definition + corpus.
- Squad Stability: definition + corpus.
- Motivation: confirm permanent deferral or supply a governed definition + source.
- Player/lineup corpus scope (fields, fixtures-per-team, season coverage) for the player-dependent components.
- Weighting policy if the model is released before all seven components are governed (no silent renormalisation).

---

**Decisions authorized by this record:** Form (venue-split reuse), Congestion (`100 − index`), Home/Venue (Option A), Travel input = `team.travel_burden`, and the closure of the `travel_burden` **definition** as **C-2** (definition only — implementation remains gated). Everything else is recorded as blocked/deferred/human-decision-required as above. No implementation, migration, calculator, ingestion, or feature creation is authorized by this record.
