# PitchTerminal V2 — Historical Backfill & Production Cutover

**Target window: 2026-05-31 → 2026-08-04 (today) — 66 UTC dates, inclusive.**

Every command is implemented in this repository. No code is modified. Every number is derived from the source or measured against the schema, and where a figure cannot be known in advance it is given as a query to run rather than a guess.

> ### Read §8 before you start
>
> The chosen window is the **northern-hemisphere close season**. Two-thirds of it contains almost no club football, and the six V2 features are all club-form derived. The backfill will succeed, write correctly, and produce far fewer feature values than the fixture count suggests — most of them flagged `sample_meets_threshold = false`. That is the system working honestly, not failing. §8 quantifies it and gives the alternative.

---

## Phase 1 — Preparation

### 1.1 Prerequisites

```bash
cd /path/to/soccer/beta/backend
node --version          # the repo targets an LTS with tsx support
npm install
npm run build           # tsc — expect exit 0
psql "$PT_V2_ADMIN_URL" -c "SELECT version();"     # expect PostgreSQL 16.x
```

### 1.2 Confirm migrations

All twenty must be applied. `020` in particular — without it the feature-value business identity cannot detect a duplicate and Replay B silently fails.

```sql
SELECT count(*) FROM information_schema.schemata
 WHERE schema_name IN ('football','feature','module','snapshot','calibration','product','operations');
-- expect 7

SELECT count(*) FROM pg_constraint
 WHERE contype = 'u' AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%';
-- expect 7   ← migration 020 applied

SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();
-- both return without raising
```

**Partitions must cover the window.** `feature_value` and `feature_lineage` are partitioned monthly by `as_of`; `fixture` and `result` yearly by `fixture_partition_on`. The window spans 2026-05 … 2026-08.

```sql
SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
 WHERE i.inhparent = 'feature.feature_value'::regclass
   AND c.relname IN ('feature_value_p202605','feature_value_p202606',
                     'feature_value_p202607','feature_value_p202608')
 ORDER BY 1;
-- expect all four

SELECT count(*) FROM feature.feature_value_pdefault;   -- expect 0, now and after
```

A row landing in `pdefault` means a partition is missing; `quality_check.default_partition_empty` exists for exactly this and is registered HIGH at an hourly cadence.

### 1.3 Confirm seed data

```bash
npm run seed:v2
```

Expect `v2 seed complete: 0 inserted, 146 already present` on an already-seeded database, or `146 inserted, 0 already present` on a fresh one.

```sql
SELECT (SELECT count(*) FROM football.currency)          AS currency,     -- 14
       (SELECT count(*) FROM football.country)           AS country,      -- 51
       (SELECT count(*) FROM football.position)          AS position,     -- 11
       (SELECT count(*) FROM football.snapshot_point)    AS snap_points,  -- 4
       (SELECT count(*) FROM feature.feature_definition) AS feature_defs, -- 7
       (SELECT count(*) FROM module.module_definition)   AS module_defs;  -- 13
```

`snapshot_point` is seeded by the migrations, not the seed, and **every `as_of` in the system derives from it**. The four in force are `KICKOFF` (0), `T_MINUS_1D`, `T_MINUS_3D`, `T_MINUS_7D`. An empty table makes the feature pipeline throw rather than write nothing — deliberately.

### 1.4 Confirm environment

```bash
grep -c PT_V2_ .env
```

| Variable | Needed for | Note |
|---|---|---|
| `PT_V2_DB_HOST`, `PT_V2_DB_NAME` | everything | |
| `PT_V2_DB_PORT` | | defaults 5432. **6543 is refused outright** — session mode is required |
| `PT_V2_DB_PASSWORD_INGESTION` | ingestion + seed | |
| `PT_V2_DB_PASSWORD_FEATURE` | features + seed | |
| `PT_V2_DB_PASSWORD_MODULE`, `..._ADMIN` | seed; `_ADMIN` also for `verify` | |
| `PT_V2_PROVIDER_BASE_URL`, `PT_V2_PROVIDER_KEY` | ingestion | `PT_V2_PROVIDER_KEY_2` doubles the budget to 200 |
| `PT_V2_PROVIDER_DAILY_QUOTA` | | defaults 100 **per key** |
| `PT_V2_PROVIDER_MIN_INTERVAL_MS` | | defaults 2000 — this sets the backfill's floor runtime |

