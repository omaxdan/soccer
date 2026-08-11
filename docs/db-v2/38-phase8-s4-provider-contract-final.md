# Phase 8 S-4 — Provider Contract, Final (Deliverable 2)

Supersedes and **corrects** [doc 37](./37-phase8-s4-provider-response-report.md).
Doc 37 is retained unedited; §8 below lists exactly what it got wrong.

| Label | Meaning |
|---|---|
| **LIVE VERIFIED** | Body inspected in this repository |
| **LIVE REPORTED** | Observed on the operator's machine and reported here, body **not** available to this report |
| **REPOSITORY VERIFIED** | Guaranteed by V2 code or the migration set |
| **UNKNOWN** | Not established |

## Evidence available to this report

**Revised.** All six captures are now in `docs/api-samples/v2-discovery/`. §4 is
complete, U-3a and U-3b are closed, and the `events/next` interior is LIVE
VERIFIED rather than reported.

| Call | Status | Body here? | Class |
|---|---|---|---|
| `tournament_seasons` / 325 | 200 | **yes**, 2 187 B | LIVE VERIFIED |
| `events/last/0` | 200 | **yes**, 131 997 B | LIVE VERIFIED |
| `events/last/1` | 200 | **yes**, 133 460 B | LIVE VERIFIED |
| `events/last/2` | 200 | **yes**, 132 577 B | LIVE VERIFIED |
| `events/last/999` | **404** | **no body exists** — `body: null`, `bodyBytes: 0` | LIVE VERIFIED |
| `events/next/0` | 200 | **yes**, 118 870 B | LIVE VERIFIED |

**Integrity.** For each of the five 200s the `responseSha256` recorded at capture
time was recomputed from the committed body and matches, and `bodyBytes` matches
the serialised length. `events/last/2` → `624baff59f08…`, `events/next/0` →
`5f2fe8bf6ffe…`. The files are unaltered captures, not transcriptions.

**One caveat on the 404 record.** Its `url`, `path` and `attempts` fields are
wrong — an artefact of a defect in the evidence writer, not of the provider:

| Field | As captured | Truth |
|---|---|---|
| `url` | `https://v2.football.sportsapipro.com/apitournament_season_events_last` | `…/api/tournament/325/season/87678/events/last/999` |
| `path` | `(see error)` | `/tournament/325/season/87678/events/last/999` |
| `attempts` | `0` | `1` |

The file is committed **verbatim** rather than corrected, because rewriting a
capture destroys its value as a capture. The true path is recoverable from the
record's own `error` string, which the client built from the resolved path. The
writer defect and the attempt-count defect behind it are both fixed — see §8.6.
The status, the `success: false` and the absence of a body — the evidence that
matters — were always correct.

---

## 1. Envelope shapes

### `tournament_seasons` — LIVE VERIFIED

```jsonc
{ "success": true, "source": "live", "tournamentId": 325,
  "seasons": [ { "id", "name", "year", "tournamentId" } ],
  "timezone": { "name", "utcOffset", "source", "country" } }
```

**No `data` wrapper.** The collection sits at the top level under `seasons`.

### `events/last` — LIVE VERIFIED

```jsonc
{ "success": true,
  "data": { "events": [ … ], "hasNextPage": true },
  "source": "live", "cacheHit": false,
  "timezone": { … } }
```

### `events/next` — LIVE VERIFIED, byte-identical envelope to `events/last`

```jsonc
{ "success": true,
  "data": { "events": [ … ], "hasNextPage": true },
  "source": "live", "cacheHit": false,
  "timezone": { … } }
```

Same five top-level keys, same two `data` keys, same names. **One envelope
handler serves both directions.** No `next`-specific parsing is needed.

**The two envelope families differ and both must be handled.** Seasons is flat;
events wraps in `data`. `firstSeasonId()` already handles both.
REPOSITORY VERIFIED.

### The envelope `timezone` is a property of the REQUEST — LIVE VERIFIED

Within a single discovery session against a single competition and season, the
envelope reported two different zones:

| Capture | `timezone.name` | `country` |
|---|---|---|
| `seasons`, `last/0`, `last/1` (04:30Z) | `Europe/Paris` | FR |
| `last/2` (04:50Z) | **`Europe/Zurich`** | **CH** |
| `next/0` (04:51Z) | `Europe/Paris` | FR |

