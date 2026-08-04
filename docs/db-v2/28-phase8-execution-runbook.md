# PitchTerminal V2 — Execution Procedure Audit & Operator Runbook

**Read-only audit. No code was modified.** Every command below is implemented in this repository; none is invented.

---

## 0. What actually exists — read this before anything else

Three findings shape the whole procedure. All three are verified by inspection, not inferred.

### E-1 — There are exactly three V2 entrypoints

`grep -rn 'require.main === module' src/ --include='*.ts'`, tests excluded, returns three files:

```
src/v2/seed/runAll.ts:194
src/v2/ingestion/cli.ts:89
src/v2/feature/cli.ts:140
```

and `package.json` registers exactly three V2 scripts:

```json
"seed:v2":    "tsx src/v2/seed/runAll.ts",
"ingest:v2":  "tsx src/v2/ingestion/cli.ts",
"feature:v2": "tsx src/v2/feature/cli.ts"
```

There is **no `bin` entry**, no migration runner, and no orchestrating script for V2.

### E-2 — `src/cli.ts` is V1 and must never be pointed at a V2 database

It is 1,745 lines exposing **119 commands**. It imports nothing from `src/v2/` — verified: `grep -rn "from './v2" src/cli.ts` returns nothing. It writes the V1 `public` schema through `supabase-js` with `SUPABASE_SERVICE_KEY`, which is precisely the bypass V2 forbids. `beta/scripts/rip-daily-v2.sh` is likewise V1 — the "v2" in its name is the script's own version, and it invokes V1 commands such as `sync:squads:v2`.

**It is listed in §3 for completeness and appears nowhere in the runbook.**

### E-3 — Only one ingestion job exists, and it is not the whole of S-4

`ingestSchedule` is the single exported runner, and it calls exactly one stage: `ingestScheduleDate`.

`src/v2/ingestion/entities/squad.ts` and `entities/standings.ts` are implemented, exported from `index.ts`, and covered by tests — **and called by no pipeline, no stage and no CLI.** Verified: the only importers of either module are `index.ts` itself.

**Consequence for an operator.** After a complete, successful V2 population these relations will hold **zero rows**, and nothing will report an error:

```
football.player               football.player_registration
football.player_availability   football.player_valuation
football.standing
```

The S-4 README lists them under "Scope: In", and that is accurate about the *writers*. It is not accurate about what any command runs. Nothing in Layer 2 depends on them today — the six S-5 features source only `fixture`, `result`, `venue` and `team` — so this does not block feature calculation. It does mean squad, availability, valuation and standings data does not exist in V2 and cannot be obtained by running anything.

---

## 1. Overall execution order

```
  0. PLATFORM PREREQUISITES        PostgreSQL 16, extensions, network
        ↓  roles must exist before grants can attach to them
  1. MIGRATIONS 001 → 020          psql, sequential, one transaction per file
        ↓  roles are NOLOGIN; nothing can authenticate yet
  2. GRANT LOGIN + PASSWORDS       out of band, by the database owner
        ↓  four roles must authenticate before the seed can open its connections
  3. SEED           npm run seed:v2
        ↓  vocabularies must exist before ingestion writes FK-bearing columns
  4. INGESTION      npm run ingest:v2
        ↓  fixtures and results must be committed before features can read them
  5. FEATURES       npm run feature:v2
        ↓
  6. VERIFY         npm run feature:v2 -- verify   +   the SQL in §7
```

### Why each step must precede the next

**0 → 1.** Migration 001 creates extensions (`btree_gist` among them), the seven schemas and the nine roles. Migration 016 attaches every grant and policy by role name. A grant cannot reference a role that does not exist, and privileges are applied last *deliberately* so no window exists in which an object is reachable without its policies.

**1 → 2.** Migration 001 creates all roles **`NOLOGIN`**, with credentials deferred to a secure channel outside version control — a migration file is not a place for a credential. `requireCredential()` fails with the exact variable name to set. **Nothing in this repository performs step 2.** Until an operator does it manually, every V2 command fails at pool construction.

**2 → 3.** The seed opens four connections as four different roles, because migration 016 assigns writes by *layer*: `pt_pipeline_ingestion` is the only role with INSERT on `football`, `pt_platform_admin` the only one on `product`, `pt_pipeline_feature` on `feature`, `pt_pipeline_module` on `module`. A single "seed role" would be a principal broader than any pipeline.

**3 → 4. This is a hard dependency, not a soft one.** `mapCountry` resolves a provider country name to a seeded ISO code and the writers put it in `competition.country_code`, `venue.country_code`, `team.country_code` — each a foreign key onto `football.country`. Ingesting before seeding raises a foreign-key violation on the first competition whose country maps. Seeding also runs `verifyMigrationVocabularies` first, which turns a missing migration-seeded code into a named error rather than an FK failure discovered halfway through a registry write.

