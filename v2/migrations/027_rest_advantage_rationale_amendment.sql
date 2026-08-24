-- =============================================================================
-- 027_rest_advantage_rationale_amendment.sql
-- PitchTerminal V2 — the D-2 rationale amendment for rest_advantage (S-6.x)
-- =============================================================================
-- Source of truth : docs/db-v2/56 (D-2 governed; D-4 permitted; C-2/C-3 —
--                   status is the module's own characterisation, no orientation
--                   column), 57 (D-4a: a per-side input is TWO declared inputs),
--                   and the S-6.x implementation gate (rule = signed comparison,
--                   NOT the V1 evalRest 4-day/pickSide rule).
-- Depends on      : 008 (module_version), 023 (minimum_sample_observation_count)
-- Transactional   : yes
--
-- Purpose
--   `rest_advantage` is the first FIXTURE-subject comparison module and its rule
--   now exists in code (module/calculators/restAdvantage.ts). Under D-2 (doc 56)
--   a version's rule lives in code and its rationale STATES that rule; the seeded
--   1.0.0 rationale still carries the pre-D-2 template ("Carries forward the V1
--   module 'rest' ... ported in S-6"), which is now false. This amends exactly
--   that one row, before its first reading, in its own implementation gate
--   (doc 82: the active-but-unimplemented rows are amended per module).
--
-- Why a migration, and why not a new version
--   UPDATE on module.module_version is held only by pt_owner; no pipeline or seed
--   role can amend it. A new version would be wrong: 1.0.0 has attributed zero
--   readings for this module, so there is nothing to preserve and no rule ever
--   changed — this corrects a description (doc 56; the 024 precedent).
--
-- Safety
--   Data-only. No schema object is created or altered. Exactly one row in
--   module_version changes; every other relation is left unchanged. The DO block
--   asserts exactly one row updated and raises otherwise. The rationale text is
--   BYTE-IDENTICAL to seed/moduleRegistry.ts (rest_advantage versionRationale),
--   so a fresh seed and a migrated database converge on the same value.
-- =============================================================================

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE module.module_version mv
     SET rationale =
       '1.0.0. Status rule (D-2, stated here): gap = home.rest_advantage - away.rest_advantage (days); '
       || 'SUPPORTS when gap > 0 (home fresher), CONTRADICTS when gap < 0 (away fresher), NEUTRAL when '
       || 'gap = 0 - the module’s own characterisation (doc 56 C-2); the favoured side is carried in '
       || 'verdict_text, with no orientation column (doc 56 C-3). A SIGNED COMPARISON, deliberately NOT the '
       || 'V1 evalRest rule: V1’s 4-day band and pickSide selection are not reproduced - LC-71 bars a '
       || 'selection, and magnitude significance is an S-9 calibration concern, not a fabricated threshold. '
       || 'FIXTURE-subject, consuming team.rest_advantage for BOTH teams (D-4); a per-side input is two '
       || 'declared inputs (D-4a), so declared_input_count = 2. Threshold minimum_sample_observation_count '
       || '= 0. Observation-count rule: sample_observation_count = MIN(consumed) across both sides (D-5c-i); '
       || 'team.rest_advantage carries a fixed count of 1, so a valid reading rests on 1. strength, '
       || 'confidence and published_baseline_id are NULL at 1.0.0 (D-5a/D-5b; S-9 out of scope).'
    FROM module.module_definition d
   WHERE d.id = mv.module_definition_id
     AND d.module_key = 'rest_advantage'
     AND mv.designation = '1.0.0';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 027: expected exactly 1 rest_advantage 1.0.0 row, updated %', n;
  END IF;
END
$$;
