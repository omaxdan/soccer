-- =============================================================================
-- 002_reference_vocabularies.sql
-- PitchTerminal V2 — Governed reference vocabularies
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 2
-- Depends on      : 001
-- Transactional   : yes
--
-- Purpose
--   Creates every governed vocabulary. These are the stable code sets that
--   sealed claims reference indefinitely.
--
-- Rules applied
--   PD-02 / D-13  Vocabularies are lookup relations. NO ENUM TYPES ANYWHERE.
--                 An enumerated type cannot express retirement without
--                 deletion, effective dating, descriptive attributes, or
--                 referential integrity — all four of which are required.
--   LC-10         A vocabulary entry's meaning is never redefined in place.
--                 Retirement closes the effective period; the row persists.
--   §5.4.2        Referenced by foreign key on the CODE, not on a surrogate.
--
-- Standard vocabulary shape
--   code            stable, immutable, the business key and FK target
--   display_name    human-readable label
--   meaning         the definition of the entry; changing it is prohibited
--   effective_from  when the entry became available
--   effective_to    when the entry was retired; NULL while active
--   created_at
--
-- TODO: requires confirmation from Phase 5 schema catalogue
--   Doc 08 §5.9.5 lists "vocabulary effective periods do not overlap within one
--   code" as an exclusion constraint, which implies multiple rows per code and
--   a surrogate key. Doc 08 §5.4.2 states vocabularies are referenced by FK on
--   the code, which requires the code to be unique and therefore one row per
--   code. These two statements cannot both hold.
--   Implemented here as ONE ROW PER CODE (code as primary key) because the FK
--   requirement is load-bearing for every referencing relation, and retirement
--   is fully expressible by closing effective_to on the single row.
--   Confirm before Phase 6 sign-off.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- football — reality vocabularies
-- -----------------------------------------------------------------------------

