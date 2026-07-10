-- ─── MIGRATION 014 — League Intelligence Precomputation ──────────────────────
-- Converts getLeagueReadinessRankings() from a live-in-the-browser
-- aggregation (was in frontend/src/lib/queries.ts, three bulk queries +
-- in-memory grouping/averaging recomputed on every Leagues Overview page
-- load) into a precomputed table — same architecture fix as migration 013
-- (match_signals), same underlying project principle: zero runtime
-- calculations, frontend reads only.

CREATE TABLE IF NOT EXISTS public.league_intelligence (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL UNIQUE,
  team_count integer DEFAULT 0,
  avg_readiness numeric,
  avg_form numeric,
  avg_congestion numeric,
  avg_travel_14d numeric,
  avg_rest_days numeric,
  avg_active_competitions numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT league_intelligence_pkey PRIMARY KEY (id),
  CONSTRAINT league_intelligence_tournament_id_fkey FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id)
);
