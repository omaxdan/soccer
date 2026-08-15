# Phase 8 — S-6 Module #5 Governance Decision

## Governance decision only · nothing implemented

| | |
|---|---|
| Prior | `9a4617b` (doc 70) · features `127da55`/`7f6e9a4`/`32a0e33`/`ca0bee5`/`08a19cb` |
| **Executive decision** | **KEEP module #5 unchanged** — `FIXTURE`, `OUTCOME_SCORED`, "Does distance matter here?". No new module, no version bump, no mode/subject change. |
| **What changes** | Nothing in the registry. When S-6 unblocks, #5 is implemented using the **corrected `team.travel_distance`** as evidence. |
| **Smallest truthful architecture** | Option **A** (Step 5). Not B (supersede), not C (add a contextual module), not D (retire). |
| **Implementation authorized** | **NO** — blocked on S-0 → S-6 (D-1). |

Nothing implemented. No registry change, module row, module version, dependency,
value, calculator, migration, `travel_burden`/`travel_recency`, readiness or DEC-2
change, no invented coefficient/threshold.

---

## 1. Executive decision

Module #5 `travel_impact` is **correct as registered** and should be **left
untouched**. Its `FIXTURE` subject and `OUTCOME_SCORED` mode are deliberate,
consistent with V2's conventions, and — given the corrected travel measurement —
*more* justified now than when they were seeded, not less. The one change the
travel programme delivers is **better evidence**: `team.travel_distance`
(empirically verified, doc 65) replaces the defective V1 travel signal that made
the module's outcome question unanswerable. No governance action is required to
keep the contract; the only pending work is implementing #5 under S-6.

The brief explicitly invited "keep module #5 unchanged" as a valid result. It is
the right one, and the following sections show why each alternative is larger than
the truth requires.

## 2. Existing module #5

```
module_key            travel_impact          (module schema; distinct from feature.team.travel_impact)
display_number        5
display_name          Travel Impact
question              "Does distance matter here?"
subject_kind          FIXTURE
entitlement_key       TRAVEL_IMPACT
calibration_mode      OUTCOME_SCORED
outcome_dimension     MATCH_RESULT
is_active             true      (registered contract; S-6 has no evaluation logic yet)
v1_key                travel
```

A registered architectural contract, not an implemented intelligence path.

## 3. Existing contract (the full module set, for context)

From `seed/moduleRegistry.ts`, the thirteen approved modules by subject × mode:

