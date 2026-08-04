# PitchTerminal V2 — Complete Ingestion Orchestrator: Implementation Blueprint

**Planning only. No code was written or modified.** Every component named below already exists in `beta/backend/src/v2/`; the plan adds orchestration around them and introduces no relation, no vocabulary and no new principal.

---

## 0. The constraint that determines the whole design

Everything in this blueprint follows from one number.

```
2 keys × 100 requests/key/day = 200 provider calls per day, total.
```

`schedule` is a **FEED** endpoint: one call returns every fixture for a date with its competition, season, round, venue, both teams, status and score. Everything else worth ingesting is **PER_ENTITY** — one call per team, or per (tournament, season) pair.

Against a tracked estate of roughly 60–80 teams and a similar number of live editions, a naïve "ingest everything daily" orchestrator needs:

| Stage | Calls per full pass |
|---|---|
| `schedule` (1 day) | 1 |
| `season_standings`, all live editions | ~60 |
| `team_squad`, all tracked teams | ~76 |
| `team_transfers`, all tracked teams | ~76 |
| **Total** | **~213 — over budget on day one, with nothing left for catch-up** |

**So the orchestrator's central job is not sequencing. It is rationing.** A design that runs every stage every day cannot work, and one that runs stages on fixed calendar days wastes calls on estates that did not change. The design below rations by **derived staleness**: each per-entity stage asks the database which subjects are most out of date, takes as many as its budget allows, and stops.

That choice also satisfies the "no new tables" constraint, and it is the part of this plan most worth scrutinising. See §8.

---

## 1. Complete orchestration architecture

```
                          ┌──────────────────────────────────────┐
                          │  ProviderClient  (exists)            │
                          │  dual key · round robin · 429 failover│
                          │  2s throttle · usage accumulator      │
                          └───────────────┬──────────────────────┘
                                          │  every call observed
   ┌──────────────────────────────────────┴───────────────────────────────────┐
   │                    ORCHESTRATOR  (new — src/v2/ingestion/orchestrator/)   │
   │                                                                           │
   │   budget.ts     reads operations.api_usage → calls remaining today        │
   │   worklist.ts   reads football.*           → which subjects are stalest   │
   │   plan.ts       stage set × budget         → a bounded, ordered plan      │
   │   run.ts        executes the plan, one transaction per unit of work       │
   └───────────────────────────────────────────────────────────────────────────┘
        │                │                    │                    │
        ▼                ▼                    ▼                    ▼
  ┌───────────┐   ┌─────────────┐     ┌─────────────┐     ┌──────────────┐
  │ STAGE 1   │   │  STAGE 2    │     │  STAGE 3    │     │  STAGE 4     │
  │ schedule  │   │  standings  │     │  squad      │     │  transfers   │
  │ (exists)  │   │  (new stage,│     │  (new stage,│     │  (NOT        │
  │           │   │   existing  │     │   existing  │     │   BUILDABLE  │
  │           │   │   writer)   │     │   writers)  │     │   — see §10) │
  └─────┬─────┘   └──────┬──────┘     └──────┬──────┘     └──────────────┘
        │                │                    │
        ▼                ▼                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  EXISTING WRITERS — unchanged, no edit required                           │
│                                                                           │
│  reference.ts      resolveCompetition · resolveCompetitionEdition ·       │
│                    resolveCompetitionStage · resolveVenue                 │
│  participants.ts   resolveTeam · recordTeamRegistration · resolvePlayer   │
│  fixtures.ts       resolveFixture · recordResult                          │
│  standings.ts      recordStandings                          ← never called│
│  squad.ts          recordRegistration · recordUnavailability ·            │
│                    recordValuations · closeResolvedSpells   ← never called│
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  football.*   competition · competition_edition · competition_stage ·     │
│               venue · team · team_registration · fixture ·                │
│               fixture_lifecycle_transition · result · result_revision ·   │
│               player · player_registration · player_availability ·        │
│               player_valuation · standing                                 │
└───────────────────────────────────────────────────────────────────────────┘
        │  committed
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  FEATURE PIPELINE  (exists, separate process, separate role)              │
│  npm run feature:v2 — registry → plan → Stage 1 → commit → Stage 2        │
└───────────────────────────────────────────────────────────────────────────┘
```

**All four ingestion stages run as one role, `pt_pipeline_ingestion`** — the single-writer property is already structural. `pt_pipeline_ingestion` holds no `USAGE` on `feature`, `module`, `snapshot` or `calibration`, so a statement touching them fails with `permission denied for schema feature` before any policy is consulted. The orchestrator adds no principal and needs none.