### 1.5 Confirm roles

```sql
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'pt\_%' ORDER BY 1;
```

`pt_pipeline_ingestion`, `pt_pipeline_feature`, `pt_pipeline_module` and `pt_platform_admin` must show `rolcanlogin = t`. All roles are created `NOLOGIN` by migration 001; **nothing in this repository grants login** — it is a manual step by the database owner.

Verify the isolation actually holds before trusting it:

```sql
SELECT count(*) FROM information_schema.role_table_grants
 WHERE grantee = 'pt_pipeline_ingestion' AND table_schema IN ('feature','module','snapshot','calibration');
-- expect 0 — ingestion structurally cannot reach Layer 2 or beyond
```

---

## Phase 2 — Historical backfill

### 2.1 The one command

```bash
cd /path/to/soccer/beta/backend
npm run ingest:v2 -- --from 2026-05-31 --to 2026-08-04
```

### 2.2 `--allow-over-budget` is **not** required, and should not be passed

The guard refuses when `dates.length > keys × PT_V2_PROVIDER_DAILY_QUOTA`. Here:

```
66 dates  ≤  2 keys × 100 = 200 calls/day     →  the guard passes
```

Passing `--allow-over-budget` would disable the only protection against a mistyped range. Leave it off. It becomes necessary only beyond 200 dates — see §8.4.

### 2.3 Expected provider calls

| | |
|---|---|
| Endpoint | `GET /schedule/{date}` — `FEED`, one call per date |
| Calls | **66**, one per UTC date, no retries assumed |
| Share of daily budget | 33% of 200 |
| Remaining after the run | ~134 calls the same day |

One call carries competition, season, round, venue, both teams, fixture, status and score — which is why 66 calls populate seven relations.

### 2.4 Expected runtime

```
throttle floor : 65 gaps × 2 000 ms  =  130 s
request time   : 66 × 0.3–1.5 s      =  20–100 s
database time  : dominated by fixture volume per date
```

**Realistic total: 5–20 minutes.** The throttle is global, not per endpoint — the provider's limit, not the path's.

### 2.5 Transaction behaviour

**One transaction per date.** Everything a date writes commits together or not at all. A date that fails rolls back entirely and the run **continues to the next** — days are independent, so one bad response does not cost the range.

Within a date the resolution order is the reference graph and is fixed:

```
competition → competition_edition → competition_stage → venue
  → team ×2 → team_registration ×2 → fixture
  → fixture_lifecycle_transition → result (→ result_revision)
```

One malformed *event* inside a date does not abort the date: shape failures are counted and skipped. A failure carrying a SQLSTATE **is** rethrown, because the transaction is then poisoned and continuing would fail every subsequent statement.

### 2.6 Replay safety

Fully replay-safe. Re-running any date, or the whole range, is correct and cheap in rows:

| Class | Relations | Mechanism |
|---|---|---|
| Mutable identity | `competition`, `competition_edition`, `competition_stage`, `venue`, `team`, `fixture`, `result` | `ON CONFLICT DO UPDATE`, every column `COALESCE(EXCLUDED.col, target.col)` — a thinner payload never erases a known value |
| Append-only | `fixture_lifecycle_transition`, `result_revision` | `ON CONFLICT DO NOTHING`, named target |
| Immutable once set | `team_registration.registered_on` | never moved |

**There is no delete path and there cannot be one** — `pt_pipeline_ingestion` holds no `DELETE` on any `football` relation.

It costs provider calls, though. A re-run is 66 more calls, not 0 — the response is fetched before the database can tell you it already had it.

### 2.7 Progress monitoring

Run in one terminal, watch in another.

```bash
npm run ingest:v2 -- --from 2026-05-31 --to 2026-08-04 2>&1 | tee backfill.log
```

Per date the log emits `v2 ingestion: schedule date processed` then `v2 ingestion: date complete` with written/skipped/rejected. On completion:

```
v2 ingestion complete: 66 date(s), 66 provider call(s), 0 failure(s)
  examined  ……
  written   ……
  skipped   ……
  rejected  ……
```

Live, from a second shell:

