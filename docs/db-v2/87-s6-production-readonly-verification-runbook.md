# S-6 Production Read-Only Verification Gate — Prepared Runbook

**Gate type:** read-only production verification, **prepared for execution in a
raw-TCP-capable environment**. No production write, no pipeline run, no
schema/seed/registry/engine/calculator change, no Module #3. Deliverable: this
document (the runbook + decision rule) and a classification.

**Correction accepted (from the operator):** `.env.v2.example` contains only
redacted/template values — **no production secret was committed**; this is **not** a
secret-exposure incident and **no credential rotation is advised**. The prior
attempt's §8.2 security note is retracted. Production credentials are supplied
through the git-ignored `.env` / process environment, as documented.

**Why this gate is *prepared* here rather than *executed* here:** this Claude
execution environment cannot open a raw-TCP PostgreSQL connection to Supabase 5432
(`doctor:v2 --probe` stalls at TCP; the agent proxy does not carry raw-TCP
databases and that is a limitation to report, not to bypass). The operator's
environment has already authenticated successfully. This document is therefore a
copy-paste runbook the operator runs from that environment; its expected values are
the **approved reference** captured from the scratch build (migrations 001–024 +
the real seed) and from migration 024, and are environment-independent.

---

## 0. How to run (operator, raw-TCP environment)

1. Ensure the git-ignored `beta/backend/.env` (or process env) holds the production
   `PT_V2_DB_*` values, then confirm the connection **read-only**:
   ```
   cd beta/backend && npm run doctor:v2 -- --probe
   ```
   Expect: TCP → SSLRequest → TLS (verified) → authenticated as the configured
   login; PostgreSQL 17.x. No secret is printed.
2. Run each query group below with a **read-only** session. Recommended wrapper so
   no write is even possible:
   ```
   psql "$PROD_CONN" -v ON_ERROR_STOP=1 -c 'BEGIN TRANSACTION READ ONLY' -f 87-queries.sql -c 'ROLLBACK'
   ```
   or prefix the session with `SET default_transaction_read_only = on;`. Every
   query below is `SELECT`-only; none writes.
3. Compare each result to the **Expected** column. Apply the §9 decision rule.

Do **not** run `seed:v2`, `feature:v2`, `ingest:v2`, or the module pipeline. Do
**not** insert, update, or delete anything. Reading is the whole task.

---

## 1. The SELECT-only inspection (copy-paste)

### Q1 — migration 023/024 schema artifacts (parent-scoped)
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='module' AND table_name='module_version'
       AND column_name='minimum_sample_observation_count')                      AS mv_min_col,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='module' AND table_name='module_reading'
       AND column_name='inactive_reason')                                       AS mr_inactive_col,
  (SELECT count(*) FROM pg_constraint
     WHERE conname='ck_module_version__minimum_sample_non_negative'
       AND conrelid='module.module_version'::regclass)                          AS ck_min_sample,
  (SELECT count(*) FROM pg_constraint
     WHERE conname='ck_module_reading__inactive_reason_iff_inactive'
       AND conrelid='module.module_reading'::regclass)                          AS ck_inactive_reason;
```
**Expected:** `1 | 1 | 1 | 1` (migration 023 applied). *Note: the CHECK constraints
are inherited by `module_reading`'s ~61 partitions, so scope to the parent
`conrelid` as above; an unscoped `count(*)` returns ~62 and is not an error.*

### Q2 — the thirteen module_version rows
```sql
SELECT d.display_number, d.module_key, d.is_active, mv.designation,
       mv.minimum_sample_observation_count
  FROM module.module_version mv
  JOIN module.module_definition d ON d.id = mv.module_definition_id
 ORDER BY d.display_number;
