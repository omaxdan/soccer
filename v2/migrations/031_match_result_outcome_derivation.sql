-- =============================================================================
-- 031_match_result_outcome_derivation.sql
-- PitchTerminal V2 — MATCH_RESULT/1.0.0 outcome derivation + calibration read grant
-- =============================================================================
-- Source of truth : S-9A ratification (FULLY RATIFIED) —
--                   A1: home_goals > away_goals → HOME_WIN; = → DRAW; < → AWAY_WIN
--                   A2: authoritative score = regulation/full-time home_goals/away_goals
--                       (AET/penalties belong to a FUTURE derivation version)
--                   A5: the derivation version is resolved at outcome-link creation
--                       and pinned on the link; no retroactive re-score.
--                   D2/D6: the calibration/accrual corpus is the governed TRACKED
--                       competition universe; synthetic/test fixtures are excluded.
-- Depends on      : 003 (outcome_derivation_version), 010 (snapshot_outcome_link),
--                   025 (governance.tracked_competition/tracked_edition), 016 (grants)
-- Transactional   : yes
--
-- Purpose (S-9B substrate — accrual, NOT calibration)
--   Two things the ratified S-9B accrual substrate needs and the schema does not
--   yet contain:
--     1. The governed MATCH_RESULT/1.0.0 outcome-derivation rule row. Without it,
--        snapshot_outcome_link (FK NOT NULL to outcome_derivation_version) cannot
--        be created. E7.04: deriving a dimension from a result IS a rule; this
--        registers it, versioned, so a later AET/penalty rule is a NEW version and
--        never a silent restatement.
--     2. A minimal READ grant so the outcome-accrual writer (pt_pipeline_calibration)
--        can honor the D2/D6 tracked-universe boundary — i.e. attach outcomes only
--        to REAL tracked fixtures and never to synthetic/test fixtures. The writer
--        already holds INSERT on snapshot_outcome_link(_currency) (migration 016);
--        it only lacks visibility of the governance authorization tables.
--
--   This migration performs NO calibration, NO hit-rate, NO confidence, NO risk,
--   NO reliability, and creates no S-9C/S-9D structures.
--
-- Idempotency / safety
--   Data + grant only. No schema object is created or altered. The version INSERT
--   is guarded so a re-run is a no-op once MATCH_RESULT/1.0.0 exists. GRANTs are
--   idempotent. Existing constraints, RLS, and immutability are untouched.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM calibration.outcome_derivation_version
     WHERE outcome_dimension_code = 'MATCH_RESULT' AND designation = '1.0.0'
  ) THEN
    INSERT INTO calibration.outcome_derivation_version
      (outcome_dimension_code, designation, effective_period, predecessor_id, rationale)
    VALUES (
      'MATCH_RESULT',
      '1.0.0',
      tstzrange(now(), NULL, '[)'),
      NULL,
      'MATCH_RESULT/1.0.0 (S-9A A1/A2). Derives the match result from the prevailing '
      || 'football.result using REGULATION/FULL-TIME goals only: home_goals > away_goals '
      || '→ HOME_WIN; home_goals = away_goals → DRAW; home_goals < away_goals → AWAY_WIN. '
      || 'Extra-time goals and penalty-shootout results are NOT used by this version; any '
      || 'AET/penalty-aware treatment is a FUTURE derivation version, never a silent change '
      || 'to 1.0.0. Only COMPLETED fixtures produce an outcome (A3). The applicable derivation '
      || 'version is resolved at outcome-link creation and pinned on the link (A5); a later '
      || 'version never retroactively re-scores an existing link. Deriving a dimension from a '
      || 'result is itself a governed rule (E7.04).'
    );
  END IF;
END
$$;

-- Minimal read access: the outcome-accrual writer must see the governed tracked
-- universe to exclude synthetic/test fixtures (D2/D6). Governance tables FORCE RLS
-- (migration 025), so a bare GRANT would be uncovered and fail the security-posture
-- invariant (every granted privilege must have a covering policy). Use the governed
-- helper operations.fn_apply_access, which grants SELECT AND creates the covering
-- read policy together (PR-02 ordering), exactly as migration 025 grants ingestion
-- its read. Idempotent (DROP POLICY IF EXISTS + re-grant). Read-only ('S'); the
-- writer never mutates governance.
GRANT USAGE ON SCHEMA governance TO pt_pipeline_calibration;
SELECT operations.fn_apply_access('governance', 'tracked_competition', 'pt_pipeline_calibration', 'S');
SELECT operations.fn_apply_access('governance', 'tracked_edition',     'pt_pipeline_calibration', 'S');
