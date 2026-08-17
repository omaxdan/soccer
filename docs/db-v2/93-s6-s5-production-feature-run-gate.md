# S-6 S-5 Production Feature-Run Gate (prepared — awaiting authorization)

**Gate type:** feature-value production gate, **prepared and held for explicit
operator authorization.** When authorized, its scope is the S-5 feature pipeline
run against production to compute and write `feature.feature_value` from the
existing completed fixtures. Nothing is executed by preparing it. **No module
write, no migration, no S-4, no Module #3.**

**Prerequisite satisfied:** Gate 91 (doc 92) is PASSED — the feature registry is
current (`8/11/14/11`), so the pipeline's registry reconciliation will succeed for
all calculators (before Gate 91 it would have failed on the unregistered
`venue_win_rate`/`team_momentum` features).

---

## 1. Objective and boundary

Run S-5 in production so the two implemented modules gain real inputs:
- `home_away_split` ← `team.home_win_rate` + `team.away_win_rate` (COMPETITION_SCOPED);
- `readiness_tracker` ← `team.momentum` (ALL_COMPETITIONS).

S-5 produces the **whole** implemented feature set (below), of which these three are
a subset. It writes **feature-layer data only**.

---

## 2. Calculators that will run (source: `feature/pipeline.ts` CALCULATORS)

**ALL_COMPETITIONS pass** (default driver `selectBatches`):

| calculator | produces |
|---|---|
| `formBackfill` | `team.home_form`, `team.away_form` |
| `fixtureLoad` | `team.rest_advantage`, `team.congestion_index` |
| `travelLoad` | `team.travel_impact` |
| `teamReadiness` | `team.readiness_score` (composite → lineage) |
| `travelItinerary` | `team.travel_distance` |
| `teamMomentum` | `team.momentum` ← readiness_tracker input |

**COMPETITION_SCOPED pass** (driver `selectScopedBatches`):

| calculator | produces |
|---|---|
| `venueWinRate` | `team.home_win_rate`, `team.away_win_rate` ← home_away_split inputs |

Every calculator is reconciled against the (now-complete) registry; an
unregistered feature would abort the run.

---

## 3. Input scope

- Population: **completed fixtures with results** — production holds **51 completed
  / 51 results**, across **2 editions**, **22 teams**, with **4 snapshot points**.
- The driver derives `as_of` per fixture × snapshot point (strict `< as_of`), then
  de-duplicates into `(as_of, team)` batches (ALL_COMPETITIONS) and
  `(as_of, edition, team)` batches (COMPETITION_SCOPED).
- Because the fixtures are historical, use **`replay`** over their kickoff span
  (not `calculate`, which is forward-from-now). Determine the span first (§5).

---

## 4. Write boundary (source-confirmed)

S-5 writes, in schema `feature`:
- `feature.feature_value` — the outputs;
- `feature.feature_lineage` — composite lineage (e.g. `readiness_score` consuming
  its inputs);
- `feature.feature_source` + `feature.feature_dependency` — the **declare** step
  (which football relations each calculator reads, and composite dependency edges);
  on by default, additive `ON CONFLICT DO NOTHING`, skipped under `--dry-run`;
- `operations.*` telemetry (job runs, write records).

S-5 **cannot and does not** write anything in schema `module` (verified: no
`INSERT INTO module` exists anywhere in `feature/`), runs **no migration**, and
touches **no Module #3 state**. So: **it may create `feature.feature_value`
(+ lineage + the source/dependency declarations + telemetry); it cannot create or
modify `module_reading`, `module_evidence`, `module_evidence_item`,
`module_version`, migrations, or any module registration.** This directly confirms
the boundary requested.

---

## 5. Pre-flight (SELECT-only + a dry-run; abort on mismatch)

```sql
-- A. baseline: expect feature_value = 0, and module output still 0
SELECT (SELECT count(*) FROM feature.feature_value)        AS feature_values,   -- expect 0
       (SELECT count(*) FROM module.module_reading)        AS readings,         -- expect 0
       (SELECT count(*) FROM module.module_version)        AS versions;         -- expect 13

-- B. registry is current (Gate 91): expect 8 | 11 | 14 | 11
SELECT (SELECT count(*) FROM feature.feature_calculator)              AS calculators,
       (SELECT count(*) FROM feature.feature_definition)              AS definitions,
       (SELECT count(*) FROM feature.feature_definition_context_kind) AS context_bindings,
       (SELECT count(*) FROM feature.feature_version)                 AS versions;

-- C. the fixture kickoff span, to set the replay range
SELECT min(scheduled_kickoff_at) AS first_kickoff,
       max(scheduled_kickoff_at) AS last_kickoff,
       count(*)                    AS completed
  FROM football.fixture WHERE lifecycle_state_code='COMPLETED';
```

