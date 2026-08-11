# Phase 8 S-5 — Controlled Fixture-Ingestion Replay Proof

The real pager and the real writer, run against the four captured Brasileirão
responses and a real V2 database built from the real migrations and seed. **No
provider calls, no quota, no sweep, no schema change.**

| Label | Meaning |
|---|---|
| **REPLAY VERIFIED** | Observed in the scratch database during this replay |
| **SCHEMA VERIFIED** | Read from `v2/migrations/*.sql` |
| **CODE VERIFIED** | Read from `beta/backend/src/v2/` |

---

## Verdict

**19 of the 20 required proofs pass. One defect was found, and it blocks the
sweep.**

**F-1 — one provider season becomes two competition editions.** `season.id
87678`, labelled "Brasileiro Serie A 2026", produced **two**
`competition_edition` rows split at 1 July: 5 fixtures in one, 42 in the other.
Every season-level baseline computed from this competition would be split in
two. It is not a fixture-writer defect and nothing in this step's scope covers
fixing it, so it is reported rather than repaired.

Two lesser findings, F-2 and F-3, concern write telemetry rather than data.

---

## What was replayed

| | |
|---|---|
| Evidence | `docs/api-samples/v2-discovery/`, 4 captures, 120 events |
| Competition | 325 (Brasileirão Betano), season 87678 |
| Window | **2026-05-31T00:00:00Z → 2026-08-11T23:59:59.999Z**, unchanged |
| Database | PostgreSQL 16, scratch cluster, all 21 migrations, S-3 seed (146 rows) |
| Provider calls | **0** |

The harness is two adapters and nothing else (`__tests__/support/replay.ts`):
one serves `EventPageSource` from files, one answers the single method
`ingestScheduleDate` calls. Everything between them — window selection,
ordering, scoring, identity, partitioning, lifecycle — is production code,
unmodified.

The season feed wraps events in `data`; the schedule feed does not. That
unwrapping happens in the harness, because it is a difference between two
provider endpoints rather than a defect in the stage.

---

## 1. The walk — REPLAY VERIFIED

| Feed | Page | Read | In window | Dupes | Rejected | `hasNextPage` | Ascending | Range (UTC) |
|---|---|---|---|---|---|---|---|---|
| `last` | 0 | 30 | **30** | 0 | 0 | true | ✓ | 2026-07-25T21:30 → 2026-08-09T22:30 |
| `last` | 1 | 30 | **17** | 0 | 0 | true | ✓ | 2026-05-23T22:00 → 2026-07-23T22:30 |
| `last` | 2 | 30 | **0** | 0 | 0 | true | ✓ | 2026-05-02T21:30 → 2026-05-23T20:00 |
| `next` | 0 | 30 | **0** | 0 | 0 | true | ✓ | 2026-08-15T19:30 → 2026-08-30T18:00 |

- **Events read: 120. Selected by window: 47. Duplicates detected: 0. Rejected by the pager: 0. Ordering anomalies: 0.**
- Calls: **4**, all to `tournament_season_events_last|next`. No match-level endpoint.
- Both walks stopped `BEYOND_WINDOW`.

**The cross-page boundary behaves as specified.** Page 1 straddles the floor and
its 17 in-window fixtures are kept; page 2 is fetched, found wholly below the
floor, and ends the walk. The conservative rule — fetch, then decide — is intact.

The boundary is applied **per event, not per page**:

| Fixture | Kickoff | In window? |
|---|---|---|
| `15235584` | 2026-05-31T14:00:00Z | **yes** — the earliest selected |
| `15235580` | 2026-05-30T23:00:00Z | **no** — fifteen hours below the floor, same page |

`next/0` was read in full and contributed nothing, because the window closes on
11 August and the forward feed opens on the 15th. Correct behaviour, and the
subject of the separate forward-horizon decision.

---

## 2. Write counts — REPLAY VERIFIED

Per-relation, from `StageCounts`, first pass then an identical second pass:

