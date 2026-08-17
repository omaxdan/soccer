# S-6 Production Feature-Registry Deployment Gate (prepared — awaiting authorization)

**Gate type:** deployment gate, **prepared and held for explicit operator
authorization.** Nothing is executed by preparing it. When authorized, its scope is
exactly one action — `seed:v2` against production to add the missing feature-registry
metadata — bracketed by SELECT-only pre/post checks. **No S-4, no S-5, no migration,
no module-reading write, no Module #3, no code/seed/schema change.**

---

## 1. Pre-authorization state — measured in production (docs 88–90 + this run)

| Check | Measured | Expected | OK |
|---|---|---|---|
| feature registry `5\|7\|10\|7\|0` (calc/def/binding/ver/value) | 5 / 7 / 10 / 7 / 0 | 5 / 7 / 10 / 7 / 0 | ✅ |
| upstream `fixtures/completed/results/teams/editions/snapshot_points` | 55 / 51 / 51 / 22 / 2 / 4 | data present | ✅ |
| migrations 023 + 024 | applied (Q1 `1|1|1|1`; Q3 post-024 md5s) | applied | ✅ |
| module_version rows | 13, amended md5s `e8e2464…` / `91d4ee9…` | 13 | ✅ |
| module_reading / evidence / item | 0 / 0 / 0 | 0 | ✅ |

**Consequences (reconciled):** the registry pre-state exactly matches Gate 90's
before-column; **51 completed fixtures with results exist → S-4 ingestion is NOT
required**; `feature_value = 0` solely because S-5 has not run; the correct next
operation is the additive feature-registry deployment.

---

## 2. Exact delta this deployment applies (+3 / +4 / +4 / +4)

**Calculators (+3):** `venue_win_rate`, `team_momentum`, `travel_itinerary`.

**Definitions (+4), each TEAM, one context binding, one 1.0.0 version:**

| feature_key | context binding |
|---|---|
| `team.home_win_rate` | `COMPETITION_SCOPED` |
| `team.away_win_rate` | `COMPETITION_SCOPED` |
| `team.momentum` | `ALL_COMPETITIONS` |
| `team.travel_distance` | `ALL_COMPETITIONS` |

**Context bindings (+4)** and **versions (+4)** — one of each per new definition.

Before/after: `feature_calculator` 5→8, `feature_definition` 7→11,
`feature_definition_context_kind` 10→14, `feature_version` 7→11.
`feature_value` stays **0** (S-5 not run).

---

## 3. Execution model (confirmed from source)

- **Command:** `cd beta/backend && npm run seed:v2`, run from the raw-TCP environment
  whose git-ignored `.env` holds the production credentials (the same one that
  passed `doctor:v2 --probe`).
- **Connection:** a single login (`postgres`); `PipelineRole` is a **label**, and
  the db layer issues **no `SET ROLE`** — so the deploy does not depend on the
  `pt_pipeline_*` roles existing in production.
- **Idempotency:** every seed statement is `INSERT … ON CONFLICT (<identity>) DO
  NOTHING` (`seed/helpers.ts`) — additive only, **never UPDATE/DELETE**. Existing
  rows are untouched.
- **Transactions:** one per stage; a stage that fails rolls back that stage and the
  run stops; re-running is the intended recovery (idempotent).
- **Also written:** ordinary `operations` telemetry (a `pipeline_job_run` +
  `write_record` per attributed stage) — the record that a seed ran. Not feature or
  module data.

**Expected `seed:v2` console report (the only non-zero inserts):**
```
feature.feature_calculator                +  3  (5 present)
feature.feature_definition                +  4  (7 present)
feature.feature_definition_context_kind   +  4  (10 present)
feature.feature_version                   +  4  (7 present)
… every other relation                    +  0  (present)
```

---

## 4. PRE-FLIGHT checks (SELECT-only; run immediately before, abort on mismatch)

```sql
-- P1: registry pre-state — expect 5 | 7 | 10 | 7 | 0
SELECT (SELECT count(*) FROM feature.feature_calculator)              AS calculators,
       (SELECT count(*) FROM feature.feature_definition)              AS definitions,
       (SELECT count(*) FROM feature.feature_definition_context_kind) AS context_bindings,
       (SELECT count(*) FROM feature.feature_version)                 AS versions,
       (SELECT count(*) FROM feature.feature_value)                   AS feature_values;

-- P2: module registry + the two amended rationales — expect 13, e8e2464…, 91d4ee9…
SELECT (SELECT count(*) FROM module.module_version) AS versions,
       (SELECT md5(rationale) FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id WHERE d.module_key='home_away_split')   AS split_md5,
       (SELECT md5(rationale) FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id WHERE d.module_key='readiness_tracker') AS readiness_md5;

-- P3: all-13-rationales fingerprint (baseline for the preservation check) — capture the value
SELECT md5(string_agg(d.module_key||'='||mv.rationale,'|' ORDER BY d.display_number)) AS all13_md5
  FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id;

-- P4: no readings exist — expect 0 | 0 | 0
SELECT (SELECT count(*) FROM module.module_reading)       AS readings,
       (SELECT count(*) FROM module.module_evidence)      AS evidence,
       (SELECT count(*) FROM module.module_evidence_item) AS items;
```

**Abort (do not run `seed:v2`) if:** P1 ≠ `5|7|10|7|0`; P2 versions ≠ 13 or either
md5 ≠ the approved value; P4 ≠ `0|0|0`. Record P3's `all13_md5` — the scratch
reference is `d57b9d898c5e27eae7c374cd74a6a7fe` (production should match; whatever
it is, it must be **unchanged** after the deploy).

