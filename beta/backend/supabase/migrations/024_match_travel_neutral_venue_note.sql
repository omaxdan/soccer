-- ─── MIGRATION 024 — Neutral-venue note on match_travel_intelligence ─────────
-- processMatchTravelIntelligence (src/jobs/processDbOnly.ts) previously
-- assigned travel_advantage_team_id to whichever team traveled less, even
-- when NEITHER team was at their own stadium (cup finals, derbies played at
-- a neutral ground, etc.) — a misleading "advantage" for a match where both
-- teams travelled. The fix nulls out travel_advantage_team_id in that case
-- and records why via this new column; the raw distance columns are
-- unaffected.

ALTER TABLE match_travel_intelligence
    ADD COLUMN IF NOT EXISTS travel_advantage_note TEXT;
