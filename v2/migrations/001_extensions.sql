-- =============================================================================
-- 001_extensions.sql
-- PitchTerminal V2 — Extensions, schemas and roles
-- =============================================================================
-- Source of truth : Document 08 Revision 1 (Phase 5.6), §B.8.5 stage 1
-- Platform        : PostgreSQL 16 on Supabase
-- Transactional   : yes
--
-- Purpose
--   Establishes the physical foundation: required extensions, the seven schema
--   boundaries of §5.3.1, and every role named in §B.7.1. No privileges are
--   granted here; privilege configuration is migration 016 (§B.8.5 stage 17),
--   which is applied last so that no object is reachable before its policies
--   are in force.
--
-- Rules applied
--   R-54, R-55, R-56  btree_gist is required and installed before any relation
--                     carrying an exclusion constraint
--   R-57              Pipeline and administrative roles are direct-connection
--                     roles, not reachable through the platform auth path
--   D-15              Every object is owned by the schema owner role
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- Installed into the platform's designated extension schema (R-56), never into
-- a design schema.

CREATE SCHEMA IF NOT EXISTS extensions;

-- btree_gist (R-54): supplies scalar equality operator classes to GiST, without
-- which every exclusion constraint in the design is uncreatable. Required by:
-- player registration non-overlap, availability spell non-overlap, entitlement
-- grant non-overlap, version effective-period non-overlap, and the canonical
-- model designation of A.8.
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;

-- pgcrypto: digest computation for the snapshot content checksum (A.6, R-25).
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- pg_stat_statements: access-path monitoring (§5.11.8) and the pruning
-- conformance assertion (§B.9.6). Commonly pre-enabled on the platform.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;

-- pg_cron: scheduled maintenance — partition creation, retention, explicit
-- freeze, projection refresh, validation assertions (§B.9.6).
-- NOTE: pg_cron executes within the primary database only.
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA extensions;

-- TODO: requires confirmation from Phase 5 schema catalogue
--   PG-01 (geospatial representation) is a gated decision with a default of
--   "no geospatial column". PostGIS is therefore NOT installed here. Install
--   only if the gating measurement in §5.25.4 concludes otherwise.

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
-- Object ownership is held by a role no application process authenticates as
-- (§5.17.5). Ownership confers ALTER and DROP, which no application process
-- requires.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pt_owner') THEN
    CREATE ROLE pt_owner NOLOGIN NOINHERIT;
  END IF;
END
$$;

COMMENT ON ROLE pt_owner IS
  'Owns every object in the seven design schemas. No application process authenticates as this role. §5.17.5.';

-- Migration role: the sole holder of data definition privilege (§5.17.5).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pt_migration') THEN
    CREATE ROLE pt_migration NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT pt_owner TO pt_migration;

COMMENT ON ROLE pt_migration IS
  'Holds data definition privilege. Exercised only through the migration process of §B.8. Carries bulk-operation timeout settings per R-64.';

-- Pipeline roles (R-57, R-58): direct database connection, credentialed,
-- session mode. Not reachable through the platform's authenticated session
-- path; no claim is ever issued naming them.
--
-- Created NOLOGIN here deliberately. LOGIN and credentials are granted through
-- a secure channel outside version control — a migration file is not a place
-- for a credential.

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'pt_pipeline_ingestion',
    'pt_pipeline_feature',
    'pt_pipeline_module',
    'pt_pipeline_calibration',
    'pt_pipeline_projection',
    'pt_retention',
    'pt_platform_admin'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END
$$;

COMMENT ON ROLE pt_pipeline_ingestion   IS 'Writes schema football. Direct connection, session mode. R-57, R-58.';
COMMENT ON ROLE pt_pipeline_feature     IS 'Writes schema feature. Direct connection, session mode. R-57, R-58.';
COMMENT ON ROLE pt_pipeline_module      IS 'Writes schemas module and snapshot. Direct connection, session mode. R-57, R-58.';
COMMENT ON ROLE pt_pipeline_calibration IS 'Writes schema calibration and snapshot outcome links only. R-57, R-67.';
COMMENT ON ROLE pt_pipeline_projection  IS 'Refreshes projections and materialised views. R-57, R-58.';
COMMENT ON ROLE pt_retention            IS 'Sole holder of DELETE on thinnable relations, under the retention session marker. R-20, R-22.';
COMMENT ON ROLE pt_platform_admin       IS 'Reads all schemas; writes governed configuration and vocabulary. Direct connection.';

