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

| Call | Status | Body here? | Class |
|---|---|---|---|
| `tournament_seasons` / 325 | 200 | **yes**, 2 187 B | LIVE VERIFIED |
| `events/last/0` | 200 | **yes**, 131 997 B | LIVE VERIFIED |
| `events/last/1` | 200 | **yes**, 133 460 B | LIVE VERIFIED |
| `events/last/2` | 200 | **no** | LIVE REPORTED |
| `events/last/999` | **404** | **no** | LIVE REPORTED |
| `events/next/0` | 200, 118 870 B, sha256 `5f2fe8bf6ffe` | **no** | LIVE REPORTED |

**Three bodies are missing from this repository**, so §4 (field-by-field `last`
vs `next`) cannot be completed and several `next` behaviours stay UNKNOWN. That
is stated rather than filled in. The three files should be committed to
`docs/api-samples/v2-discovery/` before the pager is written.

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

### `events/next` — top level LIVE REPORTED, interior UNKNOWN

Reported shape: `object{ success, data, source, cacheHit, timezone }` — the same
five top-level keys as `events/last`. **Whether `data` contains `events` and
`hasNextPage`, and in what form, is UNKNOWN** without the body.

**The two envelope families differ and both must be handled.** Seasons is flat;
events wraps in `data`. `firstSeasonId()` already handles both.
REPOSITORY VERIFIED.

## 2. Field locations and types

All LIVE VERIFIED from `events/last/0` and `/1` unless marked.

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
`awayRedCards` (counts, present on some events only), `changes.changeTimestamp`.

## 3. Pagination behaviour — U-2 CLOSED

| Page | Status | Events | Date range | `hasNextPage` | Class |
|---|---|---|---|---|---|
| 0 | 200 | **30** | 2026-07-25T21:30Z → 2026-08-09T22:30Z | `true` | LIVE VERIFIED |
| 1 | 200 | **30** | 2026-05-23T22:00Z → 2026-07-23T22:30Z | `true` | LIVE VERIFIED |
| 2 | 200 | not counted here | — | not read here | LIVE REPORTED |
| 999 | **404** | — | — | — | LIVE REPORTED |

### Page size

**LIVE VERIFIED: pages 0 and 1 each returned exactly 30 events.**

**UNKNOWN: whether 30 is a guaranteed page size.** Two observations of the same
number is consistent with a fixed size and equally consistent with a maximum
that these particular pages happened to fill. Nothing in the response declares
it — there is no page-size field. **The pager must not hard-code 30, must not
derive "is this the last page?" from a short page, and must not compute a page
count by dividing a total by 30.** A short page is not evidence of the end; only
`hasNextPage === false` or a 404 is.

### Is `hasNextPage` authoritative? — **NOT ESTABLISHED**

This is the correction that matters most. **`hasNextPage: false` has never been
observed.** It was `true` on both pages whose bodies exist, and page 999
returned **404** rather than a 200 carrying `hasNextPage: false`.

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

## 4. `events/last` vs `events/next`, field by field — **CANNOT BE COMPLETED**

The `next/0` body is not in this repository. What is established:

- **LIVE REPORTED**: HTTP 200, 118 870 bytes, sha256 `5f2fe8bf6ffe`, top-level
  keys `success, data, source, cacheHit, timezone` — matching `events/last`.
- **UNKNOWN**: whether `data.events` and `data.hasNextPage` are present and
  named identically; intra-page ordering; whether an *unplayed* fixture
  represents scores the way a *postponed* one does (`{}` plus absent
  `winnerCode`) or differently; whether `venue` is as complete for future
  fixtures; whether `roundInfo` is present.

The size is suggestive — 118 870 B against 131 997 B for a 30-event page — but
byte count is not a field contract and I will not derive one from it.

**This blocks the pager's forward half.** Send the file and this section closes.

## 5. Previously identified findings, re-checked

| Finding | Verdict |
|---|---|
| Intra-page ordering **ascending** by `startTimestamp` | **CONFIRMED**, LIVE VERIFIED, pages 0 and 1 |
| Cross-page: page N+1 entirely **earlier** than page N | **CONFIRMED** for 0 → 1 (page 1 max < page 0 min). For 1 → 2, LIVE REPORTED contiguity only |
| Round **not** chronological | **CONFIRMED** — page 1 carries rounds 19, 18, 17 **and 4**; two round-4 fixtures played 2026-07-17 and 07-23, ids `16390770`/`16390771` from a different range |
| Postponed uses **empty objects** | **CONFIRMED** — all 4 postponed events: `homeScore {}`, `awayScore {}`, `time {}`, `winnerCode` absent |
| `uniqueTournament.id` ≠ `tournament.id` ≠ `season.id` | **CONFIRMED** — 325 / 83 / 87678, three distinct integers in every event |
| `slug` unreliable for home/away | **CONFIRMED** — event `15235411` is Santos (home) v Chapecoense (away), slug `chapecoense-santos` |
| Venue completeness | **CONFIRMED** — 60/60 events, 60/60 with coordinates, 20 distinct venues |
| Result embedded | **CONFIRMED** — `current` full time, `period1` half time; no match call needed |
| Referee / manager / attendance | **CONFIRMED ABSENT** — 0/60 for `referee`, `manager`, `homeManager`, `awayManager`, `officials`, `attendance` |

Nothing established in doc 37 from bodies is overturned.

## 6. Budget, recomputed from observed counts

Observed for tournament 325, season 87678:

