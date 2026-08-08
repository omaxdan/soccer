# PitchTerminal V2 — Competition Context, Player Minutes & Rotation Intelligence: Feasibility Investigation

**Investigation only. Nothing was implemented, no migration written, no code or database modified.** Every claim below is marked with the evidence that supports it, and where the repository cannot answer a question it is marked `UNKNOWN` rather than guessed.

---

## 1. Executive verdict

### The headline finding

**The minute-delta approach is unnecessary, and building it would be a mistake.**

V2 already models exactly what you are trying to reconstruct:

```
football.appearance
  (fixture_partition_on, fixture_id, player_id)   UNIQUE
  minutes_played          smallint NOT NULL   CHECK 0..150
  participation_state_code text     NOT NULL   → STARTED | SUBSTITUTED_ON |
                                                 UNUSED_SUBSTITUTE | NOT_SELECTED
  position_code, yellow_cards, red_cards
```

That is per-fixture, per-player minutes as a first-class fact, partitioned by year, with a participation state that already distinguishes *started* from *came on* from *on the bench, unused* from *not in the squad*. The `0..150` bound accommodates extra time.

Deriving `+90, +30, 0` from consecutive season totals would be an **INFERRED** reconstruction of a fact the schema is designed to hold as **OBSERVED**. Under `football.provenance_class` those are ranks 2 and 4 — a two-rank downgrade, permanently, on the evidence every rotation claim would rest on.

**The gap is not the model. It is that nothing populates `appearance`, and no endpoint in either integration returns the data.**

### Capability classification

| # | Capability | Verdict | Evidence |
|---|---|---|---|
| 1 | Per-fixture player minutes — **schema** | **READY** | `football.appearance.minutes_played`, unique on (fixture, player) |
| 2 | Per-fixture player minutes — **data** | **DATA GAP** | Relation empty; no writer, no runner, no CLI |
| 3 | Per-fixture player minutes — **source** | **UNKNOWN** | No endpoint in V1 or V2 returns it; the provider's full catalogue is not verifiable from this repository |
| 4 | Season-minute snapshots over time | **DATA GAP — unrecoverable** | V1 upserts `on_conflict: player_id,season_external_id`; V2's `provider_statistic` has no temporal column. Neither keeps history, and none exists to mine |
| 5 | Season-minute **deltas** | **NOT VIABLE** | §5. Even with history it would be blind to cup minutes and cost one call per competition per team per observation |
| 6 | Complete competitive calendar of tracked teams | **READY** | `/schedule/{date}` is ingested unfiltered — V2 has **no** tracked-league filter |
| 7 | Distinguishing competitions | **READY** | `football.competition` + `competition_edition` + `competition_stage` |
| 8 | Distinguishing competition **type** (LEAGUE / CUP / CONTINENTAL …) | **ARCHITECTURE GAP** | No type column, no `competition_kind` vocabulary anywhere |
| 9 | Distinguishing stage **kind** (group / knockout / final) | **ARCHITECTURE GAP** | `competition_stage` has ordinal, depth, name, parent — no kind |
| 10 | League-only vs all-competitions separation — **vocabulary** | **READY** | `context_kind`: `ALL_COMPETITIONS`, `COMPETITION_SCOPED`, `CROSS_COMPETITION_DERIVED` |
| 11 | League-only vs all-competitions separation — **implementation** | **ARCHITECTURE GAP, and live today** | S-5 hard-codes `ALL_COMPETITIONS`; `readCompletedFixtures` has no competition predicate. **Cup fixtures already contaminate `home_form`/`away_form`** |
| 12 | Actual lineups | **DATA GAP** | `lineup` / `lineup_selection` modelled and empty; V1 has only *predicted* lineups |
| 13 | Regular-starter baseline | **DATA GAP** | Depends entirely on #2 |
| 14 | Rotation detection (90→0→90 etc.) | **DATA GAP** | Depends entirely on #2 |
| 15 | Manager identity | **ARCHITECTURE GAP — total** | **No manager or coach relation or column exists anywhere in the V2 database.** Verified by catalogue query |
| 16 | Manager rotation profile | **ARCHITECTURE GAP** | Not buildable at any level. Depends on #15 |
| 17 | Forward-looking fixture pressure | **READY** | `fixture` holds future fixtures with kickoff, edition, stage, venue |
| 18 | Objective competition importance | **ARCHITECTURE GAP** | No stage kind, no aggregate score, no qualification implication anywhere |
| 19 | Why a player played 0 minutes — four-way | **READY in design, DATA GAP in fact** | `participation_state` × `player_availability.unavailability_kind_code` × absent row. All modelled, none populated |
| 20 | Evidence grading (OBSERVED / INFERRED / …) | **READY** | `provenance_class` — 4 ranks, already the LC-37 floor rule in S-5 |

### Recommendation

> ## IMPLEMENT AFTER DATA GAP
>
> The architecture supports this work better than the brief assumes — `appearance`, `participation_state`, `context_kind` and `provenance_class` were designed for precisely these questions. What is missing is **data acquisition**, in this order:
>
> 1. **Confirm whether SportsAPI Pro exposes per-fixture lineups/minutes.** This single answer decides everything downstream. It cannot be answered from this repository.
> 2. If yes → build the ingestion; the schema needs no change for minutes.
> 3. If no → the feature is **NOT FEASIBLE WITH THE CURRENT DATA SOURCE** at the player level. The *team-level* competition-context half (schedule pressure, competition transitions) remains fully feasible and is worth building on its own.
>
> Two small, safe schema additions are needed regardless — competition kind and stage kind (§8). Manager intelligence needs a third and is a separate decision.

