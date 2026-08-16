# S-6 Gate E-i — Reusable ALL_COMPETITIONS × TEAM Module-Engine Capability

**Gate type:** design / implementation-specification only. No code, no migration,
no registry change, no engine change, no `readiness_tracker`, no team-momentum
feature. The only artefact is this document.

**Objective:** specify the smallest reusable change that lets the S-6 module
engine support **TEAM × ALL_COMPETITIONS** while preserving the already-verified
**TEAM × COMPETITION_SCOPED** path byte-for-byte, without special-casing
`readiness_tracker` and without duplicating the feature-layer context mechanism.

**Inspected at `d47eb20` / `9666a56`:** `module/{types,pipeline}.ts`,
`module/registry/load.ts`, `module/read/consumedFeatures.ts`,
`module/write/readings.ts`, `module/calculators/homeAwaySplit.ts`,
`module/__tests__/moduleEngine.test.ts`; the live `module.module_reading` schema;
`feature/driver/eligibility.ts` (`selectBatches`, `selectScopedBatches`),
`feature/read/featureValues.ts` (`readPriorValues`),
`feature/calculators/types.ts` (`CalculationScope`, context vocabulary),
`football.context_kind`; Gate C-ii (docs 77 / `5796e12` / `85a7bab`) and Gate 79
(`23ee9b2`).

---

## 0. The finding in one line

The module *storage* schema already supports TEAM × ALL_COMPETITIONS with **no
migration**; the *engine code* is the only thing that is hardwired, and the
feature layer already contains the exact reusable pattern to unwire it. The
change is bounded to five module-layer source files.

---

## 1. What is hardwired today (verified)

The Gate D engine binds TEAM × COMPETITION_SCOPED at four code sites — none of
them in the schema:

| Site | Hardwiring |
|---|---|
| `module/types.ts` | `ModuleCalculator.contextKind: 'COMPETITION_SCOPED'` (literal), `subjectKind: 'TEAM'` (literal) |
| `module/read/consumedFeatures.ts` | SQL fixes `context_kind_code='COMPETITION_SCOPED'` and **requires** `context_competition_edition_id = $5` |
| `module/write/readings.ts` | INSERT hardcodes `'COMPETITION_SCOPED'` and binds `context_competition_edition_id = $6` |
| `module/pipeline.ts` | driver = `selectScopedBatches` only; `assembleReading` takes `competitionEditionId: string` (non-null) |

`subjectKind: 'TEAM'` stays fixed for E-i (this gate is TEAM-only; FIXTURE /
COMPETITION_EDITION remain out of scope, as Gate 79 established). Only the
**context/scope** axis is generalized.

---

## 2. The schema already permits it — proof (no migration)

From the live `module.module_reading` definition:

```
ck_module_reading__context_edition_conditional CHECK (
  (context_kind_code =  'COMPETITION_SCOPED' AND context_competition_edition_id IS NOT NULL) OR
  (context_kind_code <> 'COMPETITION_SCOPED' AND context_competition_edition_id IS NULL))
```

→ `context_kind_code='ALL_COMPETITIONS'` **with a NULL edition is explicitly
valid.**

```
uq_module_reading__subject_context_definition_asof_version
  UNIQUE NULLS NOT DISTINCT (subject_kind_code, subject_team_id, subject_player_id,
    subject_fixture_id, subject_fixture_partition_on, subject_competition_edition_id,
    context_kind_code, context_competition_edition_id, module_definition_id, as_of,
    module_version_id)
```

→ the unique key **includes** `context_kind_code` and
`context_competition_edition_id`, and is `NULLS NOT DISTINCT`. Consequences:
- an ALL_COMPETITIONS reading (edition NULL) and a COMPETITION_SCOPED reading
  (edition set) for the same team/as_of/definition/version **do not collide** —
  different `context_kind_code` (and different edition). Both scopes coexist.
- NULL edition is treated as a value, so `ON CONFLICT … DO NOTHING` is idempotent
  for ALL_COMPETITIONS exactly as for scoped.

Other constraints are orthogonal or already satisfied:
- `ck_module_reading__subject_exclusive` governs the *subject*, not the context —
  unchanged for TEAM.
- **No FK and no CHECK enumerates `context_kind_code`** on `module_reading`; and
  `ALL_COMPETITIONS` is in `football.context_kind` regardless.
- `module_evidence_item` cites a feature value by its `(id, as_of)` composite FK —
  **context-agnostic**; the cited value's scope is intrinsic to that
  `feature_value` row (see §Q8).