Nothing about the data changed between 04:50 and 04:51. This was previously an
inference — "the envelope timezone is the account's location" — and is now
demonstrated: it is not stable even across consecutive calls, so it cannot be a
property of the fixtures. It carries `"source": "auto"`, i.e. the provider is
geolocating the caller. **It must never touch a kickoff**, and it must not be
persisted as competition or fixture metadata.

## 2. Field locations and types

All LIVE VERIFIED across all four 200-response pages — `events/last/0`, `/1`,
`/2` and `events/next/0`, 120 events — unless marked.

| Concept | Path | Type | Note |
|---|---|---|---|
| Event collection | `data.events` | array | |
| Pagination flag | `data.hasNextPage` | boolean | **only ever observed `true`** — see §3 |
| Other pagination metadata | — | — | **none**: no total, no page count, no page size |
| Event id | `event.id` | integer | e.g. `15235404`; the only stable identity |
| Competition identity | `event.tournament.uniqueTournament.id` | integer | **325** |
| Season instance | `event.tournament.id` | integer | **83** — NOT competition identity |
| Edition / season | `event.season.id` | integer | **87678** |
| Kickoff | `event.startTimestamp` | integer | Unix epoch **seconds**, UTC |
| Status | `event.status` | `{code:int, description:string, type:string}` | |
| Home / away team | `event.homeTeam` / `event.awayTeam` | object with `id`, `name`, `slug`, `shortName`, `nameCode`, `country{alpha2,…}` | |
| Scores | `event.homeScore` / `event.awayScore` | object | `current`, `display`, `period1`, `period2`, `normaltime` |
| Winner | `event.winnerCode` | integer | 1 home, 2 away, 3 draw; **absent when unplayed** |
| Venue | `event.venue` | object | `id`, `name`, `slug`, `capacity`, `city{id,name,country}`, `country` |
| Coordinates | `event.venue.venueCoordinates` | `{latitude, longitude}` | floats |
| Round | `event.roundInfo` | `{round:int}` | integer only in this sample |
| Unplayed representation | `homeScore`/`awayScore`/`time` = `{}`, `winnerCode` absent | | |

Secondary: `customId` (opaque string), `slug` (see §5), `homeRedCards` /
`awayRedCards` (integer counts, key present on some events only — 1 or 2 where
present, `null` on the rest; never present in `events/next`),
`changes.changeTimestamp`.

Present on every event in both feeds and carrying nothing usable in this sample:
`eventState` is `{}` on all 120 events; `detailId`, `feedLocked`,
`finalResultOnly`, `isEditor`, `crowdsourcingDataDisplayEnabled`,
`hasGlobalHighlights`, `eventFilters` are provider display concerns. **None of
them is ingested.**

## 3. Pagination behaviour — U-2 CLOSED

| Feed | Page | Status | Events | Date range (UTC) | `hasNextPage` |
|---|---|---|---|---|---|
| `last` | 0 | 200 | **30** | 2026-07-25T21:30 → 2026-08-09T22:30 | `true` |
| `last` | 1 | 200 | **30** | 2026-05-23T22:00 → 2026-07-23T22:30 | `true` |
| `last` | 2 | 200 | **30** | 2026-05-02T21:30 → 2026-05-23T20:00 | `true` |
| `last` | 999 | **404** | — | — | — |
| `next` | 0 | 200 | **30** | 2026-08-15T19:30 → 2026-08-30T18:00 | `true` |

All five rows are now LIVE VERIFIED from committed bodies.

**No event id appears on more than one page**, in either feed or across them
(all six pairwise intersections of the four id sets are empty). Paging does not
duplicate, and `last` and `next` are disjoint.

### Page size

**LIVE VERIFIED: all four 200 pages returned exactly 30 events** — three `last`
pages and one `next` page.

**Still UNKNOWN: whether 30 is a guaranteed page size.** Four observations of the
same number is stronger than two, and it is now the same number in *both* feeds,
which makes a per-request coincidence implausible. It is still not a contract:
every page observed was a page the provider had enough events to fill, so a
fixed size and a maximum-that-was-reached remain indistinguishable. Nothing in
the response declares it — there is no page-size field. **The pager must not
hard-code 30, must not derive "is this the last page?" from a short page, and
must not compute a page count by dividing a total by 30.** A short page is not
evidence of the end; only `hasNextPage === false` or a 404 is.

