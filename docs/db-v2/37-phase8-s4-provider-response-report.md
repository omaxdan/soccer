# Phase 8 S-4 — Provider Response Report (Deliverable 2)

**Status: the fixture-universe contract is established.** Every finding below is
labelled by how it was established. Nothing is inferred from documentation —
`docs.sportsapipro.com` is unreachable from the build environment, so the
**DOCUMENTATION** label appears nowhere in this report by design.

| Label | Meaning |
|---|---|
| **LIVE** | Directly observed in the three captured responses |
| **REPOSITORY** | Established from V2 code or the migration set |
| **UNKNOWN** | Not established; named in §17 with the call that would settle it |

## Evidence base

Three files, captured 2026-08-11T04:30:43.956Z, committed under
`docs/api-samples/v2-discovery/`:

| File | Status | Bytes | Quota after |
|---|---|---|---|
| `tournament_seasons__tournamentId-325.json` | 200 | 2 187 | 99 |
| `tournament_season_events_last__page-0__seasonId-87678__tournamentId-325.json` | 200 | 131 997 | 99 |
| `tournament_season_events_last__page-1__seasonId-87678__tournamentId-325.json` | 200 | 133 460 | 98 |

Subject: tournament **325** (Brasileirão Betano, `brasileirao-serie-a`), season
**87678** (Brasileiro Serie A 2026). Three calls, one attempt each, no retries.
**LIVE**

---

## 1. Seasons envelope and the season ID field — LIVE

The seasons response does **not** use a `data` wrapper:

```jsonc
{
  "success": true,
  "source": "live",
  "tournamentId": 325,
  "seasons": [ { "id": 87678, "name": "Brasileiro Serie A 2026",
                 "year": "2026", "tournamentId": 325 }, … ],
  "timezone": { "name": "Europe/Paris", "utcOffset": "+02:00",
                "source": "auto", "country": "FR" }
}
```

- **Season ID field: `seasons[].id`** (integer). The 2026 edition is `87678`.
- **25 seasons returned**, 2001 through 2026, newest first.
- `year` is a **string** and is not always a plain year — `"20/21"` appears for
  the 2020–21 split season. It is a label, not a parseable date.
- Season IDs are **not** monotonic with year: 2007 is `89936` and 2006 is
  `90145`, both higher than 2026's `87678`. **An ID may never be used to infer
  recency.**

**The two envelopes differ.** Seasons puts its collection at the top level;
events wraps in `data`. Any client must handle both — the discovery runner's
`firstSeasonId()` already does, which is why it resolved 87678 without guessing.
**REPOSITORY**

## 2. Events envelope — LIVE

```jsonc
{
  "success": true,
  "data": { "events": [ … ], "hasNextPage": true },
  "source": "live",
  "cacheHit": false,
  "timezone": { "name": "Europe/Paris", "utcOffset": "+02:00",
                "source": "auto", "country": "FR" }
}
```

`source: "live"` and `cacheHit: false` on both pages — the provider states
whether it served from cache. Useful for interpreting a stale response later.

## 3. Event counts — LIVE

**Page 0: 30 events. Page 1: 30 events.** Page size is 30 on both observed
pages. Whether 30 is fixed or a maximum is **UNKNOWN** (§17).

## 4. Distinctness — LIVE

**Zero shared event IDs.** 30 distinct on page 0, 30 distinct on page 1,
intersection empty. Pages do not overlap across the two observed.

## 5. Pagination metadata — LIVE

**`data.hasNextPage` exists and is `true` on both pages.** This is the
termination condition, and it removes the need to infer one from an empty page.

There is **no** total count, no total-page count, and no page-size field.

**Ordering, which is not what one would assume:**

| | Range | Intra-page order |
|---|---|---|
| Page 0 | 2026-07-25T21:30Z → 2026-08-09T22:30Z | **ascending** |
| Page 1 | 2026-05-23T22:00Z → 2026-07-23T22:30Z | **ascending** |

Within a page, events run **oldest → newest**. Across pages, **page N+1 is
entirely earlier than page N** (page 1's maximum is strictly less than page 0's
minimum). So the page sequence walks backwards through time while each page
reads forwards. A pager that assumed a single global sort direction would
mis-order every batch.

## 6. Timestamps — LIVE

**`startTimestamp` is Unix epoch seconds, UTC, timezone-independent.**
`1785015000` → `2026-07-25T21:30:00Z`. Related fields — `time.currentPeriodStartTimestamp`,
`time.lastPeriodEndTimestamp`, `changes.changeTimestamp` — use the same
representation.

