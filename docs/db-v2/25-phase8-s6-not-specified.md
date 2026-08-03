# PitchTerminal V2 — S-6 Module Evaluation: Cannot Begin

**Implementation has not started. No file under `src/v2/module/` has been created.**

The S-6 brief instructs: *"If the specification contains ambiguity: stop, report it, do not invent behaviour."* S-6 is not ambiguous in places — **it has no specification**, and its declared blocking prerequisite has not been done.

Five independent blockers, each verified against the repository or the live database.

---

## B-1 — No S-6 specification exists

Every prior subsystem was specified before it was built. S-6 has none of it:

| Artefact | S-5 | S-6 |
|---|---|---|
| Architecture document | doc 20 | **absent** |
| Implementation specification | doc 21 | **absent** |
| Decision record | doc 23 | **absent** |

What exists is [document 15](./15-phase8-application-migration-specification.md) §3.6 and §6 — a **migration plan**: what exists today, where the code moves, which relations receive it, and a per-module sequence. It is a disposition table, not an evaluation specification. It does not state, for any module:

- the rule that derives `module_status_code` — `SUPPORTS`, `CONTRADICTS`, `NEUTRAL` or `INACTIVE`
- how `confidence` is computed
- which feature values the module consumes
- how `sample_observation_count` and `sample_meets_threshold` are derived
- how `contribution_direction` is assigned to each evidence citation

Every one of those is a NOT NULL column on a relation S-6 must write, except `confidence` which is nullable.

**This is the S-5 lesson, exactly.** Document 21 §10 judged the missing formulae *"safe to leave to implementation"*; [document 22](./22-phase8-s5-implementation-blocked.md) recorded that the judgement was wrong, because the declared windows *were* part of the formula. S-6 is the same shape with none of the specification S-5 at least had.

---

## B-2 — S-0 is unfinished, and document 15 names it as blocking S-6

Document 15's own dependency table:

| Subsystem | Depends on | Blocking issue |
|---|---|---|
| **S-0** | `mv_*` recovery | — | **Blocks all module and calibration planning** |
| **S-6** | Module generation | **S-0**, S-5, S-3 | `mv_*` definitions |

And §6.1:

> Each definition names a source view — `mv_module_home_away`, `mv_module_readiness_tracker`, … — and **all thirteen are undefined everywhere in the repository** (Phase 7 AC-05). This is why S-0 blocks this workstream.

§6.4 makes it step one: *"1. Recover the module's `mv_*` definition from production (**S-0**)."*

**Verified still true.** `beta/live-frontend/src/lib/modules.ts` (57 KB) references thirteen views, and a repository-wide search for a definition of each returns **zero**:

```
mv_match_scoring_probabilities : 0        mv_module_home_away          : 0
mv_module_btts_fatigue         : 0        mv_module_league_goals       : 0
mv_module_clean_sheet          : 0        mv_module_readiness_tracker  : 0
mv_module_confidence           : 0        mv_module_rest               : 0
mv_module_consistency          : 0        mv_module_travel             : 0
mv_module_form_gap             : 0        mv_module_giant_killer       : 0
mv_module_halftime             : 0
```

Document 15 registers this as risk **B-1**: *"Thirteen `mv_*` definitions exist only in production | affects S-6, S-9, and the effort estimate | owner: Platform."* It is still open.

**Without the view definitions, the inputs of every V1 module are unknown.** The `eval*` functions can be read, but what they read cannot.

---

## B-3 — `module_version` 1.0.0 repeats the S-5 authority conflict

Read from the live registry:

```
home_away_split   :: Initial registration. Carries forward the V1 module 'home_away'
                     unchanged; the evaluation logic is ported in S-6.
readiness_tracker :: Initial registration. Carries forward the V1 module 'readiness'
                     unchanged; the evaluation logic is ported in S-6.
```

This is the identical structure that blocked S-5: **the registry defines what version 1.0.0 means, and it means "the V1 logic unchanged"**. In a system where *"a measured rate spanning two rules describes a system that never existed"*, the rule is not an implementation detail — it *is* the version.

