# Phase 8 — S-6 Travel Module Consumer Specification

## Design gate only · nothing implemented

| | |
|---|---|
| Prior gates | `127da55` · `7f6e9a4` · `ad73dae` · `32a0e33` · `ca0bee5` · `08a19cb` |
| **Decisive finding** | **The Layer-3 travel module already exists** — `module.travel_impact` (display #5), registered, active, S-6-unimplemented |
| **Recommendation** | **Do NOT create a new module.** The corrected travel features are the governed EVIDENCE for module #5 |
| **Key unresolved tension** | module #5 is `OUTCOME_SCORED` / subject `FIXTURE`, while the brief's desired signal is a `CONTEXTUAL` / `TEAM` characterisation — a **module-governance** question, not this gate's to settle |
| **Implementation authorized** | **NO** — blocked on S-0→S-6 (D-1), on resolving #5's mode/subject contract, and on `travel_burden` having a reason to exist (λ=0) |

Nothing implemented. No module/registry/dependency/value rows, no migration, no
edit to `travel_distance` / `travel_impact` / readiness / DEC-2, no `travel_burden`,
no `travel_recency`, no λ, no invented threshold or vocabulary.

---

## 1. Existing S-6 architecture

Read from `v2/migrations/002,008,009` and `seed/moduleRegistry.ts` (no module
*calculator* exists — S-6 is unimplemented; only the registry seed exists).

**The reading chain.** `module_definition` (identity, `question`,
`calibration_mode_code`, optional `outcome_dimension_code`, `entitlement_feature_key`)
→ `module_version` (versioned rule, `rationale`; no numeric-parameter column) →
`module_reading` (E3.03: `module_status_code`, nullable `strength`, nullable
`confidence` ∈ [0,1], `sample_observation_count` **never optional** (LC-60),
`sample_meets_threshold`, nullable `published_baseline_id`, `headline_text`,
`verdict_text`) → `module_evidence` (E3.04, set-level completeness:
declared/present/below_threshold/estimated input counts) → `module_evidence_item`
(E3.05, **the explainability substrate**: cites a `feature_value` with
`contribution_direction` SUPPORTS/CONTRADICTS/NEUTRAL and `contribution_weight`).

**Governing vocabularies.**
- `calibration_mode`: **`OUTCOME_SCORED`** ("measured against a stated outcome
  dimension") vs **`CONTEXTUAL`** ("characterises an environment; not
  outcome-scored"). `ck_module_definition__dimension_when_scored` forces
  `outcome_dimension_code` present iff `OUTCOME_SCORED`.
- `module_status`: `SUPPORTS` / `NEUTRAL` / `CONTRADICTS` / `INACTIVE`
  (`is_engaged = false` for INACTIVE only). Oriented to *the module's own
  characterisation* (doc 55): SUPPORTS = the characterisation holds; NEUTRAL =
  spoke, nothing of consequence; INACTIVE ≠ NEUTRAL (LC-69). Status semantics are
  **per module version** (D-2, interpretation d).
- `outcome_dimension`: MATCH_RESULT, GOAL_TOTAL, BOTH_SCORED, CLEAN_SHEET,
  HALF_TIME_STATE, MARGIN — all **fixture outcomes**.
- **`ck_module_reading__inactive_is_silent`**: an INACTIVE reading has NULL
  strength and no baseline. This is the schema-level NO VALUE guard.

**Calibration coupling.** `calibration_series` and `published_baseline` both carry
`outcome_dimension_code` **NOT NULL** — the entire published-baseline machinery is
**outcome-scored**. A CONTEXTUAL module does not produce a `published_baseline` in
that sense; its `published_baseline_id` stays NULL.

## 2. The Travel Module's question — already registered

**A travel module is not hypothetical: it is module #5.**

```
module_key            travel_impact
display_name          Travel Impact
question              "Does distance matter here?"
subject_kind          FIXTURE
entitlement_key       TRAVEL_IMPACT
calibration_mode      OUTCOME_SCORED
outcome_dimension     MATCH_RESULT
is_active             true          (but S-6 has no evaluation logic yet)
v1_key                travel
```

So the semantic question is **already fixed by the registry**: *"Does distance
matter here?"* — a **fixture-level, outcome-scored** question (does the travel
situation in this matchup predict the match result?), carrying V1's `travel`
module. It is **not** the team-level exposure characterisation the brief sketches
in candidates B/C. That gap is the heart of this specification (§4, §16).

Mapping the brief's candidates onto the registered reality:
- **A** ("how much travel") — rejected, it is `travel_distance` (Layer 1). ✓ agree.
- **B/C** ("how burdensome / how unusual this team's exposure") — a **CONTEXTUAL,
  TEAM-subject** characterisation. **Not what module #5 is.**
- **D** ("travel-related preparedness risk") — closer to readiness; deferred.
- **E** ("historically associated with degraded performance") — **this is module
  #5's OUTCOME_SCORED question**, and doc 60 §6 already records V1's verdict that
  single-trip distance does **not** predict results ("a known dead end").

## 3. Why Layer 3 is required (separation of responsibilities)

| Layer | Question | Owner |
|---|---|---|
| 1 | "what physically happened?" | `travel_distance` (measurement, UNSIGNED) |
| 2 | "what does it mean, oriented?" | `travel_burden` (characterisation, contract frozen, unbuilt) |
| 3 | "how significant is that evidence, in context, with what confidence?" | **the module** |

Orientation, contextual reference, `strength`, `confidence`, evidence
completeness, baseline, and `verdict_text` are **Layer-3 responsibilities** and the
schema already houses them. They must **not** migrate into `travel_distance`
(kept UNSIGNED and raw) or `travel_burden` (kept a raw physical magnitude). This
gate confirms the split rather than moving anything.

## 4. `travel_distance` relationship

`travel_distance` is **TEAM-subject**; module #5 is **FIXTURE-subject**. A
fixture-level travel module therefore reads **both** teams' travel values and forms
the matchup view — which is exactly V1's fixture-level travel differential (doc 60
§5: "one fixture, both sides"). So the corrected `travel_distance` is the natural
**evidence input** for module #5: cite the home team's and away team's
`feature_value(team.travel_distance)` as two `module_evidence_item`s, each with a
`contribution_direction`.

