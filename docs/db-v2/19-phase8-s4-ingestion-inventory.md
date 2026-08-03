# PitchTerminal V2 — S-4 Ingestion Foundation: Pre-implementation Inventory

Produced before any S-4 code is written, per the S-4 brief. **No implementation has begun.**

**Authority order:** the approved migration set (001–019) over V1 application code. Where V1 and the schema disagree, the schema is right and V1's shape is a defect being corrected — that is the whole reason S-4 exists.

---

## 1. Provider ingestion sources

Two providers, one of which is currently dormant.

| # | Provider | `provider_code` | Client | Base URL | Status |
|---|---|---|---|---|---|
| 1 | SportsAPI Pro | `SPORTSAPI` | `src/services/sportsApiClient.ts` | `config.sportsapi.baseUrl` | **Active — sole live source** |
| 2 | SofaScore direct | `SOFASCORE` | `src/services/sofaScoreClient.ts` | `config.sofascore.baseUrl` | **Dormant** — Cloudflare 403s all server requests |

SportsAPI Pro is a SofaScore reseller: **same entity ids, same payload schema**. `syncSquadSofaScore.ts` reaches SofaScore *data* through the SportsAPI *client*, which is why the squad endpoint appears under a SofaScore heading in `endpoints.ts` but is fetched over the SportsAPI transport.

**This matters for identity.** `provider_code` participates in `uq_team__provider_external_id (provider_code, provider_external_id)` and its equivalents on `competition`, `player` and `fixture`. If the same numeric id is written once as `SPORTSAPI` and once as `SOFASCORE`, the platform acquires two teams where one exists — and every feature, reading and snapshot splits across them. Since the ids are literally the same values from the same upstream, **S-4 must write exactly one provider code for both paths.**

### 1.1 Endpoints in use

| Key | Path | Consumers | Volume |
|---|---|---|---|
| `schedule` | `/schedule/{date}` | `syncDateMasterFeed`, `syncSchedule`, `backfillSeason` | **Primary feed.** 1 call/day |
| `tournaments` | `/tournaments` | `syncDiscovery` | 1 call |
| `seasons` | `/seasons` | `syncDiscovery` | 1 call |
| `team_players` | `/teams/{id}/players` | `syncTeamsPlayers` | 1 call/team |
| `tournament_team_events` | `/tournament/{t}/season/{s}/team-events` | `syncTournamentEvents` | 1 call/tournament-season |
| `team_events_last` | `/teams/{id}/events/last/{n}` | CLI only | **targeted use only** |
| `team_events_next` | `/teams/{id}/events/next/{n}` | CLI only | **targeted use only** |
| *(unregistered)* | `/team/{id}/players` | `syncSquadSofaScore` | 1 call/team → 7 V1 tables |
| *(unregistered)* | `/teams/{id}/transfers` | `syncTransfersV2` | 1 call/team |
| *(unregistered)* | `/teams/{id}/image`, `/tournament/{id}/image` | `syncTeamImages` | binary, not entity data |
| *(unregistered)* | standings path | `syncStandings` | 1 call/tournament-season |

Four paths are constructed inline rather than through `ENDPOINT_REGISTRY`. `operations.api_usage.endpoint_key` is NOT NULL, so **S-4 needs one registry covering every path**, or quota telemetry silently under-reports the four that bypass it.

### 1.2 Quota — the binding constraint

`SportsAPIClient` supports **dual keys, round-robin, 100 requests/day each → 200/day**. Call counts are in-memory and reset on process restart; the client's own comment concedes it is "NOT a persistent historical record."

`operations.api_usage` (E9.05) exists precisely for this and is **retained longest among operational content** (§B.9.4). Its table comment names this V1 gap directly: *"the previous platform carried configuration specifically to double a daily quota by adding a second credential, and nothing recorded consumption."*

At 57 tracked leagues, a per-team endpoint costs ~76 calls — most of a single key's daily budget. **Quota is the binding constraint on freshness**, and S-4 is the first subsystem in a position to measure it.

---

## 2. Provider entity → V2 canonical entity

### 2.1 Direct identity mappings

