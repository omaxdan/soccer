# Phase 8 S-6 — The Season Sweep, Wired

Closes **B-1** from [doc 43](./43-phase8-s6-live-run-preflight.md): the season
pager and the entity writers both existed and were both proven, and nothing
joined them. **No provider call was made. No live sweep was run.**

---

## The new production path

```
   npm run ingest:v2 -- season --tournament 325 --season 87678 \
                               --from 2026-05-31 --to 2026-08-11 --max-calls 10
                                          │
                                          ▼
                              cli.ts  ── validates, prints the resolved
                                          configuration, refuses bad input
                                          BEFORE any provider call
                                          │
                                          ▼
                        pipeline.ts  ── ingestSeason()
                                          │
              withPipelineRun('v2.ingest.season')
                                          │
                    ┌─────────────────────┴─────────────────────┐
                    ▼                                           ▼
         sweepSeason(client, …)                     withRun('ingest.season')
         tournament_season_events_last                          │
         tournament_season_events_next                          ▼
         NO transaction held                        ingestEvents(tx, raws, {scope})
                    │                                           │
                    └────────── PagedEvent[] ──────────────────►│
                                                                ▼
                                              the existing entity writers,
                                              unchanged
```

`ingestSeason` is **~120 lines of orchestration and no writing**. Every row it
causes is written by code that already existed and was already proven.

---

## The shared writer extraction

`ingestScheduleDate` did two things — fetch, then write — and the writing half
was unreachable from anywhere else. That is the whole of why the pager had no
production caller.

**Before**

```ts
export async function ingestScheduleDate(tx, client, date) {
  const response = await client.get('schedule', { date });
  const events = response.events ?? [];
  … caches, loop, ingestEvent …          // ← the only copy, reachable only here
}
```

**After**

```ts
export async function ingestEvents(tx, events, { label, scope? }): Promise<StageCounts>
  … caches, loop, ingestEvent …          // ← the one copy, reachable by both feeds

export async function ingestScheduleDate(tx, client, date) {
  const response = await client.get('schedule', { date });
  return ingestEvents(tx, response.events ?? [], { label: `schedule ${date}` });
}
```

```
  /schedule/{date}  ──fetch──┐
                             ├──►  ingestEvents  ──►  entities
  season pager      ─────────┘
```

**Nothing about the writing changed.** Same entity resolution, same order, same
caches, same functions. The schedule path is behaviourally identical and its
existing tests pass unmodified.

**There is one writer, and a test asserts it structurally** (test 13): the
schedule path must contain `return ingestEvents(`, and `stages/schedule.ts` must
contain exactly **one** event loop. Two writers would pass every behavioural test
here and diverge on the next rule someone adds to one of them.

---

## CLI and window configuration

```
npm run ingest:v2 -- season --tournament <id> --season <id>
                            --from <YYYY-MM-DD> --to <YYYY-MM-DD>
                            [--max-calls <n>]
```

**All four scope flags are required. There is no default competition and no
default window.** `FIXTURE_WINDOW` remains in the pager as the evidence-derived
value tests and exploration use; production states its own. A window that lives
only in a module constant cannot appear in a run record, and an operator cannot
see what a run actually used.

Everything is refused **before the first provider call**: a missing flag, a
malformed date, an inverted range, a non-positive `--max-calls`. Verified live:

```
$ … season --tournament 325 --season 87678 --from 2026-08-11 --to 2026-05-31
v2 ingestion FAILED: --to (2026-05-31) precedes --from (2026-08-11).

$ … season --tournament 325
v2 ingestion FAILED: --season is required for a season sweep. Usage: …
```

The resolved configuration prints before execution:

```
v2 season sweep — resolved configuration
  competition (uniqueTournament.id)  325
  season (season.id)                87678
  window                            2026-05-31 .. 2026-08-11 (inclusive, UTC)
  call budget (whole sweep)         10
  endpoints                         tournament_season_events_last | _next
  NOT used                          /schedule/{date}, match-level
```

`to` is inclusive **to the end of that UTC day** — a fixture kicking off at
22:30Z on 11 August is inside the window, and a boundary at midnight would drop
the evening round.

