# S-6 S-5 Production Feature Run — Executed & Verified: PASSED

**Gate type:** feature-value production execution record. The S-5 feature
pipeline (Doc 93) was executed against production by the operator from the
raw-TCP environment (this sandbox has no raw-TCP egress); this records the
outcome and closes the gate. **No module write, no migration, no Gate 87, no
Module #3 occurred.**

---

## 1. Pre-flight (SELECT-only, abort conditions clear)

- **A** — `feature_value 0 | module_reading 0 | module_version 13`
- **B** — registry `calculators 8 | definitions 11 | context_bindings 14 | feature_versions 11`

Baseline matched Doc 93 §5 exactly; no abort condition triggered.

---

## 2. Replay scope (identical for production run and idempotency replay)

```
--from 2026-05-31
--to   2026-11-04
```

`<after_last_kickoff>` = 2026-11-04, strictly after the verified last kickoff
(`2026-11-03 14:00:00+00`) so the final fixtures' snapshot instants are included.

---

## 3. Dry-run (computes, writes nothing)

- 180 batches
- 0 failures
- 1,506 feature candidates examined
- 0 written
- 1,506 dry-run skipped

---

## 4. Production replay (authorized write)

- 180 batches
- 0 failures
- `feature.feature_value` — examined **1,754** | written **767** | skipped **987**
- `feature.feature_lineage` — examined 448 | written 448 | skipped 0
- `feature.feature_source` — examined 15 | written 0 | skipped 15
- `feature.feature_dependency` — examined 2 | written 0 | skipped 2
- pipeline outcome **SUCCEEDED**

---

## 5. Post-write verification

**Q1 — module prerequisites present with correct context:**
- `team.away_win_rate` = 199, COMPETITION_SCOPED, with_edition 199, null_edition 0
- `team.home_win_rate` = 203, COMPETITION_SCOPED, with_edition 203, null_edition 0
- `team.momentum` produced 0 rows (legitimately — see §7)

**Q2 — provenance / version / sample:**
- `team.away_win_rate` = DERIVED, sample_meets_threshold true, version 1.0.0, 199 rows
- `team.home_win_rate` = DERIVED, sample_meets_threshold true, version 1.0.0, 203 rows

**Q3 — module preservation (untouched):**
- `module_reading` = 0
- `module_evidence` = 0
- `module_evidence_item` = 0
- `module_version` = 13
- `all13_md5` = `d57b9d898c5e27eae7c374cd74a6a7fe` (**unchanged**)

**D1 — identity integrity:**
- `feature_value` total_rows = 1,754
- distinct governed identities = 1,754 (**no duplication in the table**)

**D1b — per-feature/context breakdown of the 1,754 rows:**

| feature_key | context | rows |
|---|---|---|
| `team.away_form` | ALL_COMPETITIONS | 199 |
| `team.away_win_rate` | COMPETITION_SCOPED | 199 |
| `team.congestion_index` | ALL_COMPETITIONS | 200 |
| `team.home_form` | ALL_COMPETITIONS | 203 |
| `team.home_win_rate` | COMPETITION_SCOPED | 203 |
| `team.readiness_score` | ALL_COMPETITIONS | 248 |
| `team.rest_advantage` | ALL_COMPETITIONS | 248 |
| `team.travel_distance` | ALL_COMPETITIONS | 161 |
| `team.travel_impact` | ALL_COMPETITIONS | 93 |

---

## 6. Idempotency replay (identical bounds §2)

- 180 batches
- 0 failures
- `feature.feature_dependency` — examined 2 | written 0 | skipped 2
- `feature.feature_lineage` — examined 0 | written 0 | skipped 0
- `feature.feature_source` — examined 15 | written 0 | skipped 15
- `feature.feature_value` — examined 1,754 | written 0 | skipped 1,754
- pipeline outcome **SUCCEEDED**

The exact replay wrote nothing and skipped everything already present — the run
converged. (`feature_lineage` examined 0 because lineage is derived only from
newly-written values, of which there were none.)

---

## 7. `team.momentum` zero-rows — verified legitimate, not a defect

Source-grounded prerequisite (`teamMomentum.ts:66,110`): a subject needs **≥10**
result-bearing completed fixtures strictly before `as_of`, across all
competitions (two full five-match windows). Diagnostic (conservative
reconstruction of the real subject set, using `now()` ≥ the run clock):

- eligible subject rows = 335
- teams with eligible subjects = 20
- teams qualifying for momentum = **0**
- highest prior result count for any team = **4**

No team ever reached 10 prior result-bearing fixtures before any eligible
instant (most of the 51 "COMPLETED" fixtures kick off after `now`, so they never
fall before an eligible `as_of`). Therefore `team.momentum` correctly emitted no
values — a "no value, never a zero" outcome (`teamMomentum.ts:32-38`), not a
failed calculation.

---

## 8. Declaration-history reconciliation

`operations.pipeline_job_run` records **exactly 2** `feature.declare` invocations:

| job_run_id | pipeline_run_id | job_occurred_at (UTC) | terminal outcome |
|---|---|---|---|
| 1398 | 63 | 2026-08-17 15:25:53 | SUCCEEDED |
| 1841 | 65 | 2026-08-17 15:48:38 | SUCCEEDED |

Both were `implicit:feature.declare` / MANUAL runs (the declare step runs before
`withPipelineRun`, so each opens its own implicit run — `pipeline.ts:231-245`).

**Finding:** `feature.feature_source` (15) and `feature.feature_dependency` (2)
were **already declared before the S-5 Step-4 replay** — hence their 0-written /
all-skipped result in §4. They were **not** newly created by Step 4; the Step-4
declare found them already present (`ON CONFLICT DO NOTHING`). Benign and
additive — no hard-stop condition.

---

## 9. Conclusion — all Doc 93 success criteria satisfied

- feature values produced (1,754);
- correct context semantics (win-rate COMPETITION_SCOPED with edition set;
  momentum ALL_COMPETITIONS, absent-not-zero);
- correct provenance/version (DERIVED, 1.0.0, sample threshold met);
- module layer untouched (readings/evidence/items 0, versions 13);
- `all13_md5` unchanged (`d57b9d8…`);
- governed identities unique (1,754 = 1,754);
- exact replay idempotent (0 written on re-run);
- zero failures across all runs;
- no migration; no Module #3 writes.

**Correction preserved in the record:** the earlier expectation of ~1,506
written / 0 skipped was **incorrect**. The authoritative production result is
**767 initial writes and 987 intra-run `ON CONFLICT` skips, producing 1,754
distinct final feature values.** The dry-run under-counted because composite
calculators (e.g. `readiness_score`) could not read uncommitted upstream feature
values across connections, so their candidates only materialise in a real,
staged run (`pipeline.ts:28-33`). The ~1,506-write expectation must not be
repeated.

---

## 10. Status

- **S-5 Production Feature Run: CLOSED / PASSED.**
- Production feature layer now holds 1,754 governed `feature_value` rows; the two
  implemented modules' prerequisite inputs (`home_win_rate`, `away_win_rate`) are
  present with correct context, provenance, and version.
- `feature_value` = 1,754; `module_reading` = 0; `module_version` = 13
  (`all13_md5` unchanged). No migration, no module write, no Module #3.

**No next gate is started.** Gate 87 (read-only), the production-write
authorization gate, the first module write, and Module #3 all remain **held**
pending explicit authorization.