**4 → 5.** `readFixturesForEligibility` selects from `football.fixture` where `lifecycle_state_code IN ('SCHEDULED','IN_PROGRESS','COMPLETED')`; `readCompletedFixtures` requires `lifecycle_state_code = 'COMPLETED'` joined to `football.result`. With no fixtures the pipeline derives its plan, reports zero batches and writes nothing. **It succeeds and does nothing** — which is exactly the silent-success state `operations.write_record` exists to expose.

**Within 5**, Stage 2 cannot begin until Stage 1 has committed: `team.readiness_score` reads its inputs back through `feature.feature_value` on a different connection, and an uncommitted row is invisible there.

**5 → 6.** The four verification controls read `feature.feature_value`; running them before values exist reports four vacuous passes.

### The step that does not exist

**There is no "DB-only processing" phase in V2.** See §5.

---

## 2. Exact terminal commands

All V2 commands run from `beta/backend`.

```bash
# ── one-time setup ────────────────────────────────────────────────────────────
cd /path/to/soccer/beta/backend
npm install

cp .env.v2.example .env          # then edit: connection + the credentials you need

# ── migrations (no runner exists — psql, in order, one transaction per file) ──
cd /path/to/soccer/v2/migrations
for f in 0*.sql; do
  case "$f" in *rollback*) continue;; esac
  echo "== $f"
  psql "$PT_V2_ADMIN_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$f" || break
done

# ── grant LOGIN and passwords — MANUAL, as the database owner ────────────────
# Not implemented anywhere in this repository. See §7 step 3.

# ── bootstrap ────────────────────────────────────────────────────────────────
cd /path/to/soccer/beta/backend
npm run seed:v2

# ── ingestion ────────────────────────────────────────────────────────────────
npm run ingest:v2                                          # today, UTC
npm run ingest:v2 -- --date 2026-08-04                     # one date
npm run ingest:v2 -- --from 2026-08-01 --to 2026-08-07     # a range
npm run ingest:v2 -- --from 2025-08-01 --to 2026-05-31 --allow-over-budget

# ── features ─────────────────────────────────────────────────────────────────
npm run feature:v2                                         # = calculate
npm run feature:v2 -- calculate --dry-run
npm run feature:v2 -- calculate --lookback-days 7
npm run feature:v2 -- replay --from 2026-08-01 --to 2026-08-31
npm run feature:v2 -- verify

# ── tests ────────────────────────────────────────────────────────────────────
npm test                                                   # no database needed
PT_V2_DB_HOST=… npm test                                   # + persistence tests
npm run build                                              # tsc
```

`$PT_V2_ADMIN_URL` is a connection string for a role that owns the objects — the migration/owner principal, **not** one of the seven pipeline roles. The repository does not name it; supply your own.

---

## 3. CLI reference

### 3.1 `npm run seed:v2` → `src/v2/seed/runAll.ts`

| | |
|---|---|
| **Commands** | none — a single unconditional action |
| **Arguments** | none. `main()` takes no `argv` and parses nothing |
| **Flags** | none |
| **Roles required** | `pt_pipeline_ingestion`, `pt_platform_admin`, `pt_pipeline_feature`, `pt_pipeline_module` — all four, asserted at start |
| **Exit code** | 0 on success; `process.exit(1)` on any error |

**Undocumented surface.** `runAllSeeds({ attributed?: boolean })` is exported and accepts one option — `attributed: false` skips installing the S-2 operational layer. **It is not reachable from the CLI**; only tests pass it.

### 3.2 `npm run ingest:v2` → `src/v2/ingestion/cli.ts`

| Flag | Value | Default | Meaning |
|---|---|---|---|
| `--date` | `YYYY-MM-DD` | — | One UTC date. Sets both `from` and `to`; **overrides both** |
| `--from` | `YYYY-MM-DD` | today (`new Date()`) | First UTC date, inclusive |
| `--to` | `YYYY-MM-DD` | the value of `--from` | Last UTC date, inclusive |
| `--allow-over-budget` | boolean | absent → guard **on** | Permit a range longer than the daily quota |

**Parser behaviour, exactly as implemented:**
- Any `--flag` other than `--allow-over-budget` consumes the next token. A flag followed by another `--flag`, or by nothing, throws `"<flag> expects a value."`
- Dates are matched against `/^\d{4}-\d{2}-\d{2}$/` and parsed as `T00:00:00Z`.
- `--to` earlier than `--from` throws `"--to precedes --from."`
- **Unrecognised flags are accepted and silently ignored** — they are stored in the map and never read. `--dry-run` is *not* a flag here; passing it consumes the following token and does nothing.
- Positional arguments are ignored entirely.

