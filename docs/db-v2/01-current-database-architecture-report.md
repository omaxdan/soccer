# PitchTerminal — Current Database Architecture Report

**Phase 1 — Reverse engineering only. No redesign, no migrations, no schema changes.**

| | |
|---|---|
| Source of truth | Supplied Supabase schema dump (`Schema.sql`, 92 tables in `public`) |
| Corroborating sources | `beta/backend/src` (64 TS files, ~23k lines), `beta/live-frontend/src` (98 TS/TSX files, ~10k lines), `beta/migrations/023–044`, `beta/backend/supabase/migrations/000–025` |
| Method | Every claim below was traced to a schema object, a migration, or a code path. Where the schema dump is silent (indexes, views, RLS, functions) the finding is marked **UNVERIFIED** and listed in document 05 rather than assumed. |

---

## 1. Overview

PitchTerminal is a **precompute-and-serve** football intelligence platform. Nothing is calculated at request time by design; the database is simultaneously the ingestion warehouse, the calculation substrate, the results store, and the read model for the UI.

Three actors write to the database, and only three:

| Actor | Mechanism | Credential |
|---|---|---|
| Backend pipeline | `beta/backend` CLI jobs (`ts-node src/cli.ts <command>`), cron-driven | `SUPABASE_SERVICE_KEY` — bypasses RLS |
| End users | Next.js 15 server actions / route handlers | Supabase anon key + session, RLS enforced |
| Postgres itself | 4 triggers + ~10 SQL functions (auth bootstrap, watchlist pruning, immutability guards) | `SECURITY DEFINER` where applicable |

The frontend is **read-only against all football data**. It performs writes only against the user/product layer (`watchlists`, `user_favourite_leagues`, `user_profiles`, admin tables). This is a genuine architectural strength and must be preserved in V2.

Two external data sources feed the warehouse:

- **SportsAPI Pro** (`v2.football.sportsapipro.com`) — fixtures, results, tournaments, seasons, teams, venues. Rate/quota-limited; the client supports a second API key to double the daily quota.
- **SofaScore public API** — squads, players, injuries, season statistics, standings, transfers, images.

Coverage is bounded by `beta/backend/src/config/trackedLeagues.ts` — a **hardcoded TypeScript array of ~61 leagues** matched to DB rows by name fragment and slug string. League coverage is therefore a code deployment, not a data operation.

---

## 2. Inventory and layer classification

92 tables. Classified against the four layers requested:

### 2.1 Raw Football Data Layer — 16 tables

Provider-owned facts. Every row traces to an ingestion job; nothing here is derived.

`countries` · `tournaments` · `seasons` · `teams` · `players` · `stadiums` · `matches` · `match_results` · `team_form_history`¹ · `player_season_statistics` · `team_season_statistics` · `tournament_standings` · `player_transfers` · `player_injuries` · `team_squads_snapshot` · `player_match_load`

¹ `team_form_history` is a *derived projection* of `matches` + `match_results` (one row per team per played match) but is treated as raw input by every downstream processor. It sits on the boundary.

### 2.2 Intelligence Calculation Layer — 58 tables

The overwhelming bulk of the schema. Three distinct sub-shapes, which is itself the core finding:

**(a) Team current-state singletons — 17 tables, `team_id UNIQUE`, one row per team, destructively overwritten on every run:**
`team_intelligence` · `team_strength_ratings` · `team_venue_performance` · `team_form_quality` · `team_momentum` · `team_motivation` · `team_playing_style` · `team_strength_dashboard` · `team_fixture_difficulty` · `team_goal_dependency` · `team_injury_impact` · `team_transfer_intelligence` · `team_tactical_variations` · `team_betting_intelligence`² · `player_intelligence` · `player_versatility` · `league_intelligence`

² `team_betting_intelligence` has a `season_external_id` column and no unique constraint on `team_id` in the dump — the frontend reads it with `.order('season_external_id', desc).limit(1)`, so it behaves as multi-row-per-team in practice.

