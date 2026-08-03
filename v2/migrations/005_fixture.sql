-- =============================================================================
-- 005_fixture.sql
-- PitchTerminal V2 — Partitioned fixture-scoped relations
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 5, §B.4, A.1, A.7
-- Depends on      : 001, 002, 004
-- Transactional   : yes
--
-- Purpose
--   Creates the fixture and every fixture-scoped reality relation, all range
--   partitioned yearly on a plain partition column and co-partitioned with one
--   another, so that fixture assembly is a partition-wise gather.
--
-- Rules applied
--   R-29  A partition key is a PLAIN COLUMN, never a generated column
--   C-02  A partitioned relation's primary key comprises the surrogate key and
--         the partition key
--   R-01  Every reference to a partitioned relation is COMPOSITE, referencing a
--         unique constraint containing the parent's partition key
--   R-03  A co-partitioned child uses the partition key it already carries
--   PD-11 Yearly granularity for fixture-scoped reality; volume per year is
--         moderate and these relations are never thinned
--
-- Partition key immutability (PR-03)
--   fixture_partition_on is written by ingestion at fixture creation as the UTC
--   date of scheduled kickoff, and is immutable thereafter. Immutability is
--   enforced declaratively: every child references it with ON UPDATE RESTRICT,
--   so once any child row exists the value cannot be altered. A fixture
--   rescheduled across a year boundary retains its original partition date,
--   which is correct — earlier snapshots describe a fixture as it was expected
--   at the time (E4.09).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fixture
-- -----------------------------------------------------------------------------