**Budget guard:** refuses when `dates.length > keys × PT_V2_PROVIDER_DAILY_QUOTA` (default 2 × 100 = 200) unless `--allow-over-budget`.

**Exit code:** 1 if any date failed *or* on a thrown error; 0 otherwise. A run with failures still completes the remaining dates.

**Examples**

```bash
npm run ingest:v2
npm run ingest:v2 -- --date 2026-08-04
npm run ingest:v2 -- --from 2026-08-01 --to 2026-08-07
npm run ingest:v2 -- --from 2025-08-01 --to 2026-05-31 --allow-over-budget
```

### 3.3 `npm run feature:v2` → `src/v2/feature/cli.ts`

| Command | Default | Purpose |
|---|---|---|
| `calculate` | **yes** — the first positional, or `calculate` if absent | Forward run from now |
| `replay` | | Explicit kickoff range. **Same pipeline**, only the driver range differs |
| `verify` | | The four temporary verification controls |

Any other positional throws `"unknown command '<x>'. Expected calculate, replay or verify."`

| Flag | Applies to | Default | Meaning |
|---|---|---|---|
| `--dry-run` | `calculate`, `replay` | off | Compute and report; write nothing |
| `--lookback-days` | `calculate` **only** | `2` | How far back kicked-off fixtures stay eligible |
| `--from` | `replay` — **required** | — | Inclusive kickoff range start |
| `--to` | `replay` — **required** | — | Inclusive kickoff range end |

**Parser behaviour:**
- `replay` without both `--from` and `--to` throws — defaulting the range would let a scheduled run drift into a historical replay.
- `--lookback-days` is passed through `Number()` with **no validation**: `--lookback-days abc` yields `NaN`, which makes the lookback window `NaN` and the eligibility range comparison throw `"the eligibility range ends before it begins"`.
- `--from`/`--to` are parsed but **ignored** under `calculate`.
- Unrecognised flags consume their value and are ignored.

**Roles:** `calculate`/`replay` assert `pt_pipeline_feature` only. **`verify` runs as `pt_platform_admin`** and does *not* call `assertRolesConfigured`, so a missing `PT_V2_DB_PASSWORD_ADMIN` surfaces at pool construction rather than as a startup message.

**Exit code:** 1 if any batch failed, or if any verification control fails; 0 otherwise.

**Undocumented surface.** `runFeaturePipeline` accepts two options the CLI never sets: `declare` (default true — writes `feature_source`/`feature_dependency`) and `now` (overrides the run clock; tests only).

### 3.4 `npm run cli` → `src/cli.ts` — **V1 ONLY**

119 commands. Writes the V1 `public` schema through `supabase-js`. **Not part of the V2 procedure and must not be run against a V2 database.** Grouped by prefix:

| Prefix | Count | Examples |
|---|---|---|
| `sync:*` | 31 | `sync:tournaments`, `sync:seasons`, `sync:schedule <date>`, `sync:today`, `sync:range <from> <to>`, `sync:standings`, `sync:squads:v2`, `sync:transfers`, `sync:images` |
| `process:*` | 78 | `process:all-db`, `process:all-db:range`, `process:match-intelligence:*`, `process:form:backfill`, `process:travel-load`, `process:match-weather`, … |
| `archive:*` | 5 | `archive:readiness-snapshot`, `archive:link-results`, … |
| `backtest:*` | 2 | `backtest:signals`, `backtest:bands` |
| other | 3 | `analytics:refresh-league-gap`, `verify:historical-integrity`, `sample:bands` |
| help | 3 | `help`, `--help`, `-h` |

**Undocumented in its own help:** the header comment documents **8** commands; 116 are undocumented there. `process:injury-risk` is registered but removed — it logs an error and exits, because it targeted a SQL view that cannot be written.

---

## 4. API ingestion order

**One job. One provider call per date.**

| Job | `ingest.schedule` |
|---|---|
| **Endpoint** | `GET /schedule/{date}`, cost class `FEED` |
| **Downloads** | Every fixture for one UTC date, with nested competition, season, round, venue, both teams, status and scores |
| **Depends on** | The seed (§1, "3 → 4"); nothing else |
| **Calls the provider** | Yes — exactly once per date |
| **Transaction** | One per date. A failed date rolls back entirely and the run continues to the next |
| **Replay-safe** | **Yes** |

**Relations written, in the order the reference graph forces** — this order is the resolution sequence inside `ingestScheduleDate`, not a preference:

| # | Relation | Duplicate handling |
|---|---|---|
| 1 | `football.competition` | upsert, `COALESCE` on every updated column |
| 2 | `football.competition_edition` | upsert |
| 3 | `football.competition_stage` | upsert — skipped when the feed reports no round |
| 4 | `football.venue` | upsert — skipped when the event has no venue |
| 5 | `football.team` ×2 | upsert |
| 6 | `football.team_registration` ×2 | upsert |
| 7 | `football.fixture` | upsert |
| 8 | `football.fixture_lifecycle_transition` | append-only, `DO NOTHING` |
| 9 | `football.result` | upsert; a changed score appends `football.result_revision` |

**Why replay-safe.** Mutable-identity relations upsert with `COALESCE(EXCLUDED.col, target.col)`, so a thinner payload never erases a known value. Append-only relations use `ON CONFLICT … DO NOTHING` against a named target. There is no delete path anywhere — `pt_pipeline_ingestion` holds no `DELETE` on any `football` relation.

**Quota is flushed on the control connection**, outside the work transaction, after every date. A rolled-back date still records what it spent, because the provider charged for the call regardless.

### Endpoints registered but never called

Nine endpoints are registered in `provider/endpoints.ts`; **one is called.**

| Endpoint | Cost class | Called by any runner? |
|---|---|---|
| `schedule` | FEED | **yes** |
| `tournaments`, `seasons` | DISCOVERY | no |
| `team_squad`, `team_players`, `team_transfers`, `season_standings`, `tournament_team_events`, `team_events_last`, `team_events_next` | PER_ENTITY | no |

Two image paths are in `DELIBERATELY_NOT_INGESTED` — registered so their absence is a recorded decision. The other eight are registered with no runner (finding E-3).

---

## 5. DB-only processes

**There are none in V2, and this is not an omission to work around.**

V1 has 78 `process:*` commands that read V1 tables and write V1 tables. V2 has **zero** equivalent commands. The transformation from Layer 1 (reality) to Layer 2 (features) *is* the feature pipeline, and it is the only database-to-database process that exists.

Two V2 processes are database-only in the sense of issuing no provider call, and both are sub-steps rather than commands:

| Process | Input | Output | Runs as | Order | Replay |
|---|---|---|---|---|---|
| **Registry declaration** — `declareRegistryInputs` | `FEATURE_SOURCES`, `FEATURE_DEPENDENCIES` (source constants) + the loaded registry | `feature.feature_source`, `feature.feature_dependency` | `pt_pipeline_feature` | first, inside `feature:v2 calculate`; **skipped when `--dry-run`** | Additive, `ON CONFLICT DO NOTHING`. Second run writes 0 |
| **Feature calculation** | `football.fixture`, `result`, `venue`, `team`, and `feature.feature_value` for Stage 2 | `feature.feature_value`, `feature.feature_lineage` | `pt_pipeline_feature` | after declaration | **Zero rows on a second run** |

**Do not substitute V1's `process:*` jobs.** They write `public` tables that no V2 relation references, using the service key. Running them changes nothing in V2 and reintroduces the bypass V2 is built to remove.

---

## 6. Feature pipeline

### Execution order — derived, never written down

There is no ordered list of calculators in the subsystem. `deriveExecutionPlan` reads `feature.feature_dependency` and topologically sorts it (Kahn), ties broken by `calculator_key` ascending. Declaring a new edge changes the order *by being declared*.

With the two edges S-5 declares — `team.readiness_score` consumes `team.rest_advantage` and `team.congestion_index` — the derived plan is:

```
Stage 1   fixture_load + form_backfill + travel_load     (alphabetical within the stage)
   ↓ commit
Stage 2   team_readiness
```

### Full sequence

```
assertRolesConfigured(['pt_pipeline_feature'])
installOperationalLayer()
now = new Date()                     ← ONE clock read for the whole run
  │
  ├─ withConnection: loadRegistry → assertCalculatorCoverage → deriveExecutionPlan → selectBatches
  ├─ withRun 'feature.declare'   → feature_source, feature_dependency        (skipped on --dry-run)
  └─ withPipelineRun 'v2.feature.calculate'
       for each stage (sequential)
         for each calculator in the stage (sequential — D-5)
           for each subject batch (sequential)
             withRun 'feature.<calculator>'   ← ONE TRANSACTION
                buildContext  → readCompletedFixtures, readHomeVenues,
                                 readVenueLocations, readPriorValues
                calculate     → pure; no clock, no database
                writeValues   → feature.feature_value      (single rounding boundary)
                writeLineage  → feature.feature_lineage    (forced after values by the FK)
                reportWrites  → operations.write_record on the CONTROL connection
```

### Calculators — four, producing six features

| Calculator | Features | Stage |
|---|---|---|
| `form_backfill` | `team.home_form`, `team.away_form` | 1 |
| `fixture_load` | `team.rest_advantage`, `team.congestion_index` | 1 |
| `travel_load` | `team.travel_impact` | 1 |
| `team_readiness` | `team.readiness_score` | 2 |

