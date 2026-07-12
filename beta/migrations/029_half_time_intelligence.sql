-- ─── MIGRATION 029 — Half-Time/Full-Time Intelligence ───────────────────────
-- Computed directly from match_results.half_time_home_score/away_score
-- (real columns since migration 001) — NOT from a "team_ht_profile" view,
-- which does not exist anywhere in this project's migration history
-- (verified against all 28 prior migrations before writing this one).

CREATE TABLE IF NOT EXISTS public.match_half_time_intelligence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),
  home_ht_win_prob numeric,
  draw_ht_prob numeric,
  away_ht_win_prob numeric,
  predicted_ht_goals_home numeric,
  predicted_ht_goals_away numeric,
  hh_prob numeric, hd_prob numeric, ha_prob numeric,
  dh_prob numeric, dd_prob numeric, da_prob numeric,
  ah_prob numeric, ad_prob numeric, aa_prob numeric,
  home_2h_goals numeric, away_2h_goals numeric,
  over_0_5_2h_prob numeric, over_1_5_2h_prob numeric, btts_2h_prob numeric,
  confidence_score integer, confidence_band text,
  calculated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
COMMENT ON TABLE public.match_half_time_intelligence IS
  'HH/HD/HA/DH/DD/DA/AH/AD/AA transition probabilities, blended from each side''s own HT/FT history (min. 5 finished matches with half-time data, else league average fallback), weighted by home_readiness/away_readiness. Second-half goal estimates are a simple average-based heuristic, not Poisson-modeled — flagged provisional pending backtest, same as other heuristic scores in this suite.';

ALTER TABLE public.match_half_time_intelligence ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='match_half_time_intelligence' AND policyname='public_read') THEN
    CREATE POLICY public_read ON public.match_half_time_intelligence FOR SELECT USING (true);
  END IF;
END $$;
