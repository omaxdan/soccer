# S-6 Module #2 Selection Gate

**Gate type:** selection / audit only. No code, no migration, no registry change,
no test, no engine change. The only artefact is this document.

**Predecessors relied on as authoritative:** module registry seed
(`src/v2/seed/moduleRegistry.ts`), feature registry seed
(`src/v2/seed/featureRegistry.ts`), the Gate D engine
(`src/v2/module/*`), migration 023 (`v2/migrations/023_module_reading_contract.sql`),
docs 55 (D-2 status package), 56 (D-2 governed / D-4 / D-5), 73 (entry gate),
78 (Gate D audit), and the V1 evaluators in
`beta/live-frontend/src/lib/modules.ts` + `beta/backend/src/jobs/processDbOnly.ts`.

---

## 0. The decisive constraint, stated first

The Gate D engine is **hardwired to one shape: TEAM subject × COMPETITION_SCOPED
context, edition-keyed.** This is not a comment — it is enforced in code at four
points:

| Site | Hardwiring (verified) |
|---|---|
| `module/types.ts` | `ModuleCalculator.subjectKind: 'TEAM'`, `contextKind: 'COMPETITION_SCOPED'` — the type admits nothing else |
| `module/read/consumedFeatures.ts` | SELECT filters `subject_kind_code='TEAM' AND context_kind_code='COMPETITION_SCOPED'` and **requires** `context_competition_edition_id = $5` |
| `module/write/readings.ts` | INSERT hardcodes `'TEAM'`, `subject_team_id`, `'COMPETITION_SCOPED'`, `context_competition_edition_id` |
| `module/pipeline.ts` | driver is `selectScopedBatches` (edition-keyed) exclusively |

The **schema** is general — `module_reading` carries
`subject_team_id / subject_player_id / subject_fixture_id (+partition) /
subject_competition_edition_id`, `context_kind_code`, and
`context_competition_edition_id`, with `ck_module_reading__subject_exclusive`
enforcing exactly one subject. So the storage layer can hold any subject kind;
**the engine code cannot express any but TEAM×COMPETITION_SCOPED.**

Consequence, combined with feature availability (§3): the engine can consume
**only COMPETITION_SCOPED feature values**, and the only two such values produced
in all of V2 are `team.home_win_rate` and `team.away_win_rate` — **both already
consumed by module #1, `home_away_split`.** No other registered module's
semantics derive from venue win rates. Therefore **no remaining module can be
implemented as a pure new calculator on the current engine**; each needs at least
one of: a non-TEAM subject the engine cannot express, an ALL_COMPETITIONS
read/write path the engine does not have, or a feature input that does not yet
exist.

This does not mean nothing is a safe *choice*. It means the safest choice comes
with **bounded, recoverable prerequisites**, which the criteria explicitly permit
for feature inputs — and, by the Gate C-ii precedent, for a bounded engine
capability that is an *additive parametrization*, not architectural expansion.

---

## 1. Complete remaining-module matrix

Thirteen modules are registered. #1 is implemented. The remaining twelve:

| # | key | subject | calibration | active | V1 key | V1 status rule | orientation? |
|---|---|---|---|---|---|---|---|
| 1 | home_away_split | TEAM | OUTCOME · MATCH_RESULT | ✓ | home_away | `\|disparity\|≥40→SUP else NEU` | none — **DONE (Gate D)** |
| 2 | readiness_tracker | TEAM | OUTCOME · MATCH_RESULT | ✓ | readiness | Surging→SUP · Crashing→CON · else NEU | **none** |
| 3 | consistency_index | TEAM | CONTEXTUAL | ✓ | consistency | Erratic→CON · vol≤0.6→SUP · else NEU | **none** |
| 4 | giant_killer_index | TEAM | OUTCOME · MATCH_RESULT | ✓ | giant_killer | Strong→SUP · Bully/Struggles→CON · else NEU | **none** |
| 5 | travel_impact | FIXTURE | OUTCOME · MATCH_RESULT | ✓ | travel | six literal branches | none, but FIXTURE |
| 6 | rest_advantage | FIXTURE | OUTCOME · MATCH_RESULT | ✓ | rest | via `sideStatus` | **orientation-dependent** |
| 7 | league_goal_profiles | COMPETITION_EDITION | OUTCOME · GOAL_TOTAL | ✓ | league_goals | no orientation | none, but EDITION |
| 8 | form_gap_accuracy | FIXTURE | OUTCOME · MATCH_RESULT | ✓ | form_gap | two-team gap | FIXTURE composition |
| 9 | squad_stability | TEAM | CONTEXTUAL | ✗ | — | **no V1 logic** | — |
| 10 | confidence_calibration | FIXTURE | CONTEXTUAL | ✓ | confidence | band→SUP/NEU/CON | none, but FIXTURE |
| 11 | historical_advantage | FIXTURE | CONTEXTUAL | ✗ | — | **no V1 logic** | — |
| 12 | risk_assessment | FIXTURE | CONTEXTUAL | ✗ | — | **no V1 logic** | — |
| 13 | match_context | FIXTURE | CONTEXTUAL | ✗ | — | **no V1 logic** | — |

