# PitchTerminal — Table-by-Table Documentation

All 92 tables in the supplied `public` schema. Grouped by layer, alphabetical within group.

**Legend for ownership:** `API` = ingested from an external provider · `CALC` = produced by a calculation processor · `USER` = written by an end user through the app · `ADMIN` = written through the admin UI · `PG` = written by a Postgres trigger/function.

**Legend for concerns:** 🔴 blocking for V2 design · 🟠 significant · 🟡 worth noting.

Where the supplied dump cannot answer a question (indexes, composite uniques, RLS on the football layer), the entry says **UNVERIFIED** rather than guessing.

---

# LAYER 1 — RAW FOOTBALL DATA (16 tables)

---

## `countries`
**Purpose** — Canonical country list; the root of the competition hierarchy. Exists so tournaments can be grouped and filtered by region without relying on provider strings.
**Ownership** — `API` (`syncDateMasterFeed`, `syncDiscovery`).
**Columns** — 5. `id` PK · `name UNIQUE` · `alpha2` · `slug` · `created_at`.
**Depends on** — nothing.
**Depended on by** — `tournaments.country_id`. Read by the frontend only through the nested join `tournament:tournaments(...country:countries(id, name, alpha2))`.
**Concerns**
- 🟠 `teams.country`, `stadiums.country`, `players.nationality` are free text and do **not** FK here. The canonical table exists and is bypassed by three tables that need it.
- 🟡 `alpha2` and `slug` are both nullable with no uniqueness — two rows could share an ISO code.

## `tournaments`
**Purpose** — A competition (league or cup). The unit of coverage: `trackedLeagues.ts` decides which tournaments the pipeline ingests at all.
**Ownership** — `API`.
**Columns** — 8. `id` PK · `external_id UNIQUE` · `name` · `slug` · `country_id` FK · `category` · `logo_storage_path` · `created_at`.
**Depends on** — `countries`.
**Depended on by** — `seasons`, `matches`, `tournament_standings`, `league_intelligence`, `player_season_statistics`, `team_season_statistics`, `user_favourite_leagues`. Prune trigger `prune_watchlist_league` fires on delete.
**Concerns**
- 🟠 No season/edition concept at this level — a tournament is a single row across all years, so a competition that changes format or name across seasons has one identity.
- 🟠 `slug` is nullable but is the exact-match key used by `getTrackedLeagueTeams()` for squad sync. A null slug silently drops a league from squad ingestion.
- 🟡 `category` is untyped free text overlapping `country_id`'s purpose.
- 🟡 `logo_storage_path` couples the DB to a Supabase Storage layout.

## `seasons`
**Purpose** — A season of a tournament. Gives fixtures a temporal edition.
**Ownership** — `API`.
**Columns** — 6. `id` PK · `external_id UNIQUE` · `name` · `year` · `tournament_id` FK · `created_at`.
**Depends on** — `tournaments`.
**Depended on by** — `matches.season_id` (FK). **Nothing else.**
**Concerns**
- 🔴 **Season identity is split in two.** Five tables (`player_season_statistics`, `team_season_statistics`, `tournament_standings`, `team_goal_dependency`, `team_betting_intelligence`) key their season by a bare `season_external_id bigint` with no FK to this table. Two incompatible ways to say "which season", and the popular one is unconstrained.
- 🟡 `year` is `text`, not a date range — no way to ask "which season was live on 2024-03-01".

## `teams`
**Purpose** — A club. The primary hub entity of the intelligence layer.
**Ownership** — `API`.
**Columns** — 10. `id` PK · `external_id UNIQUE` · `name` · `short_name` · `country` (text) · `slug` · `stadium_id` FK · `crest_storage_path` · `created_at`/`updated_at`.
**Depends on** — `stadiums`.
**Depended on by** — **~45 tables.** Every team-scoped intelligence singleton, both sides of `matches`, all snapshot tables, `players.team_id`. Prune trigger `prune_watchlist_team`.
**Concerns**
- 🟠 `country` is free text, not FK to `countries`.
- 🟠 No season/competition membership table. Which teams are in which competition this season is inferred from `tournament_standings` or from fixtures — there is no roster-of-competition entity.
- 🟡 `stadium_id` denormalizes home venue, which `team_locations` also stores; two homes for one fact.
- 🟡 `slug` nullable and not unique although the frontend routes `/team/[slug]` off it.

## `players`
**Purpose** — A footballer, with current club, contract, physical attributes, positional profile, and **current injury state**.
**Ownership** — `API` (`syncSquadSofaScore`, `syncTeamsPlayers`, `syncTransfersV2`).
**Columns** — 29. Identity/bio (`external_id UNIQUE`, `name`, `short_name`, `date_of_birth`, `nationality`, `nationality_code`, `height_cm`, `preferred_foot`, `jersey_number`) · club (`team_id` FK, `contract_until`, `market_value`) · positions (`position`, `position_detailed`, `primary_position`, `secondary_position`, `tertiary_position`) · **injury (10 columns)**.
**Depends on** — `teams`.
**Depended on by** — `player_season_statistics`, `player_injuries`, `player_transfers`, `player_intelligence`, `player_versatility`, `player_match_load`, `player_match_impact`, `player_matchup`, `match_predicted_lineups`, `match_key_battles`, `match_positional_matchups`, `team_goal_dependency.top_scorer_player_id`, `team_injury_impact.worst_absence_player_id`.
**Concerns**
- 🟠 **Five position columns** (`position`, `position_detailed`, `primary_position`, `secondary_position`, `tertiary_position`) with no stated precedence, plus `player_versatility.positions_played ARRAY` as a sixth representation.
- 🟠 **Ten injury columns duplicate the `player_injuries` table** with no constraint keeping them consistent. Both are written by the same sync job; either can be stale relative to the other.
- 🟠 `market_value` is a scalar with no currency and no as-of date — it changes constantly and history is lost on every sync.
- 🟡 `team_id` is current club only; loan/registration history lives in `player_transfers`, so "who was at this club on this date" needs reconstruction.

## `stadiums`
**Purpose** — Venue with geo-coordinates. Exists to make travel-distance intelligence computable.
**Ownership** — `API`.
**Columns** — 13. `external_id UNIQUE` · `name` · `city` · `state_region` · `country` · `latitude`/`longitude` · `elevation_meters` · `timezone` · `capacity` · timestamps.
**Depends on** — nothing.
**Depended on by** — `teams.stadium_id`, `matches.venue_id`, `team_locations.stadium_id`.
**Concerns**
- 🟡 `latitude`/`longitude` nullable — a null silently zeroes a travel calculation rather than failing it.
- 🟡 `country` free text again.
- 🟡 No `surface` column; `docs/SCHEMA_GAP_ANALYSIS.md` records this as a known UI gap.
- 🟡 `match_weather` does not reference this table even though weather is a property of a venue at a time.

## `matches`
**Purpose** — A fixture. The second hub entity; every match-scoped intelligence table hangs off it.
**Ownership** — `API` (`syncDateMasterFeed`, 75 code references — the most-touched table in the backend).
**Columns** — 13. `id` PK · `external_match_id UNIQUE` · `home_team_id`/`away_team_id` FK · `date` · `status` · `venue_id` FK · `tournament_id` FK · `season_id` FK · **`competition` (text)** · **`season` (text)** · timestamps.
**Depends on** — `teams` ×2, `stadiums`, `tournaments`, `seasons`.
**Depended on by** — 31 match-scoped tables, `team_form_history`, `player_match_load`, `match_results`. Prune trigger `prune_watchlist_match`.
**Concerns**
- 🟠 **`competition` and `season` text columns coexist with `tournament_id`/`season_id` FKs.** Two sources of truth, no constraint enforcing agreement. Migration 042's header explicitly notes `status` is "a raw passthrough from the external sports data provider… this codebase does not control or fully enumerate its vocabulary" — the same is true of these two.
- 🟠 **`status` is an unenumerated provider string** but it is load-bearing: the immutability trigger, four processors' scoping, and match lifecycle all branch on `status = 'scheduled'`. A new provider value silently changes system behaviour.
- 🟠 No matchweek/round column — `SCHEMA_GAP_ANALYSIS.md` lists "Matchweek" as a UI requirement.
- 🟡 No referee column (known gap, pending provider confirmation).
- 🟡 This is the natural partition key for the whole warehouse (`date`) and nothing is partitioned by it.

## `match_results`
**Purpose** — Final and half-time scores for a played fixture, separated from `matches` so a scheduled fixture has no result row.
**Ownership** — `API`.
**Columns** — 10. `match_id UNIQUE` FK · `home_score`/`away_score` · `half_time_home_score`/`half_time_away_score` · `winner_team_id` FK · `status` · `match_date` · `updated_at`.
**Depends on** — `matches`, `teams`.
**Depended on by** — `team_form_history` derivation, `readiness_history` result-linking, all backtest jobs, `processHistoricalContext`.
**Concerns**
- 🟠 **`status` duplicates `matches.status`** and can disagree; nothing reconciles them.
- 🟠 `match_date` duplicates `matches.date` — a denormalization for query convenience with no trigger keeping it in sync.
- 🟡 `winner_team_id` is derivable from the scores; a third representation of the same fact.
- 🟡 No extra-time/penalty columns, so cup results are lossy.