| Provider entity | V1 table | V2 relation | Provider key |
|---|---|---|---|
| `uniqueTournament` | `tournaments` | `football.competition` | `(provider_code, provider_external_id)` NOT NULL |
| `season` | `seasons` | `football.competition_edition` | `provider_external_id` **nullable** |
| `roundInfo` / stage | — | `football.competition_stage` | — |
| `venue` / `stadium` | `stadiums` | `football.venue` | `provider_external_id` **nullable**, UNIQUE |
| `team` | `teams` | `football.team` | `(provider_code, provider_external_id)` NOT NULL |
| `player` | `players` | `football.player` | `(provider_code, provider_external_id)` NOT NULL |
| `event` / match | `matches` | `football.fixture` | `(provider_code, provider_external_id, fixture_partition_on)` |
| `homeScore`/`awayScore` | `match_results` | `football.result` | via fixture |
| `referee` | — | `football.official` | `provider_external_id` nullable |
| `category` | `countries` | **`football.country`** | **governed vocabulary — see §4** |

### 2.2 Decomposition mappings

Four V1 records each fan out into several V2 relations. This is where V2's shape differs most from what the sync jobs currently produce.

**`players` → four relations.** V1 carries biography, positional profile, current club and market value on one row, overwritten every sync.

| Provider field | V2 target | Note |
|---|---|---|
| `name`, `dateOfBirth`, `height`, `preferredFoot`, nationality | `football.player` | **biography only** — no computed attribute (LC-07) |
| `positionsDetailed` | `football.position_profile` | **not seeded in S-3** — see §4.2 |
| team affiliation | `football.player_registration` | dated `daterange`, carries `provenance_class_code` |
| `proposedMarketValueRaw` | `football.player_valuation` | **append-only**, dated, currencied |
| `injury` | `football.player_availability` | spell as `daterange`, not a flag |

`player_availability`'s comment states the intent plainly: V1 held injury state in two places written by the same process with nothing constraining them to agree, and *"the resolution is removal of one representation, not synchronisation of both."* **Current availability is a query over open spells, never a stored flag** (LC-11).

**Match status → two relations.** V1's `transformMatch` maps 13 provider status codes onto 8 strings and stores the result on `matches.status`, overwritten in place. V2 splits this:

- `football.fixture.lifecycle_state_code` — the **platform's** state, FK to a 7-code governed vocabulary
- `football.fixture.provider_status_raw` — the provider's own string, *"load-bearing for nothing"*
- `football.fixture_lifecycle_transition` — **append-only** history of every state change

A postponed-and-replayed fixture gets a legible history instead of a final state that conceals it.

**Score → two relations.** `football.result` plus `football.result_revision`, which records a post-confirmation correction as *"a revision with its own record, never a silent overwrite"* (LC-17). V2's result also models extra time and penalties explicitly; V1's shape is lossy for cup fixtures.

**Squad snapshot → registrations.** V1's `team_squads_snapshot` is a per-sync roster dump. V2 expresses the same information as dated `player_registration` rows, where a transfer is *"the boundary between two registrations, not an independent fact."* Boundaries derived by comparing snapshots are `INFERRED`, not `OBSERVED` — and `provenance_class_code` is NOT NULL precisely so a consumer can tell.

### 2.3 Out of scope for ingestion

`syncTeamImages` fetches binary assets. No V2 relation holds them; they are not football reality. Excluded.

Every `process*.ts` job is **feature calculation** (S-5) or **module evaluation** (S-6), not ingestion. The S-4 constraint *"do not calculate intelligence during ingestion"* is satisfied structurally: `pt_pipeline_ingestion` holds `SELECT` only on `feature`, `module`, `snapshot` and `calibration` — it **cannot** write a feature value even if code tried.

---

## 3. Foreign key targets

Every FK an ingestion write must satisfy. All are `ON DELETE RESTRICT ON UPDATE RESTRICT`.

### 3.1 Onto governed vocabularies

| Relation | Column | Target | Seeded by |
|---|---|---|---|
| `competition` | `country_code` | `football.country` | **S-3** (24 codes) |
| `team` | `country_code` | `football.country` | **S-3** |
| `player` | `nationality_code` | `football.country` | **S-3** |
| `player_valuation` | `currency_code` | `football.currency` | **S-3** (14 codes) |
| `player_availability` | `position_code_at_onset` | `football.position` | **S-3** (11 codes) |
| `player_availability` | `valuation_currency_code_at_onset` | `football.currency` | **S-3** |
| `position_profile` | `position_code` | `football.position` | **S-3** |
| `fixture` | `lifecycle_state_code` | `football.fixture_lifecycle_state` | migration 002 |
| `fixture_lifecycle_transition` | `from_state_code`, `to_state_code` | same | migration 002 |
| `player_registration` | `registration_kind_code` | `football.registration_kind` | migration 002 — `PERMANENT`, `LOAN_IN`, `LOAN_OUT` |
| `player_registration` | `provenance_class_code` | `football.provenance_class` | migration 002 |
| `player_availability` | `unavailability_kind_code` | `football.unavailability_kind` | migration 002 — `INJURY`, `SUSPENSION`, `OTHER` |
| `lineup_selection` | `participation_state_code` | `football.participation_state` | migration 002 |
| `provider_statistic` | `statistics_domain_code`, `subject_kind_code` | respective | migration 002 |

