# Phase 8 — S-6 Entry Gate & Module-Engine Contract

## Implementation planning only · no code

| | |
|---|---|
| Prior | `92f6e97` (doc 72, S-0 audit) |
| **Executive conclusion** | S-0 is closed; the three `-i` items are ratifiable now; **migration 023 = exactly two additive columns**; the engine contract is specifiable and minimal; **first module = `home_away_split`** (not `rest_advantage`, whose status rule is an unresolved modelling decision — a STOP condition) |
| **Caveat that shapes the plan** | No recoverable module is both feature-ready **and** status-frozen. `home_away_split` is status-frozen but needs one bounded recoverable feature built first |
| **S-6 implementation** | **NOT authorized** yet — this gate produces the contract; a ratification note + migration-023 authoring gate precede code |

Nothing implemented. No migration, engine, calculator, registry, feature, or test
code; no touch to Travel / readiness / S-9 / calibration / V1 / feature-calc
semantics.

---

## 1. Executive conclusion

S-0's substance is complete (doc 72). The path to a first module reading is now
mechanical and small, with one honest wrinkle: **the module whose semantics are
frozen needs a feature built, and the module whose feature exists has ungoverned
semantics.** The plan therefore targets `home_away_split` (frozen, orientation-free
status; TEAM subject), accepting a bounded recoverable feature build before it, and
explicitly rejects `rest_advantage` as first because its status rule is
orientation-dependent and V1's own fallbacks contradict — a modelling decision, not
an implementation detail (STOP condition, §15).

## 2. S-0 closure confirmation

Per doc 72: all 13 modules RECOVERABLE, 0 UNRECOVERABLE, D-1 satisfied, travel line
closed. No S-0 recovery finding, decision, or schema item remains open. The only
S-0-labelled residue is ratifications/transcriptions, addressed below.

## 3. Three ratification statuses

### D-5c-i — `MIN(consumed.sample_observation_count)` for module `1.0.0`
- **Governs:** `module_reading.sample_observation_count` (NOT NULL, LC-60).
- **Location:** doc 58 §1 recommendation; awaiting confirmation.
- **Implemented?** No — no engine.
- **Ratification needed?** Yes — one line. **Smallest artifact:** a confirmation
  sentence in the ratification note; the rule then lives in the engine (§5), not a
  column.

### S-0-c-i — golden-file rescoping (doc 15 §6.4 step 5)
- **Governs:** the S-6 *test methodology* — a V1 golden comparison applies only where
  a V1 rule is deliberately carried across; elsewhere V2 golden fixtures are derived
  from the declared rule.
- **Location:** doc 60 §S-0-c + "minimum decisions still open."
- **Implemented?** N/A (methodology).
- **Ratification needed?** Yes — one line. **Smallest artifact:** a confirmation
  sentence; binds the test strategy in §12.

### D-3 — declaration site
- **Governs:** where a module's declared inputs live, feeding `declared_input_count`
  and `module_input_conformance`.
- **Location:** doc 56 §D-4 / doc 57 (permission settled; *site* open); doc 58 "D-3
  declaration site remains the open half."
- **Decision to ratify:** **calculator-code declaration**, with the engine deriving
  `declared_input_count` — **no `module.module_input` relation, no migration** (docs
  56/57 lean this way; it mirrors S-5, where calculators declare `featureKeys` and
  the pipeline derives the rest).
- **Ratification needed?** Yes — one line. **Smallest artifact:** a confirmation
  sentence; then the calculator interface (§11) carries the declaration.

All three are **OUTSTANDING but ratifiable now**, each a single sentence, none
requiring new architecture.

## 4. Migration 023 — exact contract

Verified against `v2/migrations/008_module_storage.sql`. **Two additive columns,
nothing more.**

### 4.1 `module_version.minimum_sample_observation_count`
| | |
|---|---|
| Table | `module.module_version` (not partitioned) |
| Type | `integer` |
| Nullability | `NOT NULL` |
| Default | `DEFAULT 0` |
| Constraint | `CHECK (minimum_sample_observation_count >= 0)` — mirrors `feature_definition.meaningful_sample_threshold` (`NOT NULL DEFAULT 0`, `>= 0`) |
| Index | none |
| Backfill | none — the 13 seeded `1.0.0` rows take `0` (= "any observation meets"), consistent with the feature layer's convention |
| Existing rows valid? | yes, unchanged |

