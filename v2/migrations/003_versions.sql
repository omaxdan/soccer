-- =============================================================================
-- 003_versions.sql
-- PitchTerminal V2 — Version registries
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 3, §5.16.1
-- Depends on      : 001, 002
-- Transactional   : yes
--
-- Purpose
--   Creates every version line. Version identity is realised EXCLUSIVELY as a
--   foreign key to one of these registries. No relation anywhere in the design
--   carries a version designation as text (PR-05, C-07).
--
-- Rules applied
--   R-25          Registration precedes use. A calculated row referencing an
--                 unregistered version is rejected by foreign key.
--   §5.16.1       Every registry shares one structure: the entity whose rule it
--                 versions, a designation, an effective period, a predecessor
--                 reference, and a rationale.
--   §5.9.5        Effective periods within one registry entry do not overlap —
--                 enforced by EXCLUDE, which is why btree_gist is required.
--
-- Placement note
--   The rule version lines that are neither feature-specific nor module-specific
--   — model, verdict composition, consensus, checksum algorithm — are held in
--   the module schema because module calculation is the process that applies
--   them and that seals snapshots. This keeps snapshot -> module, a reference
--   direction already established by snapshot_module_reading (§5.3.3), and adds
--   no new cross-schema direction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- feature.feature_calculator — declared owner of one or more definitions
-- -----------------------------------------------------------------------------
-- Created here rather than in 006 because feature_version references it for
-- implementation attribution, and 006 references it in turn.

CREATE TABLE feature.feature_calculator (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  calculator_key          text        NOT NULL,
  display_name            text        NOT NULL,
  implementation_version  text        NOT NULL,
  description             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_calculator                PRIMARY KEY (id),
  CONSTRAINT uq_feature_calculator__calculator_key UNIQUE (calculator_key)
);
COMMENT ON TABLE feature.feature_calculator IS
  'E2.04 Feature Calculator. Makes single ownership a modelled fact rather than an observed convention. Exactly one calculator owns any given definition (LC-28).';
COMMENT ON COLUMN feature.feature_calculator.implementation_version IS
  'Distinct from the feature versions this calculator produces. A calculator may be reimplemented without the rule changing, and the two must be separable (§5.16.6).';

-- -----------------------------------------------------------------------------
-- Version registries
-- -----------------------------------------------------------------------------
-- feature.feature_version is created in 006 alongside feature_definition,
-- because it references that relation and the two are meaningless apart.

CREATE TABLE module.model (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  model_key       text        NOT NULL,
  display_name    text        NOT NULL,
  output_type_code text       NOT NULL,
  description     text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_model                     PRIMARY KEY (id),
  CONSTRAINT uq_model__model_key          UNIQUE (model_key),
  CONSTRAINT fk_model__model_output_type  FOREIGN KEY (output_type_code)
    REFERENCES module.model_output_type (code) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE module.model IS
  'A named probabilistic model. Several models may produce the same output type — this is legitimate and useful. Exactly one is canonical per output type at any instant, designated in calibration.model_canonical_designation (A.8).';

CREATE TABLE module.model_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  model_id          bigint      NOT NULL,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_model_version                    PRIMARY KEY (id),
  CONSTRAINT uq_model_version__model_designation UNIQUE (model_id, designation),
  CONSTRAINT uq_model_version__id_model          UNIQUE (id, model_id),
  CONSTRAINT fk_model_version__model             FOREIGN KEY (model_id)
    REFERENCES module.model (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_model_version__predecessor       FOREIGN KEY (predecessor_id)
    REFERENCES module.model_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_model_version__not_self_predecessor CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_model_version__periods_do_not_overlap
    EXCLUDE USING gist (model_id WITH =, effective_period WITH &&)
);
COMMENT ON TABLE module.model_version IS
  'Version identity for a probabilistic model. Sealed on registration; a registered version''s rule is fixed permanently (LC-26).';
COMMENT ON CONSTRAINT ex_model_version__periods_do_not_overlap ON module.model_version IS
  'Requires btree_gist for the scalar equality operator class (R-54).';

CREATE TABLE module.verdict_composition_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_verdict_composition_version              PRIMARY KEY (id),
  CONSTRAINT uq_verdict_composition_version__designation UNIQUE (designation),
  CONSTRAINT fk_verdict_composition_version__predecessor FOREIGN KEY (predecessor_id)
    REFERENCES module.verdict_composition_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_verdict_composition_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_verdict_composition_version__no_overlap
    EXCLUDE USING gist (effective_period WITH &&)
);
COMMENT ON TABLE module.verdict_composition_version IS
  'E4.05. How confidence is derived and how consensus is weighted are rules. Changing either changes what is published and begins a new calibration series (LC-92).';

