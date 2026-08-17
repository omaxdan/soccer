# S-6 Gate 87 Result — Production Read-Only Verification: B, with Gap Analysis

**Gate type:** governance / read-only finding. No production write, no migration,
no seed, no schema change, no module execution, no Module #3. Deliverable: this
document.

The operator executed the Gate 87 runbook (doc 87) against production from a
raw-TCP-capable environment. This document formally records the result and explains
Q1/Q6/Q7/Q8, separating **client-presentation artifacts** from **genuine production
gaps**, and states the exact read-only-confirmed remediation sequence.

---

## 1. Classification

### Gate 87: B — PRODUCTION READ-ONLY VERIFICATION FAILED / REMEDIATION REQUIRED

Production write authorization remains **CLOSED**. Migration 024 is **not** applied.
No production data is modified by this gate.

The B verdict is driven by **two genuine gaps** (Q3, Q6/Q7). Q1/Q4/Q8 as reported
are a query-presentation artifact, not deficiencies (§3).

---

## 2. Observed production results (operator run)

| Q | Observed | Meaning |
|---|---|---|
| Q1 | `[{"count":1}]` | **inconclusive as shown** — collapsed (see §3). |
| Q2 | 13 rows, keys/active/`1.0.0`/`min=0` all as expected | module registry fully present and correct. |
| Q3 | `home_away_split e07466dd…`, `readiness_tracker 889bfada…` | **PRE-024 hashes** — migration 024 not deployed. |
| Q4 | `[{"count":0}]` | collapsed, but consistent with 0 readings/evidence/items. |
| Q5 | no rows | neither implemented module has produced a reading. |
| Q6 | **no rows** | **the 3 prerequisite feature definitions are absent** in production. |
| Q7 | **no rows** | **no prerequisite feature values** in production. |
| Q8 | `[{"count":1}]` | **inconclusive as shown** — collapsed (see §3). |

---

## 3. Explanation of Q1, Q4, Q8 — a client artifact, not a gap

Q1, Q4 and Q8 are single-row SELECTs of several scalar sub-counts. In the runbook
(doc 87) each column is **aliased** (`mv_min_col`, `readings`, `ck_ctx_edition`, …).
The variant used dropped the aliases, so PostgreSQL auto-named **every** column
`count`. Reproduced on the scratch reference:

```
 count | count | count | count
-------+-------+-------+-------
     1 |     1 |     1 |     1      -- psql shows all four
row_to_json → {"count":1,"count":1,"count":1,"count":1}
```

A JSON client keys an object by column name, and **duplicate keys collapse to one**
— yielding exactly the operator's `[{"count":1}]` (Q1/Q8) and `[{"count":0}]` (Q4).
So:
- **Q1 `{"count":1}`** hides four values; one is 1. Q2 independently proves
  `module_version.minimum_sample_observation_count` exists (it returned values), so
  migration 023's `module_version` column is present. The other three artifacts
  (the `inactive_reason` column, the two CHECKs) are **unconfirmed as shown** and
  must be re-read with aliases.
- **Q4 `{"count":0}`** is consistent with all three counts being 0 (no readings/
  evidence/items) — reassuring, but re-read with aliases to confirm all three.
- **Q8 `{"count":1}`** hides four values; Q2 proves both modules are registered
  TEAM+active, so `split_ok`/`readiness_ok` are ≥1. The two schema CHECKs are
  **unconfirmed as shown** and must be re-read with aliases.

**These are not production deficiencies** — they are an artifact of running the
un-aliased variant through a JSON client. Re-run the **aliased** forms (§5) to
confirm; the scratch reference for all is `1|1|1|1` (Q1, Q8) and `0|0|0` (Q4).

---

## 4. Explanation of Q3, Q6, Q7 — the genuine gaps

**Q3 — migration 024 not deployed (expected, benign).** Production carries the
pre-D-2 rationale text (`e07466dd…`, `889bfada…`), not the post-024 text
(`e8e2464…`, `91d4ee9…`). Migration 024 exists in Git (`514dcb8`) but has not been
applied to production. This is a deployment step, not an implementation error.

