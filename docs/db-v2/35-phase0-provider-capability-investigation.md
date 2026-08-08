# Phase 0 — Provider Capability Investigation

**Read-only. No database change, no DDL, no DML, no migration, no code change, no writer or runner added.** Every statement below is traceable to a file and line, or is explicitly marked as not established.

> ## LIVE PAYLOAD: NOT OBTAINED
>
> **REASON:** No provider credentials exist in this environment.
> - `env | grep -iE 'SPORTSAPI|PT_V2_PROVIDER|SOFASCORE'` → **empty**
> - `find /home/user/soccer -name '.env' -not -path '*/node_modules/*'` → **empty**; only `.env.example` and `.env.v2.example` exist, both carrying `your_api_key_here`
> - `beta/backend/docs/api-samples/` contains **only its README** — the capture mechanism has never run
> - No recorded HTTP fixtures anywhere: no nock, msw or polly dependency, no cassette or recording directory
>
> **No unauthenticated request was sent to the provider.** An unauthenticated call would demonstrate nothing about capability and is not a legitimate read-only request against a keyed API.
>
> **This is "not obtained", not "not supported".** The distinction is carried through every section.

---

## 1. Executive conclusion

**G-1 is NOT CONFIRMED, and it cannot be confirmed from this repository.**

The complete provider surface either integration knows about is **thirteen paths**. Not one of them is documented, typed, called or tested as returning per-fixture player data. There is no lineup endpoint, no per-fixture player-statistics endpoint, no events endpoint and no manager endpoint in any registry, in either codebase.

Three things sharpen that:

**1. One endpoint is a genuine candidate and has never been called.** `/match/{id}` is registered in V1's `ENDPOINT_REGISTRY` (`src/constants/endpoints.ts:40-43`) and invoked nowhere — the only occurrence of `resolveEndpoint('match'` in the repository is the JSDoc example on line 136 of the file that defines it. Its own description reads *"Get match details (teams, date, status)"*, which does **not** claim lineups. Whether the live payload carries more is **UNKNOWN**, and it is the single cheapest question to answer.

**2. The repository already states that an endpoint it does not call exists.** `entities/reference.ts:133-135`: *"A nested structure would need the tournament structure endpoint, which S-4 does not call."* That is a claim about the provider written by whoever built S-4, and it is evidence that the thirteen known paths are not the provider's whole catalogue.

**3. The season-aggregate endpoint is confirmed present and is confirmed insufficient.** `/teams/{id}/tournament/{t}/season/{s}/player-statistics` is called by V1 at `syncSeasonStatistics.ts:268-270` and maps `s.minutesPlayed` into `player_season_statistics`. It returns **season totals scoped to one tournament season**. It does not satisfy G-1, and §7 explains why in detail.

**Everything downstream of `football.appearance` therefore remains blocked.** `appearance`, `lineup`, `lineup_selection`, `match_event`, `official`, `official_assignment` and `provider_statistic` have **zero references in the entire V2 source tree** — not an uncalled writer, no writer at all.

---

## 2. Existing provider integration

### 2.1 Two clients, one provider, GET only

| | **V2** | **V1** |
|---|---|---|
| Client | `src/v2/ingestion/provider/client.ts` | `src/services/sportsApiClient.ts` |
| Base URL | `PT_V2_PROVIDER_BASE_URL` — **required, no default** | `SPORTSAPI_BASE_URL` ‖ `https://v2.football.sportsapipro.com/api` |
| Auth | header `x-api-key` (`client.ts:83`) | header `x-api-key` (`sportsApiClient.ts:50`) |
| Keys | `PT_V2_PROVIDER_KEY`, `..._KEY_2` | `SPORTSAPI_KEY`, `SPORTSAPI_KEY_2` |
| HTTP verbs | **GET only** — one `.get<T>(path)`; the sole `delete(` is `Map.delete` on the usage accumulator (`client.ts:240`) | GET only |
| Retry | 4 attempts: immediate, other key, 62 s window wait, final | same tactics |
| Throttle | `PT_V2_PROVIDER_MIN_INTERVAL_MS`, default 2000 ms, applied globally | same |
| Quota accounting | `operations.api_usage`, per endpoint key | in-memory only, by its own admission |

