-- =============================================================================
-- 020_null_distinct_identities.sql — Business identities that can actually match
-- REVISION 1
-- Source: Phase 8 S-5 finding S5-5 (docs/db-v2/24-phase8-s5-schema-defect.md)
-- Depends: 001-019  |  Transactional
--
-- WHY THIS MIGRATION EXISTS
--
-- Seven composite UNIQUE constraints express a business identity in which one or
-- more key columns are NULL BY DESIGN — and are forced NULL by a CHECK on the
-- same table. PostgreSQL's default for UNIQUE is NULLS DISTINCT: two rows with a
-- NULL anywhere in the key are never equal. Those constraints can therefore
-- never detect a duplicate.
--
-- For feature.feature_value the failure is TOTAL, not partial.
-- ck_feature_value__subject_exclusive requires exactly ONE of the four typed
-- subject columns to be populated, so every row of every subject kind leaves at
-- least three of them NULL. There is no legal combination of column values for
-- which the constraint can fire.
--
-- Proven by execution before this migration was written: the same logical row,
-- inserted twice with ON CONFLICT ON CONSTRAINT ... DO NOTHING, produced two
-- rows.
--
-- THE CONSEQUENCE
--
-- ON CONFLICT has nothing to catch, so S-5's idempotency guarantee is
-- unattainable and every replay appends a complete duplicate set. Because
-- feature_value is append-only and no pipeline role holds DELETE, those
-- duplicates would be permanent and unbounded.
--
-- The application implementation is correct and is NOT CHANGED BY THIS
-- MIGRATION. It already names the constraint in every conflict clause; it simply
-- names a constraint that could not match.
--
-- =============================================================================
-- THE RULE THIS MIGRATION APPLIES, AND WHY IT DOES NOT APPLY EVERYWHERE
--
-- Nine unique constraints in the design contain a nullable column. They fall
-- into two classes with OPPOSITE correct answers, and the distinction is what
-- NULL MEANS in each:
--
--   CLASS A — NULL is a MEANINGFUL VALUE within a composite identity.
--     The column is one dimension of a multi-column identity, and NULL says
--     "this dimension does not apply to this row" — an exclusive-subject
--     discriminator, or an optional scope that is absent for the unscoped case.
--     Two rows that are both unscoped ARE the same row.
--     -> NULLS NOT DISTINCT is REQUIRED. Seven constraints.
--
--   CLASS B — NULL means NO KEY EXISTS.
--     The constraint is a single-column alternate key, and NULL says "this row
--     has no such key". Rows without one are distinct entities that happen to
--     share an absence.
--     -> NULLS DISTINCT IS CORRECT AND IS LEFT ALONE. Two constraints.
--
-- Applying NULLS NOT DISTINCT to Class B would be a REGRESSION, not a fix: it
-- would permit at most ONE venue and ONE official without a provider identifier
-- in the entire system. That is why this migration is a considered list rather
-- than a sweep over pg_constraint.
--
-- =============================================================================
-- PER-CONSTRAINT DECISIONS
--
-- CLASS A — CHANGED (7)
--
--   feature.feature_value
--     uq_feature_value__subject_context_definition_asof_version
--     6 nullable key columns. ck_feature_value__subject_exclusive forces at
--     least 3 NULL on every row; ck_feature_value__context_edition_conditional
--     forces context_competition_edition_id NULL unless COMPETITION_SCOPED.
--     Failure is total. THE PRIMARY SUBJECT OF S5-5.
--     Note the INCLUDE list is preserved exactly — it is the covering payload of
--     REVISION 2 (O-03), which lets one structure enforce identity AND serve the
--     dominant access path (§5.11.1, §5.11.3). Losing it would silently halve
--     the value of the index.
--
--   module.module_reading
--     uq_module_reading__subject_context_definition_asof_version
--     Structurally identical. S-6 has not been implemented, so the defect has
--     not yet been observed there — it is fixed now because the shape is the
--     same and finding it twice would be a waste.
--
--   product.watchlist
--     uq_watchlist__user_entity
--     ck_watchlist__entity_exclusive forces exactly one of team / fixture /
--     competition, so a user could watch the same team any number of times.
--
--   football.provider_statistic
--     uq_provider_statistic__subject_affiliation_edition_domain
--     ck_provider_statistic__subject_exclusive forces player XOR team;
--     affiliation_team_id and competition_edition_id are independently optional.
--     Ingestion would duplicate a statistic on every re-run.
--
--   calibration.calibration_series
--     uq_calibration_series__identity
--     ck_calibration_series__context_competition_conditional is the same
--     conditional-scope shape as feature_value's: context_competition_id is NULL
--     for every series that is not competition-scoped.
--
--   product.p_team_state
--     uq_p_team_state__team_context_feature
--     competition_edition_id is NULL for the all-competitions projection row.
--     A projection that duplicates its unscoped row serves a non-deterministic
--     read.
--
--   product.user_preference
--     uq_user_preference__user_domain_competition
--     competition_id is NULL for a user's global preference in a domain. Two
--     global preferences for one domain makes "the" preference unanswerable.
--
-- CLASS B — DELIBERATELY UNCHANGED (2)
--
--   football.venue    uq_venue__provider_external_id
--   football.official uq_official__provider_external_id
--     Single-column alternate keys. provider_external_id is NULL when the
--     provider supplied no identifier, which is expected for venues and
--     officials that arrive only as a name. Under NULLS NOT DISTINCT the system
--     could hold exactly one such row, and the second would be refused as a
--     duplicate of an entirely different place or person.
--     NULLS DISTINCT IS INTENTIONAL HERE AND IS PRESERVED.
--
-- =============================================================================
-- WHAT THIS MIGRATION DOES NOT DO
--
--   - It does not weaken, drop or alter any CHECK constraint. The subject
--     exclusivity and context obligation rules are untouched, and they are the
--     reason the NULLs exist.
--   - It does not redesign the subject model or introduce a surrogate identity.
--     PD-03's typed-subject shape is unchanged. This is a two-word correction to
--     how the existing identity compares, not a remodelling.
--   - It does not change RLS, privileges, ownership or any policy.
--   - It does not require one line of application change. Every conflict clause
--     already names its constraint by name, and the name does not change.
--
-- PostgreSQL provides no way to alter a constraint's NULL comparison in place,
-- so each is dropped and re-added. The constraint NAME, COLUMN LIST and INCLUDE
-- list are reproduced exactly; only the NULLS NOT DISTINCT clause is added.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Preconditions
-- -----------------------------------------------------------------------------
-- NULLS NOT DISTINCT is PostgreSQL 15+. Refusing early gives a clear message
-- rather than a syntax error part-way through a partitioned rebuild.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION
      'migration 020 requires PostgreSQL 15 or later for NULLS NOT DISTINCT; this server is %',
      current_setting('server_version');
  END IF;