CREATE TABLE football.fixture (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  provider_external_id      text        NOT NULL,
  provider_code             text        NOT NULL,
  competition_edition_id    bigint      NOT NULL,
  competition_stage_id      bigint,
  venue_id                  bigint,
  is_neutral_venue          boolean     NOT NULL DEFAULT false,
  home_team_id              bigint      NOT NULL,
  away_team_id              bigint      NOT NULL,
  scheduled_kickoff_at      timestamptz NOT NULL,
  lifecycle_state_code      text        NOT NULL,
  provider_status_raw       text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_fixture PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_fixture__provider_external_id
    UNIQUE (provider_code, provider_external_id, fixture_partition_on),
  CONSTRAINT fk_fixture__edition FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture__stage FOREIGN KEY (competition_stage_id)
    REFERENCES football.competition_stage (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture__venue FOREIGN KEY (venue_id)
    REFERENCES football.venue (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture__home_team FOREIGN KEY (home_team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture__away_team FOREIGN KEY (away_team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture__lifecycle_state FOREIGN KEY (lifecycle_state_code)
    REFERENCES football.fixture_lifecycle_state (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fixture__participants_distinct CHECK (home_team_id <> away_team_id),
  CONSTRAINT ck_fixture__partition_not_after_kickoff
    CHECK (fixture_partition_on <= (scheduled_kickoff_at AT TIME ZONE 'UTC')::date)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.fixture IS
  'E1.13 Fixture. The second hub entity and the anchor of every snapshot. Identity is stable across rescheduling, because sealed claims made before a postponement reference it and reassigning identity would orphan them.';
COMMENT ON COLUMN football.fixture.fixture_partition_on IS
  'PLAIN partition column (R-29). Derived in UTC at creation and immutable thereafter (PD-08, PR-03). Immutability is enforced by ON UPDATE RESTRICT on every child reference.';
COMMENT ON COLUMN football.fixture.lifecycle_state_code IS
  'The PLATFORM''S state, mapped from provider status. Sealing branches on this, never on provider_status_raw (LC-14).';
COMMENT ON COLUMN football.fixture.provider_status_raw IS
  'The provider''s own string, retained for mapping diagnosis. Load-bearing for nothing.';
COMMENT ON CONSTRAINT ck_fixture__partition_not_after_kickoff ON football.fixture IS
  'REVISION 2 (O-02). The partition date equals the original UTC kickoff date at creation and never advances, so it can only precede a later rescheduled kickoff. The previous formulation stated this as a disjunction whose first branch was subsumed by the second, which read as though equality were being enforced when it was not.';
COMMENT ON COLUMN football.fixture.is_neutral_venue IS
  'The stated home and away roles are how the fixture is constituted, not an assertion about geography. Neutral-venue fixtures retain their roles.';

-- Yearly partitions. Ten years of history plus a forward buffer of not fewer
-- than three intervals (§5.10.5). A DEFAULT partition accepts any row that
-- would otherwise be rejected, making a missing partition a detectable data
-- condition rather than a write failure.
DO $$
DECLARE y integer;
BEGIN
  FOR y IN 2015..2035 LOOP
    EXECUTE format(
      'CREATE TABLE football.fixture_p%s PARTITION OF football.fixture
         FOR VALUES FROM (%L) TO (%L)',
      y, format('%s-01-01', y), format('%s-01-01', y + 1));
    EXECUTE format('ALTER TABLE football.fixture_p%s OWNER TO pt_owner', y);
  END LOOP;
END
$$;

CREATE TABLE football.fixture_pdefault PARTITION OF football.fixture DEFAULT;
ALTER TABLE football.fixture_pdefault OWNER TO pt_owner;
COMMENT ON TABLE football.fixture_pdefault IS
  'Default partition. A non-empty default partition is a QUALITY BREACH reported by the assertion of migration 018, never a silent condition (§5.10.5).';

-- -----------------------------------------------------------------------------
-- fixture_lifecycle_transition
-- -----------------------------------------------------------------------------

CREATE TABLE football.fixture_lifecycle_transition (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  from_state_code       text,
  to_state_code         text        NOT NULL,
  transitioned_at       timestamptz NOT NULL,
  provider_status_raw   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_fixture_lifecycle_transition PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_fixture_lifecycle_transition__fixture_at
    UNIQUE (fixture_partition_on, fixture_id, transitioned_at),
  CONSTRAINT fk_fixture_lifecycle_transition__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture_lifecycle_transition__from_state FOREIGN KEY (from_state_code)
    REFERENCES football.fixture_lifecycle_state (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fixture_lifecycle_transition__to_state FOREIGN KEY (to_state_code)
    REFERENCES football.fixture_lifecycle_state (code) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.fixture_lifecycle_transition IS
  'E1.14 transition history. APPEND-ONLY: states advance, transitions are recorded, never overwritten. A fixture postponed and replayed has a legible history rather than a final state that conceals it.';
COMMENT ON CONSTRAINT fk_fixture_lifecycle_transition__fixture ON football.fixture_lifecycle_transition IS
  'COMPOSITE reference (R-01). fixture is partitioned, so its primary key comprises the surrogate key and the partition key, and a single-column reference has no valid target.';

-- -----------------------------------------------------------------------------
-- official_assignment
-- -----------------------------------------------------------------------------

CREATE TABLE football.official_assignment (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  official_id           bigint      NOT NULL,
  role_code             text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_official_assignment PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_official_assignment__fixture_official_role
    UNIQUE (fixture_partition_on, fixture_id, official_id, role_code),
  CONSTRAINT fk_official_assignment__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_official_assignment__official FOREIGN KEY (official_id)
    REFERENCES football.official (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.official_assignment IS
  'E1.15 Official Assignment. Modelled because the requirement is real; whether it is populated is an ingestion question, and an unpopulated relation is a coverage fact rather than a modelling defect.';

-- -----------------------------------------------------------------------------
-- lineup and lineup_selection  (ACTUAL lineups — Layer 1)
-- -----------------------------------------------------------------------------

CREATE TABLE football.lineup (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  team_id               bigint      NOT NULL,
  formation             text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_lineup PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_lineup__fixture_team UNIQUE (fixture_partition_on, fixture_id, team_id),
  CONSTRAINT uq_lineup__id_partition UNIQUE (id, fixture_partition_on),
  CONSTRAINT fk_lineup__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_lineup__team FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.lineup IS
  'E1.16 Lineup — the ACTUAL lineup as reported. Kept strictly separate from predicted lineups, which are Layer 2 calculated artefacts carrying a formula version and subject to calibration. Housing them together would place a claim and an observation in one structure, which is exactly the input/output conflation the architecture exists to eliminate (LC-15).';
COMMENT ON COLUMN football.lineup.formation IS
  'Stated ONCE per club per fixture. The previous platform stored formation both on a per-club structure and repeated on every player row.';

CREATE TABLE football.lineup_selection (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  lineup_id             bigint      NOT NULL,
  player_id             bigint      NOT NULL,
  position_code         text,
  shirt_number          smallint,
  is_starting           boolean     NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_lineup_selection PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_lineup_selection__lineup_player
    UNIQUE (fixture_partition_on, lineup_id, player_id),
  CONSTRAINT fk_lineup_selection__lineup
    FOREIGN KEY (lineup_id, fixture_partition_on)
    REFERENCES football.lineup (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_lineup_selection__player FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_lineup_selection__position FOREIGN KEY (position_code)
    REFERENCES football.position (code) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.lineup_selection IS
  'Constituent selections of an actual lineup. Co-partitioned with its parent, so the reference uses the partition key already present (R-03).';

-- -----------------------------------------------------------------------------
-- appearance
-- -----------------------------------------------------------------------------

CREATE TABLE football.appearance (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  fixture_id                bigint      NOT NULL,
  player_id                 bigint      NOT NULL,
  team_id                   bigint      NOT NULL,
  participation_state_code  text        NOT NULL,
  position_code             text,
  minutes_played            smallint    NOT NULL DEFAULT 0,
  yellow_cards              smallint    NOT NULL DEFAULT 0,
  red_cards                 smallint    NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_appearance PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_appearance__fixture_player UNIQUE (fixture_partition_on, fixture_id, player_id),
  CONSTRAINT fk_appearance__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appearance__player FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appearance__team FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appearance__participation_state FOREIGN KEY (participation_state_code)
    REFERENCES football.participation_state (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_appearance__position FOREIGN KEY (position_code)
    REFERENCES football.position (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_appearance__minutes_plausible CHECK (minutes_played BETWEEN 0 AND 150),
  CONSTRAINT ck_appearance__cards_plausible CHECK (yellow_cards BETWEEN 0 AND 2 AND red_cards BETWEEN 0 AND 1)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.appearance IS
  'E1.17 Appearance. The foundational input to every load, fatigue and readiness calculation. A SINGLE STATED PARTICIPATION STATE replaces two booleans that could not distinguish "named but unused" from "absent from the record entirely" — materially different facts for a fatigue model (LC-16).';

-- -----------------------------------------------------------------------------
-- match_event
-- -----------------------------------------------------------------------------

CREATE TABLE football.match_event (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  event_sequence        integer     NOT NULL,
  event_type_code       text        NOT NULL,
  minute                smallint,
  team_id               bigint,
  player_id             bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_match_event PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_match_event__fixture_sequence
    UNIQUE (fixture_partition_on, fixture_id, event_sequence),
  CONSTRAINT fk_match_event__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_event__team FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_event__player FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.match_event IS
  'E1.18 Match Event. Modelled CONDITIONALLY — included only where a provider supplies event data and a calculated metric consumes it. An entity with no producer and no consumer is scope creep.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   event_type_code has no governed vocabulary in doc 08. Either a
--   football.match_event_type vocabulary is added in migration 002, or the
--   relation is deferred until a provider contract is confirmed. Left as
--   unconstrained text here rather than inventing a vocabulary.

-- -----------------------------------------------------------------------------
-- result and result_revision
-- -----------------------------------------------------------------------------

CREATE TABLE football.result (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  fixture_id                bigint      NOT NULL,
  home_goals                smallint    NOT NULL,
  away_goals                smallint    NOT NULL,
  home_goals_half_time      smallint,
  away_goals_half_time      smallint,
  home_goals_extra_time     smallint,
  away_goals_extra_time     smallint,
  home_penalties            smallint,
  away_penalties            smallint,
  confirmed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_result PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_result__fixture UNIQUE (fixture_partition_on, fixture_id),
  CONSTRAINT uq_result__id_partition UNIQUE (id, fixture_partition_on),
  CONSTRAINT fk_result__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_result__goals_non_negative CHECK (home_goals >= 0 AND away_goals >= 0),
  CONSTRAINT ck_result__half_time_paired
    CHECK ((home_goals_half_time IS NULL) = (away_goals_half_time IS NULL)),
  CONSTRAINT ck_result__extra_time_paired
    CHECK ((home_goals_extra_time IS NULL) = (away_goals_extra_time IS NULL)),
  CONSTRAINT ck_result__penalties_paired
    CHECK ((home_penalties IS NULL) = (away_penalties IS NULL))
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.result IS
  'E1.19 Result. Separate from fixture because a scheduled fixture has no result, and modelling absence as empty attributes on the fixture would make "not yet played" and "played, nil-nil" structurally identical. Extra time and penalties are modelled explicitly — the previous platform''s shape was lossy for cup fixtures, which distorted any measurement over a population including them.';

CREATE TABLE football.result_revision (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  result_id                 bigint      NOT NULL,
  revision_ordinal          integer     NOT NULL,
  revised_at                timestamptz NOT NULL,
  previous_home_goals       smallint    NOT NULL,
  previous_away_goals       smallint    NOT NULL,
  revision_reason           text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_result_revision PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_result_revision__result_ordinal
    UNIQUE (fixture_partition_on, result_id, revision_ordinal),
  CONSTRAINT fk_result_revision__result
    FOREIGN KEY (result_id, fixture_partition_on)
    REFERENCES football.result (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_result_revision__ordinal_positive CHECK (revision_ordinal >= 1)
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE football.result_revision IS
  'E1.19. A post-confirmation revision is recorded as a REVISION WITH ITS OWN RECORD, never as a silent overwrite (LC-17). Calibration must be able to distinguish a claim that was wrong from a claim measured against a figure later corrected; without this relation that distinction is unavailable and every measurement over a population containing amended fixtures is silently misattributed.';

-- -----------------------------------------------------------------------------
-- Partitions for every co-partitioned relation
-- -----------------------------------------------------------------------------
-- Co-partitioned families are created as a SINGLE OPERATION with identical
-- boundaries (§5.11.6), which is what permits partition-wise joins.

DO $$
DECLARE
  rel  text;
  y    integer;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'fixture_lifecycle_transition','official_assignment','lineup','lineup_selection',
    'appearance','match_event','result','result_revision'
  ]
  LOOP
    FOR y IN 2015..2035 LOOP
      EXECUTE format(
        'CREATE TABLE football.%I PARTITION OF football.%I FOR VALUES FROM (%L) TO (%L)',
        rel || '_p' || y, rel, format('%s-01-01', y), format('%s-01-01', y + 1));
      EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', rel || '_p' || y);
    END LOOP;
    EXECUTE format('CREATE TABLE football.%I PARTITION OF football.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fixture','fixture_lifecycle_transition','official_assignment','lineup',
    'lineup_selection','appearance','match_event','result','result_revision'
  ]
  LOOP
    EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;