---

## 2. Current data flow

### 2.1 What runs today

```
SportsAPI Pro
   │
   │  GET /schedule/{date}          ← THE ONLY V2 INGESTION CALL
   ▼
ingestScheduleDate()  — one transaction per UTC date
   │
   ├─1─► football.competition            upsert, COALESCE
   ├─2─► football.competition_edition    upsert; season_period derived from the label
   ├─3─► football.competition_stage      upsert; only when roundInfo.round is present
   ├─4─► football.venue                  upsert; only when the event carries a venue id
   ├─5─► football.team          ×2       upsert
   ├─6─► football.team_registration ×2   upsert, registered_on immutable
   ├─7─► football.fixture                upsert (id, fixture_partition_on)
   ├─8─► football.fixture_lifecycle_transition   append-only
   └─9─► football.result (+ result_revision)     upsert / append
   │
   ▼
feature pipeline  (pt_pipeline_feature)
   readCompletedFixtures:  lifecycle_state_code = 'COMPLETED'
                           AND scheduled_kickoff_at < as_of
                           ← NO COMPETITION PREDICATE
   │
   ▼
feature.feature_value   context_kind_code = 'ALL_COMPETITIONS'   ← hard-coded
```

### 2.2 Where the flow stops

```
    player ─────────────► ✗  no runner. resolvePlayer() exported, never called
    appearance ─────────► ✗  NO WRITER AT ALL — not even an unused one
    lineup ─────────────► ✗  NO WRITER AT ALL
    lineup_selection ───► ✗  NO WRITER AT ALL
    match_event ────────► ✗  NO WRITER AT ALL
    provider_statistic ─► ✗  NO WRITER AT ALL
    player_registration ► ✗  writer exists (squad.ts), never called
    player_availability ► ✗  writer exists, never called
    player_valuation ───► ✗  writer exists, never called
    standing ───────────► ✗  writer exists (standings.ts), never called
    manager ────────────► ✗  RELATION DOES NOT EXIST
```

**Four of the relations this feature needs have no writer in the repository at all** — not merely an uncalled one. `appearance`, `lineup`, `lineup_selection` and `provider_statistic` were modelled by the migrations and never implemented.

### 2.3 V1's parallel flow, for comparison

```
GET /teams/{id}/tournament/{t}/season/{s}/player-statistics
   → playerStatistics[].statistics.minutesPlayed        ← SEASON AGGREGATE
   → public.player_season_statistics
       .upsert(rows, { onConflict: 'player_id,season_external_id' })
                     └──── OVERWRITE IN PLACE. NO HISTORY. ────┘
```

`syncSeasonStatistics.ts:438-439`. This is the origin of the season-minute value the brief refers to, and §5 explains why it cannot yield deltas.

---

## 3. Current table and schema mapping

Only relations that exist. Nothing invented.

### 3.1 Competition context

| Need | Relation.column | State |
|---|---|---|
| Competition identity | `football.competition` — `id`, `provider_external_id`, `provider_code`, `name`, `slug`, `country_code` | **populated by ingestion** |
| **Competition type** | — | **ABSENT.** No column, no vocabulary |
| Season | `football.competition_edition` — `id`, `competition_id`, `provider_external_id`, `season_label`, `season_period daterange` | **populated.** `provider_external_id` is **nullable** |
| Stage / round | `football.competition_stage` — `id`, `competition_edition_id`, `parent_stage_id`, `stage_ordinal`, `nesting_depth`, `name` | **populated when the feed sends `roundInfo.round`** |
| **Stage kind** | — | **ABSENT.** Hierarchy is expressible; kind is not |
| Statistical context axis | `football.context_kind` — `ALL_COMPETITIONS`, `COMPETITION_SCOPED`, `CROSS_COMPETITION_DERIVED` | **seeded, and only the first is used** |

### 3.2 Fixtures and the calendar

| Need | Relation.column | State |
|---|---|---|
| match_id | `football.fixture.id` (+ `fixture_partition_on`) | ✅ |
| team / opponent | `fixture.home_team_id`, `away_team_id` | ✅ |
| kickoff | `fixture.scheduled_kickoff_at timestamptz` | ✅ |
| home / away | positional, plus `fixture.is_neutral_venue` | ✅ |
| competition, season, stage | `fixture.competition_edition_id`, `competition_stage_id` | ✅ (stage nullable) |
| status | `fixture.lifecycle_state_code` → 7 codes incl. `POSTPONED`, `ABANDONED`, `CANCELLED`, `UNKNOWN` | ✅ |
| status history | `football.fixture_lifecycle_transition` — append-only | ✅ |
| result | `football.result` — full time, half time, extra time, penalties | ✅ |
| result corrections | `football.result_revision` — append-only | ✅ |

**The calendar requirement of §5 of the brief is met in full by relations that already exist and are already populated — except competition type and stage kind.**

### 3.3 Player minutes and participation

