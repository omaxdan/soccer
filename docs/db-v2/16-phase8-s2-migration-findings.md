# PitchTerminal V2 — S-2 Migration Findings

Inconsistencies discovered while implementing Subsystem S-2 (Operational Layer) against the approved migration set.

**None of these was worked around silently, and none is fixed here.** S-2 may not change the approved schema. Each is recorded with the evidence that produced it, the effect on the application, what the implementation does in the meantime, and the correction the architecture owner would need to make.

Every finding was produced by **executing** the layer against PostgreSQL 16 with migrations 001–018 applied — not by reading the DDL.

| # | Finding | Severity | Blocks |
|---|---|---|---|
| **M-1** | Run and job rows cannot be closed — `outcome` is permanently `RUNNING` | **Blocking before production** | Run duration and outcome reporting |
| **M-2** | `pt_platform_admin` cannot write any operational telemetry | **Before production** | Operator-driven failure resolution |
| **M-3** | `write_record` shape differs from the S-2 brief | Documentation | Nothing — the schema's shape is better |
| **M-4** | `api_usage` is a window aggregate, not a call log | Documentation | Nothing — the schema's shape is better |
| **M-5** | `pipeline_schedule` / `pipeline_schedule_run` do not exist | Specification conflict | Nothing — pg_cron already owns this |

---

## M-1 — Run and job rows cannot be closed

**Severity: blocking before production.**

### The conflict

`operations.pipeline_run` and `operations.pipeline_job_run` are the only relations in the design modelled with an explicit **open → close lifecycle**:

```
 ended_at   timestamptz NULL                       -- only meaningful if set later
 outcome    text NOT NULL
            CHECK (outcome IN ('RUNNING','SUCCEEDED','FAILED','PARTIAL'))
                                                   -- 'RUNNING' is only meaningful as an initial state
```

Three facts make that lifecycle unreachable.

**1. The append-only guard is attached to both relations.**

```
$ select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid …
 pipeline_run          | tr_pipeline_run__append_guard
 pipeline_run_p202401  | tr_pipeline_run__append_guard
 …
```

**2. The guard raises on UPDATE for every principal, without exception (R-19).** Executed:

```
INSERT INTO operations.pipeline_run (run_key, trigger_kind, started_at, outcome, code_revision)
VALUES ('probe-1','MANUAL', now(), 'RUNNING', 'test');

UPDATE operations.pipeline_run SET outcome='SUCCEEDED', ended_at=now() WHERE run_key='probe-1';
-- NOTICE:  UPDATE BLOCKED: append-only relation: UPDATE attempted on
--          operations.pipeline_run_p202608 by role postgres

 run_key | outcome | still_open
---------+---------+------------
 probe-1 | RUNNING | t
```

Note the principal: **`postgres`**, the cluster superuser. The guard admits nobody.

**3. No role holds UPDATE on either relation.**

```
$ select pg_get_userbyid(a.grantee), c.relname from … where privilege_type='UPDATE' …
 pt_migration       | constraint_validation_progress
 pt_migration       | retention_policy
 pt_migration       | quality_check
 pt_platform_admin  | retention_policy
```

`pipeline_run` and `pipeline_job_run` appear nowhere.

### Effect

Every run and every job is permanently `RUNNING` with `ended_at` NULL. Consequently:

- **Run outcome is not recorded.** Nothing distinguishes a run that succeeded from one that failed, at the run level.
- **Run duration is not recorded.** `started_at` is stored; `ended_at` never is.
- The `SUCCEEDED`, `FAILED`, `PARTIAL` and `SKIPPED` enum values, and the `PRECONDITION_UNMET` value on job runs, are **unreachable**.
- Operational dashboards cannot answer "did last night's pipeline succeed" from these relations.

### Why the obvious alternative is not available

Inserting the row once, at completion, with an accurate `started_at`, `ended_at` and terminal outcome would satisfy the guard, the privilege matrix and the reporting requirement simultaneously. **It is foreclosed by P-04.**

`snapshot.match_snapshot.pipeline_job_run_id` is NOT NULL and pairs compositely with `pipeline_job_run_occurred_at`; `ck_match_snapshot__job_run_reference_complete` enforces both-or-neither. A sealing transaction must reference a job run that already exists **and is committed** at the moment it inserts the snapshot — which is *during* the work, not after it. The job row must therefore be inserted at open.

So the schema requires the row early (for the foreign key) and forbids amending it later (for the guard), and those two requirements are incompatible with recording an outcome.

### What S-2 does in the meantime