---

## 2. Source evidence per candidate

Status rules are transcribed from `beta/live-frontend/src/lib/modules.ts`
(the V1 evaluators and their `classify*` helpers) and cross-checked against doc
55 §1. Inputs are traced to the V1 quantity each evaluator reads.

**#2 readiness_tracker** — `evalReadinessTracker` reads `ctx.momentum`
(`last_5_points`, `prior_5_points`). `classifyTrend(last5, prior5)`:
`change = last5 − prior5`; `change≥10 → SURGING`, `≤−10 → CRASHING`, else
IMPROVING/DECLINING/STABLE. Status: `Surging → supports · Crashing → contradicts ·
else neutral`. Source of the input: `processDbOnly.ts::processTeamMomentum`,
`momentum_score = last5Points − prior5Points`, **null unless a full 5-match prior
window exists** (`prior5.length === 5`). Inactive text: *"Not enough matches to
compare two five-game windows."* `baseline: null`.

> **Source discrepancy to reconcile (recorded, not fatal).** The live
> `classifyTrend` returns `base = "SURGING"/"CRASHING"` and a formatted
> `trend = "SURGING (+12)"`, but `evalReadinessTracker` compares
> `trend === "Surging"` / `=== "Crashing"` — casing and suffix both differ, so
> the live comparison never matches and the frontend evaluator collapses to
> `neutral`. This is a frontend refactor defect, **not** a semantic ambiguity:
> the governing rule is the **numeric ±10 threshold in `classifyTrend`**, which
> doc 55 §1 already recorded as *Surging→SUP · Crashing→CON*. The implementation
> gate must transcribe the **threshold** (`change ≥ 10 → SUPPORTS`,
> `change ≤ −10 → CONTRADICTS`, else NEUTRAL), never the broken string test. The
> thresholds are in source; nothing is invented.

**#3 consistency_index** — `evalConsistency` reads `ctx.formQuality.volatility`
(+ `opponent_adjusted_form`). Status: `Erratic → contradicts · vol ≤ 0.6 →
supports · else neutral`; `classifyConsistency` uses `vol ≤ 0.6` and
`vol ≥ 1.5 (Erratic)`. The status rule reads cleanly (pure numeric comparisons,
no string defect). Input `volatility` is a **std-dev-style dispersion over recent
result quality** — a heavier derivation than a points delta, produced in V1's
form-quality processor, **not** currently a registered V2 feature.
`baseline: null`.

**#4 giant_killer_index** — `evalGiantKiller` reads
`formQuality.{giant_killer_score, flat_track_bully_score, ppg_vs_top}`. Status:
`Strong vs top → supports · (Flat-track bully | Struggles vs top) → contradicts ·
else neutral`; `classifyGiantKiller` uses `gk≥80`, `ftb≥70`, `ppgTop≤0.5`. All
three inputs depend on a definition of **"top-tier opposition"** — a standings
rank cut that V2 has not decided. `baseline: null`.