A third client exists — `src/services/sofaScoreClient.ts`, 108 lines, a bare `get<T>(path, params)` with no registry. Its only caller passes `/team/{id}/players`, and the client itself logs *"SofaScore 403 — Cloudflare blocking server request. Use SportsAPI Pro instead."* (`sofaScoreClient.ts:78`). **`src/services/sofaScoreClient.ts` is not carried into V2** (S-4 README, decision D-1).

### 2.2 The complete known provider surface — 13 paths

| # | Path | Where declared | Status | Returns (per repository) |
|---|---|---|---|---|
| 1 | `/schedule/{date}` | V1 registry + V2 registry | **EXISTS + CALLED** (both) | fixtures with competition, season, roundInfo, venue, both teams, status, scores |
| 2 | `/tournaments` | V1 registry + V2 registry | **EXISTS + CALLED** (V1 only) | tournament catalogue |
| 3 | `/seasons` | V1 registry + V2 registry | **EXISTS + CALLED** (V1 only) | season catalogue |
| 4 | **`/match/{id}`** | **V1 registry only** | **EXISTS + UNCALLED** | *"match details (teams, date, status)"* — **payload UNKNOWN** |
| 5 | `/teams/{id}/players` | V1 registry + V2 registry (`team_players`) | **EXISTS + CALLED** (V1) | roster |
| 6 | `/team/{id}/players` | V2 registry (`team_squad`); V1 via SofaScore | **EXISTS + UNCALLED in V2** | roster, injury spells, positions, market values, contracts |
| 7 | `/teams/{id}/events/last/{limit}` | V1 + V2 registries | **EXISTS + UNCALLED** | a team's last N completed fixtures |
| 8 | `/teams/{id}/events/next/{limit}` | V1 + V2 registries | **EXISTS + UNCALLED** | a team's next N fixtures |
| 9 | `/tournament/{t}/season/{s}/team-events` | V1 + V2 registries | **EXISTS + CALLED** (V1) | all events for a tournament season, schedule shape |
| 10 | `/tournament/{t}/season/{s}/standings` | inline in V1; V2 registry (`season_standings`) | **EXISTS + CALLED** (V1) | league table |
| 11 | `/teams/{id}/tournament/{t}/season/{s}/player-statistics` | **inline in V1 only** | **EXISTS + CALLED** (V1) | **season-aggregate** player stats incl. `minutesPlayed` |
| 12 | `/teams/{id}/tournament/{t}/season/{s}/statistics` | inline in V1 only | **EXISTS + CALLED** (V1) | team season aggregates |
| 13 | `/teams/{id}/transfers` | inline in V1; V2 registry (`team_transfers`) | **EXISTS + CALLED** (V1) | transfers in/out |

Plus two image paths, in V2's `DELIBERATELY_NOT_INGESTED`.

**No path in this table is declared, typed or described as returning per-fixture player data.**

### 2.3 The full trace, for the three target relations

```
provider endpoint   →   client   →   normalizer   →   writer   →   runner   →   table

football.appearance
    ✗ none            ✗            ✗                 ✗           ✗          modelled, empty

football.lineup
    ✗ none            ✗            ✗                 ✗           ✗          modelled, empty

football.lineup_selection
    ✗ none            ✗            ✗                 ✗           ✗          modelled, empty
```

Verified mechanically — references in the entire `src/` tree, tests included:

```
football.appearance          src_refs=0   test_refs=0
football.lineup              src_refs=0   test_refs=0
football.lineup_selection    src_refs=0   test_refs=0
football.match_event         src_refs=0   test_refs=0
football.official            src_refs=0   test_refs=0
football.official_assignment src_refs=0   test_refs=0
football.provider_statistic  src_refs=0   test_refs=0
```