**What is new is three files and one CLI change.** Every writer, mapper, normaliser, counter and telemetry helper already exists and is tested.

---

## 2. Dependency graph

### 2.1 Hard dependencies — a foreign key or an exclusion constraint enforces them

```
football.country, currency, position        ← S-3 seed (npm run seed:v2)
   │  FK: competition.country_code, venue.country_code, team.country_code,
   │      player.nationality_code, player_valuation.currency_code
   ▼
competition ──► competition_edition ──► competition_stage
   │                   │  FK: fixture.competition_edition_id
   │                   │      team_registration.competition_edition_id
   │                   │      standing.competition_edition_id
   ▼                   ▼
venue ─────────► team ─────────► team_registration
   │  FK:          │  FK: fixture.home_team_id / away_team_id
   │  fixture.venue_id │      standing.team_id
   │               │          player_registration.team_id
   ▼               ▼
              fixture (composite key: id, fixture_partition_on)
                 │  FK: result(fixture_id, fixture_partition_on)
                 │      fixture_lifecycle_transition(…)
                 ▼
              result ──► result_revision

player ──► player_registration          (EXCLUDE: player, kind, period)
   │   ──► player_availability          (EXCLUDE: player, kind, period)
   └───► player_valuation               (UQ: player, source, as_of_on)
```

### 2.2 Why each stage must precede the next

| Edge | Enforced by | What happens if violated |
|---|---|---|
| **seed → every stage** | FKs on `country_code`, `currency_code` | `mapCountry` returns a code with no row; the insert raises a foreign-key violation on the first mappable country |
| **schedule → standings** | `standing.competition_edition_id` FK, and `standing.team_id` FK | An edition the schedule feed has never returned does not exist, so its table cannot be written. **Also practical:** the standings *endpoint path* needs `competition.provider_external_id` and `competition_edition.provider_external_id`, which only the schedule stage populates |
| **schedule → squad** | `player_registration.team_id` FK | A team must exist before a player can be registered to it. The squad work list is a query over `football.team`, which only the schedule stage populates |
| **squad(player) → registration / availability / valuation** | `player_id` FK on all three | `resolvePlayer` must run first, within the same transaction, so the surrogate id exists |
| **transfers → registration provenance** | *No constraint — a data-quality dependency* | Without transfers, **every** registration boundary is `SNAPSHOT_DIFFERENCE` → `INFERRED`. Nothing fails; the provenance is simply weaker than the schema is designed to record. See §10, blocker **B-3** |
| **ingestion → features** | `readFixturesForEligibility` / `readCompletedFixtures` | The feature pipeline derives its plan, reports zero batches, and **succeeds having written nothing** |

### 2.3 Ordering constraints *within* the squad stage

This is the one stage where order is an algorithm rather than a graph, and it must be written down.

```
for one team:
   1. resolvePlayer          × N          upsert; establishes player_id
   2. recordRegistration     × N          reads the open spell, may close it, opens successor
   3. recordUnavailability   × injured    reads the open spell, opens if absent
   4. closeResolvedSpells    × 1          closes spells no longer reported — needs the
                                          full player id list from step 1 and the still-
                                          unavailable list from step 3
   5. recordValuations       × N          append-only, order-independent
```

Step 4 **must** come after steps 1 and 3, because it takes both sets as arguments and closes everything else that is open. Bounded to one team's players deliberately: a global sweep would read "not observed" as "recovered" for every team not fetched this run.

---

## 3. Correct execution order

The order in the brief is a sensible first sketch. Three corrections are required, each for a reason in the code.

### 3.1 Corrections to the proposed order

| Proposed stage | Correction | Why |
|---|---|---|
| **Discovery → Competitions → Seasons → Stages → Venues → Teams** as six separate stages | **Collapse into `schedule`.** They are not stages; they are the first six of nine resolution steps *inside* `ingestScheduleDate`, in exactly that order, on one provider response | Running `tournaments` and `seasons` as separate DISCOVERY calls costs 2 calls to obtain data the `schedule` FEED call already carries, and introduces a second writer for the same relations. `resolveCompetition` and `resolveCompetitionEdition` are already driven by the schedule payload |
| **Standings before Squads** | **Keep, but both are quota-rationed and neither is daily** | No dependency between them. Standings is cheaper per unit of value (one call covers a whole division) and should win a contested budget |
| **Transfers** | **Cannot be built today** | The `team_transfers` endpoint is registered; **no writer consumes it.** `recordRegistration` accepts `evidence: 'TRANSFER_RECORD'`, and nothing in the repository ever supplies that value. See §10 **B-3** |

