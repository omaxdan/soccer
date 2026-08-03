# PitchTerminal V2 — S-2 Resolution

Closure of every finding raised in [document 16](./16-phase8-s2-migration-findings.md).

**Nothing was weakened.** No append-only guard was removed or exempted. No `UPDATE` privilege was granted to any role on any relation. No `DELETE` privilege was granted beyond the existing retention path. `RUNNING` remains the immutable initial state of a run and of a job run.

## Disposition

| # | Finding | Classification | Instrument |
|---|---|---|---|
| **M-1** | Run and job rows could not reach a terminal state | **Resolved by migration correction** | Migration `019`, Correction B |
| **M-2** | `pt_platform_admin` could not resolve a failure | **Resolved by migration correction** | Migration `019` |
| **M-3** | `write_record` shape | **Closed as documentation clarification** | This document, §M-3 |
| **M-4** | `api_usage` shape | **Closed as documentation clarification** | This document, §M-4 |
| **M-5** | `pipeline_schedule` absent | **Closed as documentation clarification** | This document, §M-5 |
| — | Timestamp precision | **Resolved by application implementation** | Engineering rule ER-01 |

---

## M-1 — Resolved by migration correction

### What was wrong

`operations.pipeline_run` and `operations.pipeline_job_run` model an open → close lifecycle (`ended_at` nullable, `outcome` including `'RUNNING'`) that no principal could complete. Both carry the append-only guard, which raises on `UPDATE` for every principal without exception (R-19), and no role held `UPDATE` on either. Every run stayed `RUNNING` for ever, so run outcome and duration were never recorded.

Inserting the row once at completion instead was foreclosed by **P-04**: `snapshot.match_snapshot.pipeline_job_run_id` is NOT NULL and pairs compositely with `pipeline_job_run_occurred_at`, so a sealing transaction must reference a job run that already exists **and is committed** during the work.

### The correction — Correction B, the A.2 pattern

Migration `019_operational_completion.sql` adds two append-only companions:

```sql
CREATE TABLE operations.pipeline_run_completion (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  pipeline_run_id   bigint      NOT NULL,
  run_occurred_at   timestamptz NOT NULL,
  ended_at          timestamptz NOT NULL,
  outcome           text        NOT NULL,
  ordinal           integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_pipeline_run_completion PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_pipeline_run_completion__succession
    UNIQUE (pipeline_run_id, run_occurred_at, ordinal, occurred_at),
  CONSTRAINT fk_pipeline_run_completion__run
    FOREIGN KEY (pipeline_run_id, run_occurred_at)
    REFERENCES operations.pipeline_run (id, occurred_at)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_pipeline_run_completion__outcome_known
    CHECK (outcome IN ('SUCCEEDED','FAILED','PARTIAL')),
  CONSTRAINT ck_pipeline_run_completion__ordinal_positive CHECK (ordinal >= 1)
) PARTITION BY RANGE (occurred_at);
```

`operations.pipeline_job_run_completion` mirrors it over `('SUCCEEDED','FAILED','SKIPPED','PRECONDITION_UNMET')`. **It was required, not optional**: the job run is the relation `snapshot.match_snapshot` actually references, so it is the one whose outcome a later reader most needs.

Note that `'RUNNING'` is absent from both CHECK constraints. A completion record saying the run is still running is not a completion.

### Design properties

| Property | How |
|---|---|
| Append-only | `tr_*__append_guard` on both, using the existing `feature.tf_append_only__guard()` |
| No UPDATE anywhere | Only `SELECT` and `INSERT` granted, to any role |
| Composite references | `(pipeline_run_id, run_occurred_at)` → `pipeline_run (id, occurred_at)` — A.1 / R-01 |
| Co-partitioned | Monthly on `occurred_at`, added to `fn_maintain_partitions()` (§5.11.6) |
| Retention | `BOUNDED`, 180 days, matching the runs they complete |
| Current-state access path | `ix_*__current (parent_id, parent_instant, ordinal DESC)` — a backwards index scan of one row |
| RLS | Enabled and forced, with a policy for every grant, via `fn_apply_access` |

`fn_maintain_partitions()` is replaced with `CREATE OR REPLACE` in 019 rather than edited in 018, so the approved set stays intact.

### Ordinal succession, and the tie-break

`ordinal` is allocated as `max(ordinal) + 1` within the run. A correction to a recorded outcome is a **new row at a higher ordinal**; the earlier record stays readable, because a run whose outcome was revised is a different fact from one that was always `SUCCEEDED`.

The unique constraint includes `occurred_at`, because F-03 forbids a non-covering unique index on a partitioned relation. A duplicate ordinal in a *different month* is therefore possible in principle, so current-state resolution orders on `(ordinal DESC, occurred_at DESC, id DESC)` — deterministic rather than arbitrary, which is the defect class Phase 7 recorded as DB-04.

### Reading current state

Two views resolve the prevailing completion:

```sql
CREATE OR REPLACE VIEW operations.v_pipeline_run_current
  WITH (security_invoker = true, security_barrier = true) AS
SELECT r.id, r.run_key, r.started_at,
       c.ended_at,
       COALESCE(c.outcome, r.outcome) AS outcome,
       (c.ended_at - r.started_at)    AS duration
FROM operations.pipeline_run r
LEFT JOIN LATERAL (…ORDER BY pc.ordinal DESC, pc.occurred_at DESC, pc.id DESC LIMIT 1) c ON true;
```

`COALESCE` keeps `RUNNING` for a run with no completion yet — which is now a **true statement about an in-flight run** rather than a permanent lie about a finished one.

### Application change

`tryCloseRow()` is replaced by `appendCompletion()` in `v2/operations/run.ts`; `v2/operations/jobLifecycle.ts` calls it. **S-1's public contract is untouched** — `withRun`, `withConnection`, `withSession`, `withSavepoint` and `requireJobRun` keep their signatures.

```ts
export async function appendCompletion(
  control: PoolClient,
  target: CompletionTarget,
  id: string,
  occurredAt: Date,
  outcome: string,
  endedAt: Date = operationalNow()
): Promise<boolean> {
  const spec = COMPLETION_SPEC[target];
  await control.query(
    `INSERT INTO operations.${spec.relation}
       (occurred_at, ${spec.idColumn}, ${spec.instantColumn}, ended_at, outcome, ordinal)
     SELECT $1, $2, $3, $4, $5,
            COALESCE((SELECT max(c.ordinal) + 1
                        FROM operations.${spec.relation} c
                       WHERE c.occurred_at >= $3::timestamptz - interval '30 days'
                         AND c.${spec.idColumn} = $2
                         AND c.${spec.instantColumn} = $3), 1)`,
    [operationalNow(), id, occurredAt, endedAt, outcome]
  );
  …
}
```

The `occurred_at` lower bound is the mandatory partition predicate (§5.10.6, F-15). A completion is always within days of the run it completes, so the bound is both correct and prunable.

Behaviour is now exactly as specified:

| Point | Effect |
|---|---|
| Start | `INSERT operations.pipeline_run`, `outcome = 'RUNNING'` |
| Job start | `INSERT operations.pipeline_job_run`, `outcome = 'RUNNING'` — committed, so P-04's reference resolves |
| Finish | `INSERT operations.pipeline_run_completion`, `outcome = SUCCEEDED \| FAILED \| PARTIAL` |
| Failure | `INSERT` completion with `FAILED`, **and** `INSERT operations.failure` |

`appendCompletion` never throws: telemetry must not decide the fate of the work it describes.

### Regression tests

Seven, in `operations.test.ts`:

| Test | Asserts |
|---|---|
| a run reaches a terminal state without any UPDATE | run row still `RUNNING`; completion is `SUCCEEDED` at ordinal 1 with `ended_at` |
| a failed run records FAILED | run and job completions both `FAILED`; the `failure` row exists alongside |
| a snapshot may reference a job run while it is still open | the job run is committed and visible from another connection **during** the work — P-04's requirement |
| a corrected outcome appends a higher ordinal | ordinal 2 prevails; **both** records remain |
| nothing was weakened | no `UPDATE`/`DELETE` grant on either completion relation |
| protected at BOTH layers | a granted role is refused by **privilege**; both relations carry the **guard** |
| the current-state view resolves the prevailing outcome | view reports `SUCCEEDED`, and `duration` is answerable |

The sixth is worth calling out: the two defences refuse *different principals*. A pipeline role hits `permission denied` before the guard is reached; the guard exists for the owner, whom no application credential authenticates as. The test therefore exercises the privilege layer and confirms the guard's attachment in the catalogue, since the privilege check would otherwise mask an absent guard.

---

## M-2 — Resolved by migration correction

`operations.failure_resolution` records a failure's triage history — `OPEN → INVESTIGATING → RESOLVED / WONT_FIX`. That is an **operator** action, and `pt_platform_admin` is the role an operator uses, but migration 016 granted it `SELECT` only on `operations`. Resolutions had to be written by a pipeline role, and a pipeline resolving its own failures is not oversight.

Migration 019:

```sql
SELECT operations.fn_apply_access('operations','failure_resolution','pt_platform_admin','SI');
```

**INSERT only.** The relation is append-only and carries the guard, so a resolution history is the sequence of its rows; no amendment capability is conferred and none is needed. Issued through `fn_apply_access` so the grant carries its matching policy — a grant without a policy on a FORCE-RLS relation fails silently, which is the defect class of B-03, B-09 and B-11.

Verified:

```
INSERT=true UPDATE=false DELETE=false
```

**Regression tests.** `M-2: pt_platform_admin can append a failure resolution` writes one as the admin role and reads it back. `M-2: pt_platform_admin cannot modify or remove an existing resolution` asserts `INSERT` true, `UPDATE` and `DELETE` false, and that an `UPDATE` attempt is refused.

