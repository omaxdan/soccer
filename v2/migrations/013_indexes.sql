-- =============================================================================
-- 013_indexes.sql — Access paths
-- Source: Doc 08 Rev 1 §B.8.5 stage 14, §5.11, A.9  |  Depends: 001-012 | Transactional
--
-- R-41: every relation is EMPTY at this point in the ordering, so indexes are
-- declared normally. The four-stage per-partition pattern of A.9 / R-37 applies
-- to POPULATED partitioned relations only and is documented in 014.
--
-- §5.11.1: every index exists to serve a DECLARED access path. An undocumented
-- index is a defect. Constraint-supporting indexes are exempt from the disuse
-- retirement rule of §5.11.8, because they enforce a constraint rather than
-- serve a read.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- feature.feature_value — the dominant temporal access path (§5.11.3)
-- -----------------------------------------------------------------------------
-- Access path: prevailing value for a set of features, one subject, one context,
-- as of an instant. Subject and context LEAD; as_of DESCENDING means the
-- prevailing value is the first entry encountered, so the access is a bounded
-- scan of one entry per feature rather than an aggregate over history.
-- COVERING payload satisfies the path without visiting the heap.

-- REVISION 2 (O-03). The business unique constraint's supporting index and this
-- covering index shared a long leading prefix, so two structures were maintained
-- on a relation projected at 10^8-10^9 rows. §5.11.1 requires that a constraint's
-- supporting index be ordered to serve the dominant access path so that ONE
-- structure serves both purposes. The covering payload is therefore attached to
-- the business unique constraint in 007 and the separate index is withdrawn.
--
-- The remaining difference is column ORDER: the constraint leads with the
-- subject columns and carries as_of in ascending order. Descending order on a
-- btree is scanned backwards at no cost for a bounded lookup of the greatest
-- as_of not exceeding a bound, so the prevailing-value access path is served by
-- the constraint index without a second structure.

-- Access path: replay and audit by calculation time. Correlated with physical
-- order by insertion, which is what makes a block-range index viable (§5.11.5).
CREATE INDEX ix_feature_value__calculated_at__brin
  ON feature.feature_value USING brin (calculated_at);

-- Access path: registry impact analysis — every value produced by a version.
CREATE INDEX ix_feature_value__version
  ON feature.feature_value (feature_version_id, as_of DESC);

-- -----------------------------------------------------------------------------
-- feature.feature_lineage
-- -----------------------------------------------------------------------------
-- Access path: replay — what did this value consume.
CREATE INDEX ix_feature_lineage__produced
  ON feature.feature_lineage (produced_value_id, produced_value_as_of);
-- Access path: thinning eligibility — is this value cited by retained lineage.
CREATE INDEX ix_feature_lineage__consumed
  ON feature.feature_lineage (consumed_value_id, consumed_value_as_of);

-- -----------------------------------------------------------------------------
-- module.module_reading — structurally identical dominant path
-- -----------------------------------------------------------------------------
CREATE INDEX ix_module_reading__subject_context_definition_asof
  ON module.module_reading
     (subject_kind_code, subject_team_id, subject_player_id,
      subject_fixture_id, subject_competition_edition_id,
      context_kind_code, context_competition_edition_id,
      module_definition_id, as_of DESC)
  INCLUDE (module_status_code, strength, confidence,
           sample_observation_count, sample_meets_threshold, module_version_id);

CREATE INDEX ix_module_reading__calculated_at__brin
  ON module.module_reading USING brin (calculated_at);
CREATE INDEX ix_module_reading__version
  ON module.module_reading (module_version_id, as_of DESC);
-- Access path: baseline impact analysis — which readings cite a baseline.
CREATE INDEX ix_module_reading__baseline
  ON module.module_reading (published_baseline_id) WHERE published_baseline_id IS NOT NULL;

CREATE INDEX ix_module_evidence_item__cited_value
  ON module.module_evidence_item (cited_feature_value_id, cited_feature_value_as_of);