and `grep -rniE 'INTO football\.(appearance|lineup|lineup_selection|match_event|official|provider_statistic)'` across `src/` and `v2/` (migrations excluded) returns **nothing**.

**The chain is broken at the first link, not the last.** These are not uncalled writers like `squad.ts` and `standings.ts` — nothing exists at any stage.

### 2.4 Uncalled provider methods

| Endpoint | Registered in | Called |
|---|---|---|
| `/match/{id}` | V1 | **never** — the only textual occurrence is a JSDoc example |
| `/teams/{id}/events/last/{limit}` | V1 + V2 | never |
| `/teams/{id}/events/next/{limit}` | V1 + V2 | never |
| `/team/{id}/players` (`team_squad`) | V2 | never in V2 |
| `/teams/{id}/transfers` (`team_transfers`) | V2 | never in V2 |
| `/tournament/{t}/season/{s}/standings` (`season_standings`) | V2 | never in V2 |
| `/tournaments`, `/seasons` | V2 | never in V2 |

### 2.5 Normalizers and DTOs

V2's provider-facing types are deliberately loose because the data is external. `stages/schedule.ts:75-77`:

```ts
interface ScheduleResponse { readonly events?: readonly Record<string, unknown>[]; }
```

Fields are extracted defensively through `asRecord`, `externalId`, `text`, `nonNegativeInt`, `fromUnixSeconds`. **There is no typed DTO describing the provider's payload**, so the type system cannot tell us which fields exist — only which are read.

**Every field either integration reads from a schedule event:**

```
V1 (syncDateMasterFeed.ts): id · homeTeam · awayTeam · homeScore · awayScore ·
                            season · startTimestamp · status · tournament ·
                            venue · winnerCode
V2 (stages/schedule.ts):    the same, plus roundInfo · neutralGround
```

No lineup, incident, player or manager field is read by either. **That is evidence about the integration, not about the payload** — a field can be present and unread, and with `Record<string, unknown>` nothing would flag it.

---

## 3. Per-fixture appearance capability (G-1)

### Classification: **NOT CONFIRMED**

| Item | Finding |
|---|---|
| Endpoint | **None identified.** No path in §2.2 is declared as returning per-fixture player data |
| HTTP method | n/a |
| Required parameters | n/a |
| Provider identifier | n/a |
| Actual response fields | **Not obtained** — no credentials, no committed payload |
| Sufficient for V2? | Cannot be assessed |
| Already called? | No — nothing calls anything of this shape |
| Real payload obtained? | **No** |
| Evidence | §2.2, §2.3; `docs/api-samples/` empty |
| Confidence | **High that the repository contains no such call. Zero as to what the provider offers.** |

### The one candidate

`/match/{id}` — `src/constants/endpoints.ts:40-43`:

```ts
match: {
  path: '/match/{id}',
  description: 'Get match details (teams, date, status)',
},
```

**The description does not claim player data**, and no code has ever exercised it. Everything about its payload beyond that sentence is **UNKNOWN**.

### What `football.appearance` would require

```
fixture_partition_on      ← derivable from the fixture, already ingested
fixture_id                ← already ingested
player_id                 ← requires a provider player id per fixture   ⛔
team_id                   ← already ingested
participation_state_code  ← requires STARTED / SUBSTITUTED_ON /
                            UNUSED_SUBSTITUTE / NOT_SELECTED per player ⛔
minutes_played  NOT NULL  ← requires minutes per player per fixture     ⛔
position_code             ← optional
yellow_cards / red_cards  NOT NULL  ← requires per-fixture discipline   ⛔
```

**Four NOT NULL columns have no identified source.** `minutes_played` is NOT NULL with `CHECK (0..150)`, so a row cannot be written without a real number — the schema forecloses writing a placeholder, which is correct and which is why this is a hard block rather than a degraded mode.

---

## 4. Lineup capability (G-3)

### Classification: **NOT CONFIRMED**

| Item | Finding |
|---|---|
| Endpoint | **None.** No lineup path in either registry, in any inline call, or in any comment |
| Already called? | No |
| Real payload? | **No** |
| Confidence | High that no lineup endpoint is known to the repository |