### 3.2 The corrected order

```
   SEED  (npm run seed:v2 — once, then on vocabulary change)
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1 — schedule            1 provider call per date         DAILY        │
│   inside one transaction per date, in this fixed order:                     │
│     1. competition        4. venue           7. fixture                     │
│     2. competition_edition 5. team           8. fixture_lifecycle_transition│
│     3. competition_stage  6. team_registration 9. result (+ result_revision)│
└─────────────────────────────────────────────────────────────────────────────┘
     │  editions and teams now exist and carry provider ids
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 2 — standings           1 call per (competition, edition)  RATIONED   │
│   work list: live editions ordered by staleness, capped by budget           │
│   one transaction per edition · writes football.standing (append-only)      │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3 — squad               1 call per team                    RATIONED   │
│   work list: teams with an upcoming fixture, ordered by staleness           │
│   one transaction per team · player → registration → availability →         │
│   closeResolvedSpells → valuation                                           │
└─────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STAGE 4 — transfers           NOT IMPLEMENTABLE — no writer exists          │
└─────────────────────────────────────────────────────────────────────────────┘
     │  all ingestion committed
     ▼
   FEATURES  (npm run feature:v2 — separate process, separate role)
     │
     ▼
   VERIFY   (npm run feature:v2 -- verify)
```

---

## 4. CLI design

### Recommendation: **subcommands, with `full` as the scheduled default.**

```
npm run ingest:v2 -- schedule   [--date | --from --to] [--allow-over-budget]
npm run ingest:v2 -- standings  [--limit N] [--edition <id>]
npm run ingest:v2 -- squads     [--limit N] [--team <id>]
npm run ingest:v2 -- full       [--date …]        ← schedule, then standings, then squads
npm run ingest:v2 -- plan       [--date …]        ← print the plan and the budget, call nothing
```

### Why not keep one command

One command cannot express the three things an operator needs to do independently:

1. **Re-run one stage after a partial failure.** Today's single command would re-run schedule too — wasting a call that already succeeded, on the day the budget is most likely already tight.
2. **Backfill.** Historical schedule replay is a bounded, deliberate act with its own guard. Squad backfill is *not possible at all* — a squad endpoint returns today's squad, so replaying it into a past date would assert a registration that was not observed then. The two must not share an invocation.
3. **Ration.** `--limit` is meaningful for the per-entity stages and meaningless for schedule.

### Why not a separate npm script per stage

`ingest:v2` already resolves to one file, and four scripts would mean four `package.json` entries, four processes, four connection pools and four `pipeline_run` rows for what is operationally one job. A subcommand costs one `switch`.

### Backward compatibility

**`npm run ingest:v2` with no arguments must keep meaning "ingest today's schedule".** The current parser takes no positional at all; the new one should treat an absent or date-shaped first positional as `schedule`, so every command in [document 28](./28-phase8-execution-runbook.md) and any existing cron entry continues to work unchanged.

### `plan` is not decoration

`--dry-run` is the wrong shape for a quota-bound pipeline: it implies "do the work, write nothing", which still spends the calls. `plan` reads the budget and the work lists, prints what *would* be fetched and in what order, and **makes no provider call**. It is the only safe way to answer "what will tonight's run do?" before it runs.

---

## 5. Daily production workflow

```
  ┌────────────────────────────────────────────────────────────────────┐
  │ 1. PLAN            npm run ingest:v2 -- plan                       │
  │    0 calls. Prints remaining budget and the chosen work lists.      │
  │    Optional in automation; essential when investigating.            │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 2. API SYNC        npm run ingest:v2 -- full                       │
  │    schedule (1) → standings (≤ n) → squads (≤ m)                   │
  │    One transaction per date / per edition / per team.               │
  │    Exit 1 if any unit failed; the rest still committed.             │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 3. DATABASE WRITES  — none separate                                │
  │    V2 has no DB-only processing phase. Writes happen inside step 2. │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 4. FEATURES        npm run feature:v2                              │
  │    MUST NOT overlap step 2 — features read football.fixture and    │
  │    football.result inside their own transactions, and a concurrent │
  │    ingestion commit would let one batch see a fixture another did  │
  │    not, both labelled with the same as_of.                          │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 5. VERIFICATION    npm run feature:v2 -- verify                    │
  │    Four temporary controls, read-only as pt_platform_admin.         │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 6. MODULE REFRESH  — DOES NOT EXIST                                │
  │    S-6 is not implemented and cannot be specified                   │
  │    (docs 25, 26, 27). Nothing to schedule.                          │
  └────────────────────────────────────────────────────────────────────┘
                                  ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │ 7. HEALTH CHECKS   the queries in §9                               │
  └────────────────────────────────────────────────────────────────────┘
```

