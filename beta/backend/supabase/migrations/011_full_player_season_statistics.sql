-- ─── MIGRATION 011 — Full Player Season Statistics Field Set ────────────────
-- Confirmed via direct inspection of syncSeasonStatistics.ts and the raw
-- SofaScore API payload (pasted example: Evertton Araujo, 79 of ~80
-- available fields populated) that only 13 fields were being captured out
-- of the full response — everything below was arriving in every API call
-- already being made and simply discarded. No new API calls, no new sync
-- job, no new cost. See backend/docs/PLAYER_STATS_EXPANSION.md for the
-- full reasoning and the tiering context this was built for.
--
-- FIELD COVERAGE CAVEAT: not every league/tier is confirmed to populate
-- every field (advanced tracking metrics like kilometers_covered,
-- top_speed, number_of_sprints plausibly require optical tracking systems
-- some competitions don't run). Every column here is nullable and the
-- sync job maps with the same `?? null` defensive pattern used everywhere
-- else in this codebase — missing data degrades gracefully, never breaks,
-- never gets faked. Run the verification query in
-- PLAYER_STATS_EXPANSION.md after this has synced against a mix of
-- leagues to see real coverage.
--
-- Excluded as genuinely redundant (not lost, just not worth a column):
--   goalsAssistsSum        — trivially goals + assists
--   scoringFrequency        — in sample data this exactly equalled
--                             minutesPlayed for the one player checked,
--                             which looks like it may not carry the
--                             distinct meaning its name implies. Flagging
--                             as suspect rather than trusting it blindly;
--                             can be added later if verified meaningful.

ALTER TABLE public.player_season_statistics
  -- ── Passing ──────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS accurate_passes integer,
  ADD COLUMN IF NOT EXISTS inaccurate_passes integer,
  ADD COLUMN IF NOT EXISTS total_passes integer,
  ADD COLUMN IF NOT EXISTS accurate_passes_pct numeric,
  ADD COLUMN IF NOT EXISTS accurate_own_half_passes integer,
  ADD COLUMN IF NOT EXISTS accurate_opposition_half_passes integer,
  ADD COLUMN IF NOT EXISTS accurate_final_third_passes integer,
  ADD COLUMN IF NOT EXISTS key_passes integer,
  ADD COLUMN IF NOT EXISTS accurate_long_balls integer,
  ADD COLUMN IF NOT EXISTS accurate_long_balls_pct numeric,
  ADD COLUMN IF NOT EXISTS total_long_balls integer,
  ADD COLUMN IF NOT EXISTS accurate_chipped_passes integer,
  ADD COLUMN IF NOT EXISTS total_chipped_passes integer,
  ADD COLUMN IF NOT EXISTS accurate_crosses integer,
  ADD COLUMN IF NOT EXISTS accurate_crosses_pct numeric,
  ADD COLUMN IF NOT EXISTS total_cross integer,
  ADD COLUMN IF NOT EXISTS pass_to_assist integer,
  ADD COLUMN IF NOT EXISTS total_attempt_assist integer,
  ADD COLUMN IF NOT EXISTS total_own_half_passes integer,
  ADD COLUMN IF NOT EXISTS total_opposition_half_passes integer,

  -- ── Attacking / Shooting ─────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS total_shots integer,
  ADD COLUMN IF NOT EXISTS shots_on_target integer,
  ADD COLUMN IF NOT EXISTS shots_off_target integer,
  ADD COLUMN IF NOT EXISTS shots_from_inside_box integer,
  ADD COLUMN IF NOT EXISTS shots_from_outside_box integer,
  ADD COLUMN IF NOT EXISTS goals_from_inside_box integer,
  ADD COLUMN IF NOT EXISTS goals_from_outside_box integer,
  ADD COLUMN IF NOT EXISTS headed_goals integer,
  ADD COLUMN IF NOT EXISTS left_foot_goals integer,
  ADD COLUMN IF NOT EXISTS right_foot_goals integer,
  ADD COLUMN IF NOT EXISTS goal_conversion_pct numeric,
  ADD COLUMN IF NOT EXISTS big_chances_created integer,
  ADD COLUMN IF NOT EXISTS big_chances_missed integer,
  ADD COLUMN IF NOT EXISTS hit_woodwork integer,
  ADD COLUMN IF NOT EXISTS shot_from_set_piece integer,
  ADD COLUMN IF NOT EXISTS free_kick_goal integer,

  -- ── Dribbling / Ball carrying ────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS successful_dribbles integer,
  ADD COLUMN IF NOT EXISTS successful_dribbles_pct numeric,
  ADD COLUMN IF NOT EXISTS total_contest integer,
  ADD COLUMN IF NOT EXISTS dispossessed integer,
  ADD COLUMN IF NOT EXISTS possession_lost integer,
  ADD COLUMN IF NOT EXISTS possession_won_att_third integer,
  ADD COLUMN IF NOT EXISTS touches integer,
  ADD COLUMN IF NOT EXISTS dribbled_past integer,
  ADD COLUMN IF NOT EXISTS was_fouled integer,
  ADD COLUMN IF NOT EXISTS fouls integer,
  ADD COLUMN IF NOT EXISTS offsides integer,

  -- ── Defensive actions ────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS tackles integer,
  ADD COLUMN IF NOT EXISTS tackles_won integer,
  ADD COLUMN IF NOT EXISTS tackles_won_pct numeric,
  ADD COLUMN IF NOT EXISTS interceptions integer,
  ADD COLUMN IF NOT EXISTS clearances integer,
  ADD COLUMN IF NOT EXISTS blocked_shots integer,
  ADD COLUMN IF NOT EXISTS ball_recovery integer,
  ADD COLUMN IF NOT EXISTS outfielder_blocks integer,
  ADD COLUMN IF NOT EXISTS error_lead_to_goal integer,
  ADD COLUMN IF NOT EXISTS error_lead_to_shot integer,

  -- ── Duels ────────────────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS ground_duels_won integer,
  ADD COLUMN IF NOT EXISTS ground_duels_won_pct numeric,
  ADD COLUMN IF NOT EXISTS aerial_duels_won integer,
  ADD COLUMN IF NOT EXISTS aerial_duels_won_pct numeric,
  ADD COLUMN IF NOT EXISTS aerial_lost integer,
  ADD COLUMN IF NOT EXISTS total_duels_won integer,
  ADD COLUMN IF NOT EXISTS total_duels_won_pct numeric,
  ADD COLUMN IF NOT EXISTS duel_lost integer,

  -- ── Penalties & set pieces ───────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS penalties_taken integer,
  ADD COLUMN IF NOT EXISTS penalty_goals integer,
  ADD COLUMN IF NOT EXISTS penalty_won integer,
  ADD COLUMN IF NOT EXISTS penalty_conceded integer,
  ADD COLUMN IF NOT EXISTS penalty_conversion_pct numeric,
  ADD COLUMN IF NOT EXISTS attempt_penalty_miss integer,
  ADD COLUMN IF NOT EXISTS attempt_penalty_post integer,
  ADD COLUMN IF NOT EXISTS attempt_penalty_target integer,
  ADD COLUMN IF NOT EXISTS set_piece_conversion_pct numeric,

  -- ── Discipline / misc ────────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS direct_red_cards integer,
  ADD COLUMN IF NOT EXISTS yellow_red_cards integer,
  ADD COLUMN IF NOT EXISTS own_goals integer,
  ADD COLUMN IF NOT EXISTS totw_appearances integer,

  -- ── Goalkeeper-specific ──────────────────────────────────────────────
  ADD COLUMN IF NOT EXISTS saves integer,
  ADD COLUMN IF NOT EXISTS saves_caught integer,
  ADD COLUMN IF NOT EXISTS saves_parried integer,
  ADD COLUMN IF NOT EXISTS penalty_faced integer,
  ADD COLUMN IF NOT EXISTS penalty_save integer,
  ADD COLUMN IF NOT EXISTS saved_shots_inside_box integer,
  ADD COLUMN IF NOT EXISTS saved_shots_outside_box integer,
  ADD COLUMN IF NOT EXISTS goals_conceded integer,
  ADD COLUMN IF NOT EXISTS goals_conceded_inside_box integer,
  ADD COLUMN IF NOT EXISTS goals_conceded_outside_box integer,
  ADD COLUMN IF NOT EXISTS clean_sheet integer,
  ADD COLUMN IF NOT EXISTS punches integer,
  ADD COLUMN IF NOT EXISTS runs_out integer,
  ADD COLUMN IF NOT EXISTS successful_runs_out integer,
  ADD COLUMN IF NOT EXISTS high_claims integer,
  ADD COLUMN IF NOT EXISTS crosses_not_claimed integer,
  ADD COLUMN IF NOT EXISTS goal_kicks integer,

  -- ── Physical / tracking (may be sparse — see coverage caveat above) ──
  ADD COLUMN IF NOT EXISTS kilometers_covered numeric,
  ADD COLUMN IF NOT EXISTS number_of_sprints integer,
  ADD COLUMN IF NOT EXISTS top_speed numeric;