`football.lineup` needs `formation`; `football.lineup_selection` needs `player_id`, `position_code`, `shirt_number` and `is_starting NOT NULL`. **No identified source for any of them.**

**V1's `match_predicted_lineups` (migration 025) is not evidence of a provider lineup feed.** It is *predicted* by `processPredictedLineups.ts` — computed by V1 from squad and availability data, not ingested. It is the opposite of what G-3 needs: a model output, not an observation.

---

## 5. Player-statistics capability

### Two distinct things, and only one is confirmed

**CONFIRMED FROM REPOSITORY ONLY — season aggregates:**

| | |
|---|---|
| Endpoint | `GET /teams/{id}/tournament/{tournamentId}/season/{seasonId}/player-statistics` |
| Parameters | team external id, tournament external id (`uniqueTournament.id`), season external id |
| Called at | `src/jobs/syncSeasonStatistics.ts:268-270` |
| Response shape read | `response.playerStatistics[] { player: { id }, statistics: {…}, playedEnough }` |
| Fields mapped | ~98, including `minutesPlayed`, `appearances`, `matchesStarted`, `rating`, `goals`, `assists`, `expectedGoals`, `expectedAssists` (`syncSeasonStatistics.ts:296-320`) |
| Written to | `public.player_season_statistics`, `upsert onConflict: 'player_id,season_external_id'` (line 438-439) |
| Real payload obtained? | **No** — `docs/api-samples/player-stats/` is empty |

The in-code comment records that the path was *"CONFIRMED via live testing against the real API"* for its pluralisation — evidence the endpoint works, **not** evidence of what a per-fixture variant would return.

**NOT CONFIRMED — per-fixture player statistics:** no endpoint, no call, no payload, no comment referring to one.

### Two properties of the confirmed endpoint that matter

1. **It is scoped to one tournament season.** Minutes accrued in a cup are in the cup's aggregate, not the league's. Full coverage costs one call per team **per competition**.
2. **It is stored overwrite-in-place.** No history exists, and none can be recovered.

---

## 6. Substitution / event capability (G-12)

### Classification: **NOT CONFIRMED**

No events or incidents endpoint in either registry; no inline call; `football.match_event` has zero references in `src/`.

**Correctly treated as a refinement, not a prerequisite.** `appearance.minutes_played` is a total; substitution minutes would let "reduced minutes" distinguish an early withdrawal from a late introduction. If `/match/{id}` returns incidents, this and G-1 may be answered by the same call — but that is a hypothesis, not a finding.

---

## 7. Manager capability (G-8)

### Classification: **NOT CONFIRMED (integration) / UNKNOWN (provider)**

| Evidence | Result |
|---|---|
| Manager or coach endpoint in either registry | **none** |
| Manager or coach field read by any normalizer | **none** |
| Manager or coach relation or column in V2 | **none** — catalogue query returns 0 rows for both tables and columns |
| Occurrences of "manager" in the repository | **3, all prose comments** in V1 files about tactical flexibility |

**Even a confirmed current-manager field would be insufficient.** Modelling *tenure* requires a bounded period per manager per team — the `daterange` + exclusion-constraint shape V2 already uses for `player_registration` and `player_availability`. A current-manager field observed repeatedly could only yield `INFERRED` boundaries by snapshot differencing, which is precisely the provenance downgrade the S-4 README calls *"the single most damaging thing this subsystem could do"* when mislabelled.

**Manager history with start and end dates is therefore a separate requirement from manager identity, and neither is established.**

---

## 8. Competition classification capability (G-5 / G-6)

### Competition kind — **NOT CONFIRMED**

No structured classification field is read anywhere. The provider does supply a `category` object on `tournament.uniqueTournament`, and V2 reads exactly one field of it:

```ts
categoryName: text(asRecord(uniqueTournament.category)?.name)   // schedule.ts:216
```