**(b) Team snapshot/time-series — 6 tables, carry a date dimension:**
`team_intelligence_history` (`team_id, snapshot_date` unique) · `team_fixture_load` (`snapshot_date`) · `team_travel_load` (`snapshot_date`) · `team_squads_snapshot` (`snapshot_date`) · `team_match_snapshots` (`match_id, team_id` — point-in-time, pre-match) · `match_opponent_context` (`match_id, team_id`)

**(c) Match-scoped outputs — 31 tables, keyed by `match_id` (± `team_id`/`player_id`/`position_code`):**
`match_intelligence` · `match_travel_intelligence` · `match_risk_intelligence` · `match_opportunity` · `match_signals` · `match_weather` · `match_half_time_intelligence` · `match_performance_comparison` · `match_impact_advantage` · `match_impact_summary` · `match_key_battles` · `match_positional_matchups` · `match_tactical_advantages` · `match_squad_depth_comparison` · `match_predicted_lineups` · `match_predicted_formations` · `match_intelligence_watch` · `team_match_impact` · `team_versatility` · `player_match_impact` · `player_matchup` · `squad_depth` · `position_depth_comparison` · `position_adaptability` · `position_coverage`³ · `tactical_flexibility` · `substitution_impact` · `injury_adaptability` · `formation_analysis` · `formation_options` · `formation_matchup` · `versatility_advantage` · `team_position_depth`³ · `team_strengths`³ · `team_weaknesses`³

³ team-scoped, not match-scoped; grouped here because they are multi-row-per-team output tables rather than singletons.

**(d) Backtest / calibration — 4 tables:**
`readiness_history` · `league_gap_analytics` · `league_gap_summary` · `signal_backtests`

### 2.3 User / Product Layer — 12 tables

`user_profiles` · `user_subscriptions` · `subscription_plans` · `subscription_events` · `feature_permissions` · `customers` · `watchlists` · `user_favourite_leagues` · `notifications` · `notification_preferences` · `user_notes` · `admin_actions`

All keyed to `auth.users(id)` (Supabase Auth), all RLS-enabled, all reachable only through the anon key. This layer is the cleanest part of the schema.

### 2.4 Operational Layer — 2 tables

`platform_settings` (key/value; holds the `subscriptions_enabled` beta flag) · `platform_daily_summary` (one row per day of aggregate counters)

**This layer is effectively absent.** There is no `sync_log`, `job_run`, `ingestion_error`, `api_quota_usage`, or `data_quality_check` table. The pipeline logs to stdout via `pino` and writes nothing durable about its own execution. `platform_daily_summary.last_sync_at` is the single persisted operational signal in the entire system.

### 2.5 Does the current database separate its layers?

**Partially — and it degrades as you move up the stack.**

| Boundary | Verdict |
|---|---|
| Raw ↔ Intelligence | **Good.** Raw tables are never written by a `process:*` job; intelligence tables are never written by a `sync:*` job. The single-writer discipline holds. |
| Within Intelligence | **Poor.** Inputs and outputs are mixed inside the same rows (see §5), and the same quantity is materialized in up to seven places. |
| Intelligence ↔ Product | **Good.** No product table references a football entity except `user_favourite_leagues.tournament_id`; `watchlists`/`notifications` use untyped polymorphic `entity_id`. |
| Product ↔ Operational | **Merged.** `platform_settings` carries both product flags and operational config with no distinction. |
| Module layer | **Does not exist in the database at all.** See document 03 §4. |

---

## 3. ERD explanation

### 3.1 The entity spine