COMMENT ON INDEX module.ix_module_evidence_item__cited_value IS
  'Serves thinning eligibility and the explainability path "which readings did this value drive".';

-- -----------------------------------------------------------------------------
-- snapshot — the match intelligence read path (§B.13.3)
-- -----------------------------------------------------------------------------
-- The heaviest declared read is a partition-pruned, partition-wise gather of a
-- small number of rows within one partition per relation. It is served DIRECTLY
-- rather than from a projection: a sealed snapshot is immutable, so a projection
-- would offer no consistency benefit and would add refresh machinery, staleness
-- and rebuild cost for no gain.

CREATE INDEX ix_match_snapshot__fixture_point
  ON snapshot.match_snapshot (fixture_partition_on, fixture_id, snapshot_point_code);
CREATE INDEX ix_match_snapshot__sealed_at__brin
  ON snapshot.match_snapshot USING brin (sealed_at);

CREATE INDEX ix_snapshot_feature_state__snapshot
  ON snapshot.snapshot_feature_state (fixture_partition_on, match_snapshot_id);
CREATE INDEX ix_snapshot_feature_state__cited_value
  ON snapshot.snapshot_feature_state (cited_feature_value_id, cited_as_of);

CREATE INDEX ix_snapshot_module_reading__snapshot
  ON snapshot.snapshot_module_reading (fixture_partition_on, match_snapshot_id);
CREATE INDEX ix_snapshot_module_reading__cited_reading
  ON snapshot.snapshot_module_reading (cited_module_reading_id, cited_as_of);

CREATE INDEX ix_snapshot_version_component__snapshot
  ON snapshot.snapshot_version_component (fixture_partition_on, match_snapshot_id);
CREATE INDEX ix_snapshot_model_output__snapshot
  ON snapshot.snapshot_model_output (fixture_partition_on, match_snapshot_id);
CREATE INDEX ix_snapshot_completeness_item__completeness
  ON snapshot.snapshot_completeness_item (fixture_partition_on, snapshot_completeness_id);
CREATE INDEX ix_snapshot_verdict__snapshot
  ON snapshot.snapshot_verdict (fixture_partition_on, match_snapshot_id);

-- A.2 / R-08: resolves the PREVAILING outcome link as a single index entry, so
-- currency resolution requires neither aggregation nor a marker.
CREATE INDEX ix_snapshot_outcome_link__snapshot_dimension_ordinal
  ON snapshot.snapshot_outcome_link
     (fixture_partition_on, match_snapshot_id, outcome_dimension_code, revision_ordinal DESC);
COMMENT ON INDEX snapshot.ix_snapshot_outcome_link__snapshot_dimension_ordinal IS
  'A.2 / R-08. Ordinal DESC makes the prevailing link the first entry encountered.';

-- Access path: snapshots awaiting outcome linkage.
CREATE INDEX ix_snapshot_outcome_link__result
  ON snapshot.snapshot_outcome_link (result_id, fixture_partition_on);

-- -----------------------------------------------------------------------------
-- football — write-path and read-path lookups
-- -----------------------------------------------------------------------------
CREATE INDEX ix_fixture__edition_kickoff
  ON football.fixture (competition_edition_id, scheduled_kickoff_at);
CREATE INDEX ix_fixture__home_team_kickoff ON football.fixture (home_team_id, scheduled_kickoff_at);
CREATE INDEX ix_fixture__away_team_kickoff ON football.fixture (away_team_id, scheduled_kickoff_at);
-- Partial index on a PARTITIONED relation is permitted because it is NON-UNIQUE
-- (F-03 applies to unique indexes only).
CREATE INDEX ix_fixture__forward_window__open
  ON football.fixture (scheduled_kickoff_at)
  WHERE lifecycle_state_code = 'SCHEDULED';
COMMENT ON INDEX football.ix_fixture__forward_window__open IS
  'Serves the forward-window read path. Non-unique, so the prohibition on partial UNIQUE indexes over partitioned relations does not apply.';