| Need | Relation.column | State |
|---|---|---|
| **Per-match minutes** | `football.appearance.minutes_played smallint NOT NULL` | **modelled, empty, no writer** |
| **Participation state** | `appearance.participation_state_code` → `STARTED` / `SUBSTITUTED_ON` / `UNUSED_SUBSTITUTE` / `NOT_SELECTED` | **modelled, empty** |
| Position played | `appearance.position_code` | modelled, empty |
| Cards | `appearance.yellow_cards`, `red_cards` (0..2 / 0..1) | modelled, empty |
| Starting XI | `football.lineup_selection.is_starting boolean NOT NULL` | **modelled, empty, no writer** |
| Formation | `football.lineup.formation` | modelled, empty |
| Season aggregates | `football.provider_statistic` — `measures jsonb`, `statistics_domain_code = 'PARTICIPATION'` ("Appearances, starts, minutes, rating") | **modelled, empty, no writer, and see below** |
| Substitution timing | `football.match_event` — `event_sequence`, `event_type_code`, `minute`, `player_id` | modelled, empty, no writer |
| Injury / suspension | `football.player_availability` — `spell_period daterange`, `unavailability_kind_code` → `INJURY` / `SUSPENSION` / `OTHER` | **modelled, empty; writer exists, uncalled** |
| Club membership over time | `football.player_registration` — `registration_period daterange`, `provenance_class_code` | **modelled, empty; writer exists, uncalled** |
| Position profile | `football.position_profile` — `role_rank`, `provenance_class_code` | modelled, empty |

**`provider_statistic` cannot hold a time series.** Its unique constraint is

```
(subject_kind_code, player_id, team_id, affiliation_team_id,
 competition_edition_id, statistics_domain_code, provider_code)  NULLS NOT DISTINCT
```

with only `created_at` / `updated_at` — **no `as_of` and no date in the key**. One row per player per edition per domain, current value. Storing a second observation would violate the constraint.

### 3.4 Managers

```sql
SELECT table_schema||'.'||table_name FROM information_schema.tables
 WHERE table_name ~* 'manager|coach|staff';          -- 0 rows
SELECT table_schema||'.'||table_name||'.'||column_name FROM information_schema.columns
 WHERE column_name ~* 'manager|coach';               -- 0 rows
```

**Nothing. No relation, no column, in any of the seven schemas.** The only occurrences of the word in the whole repository are three prose comments in V1 files.

### 3.5 Evidence grading

`football.provenance_class`, already the LC-37 floor rule S-5 enforces:

| Code | Rank | Meaning | Maps to the brief's §13 |
|---|---|---|---|
| `OBSERVED` | 4 | A provider stated it | **OBSERVED** |
| `DERIVED` | 3 | Calculated from observed facts | **OBSERVED**, computed |
| `INFERRED` | 2 | Reconstructed by heuristic where no direct source exists | **INFERRED** / **HISTORICAL PATTERN** |
| `ESTIMATED` | 1 | Modelled in the absence of any source | below the bar for this feature |

**UNKNOWN** is expressed by the absence of a row — PD-07 / LC-05, absence over substitution. Every calculator in S-5 already behaves this way: `formBackfill` returns null on an empty window rather than emitting a zero.

---

## 4. API capability audit

### 4.1 Every provider path either integration calls

| Path | Used by | Returns | Status |
|---|---|---|---|
| `/schedule/{date}` | **V2** + V1 | fixtures, competition, season, roundInfo, venue, both teams, status, scores | **AVAILABLE NOW** |
| `/tournaments` | V1 `syncDiscovery` | competition catalogue | **AVAILABLE, NOT INGESTED BY V2** |
| `/seasons` | V1 `syncDiscovery` | season catalogue | **AVAILABLE, NOT INGESTED BY V2** |
| `/teams/{id}/players` | V1 squad sync | roster, injury spells, positions, market values, contracts | **AVAILABLE, NOT INGESTED BY V2** |
| `/teams/{id}/transfers` | V1 | transfers in/out | **AVAILABLE, NOT INGESTED BY V2** |
| `/teams/{id}/tournament/{t}/season/{s}/player-statistics` | V1 | **season-aggregate** player minutes, appearances, starts, rating — **scoped to one tournament season** | **AVAILABLE, NOT INGESTED BY V2** |
| `/teams/{id}/tournament/{t}/season/{s}/statistics` | V1 | team season aggregates | **AVAILABLE, NOT INGESTED BY V2** |
| `/tournament/{t}/season/{s}/standings` | V1 | league table | **AVAILABLE, NOT INGESTED BY V2** |
| `/tournament/{t}/season/{s}/team-events` | V1 `syncTournamentEvents` | all events for a tournament season, schedule shape | **AVAILABLE, NOT INGESTED BY V2** |
| `/teams/{id}/events/last/{n}`, `/next/{n}` | V2 registry only | a team's own fixtures | registered, **never called** |
| `/teams/{id}/image`, `/tournament/{id}/image` | V1 | binary | V2: `DELIBERATELY_NOT_INGESTED` |

### 4.2 Against what this feature needs

| Requirement | Verdict |
|---|---|
| **All fixtures for a team, all competitions** | **AVAILABLE NOW.** `/schedule/{date}` is not filtered by competition, and neither is V2's ingestion (§6.1). Cup, continental and qualifier fixtures already arrive |
| **Cup / continental fixtures** | **AVAILABLE NOW**, same call |
| **Competition metadata** | **PARTIAL.** Name, country, season label and round number arrive. **Type does not** — see 4.3 |
| **Player season minutes** | **AVAILABLE BUT NOT INGESTED BY V2**, and per (team, tournament, season) — one call each |
| **Match-level player minutes** | **UNKNOWN.** No endpoint in either integration returns it. Not in V2's nine-entry registry; not called anywhere in V1 |
| **Actual lineups** | **UNKNOWN.** Same. V1 has only *predicted* lineups (`match_predicted_lineups`, migration 025), computed not ingested |
| **Player participation per match** | **UNKNOWN.** Same |
| **Managers** | **UNKNOWN.** No endpoint, no field read, no relation |