```sql
-- fixtures landed so far, by month
SELECT date_trunc('month', scheduled_kickoff_at)::date AS month, count(*)
  FROM football.fixture GROUP BY 1 ORDER BY 1;

-- per-relation write record for this run
SELECT target_relation_name, sum(rows_written) w, sum(rows_skipped) s, sum(rows_rejected) r
  FROM operations.write_record
 WHERE occurred_at >= now() - interval '1 hour'
 GROUP BY 1 ORDER BY 1;

-- quota burned today
SELECT sum(quota_consumed) FROM operations.api_usage
 WHERE occurred_at >= date_trunc('day', now());

-- anything failing
SELECT occurred_at, failure_class_code, message FROM operations.failure
 ORDER BY occurred_at DESC LIMIT 10;
```

**`rejected > 0` needs attention, not a retry.** It almost always means an unmapped country — `mapCountry` refuses rather than inventing a code. The fix is to add the code to `src/v2/seed/vocabulary.ts` under governance, re-run `npm run seed:v2`, and re-ingest the affected dates.

### 2.8 If the run stops part-way

The exit code is 1 if **any** date failed; the rest still committed. Re-run only what failed:

```bash
grep 'date failed' backfill.log            # the dates to repeat
npm run ingest:v2 -- --date 2026-06-17     # one at a time, or a narrow --from/--to
```

Re-running the whole range is also safe — it just costs 66 calls again.

---

## Phase 3 — Feature calculation

### 3.1 Use `replay`, then one `calculate`

```bash
cd /path/to/soccer/beta/backend

# 1. see the plan and the batch count without writing
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04 --dry-run

# 2. the historical window
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04

# 3. forward fixtures whose early snapshot points have already passed
npm run feature:v2
```

### 3.2 Why `replay`, and why the third command is not optional

`calculate` and `replay` are **the same pipeline**. Only the driver's range differs — replay is not a second implementation and cannot drift from forward operation.

| | `calculate` | `replay` |
|---|---|---|
| Range | `now − lookbackDays` … `now + maxOffset` | the explicit `--from`/`--to` **kickoff** range |
| Default reach | **2 days** | none — both flags are required |
| Intended use | scheduled operation | a deliberate historical act (D-4) |

`calculate --lookback-days 66` would cover the same window and produce identical output. **Prefer `replay` anyway**: `--lookback-days` is the knob a scheduled run reads, and setting it to 66 once is how a scheduled run later drifts into recomputing a quarter of a year every night. `replay` requires both bounds explicitly, so a historical act cannot be entered by accident.

**Step 3 exists because the replay range is bounded by kickoff, not by `as_of`.** A fixture kicking off 2026-08-08 has `T_MINUS_7D = 2026-08-01`, already in the past and therefore eligible — but its kickoff is outside `--to 2026-08-04`, so the replay never selects it. The forward `calculate` picks it up. Skipping step 3 leaves the next seven days of fixtures with no early-point features.

### 3.3 What the pipeline does

```
loadRegistry → assertCalculatorCoverage → deriveExecutionPlan → selectBatches
  → declare feature_source (9 rows) + feature_dependency (2 rows)     first run only
  → Stage 1: fixture_load + form_backfill + travel_load  → commit
  → Stage 2: team_readiness                              → commit
```

Order is **derived** from `feature_dependency`, never written down; ties broken by `calculator_key` ascending. Expect this line in the output:

```
stages: fixture_load + form_backfill + travel_load  ->  team_readiness
order:  fixture_load -> form_backfill -> travel_load -> team_readiness   (derived from feature_dependency)
```

**One transaction per (calculator × subject batch)**, values then lineage, forced by the foreign key. Stage 2 cannot start until Stage 1 has committed, because it reads its inputs back through `feature_value` on a different connection.

### 3.4 Do not run ingestion and features concurrently

Features read `football.fixture` and `football.result` inside their own transactions. A concurrent ingestion commit would let one batch see a fixture another did not, both labelled with the same `as_of`.

---

## Phase 4 — Verification

### 4.1 Ingestion integrity