END
$$;

-- Every constraint below must exist before it can be replaced. A missing one
-- means the migration set is not at 019, and continuing would leave the identity
-- silently unenforced — the exact condition this migration exists to remove.
DO $$
DECLARE
  expected text[] := ARRAY[
    'uq_feature_value__subject_context_definition_asof_version',
    'uq_module_reading__subject_context_definition_asof_version',
    'uq_watchlist__user_entity',
    'uq_provider_statistic__subject_affiliation_edition_domain',
    'uq_calibration_series__identity',
    'uq_p_team_state__team_context_feature',
    'uq_user_preference__user_domain_competition'
  ];
  missing text[];
BEGIN
  SELECT array_agg(name) INTO missing
    FROM unnest(expected) AS name
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint WHERE conname = name AND contype = 'u'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 020 preconditions unmet; missing unique constraints: %', missing;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. feature.feature_value  — the primary subject of S5-5
-- -----------------------------------------------------------------------------
-- The INCLUDE list is reproduced verbatim from migration 007. feature_version_id
-- appears in BOTH the key and the INCLUDE list there; that redundancy is
-- preserved rather than tidied, because this migration corrects one property and
-- changes nothing else.
ALTER TABLE feature.feature_value
  DROP CONSTRAINT uq_feature_value__subject_context_definition_asof_version;

ALTER TABLE feature.feature_value
  ADD CONSTRAINT uq_feature_value__subject_context_definition_asof_version
  UNIQUE NULLS NOT DISTINCT
    (subject_kind_code, subject_team_id, subject_player_id,
     subject_fixture_id, subject_fixture_partition_on,
     subject_competition_edition_id,
     context_kind_code, context_competition_edition_id,
     feature_definition_id, as_of, feature_version_id)
  INCLUDE (value, provenance_class_code, sample_observation_count,
           sample_meets_threshold, feature_version_id);

