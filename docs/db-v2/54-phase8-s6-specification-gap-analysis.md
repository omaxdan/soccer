# Phase 8 S-6 — Specification gap analysis: a decision package

**S-6 is the critical-path blocker (S-6 → S-7 → S-8) and it is a SPECIFICATION
blocker, not a provider one.** Nothing here depends on the season-statistics
hold, G-1, or `provider_statistic`.

This audits what the repository already establishes about S-6, marks precisely
where it stops, and reduces the remainder to **seven decisions**. Nothing was
implemented, no schema changed, no rule invented.

[Doc 25](./25-phase8-s6-not-specified.md) reached the same verdict and remains
correct in outline. This goes further in three places and **corrects one of its
findings** — B-2 is materially overstated (§7.2).

Every statement below is marked **EXPLICIT** (stated in an authoritative V2
document), **STRUCTURAL** (forced by a live schema object), **INFERRED**
(plausible, ungoverned) or **UNKNOWN**. Nothing INFERRED or UNKNOWN is written as
a requirement.

---

## 1. S-6 purpose

> **Compute what each registered module says about one subject, in one context,
> at one instant, under one version — and record the feature values it consumed
> in doing so.** — EXPLICIT, doc 15 §3.6, §6.2

| | |
|---|---|
| Role | `pt_pipeline_module` — EXPLICIT (§6.2) |
| Writes | `module_reading`, `module_evidence`, `module_evidence_item` — EXPLICIT |
| Also writes | `snapshot.snapshot_verdict` consensus — EXPLICIT (§6.5) |
| Does not write | `module_definition`, `module_version` (seeder), `published_baseline` (`pt_pipeline_calibration`) — EXPLICIT (§6.2) |
| Does not resolve entitlement | EXPLICIT — *"the module engine resolves no entitlement and reads no subscription"* (008 comment) |

The role's own purpose string is `"Writes schemas module and snapshot"`, so
**the S-6 / S-7 boundary is a code boundary, not a privilege boundary** —
STRUCTURAL, `db/roles.ts`.

## 2. Inputs

| Input | State today | Class |
|---|---|---|
| `module.module_definition` | **13 rows, seeded** | STRUCTURAL |
| `module.module_version` | **13 rows, all `1.0.0`** | STRUCTURAL |
| `feature.feature_value` (17 cols) | **0 rows** — S-5 implemented, never run against ingested reality | STRUCTURAL — `module_evidence_item` holds a composite FK onto `(id, as_of)` |
| `module.module_status` | 4 codes: `SUPPORTS`, `NEUTRAL`, `CONTRADICTS`, `INACTIVE` | STRUCTURAL |
| `calibration.published_baseline` | **0 rows** | STRUCTURAL — `module_reading.published_baseline_id` is nullable |
| `calibration.sample_gate` | **0 rows**, and doc 15 §6.2 assigns it to *"Seeder"* | **see finding F-A** |
| Vocabularies (`subject_kind`, `context_kind`, `provenance_class`, `calibration_mode`) | seeded | STRUCTURAL |

**What a module may consume is nowhere declared.** Layer 2 has
`feature.feature_source` (Layer-1 relations read) and `feature.feature_dependency`
(features consumed). **Layer 3 has no equivalent relation** — confirmed by
enumerating schema `module`: thirteen relations, none matching `%input%`,
`%source%` or `%depend%`. This is doc 25's B-5 and it stands.

## 3. Outputs

**`module.module_reading`** — 21 columns. NOT NULL and therefore requiring a rule:
`as_of`, `module_definition_id`, `module_version_id`, `subject_kind_code`, the
matching subject id, `context_kind_code`, **`module_status_code`**,
**`sample_observation_count`**, **`sample_meets_threshold`**.
Nullable: `strength`, `confidence`, `published_baseline_id`, `headline_text`,
`verdict_text`.

**`module.module_evidence`** — one per reading (LC-61). All four counts NOT NULL:
`declared_input_count`, `present_input_count`, `below_threshold_input_count`,
`estimated_input_count`.

**`module.module_evidence_item`** — one per cited feature value.
`contribution_direction` NOT NULL, constrained to `SUPPORTS|CONTRADICTS|NEUTRAL`;
`contribution_weight` nullable.

**`snapshot.snapshot_verdict`** — consensus counts, written under a
`verdict_composition_version` — EXPLICIT (§6.5), including
`consensus_inactive_count` held separately from neutral (LC-73).

## 4. Required invariants — EXPLICIT or STRUCTURAL only