`entities/reference.ts:34` documents what it is: *"The provider's category name — a country in most cases, 'World' for others."* It is consumed by `mapCountry` and written to `competition.country_code`.

**So `category` is a geography grouping, not a competition type.** Whether the object carries any other field — a type, a tier, a flag — is **UNKNOWN**: it is destructured for `.name` only, and the loose `Record<string, unknown>` typing means nothing else would surface.

**No name-based classification is proposed.** The mapping layer already refuses this class of guess by design: `mapCountry` returns `ABSENT` with a reason rather than inventing a code, and *"ingestion does not create vocabulary rows."*

### Stage kind — **NOT CONFIRMED**

`roundInfo` is read for `round` (a number) and `name` (a string) only. `resolveCompetitionStage` writes `nesting_depth` as a hard-coded `0`, with the reason stated at `reference.ts:130-135`:

> *"`nesting_depth` is 0 here throughout: the schedule feed reports a flat round, never a hierarchy. A nested structure would need the tournament structure endpoint, which S-4 does not call. Writing a fabricated depth would be asserting a hierarchy nobody observed."*

**This is the repository asserting that a tournament-structure endpoint exists.** It is a comment, not a verified capability — but it is the second concrete lead worth putting to the provider, after `/match/{id}`.

**No aggregate score, qualification implication, or knockout flag** is read anywhere (G-10 — **NOT CONFIRMED**).

---

## 9. Competition identifier capability (G-11)

### Classification: **CONFIRMED FROM REPOSITORY ONLY — with a stated conditionality**

| Relation | Identifier | Source | Reliable? |
|---|---|---|---|
| `football.competition` | `provider_external_id` **NOT NULL** | `uniqueTournament.id` | **Yes** — an event with no tournament id is rejected outright (`schedule.ts:204-208`) |
| `football.competition_edition` | `provider_external_id` **nullable** | `season?.id` | **Conditional** — see below |
| `football.competition_stage` | none | — | Identified by `(edition, stage_ordinal)`, not by a provider id |

`resolveCompetitionEdition` (`reference.ts:101-122`) writes `provider_external_id` from `season.externalId`, but the conflict target is `(competition_id, season_period)` — **the edition's identity is the competition plus the period, deliberately, so that two editions cannot overlap.** The provider id is carried but is not the key.

`schedule.ts:224-241` shows the consequence: when the payload has no `season.id`, `externalId(season?.id)` returns `null`, the edition row is still written, and the season *label* falls back through `season.name` → `season.year` → the kickoff year.

**So G-11 is real but bounded:** an edition without a provider season id **cannot be addressed** by any `/tournament/{t}/season/{s}/…` path — which covers standings, team statistics, player statistics and team-events. How often that occurs is **UNKNOWN** and measurable only after a backfill:

```sql
SELECT count(*) FILTER (WHERE provider_external_id IS NULL) AS unaddressable,
       count(*)                                             AS total
  FROM football.competition_edition;
```

---

## 10. V2 field mapping