```
countries ──< tournaments ──< seasons
                  │              │
                  │              └────────────┐
                  │                           │
                  └──────────────< matches >──┘        (tournament_id, season_id)
                                     │
        teams ──────────────────────┤ (home_team_id, away_team_id)
          │                          │
          │                          ├──< match_results (1:1)
          │                          │
          │                          └──< [31 match-scoped intelligence tables]
          │
          ├──< players ──< player_season_statistics
          │       ├──< player_injuries
          │       ├──< player_transfers
          │       └──< player_intelligence / player_versatility (1:1)
          │
          ├──< team_form_history >── matches
          ├──< [17 team-scoped intelligence singletons] (1:1)
          ├──< team_squads_snapshot / team_fixture_load / team_travel_load (1:N by date)
          └──< tournament_standings >── tournaments

stadiums ──< teams.stadium_id
         ├──< matches.venue_id
         └──< team_locations.stadium_id

auth.users ──< user_profiles / user_subscriptions / watchlists / notifications / ...
                        │
          subscription_plans ──< user_subscriptions
                    └──(slug)──< feature_permissions
```

### 3.2 The shape in one sentence

**It is a star, twice.** `teams` is the hub of a 17-spoke star of 1:1 intelligence singletons; `matches` is the hub of a 31-spoke star of 1:1 (or 1:few) intelligence tables. Almost no intelligence table references any other intelligence table — the dependency graph between them lives entirely in the CLI's L1→L6 ordering, not in the schema.

**Consequence:** the database cannot tell you that `match_performance_comparison` depends on `team_betting_intelligence`, or that `substitution_impact` depends on `match_predicted_lineups`. Drop or corrupt one input table and Postgres raises nothing; the downstream processor silently writes nulls. All 50+ dependency edges are encoded as comments and call ordering in `beta/backend/src/cli.ts` lines 663–892.

### 3.3 Foreign-key coverage

Every FK in the dump points at `teams(id)`, `players(id)`, `matches(id)`, `tournaments(id)`, `seasons(id)`, `countries(id)`, `stadiums(id)`, `subscription_plans`, or `auth.users(id)`. That is: **all FKs point down into the raw layer or the auth layer. There is not one FK between two intelligence tables.**

### 3.4 Relationships that are missing

| Missing relationship | Where it hurts |
|---|---|
| `season_external_id` → `seasons` | 5 tables (`player_season_statistics`, `team_season_statistics`, `tournament_standings`, `team_goal_dependency`, `team_betting_intelligence`) carry a bare `bigint` with no FK. A season can be deleted or renumbered and these rows orphan silently. |
| `league_name` (text) → `tournaments` | `readiness_history`, `league_gap_analytics`, `league_gap_summary` identify a competition **by name string**. `league_gap_summary.league_name` is even the UNIQUE key. Renaming a sponsor-branded tournament (a documented real occurrence — "Série A" → "Brasileirão Betano" in `trackedLeagues.ts`) severs the entire calibration history for that league. |
| `matches.competition` / `matches.season` (text) → the FK columns beside them | Both text columns coexist with `tournament_id`/`season_id`. Two sources of truth for the same fact, no constraint keeping them consistent. |
| `teams.country` (text) → `countries` | `countries` exists and is populated, but `teams.country`, `stadiums.country`, and `players.nationality` are free text. |
| `watchlists.entity_id` / `notifications.entity_id` | Polymorphic, no FK. `watchlists` is defended by three `AFTER DELETE` prune triggers (migration 035); `notifications` has no equivalent and will accumulate dangling references. |
| `match_weather` → `stadiums`, plus an observation timestamp | Weather has no location and no time-of-measurement. |
| `team_intelligence` → any season or competition | Team intelligence is global per team, with no season dimension, so a team in two competitions has one readiness number. |

---

## 4. Data ownership map