```
**Expected:** exactly 13 rows, all `designation = 1.0.0`, all `min = 0`:

| # | module_key | is_active |
|---|---|---|
| 1 | home_away_split | t |
| 2 | readiness_tracker | t |
| 3 | consistency_index | t |
| 4 | giant_killer_index | t |
| 5 | travel_impact | t |
| 6 | rest_advantage | t |
| 7 | league_goal_profiles | t |
| 8 | form_gap_accuracy | t |
| 9 | squad_stability | f |
| 10 | confidence_calibration | t |
| 11 | historical_advantage | f |
| 12 | risk_assessment | f |
| 13 | match_context | f |

### Q3 — the two amended rationales (migration 024), exact match by md5
```sql
SELECT d.module_key, md5(mv.rationale) AS rationale_md5
  FROM module.module_version mv
  JOIN module.module_definition d ON d.id = mv.module_definition_id
 WHERE d.module_key IN ('home_away_split','readiness_tracker')
 ORDER BY d.module_key;
```
**Expected (byte-exact, environment-independent):**
- `home_away_split`   → `e8e2464b265f20ff7dad98bb4a1fd81b`
- `readiness_tracker` → `91d4ee9619a2d6345becdbbaf6275e84`

These md5s are of the approved migration-024 text. To eyeball the literal text,
`SELECT rationale …` and compare against `v2/migrations/024_module_version_rationale_amendment.sql`.
The other eleven rows must **not** be amended (they keep the pre-D-2 template).

### Q4 — production reading/evidence/item counts
```sql
SELECT (SELECT count(*) FROM module.module_reading)        AS readings,
       (SELECT count(*) FROM module.module_evidence)       AS evidence,
       (SELECT count(*) FROM module.module_evidence_item)  AS items;
```
**Expected for a first authorization:** `0 | 0 | 0`. **Must be observed, never
assumed from scratch.** Non-zero is a finding (see §9).

### Q5 — any existing readings for the two implemented modules
```sql
SELECT d.module_key, count(*) AS n
  FROM module.module_reading r
  JOIN module.module_definition d ON d.id = r.module_definition_id
 WHERE d.module_key IN ('home_away_split','readiness_tracker')
 GROUP BY d.module_key;
```
**Expected:** **no rows** (neither module has produced a reading).

### Q6 — prerequisite feature definitions + context bindings
```sql
SELECT d.feature_key, d.subject_kind_code,
       string_agg(c.context_kind_code, ',' ORDER BY c.context_kind_code) AS contexts
  FROM feature.feature_definition d
  LEFT JOIN feature.feature_definition_context_kind c ON c.feature_definition_id = d.id
 WHERE d.feature_key IN ('team.home_win_rate','team.away_win_rate','team.momentum')
 GROUP BY d.feature_key, d.subject_kind_code
 ORDER BY d.feature_key;
```
**Expected (3 rows):**
- `team.away_win_rate`  TEAM  `COMPETITION_SCOPED`
- `team.home_win_rate`  TEAM  `COMPETITION_SCOPED`
- `team.momentum`       TEAM  `ALL_COMPETITIONS`

### Q7 — prerequisite feature-value availability (discovery)
```sql
SELECT d.feature_key, fv.context_kind_code,
       count(*)                                                              AS n,
       count(*) FILTER (WHERE fv.context_competition_edition_id IS NOT NULL) AS with_edition,
       count(*) FILTER (WHERE fv.context_competition_edition_id IS NULL)     AS null_edition
  FROM feature.feature_value fv
  JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
 WHERE d.feature_key IN ('team.home_win_rate','team.away_win_rate','team.momentum')
 GROUP BY d.feature_key, fv.context_kind_code
 ORDER BY d.feature_key, fv.context_kind_code;
```
**Expected shape (values themselves are production state to discover):**
- `home_win_rate` / `away_win_rate`: `COMPETITION_SCOPED`, `with_edition = n`,
  `null_edition = 0`.
- `team.momentum`: `ALL_COMPETITIONS`, `null_edition = n`, `with_edition = 0`.

`n = 0` for a feature is **not** a schema failure — it means S-5 has not yet
produced that feature in production, so the corresponding module would produce only
INACTIVE (or nothing) until it has. Record the counts; this informs the *write*
gate, not the schema verdict (see §9).

### Q8 — E-i / E-iii schema + registry state
```sql
SELECT
  (SELECT count(*) FROM pg_constraint
     WHERE conname='ck_module_reading__context_edition_conditional'
       AND conrelid='module.module_reading'::regclass)                       AS ck_ctx_edition,
  (SELECT count(*) FROM pg_constraint
     WHERE conname='uq_module_reading__subject_context_definition_asof_version'
       AND conrelid='module.module_reading'::regclass)                       AS uq_reading,
  (SELECT count(*) FROM module.module_definition
     WHERE module_key='home_away_split'   AND subject_kind_code='TEAM' AND is_active) AS split_ok,
  (SELECT count(*) FROM module.module_definition
     WHERE module_key='readiness_tracker' AND subject_kind_code='TEAM' AND is_active) AS readiness_ok;