**Nullability is the safety valve.** `competition.country_code`, `team.country_code`, `player.nationality_code` and `position_code_at_onset` are **nullable**. `player_valuation.currency_code` and `fixture.lifecycle_state_code` are **NOT NULL**. That difference decides §4's handling per case, and it is the schema's decision, not one S-4 gets to make.

### 3.2 Onto entities — the resolution order

```
country (S-3, static)
   └── competition ─── competition_edition ─── competition_stage
                              │
venue ──────────┐             │
                ├─── team ─── team_registration
                │      │
                │      └───── fixture ─── result ─── result_revision
                │                 │
                │                 ├───── fixture_lifecycle_transition
                │                 ├───── official_assignment ─── official
                │                 └───── lineup ─── lineup_selection ─── appearance
                │                                                   └─── match_event
                └─── player ─── player_registration
                          ├──── player_availability
                          ├──── player_valuation
                          └──── position_profile
```

**A single `/schedule/{date}` response contains entities at seven of these levels.** V1's master feed already resolves them in dependency order (`countries → stadiums → tournaments → seasons → teams → matches → match_results`); V2's graph is deeper because of the decompositions in §2.2, but the discipline is the same and V1's ordering is sound. It is preserved.

### 3.3 Composite references (R-01)

`football.fixture` is partitioned by `fixture_partition_on`, so its PK is `(id, fixture_partition_on)` and **every child reference is composite**: `result`, `fixture_lifecycle_transition`, `official_assignment`, `lineup`, `match_event`.

**ER-01 applies directly.** `fixture_partition_on` is a `date`, not a `timestamptz`, which avoids the microsecond truncation that broke S-2's job-run pairing — but the rule stands for `scheduled_kickoff_at` and every operational instant S-4 carries. Ingestion supplies partition dates itself, derived in UTC:

```
fixture_partition_on = (scheduled_kickoff_at AT TIME ZONE 'UTC')::date   at creation
```

and **never advances** — `ck_fixture__partition_not_after_kickoff` permits a later kickoff, so a rescheduled fixture keeps its original partition. Immutability is enforced by `ON UPDATE RESTRICT` on every child.

---

## 4. Unmapped-value handling

The S-4 constraint is *"do not create new vocabularies dynamically."* V1 does exactly that:

```ts
// syncDateMasterFeed.ts:473
await db.from('countries').upsert(countryRows, { onConflict: 'name' });
```

Country rows are created from the provider's `category.name` on every sync. `CountriesRepository.upsert()` exists solely to do this. **This pattern does not survive into V2** — `football.country` is a governed vocabulary with `ck_country__code_is_iso3166_1` and S-3 owns its contents.

The architecture already answers this in the one place it is most dangerous. `football.fixture_lifecycle_state` carries a **seventh code**:

```sql
('UNKNOWN', 'Unknown', 'Provider status not recognised by the current mapping. Seals by default.', false)
```

with the column comment: *"The lifecycle guard protects by default: an unmapped provider status maps to a state with is_open = FALSE."*

**That is the governing principle: an unmapped value degrades safely and visibly, never silently.** The three sub-cases differ only in what "safely" means, and the schema decides which applies.

### 4.1 Country — the largest gap, and it needs a decision

`src/config/trackedLeagues.ts` declares **57 leagues across ~48 countries**. S-3 seeded **24**.

**27 tracked countries have no code:** Bulgaria, China, Colombia, Croatia, Cyprus, Czech Republic, Ecuador, Egypt, Finland, Hungary, India, Ireland, Lithuania, Romania, Russia, Serbia, Slovakia, Slovenia, South Africa, South Korea, Ukraine, Uruguay, Wales, Monaco, Andorra, Liechtenstein, Canada.

