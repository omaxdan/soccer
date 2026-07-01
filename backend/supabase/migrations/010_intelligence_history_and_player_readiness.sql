-- ─── MIGRATION 010 — Team Intelligence History + Player Readiness ───────────
-- Unblocks: Trend (Last 14 Days) chart on Team Detail, Trend Over Time on
-- League Detail, Trend sparkline column on Leagues Overview — all three
-- were blocked on the same gap: team_intelligence only stores the CURRENT
-- snapshot (overwritten every run), with no history to chart.
--
-- Also adds player_intelligence.readiness_score — unblocks the per-player
-- READINESS column shown in the Team Detail "Key Players" table mockup.

-- Daily snapshot of team_intelligence, same pattern as team_squads_snapshot
-- and team_fixture_load (both already use snapshot_date). One row per
-- team per day — NOT overwritten, accumulates history for trend charts.
CREATE TABLE IF NOT EXISTS public.team_intelligence_history (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  team_id bigint NOT NULL,
  snapshot_date date NOT NULL,
  readiness_score numeric,
  form_index numeric,
  congestion_score numeric,
  travel_fatigue_score numeric,
  rest_days_avg numeric,
  squad_stability_score numeric,
  injury_burden_score numeric,
  calculated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT team_intelligence_history_pkey PRIMARY KEY (id),
  CONSTRAINT team_intelligence_history_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id),
  -- One snapshot per team per day — running the daily process job twice in
  -- the same day upserts rather than duplicating.
  CONSTRAINT team_intelligence_history_team_date_unique UNIQUE (team_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_team_intelligence_history_team_date
  ON public.team_intelligence_history (team_id, snapshot_date DESC);

-- Per-player readiness score — composite of fatigue, load, and recent
-- playing time. Computed the same way team readiness is: not stored raw
-- fatigue/load numbers directly in the UI, but a single blended 0-100
-- score matching the "READINESS" column in the Key Players mockup table.
ALTER TABLE public.player_intelligence
  ADD COLUMN IF NOT EXISTS readiness_score numeric;