```sql
-- 1. Fixture coverage matches the window
SELECT min(scheduled_kickoff_at), max(scheduled_kickoff_at), count(*) FROM football.fixture;

-- 2. Every fixture has a legal lifecycle state
SELECT lifecycle_state_code, count(*) FROM football.fixture GROUP BY 1 ORDER BY 2 DESC;
--    UNKNOWN > 0 means provider statuses are unmapped: the guard is protecting by
--    default (is_open = false), which is correct, but it needs investigating.

-- 3. Completed fixtures carry a result
SELECT count(*) FROM football.fixture f
  LEFT JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
 WHERE f.lifecycle_state_code = 'COMPLETED' AND r.fixture_id IS NULL;
-- expect 0

-- 4. No row escaped into a default partition
SELECT (SELECT count(*) FROM football.fixture_pdefault)       AS fixture_default,
       (SELECT count(*) FROM feature.feature_value_pdefault)  AS value_default,
       (SELECT count(*) FROM feature.feature_lineage_pdefault) AS lineage_default;
-- expect 0, 0, 0

-- 5. Every relation that should have been written, was
SELECT target_schema_name||'.'||target_relation_name AS relation,
       sum(rows_written) w, sum(rows_skipped) s, sum(rows_rejected) r
  FROM operations.write_record GROUP BY 1 ORDER BY 1;
--    A relation ABSENT from this list received nothing. That is the state this
--    relation exists to make visible.

-- 6. Nothing failed unnoticed
SELECT occurred_at, failure_class_code, message FROM operations.failure
 ORDER BY occurred_at DESC LIMIT 50;

-- 7. Every run reached a terminal state
SELECT r.job_key, r.occurred_at, c.outcome
  FROM operations.pipeline_job_run r
  LEFT JOIN operations.pipeline_job_run_completion c
         ON c.pipeline_job_run_id = r.id AND c.job_occurred_at = r.occurred_at
 WHERE c.pipeline_job_run_id IS NULL;
-- expect 0 rows — a run with no completion means the process died
```

### 4.2 Feature integrity

```bash
npm run feature:v2 -- verify
```

Expect four `PASS` lines: `feature_dependency_acyclic` (BLOCKING), `feature_scale_conformance`, `orphan_absence`, `provenance_propagation`. Requires `PT_V2_DB_PASSWORD_ADMIN` — it runs read-only as `pt_platform_admin`.

```sql
-- 8. Six features present, squad_stability absent
SELECT d.feature_key, count(*) AS values,
       count(*) FILTER (WHERE v.sample_meets_threshold) AS meets_threshold,
       min(v.as_of), max(v.as_of)
  FROM feature.feature_definition d
  LEFT JOIN feature.feature_value v ON v.feature_definition_id = d.id
 GROUP BY 1 ORDER BY 1;
--    team.squad_stability MUST show 0. It is registered and never calculated (R-1).

-- 9. Declarations written exactly once
SELECT (SELECT count(*) FROM feature.feature_source)     AS sources,       -- 9
       (SELECT count(*) FROM feature.feature_dependency) AS dependencies;  -- 2

-- 10. Scale conformance — value_scale is honoured
SELECT d.feature_key, d.value_scale, count(*) AS wrong_scale
  FROM feature.feature_value v JOIN feature.feature_definition d ON d.id = v.feature_definition_id
 WHERE scale(v.value) <> d.value_scale
 GROUP BY 1,2;
-- expect 0 rows

-- 11. Lineage exists for the only composite feature and for nothing else
SELECT d.feature_key, count(l.*) AS lineage_edges
  FROM feature.feature_value v
  JOIN feature.feature_definition d ON d.id = v.feature_definition_id
  LEFT JOIN feature.feature_lineage l
         ON l.produced_value_id = v.id AND l.produced_value_as_of = v.as_of
 GROUP BY 1 ORDER BY 1;
--    only team.readiness_score should carry edges

-- 12. Provenance never exceeds the registry ceiling
SELECT d.feature_key, v.provenance_class_code, count(*)
  FROM feature.feature_value v JOIN feature.feature_definition d ON d.id = v.feature_definition_id
 GROUP BY 1,2 ORDER BY 1,2;
--    team.rest_advantage may reach OBSERVED; the other five cap at DERIVED

-- 13. as_of instants are whole seconds (ER-01)
SELECT count(*) FROM feature.feature_value WHERE date_part('microsecond', as_of) <> 0;
-- expect 0
```

### 4.3 Replay B — the decisive check

```bash
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04
```

**Every `written` count must be 0 and `skipped` must equal `examined`.** A non-zero write means duplicate detection is not working — check that migration 020 is applied (§1.2). This is the single most important verification in the whole plan: it proves the database, not the application, owns idempotency.

### 4.4 Freshness

```sql
SELECT feature_key, context_kind_code, last_calculated_at, staleness
  FROM operations.v_freshness ORDER BY staleness DESC NULLS FIRST;
```