### Is `hasNextPage` authoritative? — **NOT ESTABLISHED**

This is the correction that matters most. **`hasNextPage: false` has never been
observed.** It was `true` on all four 200 pages — including `next/0`, which for
a season 23 rounds into 38 plausibly *is* near the end of the forward feed — and
page 999 returned **404** rather than a 200 carrying `hasNextPage: false`.

Two readings remain open and the evidence cannot separate them:

- the flag does go false on the true last page, and 999 is simply far past it; or
- the flag is always `true` and **404 is the only real terminal signal**.

### Termination logic the evidence supports

Three independent stops, whichever fires first:

1. **404** — proven terminal. `ProviderRequestError.isNotFound` already exists
   (`client.ts:63`), and the retry loop **breaks on 404 without retrying**
   (`client.ts:229`), so a terminal page costs exactly one call. REPOSITORY VERIFIED.
2. **`hasNextPage === false`** — honoured if it ever appears. Cheap, correct if
   the flag is real, harmless if it never fires.
3. **The date floor** — stop once a page's newest event predates the window
   start. For Brasileirão this fires on **page 1** (min 2026-05-23, before the
   2026-05-31 floor), so ingestion never needs page 2 at all.

A page-count limit is **not** a termination condition and must not be one.

## 4. `events/last` vs `events/next`, field by field — **COMPLETE, LIVE VERIFIED**

Comparison of `events/last/0` (30 events) against `events/next/0` (30 events).

### Identical

| Property | Both feeds |
|---|---|
| Envelope | `{success, data:{events, hasNextPage}, source, cacheHit, timezone}` |
| Events per page | 30 |
| `hasNextPage` | `true` |
| Intra-page ordering | **ascending** by `startTimestamp` (non-strict — `next/0` has ties, ten fixtures share 1788112800) |
| `tournament.uniqueTournament.id` | `325` on every event |
| `tournament.id` | `83` on every event |
| `season.id` | `87678` on every event |
| `roundInfo` | present on 30/30, `{round:int}` |
| `venue` | present 30/30, `venueCoordinates` 30/30 |
| `homeTeam` / `awayTeam` | same object shape, `id` / `name` / `slug` / `nameCode` / `country` |
| `slug` unreliable | **yes in both** — 16 of 30 `next` events have `slug` in away-home order (e.g. `15235422`, slug `palmeiras-fluminense`, is Fluminense **home** v Palmeiras) |
| `eventState` | `{}` on all 60 |

**The byte-size difference (118 870 vs 131 997) is entirely the absent
result-side fields below**, not a structural difference. The earlier refusal to
infer a contract from byte count was right, and the reason is now visible.

### Present in `last`, **absent** in `next`

Seven keys, all result-side:

`winnerCode`, `homeRedCards`, `hasXg`, `hasEventPlayerStatistics`,
`hasEventPlayerHeatMap`, `correctAiInsight`, `correctHalftimeAiInsight`.

The reverse set is **empty**: `next` introduces no key `last` does not have. So a
parser written against `last` reads `next` without modification, provided every
one of those seven is treated as optional.

### Different in value

| Field | `last/0` | `next/0` |
|---|---|---|
| `status` | `{100, "Ended", "finished"}` ×26, `{60, "Postponed", "postponed"}` ×4 | `{0, "Not started", "notstarted"}` ×30 |
| `homeScore` / `awayScore` | `{current, display, period1, period2, normaltime}` for ended | **`{}` on 30/30** |
| `time` | `{injuryTime1, injuryTime2, currentPeriodStartTimestamp, lastPeriodEndTimestamp}` | **`{}` on 30/30** |
| `winnerCode` | present on 26 ended events | **absent on 30/30** |
| `changes.changeTimestamp` | non-zero on 30/30 (1785021849 – 1786321479) | **`0` on 30/30** |
| `roundInfo.round` | 20, 21, 22 | 23, 24, 25 |

### U-3b closed: how an unplayed fixture represents itself