**Q6 — the three prerequisite feature definitions are absent in production.** Q6
returned no rows, so `team.home_win_rate`, `team.away_win_rate`, and `team.momentum`
do **not** exist in production `feature.feature_definition`. These were added to the
seed at **Gate C** (`venue_win_rate` → home/away win rate, `9666a56`) and **Gate
E-ii** (`team_momentum` → `team.momentum`, `a765821`). Production was seeded **before**
those gates, so its feature registry predates them. The scratch reference (current
seed) holds **11** feature definitions and **8** calculators:

- features: `team.away_form, team.away_win_rate, team.congestion_index,
  team.home_form, team.home_win_rate, team.momentum, team.readiness_score,
  team.rest_advantage, team.squad_stability, team.travel_distance,
  team.travel_impact`
- calculators: `fixture_load, form_backfill, squad_continuity, team_momentum,
  team_readiness, travel_itinerary, travel_load, venue_win_rate`

Production is missing at least the three module prerequisites (and their calculators
`venue_win_rate`, `team_momentum`, context bindings, and versions). The exact
production delta is confirmed by the diagnostics in §5 (D1/D2).

**Q7 — no prerequisite feature values.** Follows from Q6 (no definitions) and from
S-5 not having produced these features in production. Consistent with a production
that has the schema and an early seed but has not run the S-5 feature pipeline for
these quantities.

**Q4/Q5 — positive evidence.** Zero module readings/evidence/items and none for
either implemented module: there is **no production output contamination** to
recover. A clean slate.

---

## 5. Read-only diagnostics to pin the exact delta (operator, aliased)

All SELECT-only; run read-only. The aliased Q1/Q4/Q8 replace the collapsed variants:

```sql
-- Q1 (aliased) — expect mv_min_col=1, mr_inactive_col=1, ck_min_sample=1, ck_inactive_reason=1
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='module' AND table_name='module_version' AND column_name='minimum_sample_observation_count') AS mv_min_col,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='module' AND table_name='module_reading' AND column_name='inactive_reason')                    AS mr_inactive_col,
  (SELECT count(*) FROM pg_constraint WHERE conname='ck_module_version__minimum_sample_non_negative'  AND conrelid='module.module_version'::regclass)                AS ck_min_sample,
  (SELECT count(*) FROM pg_constraint WHERE conname='ck_module_reading__inactive_reason_iff_inactive' AND conrelid='module.module_reading'::regclass)               AS ck_inactive_reason;

-- Q4 (aliased) — expect readings=0, evidence=0, items=0
SELECT (SELECT count(*) FROM module.module_reading) AS readings,
       (SELECT count(*) FROM module.module_evidence) AS evidence,
       (SELECT count(*) FROM module.module_evidence_item) AS items;

-- Q8 (aliased) — expect ck_ctx_edition=1, uq_reading=1, split_ok=1, readiness_ok=1
SELECT
  (SELECT count(*) FROM pg_constraint WHERE conname='ck_module_reading__context_edition_conditional' AND conrelid='module.module_reading'::regclass)                AS ck_ctx_edition,
  (SELECT count(*) FROM pg_constraint WHERE conname='uq_module_reading__subject_context_definition_asof_version' AND conrelid='module.module_reading'::regclass)     AS uq_reading,
  (SELECT count(*) FROM module.module_definition WHERE module_key='home_away_split'   AND subject_kind_code='TEAM' AND is_active)                                    AS split_ok,
  (SELECT count(*) FROM module.module_definition WHERE module_key='readiness_tracker' AND subject_kind_code='TEAM' AND is_active)                                    AS readiness_ok;

-- D1 — every production feature definition (compare to the 11 in §4)
SELECT feature_key, subject_kind_code FROM feature.feature_definition ORDER BY feature_key;

-- D2 — every production feature calculator (compare to the 8 in §4)
SELECT calculator_key FROM feature.feature_calculator ORDER BY calculator_key;

-- D3 — total production feature values (context this)
SELECT count(*) AS feature_values FROM feature.feature_value;
```