`team.squad_stability` is registered and **never calculated** (R-1): no calculator, no `feature_source` row, no values.

`assertCalculatorCoverage` fails the run if the registry names a calculator the code does not implement, or vice versa.

### Driver

`as_of` is derived arithmetically: `deriveAsOf(kickoffAt, offsetSeconds)` = `kickoff − offset`, **truncated to whole seconds** so it round-trips without loss (ER-01). Offsets are read from `football.snapshot_point`, never hard-coded — an empty snapshot-point table throws:

> `no snapshot points are in force. as_of is derived from football.snapshot_point, and S-5 cannot select any subject without it.`

A pair is eligible only when `as_of <= now`. **This is the only wall-clock read for selection in the entire subsystem**, and the clock is captured once per run. Forward mode covers `now − lookback` … `now + maxOffset`; replay covers the given kickoff range. Batches are keyed by instant, teams de-duplicated and sorted numerically ascending.

### Writers

`write/values.ts` is the **single rounding boundary** — half-up, at the write, once. `feature_value.value` never sees a JavaScript `number`; arithmetic is exact on `{units: bigint, scale}`. `write/provenance.ts` applies `min(registry ceiling, weakest lineage input)` and `sample_observation_count = MIN(consumed)`.

Every `ON CONFLICT` names its target constraint. A bare `DO NOTHING` would swallow the version/definition binding, subject exclusivity and the context obligation.

### Verification

`npm run feature:v2 -- verify` runs four **temporary** controls, read-only as `pt_platform_admin`:

| Control | Stands in for | Severity |
|---|---|---|
| `feature_dependency_acyclic` | the registered check, unimplemented | **BLOCKING** |
| `feature_scale_conformance` | the registered check, unimplemented | HIGH |
| `orphan_absence` | the registered check, unimplemented | HIGH |
| `provenance_propagation` | the A.12 trigger, which cannot fire (S5-1), and the registered check | HIGH |

Every result carries `temporary: true` and a `standsInFor` string. Delete the module — do not extend it — when those assertions exist in the database.

### Replay guarantees

| | |
|---|---|
| **Replay A** — two clean runs over identical reality produce identical output | **Passes.** `calculated_at` is the only permitted difference |
| **Replay B** — a second run over unchanged reality writes **zero** rows | **Passes.** Enforced by `uq_feature_value__subject_context_definition_asof_version`, which carries `NULLS NOT DISTINCT` since migration 020 |

Determinism rests on six obligations: total `ORDER BY` on every input query, exact arithmetic, one rounding boundary, a deterministic topological sort, arithmetically derived `as_of`, and no wall clock inside a calculator (enforced by a source scan in the test suite).

---

## 7. Fresh database checklist

> Steps 1–3 are **not implemented in this repository**. They are performed by an operator with owner privileges.

**1. Platform prerequisites**

```bash
psql "$PT_V2_ADMIN_URL" -c "SELECT version();"
```
*Expect:* `PostgreSQL 16.x`. Migration 001 creates `btree_gist`; the role running it needs privilege to do so.

**2. Apply migrations 001 → 020, in order, each in its own transaction**

```bash
cd /path/to/soccer/v2/migrations
for f in 0*.sql; do
  case "$f" in *rollback*) continue;; esac
  echo "== $f"
  psql "$PT_V2_ADMIN_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$f" || break
done
```
*Expect:* every file completes with no `ERROR`. Migrations 016 and 018 close with assertions that **raise** rather than report.

*Verify:*
```sql
SELECT count(*) FROM information_schema.schemata
 WHERE schema_name IN ('football','feature','module','snapshot','calibration','product','operations');
-- expect 7

SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();
-- both return without raising
```

**3. Grant LOGIN and passwords — MANUAL**

Migration 001 creates every role `NOLOGIN`. Nothing in this repository grants login.

```sql
ALTER ROLE pt_pipeline_ingestion LOGIN PASSWORD '…';
ALTER ROLE pt_platform_admin     LOGIN PASSWORD '…';
ALTER ROLE pt_pipeline_feature   LOGIN PASSWORD '…';
ALTER ROLE pt_pipeline_module    LOGIN PASSWORD '…';
```
*Verify:* `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname LIKE 'pt\_%' ORDER BY 1;`

**4. Install dependencies and configure the environment**

```bash
cd /path/to/soccer/beta/backend
npm install
cp .env.v2.example .env      # then edit
```

