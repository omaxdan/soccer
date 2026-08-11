# S-4 — Ingestion Foundation

Writes schema `football` from the provider feed. Nothing else.

```bash
npm run ingest:v2                                    # today's schedule
npm run ingest:v2 -- --date 2026-08-01               # one date
npm run ingest:v2 -- --from 2026-08-01 --to 2026-08-07
npm run ingest:v2 -- --from … --to … --allow-over-budget

npm run ingest:v2 -- squads                          # the stalest teams, bounded
npm run ingest:v2 -- squads --limit 40
npm run ingest:v2 -- squads --team 4501              # one team, by provider id
```

A bare invocation still means today's schedule, so every existing command and cron entry is unchanged.

## Two stages

| Stage | Endpoint | Cost | Writes |
|---|---|---|---|
| `schedule` | `/schedule/{date}` | **FEED** — 1 call per date | competition · edition · stage · venue · team · team_registration · fixture · lifecycle transition · result |
| `squads` | `/teams/{id}/players` | **PER_ENTITY** — 1 call per team | player · player_registration · player_availability · player_valuation |

**The squad work list is a query, not a table.** `team_players` costs one call per team, so the stage takes the stalest teams and stops. Staleness is *derived* — `max(player_valuation.as_of_on)` per team, because the squad response carries valuations and `recordValuations` writes at most one row per player per source per day. `NULLS FIRST` puts never-observed teams ahead of stale ones; `team.id` is the final tie-break, so the list is totally ordered and two runs against the same state choose the same teams.

**There is no `squads --from/--to`, deliberately.** A roster endpoint returns *today's* squad. Replaying it into a past date would assert a registration nobody observed then. The only replay for a squad is "fetch this team again now".

### An incomplete response must not close a valid spell

`closeResolvedSpells` treats absence as recovery — that is its design: *"A spell that ends is not reported as ending — it simply stops appearing."* The unit of trust is therefore **the team's squad response**: absence within a squad we successfully fetched is evidence; absence because we fetched nothing is not.

So closing is **gated on the response having resolved at least one player**. A zero-player response is a failed observation, not a report of a fully fit squad. The gate invents no threshold — it does not ask whether a squad "looks big enough", only whether an observation happened at all.

**`closeResolvedSpells` still dates its closure with `now()`** while the stage carries the run's single observation date. When the two diverge the guard `lower(spell_period) < now()::date` silently refuses the update. That is doc 29 blocker **B-2**, it is **not** worked around here, and test 61 pins it down so that fixing it breaks a test that says why.

## The season event pager — built, and deliberately not wired

`provider/pager.ts` walks a season's event feed. It is the S-5 fixture-universe reader, implemented to the contract in [doc 38 §9](../../../../docs/db-v2/38-phase8-s4-provider-contract-final.md), and **nothing imports it yet** — that is the current gate, not an oversight.

**One pager, both directions.** `events/last` and `events/next` were verified to share an envelope, an ordering rule, an event shape and a `hasNextPage` flag, so `direction` is a parameter selecting an endpoint key and which end of the window bounds the walk. Two implementations would be two places for the same bug.

**Termination, in this order:** a 404 (proven terminal — the client breaks on 404 without retrying, so the last page costs one call) · `hasNextPage === false` · a page lying wholly outside the window · budget exhausted, which reports a resume page. A fifth, defensive and labelled as such, stops on a page carrying *zero* events — distinct from a **short** page, which is explicitly not evidence of the end.

**What it refuses to know.** The number 30 does not appear in it, though every observed page held exactly 30: each was a page the provider could fill, so a fixed size and a maximum are indistinguishable from outside. No page count is derived from a size or a total. `roundInfo.round` is carried but never paged or filtered on — page 1 of the observed season holds rounds 19, 18, 17 **and 4**.

**It does not write.** No database handle reaches it, by construction, so it cannot begin ingestion by accident and its tests run with no provider and no schema — every page they walk is a body committed under `docs/api-samples/v2-discovery/`.

