# Phase 8 S-6 — Operational Closure: Verification Block

## Status

| Section | State |
|---|---|
| **§1 — runs and prevailing outcome** | **VERIFIED** by the operator against the real database, 2026-08-11. Evidence below |
| §2 — job attribution | **OUTSTANDING** |
| §3 — write records | **OUTSTANDING** |
| §4 — provider calls | **OUTSTANDING** |
| §5 — failure and lingering state | **OUTSTANDING** |
| §6 — data-state invariants | **OUTSTANDING** |
| **THE S-6 OPERATIONAL GATE** | **NOT CLOSED** |

**Why §2–§6 are outstanding:** this session has no route to the real database.
`PT_V2_DB_HOST`, `_NAME`, `_USER`, `_PASSWORD`, `_PORT`, `_SSL` and
`_USER_SUFFIX` are all absent from the environment; no `.env` exists at the
package root or the working directory; and the only file in the tree matching
`PT_V2_DB_HOST=` is `.env.v2.example`, a template. The V2 connection doctor
refuses to start. §1 was run by the operator, who supplied the results recorded
below.

**No production data has been changed by this document. No connection has been
opened from this session, and no provider call has been made.**

---

## §1 — VERIFIED

Run against the real Supabase database on 2026-08-11.

| Field | Run 51 | Invariant |
|---|---|---|
| `run_key` | `v2.ingest.season` | **PASS** |
| `trigger_kind` | `MANUAL` | **PASS** — a directly invoked pipeline |
| `scope_text` | `competition 325 season 87678 2026-05-31..2026-08-11` | **PASS** — competition, season and window all present |
| `started_at` | `2026-08-11 16:55:15.821+00` | |
| `ended_at` | `2026-08-11 16:57:03.654+00` | **PASS** — not null |
| **prevailing outcome** | **`SUCCEEDED`** | **PASS** |
| `completion_ordinal` | `1` | **PASS** — one completion, no correction appended |
| duration | `107.83 s` | see O-2 |
| `code_revision` | **`unknown`** | see O-1 |

Run 50 is also `SUCCEEDED` with the same scope. Runs 47–49 are earlier failed
attempts, consistent with iterating on configuration before the first successful
execution; §5 is what confirms they are attributed separately.

**The terminal outcome was resolved through the prevailing completion record, not
through the stale `pipeline_run.outcome` column** — which is the trap this
document warns about below, and it was avoided.

### O-1 — `code_revision = unknown`. Configuration gap, not a defect.

`codeRevision()` (`operations/run.ts:90`) reads `PT_V2_CODE_REVISION` and falls
back to the literal `'unknown'`. The variable was not set on the machine that ran
the sweep, so **the run ledger cannot tie runs 50 and 51 to the build that
produced them** — which is the column's entire purpose.

Harmless for a hand-run validation where the operator knows what they ran. It
stops being harmless the moment a sweep is scheduled or repeated across a
deployment, because a result whose producing revision is unrecorded cannot be
reproduced or blamed. **Setting `PT_V2_CODE_REVISION` to the commit SHA is a
one-line deployment change; no code change is needed.** Recorded so it is decided
rather than inherited.

### O-2 — 107.83 s for four provider calls. Explained, not anomalous.

Four calls against a 2 000 ms minimum interval account for roughly 6–8 s. The
remainder is database connection establishment: this programme measured a full
connect to the Supabase pooler at **14 125 ms** (doc 39 lineage), and a season
sweep opens several — `withPipelineRun`'s control connection, `withRun`'s control
and work connections, and the usage-flush connection.

Not a defect, and not worth optimising for one season. **Worth knowing before the
56-competition sweep:** if roughly 100 s of each season's ~108 s is connection
overhead rather than work, 56 competitions is ~100 minutes dominated by connect
latency, and pooling across seasons would be the lever — not the pager, and not
the writer. **Measure before optimising; recorded as an observation only.**

---

## The trap in this schema

