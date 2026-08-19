-- =============================================================================
-- 025_governance_tracked_competition_and_edition.sql
--   Governance layer for broad automated ingestion.
--   Source: docs/db-v2/95-dgate-tracked-competition-and-edition-governance-design.md
--           (design commit 801741f, verdict DESIGN READY)
--           and its implementation-readiness review (verdict IMPLEMENTATION READY).
--   Depends: 001-024  |  Transactional
--
-- WHAT THIS MIGRATION IS, AND WHAT IT IS NOT
--
-- It materializes the two governance relations that answer, deterministically and
-- fail-closed, two questions broad automated ingestion cannot currently answer:
--
--     governance.tracked_competition  — "which competitions may be ingested?"
--     governance.tracked_edition      — "which season of each may be ingested?"
--
-- It does NOT wire broad automated ingestion, provider enumeration, or any
-- discovery→authorization promotion. Authorization is a GOVERNED ADMIN ACTION,
-- never a side effect of discovery (Doc 95 §6-7). The bounded operator path (I1)
-- reads no governance state and is deliberately left untouched: the authorization
-- predicate belongs ABOVE the shared writer, not inside ingestEvents /
-- resolveCompetition (readiness review §7).
--
-- IDENTITY IS NOT AUTHORIZATION. The governance rows key on PROVIDER identity
-- (provider_code, provider_external_id) so a competition can be authorized BEFORE
-- its football.competition reality row exists. The nullable competition_id /
-- competition_edition_id are linkage, set once reality materializes — never the
-- authorization key (Doc 95 §2, readiness review §1).
--
-- SECURITY. Created after 016 forced row-level security across the design schemas,
-- so this file must ENABLE and FORCE it for its own relations, declare every grant
-- through operations.fn_apply_access (so no privilege exists without its policy),
-- and — because the assertion functions of 016/018 enumerate a fixed schema list
-- that predates this schema — REPLACE those two functions to bring `governance`
-- under the same posture and correspondence checks. pt_pipeline_ingestion may READ
-- governance to evaluate authorization but holds no write of any kind: the
-- ingesting role can never self-authorize (readiness review §5-6). No role holds
-- DELETE; governance change is a status transition, not destruction.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS governance AUTHORIZATION pt_owner;
COMMENT ON SCHEMA governance IS
  'PitchTerminal ingestion governance. NOT provider reality (that is football) and NOT telemetry (that is operations): this schema holds PT POLICY — which competitions and which seasons broad automated ingestion is authorized to touch. Discovery proposes; only a governed decision here authorizes.';

GRANT USAGE ON SCHEMA governance TO pt_pipeline_ingestion, pt_platform_admin;

-- -----------------------------------------------------------------------------
-- Vocabularies — lookup tables, per the migration 002 convention. NOT enums,
-- NOT free text. Seeded here (before RLS is forced below, exactly as migration
-- 016 seeds product.platform_setting before the force sweep) with their initial
-- codes; extension is a later governed act by pt_platform_admin.
-- -----------------------------------------------------------------------------