S-3's country list was deliberately *"a minimum, not the full 249-entry ISO set"*, on the reasoning that a vocabulary nobody governs is the V1 pattern V2 replaces, and *"S-4 adds a code when a competition genuinely requires it, under the same governance."* **Fifty-seven leagues is that requirement arriving.**

The columns are nullable, so ingestion *can* proceed with `country_code = NULL` — LC-05/PD-07's "absence rather than a substituted value". But a Ukrainian league whose competition has no country is a competition the product cannot group or filter by nation. **This is decision 1 below.**

### 4.2 Position — mapping table required, no seeding

The provider returns `positionsDetailed` as free text (`parsePositions` splits on commas and does nothing else). V2 has 11 canonical codes.

S-4 needs a **static provider→canonical mapping declared in source**, exactly as S-3 declared its vocabularies — checked into version control, reviewable, and never extended at runtime. An unmappable token yields `NULL` where the column allows it and is counted as `rows_rejected` on the `write_record`, so it appears in telemetry rather than vanishing.

`football.position_profile` was **deliberately not seeded in S-3** (Decision 1: *"defer until governed meaning exists"*), and its governed meaning still does not exist — that arrives with S-6. **S-4 does not seed it and does not write it.** Player positional profile is therefore not ingested in S-4. This is a stated scope limit, not an omission.

### 4.3 Currency — reject, do not substitute

`player_valuation.currency_code` is **NOT NULL** with an FK to the 14 seeded currencies. V1 reads `proposedMarketValueRaw?.value` and **discards the accompanying currency entirely**, storing a bare scalar.

There is no safe default. Substituting `EUR` would assert a fact the provider did not state, and `minor_unit` exists specifically because that assertion is materially wrong for JPY. **A valuation whose currency is absent or unseeded is not written**, is counted as `rows_rejected`, and raises a `DATA_QUALITY` failure. The valuation is a dated observation; a missing one is a gap, and a wrong one corrupts the trajectory the relation exists to preserve.

### 4.4 Summary

| Unmapped value | Column | Handling | Why |
|---|---|---|---|
| Provider status | `fixture.lifecycle_state_code` | → `UNKNOWN` (`is_open = false`) | The vocabulary provides it. Seals by default |
| Provider status | `fixture.provider_status_raw` | **retained verbatim** | Mapping diagnosis. Load-bearing for nothing |
| Country | `*.country_code` | NULL + quality observation | Nullable; LC-05 absence over substitution |
| Position | `position_code_at_onset` | NULL + `rows_rejected` | Nullable |
| Position profile | `position_profile` | **not ingested in S-4** | No governed meaning until S-6 |
| Currency | `player_valuation.currency_code` | **reject the row** + `DATA_QUALITY` | NOT NULL; no honest default exists |
| Unavailability kind | `unavailability_kind_code` | → `OTHER` | The vocabulary provides it |
| Registration kind | `registration_kind_code` | → `PERMANENT` + `INFERRED` provenance | Only three codes; loan direction is often unstated |

**No branch creates a vocabulary row.** Every branch either uses a seeded code, writes NULL, or refuses the row.

---

## 5. Duplicate handling

Ingestion is **re-run constantly** — the same `/schedule/{date}` is fetched daily for a week around each fixture. Duplicate handling is not an edge case; it is the normal path.

**`pt_pipeline_ingestion` holds no `DELETE` on `football` at all.** Delete-and-reinsert is not available, which forecloses the laziest reconciliation strategy at the privilege layer rather than by convention.

Three classes, decided by lifecycle rather than by preference:

### 5.1 Mutable identity records — `INSERT … ON CONFLICT DO UPDATE`

`competition`, `competition_edition`, `competition_stage`, `venue`, `team`, `player`, `official`, `fixture`, `result`

Ingestion holds `S`, `I`, `U`. These carry `updated_at` and describe a **current** state: a renamed club is the same club with a new name. The conflict target is the provider alternate key.

Two rules on the update branch:

- **Never overwrite a non-NULL value with NULL.** A provider response omitting a field is not an assertion that the field is empty. `COALESCE(EXCLUDED.col, target.col)`.
- **`fixture_partition_on` is never updated.** It is part of the conflict target and immutable by design.

### 5.2 Append-only records — `INSERT … ON CONFLICT DO NOTHING`

`standing`, `player_valuation`, `fixture_lifecycle_transition`