**An unplayed fixture is represented exactly as a postponed one**: `homeScore`,
`awayScore` and `time` are all `{}`, and `winnerCode` is absent. They are
distinguished **only** by `status.code` — `0` unplayed, `60` postponed.

Provider status `0` already maps to `SCHEDULED` in `LIFECYCLE_BY_PROVIDER_STATUS`
(`mapping/index.ts:72`). REPOSITORY VERIFIED. Nothing new is needed to ingest
the forward feed.

**This is the single most dangerous field in the payload.** `homeScore: {}` read
by anything that coerces missing to zero becomes a 0–0 result on a fixture that
has not kicked off, and it will do so on every future fixture in the universe.
The `winnerCode`-presence guard in §9 is what prevents it, and it is now
verified against real unplayed fixtures rather than inferred from postponed ones.

### The boundary between the two feeds — new, and a risk

At capture time (2026-08-11T04:51Z):

- `last/0` newest event: **2026-08-09T22:30Z**
- `next/0` oldest event: **2026-08-15T19:30Z**

A ~6-day window in which **no event appears in either feed**, and the capture
instant falls inside it. Rounds are continuous across it (22 → 23), and no event
id is shared, so nothing was dropped *between* pages. Two readings, and the
evidence cannot separate them:

- the competition genuinely has no fixture between 09 and 15 August, and the
  feeds meet cleanly; or
- there is a class of fixture — in progress, or very recently kicked off — that
  belongs to neither `last` nor `next`.

The Brasileirão is mid-season and a six-day gap after a full round is ordinary,
so the first reading is likelier. **It is not established**, and the pager must
not assume `last ∪ next` covers the season. Recorded as **U-8** in §7.

### Postponed fixtures carry a stale kickoff — new

All four postponed events on `last/0` are round 21, all timestamped
**2026-07-30T18:00Z** — the date they did *not* happen. They appear in the
**backward** feed at their original kickoff, not in `next` at a rescheduled one,
and the payload contains no replacement date.

Consequence for ingestion: a `POSTPONED` fixture's `startTimestamp` is the
abandoned time, and therefore so is its `fixture_partition_on`. When the fixture
is eventually replayed the provider will presumably supply a new timestamp,
which lands it in a **different partition** while
`uq_fixture__provider_external_id` is scoped by `(provider_code,
provider_external_id, fixture_partition_on)` — so the conflict target will not
match and a second row will be inserted for the same `event.id`. That is a
consequence of the partitioning key, is out of scope for the pager, and is
flagged here as **U-9** so it is decided before a rescheduled fixture arrives.

## 5. Previously identified findings, re-checked

| Finding | Verdict |
|---|---|
| Intra-page ordering **ascending** by `startTimestamp` | **CONFIRMED**, LIVE VERIFIED on all four 200 pages, both feeds. Non-strict: ties occur (`next/0` has ten events at 1788112800) |
| Cross-page: page N+1 entirely **earlier** than page N | **CONFIRMED** for 0 → 1 **and now 1 → 2**, LIVE VERIFIED. Page 2 max 2026-05-23T20:00Z < page 1 min 2026-05-23T22:00Z — contiguous, same day, no overlap |
| Paging does not duplicate | **CONFIRMED** — no event id occurs on two pages, and `last` and `next` share none |
| Round **not** chronological | **CONFIRMED** — page 1 carries rounds 19, 18, 17 **and 4**; two round-4 fixtures played 2026-07-17 and 07-23, ids `16390770`/`16390771` from a different range |
| Postponed uses **empty objects** | **CONFIRMED** — all 4 postponed events: `homeScore {}`, `awayScore {}`, `time {}`, `winnerCode` absent |
| `uniqueTournament.id` ≠ `tournament.id` ≠ `season.id` | **CONFIRMED** — 325 / 83 / 87678, three distinct integers in every event |
| `slug` unreliable for home/away | **CONFIRMED, and worse than reported** — `last/0` event `15235411` is Santos (home) v Chapecoense (away), slug `chapecoense-santos`; in `next/0` **16 of 30** events have `slug` reversed relative to `homeTeam`-`awayTeam`. Better than half the forward feed would be wrong |
| Venue completeness | **CONFIRMED** — 120/120 events across all four pages, 120/120 with coordinates |
| Result embedded | **CONFIRMED** — `current` full time, `period1` half time; no match call needed |
| Referee / manager / attendance | **CONFIRMED ABSENT** — 0/120 for `referee`, `manager`, `homeManager`, `awayManager`, `officials`, `attendance`, in both feeds |
| Unplayed uses **empty objects** | **CONFIRMED for genuinely unplayed fixtures**, not merely postponed ones — 30/30 on `next/0`. §4 |