COMMENT ON CONSTRAINT uq_feature_value__subject_context_definition_asof_version
  ON feature.feature_value IS
  'Business identity (§B.3.2). NULLS NOT DISTINCT is LOAD-BEARING, not stylistic: ck_feature_value__subject_exclusive forces at least three of the four typed subject columns NULL on every row, and ck_feature_value__context_edition_conditional forces the context edition NULL outside COMPETITION_SCOPED. Under the default NULLS DISTINCT this constraint could never match, ON CONFLICT could never fire, and every recalculation would append a duplicate (finding S5-5). Two rows that are both unscoped ARE the same row.';

-- -----------------------------------------------------------------------------
-- 2. module.module_reading  — structurally identical
-- -----------------------------------------------------------------------------
ALTER TABLE module.module_reading
  DROP CONSTRAINT uq_module_reading__subject_context_definition_asof_version;

ALTER TABLE module.module_reading
  ADD CONSTRAINT uq_module_reading__subject_context_definition_asof_version
  UNIQUE NULLS NOT DISTINCT
    (subject_kind_code, subject_team_id, subject_player_id,
     subject_fixture_id, subject_fixture_partition_on,
     subject_competition_edition_id,
     context_kind_code, context_competition_edition_id,
     module_definition_id, as_of, module_version_id);

COMMENT ON CONSTRAINT uq_module_reading__subject_context_definition_asof_version
  ON module.module_reading IS
  'Business identity. NULLS NOT DISTINCT for the same reason as feature_value (S5-5): the typed-subject shape guarantees NULLs in the key, so the default comparison could never detect a duplicate reading. Corrected before S-6 rather than after, because the defect is structural rather than incidental.';

-- -----------------------------------------------------------------------------
-- 3. product.watchlist
-- -----------------------------------------------------------------------------
ALTER TABLE product.watchlist
  DROP CONSTRAINT uq_watchlist__user_entity;

ALTER TABLE product.watchlist
  ADD CONSTRAINT uq_watchlist__user_entity
  UNIQUE NULLS NOT DISTINCT
    (user_id, entity_kind, team_id, fixture_id, fixture_partition_on, competition_id);

COMMENT ON CONSTRAINT uq_watchlist__user_entity ON product.watchlist IS
  'NULLS NOT DISTINCT (S5-5). ck_watchlist__entity_exclusive forces exactly one of team_id, fixture_id or competition_id to be populated, so under the default comparison a user could add the same team to a watchlist any number of times.';

-- -----------------------------------------------------------------------------
-- 4. football.provider_statistic
-- -----------------------------------------------------------------------------
ALTER TABLE football.provider_statistic
  DROP CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain;

ALTER TABLE football.provider_statistic
  ADD CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain
  UNIQUE NULLS NOT DISTINCT
    (subject_kind_code, player_id, team_id, affiliation_team_id,
     competition_edition_id, statistics_domain_code, provider_code);

COMMENT ON CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain
  ON football.provider_statistic IS
  'NULLS NOT DISTINCT (S5-5). ck_provider_statistic__subject_exclusive forces player XOR team, and affiliation_team_id and competition_edition_id are independently optional — so under the default comparison every ingestion re-run would append a duplicate statistic rather than conflict.';

-- -----------------------------------------------------------------------------
-- 5. calibration.calibration_series
-- -----------------------------------------------------------------------------
ALTER TABLE calibration.calibration_series
  DROP CONSTRAINT uq_calibration_series__identity;

ALTER TABLE calibration.calibration_series
  ADD CONSTRAINT uq_calibration_series__identity
  UNIQUE NULLS NOT DISTINCT
    (module_version_id, band_code, outcome_dimension_code,
     context_kind_code, context_competition_id, snapshot_point_code);

COMMENT ON CONSTRAINT uq_calibration_series__identity ON calibration.calibration_series IS
  'NULLS NOT DISTINCT (S5-5). ck_calibration_series__context_competition_conditional forces context_competition_id NULL for every series that is not competition-scoped — the same conditional-scope shape as feature_value — so two identical unscoped series would not compare equal.';