### 4.3 Why "UNKNOWN" and not "NOT AVAILABLE"

I can state with certainty what the repository *calls*. I cannot state what the provider *offers*. Two attempts to close that gap:

**Payload evidence: none available.** `docs/api-samples/` contains only its README — the mechanism captures samples on first run and has never run. Its own text: *"This directory starts empty."*

**Field-read evidence, which is suggestive but not conclusive.** Every field either integration reads from a schedule event:

```
V1 (syncDateMasterFeed):  id · homeTeam · awayTeam · homeScore · awayScore ·
                          season · startTimestamp · status · tournament · venue · winnerCode
V2 (stages/schedule.ts):  the same, plus roundInfo · neutralGround
```

No lineup, no incident, no manager field is read by either. **That is evidence about the integration, not about the payload** — a field can be present and unread.

> **This is the single question that decides the whole feature, and it must be answered against the provider, not against this repository.** Ask for: per-fixture lineups, per-fixture player minutes, per-fixture player statistics, manager/coach data, and a competition-type or category field.

---

## 5. Minute-delta feasibility — definitive answer

### 5.1 Verdict: **not feasible, and superseded**

| Question from §4 of the brief | Answer |
|---|---|
| **A. Do we store season minutes repeatedly over time?** | **No.** V1: `upsert … onConflict: 'player_id,season_external_id'` — one row per player per season, overwritten. V2: `provider_statistic` has no temporal column and a unique key that forbids a second observation |
| **B. Can we compute `current − previous`?** | **No.** There is no `previous`. Only the latest value has ever existed |
| **C. Can we reconstruct historical match minutes?** | **No.** Nothing to reconstruct from. Doc 15 already records that point-in-time reconstruction begins at cut-over for the V1 tables overwritten in place |
| **D. Does the provider give match-level minutes?** | **UNKNOWN** — §4.3. The endpoint V1 uses gives season aggregates only |
| **E. Are cup/continental matches available from the same source?** | **Yes** for *fixtures* — `/schedule/{date}`. For *minutes*, the aggregate endpoint is scoped per tournament season, so cup minutes need a separate call per competition |
| **F. Can we distinguish competitions and stages?** | **Identity yes, type no.** §3.1 |
| **G. What additional ingestion is required?** | §9 |

### 5.2 Three independent reasons not to build the delta approach even if history existed

**(a) It would be a two-rank provenance downgrade.** A delta is `INFERRED` — *"reconstructed by heuristic where no direct source exists"* — where `appearance.minutes_played` is `OBSERVED`. S-5 already enforces `min(ceiling, weakest input)`, so every downstream rotation feature would be permanently capped at INFERRED. The S-4 README states the principle for the analogous case: writing the stronger class for a snapshot-diff-derived fact is *"the single most damaging thing this subsystem could do."*

**(b) The aggregate is per-competition, so the delta is blind to exactly what you are trying to detect.** The endpoint is `/teams/{id}/tournament/{t}/season/{s}/player-statistics`. A delta on the *league* aggregate across a league→cup→league sequence shows the league minutes only — the cup appearance you need as confirming evidence is in a different aggregate entirely. Capturing both means one call per competition per team per observation.

**(c) The quota arithmetic forbids it.** Two observations per fixture per team per competition, against 200 calls/day, for an estate of ~76 teams in ~2–4 competitions each, is several hundred calls per matchday. Even one observation per team per competition per week does not fit.

### 5.3 A genuine ambiguity in the delta itself

A delta cannot distinguish **90 minutes in one match** from **45 + 45 across two matches** unless an observation is taken between every pair of fixtures — for every competition the team is in, on the exact days between them. Congested weeks are precisely when rotation happens and precisely when this fails.

The negative-delta rule in the brief is correct — a decrease is a correction, not negative minutes — but it is moot: there is nothing to subtract.

### 5.4 What must change instead

**Populate `football.appearance`.** It needs no schema change. It needs a provider endpoint (§4.3) and an ingestion stage.

---

## 6. Competition context feasibility

### 6.1 The good news: the calendar is already complete, unfiltered, and free

**V2 ingestion has no tracked-league filter.** Verified — `grep -rn 'TRACKED\|trackedLeagues' src/v2/` returns only comments in `vocabulary.ts`, `endpoints.ts` and `mapping/index.ts`; no code path filters an event. `ingestScheduleDate` iterates `response.events` and resolves **every one**.

So the architecture already does what §6 of the brief asks for, and does it the right way round:

```
/schedule/{date}                      ← every competition worldwide, one call
   ↓  ingest everything
football.fixture                      ← the complete competitive calendar, free
   ↓  filter at READ time, per consumer
product coverage    = the tracked subset          (a product decision)
team-context coverage = every fixture of a team    (already available)
```

**"Tracked competitions define product coverage; all official competitions involving tracked teams define team-context coverage"** is not a change to make. It is what the ingestion already does. The tracked-league concept exists only in V1 (`config/trackedLeagues.ts`) and was deliberately not carried across.

### 6.2 The bad news: the separation is declared but not implemented, and it is leaking today

`football.context_kind` has exactly the three codes this feature needs, and the third names your requirement outright:

| Code | Seeded meaning |
|---|---|
| `ALL_COMPETITIONS` | "Describes the subject overall. Fatigue, injury burden, travel load — quantities that do not partition." |
| `COMPETITION_SCOPED` | "Describes the subject within one competition edition. Form quality, opponent-adjusted strength, venue performance." |
| `CROSS_COMPETITION_DERIVED` | **"Explicitly about the interaction between competitions. Congestion, active competition count, rotation pressure."** |