| # | Invariant | Source |
|---|---|---|
| I-1 | One reading per `(subject, context, definition, as_of, version)` | STRUCTURAL — `uq_module_reading__…`, `NULLS NOT DISTINCT` since migration 020 |
| I-2 | Subject columns are mutually exclusive and must match the subject kind | STRUCTURAL — `ck_module_reading__subject_exclusive` |
| I-3 | A reading's subject kind must equal its definition's | STRUCTURAL — composite FK `(module_definition_id, subject_kind_code)` |
| I-4 | `COMPETITION_SCOPED` context requires an edition; any other forbids one | STRUCTURAL — `ck_module_reading__context_edition_conditional` |
| I-5 | **INACTIVE carries no `strength` and cites no baseline** | STRUCTURAL — `ck_module_reading__inactive_is_silent` |
| I-6 | `confidence ∈ [0,1]` or null; `sample_observation_count ≥ 0` | STRUCTURAL |
| I-7 | Exactly one evidence set per reading | STRUCTURAL — `uq_module_evidence__reading` (LC-61) |
| I-8 | `present_input_count ≤ declared_input_count` | STRUCTURAL |
| I-9 | Every citation references a **real** `feature_value` | STRUCTURAL — composite FK |
| I-10 | A reading cannot cite evidence from its own future | STRUCTURAL — `ck_module_evidence_item__cited_not_after_reading` |
| I-11 | `sample_observation_count` is never optional | EXPLICIT — LC-60, *"a rate without an observation count is a marketing figure"* |
| I-12 | INACTIVE and NEUTRAL are distinct and scored separately | EXPLICIT — LC-69 |
| I-13 | Readings are append-only; no UPDATE, DELETE only by `pt_retention` | STRUCTURAL — migration 016 + append guard |
| I-14 | No column for a recommended action, stake or selection exists | EXPLICIT — LC-71 |

## 5. Dependency contract

### What S-7 demonstrably requires

- **Readings must already exist and be individually addressable.**
  `snapshot.snapshot_module_reading` holds a **composite FK onto
  `module.module_reading (id, as_of)`** — STRUCTURAL, migration 014. Sealing
  cannot invent one.
- **`cited_as_of ≤ snapshot_as_of`** — STRUCTURAL.
- **Sealing runs as `pt_pipeline_module`** — EXPLICIT, doc 15 §7.2, and step 4 is
  `insertModuleReadings(tx, snap, readings)`.
- **Consensus counts** — four separate integers including inactive — EXPLICIT
  §6.5.
- Not required from S-6: the checksum canonical form, which is a separate
  BLOCKING TODO (doc 15 §7.3).

### What S-8 demonstrably requires

`module_reading` is registered `THINNED` (90-day recent / 2-year intermediate,
family `MODULE`) and `fn_thin_module_readings` keeps the **latest reading per
`(subject…, context…, module_definition_id, band, bucket)`** — STRUCTURAL,
migration 018. Children are deleted deepest-first against `ON DELETE RESTRICT`.

**Note, STRUCTURAL and unremarked anywhere:** the thinning identity **omits
`module_version_id`**, which the business key includes. Two readings differing
only by version, in one bucket, thin to one. That is S-8's design and is recorded
here only because S-6 produces the rows it operates on.

## 6. Existing implementation evidence

| Artefact | Status |
|---|---|
| `src/v2/module/` | **Does not exist.** No file, no stub |
| `src/v2/seed/moduleRegistry.ts` | **Reusable, complete.** 13 definitions + 13 versions, seeded and verified |
| `beta/live-frontend/src/lib/modules.ts` (1,587 lines) | **Evidence of prior intent, and partially reusable** — see §7 |
| `src/v2/feature/verify.ts` | **Contradictory-adjacent**: `module_input_conformance` is registered but has no implementation and nothing to check against (B-5) |
| `operations.quality_check` | `module_input_conformance` registered, **unimplemented** — doc 53 §coverage |
| Tests | **None reference any `module.*` relation** beyond the seed's own |

## 7. V1 comparison — *not* the V2 specification

### 7.1 The registries differ in both directions

| V2 module | subject | active | V1 predecessor |
|---|---|---|---|
| `home_away_split` | TEAM | ✓ | `home_away` |
| `readiness_tracker` | TEAM | ✓ | `readiness` |
| `consistency_index` | TEAM | ✓ | `consistency` |
| `giant_killer_index` | TEAM | ✓ | `giant_killer` |
| `travel_impact` | FIXTURE | ✓ | `travel` |
| `rest_advantage` | FIXTURE | ✓ | `rest` |
| `form_gap_accuracy` | FIXTURE | ✓ | `form_gap` |
| `confidence_calibration` | FIXTURE | ✓ | `confidence` |
| `league_goal_profiles` | COMPETITION_EDITION | ✓ | `league_goals` |
| `squad_stability` | TEAM | ✗ | **none** |
| `historical_advantage` | FIXTURE | ✗ | **none** |
| `risk_assessment` | FIXTURE | ✗ | **none** |
| `match_context` | FIXTURE | ✗ | **none** |