The S-1 permission register test caught this grant on its first run after the migration and failed until `roles.ts` was updated to declare it — which is exactly what that test exists for.

---

## M-3 — Closed as documentation clarification

**No schema change.** The authoritative description of `operations.write_record` is:

> `write_record` records append pipeline throughput:
> **`rows_examined`, `rows_written`, `rows_skipped`, `rows_rejected`.**

References to `rows_updated`, `rows_deleted` and elapsed duration are withdrawn. In a write model that is append-only by construction those are not quantities a pipeline can report: an `UPDATE` against `feature.feature_value` raises (R-19), and `DELETE` is held by `pt_retention` alone under the session marker (R-20, R-22). A column for them would be permanently zero, and a permanently-zero column invites the belief that the operation is available.

**Duration belongs to lifecycle timing** — `pipeline_job_run.started_at` with the `ended_at` now supplied by M-1's completion record, exposed as `duration` on `v_pipeline_job_run_current`.

---

## M-4 — Closed as documentation clarification

**No schema change.** The authoritative description of `operations.api_usage` is:

> `api_usage` is a **quota window aggregate**. It records provider, endpoint, window, requests, quota consumption, remaining quota and throttling.

One row per `(provider, endpoint, window)`, not one row per call — which is what `uq_api_usage__provider_endpoint_window` already states. **Individual call failures belong in `operations.failure`**, with the full diagnostic, which is where one call's story belongs.

`ApiUsageWindowBuilder` accepts per-call observations, because that is how a caller naturally thinks, and folds them into the window the relation stores. No schema change was needed to reconcile the two.

---

## M-5 — Closed as documentation clarification

**No `pipeline_schedule` tables are created.** The concern is already assigned:

| Concern | Home |
|---|---|
| Schedule **definition** | `pg_cron` — `cron.job` |
| Schedule **execution** | `operations.pipeline_run`, `trigger_kind = 'SCHEDULED'` |

`ck_pipeline_run__trigger_known` includes `'SCHEDULED'` precisely so a scheduled execution is distinguishable from a manual one. A `pipeline_schedule` relation would be a second home for something that already has one, and the two would drift — the class of problem Phase 1 recorded across V1, where the same quantity lived in up to seven tables with nothing reconciling them.

`v2/operations/schedule.ts` provides `withScheduledRun()`, `recentScheduledExecutions()`, `scheduleFired()` and read access to `cron.job`, and fabricates nothing. `scheduleFired()` is the check that finds a schedule which has stopped firing — otherwise silent, because calculation is append-only and absences produce no error.

---

## Engineering rule ER-01 — Timestamp precision

**Resolved by application implementation.** Added to the standing rules in `beta/backend/src/v2/README.md`.

> Any timestamp participating in a **composite key**, a **foreign key** or a **partition key** must either
>
> 1. originate from an application-controlled timestamp value, or
> 2. remain serialised without JavaScript `Date` conversion.
>
> **Never** `database timestamptz → JS Date → database key comparison.`

PostgreSQL stores `timestamptz` at microsecond precision; a JavaScript `Date` carries milliseconds. A value generated by a column default, returned to the application and sent back as half a key **arrives truncated and matches nothing**:

```
stored    2026-08-03 09:24:31.363472+00
returned  2026-08-03 09:24:31.363          (JS Date)
sent      2026-08-03 09:24:31.363000+00    ->  foreign key violation
```

Found when every job run failed to attach to its pipeline run with `violates foreign key constraint "fk_pipeline_job_run__run"`. The implementation now supplies `occurred_at` explicitly via `operations/run.ts:operationalNow()`.

**This binds every later subsystem, S-7 above all**, whose sealing writes carry the job run's instant into `snapshot.match_snapshot` under P-04.

**Regression tests.** `composite foreign keys succeed using application-supplied instants` traverses the whole chain — run → job → completion — and asserts it resolves. `an application-supplied instant round-trips without loss` asserts the millisecond value survives exactly.

---

## Verification

Rebuilt from an empty database, all nineteen migrations applied in sequence, each inside a transaction:

```
001 … 018   applied
019         applied
fn_maintain_partitions()  ->  8 new partitions (the two completion relations × 4 months)
```

Both conformance gates pass at the end of 019 — `fn_assert_security_posture()` and `fn_assert_access_correspondence()` — so the new relations carry a policy for every privilege granted on them.

| Suite | Result |
|---|---|
| Full backend, with a V2 database | **139 tests, 139 passing** |
| Full backend, without one | **64 tests, 64 passing** (integration suites skip) |

V1 source remains untouched.

---

## Status

**All S-2 findings are closed.** Two by migration correction, one by application implementation, three as documentation clarifications. No architecture was weakened, no schema assumption was silently modified, and no work beyond S-2 was performed.

S-3 (Vocabulary & Registry Seeding) has not been started.