Anyone verifying these runs by reading `pipeline_run.outcome` will conclude that
**every run ever executed is still RUNNING**, and that is not what it means.

`operations.pipeline_run.outcome` is written once as `'RUNNING'` and **is never
updated**. Migration 019 (finding M-1) made terminal outcomes append-only:
`operations.pipeline_run_completion` carries `ended_at`, `outcome` and an
`ordinal`, and a correction is a new row at a higher ordinal rather than an edit.
The same applies to `pipeline_job_run` → `pipeline_job_run_completion`.

**The prevailing outcome is the completion row with the highest ordinal.** Every
query below resolves it that way. A verification that skipped this step would
report a false failure on a healthy run.

---

## The verification block

Run as a role holding `SELECT` on schema `operations` — `pt_platform_admin` or
`pt_pipeline_ingestion`. **Every statement is read-only.**

### 1 · The runs, with their prevailing outcome

```sql
WITH prevailing AS (
  SELECT DISTINCT ON (c.pipeline_run_id, c.run_occurred_at)
         c.pipeline_run_id, c.run_occurred_at, c.outcome, c.ended_at, c.ordinal
    FROM operations.pipeline_run_completion c
   ORDER BY c.pipeline_run_id, c.run_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
)
SELECT r.id,
       r.occurred_at,
       r.run_key,
       r.trigger_kind,
       r.scope_text,
       r.started_at,
       p.ended_at,
       COALESCE(p.outcome, r.outcome)                 AS prevailing_outcome,
       p.ordinal                                       AS completion_ordinal,
       round(EXTRACT(epoch FROM (p.ended_at - r.started_at))::numeric, 2) AS seconds,
       r.code_revision
  FROM operations.pipeline_run r
  LEFT JOIN prevailing p
    ON p.pipeline_run_id = r.id AND p.run_occurred_at = r.occurred_at
 WHERE r.run_key = 'v2.ingest.season'
 ORDER BY r.occurred_at DESC;
```

**Expect:** two rows, ids 50 and 51, `prevailing_outcome = 'SUCCEEDED'`,
`completion_ordinal = 1`, `ended_at` not null.
`scope_text = 'competition 325 season 87678 2026-05-31..2026-08-11'`.

**A `prevailing_outcome` of `RUNNING` with a null `ended_at` means no completion
was ever appended** — an in-flight or crashed run, not a successful one.

### 2 · Job attribution

```sql
WITH prevailing AS (
  SELECT DISTINCT ON (c.pipeline_job_run_id, c.job_occurred_at)
         c.pipeline_job_run_id, c.job_occurred_at, c.outcome, c.ended_at, c.ordinal
    FROM operations.pipeline_job_run_completion c
   ORDER BY c.pipeline_job_run_id, c.job_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
)
SELECT j.pipeline_run_id                       AS run_id,
       j.id                                    AS job_id,
       j.job_key,
       j.scope_text,
       j.started_at,
       p.ended_at,
       COALESCE(p.outcome, j.outcome)          AS prevailing_outcome
  FROM operations.pipeline_job_run j
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
  LEFT JOIN prevailing p
    ON p.pipeline_job_run_id = j.id AND p.job_occurred_at = j.occurred_at
 WHERE r.run_key = 'v2.ingest.season'
 ORDER BY j.occurred_at DESC;
```

**Expect:** exactly **one** job per run, `job_key = 'ingest.season'`,
`SUCCEEDED`. A season sweep writes in a single transaction, so a second job under
one run would mean the orchestrator ran twice.

### 3 · Write records reconciled against the reported counts

```sql
SELECT r.id                                    AS run_id,
       w.target_schema_name || '.' || w.target_relation_name AS relation,
       w.rows_examined, w.rows_written, w.rows_skipped, w.rows_rejected
  FROM operations.write_record w
  JOIN operations.pipeline_job_run j
    ON j.id = w.pipeline_job_run_id AND j.occurred_at = w.job_occurred_at
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
 WHERE r.run_key = 'v2.ingest.season'
 ORDER BY r.id DESC, relation;
```

