-- =============================================================================
-- 024_module_version_rationale_amendment.sql
-- PitchTerminal V2 — the D-2 rationale amendment, for the two implemented modules
-- =============================================================================
-- Source of truth : docs/db-v2/56 (D-2 RECORDED AS GOVERNED), 57, 58 §4-5
--                   (rationale states status + threshold + count rule; the
--                   "never edited" reconciliation), and 82 (D-2 Rationale
--                   Governance Gate — RATIFIED, scope = the two implemented
--                   modules, exact facts per module).
-- Depends on      : 008 (module_version), 023 (minimum_sample_observation_count)
-- Transactional   : yes
--
-- Purpose
--   Amends module_version.rationale for exactly the two 1.0.0 versions whose
--   status rule now exists in code and will govern readings:
--
--     home_away_split   1.0.0
--     readiness_tracker 1.0.0
--
--   Under D-2 (doc 56) a module version's rule lives in code and its rationale
--   STATES that rule; doc 58 §4 refines that to status + threshold + count rule.
--   The thirteen seeded 1.0.0 rationales still carry the pre-D-2 wording
--   ("Carries forward the V1 module ... the evaluation logic is ported in S-6"),
--   which for these two is now false: their rule is implemented (Gate D
--   home_away_split; Gate E-iii readiness_tracker), so it must be stated, and
--   readings are imminent. Doc 82 ratified this and fixed the scope to these two.
--
-- Why ONLY these two, and no other version
--   Doc 82 §4/§6: the other eleven produce no reading (a module is produced only
--   when registered active AND listed in MODULE_CALCULATORS; only these two are).
--   The seven active-but-unimplemented rows are pending-not-false and are amended
--   in each module's own implementation gate; the four inactive rows are already
--   accurate ("no evaluation logic exists"). None of the eleven is touched here.
--
-- Why a migration, and why not a new version
--   UPDATE on module.module_version is held only by pt_owner (verified); no
--   pipeline or seed role can amend it. A new version would be wrong: 1.0.0 has
--   attributed zero readings (module_reading holds 0 rows), so there is nothing
--   to preserve and no rule ever changed — this corrects a description, it does
--   not supersede a rule (doc 56; doc 58 §4 "never edited" reconciliation: the
--   rationale is in no identity and no FK, and protects attributed values, of
--   which there are none).
--
-- Safety
--   Data-only. No schema object is created or altered. No column, no table, no
--   constraint, no trigger. module_reading is not touched. Exactly two rows in
--   module_version change; the other eleven, and every other relation, are left
--   byte-for-byte unchanged. The DO block asserts exactly one row updated per
--   module and raises otherwise, so a miss (renamed key, missing version) fails
--   the migration rather than passing silently.
--
--   The rationale text below is BYTE-IDENTICAL to seed/moduleRegistry.ts
--   (versionRationale for these two modules), so a fresh seed and a migrated
--   database converge on the same value.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Precondition (advisory): the amendment is meant to precede the first reading.
-- 0 rows is the expected state; a non-zero count is reported, not blocked — the
-- new text is the accurate description either way (doc 58 §4).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  readings bigint;
BEGIN
  SELECT count(*) INTO readings FROM module.module_reading;
  IF readings > 0 THEN
    RAISE NOTICE
      'module.module_reading holds % rows; the D-2 amendment corrects the version description they are attributed to (doc 56 timing was "before the first reading", doc 82).',
      readings;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- The two amendments, each asserted to hit exactly one row.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
BEGIN
  -- home_away_split 1.0.0 — a rule TRANSCRIPTION, not a literal V1 port (its
  -- inputs supersede the V1 venue population, doc 76).
  UPDATE module.module_version mv
     SET rationale =
       '1.0.0. Status rule (D-2, stated here): disparity = home_win_rate - away_win_rate; '
       || 'SUPPORTS when |disparity| >= 40, otherwise NEUTRAL — orientation-free, transcribed '
       || 'from the V1 evalHomeAway rule (docs/db-v2/78, 79). A rule transcription, NOT a literal '
       || 'V1 port: the inputs team.home_win_rate and team.away_win_rate are edition-cumulative and '
       || 'COMPETITION_SCOPED, deliberately superseding the V1 lifetime all-competition venue '
       || 'population (docs/db-v2/76). Threshold minimum_sample_observation_count = 0 (no gate). '
       || 'Observation-count rule: sample_observation_count = MIN(consumed); the non-composite '
       || 'inputs pass their own counts through (D-5c-i). strength, confidence and '
       || 'published_baseline_id are NULL at 1.0.0 (D-5a/D-5b; S-9 out of scope).'
    FROM module.module_definition d
   WHERE d.id = mv.module_definition_id
     AND d.module_key = 'home_away_split'
     AND mv.designation = '1.0.0';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 024: expected exactly 1 home_away_split 1.0.0 row, updated %', n;
  END IF;

  -- readiness_tracker 1.0.0 — the numeric classifyTrend thresholds transcribed;
  -- the defective V1 formatted-string evaluator is NOT reproduced (doc 79 §2).
  UPDATE module.module_version mv
     SET rationale =
       '1.0.0. Status rule (D-2, stated here): on team.momentum = last5Points - prior5Points, '
       || 'classify >= +10 as SURGING, <= -10 as CRASHING, otherwise STABLE, and map '
       || 'SURGING -> SUPPORTS, CRASHING -> CONTRADICTS, STABLE -> NEUTRAL — the numeric V1 '
       || 'classifyTrend thresholds, transcribed (docs/db-v2/79, 81). The defective V1 '
       || 'evalReadinessTracker, which compares a formatted string against a bare label and so '
       || 'always yields neutral, is deliberately NOT reproduced. Threshold '
       || 'minimum_sample_observation_count = 0. Observation-count rule: '
       || 'sample_observation_count = MIN(consumed) — for this single non-composite input, the '
       || 'team.momentum count (10 for a valid momentum) passes through (D-5c-i). strength, '
       || 'confidence and published_baseline_id are NULL at 1.0.0 (D-5a/D-5b; S-9 out of scope).'
    FROM module.module_definition d
   WHERE d.id = mv.module_definition_id
     AND d.module_key = 'readiness_tracker'
     AND mv.designation = '1.0.0';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 024: expected exactly 1 readiness_tracker 1.0.0 row, updated %', n;
  END IF;
END
$$;