## `team_form_history`
**Purpose** — One row per team per played match: result, goals, points, home/away, BTTS. The workhorse input for every form, momentum, venue, and strength calculation.
**Ownership** — `CALC` (`processFormBackfill`, pipeline layer L1) derived from `matches` + `match_results`.
**Columns** — 13. `team_id` FK · `match_id` FK · `result CHECK IN (W,D,L)` · `goals_for`/`goals_against` · `points` · `match_date` · `is_home` · `half_time_score_for`/`half_time_score_against` · `btts` · `created_at`.
**Constraints** — `UNIQUE (team_id, match_id)` (migration).
**Depends on** — `matches`, `teams`, `match_results`.
**Depended on by** — `team_intelligence`, `team_venue_performance`, `team_strength_ratings`, `team_momentum`, `team_form_quality`, scoreline predictions, `backtestSignals`.
**Concerns**
- 🟠 The dump renders the `result` CHECK as `NOT VALI)` — **truncated/corrupt in the supplied file.** Whether the live constraint is `NOT VALID` (i.e. not enforced against existing rows) must be verified.
- 🟡 `match_date`, `is_home`, `goals_*` are all derivable from `matches`/`match_results` — a wide denormalization for read speed, accepted but undocumented as such.
- 🟠 Will reach ~760k rows at target scale with no partitioning.

## `player_season_statistics`
**Purpose** — Per-player per-season per-competition statistics. The deepest dataset in the warehouse and the input to player importance, impact, and lineup prediction.
**Ownership** — `API` (`syncSeasonStatistics`).
**Columns** — **118.** Identity (`player_id`, `team_id`, `tournament_id`, `season_external_id`) · ratings · appearances/minutes · passing (~15) · shooting (~15) · dribbling/possession (~10) · defending (~12) · duels (~8) · penalties (~9) · discipline · **goalkeeping (~20)** · physical (`kilometers_covered`, `number_of_sprints`, `top_speed`).
**Constraints** — `UNIQUE (player_id, season_external_id)` (migration 011).
**Depends on** — `players`, `teams`, `tournaments`.
**Depended on by** — `processPredictedLineups`, `player_intelligence`, `player_match_impact`, `team_goal_dependency`.
**Concerns**
- 🔴 **118 columns mixing outfield and goalkeeper metrics.** ~20 GK columns are permanently null for outfielders; ~50 outfield columns permanently null for keepers. This is the clearest normalization failure in the schema.
- 🟠 `season_external_id` has no FK to `seasons`.
- 🟠 The unique key is `(player_id, season_external_id)` — a player who moves mid-season between two clubs in the same competition, or plays two competitions in one season, **cannot be represented**. `team_id` and `tournament_id` are in the row but not in the key.
- 🟡 `played_enough boolean` is a computed gate stored alongside raw provider stats — a calculation leaking into a raw table.

## `team_season_statistics`
**Purpose** — Per-team per-season per-competition aggregate statistics. Input to `team_betting_intelligence` and playing-style classification.
**Ownership** — `API`.
**Columns** — 34. `team_id`, `tournament_id`, `season_external_id` · goals/clean sheets · possession/passing · duels · discipline · shots for and against · big chances for and against · corners against.
**Constraints** — `UNIQUE (team_id, season_external_id)` (migration).
**Depends on** — `teams`, `tournaments`.
**Concerns** — 🟠 Same missing `seasons` FK; 🟠 same "one competition per team per season" limitation as above; 🟡 asymmetric coverage (`corners_against` exists, `corners_for` does not).

## `tournament_standings`
**Purpose** — League table position per team per season, with `standings_type` supporting total/home/away variants.
**Ownership** — `API` (`syncStandings`).
**Columns** — 15. `tournament_id`, `team_id`, `season_external_id`, `standings_type` (default `'total'`), `position`, `matches`, `wins`/`draws`/`losses`, `scores_for`/`scores_against`, `points`, timestamps.
**Depends on** — `tournaments`, `teams`.
**Depended on by** — `team_strength_ratings`, `processHistoricalContext`, league pages.
**Concerns**
- 🟠 No unique constraint visible on `(tournament_id, team_id, season_external_id, standings_type)` — **UNVERIFIED**, and without it repeated syncs duplicate rows.
- 🟠 Current standings only; no `as_of_date`, so a point-in-time table for a past matchweek is unrecoverable. `team_match_snapshots.league_position_before` exists precisely to work around this.
- 🟡 `standings_type` is unconstrained text.

## `player_transfers`
**Purpose** — Transfer history, both provider-sourced and inferred from squad diffs.
**Ownership** — `API` (`syncTransfersV2`) + `CALC` (squad-diff inference — see `source` default `'squad_diff'`).
**Columns** — 10. `player_id`, `from_team_id`, `to_team_id`, `transfer_date`, `transfer_fee`, `transfer_fee_currency`, `transfer_type` (integer), `source`, `created_at`.
**Constraints** — `UNIQUE (player_id, transfer_date)`.
**Depends on** — `players`, `teams` ×2.
**Depended on by** — `player_intelligence.transfers_last_12_months`, `team_transfer_intelligence`, `processPredictedLineups`.
**Concerns**
- 🟠 **Mixed provenance in one table** — provider-confirmed transfers and squad-diff guesses are distinguished only by a nullable text `source` with no constraint. The good instinct (recording provenance) exists here and nowhere else.
- 🟠 `UNIQUE (player_id, transfer_date)` makes a same-day loan-out/loan-in pair unrepresentable.
- 🟡 `transfer_type` is a bare integer with no lookup table or CHECK.

## `player_injuries`
**Purpose** — Injury history per player with active flag, severity, and expected return.
**Ownership** — `API` (`syncSquadSofaScore` via `PlayerInjuriesRepository`).
**Columns** — 14. `player_id`, `injury_reason`, `injury_status`, `expected_return_days`, `start_timestamp`/`end_timestamp`/`updated_timestamp` (bigint epochs), `active`, `days_out`, `injury_severity_score`, `position_at_injury`, `market_value_at_injury`, `created_at`.
**Constraints** — partial unique indexes `uq_player_injuries_player_start`, `uq_player_injuries_player_active_nostart`.
**Depends on** — `players`.
**Depended on by** — `team_injury_impact`, `injury_adaptability`, availability filtering in `processPredictedLineups`.
**Concerns**
- 🟠 Duplicates the 10 injury columns on `players`.
- 🟠 **Timestamps stored as `bigint` epochs** while every other temporal column in the schema is `timestamptz`. Cannot be compared or indexed alongside them without casting.
- 🟡 `position_at_injury`/`market_value_at_injury` are good point-in-time captures — the pattern the rest of the schema lacks.
- 🟡 Never read by the frontend, though an injury panel component exists.

## `team_squads_snapshot`
**Purpose** — Daily squad composition snapshot per team: size, age, foreign/domestic split, injured count, average market value.
**Ownership** — `API`/`CALC` (`syncSquadSofaScore`, `syncTeamsPlayers`).
**Columns** — 12. `team_id`, `snapshot_date`, `players_count`, `avg_age`, `foreign_players_count`/`domestic_players_count`/`foreign_player_pct`, `injured_player_count`/`injured_player_pct`, `average_market_value`, `created_at`.
**Depends on** — `teams`.
**Depended on by** — `team_intelligence.squad_stability_score`, `player_transfers` squad-diff inference.
**Concerns**
- 🟠 No unique on `(team_id, snapshot_date)` visible — **UNVERIFIED**; without it, re-running a sync duplicates a day.
- 🟡 Both count and pct stored for the same two facts (`foreign_players_count`/`foreign_player_pct`, `injured_player_count`/`injured_player_pct`).
- 🟠 Unbounded growth: 2,000 teams × 365 days × 10 years ≈ 7.3M rows with no retention policy.

## `player_match_load`
**Purpose** — Per-player minutes and start/substitute status per match. The input to fatigue and load intelligence.
**Ownership** — `CALC` (`processPlayerMatchLoad`, pipeline L1; written through the `replace_player_match_load` RPC for atomicity — migrations 024/025).
**Columns** — 8. `player_id`, `match_id`, `match_date`, `minutes_played`, `started`, `substitute`, `created_at`.
**Depends on** — `players`, `matches`.
**Depended on by** — `player_intelligence` (all `minutes_*`/`matches_*` columns), fatigue components of `team_intelligence`.
**Concerns**
- 🟠 `match_id` is **nullable** despite being the semantic key alongside `player_id`; no unique constraint on `(player_id, match_id)` visible — **UNVERIFIED**.
- 🟠 `match_date` is `date` while `matches.date` is `timestamptz` — a type mismatch on the same fact.
- 🟠 ~10M rows at target scale, unpartitioned.
- 🟡 `started` and `substitute` are two booleans encoding three states; a `did-not-play` row is ambiguous with a missing row.

---

# LAYER 2 — INTELLIGENCE CALCULATION (58 tables)

## 2a. Team current-state singletons

> **Shared concern for all 17 tables in this group:** one row per team, overwritten in place on every pipeline run. No `snapshot_date`, no season dimension, no formula version. The value of every column is "as of whenever the processor last ran." A team competing in two competitions gets one number for both. Historical reconstruction is impossible except through the four archive tables. **This shape is the primary constraint V2 must relieve.** It is not repeated in each entry below.

