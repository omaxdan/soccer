# S-6 Gate E-ii — `team.momentum` feature (source recovery + implementation)

**Gate type:** feature-layer implementation. Adds the reusable
TEAM × ALL_COMPETITIONS team-momentum feature that Gate E-iii's
`readiness_tracker` will consume. No module code, no migration, no module
registry change, no `readiness_tracker`. `home_away_split` and the E-i engine are
untouched.

**Predecessors:** Gate E-i (`6a9d04e`); Module #2 selection gate (doc 79); V1
`processTeamMomentum` (`beta/backend/src/jobs/processDbOnly.ts:3657-3720`) and
`processForm` (`beta/backend/src/jobs/processForm.ts:55-99`).

---

## 1. Source recovery — V1 `processTeamMomentum`, established from code

| Aspect | Recovered rule |
|---|---|
| Underlying quantity | `momentum_score = last5Points − prior5Points` — a signed **points delta** between two consecutive five-match windows. (`last_5_points`, `prior_5_points`, `trend` are its intermediates/derivatives.) |
| Population | `team_form_history` — every completed, result-bearing fixture, **all competitions, all seasons** (the table is not competition- or season-scoped). |
| Ordering | `match_date` **descending** (most recent first). |
| Window | **Count-based, bounded to ten**: `last5 = slice(0,5)`, `prior5 = slice(5,10)`. No elapsed-time bound. |
| Qualifying fixture | a completed fixture **with a result** (the only rows `processForm` writes to `team_form_history`). |
| Points mapping | **3 / 1 / 0** for win / draw / loss (`processForm.ts:56-71`). |
| last5 / prior5 | the five most recent; the five before those. |
| < 10 matches | `momentum_score = null` unless `prior5.length === 5` (i.e. ≥ 10). `last5.length === 0` → no row at all. |
| Draws/losses | not a rate — they contribute 1 / 0 points to the sums; both windows count every match. |
| Rounding | none — integer point sums, integer delta. |
| Observation count | V1 stores none; the delta rests on the full ten matches. |
| NO VALUE | fewer than ten qualifying matches → `null` (no meaningful momentum). |
| Provenance | derived from recorded results. |
| Cumulative vs bounded | **bounded** — exactly the ten most recent, a rolling window; not cumulative, not edition-scoped. |
| All competitions? | **yes** — all competitions and seasons, ten most recent by date. |
| as_of | **V1 has none** — it computes a single "now" snapshot over the whole table. |

---

## 2. Context decision — TEAM × ALL_COMPETITIONS (confirmed, no supersession)

The recovered population is all-competitions, all-seasons, ten-most-recent — an
**ALL_COMPETITIONS** quantity. It reuses the existing ALL_COMPETITIONS machinery
(the default feature pass and `readCompletedFixtures`); no new context kind, no new
schema abstraction, no feature-specific reader.

**No population supersession.** Unlike `venue_win_rate` (whose lifetime
all-competition population was deliberately replaced with an edition-cumulative one,
doc 76), momentum's population is carried **unchanged**. The **only** V2 difference
is the mandatory point-in-time boundary: V1 computed one "now" snapshot; V2
evaluates the identical quantity as of each instant, reading only fixtures strictly
before `as_of`. The number is identical, so **V1-golden comparison is valid** for
this quantity (S-0-c-i sense) — and the tests use it (five losses then five wins →
+15, etc.).

---

## 3. Overlap analysis — genuinely different information

| Existing feature | How momentum differs |
|---|---|
| `team.home_form` / `team.away_form` | those are **weighted result-quality LEVELS per venue side**; momentum is an **unweighted points DELTA across both sides** — a trend, not a level, and not per-side. |
| `team.home_win_rate` / `team.away_win_rate` | those are **edition-cumulative win RATES per venue side**; momentum is a **bounded ten-match points delta across all competitions** — different window, different quantity, different context. |
| any other | no existing momentum/trend feature exists. |

Momentum adds the **acceleration of form** (recent vs prior), which no existing
feature carries. Not a duplicate.

---

## 4. Feature shape — the delta, not the two sums

