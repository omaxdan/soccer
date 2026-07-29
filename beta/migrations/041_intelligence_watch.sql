-- ─── MIGRATION 041 — Intelligence change detection: the snapshot table ──────
--
-- Schema only. Nothing writes to this table yet — see the note at the bottom
-- for exactly what remains before alerts can fire.
--
-- WHY A NEW TABLE, GIVEN THE STRONG PREFERENCE AGAINST ONE
-- readiness_history was checked first and is the wrong tool: it is write-once,
-- pre-kickoff, immutable by design (migration 019's whole point). Detecting
-- "confidence band moved from Moderate to Strong between Tuesday's recompute
-- and today's" for a match that has NOT kicked off yet needs a row that gets
-- UPDATED on every recompute, holding the last-seen values — the opposite
-- lifecycle from readiness_history. notifications (migration 035) stores an
-- alert once one is detected; it cannot also be the thing a detector diffs
-- against, since it only exists after a change has already been decided.
-- There is no existing table with the right lifecycle for this, checked
-- before proposing a new one.

CREATE TABLE IF NOT EXISTS public.match_intelligence_watch (
  match_id bigint NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  confidence_band text,
  confidence_score numeric,
  readiness_gap numeric,
  home_xg numeric,
  away_xg numeric,
  win_probability numeric,
  module_consensus text,
  evidence_count integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_intelligence_watch_pkey PRIMARY KEY (match_id)
);

-- Read by whatever job ends up detecting changes; not queried by the public
-- product, so no broad SELECT grant.
ALTER TABLE public.match_intelligence_watch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS miw_admin_only ON public.match_intelligence_watch;
CREATE POLICY miw_admin_only ON public.match_intelligence_watch FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

COMMENT ON TABLE public.match_intelligence_watch IS
  'Last-seen intelligence values per not-yet-played match, upserted on every recompute so the NEXT recompute can diff against it. One row per match; overwritten in place, unlike readiness_history which is never overwritten. Feeds the notifications table (035) once a detector job compares new values against this table and writes an alert for a meaningful change.';

-- ── What is NOT done here, and why ──────────────────────────────────────────
-- 1. THE WRITER JOB. This needs to run as part of whatever job currently
--    recomputes match_intelligence for upcoming matches. I traced this as far
--    as beta/backend/src/jobs/processDbOnly.ts, which orchestrates
--    intelligence work, but did not conclusively locate the single upsert
--    call site for match_intelligence within this pass — worth one more
--    targeted read of that file (and whatever it delegates to) before wiring
--    a comparison in. Saying so plainly rather than guessing at a hook point
--    and writing to it unverified.
-- 2. THE THRESHOLDS. "Moderate -> Strong" is unambiguous; "confidence changed
--    significantly" is not, until a number is chosen. This is a real product
--    decision, not an engineering one — proposed thresholds, not committed:
--      confidence_band:    any change at all (five discrete values; every
--                           transition is meaningful by construction)
--      confidence_score:   |delta| >= 8 (roughly one band-width of movement
--                           without necessarily crossing a boundary)
--      win_probability:    |delta| >= 10 percentage points
--      readiness_gap:      |delta| >= 5
--      module_consensus:   any change in the STRONG/MODERATE/WEAK/NEUTRAL
--                           label (tally()/overallVerdict() output)
--      evidence_count:     any change (a module going active/inactive is
--                           itself the signal, magnitude doesn't apply)
--    These should be reviewed, not assumed correct, before the writer job
--    uses them.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP POLICY IF EXISTS miw_admin_only ON public.match_intelligence_watch;
--   DROP TABLE IF EXISTS public.match_intelligence_watch;