Nothing established in doc 37 from bodies is overturned. Everything the four
newly-available and previously-available bodies could contradict, they confirm.

## 6. Budget, recomputed from observed counts

Observed for tournament 325, season 87678:

- 60 events across `last` pages 0–1; **47 fall inside 2026-05-31 → 2026-08-11**; 13 are earlier
- The date floor is reached **on page 1** (min 2026-05-23 < the 2026-05-31 floor)
- **Page 2 is entirely outside the window** — its newest event, 2026-05-23T20:00Z,
  already predates the floor. Confirmed rather than assumed: ingestion stops at
  page 1 and never issues the page-2 call
- The forward half is no longer a guess, but it is a **lower bound**:
  `next/0` returned `hasNextPage: true`, so at least one more `next` page exists
  for this competition and the sweep will discover the count

| | |
|---|---|
| Per competition, historical half | 1 seasons + **2** `last` pages = 3 calls |
| Per competition, forward half | **1+** `next` pages — at least 1, `hasNextPage` was `true` |
| **Per competition total** | **~4 calls, floor** |
| **56 tracked competitions** | **~224 calls, floor** |
| Daily quota | 200 |

**The forward half is where the estimate is soft.** The backward half is bounded
by the date floor, which is a hard stop; the forward half has no equivalent
bound in the evidence — a season with 15 rounds remaining could plausibly run to
several `next` pages. The pager must take a per-competition call budget and
persist a resume point rather than assume the sweep fits in one day.

**Roughly 1.1 days of quota for the entire fixture universe.** Two practical
notes: most European leagues are between seasons across much of this window and
should need fewer pages, not more; and a competition with no 2026 season costs
only its seasons call. The 224 is a ceiling, not an expectation.

Page 2 cost one call and bought contiguity evidence, not fixtures — correct for
discovery, unnecessary for ingestion.

## 7. What remains UNKNOWN before the pager

| # | Unknown | Blocks | Cost to close |
|---|---|---|---|
| ~~U-3a~~ | ~~`events/next` interior~~ | — | **CLOSED** §1, §4 — identical envelope |
| ~~U-3b~~ | ~~How an *unplayed* fixture represents scores/status/time~~ | — | **CLOSED** §4 — `{}` + absent `winnerCode`, status code 0 |
| **U-8** | Whether `last ∪ next` covers the whole season, or a fixture can fall in the ~6-day gap between the feeds (in progress, just kicked off) | Completeness of the fixture universe, not its correctness | 0 calls now — **detectable during the sweep**: count ingested fixtures per competition against `rounds × teams / 2` |
| **U-9** | A postponed fixture keeps its **abandoned** kickoff, so a rescheduled one arrives with a different `fixture_partition_on` and misses the `uq_fixture__provider_external_id` conflict target — a second row for the same `event.id` | Nothing in the first sweep; corrupts fixture identity thereafter | Decide before the second sweep, not before the first |
| **U-1** | Whether 30 is a guaranteed page size | Nothing, if the pager never assumes it | Not worth a call |
| **U-2b** | Whether `hasNextPage` ever goes `false` | Nothing, given 404 is terminal | Emerges during the first real run |
| **U-7** | Do all 56 competitions resolve a 2026 season? | Budget accuracy | Emerges during the sweep |
| **U-4/5/6** | Cup `roundInfo`, extra time, penalties, neutral venue | Nothing today — **`TRACKED_LEAGUES` contains no cup**, all 56 are leagues | Defer until a cup is tracked |

**Nothing blocks the pager.** U-8 and U-9 are new and neither is a blocker: U-8
is a completeness question answerable from the sweep's own output at no call
cost, and U-9 cannot bite until a postponed fixture is replayed. Both are
recorded so they are decided deliberately rather than discovered in the data.