- Inserts at open with `outcome = 'RUNNING'`, so the composite foreign key resolves and S-7 is unblocked.
- **Probes the close capability once per process** rather than hard-coding the failure (`run.ts:tryCloseRow`). It attempts the UPDATE, learns it is refused, logs one warning naming this finding, and does not attempt again. If the defect is corrected, the application starts recording outcomes **with no code change**.
- Records the terminal state of failures in `operations.failure`, which is append-only and works. A failed job is therefore identifiable; a successful one is identifiable by the absence of a failure against it.
- Asserts the current behaviour in `operations.test.ts` ("M-1: operations run rows cannot be closed"), so that when the defect is fixed **the test fails** and this document gets closed rather than quietly outliving its truth.

### Candidate corrections

**Correction A — exempt the two run relations from the append guard, and grant UPDATE.**
Minimal. They are the only relations in the design with an open→close lifecycle, and they are telemetry rather than authoritative content: amending a run's own outcome is not the kind of rewrite R-19 exists to prevent. Requires a migration change to 015 (guard attachment) and 016 (grant).

**Correction B — model completion as an append-only companion.**
More consistent with the architecture's own philosophy. This is exactly the shape **A.2** already uses for snapshot outcome revision: rather than update a sealed row, append a companion recording currency by ordinal succession. A `pipeline_run_completion` relation carrying `(run_id, run_occurred_at, ended_at, outcome, ordinal)` would record outcomes without weakening the guard anywhere, and `RUNNING` would then be the only correct value on the run row itself.

**Recommended: B.** It preserves the append-only posture uniformly, reuses a pattern the architecture has already validated, and leaves the guard untouched — whereas A introduces the design's only guard exemption and would need to be justified against R-19's "without exception".

---

## M-2 — `pt_platform_admin` cannot write operational telemetry

**Severity: before production.**

### Evidence

```
admin INSERT failure_resolution: false
admin INSERT write_record:      false
ingestion INSERT failure_resolution: true
```

Migration 016's access specification grants `pt_platform_admin` `['S']` on `operations` — SELECT only, with one exception (`retention_policy`, SIU).

### Effect

`operations.failure_resolution` exists so a failure can be triaged and resolved: `OPEN → INVESTIGATING → RESOLVED / WONT_FIX`. That is an **operator** action. The administrative role is the one an operator would use, and it cannot insert the row.

Resolutions must currently be written by a **pipeline** role, which is the wrong principal: a pipeline resolving its own failures is not oversight.

### What S-2 does

`failure.ts:appendResolution` takes whatever connection it is given and does not assume a role — the privilege note is recorded in its documentation, and the test `M-2: pt_platform_admin cannot write operations telemetry` asserts the current state so a correction closes it.

### Candidate correction

Add `INSERT` on `operations.failure_resolution` to `pt_platform_admin`'s entry in migration 016. Narrow and specific: resolution is the only operational relation an operator writes, and `failure_resolution` is append-only, so no amendment capability is conferred.

---

## M-3 — `write_record` records different quantities than the brief asked for

**Severity: documentation. The schema's shape is the better one.**

The S-2 brief asks write records to capture *"operation type, rows inserted, rows updated, rows deleted, elapsed duration"*. The approved relation records:

```
 rows_examined   rows_written   rows_skipped   rows_rejected
```

No operation-type column, no per-operation counts, no duration.

**This is coherent, not deficient.** In a write model that is append-only by construction, "rows updated" and "rows deleted" are not quantities a pipeline can report: an UPDATE against `feature.feature_value` raises (R-19), and DELETE is held by `pt_retention` alone under the session marker (R-20, R-22). Columns for them would be permanently zero — and a permanently-zero column invites the belief that the operation is available.

The recorded quantities answer the questions this pipeline actually has: how much was considered, how much landed, how much was deliberately passed over, how much was refused. Duration belongs to the job run's `started_at`/`ended_at`, not to each batch within it — subject to M-1.

**No correction recommended.** The brief should be read as superseded by the schema.

---

## M-4 — `api_usage` is a window aggregate, not a call log

**Severity: documentation. The schema's shape is the better one.**

The brief asks for *"provider, endpoint, request timestamp, response timestamp, HTTP status, rows returned"*. The approved relation records:

```
 provider_code  endpoint_key  window_start  window_end
 requests_made  quota_consumed  quota_remaining  throttled_count
```

One row per (provider, endpoint, window). No status column, no per-call timing.

The unique constraint settles the intent: `uq_api_usage__provider_endpoint_window UNIQUE (provider_code, endpoint_key, window_start, occurred_at)`. A per-call log would make that constraint meaningless.

It is also the right shape operationally. At the coverage target a per-call log would be the largest operational relation by an order of magnitude, answering questions nobody asks ("what was the status of call 4,812,003"), while the question that *is* asked — "how much quota is left" — is answered directly by this shape. Phase 1 recorded that quota is the binding constraint on freshness and that nothing measured it; this relation measures it.