CREATE TABLE football.country (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  alpha3_code     text,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_country                    PRIMARY KEY (code),
  CONSTRAINT ck_country__code_is_iso3166_1 CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT ck_country__period_ordered    CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.country IS
  'E1.01 Country. Canonical geographic vocabulary. Every geographic reference resolves here — teams, venues, players, competitions, officials.';

CREATE TABLE football.position (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  position_group  text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_position                 PRIMARY KEY (code),
  CONSTRAINT ck_position__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.position IS
  'E1.10a Position. Governed playing-position vocabulary. Referenced by position profile, lineup, appearance, predicted lineup, and every position-scoped feature. A changed meaning is a new code, never an edit (LC-10).';

CREATE TABLE football.statistics_domain (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_statistics_domain                 PRIMARY KEY (code),
  CONSTRAINT ck_statistics_domain__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.statistics_domain IS
  'E1.22 Statistics Domain. Partitions provider statistics into coherent groups so a goalkeeper carries goalkeeping and participation only. Adding a provider measure extends one domain and widens nothing.';

INSERT INTO football.statistics_domain (code, display_name, meaning) VALUES
  ('PARTICIPATION', 'Participation', 'Appearances, starts, minutes, rating. Applies to every player.'),
  ('ATTACKING',     'Attacking',     'Shots, goals, conversion, big chances, set pieces.'),
  ('CREATION',      'Creation',      'Passing, key passes, crosses, long balls, assists.'),
  ('DEFENDING',     'Defending',     'Tackles, interceptions, clearances, blocks, duels, errors.'),
  ('DISCIPLINE',    'Discipline',    'Cards, fouls, offsides.'),
  ('GOALKEEPING',   'Goalkeeping',   'Saves, claims, distribution, goals conceded. Players who keep goal only.'),
  ('PHYSICAL',      'Physical',      'Distance, sprints, top speed.');

CREATE TABLE football.fixture_lifecycle_state (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  is_open         boolean     NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_fixture_lifecycle_state                 PRIMARY KEY (code),
  CONSTRAINT ck_fixture_lifecycle_state__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.fixture_lifecycle_state IS
  'E1.14 Fixture Lifecycle State. The PLATFORM''S OWN vocabulary, mapped from provider status. Sealing depends on is_open; a vocabulary the platform does not control cannot be permitted to govern sealing (LC-14).';
COMMENT ON COLUMN football.fixture_lifecycle_state.is_open IS
  'TRUE only for states in which a fixture may still receive snapshots. The lifecycle guard protects by default: an unmapped provider status maps to a state with is_open = FALSE.';

INSERT INTO football.fixture_lifecycle_state (code, display_name, meaning, is_open) VALUES
  ('SCHEDULED',   'Scheduled',   'Fixture is scheduled and has not started. Snapshots permitted.',            true),
  ('IN_PROGRESS', 'In progress', 'Fixture has started. No further snapshots.',                                false),
  ('COMPLETED',   'Completed',   'Fixture has finished. No further snapshots.',                               false),
  ('POSTPONED',   'Postponed',   'Fixture postponed. No further snapshots until rescheduled and reopened.',   false),
  ('ABANDONED',   'Abandoned',   'Fixture abandoned after starting. No further snapshots.',                   false),
  ('CANCELLED',   'Cancelled',   'Fixture cancelled and will not be played. No further snapshots.',           false),
  ('UNKNOWN',     'Unknown',     'Provider status not recognised by the current mapping. Seals by default.',  false);

CREATE TABLE football.snapshot_point (
  code               text        NOT NULL,
  display_name       text        NOT NULL,
  meaning            text        NOT NULL,
  offset_before_kick interval    NOT NULL,
  is_canonical       boolean     NOT NULL DEFAULT false,
  effective_from     timestamptz NOT NULL DEFAULT now(),
  effective_to       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_snapshot_point                 PRIMARY KEY (code),
  CONSTRAINT ck_snapshot_point__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.snapshot_point IS
  'E4.09 Snapshot Point. Named, fixed moments in a fixture''s approach. Held in football as a vocabulary shared by snapshot and calibration. Named and fixed points are what make snapshots comparable across fixtures, which is the basis of every calibration population (LC-101).';
COMMENT ON COLUMN football.snapshot_point.is_canonical IS
  'Exactly one point is canonical — the platform''s final stated position, against which headline reliability is measured.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   The exact snapshot point set is recorded as an open decision (Phase 4 D8;
--   doc 08 §5.25.4). The four points below are the architecture's proposal.
--   Confirm before production.
INSERT INTO football.snapshot_point (code, display_name, meaning, offset_before_kick, is_canonical) VALUES
  ('T_MINUS_7D', 'T-7 days',  'Earliest useful signal. Squad and fixture context known; injury picture incomplete.', interval '7 days',  false),
  ('T_MINUS_3D', 'T-3 days',  'Congestion and rest resolved; rotation risk readable.',                              interval '3 days',  false),
  ('T_MINUS_1D', 'T-1 day',   'Team news largely settled; predicted lineups at their most reliable.',               interval '1 day',   false),
  ('KICKOFF',    'Kickoff',   'The canonical snapshot. The platform''s final stated position.',                     interval '0',       true);

-- Currency is held in football because football.player_valuation references it
-- and football may not reference a higher schema (§5.3.3).
CREATE TABLE football.currency (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  minor_unit      smallint    NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_currency                    PRIMARY KEY (code),
  CONSTRAINT ck_currency__code_is_iso4217   CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_currency__minor_unit_valid  CHECK (minor_unit BETWEEN 0 AND 4),
  CONSTRAINT ck_currency__period_ordered    CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.currency IS
  'ISO 4217 vocabulary. Every monetary amount carries a currency reference (LC-12); an uncurrencied amount is prohibited by NOT NULL on the referencing column.';

CREATE TABLE football.registration_kind (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_registration_kind                 PRIMARY KEY (code),
  CONSTRAINT ck_registration_kind__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.registration_kind IS
  'Discriminates player registration periods so that LC-08 non-overlap applies within a kind — a permanent registration and a concurrent loan-out are distinct kinds.';

INSERT INTO football.registration_kind (code, display_name, meaning) VALUES
  ('PERMANENT', 'Permanent', 'Standard club registration.'),
  ('LOAN_IN',   'Loan in',   'Player registered on loan from another club.'),
  ('LOAN_OUT',  'Loan out',  'Player loaned to another club; parent registration continues.');

CREATE TABLE football.unavailability_kind (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_unavailability_kind                 PRIMARY KEY (code),
  CONSTRAINT ck_unavailability_kind__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.unavailability_kind IS
  'E1.11 discriminator. Suspensions may be competition-scoped while injuries are not; the kind carries that distinction.';

INSERT INTO football.unavailability_kind (code, display_name, meaning) VALUES
  ('INJURY',      'Injury',      'Physical unavailability. Not competition-scoped.'),
  ('SUSPENSION',  'Suspension',  'Disciplinary unavailability. May be competition-scoped.'),
  ('OTHER',       'Other',       'Unavailable for a reason the provider does not classify.');

CREATE TABLE football.participation_state (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_participation_state                 PRIMARY KEY (code),
  CONSTRAINT ck_participation_state__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.participation_state IS
  'E1.17. A single stated participation state replaces two booleans that could not express the third and fourth cases (LC-16).';

INSERT INTO football.participation_state (code, display_name, meaning) VALUES
  ('STARTED',          'Started',          'Named in the starting eleven.'),
  ('SUBSTITUTED_ON',   'Substituted on',   'Entered from the bench.'),
  ('UNUSED_SUBSTITUTE','Unused substitute','Named on the bench and did not play.'),
  ('NOT_SELECTED',     'Not selected',     'Available but not named in the squad.');

-- -----------------------------------------------------------------------------
-- Shared calculation vocabularies — held in football
-- -----------------------------------------------------------------------------
-- REVISION 2 (B-07). subject_kind, provenance_class and context_kind are
-- referenced from football, feature, module AND calibration. Doc 08 §5.3.3
-- states absolutely that football references nothing outside itself, and lists
-- calibration's permitted targets without feature. football is therefore the
-- only schema every referrer may reference, and these vocabularies belong here.
--
-- This applies the principle the implementation already used for snapshot_point
-- and currency above, consistently. It is a PHYSICAL RELOCATION ONLY: Phase 4
-- classifies these as Identity Components and a Value Object (E2.06, E2.07,
-- E2.08), whose realisation as lookup relations and the schema they occupy are
-- physical decisions under §5.4.2 and §5.4.4. No logical entity moves.

CREATE TABLE football.subject_kind (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_subject_kind                 PRIMARY KEY (code),
  CONSTRAINT ck_subject_kind__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.subject_kind IS
  'E2.06 Subject Reference discriminator. Realised as a kind code plus one typed FK column per kind, with a check asserting exactly the corresponding column is populated (PD-03). Only a typed FK can guarantee LC-35.';

INSERT INTO football.subject_kind (code, display_name, meaning) VALUES
  ('TEAM',                'Team',                'The value describes a club.'),
  ('PLAYER',              'Player',              'The value describes a player.'),
  ('FIXTURE',             'Fixture',             'The value describes a fixture.'),
  ('COMPETITION_EDITION', 'Competition edition', 'The value describes a competition edition.');

CREATE TABLE football.context_kind (
  code                 text        NOT NULL,
  display_name         text        NOT NULL,
  meaning              text        NOT NULL,
  requires_edition     boolean     NOT NULL,
  effective_from       timestamptz NOT NULL DEFAULT now(),
  effective_to         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_context_kind                 PRIMARY KEY (code),
  CONSTRAINT ck_context_kind__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.context_kind IS
  'E2.08 Feature Context. Exactly three kinds. Context is mandatory and explicit — there is no absent context meaning global, because absent and unset are indistinguishable (LC-38).';
COMMENT ON COLUMN football.context_kind.requires_edition IS
  'TRUE only for COMPETITION_SCOPED. Drives the conditional check on every calculated relation (LC-39).';

INSERT INTO football.context_kind (code, display_name, meaning, requires_edition) VALUES
  ('COMPETITION_SCOPED',       'Competition-scoped',       'Describes the subject within one competition edition. Form quality, opponent-adjusted strength, venue performance.', true),
  ('ALL_COMPETITIONS',         'All competitions',         'Describes the subject overall. Fatigue, injury burden, travel load — quantities that do not partition.',            false),
  ('CROSS_COMPETITION_DERIVED','Cross-competition derived','Explicitly about the interaction between competitions. Congestion, active competition count, rotation pressure.',    false);

CREATE TABLE football.provenance_class (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  strength_rank   smallint    NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_provenance_class                 PRIMARY KEY (code),
  CONSTRAINT uq_provenance_class__strength_rank  UNIQUE (strength_rank),
  CONSTRAINT ck_provenance_class__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE football.provenance_class IS
  'E2.07 Feature Provenance. Declares how strongly a value is known. Travels into evidence, into sealed content, and into anything a consumer sees (LC-36).';
COMMENT ON COLUMN football.provenance_class.strength_rank IS
  'Ordinal strength, higher is stronger. Used by the statement-level propagation trigger of migration 015 to assert LC-37: a derived value is no stronger than the weakest input in its lineage.';

INSERT INTO football.provenance_class (code, display_name, meaning, strength_rank) VALUES
  ('OBSERVED',  'Observed',  'A provider stated it.',                                   4),
  ('DERIVED',   'Derived',   'Calculated from observed facts.',                         3),
  ('INFERRED',  'Inferred',  'Reconstructed by heuristic where no direct source exists.',2),
  ('ESTIMATED', 'Estimated', 'Modelled in the absence of any source.',                   1);

-- -----------------------------------------------------------------------------
-- module — judgement vocabularies
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_status (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  is_engaged      boolean     NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_module_status                 PRIMARY KEY (code),
  CONSTRAINT ck_module_status__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE module.module_status IS
  'E3.07 Module Status. INACTIVE and NEUTRAL are distinct and are scored separately (LC-69). Conflating them is how a platform begins overstating its coverage — a module silent for want of data looks identical to one that examined the fixture and found it unremarkable.';
COMMENT ON COLUMN module.module_status.is_engaged IS
  'TRUE where the module had sufficient data to speak. FALSE for INACTIVE only.';

INSERT INTO module.module_status (code, display_name, meaning, is_engaged) VALUES
  ('SUPPORTS',    'Supports',    'The module''s reading agrees with the characterisation.',      true),
  ('NEUTRAL',     'Neutral',     'The module spoke and found nothing of consequence.',           true),
  ('CONTRADICTS', 'Contradicts', 'The module''s reading argues against the characterisation.',   true),
  ('INACTIVE',    'Inactive',    'Insufficient data to speak. Distinct from NEUTRAL.',           false);

CREATE TABLE module.calibration_mode (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_calibration_mode                 PRIMARY KEY (code),
  CONSTRAINT ck_calibration_mode__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE module.calibration_mode IS
  'E3.02 declaration. A module characterising an environment rather than claiming an outcome is not outcome-scored, and this has direct consequences for what may legitimately be displayed alongside it.';

INSERT INTO module.calibration_mode (code, display_name, meaning) VALUES
  ('OUTCOME_SCORED', 'Outcome scored', 'Measured against a stated outcome dimension.'),
  ('CONTEXTUAL',     'Contextual',     'Characterises an environment; not outcome-scored.');

CREATE TABLE module.model_output_type (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_model_output_type                 PRIMARY KEY (code),
  CONSTRAINT ck_model_output_type__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE module.model_output_type IS
  'E4.06. The unit over which exactly one model is canonical at any instant. Canonicity is held in calibration.model_canonical_designation, effective-dated, never on the sealed output row (A.8).';

-- -----------------------------------------------------------------------------
-- calibration — measurement vocabularies
-- -----------------------------------------------------------------------------

CREATE TABLE calibration.outcome_dimension (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_outcome_dimension                 PRIMARY KEY (code),
  CONSTRAINT ck_outcome_dimension__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE calibration.outcome_dimension IS
  'E7.04 Outcome Dimension. A module is measured against the dimension it actually addresses. Measuring a scoring-environment module against result would produce a figure that is precise, reproducible and meaningless (LC-128).';

INSERT INTO calibration.outcome_dimension (code, display_name, meaning) VALUES
  ('MATCH_RESULT',   'Match result',    'Home win, draw, or away win.'),
  ('GOAL_TOTAL',     'Goal total',      'Total goals scored in the fixture.'),
  ('BOTH_SCORED',    'Both teams scored','Whether both sides scored.'),
  ('CLEAN_SHEET',    'Clean sheet',     'Whether either side conceded none.'),
  ('HALF_TIME_STATE','Half-time state', 'The result standing at the interval.'),
  ('MARGIN',         'Margin',          'The absolute goal difference.');

-- -----------------------------------------------------------------------------
-- operations — telemetry vocabularies
-- -----------------------------------------------------------------------------

CREATE TABLE operations.failure_class (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  is_retryable    boolean     NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_failure_class                 PRIMARY KEY (code),
  CONSTRAINT ck_failure_class__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE operations.failure_class IS
  'E9.04 classification. Governs retry eligibility (§5.12.8). A deterministic failure is never retried automatically, because retrying it produces the same failure and obscures it in the operational record.';

INSERT INTO operations.failure_class (code, display_name, meaning, is_retryable) VALUES
  ('TRANSIENT',    'Transient',    'Infrastructure fault expected to resolve.',            true),
  ('UPSTREAM',     'Upstream',     'External provider fault.',                             true),
  ('DATA_QUALITY', 'Data quality', 'An assertion failed. Never retried automatically.',    false),
  ('LOGIC',        'Logic',        'A defect in a calculation or migration. Never retried.',false);

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname IN ('football','feature','module','calibration','operations')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO pt_owner', t.schemaname, t.tablename);
  END LOOP;
END
$$;