**Expect per run** — and note which figures are *not* row counts:

| Relation | examined | written | skipped | rejected | Note |
|---|---|---|---|---|---|
| `football.competition` | 1 | 1 | 0 | 0 | |
| `football.competition_edition` | **1** | 1 | 0 | 0 | resolved once per response since the F-1 fix |
| `football.competition_stage` | 6 | 6 | 0 | 0 | rounds 4, 18–22 |
| `football.venue` | 20 | 20 | 0 | 0 | |
| `football.team` | 20 | 20 | 0 | 0 | |
| `football.team_registration` | **94** | 94 | 0 | 0 | two per fixture; **20 distinct rows** |
| `football.fixture` | **94** on run 50, **47** on run 51 | same | 0 | 0 | **F-2** — see below |
| `football.fixture_lifecycle_transition` | **0** | 0 | 0 | 0 | **F-2** |
| `football.result` | 47 | **43** | **4** | 0 | the four postponed are skipped, not rejected |

**Two of these will look wrong and are not.** `football.fixture` reporting 94 on
the first run over 47 fixtures, and `fixture_lifecycle_transition` reporting 0
despite 47 rows existing, are **F-2**: `recordLifecycleTransition` is handed the
fixture's counter, so its 47 writes land there and the transition relation reports
nothing. Telemetry only; no data is affected. **Do not treat 94 as a duplicate
signal.**

Likewise `rows_written` cannot distinguish an insert from an update (**F-3**), so
run 51 reporting `written = 47` does **not** contradict "zero new fixtures". The
idempotency proof is the row count in §6, not this column.

### 4 · Provider calls

```sql
SELECT u.occurred_at, u.endpoint_key, u.window_start, u.window_end,
       u.requests_made, u.quota_consumed, u.quota_remaining, u.throttled_count
  FROM operations.api_usage u
 WHERE u.provider_code = 'SPORTSAPI_API'
   AND u.endpoint_key IN ('tournament_season_events_last', 'tournament_season_events_next')
 ORDER BY u.occurred_at DESC;

-- Totals per endpoint
SELECT endpoint_key,
       sum(requests_made)  AS requests,
       sum(quota_consumed) AS consumed,
       sum(throttled_count) AS throttled,
       min(quota_remaining) AS lowest_reported_remaining
  FROM operations.api_usage
 WHERE provider_code = 'SPORTSAPI_API'
   AND endpoint_key IN ('tournament_season_events_last', 'tournament_season_events_next')
 GROUP BY 1;
```

**Expect per sweep:** `tournament_season_events_last` → **3** requests,
`tournament_season_events_next` → **1**. Across runs 50 and 51: **6 and 2**,
totalling **8**. `throttled_count = 0`.

`quota_remaining` is what the provider *said* and is nullable by design — a null
means the provider sent no header, never that quota is unknown-and-guessed. It
should match the CLI's `quota remaining` line for the corresponding run and
should be **monotonically decreasing** across the two runs. A figure that rose
between runs means the daily window reset between them, which is legitimate but
worth noting in the record.

**And no other endpoint may appear for these runs.** This is the assertion that
`/schedule/{date}` and match-level endpoints were not touched:

```sql
SELECT DISTINCT endpoint_key
  FROM operations.api_usage
 WHERE occurred_at >= (SELECT min(started_at) FROM operations.pipeline_run
                        WHERE run_key = 'v2.ingest.season')
 ORDER BY 1;
```

**Expect exactly two keys.** A `schedule` or `event_*` key here is a hard stop.

### 5 · No lingering failed or partial state