`team.squad_stability` will show permanently stale with a NULL `last_calculated_at`. **That is correct** — annotate the dashboard, do not alert on it.

### 4.5 Production-ready gate

Declare the database ready only when all of the following hold:

| | |
|---|---|
| ☐ | Ingestion completed with `0 failure(s)`, or every failed date re-run successfully |
| ☐ | Checks 3, 4, 7 return 0 |
| ☐ | Check 5 lists **every** expected relation (§7.1) |
| ☐ | `feature:v2 -- verify` shows four PASS |
| ☐ | Checks 9, 10, 13 return the expected values |
| ☐ | **Replay B writes zero rows** |
| ☐ | `rejected` counts understood — each one is an unmapped value, not a transient error |

---

## Phase 5 — Production cutover

### 5.1 Daily ingestion

```bash
cd /path/to/soccer/beta/backend
npm run ingest:v2                                  # today — 1 call
```

Recommended instead, at 3 calls/day, so late results and the forward window are both covered:

```bash
npm run ingest:v2 -- --from "$(date -u -d yesterday +%F)" --to "$(date -u -d tomorrow +%F)"
```

Cron (UTC): `0 4 * * *`.

### 5.2 Daily feature calculation

```bash
npm run feature:v2
```

Cron (UTC): `0 7 * * *` — **after** ingestion has finished, never overlapping it. The two-day default lookback means a missed day self-heals on the next run.

### 5.3 Weekly verification

```bash
npm run feature:v2 -- verify
psql "$PT_V2_ADMIN_URL" -c "SELECT operations.fn_assert_security_posture();"
psql "$PT_V2_ADMIN_URL" -c "SELECT operations.fn_assert_access_correspondence();"
```

Cadence taken from `operations.quality_check`, which declares it: the four feature controls are 1 day, the security assertions are BLOCKING at 1 day. Weekly is the pragmatic floor; daily matches the registry.

### 5.4 Operational monitoring

| Panel | Query | Alert |
|---|---|---|
| Quota | `sum(quota_consumed)` from `api_usage`, today | > 85% before the ingest window |
| Rows by relation | `write_record`, 24h | an expected relation **missing** |
| Rejections | `write_record.rows_rejected` | > 0 |
| Run outcomes | `pipeline_job_run` ⟕ completion | any run with no completion row |
| Feature freshness | `operations.v_freshness` | staleness > 36h, excluding `squad_stability` |
| Failures | `operations.failure`, 7d | any BLOCKING class |

### 5.5 What is *not* in the daily workflow

- **DB-only processing** — V2 has none. Do not run V1's `process:*` commands.
- **Module refresh** — S-6 is not implemented.
- **Standings / squad ingestion** — no runner exists (§7.2).
- **Retention** — implemented in the database, no CLI calls it. Not needed at this volume.

---

## Phase 6 — Resume point: how V2 avoids reprocessing

There is **no watermark table and no resume file.** V2 determines what is already populated in three different ways, one per layer, each a property of the schema rather than of a bookkeeping record.

### 6.1 Ingestion — the identity decides

Nothing tracks "last ingested date". Every write is offered to the database and the constraint decides:

| Relation class | Second offer of the same fact |
|---|---|
| `competition`, `edition`, `stage`, `venue`, `team`, `fixture`, `result` | `ON CONFLICT DO UPDATE` with `COALESCE` — the row is refreshed, never duplicated, and a thinner payload cannot erase a known value |
| `fixture_lifecycle_transition`, `result_revision` | `ON CONFLICT DO NOTHING` on a named target — counted as skipped |
| `team_registration.registered_on` | immutable once set |

**So "today's ingestion" is not narrower than "the backfill" — it is the same operation over a smaller range.** The reason tomorrow's run is cheap is that it *asks for* one date, not that it detects 66 are already present. The provider call is spent either way; only the row churn differs.

### 6.2 Features — the business identity decides

`uq_feature_value__subject_context_definition_asof_version`, carrying `NULLS NOT DISTINCT` since migration 020:

```
(subject_kind_code, subject_team_id, subject_player_id, subject_fixture_id,
 subject_fixture_partition_on, subject_competition_edition_id,
 context_kind_code, context_competition_edition_id,
 feature_definition_id, as_of, feature_version_id)
```

