-- ─── MIGRATION 017 — Player Importance / Goal Dependency / Injury Impact ────
-- Three closely related tables answering the same underlying question from
-- different angles: how much does this team rely on player X?
--
-- Built after finding a real double-scaling bug in a proposed ad-hoc
-- formula (importance = (weighted-fraction-sum-already-0-100) * 100 —
-- inflated a real ~12.5/100 score to 1250, reported as "5650.9 CRITICAL"
-- for a real player) — every formula below was verified by direct
-- simulation before being written into the backend job, not just
-- reasoned about on paper.

-- 1. Per-player importance — season-scoped (most recent season only, same
--    fix as processPredictedLineups: player_season_statistics genuinely
--    accumulates one row per season over time, summing across all of them
--    would dilute/inflate current-season importance).
ALTER TABLE public.player_intelligence
  ADD COLUMN IF NOT EXISTS importance_score numeric,
  ADD COLUMN IF NOT EXISTS goal_share_pct numeric,
  ADD COLUMN IF NOT EXISTS assist_share_pct numeric,
  ADD COLUMN IF NOT EXISTS minutes_share_pct numeric;

-- 2. Team-level goal concentration risk — the genuinely novel metric from
--    the source documents: how concentrated is this team's scoring in its
--    top 1-2 players (distinct from "starters vs bench", which is largely
--    tautological since predicted lineups are selected BY matches_started/
--    rating — of course the starters account for most of a team's output,
--    that's true of every team ever and isn't itself a risk signal).
--    Concentration in ONE named individual is the real, differentiated
--    risk signal.
CREATE TABLE IF NOT EXISTS public.team_goal_dependency (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL UNIQUE,
  season_external_id bigint,
  total_goals integer,
  total_assists integer,
  top_scorer_player_id bigint,
  top_scorer_goals integer,
  top_scorer_pct numeric,
  top_2_scorers_pct numeric,
  top_scorer_no_backup boolean,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_goal_dependency_pkey PRIMARY KEY (id),
  CONSTRAINT team_goal_dependency_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_goal_dependency_top_scorer_fkey FOREIGN KEY (top_scorer_player_id) REFERENCES public.players(id)
);

-- 3. Team-level injury impact — SUM(importance_score) across currently
--    active-injured players, correctly gated on active=true ONLY (the
--    source documents' end_timestamp > NOW() comparison silently drops
--    any open-ended injury with no known return date, since NULL > X is
--    NULL, not true, in a WHERE clause — the existing processPlayerIntelligence
--    job already gets this right with .eq('active', true) alone).
CREATE TABLE IF NOT EXISTS public.team_injury_impact (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL UNIQUE,
  injured_count integer,
  total_importance_lost numeric,
  goals_lost integer,
  assists_lost integer,
  no_replacement_positions text,
  worst_absence_player_id bigint,
  worst_absence_importance numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_injury_impact_pkey PRIMARY KEY (id),
  CONSTRAINT team_injury_impact_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  CONSTRAINT team_injury_impact_worst_fkey FOREIGN KEY (worst_absence_player_id) REFERENCES public.players(id)
);