| V2 requirement | Provider field | Available? | Evidence | Notes |
|---|---|---|---|---|
| fixture | `events[].id`, `startTimestamp`, `status` | **YES** | `schedule.ts:189-201`; called daily | Already ingested |
| team | `homeTeam.id`, `awayTeam.id` | **YES** | `schedule.ts:192-193` | Already ingested |
| competition | `tournament.uniqueTournament.id` | **YES** | `schedule.ts:204` | NOT NULL, rejected if absent |
| competition_edition id | `season.id` | **CONDITIONAL** | `schedule.ts:234` | Nullable — §9 |
| stage / round | `roundInfo.round`, `roundInfo.name` | **YES** | `schedule.ts:246-247` | Flat only, `nesting_depth = 0` |
| venue + coordinates | `venue.id`, `venue.venueCoordinates` | **YES** | `schedule.ts:264-285` | Paired or absent |
| result | `homeScore`/`awayScore` `.normaltime`, `.period1`, `.extra1`, `.penalties` | **YES** | `schedule.ts:332-339` | FT, HT, ET, pens |
| **player (per fixture)** | — | **NO** | §3 | No endpoint identified |
| **starter status** | — | **NO** | §3, §4 | `participation_state_code` unsourced |
| **minutes (per fixture)** | — | **NO** | §3 | NOT NULL, `CHECK 0..150` |
| **unused substitute** | — | **NO** | §4 | Needs a bench list |
| player (roster) | `/teams/{id}/players` | **YES** | V1 `syncSquadSofaScore.ts` / `syncTeamsPlayers.ts` | **Not called by V2** — G-4 |
| availability | injury data in the squad payload | **YES (probable)** | V1 writes `player_injuries` from it | Writer exists in V2, uncalled — G-9 |
| **competition kind** | `category` carries a *country*, not a type | **NO** | `reference.ts:34`; §8 | Other fields of `category` UNKNOWN |
| **stage kind** | — | **NO** | §8 | `roundInfo` is number + name only |
| **manager** | — | **NO** | §7 | No endpoint, no field, no relation |
| **manager tenure** | — | **NO** | §7 | Needs bounded periods; not obtainable from a current-value field |

---

## 11. Rosario Central AC-4 feasibility

**Independiente del Valle vs Rosario Central (28 May) and Estudiantes vs Rosario Central (31 May) are not in the database — `football.fixture` is empty; no V2 database has been populated.** Neither the specific fixtures nor an equivalent could be queried.

Assessed against a *populated* database after a backfill covering those dates:

| # | AC-4 requirement | Status | Why |
|---|---|---|---|
| 1 | Both fixtures exist | **WOULD PASS** | `/schedule/{date}` is ingested unfiltered — cup and continental fixtures already arrive |
| 2 | Different competitions | **WOULD PASS for identity; FAIL for kind** | Two `competition_edition_id` values are distinguishable. Naming one CONTINENTAL and the other DOMESTIC_CUP is **not** possible — G-5 |
| 3 | 3-day gap from `scheduled_kickoff_at` | **WOULD PASS** | `timestamptz`, computed not asserted |
| 4 | **Player appearances for both fixtures** | **FAILS** | `football.appearance` empty, no writer, **no identified source** |
| 5 | Regular-starter status from a pre-28-May window | **FAILS** | Depends on 4 |
| 6 | Minutes compared per player | **FAILS** | Depends on 4 |
| 7 | Availability excludes unavailable players | **FAILS** | `player_availability` writer exists but is never called — G-9 |
| 8 | A reduced-minute player identified | **FAILS** | Depends on 4, 5, 6 |
| 9 | Expressed as an observed count | **FAILS** | Nothing to count |
| 10 | No causal claim | **WOULD PASS trivially** | Nothing is emitted at all |

### Field-level answer

**No.** Requirement 4 is the gate, and it needs, per player per fixture:

```
player identity      ⛔ no per-fixture player source
started / came on    ⛔ no participation source
minutes played       ⛔ no per-fixture minutes source        NOT NULL, CHECK 0..150
```

Requirement 7 is a **second, independent** blocker and is the more dangerous of the two: without `player_availability`, an injured player and a rested player are indistinguishable, and the whole claim inverts from "the manager protected him" to "he was unavailable". That gap is G-9 and, unlike G-1, it is closable today — the writers exist (`recordUnavailability`, `closeResolvedSpells`) and the endpoint that feeds them is already called by V1.

**AC-4 is not runnable, and must not be weakened to make it so.** Substituting season aggregates for per-fixture minutes would satisfy the letter of steps 6 and 8 while destroying their meaning (§12 below, and doc 33 §5).

---

## 12. Evidence / payloads obtained

```
LIVE PAYLOAD: NOT OBTAINED
REASON:       No provider credentials are present in this environment.
              No .env file exists; no SPORTSAPI_KEY, PT_V2_PROVIDER_KEY or
              equivalent is set. Only .env.example templates carrying
              'your_api_key_here'.

PAYLOADS SAVED TO docs/api-samples/: NONE
              Creating one would require inventing it, which this task forbids.
              beta/backend/docs/api-samples/ still contains only its README.
```