**Every active module has a V1 predecessor; every module without one is
registered inactive.** V1's `btts_fatigue`, `halftime`, `clean_sheet` and
`weather` are **dropped** — a deliberate product decision recorded in the seed.

### 7.2 CORRECTION to doc 25 §B-2

Doc 25 states: *"Without the view definitions, the inputs of every V1 module are
unknown."* **That is too strong, and the difference matters for what S-0 must
recover.**

Read directly, the thirteen `eval*` functions consume **named, typed row
shapes**, and those shapes are declared in `beta/live-frontend/src/lib/types.ts`:

| eval function | consumes | fields declared |
|---|---|---|
| `evalRest` | `match.intel.{home,away}_rest_days` | 12 (`TeamIntelligence`) |
| `evalFormGap` | `match.{home,away}Intel.form_index` | 12 |
| `evalConfidence` | `match.intel.confidence_{band,score}`, `bandBacktests` | 12 |
| `evalLeagueGoals` | `match.intel.predicted_{home,away}_goals`, competition | 12 |
| `evalTravel` | a `ModuleTravelRow` | 6 — *"columns confirmed against production"* |
| `evalHomeAway` | `TeamVenuePerformance` | 8 |
| `evalReadinessTracker` | `TeamMomentum` | 3 |
| `evalConsistency`, `evalGiantKiller` | `TeamFormQuality` | 16 |

So the correct statement is:

> **The input FIELD NAMES and TYPES of every V1 module are known. What is unknown
> is how those fields are DERIVED from base tables.**

`evalRest` is the clearest case: it reads two scalars and applies a pure band
table over their difference, with a hardcoded rate per band and
`sample: 1179, provenance: "unreplayed"`. **The evaluation logic is fully legible
and portable; the number it is applied to is not**, because `home_rest_days` is
produced by a view whose SQL does not exist in this repository.

That is what S-0 must recover — and it narrows S-0 from *"thirteen unknown
views"* to *"the derivation of a bounded, named set of columns"*. Recovering the
derivation is still required: a V2 feature must reproduce the **number**, not
merely the field name, or doc 15 §6.4 step 5's golden-file test cannot pass.

**Confirmed unchanged:** no `CREATE MATERIALIZED VIEW mv_module_*` exists
anywhere in the repository. The only materialised views defined are
`product.mv_module_directory` and `product.mv_competition_summary`, which are V2
projections and unrelated.

### 7.3 Two V1 behaviours that are NOT automatically V2 requirements

- **Hardcoded rates and samples.** Doc 15 §6.3 says these *"become calibration"*
  — `published_baseline` rows behind a sample gate. So porting `rate: 62.5,
  sample: 1179` as a literal would contradict the stated disposition. EXPLICIT.
- **`provenance: "unreplayed"`.** Becomes `published_baseline.is_verified` and
  `measurement_provenance` — EXPLICIT. V1's string is not a V2 value.

## 8. Specification gaps — what genuinely cannot be determined

Only unresolved items appear here.

| # | Gap | Class |
|---|---|---|
| **G-a** | **The status derivation.** Nothing states how `module_status_code` is chosen. V1 derives it from a `pickSide` the viewer supplies — **V2 has no `pick` anywhere** (LC-71 forbids a selection), so V1's rule is not portable even in principle | **UNKNOWN** |
| **G-b** | **`strength` and `confidence`.** Both nullable, neither defined. No formula, no scale, no relationship to evidence | **UNKNOWN** |
| **G-c** | **`sample_observation_count` semantics.** NOT NULL and named the platform's evidential standard (LC-60), but what is being counted — features consumed? observations behind a baseline? — is not stated | **UNKNOWN** |
| **G-d** | **`sample_meets_threshold`.** NOT NULL. `calibration.sample_gate` exists to hold thresholds and is **empty**; nothing says which gate applies to which module | **UNKNOWN** |
| **G-e** | **Declared inputs.** `declared_input_count` is NOT NULL and no relation declares a module's inputs. `module_input_conformance` is registered and has nothing to check | **UNKNOWN** (doc 25 B-5) |
| **G-f** | **`contribution_direction` per citation.** NOT NULL, three values, no assignment rule | **UNKNOWN** |
| **G-g** | **Cross-subject consumption.** 5 of 9 active modules are FIXTURE- or COMPETITION_EDITION-subject; **all 7 feature definitions are TEAM-subject**. Whether a fixture module may consume its two teams' features, and how they combine, is unspecified | **UNKNOWN** |
| **G-h** | **What `module_version` 1.0.0 means.** The rationale says *"carries forward the V1 module unchanged; the evaluation logic is ported in S-6"* — and the V1 logic cannot be reproduced without S-0. Identical in shape to the S-5 conflict that doc 23 had to resolve | **UNKNOWN** |
| **G-i** | **The four inactive modules.** `squad_stability`, `historical_advantage`, `risk_assessment`, `match_context` have no V1 predecessor and no specification — only a registry row and a question | **UNKNOWN** |
| **G-j** | **The INACTIVE reason has nowhere to go.** Doc 15 §6.3 says `inactive(def, reason)` becomes *"`module_status_code = 'INACTIVE'` **with a stored reason**"*. `module_reading` has **no reason column** — only `headline_text` and `verdict_text`, and I-5 says INACTIVE is silent. Schema-or-specification gap | **finding F-C** |
| **G-k** | **`sample_gate` is unseeded.** Doc 15 §6.2 assigns it to *"Seeder"*; it holds **0 rows**, and no seed stage writes it. §6.4 step 7 — *"publish a baseline only when the sample gate passes"* — cannot be evaluated. **Same class as the `quality_check_version` gap closed in doc 53** | **finding F-A** |
| **G-l** | **Timing.** Nothing states what `as_of` a reading is computed at, at what cadence, or how it relates to `snapshot_point`. S-5 has a driver with an explicit range; S-6 has no equivalent statement | **UNKNOWN** |
| **G-m** | **Idempotency and reconciliation.** I-1 makes a re-run conflict; whether that is `DO NOTHING`, an error, or a new version is unstated. S-5's answer does not automatically transfer | **UNKNOWN** |