## What this subsystem is, and is not

**Is:** provider transport, quota accounting, provider→canonical mapping, entity resolution, duplicate handling, ingestion provenance.

**Is not:** feature calculation (S-5), module evaluation (S-6), snapshots (S-7), calibration (S-9). That boundary is **structural, not conventional** — `pt_pipeline_ingestion` holds no `USAGE` on `feature`, `module`, `snapshot` or `calibration`, so a statement touching `feature.feature_value` fails with `permission denied for schema feature` before it reaches a policy.

## One provider namespace

```
provider_code = 'SPORTSAPI_API'
```

A source constant, deliberately **not** configurable — exactly as the seven role names are. It participates in `uq_team__provider_external_id (provider_code, provider_external_id)` and the equivalents on `competition`, `player` and `fixture`. A deployment able to change it could point ingestion at a namespace the existing rows do not occupy, and every entity would silently double with features and readings splitting across the pairs.

SportsAPI Pro resells SofaScore data, so some rows describe SofaScore observations. That is a provenance fact recorded in documentation. It is **not** an identity fact, and it does not earn a second `provider_code` (decision D-1). `src/services/sofaScoreClient.ts` is not carried into V2.

## Duplicate handling — three classes, decided by lifecycle

| Class | Relations | Statement |
|---|---|---|
| **Mutable identity** | `competition`, `competition_edition`, `competition_stage`, `venue`, `team`, `player`, `official`, `fixture`, `result` | `INSERT … ON CONFLICT DO UPDATE` |
| **Append-only** | `standing`, `player_valuation`, `fixture_lifecycle_transition` | `INSERT … ON CONFLICT DO NOTHING` |
| **Temporal succession** | `player_registration`, `player_availability` | read the open spell, then close and open |

**There is no delete path and there cannot be one.** `pt_pipeline_ingestion` holds no `DELETE` on any `football` relation. Delete-and-reinsert — the laziest reconciliation strategy — is foreclosed at the privilege layer rather than by convention.

**The update branch coalesces.** Every updated column is `COALESCE(EXCLUDED.col, target.col)`. A provider response omitting a field is *not* an assertion that the field is empty; overwriting a known coordinate with NULL because today's payload was thinner is how a platform loses data it already had, one sync at a time, with nothing reporting it because the write succeeded.

**Temporal succession is the one place duplicate handling is an algorithm.** `ON CONFLICT` cannot target an exclusion constraint, so there is no clause to write. A re-observed spell is either the same open spell (do nothing) or a boundary event (close the current period, open a successor).

## Unmapped values — degrade safely, never silently

The architecture decides this, not the application. `football.fixture_lifecycle_state` carries a seventh code — `UNKNOWN`, `is_open = false` — because *"the lifecycle guard protects by default: an unmapped provider status maps to a state with is_open = FALSE."*

| Unmapped value | Handling | Why |
|---|---|---|
| Provider status | → `UNKNOWN`, seals by default | The vocabulary provides it |
| Provider status string | retained verbatim on `provider_status_raw` | Diagnosis. Load-bearing for nothing |
| Country | NULL + counted | Nullable; LC-05 absence over substitution |
| Position | NULL + counted | Nullable |
| Currency | **row refused** + `DATA_QUALITY` | NOT NULL, and no default is honest |
| Unavailability kind | → `OTHER` | The vocabulary provides it |

**No branch creates a vocabulary row.** V1 upserted countries from the provider's category name on every sync (`syncDateMasterFeed.ts:473`); that is how it accumulated codes nobody governed. Mapping refuses; it never inserts.

**Currency is the one mapping that rejects.** V1 read `proposedMarketValueRaw?.value` and discarded the currency. Substituting EUR would restore that behaviour while looking rigorous — `minor_unit` exists precisely because a JPY valuation treated as EUR is wrong by two orders of magnitude. A valuation is a dated observation whose *trajectory* is the point: a missing one is a gap, a wrong one corrupts the series.

## Provenance