For S-5 that conflicted with the specification. For S-6 it is worse: **the V1 logic cannot be carried forward at all**, because it reads thirteen views that do not exist (B-2). There is nothing to port unchanged, and no specification saying what should replace it.

S-6 holds no `UPDATE` on `module_version`, so it could not amend the rationale even if that were the right answer — the same governance boundary recorded for S-5.

---

## B-4 — Most active modules have no inputs at their subject kind

| | TEAM | FIXTURE | COMPETITION_EDITION |
|---|---|---|---|
| Modules registered | 5 | 7 | 1 |
| Modules **active** | 4 | 4 | 1 |
| **Feature definitions available** | **7** | **0** | **0** |

S-5 delivered six calculated features, **all TEAM subject** — a stated and approved scope limit (doc 21 §9, D-3).

**Five of the nine active modules are FIXTURE- or COMPETITION_EDITION-subject and have no feature at their own subject kind to consume.** Whether a fixture-subject module may consume team-subject features of its two participants — and if so, how the two are combined — is a modelling decision nothing specifies.

`feature.feature_value` also currently holds **0 rows**: S-5 is implemented and verified but has not been run against ingested reality, because S-4 ingests forward-only and no production feed has been connected. That is operational rather than architectural, but it means a golden-file test (doc 15 §6.4 step 5) has nothing to compare.

---

## B-5 — Nothing declares a module's inputs, yet three columns require them

`module.module_evidence` requires, all NOT NULL:

```
declared_input_count   present_input_count
below_threshold_input_count   estimated_input_count
```

and `operations.quality_check` registers `module_input_conformance`: *"Every evidence citation falls within the consuming module's declared inputs."*

**There is no relation in schema `module` that declares a module's inputs.** Verified: no relation matching `%input%` exists. Layer 2 has `feature_source` (Layer 1 relations read) and `feature_dependency` (features consumed); Layer 3 has no equivalent.

So `declared_input_count` has no source of truth, and the registered conformance check has nothing to check against. This is a **schema-or-specification gap in its own right**, independent of the other four, and it should be resolved by the architecture owner rather than by S-6 inventing a convention.

---

## What I did not do

- **Did not create `src/v2/module/`.** No file, no scaffold, no stub.
- **Did not invent an evaluation rule**, a status derivation, a confidence formula or an input declaration for any module.
- **Did not port the V1 `eval*` functions.** They read views whose definitions do not exist, so a port would be a guess wearing V1's name — and `module_version` 1.0.0 asserts it is V1's logic unchanged.
- **Did not modify the schema or write a migration.** B-5 is a finding, not a licence.
- **Did not touch S-5.** Its output is read-only to S-6 and untouched.

---

## What is needed before S-6 can begin

In dependency order:

1. **S-0 — recover the thirteen `mv_*` definitions from production.** Document 15's own step one, owner Platform, still open. Everything else is guesswork until this lands.
2. **An S-6 architecture document** — the module inventory, per-module inputs, the dependency graph from features to modules, evidence model, and scope.
3. **An S-6 implementation specification** — status derivation, confidence, sampling and threshold semantics, `contribution_direction`, transaction boundaries, replay guarantees.
4. **A decision record** resolving what `module_version` 1.0.0 means, exactly as [document 23](./23-phase8-s5-decision-record.md) did for S-5 — including whether a FIXTURE-subject module may consume TEAM-subject features, and how.
5. **A ruling on B-5** — where module inputs are declared. If a relation is needed, that is a migration and a schema-owner decision.

Items 2–4 are the same three artefacts S-5 required. S-5 also demonstrated that producing them is not a formality: even with all three, implementation still uncovered that the formulae were undetermined, which took a further decision record to close.

---

## Status

**S-6 has not begun and cannot begin on the current specification.**

S-5 remains complete and unaffected: 102/102 in the subsystem, 321/321 across the backend, 181/181 without a database.