**Not gaps — already answered by the repository, and listed so they are not
re-asked:** who writes what (§1); the reading's identity (I-1); subject/context
exclusivity (I-2, I-4); INACTIVE silence (I-5); one evidence set per reading
(I-7); citations must reference real feature values (I-9); temporal ordering
(I-10); append-only posture (I-13); the retention identity (§5); which V1 modules
map to which V2 modules (§7.1); and that hardcoded rates become calibration
(§7.3).

## 9. Decision questions — the minimum set

Seven. Each is a decision only you can take; none can be answered from the
repository.

> **D-1 — Does S-6 start before S-0, or wait for it?**
> The nine active modules' `module_version` 1.0.0 asserts V1's logic unchanged,
> and that logic cannot be reproduced without the `mv_*` derivations (§7.2).
> Either S-0 recovers them, **or** 1.0.0 is redefined as "the V2 rule" — the
> DEC-1 decision doc 23 took for S-5. **This gates everything below.**

> **D-2 — What derives `module_status_code`, given that V2 has no pick?**
> V1's SUPPORTS/CONTRADICTS is relative to a viewer's selection, which V2
> forbids (LC-71). A status must therefore be relative to *something else* — the
> module's own characterisation, a home/away orientation, or a threshold on
> `strength`. This is the single largest gap and nothing in the repository
> constrains it.

> **D-3 — Where are a module's declared inputs held?**
> `declared_input_count` is NOT NULL and `module_input_conformance` is a
> registered assertion with nothing to check. Options: a new
> `module.module_input` relation (a migration, schema-owner decision), or
> declaration in calculator code with the count derived. **Doc 25 B-5, still
> open.**

> **D-4 — May a FIXTURE-subject module consume TEAM-subject features, and how?**
> Five of nine active modules have no feature at their own subject kind. If yes,
> the combination rule (home−away? both cited?) is part of the answer, because it
> determines the evidence citations.

> **D-5 — What are `strength`, `confidence` and `sample_observation_count`?**
> Three columns, one NOT NULL, none defined. LC-60 makes the count load-bearing,
> so a convention that is merely plausible is not enough.

> **D-6 — Where does an INACTIVE reading's reason go?** (F-C)
> Doc 15 promises a stored reason; no column holds one and INACTIVE is
> constrained to be silent. Either a column is added (migration) or the promise
> is withdrawn.

> **D-7 — Who seeds `calibration.sample_gate`, and with what thresholds?** (F-A)
> Doc 15 assigns it to the seeder; it is empty. Without it,
> `sample_meets_threshold` has no basis and the §6.4 step-7 publication rule
> cannot run.

### Recommended sequencing of the answers

D-1 first — it determines whether D-2 is *"recover V1's rule"* or *"author a V2
rule"*. D-3, D-6 and D-7 are the three that may carry a migration and can be
decided in parallel. D-4 and D-5 depend on D-2.

**Not required to start:** the checksum canonical form (S-7's BLOCKING TODO), the
retention granularity decision, and the four inactive modules (G-i) — they are
registered inactive and nothing consumes them.

---

**Nothing implemented. No schema change, no migration, no assertion altered, no
evaluation rule or status semantics invented. S-7 and S-8 untouched. No provider
quota. `provider_statistic` and G-1 untouched.**

**S-6 remains BLOCKED, and is now blocked on seven named decisions rather than on
an absence.**