**A trap worth naming.** The envelope carries
`timezone: {name: "Europe/Paris", utcOffset: "+02:00", source: "auto", country: "FR"}`.
That is the **account's inferred location**, not the fixture's local zone, and
`source: "auto"` says the provider guessed it. It is irrelevant to
`startTimestamp`, which is absolute. Nothing may use it to shift a kickoff, and
nothing may treat it as the venue's zone. `football.fixture.scheduled_kickoff_at`
is `timestamptz`, so the epoch value converts directly. **REPOSITORY**

`fixture_partition_on` must be derived from the UTC date of `startTimestamp`.
`normalise.ts` already exposes `fromUnixSeconds` and `fixturePartitionOn`.
**REPOSITORY**

## 7. Event/fixture ID — LIVE

**`id`** (integer), e.g. `15235404`. Also present: `customId` (short opaque
string, e.g. `"qOsrO"`) and `slug` (e.g. `"athletico-internacional"`).

**`id` is the only stable identity.** `slug` is derived from team names and is
**not** ordered home-away: event `15235411` has `homeTeam.name = "Santos"`,
`awayTeam.name = "Chapecoense"` and `slug = "chapecoense-santos"`. **Parsing a
slug for participants would invert fixtures.**

IDs are **not** contiguous or chronological. Two events in the round-4 group
carry IDs `16390770` / `16390771`, an entirely different range from the
`152354xx` block, while being played in July. See §12.

## 8. Team identifiers — LIVE

`homeTeam` / `awayTeam` objects, each with `id` (integer), `name`, `slug`,
`shortName`, `nameCode` (3-letter), `gender`, `national` (boolean), `type`,
`country {alpha2, alpha3, name, slug}`, `teamColors`, `userCount`,
`fieldTranslations`.

**20 distinct teams across the 60 events**, consistent with a 20-team league.
Sufficient to populate `football.team` and `football.team_registration` with no
additional call. `country.alpha2` feeds the seeded `football.country`
vocabulary. **REPOSITORY**

## 9. Competition / tournament / season identifiers — LIVE

Three nested identifiers, and **the distinction matters**:

| Path | Value | Meaning |
|---|---|---|
| `tournament.id` | **83** | The season-specific tournament instance |
| `tournament.uniqueTournament.id` | **325** | The stable competition — the ID we requested |
| `season.id` | **87678** | The season/edition |

`uniqueTournament.id` is what maps to `football.competition.provider_external_id`;
`season.id` maps to `football.competition_edition.provider_external_id`.
**`tournament.id` (83) is a different number and must not be used for
competition identity** — it would fragment a competition across seasons, which is
the exact V1 defect `competition_edition` exists to fix. **REPOSITORY**

Also present: `tournament.category {id, name, slug, country, flag}` — Brazil,
id 13 — which gives the competition's country without a further call.

## 10. Status — LIVE

```jsonc
"status": { "code": 100, "description": "Ended", "type": "finished" }
```

Observed across 60 events:

| code | type | description | count |
|---|---|---|---|
| 100 | `finished` | Ended | 56 |
| 60 | `postponed` | Postponed | 4 |

**Both are already mapped** by `LIFECYCLE_BY_PROVIDER_STATUS` in
`src/v2/ingestion/mapping/index.ts:72` — `100 → COMPLETED`, `60 → POSTPONED`.
The map also covers 0, 6, 7, 31, 40, 41, 50, 70, 90, 110, 120, and anything
unmapped becomes `UNKNOWN` rather than a guess. `provider_status_raw` preserves
the original. **REPOSITORY**

No cancelled, abandoned or in-progress status was observed in this sample; those
codes remain **UNKNOWN** as live observations, though the mapping exists.

## 11. Scores and results — LIVE

```jsonc
"homeScore": { "current": 2, "display": 2, "period1": 1, "period2": 1, "normaltime": 2 },
"awayScore": { "current": 0, "display": 0, "period1": 0, "period2": 0, "normaltime": 0 },
"winnerCode": 1
```

**Full results are embedded in the event feed. No match-level call is needed to
populate `football.result`.**

- `current` / `display` / `normaltime` — full-time goals
- `period1` — **half-time goals**, which maps directly to
  `result.home_goals_half_time` / `away_goals_half_time`
- `period2` — second-half goals
- `winnerCode`: 1 = home (24), 2 = away (15), 3 = draw (17)

**The absence discriminator is unambiguous.** For all four postponed events:

```jsonc
"homeScore": {}, "awayScore": {}, "time": {}       // empty objects
// and `winnerCode` is ABSENT from the event entirely
```

So "no result" is an empty object plus a missing key, never a zero. A writer
that read `homeScore.current ?? 0` would record 0–0 for a match that was never
played. **`winnerCode in event` is the safest presence test**, corroborated by
`status.code`.

`extra_time` and `penalties` fields were **not** observed — no sampled fixture
went beyond normal time. Whether the provider supplies `extraTime` /
`penalties` sub-keys is **UNKNOWN**.