---

## 5. AUTHORIZED ACTION (only after explicit go)

```
cd beta/backend && npm run seed:v2
```
Confirm the console report matches §3 (+3/+4/+4/+4, everything else present).

---

## 6. POST checks (SELECT-only; run immediately after)

```sql
-- Q_after registry — expect 8 | 11 | 14 | 11 | 0  (feature_value STILL 0)
SELECT (SELECT count(*) FROM feature.feature_calculator)              AS calculators,
       (SELECT count(*) FROM feature.feature_definition)              AS definitions,
       (SELECT count(*) FROM feature.feature_definition_context_kind) AS context_bindings,
       (SELECT count(*) FROM feature.feature_version)                 AS versions,
       (SELECT count(*) FROM feature.feature_value)                   AS feature_values;

-- Q_calc — the 3 new calculators present
SELECT calculator_key FROM feature.feature_calculator
 WHERE calculator_key IN ('venue_win_rate','team_momentum','travel_itinerary') ORDER BY calculator_key;

-- Q_def (= Gate 87 Q6) — the module prerequisites now present with correct bindings/version
SELECT d.feature_key, d.subject_kind_code,
       string_agg(c.context_kind_code,',' ORDER BY c.context_kind_code) AS contexts,
       (SELECT count(*) FROM feature.feature_version v WHERE v.feature_definition_id=d.id) AS versions
  FROM feature.feature_definition d
  JOIN feature.feature_definition_context_kind c ON c.feature_definition_id=d.id
 WHERE d.feature_key IN ('team.home_win_rate','team.away_win_rate','team.momentum','team.travel_distance')
 GROUP BY d.feature_key, d.subject_kind_code, d.id ORDER BY d.feature_key;
-- expect: home/away_win_rate TEAM COMPETITION_SCOPED v1; momentum, travel_distance TEAM ALL_COMPETITIONS v1

-- PRESERVATION — must be byte-identical to P2/P3, and readings still zero
SELECT (SELECT count(*) FROM module.module_version) AS versions,                         -- expect 13
       (SELECT md5(rationale) FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id WHERE d.module_key='home_away_split')   AS split_md5,   -- e8e2464…
       (SELECT md5(rationale) FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id WHERE d.module_key='readiness_tracker') AS readiness_md5,-- 91d4ee9…
       (SELECT md5(string_agg(d.module_key||'='||mv.rationale,'|' ORDER BY d.display_number)) FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id) AS all13_md5, -- == P3
       (SELECT count(*) FROM module.module_reading)  AS readings,                          -- expect 0
       (SELECT count(*) FROM module.module_evidence) AS evidence,                          -- expect 0
       (SELECT count(*) FROM module.module_evidence_item) AS items;                        -- expect 0
```

**Success criteria (all must hold):** registry `8|11|14|11|0`; the 3 calculators and
4 definitions present with the stated bindings/versions; **`all13_md5` unchanged
from P3**; `split_md5`/`readiness_md5` still `e8e2464…`/`91d4ee9…`; module_version
still 13; readings/evidence/items still 0; `feature_value` still 0.

---

## 7. Idempotency verification (SELECT-only + one re-run)

Re-run `npm run seed:v2` once more; expect the console report to show **+0 inserted,
all present**, and the §6 registry counts to remain `8|11|14|11|0`. This proves the
deploy converged and a repeat is a no-op.

---

## 8. Hard-stop / abort conditions

Stop immediately and investigate (do **not** proceed to S-5) if any of these occur:
- a pre-flight check (§4) fails → do not run `seed:v2` at all;
- the `seed:v2` report shows inserts to any relation other than the four feature-
  registry relations (e.g. a `module_version` insert, or a feature_value/module
  write);
- any preservation value changes: `all13_md5` differs from P3, either amended md5
  changes, module_version count ≠ 13, or `module_reading/evidence/item` becomes
  non-zero;
- `feature_value` becomes non-zero (that would mean S-5 ran — it must not);
- a stage errors (the run rolls that stage back and stops; re-run after diagnosing —
  idempotency makes re-run safe).

**Containment:** the deploy is additive `DO NOTHING`; there is no destructive step
to undo. A stage failure self-rolls-back. If a preservation check nonetheless fails
post-run, that is a serious anomaly — halt the sequence and report before any S-5 or
write step.

---

## 9. What this gate does NOT do

No S-5 / feature-value production. No S-4 ingestion (not needed — data present). No
migration. No `module_reading` / evidence / item write. No module registration
change. No Module #3. No calculator/engine/seed code change. It establishes registry
**metadata** only — the definitions come to exist so S-5 can later produce their
values, which is a separate gate.

---

## 10. Authorization boundary and next gate

**This gate is prepared and HELD. It executes nothing until you explicitly
authorize the `seed:v2` deployment.** On your go, the sequence is: §4 pre-flight →
§5 `seed:v2` → §6 post checks → §7 idempotency; report the §6 result.

**Next gate (after a clean deployment):** the **S-5 production feature-run gate** —
run the feature pipeline in production to produce the prerequisite values
(`venue_win_rate` → home/away win rate; `team_momentum` → momentum) from the 51
completed fixtures, then re-run Gate 87 → **A**, then the production-write
authorization gate. **No Module #3** until production write authorization is granted.