| Owner | Tables | Writer |
|---|---|---|
| **API ingestion** | countries, tournaments, seasons, teams, players, stadiums, matches, match_results, tournament_standings, player_season_statistics, team_season_statistics, player_transfers, player_injuries, team_squads_snapshot | `sync:*` jobs (`syncDateMasterFeed`, `syncSquadSofaScore`, `syncSeasonStatistics`, `syncStandings`, `syncTransfersV2`, `syncTeamsPlayers`, `syncTournamentEvents`, `syncDiscovery`, `syncTeamImages`) |
| **Calculation** | all 58 intelligence tables + `team_form_history` + `player_match_load` + `team_locations` + `team_position_depth` | `process:*` jobs (`processDbOnly.ts` 4,509 lines · `processExtendedIntelligence.ts` 4,866 lines · `processPredictedLineups.ts` · `processHistoricalContext.ts` · `processRiskOpportunity.ts`) |
| **Calibration** | readiness_history, league_gap_analytics, league_gap_summary, signal_backtests | `archiveReadinessHistory`, `backtestSignals`, `backtestConfidenceBands` |
| **User-generated** | watchlists, user_favourite_leagues, notification_preferences, user_profiles (display_name, avatar_url) | Frontend server actions, RLS-scoped to `auth.uid()` |
| **Admin-managed** | subscription_plans, feature_permissions, platform_settings, user_notes, admin_actions, user_profiles (role, suspended), user_subscriptions | Admin UI (`/admin/*`), gated by `is_admin()` SQL function |
| **Postgres-managed** | user_profiles (row creation), notifications (none yet) | `handle_new_user()` trigger on `auth.users` |

Ownership is clean at the boundaries. The one violation: `players` carries 10 injury columns (`current_injury`, `injury_status`, `injury_reason`, `injury_return_days`, `injury_expected_return_days`, `injury_start_timestamp`, `injury_end_timestamp`, `injury_updated_timestamp`, `injury_severity_score`) that duplicate the `player_injuries` table — the same fact owned by two tables with no constraint tying them together.

---

## 5. Structural findings

### 5.1 Duplicated concepts (the largest single problem)

Every one of these is the *same quantity* materialized in multiple tables, with no constraint or FK asserting they agree:

| Concept | Materialized in |
|---|---|
| **Readiness** | `team_intelligence.readiness_score`, `team_intelligence_history.readiness_score`, `match_intelligence.home_readiness`/`away_readiness`, `readiness_history.home_readiness`/`away_readiness`, `team_match_snapshots.readiness_before`, `player_intelligence.readiness_score`, `player_match_impact.readiness_score` — **7 locations** |
| **Confidence** | `match_intelligence.confidence_score`/`confidence_band`, `match_performance_comparison.prediction_confidence`/`confidence_band`, `match_half_time_intelligence.confidence_score`/`confidence_band`, `match_intelligence_watch.confidence_score`/`confidence_band`, `readiness_history.confidence_pct`, plus `confidence_score` columns on `match_impact_advantage`, `versatility_advantage`, `match_tactical_advantages` — **8 locations, at least 3 different scales** |
| **Win probability** | `match_intelligence.win_probability_home/draw/away` **and** `match_performance_comparison.home_win_probability/draw_probability/away_win_probability` **and** `match_intelligence_watch.win_probability` — two independent processors write competing triples for the same fixture, with nothing reconciling them |
| **Predicted goals** | `match_intelligence.predicted_home_goals`/`predicted_away_goals`/`predicted_scorelines`, `match_performance_comparison.home_goals`/`away_goals`/`most_likely_score`/`expected_goal_difference`, `match_half_time_intelligence.predicted_ht_goals_*`/`home_2h_goals` |
| **Team strength** | `team_strength_ratings.strength_score`, `team_strength_dashboard.overall_rating`, `team_betting_intelligence.team_quality_score`, `team_intelligence.overall_rating`, `match_intelligence.home_strength_rating`/`away_strength_rating`, `team_match_snapshots.strength_rating_before`, `team_match_impact.*` |
| **Travel** | `team_travel_load.travel_fatigue_score` ≡ `team_intelligence.travel_fatigue_score`; `match_travel_intelligence.home_team_distance_km`/`away_team_distance_km` ≡ `match_intelligence.home_travel_distance_km`/`away_travel_distance_km` — verbatim copies |
| **Congestion / rest** | `team_fixture_load.congestion_score`/`avg_rest_days` ≡ `team_intelligence.congestion_score`/`rest_days_avg`; `match_intelligence.home_rest_days`/`away_rest_days` copies them again |
| **Squad depth** | `team_position_depth`, `position_coverage`, `squad_depth`, `match_squad_depth_comparison`, `position_depth_comparison`, `team_intelligence.squad_depth_score`, `substitution_impact.home_depth_score` — **7 tables** describing one concept |
| **Versatility** | `player_versatility`, `team_versatility`, `versatility_advantage`, `position_adaptability`, `tactical_flexibility`, `team_tactical_variations`, `team_intelligence.lineup_versatility_score`, `team_strength_ratings.lineup_versatility_score` (**the identical column name on two tables**) |
| **Formations** | `match_predicted_formations`, `formation_analysis`, `formation_options`, `formation_matchup`, `match_predicted_lineups.formation` — 5 tables, overlapping columns (`primary`/`secondary`/`tertiary_formation` appears in both `formation_analysis` and `formation_options`) |
| **Strengths / weaknesses** | `team_strengths`/`team_weaknesses` tables, `team_intelligence.strengths`/`weaknesses` (ARRAY), `team_versatility.strengths`/`weaknesses` (ARRAY), `formation_analysis.formation_strengths`/`formation_weaknesses` (ARRAY), `match_impact_advantage.key_advantages`/`key_disadvantages` (ARRAY) |
| **Injury burden** | `players.*` (10 cols), `player_injuries`, `team_intelligence.injury_burden_score`/`injured_market_value`, `team_injury_impact`, `injury_adaptability`, `team_squads_snapshot.injured_player_count`/`injured_player_pct`, `match_intelligence.home_injury_score`/`away_injury_score` |
| **Recent form** | `team_form_history` (rows), `team_intelligence.last_5_points`/`last_10_points`/`last_5_results`/`form_index`, `team_momentum.last_5_points`/`prior_5_points`, `team_form_quality.*`, `team_strength_dashboard.form_rating`/`form_trend`, `team_match_snapshots.points_last5_before`/`form_rating_before` |

