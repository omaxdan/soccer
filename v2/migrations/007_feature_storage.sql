-- =============================================================================
-- 007_feature_storage.sql
-- REVISION 2
-- PitchTerminal V2 — Feature value and lineage
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 7, A.1, A.11
-- Depends on      : 001–006
-- Transactional   : yes
--
-- Purpose
--   Creates the two highest-volume relations in the design: every calculated
--   quantity, and the instance-level record of what each value consumed.
--
-- Volume envelope (§5.24.1)
--   feature_value    10^8 – 10^9, subject to the temporal granularity decision
--   feature_lineage  3 – 5 x feature_value
--   Lineage cannot be thinned independently of the values it describes (LC-47),
--   so the ONLY lever on lineage volume is feature value volume. The granularity
--   decision therefore determines total storage between roughly 150 GB and 1 TB.
--
-- Rules applied
--   C-05  Every calculated relation carries, all NOT NULL: subject kind with
--         typed subject columns, context kind with conditional edition, as-of,
--         calculated-at, version reference, provenance class, observation count
--         with threshold indicator. This uniformity is what makes LC-D structural.
--   R-47  Context validity is a COMPOSITE FOREIGN KEY, not a trigger
--   R-01  Every reference to a partitioned relation is composite — including the
--         FIXTURE subject reference, since fixture is partitioned
--   PD-06 Values are exact numerics. Binary floating point is not used, because
--         calibration compares for equality and replay must not depend on
--         aggregation order.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- feature_value
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_value (
  id                            bigint      GENERATED ALWAYS AS IDENTITY,
  as_of                         timestamptz NOT NULL,
  calculated_at                 timestamptz NOT NULL DEFAULT now(),

  feature_definition_id         bigint      NOT NULL,
  feature_version_id            bigint      NOT NULL,

  -- Subject reference (PD-03): kind code plus one typed column per kind.
  subject_kind_code             text        NOT NULL,
  subject_team_id               bigint,
  subject_player_id             bigint,
  subject_fixture_id            bigint,
  subject_fixture_partition_on  date,
  subject_competition_edition_id bigint,

  -- Context (E2.08): kind code plus a conditional edition reference.
  context_kind_code             text        NOT NULL,
  context_competition_edition_id bigint,

  value                         numeric     NOT NULL,
  provenance_class_code         text        NOT NULL,
  sample_observation_count      integer     NOT NULL,
  sample_meets_threshold        boolean     NOT NULL,

  CONSTRAINT pk_feature_value PRIMARY KEY (id, as_of),

  -- Business identity (§B.3.2). Subject and context LEAD because the dominant
  -- access retrieves many features for one subject at one moment, not one
  -- feature across many subjects.
  -- REVISION 2 (O-03): the covering payload is attached HERE rather than to a
  -- second index, so one structure enforces identity and serves the dominant
  -- access path (§5.11.1, §5.11.3).
  CONSTRAINT uq_feature_value__subject_context_definition_asof_version
    UNIQUE (subject_kind_code, subject_team_id, subject_player_id,
            subject_fixture_id, subject_fixture_partition_on,
            subject_competition_edition_id,
            context_kind_code, context_competition_edition_id,
            feature_definition_id, as_of, feature_version_id)
    INCLUDE (value, provenance_class_code, sample_observation_count,
             sample_meets_threshold, feature_version_id),

  -- Redundant unique constraint (§B.3.3): the target of every composite
  -- reference to a feature value — lineage, evidence, sealed feature state.
  CONSTRAINT uq_feature_value__id_as_of UNIQUE (id, as_of),

  -- Version belongs to definition (C-09) — declarative, no trigger.
  CONSTRAINT fk_feature_value__version_definition
    FOREIGN KEY (feature_version_id, feature_definition_id)
    REFERENCES feature.feature_version (id, feature_definition_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  -- Subject kind matches the definition's declared subject kind (C-09).
  CONSTRAINT fk_feature_value__definition_subject_kind
    FOREIGN KEY (feature_definition_id, subject_kind_code)
    REFERENCES feature.feature_definition (id, subject_kind_code)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  -- A.11 / R-47: context validity BY REFERENCE, replacing the per-row trigger.
  CONSTRAINT fk_feature_value__definition_context_kind
    FOREIGN KEY (feature_definition_id, context_kind_code)
    REFERENCES feature.feature_definition_context_kind (feature_definition_id, context_kind_code)
    ON DELETE RESTRICT ON UPDATE RESTRICT,

  -- Typed subject references. The fixture reference is COMPOSITE (R-01).
  CONSTRAINT fk_feature_value__subject_team FOREIGN KEY (subject_team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_value__subject_player FOREIGN KEY (subject_player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_value__subject_fixture
    FOREIGN KEY (subject_fixture_id, subject_fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_value__subject_edition FOREIGN KEY (subject_competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_value__context_edition FOREIGN KEY (context_competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_value__provenance FOREIGN KEY (provenance_class_code)
    REFERENCES football.provenance_class (code) ON DELETE RESTRICT ON UPDATE RESTRICT,

  -- Subject exclusivity (PD-03, LC-35): exactly the column corresponding to the
  -- declared kind is populated.
  CONSTRAINT ck_feature_value__subject_exclusive CHECK (
    (subject_kind_code = 'TEAM'   AND subject_team_id   IS NOT NULL
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

  -- Context obligation (LC-39): the edition is present when and only when the
  -- kind is competition-scoped.
  CONSTRAINT ck_feature_value__context_edition_conditional CHECK (
    (context_kind_code =  'COMPETITION_SCOPED' AND context_competition_edition_id IS NOT NULL) OR
    (context_kind_code <> 'COMPETITION_SCOPED' AND context_competition_edition_id IS NULL)
  ),

  CONSTRAINT ck_feature_value__sample_non_negative CHECK (sample_observation_count >= 0)
  -- REVISION 2 (O-01). The former ck_feature_value__calculated_not_before_creation
  -- permitted calculated_at up to a century before as_of, which excluded nothing
  -- and cost an evaluation on every insert into the largest relation in the
  -- design. No constraint replaces it: calculated_at legitimately both precedes
  -- as_of (a value calculated for a future moment) and follows it by years
  -- (backfill, §5.16.5), so there is no rule to state.
) PARTITION BY RANGE (as_of);

COMMENT ON TABLE feature.feature_value IS
  'E2.05 Feature Value. THE atomic unit of Layer 2 and the highest-volume relation in the design. Every calculated metric the previous platform held — readiness and components, form quality, travel, rest, congestion, stability, strength, depth, versatility, momentum, motivation, style, injury burden, valuation aggregates, opponent quality, competition aggregates — is an instance of this one relation.
   APPEND-ONLY. Never updated, never deleted while referenced. A club''s readiness on a date two years ago, within a specific competition, under the rule in force then, is a single row directly addressable by its identity. The previous platform could not produce that figure by any means, because the value had been overwritten within a day of being calculated.';
COMMENT ON COLUMN feature.feature_value.as_of IS
  'The moment in the world this value describes. PARTITION KEY and a member of the business identity, so PD-05 is satisfied trivially and no denormalisation arises.';
COMMENT ON COLUMN feature.feature_value.calculated_at IS
  'When the calculation ran. INDEPENDENT of as_of (LC-32). A value calculated today describing a moment last year is legitimate backfill, and the two attributes together make reconstruction legible as reconstruction.';
COMMENT ON CONSTRAINT fk_feature_value__definition_context_kind ON feature.feature_value IS
  'A.11 / R-47. Context validity enforced declaratively. This constraint REPLACES a per-row trigger that would have executed up to one billion times during initial population.';
COMMENT ON COLUMN feature.feature_value.subject_fixture_partition_on IS
  'R-01. fixture is partitioned, so a fixture subject reference must be composite. Carried for every row whose subject kind is FIXTURE, null otherwise.';
COMMENT ON COLUMN feature.feature_value.sample_meets_threshold IS
  'Retained alongside the count rather than derived at read time. The threshold in force AT CALCULATION is the one that governed the value; a later change to the registry-declared threshold does not retroactively alter whether a historical value met the threshold that applied to it (LC-41).';

-- -----------------------------------------------------------------------------
-- feature_lineage
-- -----------------------------------------------------------------------------

CREATE TABLE feature.feature_lineage (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  produced_value_as_of    timestamptz NOT NULL,
  produced_value_id       bigint      NOT NULL,
  consumed_value_id       bigint      NOT NULL,
  consumed_value_as_of    timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_lineage PRIMARY KEY (id, produced_value_as_of),
  CONSTRAINT uq_feature_lineage__produced_consumed
    UNIQUE (produced_value_id, produced_value_as_of, consumed_value_id, consumed_value_as_of),

  -- Both endpoints are COMPOSITE references (R-01). The produced side is
  -- partition-local; the consumed side crosses partitions by nature.
  CONSTRAINT fk_feature_lineage__produced_value
    FOREIGN KEY (produced_value_id, produced_value_as_of)
    REFERENCES feature.feature_value (id, as_of) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_feature_lineage__consumed_value
    FOREIGN KEY (consumed_value_id, consumed_value_as_of)
    REFERENCES feature.feature_value (id, as_of) ON DELETE RESTRICT ON UPDATE RESTRICT,

  CONSTRAINT ck_feature_lineage__not_self CHECK (produced_value_id <> consumed_value_id),
  CONSTRAINT ck_feature_lineage__consumed_not_after_produced
    CHECK (consumed_value_as_of <= produced_value_as_of)
) PARTITION BY RANGE (produced_value_as_of);

COMMENT ON TABLE feature.feature_lineage IS
  'E2.12 Feature Lineage. A DEPENDENCY says "this rule consumes that rule" — type-level, declared in advance. LINEAGE says "this value consumed those values" — instance-level, recorded at calculation.
   Lineage is what makes reproducibility real rather than nominal: without it, a stated version tells you which rule ran but not what it ran ON, and a reproduction can differ from the original with nothing revealing why.';
COMMENT ON CONSTRAINT fk_feature_lineage__consumed_value ON feature.feature_lineage IS
  'RESTRICT prevents thinning of any cited value (LC-31, LC-47). A value cited by retained lineage cannot be deleted, which is what makes thinning eligibility enforced by the database rather than by the correctness of the retention process.';
COMMENT ON CONSTRAINT ck_feature_lineage__consumed_not_after_produced ON feature.feature_lineage IS
  'A value cannot consume an input from its own future. The same-row check is available because both as-of instants are present and both are bound by composite foreign key — the same construction that closes the contamination path on sealed content (A.3).';

-- -----------------------------------------------------------------------------
-- Initial monthly partitions
-- -----------------------------------------------------------------------------
-- Co-partitioned families are created as ONE operation with identical
-- boundaries (§5.11.6), which is what permits partition-wise joins during
-- replay.
--
-- Initial window: 2024-01 to 2028-12. The maintenance function of migration 018
-- extends the range FORWARD to maintain the buffer of not fewer than three
-- intervals, and BACKWARD before any historical reconstruction (§B.8.5 stage 20).

DO $$
DECLARE
  rel   text;
  d     date;
  d_end date;
BEGIN
  FOREACH rel IN ARRAY ARRAY['feature_value','feature_lineage'] LOOP
    d := date '2024-01-01';
    WHILE d < date '2029-01-01' LOOP
      d_end := (d + interval '1 month')::date;
      EXECUTE format(
        'CREATE TABLE feature.%I PARTITION OF feature.%I FOR VALUES FROM (%L) TO (%L)',
        rel || '_p' || to_char(d, 'YYYYMM'), rel, d, d_end);
      EXECUTE format('ALTER TABLE feature.%I OWNER TO pt_owner', rel || '_p' || to_char(d, 'YYYYMM'));
      d := d_end;
    END LOOP;
    EXECUTE format('CREATE TABLE feature.%I PARTITION OF feature.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE feature.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
ALTER TABLE feature.feature_value   OWNER TO pt_owner;
ALTER TABLE feature.feature_lineage OWNER TO pt_owner;