Steps 3 and 6 are in the brief's example workflow and are listed here **as absent**, because an operator following a workflow with two silent no-ops in it will assume something ran.

---

## 6. Cron schedule

`operations.quality_check` already declares a cadence per check, and migration 018 already contains the pg_cron entries for maintenance — commented, pending exactly this cadence decision. The schedule below is aligned to both.

### Ingestion and calculation

| What | Cadence | Cron (UTC) | Calls/day | Why this frequency |
|---|---|---|---|---|
| **schedule — today + tomorrow** | daily | `0 4 * * *` | 2 | Today's fixtures may have moved; tomorrow's must exist before the earliest snapshot point is reached. Two calls is 1% of budget for the entire fixture graph |
| **schedule — yesterday** | daily | `30 6 * * *` | 1 | Late results and lifecycle corrections. Separated from the forward pass so a provider outage overnight does not cost the forward window |
| **standings** | daily, rationed | `0 5 * * *` | ≤ 25 | A league table changes only on a matchday, but *which* leagues played is not known without checking. 25/day cycles ~60 live editions every 2–3 days, which is inside the useful life of a table |
| **squads** | daily, rationed | `0 5 * * *` (same run) | ≤ 60 | Squad composition changes on transfer deadline days and injury news. 60/day cycles ~76 teams every ~1.3 days |
| **features** | daily | `0 7 * * *` | 0 | After all ingestion has committed. The 2-day default lookback means a missed day self-heals |
| **transfers** | — | — | — | No writer exists (§10 **B-3**) |
| **competitions / seasons (DISCOVERY)** | **never** | — | 0 | The schedule FEED already resolves both. A separate discovery call buys nothing and costs quota |

**Daily total: 3 + 25 + 60 = 88 calls, leaving 112 for catch-up, re-runs and manual investigation.** That headroom is the point — a budget consumed at 95% has no room for the day something goes wrong.

### Verification and maintenance

| What | Cadence | Cron (UTC) | Source of the cadence |
|---|---|---|---|
| `feature:v2 -- verify` | daily | `30 7 * * *` | `quality_check`: `feature_dependency_acyclic` BLOCKING/1 day, `feature_scale_conformance` HIGH/1 day, `orphan_absence` HIGH/1 day, `provenance_propagation` HIGH/1 day |
| `fn_assert_security_posture()` + `fn_assert_access_correspondence()` | daily | `0 8 * * *` | `quality_check`: `rls_enabled_and_forced`, `privilege_policy_correspondence`, `retention_delete_privilege`, `snapshot_no_modification_privilege` — all BLOCKING/1 day |
| `fn_maintain_partitions()` | daily | `0 2 * * *` | Migration 018's own commented entry, unchanged |
| `fn_run_retention()` | weekly | `0 3 * * 0` | Migration 018's own commented entry. **Must run as `pt_retention` in a session with the R-21 marker** — `withSession` supports it, no CLI calls it |
| Freeze pass | weekly | external, non-transactional | VACUUM cannot run inside pg_cron's transaction (R-62). Migration 018 states this explicitly |

**pg_cron holds schedule definitions; `operations.pipeline_run.trigger_kind = 'SCHEDULED'` records executions.** There is no `pipeline_schedule` relation and one must not be created — `src/v2/operations/schedule.ts` documents this as finding M-5 and refuses to fabricate it.

---

## 7. Failure recovery

### 7.1 Per stage

| Stage | Transaction boundary | Partial failure | Replay-safe? | Retry |
|---|---|---|---|---|
| **schedule** | one per **date** | The failed date rolls back entirely; the range continues. Exit code 1 | **Yes, fully.** Mutable upsert with `COALESCE`; append-only `DO NOTHING`; no delete path exists | `-- schedule --date <that date>` |
| **standings** | one per **edition** | The failed edition rolls back; the rest of the work list continues | **Yes, fully.** `insertAppendOnly` on `uq_standing__edition_team_variant_asof`. Same day → 0 written, all skipped | `-- standings --edition <id>` |
| **squad** | one per **team** | The failed team rolls back — including its `closeResolvedSpells` — so the team's spell state is exactly as before | **Partly. See 7.2** | `-- squads --team <id>` |
| **features** | one per (calculator × batch) | Batch rolls back; run continues; exit 1 | **Yes.** Replay B: second run writes zero rows | `npm run feature:v2` |