| subject | OUTCOME_SCORED | CONTEXTUAL |
|---|---|---|
| **TEAM** | home_away_split, readiness_tracker, giant_killer_index | consistency_index, squad_stability |
| **FIXTURE** | **travel_impact (#5)**, rest_advantage (#6), form_gap_accuracy | confidence_calibration, historical_advantage, risk_assessment, match_context |
| **COMPETITION_EDITION** | league_goal_profiles | — |

This table is the decisive context for both conflicts.

## 4. Subject-kind analysis — FIXTURE is correct

| Question | FIXTURE (registered) | TEAM (alternative) |
|---|---|---|
| What does it answer? | "in this matchup, does the travel situation bear on the result?" | "how much/elevated is one team's travel?" |
| Evidence required | **both** teams' `team.travel_distance` (a differential) | one team's `team.travel_distance` |
| Home/away differential | native — the module *is* the comparison | not expressible |
| Readiness compatibility | indirect (readiness is TEAM; see §17) | superficially closer, but readiness consumes the **feature**, not this module |
| Match Report compatibility | high — a fixture card is about the matchup | needs pairing of two team readings |
| Historical-pattern compatibility | high — "did distance register, historically, in fixtures like this?" | weaker — a team's own travel history |
| V1 continuity | **exact** — V1's travel was fixture-level, "one fixture, both sides" (doc 60 §5) | breaks continuity |
| Double-counting risk | none | none |
| Implementation complexity | reads two feature values | reads one |

**The decisive evidence is the sibling module.** `team.rest_advantage` is a
**TEAM** feature, yet module #6 `rest_advantage` is **FIXTURE** ("Who is fresher,
and does it register?"). That is precisely the travel relationship:
`team.travel_distance` is a TEAM feature, and module #5 is a FIXTURE module ("Does
distance matter here?"). V2 has a **deliberate, repeated convention**: recovery/
travel comparison features are measured per team, and the *module* asks whether the
between-sides differential registers in the fixture. Changing #5 to TEAM would
break a convention the schema demonstrates twice, and would not even serve
readiness (which reads the feature layer, not this module — §17).

**Recommendation: keep `FIXTURE`.** No governed change.

## 5. Calibration-mode analysis — OUTCOME_SCORED is correct

What each mode means in V2 (from `002`/`008`/`009`):

| | OUTCOME_SCORED | CONTEXTUAL |
|---|---|---|
| Claim permitted | "X bears on outcome dimension D" | "X characterises an environment" (no outcome claim) |
| `outcome_dimension` | required (MATCH_RESULT) | must be NULL |
| `published_baseline` | built by S-9 (`outcome_dimension` NOT NULL) | none — no baseline row exists for it |
| `sample_gate` | governs the published rate (LC-133) | N/A to a rate; reading's own count is the control |
| S-9 role | validates band → outcome `hit_rate`/`lift` | cannot validate an outcome relationship |
| Supports "elevated exposure" verdict | not directly | yes |
| Supports readiness evidence | via outcome relationship | via characterisation |
| Preserves historical outcome evidence | **yes** — accumulating `calibration_result` series | no |

`CONTEXTUAL` is **not** "no calibration" — it is a positive declaration that the
module characterises an environment and makes **no outcome claim**, so it is
structurally exempt from `published_baseline`/`sample_gate`/S-9 outcome validation.

**Why OUTCOME_SCORED stays correct:**

1. **The module's question is literally an outcome question.** "Does distance
   *matter* here?" = does travel register in the *result* in this competition.
   That is `MATCH_RESULT`, by definition.
2. **V1's "doesn't predict" verdict was on DEFECTIVE data.** Doc 60 §6 records
   *"single-trip distance alone does not predict"* — but that was V1's home-radial,
   away-only, single-trip band table, the very model S-0-a condemned. The
   **corrected `travel_distance`** (successive-venue itinerary, verified) is a
   different, better measurement. Whether *it* predicts is an **open empirical
   question V1 never properly asked.** Keeping OUTCOME_SCORED is what lets S-9
   finally ask it with good evidence.
3. **OUTCOME_SCORED + sample_gate is the trust mechanism, not a liability.** If the
   corrected distance also fails to predict, the module honestly reports NEUTRAL /
   unverified (LC-133: pass the gate or be marked unverified). That is the platform
   declining to claim travel matters when the data says it doesn't — exactly the
   behaviour that earns trust.
4. **CONTEXTUAL would remove the check.** An "exposure is elevated" claim with no
   outcome dimension can never be validated against whether it matters. Converting
   #5 to CONTEXTUAL would let an unfalsifiable claim through and *discard* the
   outcome-evidence substrate — a larger, less truthful architecture.

**Recommendation: keep `OUTCOME_SCORED` / `MATCH_RESULT`.** No governed change.

## 6. V1 evidence — what it does and does not mean

Doc 60 §6: V1's author found away win rate moves <3 pp across distance bands, using
V1's defective travel model, and V1's band table + hardcoded rates are disowned
(they belong in `calibration.published_baseline` behind a gate, "not module
inputs"). Mapping to the brief's Step-5 options:

- **Not D (retire):** the question is legitimate and newly answerable with corrected data.
- **Not B (contextualise):** that abandons the outcome test precisely when good data first makes it possible.
- **Not C (add a contextual module):** unjustified — see §11.
- **A (keep outcome-scored, implement with corrected evidence):** correct. V1's
  verdict is a *prior*, not a *result* for the corrected measure, and it must not
  be ported as literals (its rates go to calibration, gated).

## 7. Travel-distance evidence contract

Module #5 consumes, when implemented:

- `feature_value(team.travel_distance)` for the **home** team;
- `feature_value(team.travel_distance)` for the **away** team;

each a `module_evidence_item` with `contribution_direction`. This is the corrected,
verified Layer-1 measurement — the better evidence that is the whole point of the
travel programme. `team.travel_impact` (the legacy V1-derived *feature*) is **not**
silently redefined and is **not** required as evidence.

## 8. Travel-burden relationship

`travel_burden` adds **no information at λ=0** (`travel_burden == travel_distance`).
So module #5 cites `travel_distance` **directly**; `travel_burden` becomes an
evidence item only when λ>0 or recency joins (doc 68/69). Do not materialise
`travel_burden` for this module. This is the previous gate's decision, unchanged.

## 9. Home/away treatment

A FIXTURE module combines the two teams' travel values. The schema **supports
directional/paired evidence** natively: `module_evidence_item.contribution_direction`
(SUPPORTS/CONTRADICTS/NEUTRAL) + `contribution_weight`, one item per side. The
**combination formula** (away − home, relative exposure, etc.) is a **future
modelling gate**, not decided here — no formula is invented. What is decided: the
schema already accommodates the differential without new structure.

## 10. Contextual normalization

Not applicable under the recommended OUTCOME_SCORED mode. "Normal vs elevated" is a
CONTEXTUAL concept; #5's normalisation is instead the **outcome baseline** — the
competition's base `MATCH_RESULT` rate that S-9 compares the travel band's rate
against, keyed per competition in `published_baseline` (the correct home for
cross-league relativisation, doc 69/70). No population statistic, z-score,
percentile, or threshold is invented.

## 11. Why NOT a second, contextual module

Option C (keep #5 outcome-scored + add a CONTEXTUAL exposure module) is rejected
**now**:

- It is a **14th module** — expanding a governed, deliberately-closed 13-module set
  is a product decision, not a consequence of this gate.
- At λ=0 a contextual "elevated exposure" reading adds little over simply
  displaying `travel_distance`, and there is **no outcome-free baseline mechanism**
  in the schema (`published_baseline` is outcome-scored) — it would need a new
  read-time population statistic that does not exist.
- The honest outcome question is not yet answered; building a parallel
  characterisation before testing whether travel matters is architecture ahead of
  evidence.

If, after S-9 tests the corrected measure and product demand is shown, a contextual
travel-exposure module is wanted, that is its own future product gate.

## 12. Strength semantics

`module_reading.strength` is the module's own, not the feature's direction. For #5:
higher strength = **stronger evidence that travel bears on the result in this
fixture/competition** (a large, calibrated differential), NOT "more km." It is
explicitly decoupled from `team.travel_distance` being UNSIGNED. Direction and
exact scaling are part of the implementation gate; the semantic is fixed here.

## 13. Confidence semantics

`confidence ∈ [0,1]` from existing substrate: `module_evidence` completeness
(declared/present/below_threshold/estimated), the reading's
`sample_observation_count`/`sample_meets_threshold`, and — under OUTCOME_SCORED —
the calibration sample behind the band (thin sample → low confidence, or unverified
per the gate). Not "km is large." No formula invented.

## 14. NO VALUE behaviour

Following existing conventions (LC-05, PD-07, LC-69, `ck_module_reading__inactive_is_silent`):

| condition | #5 |
|---|---|
| one side's `travel_distance` absent | the differential is incomplete → **reduced confidence**, or INACTIVE if the reading requires both sides (implementation gate decides the partial-reading rule) |
| both sides absent | **INACTIVE** — insufficient data to speak, NULL strength, no baseline |
| a side measured 0 km (count ≥ 1) | a **real** value — the module speaks |

Never convert NO VALUE to 0 km. INACTIVE ≠ NEUTRAL is preserved.

## 15. S-9 relationship

Under OUTCOME_SCORED, S-9 validates **corrected-distance travel bands → MATCH_RESULT
rates** over a reproducible `measurement_population`, gated by `sample_gate`,
accumulating as a `calibration_result` time series. This is the honest re-test V1
never performed on a correct measurement. S-9 does **not** fit λ and does not
estimate a continuous coefficient (doc 68/69). The five concerns stay separate:
feature modelling (λ), baseline construction, band publication, outcome validation,
readiness weighting.

## 16. Historical-pattern & trust/evidence relationship

Keeping OUTCOME_SCORED **maximises** the historical/trust substrate the product
values: the accumulating `calibration_result` series shows how the travel→result
relationship measures over time (LC-123), and `module_evidence_item` makes each
reading explainable and queryable (LC-64). CONTEXTUAL would forfeit the outcome
history. The module must remain able to answer "has distance historically
registered in fixtures like this?" — which only the outcome-scored path supports.
No historical retrieval is designed here; the requirement is that the chosen mode
not preclude it, and OUTCOME_SCORED best satisfies it.

## 17. Readiness relationship

**Clarification that resolves an apparent tension:** readiness is a **TEAM feature
composite**; module #5 is a **FIXTURE module**. They are **parallel consumers of
the travel feature layer, not a chain.** A future readiness contribution would
consume the **team-level travel feature** (`travel_burden`, once it bears
information) via a new `readiness_score` `feature_version` — it would **not**
consume the fixture module. So #5's FIXTURE subject creates no obstacle to
readiness, and readiness needs no change to #5. No V1 15% weight; any readiness
travel term is a separate governed feature-version decision. No readiness change is
proposed.

## 18. Module-version implications

Because **nothing in the contract changes** (subject, mode, question, outcome
dimension all stay), **no new `module_version` is required by this decision.** When
S-6 first implements #5's evaluation logic, that logic is the rule of its first
real `module_version` (rationale authored then, status semantics per version —
D-2 interpretation d), analogous to DEC-1 for features. For the record: changing
`subject_kind` or `calibration_mode` of a seeded, active module **would** be a
governed change (a corrected registration / new version, never a silent overwrite)
— but this decision recommends against making it, so no such action arises.

## 19. Implementation prerequisites

1. **S-0 complete → S-6 unblocked** (D-1) — the hard blocker.
2. **S-6 module engine** built (none exists).
3. **Evidence contract**: home + away `team.travel_distance` (§7); exclusions held.
4. **Home/away combination formula** — a future modelling gate (§9).
5. **Partial-reading rule** for one side absent (§14).
6. **Strength direction/scaling** and **confidence inputs** finalised (§12–13).
7. **For calibration**: a reproducible `measurement_population`, a declared
   `sample_gate`, and multi-season history for S-9 to test the corrected measure.
8. **Verdict vocabulary** consistent with `module_status` (SUPPORTS/NEUTRAL/
   CONTRADICTS/INACTIVE) — no new labels invented.

## 20. Deferred decisions & explicit non-decisions

Deferred: the home/away differential formula; the partial-reading rule; λ;
`travel_recency`; the S-9 `measurement_population` + `sample_gate` numbers; any
readiness travel term; whether a separate CONTEXTUAL exposure module is ever added
(§11); disposition of the legacy `team.travel_impact` *feature* (doc 69).

Explicit non-decisions (this gate changes none of them): module #5's subject kind,
calibration mode, question, outcome dimension, `is_active`, or any registry row;
`travel_distance`; `travel_impact`; readiness; DEC-2.

## 21. Recommended final architecture

```
Layer 1   team.travel_distance   (TEAM, verified, corrected)
              │  (home team)   │  (away team)
              ▼                ▼
Layer 3   module #5 travel_impact   (FIXTURE, OUTCOME_SCORED / MATCH_RESULT)
              │   evidence: two directional module_evidence_items
              │   strength/confidence/status/verdict per reading
              ▼
          S-9: corrected-distance bands → MATCH_RESULT rate, gated  ── honest re-test
              │
              └── (parallel) readiness consumes the TEAM travel FEATURE layer
                  via a future feature_version — NOT this module

travel_burden (λ=0)  → not materialised; swapped into evidence only when λ>0/recency
```

The smallest truthful Layer-3 travel architecture V2 supports: **change nothing;
implement #5 with corrected evidence when S-6 unblocks.**

---

## STATUS

- **Existing travel module:** `module.travel_impact` (#5), registered, active, S-6-unimplemented
- **Existing subject:** FIXTURE
- **Recommended subject:** **FIXTURE (unchanged)** — matches the sibling convention (feature `team.rest_advantage` → FIXTURE module #6; feature `team.travel_distance` → FIXTURE module #5)
- **Existing calibration:** OUTCOME_SCORED / MATCH_RESULT
- **Recommended calibration:** **OUTCOME_SCORED (unchanged)** — the question is an outcome question; corrected data makes it newly answerable; the gate/verdict machinery is the trust mechanism
- **Existing question:** "Does distance matter here?"
- **Recommended question:** **unchanged**
- **V1 outcome evidence:** distance non-predictive **on V1's defective model**; a prior, not a verdict on the corrected measure; rates belong in calibration, not as module inputs
- **Authoritative Layer-1 evidence:** `team.travel_distance` (verified `7f6e9a4`), home + away, as directional evidence
- **travel_burden required:** NO (λ=0 adds nothing; swap in when λ>0/recency)
- **travel_recency required:** NO (separate future gate)
- **Home/away treatment:** two directional `module_evidence_item`s; combination formula = future modelling gate; schema already supports paired/directional evidence
- **Normalization:** outcome baseline via S-9 `published_baseline`, per competition; no contextual population statistic (not applicable under OUTCOME_SCORED)
- **Strength:** module's own — strength of evidence that travel bears on the result; not "more km"
- **Confidence:** `module_evidence` completeness + sample + calibration sample; no formula invented
- **NO VALUE:** absent → reduced confidence or INACTIVE; measured 0 km = a real reading; never travel=0
- **S-9:** validates corrected-distance bands → MATCH_RESULT under a sample gate — the honest re-test V1 never did; does not fit λ
- **Historical Patterns:** best served by keeping OUTCOME_SCORED (accumulating calibration series + relational evidence)
- **Trust/Evidence:** OUTCOME_SCORED + sample gate lets the module honestly report NEUTRAL/unverified where travel doesn't matter — the trust mechanism working
- **Readiness:** parallel consumer of the TEAM feature layer via a future feature_version, NOT a chain through this FIXTURE module; no V1 15% weight
- **Versioning:** NO new module_version required (contract unchanged); first real version is authored at S-6 implementation; subject/mode changes would need governance but are not recommended
- **Implementation authorized:** **NO** — blocked on S-0 → S-6 (D-1)
- **Next gate:** S-0 completion → S-6 module-engine implementation gate; then #5's evaluation logic (evidence, home/away formula, strength/confidence, verdict) as its first module_version
