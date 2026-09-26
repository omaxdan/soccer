# Historical Response (Historical Patterns) — v1

**Status:** AUTHORED V1 SPECIFICATION — *not previously frozen in the repository.*
**Version key:** `historical-response-v1`
**Historical note:** The intended Historical Response semantics were named as the next
roadmap concept, but the repository did not contain an authoritative implementation
contract for them. This document authors and locks that contract. The only pre-existing
"historical" module, `historical_advantage` (a head-to-head, FIXTURE-subject, inactive,
unimplemented placeholder), is a **different concept** and is **not touched** by this work.

---

## 1. Purpose
Historical Patterns describes **historically observed outcomes around a defined trigger**.
It is descriptive historical evidence — **not** prediction, probability, forecast,
recommendation, betting advice, or psychological interpretation.

## 2. Subject
Primary subject: **TEAM.** The same reading may later be consumed in team and match
surfaces, but the stored/read-model subject is the team.

## 3. Scope
**ALL_COMPETITIONS** only. No edition-only variant, no cross-competition normalization,
no multi-season normalization in v1.

## 4. Temporal rule
Every qualifying fixture must satisfy **`kickoff < asOf`** (strict). `kickoff = asOf` and
`kickoff > asOf` are excluded. No future leakage — this applies to both the trigger
fixture (Sequence A) and its response fixture (Sequence B).

## 5. Eligibility
A fixture contributes only when it is **COMPLETED**, has a **governed result**, and
`kickoff < asOf`. `SCHEDULED / POSTPONED / IN_PROGRESS / CANCELLED / ABANDONED` fixtures
are never reinterpreted as completed evidence.

## 6. Team-perspective result
Each eligible fixture is oriented from the subject team's perspective as **WIN / DRAW /
LOSS**, derived from the governed result substrate (`football.result.home_goals` vs
`away_goals`, oriented by whether the subject team was home or away). The same
deterministic orientation used by Season Position Trajectory; no new result semantics.

## 7. Triggers (v1)
- **POST_WIN** — a completed eligible fixture in which the subject team's result was WIN.
- **POST_LOSS** — a completed eligible fixture in which the subject team's result was LOSS.

## 8. Sequence A — trigger history
For the subject team and trigger, select all eligible fixtures (§5) before `asOf` whose
team-perspective result matches the trigger (WIN for POST_WIN, LOSS for POST_LOSS),
in chronological order. Deterministic population.

## 9. Sequence B — first subsequent response
For each qualifying trigger fixture, the **response** is the **first subsequent eligible
fixture** for the same team (completed, result present, `kickoff < asOf`), taken in the
chronological eligible sequence. Its team-perspective result (WIN/DRAW/LOSS) is the
observed response. Never the second or later fixture; never a scheduled fixture; never a
fixture at or after `asOf`. A trigger with no subsequent eligible fixture contributes no
response (it is not counted in `n`).

## 10. Response counts
Per trigger: `wins`, `draws`, `losses`, `n`, with the hard invariant
**`wins + draws + losses = n`**. No alternative total.

## 11. Sample gate
A trigger produces an **engaged** reading only when **`n >= 10`**. `n < 10` → not engaged.
No lowering of the threshold, no zero-fill, no estimation.

## 12. No-trigger behavior
If neither POST_WIN nor POST_LOSS reaches `n >= 10`, there is **no engaged Historical
Pattern reading** — no artificial empty "pattern" is fabricated.

## 13. Reading identity
At most one reading per **(team, module, scope)**. The two triggers are represented as
breakdowns *inside* the single reading, not as separate rows.

## 14. Output contract
```
{
  subjectKind: 'TEAM',
  subjectId: string,
  scope: 'ALL_COMPETITIONS',
  asOf: ISO-8601,
  triggers: {
    POST_WIN:  { engaged: boolean, n: number, response: { wins, draws, losses } },
    POST_LOSS: { engaged: boolean, n: number, response: { wins, draws, losses } }
  },
  anyEngaged: boolean,
  provenance: { source, mode: 'READ_MODEL', version },
  version: 'historical-response-v1'
}
```
No percentages, no probabilities, no "confidence".

## 15. Provenance
Exposes the source substrate (`football.fixture` + `football.result`), the `asOf`, the
calculation `version`, the `scope`, and its **read-model** (reconstructed) nature. No
immutable-snapshot claim — nothing is persisted; the reading is computed on read.

## 16. Semantic safety
The reader/output never emits: *will, likely, probably, expected, tends to, usually,
bounce back, responds well, resilient, confident, momentum,* percentages, forecasts, tips,
or recommendations (such words may appear only in internal test names, never in output).
Customer-facing presentation is purely descriptive: "Historical results following wins /
following losses" + N / Wins / Draws / Losses.

## 17. Relation to other layers
Consumes Team Observation / result-fixture evidence (and governed Context where explicitly
required later). Must not rebuild Performance Signals, Benchmark, Team Attributes, or
Context calculations. Pipeline: result evidence → historical-pattern computation →
historical-pattern read model → (later) Team / Match Intelligence. **Match Intelligence is
not built here.**

## Non-goals
Prediction/probability; H2H semantics; modifying `historical_advantage`; provider calls;
new persistent snapshot table; statistical or tactical/event attributes; any public
`/historical*` endpoint in v1 (the reader is consumed by Intelligence later).

---

## Governance lock — HISTORICAL PATTERNS V1
1. TEAM subject · 2. ALL_COMPETITIONS · 3. strict `kickoff < asOf` · 4. COMPLETED + result ·
5. POST_WIN · 6. POST_LOSS · 7. first subsequent qualifying completed fixture ·
8. `n >= 10` · 9. `wins + draws + losses = n` · 10. no-trigger → no engaged reading ·
11. no predictive semantics · 12. no probability · 13. no provider dependency ·
14. no H2H semantics · 15. `historical_advantage` untouched · 16. read-model preferred
(no new table) · 17. version `historical-response-v1`.
