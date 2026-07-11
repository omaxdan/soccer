-- ─── MIGRATION 028 — Historical Context Engine (PitchTerminal Phase 1) ──────
-- Foundational principle: opponent quality must be captured AT THE TIME of
-- the match, never inferred from final season standings. "Manchester United
-- finished 8th" is useless; "Manchester United were 2nd when we played them"
-- is intelligence. Every finished match gets a pre-kickoff state snapshot
-- for both teams, reconstructed by replaying results in date order per
-- (tournament_id, season_id) — see processHistoricalContext.ts.
--
-- This is also the substrate for the Phase 3 backtest harness: signal rules
-- are only evaluated against features that were knowable BEFORE kickoff,
-- which is what makes their measured hit rates honest.

-- ── 1. Pre-kickoff team state, one row per (match, team) ────────────────────
CREATE TABLE IF NOT EXISTS public.team_match_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY,
  match_id bigint NOT NULL REFERENCES public.matches(id),
  team_id  bigint NOT NULL REFERENCES public.teams(id),
  is_home  boolean,

  -- Reconstructed league table state entering the match
  league_position_before integer,          -- NULL until team has played ≥1 game
  points_before          integer NOT NULL DEFAULT 0,
  games_played_before    integer NOT NULL DEFAULT 0,
  goal_diff_before       integer NOT NULL DEFAULT 0,
  ppg_before             numeric,          -- points_before / games_played_before

  -- Rolling form entering the match (from team_form_history replay)
  points_last5_before    integer,          -- NULL until ≥1 prior match; capped at last 5

  -- Ratings where a dated source exists. Honest-nullability policy:
  --  * form_rating_before  ← team_intelligence_history.form_index, nearest
  --    snapshot_date ≤ match date within 14 days (else NULL)
  --  * readiness_before    ← readiness_history.home/away_readiness for this
  --    match (else NULL) — this IS a true pre-kickoff archive
  --  * strength_rating_before has NO historical source (team_strength_ratings
  --    is current-only). NULL for backfilled matches; populated going forward
  --    by the incremental run reading the live value pre-kickoff.
  form_rating_before     numeric,
  readiness_before       numeric,
  strength_rating_before numeric,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_match_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT team_match_snapshots_match_team_key UNIQUE (match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_tms_team ON public.team_match_snapshots(team_id);
CREATE INDEX IF NOT EXISTS idx_tms_match ON public.team_match_snapshots(match_id);

COMMENT ON TABLE public.team_match_snapshots IS
  'Pre-kickoff league-table and form state per team per match, reconstructed by date-ordered result replay per tournament season. Never overwritten by later-season knowledge.';
COMMENT ON COLUMN public.team_match_snapshots.strength_rating_before IS
  'NULL for backfilled matches (no historical strength source exists). Populated live going forward from team_strength_ratings.strength_score at snapshot time.';

-- ── 2. Opponent context, one row per (match, team) — describes THAT team's
--       opponent as it stood before kickoff ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_opponent_context (
  id bigint GENERATED ALWAYS AS IDENTITY,
  match_id bigint NOT NULL REFERENCES public.matches(id),
  team_id  bigint NOT NULL REFERENCES public.teams(id),   -- perspective team
  opponent_team_id bigint NOT NULL REFERENCES public.teams(id),

  opponent_position_before integer,
  opponent_points_before   integer,
  opponent_ppg_before      numeric,
  opponent_form_before     integer,        -- opponent's last-5 points entering match

  -- Rank band: tercile of the reconstructed table among teams with ≥1 game.
  -- NULL (with quality NULL) when opponent had played <4 games — early-season
  -- positions are noise and are honestly withheld rather than guessed.
  opponent_rank_band text
    CHECK (opponent_rank_band IN ('top','middle','bottom')),

  -- 0–100 blend: 60% positional percentile in the table at that time,
  -- 40% opponent PPG relative to the table leader's PPG at that time.
  -- Formula documented once, in processHistoricalContext.ts, and never
  -- re-invented per consumer.
  opponent_quality_score numeric,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_opponent_context_pkey PRIMARY KEY (id),
  CONSTRAINT match_opponent_context_match_team_key UNIQUE (match_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_moc_team ON public.match_opponent_context(team_id);
CREATE INDEX IF NOT EXISTS idx_moc_band ON public.match_opponent_context(opponent_rank_band);

-- ── 3. Derived form-quality intelligence, one row per team (rolling) ────────
-- All values recomputed from the two tables above over the team's last
-- 10 context-bearing matches. Numbers, not verdicts — consumers decide
-- how to present them.
CREATE TABLE IF NOT EXISTS public.team_form_quality (
  id bigint GENERATED ALWAYS AS IDENTITY,
  team_id bigint NOT NULL UNIQUE REFERENCES public.teams(id),

  window_matches integer NOT NULL DEFAULT 0,

  -- Opponent-Adjusted Form, 0–100. Each match's points are weighted by
  -- (0.5 + opponent_quality/100): beating a 100-quality side counts 1.5×,
  -- a 0-quality side 0.5×. OAF = 100 × Σ(points×w) / (3 × Σw).
  opponent_adjusted_form numeric,

  -- Strength of Schedule, 0–100: mean opponent_quality_score over window.
  strength_of_schedule numeric,

  -- Performance split by opponent tier (points per game; NULL if <3 samples)
  ppg_vs_top    numeric,  matches_vs_top    integer NOT NULL DEFAULT 0,
  ppg_vs_middle numeric,  matches_vs_middle integer NOT NULL DEFAULT 0,
  ppg_vs_bottom numeric,  matches_vs_bottom integer NOT NULL DEFAULT 0,

  -- Giant Killer: 100 × ppg_vs_top / 3           (≥3 top-tier samples)
  -- Flat Track Bully: 100 × max(0, ppg_vs_bottom − ppg_vs_top) / 3
  --                                               (≥3 samples in BOTH tiers)
  giant_killer_score     numeric,
  flat_track_bully_score numeric,

  -- Expected vs actual: expected_points = Σ league-wide baseline PPG earned
  -- against each opponent band (baseline computed per tournament from ALL
  -- context rows, so it reflects that league's real difficulty structure).
  -- Positive delta = overperforming the league norm for that schedule.
  expected_points   numeric,
  actual_points     integer,
  performance_delta numeric,

  -- Goal-margin standard deviation over window — volatility input for the
  -- Phase 3 risk engine.
  volatility numeric,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_form_quality_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.team_form_quality IS
  'Rolling opponent-quality-adjusted form intelligence. Window = last 10 matches with valid opponent context. All formulas defined in processFormQuality.ts and mirrored in column comments here.';

-- ── Verification (run after first backfill) ─────────────────────────────────
-- 1) Coverage: every finished match with a result should have 2 snapshot rows
-- SELECT count(*) FROM match_results r
--   JOIN matches m ON m.id = r.match_id
--   LEFT JOIN team_match_snapshots s ON s.match_id = m.id
--  WHERE r.status = 'finished' AND s.id IS NULL;          -- expect 0
-- 2) No future leakage: position_before must be NULL on each team's first game
-- SELECT count(*) FROM team_match_snapshots
--  WHERE games_played_before = 0 AND league_position_before IS NOT NULL;  -- expect 0
-- 3) Band integrity: quality NULL wherever band is NULL and vice versa
-- SELECT count(*) FROM match_opponent_context
--  WHERE (opponent_rank_band IS NULL) <> (opponent_quality_score IS NULL); -- expect 0
