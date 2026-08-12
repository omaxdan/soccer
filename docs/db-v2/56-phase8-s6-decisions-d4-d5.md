# Phase 8 S-6 — D-2 recorded; D-4 and D-5 decision package

Nothing implemented. No S-6 code, no migration created or applied, no S-7/S-8
change, no provider call. `provider_statistic` and G-1 untouched.

---

# D-2 — RECORDED AS GOVERNED

> **Status semantics are defined per module version, using that module version's
> own finding/characterisation as the reference.**
>
> Not "every module gets an arbitrary formula". **Each registered module version
> declares the rule by which its own finding maps to `module_status_code`.** The
> rule belongs to the module-version contract.

Reasoning as supplied (1–8) is adopted verbatim into the record. Three
consequences follow.

**C-1 — The vocabulary meanings are now anchored.** *"The characterisation"* in
`module.module_status` refers to **the module's own characterisation**, not the
snapshot verdict. This breaks the circularity of doc 55 §3 by construction:
status → consensus → verdict flows one way only.

**C-2 — The governance tension of doc 07 E3.07 is accepted knowingly.** *"A
status meaning may not be redefined — sealed readings reference it."* Under D-2
the four codes keep one meaning (*agrees / argues against / spoke and found
nothing / could not speak*); what varies per version is **what the module's own
finding is**, which is what a module version has always been free to define.
Calibration continues to score the four codes across modules (E7.10); it is
scoring *engagement and direction*, which remain commensurable.

**C-3 — Not orientation, not baseline, not verdict.** Interpretations I-2, I-3
and I-4 of doc 55 are **closed**. No orientation column is needed, D-4 loses its
dependency on D-2, and the S-6 → S-9 ordering is preserved.

## The representation gap D-2 creates — smallest form

**No new column is required.** The governed precedent is exact: `feature_version`
carries the *identical* seven columns as `module_version` — `id`,
`definition_id`, `designation`, `effective_period`, `predecessor_id`,
`rationale`, `created_at` — and **none holds a rule**. S-5 binds the rule in code
(`feature/calculators/*.ts`) and resolves the version in force from the open
effective period. S-6 does the same with `module/modules/*.ts`.

**The gap is the rationale, and it is a mechanism gap rather than a schema one.**

| | |
|---|---|
| What a version's `rationale` must now say | Under D-2 the rationale is where the version *states* its status rule. The thirteen current rationales say *"Carries forward the V1 module … unchanged; the evaluation logic is ported in S-6"* — which D-2 has just made **false** |
| When it must be corrected | **Before the first reading is written.** Doc 23 DEC-1 states the principle: after the first write, values are attributed to a version whose recorded rationale misdescribes them |
| Why it cannot simply be done | **No role holds UPDATE on `module_version`** — verified: `pt_pipeline_module` INSERT+SELECT, every other role SELECT, `pt_migration` no grant at all. The same is true of `feature_version` |
| Therefore | The amendment path is **a migration** (owner-executed). A *new version* would be wrong: 1.0.0 has produced no reading, so there is nothing to preserve, and a successor would assert a rule change where no rule ever existed |

**Prepared, not written:** a rationale-amendment migration, alongside D-6's
column. **Held with D-6 and D-7 pending your instruction.**

---

# D-4 — May a FIXTURE-scoped module consume TEAM-scoped features?

## 1. What the model permits

**`module.module_evidence_item` carries no subject constraint of any kind.**
Verified against the live schema — its only constraints are the composite FK to a
real `feature_value`, the direction vocabulary, and
`cited_feature_value_as_of ≤ reading_as_of`. **Zero occurrences of `subject` in
the relation.** — **STRUCTURAL**

The governing rule is about declaration, not subject kind:

> **LC-56 — "A reading consumes only features its definition declares."** —
> **EXPLICIT**

Nothing anywhere says *"a reading consumes only features of its own subject
kind"*. The subject-kind constraints that do exist — `ck_module_reading__subject_exclusive`,
`fk_module_reading__definition_subject_kind` — govern **the reading's own
subject**, never its evidence.

## 2. Why 5 of 9 active modules have no feature at their own subject kind

**A stated and approved S-5 scope limit, not an oversight.** Doc 21 §9 D-3 fixed
S-5's scope to TEAM-subject features; seven are registered and six are
calculated. The five modules are FIXTURE (`travel_impact`, `rest_advantage`,
`form_gap_accuracy`, `confidence_calibration`) and COMPETITION_EDITION
(`league_goal_profiles`). — **EXPLICIT**

## 3. Does V1 demonstrably consume TEAM data in fixture modules?

**Yes, in every one of them, read directly from code:**

| V1 function | V2 module | Reads |
|---|---|---|
| `evalRest` | `rest_advantage` | `match.intel.home_rest_days`, `…away_rest_days` |
| `evalFormGap` | `form_gap_accuracy` | `match.homeIntel.form_index`, `match.awayIntel.form_index` |
| `evalConfidence` | `confidence_calibration` | `match.intel.confidence_band`, `…confidence_score` |
| `evalTravel` | `travel_impact` | a `ModuleTravelRow` plus both teams' names |
| `evalLeagueGoals` | `league_goal_profiles` | `match.intel.predicted_{home,away}_goals` |