Required: `PT_V2_DB_HOST`, `PT_V2_DB_NAME`, plus `PT_V2_DB_PASSWORD_{INGESTION,ADMIN,FEATURE,MODULE}`. For ingestion also `PT_V2_PROVIDER_BASE_URL` and `PT_V2_PROVIDER_KEY`. `PT_V2_DB_PORT` defaults to 5432 and **6543 is refused outright**.

*Verify:* `npm run build` — *expect* `tsc` to exit 0.

**5. Seed**

```bash
npm run seed:v2
```
*Expect:*
```
v2 seed complete: 146 inserted, 0 already present
  football.currency                             + 14  (0 present)
  football.country                              + 51  (0 present)
  …
```
**146, not 119.** The S-3 report and README both state 119 with 24 countries. S-4 extended `COUNTRIES` from 24 to **51** to cover the tracked leagues (`vocabulary.ts` — verified: 14 currencies, 51 countries, 11 positions), so the total is 119 + 27 = **146**. Confirmed against a seeded database. The two documents were written before that extension and were not updated.

Twelve relations: currency 14 · country 51 · position 11 · entitlement_feature 13 · feature_calculator 5 · feature_definition 7 · feature_definition_context_kind 10 · feature_version 7 · verdict_composition_version 1 · consensus_rule_version 1 · module_definition 13 · module_version 13.

*Verify:*
```sql
SELECT (SELECT count(*) FROM football.currency)                    AS currency,
       (SELECT count(*) FROM football.country)                     AS country,
       (SELECT count(*) FROM football.position)                    AS position,
       (SELECT count(*) FROM product.entitlement_feature)           AS entitlement,
       (SELECT count(*) FROM feature.feature_definition)            AS feature_def,
       (SELECT count(*) FROM module.module_definition)              AS module_def;
-- expect 14, 51, 11, 13, 7, 13
```

**6. Confirm idempotence before going further**

```bash
npm run seed:v2
```
*Expect:* `v2 seed complete: 0 inserted, 146 already present`. If anything is re-inserted, stop — the seed is not idempotent against this database and every downstream guarantee is in doubt.

**7. Ingest**

```bash
npm run ingest:v2 -- --date 2026-08-04
```
*Expect:*
```
v2 ingestion complete: 1 date(s), 1 provider call(s), 0 failure(s)
  examined     …
  written      …
  skipped      …
  rejected     …
```
*Log line:* `v2 ingestion: schedule date processed`.

*Verify:*
```sql
SELECT count(*) FROM football.fixture;
SELECT target_schema_name, target_relation_name, rows_written, rows_skipped, rows_rejected
  FROM operations.write_record ORDER BY target_relation_name;
SELECT endpoint_key, sum(request_count) FROM operations.api_usage GROUP BY 1;
```
A relation appearing with `rows_written = 0` is the signal `write_record` exists to give.

**8. Backfill enough history for the features to be meaningful**

`form_backfill` normalises over five- and ten-fixture windows; `travel_load` over the last five away fixtures; `fixture_load` over a 28-day window. A single date produces values on very thin evidence.

```bash
npm run ingest:v2 -- --from 2026-05-01 --to 2026-08-04 --allow-over-budget
```
*Expect:* one provider call per date. At 200 calls/day of budget, 96 dates is roughly half a day's quota — the guard will refuse without `--allow-over-budget` for any range over 200 days.

**9. Dry-run the feature pipeline**

```bash
npm run feature:v2 -- calculate --dry-run
```
*Expect:*
```
v2 feature DRY RUN complete: N batch(es), 0 failure(s)
  stages: fixture_load + form_backfill + travel_load  ->  team_readiness
  order:  fixture_load -> form_backfill -> travel_load -> team_readiness   (derived from feature_dependency)
  feature.feature_value        examined …  written      0  skipped …
```
`written 0` is correct — a dry run writes nothing and skips everything.

**10. Calculate**

```bash
npm run feature:v2
```
*Expect:* the same stage and order lines, with non-zero `written` on `feature.feature_value` and `feature.feature_lineage`, and `feature.feature_source` / `feature.feature_dependency` written on the first run only (**9** sources, **2** dependencies — one source row per (feature, relation) pair: `home_form` and `away_form` cite `fixture` and `result`, `rest_advantage` and `congestion_index` cite `fixture`, `travel_impact` cites `fixture`, `venue` and `team`).

*Verify:*
```sql
SELECT d.feature_key, count(*), min(v.as_of), max(v.as_of)
  FROM feature.feature_value v
  JOIN feature.feature_definition d ON d.id = v.feature_definition_id
 GROUP BY 1 ORDER BY 1;
-- expect six keys; team.squad_stability must be ABSENT

SELECT count(*) FROM feature.feature_source;      -- expect 9
SELECT count(*) FROM feature.feature_dependency;  -- expect 2
```

**11. Prove Replay B**