`feature_value.context_competition_edition_id` scopes a `COMPETITION_SCOPED` value to one edition, and `ck_feature_value__context_edition_conditional` enforces the pairing. The registry binds `team.home_form` and `team.away_form` to **both** `ALL_COMPETITIONS` and `COMPETITION_SCOPED`.

**But:**

```ts
// src/v2/feature/calculators/types.ts:46
export const CALCULATION_CONTEXT_KIND = 'ALL_COMPETITIONS';
```

Hard-coded, used by `write/values.ts`, `pipeline.ts` and `registry/declare.ts`. And `readCompletedFixtures` filters on `lifecycle_state_code = 'COMPLETED'` and kickoff only — **no competition predicate**.

> ### Finding CC-1 — cup fixtures already contaminate league form
>
> `team.home_form` and `team.away_form` are computed over **every completed fixture of any competition**, and written under a single `ALL_COMPETITIONS` context. The registry says a `COMPETITION_SCOPED` variant may exist; nothing writes one.
>
> **There is no "last 5 league matches" in V2 today — only "last 5 fixtures of any kind".** The brief's requirement that cup fixtures must not become Team A's last five league matches is already violated, before any new work.
>
> This is a pre-existing implementation gap, not a consequence of the proposed feature. It is also the cheapest item in this report to fix: the machinery, the vocabulary, the registry bindings and the constraint all exist.

### 6.3 What competition type would require

`football.competition` is `id · provider_external_id · provider_code · name · slug · country_code`. No type. Nothing in the seven schemas types a competition.

Classifying by name would be exactly the failure mode the brief forbids — and the S-4 mapping layer already refuses this class of guess: `mapCountry` *"does not create vocabulary rows"*, and an unmapped value is counted and logged rather than invented.

The clean shape, matching every other governed vocabulary in V2:

- a `football.competition_kind` vocabulary — code, display_name, meaning, effective period
- a `competition.competition_kind_code` FK, **nullable**, so an unclassified competition is `UNKNOWN`-by-absence rather than mis-typed
- population from a provider category field **if one exists** (`uniqueTournament.category` is already read for the country and may carry more) — otherwise a governed seed, which is a product decision, not an ingestion one

The same shape for `competition_stage.stage_kind_code` (GROUP / KNOCKOUT / FINAL / QUALIFIER / PLAYOFF).

**Both are `UNKNOWN` as to source** until the provider payload is inspected.

---

## 7. Rotation intelligence feasibility

Every one of the brief's patterns is computable **from `appearance` alone**, with no delta arithmetic:

| Requirement | Expression over `appearance` | Blocked by |
|---|---|---|
| Last-match minutes | `minutes_played` at the most recent fixture | data |
| Last-3 / last-5 minutes | window over `(player_id, fixture ORDER BY kickoff DESC)` | data |
| Average recent minutes → **baseline** | mean over a window | data |
| Consecutive appearances | run-length over `participation_state_code IN ('STARTED','SUBSTITUTED_ON')` | data |
| Consecutive 90-minute appearances | run-length over `minutes_played >= 90` | data |
| Consecutive zero-minute matches | run-length over `minutes_played = 0` | data |
| Minutes trend / workload deviation | recent mean vs baseline | data |
| Days since last appearance | kickoff arithmetic | data |
| **Regular starter** | share of `participation_state_code = 'STARTED'` over a window; corroborated by `lineup_selection.is_starting` | data |
| Patterns A–D (90→0→90, 90→25→90, …) | the ordered minute sequence, directly | data |

**Everything is `DATA GAP`, nothing is `ARCHITECTURE GAP`.** The schema is ready.

### 7.1 Disambiguating a zero — the four-way test the brief asks for

This is fully expressible today, and it is the strongest argument for using `appearance` rather than deltas — **a delta of 0 is a single undifferentiated fact**, whereas the modelled data separates all four causes:

| Cause | Signature |
|---|---|
| **Rested / not selected** | `appearance` row, `participation_state_code = 'NOT_SELECTED'`, **no** open `player_availability` spell covering the kickoff |
| **Injured or suspended** | `participation_state_code = 'NOT_SELECTED'`, **and** an open `player_availability` spell whose `spell_period` contains the kickoff, with `unavailability_kind_code IN ('INJURY','SUSPENSION','OTHER')` |
| **In the squad, unused** | `participation_state_code = 'UNUSED_SUBSTITUTE'` — a meaningfully different signal from not being named at all |
| **Data incomplete** | **no `appearance` row for that (fixture, player)** — absence, per PD-07 / LC-05 |

The fourth case is why every rotation claim must state its denominator: "five of eleven regular starters" is a claim about eleven observed rows, and it is unsupportable if only six exist.

### 7.2 Manager rotation profile — not buildable

**No manager relation, no manager column, no manager endpoint, no manager field read anywhere.** Every metric in §11 of the brief — pre-cup rotation rate, protection rate, complete-rest rate — requires manager identity over time.

The brief's own requirement that a tendency must not remain attached to a team forever is the harder half: distinguishing *current manager tendency* from *historical team tendency* needs manager **tenure as a bounded period**, which is the `daterange` + exclusion-constraint shape V2 already uses for `player_registration` and `player_availability`. That shape is well understood here; the relation simply does not exist.

**Until manager identity is ingested, only team-level tendency is computable**, and it must be labelled as such — a team tendency spanning a managerial change is a measured rate spanning two rules, which doc 22 already established describes a system that never existed.

---