- 60 events across pages 0–1; **47 fall inside 2026-05-31 → 2026-08-11**; 13 are earlier
- The date floor is reached **on page 1**

| | |
|---|---|
| Per competition, historical half | 1 seasons + **2** `last` pages = 3 calls |
| Per competition, forward half | 1+ `next` pages — **UNKNOWN**, likely 1 for a league |
| **Per competition total** | **~4 calls** |
| **56 tracked competitions** | **~224 calls** |
| Daily quota | 200 |

**Roughly 1.1 days of quota for the entire fixture universe.** Two practical
notes: most European leagues are between seasons across much of this window and
should need fewer pages, not more; and a competition with no 2026 season costs
only its seasons call. The 224 is a ceiling, not an expectation.

Page 2 cost one call and bought contiguity evidence, not fixtures — correct for
discovery, unnecessary for ingestion.

## 7. What remains UNKNOWN before the pager

| # | Unknown | Blocks | Cost to close |
|---|---|---|---|
| **U-3a** | `events/next` interior: `data.events`, `data.hasNextPage`, ordering | The forward half of the pager | **0 calls** — send the captured file |
| **U-3b** | How an *unplayed* fixture represents scores/status/time | `result` write guard for future fixtures | 0 calls — same file |
| **U-1** | Whether 30 is a guaranteed page size | Nothing, if the pager never assumes it | Not worth a call |
| **U-2b** | Whether `hasNextPage` ever goes `false` | Nothing, given 404 is terminal | Emerges during the first real run |
| **U-7** | Do all 56 competitions resolve a 2026 season? | Budget accuracy | Emerges during the sweep |
| **U-4/5/6** | Cup `roundInfo`, extra time, penalties, neutral venue | Nothing today — **`TRACKED_LEAGUES` contains no cup**, all 56 are leagues | Defer until a cup is tracked |

**Only U-3a and U-3b block the pager, and both cost zero further calls.**

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

Not corrected: everything in doc 37 derived from response bodies. §5 above
re-checked each and all stand.

## 9. Pager contract — SPECIFICATION ONLY, not implemented

### Inputs
`competitionProviderId` (from `uniqueTournament.id`), `seasonProviderId` (from
`season.id`), `windowStart`, `windowEnd`, `callBudget`.

### Termination — in this order, whichever fires first
1. `ProviderRequestError.isNotFound` → **stop, page consumed nothing further**
2. `data.hasNextPage === false` → stop
3. Every event on the page has `startTimestamp` earlier than `windowStart` → stop
4. Budget exhausted → stop and **persist the resume point**

### Forbidden by evidence
- No hard-coded page size; **30 must not appear in the pager**
- No page count computed from any total
- No "short page means last page"
- No termination on a fixed maximum page number
- No ordering assumption beyond: intra-page ascending, page N+1 earlier than N —
  and both must be re-checked, not trusted, when a page arrives

### Per-event rules, all evidence-backed
- Identity `event.id`; **never** parse `slug` for participants
- Competition `uniqueTournament.id`; **never** `tournament.id`
- Edition `season.id`
- Kickoff from `startTimestamp` × 1000; `fixture_partition_on` from its **UTC**
  date; the envelope `timezone` block is the account's location and must not
  touch a kickoff
- Lifecycle via the existing `mapLifecycleState(status.code)`; raw preserved in
  `provider_status_raw`
- **Write a `result` only when `winnerCode` is present** — an empty `homeScore`
  object must never become 0–0
- Filter the window on `startTimestamp`; **never** on `roundInfo.round`
- Venue, teams, competition, edition all resolve from the same payload — no
  supplementary call

### Idempotency
`uq_fixture__provider_external_id (provider_code, provider_external_id,
fixture_partition_on)` makes re-running safe. REPOSITORY VERIFIED.

## 10. Summary by class

**LIVE VERIFIED** — seasons envelope and `seasons[].id`; `events/last` envelope
and `data.events` / `data.hasNextPage`; 30 events on pages 0 and 1; intra-page
ascending and cross-page descending for 0 → 1; every field in §2; empty-object
representation of unplayed; three distinct identifiers; slug unreliability;
100% venue with coordinates; embedded results; total absence of referee,
manager and attendance.

**LIVE REPORTED** — page 2 returns 200; **page 999 returns 404**; `next/0`
returns 200 with the same five top-level keys.

**REPOSITORY VERIFIED** — 404 short-circuits without retry (`client.ts:229`) and
is surfaced as `isNotFound` (`client.ts:63`); status codes 100 and 60 already
mapped (`mapping/index.ts:72`); every `NOT NULL` column of `football.fixture` is
satisfiable from the feed; fixture uniqueness gives idempotency; `TRACKED_LEAGUES`
holds 56 competitions and **no cup**.

**UNKNOWN** — the `events/next` interior; unplayed-fixture score representation;
whether 30 is guaranteed; whether `hasNextPage` ever goes false; 2026 season
coverage across all 56; all cup-specific structure.

---

## Recommendation

**Commit the three missing evidence files** — `events/last/2`,
`events/last/999`, `events/next/0` — to `docs/api-samples/v2-discovery/`. That
costs **no provider calls** and closes U-3a and U-3b, the only two unknowns
blocking the pager.

Then the pager can be written to the §9 specification, against a contract with
no assumed page size, no assumed page count, and 404 as the primary terminal
condition.

**Do not begin fixture ingestion until §4 is complete.** The forward half of the
universe is half the universe, and its contract is currently unread.