## 5. `travel_burden` relationship — architecture (A), gated

Of the brief's three options, **(A)** is correct:

```
travel_distance → travel_burden → module #5   (evidence)
```

but **implementation-blocked until `travel_burden` bears information over
`travel_distance`** — i.e. until λ>0 or recency joins (doc 68/69). While λ=0,
module #5 should, when S-6 implements it, cite `travel_distance` **directly**;
`travel_burden` becomes a later evidence item, transparently swapped when it earns
its place. Not option B (module doing Layer-2 interpretation itself — that belongs
in `travel_burden`) and not a permanent bypass. This is the hybrid **(C)** timing
of the brief's Step 4, resolved in favour of *direct `travel_distance` now,
`travel_burden` when informative*.

## 6. Evidence items

Declared inputs for module #5 (fixture-level):

- `feature_value(team.travel_distance)` for the **home** team;
- `feature_value(team.travel_distance)` for the **away** team;
- later: the two teams' `team.travel_burden`, and (separate gate) `travel_recency`.

**Excluded, deliberately:** `rest_advantage`, `congestion_index`. The travel /
recovery / workload separation is preserved (doc 67 §4); those enter preparedness
through their **own** modules or the readiness composite, once each. Nothing in the
schema justifies folding them into a travel module, and doing so would re-create
the double-counting the whole travel line was designed to avoid.

## 7. Contextual normalization

This is where the registered mode matters. The brief wants "elevated vs normal
travel" — a **population-relative** statement. Two schema paths, and they are
**different**:

- **OUTCOME_SCORED path (module #5 as registered):** the "baseline" is a
  `published_baseline` rate against MATCH_RESULT per band, built by S-9 over a
  reproducible `measurement_population` and gated by `sample_gate`. This answers
  "does distance predict results in this competition?" — **not** "is this team's
  km unusual." And doc 60 §6 says the honest answer is likely *no*.
- **CONTEXTUAL path (what B/C describes):** "elevated vs the competition's normal
  recent travel" is a distribution comparison among the competition's teams at the
  same `as_of`. The schema has **no** outcome-free published baseline for this; a
  CONTEXTUAL module would compute the reference at read time from the feature
  layer (the competition-edition teams' `travel_distance` at that `as_of`), with
  `published_baseline_id` NULL.

**These cannot both be module #5 under one version.** Which one module #5 *is* is a
governance decision (§16). No threshold or population formula is invented here; the
*semantic population* for the CONTEXTUAL reading would be "teams in the same
`competition_edition` at the same `as_of`," and its exact statistic is a later gate.

## 8. Strength semantics

`strength` is the module's own, **not** the feature's direction. For module #5 as
registered (OUTCOME_SCORED), high `strength` should mean *"the travel evidence
strongly bears on the match-result characterisation"* — i.e. the differential is
large and the calibrated relationship is real. For a CONTEXTUAL reading it would
mean *"travel exposure is unusually elevated vs the population."* These are
different meanings, resolved with the mode (§16). Either way, do not conflate it
with `team.travel_distance` being UNSIGNED or `team.travel_burden` being
LOWER_IS_STRONGER — orientation into `strength` is the module's job, applied at
read time.

## 9. Confidence semantics

`confidence ∈ [0,1]` must rest on **evidence completeness + sample**, not on "km is
large." The schema supplies the substrate: `module_evidence`
(declared/present/below_threshold/estimated input counts) and the reading's
`sample_observation_count` / `sample_meets_threshold`. For module #5, confidence
falls when a team's travel value is absent or below threshold (a side with no
measurable itinerary), and — in OUTCOME_SCORED mode — when the calibration sample
behind the band is thin. No confidence formula is invented; the gate specifies
*which existing signals feed it*.

## 10. NO VALUE behaviour

Locked to existing conventions (LC-05, PD-07, LC-69, `ck_module_reading__inactive_is_silent`):

| condition | module #5 |
|---|---|
| a team's `travel_distance` absent | that evidence item absent → `present_input_count < declared_input_count` → **confidence reduced**; the reading may still speak on the other side |
| **both** teams' `travel_distance` absent | **`module_status = INACTIVE`** — insufficient data to speak, NULL strength, no baseline; **never** a `travel = 0` reading |
| a team measured 0 km (count ≥ 1) | a **real** minimum-exposure value — the module speaks; distinguishable from absence |

INACTIVE (couldn't speak) is kept distinct from NEUTRAL (spoke, nothing of
consequence) — the coverage-honesty rule the whole layer rests on.

## 11. Sample gate

`calibration.sample_gate` (E7.07, LC-133) governs **published outcome rates**:
"every published rate passes a declared gate or is marked unverified." It applies
to the **OUTCOME_SCORED** path — before module #5 may publish a *calibrated
travel→result rate*, that rate's band must clear a declared `sample_gate` over a
`measurement_population`. It does **not** gate a CONTEXTUAL characterisation (which
publishes no outcome rate); there, the reading's own
`sample_observation_count`/`sample_meets_threshold` (e.g. how many comparable teams
formed the population) is the honesty control. No gate numbers are invented; the
mechanism is reused as-is.

## 12. Baseline

`published_baseline` is outcome-scored (`outcome_dimension_code` NOT NULL), keyed
by `module_version_id, band_code, outcome_dimension_code, context_kind_code,
context_competition_id`. So module #5's baseline — **if** it stays OUTCOME_SCORED —
is *"the competition's base match-result rate against which the travel band's rate
is compared,"* built by S-9, **per competition** (the schema already keys it by
competition, which is the correct home for cross-league relativisation — §7/§16 of
doc 69). A CONTEXTUAL travel-exposure reference has **no** row here and is computed
at read time. This asymmetry is, again, the mode decision.

