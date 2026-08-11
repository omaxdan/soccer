# Phase 8 S-6 — Live Single-Season Run: PREFLIGHT, NOT EXECUTED

Code-path review performed as instructed. **Three independent blockers. No
provider call was made, no database was written, and no code was changed.**

The live proof document is not written, because there is nothing to prove yet.
It should take the next number when the run happens.

---

## Verdict

| Blocker | Detail |
|---|---|
| **B-1 — the season sweep does not exist** | `pageSeasonEvents` and `sweepSeason` have **no caller outside tests**. There is no code path that walks a season's feed and writes fixtures. |
| **B-2 — no provider credential in this environment** | `SPORTSAPI_KEY` is absent from the process environment, and there is **no `.env` file** in the container. |
| **B-3 — no V2 database credential** | `PT_V2_DB_HOST`, `PT_V2_DB_NAME`, `PT_V2_DB_PASSWORD` are all absent, from the environment and from any `.env`. |

B-1 is the substantive one. B-2 and B-3 are environmental and may be a matter of
supplying secrets to this session; **B-1 is missing code.**

---

## The twelve-point review

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | The sweep uses the new `competition_edition` resolver | **FAILS — no sweep exists** | `grep pageSeasonEvents\|sweepSeason src/` returns only `pager.ts` and its tests |
| 2 | `season_period` derives from `season.year`, never fixture kickoff | **TRUE** | `stages/schedule.ts:264` — `seasonPeriod(text(season?.year)) ?? seasonPeriod(text(season?.name))`; `seasonPeriod` takes **no kickoff parameter** |
| 3 | The provider alternate key is the conflict target | **TRUE** | `entities/reference.ts:147` — `conflictTarget: ['provider_external_id']`, `immutableColumns: ['season_period', 'competition_id']` |
| 4 | The U-9 identity lookup runs before the fixture upsert | **TRUE** | `entities/fixtures.ts:246` — `findFixtureByProviderIdentity` precedes `upsertMutable` |
| 5 | `fixture_partition_on` is reused from the existing fixture on replay | **TRUE** | `entities/fixtures.ts:247` — `partitionForWrite(existing, …)`; `immutableColumns: ['fixture_partition_on']` |
| 6 | Lifecycle transitions use the stored previous state | **TRUE** | `entities/fixtures.ts:248` — `existing?.lifecycleState ?? null`, then `lifecycleTransitionFor` |
| 7 | The pager uses the verified `last`/`next` contract | **TRUE** — but unreachable | `pager.ts`; proven by 5 pager tests and 17 replay tests |
| 8 | Historical and forward windows are explicit configuration | **PARTIAL** | `FIXTURE_WINDOW` (`pager.ts:82`) is a module constant; `SweepOptions.window` is optional. **No CLI flag, no environment variable, no caller** — see below |
| 9 | No match-level endpoint is called | **TRUE of the pager** | It resolves only `tournament_season_events_last\|next` |
| 10 | No unrelated competition or season can be written | **FAILS for the only wired path** | `ingest:v2` calls `/schedule/{date}` (`stages/schedule.ts:167`), which returns **every competition playing that day** |
| 11 | Every provider call stays inside the call budget | **TRUE of the pager** | `callBudget` is a required field of `SweepOptions`, checked each iteration |
| 12 | Resumable/repeatable, no duplicates on a second run | **PARTIAL** | Idempotency is **proven** (replay tests 15, 4). `resumeFromPage` is returned but **nothing persists it**, because nothing calls the pager |

**Eight of twelve hold. Two fail, two are partial, and every failure traces to
B-1.**

---

## B-1 — what is actually missing

The pager's own header says so, and it is still true:

> **THIS PAGER DOES NOT WRITE.** … The write path consumes `PagedEvent` when
> ingestion is authorised; **that wiring is deliberately absent.**

Two halves exist and have never been joined in production code:

