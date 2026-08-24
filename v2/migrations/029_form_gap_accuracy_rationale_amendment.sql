-- =============================================================================
-- 029_form_gap_accuracy_rationale_amendment.sql
-- PitchTerminal V2 — the D-2 rationale amendment for form_gap_accuracy (S-6.x)
-- =============================================================================
-- Source of truth : the S-6.x form_gap_accuracy governance decision (D-2/D-4
--                   gate) — venue-specific pairing (home team's team.home_form
--                   vs away team's team.away_form), home-relative signed gap,
--                   SUPPORTS/CONTRADICTS/NEUTRAL by sign, MIN(consumed) sample,
--                   inherited feature threshold = 5, missing side -> INACTIVE,
--                   and the explicit rejection of V1's bands/pickSide/probability.
--                   Governance basis: docs 56 (D-2 characterisation; D-4
--                   permitted; C-2/C-3 no orientation column), 57 (D-4a per-side
--                   input; D-5c-i observation-count), 79 (the open two-team
--                   composition this closes).
-- Depends on      : 008 (module_version), 023 (minimum_sample_observation_count)
-- Transactional   : yes
--
-- Purpose
--   form_gap_accuracy is the second FIXTURE-subject comparison module. Its
--   two-team composition was previously unresolved (doc 79: "needs a two-team
--   form-gap composition (D-4 territory)"; doc 82: "pending ... amend at
--   implementation"). The governance decision is now recorded, so the seeded
--   1.0.0 rationale — still the pre-D-2 template ("Carries forward the V1 module
--   'form_gap' unchanged ... ported in S-6") — is now false and is amended to
--   STATE the governed rule, before its first reading, in its own gate. No
--   calculator is created here; this records the rule only.
--
-- Why a migration, and why not a new version
--   UPDATE on module.module_version is held only by pt_owner; no pipeline or seed
--   role can amend it. A new version would be wrong: 1.0.0 has attributed zero
--   readings for this module, so there is nothing to preserve and no rule ever
--   changed — this corrects a description (doc 56; the 024/027 precedent).
--
-- Safety
--   Data-only. No schema object is created or altered. Exactly one row in
--   module_version changes; every other relation is left unchanged. The DO block
--   asserts exactly one row updated and raises otherwise. The rationale text is
--   BYTE-IDENTICAL to seed/moduleRegistry.ts (form_gap_accuracy versionRationale),
--   so a fresh seed and a migrated database converge on the same value.
-- =============================================================================

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE module.module_version mv
     SET rationale =
       '1.0.0. Status rule (D-2, stated here): gap = home_team.home_form - away_team.away_form '
       || '(venue-specific form index); SUPPORTS when gap > 0 (home’s venue form stronger), CONTRADICTS '
       || 'when gap < 0 (away’s venue form stronger), NEUTRAL when gap = 0 - the module’s own '
       || 'characterisation (doc 56 C-2); the favoured side is carried in verdict_text, with no '
       || 'orientation column (doc 56 C-3). A SIGNED COMPARISON, deliberately NOT the V1 form_gap rule: '
       || 'V1’s Banker/Strong/Lean/Coin-flip bands and pickSide selection are not reproduced - LC-71 bars '
       || 'a selection, magnitude significance is an S-9 calibration concern rather than a fabricated '
       || 'threshold, and no probability or betting interpretation is made. FIXTURE-subject (D-4), '
       || 'consuming the home team’s team.home_form and the away team’s team.away_form - each club’s '
       || 'venue-appropriate form for THIS fixture, a different question from the Home/Away Split module '
       || '(one team’s own home-vs-away disparity), so the two are not duplicate calculations. The two '
       || 'per-side inputs are two declared inputs (D-4a), so declared_input_count = 2. Threshold: each '
       || 'feature’s own minimum_sample_observation_count = 5 governs sufficiency; no module threshold is '
       || 'fabricated. Observation-count rule: sample_observation_count = MIN(consumed) across both sides '
       || '(D-5c-i). Either side’s form absent makes the reading INACTIVE; no zero substitution and no '
       || 'fabricated value, and a below-threshold value stays below threshold, never silently upgraded. '
       || 'Values are compared at the feature’s declared scale, with no rounding beyond the definition’s. '
       || 'strength, confidence and published_baseline_id are NULL at 1.0.0 (D-5a/D-5b; S-9 out of scope).'
    FROM module.module_definition d
   WHERE d.id = mv.module_definition_id
     AND d.module_key = 'form_gap_accuracy'
     AND mv.designation = '1.0.0';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 029: expected exactly 1 form_gap_accuracy 1.0.0 row, updated %', n;
  END IF;
END
$$;
