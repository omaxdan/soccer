-- ─── MIGRATION 029 — Risk Engine, Opportunity Layer, Backtest Calibration ───
-- PitchTerminal Phase 3 schema. Three rules govern this layer:
--
--  1. CALIBRATION GATE. A directional market signal is only published when
--     its rule has a measured historical record: sample_size ≥ 200 AND
--     lift ≥ 1.05 over the market base rate (thresholds env-tunable,
--     PT_MIN_SAMPLE / PT_MIN_LIFT; PT_PUBLISH_UNCALIBRATED=1 overrides for
--     dev). Shipping unmeasured signals is a credibility time bomb — the
--     moment the product says "Home Win: Positive", it owns a track record.
--
--  2. EXPLANATION REQUIRED. Every signal and risk factor carries its
--     drivers. No naked verdicts.
--
--  3. LEGACY ENGINE UNTOUCHED. Nothing here modifies readiness, NBSI, or
--     any existing intelligence — this layer only reads them.

-- ── 1. Match risk intelligence ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_risk_intelligence (
  id bigint GENERATED ALWAYS AS IDENTITY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),

  risk_score integer CHECK (risk_score BETWEEN 0 AND 100),
  risk_band  text    CHECK (risk_band IN ('LOW','MEDIUM','HIGH')),
  -- Convenience inverse for "Match Predictability Score" surfaces
  predictability_score integer CHECK (predictability_score BETWEEN 0 AND 100),

  -- Array of { key, label, points } — every factor that contributed,
  -- e.g. { "key":"scorer_dependency", "label":"Favourite depends on one
  -- scorer for 48% of goals", "points":12 }
  risk_factors jsonb NOT NULL DEFAULT '[]'::jsonb,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_risk_intelligence_pkey PRIMARY KEY (id)
);

-- ── 2. Match opportunity + executive brief ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.match_opportunity (
  id bigint GENERATED ALWAYS AS IDENTITY,
  match_id bigint NOT NULL UNIQUE REFERENCES public.matches(id),

  -- 0–100 contrast/edge composite. Measures how much exploitable
  -- asymmetry the intelligence sees — NOT which team wins.
  opportunity_score integer CHECK (opportunity_score BETWEEN 0 AND 100),

  -- Composed narrative shown first on the match page ("Executive Brief" —
  -- deliberately not "Executive Decision": decision support, not instruction).
  executive_brief text,

  -- Headline arrays of { key, text } — max 3 each, strongest first
  signals  jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Raw component scores for transparency/debugging
  score_components jsonb NOT NULL DEFAULT '{}'::jsonb,

  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_opportunity_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_match_opportunity_score
  ON public.match_opportunity(opportunity_score DESC);

-- ── 3. Rule keys on stored signals ──────────────────────────────────────────
-- PitchTerminal market signals coexist with legacy rows in match_signals via
-- signal_group = 'pitchterminal' (writer deletes/rewrites only its own group).
-- rule_key joins each stored signal to its calibration record.
ALTER TABLE public.match_signals
  ADD COLUMN IF NOT EXISTS rule_key text;

CREATE INDEX IF NOT EXISTS idx_match_signals_rule_key
  ON public.match_signals(rule_key);

-- ── 4. Backtest calibration results ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.signal_backtests (
  id bigint GENERATED ALWAYS AS IDENTITY,
  rule_key text NOT NULL,
  market   text NOT NULL,          -- HOME_WIN | AWAY_WIN | DRAW | OVER_2_5 | UNDER_2_5 | BTTS

  sample_size   integer NOT NULL,
  hits          integer NOT NULL,
  hit_rate      numeric NOT NULL,  -- hits / sample_size
  baseline_rate numeric NOT NULL,  -- market base rate over the SAME population
  lift          numeric NOT NULL,  -- hit_rate / baseline_rate

  is_calibrated boolean NOT NULL DEFAULT false,  -- passed sample+lift gate at eval time
  window_days   integer,                          -- NULL = full history
  notes         text,
  evaluated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT signal_backtests_pkey PRIMARY KEY (id),
  CONSTRAINT signal_backtests_rule_market_key UNIQUE (rule_key, market)
);

COMMENT ON TABLE public.signal_backtests IS
  'Measured historical performance per signal rule. Rules are evaluated ONLY on pre-kickoff features (team_match_snapshots, match_opponent_context, readiness_history) — never on information from after kickoff. The signal writer refuses to publish rules that are not calibrated here.';

-- ── Verification ─────────────────────────────────────────────────────────────
-- After backtest:signals + process:risk-opportunity have both run once:
-- SELECT rule_key, market, sample_size, round(hit_rate*100,1) AS hit_pct,
--        round(baseline_rate*100,1) AS base_pct, round(lift,3) AS lift,
--        is_calibrated
--   FROM signal_backtests ORDER BY lift DESC;
-- SELECT count(*) FROM match_signals
--  WHERE signal_group='pitchterminal'
--    AND rule_key NOT IN (SELECT rule_key FROM signal_backtests WHERE is_calibrated);
--                                                   -- expect 0 unless override set
