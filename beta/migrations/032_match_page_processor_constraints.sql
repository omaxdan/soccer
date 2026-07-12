-- ─── MIGRATION 032 — Unique constraints for match-page processor tables ─────
-- All 6 target tables already exist live (they were part of the original
-- scaffold SQL). This migration only adds the unique constraints needed for
-- upsert(onConflict:...) to work safely — idempotent, no-ops where a
-- constraint already exists. Written defensively rather than assumed,
-- since the abbreviated live schema dump didn't confirm every constraint.

DO $$ BEGIN
  ALTER TABLE public.team_match_impact
    ADD CONSTRAINT team_match_impact_match_team_key UNIQUE (match_id, team_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.match_key_battles
    ADD CONSTRAINT match_key_battles_match_battle_key UNIQUE (match_id, battle_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.match_positional_matchups
    ADD CONSTRAINT match_positional_matchups_match_pos_key UNIQUE (match_id, position_code);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.match_tactical_advantages
    ADD CONSTRAINT match_tactical_advantages_match_type_key UNIQUE (match_id, advantage_type);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.player_matchup
    ADD CONSTRAINT player_matchup_match_players_key UNIQUE (match_id, player_id, opponent_player_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- match_impact_advantage already has UNIQUE(match_id) per the live schema
-- dump (it's declared UNIQUE on the column itself) — no action needed.