```bash
npm run feature:v2
```
*Expect:* every `written` count is **0** and `skipped` equals `examined`. A non-zero write here means duplicate detection is not working.

**12. Verify**

```bash
npm run feature:v2 -- verify
```
*Expect:*
```
v2 feature verification — TEMPORARY IMPLEMENTATION CONTROLS
  PASS  feature_dependency_acyclic       0 violation(s)
  PASS  feature_scale_conformance        0 violation(s)
  PASS  orphan_absence                   0 violation(s)
  PASS  provenance_propagation           0 violation(s)
```
Requires `PT_V2_DB_PASSWORD_ADMIN`.

**13. Operational health**

```sql
SELECT * FROM operations.v_freshness ORDER BY 1;
SELECT * FROM operations.v_coverage  ORDER BY 1;
SELECT * FROM operations.v_pipeline_run_current;
SELECT f.occurred_at, f.failure_class_code, f.message
  FROM operations.failure f ORDER BY f.occurred_at DESC LIMIT 20;
```

---

## 8. Daily production run

Three phases, in this order, each finishing before the next begins.

### Phase A — API syncs (provider calls; quota-bound)

```bash
cd /path/to/soccer/beta/backend
npm run ingest:v2
```

One call. Ingests today's UTC schedule: new fixtures, lifecycle transitions, and results for anything that finished.

To also refresh yesterday's late results and tomorrow's fixture list — three calls, still far inside budget:

```bash
npm run ingest:v2 -- --from "$(date -u -d yesterday +%F)" --to "$(date -u -d tomorrow +%F)"
```

### Phase B — DB-only processes

**None exist.** See §5. Do not run V1's `process:*` commands.

### Phase C — Feature calculation

```bash
npm run feature:v2
```

The two-day default lookback means a missed day is picked up by the next run without intervention. Re-running is idempotent.

### Weekly

```bash
npm run feature:v2 -- verify
```

and review `operations.v_freshness` for a relation whose last write is older than its cadence — the check that catches a job succeeding while writing nothing.

### Ordering constraint

Phase C must not overlap Phase A. Features read `football.fixture` and `football.result` inside their own transactions; a concurrent ingestion commit mid-run would let one batch see a fixture another did not, and both would be labelled with the same `as_of`.

---

## 9. Failure recovery

### Replay-safe — rerun freely

| Command | Why |
|---|---|
| `npm run seed:v2` | Every statement is `INSERT … ON CONFLICT (<named target>) DO NOTHING`. No update, no upsert, no delete path exists or may be added |
| `npm run ingest:v2` for any date | Upsert with `COALESCE`; append-only with `DO NOTHING`; temporal succession re-reads the open spell. No delete path exists |
| `npm run feature:v2` | Replay B: a second run over unchanged reality writes zero rows |
| `npm run feature:v2 -- replay --from … --to …` | Same code path as forward operation |
| `npm run feature:v2 -- verify` | Read-only |

### Never rerun

| | |
|---|---|
| **Migrations already applied** | The set is a sequential first-run deployment. Re-running a later migration against a populated database is not a supported operation. **Migration 020 in particular rebuilds indexes on every partition** — cheap while empty, not cheap later |
| **`020_null_distinct_identities.rollback.sql`** | Only to undo 020 deliberately. Applying it reinstates the defect where a duplicate feature value cannot be detected |
| **V1 `process:*` / `sync:*` against a V2 database** | They write the `public` schema with the service key. Nothing in V2 is touched and the bypass is reintroduced |

### Per-failure response

| Failure | Rerun | Notes |
|---|---|---|
| Seed fails mid-stage | `npm run seed:v2` | Each stage is one transaction and rolls back entirely; earlier stages stay committed. Re-running skips them |
| `Missing credentials for: …` | Fix `.env`, rerun | Named by the assertion. Nothing was written |
| `PT_V2_DB_PORT is 6543 … TRANSACTION POOLER` | Set 5432, rerun | Session mode is required — the retention marker and timeout settings are session-scoped |
| One date fails during a range | `npm run ingest:v2 -- --date <that date>` | That date rolled back; the rest of the range committed. The run already exited 1 |
| Provider 404 for a date | Nothing | Logged at `warn` as "provider has no schedule for this date". Counted as a failure and reflected in the exit code |
| Provider 429 / quota exhausted | Wait for the window, rerun the missing dates | Usage is flushed on the control connection, so the record survives the rollback and the next run sees the true budget |
| A feature batch fails | `npm run feature:v2` | That batch's transaction rolled back; the run continued. The next run recalculates it and skips everything already written |
| `no snapshot points are in force` | Fix the database, then rerun | `football.snapshot_point` is migration-seeded. An empty table means the migrations did not complete |
| `assertCalculatorCoverage` fails | **Do not rerun** — investigate | The registry and the code disagree about which calculators exist. Either the seed is wrong or the deployed code is |
| `verify` reports `feature_dependency_acyclic` violations | **Stop.** Manual intervention | BLOCKING severity. A cycle in `feature_dependency` means the derived order is not a valid order |
| Replay B writes non-zero rows | **Stop.** Manual intervention | Duplicate detection is not working. Confirm migration 020 is applied: `SELECT count(*) FROM pg_constraint WHERE contype='u' AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%';` — expect 7 |

