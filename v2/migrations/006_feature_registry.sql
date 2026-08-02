-- =============================================================================
-- 006_feature_registry.sql
-- PitchTerminal V2 — Feature registry and governance relations
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 6, A.11
-- Depends on      : 001, 002, 003, 004
-- Transactional   : yes
--
-- Purpose
--   Creates the governance layer of the feature engine. Registration is the
--   governance point: a calculation process writing a value for an unregistered
--   feature is rejected by foreign key, not merely discouraged (LC-20).
--
-- Rules applied
--   LC-24   Feature keys are NAMESPACED BY SUBJECT, so team readiness and player
--           readiness are visibly distinct declarations rather than the same
--           word appearing twice
--   LC-28   Exactly one calculator owns any given definition
--   R-47    feature_definition_context_kind is the binding relation that
--           replaces the per-row context validity TRIGGER with a composite
--           foreign key. This is the correction that removes up to one billion
--           trigger executions.
--   LC-44   The dependency graph is acyclic — validated, not triggered, because
--           the registry is modified rarely and under governance (§B.5.4)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- feature_definition
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_definition (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  feature_key                 text        NOT NULL,
  subject_kind_code           text        NOT NULL,
  display_name                text        NOT NULL,
  meaning                     text        NOT NULL,
  unit                        text        NOT NULL,
  value_scale                 smallint    NOT NULL,
  direction                   text        NOT NULL,
  feature_calculator_id       bigint      NOT NULL,
  max_provenance_class_code   text        NOT NULL,
  meaningful_sample_threshold integer     NOT NULL DEFAULT 0,
  is_active                   boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_definition                   PRIMARY KEY (id),
  CONSTRAINT uq_feature_definition__feature_key      UNIQUE (feature_key),
  CONSTRAINT uq_feature_definition__id_subject_kind  UNIQUE (id, subject_kind_code),
  CONSTRAINT fk_feature_definition__subject_kind     FOREIGN KEY (subject_kind_code)
    REFERENCES feature.subject_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_definition__calculator       FOREIGN KEY (feature_calculator_id)
    REFERENCES feature.feature_calculator (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_definition__max_provenance   FOREIGN KEY (max_provenance_class_code)
    REFERENCES feature.provenance_class (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_feature_definition__key_namespaced   CHECK (feature_key ~ '^(team|player|fixture|competition)\.[a-z0-9_]+$'),
  CONSTRAINT ck_feature_definition__direction_known  CHECK (direction IN ('HIGHER_IS_STRONGER','LOWER_IS_STRONGER','UNSIGNED')),
  CONSTRAINT ck_feature_definition__scale_bounded    CHECK (value_scale BETWEEN 0 AND 12),
  CONSTRAINT ck_feature_definition__threshold_non_negative CHECK (meaningful_sample_threshold >= 0)
);
COMMENT ON TABLE feature.feature_definition IS
  'E2.02 Feature Definition. Makes a metric''s meaning DATA rather than convention. The previous platform carried quantities whose scale, direction and comparability were knowable only by reading the process that produced them — including two identically-named attributes on different structures that were different metrics, and one identically-named attribute on two structures that was the same metric.';
COMMENT ON CONSTRAINT ck_feature_definition__key_namespaced ON feature.feature_definition IS
  'LC-24. Subject namespacing is load-bearing: it makes team.readiness and player.readiness visibly distinct declarations, which is the naming failure that concealed the duplication in the first place.';
COMMENT ON COLUMN feature.feature_definition.value_scale IS
  'Declared scale. Cannot be enforced on the value column by CHECK, because a check constraint may not reference another relation. Enforced by the calculating process and verified by the scale conformance assertion of migration 018 — a NAMED RESIDUAL ENFORCEMENT POINT (§B.5.4).';
COMMENT ON COLUMN feature.feature_definition.max_provenance_class_code IS
  'The strongest provenance class this feature can ever carry. A feature modelled in the absence of a source can never be OBSERVED.';
COMMENT ON CONSTRAINT uq_feature_definition__id_subject_kind ON feature.feature_definition IS
  'Redundant unique constraint (§B.3.3). Serves the composite reference from feature_value that binds a value''s subject kind to its definition''s declared subject kind.';

-- -----------------------------------------------------------------------------
-- feature_version
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_version (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  feature_definition_id bigint      NOT NULL,
  designation           text        NOT NULL,
  effective_period      tstzrange   NOT NULL,
  predecessor_id        bigint,
  rationale             text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_version                      PRIMARY KEY (id),
  CONSTRAINT uq_feature_version__definition_designation UNIQUE (feature_definition_id, designation),
  CONSTRAINT uq_feature_version__id_definition       UNIQUE (id, feature_definition_id),
  CONSTRAINT fk_feature_version__definition          FOREIGN KEY (feature_definition_id)
    REFERENCES feature.feature_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_version__predecessor         FOREIGN KEY (predecessor_id)
    REFERENCES feature.feature_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_feature_version__not_self_predecessor CHECK (predecessor_id IS NULL OR predecessor_id <> id),
  CONSTRAINT ex_feature_version__periods_do_not_overlap
    EXCLUDE USING gist (feature_definition_id WITH =, effective_period WITH &&)
);
COMMENT ON TABLE feature.feature_version IS
  'E2.03 Feature Version. A metric''s MEANING is stable while the RULE realising it is not. Changing a weight, window, threshold or component changes what the number IS without changing what it is ABOUT — and a measured rate spanning two rules describes a system that never existed.';
COMMENT ON CONSTRAINT uq_feature_version__id_definition ON feature.feature_version IS
  'Redundant unique constraint (§B.3.3, C-09). Serves the composite reference from feature_value, which binds a value''s version to its definition declaratively — a version belonging to a different definition is rejected by the reference itself, with no trigger.';

-- -----------------------------------------------------------------------------
-- feature_definition_context_kind   (A.11 / R-47)
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_definition_context_kind (
  feature_definition_id bigint      NOT NULL,
  context_kind_code     text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_definition_context_kind PRIMARY KEY (feature_definition_id, context_kind_code),
  CONSTRAINT fk_feature_definition_context_kind__definition FOREIGN KEY (feature_definition_id)
    REFERENCES feature.feature_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_definition_context_kind__context_kind FOREIGN KEY (context_kind_code)
    REFERENCES feature.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE feature.feature_definition_context_kind IS
  'A.11 / R-47. Enumerates the permitted (definition, context kind) pairs. feature_value declares a composite foreign key over its definition and context kind referencing this relation, so a value at an invalid context is rejected BY THE REFERENCE.
   THIS RELATION EXISTS TO REMOVE A TRIGGER. The original specification enforced context validity by a per-row trigger performing an indexed registry lookup — up to one billion executions during initial population, and a placement contravening PR-09, which requires the lowest capable layer. It is a physical realisation of a declaration the logical model already contains (E2.02) and introduces no new logical concept (R-48).';

-- -----------------------------------------------------------------------------
-- feature_source   (Layer 1 dependencies)
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_source (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  feature_definition_id bigint      NOT NULL,
  feature_version_id    bigint      NOT NULL,
  source_schema_name    text        NOT NULL,
  source_relation_name  text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_source PRIMARY KEY (id),
  CONSTRAINT uq_feature_source__version_relation
    UNIQUE (feature_version_id, source_schema_name, source_relation_name),
  CONSTRAINT fk_feature_source__version_definition
    FOREIGN KEY (feature_version_id, feature_definition_id)
    REFERENCES feature.feature_version (id, feature_definition_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_feature_source__layer_one_only CHECK (source_schema_name = 'football')
);
COMMENT ON TABLE feature.feature_source IS
  'E2.10 Feature Source. A SOURCE is a reality entity a feature reads; a DEPENDENCY is another feature it consumes. Conflating them makes the layer boundary unauditable. Declared sources are what make freshness derivable rather than hand-maintained: a fatigue feature sourcing from appearances is stale whenever appearance ingestion has not run, and nobody maintains that relationship separately.';
COMMENT ON CONSTRAINT ck_feature_source__layer_one_only ON feature.feature_source IS
  'LC-43. Only Layer 2 declares Layer 1 sources, and a source may only be a Layer 1 relation.';

-- -----------------------------------------------------------------------------
-- feature_dependency   (Layer 2 dependencies)
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_dependency (
  id                              bigint      GENERATED ALWAYS AS IDENTITY,
  consumer_definition_id          bigint      NOT NULL,
  consumer_version_id             bigint      NOT NULL,
  consumed_definition_id          bigint      NOT NULL,
  consumer_context_kind_code      text        NOT NULL,
  consumed_context_kind_code      text        NOT NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_dependency PRIMARY KEY (id),
  CONSTRAINT uq_feature_dependency__consumer_version_consumed
    UNIQUE (consumer_version_id, consumed_definition_id, consumed_context_kind_code),
  CONSTRAINT fk_feature_dependency__consumer_version
    FOREIGN KEY (consumer_version_id, consumer_definition_id)
    REFERENCES feature.feature_version (id, feature_definition_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_dependency__consumed_definition FOREIGN KEY (consumed_definition_id)
    REFERENCES feature.feature_definition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_dependency__consumer_context FOREIGN KEY (consumer_context_kind_code)
    REFERENCES feature.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_dependency__consumed_context FOREIGN KEY (consumed_context_kind_code)
    REFERENCES feature.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_feature_dependency__not_self CHECK (consumer_definition_id <> consumed_definition_id)
);
COMMENT ON TABLE feature.feature_dependency IS
  'E2.11 Feature Dependency. Makes the calculation dependency graph DATA. The previous platform''s graph — roughly fifty edges — lived entirely in the ordering of calls within one orchestration process: correct, carefully documented, and completely invisible to the model, such that a missing input produced empty values rather than an error. EXECUTION ORDER IS DERIVED FROM THESE DECLARATIONS (§B.8, §5.12.2).';
COMMENT ON COLUMN feature.feature_dependency.consumed_context_kind_code IS
  'LC-45. The context MAPPING is part of the declaration, not an assumption inside the calculator. A cross-competition congestion feature consumes competition-scoped fixture data.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   LC-44 (acyclicity) is enforced by the validation assertion of migration 018,
--   not by constraint. Doc 08 §5.9.9 states this explicitly: a recursive trigger
--   would run on every registry modification and scale with graph size, and the
--   registry is modified rarely and under governance. Recorded here so the
--   residual enforcement point is visible at the relation it governs.

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
ALTER TABLE feature.feature_definition              OWNER TO pt_owner;
ALTER TABLE feature.feature_version                 OWNER TO pt_owner;
ALTER TABLE feature.feature_definition_context_kind OWNER TO pt_owner;
ALTER TABLE feature.feature_source                  OWNER TO pt_owner;
ALTER TABLE feature.feature_dependency              OWNER TO pt_owner;