Ingestion holds `S`, `I` **only** — migration 016 Revision 2 removed `UPDATE` explicitly, and the commit reasoning is recorded in the migration: *"Granting UPDATE asserted a capability the lifecycle class forbids — exactly the drift PR-02 places privilege ahead of guards to prevent."* Both the grant and the policy exclude it, and the append guard of migration 015 would refuse the statement regardless.

Natural keys already express the correct grain:

- `uq_standing__edition_team_variant_asof (competition_edition_id, team_id, standing_variant, as_of_on)` — one row per team per day per variant. Re-running a sync the same day writes nothing.
- `uq_player_valuation__player_src_asof (player_id, source_code, as_of_on)` — same.
- `uq_fixture_lifecycle_transition__fixture_at (fixture_partition_on, fixture_id, transitioned_at)` — same.

A conflicted row is **skipped, not updated**, and lands in `rows_skipped` on the `write_record`. The relation's own comment makes this diagnostic: *"a calculation that conflicted on every row reports zero written and a high skipped count."*

### 5.3 Temporal records — succession, not conflict

`player_registration`, `player_availability`

These carry **exclusion constraints**, not unique constraints:

```sql
EXCLUDE USING gist (player_id WITH =, registration_kind_code WITH =, registration_period WITH &&)
```

`ON CONFLICT` cannot target an exclusion constraint. A re-observed spell is not a duplicate key — it is either the **same open spell** (leave it) or **a boundary event** (close the current period and open a successor). S-4 must read the open spell first and decide. This is the one place where duplicate handling is a genuine algorithm rather than a conflict clause, and it is the mechanism V1 had no equivalent of.

### 5.4 A duplicate is never silent

Every path reports `rows_examined / written / skipped / rejected` through `recordWrite()`. A job that examined 400 fixtures and wrote 0 is legible as *nothing changed* rather than indistinguishable from *the job did nothing*, which E9.03 names as *"among the most dangerous states in a precompute platform."*

---

## 6. Ingestion provenance requirements

Five obligations, each backed by a constraint or a relation that already exists.

**6.1 Every write is attributed to a job run.** `withRun('pt_pipeline_ingestion', …)` under S-2. Ingestion holds `S, I` on `operations`, so — unlike `pt_platform_admin` under finding S3-1 — **it can and must record its own telemetry.** Verified in §7.

**6.2 Provider identity is stored, not just used for lookup.** `provider_code` + `provider_external_id` persist on the row. The column comment fixes their status: *"Alternate key, not business identity (§5.6.6)."* A provider that reissues an identifier must not be able to reassign a platform entity.

**6.3 Derived facts declare their provenance class.** `player_registration.provenance_class_code` is NOT NULL. A registration boundary observed in a transfer feed is `OBSERVED`; one derived by diffing two squad snapshots is `INFERRED`. The column comment is explicit that these are *"materially weaker"* facts and *"downstream consumers must be able to tell."* V1 carried one such marker; V2 generalises it, and **S-4 must not write `OBSERVED` for a diffed boundary.**

**6.4 Provider payloads stay opaque.** `provider_statistic.measures` is the **one permitted structured payload** under PD-16 circumstance 1: a retained provider response, *"opaque by definition, never queried by content in a production read path."* S-4 stores it and never reads inside it. Every measure a calculation consumes is reached through a declared feature source in S-5.

**6.5 Quota consumption is recorded.** `recordApiUsage()` per provider/endpoint/window. Not optional: at 57 leagues on 200 calls/day, an unmeasured binding constraint cannot be managed.

**Not a provenance requirement:** synthetic or estimated values. V1's audit found synthetic weather stored with no provenance flag and consumed by a paid module. **S-4 ingests what the provider reported and nothing else.** No gap-filling, no interpolation, no defaults standing in for absent facts.

---

## 7. Ingestion role permissions verified against S-2

Read from migration `016_security.sql` and cross-checked against the S-1 role register, which the permission suite proves against the live catalogue.

```sql
-- 016_security.sql:294
('football','pt_pipeline_ingestion','SIU', NULL,
   ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL),
('football','pt_pipeline_ingestion','SI',
   ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL, NULL),
('operations','pt_pipeline_ingestion','SI', NULL, NULL, NULL, NULL),
```