## `team_intelligence`
**Purpose** — The flagship table. Composite team readiness plus the seven components that build it. Everything the product calls "readiness" starts here.
**Ownership** — `CALC` (`processTeamIntelligencePartial`, L3 — 19 code references).
**Columns** — 26. `team_id UNIQUE` · `readiness_score` · components (`fatigue_index`, `rotation_pressure_index`, `form_index`, `congestion_score`, `rest_days_avg`, `travel_fatigue_score`, `travel_load_km`, `squad_stability_score`, `injury_burden_score`, `squad_depth_score`, `lineup_versatility_score`) · form (`last_5_points`, `last_10_points`, `last_5_results` with a `^[WDL]{1,5}$` CHECK) · market value (`injured_market_value`, `available_market_value`) · `active_competitions` · narrative (`strengths ARRAY`, `weaknesses ARRAY`, `recommended_approach`, `overall_rating`) · timestamps.
**Depends on** — `team_form_history` (L1), `team_fixture_load` (L1), `team_travel_load` (L2), `team_squads_snapshot`, `player_intelligence`, `team_position_depth`. **None of these are FKs.**
**Depended on by** — `match_intelligence` (L4), `league_intelligence` (L3.5), `team_intelligence_history`, `match_signals`, and 6 frontend query paths.
**Concerns**
- 🔴 Single most duplicated table in the schema: `congestion_score`/`rest_days_avg` copy `team_fixture_load`; `travel_fatigue_score`/`travel_load_km` copy `team_travel_load`; `last_5_points` duplicates `team_momentum`; `lineup_versatility_score` is the identical column name on `team_strength_ratings`; `strengths`/`weaknesses` ARRAY duplicate the `team_strengths`/`team_weaknesses` tables; `overall_rating` competes with `team_strength_dashboard.overall_rating`.
- 🔴 No version column, though `confidenceBand.ts` exists specifically to keep the formula reproducible.
- 🟠 Only 7 of 26 metrics are archived into `team_intelligence_history`.
- 🟠 `recommended_approach` is generated prose in a metrics table.
- 🟡 `strengths`/`weaknesses` render as `ARRAY` in the dump — element type **UNVERIFIED**.

## `player_intelligence`
**Purpose** — Per-player load, fatigue, readiness, and squad-share importance.
**Ownership** — `CALC` (L3).
**Columns** — 18. `player_id UNIQUE` · `load_index`, `fatigue_score`, `readiness_score` · `matches_last_7_days`/`_30_days`, `minutes_last_7_days`/`_30_days`, `avg_minutes_per_match` · `transfers_last_12_months` · `importance_score`, `goal_share_pct`, `assist_share_pct`, `minutes_share_pct`, `player_strength_score` · timestamps.
**Depends on** — `players`, `player_match_load`, `player_season_statistics`, `player_transfers`.
**Depended on by** — `team_intelligence` fatigue component, `player_match_impact`, `squad_depth`, lineup scoring.
**Concerns** — 🟠 `readiness_score` here is a different formula from `team_intelligence.readiness_score` and from `player_match_impact.readiness_score`, all sharing the name; 🟠 rolling windows (`last_7_days`) are frozen at last run — a stale row silently reports a stale window; 🟠 ~50k rows at target scale, all rewritten every run.

## `player_versatility`
**Purpose** — How many positions a player can competently fill; feeds squad adaptability modules.
**Ownership** — `CALC` (L5.8).
**Columns** — 13. `player_id UNIQUE` · `positions_played ARRAY` · `primary`/`secondary`/`tertiary_position_rating` · `versatility_score`, `adaptability_score`, `utility_rating`, `overall_versatility` · `games_at_position`, `position_rating` · `calculated_at`.
**Concerns** — 🟠 **Four overlapping aggregate scores** (`versatility_score`, `adaptability_score`, `utility_rating`, `overall_versatility`) with no documented distinction; 🟠 `games_at_position`/`position_rating` are singular columns on a table describing multiple positions — structurally they belong to a `(player, position)` child table; 🟠 `positions_played` is a sixth representation of player position (see `players`).

## `team_strength_ratings`
**Purpose** — Composite team strength from league position, PPG, win rate, and market value.
**Ownership** — `CALC` (L2).
**Columns** — 9. `team_id UNIQUE`, `league_position`, `points_per_game`, `win_percentage`, `strength_score`, `market_value_eur`, `lineup_versatility_score`, `calculated_at`.
**Depends on** — `team_form_history`, `tournament_standings`.
**Depended on by** — `team_fixture_difficulty`, `match_intelligence`, `processHistoricalContext`, `processRiskOpportunity`.
**Concerns** — 🟠 `lineup_versatility_score` is verbatim duplicated from `team_intelligence`; 🟠 `league_position` copies `tournament_standings.position` without its season key, so it is meaningless for a team in two competitions; 🟠 `strength_score` competes with three other "strength" measures.

## `team_venue_performance`
**Purpose** — Home vs away splits. Backs **Module 1 (Home/Away Split)** — the platform's flagship free module.
**Ownership** — `CALC` (L2).
**Columns** — 12. `team_id UNIQUE`, `home_matches`/`away_matches`, `home_points_per_game`/`away_points_per_game`, `home_win_pct`/`away_win_pct`, `home_goal_diff`/`away_goal_diff`, `venue_advantage_score`, `calculated_at`.
**Concerns** — 🟠 No season scoping: a team's venue split pools every match ever recorded; 🟠 sample sizes (`home_matches`/`away_matches`) are on the row, which is the right instinct — this is the one singleton that carries its own `n`.

## `team_form_quality`
**Purpose** — Opponent-adjusted form. Backs **Module 4 (Giant Killer Index)** and **Module 3 (Consistency Index)**.
**Ownership** — `CALC` (L5.8).
**Columns** — 18. `team_id UNIQUE`, `window_matches`, `opponent_adjusted_form`, `strength_of_schedule`, `ppg_vs_top`/`_middle`/`_bottom` + matching match counts, `giant_killer_score`, `flat_track_bully_score`, `expected_points`/`actual_points`/`performance_delta`, `volatility`, `calculated_at`.
**Concerns** — 🟡 Well-designed: carries its own sample sizes per band; 🟠 the top/middle/bottom banding rule is not stored, only its output — the same banding is re-derived in `match_opponent_context.opponent_rank_band`.

## `team_momentum`
**Purpose** — Recent-vs-prior form trend.
**Ownership** — `CALC` (L1).
**Columns** — 7. `team_id UNIQUE`, `momentum_score`, `last_5_points`, `prior_5_points`, `trend`, `calculated_at`.
**Concerns** — 🟠 `last_5_points` duplicates `team_intelligence.last_5_points`; 🟡 `trend` is unconstrained text; 🟡 the whole table is three derived numbers that could be columns on `team_intelligence`.

## `team_motivation`
**Purpose** — Composite motivation score from momentum, quality, venue, fatigue, and external factors.
**Ownership** — `CALC` (L5.8).
**Columns** — 10. `team_id UNIQUE`, `overall_motivation_score`, `motivation_band`, `momentum_factor`, `quality_factor`, `venue_factor`, `fatigue_factor`, `external_motivation`, `calculated_at`.
**Concerns** — 🟠 `external_motivation` has no documented input — **UNVERIFIED** whether it is ever non-default; 🟠 motivation is inherently match-specific (relegation battle, dead rubber) but is stored per-team; `match_intelligence.motivation_gap` and `match_impact_summary.momentum_at_stake` are separate attempts at the match-level version.

## `team_playing_style`
**Purpose** — Categorical tactical identity (possession/passing/attacking/defensive style) with a confidence figure.
**Ownership** — `CALC` (L5.10 — one of the 13 "table existed, no writer" processors).
**Columns** — 9. `team_id UNIQUE`, `playing_style`, `possession_score`, `passing_style`, `attacking_style`, `defensive_style`, `style_confidence`, `calculated_at`.
**Concerns** — 🟠 Five unconstrained text classification columns with no enum or lookup table; 🟡 style is season-dependent and stored globally.

## `team_strength_dashboard`
**Purpose** — Per-department ratings (attack/midfield/defense/set-piece/tactical/experience) for the team page radar chart.
**Ownership** — `CALC` (L5.10).
**Columns** — 12. `team_id UNIQUE`, `overall_rating`, `attack_rating`, `midfield_rating`, `defense_rating`, `set_piece_rating`, `tactical_rating`, `experience_rating`, `form_trend`, `form_rating`, `calculated_at`.
**Concerns** — 🟠 `overall_rating` collides with `team_intelligence.overall_rating`; `attack_rating`/`defence_rating` collide with `team_betting_intelligence`; `form_rating`/`form_trend` collide with `team_momentum` and `team_intelligence.form_index`. **This table is almost entirely a re-presentation of numbers stored elsewhere.**

## `team_fixture_difficulty`
**Purpose** — Average opponent strength across the next 5 and 10 fixtures.
**Ownership** — `CALC` (L2, needs `team_strength_ratings`).
**Columns** — 7. `team_id UNIQUE`, `next_5_difficulty`, `next_10_difficulty`, `next_5_matches`, `next_10_matches`, `calculated_at`.
**Concerns** — 🟠 Forward-looking by definition and therefore invalid the moment a fixture is played — with no `as_of` date, a stale row is indistinguishable from a fresh one; 🟡 window sizes hardcoded as column names (adding "next 3" means a schema change).

## `team_goal_dependency`
**Purpose** — Concentration of goal-scoring in one or two players; identifies over-reliance risk.
**Ownership** — `CALC`.
**Columns** — 11. `team_id UNIQUE`, `season_external_id`, `total_goals`/`total_assists`, `top_scorer_player_id` FK, `top_scorer_goals`/`top_scorer_pct`, `top_2_scorers_pct`, `top_scorer_no_backup`, `calculated_at`.
**Concerns** — 🔴 **`team_id` is UNIQUE while `season_external_id` is a column** — the table can hold only one season per team despite being explicitly season-scoped. Either the constraint or the column is wrong; 🟠 no FK on `season_external_id`.