| Relation | Pass 1 examined / written / skipped / rejected | Pass 2 |
|---|---|---|
| `football.competition` | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 |
| `football.competition_edition` | 2 / 2 / 0 / 0 | 2 / 2 / 0 / 0 |
| `football.competition_stage` | 6 / 6 / 0 / 0 | 6 / 6 / 0 / 0 |
| `football.venue` | 20 / 20 / 0 / 0 | 20 / 20 / 0 / 0 |
| `football.team` | 20 / 20 / 0 / 0 | 20 / 20 / 0 / 0 |
| `football.team_registration` | 94 / 94 / 0 / 0 | 94 / 94 / 0 / 0 |
| `football.fixture` | **94** / 94 / 0 / 0 | **47** / 47 / 0 / 0 |
| `football.fixture_lifecycle_transition` | **0** / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `football.result` | 47 / 43 / **4** / 0 | 47 / 43 / **4** / 0 |

Resulting rows, scoped to competition 325:

| | |
|---|---|
| Fixtures | **47** |
| — completed | **43** (`status.code` 100) |
| — postponed | **4** (`status.code` 60) |
| — scheduled/unplayed | **0** (the window excludes the forward feed) |
| Results | **43** — one per completed fixture, none for any other |
| Lifecycle transitions | **47** |
| Venues | **20**, all complete |
| Teams | **20** |
| Competitions | **1** |
| Editions | **2** ← **F-1** |
| Stages | **6** |
| Duplicates detected | **0** |
| Fixtures rejected | **0** |

**Inserted vs updated.** Pass 1 inserted 47; pass 2 inserted 0 and updated 47 —
derived from row counts, because the counters cannot distinguish the two (F-3).

---

## 3. Findings

### F-1 — one provider season becomes two editions. **BLOCKS THE SWEEP.**

REPLAY VERIFIED:

| `season_period` | Fixtures | First kickoff | Last kickoff |
|---|---|---|---|
| `[2025-07-01, 2026-07-01)` | **5** | 2026-05-31 14:00Z | 2026-05-31 23:30Z |
| `[2026-07-01, 2027-07-01)` | **42** | 2026-07-16 22:30Z | 2026-08-09 22:30Z |

Both carry `provider_external_id = 87678` and `season_label = "Brasileiro Serie
A 2026"`. One provider season; two platform editions.

**Cause** — CODE VERIFIED, `stages/schedule.ts` `seasonPeriod()`. The label
matches neither the split-season pattern `(\d{4})\s*[/\-–]\s*(\d{2,4})` nor the
calendar pattern `^(\d{4})$`, which is anchored and so rejects any label with
words in it. Execution falls to the kickoff-derived fallback, which returns a
**different period for each fixture** depending on which side of 1 July it lands.
The Brasileirão's mid-2026 break happens to fall exactly across that line, so
the season is cut in two.

**Why the schema permits it** — SCHEMA VERIFIED. The business key is
`uq_competition_edition__competition_period (competition_id, season_period)`, and
`provider_external_id` is "an alternate key, not business identity". Two rows
with one provider id and two non-overlapping periods satisfy every constraint,
including `ex_competition_edition__periods_do_not_overlap`. Nothing objects.

**Impact.** `competition_edition` is described in doc 07 as "THE most
load-bearing entity in Layer 1". A split edition splits standings, season
statistics, registrations (94 written where 40 are meant — 20 teams counted twice
across two editions) and every calibration population keyed on the edition. It
is silent: both halves look like healthy seasons.

**Scope.** This affects **any competition whose season label is not exactly four
digits and whose season spans 1 July** — every calendar-year league in the
tracked set, and any European league whose label the provider writes in prose.
It is a schedule-stage defect, not a fixture-writer one, and repairing it is
outside this step's scope. Tracked as a `todo` test that states the invariant it
violates: one provider season, one edition.

### F-2 — lifecycle-transition writes are counted against `football.fixture`

`football.fixture` reports 94 examined on a first pass over 47 fixtures.
`recordLifecycleTransition` is handed the fixture's own counter, so its 47 writes
land there, while `football.fixture_lifecycle_transition` reports **0** despite
47 rows existing. The stage creates the bucket and comments that it is
attributing them "where they belong", but the counts are never moved.