### Requires manual intervention — always

- **Granting LOGIN and passwords.** Not implemented anywhere.
- **Applying migrations.** No runner exists.
- **Adding a country, currency or position code.** Ingestion never creates vocabulary rows. An unmapped country is counted and logged; the fix is to add the code to `src/v2/seed/vocabulary.ts` under governance and rerun the seed.
- **A rejected currency.** The one mapping that refuses the row rather than substituting, because `minor_unit` makes a wrong currency wrong by orders of magnitude.
- **Retention.** `operations.fn_run_retention()` must be called as `pt_retention` in a session with the R-21 marker set. `withSession` supports it; **no CLI calls it.**

---

## 10. Operator runbook

### Bring up an empty V2 database

```bash
# 1. migrations — as the owner role, sequential, one transaction per file
cd /path/to/soccer/v2/migrations
for f in 0*.sql; do
  case "$f" in *rollback*) continue;; esac
  echo "== $f"
  psql "$PT_V2_ADMIN_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$f" || break
done

# 2. grant login — MANUAL, not implemented in this repository
#    ALTER ROLE pt_pipeline_ingestion LOGIN PASSWORD '…';   (and _admin, _feature, _module)

# 3. application
cd /path/to/soccer/beta/backend
npm install
cp .env.v2.example .env      # edit: PT_V2_DB_HOST, PT_V2_DB_NAME,
                             # PT_V2_DB_PASSWORD_{INGESTION,ADMIN,FEATURE,MODULE},
                             # PT_V2_PROVIDER_BASE_URL, PT_V2_PROVIDER_KEY

# 4. seed          expect: 146 inserted
npm run seed:v2

# 5. seed again    expect: 0 inserted, 146 already present
npm run seed:v2

# 6. history       one provider call per date
npm run ingest:v2 -- --from 2026-05-01 --to 2026-08-04 --allow-over-budget

# 7. today
npm run ingest:v2

# 8. dry run       expect: stages fixture_load + form_backfill + travel_load -> team_readiness
npm run feature:v2 -- calculate --dry-run

# 9. calculate
npm run feature:v2

# 10. replay B     expect: every written count 0
npm run feature:v2

# 11. verify       expect: four PASS lines
npm run feature:v2 -- verify
```

### Every day

```bash
cd /path/to/soccer/beta/backend
npm run ingest:v2      # 1 provider call — fixtures, transitions, results
npm run feature:v2     # no provider call — six features, two stages
```

### Every week

```bash
npm run feature:v2 -- verify
psql "$PT_V2_ADMIN_URL" -c "SELECT * FROM operations.v_freshness ORDER BY 1;"
```

### Backfill a date range

```bash
npm run ingest:v2 -- --from 2026-08-01 --to 2026-08-31 --allow-over-budget
npm run feature:v2 -- replay --from 2026-08-01 --to 2026-08-31
```

### When something fails

```bash
# which relation received nothing
psql "$PT_V2_ADMIN_URL" -c \
  "SELECT target_schema_name, target_relation_name, rows_written, rows_rejected
     FROM operations.write_record ORDER BY 1,2;"

# what failed, and why
psql "$PT_V2_ADMIN_URL" -c \
  "SELECT occurred_at, failure_class_code, message FROM operations.failure
    ORDER BY occurred_at DESC LIMIT 20;"

# quota spent today
psql "$PT_V2_ADMIN_URL" -c \
  "SELECT endpoint_key, sum(request_count) FROM operations.api_usage
    WHERE window_start >= date_trunc('day', now()) GROUP BY 1;"
```

Rerun the failed date (`--date`) or simply rerun the feature pipeline. Both are replay-safe. **Never re-apply a migration.**

### Known gaps an operator should expect

| | |
|---|---|
| `football.player`, `player_registration`, `player_availability`, `player_valuation`, `football.standing` | **Will stay empty.** Writers exist; no runner calls them (E-3) |
| `feature.feature_value` for `team.squad_stability` | **Will stay empty, deliberately.** Registered and never calculated (R-1) |
| Modules, snapshots, calibration, projections | **Not implemented.** S-6 onward has not been built |
| Retention | Implemented in the database; no CLI calls it |