## 13. Calibration / S-9 relationship

Keeping the five concerns distinct (as the brief demands):

1. **feature modelling** (λ in `travel_burden`) — feature layer, per feature_version, no S-9 mechanism to *fit* it (doc 68/69).
2. **module baseline construction** — S-9 builds `published_baseline` **only for the OUTCOME_SCORED path**.
3. **module band publication** — S-9 publishes a band's rate iff it clears `sample_gate`.
4. **outcome validation** — S-9 measures `hit_rate` vs `baseline_rate` → `lift` against MATCH_RESULT. **This is where V1's "distance doesn't predict" verdict (doc 60 §6) will show up empirically** — module #5 may honestly calibrate to ≈0 lift.
5. **readiness weighting** — a future `readiness_score` feature_version, separate again (§15).

A CONTEXTUAL module #5 would use **none** of 2–4; it would only carry its own
evidence/confidence. That is the sharpest practical consequence of the mode choice.

## 14. Historical-evidence requirements

PitchTerminal values historical patterns + trust/evidence. The module architecture
**already leaves room** for it: `module_evidence_item` is the explainability
substrate (query which features drove a reading, explain a past reading without
re-running it), and `calibration_result` accumulates as a time series (LC-123).
The Travel module must **not** be designed in a way that precludes later historical
exposition — but no historical retrieval is designed here. The requirement is only:
keep the reading's evidence relational and its calibration series intact, both of
which the schema enforces by default.

## 15. Readiness relationship

Preferred future path: **`travel_distance → travel_burden → module #5`**, with any
readiness contribution flowing from the **module reading**, not a raw feature, and
authorised by a **new `readiness_score` feature_version** — never V1's 15% weight
(unfounded; DEC-2's own "no evidence supports asymmetry" logic applies). But note
module #5 is FIXTURE-subject while `readiness_score` is TEAM-subject: a fixture
module does not slot directly into a team composite. This is a further reason the
subject-kind question (§16) must be settled before any readiness integration is
even expressible. No readiness change is proposed.

## 16. Module registry contract — as registered, with the open questions named

Module #5 **is already contracted**; this gate does not re-seed it. Recorded as-is,
with the three decisions that block its S-6 implementation:

| slot | registered value | open question |
|---|---|---|
| `module_key` | `travel_impact` | — (note the name-collision with `feature.team.travel_impact`; distinct rows, distinct schemas) |
| `subject_kind` | **FIXTURE** | brief wants a TEAM exposure signal — **mismatch** |
| `question` | "Does distance matter here?" | an outcome question, not an exposure characterisation |
| `calibration_mode` | **OUTCOME_SCORED** / MATCH_RESULT | doc 60 §6: distance ≈ non-predictive → should it be **CONTEXTUAL**? |
| `entitlement_key` | `TRAVEL_IMPACT` | — |
| `is_active` | true | but no S-6 evaluation logic; blocked on S-0 (D-1) |
| evidence (proposed) | home + away `team.travel_distance`; later `travel_burden` | not `rest_advantage`/`congestion_index` |
| version rationale | (to be authored by S-6) | status semantics are per-version (D-2 d) |

Changing subject kind or calibration mode of a **seeded, active** module is a
**module-governance decision** (a new `module_version` and/or a registry
correction under the same discipline that governs `feature_version`), explicitly
**outside this gate**.

## 17. Implementation prerequisites (explicit gates)

1. **S-0 complete → S-6 unblocked** (D-1). The hard blocker.
2. **Resolve module #5's contract**: is it OUTCOME_SCORED "does distance predict
   results?" (accepting a likely ≈0-lift, honest NEUTRAL answer) **or** CONTEXTUAL
   "how elevated is exposure?" — and FIXTURE vs TEAM subject. A governance
   decision.
3. **`travel_burden` reason-to-exist**: while λ=0, module #5 cites `travel_distance`
   directly; `travel_burden` is added only when λ>0 or recency joins.
4. **Evidence set approved** (home+away travel values; exclusions held).
5. **If OUTCOME_SCORED**: a reproducible `measurement_population`, a declared
   `sample_gate`, and S-9 calibration — none of which exist yet, and which need
   multi-season history to be meaningful.
6. **If CONTEXTUAL**: the read-time population statistic (teams in the same
   competition-edition at the same `as_of`) specified — a separate small gate.
7. **S-6 implementation pattern** (the module engine) built — none exists yet.

## 18. Explicitly deferred decisions

Module #5's calibration mode and subject kind; the contextual-population statistic;
λ; `travel_recency`; the OUTCOME_SCORED calibration population + gate numbers; the
readiness contribution and its subject-kind reconciliation; `travel_impact`
*feature* disposition (doc 69); any expansion of the governed 13-module set.

## 19. Recommended architecture

- **Do not create a new module.** The governed travel module is **#5
  `travel_impact`** (FIXTURE, OUTCOME_SCORED, active, S-6-unimplemented).
- **The corrected `travel_distance` is module #5's evidence** (home + away, a
  fixture-level differential), with `travel_burden` swapped in when it bears
  information over the raw measurement.
