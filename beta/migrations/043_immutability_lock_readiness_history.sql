-- ─── MIGRATION 043 — Immutability lock recognizes readiness_history too ─────
--
-- CREATE OR REPLACE, not a drop/recreate of the trigger itself — 042's
-- trigger stays attached; only the guard function's body changes. Same
-- discipline as never editing an already-applied migration file: this adds a
-- new one rather than rewriting 042.
--
-- WHAT CHANGED, AND WHY NOT A NEW COLUMN
-- The review's suggestion was a dedicated column — historical_locked or
-- snapshot_finalized_at — reasoning that matches.status is an external
-- signal that can be corrected, and a fixture can be postponed and
-- rescheduled under the same status vocabulary. That reasoning is right. The
-- literal column wasn't added, because this schema already has the exact
-- signal being asked for: readiness_history.result_linked_at, set exactly
-- once by linkReadinessResults() (jobs/archiveReadinessHistory.ts), by a
-- process this codebase owns end to end — not a passthrough from an external
-- provider. "This match's historical record has been finalized" is precisely
-- what a non-null result_linked_at already means.
--
-- The lock is now: protect if EITHER matches.status != 'scheduled' OR a
-- readiness_history row exists with result_linked_at set. Not a replacement
-- of one signal with the other — an OR, not a swap. Narrowing to
-- result_linked_at alone would have REMOVED protection for a genuine,
-- expected case this whole fix already accounts for: a match that finished
-- but was never snapshotted (the "pre-match record not available" case the
-- frontend explicitly handles). Both signals stay; either is sufficient.

CREATE OR REPLACE FUNCTION public.guard_match_intelligence_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_result_linked boolean;
BEGIN
  SELECT status INTO v_status FROM public.matches WHERE id = NEW.match_id;
  SELECT EXISTS (
    SELECT 1 FROM public.readiness_history
     WHERE match_id = NEW.match_id AND result_linked_at IS NOT NULL
  ) INTO v_result_linked;

  -- Neither signal says this match is finalized: nothing to protect.
  IF (v_status IS NULL OR v_status = 'scheduled') AND NOT v_result_linked THEN
    RETURN NEW;
  END IF;

  IF NEW.confidence_score      IS DISTINCT FROM OLD.confidence_score
     OR NEW.confidence_band      IS DISTINCT FROM OLD.confidence_band
     OR NEW.readiness_gap        IS DISTINCT FROM OLD.readiness_gap
     OR NEW.home_readiness       IS DISTINCT FROM OLD.home_readiness
     OR NEW.away_readiness       IS DISTINCT FROM OLD.away_readiness
     OR NEW.predicted_home_goals IS DISTINCT FROM OLD.predicted_home_goals
     OR NEW.predicted_away_goals IS DISTINCT FROM OLD.predicted_away_goals
     OR NEW.win_probability_home IS DISTINCT FROM OLD.win_probability_home
     OR NEW.win_probability_draw IS DISTINCT FROM OLD.win_probability_draw
     OR NEW.win_probability_away IS DISTINCT FROM OLD.win_probability_away
     OR NEW.net_battle_index     IS DISTINCT FROM OLD.net_battle_index
     OR NEW.home_xi_strength     IS DISTINCT FROM OLD.home_xi_strength
     OR NEW.away_xi_strength     IS DISTINCT FROM OLD.away_xi_strength
  THEN
    RAISE EXCEPTION
      'MATCH_INTELLIGENCE_IMMUTABILITY_VIOLATION: match % is finalized (status=''%'', result_linked=%) — historical intelligence fields cannot be rewritten. This is a logic error in whatever wrote this row.',
      NEW.match_id, v_status, v_result_linked;
  END IF;

  RETURN NEW;
END;
$$;

-- The 042 trigger definition (BEFORE UPDATE, FOR EACH ROW) is untouched —
-- CREATE OR REPLACE FUNCTION above is sufficient; a trigger bound to a
-- function by name picks up the new body automatically, no re-binding needed.

COMMENT ON FUNCTION public.guard_match_intelligence_immutability() IS
  'Rejects any UPDATE (including upsert-as-update) to a finalized match''s historical intelligence columns. Finalized = status != ''scheduled'' OR readiness_history.result_linked_at is set for this match — either signal is sufficient, matching the codebase''s two independent notions of "this match is over": the external provider''s status field, and this system''s own archival linkage. The exception message is tagged MATCH_INTELLIGENCE_IMMUTABILITY_VIOLATION specifically so calling code can catch and count it (see jobs/processDbOnly.ts) without string-matching a message that might be edited later.';

-- ── Rollback ────────────────────────────────────────────────────────────────
--   -- Restores 042's original body (status-only check):
--   CREATE OR REPLACE FUNCTION public.guard_match_intelligence_immutability()
--   RETURNS trigger LANGUAGE plpgsql AS $$ ... $$;  -- see migration 042
