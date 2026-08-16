# S-6 D-2 Rationale Governance Gate

**Gate type:** governance only. No code, no seed change, no migration, no registry
change, no production reading. The single deliverable is this document. Its purpose
is to CLOSE the D-2 rationale question before any module writes a production
reading — not to implement the fix.

---

## 1. Gate objective

Migration 023 (`0e4f9a8`) deliberately added only
`module_version.minimum_sample_observation_count` and
`module_reading.inactive_reason`. It did **not** execute the D-2
`module_version.rationale` amendment that docs 56–58 held pending. This gate
determines, from authoritative source:

- what the D-2 rationale amendment requires;
- which of the thirteen 1.0.0 rationales are stale and must change, versus which
  are accurate or intentionally provisional;
- whether the amendment is a transcription of an already-decided rule or needs a
  new governance decision;
- the production-reading consequence and whether a migration is required;

and then ratifies (or declines to ratify) D-2 accordingly.

---

## 2. Authoritative sources

| Source | What it establishes |
|---|---|
| **doc 55 §7 / §1** | D-2 is the choice of what "the characterisation" a status agrees with is; the eleven orientation-free V1 status derivations, incl. `evalHomeAway` and `evalReadinessTracker`. |
| **doc 56 (D-2 RECORDED AS GOVERNED)** | D-2 DECIDED: *status semantics are defined per module version, using that version's own finding as the reference* (C-1/C-2/C-3). The rationale is where the version **states its rule**. The thirteen current rationales ("ported in S-6") are made false. Correct **before the first reading is written**. **No role holds UPDATE on `module_version`** → the amendment is an **owner-executed migration**; a new version would be wrong (1.0.0 has produced no reading). *"Prepared, not written … pending your instruction."* |
| **doc 57** | Under D-2 the rule lives in code with the rationale stating it; the four-quantity separation (status / threshold / count / baseline). |
| **doc 58 §4–5** | Refines the amendment: the rationale must now state each version's **threshold and count rule**, not only its status rule. Reconciles E3.02a "never edited": correcting `rationale` changes no identity and protects *attributed values, of which there are zero* → **no new governance question**. Lists the rationale amendment among three prepared-and-held changes. |
| **doc 78 / 79 / Gate D (`d47eb20`)** | `home_away_split` provenance: TEAM, orientation-free `\|disparity\| ≥ 40 → SUPPORTS else NEUTRAL` (transcribed V1 `evalHomeAway`); inputs `team.home_win_rate` + `team.away_win_rate`, whose **population V2 supersedes** (edition-cumulative, doc 76); strength/confidence/baseline NULL at 1.0.0. |
| **doc 79 §2 / doc 81 / Gate E-iii (`ea8e558`)** | `readiness_tracker` provenance: TEAM × ALL_COMPETITIONS, `momentum ±10 → SUPPORTS / CONTRADICTS / NEUTRAL` (transcribed V1 `classifyTrend`, **NOT** the broken formatted-string evaluator); input `team.momentum`; strength/confidence/baseline NULL. |
| **migration 023 (`0e4f9a8`)** | `minimum_sample_observation_count DEFAULT 0` — the threshold for every 1.0.0 version is **0** unless separately seeded (none is). |
| **D-5c-i (doc 58) / Gate A (doc 74)** | The 1.0.0 count rule is `sample_observation_count = MIN(consumed)`. |

**Live schema, verified this gate (scratch proxy):** all 13 rationales are the two
seeded templates (below); committed `module_reading` = **0**; `UPDATE` on
`module.module_version` is held **only by `pt_owner`** (the migration role) — every
pipeline role has SELECT only. This matches docs 56/58 exactly.

---

## 3. The D-2 decision being ratified

Verbatim from doc 56, refined by doc 58 — **not redesigned here**:

> Status semantics are defined **per module version**, using that module version's
> own finding as the reference. Each registered module version **declares its rule
> in code**, and its `module_version.rationale` **states** that rule — its status
> mapping, its threshold, and its observation-count rule.