```
**Expected:** `1 | 1 | 1 | 1` — the E-i context/edition conditional and the
context-inclusive unique key exist, and both implemented modules are registered
TEAM + active. (`MODULE_CALCULATORS` = exactly `[home_away_split,
readiness_tracker]` is a **source** fact, already fixed in `module/pipeline.ts`;
production carries no calculator list.)

---

## 2. Decision rule (deterministic)

Classify **A — PRODUCTION READ-ONLY VERIFICATION PASSED** iff *all* hold:
- Q1 = `1|1|1|1`;
- Q2 = the 13 rows exactly as tabled (keys, active flags, `1.0.0`, `min = 0`);
- Q3 md5s = the two approved values, and no other module_version rationale changed;
- Q4 = `0|0|0`;
- Q5 = no rows;
- Q6 = the 3 definitions with the exact subject/context bindings;
- Q8 = `1|1|1|1`.

Q7 is **reported, not gating** for the read verdict: definitions must exist (Q6),
but zero *values* is a legitimate pre-S-5 production state — it becomes a
precondition for the *write* gate (a module with no input yields only INACTIVE).

Classify **B — REMEDIATION REQUIRED** if any Q1/Q2/Q3/Q4/Q5/Q6/Q8 deviates — in
particular: migration 023/024 artifacts missing; a rationale md5 mismatch (or an
unexpected module amended); **any pre-existing `module_reading`/evidence/item rows**
(Q4 ≠ 0 or Q5 non-empty) — which means production already holds readings and a
separate reconciliation is required before authorization; or a missing
definition/binding. Record the exact deviation.

---

## 3. SCRATCH VERIFIED vs PRODUCTION VERIFIED

**SCRATCH VERIFIED** (local `ptv2`, migrations 001–024 + real seed — the reference
this runbook's Expected values come from): Q1 `1|1|1|1`; Q2 the 13 rows as tabled;
Q3 `e8e2464…` / `91d4ee9…`; Q4 `0|0|0`; Q5 empty; Q6 the 3 bindings; Q8 `1|1|1|1`;
Q7 test-only values present. Full DB suite at the documented 14-failure baseline;
module suites 55/55.

**PRODUCTION VERIFIED:** *to be completed by the operator's run of §1.* This
document does not assert any production fact — the production database was not
reachable from the environment that prepared it.

---

## 4. Classification (this preparation)

### B. PRODUCTION READ-ONLY VERIFICATION FAILED — REMEDIATION REQUIRED

Strictly because production **could not be inspected from the environment that
prepared this gate** (raw-TCP 5432 egress unavailable here — a reported limitation,
not a defect and not worked around), so no production fact is verified. This is an
execution-locus limitation, **not** a discovered production problem. The runbook in
§1 is complete and validated; executing it in the operator's raw-TCP environment
and matching every Expected value in §2 resolves the gate to **A**.

Production write authorization remains **CLOSED** regardless of outcome.

---

## 5. Next gate

- **Immediate:** the operator runs §0–§1 from the raw-TCP environment and records
  the results against §2. If all pass → **A** (production read-only verification
  passed); attach the observed outputs to close this gate as A.
- **Then:** the separate **production-write authorization gate** — Gate 83's
  decision re-evaluated against the now-verified production state — followed only
  then by a small, auditable first write for the two modules.
- **Not now:** Module #3 (out of scope until production authorization is granted);
  S-9 calibration (out of scope).

No code, schema, migration, seed, or registry change was made in this gate. No
production write occurred.
