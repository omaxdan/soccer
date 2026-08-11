# Phase 8 S-4 — Standings Live Proof: Verification Block

## Status — VERIFIED

| | |
|---|---|
| **Live ingestion** | **RUN** — runs 52 and 53, both `2026-08-11` |
| **§0–§6 database verification** | **EXECUTED — all 33 assertions PASS** |
| **S-4 standings live proof** | **VERIFIED** |
| **S-4 as a whole** | **OPEN** — see the closure section |

Verified against the real database via
`docs/db-v2/sql/s4-standings-verification.sql`, which resolves run outcomes
through `pipeline_run_completion` by highest ordinal rather than the stale
`pipeline_run.outcome` column, and settles shell-team creation from
`football.team.created_at` inside the run window rather than from `rows_written`,
which under F-3 cannot distinguish an insert from an update.

### Evidence

| | Run 52 | Run 53 |
|---|---|---|
| **Standings** | **20 written / 0 skipped / 0 rejected** | **0 written / 20 skipped / 0 rejected** |
| `write_record` attribution | present | present |
| `scope_text` | contains `+standings@2026-08-11` | contains `+standings@2026-08-11` |

**Database state:** 20 `football.standing` rows · variant **TOTAL only** · **0**
HOME/AWAY · `as_of_on` **2026-08-11** · positions **1–20** · **20** distinct
teams · **0** duplicate `(team, variant, as_of)` groups · exactly **1**
competition edition for season 87678.

**Season state:** 47 fixtures · 43 results · 6 competition stages · 20 distinct
team registrations · 20 venues.

**Team resolution:** **0** shell teams created during the runs · **0** standings
teams without fixtures.

**Provider:** 6 `tournament_season_events_last` · 2
`tournament_season_events_next` · 2 `season_standings` · no unexpected endpoint ·
`throttled_count` **0** · **0** failure rows.

**The idempotency proof is run 53's `20 examined / 0 written / 20 skipped / 0
rejected`.** `standing` is append-only, so `insertAppendOnly` derives `skipped`
from what it offered — the telemetry is honest here in a way it is not for
fixtures, and **F-3 does not reach this relation**.

**S-4 standings: COMPLETE and LIVE-PROVEN.**

---

## How it was produced

```
cd beta/backend
npm run ingest:v2 -- season --tournament 325 --season 87678 \
                            --from 2026-05-31 --to 2026-08-11 \
                            --max-calls 10 --with-standings
```

run twice on the same UTC date. The verification below is read-only and
establishes the result independently of the CLI output.

---

## The verification block

Read-only throughout. `:run1` and `:run2` are the two new `pipeline_run` ids;
§0 finds them.

### §0 · Identify the two runs

```sql
WITH prevailing AS (
  SELECT DISTINCT ON (c.pipeline_run_id, c.run_occurred_at)
         c.pipeline_run_id, c.run_occurred_at, c.outcome, c.ended_at, c.ordinal
    FROM operations.pipeline_run_completion c
   ORDER BY c.pipeline_run_id, c.run_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
)
SELECT r.id, r.occurred_at, r.scope_text, r.started_at, p.ended_at,
       COALESCE(p.outcome, r.outcome) AS prevailing_outcome, p.ordinal,
       round(EXTRACT(epoch FROM (p.ended_at - r.started_at))::numeric, 2) AS seconds
  FROM operations.pipeline_run r
  LEFT JOIN prevailing p ON p.pipeline_run_id = r.id AND p.run_occurred_at = r.occurred_at
 WHERE r.run_key = 'v2.ingest.season'
 ORDER BY r.occurred_at DESC LIMIT 4;
```

**Expect** the two newest rows `SUCCEEDED`, ordinal 1, and
`scope_text = 'competition 325 season 87678 2026-05-31..2026-08-11 +standings@<UTC date>'`.

**The outcome must be read from the completion record, never from
`pipeline_run.outcome`** — that column is written once as `RUNNING` and never
updated (migration 019, M-1). Reading it directly reports a false failure on a
healthy run.

### §1 · One `ingest.season` job per run

```sql
WITH prevailing AS (
  SELECT DISTINCT ON (c.pipeline_job_run_id, c.job_occurred_at)
         c.pipeline_job_run_id, c.job_occurred_at, c.outcome, c.ended_at, c.ordinal
    FROM operations.pipeline_job_run_completion c
   ORDER BY c.pipeline_job_run_id, c.job_occurred_at, c.ordinal DESC, c.occurred_at DESC, c.id DESC
)
SELECT j.pipeline_run_id AS run_id, j.id AS job_id, j.job_key,
       COALESCE(p.outcome, j.outcome) AS prevailing_outcome,
       round(EXTRACT(epoch FROM (p.ended_at - j.started_at))::numeric, 2) AS seconds
  FROM operations.pipeline_job_run j
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
  LEFT JOIN prevailing p
    ON p.pipeline_job_run_id = j.id AND p.job_occurred_at = j.occurred_at
 WHERE r.run_key = 'v2.ingest.season' AND r.id IN (:run1, :run2)
 ORDER BY j.occurred_at;