Consequences carried unchanged:
- **C-3:** not orientation, not baseline, not verdict (I-2/I-3/I-4 closed).
- The rationale amendment is an **owner-executed migration** (no pipeline UPDATE
  grant); **not** a new version (1.0.0 has produced no reading).
- It must land **before the first production reading** of the version it describes.
- Amending `rationale` edits no identity and no attributed value (0 readings) →
  **no conflict with E3.02a**.

This decision is fully established by authoritative source and is **RATIFIED** as a
transcription. Nothing about the decision is reopened or invented.

---

## 4. Current-vs-authoritative reconciliation — all 13 modules

Two current templates are seeded (`seed/moduleRegistry.ts`):
- **T-ported** (9 active, v1-backed): *"Initial registration. Carries forward the
  V1 module '{key}' unchanged; the evaluation logic is ported in S-6."*
- **T-inactive** (4 inactive, newly approved): *"Initial registration of a newly
  approved module. Identity and version only — no evaluation logic exists, which is
  why the definition is registered inactive."*

| # | module | active | current | stale under D-2? | intended state | wording established? |
|---|---|---|---|---|---|---|
| 1 | **home_away_split** | ✓ | T-ported | **YES — actively false** (rule exists in code) | state the status/threshold/count rule + V2 provenance | **facts established** (docs 78/79); string is a transcription, owner-approval pending |
| 2 | **readiness_tracker** | ✓ | T-ported | **YES — actively false** (rule exists in code) | state the status/threshold/count rule + V2 provenance | **facts established** (docs 79/81); string is a transcription, owner-approval pending |
| 3 | consistency_index | ✓ | T-ported | pending, not false — no rule exists yet | amend in its own implementation gate | not yet (no rule to state) |
| 4 | giant_killer_index | ✓ | T-ported | pending, not false | amend at implementation | not yet |
| 5 | travel_impact | ✓ | T-ported | pending, not false | amend at implementation (travel architecture stays closed) | not yet |
| 6 | rest_advantage | ✓ | T-ported | pending, not false | amend at implementation (orientation still unresolved, doc 79) | not yet |
| 7 | league_goal_profiles | ✓ | T-ported | pending, not false | amend at implementation | not yet |
| 8 | form_gap_accuracy | ✓ | T-ported | pending, not false | amend at implementation | not yet |
| 10 | confidence_calibration | ✓ | T-ported | pending, not false | amend at implementation | not yet |
| 9 | squad_stability | ✗ | T-inactive | **NO — accurate** | leave unchanged | accurate as-is |
| 11 | historical_advantage | ✗ | T-inactive | **NO — accurate** | leave unchanged | accurate as-is |
| 12 | risk_assessment | ✗ | T-inactive | **NO — accurate** | leave unchanged | accurate as-is |
| 13 | match_context | ✗ | T-inactive | **NO — accurate** | leave unchanged | accurate as-is |

**The scope of the required amendment is exactly the two implemented modules (#1,
#2).** This is derived from doc 56's own timing rule ("before the first reading is
written") together with the engine's production rule (a module is produced only
when registered active **and** listed in `MODULE_CALCULATORS`): only
`home_away_split` and `readiness_tracker` are in `MODULE_CALCULATORS`, so only they
will write readings. The other eleven write nothing, so their rationale misdescribes
no reading.

Distinguishing the two kinds of "stale":
- **Actively false (2):** the version's rule now exists in code, so "the evaluation
  logic is ported in S-6" no longer describes it, and its readings are imminent.
- **Pending, not false (7):** "ported in S-6" is a forward-looking statement for a
  version with no implemented rule; it describes no reading and is corrected in that
  module's own implementation gate — exactly as this programme corrects #1 and #2 now.
- **Accurate (4):** the inactive template already says "no evaluation logic exists,"
  which is true and D-2-consistent; never amended until the module is implemented.

This is **not** thirteen-identical wording, and no rationale is amended to state a
rule that does not exist.

---