**#6 rest_advantage** — re-evaluated from source per the critical warning.
`evalRest` is in doc 55 §1's **orientation-dependent (6)** set; V2 has no
orientation mechanism (`readiness_gap` absent, no orientation column — doc 56 C-3
closed I-2). Worse, V1's two no-orientation fallbacks **disagree**: `evalRest`
returns SUPPORTS when nothing orients it, while the shared `sideStatus` returns
NEUTRAL (doc 55 §1; doc 73:212). Plus FIXTURE subject. **The earlier finding
stands, confirmed from source, not assumed.**

**#5 travel_impact / #8 form_gap_accuracy / #10 confidence_calibration** —
FIXTURE subject; the engine cannot express FIXTURE. `travel_impact`'s governance
is closed (doc 71: KEEP, do not reopen). `confidence_calibration` additionally
characterises the *platform's own* reliability, needing calibration history
(S-9-adjacent). `form_gap_accuracy` needs a two-team form-gap composition (D-4
territory).

**#7 league_goal_profiles** — COMPETITION_EDITION subject; the engine cannot
express it, and it needs an edition-level goal-total feature.

**#9 squad_stability / #11 historical_advantage / #12 risk_assessment /
#13 match_context** — `is_active = false`, **no V1 evaluation logic** (newly
approved identities). Implementing any requires authoring a status rule from
nothing — precisely the "invent semantics" this gate forbids.

---

## 3. Prerequisite-feature status

Implemented = produces `feature_value` rows (calculator present in
`feature/pipeline.ts::CALCULATORS`). Verified against the feature registry seed
and the calculator set.