```sql
-- Failures attributed to any season-sweep job
SELECT r.id AS run_id, f.failure_class_code, f.affected_entity_text,
       left(f.diagnostic, 300) AS diagnostic, f.occurred_at
  FROM operations.failure f
  JOIN operations.pipeline_job_run j
    ON j.id = f.pipeline_job_run_id AND j.occurred_at = f.job_occurred_at
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
 WHERE r.run_key = 'v2.ingest.season'
 ORDER BY f.occurred_at DESC;

-- Runs that never completed
SELECT r.id, r.occurred_at, r.scope_text
  FROM operations.pipeline_run r
  LEFT JOIN operations.pipeline_run_completion c
    ON c.pipeline_run_id = r.id AND c.run_occurred_at = r.occurred_at
 WHERE r.run_key = 'v2.ingest.season' AND c.id IS NULL;

-- More than one completion for a run (a correction was appended)
SELECT pipeline_run_id, run_occurred_at, count(*) AS completions,
       array_agg(outcome ORDER BY ordinal) AS outcomes_in_order
  FROM operations.pipeline_run_completion
 GROUP BY 1, 2 HAVING count(*) > 1;
```

**Expect:** three empty results. A second completion is not corruption — it is
the ordinal-succession design working — but it means a run's outcome was revised
and the revision needs explaining.

### 6 · The data state the operational record claims

```sql
SELECT
  (SELECT count(*) FROM football.competition_edition
    WHERE provider_external_id = '87678')                                   AS editions,
  (SELECT count(*) FROM football.fixture f
     JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    WHERE ce.provider_external_id = '87678')                                AS fixtures,
  (SELECT count(*) FROM football.fixture f
     JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    WHERE ce.provider_external_id = '87678'
      AND f.lifecycle_state_code = 'COMPLETED')                             AS completed,
  (SELECT count(*) FROM football.fixture f
     JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    WHERE ce.provider_external_id = '87678'
      AND f.lifecycle_state_code = 'POSTPONED')                             AS postponed,
  (SELECT count(*) FROM football.result r
     JOIN football.fixture f
       ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
     JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    WHERE ce.provider_external_id = '87678')                                AS results;

-- Every fixture physically in the 2026 partition
SELECT f.tableoid::regclass::text AS partition, count(*)
  FROM football.fixture f
  JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
 WHERE ce.provider_external_id = '87678'
 GROUP BY 1;

-- U-9: one provider fixture, one row — across ALL partitions
SELECT provider_code, provider_external_id, count(*) AS rows_found,
       array_agg(to_char(fixture_partition_on, 'YYYY-MM-DD')) AS partitions
  FROM football.fixture
 GROUP BY 1, 2 HAVING count(*) > 1;

-- F-1: one provider season, one edition
SELECT provider_external_id, count(*)
  FROM football.competition_edition
 WHERE provider_external_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;

-- Migration 022 present
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'football.competition_edition'::regclass AND contype = 'u';

-- No result on an unfinished fixture
SELECT count(*) AS results_on_unfinished_fixtures
  FROM football.result r
  JOIN football.fixture f
    ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
 WHERE f.lifecycle_state_code <> 'COMPLETED';

-- No fabricated creation transition after the first
SELECT from_state_code, to_state_code, count(*)
  FROM football.fixture_lifecycle_transition t
  JOIN football.fixture f
    ON f.id = t.fixture_id AND f.fixture_partition_on = t.fixture_partition_on
  JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
 WHERE ce.provider_external_id = '87678'
 GROUP BY 1, 2 ORDER BY 3 DESC;
```

**Expect:** `1 / 47 / 43 / 4 / 43`; one partition row,
`football.fixture_p2026 = 47`; three empty duplicate results;
`uq_competition_edition__provider_external_id UNIQUE (provider_external_id)`
present; `results_on_unfinished_fixtures = 0`; transitions exactly
`null→COMPLETED 43` and `null→POSTPONED 4`, **47 total and no more** — a
`SCHEDULED→…` row would mean run 51 moved a lifecycle state it should have left
alone.

---

## What closing the gate requires

1. ~~Run §1 against the real database.~~ **Done — see the top of this document.**
2. Run **§2–§6** against the real database.
3. Paste the results into this document.
4. If everything matches, state the gate satisfied here — **not before.**