## 5. Special treatment: the two implemented modules

Their amended rationale must state (doc 58) the **status rule + threshold + count
rule**, and — per programme discipline — must distinguish **transcribed V1
semantics** from **deliberate V2 supersession**. The facts are authoritative; the
exact prose is a transcription **held for owner approval** (doc 56 "pending your
instruction"), to be executed by the migration gate. Drafts, each fact cited:

**#1 `home_away_split` 1.0.0 — established facts the rationale must state:**
- Status rule: `disparity = home_win_rate − away_win_rate`; `|disparity| ≥ 40 →
  SUPPORTS`, else `NEUTRAL`; no CONTRADICTS branch; orientation-free (transcribed
  V1 `evalHomeAway`, doc 78/79).
- Threshold: `minimum_sample_observation_count = 0` (migration 023 default; no gate).
- Count rule: `sample_observation_count = MIN(consumed)` at 1.0.0 (D-5c-i).
- **V2 supersession, stated explicitly:** the module rule is a *V1 transcription*,
  but its **inputs' population is superseded** — `team.home_win_rate` /
  `team.away_win_rate` are edition-cumulative, COMPETITION_SCOPED (doc 76), not
  V1's lifetime all-competition venue rates.
- strength / confidence / published_baseline_id NULL (D-5a/b; S-9 out of scope).

*Transcription draft (for approval, not ratified prose):* "1.0.0. Status rule
(stated per D-2): SUPPORTS when |home_win_rate − away_win_rate| ≥ 40, else NEUTRAL —
orientation-free, transcribed from V1 evalHomeAway (docs/db-v2/78,79). Threshold
minimum_sample_observation_count = 0 (no gate); count rule sample_observation_count
= MIN(consumed) (D-5c-i). Inputs team.home_win_rate/away_win_rate are edition-
cumulative COMPETITION_SCOPED, deliberately superseding V1's lifetime all-
competition population (docs/db-v2/76). strength/confidence/published_baseline NULL
at 1.0.0 (D-5a/b; S-9)."

**#2 `readiness_tracker` 1.0.0 — established facts the rationale must state:**
- Status rule: on `team.momentum` (= last5 − prior5 points), `≥ +10 → SUPPORTS`,
  `≤ −10 → CONTRADICTS`, else `NEUTRAL` — transcribed V1 `classifyTrend`
  thresholds (docs 79 §2, 81).
- **Implementation-defect distinction, stated explicitly:** the governing rule is
  the numeric ±10; V1's `evalReadinessTracker` string-comparison defect (always
  neutral) is **not** reproduced.