### 7.2 Squad ingestion is the one stage that is not fully replay-safe, and the plan must say so

Three distinct issues, all in existing code:

**(a) `closeResolvedSpells` reads the wall clock.**

```ts
[teamPlayerIds, stillUnavailablePlayerIds, utcDateString(new Date())]
```

The spell is closed *as of today*, not as of the observation date. Re-running the same squad response on a different day produces a different `spell_period` upper bound. This violates the determinism obligation the feature pipeline holds itself to (R-2 obligation 6: no wall clock inside a calculator) and it is the only wall-clock read in the ingestion write path.

**Consequence for the orchestrator:** squad ingestion is **idempotent within a day** and **not idempotent across days**. Re-running today is safe; re-running last week's response today is not.

**(b) `recordRegistration` is order-dependent by design.** It reads the open spell and closes it at the new start date. Feeding it an *older* squad snapshot after a newer one would close the newer registration and open a stale successor. Replay must therefore be chronological or not at all.

**(c) There is no squad backfill and there must not be one.** The endpoint returns *today's* squad. Writing it with a past date would assert a registration nobody observed then — precisely the fabrication the provenance rules exist to prevent.

**Design response, not a code change:** the orchestrator exposes **no `--from/--to` on `squads`**. The only replay is "fetch this team again now".

### 7.3 Cross-cutting

| Failure | Response |
|---|---|
| **Provider 404** | A data condition, not a transport failure — a team with no squad, a season with no standings. Log at `warn`, count, continue. Already implemented in `ProviderRequestError.isNotFound` |
| **Provider 429 / both keys spent** | The client already fails over to the other key and waits 62s. If the day's budget is genuinely spent, the orchestrator should **stop the stage and exit non-zero**, not keep trying — tomorrow's quota is not today's to spend |
| **Quota flush** | Already correct: flushed on the **control connection**, outside the work transaction, after every unit. A rolled-back unit still records what it spent |
| **Dependency recovery** | Never re-run the seed to fix an ingestion failure; it is idempotent but irrelevant. If a stage fails on a foreign key naming `country_code`, the fix is to add the code to `vocabulary.ts` **under governance** and re-run the seed — ingestion never creates vocabulary rows |
| **Migrations** | **Never re-apply.** Migration 020 in particular rebuilds indexes on every partition |

### 7.4 What must never be retried automatically

| | |
|---|---|
| A squad response older than the current state | 7.2(b) — it would close a newer registration |
| Any stage after the daily budget is exhausted | It would borrow tomorrow's quota and leave tomorrow's forward window unfetched |
| A rejected currency | The row is deliberately not written. Retrying changes nothing; adding the currency to the seed does |

---

## 8. API optimisation

### 8.1 The ordering that minimises spend

1. **`schedule` first, always.** One FEED call yields entities at seven levels of the reference graph. It is the only endpoint with that property, and everything else depends on what it resolves.
2. **Never call `tournaments` or `seasons`.** Both are DISCOVERY endpoints returning catalogues the schedule feed already resolves incrementally. Two calls saved per run, and — more importantly — one writer per relation preserved.
3. **`standings` before `squads`** when the budget is contested. One standings call covers an entire division's 18–20 teams; one squad call covers one team.
4. **Never call `team_players`** while `team_squad` is in use. `team_players` is the cheaper *payload* but the same *cost* — one call either way — and it omits the injury and valuation detail three writers need.

### 8.2 Conditional execution — the rationing mechanism

**The work list is a query, not a table.** This is the design decision that satisfies "no new tables" while still supporting rotation, and it deserves to be stated plainly: *the ingested data is its own staleness record.*

**Standings work list** — editions with a fixture in the recent window, ordered by how long ago their table was last recorded:

```sql
SELECT c.provider_external_id  AS tournament_external_id,
       e.provider_external_id  AS season_external_id,
       e.id                    AS edition_id,
       max(s.as_of_on)         AS last_recorded
  FROM football.competition_edition e
  JOIN football.competition c ON c.id = e.competition_id
  LEFT JOIN football.standing s ON s.competition_edition_id = e.id
 WHERE c.provider_external_id IS NOT NULL
   AND e.provider_external_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM football.fixture f
                WHERE f.competition_edition_id = e.id
                  AND f.scheduled_kickoff_at > now() - interval '14 days')
 GROUP BY 1,2,3
 ORDER BY last_recorded NULLS FIRST, e.id
 LIMIT $1;
```