CREATE TABLE governance.competition_type (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition_type                 PRIMARY KEY (code),
  CONSTRAINT ck_competition_type__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE governance.competition_type IS
  'Governed competition FORMAT classification. Deliberately minimal (Doc 95 §5): the only distinction ingestion needs is league vs cup (standings/round-robin expectations). Provider category.name is a hint at most and is not stored as a type. Youth/reserve/friendly are handled by NEVER granting TRACKED status, not by taxonomy.';
INSERT INTO governance.competition_type (code, display_name, meaning) VALUES
  ('LEAGUE', 'League', 'Round-robin domestic or continental league; a season table applies.'),
  ('CUP',    'Cup',    'Knockout and/or group competition; a full league table does not apply.'),
  ('OTHER',  'Other',  'A competition PitchTerminal has not classified as league or cup. Honest bucket; never a default that authorizes ingestion.');

CREATE TABLE governance.competition_scope (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_competition_scope                 PRIMARY KEY (code),
  CONSTRAINT ck_competition_scope__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE governance.competition_scope IS
  'Governed competition GEOGRAPHY classification, orthogonal to type (Doc 95 §5). Needed because continental competitions map to provider category ''World''/unmapped and cannot be inferred from stored football.competition.country_code.';
INSERT INTO governance.competition_scope (code, display_name, meaning) VALUES
  ('DOMESTIC',      'Domestic',      'A single country''s competition.'),
  ('CONTINENTAL',   'Continental',   'A confederation competition spanning one continent''s nations or clubs.'),
  ('INTERNATIONAL', 'International',  'A worldwide competition.');

CREATE TABLE governance.tracking_status (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_tracking_status                 PRIMARY KEY (code),
  CONSTRAINT ck_tracking_status__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE governance.tracking_status IS
  'Tracked-competition lifecycle (Doc 95 §10.A). Only CANDIDATE is reached automatically (from discovery); every other transition is a governed admin action. Broad ingestion is authorized only at TRACKED.';
INSERT INTO governance.tracking_status (code, display_name, meaning) VALUES
  ('CANDIDATE', 'Candidate', 'Discovered but not authorized. The only status discovery may create. Carries no ingestion authorization.'),
  ('TRACKED',   'Tracked',   'Authorized in principle for broad ingestion. Requires classification and an ACTIVE edition before any season is ingested.'),
  ('SUSPENDED', 'Suspended', 'Previously tracked, ingestion paused by governance; record and history retained.'),
  ('RETIRED',   'Retired',   'No longer ingested. Terminal governed state; the row is retained, never deleted.');

CREATE TABLE governance.edition_status (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_edition_status                 PRIMARY KEY (code),
  CONSTRAINT ck_edition_status__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE governance.edition_status IS
  'Governed season/edition lifecycle (Doc 95 §10.B). ACTIVE is the deterministic season selector — never seasons[0], max(year), name parsing, or provider ordering. At most one ACTIVE per competition (enforced by a partial unique index below).';
INSERT INTO governance.edition_status (code, display_name, meaning) VALUES
  ('APPROVED',    'Approved',    'Governance has approved this season for ingestion but it is not the current active edition.'),
  ('ACTIVE',      'Active',      'The one current edition of its competition. Exactly one per tracked competition at any instant.'),
  ('SUPERSEDED',  'Superseded',  'Was active; replaced by a newer active edition during a governed season transition.'),
  ('HISTORICAL',  'Historical',  'A past edition retained for possible explicit re-ingestion; not part of current authorization.'),
  ('UNAVAILABLE', 'Unavailable', 'Temporarily not ingestable (e.g. provider gap) without losing the binding or its history.');

-- -----------------------------------------------------------------------------
-- governance.tracked_competition  (Doc 95 §2)
-- -----------------------------------------------------------------------------

CREATE TABLE governance.tracked_competition (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  -- IDENTITY (provider). The authorization key; decidable before reality exists.
  provider_code           text        NOT NULL,
  provider_external_id    text        NOT NULL,
  -- CLASSIFICATION (governed). NULL is legitimate for a CANDIDATE; required at TRACKED.
  competition_type_code   text,
  competition_scope_code  text,
  -- GOVERNANCE STATE.
  tracking_status_code    text        NOT NULL DEFAULT 'CANDIDATE',
  decided_by              text,
  decided_at              timestamptz,
  note                    text,
  -- OPERATIONAL LINKAGE. NULL until the football.competition reality row exists.
  competition_id          bigint,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_tracked_competition                  PRIMARY KEY (id),
  CONSTRAINT uq_tracked_competition__provider        UNIQUE (provider_code, provider_external_id),
  CONSTRAINT fk_tracked_competition__type            FOREIGN KEY (competition_type_code)
    REFERENCES governance.competition_type (code)  ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tracked_competition__scope           FOREIGN KEY (competition_scope_code)
    REFERENCES governance.competition_scope (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tracked_competition__status          FOREIGN KEY (tracking_status_code)
    REFERENCES governance.tracking_status (code)   ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Linkage only, and IMMUTABLE-parented at the reality layer already: RESTRICT so
  -- a governance row can never be orphaned by deleting the competition it names.
  CONSTRAINT fk_tracked_competition__competition     FOREIGN KEY (competition_id)
    REFERENCES football.competition (id)           ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Classification is REQUIRED once a competition is tracked (Doc 95 §2 inv. 6):
  -- an authorized competition whose type/scope is unknown is a governance gap, not
  -- a tracked competition.
  CONSTRAINT ck_tracked_competition__classified_when_tracked
    CHECK (tracking_status_code <> 'TRACKED'
           OR (competition_type_code IS NOT NULL AND competition_scope_code IS NOT NULL))
);
COMMENT ON TABLE governance.tracked_competition IS
  'E-GOV.01 Tracked competition. Keyed on PROVIDER identity so authorization survives the window before football.competition exists. competition_id is nullable linkage, never the authorization key. Broad ingestion is authorized only at tracking_status_code = TRACKED (with an ACTIVE tracked_edition and authorized_for_ingestion). Discovery may create CANDIDATE rows and nothing more.';
COMMENT ON COLUMN governance.tracked_competition.provider_external_id IS
  'The provider uniqueTournament.id, as text. With provider_code this is the alternate key that joins to football.competition (provider_code, provider_external_id) once that row exists.';
COMMENT ON COLUMN governance.tracked_competition.competition_id IS
  'Nullable linkage to the materialized football.competition. LINKAGE AND CONSISTENCY, NOT AUTHORIZATION. NULL means authorized/known but not yet ingested.';

-- One governance row per materialized competition (Doc 95 §2 inv. 4). Partial
-- because many CANDIDATE rows may legitimately have no reality row yet (NULL).
CREATE UNIQUE INDEX uq_tracked_competition__competition
  ON governance.tracked_competition (competition_id)
  WHERE competition_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- governance.tracked_edition  (Doc 95 §3)
-- -----------------------------------------------------------------------------

CREATE TABLE governance.tracked_edition (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  tracked_competition_id      bigint      NOT NULL,
  -- IDENTITY (provider). The season.id this binding authorizes.
  provider_season_external_id text        NOT NULL,
  -- GOVERNANCE STATE.
  edition_status_code         text        NOT NULL DEFAULT 'APPROVED',
  -- EXPLICIT AUTHORIZATION. Defaults to FALSE: a binding never silently authorizes
  -- ingestion (Doc 95 §3, readiness review §5.9-10).
  authorized_for_ingestion    boolean     NOT NULL DEFAULT false,
  -- Governance-approved period. Agrees with the linked edition's immutable period
  -- once linked; required once ACTIVE.
  season_period               daterange,
  decided_by                  text,
  decided_at                  timestamptz,
  note                        text,
  -- OPERATIONAL LINKAGE. NULL until football.competition_edition exists.
  competition_edition_id      bigint,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_tracked_edition                       PRIMARY KEY (id),
  CONSTRAINT uq_tracked_edition__competition_season   UNIQUE (tracked_competition_id, provider_season_external_id),
  CONSTRAINT fk_tracked_edition__competition          FOREIGN KEY (tracked_competition_id)
    REFERENCES governance.tracked_competition (id)   ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tracked_edition__status               FOREIGN KEY (edition_status_code)
    REFERENCES governance.edition_status (code)      ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tracked_edition__edition              FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id)     ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tracked_edition__period_nonempty
    CHECK (season_period IS NULL OR NOT isempty(season_period)),
  -- An ACTIVE edition must have a bounded period: it is the current thing being
  -- ingested, and "current" with no dates is not a governed edition.
  CONSTRAINT ck_tracked_edition__active_requires_period
    CHECK (edition_status_code <> 'ACTIVE'
           OR (season_period IS NOT NULL AND NOT isempty(season_period)))
);
COMMENT ON TABLE governance.tracked_edition IS
  'E-GOV.02 Tracked edition — the durable, auditable form of the safe operator-supplied --season. Keyed on (tracked_competition_id, provider_season_external_id). The single ACTIVE row per competition IS the deterministic season selection. authorized_for_ingestion is the explicit gate and defaults false. competition_edition_id is nullable linkage, not the authorization key.';
COMMENT ON COLUMN governance.tracked_edition.authorized_for_ingestion IS
  'Explicit ingestion authorization, default FALSE. ACTIVE lifecycle and authorization are separate: an ACTIVE edition can be de-authorized without changing its lifecycle. Broad ingestion requires TRACKED competition AND ACTIVE edition AND this = true.';

-- FK/join support for the authorization predicate and for casc'ing lookups.
CREATE INDEX ix_tracked_edition__competition
  ON governance.tracked_edition (tracked_competition_id);

-- ONE ACTIVE EDITION PER TRACKED COMPETITION (Doc 95 §3 inv. 8; readiness §3).
-- A PARTIAL UNIQUE INDEX, and therefore NON-DEFERRABLE — see the transition note.
CREATE UNIQUE INDEX uq_tracked_edition__one_active
  ON governance.tracked_edition (tracked_competition_id)
  WHERE edition_status_code = 'ACTIVE';

-- One governance edition per materialized reality edition (Doc 95 §3 inv. 5).
CREATE UNIQUE INDEX uq_tracked_edition__competition_edition
  ON governance.tracked_edition (competition_edition_id)
  WHERE competition_edition_id IS NOT NULL;

-- SEASON TRANSITION PROTOCOL (readiness review §10-11; NOT a trigger).
-- uq_tracked_edition__one_active is a partial unique INDEX and cannot be deferred.
-- A season transition MUST therefore occur in this order, within one transaction:
--     1. demote the current ACTIVE edition (ACTIVE -> SUPERSEDED / HISTORICAL)
--     2. promote the incoming edition (APPROVED -> ACTIVE)
--     3. COMMIT
-- Never promote-then-demote: the intermediate two-ACTIVE state violates the index
-- and the transaction aborts. No transient state with two ACTIVE editions can
-- exist, and ingestion (a separate transaction) always sees exactly one or none.

-- =============================================================================
-- ROW-LEVEL SECURITY  — enable, force, then declare grants+policies as one
-- specification through the migration 016 applicator. (readiness review §5, §9)
-- =============================================================================

DO $rls$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS t
    FROM pg_class c
    WHERE c.relnamespace = 'governance'::regnamespace
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE governance.%I ENABLE ROW LEVEL SECURITY', r.t);
    EXECUTE format('ALTER TABLE governance.%I FORCE ROW LEVEL SECURITY',  r.t);
  END LOOP;
END
$rls$;

-- Vocabularies: administration maintains them (S,I,U); ingestion reads them.
SELECT operations.fn_apply_access('governance','competition_type', 'pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','competition_type', 'pt_pipeline_ingestion', 'S');
SELECT operations.fn_apply_access('governance','competition_scope','pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','competition_scope','pt_pipeline_ingestion', 'S');
SELECT operations.fn_apply_access('governance','tracking_status',  'pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','tracking_status',  'pt_pipeline_ingestion', 'S');
SELECT operations.fn_apply_access('governance','edition_status',   'pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','edition_status',   'pt_pipeline_ingestion', 'S');

-- The two governance relations: administration is the routine mutation principal
-- (S,I,U — NO DELETE); ingestion reads to evaluate authorization and NOTHING more.
SELECT operations.fn_apply_access('governance','tracked_competition','pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','tracked_competition','pt_pipeline_ingestion', 'S');
SELECT operations.fn_apply_access('governance','tracked_edition',    'pt_platform_admin',     'SIU');
SELECT operations.fn_apply_access('governance','tracked_edition',    'pt_pipeline_ingestion', 'S');

-- Sequences backing the two IDENTITY columns. GENERATED ALWAYS AS IDENTITY does
-- not require separate USAGE for the owning table's inserts, but the platform's
-- posture (migration 016) grants sequence usage explicitly; matched here for the
-- new schema so the convention holds uniformly.
DO $seq$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace = 'governance'::regnamespace AND c.relkind = 'S'
  LOOP
    EXECUTE format('GRANT USAGE ON SEQUENCE governance.%I TO pt_platform_admin', r.t);
  END LOOP;
END
$seq$;

-- =============================================================================
-- BRING `governance` UNDER THE EXISTING SECURITY ASSERTIONS
--
-- The assertion functions of migrations 016 and 018 enumerate a fixed schema list
-- that predates this schema. Rather than leave governance outside the checks (the
-- exact silent gap those functions exist to prevent), they are REPLACED here with
-- `governance` added — a faithful copy of each, with only the schema list extended
-- and, for the posture, one governance-specific assertion added (no role but the
-- owner may hold DELETE on any governance relation). Historical migrations are not
-- rewritten; the replacement is additive and forward-only.
-- =============================================================================

-- Correspondence: every non-owner DML privilege in the design schemas must have a
-- covering policy. (Verbatim from migration 016 with 'governance' added.)
CREATE OR REPLACE FUNCTION operations.fn_assert_access_correspondence() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  offenders text;
  n         integer;
BEGIN
  WITH granted AS (
    SELECT ns.nspname::text                AS schema_name,
           c.relname::text                 AS relation_name,
           a.grantee                       AS grantee_oid,
           pg_catalog.pg_get_userbyid(a.grantee) AS role_name,
           a.privilege_type::text          AS privilege_type
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.relkind IN ('r','p')
      AND NOT c.relispartition
      AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations','governance')
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      AND a.grantee <> c.relowner
  )
  SELECT count(*),
         pg_catalog.string_agg(
           format('%s.%s: %s lacks a %s policy', g.schema_name, g.relation_name,
                  g.role_name, g.privilege_type), E'\n'
           ORDER BY g.schema_name, g.relation_name, g.role_name, g.privilege_type)
    INTO n, offenders
  FROM granted g
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = format('%I.%I', g.schema_name, g.relation_name)::regclass
      AND (p.polcmd = '*' OR p.polcmd = CASE g.privilege_type
                                          WHEN 'SELECT' THEN 'r'
                                          WHEN 'INSERT' THEN 'a'
                                          WHEN 'UPDATE' THEN 'w'
                                          WHEN 'DELETE' THEN 'd' END)
      AND (p.polroles = '{0}'::oid[] OR g.grantee_oid = ANY (p.polroles))
  );

  IF n > 0 THEN
    RAISE EXCEPTION E'row-level security posture is incomplete: % granted privileges have no covering policy and would fail silently\n%', n, offenders;
  END IF;
  RETURN 0;
END;
$fn$;
ALTER FUNCTION operations.fn_assert_access_correspondence() OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_assert_access_correspondence() IS
  'REVISION 3 (migration 025): schema list extended to include governance. Every DML privilege held by a non-owner on a relation in the eight design schemas must have a policy covering that role and that command, or the migration fails rather than the grant failing silently in production.';

-- Posture: RLS enabled+forced everywhere; sealed content immutable; no snapshot
-- default privileges; DELETE on thinnable content only by pt_retention. Verbatim
-- from migration 018 with 'governance' added to the RLS sweep and one added
-- governance-DELETE-absence assertion.
CREATE OR REPLACE FUNCTION operations.fn_assert_security_posture() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE offenders text;
BEGIN
  -- PD-18 / F-09. Enabled AND forced on every non-partition relation in the
  -- design schemas (now eight, including governance).
  SELECT pg_catalog.string_agg(format('%s.%s', ns.nspname, c.relname), ', ' ORDER BY ns.nspname, c.relname)
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND NOT c.relispartition
    AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations','governance')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'row-level security is not enabled and forced on: %', offenders;
  END IF;

  -- R-69 / R-23. Sealed content is never modified by anyone.
  SELECT pg_catalog.string_agg(
           format('%s on snapshot.%s to %s', a.privilege_type, c.relname,
                  pg_catalog.pg_get_userbyid(a.grantee)), ', ')
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  WHERE ns.nspname = 'snapshot' AND c.relkind IN ('r','p')
    AND a.privilege_type IN ('UPDATE','DELETE')
    AND a.grantee <> c.relowner;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'sealed content is modifiable: %', offenders;
  END IF;

  -- R-66. No default privileges configured on schema snapshot.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d
             JOIN pg_catalog.pg_namespace ns ON ns.oid = d.defaclnamespace
             WHERE ns.nspname = 'snapshot') THEN
    RAISE EXCEPTION 'default privileges are configured on schema snapshot, contrary to A.16 / R-66';
  END IF;

  -- R-22. DELETE on a thinnable relation is held by pt_retention and nobody else.
  SELECT pg_catalog.string_agg(
           format('%s.%s to %s', ns.nspname, c.relname, pg_catalog.pg_get_userbyid(a.grantee)), ', ')
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  WHERE ns.nspname IN ('feature','module') AND c.relkind IN ('r','p')
    AND a.privilege_type = 'DELETE'
    AND a.grantee <> c.relowner
    AND pg_catalog.pg_get_userbyid(a.grantee) <> 'pt_retention';
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE on thinnable content is held outside the retention role: %', offenders;
  END IF;

  -- MIGRATION 025. Governance change is a status transition, never destruction:
  -- no role other than the owner may hold DELETE on any governance relation.
  SELECT pg_catalog.string_agg(
           format('governance.%s to %s', c.relname, pg_catalog.pg_get_userbyid(a.grantee)), ', ')
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
  WHERE ns.nspname = 'governance' AND c.relkind IN ('r','p')
    AND a.privilege_type = 'DELETE'
    AND a.grantee <> c.relowner;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'DELETE is held on governance content, contrary to Doc 95: %', offenders;
  END IF;

  RETURN 0;
END;
$fn$;
ALTER FUNCTION operations.fn_assert_security_posture() OWNER TO pt_owner;
GRANT EXECUTE ON FUNCTION operations.fn_assert_security_posture() TO pt_platform_admin;
COMMENT ON FUNCTION operations.fn_assert_security_posture() IS
  'REVISION 3 (migration 025): governance added to the RLS sweep, and a governance-DELETE-absence assertion added. The executable form of the platform''s BLOCKING security checks, run at the end of migrations 016/018 and again here so drift introduced by this migration is detected rather than assumed absent.';

-- Run both assertions as part of this migration: a deployment that does not
-- satisfy them does not complete.
SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();

-- =============================================================================
-- ASSERTED POSTURE (re-verified above)
--   * governance.tracked_competition / tracked_edition + 4 vocabularies created
--   * RLS ENABLED and FORCED on all six governance relations
--   * pt_pipeline_ingestion: SELECT only on governance — can evaluate authorization,
--     can never self-authorize (no INSERT/UPDATE/DELETE)
--   * pt_platform_admin: SELECT/INSERT/UPDATE (no DELETE) — routine governance role
--   * NO role holds DELETE on governance; change is a status transition
--   * one ACTIVE tracked_edition per tracked_competition (partial unique index)
--   * authorized_for_ingestion defaults FALSE; no silent authorization
--   * grants and policies issued from one applicator; correspondence asserted
-- NOT IN THIS MIGRATION: broad ingestion, provider enumeration, discovery→TRACKED
--   promotion, and any change to ingestTeam / ingestEvents / resolveCompetition /
--   schedule ingestion / the season pager (I1 remains untouched and authorized).
-- =============================================================================
