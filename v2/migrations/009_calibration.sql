-- =============================================================================
-- 009_calibration.sql
-- REVISION 2
-- PitchTerminal V2 — Calibration and canonical model designation
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 9, A.8, A.11
-- Depends on      : 001–008
-- Transactional   : yes
--
-- Purpose
--   Creates the measurement apparatus. The previous platform built good
--   machinery — point-in-time archives, formula version on the archive, strict
--   and lenient scoring, Wilson intervals, explicit sample gates, per-competition
--   segmentation — and applied it to ONE of the models it shipped. Here every
--   sealed claim is measurable.
--
-- Rules applied
--   LC-135  A calibration series is KEYED BY MODULE VERSION. Without this, a
--           rule change silently mixes two rules into one statistic.
--   LC-123  Results ACCUMULATE AS A SERIES; a new measurement never replaces an
--           earlier one. The previous platform retained only the latest
--           evaluation per rule, discarding the trajectory of measured
--           reliability — arguably the most interesting signal it produced.
--   R-34    Canonical model periods do not overlap per output type — EXCLUDE
--           USING gist, requiring btree_gist
--   R-46    published_baseline carries a redundant unique constraint over its
--           key and module version, serving the composite reference from
--           module_reading that replaces the baseline-matching trigger
-- =============================================================================