- Threshold 0; count rule `MIN(consumed)` (= the momentum value's own count, D-5c-i).
- Provenance: `team.momentum` carries the V1 formula and population unchanged, with
  the V2 as_of correction (doc 81) — the input is *not* a supersession, unlike #1.
- strength / confidence / published_baseline_id NULL.

*Transcription draft (for approval, not ratified prose):* "1.0.0. Status rule
(stated per D-2): on team.momentum (last-5 minus prior-5 points), SUPPORTS when ≥
+10, CONTRADICTS when ≤ −10, else NEUTRAL — transcribed from V1 classifyTrend
(docs/db-v2/79,81); the V1 evalReadinessTracker formatted-string defect is not
reproduced. Threshold minimum_sample_observation_count = 0; count rule
sample_observation_count = MIN(consumed) (D-5c-i). Input team.momentum carries the
V1 formula/population unchanged with the V2 as_of correction (docs/db-v2/81).
strength/confidence/published_baseline NULL at 1.0.0 (D-5a/b; S-9)."

These drafts introduce **no new semantics** — every clause cites an already-ratified
fact. They are presented so the migration gate is turnkey; the exact final text
remains the owner's call (doc 56).

---

## 6. Modules intentionally provisional (not yet implemented)

- **The 7 active-but-unimplemented v1-backed modules** (#3–8, #10): rationale stays
  "ported in S-6" until each is implemented; it describes no reading. Each module's
  future implementation gate amends its own rationale (the pattern this gate applies
  to #1/#2). `travel_impact` (#5) additionally keeps its **closed** travel
  architecture; `rest_advantage` (#6) still carries the unresolved orientation
  question (doc 79) — neither is reopened here.
- **The 4 inactive newly-approved modules** (#9, #11, #12, #13): rationale is
  accurate as-is ("no evaluation logic exists, registered inactive"); left untouched.

---

## 7. Production-reading safety analysis

| Question | Finding |
|---|---|
| Current production `module_reading` count | **0.** Verified 0 committed on the scratch proxy; docs 56/58 verified 0 on the live schema; no gate since has authorized production readings (every module test wrote only in rolled-back transactions). By construction, production = 0. |
| Would amending rationale invalidate any existing reading? | **No.** Zero readings exist; `rationale` is descriptive text in no identity and no FK; E3.02a's immutability protects attributed values, of which there are none (doc 58). |
| Must the change precede the first production reading? | **Yes** — for the two implemented modules only. A reading attributed to a version whose rationale misdescribes its rule violates doc 23 DEC-1. |
| Is the change safe to apply now? | **Yes** — additive text correction, 0 rows attributed, non-blocking. |

**Consequence:** production module readings remain **NOT AUTHORIZED** until the two
implemented rationales are amended.

---

## 8. Migration requirement determination

**REQUIRED, and only a migration can do it.** `UPDATE` on `module.module_version`
is held solely by `pt_owner` (verified); no pipeline or seed role can amend it, and
a new version is wrong (1.0.0 attributed nothing). The migration:
- targets exactly **two rows** — `home_away_split` and `readiness_tracker` 1.0.0;
- sets each `rationale` to the owner-approved transcription of §5;
- leaves the other eleven rows untouched;
- is idempotent-safe (a plain `UPDATE … WHERE module_key IN (…) AND designation =
  '1.0.0'`), non-blocking (0 attributed readings), and creates/alters no schema.

Whether the **seed** (`seed/moduleRegistry.ts`) is also updated so a fresh
environment seeds the corrected text is a secondary implementation question for that
gate (the seed generates the rationale; a migration corrects an already-seeded DB).
Both must end at the same text. **Not decided or implemented here.**

Per this gate's instruction, the migration is **DEFERRED to the next gate** — this
is a governance-only gate, and doc 56 places the exact wording under owner
approval.

---

## 9. No implementation performed

No migration was created or applied. No seed was changed. No `module_version` row
was updated. No registry, engine, or module code was touched. No production reading
was created. The scratch inspections were read-only. The only artefact of this gate
is this document.

---

## 10. Final status

- **D-2: RATIFIED** — as a transcription of the already-authoritative decision
  (docs 56/57/58). Per-module-version status rule, stated in `module_version.rationale`
  together with the threshold and count rule; amended by an owner-executed migration;
  no conflict with E3.02a. Scope of required amendment: the two implemented modules
  (`home_away_split`, `readiness_tracker`); the other eleven are deferred to their own
  implementation gates (7 pending, 4 already accurate).
- **Production module readings: NOT AUTHORIZED** — blocked until the two implemented
  rationales are amended.
- **Migration: REQUIRED, DEFERRED TO NEXT GATE** — an owner-executed `UPDATE` of two
  `module_version.rationale` rows (migration 024), with the exact wording approved
  from the §5 transcriptions; the seed updated to match.
- **Next gate:** the **D-2 rationale-amendment migration gate** — approve the two
  §5 transcriptions verbatim, add migration 024 amending those two rows, align the
  seed, verify against the 14-failure baseline, and only then authorize production
  readings for `home_away_split` and `readiness_tracker`. No other module, no
  Module #3, until then.

---

**One residual decision is surfaced, not resolved:** the *exact verbatim wording*
of the two rationales (doc 56 placed it under owner instruction). The §5 drafts
transcribe only already-ratified facts and are offered for approval; this gate does
not treat them as final.