### 5.2 Inputs and outputs are mixed in the same row

`match_intelligence` (42 columns) is the clearest case. Roughly 28 columns are **copied inputs** (`home_rest_days`, `home_travel_distance_km`, `home_injury_score`, `home_squad_stability`, `home_strength_rating`, `home_venue_advantage`, `home_positional_depth`, `home_available_market_value`, `home_active_competitions`, …) sourced verbatim from team-level tables; roughly 14 are **model outputs** (`predicted_home_goals`, `confidence_score`, `win_probability_*`, `net_battle_index`, `predicted_scorelines`). The immutability trigger (migration 042) protects only 13 of the outputs, so the input copies drift freely after kickoff while the outputs are frozen — the row becomes internally inconsistent as a historical record.

The same pattern recurs in `readiness_history` (which denormalizes `league_name`, `home_team`, `away_team` as text alongside the FK columns) and `team_match_snapshots`.

### 5.3 Table-per-module explosion

31 match-scoped tables, most holding 7–20 integer scores plus a `calculated_at`, all keyed 1:1 on `match_id`. Structurally these are **rows of one table**, not 31 tables. Evidence they were built as an accreting sequence rather than a design: migration 032 is literally named `match_page_processor_constraints` and retrofits unique constraints onto five of them; the code comment at `processExtendedIntelligence.ts:3655` describes 13 tables that "existed (created via the original scaffold SQL) but had no writer."

Adding module #14 today requires: a new table, a migration, a new processor function, a new CLI case, a new entry in the `process:all-db` sequence, a new query in `queries.ts`, a new type in `types.ts`, a new entry in `modules.ts`, a new key in the `FeatureKey` union in `access.ts`, a new `feature_permissions` row, and a new materialized view. **Eleven coordinated changes across two repositories for one module.**

### 5.4 Wide-table normalization

