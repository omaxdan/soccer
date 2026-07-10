-- ─── MIGRATION 015 — Fixture Difficulty + Momentum ────────────────────────────
-- Both fully derivable from data already synced — no new API calls, no new
-- capture needed. Confirmed nothing computes either of these today.
--
-- Fixture Difficulty: average opponent strength (team_strength_ratings.
-- strength_score) across a team's next 5/10 scheduled matches. Higher =
-- harder run of fixtures.
--
-- Momentum: recent-vs-prior form trend from team_form_history (already has
-- per-match points + date) — last 5 matches' points vs the 5 before that.
-- Positive = rising, negative = declining.

CREATE TABLE IF NOT EXISTS public.team_fixture_difficulty (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL UNIQUE,
  next_5_difficulty numeric,
  next_10_difficulty numeric,
  next_5_matches integer DEFAULT 0,
  next_10_matches integer DEFAULT 0,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_fixture_difficulty_pkey PRIMARY KEY (id),
  CONSTRAINT team_fixture_difficulty_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);

CREATE TABLE IF NOT EXISTS public.team_momentum (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL UNIQUE,
  momentum_score numeric,
  last_5_points integer,
  prior_5_points integer,
  trend text,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_momentum_pkey PRIMARY KEY (id),
  CONSTRAINT team_momentum_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id)
);