Rationale: a module reading's `sample_meets_threshold` (NOT NULL) needs a
per-version basis at S-6, **independent of S-9's `sample_gate`** (which governs
*published outcome rates*, not whether a reading may be written).

### 4.2 `module_reading.inactive_reason`
| | |
|---|---|
| Table | `module.module_reading` (RANGE partitioned on `as_of`) — `ADD COLUMN` on the parent cascades to all partitions |
| Type | `text` |
| Nullability | nullable |
| Default | none |
| Constraint | `CHECK ((module_status_code = 'INACTIVE' AND inactive_reason IS NOT NULL) OR (module_status_code <> 'INACTIVE' AND inactive_reason IS NULL))` — a reason exists iff INACTIVE; complements the existing `ck_module_reading__inactive_is_silent` (INACTIVE ⇒ NULL strength/baseline) |
| Index | none |
| Backfill | none — **0 `module_reading` rows exist**, so the CHECK holds trivially |
| Existing rows valid? | yes (there are none) |

Rationale: doc 15 promises a stored reason for INACTIVE; D-6 prepared this column.

### 4.3 Not in migration 023 (do not expand)
- `strength` scale column — D-5a: `strength` NULL at `1.0.0`, no scale needed.
- `module.module_input` relation — D-3 resolves to calculator-code (§3).
- `calibration.sample_gate` seeding — D-7, S-9, not S-6.
- The `module_version.rationale` amendment is a **data update** under `pt_owner`,
  not DDL — it belongs to the per-module version authoring, not this migration.

**Nothing else is genuinely required for S-6 to write a reading.**

## 5. Module-engine responsibilities

### ENGINE MUST DO
1. Resolve eligible `(subject, as_of)` from `football.fixture` (reusing the S-5
   driver/eligibility + snapshot-point pattern; no new clock in calculators).
2. Select the applicable `module_version` (§8).
3. Collect declared feature values for the subject at `as_of` from
   `feature.feature_value` (declared in calculator code, §11).
4. Build `module_evidence` (declared/present/below_threshold/estimated counts) and
   one `module_evidence_item` per cited value (with `contribution_direction`).
5. Invoke the pure module calculator → `module_status_code`, `verdict_text`,
   optional `strength`/`confidence` (NULL at `1.0.0`), and per-input direction.
6. Compute `sample_observation_count = MIN(consumed)` (D-5c) and
   `sample_meets_threshold = count >= module_version.minimum_sample_observation_count`.
7. Enforce lifecycle invariants: INACTIVE ⇒ NULL strength + NULL baseline
   (`inactive_is_silent`) and non-null `inactive_reason` (§4.2); INACTIVE ≠ NEUTRAL.
8. Persist `module_reading` + `module_evidence` + `module_evidence_item` in **one
   transaction** (the S-5 values+lineage discipline, one layer up).
9. Operational telemetry via `write_record`, per relation, as the feature pipeline does.

### MODULE CALCULATOR MUST DO (per module)
- Declare its input feature keys (the D-3 declaration site).
- Be a **pure** function of the collected feature values → status + verdict +
  per-input `contribution_direction`. No DB handle, no clock (R-2 obligation 6).

### S-9 CALIBRATION MUST DO (NOT the engine)
- Seed `sample_gate`; build `published_baseline`, `calibration_series/result`;
  outcome validation (`hit_rate`/`lift`). The engine **must not** populate
  `published_baseline_id` (stays NULL at `1.0.0`) or read any `calibration.*` table.

## 6. Module lifecycle

```
eligible (subject, as_of)
   → select module_version (effective_period ∋ as_of, is_active)
   → collect declared feature_value(s)               ── absent → counted, not zero
   → module_evidence (set-level counts)
   → module_evidence_item(s)  (cite value + direction)
   → calculator → status (+ verdict; strength/confidence NULL @1.0.0)
   → sample_observation_count = MIN(consumed)
   → sample_meets_threshold  = count >= version.minimum_sample_observation_count
   → persist reading + evidence + items (one tx)
```