Telemetry only — no data is affected — but `operations.write_record` would
record a fixture count roughly double the truth on any run that creates
fixtures, and zero for transitions always.

### F-3 — the write counters cannot distinguish an insert from an update

`upsertMutable` counts every successful statement as `written`. A pass that
inserted 47 fixtures and a pass that updated 47 are indistinguishable in
telemetry: both report `examined 47, written 47, skipped 0`. The distinction had
to be derived from row counts for this report. Relevant to the sweep, where
"how much of this competition was new?" is the question an operator will ask.

**None of F-1, F-2 or F-3 was introduced by the U-9 fix.** All three are
pre-existing and were surfaced by running real payloads through the real writer.

---

## 4. Representative fixtures — REPLAY VERIFIED

### A completed fixture

```
provider_external_id  15235404          lifecycle_state_code  COMPLETED
fixture_partition_on  2026-07-25        provider_status_raw   Ended
scheduled_kickoff_at  2026-07-25T21:30:00Z
home / away           Athletico / Internacional
result                2–0   (half-time 1–0)
venue                 1129 · Arena da Baixada · Curitiba · BR · 43 000
coordinates           -25.447930, -49.277030
```

`homeScore.current`/`normaltime` → 2–0; `period1` → 1–0. Both correct.

### A postponed fixture — scoreless, not nil-nil

```
provider_external_id  15235414          lifecycle_state_code  POSTPONED
fixture_partition_on  2026-07-30        provider_status_raw   Postponed
scheduled_kickoff_at  2026-07-30T18:00:00Z
home / away           Atlético Mineiro / Red Bull Bragantino
result                NO ROW            home_goals / away_goals  NULL
venue                 41245 · Arena MRV · Belo Horizonte · BR · 44 892
```

`homeScore: {}` and `awayScore: {}` produced **no result row at all**. Verified
globally: **zero results exist for any fixture not in `COMPLETED`.**

### A scheduled/unplayed fixture

Replayed from `next/0` directly, since the configured window excludes the
forward feed. The window itself is unchanged.

```
provider_external_id  15235422          lifecycle_state_code  SCHEDULED
fixture_partition_on  2026-08-15        provider_status_raw   Not started
scheduled_kickoff_at  2026-08-15T19:30:00Z
home / away           Fluminense / Palmeiras        ← slug is `palmeiras-fluminense`
result                NO ROW
venue                 686 · Estádio do Maracanã · Rio de Janeiro · BR · 78 838
```

30 unplayed fixtures written, **0 results**. Score normalisation is identical to
the postponed case, as the contract requires — the two are distinguished by
`status.code` alone.

**And the slug is ignored.** This fixture is slugged `palmeiras-fluminense` and
Fluminense is home. 16 of the 30 forward events are slugged in away-home order.

### A fixture on the historical boundary

```
provider_external_id  15235584          lifecycle_state_code  COMPLETED
scheduled_kickoff_at  2026-05-31T14:00:00Z    ← the window floor
fixture_partition_on  2026-05-31
home / away           Red Bull Bragantino / Internacional
result                3–1   (half-time 2–0)
```

`15235580`, fifteen hours earlier on the same page, was **not** written.

### A rescheduled fixture crossing a year boundary

```
provider_external_id         15235404
original startTimestamp      1785015000   → 2026-07-25T21:30:00Z
new startTimestamp           1805036400   → 2027-03-14T15:00:00Z
stored fixture_partition_on  2026-07-25          ← UNCHANGED
physical table/partition     football.fixture_p2026
fixture id before / after    3946 / 3946         ← the same row
total fixtures after         47                  ← no second row
```

The row is **physically** in the 2026 partition, not merely reporting a 2026
date. U-9 holds against a real payload.

---

## 5. The twenty required proofs