## 8. Proposed architecture

No SQL. Minimal, and aligned to what already exists.

### 8.1 Layer 1 — new ingestion, no new modelling for minutes

```
Provider
  ├─ /schedule/{date}              EXISTS  → the complete calendar, unfiltered
  ├─ <per-fixture lineups>         UNKNOWN → football.lineup, lineup_selection
  ├─ <per-fixture minutes>         UNKNOWN → football.appearance          ★ the decisive one
  ├─ /teams/{id}/players           EXISTS  → player, player_registration,
  │                                          player_availability, player_valuation
  └─ <manager>                     UNKNOWN → a relation that does not exist
```

Two vocabulary additions, both following the existing governed-vocabulary pattern exactly:

```
football.competition_kind    LEAGUE · DOMESTIC_CUP · LEAGUE_CUP · CONTINENTAL ·
                             CONTINENTAL_QUALIFIER · PLAYOFF · SUPER_CUP ·
                             OTHER_OFFICIAL · FRIENDLY
   → competition.competition_kind_code   FK, NULLABLE

football.competition_stage_kind   GROUP · KNOCKOUT · QUALIFIER · FINAL · PLAYOFF · REGULAR
   → competition_stage.stage_kind_code   FK, NULLABLE
```

Nullable is load-bearing: an unclassified competition must read as *unknown*, never as `OTHER_OFFICIAL` by default. That is LC-05 — absence over substitution.

### 8.2 Layer 2 — where each new feature belongs

The `context_kind` vocabulary already decides this, and following it prevents the double-counting §14 of the brief is worried about:

| Feature | Context kind | Subject | Why there |
|---|---|---|---|
| `team.league_form` (home/away) | **`COMPETITION_SCOPED`** | TEAM | Form *within* one competition. Closes CC-1 |
| `team.home_form`, `team.away_form` | `ALL_COMPETITIONS` (unchanged) | TEAM | Overall competitive form — keeps today's meaning, now explicitly |
| `team.congestion_index` | `ALL_COMPETITIONS` (unchanged) | TEAM | **Already exists. Do not duplicate it** |
| `team.rest_advantage` | `ALL_COMPETITIONS` (unchanged) | TEAM | **Already exists. Do not duplicate it** |
| `team.rotation_pressure` | **`CROSS_COMPETITION_DERIVED`** | TEAM | The vocabulary names this exact concept. Forward-looking: an important fixture within N days |
| `team.rotation_observed` | **`CROSS_COMPETITION_DERIVED`** | TEAM | Backward-looking: regular starters who received reduced minutes |
| `player.workload_index` | `ALL_COMPETITIONS` | **PLAYER** | `feature_value` already supports `subject_player_id` — no schema change |
| `player.is_regular_starter` | `ALL_COMPETITIONS` | PLAYER | Baseline for the above |

**The double-counting rule falls out of the vocabulary.** Congestion is *fixture density* — `ALL_COMPETITIONS`, already built. Rotation pressure is *the interaction between competitions of differing priority* — `CROSS_COMPETITION_DERIVED`, new. They are different quantities at different context kinds, which is the separation the brief asks for and the schema already encodes.

### 8.3 Evidence grading falls out of `provenance_class`

| Claim | Class | Wording |
|---|---|---|
| An important fixture is 3 days away | `DERIVED` | *"An important cup fixture is scheduled three days later, creating elevated rotation pressure."* |
| Five regular starters had reduced minutes | `OBSERVED` | *"Five regular starters received reduced or no minutes in the preceding fixture and returned to the starting XI."* |
| The team has behaved this way before | `INFERRED` | *"This team has historically reduced regular-starter minutes in comparable fixtures."* — and **not** attributed to a manager unless tenure is known |
| Insufficient appearance rows | *no row* | Absence. Never a zero, never a hedge |

The floor rule already exists and is already enforced: `min(registry ceiling, weakest lineage input)`.

### 8.4 What must not be built

- **No minute-delta calculator.** §5.
- **No competition classification by name.** §6.3.
- **No manager tendency without manager tenure.** §7.2.
- **No "team lost because they rotated" claim at any provenance class.** That is causal attribution, and nothing in this design can support it.

---

## 9. Data gaps

| ID | Gap | Rank | Effort | Note |
|---|---|---|---|---|
| **G-1** | **Per-fixture player minutes — is there a source?** | **CRITICAL** | Investigation first | Decides the entire feature. Cannot be answered from this repository |
| **G-2** | `football.appearance` has no writer and no runner | **CRITICAL** | M | Blocked by G-1. Schema needs no change |
| **G-3** | `football.lineup` / `lineup_selection` have no writer | **CRITICAL** | M | Corroborates starter status; same endpoint as G-1, probably |
| **G-4** | No player ingestion runner at all | **CRITICAL** | M | `resolvePlayer`, `recordRegistration`, `recordUnavailability`, `recordValuations` all exist and are uncalled — doc 29 **B-1** |
| **G-5** | No competition kind | **HIGH** | S | One vocabulary, one nullable FK. Population source **UNKNOWN** |
| **G-6** | No stage kind | **HIGH** | S | As above. Needed for "important fixture" objectively rather than by name |
| **G-7** | S-5 writes only `ALL_COMPETITIONS`; `readCompletedFixtures` has no competition filter | **HIGH** | S | **CC-1.** Live contamination today, independent of this feature |
| **G-8** | No manager relation anywhere | **HIGH** | M | Blocks all of §11. Needs tenure as a bounded period, plus a source (**UNKNOWN**) |
| **G-9** | `player_availability` never populated | **HIGH** | S | Blocked by G-4. Without it, rested and injured are indistinguishable — §7.1 |
| **G-10** | No aggregate score / qualification implication | **MEDIUM** | M | Needed for objective importance beyond stage kind. Source **UNKNOWN** |
| **G-11** | `competition_edition.provider_external_id` nullable and often absent | **MEDIUM** | S | Blocks any per-competition endpoint call — doc 29 **B-5** |
| **G-12** | `match_event` never populated | **MEDIUM** | M | Would give substitution minute, refining "reduced minutes" |
| **G-13** | `provider_statistic` never populated | **LOW** | S | Season aggregates are a cross-check on `appearance`, not a substitute |
| **G-14** | No V1 history to mine | **LOW — accept** | — | Overwrite-in-place; doc 15 already records that reconstruction begins at cut-over |