---

## Budget handling

**One budget for the whole sweep, not one per direction.** `sweepSeason` walks
`last` first and hands `next` only the remainder, so a truncated sweep loses
forward fixtures rather than historical ones — the half bounded by a hard date
floor is the half whose cost is predictable.

| Test | Proves |
|---|---|
| 7 | `--max-calls 5` against an endless source spends exactly 5, all on `last`; `next` gets 0 |
| 8 | `--max-calls 0` makes **no request at all** |
| 9 | `quotaRemaining` is the last figure the **provider reported**, never computed |

`SweepResult.quotaRemaining` was added to the pager for §7's accounting — the
only pager change in this step, and it carries `null` through as `null` rather
than substituting an estimate.

---

## Operational lifecycle

Existing infrastructure only. **No parallel ledger was invented.**

| Requirement | Where it lands |
|---|---|
| run id, trigger, code revision | `operations.pipeline_run`, `run_key = 'v2.ingest.season'` |
| tournament, season, window | `pipeline_run.scope_text` — `competition 325 season 87678 2026-05-31..2026-08-11` — and the job's `detail` |
| job start/end/outcome | `operations.pipeline_job_run`, `job_key = 'ingest.season'`, completion via `pipeline_run_completion` (migration 019) |
| fixtures / results / venues / teams / transitions / registrations inserted, updated, skipped, rejected | `operations.write_record`, one row per relation, via the existing `reportWrites` |
| calls used, quota remaining | `operations.api_usage`, flushed on the **control** connection in a `finally` — the provider charged for those calls whether the write rolled back or not |
| errors | `operations.failure`, written by `withRun` with job attribution |
| pages traversed, termination per direction, events read/selected, duplicates, ordering anomalies | `SeasonIngestionReport.directions[]`, printed by the CLI |

**Fetch outside the transaction, write inside it.** The pager makes up to
`maxCalls` throttled HTTP requests; holding a transaction across that would pin a
pooled connection for a network walk. The walk completes first, then the whole
season is written in **one transaction** — 47 fixtures all land or none do.

---

## Scope guards

**Enforced at the writer, not at the orchestrator.** Checking in `ingestSeason`
would leave `ingestEvents` trusting its caller; checking in `ingestEvents` means
every event is verified immediately before it would be written.

```ts
if (scope) {
  const eventCompetition = externalId(uniqueTournament.id);   // NOT tournament.id
  const eventSeason      = externalId(season.id);
  if (eventCompetition !== scope.competitionProviderId ||
      eventSeason      !== scope.seasonProviderId) { reject; return; }
}
```

The check runs **before any write**, including before competition resolution — so
an out-of-scope event creates no competition, no edition, no team, no venue. Test
10 proves it: three events offered, one in scope, **one fixture written**, both
refusals counted, and **no edition created for the out-of-scope season**.

`scope` is optional and the schedule feed passes none, because a date legitimately
carries every competition playing that day (test 11).

`ingestSeason` adds a second, independent guard: after writing, it counts editions
for the provider season **from the database** and throws if it is not exactly 1 —
rolling the transaction back rather than committing and reporting. That is F-1
asserted rather than assumed.

---

## Resume behaviour — deferred, deliberately

**No persistent resume state, and no migration.** The pager already returns
`resumeFromPage`, set **only** when the budget was what stopped the walk; a walk
stopped by 404, by `hasNextPage`, or by the window is finished, and a resume
point on a finished walk would invite someone to spend quota re-reading past the
end. It is surfaced in `SeasonIngestionReport` and printed by the CLI.

One season is four pages. **Persistent resume is deferred until bulk ingestion
proves the operational requirement exists** — a table added now would be storing
a resume point nobody has yet needed to resume from.

---

## `/schedule/{date}` is not used by the season sweep

Asserted, not merely intended (test 14): after a full sweep over the captured
evidence, the recorded calls are exactly

```
tournament_season_events_last  page 0
tournament_season_events_last  page 1
tournament_season_events_last  page 2
tournament_season_events_next  page 0
```

