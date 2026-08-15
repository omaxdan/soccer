# Phase 8 — S-6 Gate A: Ratification Note

## Governance closure only · nothing implemented

| | |
|---|---|
| Entry contract | `fadd53c` (doc 73) |
| **Gate A** | **PASSED** — all three methodology decisions ratified as already recorded |
| **Conflicts** | NONE |
| **Migration 023** | **authorized to author** (Gate B) |

This note ratifies three decisions that authoritative documents already settled.
It introduces no new rule, reinterprets nothing, and touches no code, schema,
registry, or existing decision.

---

## 1. Purpose

Remove the last governance ambiguity before migration 023 is authored, by formally
accepting the three `-i`/open-half items the S-0 audit and S-6 entry contract left
pending: **D-5c-i**, **S-0-c-i**, **D-3 (declaration site)**. Each is confirmed
against its governing source verbatim.

## 2. Governing source documents

- **D-5c-i** — doc 58 (`58-phase8-s6-d5c-final.md`) §1; DEC-5 in doc 23.
- **S-0-c-i** — doc 60 (`60-phase8-s0-final-decisions.md`) §S-0-c + "minimum
  decisions still open."
- **D-3** — doc 56 (§D-4), doc 57 (§D-4a residual), doc 58 (status table); site
  recommendation in doc 73 §3.

## 3. D-5c-i ratification

**Ratified as recorded.** Adopt mechanism **(c) — a per-module-version rule — with
`MIN(consumed.sample_observation_count)` as the declared content of version
1.0.0** (doc 58 §1). Confirmed exactly, no alteration:

- **Composite modules:** `sample_observation_count = MIN(consumed.sample_observation_count)`
  — the weakest-input shape LC-37/DEC-5 use for provenance, applied to evidence volume.
- **Non-composite (no lineage):** the value's **own observation count passes through
  unchanged** — `MIN` does not apply, per R-53's exemption for values with no
  lineage (doc 23 DEC-5). `MIN(consumed)` "absorbs option (a) as a special case."
- **Provenance propagation** is unchanged and separate: modules cite feature values;
  the engine does not recompute provenance.
- **This is the governing S-6 module-engine contract** for the observation count,
  and — like the status rule under D-2 — it is declared by the module version, so
  a version means "this module's rule, entire."

No new observation-count interpretation is introduced.

## 4. S-0-c-i ratification

**Ratified as recorded** (doc 60): **doc 15 §6.4 step 5 is rescoped.** A V1
golden-file comparison is legitimate **only where a V1 rule is deliberately carried
across** — `form_gap_accuracy`, `consistency_index`, `giant_killer_index`,
`rest_advantage`. It is **invalid** where a V2 decision superseded V1
(`travel_impact`; `readiness_score` at the feature layer) and **harmful** where V1
is defective (`readiness_tracker`). **Everywhere else, V2 golden fixtures are
derived from the declared rule.** This is now the governing V2 test methodology for
S-6. Scope unchanged; no S-0 architecture reopened.

## 5. D-3 ratification

**Ratified: declaration by calculator code; no `module_input` relation, no
migration.** Permission (a FIXTURE module may consume TEAM features where declared)
was already settled (D-4); the open half was *where* the mapping is declared. It is
declared in the **module calculator** — the calculator names the feature inputs it
consumes, and the engine derives `declared_input_count` from that declaration —
mirroring the S-5 pattern where a `Calculator` declares its `featureKeys` and the
pipeline derives the rest. No new schema mechanism is created; migration 023 is
**not** expanded for D-3.

## 6. Cross-check against S-6

| Against | Result |
|---|---|
| Migration 023 contract (doc 73 §4) | consistent — D-5c-i needs `minimum_sample_observation_count` (in 023); D-3 needs **no** column |
| Module engine contract (doc 73 §5) | consistent — engine computes `MIN(consumed)`, derives `declared_input_count`, uses V2-derived goldens |
| Feature-dependency architecture | consistent — module input declaration parallels feature `featureKeys`/edges |
| Provenance architecture | consistent — unchanged; modules cite, do not recompute |
| Registry conventions | consistent — no registry row changed |
| S-6 entry contract (doc 73) | consistent — these are exactly its three pending items |
| Travel decisions (docs 61–71) | consistent — untouched; S-0-c-i correctly marks `travel_impact` as superseded (no V1 golden) |
| S-9 calibration boundary | consistent — none of the three touches `sample_gate`/`published_baseline`/outcome validation |

**No conflict found.**

## 7. Explicit non-decisions

This note does not: implement code; create a migration; create feature/module
values or dependencies; modify registry rows; touch Travel, readiness, or S-9;
create `team.home_away_performance` or the module engine; or alter any existing
decision. It changes the *status* of three recorded decisions to ratified; it
decides no new work.

## 8. Gate-A conclusion

The three items were already established in authoritative documents and source;
Gate A ratifies them rather than redesigning them. No ambiguity remains that blocks
migration 023. Gate B (authoring migration 023, exactly the two columns of doc 73
§4) is authorized to proceed.

---

## STATUS

**D-5c-i:** RATIFIED
**S-0-c-i:** RATIFIED
**D-3:** RATIFIED
**Conflicts:** NONE
**Gate A:** PASSED
**Migration 023:** AUTHORIZED TO AUTHOR
**Next gate:** Gate B — Migration 023