| # | Proof | Result |
|---|---|---|
| 1 | `last/0,1,2` produce the expected fixture universe | **PASS** — 120 read, 47 selected, 47 written |
| 2 | The window 2026-05-31 → 2026-08-11 is applied correctly | **PASS** |
| 3 | Cross-page boundary; no in-window fixture discarded | **PASS** — page 1 keeps 17, page 2 ends the walk |
| 4 | No duplicate fixture on replay | **PASS** — 47 before and after |
| 5 | `homeScore.current` / `awayScore.current` → correct result | **PASS** — 2–0 |
| 6 | `period1` → correct half-time | **PASS** — 1–0 |
| 7 | Postponed with `{}` stays scoreless, never 0–0 | **PASS** — no result row |
| 8 | `next/0` unplayed behave identically | **PASS** — 30 fixtures, 0 results |
| 9 | `status.code` distinguishes the three states | **PASS** — 100/60/0 → COMPLETED/POSTPONED/SCHEDULED |
| 10 | Participants from explicit fields, never `slug` | **PASS** — Fluminense home despite the slug |
| 11 | Venue id/name/capacity/city/country/coordinates persist | **PASS** — 20/20 complete |
| 12 | Embedded result sufficient; no match-level call | **PASS** — 4 calls, all season-feed |
| 13 | Provider external ids stable through replay | **PASS** |
| 14 | Replay is idempotent | **PASS** — every count identical |
| 15 | Rescheduled fixture reuses its partition | **PASS** |
| 16 | Year-boundary reschedule stays in its partition | **PASS** — `fixture_p2026` |
| 17 | No fabricated `null → SCHEDULED` for a historical fixture | **PASS** — only `null→COMPLETED:43`, `null→POSTPONED:4` |
| 18 | Postponed → reopened follows the lifecycle | **PASS** — `null→POSTPONED`, `POSTPONED→SCHEDULED`, one fixture |
| 19 | Duplicated identity across partitions detected | **PASS** — `AmbiguousFixtureIdentityError`, both partitions named, nothing repaired |
| 20 | Earlier reschedule still fails the CHECK | **PASS** — SQLSTATE 23514, `ck_fixture__partition_not_after_kickoff` |

**Not among the twenty, and failing: F-1.**

---

## 6. Verification

| | Before | After |
|---|---|---|
| `npm test`, no database | 329 pass / 329 | **334 pass / 334** |
| `npm test`, with database | 476 pass, 14 fail / 490 | **497 pass, 14 fail, 1 todo / 512** |

`npx tsc --noEmit` clean.

The **14 failures are pre-existing and environmental**, verified by running the
same database against stashed code and obtaining the identical 14: per-role
connection health, `ALTER ROLE` statement timeouts, unknown-credential
rejection, and privilege-denial tests. The scratch cluster uses trust auth and a
single superuser login, so grants and RLS cannot bite. None is in the fixture
path.

The **1 todo is F-1**, stated as the invariant it violates so the defect is
tracked in the suite rather than in a document alone.

**Scratch database.** PostgreSQL 16, all 21 migrations applied with zero errors,
S-3 seed applied (146 rows). Two harness-only accommodations, neither touching
the repository: `pg_cron` is skipped (a Supabase extension unavailable locally)
and `auth.users` / `auth.uid()` are stubbed. The cluster is torn down after use.

**A note on test isolation.** `feature/__tests__/fixtures.ts` deliberately
COMMITS football rows, and `node --test` runs files concurrently, so every count
in this replay is scoped to competition 325. A global `count(*)` passes alone and
fails in the suite.

---

## 7. Recommendation

**Do not begin the single-competition live sweep until F-1 is resolved.** The
fixture writer is proven; the edition resolver is not. A sweep run today would
write a correct fixture universe into a competition-edition structure that
silently splits calendar-year seasons — and the damage is invisible, because both
halves look like healthy seasons.

The likely shape of the fix, **not implemented and not authorised**: derive the
season period from `season.id` and the season's own fixture span rather than from
a per-fixture kickoff, or treat `provider_external_id` as the resolution key for
an edition and the period as an attribute of it. The second is a change to what
identifies an edition and deserves its own investigation before anyone writes it.

F-2 and F-3 are telemetry and should be fixed before the sweep only if the
operator needs accurate per-relation counts to judge it. Neither affects data.

**Still gated:** the 56-competition sweep, the live single-competition sweep,
match-level fan-out, derived calculations, raw-response persistence, and the
forward-horizon decision.