## 8. Corrections to doc 37

1. **`hasNextPage` was over-trusted.** Doc 37 §5 said it "removes the need to
   infer a termination condition from an empty page" and §16 that it "gives a
   clean stop". **It has never been observed to go `false`**, and the real
   terminal signal observed is a **404**. Doc 37 did not anticipate a 404 at all.
   The pager must treat 404 as primary.
2. **U-2 predicted the wrong shape.** Doc 37 listed "empty array, 404, or error"
   as the possibilities and gave no primacy. **The answer is 404** — no 200 with
   an empty collection.
3. **Page size was under-qualified.** Doc 37 §3 said "page size is 30 on both
   observed pages. Whether 30 is fixed or a maximum is UNKNOWN" — accurate, but
   §16's budget then reasoned in whole pages as though 30 were dependable. The
   arithmetic survives because it rests on *observed date ranges*, not on 30.
4. **The budget was slightly optimistic.** Doc 37 gave ≈168 calls (3 per
   competition). It omitted the forward `next` pages. ≈224 is the corrected
   ceiling.
5. **The cup recommendation is withdrawn.** Doc 37 recommended a cup probe among
   the next calls. `TRACKED_LEAGUES` contains no cup, so U-4/5/6 concern
   competitions V2 does not ingest. Not disproven — **de-prioritised on evidence**.

6. **This document over-cautioned on `events/next`.** Before the body was
   available it recorded the interior as UNKNOWN and declined to infer it from
   the five matching top-level keys. That was the right call to make on the
   evidence — but the inference would have been correct, and the cost of the
   caution was one blocked section, not a wrong contract. Recording it because
   the reverse error is the one that matters: the caution was cheap.

### 8.6 Defects in the evidence tooling, found by reading its own output

Two, both now fixed, neither affecting any provider fact in this report.

- **The failure record's URL was scraped from the error message.**
  `discover.ts` built `url` as `` `${config.baseUrl}${failure?.message}`.split(' ')[0] ``,
  which for the 404 produced `https://…/apitournament_season_events_last` — a
  URL that has never existed and cannot be replayed. It now resolves the path
  through the same `resolvePath()` the client used, via a `requestPath()` helper
  that degrades to a marker rather than throwing inside the catch block and
  losing the original diagnosis.
- **`ProviderRequestError.attempts` reported the ceiling, not the spend.** The
  client passed `MAX_ATTEMPTS` (4) unconditionally, so a 404 — which breaks on
  the first attempt and costs exactly one call — claimed four. It now reports
  attempts actually made. This is quota accounting, and an overstatement there
  is not the conservative direction: it tells the next run it has less budget
  than it does. The evidence file's `attempts: 0` came from a *separate*
  hard-coded zero in the writer, now `failure.attempts`.

Both are pinned by tests: `requestPath` against the exact 999 request, and the
client's attempt count against a local server returning 404 (one attempt, one
request) and 500 (retried, reported count equals requests sent).

Not corrected: everything in doc 37 derived from response bodies. §5 above
re-checked each and all stand.

## 9. Pager contract — SPECIFICATION ONLY, not implemented

**Now unblocked.** Every rule below is LIVE VERIFIED or REPOSITORY VERIFIED.

### One pager, both directions
`last` and `next` share an envelope, a page size, an ordering rule, an event
shape and a `hasNextPage` flag (§4). **One implementation parameterised by
direction**, not two. The only direction-dependent logic is the date bound:
`last` stops at `windowStart` going backward, `next` stops at `windowEnd` going
forward.

### Inputs
`competitionProviderId` (from `uniqueTournament.id`), `seasonProviderId` (from
`season.id`), `direction` (`last` | `next`), `windowStart`, `windowEnd`,
`callBudget`.

### Termination — in this order, whichever fires first
1. `ProviderRequestError.isNotFound` → **stop, page consumed nothing further**
2. `data.hasNextPage === false` → stop
3. The page is entirely outside the window — every `startTimestamp` earlier than
   `windowStart` going backward, or later than `windowEnd` going forward → stop
4. Budget exhausted → stop and **persist the resume point**