| Feature | Context kind (produced) | Implemented? | Consumed by |
|---|---|---|---|
| team.home_win_rate | COMPETITION_SCOPED | ✅ | #1 |
| team.away_win_rate | COMPETITION_SCOPED | ✅ | #1 |
| team.home_form | ALL_COMPETITIONS | ✅ | — |
| team.away_form | ALL_COMPETITIONS | ✅ | — |
| team.readiness_score | ALL_COMPETITIONS | ✅ | — (a *level*, not the trend #2 needs) |
| team.rest_advantage | ALL_COMPETITIONS | ✅ | — |
| team.congestion_index | ALL_COMPETITIONS | ✅ | — |
| team.travel_impact | ALL_COMPETITIONS | ✅ | — |
| team.travel_distance | ALL_COMPETITIONS | ✅ | — |
| team.squad_stability | (registered) | ❌ registered, no calculator | — |
| **team momentum / points-trend** | — | ❌ **not even registered** | #2 needs it |
| **team form volatility** | — | ❌ **not even registered** | #3 needs it |
| **giant-killer / ppg-vs-top** | — | ❌ **not registered**; needs "top" defined | #4 needs it |

The only COMPETITION_SCOPED values in existence are the two venue rates, already
consumed. Every candidate's genuine input is ALL_COMPETITIONS or unregistered.

---

## 4. Exact unresolved decisions per candidate

| Candidate | Unresolved decision(s) |
|---|---|
| readiness_tracker | **None of semantics.** Prerequisites only: a bounded team-momentum feature (recoverable from `processTeamMomentum`) + the engine's ALL_COMPETITIONS-TEAM read/write capability. One transcription note (§2). |
| consistency_index | A bounded volatility feature (heavier std-dev derivation) + engine ALL_COMPETITIONS capability. Semantics frozen. |
| giant_killer_index | **A governance decision: which teams are "top."** Plus three features + engine capability. Category D. |
| rest_advantage | Orientation rule + contradictory-fallback resolution + FIXTURE engine. Category C+D+F. |
| travel_impact / form_gap_accuracy / confidence_calibration | FIXTURE-subject engine (major). |
| league_goal_profiles | EDITION-subject engine (major) + edition feature. |
| squad_stability / historical_advantage / risk_assessment / match_context | A status rule authored from nothing (no V1 source). Forbidden. |

---

## 5. Engine-capability fit

| Capability the module needs | Present in Gate D engine? |
|---|---|
| TEAM subject | ✅ |
| COMPETITION_SCOPED consumption | ✅ (edition-keyed) |
| SUPPORTS / NEUTRAL | ✅ (exercised by #1) |
| **CONTRADICTS** | ✅ in the write path (`contribution_direction`, status vocabulary) — **never yet exercised**; #1 emits only SUPPORTS/NEUTRAL |
| INACTIVE + reason | ✅ (exercised by #1) |
| **ALL_COMPETITIONS consumption (no edition)** | ❌ — read/write/driver all edition-keyed |
| FIXTURE subject | ❌ (engine code; schema has the columns) |
| COMPETITION_EDITION subject | ❌ (engine code; schema has the column) |
| orientation / two-team composition | ❌ (and closed by D-2/D-4) |

Every TEAM candidate is orientation-free and needs exactly **one** new engine
capability: **ALL_COMPETITIONS-TEAM consumption**. This is the module-layer
analogue of Gate C-ii, which added COMPETITION_SCOPED to the *feature* engine as a
reusable, parametrized capability — an additive enhancement, not a
re-architecture. The engine's core model (pure calculator, registry
reconciliation, one-tx-per-batch, evidence) is untouched by it.

---

## 6. Ranking of viable candidates

Only the three **active, TEAM-subject, orientation-free, V1-backed** modules are
viable at all (the rest fail on subject kind, orientation, or absent V1 logic):

1. **readiness_tracker** — simplest, most directly recoverable prerequisite (a
   pure points delta, `last5 − prior5`, from an explicit V1 job); OUTCOME_SCORED ·
   MATCH_RESULT, the *same* calibration mode as #1 (no new calibration ground);
   and it is the one candidate that **exercises the CONTRADICTS branch** — a
   genuinely different engine capability from #1. One transcription note (§2),
   which is a documentation reconciliation, not a modelling decision.
2. **consistency_index** — orientation-free and its status rule is if anything
   cleaner than #2's, but its prerequisite (a form-volatility feature) is a
   heavier, less directly-recoverable derivation, and it is CONTEXTUAL (new
   calibration ground). Validates CONTRADICTS too.
3. **giant_killer_index** — orientation-free status, but blocked by a real
   governance decision ("top teams") and three inputs. Least safe.

---

## 7. Recommended Module #2

**`readiness_tracker`.** It is the safest and most valuable second consumer:
authoritative TEAM subject (no reopening); a frozen, orientation-free,
per-version-governed (D-2) status rule with thresholds transcribed from source,
not invented; the same OUTCOME_SCORED · MATCH_RESULT calibration mode as #1; and
it is the module that validates the **CONTRADICTS** path the engine already
supports but has never produced. Its only gaps are two **bounded, recoverable
prerequisites**, both following patterns already proven in this programme.

It does **not** clear the bar for immediate implementation: its feature input
does not yet exist, and the current engine cannot express an ALL_COMPETITIONS-TEAM
module. Hence *selected*, but *implementation not yet authorized*.

---

## 8. Why the others are deferred

- **consistency_index, giant_killer_index** — viable but ranked below #2:
  heavier/unresolved prerequisites (volatility derivation; a "top teams"
  governance decision). Reconsider after #2 proves the ALL_COMPETITIONS-TEAM path.
- **rest_advantage** — deferred *and disqualified for now*: orientation-dependent,
  V1 fallbacks self-contradict, no V2 orientation mechanism, FIXTURE subject.
  Re-confirmed from source (§2), not assumed.
- **travel_impact, form_gap_accuracy, confidence_calibration, league_goal_profiles**
  — deferred: require FIXTURE or COMPETITION_EDITION subjects the engine cannot
  express. `travel_impact` also stays closed per doc 71.
- **squad_stability, historical_advantage, risk_assessment, match_context** —
  deferred: inactive, no V1 evaluation logic; implementing would mean inventing a
  status rule.
- **travel_burden** — not a registered module; λ = 0; no consumer makes it
  informationally distinct (docs 68/69). Not materialized. The closed travel
  architecture is not reopened.

---

## 9. Is a prerequisite feature gate needed?

**Yes — exactly one, bounded.** A new TEAM · ALL_COMPETITIONS **team-momentum**
feature (points over the last 5 completed fixtures minus the prior 5;
NO VALUE unless a full 5-match prior window exists — the V1
`processTeamMomentum` rule). It needs a registry addition (calculator +
definition + version + context-kind binding) and a calculator, mirroring Gate C
for `venue_win_rate`. It requires **no engine change of its own** — the feature
engine already produces ALL_COMPETITIONS values. It is not a golden port where a
population differs; here the V1 computation is directly reproducible, so it should
carry the V1 formula unchanged.

> Naming caution for that gate: the V2 feature `team.readiness_score` maps to V1
> `team_intelligence.readiness_score` (a *level*), which is **not** what the
> readiness_tracker status rule consumes. The rule consumes the momentum *trend*
> (`team_momentum`). The prerequisite is a distinct feature; do not conflate them.

---

## 10. Is an engine enhancement genuinely required?

**Yes — one, bounded; and it is an enhancement, not architectural expansion.**
The engine must gain **ALL_COMPETITIONS-TEAM** consumption: an
ALL_COMPETITIONS batch driver (team × as_of, no edition), a `readConsumedFeatures`
that reads `context_kind='ALL_COMPETITIONS'` with a NULL edition, and a
`writeReading` that writes `context_kind='ALL_COMPETITIONS'`,
`context_competition_edition_id = NULL`. This is the direct module-layer analogue
of Gate C-ii (which parametrized the feature engine on context kind without being
architectural expansion). It must be built **reusably and parametrized on context
kind**, exactly as Gate D's engine is reusable — never special-cased to
readiness_tracker. The frozen 1.0.0 contract of `home_away_split` (its
COMPETITION_SCOPED path) must be left byte-unchanged; the enhancement is additive.

No other engine change is required: CONTRADICTS is already supported; INACTIVE +
reason already works; strength/confidence/baseline stay NULL (D-5a/b, S-9 out of
scope).

---

## 11. Cross-cutting finding (surfaced, not fixed here)

**The D-2 `module_version.rationale` amendment was never executed.** Doc 56
recorded that under D-2 each module version's `rationale` is where its status rule
is *stated*, and that the seeded thirteen rationales — *"Carries forward the V1
module … unchanged; the evaluation logic is ported in S-6"* — were thereby made
**false**, to be corrected *before the first reading is written*, via a migration
(no role holds UPDATE on `module_version`). Verified now: migration 023 added only
the two columns; **no rationale-amendment migration exists**, and the live
`home_away_split` (and every) `module_version.rationale` still carries the stale
text. This already applies to the implemented module #1.

It is **not** a violation of the Gate D engine's *frozen contract* (which governs
`home_away_split`'s 1.0.0 semantics, not the version's stored rationale), so it is
out of scope to fix in this selection gate. But it is an open, governed
obligation: production `module_reading` currently holds **0 rows**, so it is not
yet *violated*, but it must be resolved before any module — #1 included — writes a
production reading. It belongs in the next implementation gate's scope, alongside
whatever migration that gate needs (if any), or as its own small migration gate.

---

## 12. The next bounded gate (recommended, not authorized)

Three bounded gates, in dependency order. **Do not implement any of them from
this document.**

1. **Gate E-i — Module-engine ALL_COMPETITIONS-TEAM capability** (design, then
   implementation). Parametrize the engine on context kind; add the
   ALL_COMPETITIONS batch driver; keep the COMPETITION_SCOPED path byte-unchanged;
   prove reusability with tests, exactly as Gate C-ii did for the feature engine.
   No new module.
2. **Gate E-ii — `team` momentum feature** (definition, then implementation).
   A TEAM · ALL_COMPETITIONS points-trend feature (V1 `processTeamMomentum`,
   carried unchanged), mirroring Gate C. Independent of Gate E-i; either order.
3. **Gate E-iii — `readiness_tracker` module implementation.** The pure
   calculator only, once E-i and E-ii land: transcribe the ±10 threshold rule
   (per §2, not the broken string test), emit SUPPORTS/CONTRADICTS/NEUTRAL,
   consume the momentum feature, INACTIVE when it is absent. Resolve the §11
   rationale obligation in or before this gate.

---

**MODULE 2 SELECTED — IMPLEMENTATION NOT YET AUTHORIZED**

Selected: `readiness_tracker`. Implementation is deferred behind two bounded,
recoverable prerequisites (an ALL_COMPETITIONS-TEAM engine capability; a
team-momentum feature) and one recorded transcription reconciliation. No code, no
migration, no registry change, no engine change was made in this gate.