## `team_injury_impact`
**Purpose** — Aggregate cost of current absences, weighted by player importance.
**Ownership** — `CALC`.
**Columns** — 10. `team_id UNIQUE`, `injured_count`, `total_importance_lost`, `goals_lost`, `assists_lost`, `no_replacement_positions` (text), `worst_absence_player_id` FK, `worst_absence_importance`, `calculated_at`.
**Concerns** — 🟠 `no_replacement_positions` is a **delimited string of position codes in a relational database**; 🟠 `injured_count` duplicates `team_squads_snapshot.injured_player_count` and `team_intelligence.injury_burden_score`'s input.

## `team_transfer_intelligence`
**Purpose** — Window activity: ins, outs, retention, activity score.
**Ownership** — `CALC`.
**Columns** — 8. `team_id UNIQUE`, `transfers_in`, `transfers_out`, `retained_players`, `retention_percentage`, `transfer_activity_score`, `calculated_at`.
**Concerns** — 🟠 No window definition stored — "transfers in" over what period is invisible to any consumer; 🟡 never read by the frontend.

## `team_tactical_variations`
**Purpose** — Formation history, tactical patterns, system effectiveness, game-state adaptations.
**Ownership** — `CALC` (L5.10).
**Columns** — 8. `team_id UNIQUE`, `formation_history ARRAY`, `tactical_patterns ARRAY`, `system_effectiveness ARRAY`, `adaptability_score jsonb`, `game_state_adaptations ARRAY`, `calculated_at`.
**Concerns** — 🔴 **Four ARRAY columns and a jsonb where relational child rows belong.** Unqueryable, unindexable, unjoinable; the same content in `formation_analysis` is at least columnar.

## `team_betting_intelligence`
**Purpose** — Market-oriented team ratings: attack/defence, efficiency, consistency, sustainability, per-market scores. Despite the name, the product positions these as analytical quality metrics.
**Ownership** — `CALC` (L5.8).
**Columns** — 31. `team_id`, `season_external_id` · `attack_rating`/`defence_rating`/`team_quality_score` · efficiency (`finishing_efficiency`, `shot_accuracy`, `shot_conversion_rate`, `big_chance_conversion`) · `goal_creation_score`/`goal_prevention_score`/`defensive_fragility_score`/`clean_sheet_reliability`/`attack_sustainability_score` · `consistency_score`/`volatility_score`/`predictability_score`/`sustainability_score` · `overperformance_score`/`underperformance_score` · home/away splits ×4 · market scores (`winner_market_score`, `goals_market_score`, `btts_score`, `cards_market_score`) · `sample_confidence` (default `'LOW'`) · `updated_at`.
**Concerns**
- 🟠 **Not in the singleton pattern**: no unique on `team_id`; the frontend compensates with `.order('season_external_id' desc).limit(1)`. Behaviour depends on an unenforced assumption.
- 🟠 `cards_market_score` exists but no cards data is ingested anywhere in the schema — **UNVERIFIED** what it is computed from.
- 🟠 `consistency_score`/`volatility_score`/`predictability_score`/`sustainability_score` overlap heavily with each other and with `team_form_quality.volatility` and `match_risk_intelligence.predictability_score`.
- 🟡 `sample_confidence` as text (`'LOW'`) rather than the actual n — the one place a sample size is *not* stored numerically, contradicting the `Baseline` design contract in `modules.ts`.
- 🟠 Home/away splits here duplicate `team_venue_performance`.

## `league_intelligence`
**Purpose** — Per-competition averages of the team-level metrics; powers the leagues page.
**Ownership** — `CALC` (L3.5).
**Columns** — 10. `tournament_id UNIQUE`, `team_count`, `avg_readiness`, `avg_form`, `avg_congestion`, `avg_travel_14d`, `avg_rest_days`, `avg_active_competitions`, `calculated_at`.
**Concerns** — 🟠 `tournament_id UNIQUE` with no season — the average is across whatever teams currently have rows, mixing seasons; 🟠 no sample/`n` beyond `team_count`; 🟡 this is the only league-level intelligence table, while the calibration tables key leagues by *name*.

---

## 2b. Team snapshot / time-series tables

## `team_intelligence_history`
**Purpose** — Daily archive of 7 of `team_intelligence`'s metrics. Exists because the singleton is destructive; built specifically to make the team trend chart possible (`SCHEMA_GAP_ANALYSIS.md`).
**Ownership** — `CALC`.
**Columns** — 11. `team_id`, `snapshot_date`, `readiness_score`, `form_index`, `congestion_score`, `travel_fatigue_score`, `rest_days_avg`, `squad_stability_score`, `injury_burden_score`, `calculated_at`.
**Constraints** — `UNIQUE (team_id, snapshot_date)`, index on `(team_id, snapshot_date)`.
**Concerns** — 🟠 **Archives 7 of 26 metrics.** The other 19 are permanently lost on each run; 🟠 no formula version, so a chart can silently span two different models; 🟡 never read by the frontend despite being built for a chart.

## `team_fixture_load`
**Purpose** — Fixture congestion per team per snapshot date: matches in trailing 7/14/30 days and forward 7/14 days, rest days, congestion score.
**Ownership** — `CALC` (L1).
**Columns** — 12. `team_id`, `snapshot_date`, `matches_last_7_days`/`_14_days`/`_30_days`, `matches_next_7_days`/`_14_days`, `avg_rest_days`, `min_rest_days`, `congestion_score`, `calculated_at`.
**Indexes** — `team_id`, `snapshot_date DESC`, `congestion_score DESC`.
**Concerns** — 🟠 `congestion_score`/`avg_rest_days` are copied verbatim into `team_intelligence`; 🟠 no unique on `(team_id, snapshot_date)` visible — **UNVERIFIED**; 🟠 unbounded growth with no retention policy.

## `team_travel_load`
**Purpose** — Travel kilometres and away-match counts over trailing windows, plus a fatigue score. Backs **Module 5 (Travel Impact)**.
**Ownership** — `CALC` (L2, needs `team_locations`).
**Columns** — 12. `team_id`, `snapshot_date`, `km_last_7_days`/`_14_days`/`_30_days`, `away_matches_last_7_days`/`_14_days`/`_30_days`, `avg_trip_distance_km`, `travel_fatigue_score`, `calculated_at`.
**Concerns** — 🟠 `travel_fatigue_score` copied verbatim into `team_intelligence`; 🟠 same missing `(team_id, snapshot_date)` unique — **UNVERIFIED**; 🟡 window sizes hardcoded as columns.

## `team_match_snapshots`
**Purpose** — **Point-in-time team state immediately before a specific match.** Built for `processHistoricalContext` so backtests can score a historical fixture using the state that existed *then* rather than now. The `_before` suffix on every metric column is the design statement.
**Ownership** — `CALC` (`processHistoricalContext`).
**Columns** — 14. `match_id`, `team_id`, `is_home`, `league_position_before`, `points_before`, `games_played_before`, `goal_diff_before`, `ppg_before`, `points_last5_before`, `form_rating_before`, `readiness_before`, `strength_rating_before`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, team_id)`.
**Depended on by** — `backtestSignals`, `backtestConfidenceBands`, `processRiskOpportunity`.
**Concerns** — 🟠 **This table is the correct pattern and it covers 6 metrics.** The other ~20 team metrics have no point-in-time equivalent; 🟠 no immutability guard — a re-run can rewrite a finished match's "before" state, which is exactly the failure migration 042 was written to prevent on `match_intelligence`; 🟠 ~760k rows at target scale.

## `match_opponent_context`
**Purpose** — Point-in-time opponent quality for a given team's fixture; the counterpart to `team_match_snapshots`.
**Ownership** — `CALC` (`processHistoricalContext`).
**Columns** — 11. `match_id`, `team_id`, `opponent_team_id`, `opponent_position_before`, `opponent_points_before`, `opponent_ppg_before`, `opponent_form_before`, `opponent_rank_band CHECK IN (top, middle, bottom)`, `opponent_quality_score`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, team_id)`.
**Concerns** — 🟠 `opponent_rank_band` re-derives the same banding `team_form_quality` uses, with the rule stored in neither; 🟡 every column is derivable by joining `team_match_snapshots` for the opponent — a convenience denormalization.

---

## 2c. Match-scoped intelligence tables

## `match_intelligence`
**Purpose** — The central match-level intelligence row. Readiness comparison, contextual factors, and the headline predictions (goals, scorelines, win probabilities, confidence).
**Ownership** — `CALC` (`processMatchIntelligencePartial` L4, plus scoreline L5.5, net battle index L5.6, XI strength L5.7 — **four writers**).
**Columns** — 42. Readiness (`home_readiness`, `away_readiness`, `readiness_gap`) · context copies (`congestion_factor`, `home_rest_days`/`away_rest_days`, `home_travel_distance_km`/`away_travel_distance_km`, `travel_advantage_score`, `home_active_competitions`/`away_*`, `home_injury_score`/`away_*`, `home_squad_stability`/`away_*`, `home_strength_rating`/`away_*`, `home_venue_advantage`/`away_*`, `home_positional_depth`/`away_*`, `home_available_market_value`/`away_*`, `home_injured_market_value`/`away_*`, `motivation_gap`) · outputs (`predicted_home_goals`, `predicted_away_goals`, `predicted_scorelines jsonb`, `confidence_score`, `confidence_band`, `win_probability_home`/`draw`/`away`, `net_battle_index`, `home_xi_strength`/`away_xi_strength`) · `match_date` · timestamps.
**Constraints** — `match_id UNIQUE`; **BEFORE UPDATE trigger `match_intelligence_immutability`** (migration 042) rejects changes to 13 output columns when `matches.status IS DISTINCT FROM 'scheduled'`.
**Depends on** — `matches`, `team_intelligence`, `team_strength_ratings`, `team_venue_performance`, `team_position_depth`, `match_travel_intelligence`, `match_predicted_lineups`.
**Depended on by** — `match_signals`, `match_risk_intelligence`, `match_opportunity`, `readiness_history`, `backtestConfidenceBands`, `match_intelligence_watch`, and the entire match page.
**Concerns**
- 🔴 **Inputs and outputs in one row.** 28 copied inputs, 14 outputs; the trigger freezes only the outputs, so the row becomes internally inconsistent after kickoff.
- 🔴 Four independent writers on one row with no coordination beyond CLI ordering.
- 🔴 `win_probability_*` competes with `match_performance_comparison`'s independent triple. Two answers, no reconciliation, both shipped.
- 🟠 `home_travel_distance_km`/`away_travel_distance_km` duplicate `match_travel_intelligence`.
- 🟠 `predicted_scorelines jsonb` is unindexable and is fetched in list views (`AUDIT_2026-07-03.md` flags the payload weight).
- 🟠 No formula version, despite being the table the entire calibration effort measures.