| | Reads | Writes | Entry point |
|---|---|---|---|
| **Season pager** | `tournament/{id}/season/{id}/events/{last\|next}/{page}` | nothing | **none** |
| **Schedule stage** | `/schedule/{date}` — fetches its own payload | everything | `ingest:v2` |

`ingestScheduleDate(tx, client, date)` **fetches for itself**. It cannot be handed
events the pager already selected. In the doc-40 replay proof I bridged this with
a test-scoped adapter (`__tests__/support/replay.ts`) that answers `client.get`
with events already in hand — explicitly a test harness, not a production path.

### Why the existing `ingest:v2` must not be used instead

`npm run ingest:v2 -- --from 2026-05-31 --to 2026-08-11` would run, and would be
wrong on three of your own hard-stop conditions:

- **"another competition/season is written"** — the date feed returns every
  competition playing that day, worldwide. 73 days of global fixtures, not one
  Brazilian season.
- **"an unexpected provider endpoint is called"** — `/schedule/{date}`, not the
  season feed the traversal you specified (`last/0`, `last/1`, `last/2`,
  `next/0`) describes.
- **Budget** — 73 calls against a 200/day budget, and the guard would refuse it
  without `--allow-over-budget`.

It would also not exercise the pager, the window, or the termination logic — the
things this validation exists to test.

### Item 8, precisely

`FIXTURE_WINDOW` is correct and carries the specified dates
(`2026-05-31T00:00:00Z` → `2026-08-11T23:59:59.999Z`), but it is a **module
constant with no consumer outside the pager and its tests**. "Explicit
configuration" in the sense your checklist means — a value an operator sets for a
run and can see in the run record — does not exist, because there is no run to
configure.

---

## What executing would require

Roughly one file. Stated for approval, **not built**:

1. **An orchestrator** — `sweepSeason` → `PagedEvent[]` → the writer, inside
   `withPipelineRun`/`withRun` so the S-2 job lifecycle, `write_record` and
   `api_usage` accounting apply as they do for the date feed.
2. **A production adapter** for what the test harness does: a way to write events
   already in hand. Either a small exported function beside `ingestScheduleDate`
   that takes events instead of fetching them, or splitting the existing one into
   fetch and write halves. The second is cleaner and touches a stage you have
   ruled off-limits in past steps, so it needs your call.
3. **A CLI surface** — `ingest:v2 season --tournament 325 --season 87678
   --from … --to … --budget N` — which is where the window becomes explicit
   configuration and satisfies item 8.
4. **Resume persistence** for item 12, or an explicit statement that a
   single-season run is small enough not to need it (4 calls, so it is).

Items 2–7, 9 and 11 are already in place and were re-verified above; the
orchestrator inherits them rather than reimplementing them.

---

## What is already proven without a live call

The doc-40 replay proof runs **this exact traversal** — `last/0`, `last/1`,
`last/2`, `next/0` — through the real pager and the real writer against a real
database, and after the F-1 fix produces:

| | |
|---|---|
| Events read / selected | 120 / **47** |
| Fixtures | **47** — 43 completed, 4 postponed, 0 scheduled |
| Results | **43** |
| Competition editions | **1**, `[2026-01-01,2027-01-01)`, provider season 87678 |
| Second identical pass | zero new rows, zero partition changes, zero fabricated transitions |

Those are the same numbers your checklist expects. **What a live run would add is
not the arithmetic — it is whether the provider today still returns what it
returned on 11 August**, plus real quota headers, real latency, and the
operational layer's record of a real run. That is worth doing; it is just not
what is blocked on arithmetic.

---

## Recommendation

Approve the orchestrator as its own small step — items 1–4 above, with the
decision on how to split `ingestScheduleDate` made explicitly — then run the live
validation against it. Supplying `SPORTSAPI_KEY` and the `PT_V2_DB_*` credentials
to this session unblocks B-2 and B-3 at the same time.

**Two full passes of this season cost 8 provider calls** against a 200/day
budget, so quota is not a constraint here.

**Nothing has been executed, and no code has been changed.**