### Forbidden by evidence
- No hard-coded page size; **30 must not appear in the pager**
- No page count computed from any total
- No "short page means last page"
- No termination on a fixed maximum page number
- No ordering assumption beyond: intra-page ascending **non-strictly** (ties are
  real — ten `next/0` events share one timestamp, so a strict-ascending
  assertion would fail on live data), and page N+1 earlier than N — and both must
  be re-checked, not trusted, when a page arrives
- **No assumption that `last ∪ next` is the whole season** (U-8)

### Per-event rules, all evidence-backed
- Identity `event.id`; **never** parse `slug` for participants — 16 of 30
  `next/0` slugs are reversed
- Competition `uniqueTournament.id`; **never** `tournament.id`
- Edition `season.id`
- Kickoff from `startTimestamp` × 1000; `fixture_partition_on` from its **UTC**
  date; the envelope `timezone` block is the caller's geolocation — proven, §1,
  it changed between two consecutive calls — and must not touch a kickoff
- Lifecycle via the existing `mapLifecycleState(status.code)`; raw preserved in
  `provider_status_raw`. Codes 0, 60 and 100 are all mapped
  (`mapping/index.ts:72`)
- **Write a `result` only when `winnerCode` is present** — an empty `homeScore`
  object must never become 0–0. This now guards 30/30 genuinely unplayed
  fixtures, not only postponed ones
- Treat all seven result-side keys as optional: `winnerCode`, `homeRedCards`,
  `hasXg`, `hasEventPlayerStatistics`, `hasEventPlayerHeatMap`,
  `correctAiInsight`, `correctHalftimeAiInsight`. None appears in `next`
- Filter the window on `startTimestamp`; **never** on `roundInfo.round`
- Venue, teams, competition, edition all resolve from the same payload — no
  supplementary call. 120/120 events carried a complete venue with coordinates

### Idempotency
`uq_fixture__provider_external_id (provider_code, provider_external_id,
fixture_partition_on)` makes re-running safe. REPOSITORY VERIFIED
(`005_fixture.sql:56`). Safe for the first sweep; see U-9 for the postponed case.

## 10. Summary by class

**LIVE VERIFIED** — the seasons envelope and `seasons[].id`; the events envelope,
**identical in both directions**, including `data.events` and
`data.hasNextPage`; 30 events on all four 200 pages; intra-page non-strict
ascending on all four and cross-page descending for 0 → 1 → 2; every field in
§2; the seven result-side keys absent from `next`; empty-object representation
of unplayed fixtures at status code 0; **page 999 returns 404 with no body**;
three distinct identifiers; slug unreliability at 16/30 in the forward feed;
120/120 venues with coordinates; embedded results; total absence of referee,
manager and attendance; the envelope timezone changing between two consecutive
calls.

**LIVE REPORTED** — nothing. Every claim in this report now rests on a committed
body, or on the absence of one where the provider returned none.

**REPOSITORY VERIFIED** — 404 short-circuits without retry (`client.ts:229`) and
is surfaced as `isNotFound` (`client.ts:63`); status codes 0, 60 and 100 already
mapped (`mapping/index.ts:72`); every `NOT NULL` column of `football.fixture` is
satisfiable from the feed; fixture uniqueness gives idempotency
(`005_fixture.sql:56`); `TRACKED_LEAGUES` holds 56 competitions and **no cup**.

**UNKNOWN** — whether 30 is guaranteed; whether `hasNextPage` ever goes false;
whether `last ∪ next` covers the season (U-8); the identity of a rescheduled
postponed fixture (U-9); 2026 season coverage across all 56; all cup-specific
structure. **None blocks the pager.**

---

## Recommendation

**The pager is unblocked.** Write it to the §9 specification: one implementation
serving both directions, no assumed page size, no assumed page count, 404 as the
primary terminal condition, and the `winnerCode`-presence guard on every result
write.

Two things to carry into it that this round of evidence produced:

- **U-8** — record a per-competition fixture count during the sweep and compare
  it against the expected season size. That is how the gap between the feeds
  gets answered, at no call cost, from data the sweep already collects.
- **U-9** — decide the rescheduled-postponed-fixture identity question before
  the second sweep. It is a partitioning-key consequence, not a pager one, and
  it does not need answering to start.

Fixture ingestion may follow the pager. There is no longer an unread half of the
contract.