## `match_travel_intelligence`
**Purpose** — Travel distance for each side and the resulting advantage, with a neutral-venue note (migration 024).
**Ownership** — `CALC` (L2).
**Columns** — 9. `match_id UNIQUE`, `home_team_distance_km`, `away_team_distance_km`, `travel_advantage_km`, `travel_advantage_team_id`, `travel_advantage_note`, `match_date`, `calculated_at`.
**Concerns** — 🟠 Duplicated into `match_intelligence`; 🟠 `travel_advantage_team_id` has no FK to `teams` (the only advantage-team column in the schema that lacks one); 🟡 never read directly by the frontend — `mv_module_travel` is read instead, and that view is undefined in the repo.

## `match_risk_intelligence`
**Purpose** — Match unpredictability: risk score, band, predictability, and a structured list of risk factors.
**Ownership** — `CALC` (`processRiskOpportunity`).
**Columns** — 7. `match_id UNIQUE`, `risk_score CHECK 0–100`, `risk_band CHECK IN (LOW, MEDIUM, HIGH)`, `predictability_score CHECK 0–100`, `risk_factors jsonb DEFAULT '[]'`, `calculated_at`.
**Concerns** — 🟡 One of the best-constrained tables in the schema (ranges and enums both enforced); 🟠 `risk_factors jsonb` is an unqueryable list of findings — the same content `match_signals` stores relationally; 🟠 no immutability guard, so a finished match's risk assessment can be silently rewritten.

## `match_opportunity`
**Purpose** — Composite opportunity score with an executive brief and structured signals/warnings.
**Ownership** — `CALC` (`processRiskOpportunity`).
**Columns** — 8. `match_id UNIQUE`, `opportunity_score CHECK 0–100`, `executive_brief text`, `signals jsonb`, `warnings jsonb`, `score_components jsonb`, `calculated_at`.
**Concerns** — 🔴 **Three jsonb columns carrying the actual product content.** `signals` here is a third representation of "a thing we noticed", alongside `match_signals` (relational) and `match_risk_intelligence.risk_factors` (jsonb); 🟠 `score_components jsonb` is the closest thing in the schema to explainability metadata and it is unqueryable; 🟠 no immutability guard.

## `match_signals`
**Purpose** — Precomputed per-market signals with direction, strength, drivers, and a rule key. Explicitly built to replace browser-side computation (`cli.ts:738`).
**Ownership** — `CALC` (L4.5).
**Columns** — 12. `match_id`, `market`, `signal_group`, `signal_text`, `direction`, `strength`, `drivers`, `data_source`, `locked`, `rule_key`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, market)`, index on `match_id`.
**Concerns**
- 🔴 **`UNIQUE (match_id, market)` allows exactly one signal per market per match**, yet `signal_group` and `rule_key` imply many. A second rule firing on the same market overwrites the first.
- 🟠 `rule_key` is the join to `signal_backtests` and is **nullable with no FK** — a signal can ship with no calibration link.
- 🟠 `market`, `direction`, `signal_group` are unconstrained text.
- 🟠 `drivers` is a delimited string, not structured.
- 🟡 `locked` boolean is undocumented.

## `match_weather`
**Purpose** — Weather conditions for a fixture. Backs **Module 13 (Weather Impact, `pro` tier)**.
**Ownership** — `CALC` — **synthetic**. `processMatchWeather` (`processExtendedIntelligence.ts:3695`) generates values by climate-zone estimation with a seeded PRNG; its own log line reads `'processMatchWeather completed (synthetic)'`.
**Columns** — 7. `match_id UNIQUE`, `temperature_c`, `humidity`, `wind_speed_kmh`, `weather_condition`, `created_at`.
**Concerns**
- 🔴 **No provenance column.** Estimated values are stored in the shape real observations would take, and a paid module reads them. `SCHEMA_GAP_ANALYSIS.md` independently records that a real weather integration was expected and does not exist.
- 🟠 No FK to `stadiums`, no observation timestamp — weather without a place or a time.
- 🟠 `weather_condition` unconstrained text, while `modules.ts` matches on exact strings (`"Light Rain"`, `"Overcast"`).

## `match_half_time_intelligence`
**Purpose** — Half-time/full-time probability matrix and second-half projections. Backs **Module 11 (Half-Time Trends)**.
**Ownership** — `CALC` (L5.8).
**Columns** — 25. HT outcome probs ×3 · predicted HT goals ×2 · **9 HT/FT transition cells** (`hh_prob`, `hd_prob`, `ha_prob`, `dh_prob`, `dd_prob`, `da_prob`, `ah_prob`, `ad_prob`, `aa_prob`) · second-half (`home_2h_goals`, `away_2h_goals`, `over_0_5_2h_prob`, `over_1_5_2h_prob`, `btts_2h_prob`) · `confidence_score`/`confidence_band` · timestamps.
**Constraints** — `match_id UNIQUE`; RLS enabled with a `public_read` SELECT policy (migration 029) — **the only football table with RLS**.
**Concerns** — 🟠 The 9 transition cells are a 3×3 matrix flattened into columns; 🟠 no CHECK that the 9 probabilities sum to 1; 🟠 a fourth independent `confidence_score`/`confidence_band` pair; 🟡 the lone RLS policy on the football layer suggests the rest is protected only by the anon key's implicit grants — **UNVERIFIED**.

## `match_performance_comparison`
**Purpose** — Side-by-side departmental comparison (overall/attacking/defensive/midfield/tactical/set-piece/form) plus an independent match prediction.
**Ownership** — `CALC` (L5.8).
**Columns** — 38. Seven `*_home_score`/`*_away_score`/`*_advantage` triples · `overall_advantage_team_id` FK · prediction block (`home_win_probability`, `draw_probability`, `away_win_probability`, `predicted_winner_id` FK, `prediction_confidence`, `expected_goal_difference`, `most_likely_score`, `confidence_band`, `home_goals`, `away_goals`) · `match_significance` · `calculated_at`.
**Concerns**
- 🔴 **A second, independent match prediction competing with `match_intelligence`.** Different probabilities, different confidence, different predicted score, both rendered on the same page. Nothing marks which is authoritative.
- 🟠 Seven near-identical column triples — a `(match, dimension)` child table in disguise.
- 🟠 `home_goals`/`away_goals` are dangerously named: they read as actual scores but are predictions.
- 🟠 No immutability guard.

## `match_impact_advantage`
**Purpose** — Net advantage between the two teams' impact scores, with narrative arrays.
**Ownership** — `CALC` (L5.9).
**Columns** — 10. `match_id UNIQUE`, `home_advantage_score`, `away_advantage_score`, `advantage_margin`, `advantage_team_id` FK, `key_advantages ARRAY`, `key_disadvantages ARRAY`, `confidence_score`, `calculated_at`.
**Concerns** — 🟠 ARRAY narrative columns; 🟠 a fifth `confidence_score`; 🟠 near-identical in shape to `versatility_advantage` (same 5 columns, different subject) — the strongest single argument for one generic advantage structure.

## `match_impact_summary`
**Purpose** — Match significance, rivalry, and momentum-at-stake.
**Ownership** — `CALC` (L5.8).
**Columns** — 7. `match_id UNIQUE`, `significance_score`, `importance_band`, `rivalry_score`, `momentum_at_stake`, `calculated_at`.
**Concerns** — 🟠 `significance_score` duplicates `match_performance_comparison.match_significance`; 🟠 `rivalry_score` has no derivation source in the schema (no derby/rivalry data is ingested) — **UNVERIFIED**; 🟡 never read by the frontend.

## `match_key_battles`
**Purpose** — Narrative player-vs-player duels for the match page.
**Ownership** — `CALC` (L5.9).
**Columns** — 13. `match_id`, `battle_id` (text), `title`, `description`, `home_player_id`/`away_player_id` FK, `home_advantage_score`/`away_advantage_score`, `importance_score`, `expected_impact`, `battle_outcome_prediction`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, battle_id)` (migration 032).
**Concerns** — 🟠 `battle_id` is a generated text key doubling as the uniqueness discriminator — opaque and unstable across code changes; 🟠 `title`/`description`/`expected_impact`/`battle_outcome_prediction` are four generated prose columns in a scores table; 🟡 read by the match page (`KeyPlayerBattles.tsx`).