CREATE TABLE module.consensus_rule_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_consensus_rule_version              PRIMARY KEY (id),
  CONSTRAINT uq_consensus_rule_version__designation UNIQUE (designation),
  CONSTRAINT fk_consensus_rule_version__predecessor FOREIGN KEY (predecessor_id)
    REFERENCES module.consensus_rule_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_consensus_rule_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_consensus_rule_version__no_overlap
    EXCLUDE USING gist (effective_period WITH &&)
);
COMMENT ON TABLE module.consensus_rule_version IS
  'E3.10. How dissent is weighted is a rule; changing it changes what is published (LC-74).';

CREATE TABLE module.checksum_algorithm_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  designation       text        NOT NULL,
  digest_algorithm  text        NOT NULL,
  canonical_form    text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_checksum_algorithm_version              PRIMARY KEY (id),
  CONSTRAINT uq_checksum_algorithm_version__designation UNIQUE (designation),
  CONSTRAINT fk_checksum_algorithm_version__predecessor FOREIGN KEY (predecessor_id)
    REFERENCES module.checksum_algorithm_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_checksum_algorithm_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_checksum_algorithm_version__no_overlap
    EXCLUDE USING gist (effective_period WITH &&)
);
COMMENT ON TABLE module.checksum_algorithm_version IS
  'A.6, R-24 / R-28. Each sealed snapshot names the algorithm version that produced its checksum, so historical checksums remain interpretable and existing rows are never recomputed under a new algorithm.';
COMMENT ON COLUMN module.checksum_algorithm_version.canonical_form IS
  'The deterministic serialisation order over which the digest is computed (R-25). Part of the algorithm; changing it is a new version.';

INSERT INTO module.checksum_algorithm_version (designation, digest_algorithm, canonical_form, effective_period, rationale)
VALUES ('v1', 'sha256',
        'Aggregate content serialised in the order: header, version manifest, feature state by cited value key, module readings by cited reading key, model outputs by model then output type, completeness items, verdict.',
        tstzrange(now(), NULL, '[)'),
        'Initial algorithm.');

CREATE TABLE calibration.calibration_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  interval_method   text        NOT NULL,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_calibration_version              PRIMARY KEY (id),
  CONSTRAINT uq_calibration_version__designation UNIQUE (designation),
  CONSTRAINT fk_calibration_version__predecessor FOREIGN KEY (predecessor_id)
    REFERENCES calibration.calibration_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_calibration_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_calibration_version__no_overlap
    EXCLUDE USING gist (effective_period WITH &&)
);
COMMENT ON TABLE calibration.calibration_version IS
  'E7.09. The measurement methodology is itself a rule. Changing the interval method changes every subsequent figure without any change to what is being measured — precisely the silent shift the platform''s evidential positioning cannot tolerate (LC-138).';

INSERT INTO calibration.calibration_version (designation, interval_method, effective_period, rationale)
VALUES ('v1', 'wilson', tstzrange(now(), NULL, '[)'),
        'Initial methodology. Wilson score interval for proportions, sound at small samples. Suppressed where the observation count is pooled across bands (LC-132).');