`evalFormGap` is the clearest: **two distinct `TeamIntelligence` objects, one per
side, differenced.** Fixture-scope modules consuming team-level quantities for
both participants is V1's normal mode, not an exception. — **V1 evidence**

## 4. Is there already a structural mechanism?

**Yes, and it needs nothing added.**

- A citation names a **specific feature value** (LC-63), and that row carries its
  own `subject_kind_code` and `subject_team_id`. The evidence therefore records
  *which team* without a new column. — **STRUCTURAL**
- **Which side** is recoverable too: the reading's `subject_fixture_id` joins to
  `football.fixture`, whose `home_team_id` / `away_team_id` identify the role of
  any cited team. No home/away label needs storing. — **STRUCTURAL**
- `ON DELETE RESTRICT` means a cited team value cannot be thinned while a fixture
  reading cites it (LC-65) — the protection works across subject kinds already.

## 5. Ambiguities this creates

| Area | Verdict |
|---|---|
| **Feature identity** | **None.** A citation is to a value, not a definition (LC-63); the value carries its own subject |
| **Evidence ownership** | **None.** The reading owns its evidence set (LC-61); the cited value belongs to its own subject and is merely referenced |
| **Subject / context of the reading** | **None.** Unaffected — the reading's subject stays FIXTURE |
| **Temporal validity** | ⚠ **REAL.** `cited_feature_value_as_of ≤ reading_as_of` is enforced per item, but **nothing requires two teams' values to share an instant.** A fixture reading may cite home's value from T−3d and away's from T−1d and no constraint objects |
| **Context matching** | ⚠ **REAL.** Nothing requires a cited value's `context_kind_code` to match the reading's. A `COMPETITION_SCOPED` fixture reading may cite an `ALL_COMPETITIONS` team value — which for fatigue-type quantities is *correct*, and for form-type quantities may not be |
| **`declared_input_count`** | ⚠ **REAL.** If a module declares "form_index for both sides", is that **one** declared input or **two**? `present_input_count ≤ declared_input_count` is enforced, so the counts are only meaningful once the unit of declaration is fixed |

## 6. Can D-4 be decided from existing evidence?

**The permission question: YES — it is already permitted and requires no
decision.** LC-56 governs by declaration, not subject kind; the schema imposes no
subject constraint on evidence; V1 does exactly this in every fixture module; and
the mechanism to record it exists. Deciding otherwise would make five of nine
active modules permanently unimplementable, since no FIXTURE- or
COMPETITION_EDITION-subject feature exists or is planned.

**The three ambiguities in §5: NO — they need a decision**, and they are narrow:

> **D-4a — Is a per-side input one declared input or two?**
> Fixes the unit of `declared_input_count` and therefore what
> `module_input_conformance` checks.
>
> **D-4b — Must the values a fixture reading cites share one `as_of`?**
> If yes, S-6 selects a common instant and abstains when one side lacks a value
> there. If no, it takes each side's latest ≤ `as_of` and the reading mixes
> instants.
>
> **D-4c — Must a cited value's `context_kind_code` match the reading's?**
> The context vocabulary's own meanings suggest not — `ALL_COMPETITIONS` exists
> for *"quantities that do not partition"* like fatigue — but nothing states it.

These are **declaration-and-selection** questions. None blocks the D-4 permission
itself, and none requires a schema change.

---

# D-5 — `strength`, `confidence`, `sample_observation_count`

## `strength` — numeric, **NULLABLE**

| | |
|---|---|
| **Schema** | `module.module_reading.strength` only. **One occurrence in the entire database.** No CHECK, no scale, no bound |
| **Docs** | Doc 07 E3.03: *"its **strength** on a declared scale"* — **EXPLICIT**. `ck_module_reading__inactive_is_silent`: INACTIVE ⇒ `strength IS NULL` — **STRUCTURAL** |
| **V1 analogue** | **NONE.** `ModuleReading` in V1 is `{def, status, headline, rows, baseline, verdict, code?, locked?}` — no strength, no numeric magnitude |
| **Class** | **UNKNOWN** |
| **S-0 supply?** | **No.** Not an input quantity; it is a property of a reading |
| **S-6 calculate?** | Yes, if it is written at all |
| **Required?** | **Optional.** Nullable, and INACTIVE readings must omit it |

**⚠ A second representation gap, the same shape as D-6.** E3.03 promises *"a
declared scale"* and **there is nowhere to declare one.**
`feature.feature_definition` has `value_scale`; `module.module_definition` has
**no scale column** among its twelve. So a strength could be written but not
interpreted — and, unlike `feature_value`, nothing would round or validate it.

## `confidence` — numeric, **NULLABLE**, `CHECK (0..1)`