- `player_season_statistics` — **118 columns** in one table, mixing outfield metrics (`successful_dribbles`, `aerial_duels_won`) with goalkeeper-only metrics (`saves_parried`, `punches`, `crosses_not_claimed`, `goal_kicks`). For an outfield player ~25 GK columns are permanently null; for a keeper ~50 outfield columns are. No FK on `season_external_id`, no unique constraint visible in the dump.
- `match_intelligence` 42 cols · `match_performance_comparison` 38 · `team_season_statistics` 34 · `team_betting_intelligence` 31 · `players` 29 (10 of them injury) · `readiness_history` 27 · `team_intelligence` 26.

### 5.5 Constraint drift between repository and live database

The supplied dump shows inline single-column `UNIQUE` but no composite unique constraints. Cross-referencing the migrations against the upsert targets in the code found **five processors that upsert with an `onConflict` key having no matching constraint anywhere in the repository**:

| Table | `onConflict` used by processor | Constraint found in migrations |
|---|---|---|
| `squad_depth` | `match_id,team_id` | none |
| `team_versatility` | `match_id,team_id` | none |
| `formation_analysis` | `match_id,team_id` | none |
| `position_coverage` | `team_id,position_code` | none (the similar constraint exists on `team_position_depth`) |
| `position_depth_comparison` | `match_id,position_code` | none |

A code comment at `processExtendedIntelligence.ts:3655` asserts these constraints were "added in migration 032", but 032 adds only five, none of them these. Either the constraints were created out-of-band directly in Supabase (likely, since the processors are reported as running) or these five upserts fail at runtime. **This must be resolved before V2 design — it is the difference between "the repo describes the database" and "it doesn't."**

### 5.6 Synthetic data stored without provenance

`processMatchWeather` (`processExtendedIntelligence.ts:3695`) generates weather by **climate-zone estimation with a seeded PRNG (mulberry32), not from any weather API** — the log line says so explicitly: `'processMatchWeather completed (synthetic)'`. The rows land in `match_weather` with the same column shape real observations would use, and no `source`/`is_estimated` flag. Module 13 ("Weather Impact", tier `pro`) reads that table and presents rates derived from it, and `docs/SCHEMA_GAP_ANALYSIS.md` separately records that `match_weather` was expected to be filled by a real weather integration that does not exist. **Any V2 design must carry a provenance flag on every derived/estimated fact.**

### 5.7 Versioning

`readiness_history.readiness_formula_version text NOT NULL DEFAULT 'v1'` is **the only version column in the entire schema.** No live intelligence table records which formula, weight set, or code revision produced its numbers. Given that `beta/backend/src/lib/confidenceBand.ts` exists specifically to keep the shipped blend byte-identical to the backtested blend, the absence of a stored version is a direct threat to that discipline: change a weight and every historical row silently becomes a mixture of two models.

### 5.8 History and regeneration

| Question | Answer |
|---|---|
| Can intelligence be regenerated from raw data? | **Yes, for the present.** `process:all-db` is documented and built as idempotent, zero-API, full-rebuild from raw tables in strict L1→L6 order. This is a real strength. |
| Can it be regenerated *as of a past date*? | **No.** 17 team-level singletons are overwritten in place. `processHistoricalContext` and `team_match_snapshots` were built precisely to work around this — they reconstruct point-in-time state from `matches` + `match_results` for backtesting. Only 7 of `team_intelligence`'s 26 metrics are archived in `team_intelligence_history`. |
| Are historical results preserved? | **Partially.** `readiness_history` (1 row per match, result-linked, with `pick_correct_strict`/`pick_correct_lenient`), `team_match_snapshots`, `match_opponent_context`, `signal_backtests`, `league_gap_*` are genuine historical assets. Everything else about a finished match reflects whenever the processor last ran. |
| Is the historical record protected? | **One table out of 31.** Migration 042 guards 13 columns of `match_intelligence`; migration 043 locks `readiness_history`. The other 30 match-scoped tables can be rewritten after kickoff by any future processor run, silently invalidating any backtest that reads them. |