- **Surface, do not resolve, the mode/subject tension**: module #5 as registered
  asks an outcome question that V1's own evidence says distance does not answer,
  while the brief's desired signal is a team-level exposure characterisation.
  Reconciling them is a module-governance decision.
- **Preserve travel/recovery/workload separation** — no `rest_advantage` /
  `congestion_index` in travel evidence.
- **NO VALUE stays absence** → reduced confidence or INACTIVE, never travel=0.
- **Everything is blocked** on S-0→S-6 first; **implementation is not authorized.**

---

## STATUS

- **S-6 architecture inspected:** YES — schema (002/008/009) + `moduleRegistry.ts`; no module calculator exists (S-6 unimplemented)
- **Travel Module justified:** YES — and it **already exists** as `module.travel_impact` (#5); no new module should be created
- **Semantic question:** registered as "Does distance matter here?" (FIXTURE, OUTCOME_SCORED/MATCH_RESULT) — which differs from the brief's team-level exposure characterisation (the open tension)
- **Direct travel_distance evidence:** YES — home + away teams' `team.travel_distance`, a fixture-level differential
- **travel_burden required:** not yet — cited directly as `travel_distance` while λ=0; `travel_burden` swapped in when λ>0 or recency joins
- **Contextual normalization:** two schema paths (outcome `published_baseline` vs read-time competition-edition population); which applies depends on the mode decision; population = "teams in the same competition-edition at the same as_of", statistic deferred
- **Baseline:** OUTCOME path → S-9 `published_baseline`, per competition; CONTEXTUAL path → none (read-time reference)
- **Sample gate:** `calibration.sample_gate` gates published outcome rates (LC-133); applies only to the OUTCOME_SCORED path; numbers not invented
- **Strength:** module's own orientation (not the feature's direction); meaning depends on mode
- **Confidence:** from `module_evidence` completeness + `sample_observation_count`/threshold (+ calibration sample if OUTCOME_SCORED); no formula invented
- **NO VALUE:** absent travel → reduced confidence or INACTIVE (LC-69); measured 0 km = a real reading; never travel=0
- **Historical evidence:** architecture must leave room (relational evidence + accumulating calibration series already do); no retrieval designed
- **S-9:** builds baseline/band/outcome validation for the OUTCOME_SCORED path only; will empirically show V1's "distance ≈ non-predictive" verdict; does not fit λ
- **Readiness relationship:** `travel_distance → travel_burden → module #5 → (new readiness feature_version)`; blocked further by module #5 being FIXTURE-subject vs readiness TEAM-subject; no V1 15% weight
- **Module contract:** already registered (#5); re-seeding not needed; subject-kind and calibration-mode are open governance questions
- **Implementation authorized:** **NO**
- **Next gate:** the module-governance decision on module #5's calibration mode + subject kind (and the CONTEXTUAL population statistic if chosen), downstream of S-0→S-6 being unblocked