**The rule that matters most:** a registration boundary learned from an explicit transfer record is `OBSERVED`; one learned by diffing squad snapshots is `INFERRED`. Writing `OBSERVED` for the second is the most damaging thing this subsystem could do — a calibration population built on inferred registrations treated as observed is wrong in a way nothing downstream can detect, because the marker that would reveal it is the one that was falsified.

Also enforced: every write attributed to a job run; provider identity stored rather than merely used for lookup; provider payloads kept opaque (PD-16 circumstance 1); quota consumption recorded.

**No synthetic values.** V1 stored synthetic weather with no provenance flag and fed it to a paid module. S-4 ingests what the provider reported and nothing else — no gap-filling, no interpolation, no defaults standing in for absent facts.

## Attribution

Every stage is attributed. Unlike `pt_platform_admin` under S-3's finding **S3-1**, the ingestion role holds `S` and `I` on `operations`, so it opens its own `pipeline_run`, `pipeline_job_run`, `write_record`, `failure` and `api_usage` rows. **There is no unattributed path in S-4.**

`operations.write_record` is written **per relation**, not per stage, because a single aggregate row would lose the thing the relation exists to reveal: which relation received nothing.

## Quota

100 requests per key per day; two keys give 200. **Quota is the binding constraint on freshness**, and E9.05 exists because V1 *"carried configuration specifically to double a daily quota by adding a second credential, and nothing recorded consumption."*

Usage is flushed on the **control connection**, outside the work transaction. A stage that fails rolls back its writes but not what it spent — the provider charged for those calls regardless, and a usage record lost with the rollback would tell the next run it has budget it does not have.

The budget guard refuses a range longer than the daily budget unless `--allow-over-budget` is passed. Historical replay is a deliberate act (decision D-3).

## What the database owns

Codes, foreign keys, uniqueness, participant distinctness, score non-negativity, paired half-time/extra-time/penalty columns, period boundedness, spell non-overlap, standing count consistency. A seed or writer that pre-checked would duplicate a database rule in TypeScript and drift the moment a constraint changed.

**One deliberate exception**, stated because it is one: `recordStandings` checks `played = won + drawn + lost` before offering the row. A standings response is written as one multi-row statement, so a single inconsistent row would abort the whole table — twenty valid rows lost to one bad one. The constraint still runs; this only decides which rows are offered, so the failure is per row instead of per table.

## Scope

**In:** competition, edition, stage, venue, team, team_registration, player, fixture, lifecycle transition, result, result_revision, player_registration, player_availability, player_valuation, standing.

**Deferred:** `position_profile` (no governed meaning until S-6), `lineup`/`lineup_selection`/`appearance`/`match_event` (**G-1 is OPEN** — no provider endpoint for per-fixture player data has been demonstrated; see [doc 35](../../../../docs/db-v2/35-phase0-provider-capability-investigation.md)), `official`/`official_assignment` (not in the schedule feed), `provider_statistic` (own cadence).

**The squad stage may never imply participation.** A roster states MEMBERSHIP, not who played. No minutes, no starter status, no unused-substitute status, no lineup, no appearance, no season-minute allocation. Test 60 asserts that the stage reports none of those relations and creates no row in them.

## Testing

```bash
npm test                    # declaration tests, no database and no provider needed
PT_V2_DB_HOST=… npm test    # plus the persistence and end-to-end tests
```

The end-to-end tests drive the real writers against a real database through a stubbed provider, so the composite foreign keys, the lifecycle transition and the result revision are exercised rather than reasoned about.

**The pager suite spends no quota.** It replays the six captured bodies in `docs/api-samples/v2-discovery/` through a stand-in that 404s on any page it was not given — which is not an invention, since page 999 was requested live and returned exactly that. Where a branch has never been observed live (`hasNextPage: false`, a page out of order, one fixture in both feeds) the payload is synthetic and the test says so.

Two guarantees were **mutation-tested** — the code was deliberately broken and the suite confirmed to fail: removing the result-revision append (test 54) and removing the `COALESCE` guard (test 49).