A recalculated value for the same subject, context, definition, instant and version **conflicts and is skipped**. That is Replay B, and it is why the daily run can safely recompute a two-day lookback every night: the overlap costs skipped rows, not duplicates.

Lineage is the same shape — every column of its unique key is NOT NULL, so it was always correctly idempotent.

### 6.3 The driver — what the daily run actually selects

```
from = now − lookbackDays (default 2)
to   = now + maxOffset      (7 days — the largest snapshot point offset)
```

fixtures in that kickoff range, × 4 snapshot points, keeping only pairs where `as_of ≤ now`, de-duplicated into `(as_of, team)` batches and sorted ascending.

So tomorrow's run naturally re-examines the last two days and the next seven. **The re-examination is deliberate** — it is how a missed night self-heals — and it is free in rows because of §6.2.

### 6.4 The consequence for cutover

**Nothing needs to be told the backfill happened.** After Phase 3 completes, `npm run feature:v2` on any subsequent day recalculates its own window, conflicts on everything already written, and writes only what is genuinely new. There is no cursor to advance and none to get wrong.

---

## Phase 7 — Expected population

### 7.1 What will be populated

**These are shapes and how to measure them, not predictions.** Two facts make a numeric forecast impossible from the repository alone, and both matter:

> **There is no tracked-league filter in V2 ingestion.** V1 had `config/trackedLeagues.ts` (~61 leagues, ~76 teams). S-4 has **no equivalent** — verified: every event in the `/schedule/{date}` response is ingested. The V2 estate will therefore be *everything the provider returns worldwide for those 66 dates*, which is very likely an order of magnitude larger than V1's tracked set.

| Relation | Expected shape | Measure with |
|---|---|---|
| `competition` | every competition with a fixture in the window — global, unfiltered | `SELECT count(*) FROM football.competition;` |
| `competition_edition` | ≥ competitions; **more where the window crosses a season boundary** (2025/26 and 2026/27 both appear) | `SELECT count(*) FROM football.competition_edition;` |
| `competition_stage` | only where the feed reports a round; absent is left NULL, not invented | `SELECT count(*) FROM football.competition_stage;` |
| `venue` | one per distinct venue in the feed; only where the event carries a venue id | `SELECT count(*) FROM football.venue;` |
| `team` | both participants of every fixture | `SELECT count(*) FROM football.team;` |
| `team_registration` | one per (team, edition) pair observed | `SELECT count(*) FROM football.team_registration;` |
| `fixture` | one per event across 66 dates | `SELECT count(*), min(scheduled_kickoff_at), max(scheduled_kickoff_at) FROM football.fixture;` |
| `fixture_lifecycle_transition` | one per observed state change; historical dates arrive already COMPLETED, so typically **one per fixture** | `SELECT count(*) FROM football.fixture_lifecycle_transition;` |
| `result` | one per fixture the provider scored — for a historical window, close to the fixture count | `SELECT count(*) FROM football.result;` |
| `result_revision` | **near zero.** Only where a score changed between two observations; a single-pass backfill sees each score once | `SELECT count(*) FROM football.result_revision;` |

### Feature values — the arithmetic, and why the ceiling is not the answer

```
ceiling  =  fixtures × 2 teams × 4 snapshot points × 6 features
```

The actual number will be **far lower**, for three reasons, all of them the system behaving correctly:

1. **De-duplication by instant.** A team reaching the same `as_of` from two fixtures (K₁ − 1d = K₂ − 7d) collapses to one subject. Common in a congested schedule.
2. **Absence, not substitution (PD-07 / LC-05).** Every calculator emits *nothing* rather than a placeholder when history is missing — `formBackfill` returns null on an empty window, `travelLoad` skips when no distance can be computed, `teamReadiness` skips when no component is available. A team with no completed fixtures yet produces **no rows at all**.
3. **The window has almost no club football** (§8).

```sql
SELECT d.feature_key, count(v.*) AS values,
       count(*) FILTER (WHERE v.sample_meets_threshold) AS meets_threshold
  FROM feature.feature_definition d
  LEFT JOIN feature.feature_value v ON v.feature_definition_id = d.id
 GROUP BY 1 ORDER BY 1;
```

**Feature lineage:** only `team.readiness_score` has dependencies (two edges), so lineage rows ≈ 2 × readiness values. Every other feature has Layer 1 sources, not feature dependencies, and correctly produces no lineage.