CREATE INDEX ix_appearance__player_partition
  ON football.appearance (player_id, fixture_partition_on);
COMMENT ON INDEX football.ix_appearance__player_partition IS
  'Serves player-scoped trailing-window reads during feature calculation. F-14: an UNBOUNDED career read spans partitions, which is acceptable — such reads arise in pipeline calculation, not in a production read path, and per-partition work is bounded.';

CREATE INDEX ix_standing__edition_asof_team
  ON football.standing (competition_edition_id, as_of_on DESC, team_id);
CREATE INDEX ix_player_valuation__player_asof
  ON football.player_valuation (player_id, as_of_on DESC);
CREATE INDEX ix_player_registration__team_period
  ON football.player_registration USING gist (team_id, registration_period);
CREATE INDEX ix_player_registration__open
  ON football.player_registration (player_id)
  WHERE upper_inf(registration_period);
CREATE INDEX ix_player_availability__open
  ON football.player_availability (player_id)
  WHERE upper_inf(spell_period);
COMMENT ON INDEX football.ix_player_availability__open IS
  'Current availability is a QUERY OVER OPEN SPELLS, never a stored flag (LC-11). This partial index is what makes that query cheap.';

CREATE INDEX ix_provider_statistic__subject_edition_domain
  ON football.provider_statistic (player_id, competition_edition_id, statistics_domain_code)
  WHERE player_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- calibration
-- -----------------------------------------------------------------------------
CREATE INDEX ix_calibration_result__series_measured
  ON calibration.calibration_result (calibration_series_id, measured_at DESC);
COMMENT ON INDEX calibration.ix_calibration_result__series_measured IS
  'Serves the SERIES TRAJECTORY read — whether a module is improving or degrading, which a latest-value-only structure cannot answer.';
CREATE INDEX ix_published_baseline__module_version_band
  ON calibration.published_baseline (module_version_id, band_code, outcome_dimension_code);
CREATE INDEX ix_calibration_series__module_version
  ON calibration.calibration_series (module_version_id);

-- -----------------------------------------------------------------------------
-- product and operations
-- -----------------------------------------------------------------------------
CREATE INDEX ix_watchlist__user ON product.watchlist (user_id);
CREATE INDEX ix_watchlist__fixture ON product.watchlist (fixture_id, fixture_partition_on)
  WHERE fixture_id IS NOT NULL;
CREATE INDEX ix_watchlist__team ON product.watchlist (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX ix_watchlist__competition ON product.watchlist (competition_id) WHERE competition_id IS NOT NULL;
COMMENT ON INDEX product.ix_watchlist__fixture IS
  'Also serves the watchlist referential-defence trigger of migration 015, which must locate entries by referenced entity on delete.';
CREATE INDEX ix_user_preference__user ON product.user_preference (user_id);
CREATE INDEX ix_notification_intent__user_occurred
  ON product.notification_intent (user_id, occurred_at DESC);

CREATE INDEX ix_pipeline_job_run__run ON operations.pipeline_job_run (pipeline_run_id, run_occurred_at);
CREATE INDEX ix_pipeline_job_run__job_occurred ON operations.pipeline_job_run (job_key, occurred_at DESC);
CREATE INDEX ix_write_record__job ON operations.write_record (pipeline_job_run_id, job_occurred_at);
CREATE INDEX ix_failure__job ON operations.failure (pipeline_job_run_id, job_occurred_at);
CREATE INDEX ix_failure__class_occurred ON operations.failure (failure_class_code, occurred_at DESC);
CREATE INDEX ix_api_usage__provider_window ON operations.api_usage (provider_code, window_start DESC);
CREATE INDEX ix_quality_assertion_result__check_occurred
  ON operations.quality_assertion_result (quality_check_id, occurred_at DESC);
CREATE INDEX ix_quality_assertion_result__failed
  ON operations.quality_assertion_result (occurred_at DESC) WHERE NOT passed;