Per-call outcomes are not lost. A call that failed produces an `operations.failure` row with its full diagnostic, which is where one call's story belongs.

**What S-2 does.** `ApiUsageWindowBuilder` accepts per-call observations — which is how a caller naturally thinks — and folds them into the window the relation stores. The brief's model and the schema's model meet in that class, with no schema change.

**No correction recommended.**

---

## M-5 — `pipeline_schedule` and `pipeline_schedule_run` do not exist

**Severity: specification conflict. No schema change needed.**

### Evidence

```
$ select n.nspname||'.'||c.relname from pg_class c … where c.relname like '%schedule%';
(0 rows)
```

`operations` contains thirteen relations and none is a schedule: `api_usage`, `constraint_validation_progress`, `failure`, `failure_class`, `failure_resolution`, `operational_aggregate`, `pipeline_job_run`, `pipeline_run`, `quality_assertion_result`, `quality_check`, `quality_check_version`, `retention_policy`, `write_record`.

### This is a decision already taken, not an omission

Phase 8 §8.3 assigns:

| Concern | Home |
|---|---|
| Schedule **definitions** | `pg_cron` — stored in its own `cron.job` relation |
| Schedule **executions** | `operations.pipeline_run`, with `trigger_kind = 'SCHEDULED'` |

Migration 001 installs `pg_cron`; migration 018 contains the schedule entries, commented pending the cadence decision. `ck_pipeline_run__trigger_known` includes `'SCHEDULED'` precisely so a scheduled execution is distinguishable from a manual one.

A `pipeline_schedule` relation would be a second home for something that already has one, and the two would drift — the class of problem Phase 1 recorded across V1, where the same quantity lived in up to seven tables with nothing reconciling them.

### What S-2 does

`schedule.ts` provides storage using the relations that exist and fabricates nothing:

- `withScheduledRun()` — records a schedule **execution** through `pipeline_run` with `trigger_kind = 'SCHEDULED'`.
- `recentScheduledExecutions()` / `scheduleFired()` — reads them back, with the mandatory partition predicate on `occurred_at` (§5.10.6, F-15). `scheduleFired` is the check that finds a schedule which has stopped firing, which is otherwise silent: calculation is append-only and absences produce no error.
- `listSchedules()` — reads pg_cron's own catalogue where installed, and raises `ScheduleStorageUnavailableError` with the full explanation where not. Read-only: registering a schedule is a deployment operation, and a process that could schedule itself could schedule itself twice.

**No correction recommended.** The brief should be read as superseded by §8.3.

---

## Implementation note, not a schema finding — timestamp precision

Recorded here because **every subsystem pairing on a `timestamptz` will hit it**, S-7 above all.

`occurred_at` is half of every composite key in this schema: `pipeline_job_run` pairs `(pipeline_run_id, run_occurred_at)`; `failure` pairs `(pipeline_job_run_id, job_occurred_at)`; `snapshot.match_snapshot` pairs `(pipeline_job_run_id, pipeline_job_run_occurred_at)` under P-04.

PostgreSQL stores `timestamptz` at **microsecond** precision. A JavaScript `Date` carries **milliseconds**. A value generated by the column default, returned to the application, and sent back as the second half of a foreign key **arrives truncated and matches nothing**:

```
stored    2026-08-03 09:24:31.363472+00
returned  2026-08-03 09:24:31.363          (JS Date)
sent      2026-08-03 09:24:31.363000+00    ->  foreign key violation
```

Found by the S-2 suite, where every job run failed to attach to its pipeline run with `violates foreign key constraint "fk_pipeline_job_run__run"`.

**The fix, and the rule for every later subsystem:** the application supplies `occurred_at` explicitly (`run.ts:operationalNow()`) rather than relying on the column default, so the stored value only ever has precision JavaScript can represent and the round trip is lossless. Any code that takes a database-generated `timestamptz` and sends it back as part of a key must either do the same or keep the value as text and never convert it.

This is not a schema defect — the schema is correct — but it is a trap that costs a full debugging cycle to find, and it is invisible in the DDL.

---

## Summary for the architecture owner

Two items need a decision before production:

- **M-1** is blocking and needs Correction A or B. Recommendation: **B**, the append-only companion, consistent with A.2.
- **M-2** needs one `INSERT` grant added to migration 016.

Three need no schema change: **M-3** and **M-4** are cases where the approved schema is better than the brief that described it, and **M-5** is a concern the architecture already assigned elsewhere. All three are recorded so a future reader does not mistake the divergence for an implementation shortcut.
