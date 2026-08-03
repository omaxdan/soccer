-- =============================================================================
-- 010_snapshot.sql
-- REVISION 2
-- PitchTerminal V2 — Sealed match intelligence
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 10, A.1, A.2, A.3, A.6
-- Depends on      : 001–009
-- Transactional   : yes
--
-- Purpose
--   Creates the platform's primary asset: sealed claims about fixtures.
--
-- SEALED SCHEMA POSTURE (PD-01, R-23)
--   Every relation here is INSERT-ONLY. No role — including the administrative
--   role and the retention role — holds UPDATE or DELETE on any relation in this
--   schema. Privilege is administered at schema level in migration 016, so a
--   relation added here inherits protection by construction. The sealing guard
--   of migration 015 raises on update and delete for EVERY principal, with no
--   exception under any circumstance.
--
-- Corrections realised here
--   A.1 / R-01   Composite references to feature_value and module_reading
--   A.3 / R-09-R-13  snapshot_as_of and cited_as_of, both bound by composite
--                foreign key, with a same-row check closing the temporal
--                contamination path
--   A.6 / R-24   content_checksum and checksum_algorithm_version_id
--   A.2 / R-04-R-08  outcome link revision ordinal, no currency marker,
--                ordinal succession, append-only currency companion
--   A.8 / R-32   NO canonicity attribute on snapshot_model_output
-- =============================================================================