---

## 10. Risks

### 10.1 False positives — claiming rotation that did not happen

| Risk | Mechanism | Control |
|---|---|---|
| **Injury read as rotation** | A player rested for fitness looks identical in minutes to one dropped tactically | **Hard gate:** exclude any player with an open `player_availability` spell over the kickoff. Without G-9 this control does not exist and the whole feature must not ship |
| **Suspension read as rotation** | Same shape | Same control; `unavailability_kind_code = 'SUSPENSION'` |
| **Incomplete data read as rest** | A missing `appearance` row is not a zero | **Never treat absence as 0.** Require the full XI observed before any team-level rotation claim, and state the denominator |
| **Transfers** | A player who left is not "rested" | `player_registration.registration_period` must contain the kickoff |
| **Mid-season joiners** | Thin baseline reads as unusual | Minimum appearance count before a baseline exists — the `meaningful_sample_threshold` mechanism already does this |
| **Squad-rank confusion** | A 25-minute player playing 20 is normal; an 82-minute player playing 20 is not | Baseline must be per player, never per squad |
| **Postponements** | A cup tie moved changes the pressure that existed at `as_of` | `fixture_lifecycle_transition` is append-only, so the state at `as_of` is recoverable — **but only if the feature reads the state as of that instant, not the current one** |
| **Coincidence** | Three days between fixtures is common | Require repetition. A single instance is `POTENTIAL`, never `CONFIRMED` |
| **Manager change** | A tendency attributed across a change measures two rules | Do not attribute to a manager without tenure (G-8) |

### 10.2 False negatives — missing rotation that did happen

| Risk | Mechanism |
|---|---|
| **Positional rotation** | The whole XI changes but total minutes look normal — only `lineup_selection` reveals it (G-3) |
| **Half-time protection** | 45 minutes reads as partial rotation and may be tactical instead. `match_event` would disambiguate (G-12) |
| **Extra time** | A 120-minute cup tie inflates the following window. `result` holds extra-time scores; `appearance` allows up to 150 |
| **Unclassified competition** | If `competition_kind` is null, the transition is invisible (G-5) |
| **Squad depth** | Genuinely equal options mean no measurable rotation |
| **Congested weeks** | Where deltas fail worst (§5.3) and `appearance` does not |

### 10.3 The overarching risk

**Presenting an INFERRED pattern with the confidence of an OBSERVED fact.** The provenance floor already prevents this mechanically — a composite is capped at its weakest input — provided rotation features declare their lineage honestly. The A.12 trigger cannot fire (finding S5-1), so this rests on the application's write-boundary computation and the `provenance_propagation` verification control, which is a *temporary* stand-in. Any new feature must be covered by it.

---

## 11. Recommended implementation phases

Reordered from the brief, because two prerequisites sit ahead of everything and one item is independently worth doing now.

### Phase 0 — Answer the API question *(blocking, days)*

Ask the provider, in writing: per-fixture lineups; per-fixture player minutes; per-fixture player statistics; manager/coach data; a competition type or category field. Capture one real payload per endpoint into `docs/api-samples/` — the mechanism exists and costs nothing.

**Nothing after this phase can be scoped until it is answered.**

### Phase A — Close CC-1 *(independent, small, do it regardless)*

Bind `team.home_form` / `team.away_form` to `COMPETITION_SCOPED` as well as `ALL_COMPETITIONS`, and filter `readCompletedFixtures` by competition edition for the scoped variant. **This is worth doing on its own merits** — league form is currently contaminated by cup fixtures and the fix needs no new data.

### Phase B — Competition kind and stage kind *(small)*

Two vocabularies, two nullable FKs, populated from a provider field if one exists or by governed seed if not. Unlocks "league → important cup → league" as an objective sequence rather than a name match.

### Phase C — Player ingestion *(medium — doc 29 B-1, B-2)*

Wire the four existing, uncalled squad writers. Delivers `player`, `player_registration`, `player_availability`, `player_valuation`. **B-2 must land first** — `closeResolvedSpells` reads the wall clock. `player_availability` is the injury/suspension gate that every rotation control depends on.

### Phase D — Appearance ingestion *(medium — blocked by Phase 0)*

Populate `football.appearance` and `lineup` / `lineup_selection`. **No schema change.** This replaces the entire minute-delta idea.

### Phase E — Player workload features *(medium)*

`player.workload_index`, `player.is_regular_starter` — PLAYER-subject, `ALL_COMPETITIONS`. `feature_value` already supports `subject_player_id`; no schema change.

### Phase F — Competition pressure *(medium)*

`team.rotation_pressure` at `CROSS_COMPETITION_DERIVED`. Forward-looking, derived from the calendar plus competition kind. **Does not depend on Phase D** — it can ship before player minutes exist, as `POTENTIAL ROTATION PRESSURE` only.

