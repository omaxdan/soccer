-- =============================================================================
-- 020_null_distinct_identities.rollback.sql
-- Reverts migration 020, restoring the DEFAULT NULLS DISTINCT comparison.
-- Depends: 020 applied  |  Transactional
--
-- ⚠ WHAT ROLLING BACK RESTORES
--
-- It restores finding S5-5. After this script runs:
--
--   - feature.feature_value's business identity cannot detect a duplicate;
--   - module.module_reading's cannot either;
--   - ON CONFLICT ON CONSTRAINT ... DO NOTHING silently matches nothing;
--   - every S-5 replay appends a complete duplicate set, permanently, because
--     the relation is append-only and no pipeline role holds DELETE.
--
-- This script exists because a migration without a tested reverse is not
-- reversible, not because rolling back is advisable.
--
-- ⚠ IT WILL FAIL IF DUPLICATES EXIST — AND THAT IS CORRECT
--
-- NULLS DISTINCT is strictly WEAKER than NULLS NOT DISTINCT: every pair the old
-- comparison rejects, the new one also rejects. So re-adding the weaker
-- constraint over data accepted under the stronger one always succeeds.
--
-- The reverse is not true, which is why REAPPLYING 020 after data has
-- accumulated may fail on duplicates the weak comparison allowed in. The
-- verification section below reports them rather than deleting anything: no role
-- in this design may delete calculated content outside the retention path, and
-- resolving genuine duplicates is a governed operation, not a migration's.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  present text[];
BEGIN
  SELECT array_agg(conname ORDER BY conname) INTO present
    FROM pg_constraint
   WHERE contype = 'u'
     AND conname IN (
       'uq_feature_value__subject_context_definition_asof_version',
       'uq_module_reading__subject_context_definition_asof_version',
       'uq_watchlist__user_entity',
       'uq_provider_statistic__subject_affiliation_edition_domain',
       'uq_calibration_series__identity',
       'uq_p_team_state__team_context_feature',
       'uq_user_preference__user_domain_competition'
     )
     AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%';

  IF present IS NULL THEN
    RAISE EXCEPTION
      'migration 020 does not appear to be applied; nothing to roll back';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Restore the default comparison, constraint by constraint
-- -----------------------------------------------------------------------------
-- Column lists and the INCLUDE list are reproduced exactly as migrations 007,
-- 008, 011, 004 and 009 defined them. Only the NULLS NOT DISTINCT clause is
-- removed.

ALTER TABLE feature.feature_value
  DROP CONSTRAINT uq_feature_value__subject_context_definition_asof_version;
ALTER TABLE feature.feature_value
  ADD CONSTRAINT uq_feature_value__subject_context_definition_asof_version
  UNIQUE (subject_kind_code, subject_team_id, subject_player_id,
          subject_fixture_id, subject_fixture_partition_on,
          subject_competition_edition_id,
          context_kind_code, context_competition_edition_id,
          feature_definition_id, as_of, feature_version_id)
  INCLUDE (value, provenance_class_code, sample_observation_count,
           sample_meets_threshold, feature_version_id);

ALTER TABLE module.module_reading
  DROP CONSTRAINT uq_module_reading__subject_context_definition_asof_version;
ALTER TABLE module.module_reading
  ADD CONSTRAINT uq_module_reading__subject_context_definition_asof_version
  UNIQUE (subject_kind_code, subject_team_id, subject_player_id,
          subject_fixture_id, subject_fixture_partition_on,
          subject_competition_edition_id,
          context_kind_code, context_competition_edition_id,
          module_definition_id, as_of, module_version_id);

ALTER TABLE product.watchlist
  DROP CONSTRAINT uq_watchlist__user_entity;
ALTER TABLE product.watchlist
  ADD CONSTRAINT uq_watchlist__user_entity
  UNIQUE (user_id, entity_kind, team_id, fixture_id, fixture_partition_on, competition_id);

ALTER TABLE football.provider_statistic
  DROP CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain;
ALTER TABLE football.provider_statistic
  ADD CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain
  UNIQUE (subject_kind_code, player_id, team_id, affiliation_team_id,
          competition_edition_id, statistics_domain_code, provider_code);

ALTER TABLE calibration.calibration_series
  DROP CONSTRAINT uq_calibration_series__identity;
ALTER TABLE calibration.calibration_series
  ADD CONSTRAINT uq_calibration_series__identity
  UNIQUE (module_version_id, band_code, outcome_dimension_code,
          context_kind_code, context_competition_id, snapshot_point_code);

ALTER TABLE product.p_team_state
  DROP CONSTRAINT uq_p_team_state__team_context_feature;
ALTER TABLE product.p_team_state
  ADD CONSTRAINT uq_p_team_state__team_context_feature
  UNIQUE (team_id, context_kind_code, competition_edition_id, feature_key);

ALTER TABLE product.user_preference
  DROP CONSTRAINT uq_user_preference__user_domain_competition;
ALTER TABLE product.user_preference
  ADD CONSTRAINT uq_user_preference__user_domain_competition
  UNIQUE (user_id, preference_domain, competition_id);

-- The Class B constraints on football.venue and football.official were never
-- changed by 020, so there is nothing to restore. Their comments are reset to
-- avoid leaving a reference to a migration that is no longer applied.
COMMENT ON CONSTRAINT uq_venue__provider_external_id ON football.venue IS NULL;
COMMENT ON CONSTRAINT uq_official__provider_external_id ON football.official IS NULL;

-- -----------------------------------------------------------------------------
-- Confirm the reversal
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  remaining text[];
BEGIN
  SELECT array_agg(conname ORDER BY conname) INTO remaining
    FROM pg_constraint
   WHERE contype = 'u'
     AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%';
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'rollback incomplete; still NULLS NOT DISTINCT: %', remaining;
  END IF;
END
$$;

COMMIT;

-- =============================================================================
-- BEFORE RE-APPLYING 020, CHECK FOR DUPLICATES THAT ACCUMULATED WHILE REVERTED
--
-- Read-only. Reports the logical identities holding more than one row; the
-- ADD CONSTRAINT in 020 will fail on exactly these.
--
--   SELECT subject_kind_code, subject_team_id, subject_player_id,
--          subject_fixture_id, subject_fixture_partition_on,
--          subject_competition_edition_id, context_kind_code,
--          context_competition_edition_id, feature_definition_id,
--          as_of, feature_version_id, count(*) AS copies
--     FROM feature.feature_value
--    GROUP BY 1,2,3,4,5,6,7,8,9,10,11
--   HAVING count(*) > 1
--    ORDER BY copies DESC;
--
-- Resolving them is a governed operation under the retention role, not
-- something a migration may do: only pt_retention holds DELETE on thinnable
-- content, and only under the pitchterminal.retention_operation session marker.
-- =============================================================================