-- Bulk-operation timeout settings (R-64). Lock timeout remains short so that an
-- operation blocked behind a long transaction fails quickly rather than queueing.
ALTER ROLE pt_migration           SET statement_timeout = 0;
ALTER ROLE pt_migration           SET lock_timeout = '5s';
ALTER ROLE pt_retention           SET statement_timeout = '30min';
ALTER ROLE pt_retention           SET lock_timeout = '5s';
ALTER ROLE pt_pipeline_ingestion  SET statement_timeout = '30min';
ALTER ROLE pt_pipeline_feature    SET statement_timeout = '60min';
ALTER ROLE pt_pipeline_module     SET statement_timeout = '60min';
ALTER ROLE pt_pipeline_calibration SET statement_timeout = '120min';
ALTER ROLE pt_pipeline_projection SET statement_timeout = '60min';

-- All pipeline sessions operate in UTC (PD-08).
ALTER ROLE pt_migration            SET timezone = 'UTC';
ALTER ROLE pt_retention            SET timezone = 'UTC';
ALTER ROLE pt_pipeline_ingestion   SET timezone = 'UTC';
ALTER ROLE pt_pipeline_feature     SET timezone = 'UTC';
ALTER ROLE pt_pipeline_module      SET timezone = 'UTC';
ALTER ROLE pt_pipeline_calibration SET timezone = 'UTC';
ALTER ROLE pt_pipeline_projection  SET timezone = 'UTC';

-- No role is configured with a permissive search path (§5.3.4). Every object
-- reference in application code is schema-qualified.
ALTER ROLE pt_pipeline_ingestion   SET search_path = '';
ALTER ROLE pt_pipeline_feature     SET search_path = '';
ALTER ROLE pt_pipeline_module      SET search_path = '';
ALTER ROLE pt_pipeline_calibration SET search_path = '';
ALTER ROLE pt_pipeline_projection  SET search_path = '';
ALTER ROLE pt_retention            SET search_path = '';

-- -----------------------------------------------------------------------------
-- Schemas (§5.3.1)
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS football     AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS feature      AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS module       AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS snapshot     AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS calibration  AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS product      AUTHORIZATION pt_owner;
CREATE SCHEMA IF NOT EXISTS operations   AUTHORIZATION pt_owner;

COMMENT ON SCHEMA football    IS 'Layer 1 — Football Reality. Provider-reported facts. Written by ingestion only. References nothing outside itself.';
COMMENT ON SCHEMA feature     IS 'Layer 2 — Feature Engine. Every calculated quantity. Written by feature calculation only. Reads football.';
COMMENT ON SCHEMA module      IS 'Layer 3 — Module Engine. Judgement. Written by module calculation only. Reads feature, football, calibration.';
COMMENT ON SCHEMA snapshot    IS 'Match Intelligence. SEALED. Every relation insert-only. No role holds UPDATE or DELETE. PD-01, R-23.';
COMMENT ON SCHEMA calibration IS 'Calibration. Measurement of reliability. Written by calibration only. Reads snapshot, module, football.';
COMMENT ON SCHEMA product     IS 'Layer 4 — Product. Commercial and user data, read models. The only schema exposed to end-user roles.';
COMMENT ON SCHEMA operations  IS 'Operational telemetry. Holds no outbound foreign key to any authoritative relation.';

-- Explicitly revoke the public default so that no principal gains incidental
-- access before migration 016 configures privilege deliberately.
REVOKE ALL ON SCHEMA football, feature, module, snapshot, calibration, product, operations FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Retention session marker (R-21)
-- -----------------------------------------------------------------------------
-- The append-only guard of migration 015 permits DELETE only when the executing
-- role is pt_retention AND this marker is set. Declared here so the setting is
-- known to the cluster before the guard references it.
--
-- Custom GUCs require no registration in PostgreSQL; the namespace is reserved
-- by convention. The marker is session-scoped and does not persist.

COMMENT ON SCHEMA operations IS
  'Operational telemetry. Holds no outbound foreign key to any authoritative relation. Retention marker: pitchterminal.retention_operation (R-21).';