**Answer to Q7: yes — the module schema supports TEAM × ALL_COMPETITIONS with no
migration. Migration 024 is NOT required by this gate.**

---

## 3. The feature layer already contains the reusable pattern

Nothing needs inventing; the module layer mirrors what S-5 already does:

- **Enumeration:** `feature/driver/eligibility.ts` exports **both**
  `selectBatches` (`SubjectBatch` = as_of × team, no edition — ALL_COMPETITIONS)
  and `selectScopedBatches` (`ScopedSubjectBatch` = as_of × edition × team). The
  module engine already imports the scoped one; it reuses the all-comp one
  verbatim.
- **Scope as a value:** `feature/calculators/types.ts` defines `CalculationScope`
  (a discriminated union: `{ALL_COMPETITIONS, editionId:null}` |
  `{COMPETITION_SCOPED, editionId:string}`), `CALCULATION_CONTEXT_KIND`,
  `COMPETITION_SCOPED_CONTEXT_KIND`, `ALL_COMPETITIONS_SCOPE`. The module engine
  **reuses these constants** (it already imports `COMPETITION_SCOPED_CONTEXT_KIND`)
  — single source of truth, no duplicated vocabulary.
- **Scope-parametrized read:** `feature/read/featureValues.ts::readPriorValues`
  filters ALL_COMPETITIONS by `context_kind_code` only (edition NULL by the
  conditional check); the scoped module reader adds the edition predicate. Same
  shape, one predicate different.
- **Scope-parametrized write:** `feature/write/values.ts::writeValues(…, scope)`
  is the exact precedent (Gate C-ii) for threading a scope into the write instead
  of hardcoding it.

**Answer to Q2 — where scope is declared:** on the **calculator contract**
(`ModuleCalculator.contextKind`), exactly as `Calculator.contextKind` is declared
in feature calculator code. Rationale: the scope at which a module reads its
inputs is an implementation property of the calculator (which features, at what
scope) — the same class of decision the feature layer keeps in code. It is **not**
the module registry (`subject_kind` is about the module's *subject*, not its input
scope) and **not** `module_version` (that would need a migration and would
duplicate the feature-layer mechanism). This mirrors, and does not duplicate, the
feature mechanism: each layer declares its own calculators' scope in code, over
the one shared `football.context_kind` vocabulary.

---

## 4. Answers to the gate's questions

**Q1 — One generic pipeline for both scopes?** Yes. Per calculator, the pipeline
reads `calculator.contextKind`, selects the matching batch set, and threads a
scope through read → assemble → write. One pipeline, one `runModuleBatch`, no
second engine.

**Q3 — Enumerate ALL_COMPETITIONS TEAM subjects?** Reuse `selectBatches`
(as_of × team, no edition), already verified in S-5. A run with both scoped and
all-comp calculators computes both batch sets once, then routes each calculator
to its own set.

**Q4 — Resolve consumed values at ALL_COMPETITIONS / edition NULL?** A
scope-parametrized `readConsumedFeatures`: for ALL_COMPETITIONS filter
`context_kind_code='ALL_COMPETITIONS' AND context_competition_edition_id IS NULL`
(no edition parameter); for COMPETITION_SCOPED keep the current
`context_kind_code='COMPETITION_SCOPED' AND context_competition_edition_id = $edition`.
The scoped branch's SQL text and parameters stay identical (Q6).

**Q5 — Version resolution × scope?** Orthogonal. `resolveModuleVersion` selects by
`effective_period @> as_of`; scope is not part of version identity and must not
leak into it. No change. A version applies to the module regardless of input
scope.

**Q6 — `home_away_split` byte/behaviour-equivalent?** Yes, by construction. It
declares `contextKind: 'COMPETITION_SCOPED'` → routes to the preserved scoped
branch → identical enumeration (`selectScopedBatches`), identical read SQL,
identical `writeReading` INSERT (same columns, params, `ON CONFLICT`). The
existing `moduleEngine.test.ts` DB tests are the regression guard and must pass
unchanged.

**Q7 — Schema without migration?** Yes (§2). No migration 024.

**Q8 — Evidence: ALL_COMP vs scoped feature value?** The evidence item cites the
`feature_value` by its `(id, as_of)` composite FK. The cited value's scope is a
property of that row, not something the citation re-encodes. Because
`readConsumedFeatures` selects **only** the correct-scope rows for the module's
declared context, the cited id is necessarily the ALL_COMPETITIONS value for an
ALL_COMPETITIONS module. The reading's own `context_kind_code` additionally
records the module's scope. No new evidence machinery.

