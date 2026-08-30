-- =============================================================================
-- 032_travel_impact_rationale_amendment.sql
-- PitchTerminal V2 — the D-2 rationale amendment for travel_impact (S-6)
-- =============================================================================
-- Source of truth : docs/db-v2/56 (D-2 governed; D-4 permitted; C-2/C-3 —
--                   status is the module's own characterisation, no orientation
--                   column), 57 (D-4a: a per-side input is TWO declared inputs),
--                   70/71 (module #5 cites team.travel_distance, NOT the legacy
--                   team.travel_impact feature; the outcome baseline is S-9/FUTURE),
--                   and the S-6 owner authorization (Decisions 1-3: input =
--                   team.travel_distance; orientation = away − home; categorical
--                   1.0.0 with strength/confidence/baseline NULL).
-- Depends on      : 008 (module_version), 023 (minimum_sample_observation_count),
--                   027/029 (the two prior FIXTURE-module amendments; same shape)
-- Transactional   : yes
--
-- Purpose
--   `travel_impact` is the third FIXTURE-subject comparison module and its rule
--   now exists in code (module/calculators/travelImpact.ts). Under D-2 (doc 56) a
--   version's rule lives in code and its rationale STATES that rule; the seeded
--   1.0.0 rationale still carries the pre-D-2 template ("Carries forward the V1
--   module 'travel' ... ported in S-6"), which is now false. This amends exactly
--   that one row, before its first reading, in its own implementation gate.
--
-- Why a migration, and why not a new version
--   UPDATE on module.module_version is held only by pt_owner; no pipeline or seed
--   role can amend it. A new version would be wrong: 1.0.0 has attributed zero
--   readings for this module, so there is nothing to preserve and no rule ever
--   changed — this corrects a description (doc 56; the 024/027/029 precedent).
--
-- Safety
--   Data-only. No schema object is created or altered. Exactly one row in
--   module_version changes; every other relation is left unchanged. The DO block
--   asserts exactly one row updated and raises otherwise. The rationale text is
--   BYTE-IDENTICAL to seed/moduleRegistry.ts (travel_impact versionRationale), so
--   a fresh seed and a migrated database converge on the same value.
-- =============================================================================

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE module.module_version mv
     SET rationale =
       '1.0.0. Status rule (D-2, stated here): gap = away.travel_distance - home.travel_distance (km); '
       || 'SUPPORTS when gap > 0 (away travelled farther, favouring home), CONTRADICTS when gap < 0 (home '
       || 'travelled farther), NEUTRAL when gap = 0 - the module’s own characterisation (doc 56 C-2); the '
       || 'favoured side is carried in verdict_text, with no orientation column (doc 56 C-3). The sign is '
       || 'INVERTED relative to rest_advantage because more travel is a disadvantage. A SIGNED COMPARISON, '
       || 'deliberately NOT a V1 band/selection rule: LC-71 bars a selection, and magnitude significance is '
       || 'an S-9 calibration concern rather than a fabricated threshold. FIXTURE-subject (D-4), consuming '
       || 'team.travel_distance for BOTH teams - NOT the separate team.travel_impact feature (Decision 1; '
       || 'docs 70/71); a per-side input is two declared inputs (D-4a), so declared_input_count = 2. Threshold '
       || 'minimum_sample_observation_count = 0. Observation-count rule: sample_observation_count = MIN(consumed) '
       || 'across both sides (D-5c-i). strength, confidence and published_baseline_id are NULL at 1.0.0 '
       || '(D-5a/D-5b); the OUTCOME_SCORED outcome baseline (doc 71) is an S-9 concern and remains FUTURE.'
    FROM module.module_definition d
   WHERE d.id = mv.module_definition_id
     AND d.module_key = 'travel_impact'
     AND mv.designation = '1.0.0';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 032: expected exactly 1 travel_impact 1.0.0 row, updated %', n;
  END IF;
END
$$;