Then a **dry-run** (computes, writes nothing):
```bash
cd beta/backend && npm run feature:v2 -- replay --from <first_kickoff> --to <after_last_kickoff> --dry-run
```
Review the reported would-write counts. **Abort** if the baseline is not
`feature_value=0`, `readings=0`, `versions=13`, or registry ≠ `8|11|14|11`, or if
the dry-run errors on registry reconciliation.

---

## 6. AUTHORIZED ACTION (only after explicit go)

```bash
cd beta/backend && npm run feature:v2 -- replay --from <first_kickoff> --to <after_last_kickoff>
```
(`<after_last_kickoff>` = a timestamp strictly after the last kickoff so the final
fixtures' snapshot instants are included.)

---

## 7. Post-checks (SELECT-only)

```sql
-- feature_value now populated; the module prerequisites present with correct context
SELECT d.feature_key, fv.context_kind_code,
       count(*)                                                              AS n,
       count(*) FILTER (WHERE fv.context_competition_edition_id IS NOT NULL) AS with_edition,
       count(*) FILTER (WHERE fv.context_competition_edition_id IS NULL)     AS null_edition
  FROM feature.feature_value fv
  JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
 WHERE d.feature_key IN ('team.home_win_rate','team.away_win_rate','team.momentum')
 GROUP BY d.feature_key, fv.context_kind_code ORDER BY d.feature_key;
-- expect: home/away_win_rate COMPETITION_SCOPED with_edition>0, null_edition=0;
--         momentum ALL_COMPETITIONS null_edition>0, with_edition=0

-- provenance / version / sample are set per value (spot-check)
SELECT d.feature_key, fv.provenance_class_code, fv.sample_meets_threshold,
       (v.designation) AS feature_version, count(*) AS n
  FROM feature.feature_value fv
  JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
  JOIN feature.feature_version v   ON v.id = fv.feature_version_id
 WHERE d.feature_key IN ('team.home_win_rate','team.away_win_rate','team.momentum')
 GROUP BY d.feature_key, fv.provenance_class_code, fv.sample_meets_threshold, v.designation
 ORDER BY d.feature_key;

-- PRESERVATION: module layer untouched — expect 0 | 0 | 0 | 13, all13_md5 unchanged
SELECT (SELECT count(*) FROM module.module_reading)  AS readings,
       (SELECT count(*) FROM module.module_evidence) AS evidence,
       (SELECT count(*) FROM module.module_evidence_item) AS items,
       (SELECT count(*) FROM module.module_version)  AS versions,
       (SELECT md5(string_agg(d.module_key||'='||mv.rationale,'|' ORDER BY d.display_number))
          FROM module.module_version mv JOIN module.module_definition d ON d.id=mv.module_definition_id) AS all13_md5;
```

**Success criteria:** `feature_value` > 0 with `home/away_win_rate`
(COMPETITION_SCOPED, edition set) and `team.momentum` (ALL_COMPETITIONS, edition
NULL) present; provenance non-null and `feature_version = 1.0.0`; **module layer
unchanged** — readings/evidence/items still 0, versions 13, `all13_md5` unchanged.

Notes on expectations (not failures): `team.momentum` requires ≥10 completed
result-bearing fixtures per team, so with 51 fixtures over 22 teams it will be
sparse — only teams meeting the window get a value; the rest are absent (which is
correct, and yields INACTIVE readiness_tracker readings later, never a fabricated
zero). `venue_win_rate` needs ≥1 completed home/away fixture in an edition.

---

## 8. Idempotency

Re-run the same `replay` (§6). Expect **0 written, all skipped** (the named
`feature_value` uniqueness makes recomputation a no-op), and the §7 counts
unchanged. Confirms convergence.

---

## 9. Hard-stop conditions

Stop immediately and report (do not proceed to Gate 87 re-run) if:
- any pre-flight baseline is wrong (feature_value ≠ 0, readings ≠ 0, versions ≠ 13,
  registry ≠ 8/11/14/11) → do not run;
- the run reports any write to schema `module`, or any `module_reading` /
  evidence / item appears (structurally impossible — treat as a serious anomaly);
- `module_version` count changes or `all13_md5` changes;
- a feature_value is written with the wrong context (e.g. a scoped value with NULL
  edition, or momentum with an edition) or a non-1.0.0 version;
- a migration runs.

**Containment:** each `(subject-population)` batch is one transaction; a batch
failure rolls back that batch and the run continues (isolated), and re-running is
idempotent. A transient connection timeout (Supabase cold pooler) is retried
automatically and is not a failure.

---

## 10. Authorization boundary and next gate

**Prepared and HELD — executes nothing until you explicitly authorize the S-5
production feature run.** On your go: §5 pre-flight + dry-run → §6 replay → §7 post
checks → §8 idempotency; paste the §7 results.

**Next gate (after a clean S-5 run):** **re-run Gate 87 (read-only)** — expect
**A** (registry present, feature values present, module output still 0) — then the
separate **production-write authorization gate** (Gate 83 re-evaluated against the
verified production state), then a small, auditable first module write. **No Module
#3** until production write authorization is granted.