`NULLS FIRST` puts never-fetched editions ahead of stale ones — a table that has never been recorded is worth more than one recorded three days ago. The `provider_external_id IS NOT NULL` filters are load-bearing: `competition_edition.provider_external_id` is **nullable** and is populated from `season.id` in the schedule payload, which the provider does not always send. An edition without one cannot be addressed by the standings path at all.

**Squad work list** — teams with an upcoming fixture, ordered by how long ago their squad was last observed:

```sql
SELECT t.id, t.provider_external_id, max(v.as_of_on) AS last_observed
  FROM football.team t
  LEFT JOIN football.player_registration r
         ON r.team_id = t.id AND upper_inf(r.registration_period)
  LEFT JOIN football.player_valuation v
         ON v.player_id = r.player_id
 WHERE EXISTS (SELECT 1 FROM football.fixture f
                WHERE (f.home_team_id = t.id OR f.away_team_id = t.id)
                  AND f.scheduled_kickoff_at BETWEEN now() AND now() + interval '10 days')
 GROUP BY t.id, t.provider_external_id
 ORDER BY last_observed NULLS FIRST, t.id
 LIMIT $1;
```

`player_valuation.as_of_on` is the honest proxy for "when did we last fetch this squad": the squad endpoint returns valuations, `recordValuations` writes at most one row per player per source per day, and the grain is exactly a daily observation.

**Both queries have a total `ORDER BY` with `id` as the final tie-break**, so the work list is deterministic. Two runs against the same database in the same state choose the same subjects in the same order.

### 8.3 Budget accounting

Before any call, read what has already been spent today from the relation that records it:

```sql
SELECT coalesce(sum(quota_consumed), 0) AS spent_today
  FROM operations.api_usage
 WHERE provider_code = 'SPORTSAPI_API'
   AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'UTC');
```

`remaining = dailyQuota(config) − spent_today`, then each stage takes `min(--limit, remaining − reserve)`. **Reserve at least 3 calls for the next schedule pass** — the forward fixture window is the one thing nothing downstream can work without.

### 8.4 Batching

**There is none available, and the plan should not pretend otherwise.** Every PER_ENTITY endpoint takes exactly one subject: `/team/{id}/players`, `/tournament/{t}/season/{s}/standings`. There is no multi-subject variant in the registry. The only real economies are the three above: prefer FEED over DISCOVERY, ration by derived staleness, and never fetch what the schedule feed already gave you.

---

## 9. Health monitoring

Every metric below reads a relation that already exists. No new telemetry table is proposed.

### 9.1 Quota

```sql
SELECT endpoint_key,
       sum(requests_made)   AS requests,
       sum(quota_consumed)  AS consumed,
       min(quota_remaining) AS remaining_at_low_water,
       sum(throttled_count) AS throttled
  FROM operations.api_usage
 WHERE occurred_at >= date_trunc('day', now())
 GROUP BY endpoint_key ORDER BY consumed DESC;
```

**Alert:** consumed > 85% of the daily budget before the schedule pass has run.

### 9.2 Rows written / skipped / rejected, per relation

```sql
SELECT target_schema_name || '.' || target_relation_name AS relation,
       sum(rows_examined) AS examined, sum(rows_written) AS written,
       sum(rows_skipped)  AS skipped,  sum(rows_rejected) AS rejected
  FROM operations.write_record
 WHERE occurred_at >= now() - interval '24 hours'
 GROUP BY 1 ORDER BY 1;
```

**The two alerts that matter:**

- **A relation absent from this result** — the job did not touch it at all. *"A job completing successfully while writing nothing is among the most dangerous states in a precompute platform and is invisible without this record."*
- **`rejected > 0`** — a mapping is failing. Most often an unseeded country or an unmapped currency, both of which need a governed seed change, not a retry.

### 9.3 Duration

`operations.pipeline_run` and `pipeline_job_run` carry the timings; terminal state is **appended** to the completion companions (migration 019), so duration is a join rather than a column:

```sql
SELECT r.job_key, r.occurred_at, c.completed_at - r.occurred_at AS duration, c.outcome
  FROM operations.pipeline_job_run r
  LEFT JOIN operations.pipeline_job_run_completion c
         ON c.pipeline_job_run_id = r.id AND c.job_occurred_at = r.occurred_at
 WHERE r.occurred_at >= now() - interval '24 hours'
 ORDER BY r.occurred_at DESC;
```

**Alert:** a run with **no completion row** — it neither succeeded nor failed, which means the process died. That is the state `RUNNING` was made immutable to expose.

### 9.4 Stale data

Three different staleness questions, three different sources:

```sql
-- Layer 2 freshness, per feature (the view already exists)
SELECT feature_key, context_kind_code, last_calculated_at, staleness
  FROM operations.v_freshness ORDER BY staleness DESC NULLS FIRST;

-- Layer 1 standings staleness, per edition
SELECT e.id, c.name, max(s.as_of_on) AS last_table, now()::date - max(s.as_of_on) AS days
  FROM football.competition_edition e
  JOIN football.competition c ON c.id = e.competition_id
  LEFT JOIN football.standing s ON s.competition_edition_id = e.id
 GROUP BY 1,2 ORDER BY days DESC NULLS FIRST LIMIT 20;

-- Layer 1 squad staleness, per team (same expression the work list orders by)
SELECT t.name, max(v.as_of_on) AS last_squad
  FROM football.team t
  LEFT JOIN football.player_registration r ON r.team_id = t.id AND upper_inf(r.registration_period)
  LEFT JOIN football.player_valuation v ON v.player_id = r.player_id
 GROUP BY 1 ORDER BY last_squad NULLS FIRST LIMIT 20;
```

**`v_freshness` `LEFT JOIN`s `feature_definition`, so `team.squad_stability` appears permanently stale.** That is correct and deliberate — it is registered and never calculated (R-1) — and the dashboard must annotate it rather than alert on it.

### 9.5 Failures

```sql
SELECT f.occurred_at, f.failure_class_code, f.message, r.job_key
  FROM operations.failure f
  JOIN operations.pipeline_job_run r
    ON r.id = f.pipeline_job_run_id AND r.occurred_at = f.pipeline_job_run_occurred_at
 WHERE f.occurred_at >= now() - interval '7 days'
 ORDER BY f.occurred_at DESC;
```

Every failure is already attributed to a job run with its SQLSTATE and constraint name, written on the control connection so it survives the rollback of the work that caused it.

### 9.6 Dashboard layout

| Panel | Source | Alert |
|---|---|---|
| Quota burn-down, today | `api_usage` | > 85% before the schedule pass |
| Relations written, last 24h | `write_record` | any expected relation **missing** |
| Rejections by relation | `write_record.rows_rejected` | > 0 |
| Run duration and outcome | `pipeline_job_run` + completion | missing completion row |
| Feature freshness | `v_freshness` | staleness > 36h (excl. `squad_stability`) |
| Standings / squad staleness | the two queries above | oldest > 7 days |
| Failures, 7 days | `failure` | any BLOCKING class |
| Quality assertions | `quality_assertion_result` | any BLOCKING failing |

---

## 10. Gap analysis

| ID | Blocker | Severity | Effort | Why |
|---|---|---|---|---|
| **B-1** | **No orchestrator.** `ingestSchedule` calls one stage; `standings.ts` and `squad.ts` are exported and called by nothing | **Critical** | **M** — 3 new files (~500 lines), 1 CLI change | This is the whole of §1–§4. The writers, mappers, counters and telemetry all exist and are tested; what is missing is a work-list driver, a budget gate and two stage functions that shape the provider payload into the writers' inputs |
| **B-2** | **`closeResolvedSpells` reads the wall clock** (`utcDateString(new Date())`), so a squad response replayed on a different day produces a different `spell_period` | **Critical** | **S** — one parameter, plus callers | Ingestion has no equivalent of the feature pipeline's "one clock read per run, passed down". Until this is fixed, squad ingestion is not deterministic across days and §7.2's restriction must stand. **This is an existing-code defect the orchestrator must not paper over** |
| **B-3** | **No transfers writer.** `team_transfers` is registered; nothing consumes it. `recordRegistration` accepts `evidence: 'TRANSFER_RECORD'` and nothing supplies it, so **every** registration boundary will be `INFERRED` | **High** | **M** — a new stage plus a payload mapper | Not a correctness failure — the provenance is honest about being weak. But it is the fact the S-4 README calls *"the rule that matters most"*, and a calibration population built on inferred registrations is materially weaker evidence than the schema is designed to carry |
| **B-4** | **No LOGIN grant and no migration runner.** Both are manual (doc 28, E-1) | **Critical** | **S** — a documented script, or accept as a deliberate manual gate | Full automation is impossible while bring-up needs a human. Reasonable to leave manual for the credential step; the migration runner is a 20-line script |
| **B-5** | **`competition_edition.provider_external_id` is nullable** and populated only when the schedule payload carries `season.id`. Editions without one cannot be addressed by the standings endpoint | **High** | **S** — a work-list filter plus a metric | The filter is in §8.2. The metric — how many live editions are unaddressable — needs to exist, or standings coverage will silently be partial |
| **B-6** | **No scheduler is installed.** Migration 018's pg_cron entries are commented out pending the cadence decision | **High** | **S** — uncomment, set the cadences from §6 | The cadence question this document answers is exactly the one the TODO defers |
| **B-7** | **Retention has no caller.** `fn_run_retention()` must run as `pt_retention` in a session carrying the R-21 marker; `withSession` supports it, no CLI calls it | **Medium** | **S** — ~40 lines, per doc 15 §3.8 | Not urgent while volume is low. It becomes urgent as `feature_value` grows, and the function itself is already verified |
| **B-8** | **The bounded retention class is gated** on the A.17/R-71 detachment verification, which has never been performed | **Medium** | **M** — a platform experiment | `fn_run_retention` raises a notice and detaches nothing until it is recorded. `quality_check` gives it a 365-day cadence, so it is a once-a-year platform check, not routine work |
| **B-9** | **Twelve of fourteen registered quality checks have no implementation** (finding S5-2). `feature/verify.ts` stands in for four | **Medium** | **L** — one implementation per check | Each check is a registered assertion with a declared severity and cadence and nothing behind it. Two BLOCKING ones — `privilege_policy_correspondence`, `rls_enabled_and_forced` — *do* have database functions and should simply be scheduled (§6) |
| **B-10** | **No module refresh exists.** S-6 is not implemented and cannot currently be specified (docs 25, 26, 27) | **Medium** | **XL** | Out of scope for ingestion. Listed so the daily workflow's step 6 is understood as absent rather than forgotten |
| **B-11** | **Eleven `TODO: requires confirmation` markers** remain in the migration set, three flagged as pre-production | **Low** | **M** | They are recorded open questions, not defects. None blocks ingestion |
| **B-12** | **`operations.pipeline_run.trigger_kind = 'SCHEDULED'`** is unused because nothing is scheduled | **Low** | **S** — set it when invoked from cron | Trivial, but without it every run looks manual and the scheduled/ad-hoc distinction the schema offers is wasted |