| Schema | Modes | Note |
|---|---|---|
| `football` | `S`, `I`, `U` | except the three append-only relations |
| `football` (those three) | `S`, `I` | UPDATE removed in Revision 2 under P-06 |
| `operations` | `S`, `I` | **sufficient for full S-2 attribution** |
| `feature`, `module`, `snapshot`, `calibration`, `product` | *(none)* | no USAGE on those schemas |

**Four conclusions, all verified rather than assumed:**

1. **No `DELETE` anywhere.** Reconciliation must be insert-or-update. §5 is a consequence of the privilege matrix, not a style choice.
2. **No `UPDATE` on the three append-only relations** — in the grant *and* the policy *and* the trigger. Three independent layers.
3. **Attribution works.** `operations: ['S','I']` covers `pipeline_run`, `pipeline_job_run`, the two `*_completion` companions from migration 019, `write_record`, `failure` and `api_usage`. **Finding S3-1 does not recur for ingestion** — that was specific to `pt_platform_admin`'s SELECT-only posture on `operations`.
4. **Intelligence calculation is structurally impossible.** No USAGE on `feature` or `module`, so the S-4 constraint holds even against a coding mistake.

**One gap to confirm at implementation, not now:** `failure_resolution` is granted `INSERT` to `pt_platform_admin` by migration 019 (finding M-2). Ingestion records failures; **resolving** them is administrative. Correct as it stands.

---

## 8. Append-only and audit rules preserved

| Rule | Instrument | S-4 obligation |
|---|---|---|
| R-19/R-20 append guard | `feature.tf_append_only__guard()` on 16 relations | Never attempt UPDATE on `standing`, `player_valuation`, `fixture_lifecycle_transition` |
| P-06 lifecycle class | Grant + policy + trigger | Insert-only paths for those three |
| LC-14 platform vocabulary | `lifecycle_state_code` FK; `provider_status_raw` free | Seal decisions branch on the platform state, never the provider string |
| LC-17 result revision | `football.result_revision` | A corrected score appends a revision; it never silently overwrites |
| LC-11 availability | `daterange` + exclusion constraint | No stored "is injured" flag |
| LC-18 temporal standings | `standing.as_of_on` in the unique key | Never overwrite yesterday's table |
| A.2 ordinal succession | `result_revision.revision_ordinal` | Revisions are appended with increasing ordinals |
| E9.03 write visibility | `operations.write_record` | Every job reports all four counts, including zero |
| §5.10.5 partition health | `fixture_pdefault` | A non-empty default partition is a **quality breach**, not a silent condition |
| ER-01 timestamp precision | — | Ingestion supplies `fixture_partition_on`; never round-trips a DB `timestamptz` through `Date` into a key |

**Nothing in S-4 requires a schema change.** No relation is missing, no constraint blocks a legitimate write, no privilege is absent for the work described. If that changes during implementation the S-2 protocol applies: **stop, document, do not work around.**

---

## 9. Proposed S-4 scope

Following the S-3 precedent — **identity and reality first, elaboration later.**

**In scope:**

| Stage | Relations | Source |
|---|---|---|
| 1. Reference resolution | `competition`, `competition_edition`, `competition_stage`, `venue` | `/schedule/{date}`, `/tournaments`, `/seasons` |
| 2. Participants | `team`, `team_registration`, `player` | `/schedule/{date}`, `/teams/{id}/players` |
| 3. Fixtures | `fixture`, `fixture_lifecycle_transition` | `/schedule/{date}` |
| 4. Results | `result`, `result_revision` | `/schedule/{date}` |
| 5. Squad state | `player_registration`, `player_availability`, `player_valuation` | `/team/{id}/players` |
| 6. Standings | `standing` | standings path |

**Deferred, with reasons:**

| Relation | Why |
|---|---|
| `position_profile` | No governed meaning until S-6 (S-3 Decision 1) |
| `lineup`, `lineup_selection`, `appearance`, `match_event` | Per-fixture detail endpoints; a separate quota class. S-4.2 |
| `official`, `official_assignment` | Referee data is not in the schedule feed |
| `provider_statistic` | Season statistics endpoint; large payloads, own cadence |

---

## 10. Decisions

### D-1 — Provider code: `SPORTSAPI_API`, single namespace *(architecture owner)*

> *"SportsAPI_API is the only supported S-4 ingestion source. SofaScore direct ingestion is not part of the V2 pipeline because it cannot support scheduled backend ingestion reliably. Entity uniqueness must remain within the active ingestion namespace. Do not create a second SofaScore namespace."*