- **Eligible:** a fixture whose `as_of` (snapshot offset) has passed, subject
  present, for an active module version.
- **Evidence collection:** read only the declared features at the reading's `as_of`
  (`cited_feature_value_as_of <= reading as_of`, enforced).
- **Missing evidence:** an absent declared feature is an absent
  `module_evidence_item` → `present_input_count < declared_input_count`. **Never a
  zero value.**
- **Observation count:** `MIN(consumed.sample_observation_count)` (D-5c).
- **Provenance:** modules do not have a provenance column; the *evidence items*
  carry the feature values whose provenance is already stored. The engine does not
  recompute provenance — it cites.
- **Confidence:** NULL at `1.0.0` (D-5b) — no governed formula, so none invented.
- **INACTIVE vs NEUTRAL:** INACTIVE = insufficient evidence to speak (e.g. no
  declared feature present) → `inactive_reason` set, strength/baseline NULL.
  NEUTRAL = the calculator spoke and found nothing of consequence → strength may be
  written when a version defines one (not at `1.0.0`).
- **`inactive_reason`:** populated by the engine from the reason the calculator
  abstained (e.g. `FEATURE_ABSENT`), consistent with the snapshot layer's
  `absence_kind` vocabulary.
- **Sample threshold:** applied as in step 6; at `1.0.0` with default 0, always met
  unless a version raises it.
- **No usable evidence:** INACTIVE reading with reason — a *recorded* abstention,
  not a missing row (coverage honesty).
- **Persisted:** reading + evidence + items. **Calculation-only:** nothing; unlike
  a dry-run feature pass, a module reading is the product.

## 7. Subject / context resolution

- **Subject** per `module_definition.subject_kind_code` and the
  `ck_module_reading__subject_exclusive` constraint: TEAM ⇒ `subject_team_id`;
  FIXTURE ⇒ `subject_fixture_id` + partition.
- **Context:** `ALL_COMPETITIONS` at `1.0.0` (as the feature layer does);
  `context_competition_edition_id` NULL unless `COMPETITION_SCOPED`.
- **Feature version:** the engine cites specific `feature_value` rows (which carry
  their own `feature_version_id`); it does not re-resolve feature versions.
- **The TEAM-feature / FIXTURE-module distinction is intentional (doc 71) and
  preserved:** a FIXTURE module cites *two* TEAM feature values (home + away), each
  a declared input (D-4a: two). `home_away_split` (first module) is TEAM-subject and
  cites one — deliberately the simpler path first (§9).

## 8. Module-version resolution

Select the `module_version` whose `effective_period` contains the reading's `as_of`
and whose module is active (`ex_module_version__periods_do_not_overlap` guarantees
at most one). `designation` names it; `predecessor_id`/`rationale` are lineage/audit;
`minimum_sample_observation_count` (new, §4.1) feeds the threshold. The engine reads
the version; it does **not** create versions.

## 9. First-module selection

Criteria applied to the two candidates:

| Criterion | `home_away_split` (#1, TEAM, OUTCOME_SCORED) | `rest_advantage` (#6, FIXTURE, OUTCOME_SCORED) |
|---|---|---|
| Recoverability | R (doc 59) | R (doc 60) |
| **Status semantics frozen?** | **YES** — `evalHomeAway`: `\|disparity\| ≥ 40 → SUPPORTS · Neutral type → NEUTRAL`, orientation-free (one of the 11 self-referential derivations), threshold transcribed from `processExtendedIntelligence.ts:577` | **NO** — `evalRest` is orientation-dependent; V2 has no orientation (readiness_gap absent, no orientation column); V1's own fallbacks **contradict** (evalRest→SUPPORTS vs sideStatus→NEUTRAL) |
| Feature available? | **NO** — needs a new recoverable `team.home_away_performance` feature (win% by venue side + disparity; derivable from `fixture`+`result`, all Layer 1) | **YES** — `team.rest_advantage` live in S-5 |
| Evidence simplicity | one TEAM feature, one cited value | two TEAM features (home+away), differential |
| Output simplicity | SUPPORTS/NEUTRAL only | needs orientation to place SUPPORTS/CONTRADICTS |
| Exercises full engine | yes | yes |
| Empirical verifiability | yes — deterministic from venue splits | yes, but only after the status rule is invented |
| **Risk of hidden modelling** | **LOW** — feature build + status are transcriptions | **HIGH** — status rule is an ungoverned modelling decision |

**Decision: `home_away_split`.** The criterion that dominates is *frozen semantics /
no hidden modelling decision* (Step 12). `rest_advantage` looks readier (feature
live) but conceals exactly the ungoverned decision this gate must not make.

**Honest caveat:** `home_away_split` is **not turnkey** — it requires first building
the recoverable `team.home_away_performance` feature. That is bounded S-5
transcription work (V1's win%-by-venue-side + type/disparity thresholds, window
transcribed from V1), carrying **no modelling judgment** — categorically unlike
`rest_advantage`'s orientation problem. So the sequence is: feature-build gate →
engine → `home_away_split` calculator.

## 10. First-module contract — `home_away_split`

| slot | value | note |
|---|---|---|
| module key | `home_away_split` | registered (#1) |
| module version | `1.0.0` | rule authored at implementation (D-2 per-version) |
| subject kind | TEAM | one cited value |
| question | "Home-reliant or road warrior?" | registered |
| calibration mode | OUTCOME_SCORED / MATCH_RESULT | registered; S-9 validates later |
| required feature | **`team.home_away_performance`** (NEW, recoverable) | prerequisite feature-build gate |
| evidence items | one: the subject team's `home_away_performance` value | `contribution_direction` = SUPPORTS/NEUTRAL |
| provenance | inherited via the cited feature value (DERIVED) | engine cites, does not recompute |
| observation count | `MIN(consumed)` = the feature's own count | D-5c |
| min sample threshold | `0` at `1.0.0` (version default) | §4.1 |
| missing-value policy | feature absent → INACTIVE, `inactive_reason = FEATURE_ABSENT` | never zero |
| inactive policy | strength/baseline NULL; reason set | §4.2 |
| output type | status + verdict; strength/confidence **NULL @1.0.0** | D-5a/b |
| strength semantics | none written at `1.0.0` | — |
| confidence semantics | none written at `1.0.0` | — |
| verdict semantics | plain characterisation ("strongly home-reliant" etc.); no action/stake/selection (LC-71) | — |
| persistence | reading + evidence + one item, one tx | §5 |

Status rule (frozen, transcribed): `|disparity| ≥ 40 → SUPPORTS`; `Neutral type →
NEUTRAL`; else `NEUTRAL`. No CONTRADICTS branch (V1 has none here). No invented
threshold.

## 11. Engine / calculator boundary

- **Engine (module-agnostic):** eligibility, version selection, value collection,
  evidence assembly, sample/threshold arithmetic, lifecycle invariants, persistence,
  telemetry.
- **Calculator (per module, pure):** declares input feature keys (D-3 site); maps
  collected values → `{status, verdict, perInputDirection}`. `home_away_split`'s
  calculator is ~the `evalHomeAway` transcription.
- The boundary mirrors S-5's `Calculator`/pipeline split, which is the proven
  pattern and keeps S-9 concerns out entirely.

## 12. Test architecture

**ENGINE tests** (module-agnostic, with a trivial fake module):
version selection (period boundaries); evidence assembly + counts; `MIN(consumed)`;
threshold application; INACTIVE-on-no-evidence with reason; `inactive_is_silent`
enforcement; INACTIVE≠NEUTRAL; one-transaction persistence; idempotent
recomputation; context/subject resolution; `cited_value_as_of <= as_of`.

**MODULE-CALCULATOR tests** (`home_away_split`, pure): complete evidence →
SUPPORTS/NEUTRAL per `|disparity|≥40`; zero-but-legitimate values; NO VALUE →
abstain; verdict text; per-input direction. **Golden fixtures derived from the
declared rule** (S-0-c-i) — not a V1 golden, since this is a V2-authored status rule.

**DATABASE-INTEGRATION tests:** migration 023 applies cleanly; existing rows valid;
a full reading persists across the partitioned `module_reading`; registry
compatibility (the 13 seeds unaffected).

## 13. Implementation surface (the eventual build, not now)

- `v2/migrations/023_*.sql` — the two columns (§4).
- `beta/backend/src/v2/module/` — new: engine, module types, the `home_away_split`
  calculator.
- `beta/backend/src/v2/feature/…` — the new `team.home_away_performance` calculator
  + registry seed (its own prerequisite gate).
- tests as §12.
- **Untouched:** Travel, readiness, S-9/calibration SQL, V1, existing feature-calc
  semantics.

## 14. Migration / deployment sequencing

1. Ratification note (§3) — no code.
2. **Migration 023** — additive, reversible (`DROP COLUMN`), existing rows valid,
   0 `module_reading` rows so the new CHECK is trivially satisfied. Standard
   `ALTER TABLE ADD COLUMN`; the plain-SQL runner needs no change. Must precede
   engine deployment (the engine writes both columns). No seed-order dependency
   beyond "after 022."
3. `team.home_away_performance` feature build (own gate).
4. Module engine + `home_away_split` calculator.
5. Verify (§12) before any second module.

## 15. Stop conditions — one triggered

- **TRIGGERED (avoided by selection):** `rest_advantage` as first module — its status
  rule is an unresolved modelling decision (orientation-dependent, V1 self-contradictory,
  no V2 orientation mechanism). Choosing it would force an invented threshold/orientation.
  **Resolved by selecting `home_away_split` instead**, whose rule is frozen.
- **Not triggered:** schema matches the decision docs; lifecycle specified; sample
  threshold resolved (§4.1 + D-5c); confidence governed as "NULL at 1.0.0"; subject/
  context unambiguous. No governance problem is being solved by a silent formula.

The one genuinely-open modelling area (a fixture-level orientation rule for
`rest_advantage`/`form_gap_accuracy` and the travel differential) is **deferred**,
not resolved here — the first module deliberately avoids it.

## 16. Exact implementation gate that follows

**Gate A — Ratification note** (one page): confirm D-5c-i, S-0-c-i, D-3 site.
**Gate B — Migration 023 authoring**: the two columns exactly as §4; no expansion.
**Gate C — `team.home_away_performance` feature build**: recoverable transcription
(win% by venue side + type/disparity), its own small spec.
**Gate D — Module engine + `home_away_split` calculator**: build to §5/§10/§11 with
the §12 tests, verify, then expand module coverage.

Do not start Gate D before A–C. Do not start the engine at module #5 (travel needs
its differential-formula gate first).

---

## STATUS

- **S-0:** **CLOSED** (substantive; one methodology ratification S-0-c-i pending, non-blocking)
- **D-5c-i:** **OUTSTANDING** — ratifiable now (one line); rule lives in the engine
- **S-0-c-i:** **OUTSTANDING** — ratifiable now (one line); binds test methodology
- **D-3:** **OUTSTANDING** — ratify calculator-code declaration (no migration)
- **Migration 023:** **SPECIFIED** — two additive columns (`module_version.minimum_sample_observation_count` NOT NULL DEFAULT 0 CHECK ≥0; `module_reading.inactive_reason` text, CHECK reason-iff-INACTIVE); reversible; no backfill
- **Module engine:** **SPECIFIED** — responsibilities, lifecycle, boundary, persistence, telemetry; S-9 excluded
- **First module:** `home_away_split`
- **First module semantics:** **FROZEN** — `evalHomeAway` (`|disparity| ≥ 40 → SUPPORTS`, orientation-free), transcribed; BUT requires a prerequisite recoverable feature `team.home_away_performance`
- **S-6 implementation:** **NOT AUTHORIZED** — pending Gates A–C
- **Next gate:** **Gate A — the ratification note** (then B migration 023, C the feature build, D engine + `home_away_split`)