CREATE TABLE calibration.outcome_derivation_version (
  id                     bigint      GENERATED ALWAYS AS IDENTITY,
  outcome_dimension_code text        NOT NULL,
  designation            text        NOT NULL,
  effective_period       tstzrange   NOT NULL,
  predecessor_id         bigint,
  rationale              text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_outcome_derivation_version                 PRIMARY KEY (id),
  CONSTRAINT uq_outcome_derivation_version__dim_designation UNIQUE (outcome_dimension_code, designation),
  CONSTRAINT fk_outcome_derivation_version__dimension      FOREIGN KEY (outcome_dimension_code)
    REFERENCES calibration.outcome_dimension (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_outcome_derivation_version__predecessor    FOREIGN KEY (predecessor_id)
    REFERENCES calibration.outcome_derivation_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_outcome_derivation_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_outcome_derivation_version__no_overlap
    EXCLUDE USING gist (outcome_dimension_code WITH =, effective_period WITH &&)
);
COMMENT ON TABLE calibration.outcome_derivation_version IS
  'E7.04. Deriving a dimension from a result is itself a rule, and changing it changes every measurement taken against it.';

CREATE TABLE product.read_model_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  read_model_key    text        NOT NULL,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_read_model_version                 PRIMARY KEY (id),
  CONSTRAINT uq_read_model_version__key_designation UNIQUE (read_model_key, designation),
  CONSTRAINT fk_read_model_version__predecessor    FOREIGN KEY (predecessor_id)
    REFERENCES product.read_model_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_read_model_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_read_model_version__no_overlap
    EXCLUDE USING gist (read_model_key WITH =, effective_period WITH &&)
);
COMMENT ON TABLE product.read_model_version IS
  'E8.01. A read model is a versioned contract with its consumers; a changed shape is a changed contract (LC-142).';

CREATE TABLE operations.quality_check_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  quality_check_key text        NOT NULL,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_quality_check_version                 PRIMARY KEY (id),
  CONSTRAINT uq_quality_check_version__key_designation UNIQUE (quality_check_key, designation),
  CONSTRAINT fk_quality_check_version__predecessor    FOREIGN KEY (predecessor_id)
    REFERENCES operations.quality_check_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_quality_check_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_quality_check_version__no_overlap
    EXCLUDE USING gist (quality_check_key WITH =, effective_period WITH &&)
);
COMMENT ON TABLE operations.quality_check_version IS
  'E9.07. A changed assertion measures something different (LC-169). Recorded on every result so that a change in results attributable to a changed assertion is distinguishable from one attributable to changed data.';

CREATE TABLE product.notification_trigger_version (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  designation       text        NOT NULL,
  effective_period  tstzrange   NOT NULL,
  predecessor_id    bigint,
  rationale         text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_notification_trigger_version              PRIMARY KEY (id),
  CONSTRAINT uq_notification_trigger_version__designation UNIQUE (designation),
  CONSTRAINT fk_notification_trigger_version__predecessor FOREIGN KEY (predecessor_id)
    REFERENCES product.notification_trigger_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_notification_trigger_version__not_self CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_notification_trigger_version__no_overlap
    EXCLUDE USING gist (effective_period WITH &&)
);
COMMENT ON TABLE product.notification_trigger_version IS
  'E8.09. What constitutes a change worth reporting is a rule, and changing it changes what users receive (LC-158). Notification is a product decision recorded as open in Phase 4; the registry exists so the decision is unblocked, not pre-empted.';

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
ALTER TABLE feature.feature_calculator             OWNER TO pt_owner;
ALTER TABLE module.model                           OWNER TO pt_owner;
ALTER TABLE module.model_version                   OWNER TO pt_owner;
ALTER TABLE module.verdict_composition_version     OWNER TO pt_owner;
ALTER TABLE module.consensus_rule_version          OWNER TO pt_owner;
ALTER TABLE module.checksum_algorithm_version      OWNER TO pt_owner;
ALTER TABLE calibration.calibration_version        OWNER TO pt_owner;
ALTER TABLE calibration.outcome_derivation_version OWNER TO pt_owner;
ALTER TABLE product.read_model_version             OWNER TO pt_owner;
ALTER TABLE product.notification_trigger_version   OWNER TO pt_owner;
ALTER TABLE operations.quality_check_version       OWNER TO pt_owner;