### 5.9 Notable dead or unreachable objects

Referenced by neither codebase: `customers`, `notifications`, `notification_preferences`, `match_intelligence_watch`. All four are fully built (`customers` has `stripe_customer_id UNIQUE`; `match_intelligence_watch` has an admin-only RLS policy from migration 041). **Per the Phase 1 rules these are not assumed unnecessary** — they are staged infrastructure for Stripe billing and a notification product. They are recorded here so V2 can ask whether they are still on the roadmap.

Written by the backend but never read by the frontend (28 tables): `formation_analysis`, `formation_matchup`, `formation_options`, `injury_adaptability`, `match_impact_summary`, `match_opponent_context`, `match_predicted_formations`, `match_travel_intelligence`, `platform_daily_summary`, `player_injuries`, `player_match_load`, `player_matchup`, `player_transfers`, `position_adaptability`, `position_coverage`, `position_depth_comparison`, `squad_depth`, `tactical_flexibility`, `team_fixture_load`, `team_intelligence_history`, `team_locations`, `team_match_snapshots`, `team_squads_snapshot`, `team_travel_load`, `versatility_advantage`, plus `countries`/`tournaments`/`seasons`/`stadiums` (these four *are* read, via nested PostgREST joins rather than direct `.from()` calls). Most of the rest are legitimate pipeline intermediates. Several — `player_injuries`, `team_intelligence_history`, `player_transfers`, `team_travel_load` — hold data the UI plausibly wants and simply hasn't wired up.

### 5.10 The frontend reads objects that do not exist in the supplied schema

`queries.ts` and `modules.ts` reference **13 materialized views** — `mv_match_scoring_probabilities`, `mv_module_travel`, `mv_module_home_away`, `mv_module_readiness_tracker`, `mv_module_consistency`, `mv_module_giant_killer`, `mv_module_rest`, `mv_module_league_goals`, `mv_module_form_gap`, `mv_module_btts_fatigue`, `mv_module_confidence`, `mv_module_halftime`, `mv_module_clean_sheet`. **None is defined in the supplied dump, and none is defined in any migration in either repository.** `mv_match_scoring_probabilities` and `mv_module_travel` are on the match-page and board hot paths. Their definitions and refresh strategy are the single largest gap in the Phase 1 picture (document 05, item 1).

---

## 6. Scalability assessment

Targets stated in the brief: 10+ years of history, 100+ leagues, millions of player statistics, many users, subscription tiers.

### 6.1 Row-count projection

Baseline: 100 leagues × ~380 matches/season × 10 seasons ≈ **380,000 matches**.

| Table family | Rows per match | Projected at 380k matches |
|---|---:|---:|
| `matches` + `match_results` | 2 | 760k |
| `team_form_history` | 2 | 760k |
| `team_match_snapshots` + `match_opponent_context` | 4 | 1.5M |
| 20 × 1:1 match-scoped intelligence tables | 20 | **7.6M** |
| `match_predicted_lineups` | ~26 | **9.9M** |
| `player_match_impact` | ~22 | **8.4M** |
| `match_positional_matchups` + `position_depth_comparison` | ~22 | 8.4M |
| `player_matchup` | 11–121 | **4M–46M** |
| `player_match_load` | ~26 | 9.9M |
| `match_signals` | 1 per market | 380k–2M |
| `player_season_statistics` | — | ~500k rows × 118 cols |

**Order of magnitude: 50–100M rows** in a single unpartitioned Postgres instance, with the largest tables having no time column of their own.

### 6.2 Specific scaling defects

1. **No partitioning and no partition key.** Most match-scoped tables carry only `match_id` + `calculated_at`. `calculated_at` is the *processing* time, not the match date — useless as a partition key. Only `match_intelligence`, `match_results`, `match_travel_intelligence`, and `readiness_history` denormalize `match_date`, and inconsistently. Any "last season" or "before 2024" query must join to `matches`.