## 12. Round and stage — LIVE

```jsonc
"roundInfo": { "round": 20 }
```

Integer only in this sample — no group, no stage name, no knockout label.

| Page | Rounds present |
|---|---|
| 0 | 22, 21, 20 |
| 1 | 19, 18, 17, **4** |

**Round is not chronological, and this is the finding that matters most for the
pager.** Two round-4 fixtures (IDs `16390770`, `16390771`) were played on
2026-07-17 and 2026-07-23 — rescheduled catch-ups sitting among rounds 17–19 by
date. The feed orders by **date**, not by round.

Consequence: **a date-bounded ingestion must filter on `startTimestamp`, never
on round**, and must not assume rounds arrive in order or contiguously.

`football.competition_stage` is nullable on `fixture` (`005_fixture.sql:45`), so
a league round can be represented without inventing a stage. Whether cup
competitions return a richer `roundInfo` is **UNKNOWN**. **REPOSITORY**

## 13. Venue — LIVE

**100% coverage: 60 of 60 events carry a full venue, all with coordinates.**

```jsonc
"venue": {
  "id": 1129, "name": "Arena da Baixada", "slug": "ligga-arena", "capacity": 43000,
  "city": { "id": 19541, "name": "Curitiba", "country": {…} },
  "venueCoordinates": { "latitude": -25.44793, "longitude": -49.27703 },
  "country": { "alpha2": "BR", … },
  "stadium": { "name": "Arena da Baixada", "capacity": 43000 }
}
```

20 distinct venues for 20 teams. **`/venue/{id}` is therefore NOT REQUIRED for
the fixture universe** — the feed already carries id, name, capacity, city,
country and coordinates, which is everything `football.venue` needs and
everything travel-distance work would need. That is a whole endpoint class
removed from the budget.

Postponed fixtures carry a venue too, so a venue is available even without a
result.

## 14. Fields that map into `football.fixture` and `football.result`

**`football.fixture` — every NOT NULL column is satisfiable from the feed alone:**

| Column | Source | Note |
|---|---|---|
| `provider_external_id` | `event.id` | |
| `provider_code` | `SPORTSAPI_API` | source constant, REPOSITORY |
| `competition_edition_id` | resolved from `season.id` | |
| `competition_stage_id` | — | nullable; `roundInfo.round` has no stage analogue |
| `venue_id` | resolved from `venue.id` | 100% present |
| `is_neutral_venue` | — | **UNKNOWN**, no field observed; defaults false |
| `home_team_id` / `away_team_id` | `homeTeam.id` / `awayTeam.id` | |
| `scheduled_kickoff_at` | `startTimestamp` × 1000 | epoch seconds → timestamptz |
| `fixture_partition_on` | UTC date of `startTimestamp` | |
| `lifecycle_state_code` | `mapLifecycleState(status.code)` | already implemented |
| `provider_status_raw` | `status.description` or the triple | |

**`football.result` — populated for completed fixtures with no extra call:**

| Column | Source |
|---|---|
| `home_goals` / `away_goals` | `homeScore.current` / `awayScore.current` |
| `home_goals_half_time` / `away_goals_half_time` | `homeScore.period1` / `awayScore.period1` |
| `home_goals_extra_time` / `away_goals_extra_time` | **UNKNOWN** — not observed |
| `home_penalties` / `away_penalties` | **UNKNOWN** — not observed |
| `confirmed_at` | `changes.changeTimestamp`, or absent |

Also directly usable: `football.competition` from `uniqueTournament`,
`football.competition_edition` from `season`, `football.team` and
`football.team_registration` from the two team objects, `football.venue` from
`venue`.

**Not in the feed:** `homeRedCards` / `awayRedCards` appear on some events (a
count, not an event list) but there is no `match_event` detail, no lineup, no
appearance, no player. Those remain match-level work.

## 15. Can the fixture feed be the V2 fixture universe? — **YES**

Judged against what the schema requires:

1. Every NOT NULL column of `fixture` is satisfiable — §14. **LIVE + REPOSITORY**
2. Stable provider identity exists (`event.id`) and
   `uq_fixture__provider_external_id` makes ingestion idempotent. **REPOSITORY**
3. Results are embedded, so `result` needs no second call. **LIVE**
4. Non-played fixtures are representable and distinguishable — status 60 with
   empty score objects. **LIVE**
5. Competition, edition, team and venue dependencies all resolve from the same
   payload, so the write order the schema demands can be satisfied within one
   response. **LIVE**
6. A date-bounded filter is possible and reliable, because `startTimestamp` is
   absolute UTC. **LIVE**

The one caveat: `is_neutral_venue` has no observed source and will default
`false`. For a domestic league that is almost always right; for a cup final or a
World Cup it would not be. Recorded, not worked around.