```

**Expect** exactly one row per run, `job_key = 'ingest.season'`, `SUCCEEDED`.

### §2 · Write records — the assertion that decides idempotency

```sql
SELECT r.id AS run_id,
       w.target_schema_name || '.' || w.target_relation_name AS relation,
       w.rows_examined, w.rows_written, w.rows_skipped, w.rows_rejected
  FROM operations.write_record w
  JOIN operations.pipeline_job_run j
    ON j.id = w.pipeline_job_run_id AND j.occurred_at = w.job_occurred_at
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
 WHERE r.id IN (:run1, :run2)
 ORDER BY r.id, relation;
```

**Expect for `football.standing`:**

| Run | examined | written | skipped | rejected |
|---|---|---|---|---|
| First | 20 | **20** | 0 | 0 |
| Second | 20 | **0** | **20** | 0 |

**That second row is the whole idempotency proof.** `standing` is append-only, so
`insertAppendOnly` uses `ON CONFLICT DO NOTHING` and derives `skipped` from what
it offered — the telemetry is honest here in a way it is not for fixtures. **F-3
does not reach this relation.**

Other relations on both runs — and none of these indicates duplication:

| Relation | examined | written | Note |
|---|---|---|---|
| `football.competition` | 1 | 1 | |
| `football.competition_edition` | 1 | 1 | resolved once per response |
| `football.competition_stage` | 6 | 6 | rounds 4, 18–22 |
| `football.venue` | 20 | 20 | |
| `football.team` | 20 | 20 | upserts, not inserts — see §5 |
| `football.team_registration` | 94 | 94 | two per fixture; **20 distinct rows** |
| `football.fixture` | 47 | 47 | **F-2**: a first-ever run reads 94 here because transition writes land on the fixture counter |
| `football.fixture_lifecycle_transition` | 0 | 0 | **F-2** |
| `football.result` | 47 | 43 | 4 skipped — the postponed fixtures |

`rows_written = 20` on `football.team` is an **update** count, not an insert
count (**F-3**), and must not be read as duplication. §5 settles it from the
database instead.

### §3 · Provider calls

```sql
SELECT u.endpoint_key,
       sum(u.requests_made)   AS requests,
       sum(u.quota_consumed)  AS consumed,
       sum(u.throttled_count) AS throttled,
       min(u.quota_remaining) AS lowest_remaining
  FROM operations.api_usage u
 WHERE u.provider_code = 'SPORTSAPI_API'
   AND u.occurred_at >= (SELECT started_at FROM operations.pipeline_run WHERE id = :run1)
 GROUP BY 1 ORDER BY 1;
```

**Expect exactly three endpoint keys, and 5 requests per run:**

| Endpoint | Per run |
|---|---|
| `tournament_season_events_last` | **3** |
| `tournament_season_events_next` | **1** |
| `season_standings` | **1** |

`throttled = 0`. **Any other key — `schedule`, or anything match-level — is a
hard stop.** The two runs together should total 10 requests.

### §4 · The standings table

```sql
SELECT standing_variant,
       to_char(as_of_on, 'YYYY-MM-DD') AS as_of,
       count(*)                 AS rows,
       min(position)            AS min_position,
       max(position)            AS max_position,
       count(DISTINCT position) AS distinct_positions,
       count(DISTINCT team_id)  AS distinct_teams
  FROM football.standing s
  JOIN football.competition_edition ce ON ce.id = s.competition_edition_id
 WHERE ce.provider_external_id = '87678'
 GROUP BY standing_variant, as_of_on
 ORDER BY as_of_on, standing_variant;
```

**Expect exactly ONE row:**

```
TOTAL | <run UTC date> | 20 | 1 | 20 | 20 | 20
```

A second row for a second `as_of_on` means the two passes crossed midnight UTC —
which is **correct** append-only behaviour for a snapshot relation, not a defect,
but it invalidates the same-day idempotency test and the pair should be re-run
within one UTC day.

```sql
-- No HOME or AWAY row may exist for this edition
SELECT count(*) AS non_total_rows
  FROM football.standing s
  JOIN football.competition_edition ce ON ce.id = s.competition_edition_id
 WHERE ce.provider_external_id = '87678' AND s.standing_variant <> 'TOTAL';
-- Expect 0

-- No duplicate (team, variant, as-of) — the uniqueness the constraint already
-- guarantees, asserted anyway because this is what "no duplicate standings" means
SELECT team_id, standing_variant, as_of_on, count(*)
  FROM football.standing s
  JOIN football.competition_edition ce ON ce.id = s.competition_edition_id
 WHERE ce.provider_external_id = '87678'
 GROUP BY 1,2,3 HAVING count(*) > 1;
-- Expect no rows
```

### §5 · No shell teams — settled from the database, not from telemetry

```sql
SELECT count(*) AS teams_created_during_the_runs
  FROM football.team
 WHERE created_at >= (SELECT started_at FROM operations.pipeline_run WHERE id = :run1);