### Evidence that was obtained — all repository or catalogue

| Evidence | Source |
|---|---|
| 13-path provider surface | `src/constants/endpoints.ts`, `src/v2/ingestion/provider/endpoints.ts`, inline calls in `src/jobs/*.ts` |
| `/match/{id}` exists and is uncalled | `endpoints.ts:40-43`; caller search returns only the JSDoc example |
| Auth is `x-api-key`, GET only | `client.ts:83`, `sportsApiClient.ts:50`; no non-`Map` `.delete(` |
| Season aggregates are called and mapped | `syncSeasonStatistics.ts:268-320, 438-439` |
| Zero references to the seven target relations | `grep -rn 'football\.<rel>' src/` |
| No writer for any of them | `grep -rniE 'INTO football\.(…)'` across `src/` and `v2/` |
| No manager anywhere | `information_schema` queries on tables and columns |
| `category` is a country | `reference.ts:34`, `schedule.ts:216`, `mapping/index.ts:115-117` |
| A tournament-structure endpoint is said to exist | `reference.ts:133-135` |
| `provider_external_id` nullable on editions | `information_schema.columns`; `reference.ts:101-122` |
| No recorded HTTP fixtures | no nock/msw/polly dependency; no cassette directory |

### The one thing that would change this report

```
GET {PT_V2_PROVIDER_BASE_URL}/match/{id}
Header: x-api-key: <key>
```

for any completed fixture. One call, against a 200/day budget. If the response contains a lineup or player array, G-1 through G-3, G-12 and possibly G-8 are answered at once. If it returns only teams, date and status as the registry says, G-1 is closed negatively for the known surface and the question moves to the provider's own documentation.

---

## 13. Remaining gaps

| ID | Gap | Phase-0 classification | Movement |
|---|---|---|---|
| **G-1** | Per-fixture player minutes | **NOT CONFIRMED** | **Unchanged — and now precisely bounded.** One uncalled endpoint is the live candidate |
| **G-2** | `appearance` has no writer or runner | **CONFIRMED (absence)** | Unchanged. Blocked by G-1 |
| **G-3** | `lineup` / `lineup_selection` have no writer | **CONFIRMED (absence)** | Unchanged. No lineup endpoint known |
| **G-4** | No player ingestion runner | **CONFIRMED (absence)** | **Not blocked by G-1.** The endpoint exists and V1 calls it. Buildable now |
| **G-5** | No governed competition kind | **NOT CONFIRMED** | No structured source found; `category` is geography |
| **G-6** | No governed stage kind | **NOT CONFIRMED** | `roundInfo` is flat. A structure endpoint is asserted in a comment |
| **G-8** | No manager relation or tenure | **NOT CONFIRMED / UNKNOWN** | No endpoint, no field, no relation. Tenure is a second requirement beyond identity |
| **G-9** | `player_availability` not populated | **CONFIRMED (absence)** | **Not blocked by G-1.** Writers exist; the squad endpoint is called by V1. **This is the second AC-4 blocker and it is closable** |
| **G-10** | No aggregate / qualification data | **NOT CONFIRMED** | Nothing read anywhere |
| **G-11** | Edition provider id nullable | **CONFIRMED** | Real, bounded, measurable after a backfill. §9 |
| **G-12** | `match_event` not populated | **NOT CONFIRMED** | No events endpoint. May share a call with G-1 |
| **G-13** | `provider_statistic` not populated | **CONFIRMED (absence)** | Season aggregates are available; the writer is missing |
| **G-14** | No V1 history | **CONFIRMED / ACCEPT** | Overwrite-in-place. Unchanged |

**No gap closed. Two — G-4 and G-9 — are confirmed as *not* depending on G-1**, which is the useful result: work can proceed on them while the provider question is outstanding.

---

## 14. Phase-0 decision

