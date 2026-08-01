-- ─── MIGRATION 042 — match_intelligence immutability trigger ────────────────
--
-- The application-level fix (jobs/processDbOnly.ts's status filter, plus a
-- second race-condition guard added in the same change) stops the CURRENT
-- code from rewriting a finished match's historical intelligence. This
-- migration is the guard that survives every future processor someone writes
-- without remembering that rule — the same pattern already proven in this
-- schema for a different invariant: guard_profile_self_update()
-- (migration 038) blocks a non-admin from writing their own role column;
-- this blocks anyone from rewriting a finished match's historical fields.
--
-- WHY "status IS DISTINCT FROM 'scheduled'", NOT "status = 'finished'"
-- matches.status is a raw passthrough from the external sports data provider
-- (see jobs/syncDateMasterFeed.ts) — this codebase does not control or fully
-- enumerate its vocabulary. Every processor that already correctly scopes
-- itself (processScorelinePredictions, processStartingXIStrength,
-- processNetBattleIndex) filters POSITIVELY toward 'scheduled', not
-- negatively away from a specific "it's over" value. This trigger mirrors
-- that exact posture: protect whenever the match is not explicitly still
-- scheduled, rather than trying to name every status that means "it's over"
-- and risk missing one (live, postponed-then-resumed, whatever the provider
-- calls a state this codebase has never seen).
--
-- WHAT'S PROTECTED, AND WHAT ISN'T
-- Only the columns that represent the actual historical claim — the ones the
-- four match_intelligence writers set. calculated_at/updated_at/match_date
-- are NOT guarded: those are bookkeeping, not intelligence, and a legitimate
-- future need (backfilling match_date after a schema correction, say) should
-- not be blocked by a trigger meant to protect predictions and confidence.

CREATE OR REPLACE FUNCTION public.guard_match_intelligence_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.matches WHERE id = NEW.match_id;

  -- No matching match row, or still scheduled: nothing to protect.
  IF v_status IS NULL OR v_status = 'scheduled' THEN
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
      'match_intelligence immutability violation: match % has status ''%'' (not scheduled) — historical intelligence fields cannot be rewritten. This is a logic error in whatever wrote this row, not a condition to work around.',
      NEW.match_id, v_status;
  END IF;

  RETURN NEW;
END;
$$;

-- ON CONFLICT DO UPDATE (what every writer here calls upsert) fires the
-- ordinary BEFORE UPDATE trigger for the conflict path — this guards upserts
-- exactly as it guards a plain UPDATE, which is the write pattern the actual
-- bug used.
DROP TRIGGER IF EXISTS match_intelligence_immutability ON public.match_intelligence;
CREATE TRIGGER match_intelligence_immutability
  BEFORE UPDATE ON public.match_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.guard_match_intelligence_immutability();

COMMENT ON FUNCTION public.guard_match_intelligence_immutability() IS
  'Rejects any UPDATE (including upsert-as-update) that would change a non-scheduled match''s historical intelligence columns. Raises rather than silently succeeding — see the Historical Integrity fix, migration commit eb430bd, and this migration''s header comment for the incident this exists to prevent from recurring.';

-- ── Verification, once applied ────────────────────────────────────────────
--   -- Should raise the exception above:
--   UPDATE match_intelligence SET confidence_score = 1
--    WHERE match_id = (SELECT id FROM matches WHERE status != 'scheduled' LIMIT 1);
--
--   -- Should succeed (bookkeeping column, not guarded):
--   UPDATE match_intelligence SET updated_at = now()
--    WHERE match_id = (SELECT id FROM matches WHERE status != 'scheduled' LIMIT 1);

-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS match_intelligence_immutability ON public.match_intelligence;
--   DROP FUNCTION IF EXISTS public.guard_match_intelligence_immutability();