## `match_positional_matchups`
**Purpose** — Per-position head-to-head between the two predicted XIs.
**Ownership** — `CALC` (L5.9).
**Columns** — 12. `match_id`, `position_code`, `home_player_id`/`away_player_id`, `home_impact_score`/`away_impact_score`, `advantage_score`, `advantage_team_id` FK, `advantage_type`, `matchup_description`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, position_code)` (migration 032).
**Concerns** — 🟠 `UNIQUE (match_id, position_code)` allows **one row per position code per match**, so two centre-backs collapse into one row; 🟠 `position_code` is unconstrained text shared with `team_position_depth`, `position_coverage`, `position_depth_comparison` with no lookup table.

## `match_tactical_advantages`
**Purpose** — Typed tactical edges (pressing, width, set pieces, …) with net advantage.
**Ownership** — `CALC` (L5.9).
**Columns** — 11. `match_id`, `advantage_type`, `description`, `home_advantage_score`/`away_advantage_score`, `net_advantage`, `advantage_team_id` FK, `confidence_score`, `tactical_notes`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, advantage_type)` (migration 032).
**Concerns** — 🟡 **This is the closest table in the schema to a proper module-result structure** — a typed key, scores, and a narrative, many rows per match. V2's generic design should start from this shape; 🟠 `advantage_type` unconstrained text with no registry.

## `match_squad_depth_comparison`
**Purpose** — Home vs away squad depth, rotation capability, and substitution impact.
**Ownership** — `CALC` (L5.8).
**Columns** — 20. `match_id UNIQUE`, `home_team_id`/`away_team_id` FK, home/away depth scores and ratings, quality drop-off ×2, `depth_advantage_score`/`_team_id`/`_margin`/`_band`, rotation capability ×2, substitution impact ×2, `rotation_advantage`, `calculated_at`.
**Concerns** — 🟠 `home_team_id`/`away_team_id` duplicate `matches`; 🟠 overlaps `squad_depth`, `substitution_impact`, and `position_depth_comparison` — four tables on one concept.

## `match_predicted_lineups`
**Purpose** — Predicted starting XI per team with position, tactical role, pitch coordinates, and confidence. Powers the `PredictedXI` component.
**Ownership** — `CALC` (`processPredictedLineups`, L5 — a dedicated 608-line engine plus a 10-file `lib/lineups/` module with tests).
**Columns** — 23. `match_id`, `team_id`, `player_id`, `position_code`, `rank_in_position`, `matches_started`, `confidence`, `formation`, `lineup_order`, `natural_position`, `tactical_position`, `position_group`, `role`, `suitability`, `weighted_score`, `minutes_played`, `recent_starts_score`, `is_captain`, `is_vice_captain`, `x`, `y`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, team_id, player_id)`, indexes on `match_id`, `team_id`, `(match_id, team_id, lineup_order)`, `(match_id, calculated_at)`.
**Concerns** — 🟠 `formation` is repeated on all ~11 rows of a team's XI and also stored in `match_predicted_formations` — a per-team fact on per-player rows; 🟠 `matches_started`/`minutes_played` copy `player_season_statistics`; 🟠 ~10M rows at target scale, the largest match-scoped table; 🟡 the best-indexed intelligence table in the schema.

## `match_predicted_formations`
**Purpose** — Predicted formation per team with confidence and out-of-position count.
**Ownership** — `CALC` (`processPredictedLineups`).
**Columns** — 7. Composite PK `(match_id, team_id)` · `formation`, `confidence`, `formation_score`, `out_of_position_count`, `calculated_at`.
**Concerns** — 🟡 **The only table in the schema with a natural composite primary key and no surrogate `id`** — the pattern the other 30 match-scoped tables should follow; 🟠 `formation`/`confidence` duplicate `match_predicted_lineups`; 🟠 overlaps `formation_analysis`, `formation_options`, `formation_matchup`.

## `match_intelligence_watch`
**Purpose** — Admin monitoring view of key match intelligence with a module-consensus summary (migration 041).
**Ownership** — Intended `CALC`; **currently written by nothing.**
**Columns** — 10. `match_id` PK, `confidence_band`, `confidence_score`, `readiness_gap`, `home_xg`, `away_xg`, `win_probability`, `module_consensus`, `evidence_count`, `updated_at`.
**Constraints** — RLS enabled, `miw_admin_only` policy.
**Concerns** — 🟠 **Referenced by neither codebase.** Not assumed unnecessary — it is the only place `module_consensus` and `evidence_count` appear anywhere, which suggests a planned module-aggregation feature. Needs a product decision; 🟠 `home_xg`/`away_xg` introduce yet another name for predicted goals.

## `team_match_impact`
**Purpose** — Per-team impact profile for a specific match across eight dimensions.
**Ownership** — `CALC` (L5.9).
**Columns** — 16. `match_id`, `team_id`, `overall_impact_score`, `attack_strength`, `midfield_control`, `defensive_strength`, `set_piece_threat`, `experience_level`, `form_trend`, `injury_impact`, `tactical_versatility`, `match_specific_boost`, `confidence_level`, `advantage_band`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, team_id)` (migration 032).
**Concerns** — 🟠 Nearly every column restates a team-level table at match scope (`attack_strength` ≈ `team_strength_dashboard.attack_rating`, `form_trend` ≈ `team_momentum.trend`, `injury_impact` ≈ `team_injury_impact`); 🟠 `match_specific_boost` is the only genuinely match-specific column.

## `team_versatility`
**Purpose** — Per-team, per-match tactical and positional versatility with narrative arrays.
**Ownership** — `CALC` (L5.8).
**Columns** — 16. `match_id`, `team_id`, five `*_versatility_score`/`*_score` columns, `versatility_band`, `strengths ARRAY`, `weaknesses ARRAY`, `preferred_formations ARRAY`, `alternative_formations ARRAY`, `formation_changes_per_match`, `calculated_at`.
**Concerns** — 🔴 **Upserted with `onConflict: 'match_id,team_id'` but no such constraint exists in any migration** (§5.5 of document 01); 🟠 four ARRAY columns; 🟠 versatility is a team property stored per match, so it is duplicated across every fixture that team plays.