> # OPTION C — BLOCKED
>
> **G-1 remains OPEN.**
> **Rotation observation cannot be implemented as specified.**
> **Do not weaken AC-4.**

### Precisely what is and is not claimed

**Claimed:** the repository contains no endpoint, no call, no type, no test and no payload demonstrating per-fixture player appearance or minute data. Verified across both codebases, both endpoint registries, all thirteen known paths, every call site, and the full source tree.

**Not claimed:** that SportsAPI Pro cannot supply it. That remains **UNKNOWN**, and the repository itself gives a reason to think the known surface is incomplete (`reference.ts:133-135`, asserting a tournament-structure endpoint nobody calls).

### The three ways AC-4 must not be weakened

1. **Do not substitute season aggregates.** `player_season_statistics.minutes_played` is a per-tournament-season total. Differencing it is `INFERRED` where an appearance row is `OBSERVED` — a two-rank provenance downgrade under `football.provenance_class`, and permanent under the `min(ceiling, weakest input)` floor S-5 already enforces.
2. **Do not treat a missing appearance as zero minutes.** `appearance.minutes_played` is NOT NULL with `CHECK (0..150)`; absence must remain absence (PD-07 / LC-05). The four-way disambiguation of a zero — rested, unavailable, unused, unobserved — depends entirely on that.
3. **Do not infer rotation from lineup predictions.** `match_predicted_lineups` is V1's own model output. Using it as observation would make the platform's evidence its own prediction.

---

## 15. Recommended next step

**One question, one call, in this order.**

**Step 1 — obtain a provider credential and call `/match/{id}` for one completed fixture.** Any completed fixture will do; the Rosario Central pair is preferable only for narrative continuity. Save the response to `beta/backend/docs/api-samples/phase0-match-detail.json`.

- Contains a lineup or player array → **G-1, G-3, G-12 answered at once.** Re-run Phase 0 §3–§6 against the real payload and move to Option A or B.
- Contains only teams, date and status → G-1 is closed negatively for the known surface. Proceed to step 2.

**Step 2 — put five questions to SportsAPI Pro directly**, since the repository cannot answer them:

1. Is there an endpoint returning per-fixture player appearances or minutes?
2. Is there a lineup endpoint (starting XI, bench, formation)?
3. Is there a per-fixture player-statistics endpoint, as distinct from the season-scoped one?
4. Is there a match events or incidents endpoint?
5. Is there manager data, and does it carry appointment and departure dates?

Also ask about the **tournament-structure endpoint** the repository asserts exists — it bears on G-6 and G-10.

**Step 3 — regardless of the answers, close G-4 and G-9.** They do not depend on G-1: the squad endpoint exists, V1 calls it, and the V2 writers are already built and tested. G-9 is the *second* AC-4 blocker, so closing it removes one of the two gates and delivers `player`, `player_registration`, `player_availability` and `player_valuation` — value that stands on its own whatever the provider says about minutes.

**Do not begin Phases D–G.** They rest on `football.appearance`, and G-1 is open.

---

## Constraint compliance

| Rule | Observed |
|---|---|
| No database modification, DDL, DML, migration | None. `information_schema` and `pg_catalog` reads only |
| No production code change, no writer or runner added | None |
| No invented provider capability | Every capability is CONFIRMED FROM REPOSITORY ONLY, NOT CONFIRMED, or UNKNOWN. None is asserted as supported |
| No capability inferred from an endpoint name | `/match/{id}` is reported as an **uncalled endpoint with an unknown payload**, not as a match-detail capability |
| No fabricated payloads | `docs/api-samples/` untouched. LIVE PAYLOAD: NOT OBTAINED, with the reason stated |
| Season statistics not treated as appearances | §5 and §7 separate them explicitly; §14 forbids the substitution |
| Missing data not treated as zero | §14 point 2 |
| Team-level aggregates not substituted for player-level | §5, §14 point 1 |
| AC-4 not weakened | §11 states it is not runnable; §14 lists the three ways it must not be relaxed |
| Architecture not redesigned | No change proposed to any relation, vocabulary or constraint |