### 7.2 What will intentionally remain **empty**

| Relation | Why | Fixable? |
|---|---|---|
| `football.player` | No runner calls `resolvePlayer` | Blocked on the orchestrator — [doc 29](./29-phase8-ingestion-orchestrator-plan.md) **B-1** |
| `football.player_registration` | `recordRegistration` exported, never called | as above |
| `football.player_availability` | `recordUnavailability`, `closeResolvedSpells` — never called | as above, and **B-2** must land first |
| `football.player_valuation` | `recordValuations` — never called | as above |
| `football.standing` | `recordStandings` — never called | as above |
| `football.lineup`, `lineup_selection`, `appearance`, `match_event` | Per-fixture endpoints, separate quota class — deferred by S-4 scope |  |
| `football.official`, `official_assignment` | Not in the schedule feed |  |
| `football.provider_statistic`, `position_profile` | Own cadence / no governed meaning until S-6 |  |
| `feature.feature_value` for `team.squad_stability` | **Deliberate.** Registered, never calculated (R-1) | Not a gap — a decision |
| Everything in `module`, `snapshot`, `calibration`, `product` projections | S-6 onward not implemented | docs 25–27 |

Confirm after the backfill:

```sql
SELECT 'player' t, count(*) FROM football.player
UNION ALL SELECT 'player_registration', count(*) FROM football.player_registration
UNION ALL SELECT 'player_availability', count(*) FROM football.player_availability
UNION ALL SELECT 'player_valuation', count(*) FROM football.player_valuation
UNION ALL SELECT 'standing', count(*) FROM football.standing;
-- all expected to be 0 — and their absence must not be read as a failed run
```

---

## Phase 8 — Risks specific to this window

### 8.1 The window is the close season — this is the dominant risk

2026-05-31 → 2026-08-04 is 66 days of which roughly 60 fall in the northern-hemisphere summer break. Domestic European leagues finished in late May 2026 and the 2026/27 season begins in August. The window is therefore dominated by international football, friendlies and pre-season, not by the club fixtures the six V2 features measure.

**All six features are club-form derived:**

| Feature | Window it needs | Threshold |
|---|---|---|
| `team.home_form`, `team.away_form` | 5 and 10 completed fixtures **on that side** | 5 |
| `team.congestion_index` | fixtures in the last 28 days | 3 |
| `team.rest_advantage` | ≥ 1 prior completed fixture | 1 |
| `team.travel_impact` | last 5 **away** fixtures with venue coordinates | 3 |
| `team.readiness_score` | rest + congestion, both present | 3 |

A club side with no completed fixture in the window produces **no feature values at all**. A side with two produces `rest_advantage` and possibly `congestion_index`, both with `sample_meets_threshold = false`.

### 8.2 The truncation is invisible to the calculator and visible in the data

`readCompletedFixtures` reads whatever is in `football.fixture`. With nothing before 2026-05-31, a fixture on 2026-06-05 sees a history of days, and the calculator cannot tell a short history from a short career.

**The schema does record it.** `sample_observation_count` is the real count and `sample_meets_threshold` is computed as `count >= meaningful_sample_threshold` — not asserted. So early-window values are written, correctly, and correctly marked as thin evidence.

**The operational consequence:** treat `sample_meets_threshold = false` as the expected state for most of this backfill, and track the ratio as the estate matures:

```sql
SELECT d.feature_key,
       count(*) AS values,
       round(100.0 * count(*) FILTER (WHERE v.sample_meets_threshold) / nullif(count(*),0), 1) AS pct_meeting
  FROM feature.feature_value v JOIN feature.feature_definition d ON d.id = v.feature_definition_id
 GROUP BY 1 ORDER BY 1;
```

### 8.3 Would more history materially improve feature quality? **Yes, decisively.**

| Start date | Dates | Calls | What it buys |
|---|---|---|---|
| **2026-05-31** (proposed) | 66 | 66 | Close season. Form windows mostly unfillable; most values below threshold |
| **2026-01-01** | 216 | 216 | Second half of 2025/26 — enough completed club fixtures to fill 5- and 10-match form windows for most European sides |
| **2025-07-01** | 400 | 400 | A full 2025/26 season plus the current one. Form, congestion and travel all fully evidenced from the first day of the new season |