**Q9 — Mixed-context inputs?** A calculator declares **one** `contextKind`; the
engine reads **all** of its `inputFeatureKeys` at that single scope.
`readiness_tracker` needs only ALL_COMPETITIONS inputs, so mixed-context is not
required. **Boundary, defined explicitly:** a module whose inputs span two scopes
is UNSUPPORTED by this engine; nothing about mixed-context is built. If such a
module is ever approved, it is a separate future gate. This matches the feature
layer, where a calculator also has a single `contextKind`.

**Q10 — Smallest reusable change?** §5.

---

## 5. The bounded implementation (five files, module layer only)

Each change is generic and parametrized on scope — no feature-key branching, no
`readiness_tracker` mention, no hardcoded ALL_COMP calculator.

1. **`module/types.ts`** — widen `ModuleCalculator.contextKind` from the literal
   `'COMPETITION_SCOPED'` to `typeof CALCULATION_CONTEXT_KIND | typeof
   COMPETITION_SCOPED_CONTEXT_KIND` (imported from `feature/calculators/types`).
   `subjectKind` stays `'TEAM'`. No other type change.

2. **`module/read/consumedFeatures.ts`** — accept a scope (context kind + optional
   edition) instead of a required `competitionEditionId`. Two branches over one
   query shape: ALL_COMPETITIONS → `context_kind_code=$ AND
   context_competition_edition_id IS NULL`; COMPETITION_SCOPED → the **unchanged**
   scoped predicate. `consumedKey` unchanged (`<featureKey>|<teamId>`).

3. **`module/write/readings.ts`** — `ReadingToWrite` carries `contextKindCode:
   string` and `contextEditionId: string | null` (replacing the always-present
   edition). The INSERT binds `context_kind_code` and a nullable
   `context_competition_edition_id`; `subject_kind_code='TEAM'`,
   `subject_team_id`, `strength/confidence/published_baseline_id = NULL`, and the
   named `ON CONFLICT` target are all **unchanged**. The scoped case produces a
   byte-identical row to today.

4. **`module/pipeline.ts`** — normalize both batch shapes to one internal
   `ModuleBatch { asOf, competitionEditionId: string | null, teamIds,
   snapshotPointCodes }`. Compute `selectScopedBatches` and/or `selectBatches`
   once, depending on which context kinds the run's calculators declare; route
   each calculator to its matching batch set. `runModuleBatch` and
   `assembleReading` take the scope and thread it into read/write.
   `assembleReading`'s `competitionEditionId` becomes `string | null` and it sets
   `contextKindCode` from the calculator. Registry reconciliation, one-tx-per-
   (module×batch), telemetry, and INACTIVE/MIN(consumed) logic are unchanged.

5. **`module/calculators/homeAwaySplit.ts`** — **unchanged** (already declares
   `contextKind: 'COMPETITION_SCOPED'`). Listed only to state it is deliberately
   untouched.

**Not changed:** `module/registry/load.ts` (version resolution is scope-agnostic);
the module registry seed; any migration; the feature layer; `MODULE_CALCULATORS`
(still exactly `[homeAwaySplit]` — no new module is added in E-i).

---

## 6. Adversarial verification matrix (for the future implementation)

Pure tests (no DB) and DB tests (skip without a cluster), mirroring
`moduleEngine.test.ts`. Every row guards against the Gate D hardcoding.

