-- ─── MIGRATION 033 — Confidence Band Component Archive ─────────────────────
-- Problem this fixes:
--   confidence_band on match_intelligence is derived from readiness, which is
--   derived from team_intelligence.form_index — a CURRENT-STATE table (one row
--   per team, no snapshot_date). Joining that band against finished results to
--   measure accuracy scores each match using form that already contains that
--   match's result. The published table (Strong 97.9% over 326 matches) is a
--   lookahead artifact, not a measurement.
--
--   readiness_history already freezes home_readiness, away_readiness and
--   confidence_pct before kickoff, which makes a HONEST band backtest possible
--   (see backtestConfidenceBands.ts, MODE ARCHIVED). What it does NOT freeze is
--   the eight-component vector behind the score. Without that we can measure
--   whether the band works, but never WHICH component is carrying it — so a
--   component that contributes nothing cannot be identified and dropped.
--
-- This migration archives the vector at snapshot time. It is forward-only by
-- construction: there is no historical source for six of the eight components,
-- and this schema deliberately provides no way to backfill them. Fabricating
-- history is the failure mode being corrected, not a shortcut to take again.

-- ── 1. Frozen component vector, one row per snapshotted match ───────────────
CREATE TABLE IF NOT EXISTS public.confidence_band_components (
  id bigint GENERATED ALWAYS AS IDENTITY,
  match_id bigint NOT NULL REFERENCES public.matches(id),

  -- Copied from the readiness_history row this vector belongs to, so the
  -- anti-leakage check (snapshot_at < match_date) can be made without a join.
  snapshot_at timestamptz NOT NULL,
  match_date  timestamptz NOT NULL,

  -- Which side the readiness gap favoured, and the blended score/band as
  -- actually computed pre-kickoff. Duplicated from readiness_history on
  -- purpose: this table must be independently verifiable.
  pick_side        text CHECK (pick_side IN ('HOME','AWAY','DRAW')),
  confidence_score numeric,
  confidence_band  text CHECK (confidence_band IN ('Elite','Strong','Moderate','Risky','Avoid')),

  -- ── The eight components, each signed TOWARD the pick side and already
  --    normalised to [-1, 1] at its saturation constant. Storing the
  --    normalised edge rather than the raw gap means a later change to a
  --    saturation constant cannot silently rewrite history.
  --    NULL = component had no data at snapshot time (renormalised out).
  edge_readiness_gap  numeric CHECK (edge_readiness_gap  BETWEEN -1 AND 1),
  edge_strength_gap   numeric CHECK (edge_strength_gap   BETWEEN -1 AND 1),
  edge_injury_gap     numeric CHECK (edge_injury_gap     BETWEEN -1 AND 1),
  edge_congestion_gap numeric CHECK (edge_congestion_gap BETWEEN -1 AND 1),
  edge_travel_gap     numeric CHECK (edge_travel_gap     BETWEEN -1 AND 1),
  edge_stability_gap  numeric CHECK (edge_stability_gap  BETWEEN -1 AND 1),
  edge_venue_gap      numeric CHECK (edge_venue_gap      BETWEEN -1 AND 1),
  edge_motivation_gap numeric CHECK (edge_motivation_gap BETWEEN -1 AND 1),

  -- How many of the eight had data, and the total weight actually used.
  -- processDbOnly requires >= 4 before emitting a score at all; recording the
  -- count means a band built on the bare minimum can be separated from one
  -- built on full evidence when the sample is large enough to split.
  components_with_data integer NOT NULL,
  weight_used          integer NOT NULL,

  -- Version tag so a formula change creates a new cohort rather than
  -- contaminating the existing one. Bump whenever weights or saturations move.
  band_formula_version text NOT NULL DEFAULT 'v1',

  calculated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT confidence_band_components_pkey PRIMARY KEY (id),
  CONSTRAINT confidence_band_components_match_key UNIQUE (match_id, band_formula_version),
  -- Hard guarantee, enforced by the database rather than by convention:
  -- a row that does not predate kickoff cannot exist.
  CONSTRAINT confidence_band_components_prekickoff CHECK (snapshot_at < match_date)
);

CREATE INDEX IF NOT EXISTS idx_cbc_match ON public.confidence_band_components(match_id);
CREATE INDEX IF NOT EXISTS idx_cbc_band  ON public.confidence_band_components(confidence_band);
CREATE INDEX IF NOT EXISTS idx_cbc_version ON public.confidence_band_components(band_formula_version);

COMMENT ON TABLE public.confidence_band_components IS
  'Pre-kickoff snapshot of the eight normalised evidence edges behind confidence_score. Forward-only: six of eight components have no historical source, so this table starts empty and accumulates. Never backfill it — the CHECK on snapshot_at < match_date is there to make backfilling impossible, not merely discouraged.';

COMMENT ON COLUMN public.confidence_band_components.components_with_data IS
  'Count of non-NULL edges. processDbOnly emits no score below 4. Bands built on exactly 4 components are weaker evidence than bands built on 8 and should be reported separately once sample allows.';

-- ── 2. Widen signal_backtests notes usage for band rows ─────────────────────
-- No schema change needed: rule_key CBAND_ELITE .. CBAND_AVOID with
-- market = 'PICK_STRICT' slot into the existing unique(rule_key, market).
-- Documented here so the convention is discoverable from the migration trail.
COMMENT ON COLUMN public.signal_backtests.market IS
  'HOME_WIN | AWAY_WIN | DRAW | OVER_2_5 | UNDER_2_5 | BTTS for directional rules; PICK_STRICT for confidence-band rows (rule_key CBAND_*), where a hit means the frozen pre-kickoff pick matched the final outcome exactly.';

-- ── Verification ────────────────────────────────────────────────────────────
-- 1) Nothing backfilled (must return 0 — the CHECK should make this impossible):
-- SELECT count(*) FROM confidence_band_components WHERE snapshot_at >= match_date;
--
-- 2) Archived band performance, once backtest:bands has run:
-- SELECT rule_key, sample_size, round(hit_rate*100,1) AS hit_pct,
--        round(baseline_rate*100,1) AS base_pct, round(lift,3) AS lift, is_calibrated
--   FROM signal_backtests WHERE market = 'PICK_STRICT' ORDER BY rule_key;
--
-- 3) Component coverage as it accumulates:
-- SELECT components_with_data, count(*) FROM confidence_band_components
--  GROUP BY 1 ORDER BY 1;