**Recommendation: backfill from 2025-07-01, or at minimum 2026-01-01.** The marginal cost is provider calls and wall-clock time, both cheap and one-off. The alternative is a platform whose features read "insufficient evidence" for the first two to three months of the 2026/27 season, because a 10-fixture form window takes that long to fill from a standing start.

`travel_impact` is the sharpest case: it needs the last **five away** fixtures, which for a typical club is ten weeks of the season.

### 8.4 Executing a longer backfill

Beyond 200 dates the budget guard refuses, correctly. Two options:

```bash
# A — split across days, no override, guard stays armed  (preferred)
npm run ingest:v2 -- --from 2025-07-01 --to 2025-12-31    # 184 dates, day 1
npm run ingest:v2 -- --from 2026-01-01 --to 2026-08-04    # 216 dates → still over 200
                                                          # split again: to 2026-06-30, then the rest

# B — one run, guard disabled, knowingly borrowing tomorrow's quota
npm run ingest:v2 -- --from 2025-07-01 --to 2026-08-04 --allow-over-budget
```

**Prefer A.** The guard exists because discovering the overrun at call 201 leaves the range half-done with the next day's quota already spent. Splitting is free — ingestion is replay-safe, so overlapping the split boundary by a day costs one call and nothing else.

Then one feature replay over the whole span:

```bash
npm run feature:v2 -- replay --from 2025-07-01 --to 2026-08-04
npm run feature:v2
```

### 8.5 Other risks specific to this window

| Risk | Mechanism | Mitigation |
|---|---|---|
| **Season-boundary edition overlap** | `seasonPeriod` derives a bounded period from the provider's label: `2025/2026` → 2025-07-01…2026-07-01; a bare `2026` → 2026-01-01…2027-01-01; no parseable label → derived from the kickoff. `ex_competition_edition__periods_do_not_overlap` **rejects an overlap**, aborting that date's whole transaction. The window spans exactly the mid-year point where calendar-year leagues (MLS, Scandinavian, Brazilian) and split-season leagues diverge | Watch for a failure naming that constraint. Re-run the date after the label situation is understood — **do not** work around it in application code |
| **Global, unfiltered estate** | No tracked-league filter (§7.1). Row counts and feature volume may be much larger than V1 | Measure after the backfill. If the estate is unmanageable, the filter is a scope decision for the architecture owner, not an ingestion change |
| **Editions with no provider season id** | `competition_edition.provider_external_id` is nullable and comes from `season.id`, which the provider does not always send | Harmless now; blocks standings ingestion later — doc 29 **B-5** |
| **Unmapped countries** | `mapCountry` refuses rather than inventing a code; the row is counted as rejected. A worldwide estate will hit countries outside the 51 seeded | Expect `rejected > 0`. Add codes to `vocabulary.ts` under governance, re-seed, re-ingest the affected dates |
| **`UNKNOWN` lifecycle states** | An unmapped provider status maps to `UNKNOWN` with `is_open = false` — the guard protecting by default | Count them (check 2). A large share means the status mapping needs review before the season starts |
| **Partition coverage** | `feature_value` is monthly; a run crossing into a month with no partition lands in `pdefault` | Check 4, and `quality_check.default_partition_empty` is registered HIGH/hourly |
| **Re-running the backfill costs 66 calls** | The provider is paid before the database can say it already had the row | Re-run only failed dates |

---

## Command summary

```bash
cd /path/to/soccer/beta/backend

# ── Phase 1 ──────────────────────────────────────────────────────────────────
npm install && npm run build
npm run seed:v2                                              # expect 146 / already present

# ── Phase 2 ── 66 calls, 5–20 min, no --allow-over-budget needed ────────────
npm run ingest:v2 -- --from 2026-05-31 --to 2026-08-04 2>&1 | tee backfill.log

# ── Phase 3 ──────────────────────────────────────────────────────────────────
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04 --dry-run
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04
npm run feature:v2                                           # forward window

# ── Phase 4 ──────────────────────────────────────────────────────────────────
npm run feature:v2 -- verify                                 # expect 4 × PASS
npm run feature:v2 -- replay --from 2026-05-31 --to 2026-08-04   # Replay B: 0 written
#   plus the thirteen SQL checks in §4

# ── Phase 5 — daily, thereafter ─────────────────────────────────────────────
npm run ingest:v2 -- --from "$(date -u -d yesterday +%F)" --to "$(date -u -d tomorrow +%F)"
npm run feature:v2
```
