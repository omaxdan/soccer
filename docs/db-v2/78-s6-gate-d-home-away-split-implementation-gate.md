# Phase 8 — S-6 Gate D: Home/Away Split Implementation Gate (audit)

## Source-grounded implementation audit only · no code

| | |
|---|---|
| Prior | Gate C `9666a56` (venue_win_rate) · migration 023 `0e4f9a8` · entry contract `fadd53c` |
| **Verdict** | **IMPLEMENTATION NOT AUTHORIZED** |
| **Blocker 1 (governance)** | The task states subject **FIXTURE**, but the authoritative seed, V1 `evalHomeAway`, and doc 55 D-2 all make `home_away_split` **TEAM**. The listed inputs + status rule only cohere at TEAM. This contradiction must be resolved before code. |
| **Blocker 2 (scope reality)** | The **S-6 module engine does not exist** — no `src/v2/module/`, no module read/write layer, no reading/evidence generator. Gate D is a new subsystem, not a calculator drop-in. Buildable, but far larger than "transcribe `evalHomeAway`." |

Nothing implemented, modified, or committed. This audit changes no code, migration,
registry seed, or test.

---

## 1. What exists, verified in source

| Prerequisite | State |
|---|---|
| Module registry `home_away_split` (#1) | **seeded** — `moduleRegistry.ts:73`: `subjectKind: 'TEAM'`, `question 'Home-reliant or road warrior?'`, `OUTCOME_SCORED`, `MATCH_RESULT`, `isActive: true`, `v1Key: 'home_away'` |
| `module_version` 1.0.0 for every module | **seeded** — `moduleRegistry.ts:353` `seedRowsResolvingParent`, designation `1.0.0`, rationale "Carries forward the V1 module … ported in S-6" |
| Migration 023 columns | **present** (`0e4f9a8`): `module_version.minimum_sample_observation_count` (NOT NULL DEFAULT 0), `module_reading.inactive_reason` (CHECK reason-iff-INACTIVE) |
| Module schema | **present** (`008_module_storage`): `module_reading` (status/strength/confidence/sample/published_baseline_id/verdict), `module_evidence` (declared/present/below_threshold/estimated), `module_evidence_item` (cites `feature_value` with `contribution_direction`) |
| Feature inputs | **present + verified** (`9666a56`): `team.home_win_rate`, `team.away_win_rate` — COMPETITION_SCOPED, edition-cumulative, DERIVED |
| **S-6 module ENGINE** | **ABSENT** — no `src/v2/module/` directory; no module driver, read layer, evidence writer, reading writer, or telemetry. Only `seed/moduleRegistry.ts` and `db/roles.ts` reference module tables |
| V1 `evalHomeAway` source | **NOT in the repo** as code — the beta backend has no `evalHomeAway`; the rule survives only as doc 55's transcription |

## 2. V1 `evalHomeAway` — the frozen rule and its scope

Doc 55 (D-2) is the authoritative record:

- **`evalHomeAway` (TEAM scope, orientation-FREE):** `Neutral type → NEUTRAL ·
  |disparity| ≥ 40 → SUPPORTS · else NEUTRAL` (doc 55 §1 table).
- There is ALSO an `evalHomeAwayMatch` (match scope, orientation-relative) — but
  doc 55 §1 records: *"The same four modules have BOTH rules … and V2 registers
  all four of these as TEAM-subject, i.e. the scope whose V1 rule needs no
  orientation."*
- The disparity is a **single team's own split**: `home_win_pct − away_win_pct`
  for one team ("home-reliant or road warrior?"). It is inherently a TEAM
  quantity — a team is home-reliant when its own home rate far exceeds its own
  away rate.

This is precisely why `home_away_split` was chosen as the *safe first module*
(doc 73): its status rule is frozen **because** it is TEAM-subject and
orientation-free. A FIXTURE reading would need the orientation V2 does not have
(doc 55: *"`readiness_gap` does not exist in V2 … a fixture-level gap would have
to be composed from two teams' features — exactly D-4"*).

## 3. Blocker 1 — the subject-kind contradiction (governance)

The task's frozen list says **Subject: FIXTURE**. Every authoritative source says
**TEAM**:

| Source | Subject |
|---|---|
| `seed/moduleRegistry.ts:77` | **TEAM** |
| V1 `evalHomeAway` (doc 55) | single-team disparity → TEAM |
| doc 55 D-2 ("four orientation-using V1 modules are TEAM-subject in V2") | **TEAM** |
| doc 73 (first-module rationale: orientation-free ⇒ TEAM) | **TEAM** |

The task's OWN other frozen items only cohere at TEAM:

- **Inputs `team.home_win_rate` + `team.away_win_rate`** are two TEAM features of
  the **same team** — that is a team's home-vs-away split. A FIXTURE reading would
  compare the *home team's* home rate to the *away team's* away rate — two
  different teams, a different quantity the task does not define.
- **Status rule `|disparity| ≥ 40`** is `home_win_rate − away_win_rate` for one
  team. There is no frozen fixture-level disparity, and inventing one is
  forbidden by this gate.

**Why this blocks:** the two implementable readings are mutually exclusive.
- **TEAM** (recommended): reads one team's two win rates, `disparity = home −
  away`, `|disparity| ≥ 40 → SUPPORTS`. Matches the seed, V1, and every doc — **no
  registry change, no invented rule.**
- **FIXTURE** (as the task states): requires (a) changing the seeded
  `subject_kind` — a governed module-registry redesign this gate forbids ("do NOT
  create a new module … do not reopen/redesign") — AND (b) a fixture-level
  disparity/orientation V1 never defined — an invented rule this gate forbids.

FIXTURE is therefore not implementable without a forbidden change; TEAM
contradicts the task's stated frozen line. This is a genuine governance conflict,
surfaced per instruction rather than silently resolved. **Recommended
resolution:** correct the Gate D subject reference to **TEAM** (the value already
in the registry). The FIXTURE line most likely carried over from module #5
`travel_impact`, which doc 71 correctly kept FIXTURE — a different module.

## 4. Blocker 2 — the module engine does not exist (scope)

`home_away_split` cannot be "implemented" as a lone calculator, because there is
nothing to run it: no module eligibility/driver, no context builder for module
subjects, no `module_evidence` / `module_evidence_item` writer, no `module_reading`
writer, no module telemetry. Doc 73 §5 sketched these responsibilities; none is
built. This is buildable (schema, migration 023, features, and the S-5 patterns
are all present), but it is a **new subsystem**, and the gate should authorize it
as such, not as a one-file transcription.

## 5. Frozen / transcription / unresolved

### Already frozen (no decision needed)
- **Status rule:** `|disparity| ≥ 40 → SUPPORTS`, else `NEUTRAL` (doc 55; per-module-version, D-2).
- **`strength` = NULL** and **`confidence` = NULL** at version 1.0.0 (D-5a/D-5b, doc 58).
- **`published_baseline_id` = NULL** at 1.0.0; `sample_gate` is S-9, not S-6.
- **Sample count = `MIN(consumed.sample_observation_count)`** (D-5c-i) — a reading
  consumes the two win-rate values, so the count is the min of their match counts.
- **`sample_meets_threshold`** vs `module_version.minimum_sample_observation_count`
  (DEFAULT 0 → always meets unless a version raises it).
- **INACTIVE is silent and needs `inactive_reason`; INACTIVE ≠ NEUTRAL; NO VALUE ≠ zero.**
- **Inputs declared in calculator code** (D-3); no `module_input` relation, no migration.
- **Evidence items** cite the two `feature_value` rows with `contribution_direction`.

### Straightforward transcription (bounded, no judgment)
- The `evalHomeAway` mapping into `module_status_code`.
- `disparity = home_win_rate − away_win_rate` (TEAM).
- Reading context: the module reads COMPETITION_SCOPED edition-cumulative
  features, so a reading is naturally COMPETITION_SCOPED per edition
  (`ck_module_reading__context_edition_conditional` requires the edition) — the
  same edition-grain the feature layer already produces.
- Absence handling: if EITHER win rate is absent (a team with no home, or no away,
  completed fixture in the edition) the disparity is uncomputable → **INACTIVE**
  with `inactive_reason` (e.g. `FEATURE_ABSENT`), strength/baseline NULL. Frozen by
  the INACTIVE rules; not a new decision.

### Genuine unresolved (must be settled before/within implementation)
1. **Subject kind (Blocker 1)** — TEAM vs FIXTURE. **Governance; blocking.**
2. **The module engine (Blocker 2)** — its exact contract (driver, evidence
   writer, reading writer, telemetry, transaction discipline) is sketched (doc 73
   §5) but not specified to build-level. **Scope; large but buildable.**
3. **`verdict_text` wording** — E3.09 the module's plain conclusion; needs a
   deterministic template ("strongly home-reliant / road warrior / balanced"),
   which is text, not governance, but must avoid LC-71 (no action/stake/selection).
   Bounded once subject is fixed.

Nothing here requires an invented threshold, confidence weight, baseline, sample
gate, or orientation — provided the subject is TEAM. Under FIXTURE, item 1 forces
exactly those inventions, which is the second reason FIXTURE cannot be authorized.

## 6. Determinism / purity

The calculator (given the engine) is pure and deterministic under TEAM: a
function of the two consumed win-rate values → status + verdict, no clock, no DB,
no orientation state. This is confirmable by the same purity discipline the S-5
calculators follow.

## 7. Verdict

**IMPLEMENTATION NOT AUTHORIZED.**

Two reasons, in order:

1. **Governance conflict (hard STOP):** the task freezes subject **FIXTURE**, but
   the registry, V1 `evalHomeAway`, doc 55, and doc 73 all make `home_away_split`
   **TEAM**, and the task's own inputs + status rule only work at TEAM.
   Implementing FIXTURE needs a forbidden registry subject change plus an invented
   disparity; implementing TEAM contradicts the stated frozen line. This must be
   resolved (recommended: **TEAM**) before any code.
2. **Missing subsystem:** the S-6 module engine does not exist. Gate D is the
   engine **and** the module, which should be authorized deliberately, not folded
   into a "calculator" framing.

Everything else is in place: schema, migration 023, `module_version` 1.0.0, the
two verified COMPETITION_SCOPED features, and a frozen status rule.

---

## 8. Bounded surface & test matrix — CONTINGENT on resolving §7.1 to TEAM

Recorded so the next gate is turnkey once the subject is confirmed **TEAM** and the
engine build is authorized. Not authorization to proceed.

### Implementation surface (new subsystem + first module)
- `src/v2/module/` (NEW): module driver/eligibility (TEAM × edition × as_of, reusing
  the C-ii scoped enumeration where applicable); a module read layer (consumed
  `feature_value` lookup by the declared inputs); `module_evidence` +
  `module_evidence_item` writer; `module_reading` writer (status, strength NULL,
  confidence NULL, sample = MIN(consumed), `sample_meets_threshold`, `verdict_text`,
  `inactive_reason`, `published_baseline_id` NULL); telemetry via `write_record`;
  one-transaction-per-(module × subject) discipline.
- `src/v2/module/calculators/homeAwaySplit.ts` (NEW): pure `evalHomeAway`
  transcription; declares inputs `team.home_win_rate`, `team.away_win_rate` (D-3).
- No migration; no registry seed change (module + version already seeded); no
  feature/travel/readiness change.

### Test matrix (V2-derived goldens; S-0-c-i)
1. `|disparity| ≥ 40` → SUPPORTS (e.g. home 90, away 20 → 70).
2. `|disparity| = 40` exactly → SUPPORTS (boundary inclusive per the rule).
3. `|disparity| = 39.99` → NEUTRAL (boundary just below).
4. small disparity → NEUTRAL.
5. negative disparity magnitude ≥ 40 (away-reliant) → SUPPORTS (absolute value).
6. home rate present, away absent → INACTIVE + `inactive_reason`, strength NULL, no baseline.
7. away present, home absent → INACTIVE.
8. both absent → INACTIVE (never NEUTRAL, never zero).
9. sample count = MIN(home count, away count) (D-5c-i).
10. `sample_meets_threshold` against `minimum_sample_observation_count` (0 → true).
11. strength NULL and confidence NULL at 1.0.0.
12. `published_baseline_id` NULL (S-9 out of scope).
13. evidence items cite exactly the two consumed `feature_value` rows with direction.
14. reading is COMPETITION_SCOPED per edition; two editions → two distinct readings.
15. idempotent re-run (ON CONFLICT DO NOTHING on the reading identity).
16. INACTIVE reading satisfies `ck_module_reading__inactive_is_silent` AND `…__inactive_reason_iff_inactive`.
17. purity: identical inputs → identical status/verdict, no clock/DB in the calculator.
18. `verdict_text` deterministic and free of any recommended action/stake/selection (LC-71).
19. registry coverage: `home_away_split` maps to its calculator; no other module implemented.
20. V2-derived golden fixtures (NOT literal V1 numbers — venue population superseded, S-0-c-i).

---

## STATUS

- **Module engine exists:** NO (`src/v2/module/` absent) — Gate D is a new subsystem
- **home_away_split registered:** YES — `module_definition` + `module_version` 1.0.0 seeded
- **Registered subject:** **TEAM** (seed) — **conflicts with the task's stated FIXTURE**
- **Feature inputs present:** YES — `team.home_win_rate`, `team.away_win_rate` (COMPETITION_SCOPED, verified `9666a56`)
- **Migration 023:** present and sufficient (no further migration)
- **Status rule:** FROZEN — `|disparity| ≥ 40 → SUPPORTS`, else NEUTRAL (TEAM, orientation-free)
- **Disparity:** `home_win_rate − away_win_rate` (single team) — coherent only at TEAM
- **strength / confidence:** NULL at 1.0.0 (D-5a/D-5b)
- **sample count:** MIN(consumed) (D-5c-i); **published_baseline_id:** NULL; **sample_gate:** S-9, out of scope
- **Either-feature-absent:** INACTIVE + `inactive_reason` (never NEUTRAL, never zero)
- **Calculator purity:** deterministic, pure (under TEAM)
- **Genuine unresolved:** (1) subject-kind conflict [governance, blocking]; (2) module engine unbuilt [scope]; (3) verdict wording [bounded]
- **Invented thresholds/weights/baselines/orientation:** NONE (and TEAM requires none)
- **Implementation authorized:** **NO**
- **To unblock:** confirm subject = **TEAM** (matching the seed + V1 + doc 55), and authorize building the S-6 module engine + the `home_away_split` calculator per §8; then implementation is turnkey with no invented rule and no migration