## `player_match_impact`
**Purpose** — Per-player expected impact on a specific fixture: 13 scores plus band and narrative.
**Ownership** — `CALC` (L5.8).
**Columns** — 19. `match_id`, `player_id`, `impact_score`, `importance_score`, `readiness_score`, `fatigue_score`, `form_rating`, `goal_threat`, `assist_threat`, `defensive_contribution`, `creativity_score`, `experience_score`, `big_game_performance`, `matchup_advantage`, `matchup_disadvantage`, `impact_band`, `expected_contribution`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, player_id)`.
**Concerns** — 🟠 `readiness_score`/`fatigue_score`/`importance_score` duplicate `player_intelligence` per match; 🟠 `matchup_advantage`/`matchup_disadvantage` duplicate `player_matchup`; 🟠 ~8.4M rows at target scale.

## `player_matchup`
**Purpose** — Individual player-vs-player advantage within a fixture.
**Ownership** — `CALC` (L5.9).
**Columns** — 8. `match_id`, `player_id`, `opponent_player_id`, `advantage_score`, `advantage_type`, `matchup_notes`, `calculated_at`.
**Constraints** — `UNIQUE (match_id, player_id, opponent_player_id)` (migration 032).
**Concerns** — 🔴 **Worst row-count risk in the schema** — potentially 121 rows per match (11×11) with no cap in the constraint, i.e. up to ~46M rows; 🟠 duplicates `match_positional_matchups` and `match_key_battles`; 🟡 never read by the frontend.

## `squad_depth`
**Purpose** — Per-team, per-match depth profile including bench and reserve quality.
**Ownership** — `CALC` (L5.10).
**Columns** — 14. `match_id`, `team_id`, `overall_depth_score`, `depth_rating`, `starting_xi_quality`, `bench_quality`, `reserve_quality`, `quality_drop_off`, `coverage_completeness`, `position_balance`, `experience_distribution jsonb`, `age_profile jsonb`, `calculated_at`.
**Concerns** — 🔴 **Upserted on `(match_id, team_id)` with no such constraint in any migration**; 🟠 two jsonb columns; 🟠 duplicates `match_squad_depth_comparison`.

## `position_depth_comparison`
**Purpose** — Per-position depth comparison between the two sides of a fixture.
**Ownership** — `CALC` (L5.10).
**Columns** — 14. `match_id`, `position_code`, `position_name`, home/away depth/quality/count ×6, `advantage_team_id` FK, `advantage_margin`, `depth_notes`, `calculated_at`.
**Concerns** — 🔴 **Upserted on `(match_id, position_code)` with no such constraint**; 🟠 `position_name` duplicates `position_coverage.position_name` — a lookup table's worth of data repeated per row.

## `position_coverage`
**Purpose** — Per-team, per-position coverage: which players cover it, depth quality, emergency cover.
**Ownership** — `CALC` (L5.10).
**Columns** — 11. `team_id`, `position_code`, `position_name`, `primary_players ARRAY`, `secondary_players ARRAY`, `total_coverage`, `coverage_quality`, `depth_rating`, `emergency_cover`, `calculated_at`.
**Concerns** — 🔴 **Upserted on `(team_id, position_code)` with no such constraint** (the similar constraint exists on `team_position_depth`, not here); 🔴 `primary_players`/`secondary_players` ARRAY hold **player references outside the FK system** — no referential integrity on player IDs; 🟠 near-duplicate of `team_position_depth`.

## `position_adaptability`
**Purpose** — Match-level comparison of positional flexibility (multi-position, utility, specialist counts).
**Ownership** — `CALC` (L5.8).
**Columns** — 13. `match_id UNIQUE`, home/away versatility, multi-position players, utility players, specialist players ×2 each, `adaptability_advantage`, `position_coverage_score`, `calculated_at`.
**Concerns** — 🟠 One of five overlapping versatility tables; 🟠 the strict `home_*`/`away_*` column pairing prevents any query that treats the two sides symmetrically.

## `tactical_flexibility`
**Purpose** — Match-level tactical adaptability comparison.
**Ownership** — `CALC` (L5.8).
**Columns** — 13. `match_id UNIQUE`, home/away flexibility, system count, formation adaptability, in-game adaptability ×2 each, `flexibility_advantage`, `flexibility_notes`, `calculated_at`.
**Concerns** — 🟠 Overlaps `team_versatility.tactical_versatility_score` and `team_tactical_variations`; 🟠 same `home_*`/`away_*` pairing problem.

## `substitution_impact`
**Purpose** — Bench strength and substitution options per side.
**Ownership** — `CALC` (L5.8).
**Columns** — 15. `match_id UNIQUE`, home/away bench strength, substitution quality, tactical sub options, game changers, depth score ×2 each, `substitution_advantage`, `impact_notes`, `calculated_at`.
**Concerns** — 🟠 `home_depth_score`/`away_depth_score` duplicate `squad_depth` and `match_squad_depth_comparison`; 🟡 read by the match page.

## `injury_adaptability`
**Purpose** — How well each side absorbs its current absences.
**Ownership** — `CALC` (L5.10).
**Columns** — 15. `match_id UNIQUE`, home/away injury resilience, position redundancy, cover quality, system flexibility under injury, emergency cover ×2 each, `adaptability_under_injury`, `resilience_notes`, `calculated_at`.
**Concerns** — 🟠 Fourth table on the injury concept; 🟡 never read by the frontend.

## `formation_analysis`
**Purpose** — Per-team, per-match formation profile with strengths, weaknesses, and style.
**Ownership** — `CALC` (L5.10).
**Columns** — 13. `match_id`, `team_id`, `primary_formation`, `secondary_formation`, `tertiary_formation`, `formation_confidence`, `formation_variations ARRAY`, `preferred_style`, `alternative_styles ARRAY`, `formation_strengths ARRAY`, `formation_weaknesses ARRAY`, `calculated_at`.
**Concerns** — 🔴 **Upserted on `(match_id, team_id)` with no such constraint**; 🟠 `primary`/`secondary`/`tertiary_formation` duplicated verbatim in `formation_options`; 🟠 four ARRAY columns.

## `formation_options`
**Purpose** — Available formations per side with confidence and advantage.
**Ownership** — `CALC` (L5.10).
**Columns** — 15. `match_id UNIQUE`, `home_available_formations ARRAY`/`away_*`, home/away primary/secondary/tertiary formation ×6, home/away formation confidence, `formation_advantage`, `formation_notes`, `calculated_at`.
**Concerns** — 🔴 **Direct duplicate of `formation_analysis`** in home/away-pivoted shape. Two tables, one fact, written by two processors in the same layer; 🟡 never read by the frontend.

## `formation_matchup`
**Purpose** — How the two predicted formations interact.
**Ownership** — `CALC` (L5.8).
**Columns** — 11. `match_id UNIQUE`, `home_formation_vs_away`, `away_formation_vs_home`, `matchup_effectiveness`, `home_advantages ARRAY`, `away_advantages ARRAY`, `neutral_areas ARRAY`, `key_matchups ARRAY`, `tactical_notes`, `calculated_at`.
**Concerns** — 🟠 Four ARRAY columns; 🟠 `key_matchups ARRAY` duplicates `match_key_battles`/`match_positional_matchups` as an array; 🟡 never read by the frontend.

## `versatility_advantage`
**Purpose** — Net versatility edge between the two sides.
**Ownership** — `CALC` (L5.10).
**Columns** — 10. `match_id UNIQUE`, `advantage_score`, `advantage_team_id` FK, `advantage_margin`, `advantage_band`, `key_advantages ARRAY`, `key_disadvantages ARRAY`, `confidence_score`, `calculated_at`.
**Concerns** — 🔴 **Structurally identical to `match_impact_advantage`** — same eight columns, different subject. Two tables that differ only in what they are about is the definition of a missing generic structure; 🟡 never read by the frontend.

## `team_position_depth`
**Purpose** — Per-team, per-position squad depth with injury-adjusted availability.
**Ownership** — `CALC` (squad sync, via `TeamPositionDepthRepository`).
**Columns** — 11. `team_id`, `position_code`, `player_count`, `injured_count`, `available_count`, `total_market_value`, `strength_score`, `quality_rating`, `depth_rating`, `updated_at`.
**Constraints** — `UNIQUE (team_id, position_code)`.
**Concerns** — 🟠 Overlaps `position_coverage` almost exactly; 🟡 the correctly-constrained member of the depth family — the model for the others.

## `team_strengths` / `team_weaknesses`
**Purpose** — Narrative bullet points about a team, one row per finding.
**Ownership** — `CALC` (L5.10, via `deleteThenInsert` — the code comment at `processExtendedIntelligence.ts:3661` states these two have **no unique constraint by design**, so `ON CONFLICT` cannot be used).
**Columns** — 6 each. `team_id`, `strength_type`/`weakness_type`, `description`, `score`, `calculated_at`.
**Concerns** — 🟡 **The only intentionally multi-row-per-team output structure, and the closest thing to a module-result table** — a typed key, a score, a description; 🟠 duplicated by `team_intelligence.strengths`/`weaknesses` ARRAY and `team_versatility.strengths`/`weaknesses` ARRAY; 🟠 delete-then-insert is not atomic — a failed insert chunk leaves the team with partial findings.

## `team_locations`
**Purpose** — Resolved geographic home base per team; the input to every travel calculation.
**Ownership** — `CALC` (L1, `processTeamLocations`).
**Columns** — 7. `team_id` PK, `stadium_id` FK, `city`, `country`, `latitude`, `longitude`, `updated_at`.
**Concerns** — 🟡 Correctly uses `team_id` as the natural PK; 🟠 `latitude`/`longitude`/`city`/`country` duplicate `stadiums` for the linked stadium — a resolution cache with no flag saying whether the coordinates came from the stadium or a fallback.

---

## 2d. Calibration / backtest tables

## `readiness_history`
**Purpose** — **The most important table in the system for credibility.** An immutable point-in-time archive of every match prediction, later linked to the actual result and scored strict/lenient. This is what makes any published hit rate defensible.
**Ownership** — `CALC` (`archiveReadinessHistory`).
**Columns** — 27. `match_id UNIQUE`, `match_external_id`, `snapshot_at`, `match_date`, **`readiness_formula_version` (default `'v1'`)**, denormalized `league_name`/`home_team`/`away_team` text, `home_team_id`/`away_team_id`, `home_readiness`/`away_readiness`, `predicted_gap`, `predicted_pick`, `confidence_pct`, `squad_versatility`, `defense`/`midfield`/`attack_confidence_pct`, result linkage (`result_linked_at`, `final_home_score`, `final_away_score`, `final_outcome`, `pick_correct_strict`, `pick_correct_lenient`), `created_at`.
**Constraints** — indexes on linked/unlinked/league; **immutability lock (migration 043)**.
**Concerns**
- 🟡 **The only versioned table in the schema.** The pattern V2 should generalize.
- 🟠 `league_name` as text is the join key to `league_gap_analytics`/`league_gap_summary` — a rename breaks the calibration chain.
- 🟠 `match_id UNIQUE` allows **one snapshot per match**, so a prediction cannot be archived at T-7 and again at T-1. The name says "history"; the constraint says "latest".
- 🟠 Only readiness-based picks are archived. The `match_performance_comparison` prediction and the HT/FT model have no archive at all, so they cannot be calibrated.

## `league_gap_analytics`
**Purpose** — Hit rate per league per readiness-gap tier, with baseline and lift.
**Ownership** — `CALC`.
**Columns** — 12. `league_name`, `gap_tier`, `total_picks`, `hit_rate_strict`/`_lenient`, `avg_winning_gap`/`avg_losing_gap`, `baseline_rate`, `lift_over_baseline`, `versatility_coverage`, `computed_at`.
**Constraints** — `UNIQUE (league_name, gap_tier)`.
**Concerns** — 🟠 Text league key with no FK; 🟡 carries `total_picks` and `baseline_rate` — the sample-size discipline `modules.ts` demands.

## `league_gap_summary`
**Purpose** — Per-league rollup of the above, with a sample gate.
**Ownership** — `CALC`.
**Columns** — 11. `league_name UNIQUE`, `total_picks`, `hit_rate_strict`/`_lenient`, `avg_winning_gap`, `baseline_rate`, `lift_over_baseline`, `band_status`, `meets_sample_gate`, `computed_at`.
**Concerns** — 🔴 **`league_name` as the UNIQUE key.** Two competitions with the same name in different countries (Premier League, Super League, First Division) collide into one calibration row; 🟡 `meets_sample_gate` is exactly the right guard and should be schema-wide.

## `signal_backtests`
**Purpose** — Measured hit rate, baseline, lift, and Wilson confidence interval per signal rule per market. The evidence layer behind every published rate.
**Ownership** — `CALC` (`backtestSignals`, `backtestConfidenceBands`).
**Columns** — 14. `rule_key`, `market`, `sample_size`, `hits`, `hit_rate`, `baseline_rate`, `lift`, `is_calibrated`, `window_days`, `notes`, `ci_low`, `ci_high` (migration 040), `evaluated_at`.
**Constraints** — `UNIQUE (rule_key, market)`.
**Concerns**
- 🟠 **`rule_key` is a text taxonomy disconnected from the module registry.** Modules are keyed `home_away`, `readiness`, …; signals are keyed by `rule_key`; nothing maps between them, so a module cannot reliably show its own backtest.
- 🟠 `UNIQUE (rule_key, market)` keeps only the latest evaluation — no history of how a rule's measured rate moved.
- 🟡 Wilson intervals and an explicit `is_calibrated` flag are genuinely good practice.

---

# LAYER 3 — USER / PRODUCT (12 tables)

## `user_profiles`
**Purpose** — Application-side user record: role, display name, avatar, suspension state.
**Ownership** — `PG` (row created by `handle_new_user()` trigger on `auth.users`), then `USER` (display name/avatar) and `ADMIN` (role, suspension).
**Columns** — 14. `user_id uuid UNIQUE` FK→`auth.users`, `display_name`, `role CHECK IN (user, support, moderator, admin, owner)`, `avatar_url`, `provider`, `email`, `last_login_at`, `suspended`/`suspended_reason`/`suspended_at`/`suspended_by`, timestamps.
**Constraints** — RLS: `up_self_read`, `up_self_update`, `up_admin_all`; **trigger `guard_profile_self_update`** blocks a non-admin changing their own `role`.
**Concerns** — 🟠 `email` duplicates `auth.users.email` with no sync mechanism; 🟡 the role guard trigger is exactly the right pattern and is the model migration 042 cites.

## `user_subscriptions`
**Purpose** — A user's plan, status, period, and Stripe linkage.
**Ownership** — `ADMIN` + future billing webhook.
**Columns** — 13. `user_id` FK, `plan_id` FK, `status CHECK IN (trialing, active, past_due, cancelled, expired)`, `started_at`, `expires_at`, `provider` (default `'manual'`), `stripe_subscription_id`, `current_period_start`/`_end`, `cancel_at_period_end`, timestamps.
**Constraints** — RLS `us_self_read`/`us_admin_all`; unique indexes `idx_user_subs_one_active`, `idx_user_subs_one_live`, `idx_user_subs_stripe`.
**Concerns** — 🟡 Well-constrained; 🟠 no Stripe webhook writer exists yet, so `provider='manual'` is the only live path.

## `subscription_plans`
**Purpose** — Sellable plans with price, interval, rank, and active flag.
**Ownership** — `ADMIN`.
**Columns** — 10. `name`, `slug UNIQUE`, `description`, `price`, `billing_interval CHECK IN (month, year, once)`, `active`, `rank`, timestamps.
**Concerns** — 🟠 **Plan definitions are duplicated in frontend TypeScript** (`tier.ts` `PLANS` array hardcodes starter/pro/proplus with prices and feature bullets). Two sources of truth for what a plan costs and includes; 🟡 `rank` correctly makes tier comparison data-driven.

## `feature_permissions`
**Purpose** — Maps a feature key to the minimum plan slug required. The DB half of entitlement.
**Ownership** — `ADMIN`.
**Columns** — 6. `feature_key UNIQUE`, `feature_name`, `required_plan` FK→`subscription_plans(slug)`, `description`, `created_at`.
**Concerns**
- 🔴 **`feature_key` values are duplicated as a hardcoded TypeScript union** in `access.ts` (`FeatureKey`, 13 literals) and mapped to module keys by a hardcoded object. A row added here without a matching code change is invisible; a code change without a row silently grants access.
- 🟠 FK targets a non-PK unique column (`subscription_plans.slug`) — valid but unusual; a slug rename cascades unexpectedly.
- 🟠 The mapping is single-tier ("minimum plan"), so per-plan feature matrices are not expressible.

## `subscription_events`
**Purpose** — Audit log of plan changes.
**Ownership** — `ADMIN` / billing.
**Columns** — 7. `user_id`, `event_type CHECK IN (created, upgraded, downgraded, renewed, cancelled, expired, payment_failed, reactivated)`, `old_plan`, `new_plan`, `metadata jsonb`, `created_at`.
**Concerns** — 🟡 Well-constrained event log; 🟠 `old_plan`/`new_plan` are text, not FKs.

## `customers`
**Purpose** — Stripe customer linkage.
**Ownership** — Intended billing webhook; **written by nothing today**.
**Columns** — 4. `user_id UNIQUE` FK, `stripe_customer_id UNIQUE`, `created_at`.
**Concerns** — 🟠 Referenced by neither codebase. Staged for Stripe; needs a product decision, not removal.

## `watchlists`
**Purpose** — User-saved matches, teams, and leagues.
**Ownership** — `USER`.
**Columns** — 5. `user_id` FK, `entity_type CHECK IN (match, team, league)`, `entity_id`, `created_at`.
**Constraints** — `UNIQUE (user_id, entity_type, entity_id)`; RLS `watch_own`; **three `AFTER DELETE` prune triggers** on `matches`, `teams`, `tournaments` calling `prune_watchlist_entity()`.
**Concerns** — 🟡 The polymorphic-reference problem is handled about as well as it can be without FKs; 🟠 `entity_id` still has no referential integrity at insert time — a watchlist entry for a nonexistent match is accepted.

## `user_favourite_leagues`
**Purpose** — Per-user league preferences driving feed personalization.
**Ownership** — `USER`.
**Columns** — 4. `user_id` FK, `tournament_id` FK, `created_at`. `UNIQUE (user_id, tournament_id)`; RLS `fav_own`.
**Concerns** — 🟡 The only product table with a real FK into the football layer. Correct, and the model `watchlists` should follow.

## `notifications` / `notification_preferences`
**Purpose** — In-app notification delivery and per-user channel/topic preferences (`friday_briefing`, `consensus_changes`, `module_changes`).
**Ownership** — Intended `PG`/`CALC`; **written by nothing today**.
**Columns** — 9 each. `notifications`: `user_id`, `type`, `title`, `message`, `entity_type CHECK`, `entity_id`, `read_at`, `created_at`. `notification_preferences`: `user_id UNIQUE`, `email_notifications`, `push_notifications`, `friday_briefing`, `consensus_changes`, `module_changes`, timestamps.
**Concerns** — 🟠 Referenced by neither codebase; 🟠 `notifications.entity_id` is polymorphic with **no prune trigger**, unlike `watchlists` — it will accumulate dangling references once populated; 🟠 `notification_preferences.module_changes` implies module-level change detection that no table supports.

## `user_notes` / `admin_actions`
**Purpose** — Support notes on a user, and an audit trail of admin actions.
**Ownership** — `ADMIN`.
**Columns** — 6 / 7. `user_notes`: `target_user_id`, `author_id`, `note`, `flag CHECK IN (suspicious, chargeback, support_priority, vip)`, `created_at`. `admin_actions`: `actor_id`, `target_user_id`, `action CHECK` (9 values), `detail`, `metadata jsonb`, `created_at`.
**Constraints** — RLS on both; `admin_actions` is insert-only for admins.
**Concerns** — 🟡 Both well-constrained. `admin_actions` is the only true audit table in the schema — **the operational layer needs the same treatment for pipeline runs.**

---

# LAYER 4 — OPERATIONAL (2 tables)

## `platform_settings`
**Purpose** — Key/value configuration. Holds `subscriptions_enabled`, the flag that puts the entire platform in open beta (read by `subscriptions_enabled()` SQL function and `access.ts`).
**Ownership** — `ADMIN`.
**Columns** — 6. `key UNIQUE`, `value text`, `description`, timestamps. RLS: `ps_read` (public), `ps_admin_write`.
**Concerns** — 🟠 All values are text with no type, validation, or allowed-value list — a typo in `subscriptions_enabled` silently changes global access behaviour; 🟠 mixes product flags with operational config; 🟡 the flag pattern itself is sound and correctly enforced in SQL rather than only in application code.

## `platform_daily_summary`
**Purpose** — Daily aggregate counters for the dashboard: matches today, competitions, teams tracked, readiness computed, average readiness, last sync time.
**Ownership** — `CALC` (L6, `processDashboardSummary`).
**Columns** — 10. `summary_date UNIQUE`, `matches_today`, `competitions_today`, `teams_tracked`, `competitions_tracked`, `readiness_calculated_count`, `avg_readiness`, `last_sync_at`, `calculated_at`.
**Concerns**
- 🔴 **This is the entire operational observability surface of the platform.** There is no record of which job ran, when, how long it took, how many rows it wrote, what errored, or how much API quota it consumed. `last_sync_at` is one nullable timestamp per day.
- 🟠 Never read by the frontend.
- 🟠 Cannot answer the most basic production question: "is today's intelligence fresh, and which parts of it failed?"

---

# Cross-cutting summary

| Pattern | Count | Assessment |
|---|---|---|
| Tables keyed 1:1 on `team_id`, overwritten in place | 17 | Blocks history, seasons, multi-competition |
| Tables keyed 1:1 or 1:few on `match_id` | 31 | Should be one module-result structure |
| ARRAY columns holding relational content | 21 across 11 tables | Unqueryable, unindexable, no FK integrity |
| `jsonb` columns holding product content | 9 across 6 tables | Same, plus schema drift risk |
| Tables carrying a formula/model version | **1** (`readiness_history`) | The pattern to generalize |
| Tables protected from post-hoc rewrite | **2** (`match_intelligence` partially, `readiness_history`) | 29 match-scoped tables unprotected |
| Tables carrying their own sample size | 5 | `team_form_quality`, `team_venue_performance`, `signal_backtests`, `league_gap_*` — good practice, not systematic |
| Upserts whose conflict target has no constraint in-repo | 5 | Must be resolved before V2 design |
| Tables referenced by neither codebase | 4 | Need a product decision — **not** removal candidates |
| Operational telemetry tables | 1 | Effectively absent |