Any of these is a stop, to be reported before anything is changed:

- a prevailing outcome other than `SUCCEEDED` on run 50 or 51;
- more than one job per run, or a `job_key` other than `ingest.season`;
- any endpoint key beyond the two season keys;
- total `requests_made` ≠ 8 across both runs;
- any row from the three duplicate queries;
- `fixtures ≠ 47`, `editions ≠ 1`, `results ≠ 43`, or any partition other than
  `football.fixture_p2026`;
- a lifecycle transition whose `from_state_code` is not null.

---

## Reported, not verified

Recorded because it is the input to the closure, and labelled so it is never
mistaken for something I checked:

> 4 provider calls per sweep · 120 events read · 47 selected · 47 fixtures · 1
> edition · 20 teams · 20 venues · 43 results · 4 postponed · second run
> idempotent · all 47 in `football.fixture_p2026` · partition violations 0 ·
> `competition_edition` count 1 · migration 022 present.

Those figures are exactly what the replay proof produces from the captured
bodies, which is a meaningful corroboration — the live provider returned what it
returned on 11 August. It is not a substitute for reading the operational rows.

---

## Remaining Phase 8 Decisions

Four open items. **None is implemented, and none is recommended for
implementation in this step.**

### U-10 — a fixture rescheduled EARLIER

A fixture moved to a date before its immutable `fixture_partition_on` violates
`ck_fixture__partition_not_after_kickoff` (SQLSTATE `23514`) and aborts the page.
Today that is a loud, named, safe failure, and two tests hold the posture —
including one asserting the constraint definition still reads
`fixture_partition_on <=`, so a later attempt to weaken it breaks a test that
says why.

**The decision:** abort the page, or catch `23514` on that specific constraint,
count it as a stated rejection, and continue. The second is preferable and is a
**writer** concern, not a schema one. **Not urgent** — it needs a real
brought-forward fixture, which a single completed season cannot produce. It
becomes reachable during a multi-competition sweep.

### F-2 — lifecycle-transition writes counted against `football.fixture`

`recordLifecycleTransition` receives the fixture's counter, so
`football.fixture` reports 94 examined over 47 fixtures while
`fixture_lifecycle_transition` reports 0 despite 47 rows. Telemetry only.

**The decision:** whether `operations.write_record` must be accurate before the
56-competition sweep. It matters because that sweep's per-relation counts are how
an operator will judge it, and a fixture count roughly double the truth with a
permanent zero beside it is actively misleading. **A small fix — pass the
transition relation its own counter.**

### F-3 — insert and update are indistinguishable

`upsertMutable` counts every successful statement as `written`. A run that
inserted 47 fixtures and one that updated 47 report identically, which is why
run 51's idempotency has to be proven by row count rather than by telemetry.

**The decision:** whether "how much of this competition was new?" is a question
the sweep must answer from its own records. `RETURNING (xmax = 0) AS inserted`
distinguishes the two at no extra round trip. Larger than F-2 and touches the
shared write primitive, so it deserves its own step.

### Forward-window configuration

The window `2026-05-31 → 2026-08-11` selects **zero** forward fixtures, because
`events/next/0` opens on 2026-08-15. The pager is behaving correctly; the
configuration has no forward horizon.

**The decision:** PitchTerminal is a *pre-match* intelligence platform, and a
window with no forward reach gives it nothing to be pre-match about. The
historical window and the future-fixture horizon are two parameters serving two
purposes — how far back baselines are computed, and how far ahead fixtures are
known — and the current configuration collapses them into one. Now a
**configuration** change rather than a code one: the CLI takes `--from` and
`--to` explicitly.

**Recommended order, once the gate is closed:** F-2 (small, and makes the sweep
readable), then the forward window (a product decision, no code), then F-3 (its
own step), then U-10 (only when a brought-forward fixture is plausible).

---

**Nothing in this document has been executed against any database.**