`provider_code = 'SPORTSAPI_API'` on every `competition`, `team`, `player` and `fixture` row. **One namespace, no exceptions**, so `uq_team__provider_external_id` and its equivalents cannot fork an entity.

Consequences, all deliberate:

- **`src/services/sofaScoreClient.ts` is not carried into V2.** S-4 does not import it, does not construct it, and does not read `config.sofascore`. The V1 file stays where it is, untouched, because V1 is untouched.
- The squad endpoint — the one reached through the SportsAPI transport but documented under a SofaScore heading — is registered as an ordinary SportsAPI endpoint. Its *data* provenance is a documentation fact, not an identity fact.
- The constant is **not configurable.** A deployment able to change the provider code could point ingestion at a namespace the existing rows do not occupy, and every entity would double. It is a source constant, exactly as role names are.

### D-2 — Countries: extend the governed vocabulary *(no preference stated; chosen here)*

The 27 missing codes are added to `src/v2/seed/vocabulary.ts` as a static, reviewed source change, taking `football.country` from 24 to 51.

**This is not dynamic vocabulary creation and not a registry modification.** It is additive, in version control, and reviewable before it runs — the seed is insert-only, so no existing row is touched and re-running remains a no-op for the original 24. It is also precisely what S-3 said would happen: *"S-4 adds a code when a competition genuinely requires it, under the same governance."* Fifty-seven tracked leagues is that requirement arriving.

The alternative — NULL countries for roughly half the coverage — would leave the product unable to group or filter by nation for those leagues, and would defer the same source change to a later phase with less information than we have now.

`ck_country__code_is_iso3166_1` still governs the format, so every added code is ISO 3166-1 alpha-2. **Wales joins Scotland as a code held separately from `GB`**, because the association is distinct from the state and the competition record needs to name it.

### D-3 — Backfill: forward by default, date-range capable *(no preference stated; chosen here)*

Ingestion is **parameterised by date range throughout** — the schedule feed is fetched per day regardless, so a range costs nothing structurally and makes replay the same code path rather than a second implementation.

**Default operation is forward-only** from cut-over. Historical replay is available as an explicit, quota-gated invocation rather than something a scheduled run can drift into: at 200 calls/day a multi-season replay would consume the budget for weeks, and that is a decision to take deliberately with the quota telemetry in front of you, not a default.

This is honest about what exists. Phase 8 recorded that deep history **does not exist** for the 17 team-level tables V1 overwrote in place, so point-in-time reconstruction begins at cut-over whatever S-4 does. Replay recovers fixtures and results; it cannot recover what was never stored.

---

## 11. Implementation

`beta/backend/src/v2/ingestion/`, 12 source files and one suite.

| Path | Purpose |
|---|---|
| `provider/config.ts` | `PROVIDER_CODE`, fail-fast environment validation, quota arithmetic |
| `provider/endpoints.ts` | Every path, including the four V1 built inline; cost classes |
| `provider/client.ts` | Transport, retry, throttle, and per-endpoint quota accumulation |
| `mapping/index.ts` | Provider→canonical mapping. Refuses; never inserts |
| `normalise.ts` | Shape and unit conversion. Makes no domain decision |
| `write/index.ts` | The two conflict primitives and the per-relation counters |
| `entities/reference.ts` | competition, edition, stage, venue |
| `entities/participants.ts` | team, team_registration, player |
| `entities/fixtures.ts` | fixture, lifecycle transition, result, result_revision |
| `entities/squad.ts` | player_registration, player_availability, player_valuation |
| `entities/standings.ts` | standing |
| `stages/schedule.ts` | One date, one transaction, resolution in graph order |
| `pipeline.ts` | Date-range orchestration, attribution, telemetry, quota flush |
| `cli.ts` | `npm run ingest:v2` |

`package.json` gained one script. **No other change outside `src/v2/`, and V1 is untouched.**

### The country vocabulary extension

`src/v2/seed/vocabulary.ts` gained 27 codes (D-2). Verified additive by running the seed against the already-seeded database:

```
v2 seed complete: 27 inserted, 119 already present
  football.country                              + 27  (24 present)
  … every other relation                        +  0
```

Nothing already seeded was touched, which is what "additive source change, not a registry modification" means in practice rather than in argument.

---

## 12. Finding S4-1 — two association codes are not ISO countries

**Recorded for the architecture owner. No correction applied.**