| # | Assertion | Guards |
|---|---|---|
| 1 | An ALL_COMP TEAM calculator (a **test-only probe**, not readiness_tracker) consumes an ALL_COMPETITIONS feature value and writes a reading with `context_kind_code='ALL_COMPETITIONS'`, `context_competition_edition_id IS NULL` | the core new path |
| 2 | `home_away_split` (COMPETITION_SCOPED) end-to-end still produces the identical reading + evidence + 2 items (existing DB tests pass unchanged) | Q6 regression |
| 3 | Same team + same as_of carries **both** an ALL_COMP reading and a scoped reading; both persist, no collision | unique key includes context; NULLS NOT DISTINCT |
| 4 | Scoped editions A and B remain isolated (existing edition-isolation test unchanged) | scoped read predicate intact |
| 5 | An ALL_COMP module read does **not** pick up any edition-scoped feature value (and vice-versa) | Q4 — context filter both ways |
| 6 | ALL_COMP write binds NULL edition; `ck_module_reading__context_edition_conditional` is satisfied, never violated | NULL-edition handling |
| 7 | Idempotent rerun of an ALL_COMP reading → second write skipped | ON CONFLICT over context columns |
| 8 | `resolveModuleVersion` returns the same version irrespective of scope; a reading is attributed to the `effective_period @> as_of` version | Q5 — no scope leakage |
| 9 | Evidence items of an ALL_COMP reading cite exactly the ALL_COMP feature value ids the reader returned | Q8 |
| 10 | `sample_observation_count = MIN(consumed)` holds for ALL_COMP too; INACTIVE when an ALL_COMP input is absent (silent + reason, no items) | assembly logic scope-independent |
| 11 | No new ALL_COMP path writes any `feature.feature_value` row (module layer never writes features) | feature-path non-regression |
| 12 | Reconciliation still refuses an unregistered module calculator, at either scope | reconciliation intact |
| 13 | A probe declaring `contextKind:'ALL_COMPETITIONS'` routes to `selectBatches`; one declaring `'COMPETITION_SCOPED'` routes to `selectScopedBatches` — asserted directly | **anti-hardcoding**: proves the router, not a fixed scope |
| 14 | Static assertion: `MODULE_CALCULATORS === [home_away_split]` (no module added by E-i) | scope creep guard |
| 15 | No migration file added; `git` scope confined to the five module files + tests | "no migration unless proven necessary" |

The probe calculator (row 1/13) is the module-layer analogue of Gate C-ii's
`probeCalculator`: a throwaway ALL_COMP TEAM calculator emitting against an
existing ALL_COMPETITIONS feature (e.g. `team.readiness_score`, which is already
produced), exercising the plumbing without implicitly defining `readiness_tracker`. It
lives in the test file only.

---

## 7. The D-2 `module_version.rationale` obligation (inspected, not fixed)

**What it requires (doc 56):** under D-2 each module version's `rationale` is
where its status rule is *stated*; the thirteen seeded rationales still say
*"Carries forward the V1 module … unchanged; the evaluation logic is ported in
S-6,"* which D-2 made false. The authoritative fix amends those rationales to
state each version's rule.

- **Migration?** **Yes.** No role holds UPDATE on `module_version` (verified:
  `pt_pipeline_module` INSERT+SELECT, all others SELECT). So the amendment is an
  owner-executed migration.
- **Prerequisite to E-i?** **No.** E-i changes engine *scope capability*; it
  writes no production readings and does not touch `module_version.rationale`. The
  two are orthogonal. E-i can proceed first.
- **Safe to ratify before production readings exist?** **Yes.** Production
  `module_reading` holds 0 rows, so amending rationales now is non-blocking and is
  exactly doc 56's "before the first reading is written" requirement. It must land
  before any module — `home_away_split` included — writes a *production* reading.
- **Separate gate?** **Yes.** It is a governance + migration matter (a rationale-
  amendment migration covering all thirteen versions), distinct from engine
  capability. It should be its own bounded gate, **not** bundled into E-i and
  **not** silently fixed here.

**Recommendation:** schedule it as a standalone governance/migration gate
(migration 024, rationale amendment only) before E-iii (`readiness_tracker`
implementation) reaches production, ideally covering module #1 at the same time.
It does not gate the E-i engine work.

---

## 8. Scope confirmation

- Reusable and generic: routing is by `calculator.contextKind`, over the shared
  `football.context_kind` vocabulary. No `readiness_tracker` special case, no
  feature-key branching, no second engine/pipeline/reader, no migration.
- The COMPETITION_SCOPED path is preserved behaviourally and, for the persisted
  row, byte-identically.
- `readiness_tracker` and the team-momentum feature are **not** implemented here;
  E-i only makes the engine capable, proven by a throwaway probe.

---

## 9. Verdict

The change is bounded to five module-layer files, requires no migration and no
registry change, reuses the feature layer's proven enumeration/scope/read/write
patterns without duplicating its vocabulary, preserves the scoped path
byte-for-byte, and is provable by an adversarial matrix that explicitly guards
against the original Gate D hardcoding. The D-2 rationale obligation is real but
orthogonal and correctly deferred to its own governance gate.

**E-i IMPLEMENTATION AUTHORIZED**

Bounded to: `module/types.ts`, `module/read/consumedFeatures.ts`,
`module/write/readings.ts`, `module/pipeline.ts` (and the test file);
`module/calculators/homeAwaySplit.ts` deliberately unchanged. No migration 024, no
registry change, no `readiness_tracker`, no team-momentum feature.