-- -----------------------------------------------------------------------------
-- 6. product.p_team_state
-- -----------------------------------------------------------------------------
ALTER TABLE product.p_team_state
  DROP CONSTRAINT uq_p_team_state__team_context_feature;

ALTER TABLE product.p_team_state
  ADD CONSTRAINT uq_p_team_state__team_context_feature
  UNIQUE NULLS NOT DISTINCT
    (team_id, context_kind_code, competition_edition_id, feature_key);

COMMENT ON CONSTRAINT uq_p_team_state__team_context_feature ON product.p_team_state IS
  'NULLS NOT DISTINCT (S5-5). competition_edition_id is NULL for the all-competitions projection row; without this, a refresh could duplicate that row and the read path would return whichever copy the plan happened to reach.';

-- -----------------------------------------------------------------------------
-- 7. product.user_preference
-- -----------------------------------------------------------------------------
ALTER TABLE product.user_preference
  DROP CONSTRAINT uq_user_preference__user_domain_competition;

ALTER TABLE product.user_preference
  ADD CONSTRAINT uq_user_preference__user_domain_competition
  UNIQUE NULLS NOT DISTINCT
    (user_id, preference_domain, competition_id);

COMMENT ON CONSTRAINT uq_user_preference__user_domain_competition ON product.user_preference IS
  'NULLS NOT DISTINCT (S5-5). competition_id is NULL for a user''s global preference in a domain; two such rows would make "the" preference unanswerable.';

-- -----------------------------------------------------------------------------
-- Class B, recorded rather than changed
-- -----------------------------------------------------------------------------
-- Stated on the relations themselves so the next reader finds the reasoning at
-- the constraint rather than only in this file.
COMMENT ON CONSTRAINT uq_venue__provider_external_id ON football.venue IS
  'NULLS DISTINCT DELIBERATELY RETAINED (S5-5 Class B). This is a single-column alternate key, and NULL means "the provider supplied no identifier for this venue" — not a shared identity. Under NULLS NOT DISTINCT the system could hold exactly one unidentified venue, and the second real ground would be refused as a duplicate of an unrelated place.';

COMMENT ON CONSTRAINT uq_official__provider_external_id ON football.official IS
  'NULLS DISTINCT DELIBERATELY RETAINED (S5-5 Class B). As football.venue: NULL means no provider identifier exists for this official, and officials without one are different people, not one person recorded twice.';

-- -----------------------------------------------------------------------------
-- Conformance gate
-- -----------------------------------------------------------------------------
-- Asserts the migration achieved what it claims, in the same transaction that
-- performed it. A DDL statement that silently affected nothing is the failure
-- class the Revision 2 gates exist to catch (B-09, B-11), and re-adding a
-- constraint under the wrong comparison would look identical from outside.
DO $$
DECLARE
  wrong text[];
BEGIN
  SELECT array_agg(conname ORDER BY conname) INTO wrong
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
     AND conrelid IN (
       SELECT oid FROM pg_class WHERE relkind IN ('r','p')
     )
     AND pg_get_constraintdef(oid) NOT LIKE '%NULLS NOT DISTINCT%';

  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'migration 020 did not take effect on: %', wrong;
  END IF;

  -- And the two Class B constraints must NOT have been swept up.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname IN ('uq_venue__provider_external_id', 'uq_official__provider_external_id')
       AND pg_get_constraintdef(oid) LIKE '%NULLS NOT DISTINCT%'
  ) THEN
    RAISE EXCEPTION
      'migration 020 changed a Class B constraint; venue and official must keep NULLS DISTINCT';
  END IF;
END
$$;

COMMIT;

-- =============================================================================
-- POST-MIGRATION NOTE — PARTITIONED RELATIONS
--
-- feature.feature_value and module.module_reading each have 61 partitions. DROP
-- CONSTRAINT removed the corresponding index from every one of them; ADD
-- CONSTRAINT rebuilt and re-attached all 122. That is fast only while the
-- relations are empty, which they are today in every environment.
--
-- ANALYZE is not issued here: both relations are empty, so there are no
-- statistics to refresh. Run it after the first substantial population, as
-- normal.
-- =============================================================================
