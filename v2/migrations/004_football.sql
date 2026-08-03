-- =============================================================================
-- 004_football.sql
-- REVISION 2
-- PitchTerminal V2 — Layer 1 structural relations
-- =============================================================================
-- Source of truth : Document 08 Revision 1, §B.8.5 stage 4, §5.20.1
-- Depends on      : 001, 002
-- Transactional   : yes
--
-- Purpose
--   Creates the unpartitioned reality relations: the competition hierarchy,
--   participants, and provider-reported statistics.
--
-- Layer rule
--   No relation in this schema carries an attribute the platform computed.
--   Specifically excluded: a sufficiency gate on provider statistics, and
--   computed injury summary attributes on the player record. Both are Layer 2
--   features (LC-07, LC-19).
--
-- Rules applied
--   C-01          Surrogate primary key, plus a unique constraint expressing
--                 business identity
--   §5.6.6        Provider external identifiers are ALTERNATE keys, never
--                 business keys — a provider may reissue an identifier without
--                 the entity changing
--   §5.7.6        Spells and periods are range types, admitting EXCLUDE
--   PD-09         Referential actions are RESTRICT / RESTRICT throughout
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Competition hierarchy
-- -----------------------------------------------------------------------------

CREATE TABLE football.competition (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  provider_external_id  text        NOT NULL,
  provider_code         text        NOT NULL,
  name                  text        NOT NULL,
  slug                  text        NOT NULL,
  country_code          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition                       PRIMARY KEY (id),
  CONSTRAINT uq_competition__provider_external_id UNIQUE (provider_code, provider_external_id),
  CONSTRAINT uq_competition__slug                 UNIQUE (slug),
  CONSTRAINT fk_competition__country              FOREIGN KEY (country_code)
    REFERENCES football.country (code) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE football.competition IS
  'E1.02 Competition. A competition''s STABLE IDENTITY ACROSS ALL TIME, deliberately independent of name and sponsor. A competition renamed, responsored or restructured remains the same competition — which is why calibration keys on this identity and not on a name.';
COMMENT ON COLUMN football.competition.provider_external_id IS
  'Alternate key, not business identity (§5.6.6).';

CREATE TABLE football.competition_edition (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  competition_id        bigint      NOT NULL,
  provider_external_id  text,
  season_label          text        NOT NULL,
  season_period         daterange   NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition_edition                    PRIMARY KEY (id),
  CONSTRAINT uq_competition_edition__competition_period UNIQUE (competition_id, season_period),
  CONSTRAINT fk_competition_edition__competition       FOREIGN KEY (competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_competition_edition__period_bounded    CHECK (NOT isempty(season_period)),
  CONSTRAINT ex_competition_edition__periods_do_not_overlap
    EXCLUDE USING gist (competition_id WITH =, season_period WITH &&)
);
COMMENT ON TABLE football.competition_edition IS
  'E1.03 Competition Edition — a competition in a specific season. THE most load-bearing entity in Layer 1. Its absence in the previous platform was the root of several unrelated-looking problems: statistics with no real referent, standings with no temporal home, fixtures with ambiguous context, and calibration keyed on a name that a sponsor rename could sever.';
COMMENT ON COLUMN football.competition_edition.season_period IS
  'A season is a BOUNDED PERIOD, not a label. The previous platform stored season as free text, which made "which season was active on this date" unanswerable.';

CREATE TABLE football.competition_stage (
  id                     bigint      GENERATED ALWAYS AS IDENTITY,
  competition_edition_id bigint      NOT NULL,
  parent_stage_id        bigint,
  stage_ordinal          integer     NOT NULL,
  nesting_depth          smallint    NOT NULL DEFAULT 0,
  name                   text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition_stage                   PRIMARY KEY (id),
  CONSTRAINT uq_competition_stage__edition_ordinal  UNIQUE (competition_edition_id, stage_ordinal),
  CONSTRAINT fk_competition_stage__edition          FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_competition_stage__parent           FOREIGN KEY (parent_stage_id)
    REFERENCES football.competition_stage (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_competition_stage__not_self_parent  CHECK (parent_stage_id IS NULL OR parent_stage_id <> id),
  CONSTRAINT ck_competition_stage__depth_bounded    CHECK (nesting_depth BETWEEN 0 AND 4)
);
COMMENT ON TABLE football.competition_stage IS
  'E1.04 Competition Stage. Group phase, knockout round, matchweek. The previous platform had no round concept at all, which left a documented product gap unfillable. Bounded nesting depth prevents unbounded recursion (§5.8.6).';

-- -----------------------------------------------------------------------------
-- Venue
-- -----------------------------------------------------------------------------

CREATE TABLE football.venue (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  provider_external_id  text,
  name                  text        NOT NULL,
  city                  text,
  country_code          text,
  latitude              numeric(8,6),
  longitude             numeric(9,6),
  elevation_metres      integer,
  timezone_name         text,
  capacity              integer,
  surface               text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_venue                       PRIMARY KEY (id),
  CONSTRAINT uq_venue__provider_external_id UNIQUE (provider_external_id),
  CONSTRAINT fk_venue__country              FOREIGN KEY (country_code)
    REFERENCES football.country (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_venue__latitude_in_range    CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  CONSTRAINT ck_venue__longitude_in_range   CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT ck_venue__coordinates_paired   CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT ck_venue__capacity_positive    CHECK (capacity IS NULL OR capacity > 0)
);
COMMENT ON TABLE football.venue IS
  'E1.05 Venue. An entity in its own right rather than an attribute of a club, because venues are shared, neutral venues exist, and travel calculation requires coordinates belonging to the place rather than to whoever plays there.';
COMMENT ON COLUMN football.venue.latitude IS
  'Six decimal places is approximately one-tenth of a metre, exceeding the accuracy of any provider-supplied coordinate. NULL coordinates yield no distance value — LC-05 requires absence rather than a substituted value, which follows from PD-07: absence of a distance is the absence of a feature value row.';

-- -----------------------------------------------------------------------------
-- Participants
-- -----------------------------------------------------------------------------

CREATE TABLE football.team (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  provider_external_id  text        NOT NULL,
  provider_code         text        NOT NULL,
  name                  text        NOT NULL,
  short_name            text,
  slug                  text        NOT NULL,
  country_code          text,
  home_venue_id         bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_team                       PRIMARY KEY (id),
  CONSTRAINT uq_team__provider_external_id UNIQUE (provider_code, provider_external_id),
  CONSTRAINT uq_team__slug                 UNIQUE (slug),
  CONSTRAINT fk_team__country              FOREIGN KEY (country_code)
    REFERENCES football.country (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_team__home_venue           FOREIGN KEY (home_venue_id)
    REFERENCES football.venue (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE football.team IS
  'E1.06 Team. One of the two hub entities. Identity is permanent without exception — sealed claims reference it indefinitely, so a club dissolved five years ago retains its identity (LC-02).';

CREATE TABLE football.team_registration (
  id                     bigint      GENERATED ALWAYS AS IDENTITY,
  team_id                bigint      NOT NULL,
  competition_edition_id bigint      NOT NULL,
  registered_on          date        NOT NULL,
  withdrawn_on           date,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_team_registration                PRIMARY KEY (id),
  CONSTRAINT uq_team_registration__team_edition  UNIQUE (team_id, competition_edition_id),
  CONSTRAINT fk_team_registration__team          FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_team_registration__edition       FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_team_registration__dates_ordered CHECK (withdrawn_on IS NULL OR withdrawn_on >= registered_on)
);
COMMENT ON TABLE football.team_registration IS
  'E1.07 Team Registration. Answers "which clubs are in this competition this season" — a question the previous platform could answer only by inference from standings or the fixture list, both indirect and both failing for a club registered but not yet played.';

CREATE TABLE football.player (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  provider_external_id  text        NOT NULL,
  provider_code         text        NOT NULL,
  full_name             text        NOT NULL,
  short_name            text,
  slug                  text        NOT NULL,
  date_of_birth         date,
  nationality_code      text,
  height_cm             smallint,
  preferred_foot        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_player                       PRIMARY KEY (id),
  CONSTRAINT uq_player__provider_external_id UNIQUE (provider_code, provider_external_id),
  CONSTRAINT uq_player__slug                 UNIQUE (slug),
  CONSTRAINT fk_player__nationality          FOREIGN KEY (nationality_code)
    REFERENCES football.country (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_player__height_plausible     CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 250),
  CONSTRAINT ck_player__preferred_foot_known CHECK (preferred_foot IS NULL OR preferred_foot IN ('LEFT','RIGHT','BOTH'))
);
COMMENT ON TABLE football.player IS
  'E1.08 Player. BIOGRAPHY ONLY. The previous platform carried four further concerns on this record — positional profile across five attributes plus a list, current club, injury state across ten attributes duplicating a separate structure, and an undated market value overwritten on every sync. All four are separated: position_profile, player_registration, player_availability, player_valuation. This record holds no computed attribute (LC-07).';

CREATE TABLE football.player_registration (
  id                     bigint      GENERATED ALWAYS AS IDENTITY,
  player_id              bigint      NOT NULL,
  team_id                bigint      NOT NULL,
  registration_kind_code text        NOT NULL,
  competition_edition_id bigint,
  registration_period    daterange   NOT NULL,
  provenance_class_code  text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_player_registration              PRIMARY KEY (id),
  CONSTRAINT fk_player_registration__player      FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_registration__team        FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_registration__kind        FOREIGN KEY (registration_kind_code)
    REFERENCES football.registration_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_registration__edition     FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_registration__provenance  FOREIGN KEY (provenance_class_code)
    REFERENCES football.provenance_class (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_player_registration__period_bounded CHECK (NOT isempty(registration_period)),
  CONSTRAINT ex_player_registration__no_overlap_per_kind
    EXCLUDE USING gist (player_id WITH =, registration_kind_code WITH =, registration_period WITH &&)
);
COMMENT ON TABLE football.player_registration IS
  'E1.09 Player Registration. Answers "who was at this club on this date". The previous platform stored current club only, so squad composition at any past moment had to be reconstructed by replaying transfers — and any gap in those records corrupted the reconstruction silently. A transfer is the BOUNDARY between two registrations, not an independent fact.';
COMMENT ON CONSTRAINT ex_player_registration__no_overlap_per_kind ON football.player_registration IS
  'LC-08. Non-overlap applies within a registration kind, so a permanent registration and a concurrent loan-out do not collide. Only an exclusion constraint can express this declaratively.';
COMMENT ON COLUMN football.player_registration.provenance_class_code IS
  'Preserves and generalises the one provenance marker the previous platform carried. An INFERRED registration boundary — derived by comparing squad snapshots — is a materially weaker fact than an OBSERVED one, and downstream consumers must be able to tell.';

CREATE TABLE football.position_profile (
  id                     bigint      GENERATED ALWAYS AS IDENTITY,
  player_id              bigint      NOT NULL,
  position_code          text        NOT NULL,
  role_rank              smallint    NOT NULL,
  provenance_class_code  text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_position_profile                  PRIMARY KEY (id),
  CONSTRAINT uq_position_profile__player_position UNIQUE (player_id, position_code),
  CONSTRAINT uq_position_profile__player_rank     UNIQUE (player_id, role_rank),
  CONSTRAINT fk_position_profile__player          FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_position_profile__position        FOREIGN KEY (position_code)
    REFERENCES football.position (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_position_profile__provenance      FOREIGN KEY (provenance_class_code)
    REFERENCES football.provenance_class (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_position_profile__rank_positive   CHECK (role_rank >= 1)
);
COMMENT ON TABLE football.position_profile IS
  'E1.10 Position Profile — PROVIDER-ASSERTED form. Replaces five attributes plus a list representation with no declared precedence, which made "which players can play at left-back" a scan across six representations. The CALCULATED profile, derived from observed appearances, is a Layer 2 feature and is a different fact with a different owner (LC-117).';

CREATE TABLE football.player_availability (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  player_id               bigint      NOT NULL,
  unavailability_kind_code text       NOT NULL,
  competition_edition_id  bigint,
  spell_period            daterange   NOT NULL,
  expected_return_on      date,
  reason                  text,
  severity_rank           smallint,
  position_code_at_onset  text,
  valuation_amount_at_onset numeric,
  valuation_currency_code_at_onset text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_player_availability             PRIMARY KEY (id),
  CONSTRAINT fk_player_availability__player     FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_availability__kind       FOREIGN KEY (unavailability_kind_code)
    REFERENCES football.unavailability_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_availability__edition    FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_availability__position   FOREIGN KEY (position_code_at_onset)
    REFERENCES football.position (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_availability__currency   FOREIGN KEY (valuation_currency_code_at_onset)
    REFERENCES football.currency (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_player_availability__period_bounded CHECK (NOT isempty(spell_period)),
  CONSTRAINT ck_player_availability__valuation_currencied
    CHECK ((valuation_amount_at_onset IS NULL) = (valuation_currency_code_at_onset IS NULL)),
  CONSTRAINT ex_player_availability__no_overlap_per_kind
    EXCLUDE USING gist (player_id WITH =, unavailability_kind_code WITH =, spell_period WITH &&)
);
COMMENT ON TABLE football.player_availability IS
  'E1.11 Player Availability. Holds in ONE owner what the previous platform held in two — ten attributes on the player record and a separate injury structure, both written by the same process with nothing constraining them to agree. The resolution is removal of one representation, not synchronisation of both. CURRENT AVAILABILITY IS A QUERY OVER OPEN SPELLS, NEVER A STORED FLAG (LC-11).';
COMMENT ON COLUMN football.player_availability.position_code_at_onset IS
  'Point-in-time capture. A player''s importance at the moment of injury is not recoverable later once the profile moves on. The previous platform applied this instinct here and almost nowhere else; it is preserved.';

CREATE TABLE football.player_valuation (
  id                  bigint      GENERATED ALWAYS AS IDENTITY,
  player_id           bigint      NOT NULL,
  source_code         text        NOT NULL,
  as_of_on            date        NOT NULL,
  amount              numeric     NOT NULL,
  currency_code       text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_player_valuation                   PRIMARY KEY (id),
  CONSTRAINT uq_player_valuation__player_src_asof  UNIQUE (player_id, source_code, as_of_on),
  CONSTRAINT fk_player_valuation__player           FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_valuation__currency         FOREIGN KEY (currency_code)
    REFERENCES football.currency (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_player_valuation__amount_non_negative CHECK (amount >= 0)
);
COMMENT ON TABLE football.player_valuation IS
  'E1.12 Player Valuation — market value OVER TIME. APPEND-ONLY: a dated observation, not a description of a permanent present. The previous platform stored one undated, uncurrencied scalar overwritten on every ingestion, discarding valuation TRAJECTORY continuously — and a rising and a falling valuation at the same absolute figure describe very different players.';

CREATE TABLE football.official (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  provider_external_id  text,
  full_name             text        NOT NULL,
  country_code          text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_official                       PRIMARY KEY (id),
  CONSTRAINT uq_official__provider_external_id UNIQUE (provider_external_id),
  CONSTRAINT fk_official__country              FOREIGN KEY (country_code)
    REFERENCES football.country (code) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE football.official IS
  'E1.15a Official. Stable identity so officiating patterns can be analysed across fixtures rather than treated as per-fixture text.';

-- -----------------------------------------------------------------------------
-- Provider statistics and standings
-- -----------------------------------------------------------------------------

CREATE TABLE football.provider_statistic (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  subject_kind_code       text        NOT NULL,
  player_id               bigint,
  team_id                 bigint,
  affiliation_team_id     bigint      NOT NULL,
  competition_edition_id  bigint      NOT NULL,
  statistics_domain_code  text        NOT NULL,
  provider_code           text        NOT NULL,
  measures                jsonb       NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_provider_statistic PRIMARY KEY (id),
  CONSTRAINT uq_provider_statistic__subject_affiliation_edition_domain
    UNIQUE (subject_kind_code, player_id, team_id, affiliation_team_id, competition_edition_id, statistics_domain_code, provider_code),
  CONSTRAINT fk_provider_statistic__subject_kind FOREIGN KEY (subject_kind_code)
    REFERENCES football.subject_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_provider_statistic__player       FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_provider_statistic__team         FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_provider_statistic__affiliation  FOREIGN KEY (affiliation_team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_provider_statistic__edition      FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_provider_statistic__domain       FOREIGN KEY (statistics_domain_code)
    REFERENCES football.statistics_domain (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_provider_statistic__subject_exclusive CHECK (
    (subject_kind_code = 'PLAYER' AND player_id IS NOT NULL AND team_id IS NULL) OR
    (subject_kind_code = 'TEAM'   AND team_id   IS NOT NULL AND player_id IS NULL)
  )
);
COMMENT ON TABLE football.provider_statistic IS
  'E1.21 Provider Statistic Record, partitioned BY DOMAIN. A goalkeeper carries participation and goalkeeping only; sparsity ceases to exist rather than being tolerated. THE IDENTITY INCLUDES THE AFFILIATION CLUB, which is what makes a mid-season transfer and dual-competition participation representable — the previous platform''s identity rule permitted one record per player per season and could represent neither (LC-19).';
COMMENT ON COLUMN football.provider_statistic.measures IS
  'PERMITTED STRUCTURED PAYLOAD under PD-16 circumstance 1: a retained provider response, opaque by definition, never queried by content in a production read path. Every measure consumed by a calculation is read through a declared feature source, not by content search on this column.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   Doc 08 §5.20.1 specifies that statistics are partitioned by domain and that
--   identity includes the club, but does not enumerate the measures within each
--   domain. Holding measures as an opaque provider payload is the only
--   representation available without inventing attribute names, and it is
--   explicitly permitted by PD-16 circumstance 1. If the intent was columnar
--   measures per domain, the domain relations must be enumerated before DDL is
--   finalised. Confirm before Phase 6 sign-off.

CREATE TABLE football.standing (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  competition_edition_id  bigint      NOT NULL,
  team_id                 bigint      NOT NULL,
  standing_variant        text        NOT NULL,
  as_of_on                date        NOT NULL,
  position                integer     NOT NULL,
  played                  integer     NOT NULL,
  won                     integer     NOT NULL,
  drawn                   integer     NOT NULL,
  lost                    integer     NOT NULL,
  goals_for               integer     NOT NULL,
  goals_against           integer     NOT NULL,
  points                  integer     NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_standing PRIMARY KEY (id),
  CONSTRAINT uq_standing__edition_team_variant_asof
    UNIQUE (competition_edition_id, team_id, standing_variant, as_of_on),
  CONSTRAINT fk_standing__edition FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_standing__team    FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_standing__variant_known CHECK (standing_variant IN ('TOTAL','HOME','AWAY')),
  CONSTRAINT ck_standing__counts_consistent CHECK (played = won + drawn + lost),
  CONSTRAINT ck_standing__counts_non_negative
    CHECK (played >= 0 AND won >= 0 AND drawn >= 0 AND lost >= 0 AND goals_for >= 0 AND goals_against >= 0)
);
COMMENT ON TABLE football.standing IS
  'E1.20 Standing — a club''s position AS OF A DATE. APPEND-ONLY. The temporal qualifier is the entire point: the previous platform stored current standings only, which is why a separate point-in-time reconstruction mechanism had to be built for backtesting. Making standings temporal REMOVES that compensating mechanism from the system rather than reimplementing it (LC-18).';

-- -----------------------------------------------------------------------------
-- Ownership
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'competition','competition_edition','competition_stage','venue','team',
    'team_registration','player','player_registration','position_profile',
    'player_availability','player_valuation','official','provider_statistic','standing'
  ]
  LOOP
    EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;