and the test additionally asserts no call has key `schedule`. No match-level
endpoint is reachable from the pager, which resolves only the two season keys.

---

## Test evidence

**19 tests added** in `__tests__/seasonSweep.test.ts` — 9 with no database, 10
against one.

| # | Test | Requirement |
|---|---|---|
| 1 | every scope flag is required | §3 |
| 2 | the window reaches the parsed arguments as given | §8 |
| 3 | an inverted range is refused before any fetch | §3 |
| 4 | a malformed date is refused | §3 |
| 5 | `--max-calls` is the sweep budget and defaults sanely | §3 |
| 6 | `season` does not disturb `schedule` or `squads` | regression |
| 7 | **one budget, shared** — `last` spends first, `next` gets the remainder | §7 |
| 8 | a zero budget makes no call | §7 |
| 9 | quota remaining is carried, never computed | §7 |
| 10 | **an out-of-scope event is REJECTED, not imported** | §5 |
| 11 | without a scope the same writer accepts everything | §2 |
| 12 | the schedule path reaches the same writer and still works | §2 |
| 13 | **structurally one writer** — the schedule path delegates; one event loop | §2 |
| 14 | **a season sweep never touches `/schedule/{date}`** | §8 |
| 15 | pager output reaches the writer: 47 fixtures, 43 completed, 4 postponed, 43 results, 1 edition | §8 |
| 16 | a repeated sweep is idempotent | §8 |
| 17 | a successful sweep opens a run, a job, write records, and completes | §8 |
| 18 | a failing sweep is recorded as **FAILED** in the run ledger | §8 |
| 19 | an invalid window is refused **before the run is opened** | §8 |

### Suite counts

| | Before | After |
|---|---|---|
| `npm test`, **no database** | 341 pass / 341 | **350 pass / 350** |
| `npm test`, **with database** | 517 pass, 14 fail / 531 | **536 pass, 14 fail / 550** |
| `npx tsc --noEmit` | clean | **clean** |

**+19 tests, all passing.**

**Pre-existing environmental failures — 14, unchanged.** Filtered explicitly:
there are **no failures outside the known set**. They are per-role connection
health (7), `ALTER ROLE` statement timeouts, unknown-credential rejection,
`UPDATE`/`DELETE` privilege denial (4), and one `pt_platform_admin` privilege
test. The scratch cluster uses trust auth and a single superuser login, so grants
and RLS cannot bite. None is in the ingestion path.

`lint:reads` reports 64 against a baseline of 57 — **unchanged by this diff**.

**Scratch database:** PostgreSQL 16, migrations 001–022 applied with zero errors,
S-3 seed applied. `pg_cron` skipped and `auth` stubbed, harness-only. Torn down.

### Two defects found by the tests, both fixed

- **`ingestSeason` loaded the provider config even when a client was injected**,
  so a caller supplying its own client still had to set
  `PT_V2_PROVIDER_BASE_URL`. Config is now loaded only to *build* a client.
- **Two `after` hooks each calling `closeAllPools()`** raced: the first fired
  when its own `describe` ended and the pool guard correctly refused connections
  to the next one. One shutdown hook per file now.

---

## What was NOT done

- **No live provider call.** Verified: with no `SPORTSAPI_KEY` the CLI prints its
  resolved configuration and then fails on missing provider configuration —
  before any request.
- No credentials required for this step, and none are present in this container.
- No second ingestion architecture, no duplicated writer, no new run ledger.
- No migration. No schema change. No resume table.
- No broadening beyond one competition and one season.
- `ingestSchedule` and `ingestSquads` are untouched in behaviour.

---

## Ready for the live run

`npm run ingest:v2 -- season --tournament 325 --season 87678 --from 2026-05-31
--to 2026-08-11 --max-calls 10`

Expected: 4 calls, 120 events read, 47 selected, 43 completed, 4 postponed, 43
results, 1 edition — the numbers the replay proof already produces from the
captured bodies. It needs `SPORTSAPI_KEY` and the `PT_V2_DB_*` credentials, which
this container does not have.

**Awaiting review of this deliverable before that run.**