-- -----------------------------------------------------------------------------
-- measurement_population
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.measurement_population (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  population_key            text        NOT NULL,
  display_name              text        NOT NULL,
  fixture_period            daterange   NOT NULL,
  competition_id            bigint,
  snapshot_point_code       text        NOT NULL,
  completeness_threshold    numeric     NOT NULL,
  includes_reconstructed    boolean     NOT NULL DEFAULT false,
  definition_text           text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_measurement_population              PRIMARY KEY (id),
  CONSTRAINT uq_measurement_population__key         UNIQUE (population_key),
  CONSTRAINT fk_measurement_population__competition FOREIGN KEY (competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_measurement_population__point       FOREIGN KEY (snapshot_point_code)
    REFERENCES football.snapshot_point (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_measurement_population__threshold_bounded
    CHECK (completeness_threshold BETWEEN 0 AND 1),
  CONSTRAINT ck_measurement_population__period_bounded CHECK (NOT isempty(fixture_period))
);
COMMENT ON TABLE calibration.measurement_population IS
  'E7.05 Measurement Population. A reliability figure is meaningless without its population, and the population must be REPRODUCIBLE — a measurement nobody can repeat is an assertion. Sealed once referenced by a run.';
COMMENT ON COLUMN calibration.measurement_population.completeness_threshold IS
  'LC-130. Stating the threshold matters: a population including badly-incomplete snapshots measures something different from one excluding them, and the difference must be visible rather than buried in whoever ran the measurement.';
COMMENT ON COLUMN calibration.measurement_population.includes_reconstructed IS
  'Reconstructed history and recorded history are different claims. A population mixing them without saying so would misstate what was measured (LC-127, §B.8.5 stage 21).';

-- -----------------------------------------------------------------------------
-- sample_gate
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.sample_gate (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  gate_key                  text        NOT NULL,
  module_definition_id      bigint,
  minimum_observation_count integer     NOT NULL,
  applies_to_pooled         boolean     NOT NULL DEFAULT false,
  effective_period          tstzrange   NOT NULL,
  rationale                 text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_sample_gate                  PRIMARY KEY (id),
  CONSTRAINT uq_sample_gate__key             UNIQUE (gate_key),
  CONSTRAINT fk_sample_gate__module          FOREIGN KEY (module_definition_id)
    REFERENCES module.module_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_sample_gate__minimum_positive CHECK (minimum_observation_count >= 1),
  CONSTRAINT ex_sample_gate__periods_do_not_overlap
    EXCLUDE USING gist (gate_key WITH =, effective_period WITH &&)
);
COMMENT ON TABLE calibration.sample_gate IS
  'E7.07 Sample Gate. The platform''s evidential standard is a product commitment, and a commitment enforced by editorial judgement is enforced inconsistently. EVERY PUBLISHED RATE PASSES A DECLARED GATE OR IS MARKED UNVERIFIED — there is no third path (LC-133).';

-- -----------------------------------------------------------------------------
-- calibration_series
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.calibration_series (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  module_version_id         bigint      NOT NULL,
  band_code                 text        NOT NULL,
  outcome_dimension_code    text        NOT NULL,
  context_kind_code         text        NOT NULL,
  context_competition_id    bigint,
  snapshot_point_code       text        NOT NULL,
  measurement_population_id bigint      NOT NULL,
  opened_at                 timestamptz NOT NULL DEFAULT now(),
  closed_at                 timestamptz,
  CONSTRAINT pk_calibration_series PRIMARY KEY (id),
  CONSTRAINT uq_calibration_series__identity
    UNIQUE (module_version_id, band_code, outcome_dimension_code,
            context_kind_code, context_competition_id, snapshot_point_code),
  CONSTRAINT fk_calibration_series__module_version FOREIGN KEY (module_version_id)
    REFERENCES module.module_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_series__dimension FOREIGN KEY (outcome_dimension_code)
    REFERENCES calibration.outcome_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_series__context_kind FOREIGN KEY (context_kind_code)
    REFERENCES football.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_series__competition FOREIGN KEY (context_competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_series__point FOREIGN KEY (snapshot_point_code)
    REFERENCES football.snapshot_point (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_series__population FOREIGN KEY (measurement_population_id)
    REFERENCES calibration.measurement_population (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_calibration_series__context_competition_conditional CHECK (
    (context_kind_code =  'COMPETITION_SCOPED' AND context_competition_id IS NOT NULL) OR
    (context_kind_code <> 'COMPETITION_SCOPED' AND context_competition_id IS NULL)
  )
);
COMMENT ON TABLE calibration.calibration_series IS
  'E7.08 Calibration Series — the continuous measurement line for one thing being measured. KEYED BY MODULE VERSION (LC-135): revising a module CLOSES its series and OPENS a new one, so the two are separately measured over comparable populations and the revision''s value becomes a measurement rather than an assertion. Never deleted, including closed series for retired versions (LC-136).';

-- -----------------------------------------------------------------------------
-- calibration_run
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.calibration_run (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  run_key                   text        NOT NULL,
  measurement_population_id bigint      NOT NULL,
  calibration_version_id    bigint      NOT NULL,
  pipeline_job_run_id       bigint,
  pipeline_job_run_occurred_at timestamptz,
  started_at                timestamptz NOT NULL,
  completed_at              timestamptz,
  outcome                   text        NOT NULL,
  CONSTRAINT pk_calibration_run          PRIMARY KEY (id),
  CONSTRAINT uq_calibration_run__run_key UNIQUE (run_key),
  CONSTRAINT fk_calibration_run__population FOREIGN KEY (measurement_population_id)
    REFERENCES calibration.measurement_population (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_run__version FOREIGN KEY (calibration_version_id)
    REFERENCES calibration.calibration_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_calibration_run__outcome_known CHECK (outcome IN ('RUNNING','SUCCEEDED','FAILED'))
);
COMMENT ON TABLE calibration.calibration_run IS
  'E7.01 Calibration Run. One act of measurement, sealed on completion. A reliability figure that cannot name the population it was taken over, or the rule version it measured, is not evidence.';
COMMENT ON COLUMN calibration.calibration_run.pipeline_job_run_id IS
  'Execution attribution. The foreign key to operations.pipeline_job_run is added in migration 014, operations being created later in the ordering. Note that a job run referenced by calibration or by a sealed artefact is retained PERMANENTLY regardless of operational retention (§B.9.4).';
COMMENT ON COLUMN calibration.calibration_run.pipeline_job_run_occurred_at IS
  'REVISION 2 (P-04). operations.pipeline_job_run is range-partitioned on its own occurred_at, so the reference to it must be composite over ITS key (A.1, R-01). This column carries the job run''s own instant, not an instant belonging to this row. Declared here rather than added by ALTER in migration 014 so that the relation is created in its final shape and the file remains re-runnable.';

-- -----------------------------------------------------------------------------
-- calibration_result
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.calibration_result (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  calibration_run_id      bigint      NOT NULL,
  calibration_series_id   bigint      NOT NULL,
  band_code               text        NOT NULL,
  observation_count       integer     NOT NULL,
  hit_count               integer     NOT NULL,
  hit_rate                numeric     NOT NULL,
  baseline_rate           numeric     NOT NULL,
  lift                    numeric     NOT NULL,
  interval_low            numeric,
  interval_high           numeric,
  interval_suppressed     boolean     NOT NULL DEFAULT false,
  sample_gate_id          bigint,
  meets_sample_gate       boolean     NOT NULL,
  measured_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_calibration_result PRIMARY KEY (id),
  CONSTRAINT uq_calibration_result__run_series_band
    UNIQUE (calibration_run_id, calibration_series_id, band_code),
  CONSTRAINT fk_calibration_result__run FOREIGN KEY (calibration_run_id)
    REFERENCES calibration.calibration_run (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_result__series FOREIGN KEY (calibration_series_id)
    REFERENCES calibration.calibration_series (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_calibration_result__gate FOREIGN KEY (sample_gate_id)
    REFERENCES calibration.sample_gate (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_calibration_result__counts_non_negative
    CHECK (observation_count >= 0 AND hit_count >= 0 AND hit_count <= observation_count),
  CONSTRAINT ck_calibration_result__rates_bounded
    CHECK (hit_rate BETWEEN 0 AND 1 AND baseline_rate BETWEEN 0 AND 1),
  CONSTRAINT ck_calibration_result__interval_paired
    CHECK ((interval_low IS NULL) = (interval_high IS NULL)),
  CONSTRAINT ck_calibration_result__interval_ordered
    CHECK (interval_low IS NULL OR interval_low <= interval_high),
  -- LC-132: a pooled observation count cannot support a per-band interval, and
  -- drawing one would be falsely narrow.
  CONSTRAINT ck_calibration_result__suppressed_has_no_interval
    CHECK (NOT interval_suppressed OR (interval_low IS NULL AND interval_high IS NULL))
);
COMMENT ON TABLE calibration.calibration_result IS
  'E7.02 Calibration Result. Sealed on write and ACCUMULATING AS A TIME SERIES (LC-123). Ten monthly runs produce ten results within one series, showing a module''s measured rate moving as its sample grows. The previous platform would have retained the tenth and destroyed the other nine — so whether a module was improving or degrading was unanswerable.';
COMMENT ON COLUMN calibration.calibration_result.interval_suppressed IS
  'LC-132. The previous platform correctly suppressed an interval where the observation count was pooled across bands rather than specific to one. That discipline is inherited as a constraint.';

-- -----------------------------------------------------------------------------
-- published_baseline
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.published_baseline (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  calibration_result_id       bigint      NOT NULL,
  module_version_id           bigint      NOT NULL,
  band_code                   text        NOT NULL,
  outcome_dimension_code      text        NOT NULL,
  context_kind_code           text        NOT NULL,
  context_competition_id      bigint,
  is_pooled                   boolean     NOT NULL,
  is_verified                 boolean     NOT NULL,
  measurement_provenance      text        NOT NULL,
  effective_period            tstzrange   NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_published_baseline PRIMARY KEY (id),

  -- R-46: REDUNDANT UNIQUE CONSTRAINT. The target of module_reading's composite
  -- foreign key, which enforces that a reading cites a baseline at its OWN
  -- module version — declaratively, with no trigger and no extra column.
  CONSTRAINT uq_published_baseline__id_module_version UNIQUE (id, module_version_id),

  CONSTRAINT fk_published_baseline__result FOREIGN KEY (calibration_result_id)
    REFERENCES calibration.calibration_result (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_published_baseline__module_version FOREIGN KEY (module_version_id)
    REFERENCES module.module_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_published_baseline__dimension FOREIGN KEY (outcome_dimension_code)
    REFERENCES calibration.outcome_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_published_baseline__context_kind FOREIGN KEY (context_kind_code)
    REFERENCES football.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_published_baseline__competition FOREIGN KEY (context_competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_published_baseline__provenance_known
    CHECK (measurement_provenance IN ('POINT_IN_TIME','CONTAMINATED_LOOKAHEAD')),
  CONSTRAINT ex_published_baseline__no_overlapping_publication
    EXCLUDE USING gist (module_version_id WITH =, band_code WITH =,
                        outcome_dimension_code WITH =, effective_period WITH &&)
);
COMMENT ON TABLE calibration.published_baseline IS
  'E7.03 Published Baseline — the calibration result PROMOTED FOR USE. Append-only: a new promotion supersedes an earlier one by being later, and both persist, so a historical reading''s cited baseline remains resolvable (LC-124).';
COMMENT ON COLUMN calibration.published_baseline.is_verified IS
  'FALSE where the underlying result fails its sample gate. A baseline that fails its gate is published as EXPLICITLY UNVERIFIED, never as a clean rate (LC-126). The previous platform''s own design contract required exactly this behaviour; here it is a stored fact rather than a rendering convention.';
COMMENT ON COLUMN calibration.published_baseline.measurement_provenance IS
  'LC-127. The previous platform marked one cohort as containing lookahead, because finished fixtures had been scored using then-current form. THAT MARKING MUST SURVIVE MIGRATION — a figure''s trustworthiness is not recoverable from the figure.';
COMMENT ON CONSTRAINT uq_published_baseline__id_module_version ON calibration.published_baseline IS
  'A.11 / R-46. Redundant unique constraint whose sole purpose is to serve module_reading''s composite reference. It expresses no additional identity; it exists to make a composite reference declarable (§B.3.3).';

-- -----------------------------------------------------------------------------
-- model_canonical_designation   (A.8 / R-33, R-34)
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.model_canonical_designation (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  output_type_code      text        NOT NULL,
  model_version_id      bigint      NOT NULL,
  canonical_period      tstzrange   NOT NULL,
  rationale             text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_model_canonical_designation PRIMARY KEY (id),
  CONSTRAINT fk_model_canonical_designation__output_type FOREIGN KEY (output_type_code)
    REFERENCES module.model_output_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_model_canonical_designation__model_version FOREIGN KEY (model_version_id)
    REFERENCES module.model_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_model_canonical_designation__period_bounded CHECK (NOT isempty(canonical_period)),
  -- R-34: at most one canonical model per output type at any instant.
  CONSTRAINT ex_model_canonical_designation__no_overlap_per_output_type
    EXCLUDE USING gist (output_type_code WITH =, canonical_period WITH &&)
);
COMMENT ON TABLE calibration.model_canonical_designation IS
  'A.8 / R-33. Canonical designation lives HERE, effective-dated, not on the sealed output row.
   Two reasons. First, a partial unique index is unavailable on a partitioned relation, so the original per-row construction was uncreatable. Second, and more fundamentally, canonicity is a property of the MODEL at a point in time, not of an individual sealed output — which is what E4.06 states when it says the designation is data changeable without redefinition of anything else.
   R-35: canonicity of a historical output resolves by its SNAPSHOT''S AS-OF instant, so a change of canonical model does not retroactively alter which output was canonical when a claim was made.';
COMMENT ON CONSTRAINT ex_model_canonical_designation__no_overlap_per_output_type ON calibration.model_canonical_designation IS
  'R-34. Requires btree_gist (R-54, R-55 item 6).';

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'measurement_population','sample_gate','calibration_series','calibration_run',
    'calibration_result','published_baseline','model_canonical_designation'
  ]
  LOOP
    EXECUTE format('ALTER TABLE calibration.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;
