-- ─── MIGRATION 016 — Match Confidence Score ─────────────────────────────────
-- Adds a precomputed confidence score to match_intelligence: how strongly
-- the independent evidence streams (readiness, strength, injuries,
-- congestion, travel, stability, venue, motivation) AGREE on the side the
-- readiness gap already picks. A big readiness gap with every other signal
-- pointing the same way = high confidence; a big gap contradicted by
-- strength/injuries/venue = low confidence.
--
-- Computed by processMatchIntelligencePartial (backend, zero API calls) —
-- never at frontend runtime, per this project's core principle.
--
-- Bands (per product spec):
--   95-100 Elite | 85-94 Strong | 70-84 Moderate | 55-69 Risky | <55 Avoid

ALTER TABLE public.match_intelligence
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_band text;