### Phase G — Rotation observation *(medium)*

`team.rotation_observed` at `CROSS_COMPETITION_DERIVED`. Requires D and E. Upgrades `POTENTIAL` to `CONFIRMED`.

### Phase H — Manager profile *(large, gated on G-8)*

Only after manager identity **and tenure** are ingested. Until then, team tendency labelled as team tendency.

### Phase I — Team Preparedness integration *(gated on S-6)*

S-6 is not implemented and cannot currently be specified (docs 25–27). The features above are Layer 2 and can exist and be verified without it.

```
Phase 0 ──┬─► Phase B ──┬─► Phase F ──┐
          │             │             ├─► Phase G ──► Phase I (gated on S-6)
          └─► Phase D ──┴─► Phase E ──┘
Phase A  (independent — ship now)
Phase C  (independent of Phase 0 — the writers already exist)
Phase H  (gated on G-8, may never be answerable)
```

---

## 12. Acceptance criteria

Objective, falsifiable, and honest about what cannot yet be tested.

### AC-1 — Complete competitive calendar *(testable today)*

For a tracked team over a 90-day window, every fixture the provider returned appears in `football.fixture`, across every competition, each resolvable to a competition, edition and — where the feed sent a round — a stage.

```sql
SELECT c.name AS competition, e.season_label, count(*) AS fixtures
  FROM football.fixture f
  JOIN football.competition_edition e ON e.id = f.competition_edition_id
  JOIN football.competition c ON c.id = e.competition_id
 WHERE (f.home_team_id = :team OR f.away_team_id = :team)
 GROUP BY 1,2 ORDER BY 1;
-- PASS: more than one competition appears for a team in cup competition
```

### AC-2 — League form excludes cup fixtures *(Phase A)*

For a team with both league and cup fixtures, a `COMPETITION_SCOPED` `home_form` value cites only fixtures from that edition, and its `ALL_COMPETITIONS` counterpart differs. **Failing this today is the expected result and is finding CC-1.**

### AC-3 — Competition transition detected *(Phase B + F)*

Given league → domestic cup → league within 8 days, a `team.rotation_pressure` value exists at the appropriate `as_of` with `provenance_class_code = 'DERIVED'`, and its text says *pressure*, never *cause*.

### AC-4 — Rotation observed *(Phases D + E + G)* — **the Rosario Central test**

Only runnable once `appearance` is populated. Using the brief's example:

| Step | Assertion |
|---|---|
| 1 | Both fixtures exist: Independiente del Valle vs Rosario Central (28 May) and Estudiantes vs Rosario Central (31 May), in **different** competitions |
| 2 | The gap is computed as 3 days from `scheduled_kickoff_at`, not asserted |
| 3 | Each Rosario Central player has an `appearance` row for both fixtures |
| 4 | `player.is_regular_starter` is established from a window ending **before** 28 May — no lookahead |
| 5 | A regular starter with baseline ≥ 80 minutes who played ≤ 30 on 28 May and ≥ 80 on 31 May is identified |
| 6 | Every such player has **no** open `player_availability` spell over 28 May |
| 7 | The output reads *"N regular starters received reduced minutes in the preceding fixture and returned for the cup match"* — a count, not a cause |
| 8 | **No output claims the 28 May result was caused by rotation** |

**AC-4 fails today for a reason that is not a defect: `football.appearance` is empty and has no source.** That is the honest state, and it is what Phase 0 exists to change.

### AC-5 — Zero-minute disambiguation *(Phase C + D)*

Four synthetic players in one fixture — rested, injured, unused substitute, no row — each classified into the correct one of the four categories in §7.1. **No two classified the same.**

### AC-6 — No speculation

A text scan of every emitted string: no output contains a causal connective linking a rotation observation to a result (`because`, `due to`, `as a result of`, `caused`). Mechanically checkable, in the spirit of the existing source scan that proves no calculator reads the wall clock.

### AC-7 — No double counting

For one (team, `as_of`), `team.congestion_index` and `team.rotation_pressure` are shown to derive from disjoint inputs — congestion from fixture density, rotation pressure from competition-kind transition — evidenced by their `feature_source` / `feature_dependency` declarations, which S-5 already requires and proves by test.

### AC-8 — Provenance floor holds

No rotation feature carries a `provenance_class_code` stronger than its weakest input. Verifiable by the existing `provenance_propagation` control, which any new feature must be added to.

---

## Constraint compliance

| Rule | Observed |
|---|---|
| Do not modify the database | No DDL, no DML, no migration. Read-only catalogue queries only |
| Do not create migrations or tables | None written. §8.1 describes two vocabularies as *proposals requiring the architecture owner's decision* |
| Do not change production code | Nothing edited |
| Do not invent API capabilities | Every endpoint listed is one the repository calls. Everything else is marked **UNKNOWN**, with the reason |
| Do not assume missing data exists | `appearance`, `lineup`, `provider_statistic`, manager — all stated as absent, with the catalogue query that proves it |
| Do not weaken V2 architecture | Every proposal uses an existing vocabulary, an existing context kind, an existing provenance class or an existing subject kind |
| Do not contaminate league-only statistics | Finding **CC-1** reports that this is **already happening**, and Phase A closes it |
| Do not treat speculation as fact | §8.3, AC-6, and the `POTENTIAL` / `CONFIRMED` / `HISTORICAL` separation throughout |
| No betting terminology, no prediction logic | None used. Every proposed output is a description of observed workload |