2. **No archival tier.** Nothing distinguishes a fixture kicking off tomorrow (hot, rewritten every cron run) from one played in 2016 (cold, immutable). Both live in the same heap and are scanned by the same indexes.

3. **Full-table reprocessing.** `process:all-db` reprocesses **every team, every player, and every upcoming match** on every run. L1–L3 and L5–L6 are explicitly "always full" even in the date-scoped variants (`cli.ts:953`, `:978`). At 100 leagues this is 2,000+ teams and 50,000+ players per run. The documented 30–120s runtime is a function of the current ~323-team dataset and will not survive a 6× expansion.

4. **Read amplification on the match page.** `getMatch()` issues **~30 parallel queries** for a single fixture (`queries.ts:249–284`) — no view, no RPC, no denormalized read model. Multiply by concurrent users on the free tier and the connection pool, not the CPU, becomes the limit.

5. **Board query fan-out.** `getBoard()` fires 12 queries including two materialized-view reads, then joins in application memory. Fine at today's scale; linear in fixtures per window.

6. **Singleton overwrite blocks multi-season coverage.** `team_intelligence` is one row per team with no season or competition dimension. A team playing in a domestic league and a continental competition has one readiness figure; a team's 2019 state is unrecoverable. Historical coverage and the current schema shape are structurally incompatible.

7. **Index coverage is unverified and appears raw-layer-biased.** The migrations create ~50 indexes, overwhelmingly on raw tables (`matches`, `teams`, `players`, `player_transfers`, `team_form_history`). The 31 match-scoped intelligence tables mostly have PK + one unique constraint. Actual production indexes are **UNVERIFIED** (document 05, item 2).

8. **Ingestion is quota-bound, not compute-bound.** `config.sportsapi.key2` exists to "double the daily quota (100 → 200)". At 100 leagues the external API budget, not Postgres, is the binding constraint on freshness — and there is no table recording quota consumption.

9. **Text-keyed calibration cannot scale across leagues.** `league_gap_summary.league_name` as UNIQUE key means two competitions sharing a name across countries (there are several — "Premier League", "Super League", "First Division") collide into one calibration row.

10. **The user layer is fine.** RLS policies are simple `auth.uid()` comparisons with supporting unique indexes (`idx_user_subs_one_active`, `idx_user_subs_one_live`). No scaling concern at any realistic user count.

---

## 7. Summary of findings

| # | Finding | Severity |
|---|---|---|
| 1 | 13 materialized views on the read path are undefined in the repo and the dump | **Blocking for V2 design** |
| 2 | 5 upsert conflict targets have no matching constraint in any migration | **Blocking** |
| 3 | Same quantity duplicated across up to 7 tables with no reconciliation | High |
| 4 | 31 match-scoped tables where one module-result structure belongs | High |
| 5 | 17 team-level singletons overwritten in place — no point-in-time recovery | High |
| 6 | No formula/model versioning on any live intelligence table | High |
| 7 | Immutability enforced on 1 of 31 match-scoped tables | High |
| 8 | Operational layer absent — no job, sync, error, or quota telemetry | High |
| 9 | Modules exist only in frontend TypeScript; no registry, no stored results | High |
| 10 | Synthetic weather stored with no provenance flag, consumed by a paid module | Medium-High |
| 11 | Competition/season identified by text in 8 tables; no FK on `season_external_id` | Medium-High |
| 12 | No partitioning key, no archival tier, full-table reprocessing every run | Medium-High |
| 13 | `player_season_statistics` at 118 columns mixing GK and outfield | Medium |
| 14 | Match page issues ~30 queries with no read model | Medium |
| 15 | Injury state duplicated between `players` (10 cols) and `player_injuries` | Medium |
| 16 | Two coexisting entitlement systems (`tier.ts` env var vs `access.ts` DB) | Medium |
| 17 | 4 fully-built tables unreferenced by any code (`customers`, `notifications`, `notification_preferences`, `match_intelligence_watch`) | Low — **needs product confirmation, not removal** |