## 16. Is `/events/last/{page}` sufficient for historical ingestion? — **YES, with one addition**

For the window **2026-05-31 → 2026-08-11**, on this competition:

- Page 0 covers 2026-07-25 → 2026-08-09
- Page 1 covers 2026-05-23 → 2026-07-23 — **already past the window start**
- 47 of the 60 captured events fall inside the window; 13 are earlier and
  discardable
- `hasNextPage` gives a clean stop; the date floor gives a second, earlier one

So **two pages plus one seasons call — three requests — cover this competition's
entire window.** **LIVE**

`/events/next/{page}` is **REQUIRED as well** but for a different reason: `last`
returned only finished and postponed fixtures. Upcoming fixtures between now and
any forward horizon must come from `next`. It is registered and untested.

Everything else — `/match/{id}`, `/venue/{id}`, `/teams/{id}` — is **NOT
REQUIRED** for the fixture universe. The feed already carries what they would
provide.

### Budget consequence

| | |
|---|---|
| Per competition | 1 seasons + ~2 event pages ≈ **3 calls** |
| 56 tracked competitions | **≈ 168 calls** |
| Daily quota | 200 |

**The whole fixture universe fits inside one day of quota.** That is a very
different picture from the 9-endpoint-per-fixture fan-out estimated in doc 36,
and it is because the feed is far richer than assumed. Brazil plays through the
southern winter; most European leagues are between seasons for much of this
window and should need fewer pages, not more.

## 17. What remains UNKNOWN

| # | Unknown | Why it matters | Settled by |
|---|---|---|---|
| U-1 | Is page size fixed at 30, or a maximum? | A short page might be mistaken for the last one | Reading `hasNextPage` — already available; no call needed |
| U-2 | What does a page past the end return — empty array, 404, or error? | Termination safety if `hasNextPage` were ever absent | 1 call at a high page |
| U-3 | `/events/next/{page}` envelope and whether unplayed fixtures carry scores at all | Forward fixtures are half the universe | 1 call |
| U-4 | Do cup competitions return richer `roundInfo` (group, stage, leg)? | `competition_stage` population | 1 call on a cup |
| U-5 | Are `extraTime` / `penalties` sub-keys present when a match goes beyond 90? | 4 `result` columns | 1 call on a knockout season |
| U-6 | Is `is_neutral_venue` derivable at all? | Defaults false today | Same call as U-4/U-5 |
| U-7 | Do all 56 tracked competitions have a resolvable 2026 season? | Whether the 168-call estimate holds | Batched seasons discovery |
| U-8 | Referee, manager, attendance | **Confirmed ABSENT from the feed: 0 of 60 events** carry any of them. Enrichment needs dedicated endpoints | Deliverable 5 |
| U-9 | Status codes other than 100 and 60 in live data | Mapping exists but is unproven for 0, 70, 90, 110, 120 | Observed naturally during ingestion |

U-8 is worth restating: **the event feed carries no referee and no manager
whatsoever.** The earlier plan to "retain referee/manager IDs if the fixture
payload exposes them" cannot be executed — there is nothing to retain. Both
become genuinely separate endpoint work, which is an argument for keeping them
deferred.

---

## Recommendation — the smallest next live experiment

**Maximum 4 calls.** Purpose: close U-2, U-3 and U-4/U-5/U-6 before any pager is
written, so the pager is written once.

| # | Call | Settles |
|---|---|---|
| 1 | `tournament_season_events_last` page **2**, tournament 325 / season 87678 | Confirms page size is stable at 30 and that pages stay contiguous over three hops |
| 2 | `tournament_season_events_last` at a **deliberately high page** (e.g. 50) | U-2 — what past-the-end looks like |
| 3 | `tournament_season_events_next` page 0, same tournament/season | U-3 — forward envelope, and whether unplayed fixtures omit scores the same way postponed ones do |
| 4 | `tournament_seasons` for **one cup competition** from `TRACKED_LEAGUES`, then optionally its `events/last/0` | U-4, U-5, U-6 — round/stage richness, extra time, penalties, neutral venue |

Call 4 is two calls if the cup's season must be resolved first; **cap the run at
5 and stop there.**

Command, using the runner already built:

```bash
npm run discover:v2 -- --tournament 325 --season 87678 --max-calls 2
```

That covers calls 1–2 once the runner learns `--page` and `--next`. **It does not
yet**, so the honest sequence is:

1. I extend `discover.ts` with `--page <n>`, `--pages <a,b,c>` and `--next` —
   no new endpoint, no new client, no ingestion.
2. You run it once, at `--max-calls 5`.
3. I write the pager against a fully-known contract.

**Do not begin fixture ingestion before U-2 and U-3 are closed.** Everything else
about the fixture universe is now established, and the remaining unknowns are
cheap — five calls out of 200.
