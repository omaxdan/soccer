-- =============================================================================
-- 008_module_storage.sql
-- PitchTerminal V2 — Module registry, readings and evidence
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 8, A.11
-- Depends on      : 001–007
-- Transactional   : yes
--
-- Purpose
--   Creates the module engine: modules as DATA, with stored readings and
--   relational evidence.
--
-- Deferred references
--   Two foreign keys cross into schemas created later and are added in
--   migration 014 (§B.8.5 stage 11):
--     module_reading      -> calibration.published_baseline  (composite, A.11)
--     module_evidence_item -> feature.feature_value           (composite, R-01)
--   The second is a CROSS-PARTITIONING-SCHEME reference and is created NOT VALID
--   with resumable per-partition validation (F-25).
--
-- Rules applied
--   LC-50   A module definition's QUESTION is permanently fixed once readings
--           exist; a module answering a different question is a different module
--   LC-51   A display number is never reused
--   R-46    Baseline version matching is a COMPOSITE FOREIGN KEY, not a trigger
--   LC-64   Evidence is RELATIONAL, never opaque serialised content
-- =============================================================================

-- -----------------------------------------------------------------------------
-- module_definition
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_definition (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  module_key              text        NOT NULL,
  display_number          integer     NOT NULL,
  display_name            text        NOT NULL,
  question                text        NOT NULL,
  subject_kind_code       text        NOT NULL,
  entitlement_feature_key text        NOT NULL,
  calibration_mode_code   text        NOT NULL,
  outcome_dimension_code  text,
  is_active               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_module_definition                     PRIMARY KEY (id),
  CONSTRAINT uq_module_definition__module_key         UNIQUE (module_key),
  CONSTRAINT uq_module_definition__display_number     UNIQUE (display_number),
  CONSTRAINT uq_module_definition__id_subject_kind    UNIQUE (id, subject_kind_code),
  CONSTRAINT fk_module_definition__subject_kind       FOREIGN KEY (subject_kind_code)
    REFERENCES feature.subject_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_definition__calibration_mode   FOREIGN KEY (calibration_mode_code)
    REFERENCES module.calibration_mode (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_definition__outcome_dimension  FOREIGN KEY (outcome_dimension_code)
    REFERENCES calibration.outcome_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_module_definition__dimension_when_scored CHECK (
    (calibration_mode_code =  'OUTCOME_SCORED' AND outcome_dimension_code IS NOT NULL) OR
    (calibration_mode_code <> 'OUTCOME_SCORED' AND outcome_dimension_code IS NULL)
  ),
  CONSTRAINT ck_module_definition__display_number_positive CHECK (display_number >= 1)
);
COMMENT ON TABLE module.module_definition IS
  'E3.02 Module Definition. Modules become DATA. In the previous platform, adding a module required roughly eleven coordinated changes because five separate places had to be kept in agreement by hand: the registry file, the entitlement union, the permission record, the backing view, and the query layer. Here it is a registry row plus a calculator.';
COMMENT ON CONSTRAINT uq_module_definition__display_number ON module.module_definition IS
  'LC-51. A display number is quoted in support and in published material and is NEVER reused. Uniqueness is permanent, including for retired modules.';
COMMENT ON COLUMN module.module_definition.question IS
  'The single question this module answers. Permanently fixed once readings exist (LC-50) — the strictest declaration in the layer, because the question is a product commitment and a module quietly redefined would invalidate every calibration measurement taken against it.';
COMMENT ON COLUMN module.module_definition.entitlement_feature_key IS
  'A module DECLARES its entitlement requirement; entitlement does not enumerate modules (LC-149). The foreign key to product.entitlement_feature is added in migration 014, product being created later in the ordering. This is a reference to a governed vocabulary, not a dependency on product behaviour: the module engine resolves no entitlement and reads no subscription.';

-- -----------------------------------------------------------------------------
-- module_version
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_version (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  module_definition_id  bigint      NOT NULL,
  designation           text        NOT NULL,
  effective_period      tstzrange   NOT NULL,
  predecessor_id        bigint,
  rationale             text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_module_version                        PRIMARY KEY (id),
  CONSTRAINT uq_module_version__definition_designation UNIQUE (module_definition_id, designation),
  CONSTRAINT uq_module_version__id_definition         UNIQUE (id, module_definition_id),
  CONSTRAINT fk_module_version__definition            FOREIGN KEY (module_definition_id)
    REFERENCES module.module_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_version__predecessor           FOREIGN KEY (predecessor_id)
    REFERENCES module.module_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_module_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_module_version__periods_do_not_overlap
    EXCLUDE USING gist (module_definition_id WITH =, effective_period WITH &&)
);
COMMENT ON TABLE module.module_version IS
  'E3.02a Module Version. CALIBRATION SERIES ARE KEYED BY THIS (LC-53, LC-135). Without version identity a measured reliability figure spans two rules and describes a system that never existed — the precise failure the platform''s evidential positioning cannot tolerate.';

-- -----------------------------------------------------------------------------
-- module_reading
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_reading (
  id                            bigint      GENERATED ALWAYS AS IDENTITY,
  as_of                         timestamptz NOT NULL,
  calculated_at                 timestamptz NOT NULL DEFAULT now(),

  module_definition_id          bigint      NOT NULL,
  module_version_id             bigint      NOT NULL,

  subject_kind_code             text        NOT NULL,
  subject_team_id               bigint,
  subject_player_id             bigint,
  subject_fixture_id            bigint,
  subject_fixture_partition_on  date,
  subject_competition_edition_id bigint,

  context_kind_code             text        NOT NULL,
  context_competition_edition_id bigint,

  module_status_code            text        NOT NULL,
  strength                      numeric,
  confidence                    numeric,
  sample_observation_count      integer     NOT NULL,
  sample_meets_threshold        boolean     NOT NULL,

  -- Baseline reference (A.11 / R-46). The FK is composite over the baseline key
  -- and THIS READING'S OWN module version, added in migration 014.
  published_baseline_id         bigint,

  -- Value objects held as column groups on the owning relation (§5.4.3).
  headline_text                 text,
  verdict_text                  text,

  CONSTRAINT pk_module_reading PRIMARY KEY (id, as_of),
  CONSTRAINT uq_module_reading__subject_context_definition_asof_version
    UNIQUE (subject_kind_code, subject_team_id, subject_player_id,
            subject_fixture_id, subject_fixture_partition_on,
            subject_competition_edition_id,
            context_kind_code, context_competition_edition_id,
            module_definition_id, as_of, module_version_id),
  CONSTRAINT uq_module_reading__id_as_of UNIQUE (id, as_of),

  CONSTRAINT fk_module_reading__version_definition
    FOREIGN KEY (module_version_id, module_definition_id)
    REFERENCES module.module_version (id, module_definition_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__definition_subject_kind
    FOREIGN KEY (module_definition_id, subject_kind_code)
    REFERENCES module.module_definition (id, subject_kind_code)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__status FOREIGN KEY (module_status_code)
    REFERENCES module.module_status (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__subject_team FOREIGN KEY (subject_team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__subject_player FOREIGN KEY (subject_player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__subject_fixture
    FOREIGN KEY (subject_fixture_id, subject_fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__subject_edition FOREIGN KEY (subject_competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading__context_edition FOREIGN KEY (context_competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT ck_module_reading__subject_exclusive CHECK (
    (subject_kind_code = 'TEAM'   AND subject_team_id IS NOT NULL
       AND subject_player_id IS NULL AND subject_fixture_id IS NULL
       AND subject_fixture_partition_on IS NULL AND subject_competition_edition_id IS NULL) OR
    (subject_kind_code = 'PLAYER' AND subject_player_id IS NOT NULL
       AND subject_team_id IS NULL AND subject_fixture_id IS NULL
       AND subject_fixture_partition_on IS NULL AND subject_competition_edition_id IS NULL) OR
    (subject_kind_code = 'FIXTURE' AND subject_fixture_id IS NOT NULL
       AND subject_fixture_partition_on IS NOT NULL
       AND subject_team_id IS NULL AND subject_player_id IS NULL
       AND subject_competition_edition_id IS NULL) OR
    (subject_kind_code = 'COMPETITION_EDITION' AND subject_competition_edition_id IS NOT NULL
       AND subject_team_id IS NULL AND subject_player_id IS NULL
       AND subject_fixture_id IS NULL AND subject_fixture_partition_on IS NULL)
  ),
  CONSTRAINT ck_module_reading__context_edition_conditional CHECK (
    (context_kind_code =  'COMPETITION_SCOPED' AND context_competition_edition_id IS NOT NULL) OR
    (context_kind_code <> 'COMPETITION_SCOPED' AND context_competition_edition_id IS NULL)
  ),
  CONSTRAINT ck_module_reading__sample_non_negative CHECK (sample_observation_count >= 0),
  CONSTRAINT ck_module_reading__confidence_bounded
    CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  -- An INACTIVE reading had insufficient data to speak, so it carries no
  -- strength and cites no baseline. NEUTRAL is distinct: the module spoke.
  CONSTRAINT ck_module_reading__inactive_is_silent CHECK (
    module_status_code <> 'INACTIVE'
    OR (strength IS NULL AND published_baseline_id IS NULL)
  )
) PARTITION BY RANGE (as_of);

COMMENT ON TABLE module.module_reading IS
  'E3.03 Module Reading. What one module says about one subject, in one context, at one moment, under one version. Structurally parallel to feature_value, deliberately: the two layers share one temporal, contextual, versioned identity discipline.
   In the previous platform NO module output was stored at all — readings were recomputed on demand and existed only for the instant they were displayed, which is why per-module reliability could never be measured.';
COMMENT ON COLUMN module.module_reading.sample_observation_count IS
  'NEVER OPTIONAL (LC-60). The platform''s evidential standard — a rate without an observation count is a marketing figure, not evidence — is enforceable only if the count travels with the reading.';
COMMENT ON COLUMN module.module_reading.verdict_text IS
  'E3.09 MODULE Verdict — this module''s own plain conclusion. DISTINCT from the SNAPSHOT verdict (E4.05), which is the canonical product output across all modules. No column exists anywhere for a recommended action, stake, or selection (LC-71).';

-- -----------------------------------------------------------------------------
-- module_evidence
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_evidence (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  reading_as_of               timestamptz NOT NULL,
  module_reading_id           bigint      NOT NULL,
  declared_input_count        integer     NOT NULL,
  present_input_count         integer     NOT NULL,
  below_threshold_input_count integer     NOT NULL DEFAULT 0,
  estimated_input_count       integer     NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_module_evidence PRIMARY KEY (id, reading_as_of),
  CONSTRAINT uq_module_evidence__reading UNIQUE (module_reading_id, reading_as_of),
  CONSTRAINT uq_module_evidence__id_as_of UNIQUE (id, reading_as_of),
  CONSTRAINT fk_module_evidence__reading
    FOREIGN KEY (module_reading_id, reading_as_of)
    REFERENCES module.module_reading (id, as_of) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_module_evidence__counts_non_negative CHECK (
    declared_input_count >= 0 AND present_input_count >= 0
    AND below_threshold_input_count >= 0 AND estimated_input_count >= 0
  ),
  CONSTRAINT ck_module_evidence__present_within_declared
    CHECK (present_input_count <= declared_input_count)
) PARTITION BY RANGE (reading_as_of);

COMMENT ON TABLE module.module_evidence IS
  'E3.04 Module Evidence — the collective construct, distinct from the items within it. Evidence has SET-LEVEL properties belonging to no individual item: how many features contributed, whether any fell below threshold, whether any were estimated, whether every declared input was present. Those properties are what a reading''s confidence rests on, and what completeness reporting consumes (LC-62).';
COMMENT ON CONSTRAINT uq_module_evidence__reading ON module.module_evidence IS
  'LC-61. Exactly one evidence set per reading.';

-- -----------------------------------------------------------------------------
-- module_evidence_item
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_evidence_item (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  reading_as_of             timestamptz NOT NULL,
  module_evidence_id        bigint      NOT NULL,
  cited_feature_value_id    bigint      NOT NULL,
  cited_feature_value_as_of timestamptz NOT NULL,
  contribution_direction    text        NOT NULL,
  contribution_weight       numeric,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_module_evidence_item PRIMARY KEY (id, reading_as_of),
  CONSTRAINT uq_module_evidence_item__evidence_cited_value
    UNIQUE (module_evidence_id, reading_as_of, cited_feature_value_id, cited_feature_value_as_of),
  CONSTRAINT fk_module_evidence_item__evidence
    FOREIGN KEY (module_evidence_id, reading_as_of)
    REFERENCES module.module_evidence (id, reading_as_of) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_module_evidence_item__direction_known
    CHECK (contribution_direction IN ('SUPPORTS','CONTRADICTS','NEUTRAL')),
  CONSTRAINT ck_module_evidence_item__cited_not_after_reading
    CHECK (cited_feature_value_as_of <= reading_as_of)
) PARTITION BY RANGE (reading_as_of);

COMMENT ON TABLE module.module_evidence_item IS
  'E3.05 Module Evidence Item — one feature value''s contribution to one reading. THE EXPLAINABILITY SUBSTRATE.
   Replaces three parallel, unconnected representations in the previous platform: a relational signal structure whose identity rule permitted a single entry per market per fixture, and two serialised collections holding risk factors and opportunity signals as opaque content. Relational evidence makes three things possible that serialisation cannot: querying which features most often drive a module''s readings, explaining a historical reading without re-running it, and detecting that a module''s inputs had gone stale when it spoke (LC-64).';
COMMENT ON COLUMN module.module_evidence_item.cited_feature_value_as_of IS
  'R-01. Carried because feature_value is partitioned and the reference must be composite. It also makes the temporal ordering check on this relation a same-row comparison.';
COMMENT ON CONSTRAINT ck_module_evidence_item__cited_not_after_reading ON module.module_evidence_item IS
  'A reading cannot cite evidence from its own future. Same rule as A.3 applied one layer down.';

-- -----------------------------------------------------------------------------
-- Initial monthly partitions
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  spec  text[][] := ARRAY[['module_reading','as_of'],['module_evidence','reading_as_of'],['module_evidence_item','reading_as_of']];
  i     integer;
  rel   text;
  d     date;
  d_end date;
BEGIN
  FOR i IN 1..array_length(spec, 1) LOOP
    rel := spec[i][1];
    d := date '2024-01-01';
    WHILE d < date '2029-01-01' LOOP
      d_end := (d + interval '1 month')::date;
      EXECUTE format(
        'CREATE TABLE module.%I PARTITION OF module.%I FOR VALUES FROM (%L) TO (%L)',
        rel || '_p' || to_char(d, 'YYYYMM'), rel, d, d_end);
      EXECUTE format('ALTER TABLE module.%I OWNER TO pt_owner', rel || '_p' || to_char(d, 'YYYYMM'));
      d := d_end;
    END LOOP;
    EXECUTE format('CREATE TABLE module.%I PARTITION OF module.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE module.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
ALTER TABLE module.module_definition    OWNER TO pt_owner;
ALTER TABLE module.module_version       OWNER TO pt_owner;
ALTER TABLE module.module_reading       OWNER TO pt_owner;
ALTER TABLE module.module_evidence      OWNER TO pt_owner;
ALTER TABLE module.module_evidence_item OWNER TO pt_owner;