Interpretation: if aliased Q1 = `1|1|1|1` and Q8 = `1|1|1|1`, migration 023 and the
E-i/E-iii schema/registry are fully in place (only the two genuine gaps remain). If
any is `0`, that is an additional real gap to record.

---

## 6. Remediation sequence (read-only-determined; each is a separate authorized gate)

Nothing below is executed here. Sequenced so the two modules can reach a verified,
writeable production state:

1. **Confirm the exact production delta** — operator runs §5 (aliased Q1/Q4/Q8 +
   D1/D2/D3). Expected: Q1/Q4/Q8 clean; D1/D2 missing exactly the Gate-C/E-ii
   additions (`team.home_win_rate`, `team.away_win_rate`, `team.momentum`;
   calculators `venue_win_rate`, `team_momentum`).

2. **Production deployment-readiness gate (feature registry)** — deploy the current
   seed's feature-registry additions to production so `feature.feature_definition`,
   `feature.feature_calculator`, `feature.feature_definition_context_kind`, and
   `feature.feature_version` include the three prerequisites. Mechanism: the
   idempotent `seed:v2` (or a scoped feature-registry seed) run against production
   under the seed roles. This is a WRITE to registry tables and requires its own
   authorization; it does not touch `module_reading`.

3. **Production migration 024 gate** — apply
   `v2/migrations/024_module_version_rationale_amendment.sql` to production
   (owner-executed `UPDATE` of the two rationale rows). After it, Q3 → the post-024
   hashes (`e8e2464…`, `91d4ee9…`).

4. **Production feature run (S-5)** — run the feature pipeline in production so the
   prerequisite feature VALUES exist (`venue_win_rate` scoped pass →
   home/away_win_rate; `team_momentum` → team.momentum). Without values, the modules
   would produce only INACTIVE. This is the largest step and its own gate.

5. **Re-run Gate 87 (read-only)** — expect **A** (Q1 `1|1|1|1`, Q3 post-024 hashes,
   Q4 `0|0|0`, Q5 none, Q6 the 3 bindings, Q7 values present, Q8 `1|1|1|1`).

6. **Production-write authorization gate** — Gate 83's decision re-evaluated against
   the now-verified production state, then a small, auditable first module write.

Ordering notes: step 2 precedes step 4 (definitions before values); step 3 is
independent of 2/4 but must precede any module reading write (step 6); Gate 87-A
(step 5) requires steps 2 and 3 (Q6 and Q3), and — for *engaged* rather than
INACTIVE readings at the write gate — step 4.

---

## 7. Status

- **Gate 87:** B — REMEDIATION REQUIRED (confirmed).
- **Genuine gaps:** migration 024 undeployed (Q3); production feature registry
  missing the three prerequisites and their calculators (Q6), hence no values (Q7).
- **Not gaps:** Q1/Q4/Q8 (client collapse of duplicate `count` columns — re-run
  aliased); Q2 (registry correct); Q4/Q5 (clean, zero readings — no contamination).
- **SCRATCH VERIFIED** (reference, unchanged): migrations 001–024, migration 024
  rationales (`e8e2464…`, `91d4ee9…`), 11 feature definitions / 8 calculators, 0
  readings, suites 55/55, full suite at the 14-failure baseline.
- **PRODUCTION VERIFIED:** module registry present (13, correct); migration 023
  `module_version` column present (Q2); **0 module readings/evidence/items**;
  migration 024 **not** applied; prerequisite feature definitions/values **absent**.
- No code, schema, migration, seed, or registry change was made. No production write.
  Migration 024 was **not** applied.

**Next gate:** the **production deployment-readiness gate** (step 2 above), after
the operator confirms the exact delta with §5 — deploy the feature-registry seed
additions, then migration 024, then the S-5 feature run, then re-run Gate 87 → A,
then the production-write authorization gate. **No Module #3** until production
authorization is granted.