| | |
|---|---|
| **Schema** | `module.module_reading.confidence` (0..1) · `snapshot.snapshot_verdict.confidence` · `product.p_landing.confidence` — all nullable |
| **Docs** | Doc 07 E3.03: *"its **confidence** grounded in **sample** rather than in the magnitude of what it found"* — **EXPLICIT, and a real constraint on the derivation.** Doc 15 §6.5: confidence weights consensus |
| **V1 analogue** | **NONE as a reading property.** V1 has a `confidence_band` / `confidence_score` that are *inputs* to `evalConfidence`, i.e. a module's subject matter — **not** a reading's confidence in itself. Conflating them would make one module's output the whole layer's metadata |
| **Class** | **UNKNOWN**, but bounded: it is a function of sample, explicitly not of effect size |
| **S-0 supply?** | No |
| **S-6 calculate?** | Yes, if written |
| **Required?** | **Optional** |

## `sample_observation_count` — integer, **NOT NULL**, `≥ 0`

| | |
|---|---|
| **Schema** | `module.module_reading` (NOT NULL) · `feature.feature_value` (NOT NULL) · `product.p_team_state`. Companion `sample_meets_threshold boolean NOT NULL` on the first two |
| **Docs** | **LC-60: "A reading carries an observation count; it is never optional."** 008 comment: *"a rate without an observation count is a marketing figure, not evidence"* — **EXPLICIT** |
| **V1 analogue** | **Present but NOT equivalent.** V1's `Baseline.sample` is *"Number of historical matches behind `rate`"* — e.g. `sample: 1179, pooled: true`. **That is the BASELINE's n, not the reading's.** In V2 it belongs to `calibration.published_baseline` / `calibration_result`. Writing 1179 into `module_reading.sample_observation_count` would put a pooled historical rate's denominator on a per-reading row |
| **Class** | **Required; derivation UNKNOWN** |
| **S-0 supply?** | **Partly** — `feature_value.sample_observation_count` is an S-5 output that S-6 reads |
| **S-6 calculate?** | **Yes, necessarily** — NOT NULL |
| **Required?** | **REQUIRED**, and load-bearing |

### The S-5 precedent — evidence, not a requirement

Doc 23 **DEC-5** ruled for features:
`sample_observation_count = MIN(consumed.sample_observation_count)`, with
non-composite features carrying their own count. Doc 23 also records the
consequence honestly — a fixed-count input of 1 makes `MIN` collapse to 1 and no
threshold above 1 satisfiable.

**Doc 23 already states the S-5 → S-6 contract explicitly:** *"without it every
readiness value reports `sample_meets_threshold = false`, and **S-6 would read
the feature as permanently insufficient**."* So S-6 reading
`feature_value.sample_meets_threshold` is EXPLICIT and settled.

### `sample_meets_threshold` — where a module's threshold comes from

Features resolve it from `feature_definition.meaningful_sample_threshold`.
**`module_definition` has no such column.** The intended source is
`calibration.sample_gate` — **which holds 0 rows (D-7)**, and
`pt_pipeline_module` holds **SELECT only** on it.

So `module_reading.sample_meets_threshold` is NOT NULL with **no evaluable
threshold today**. D-7 is therefore a hard prerequisite for writing any reading,
not a nicety.

---

# Minimum remaining governance decisions

| # | Decision | Blocks |
|---|---|---|
| **D-4a** | Is a per-side input **one** declared input or **two**? | `declared_input_count`, `module_input_conformance` |
| **D-4b** | Must a fixture reading's cited values share one `as_of`? | reading construction, abstention rule |
| **D-4c** | Must a cited value's `context_kind` match the reading's? | evidence selection |
| **D-5a** | **Is `strength` written at all — and if so, on what declared scale, declared where?** `module_definition` has no scale column | whether a second migration accompanies D-6 |
| **D-5b** | **Is `confidence` written at all — and what function of sample?** E3.03 bars magnitude-based confidence but names no formula | optional field |
| **D-5c** | **What does a module's `sample_observation_count` count?** DEC-5's `MIN(consumed)` is available as precedent; V1's baseline n is **not** the same quantity | **NOT NULL — blocking** |
| **D-7 (open)** | Sample-gate thresholds | **`sample_meets_threshold` is NOT NULL — blocking** |

**Blocking for any reading to be written: D-5c and D-7.** D-5a and D-5b are
optional columns and may be answered as "not written at 1.0.0". D-4a–c shape the
evidence set but do not prevent a reading existing.

## Held, prepared, unapplied

| | |
|---|---|
| **D-6** | `inactive_reason text` nullable + CHECK present exactly when INACTIVE. DDL in doc 55 |
| **D-7** | Sample-gate seed: stage, role `pt_pipeline_calibration`, shape, idempotency. **Thresholds unresolved** |
| **D-2** | `module_version.rationale` amendment — requires a migration, since no role holds UPDATE |

**No migration created or applied. Awaiting explicit instruction.**

---

**D-4 permission: already permitted, no decision needed. D-4a–c, D-5a–c open.
S-6 still waits on S-0 under D-1.**