`football.country` is documented as ISO 3166-1 alpha-2 and `ck_country__code_is_iso3166_1` enforces the *format* (`^[A-Z]{2}$`) but cannot enforce the *registry*. Two seeded codes are football associations rather than ISO countries:

| Code | Used for | Status in ISO 3166-1 |
|---|---|---|
| `SC` | Scotland (seeded by S-3) | **Assigned to Seychelles** |
| `WA` | Wales (added by S-4) | Unassigned |

`SC` is a genuine collision: the platform cannot later represent Seychelles without conflict. Both associations legitimately need separate representation — each fields its own league and the competition record must name it — but neither has an alpha-2 of its own (they are the subdivisions `GB-SCT` and `GB-WLS`).

**Not corrected here**, for two reasons. The seed has no update path by design, and changing a seeded code is precisely what the append-only posture forbids. Exported as `NON_ISO_ASSOCIATION_CODES` from the seed and asserted by the test suite, so the fact is visible rather than latent.

**Options for the architecture owner**, if this is to be closed: move both to the ISO user-assigned range (`QM`–`QZ`, `XA`–`XZ`), or widen the column to accept a documented association namespace. Both are schema-owner decisions, and neither blocks S-4.

---

## 13. Verification

### Environment

PostgreSQL 16, full migration set 001–019 applied, S-3 seed applied and then extended to 51 countries. Seven roles with distinct credentials.

### Tests

**219 tests, 219 pass, 0 fail, 0 skipped** across the whole backend with a V2 database.
**109 tests, 109 pass** without one — the integration suites skip rather than fail, so V2 work never blocks V1 work.

S-4 contributes 58: 38 declaration tests and 20 requiring a database.

The persistence tests prove the privilege posture against the live catalogue rather than against the register:

| Test | Proves |
|---|---|
| 42 | ingestion holds **no `DELETE`** on any `football` relation |
| 43 | **no `UPDATE`** on `standing`, `player_valuation`, `fixture_lifecycle_transition` |
| 44 | it **can** write its own telemetry — the contrast with S3-1 |
| 45 | **no `USAGE`** on `feature`, `module`, `snapshot`, `calibration` |
| 47 | an `UPDATE` on an append-only relation is **refused** |
| 40, 57 | an unmapped status becomes `UNKNOWN` and **seals** |

Tests 51–58 drive the real writers against the real database through a stubbed provider, so the composite foreign keys, the lifecycle transition and the result revision are exercised rather than reasoned about — including that a postponement leaves a legible trace (52), that a live score is not a result (53), that a corrected confirmed score appends a revision carrying the superseded figures (54), and that three identical runs produce one row (55).

### Mutation testing

Two guarantees were verified by **deliberately breaking the code** and confirming the suite fails, because a test that passes against a broken implementation proves nothing:

| Mutation | Result |
|---|---|
| Remove the `appendResultRevision` call | **test 54 fails** — LC-17 is genuinely guarded |
| Replace `COALESCE(EXCLUDED.c, target.c)` with `EXCLUDED.c` | **test 49 fails** — the no-null-overwrite rule is genuinely guarded |

Both were restored and the suite reconfirmed green.

---

## 14. Constraint compliance

| Constraint | Status | Evidence |
|---|---|---|
| No vocabulary created dynamically | Held | Mapping returns `MAPPED`/`ABSENT`/`REJECTED`; it has no insert path |
| S-3 seeded registries not modified | Held | Only `football.country` extended, additively, by source change |
| No schema change | Held | No DDL anywhere in `src/v2/ingestion/` |
| No service-role bypass | Held | Every write through `withRun('pt_pipeline_ingestion', …)` |
| No intelligence calculated during ingestion | Held | Test 45 — no `USAGE` on the four downstream schemas |
| Append-only rules preserved | Held | Tests 43, 47; three independent layers |
| Audit rules preserved | Held | Per-relation `write_record`; every stage attributed |
| V1 untouched | Held | Only `package.json` changed outside `src/v2/` |

---

## 15. Standing after S-4

**S-5 (feature calculation)** now has football reality to read: fixtures with lifecycle history, results with revisions, dated registrations carrying honest provenance, temporal standings, and dated valuations. The seven feature definitions S-3 registered have inputs.

**Not implemented, and out of S-4's scope by decision:** `position_profile`, lineups, appearances, match events, officials, provider statistics. Each is listed in §9 with its reason.

**Nothing beyond S-4 is implemented.**