### Critical path to a fully automated platform

```
B-4 (manual bring-up)  ──►  B-1 (orchestrator)  ──►  B-6 (scheduler)  ──►  automated
                                   │
                            B-2 must land WITH or BEFORE B-1
                            (squad determinism)
                                   │
                            B-5 filter is part of B-1's standings stage
```

**B-2 before B-1 is the one ordering that is not negotiable.** Building the squad stage on top of a wall-clock-dependent writer would put a non-deterministic write on a daily schedule, and the resulting `spell_period` values would be permanent under append-only.

### Effort summary

| Severity | Count | Combined effort |
|---|---|---|
| Critical | 3 (B-1, B-2, B-4) | **M** — the orchestrator dominates; the other two are small |
| High | 3 (B-3, B-5, B-6) | **M** |
| Medium | 4 (B-7, B-8, B-9, B-10) | **L** — B-10 is a subsystem, not a task |
| Low | 2 (B-11, B-12) | **S** |

---

## Constraint compliance

| Constraint | How this plan satisfies it |
|---|---|
| **No new database tables** | None proposed. Rotation state is *derived* — `standing.as_of_on` and `player_valuation.as_of_on` are the staleness records (§8.2). Schedule definitions live in pg_cron; executions in `operations.pipeline_run`, as the architecture already decided |
| **No weakened audit guarantees** | Every writer is used unchanged. `write_record` stays per relation. Failures stay on the control connection. Quota stays flushed outside the work transaction |
| **No service-key writes** | The orchestrator adds no principal. Every stage runs as `pt_pipeline_ingestion`, which structurally cannot reach `feature`, `module`, `snapshot` or `calibration` |
| **Replay safety preserved** | Schedule and standings are fully replay-safe today. Squad is not, and the plan **says so** (§7.2) and constrains the CLI accordingly rather than designing around it. B-2 is raised as Critical |
| **Deterministic execution** | Work lists carry a total `ORDER BY` ending in `id`; budget is read once per run; stage order is fixed. The one non-determinism is B-2, raised rather than hidden |
| **Append-only history preserved** | `standing`, `player_valuation` and `fixture_lifecycle_transition` keep `insertAppendOnly` with named conflict targets. The only UPDATE is `recordRegistration` closing a period — legitimate, already implemented, and not extended here |
| **Role isolation preserved** | One writer role for all ingestion. Features run as `pt_pipeline_feature`, verification as `pt_platform_admin`, retention as `pt_retention` — four processes, four principals, no sharing |
| **Only existing components** | Three new orchestration files and one CLI change. Zero changes to any writer, mapper, normaliser or provider client — except B-2, which is a defect fix, not an extension |