-- Expect 0
```

**Expect 0**, because the 20 teams already exist from runs 50/51. This is
stronger than a before/after count and immune to F-3: a team created by the
standings stage would carry a `created_at` inside the run window.

```sql
-- Every standings row belongs to a team that also plays fixtures in this edition
SELECT count(*) AS standings_teams_with_no_fixture
  FROM football.standing s
  JOIN football.competition_edition ce ON ce.id = s.competition_edition_id
 WHERE ce.provider_external_id = '87678'
   AND NOT EXISTS (
     SELECT 1 FROM football.fixture f
      WHERE f.competition_edition_id = s.competition_edition_id
        AND (f.home_team_id = s.team_id OR f.away_team_id = s.team_id));
-- Expect 0
```

### §6 · Season ingestion unchanged, and no failure state

```sql
SELECT
  (SELECT count(*) FROM football.competition_edition WHERE provider_external_id = '87678') AS editions,
  (SELECT count(*) FROM football.fixture f JOIN football.competition_edition ce
     ON ce.id = f.competition_edition_id WHERE ce.provider_external_id = '87678')          AS fixtures,
  (SELECT count(*) FROM football.result r JOIN football.fixture f
     ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
     JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    WHERE ce.provider_external_id = '87678')                                               AS results,
  (SELECT count(*) FROM football.competition_stage cs JOIN football.competition_edition ce
     ON ce.id = cs.competition_edition_id WHERE ce.provider_external_id = '87678')         AS stages,
  (SELECT count(*) FROM football.team_registration tr JOIN football.competition_edition ce
     ON ce.id = tr.competition_edition_id WHERE ce.provider_external_id = '87678')         AS registrations;
-- Expect  1 | 47 | 43 | 6 | 20
```

`registrations` is **20 distinct rows**, not 94 — 94 is the write-attempt count
(two per fixture), which is what §2's `rows_examined` reports.

```sql
SELECT r.id AS run_id, f.failure_class_code, left(f.diagnostic, 200) AS diagnostic
  FROM operations.failure f
  JOIN operations.pipeline_job_run j
    ON j.id = f.pipeline_job_run_id AND j.occurred_at = f.job_occurred_at
  JOIN operations.pipeline_run r
    ON r.id = j.pipeline_run_id AND r.occurred_at = j.run_occurred_at
 WHERE r.id IN (:run1, :run2);
-- Expect no rows
```

### §7 · The flag remains opt-in

Not a database check — a behavioural one, already covered by the test suite and
worth confirming once live: running the command **without** `--with-standings`
must produce **4** provider calls and no `season_standings` row in
`operations.api_usage`. **Do not run this as a third pass unless you want to
spend the quota**; the assertion is held by tests 17a/17b.

---

## Stop conditions

Report and stop — do not repair — on any of:

- either run not `SUCCEEDED`, or more than one `ingest.season` job on a run;
- any endpoint key beyond the three expected, or `throttled > 0`;
- `football.standing` row count ≠ 20 for the edition, or any `standing_variant`
  other than `TOTAL`;
- the second run's `football.standing` write record not exactly
  **20 / 0 / 20 / 0**;
- `teams_created_during_the_runs` ≠ 0;
- any row from the duplicate or non-TOTAL checks;
- any `operations.failure` row attributed to either run.

---

## S-4 closure: standings proof ≠ S-4 complete

These are **two different statements** and only the first is at stake here.

**Governing criteria — `15-phase8-application-migration-specification.md` §3.4**,
which names S-4's target relations. Current state, verified in the repository:

| Relation | Writer | Reachable from a stage |
|---|---|---|
| `competition`, `competition_edition`, `competition_stage`, `venue`, `team`, `team_registration`, `fixture`, `fixture_lifecycle_transition`, `result`, `result_revision` | yes | yes — schedule / season |
| `player`, `player_registration`, `player_availability`, `player_valuation` | yes | yes — squad |
| **`standing`** | yes | **yes — this step** |
| **`appearance`** | **NONE** | no |
| **`provider_statistic`** | **NONE** | no |

**Two of §3.4's named relations have no writer at all.** Both are deferred for
stated reasons, not forgotten:

- **`appearance`** (with `lineup`, `lineup_selection`, `match_event`) — **G-1 is
  OPEN**: no provider endpoint for per-fixture player data has been demonstrated
  (doc 35). Match-level fan-out has been deferred throughout this programme.
- **`provider_statistic`** — doc 15's own dependency table names
  *"`provider_statistic.measures` shape undefined (004 TODO)"* as **S-4's blocking
  issue**. It was known-blocked at planning time.

Also outstanding within S-4's scope: **F-2** and **F-3**, which make
`operations.write_record` misreport per-relation counts, and **U-10**.

**So, when the standings proof passes, the correct statement is:**

> **S-4 standings live proof: VERIFIED.**
> **S-4 as a whole: NOT CLOSED** — `appearance` and `provider_statistic` are
> unwritten and their blockers (G-1, the `measures` shape) are unresolved.

Closing S-4 requires a separate decision: either resolve those two blockers, or
record a governed decision that both relations are deferred out of S-4 with the
scope amended in doc 15. **That decision has not been made and is not implied by
a successful standings run.**

---

**Nothing in this document has been executed. No assertion has been tested.**
