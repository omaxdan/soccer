-- =============================================================================
-- 014_constraints.sql — Cross-schema and cross-scheme references
-- Source: Doc 08 Rev 1 §B.8.5 stage 11 and 20, A.1, A.11, F-25
-- Depends: 001-013  |  Transactional (relations are empty at deployment)
--
-- Purpose
--   Adds the foreign keys deferred because their target schema is created later
--   in the ordering, and records the validation strategy for the cross-
--   partitioning-scheme references that dominate migration and backfill cost.
--
-- Deployment note
--   At initial deployment every relation is EMPTY, so these constraints are
--   created VALID and validation is instantaneous. The NOT VALID / resumable
--   pattern below applies when these constraints are introduced to POPULATED
--   relations — during reconstruction, or in any later environment where data
--   precedes the constraint.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.11 / R-46 — baseline version matching, DECLARATIVELY
-- -----------------------------------------------------------------------------
-- The reading declares a composite reference over its cited baseline AND ITS OWN
-- module version, targeting published_baseline's redundant unique constraint.
-- Equality of the two module versions is enforced BY THE REFERENCE ITSELF.
-- This replaces a per-row trigger that would have executed ~2 x 10^7 times.

ALTER TABLE module.module_reading
  ADD CONSTRAINT fk_module_reading__baseline_at_own_version
  FOREIGN KEY (published_baseline_id, module_version_id)
  REFERENCES calibration.published_baseline (id, module_version_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_module_reading__baseline_at_own_version ON module.module_reading IS
  'A.11 / R-46 / LC-66. A reading cannot cite a baseline measured on a different version of itself. No trigger, no additional column — the redundant unique constraint on the parent makes the rule declarable.';

-- -----------------------------------------------------------------------------
-- A.1 / R-01 — cross-partitioning-scheme references (F-25)
-- -----------------------------------------------------------------------------
-- These are the most expensive constraints in any migration or backfill: the
-- referencing relation is partitioned by fixture date or reading as-of, the
-- parent by value as-of, so each check is a lookup into whichever parent
-- partition holds the referenced row. Partition-wise validation is unavailable.

ALTER TABLE module.module_evidence_item
  ADD CONSTRAINT fk_module_evidence_item__cited_feature_value
  FOREIGN KEY (cited_feature_value_id, cited_feature_value_as_of)
  REFERENCES feature.feature_value (id, as_of)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_module_evidence_item__cited_feature_value ON module.module_evidence_item IS
  'R-01 composite. RESTRICT prevents thinning of any cited value (LC-65).';

ALTER TABLE snapshot.snapshot_feature_state
  ADD CONSTRAINT fk_snapshot_feature_state__cited_feature_value
  FOREIGN KEY (cited_feature_value_id, cited_as_of)
  REFERENCES feature.feature_value (id, as_of)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_snapshot_feature_state__cited_feature_value ON snapshot.snapshot_feature_state IS
  'R-01 composite. RESTRICT is what PROMOTES the cited value from thinnable to permanent — not by any operation upon the value, but because a sealed row references it (§B.15.8).';

ALTER TABLE snapshot.snapshot_module_reading
  ADD CONSTRAINT fk_snapshot_module_reading__cited_module_reading
  FOREIGN KEY (cited_module_reading_id, cited_as_of)
  REFERENCES module.module_reading (id, as_of)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- -----------------------------------------------------------------------------
-- Deferred product and operations references
-- -----------------------------------------------------------------------------

ALTER TABLE module.module_definition
  ADD CONSTRAINT fk_module_definition__entitlement_feature
  FOREIGN KEY (entitlement_feature_key)
  REFERENCES product.entitlement_feature (feature_key)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_module_definition__entitlement_feature ON module.module_definition IS
  'LC-149. A reference to a GOVERNED VOCABULARY, not a dependency on product behaviour — the module engine resolves no entitlement and reads no subscription. One of the three references that appear to cross upward and do not (§B.21.3).';

ALTER TABLE snapshot.match_snapshot
  ADD CONSTRAINT fk_match_snapshot__pipeline_job_run
  FOREIGN KEY (pipeline_job_run_id, sealed_at)
  REFERENCES operations.pipeline_job_run (id, occurred_at)
  ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMENT ON CONSTRAINT fk_match_snapshot__pipeline_job_run ON snapshot.match_snapshot IS
  'Execution attribution — the sole direction in which an authoritative relation depends on an operational one, and it exists solely for auditability. RESTRICT is what makes the retention exception of §B.9.4 structural: a job run referenced by a sealed artefact CANNOT be removed by retention.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   The composite reference above pairs pipeline_job_run_id with match_snapshot.
--   sealed_at, which requires the job run''s occurred_at to equal the snapshot''s
--   sealed_at exactly. That holds only if the sealing transaction stamps both
--   from one clock read. Confirm the sealing procedure does so; otherwise
--   match_snapshot must carry a separate job_run_occurred_at column bound by the
--   same composite reference. Recorded rather than silently decided.

ALTER TABLE calibration.calibration_run
  ADD CONSTRAINT fk_calibration_run__pipeline_job_run_present
  CHECK (pipeline_job_run_id IS NOT NULL) NOT VALID;
COMMENT ON CONSTRAINT fk_calibration_run__pipeline_job_run_present ON calibration.calibration_run IS
  'LC-119: a run names its executing job run. Created NOT VALID so that it may be validated separately; validate before production. A full composite reference requires the job run occurred_at on this relation — see the TODO above, which applies identically here.';

-- -----------------------------------------------------------------------------
-- Resumable validation procedure for populated environments (F-25, R-65)
-- -----------------------------------------------------------------------------
-- Cross-scheme foreign keys are created NOT VALID and validated PARTITION BY
-- PARTITION ON THE REFERENCING SIDE, so each unit is bounded and interruptible.
-- Performed inline, this validation would extend a migration beyond any
-- reasonable maintenance window.

CREATE TABLE operations.constraint_validation_progress (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  target_schema_name    text        NOT NULL,
  target_relation_name  text        NOT NULL,
  constraint_name       text        NOT NULL,
  partition_name        text        NOT NULL,
  validated_at          timestamptz,
  outcome               text        NOT NULL DEFAULT 'PENDING',
  CONSTRAINT pk_constraint_validation_progress PRIMARY KEY (id),
  CONSTRAINT uq_constraint_validation_progress__target
    UNIQUE (target_schema_name, target_relation_name, constraint_name, partition_name),
  CONSTRAINT ck_constraint_validation_progress__outcome_known
    CHECK (outcome IN ('PENDING','VALIDATED','FAILED'))
);
ALTER TABLE operations.constraint_validation_progress OWNER TO pt_owner;
COMMENT ON TABLE operations.constraint_validation_progress IS
  'F-25 / R-65. Records per-partition validation progress so a timeout is a DELAY rather than a loss of progress. Populated by the validation job of migration 018.';

-- -----------------------------------------------------------------------------
-- Index and constraint patterns for POPULATED relations (A.9, A.10)
-- -----------------------------------------------------------------------------
-- Recorded here as binding guidance for every migration after initial deployment.
--
-- INDEX on a populated PARTITIONED relation — four stages (R-37, R-38, R-39):
--   1. Create the parent index definition ON ONLY the parent; it is invalid.
--   2. Create the corresponding index CONCURRENTLY on each partition, one
--      migration unit per partition, resumable. A failed concurrent creation
--      leaves an invalid partition index, which is dropped before retry.
--   3. ATTACH each partition index to the parent index.
--   4. Confirm the parent index is valid before the change is complete.
--   Stages 2 and 3 are NON-TRANSACTIONAL migrations (R-61, R-62).
--
-- INDEX on a populated UNPARTITIONED relation (R-40):
--   Single-step concurrent creation, in a non-transactional migration.
--
-- UNIQUE constraint on a populated UNPARTITIONED relation (R-43):
--   Create a unique index CONCURRENTLY, then ADD CONSTRAINT USING INDEX, which
--   is a metadata operation holding a brief lock.
--
-- UNIQUE or EXCLUSION constraint on a populated PARTITIONED relation (R-44, R-45):
--   Neither concurrent unique creation nor NOT VALID is available. Requires the
--   expand-populate-migrate-contract pattern. The ordering of §B.8.5 creates
--   partitioned relations WITH their constraints in place, so this case does not
--   arise at initial deployment.
--
-- CHECK and FOREIGN KEY on any populated relation (R-42):
--   Create NOT VALID, then VALIDATE separately — the only two classes that
--   support it.