The recovered *named* quantity is `momentum_score` — the delta. The two window
sums are intermediates. The smallest truthful representation is therefore **one
feature carrying the delta**, not two features carrying the sums. `readiness_tracker`
(E-iii) needs exactly the delta (its `classifyTrend` bands `change = last5 − prior5`);
the ±10 / ±3 banding is module logic and stays out of the feature. Emitting
`team.momentum_status` / `_direction` would encode module semantics in a feature and
is not done.

---

## 5. V2 feature contract

| Field | Value |
|---|---|
| feature_key | `team.momentum` |
| subject_kind | TEAM |
| context_kind | ALL_COMPETITIONS |
| unit | `points` (a points differential) |
| value_scale | 0 (integer) |
| direction | HIGHER_IS_STRONGER (more positive = rising; the delta is signed and stored negative when declining — `feature_value.value` has no non-negativity constraint) |
| max_provenance | DERIVED |
| meaningful_sample_threshold | 0 — **not** a statistical gate: the quantity is *undefined* below ten (both windows must be full), so the calculator emits NO VALUE there and every persisted value rests on exactly ten observations (the `venue_win_rate` precedent, doc 75) |
| observation count | 10 (D-5c-i, non-composite: the matches the delta rests on) |
| dependency edges | none — Layer 1 over football relations, `consumed: []` (no circular dependency) |
| feature_version | 1.0.0 — carries the V1 formula and population unchanged; only the as_of boundary is V2 |
| calculator | `team_momentum`, `contextKind` omitted (ALL_COMPETITIONS default pass) |

No numeric parameter is placed in `feature_version`; the ten-match window and
3/1/0 mapping live in the calculator (the V1 rule), and the significance banding
lives in the future module.

---

## 6. Temporal correctness

The calculator applies `before(fixtures, as_of)` (strict `< as_of`), then filters
to result-bearing, then sorts most-recent-first (kickoff desc, fixture id desc as a
deterministic tie-break — a V2 determinism refinement over V1's date-only order),
then takes the ten most recent and splits 5 / 5. Proven by the matrix: a fixture
exactly at `as_of` is excluded; a future fixture cannot influence the value; last5
precedes prior5; disjoint windows (distinct per-window sums); result-less fixtures
excluded.

**Reader sufficiency.** `readCompletedFixtures` returns, per team, at least the ten
most recent per side, which necessarily contains the ten most recent overall, so the
calculator reuses `fixturesByTeam` like every other ALL_COMPETITIONS calculator and
needs no reader of its own. (Under the normal invariant that COMPLETED fixtures carry
results — the same assumption the form calculators already rely on.)

---

## 7. Sample / NO VALUE

Fewer than ten qualifying fixtures → **no feature_value row** (never a substituted
zero). A zero delta is a real "form held level" and is emitted when ten matches
exist and the sums are equal. Every emitted value has `sample_observation_count = 10`.

---

## 8. Files changed (feature layer only)

- `feature/calculators/teamMomentum.ts` (new) — the calculator.
- `feature/pipeline.ts` — `teamMomentum` added to `CALCULATORS` (ALL_COMPETITIONS pass).
- `seed/featureRegistry.ts` — `team_momentum` calculator row + `team.momentum`
  definition + ALL_COMPETITIONS context binding + version (rows self-count via the
  exported constants, so the seed count tests self-adjust; no migration).
- `feature/__tests__/teamMomentum.test.ts` (new) — the adversarial matrix.
- `feature/__tests__/feature.test.ts` — `IMPLEMENTED_FEATURES` gains `team.momentum`.

**Zero** changes under `module/`, to `home_away_split`, the module registry, any
migration, or the D-2 rationale.

---

## 9. Verification

- typecheck: clean.
- pure momentum tests: 18/18.
- momentum DB tests: 3/3 (ALL_COMPETITIONS write with NULL edition, +15 golden,
  observation count 10, provenance DERIVED, idempotency, no scoped row).
- full DB suite: 719 tests, **14 failures — set identical to the documented
  environmental baseline; zero new**.
- lint:reads: 64 (pre-existing V1 drift; the pure calculator adds none) — signal
  only, not fixed.
- migration status: none. module-layer changes: none. D-2 rationale: untouched.

---

## 10. Next gate

**E-iii — `readiness_tracker` module implementation** (the TEAM ×
ALL_COMPETITIONS module, consuming `team.momentum` through the E-i engine). The
separate D-2 `module_version.rationale` governance gate remains pending before any
module writes a production reading.