-- -----------------------------------------------------------------------------
-- match_snapshot
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.match_snapshot (
  id                            bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on          date        NOT NULL,
  fixture_id                    bigint      NOT NULL,
  snapshot_point_code           text        NOT NULL,
  snapshot_as_of                timestamptz NOT NULL,
  sealed_at                     timestamptz NOT NULL DEFAULT now(),
  verdict_composition_version_id bigint     NOT NULL,
  consensus_rule_version_id     bigint      NOT NULL,
  content_checksum              bytea       NOT NULL,
  checksum_algorithm_version_id bigint      NOT NULL,
  pipeline_job_run_id           bigint,
  pipeline_job_run_occurred_at  timestamptz,

  CONSTRAINT pk_match_snapshot PRIMARY KEY (id, fixture_partition_on),

  -- Business identity (§B.3.2). The version manifest participates via the two
  -- composition version references, so two snapshots of one fixture at one point
  -- under different rule sets are distinct rows rather than a conflict — which
  -- is the physical mechanism by which parallel version series coexist (§5.16.3).
  CONSTRAINT uq_match_snapshot__fixture_point_versions
    UNIQUE (fixture_partition_on, fixture_id, snapshot_point_code,
            verdict_composition_version_id, consensus_rule_version_id),

  -- Redundant unique constraints (§B.3.3).
  CONSTRAINT uq_match_snapshot__id_partition UNIQUE (id, fixture_partition_on),
  -- A.3 / R-11: the target that binds snapshot_as_of on every content row, so
  -- the denormalised value cannot diverge from the snapshot's actual as-of.
  CONSTRAINT uq_match_snapshot__id_partition_as_of
    UNIQUE (id, fixture_partition_on, snapshot_as_of),

  CONSTRAINT fk_match_snapshot__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_snapshot__point FOREIGN KEY (snapshot_point_code)
    REFERENCES football.snapshot_point (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_snapshot__verdict_composition_version
    FOREIGN KEY (verdict_composition_version_id)
    REFERENCES module.verdict_composition_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_snapshot__consensus_rule_version
    FOREIGN KEY (consensus_rule_version_id)
    REFERENCES module.consensus_rule_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_snapshot__checksum_algorithm_version
    FOREIGN KEY (checksum_algorithm_version_id)
    REFERENCES module.checksum_algorithm_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_match_snapshot__sealed_not_before_as_of CHECK (sealed_at >= snapshot_as_of),
  -- REVISION 2 (P-04). The job-run reference is composite over the job key and
  -- ITS OWN occurred_at, not over sealed_at. Pairing on sealed_at required the
  -- sealing transaction to stamp both from one clock read and would have
  -- rejected valid inserts whenever the two differed by a microsecond.
  CONSTRAINT ck_match_snapshot__job_run_reference_complete
    CHECK ((pipeline_job_run_id IS NULL) = (pipeline_job_run_occurred_at IS NULL))
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.match_snapshot IS
  'E4.01 / E4.02 Match Snapshot and Header. THE central entity of the model and the platform''s primary historical asset.
   Immutability is not a guard applied to a mutable structure — it is WHAT THE STRUCTURE IS. There is nothing to freeze, because nothing was ever going to change.';
COMMENT ON COLUMN snapshot.match_snapshot.content_checksum IS
  'A.6 / R-24. Computed within the sealing transaction over a canonical serialisation of the aggregate, in the order defined by the referenced algorithm version. Verified periodically by the assertion of migration 018 — the RETROSPECTIVE DETECTION control, the fourth of PR-04''s four, which detects modification that circumvented the other three.';
COMMENT ON COLUMN snapshot.match_snapshot.snapshot_as_of IS
  'The moment the snapshot describes. Bound onto every content row by composite foreign key so that the contamination check of A.3 compares two trustworthy values.';
COMMENT ON COLUMN snapshot.match_snapshot.sealed_at IS
  'When the seal occurred. The distinction from snapshot_as_of is what makes BACKFILL LEGIBLE: a snapshot describing a moment two years ago, sealed last week, is visibly a reconstruction rather than a contemporaneous observation.';
COMMENT ON COLUMN snapshot.match_snapshot.pipeline_job_run_occurred_at IS
  'REVISION 2 (P-04). Carried because operations.pipeline_job_run is partitioned and the reference must be composite over ITS key, not over an unrelated instant on this row.';
COMMENT ON COLUMN snapshot.match_snapshot.pipeline_job_run_id IS
  'Execution attribution. FK added in migration 014. A job run referenced by a sealed artefact is retained permanently regardless of operational retention, because a sealed claim that cannot name its producing execution is not fully auditable (§B.9.4).';

-- -----------------------------------------------------------------------------
-- snapshot_version_component   (E4.10 manifest)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_version_component (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  match_snapshot_id     bigint      NOT NULL,
  component_kind        text        NOT NULL,
  component_version_id  bigint      NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_version_component PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_version_component__snapshot_kind_version
    UNIQUE (fixture_partition_on, match_snapshot_id, component_kind, component_version_id),
  CONSTRAINT fk_snapshot_version_component__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_version_component__kind_known CHECK (
    component_kind IN ('FEATURE_VERSION','MODULE_VERSION','MODEL_VERSION',
                       'VERDICT_COMPOSITION_VERSION','CONSENSUS_RULE_VERSION',
                       'CHECKSUM_ALGORITHM_VERSION')
  )
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_version_component IS
  'E4.10 Snapshot Version — a MANIFEST, not a single designation, because a snapshot is produced by many rules simultaneously. Manifest completeness is a sealing precondition and is verified by the assertion of migration 018: every version referenced by any content of a snapshot must appear here (LC-103).';
COMMENT ON CONSTRAINT fk_snapshot_version_component__snapshot ON snapshot.snapshot_version_component IS
  'CASCADE is the ONE cascade in the design (PD-09). It exists so that an extraordinary authorised administrative removal of a snapshot remains atomic. In normal operation no snapshot is ever deleted and no role holds the privilege to delete one.';

-- -----------------------------------------------------------------------------
-- snapshot_feature_state   (A.3)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_feature_state (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  match_snapshot_id         bigint      NOT NULL,
  snapshot_as_of            timestamptz NOT NULL,
  cited_feature_value_id    bigint      NOT NULL,
  cited_as_of               timestamptz NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_snapshot_feature_state PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_feature_state__snapshot_cited_value
    UNIQUE (fixture_partition_on, match_snapshot_id, cited_feature_value_id, cited_as_of),

  -- A.3 / R-11: binds snapshot_as_of to the parent, so it cannot diverge.
  CONSTRAINT fk_snapshot_feature_state__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on, snapshot_as_of)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on, snapshot_as_of)
    ON DELETE CASCADE ON UPDATE RESTRICT,

  -- A.3 / R-12: THE CONTAMINATION CHECK.
  CONSTRAINT ck_snapshot_feature_state__cited_not_after_snapshot
    CHECK (cited_as_of <= snapshot_as_of)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_feature_state IS
  'E4.03 Snapshot Feature State — the sealed materialisation of every feature value the snapshot consumed.
   A SEALED RESOLUTION under §4.1.2: the same fact, materialised for reproducibility, permanently attributed to the owner that produced it. A resolution that could not name its owner would be a duplicate; naming it is what keeps single-source-of-truth intact while still sealing the content.
   Sealing PROMOTES each referenced value from thinnable to permanent — not by any operation upon the value, but because a sealed row references it under RESTRICT (§B.9.2).';
COMMENT ON CONSTRAINT ck_snapshot_feature_state__cited_not_after_snapshot ON snapshot.snapshot_feature_state IS
  'A.3 / F-16. THE HIGHEST-VALUE CORRECTION IN THE REVIEW. Without it, a snapshot could cite a value whose as-of postdates the snapshot''s own — a claim incorporating information that did not exist when it was supposedly made. That is the lookahead contamination the platform''s evidential positioning exists to exclude, and the Phase 1 audit found exactly that defect in the previous platform''s baseline cohort.
   Both operands are bound to their sources by composite foreign key, so this same-row check compares two trustworthy values.';

-- -----------------------------------------------------------------------------
-- snapshot_module_reading   (A.3)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_module_reading (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  match_snapshot_id         bigint      NOT NULL,
  snapshot_as_of            timestamptz NOT NULL,
  cited_module_reading_id   bigint      NOT NULL,
  cited_as_of               timestamptz NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_snapshot_module_reading PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_module_reading__snapshot_cited_reading
    UNIQUE (fixture_partition_on, match_snapshot_id, cited_module_reading_id, cited_as_of),
  CONSTRAINT fk_snapshot_module_reading__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on, snapshot_as_of)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on, snapshot_as_of)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_module_reading__cited_not_after_snapshot
    CHECK (cited_as_of <= snapshot_as_of)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_module_reading IS
  'E4.04. Every sealed reading is INDIVIDUALLY ADDRESSABLE (LC-86), which is what makes reading-level scoring possible — the measurement underpinning every per-module reliability claim. The previous platform archived one model''s conclusion and no module readings at all.';

-- -----------------------------------------------------------------------------
-- snapshot_verdict   (E4.05)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_verdict (
  id                            bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on          date        NOT NULL,
  match_snapshot_id             bigint      NOT NULL,
  verdict_composition_version_id bigint     NOT NULL,

  readiness_edge                numeric,
  form_edge                     numeric,
  travel_edge                   numeric,
  rest_edge                     numeric,
  congestion_edge               numeric,
  availability_edge             numeric,

  risk_score                    numeric,
  confidence                    numeric,
  evidence_count                integer     NOT NULL,
  consensus_supports_count      integer     NOT NULL,
  consensus_contradicts_count   integer     NOT NULL,
  consensus_neutral_count       integer     NOT NULL,
  consensus_inactive_count      integer     NOT NULL,
  completeness_ratio            numeric     NOT NULL,
  historical_reliability_baseline_id bigint,
  created_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_snapshot_verdict PRIMARY KEY (id, fixture_partition_on),  -- C-02
  CONSTRAINT uq_snapshot_verdict__snapshot_version
    UNIQUE (fixture_partition_on, match_snapshot_id, verdict_composition_version_id),
  CONSTRAINT fk_snapshot_verdict__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_verdict__composition_version FOREIGN KEY (verdict_composition_version_id)
    REFERENCES module.verdict_composition_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_verdict__baseline FOREIGN KEY (historical_reliability_baseline_id)
    REFERENCES calibration.published_baseline (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_verdict__counts_non_negative CHECK (
    evidence_count >= 0 AND consensus_supports_count >= 0 AND consensus_contradicts_count >= 0
    AND consensus_neutral_count >= 0 AND consensus_inactive_count >= 0
  ),
  CONSTRAINT ck_snapshot_verdict__confidence_bounded
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT ck_snapshot_verdict__completeness_bounded
    CHECK (completeness_ratio BETWEEN 0 AND 1),
  CONSTRAINT ck_snapshot_verdict__evidence_matches_engaged
    CHECK (evidence_count = consensus_supports_count + consensus_contradicts_count + consensus_neutral_count)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_verdict IS
  'REVISION 2 (P-01): now range-partitioned monthly on fixture_partition_on and CO-PARTITIONED with the rest of the sealed family. It was previously left unpartitioned on volume grounds, which is sound in isolation and wrong in context: §B.13.3''s match-intelligence read path depends on partition-wise assembly across the family, and an unpartitioned member forces a join across the whole relation. The heaviest declared read was degraded to save partitions on its smallest member.
   E4.05 Snapshot Verdict — THE CANONICAL PRODUCT OUTPUT. A CHARACTERISATION OF THE FIXTURE, NOT A PREDICTION OF ITS RESULT.
   A prediction states that something will happen. A verdict states what the evidence indicates, how much of it there is, how consistent it is, and how reliable that pattern has been historically.
   NO COLUMN EXISTS ANYWHERE ON THIS RELATION for a recommended action, a stake, a selection, or an instruction. The constraint is STRUCTURAL, not editorial — the model provides no construct in which one could be expressed (LC-71).';
COMMENT ON COLUMN snapshot.snapshot_verdict.risk_score IS
  'Held SEPARATELY from confidence, deliberately. A high-edge, high-risk fixture is a different product statement from a high-edge, low-risk one; collapsing them into one figure destroys exactly the distinction that makes the characterisation useful.';
COMMENT ON COLUMN snapshot.snapshot_verdict.confidence IS
  'Grounded in SAMPLE AND EVIDENCE COMPLETENESS, never in the magnitude of any edge (LC-90).';
COMMENT ON COLUMN snapshot.snapshot_verdict.consensus_inactive_count IS
  'Counted separately from neutral. A module silent for want of data is not a module that examined the fixture and found it unremarkable; consensus RETAINS DISSENT rather than averaging it away (LC-73).';

-- -----------------------------------------------------------------------------
-- snapshot_model_output   (A.8 — NO canonicity attribute)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_model_output (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  match_snapshot_id     bigint      NOT NULL,
  model_id              bigint      NOT NULL,
  model_version_id      bigint      NOT NULL,
  output_type_code      text        NOT NULL,
  output_values         jsonb       NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_model_output PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_model_output__snapshot_model_version_type
    UNIQUE (fixture_partition_on, match_snapshot_id, model_id, model_version_id, output_type_code),
  CONSTRAINT fk_snapshot_model_output__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_model_output__model_version
    FOREIGN KEY (model_version_id, model_id)
    REFERENCES module.model_version (id, model_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_model_output__output_type FOREIGN KEY (output_type_code)
    REFERENCES module.model_output_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_model_output IS
  'E4.06 Snapshot Model Output. CARRIES NO CANONICITY ATTRIBUTE (A.8 / R-32). Canonicity is resolved from calibration.model_canonical_designation by the snapshot''s as-of instant, so a later change of canonical model does not retroactively alter which output was canonical when the claim was made (R-35).
   EVERY model output is sealed, attributed to a named model and version, and individually calibrated — canonical or not (LC-95). The competition between models is a measurable experiment rather than an ambiguity.';
COMMENT ON COLUMN snapshot.snapshot_model_output.output_values IS
  'TODO: requires confirmation from Phase 5 schema catalogue.
   Doc 08 §5.20.4 states that a model output records the model, version and output type, but does not enumerate the output value attributes per output type. Held as a structured payload rather than inventing columns.
   NOTE this is NOT within either circumstance permitted by PD-16 — it is neither a retained provider response nor operational diagnostic detail. It must become columnar, or a per-output-type child relation, before production. Recorded as a known deviation requiring resolution.';

-- -----------------------------------------------------------------------------
-- snapshot_completeness
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_completeness (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on        date        NOT NULL,
  match_snapshot_id           bigint      NOT NULL,
  expected_feature_count      integer     NOT NULL,
  present_feature_count       integer     NOT NULL,
  expected_module_count       integer     NOT NULL,
  engaged_module_count        integer     NOT NULL,
  below_threshold_count       integer     NOT NULL DEFAULT 0,
  estimated_input_count       integer     NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_completeness PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_completeness__snapshot
    UNIQUE (fixture_partition_on, match_snapshot_id),
  CONSTRAINT fk_snapshot_completeness__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_completeness__counts_non_negative CHECK (
    expected_feature_count >= 0 AND present_feature_count >= 0
    AND expected_module_count >= 0 AND engaged_module_count >= 0
  ),
  CONSTRAINT ck_snapshot_completeness__present_within_expected
    CHECK (present_feature_count <= expected_feature_count
           AND engaged_module_count <= expected_module_count)
) PARTITION BY RANGE (fixture_partition_on);

CREATE TABLE snapshot.snapshot_completeness_item (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on        date        NOT NULL,
  snapshot_completeness_id    bigint      NOT NULL,
  absence_kind                text        NOT NULL,
  feature_definition_id       bigint,
  module_definition_id        bigint,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_completeness_item PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT fk_snapshot_completeness_item__completeness
    FOREIGN KEY (snapshot_completeness_id, fixture_partition_on)
    REFERENCES snapshot.snapshot_completeness (id, fixture_partition_on)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_completeness_item__feature FOREIGN KEY (feature_definition_id)
    REFERENCES feature.feature_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_completeness_item__module FOREIGN KEY (module_definition_id)
    REFERENCES module.module_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_completeness_item__kind_known
    CHECK (absence_kind IN ('FEATURE_ABSENT','FEATURE_BELOW_THRESHOLD','FEATURE_ESTIMATED','MODULE_INACTIVE')),
  CONSTRAINT ck_snapshot_completeness_item__subject_present
    CHECK (feature_definition_id IS NOT NULL OR module_definition_id IS NOT NULL)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_completeness IS
  'E4.07 Snapshot Completeness — the statement of WHAT THE SNAPSHOT COULD NOT SEE.
   Exists so the platform can distinguish "we looked and found nothing" from "we could not look". The previous platform''s consuming surface degraded gracefully to demonstration content when a query returned nothing — good for resilience, and it made a silently empty structure indistinguishable from healthy data.
   ABSENCE IS RECORDED AS ABSENCE, never approximated or substituted (LC-97).';

-- -----------------------------------------------------------------------------
-- snapshot_outcome_link   (A.2)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_outcome_link (
  id                              bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on            date        NOT NULL,
  match_snapshot_id               bigint      NOT NULL,
  outcome_dimension_code          text        NOT NULL,
  revision_ordinal                integer     NOT NULL,
  outcome_derivation_version_id   bigint      NOT NULL,
  result_id                       bigint      NOT NULL,
  outcome_value                   text        NOT NULL,
  linked_at                       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_snapshot_outcome_link PRIMARY KEY (id, fixture_partition_on),

  -- A.2 / R-04: business identity gains the revision ordinal.
  CONSTRAINT uq_snapshot_outcome_link__snapshot_dimension_revision
    UNIQUE (fixture_partition_on, match_snapshot_id, outcome_dimension_code, revision_ordinal),

  CONSTRAINT fk_snapshot_outcome_link__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_outcome_link__result
    FOREIGN KEY (result_id, fixture_partition_on)
    REFERENCES football.result (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_outcome_link__dimension FOREIGN KEY (outcome_dimension_code)
    REFERENCES calibration.outcome_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_outcome_link__derivation_version
    FOREIGN KEY (outcome_derivation_version_id)
    REFERENCES calibration.outcome_derivation_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_outcome_link__ordinal_non_negative CHECK (revision_ordinal >= 0)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_outcome_link IS
  'E4.08 Snapshot Outcome Link. ADDITIVE ONLY — attaches alongside the snapshot and modifies nothing within it. This is the one permitted post-sealing act, permitted because it adds a fact about the world rather than altering a claim about it.
   A.2 / R-04-R-06: identity includes a REVISION ORDINAL. Ordinal zero is the original linkage; higher ordinals are successive revisions. THE RELATION CARRIES NO CURRENCY MARKER: the prevailing link is the row bearing the HIGHEST ORDINAL for a snapshot and dimension, and supersession is expressed by a higher ordinal existing.
   Ordinal succession is used rather than a marker column because setting a marker at supersession would be an UPDATE TO A SEALED ROW, and no exception to the insert-only posture is granted anywhere in this schema (R-23). It also requires no predicate, so the prohibition on partial unique indexes over partitioned relations does not arise (A.2, F-03).';

CREATE TABLE snapshot.snapshot_outcome_link_currency (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on        date        NOT NULL,
  match_snapshot_id           bigint      NOT NULL,
  outcome_dimension_code      text        NOT NULL,
  superseded_ordinal          integer     NOT NULL,
  superseding_ordinal         integer     NOT NULL,
  superseded_at               timestamptz NOT NULL DEFAULT now(),
  supersession_reason         text        NOT NULL,
  result_revision_id          bigint,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_outcome_link_currency PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_outcome_link_currency__snapshot_dimension_superseded
    UNIQUE (fixture_partition_on, match_snapshot_id, outcome_dimension_code, superseded_ordinal),
  CONSTRAINT fk_snapshot_outcome_link_currency__superseded
    FOREIGN KEY (fixture_partition_on, match_snapshot_id, outcome_dimension_code, superseded_ordinal)
    REFERENCES snapshot.snapshot_outcome_link
      (fixture_partition_on, match_snapshot_id, outcome_dimension_code, revision_ordinal)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_snapshot_outcome_link_currency__superseding
    FOREIGN KEY (fixture_partition_on, match_snapshot_id, outcome_dimension_code, superseding_ordinal)
    REFERENCES snapshot.snapshot_outcome_link
      (fixture_partition_on, match_snapshot_id, outcome_dimension_code, revision_ordinal)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_outcome_link_currency__ordinals_ordered
    CHECK (superseding_ordinal > superseded_ordinal)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_outcome_link_currency IS
  'A.2 / R-07. APPEND-ONLY audit of supersession, carrying the superseded_at semantics without requiring any update to a sealed row. Records the superseded ordinal, the superseding ordinal, the instant, and the reason — ordinarily a result revision.
   R-08: a revision link and its currency transition row are inserted IN ONE TRANSACTION, so the prevailing link and its audit are always consistent.';

-- -----------------------------------------------------------------------------
-- Monthly partitions for the whole co-partitioned sealed family
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  rel   text;
  d     date;
  d_end date;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'match_snapshot','snapshot_version_component','snapshot_feature_state',
    'snapshot_module_reading','snapshot_verdict','snapshot_model_output',
    'snapshot_completeness','snapshot_completeness_item',
    'snapshot_outcome_link','snapshot_outcome_link_currency'
  ]
  LOOP
    d := date '2024-01-01';
    WHILE d < date '2029-01-01' LOOP
      d_end := (d + interval '1 month')::date;
      EXECUTE format(
        'CREATE TABLE snapshot.%I PARTITION OF snapshot.%I FOR VALUES FROM (%L) TO (%L)',
        rel || '_p' || to_char(d, 'YYYYMM'), rel, d, d_end);
      EXECUTE format('ALTER TABLE snapshot.%I OWNER TO pt_owner', rel || '_p' || to_char(d, 'YYYYMM'));
      d := d_end;
    END LOOP;
    EXECUTE format('CREATE TABLE snapshot.%I PARTITION OF snapshot.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE snapshot.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

-- REVISION 2 (P-01): snapshot_verdict is now included in the co-partitioned
-- family above. Every relation in this schema is monthly range-partitioned on
-- fixture_partition_on with identical boundaries, which is what permits the
-- partition-wise assembly the match-intelligence read path depends upon.

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'match_snapshot','snapshot_version_component','snapshot_feature_state',
    'snapshot_module_reading','snapshot_verdict','snapshot_model_output',
    'snapshot_completeness','snapshot_completeness_item',
    'snapshot_outcome_link','snapshot_outcome_link_currency'
  ]
  LOOP
    EXECUTE format('ALTER TABLE snapshot.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;
