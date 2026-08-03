-- =============================================================================
-- 016_security.sql — Row-level security, then grants
-- REVISION 2
-- Source: Doc 08 Rev 1 §B.8.5 stages 16-17, §B.7, A.16, F-05, F-09, F-21
-- Depends: 001-015  |  Transactional
--
-- ORDER IS DELIBERATE: RLS is enabled and FORCED and policies are created
-- BEFORE any privilege is granted (D-10, §B.8.5). No window exists in which an
-- object is reachable without its policies in force. Revision 2 makes that
-- ordering structural rather than editorial: the policy and the grant it governs
-- are issued by one function, in that order, from one specification.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Entitlement resolution function  (F-21)
-- -----------------------------------------------------------------------------
-- STABLE, so PostgreSQL evaluates it once per statement rather than once per
-- row. A policy expression joining across plan, matrix, subscription and the
-- configuration flag on every row evaluation would be prohibitively expensive.

CREATE TABLE product.platform_setting (
  setting_key   text        NOT NULL,
  setting_value text        NOT NULL,
  meaning       text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_platform_setting PRIMARY KEY (setting_key)
);
ALTER TABLE product.platform_setting OWNER TO pt_owner;
INSERT INTO product.platform_setting (setting_key, setting_value, meaning) VALUES
  ('subscriptions_enabled', 'false',
   'While false the platform is in open beta: every capability is available regardless of subscription. Evaluated WITHIN the policy expression, so beta posture governs AT THE DATABASE rather than only in a consuming application.');

-- REVISION 2 (B-02). SECURITY INVOKER, not DEFINER.
-- As DEFINER the function executed as pt_owner, which owns every relation it
-- reads. FORCE ROW LEVEL SECURITY subjects the owner to policy, and no policy
-- named pt_owner — so the function returned the EMPTY SET for every principal
-- and every entitlement-gated read was denied, silently.
-- INVOKER is both sufficient and stricter: the caller reads their own
-- subscription under pl_subscription__owner__select, and plan_entitlement,
-- entitlement_feature and platform_setting under their public read policies.
-- It also removes a definer function from the security surface.
CREATE OR REPLACE FUNCTION product.fn_resolve_entitlements(p_user_id uuid)
RETURNS TABLE (entitlement_feature_key text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ef.feature_key
  FROM product.entitlement_feature ef
  WHERE (SELECT setting_value FROM product.platform_setting WHERE setting_key = 'subscriptions_enabled') = 'false'
  UNION
  SELECT pe.entitlement_feature_key
  FROM product.subscription s
  JOIN product.plan_entitlement pe ON pe.plan_id = s.plan_id
  WHERE s.user_id = p_user_id
    AND s.status IN ('TRIALING','ACTIVE','PAST_DUE')
    AND now() <@ s.subscription_period
    AND now() <@ pe.granted_period;
$$;
ALTER FUNCTION product.fn_resolve_entitlements(uuid) OWNER TO pt_owner;
COMMENT ON FUNCTION product.fn_resolve_entitlements(uuid) IS
  'REVISION 2 (B-02): SECURITY INVOKER. F-21. THE SOLE ENTITLEMENT RESOLUTION PATH, preserving the single-path requirement of the entitlement architecture. STABLE so it evaluates once per statement. The previous platform carried two paths — an environment-variable tier and a database-backed context — live simultaneously.';

-- -----------------------------------------------------------------------------
-- Enable and FORCE row-level security on every relation  (PD-18, F-09)
-- -----------------------------------------------------------------------------
-- Enabled EVERYWHERE, including schemas no end-user role can reach: enabling
-- without a policy DENIES BY DEFAULT, so a future privilege grant made in error
-- does not silently expose content.
-- FORCED because a relation's owner otherwise bypasses its policies, and
-- maintenance conducted as the owner would then be unprotected.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relnamespace::regnamespace::text AS s, c.relname AS t
    FROM pg_class c
    WHERE c.relnamespace::regnamespace::text IN
          ('football','feature','module','snapshot','calibration','product','operations')
      AND c.relkind IN ('r','p')
      AND c.relispartition = false
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
  END LOOP;
END
$$;

-- F-09 second limb: direct privileges on PARTITIONS are withheld from every role
-- other than the owner, so all access is mediated through the partitioned parent
-- and parent policies govern. Policy replication to partitions is thereby
-- unnecessary, and a partition created later inherits the posture by default.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relnamespace::regnamespace::text AS s, c.relname AS t
    FROM pg_class c
    WHERE c.relnamespace::regnamespace::text IN
          ('football','feature','module','snapshot','calibration','product','operations')
      AND c.relkind IN ('r','p') AND c.relispartition = true
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC', r.s, r.t);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- REVISION 2 (B-03) — ONE ACCESS SPECIFICATION, TWO EFFECTS
-- -----------------------------------------------------------------------------
-- FORCE ROW LEVEL SECURITY applies to EVERY role that is neither a superuser nor
-- holds BYPASSRLS. With RLS enabled and no matching policy a role receives:
--     SELECT          -> zero rows
--     INSERT          -> HARD FAILURE, "new row violates row-level security policy"
--     UPDATE / DELETE -> zero rows affected, NO ERROR
--
-- The original implementation granted privileges to the pipeline roles and
-- created no policies for them. Every pipeline INSERT would have failed on first
-- attempt; retention would have deleted nothing and reported success, forever.
--
-- BYPASSRLS is rejected as the fix on two grounds: it requires superuser to set,
-- which the platform's administrative role is not; and it would discard the
-- posture F-09 exists to establish — every principal's access declared, none
-- implicit.
--
-- THE PRIVILEGE MATRIX AND THE POLICY MATRIX ARE THEREFORE ONE SPECIFICATION,
-- declared once below and expanded into both effects. They cannot drift, because
-- there is nothing to drift from. The correspondence is then ASSERTED against
-- the catalogue at the end of this file, of migration 017, and of migration 018,
-- so a privilege added later without its policy fails the migration rather than
-- failing silently in production.

-- -----------------------------------------------------------------------------
-- The applicator. Used by the expansion below, and by migrations 017 and 018 for
-- the relations they create after this file has run.
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER: it performs exactly the statements the migration principal
-- could issue directly, and confers nothing the caller does not already hold.

CREATE OR REPLACE FUNCTION operations.fn_apply_access(
  p_schema      text,
  p_relation    text,
  p_role        text,
  p_modes       text,                 -- any of S I U D
  p_using       text DEFAULT NULL,    -- NULL means "true"
  p_check       text DEFAULT NULL     -- NULL means p_using, else "true"
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  m           text;
  policy_name text;
  privileges  text[] := '{}';
  using_expr  text := coalesce(p_using, 'true');
  check_expr  text := coalesce(p_check, p_using, 'true');
BEGIN
  FOREACH m IN ARRAY string_to_array(p_modes, NULL) LOOP
    -- One policy per (relation, role, command). The relation is NOT part of the
    -- name: policy names are unique per relation in pg_policy, so including it
    -- only risks silent truncation at 63 bytes on the longer combinations.
    policy_name := 'pl_' || p_role || '__' ||
                   CASE m WHEN 'S' THEN 'select' WHEN 'I' THEN 'insert'
                          WHEN 'U' THEN 'update' WHEN 'D' THEN 'delete' END;
    IF length(policy_name) > 63 THEN
      RAISE EXCEPTION 'generated policy name % exceeds the identifier limit and would be truncated silently', policy_name;
    END IF;

    -- Idempotent: re-applying the specification restates the policy rather than
    -- failing on a duplicate name.
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, p_schema, p_relation);

    CASE m
      WHEN 'S' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO %I USING (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr);
        privileges := privileges || 'SELECT'::text;
      WHEN 'I' THEN
        -- INSERT admits WITH CHECK only; a USING clause is a syntax error.
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO %I WITH CHECK (%s)',
                       policy_name, p_schema, p_relation, p_role, check_expr);
        privileges := privileges || 'INSERT'::text;
      WHEN 'U' THEN
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR UPDATE TO %I USING (%s) WITH CHECK (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr, check_expr);
        privileges := privileges || 'UPDATE'::text;
      WHEN 'D' THEN
        -- DELETE admits USING only.
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR DELETE TO %I USING (%s)',
                       policy_name, p_schema, p_relation, p_role, using_expr);
        privileges := privileges || 'DELETE'::text;
      ELSE
        RAISE EXCEPTION 'unknown access mode % in specification for %.% / %', m, p_schema, p_relation, p_role;
    END CASE;
  END LOOP;

  -- The grant is issued from the SAME specification, immediately after the
  -- policies it corresponds to. PR-02's ordering is preserved: no privilege
  -- exists before the policy that governs it.
  EXECUTE format('GRANT %s ON %I.%I TO %I',
                 array_to_string(privileges, ', '), p_schema, p_relation, p_role);
END;
$fn$;
ALTER FUNCTION operations.fn_apply_access(text,text,text,text,text,text) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_apply_access(text,text,text,text,text,text) IS
  'REVISION 2 (B-03). Applies one line of the access specification: the policies AND the grant that correspond to it, in that order. Every privilege in the system is issued through this function so that no grant can exist without its policy. F-09, PR-02.';

-- -----------------------------------------------------------------------------
-- The correspondence assertion
-- -----------------------------------------------------------------------------

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
      AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations')
      AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
      -- The owner's privileges are conferred by ownership, not by the access
      -- specification. FORCE ROW LEVEL SECURITY still subjects the owner to
      -- policy; where an owner-executed path needs one it is declared explicitly.
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
  'REVISION 2 (B-03, B-09). Every DML privilege held by a non-owner on a relation in the seven design schemas must have a policy covering that role and that command. Asserted at the end of migrations 016, 017 and 018 rather than trusted, because the failure it detects is SILENT: a role with a privilege and no policy reads zero rows or writes nothing, and reports success.';

-- -----------------------------------------------------------------------------
-- THE ACCESS SPECIFICATION
-- -----------------------------------------------------------------------------
-- One row per (schema, role, mode set, relation scope, predicate). Rules are
-- deliberately NON-OVERLAPPING: the expansion carries a primary key on
-- (schema, relation, role, mode), so an accidental overlap raises during the
-- migration instead of producing two competing policies for one command.

-- Plain temp tables, dropped explicitly at the end of the section rather than
-- ON COMMIT. ON COMMIT DROP would destroy the specification the instant the
-- CREATE statement committed if this file were applied in autocommit, and the
-- expansion would then fail on a missing relation. Explicit lifecycle behaves
-- identically inside an explicit transaction and outside one.
DROP TABLE IF EXISTS _access_rule;
CREATE TEMP TABLE _access_rule (
  schema_name  text   NOT NULL,
  role_name    text   NOT NULL,
  modes        text   NOT NULL,
  include_only text[],            -- NULL: every relation in the schema
  exclude      text[],            -- NULL: exclude nothing
  using_expr   text,
  check_expr   text
);

INSERT INTO _access_rule (schema_name, role_name, modes, include_only, exclude, using_expr, check_expr) VALUES

  -- ─── football — Layer 1. Reality is not confidential; it is READ BY EVERYONE
  --     and written by ingestion alone.
  --     REVISION 2 (P-06): standing, player_valuation and fixture_lifecycle_transition
  --     are in the APPEND-ONLY lifecycle class and carry the append guard of
  --     migration 015. Granting UPDATE asserted a capability the lifecycle class
  --     forbids — exactly the drift PR-02 places privilege ahead of guards to
  --     prevent. They receive SELECT and INSERT only, in the grant AND the policy.
  ('football','pt_pipeline_ingestion','SIU', NULL,
     ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL),
  ('football','pt_pipeline_ingestion','SI',
     ARRAY['standing','player_valuation','fixture_lifecycle_transition'], NULL, NULL, NULL),
  ('football','pt_pipeline_feature',    'S', NULL, NULL, NULL, NULL),
  ('football','pt_pipeline_module',     'S', NULL, NULL, NULL, NULL),
  ('football','pt_pipeline_calibration','S', NULL, NULL, NULL, NULL),
  ('football','pt_pipeline_projection', 'S', NULL, NULL, NULL, NULL),
  ('football','pt_platform_admin',      'S', NULL, NULL, NULL, NULL),
  ('football','anon',                   'S', NULL, NULL, NULL, NULL),
  ('football','authenticated',          'S', NULL, NULL, NULL, NULL),

  -- ─── feature — Layer 2. Insert-only for the feature pipeline. No end-user
  --     principal appears here at all: calculated content reaches end users
  --     EXCLUSIVELY through product projections (§B.7.2).
  ('feature','pt_pipeline_feature',    'SI', NULL, NULL, NULL, NULL),
  ('feature','pt_pipeline_module',     'S',  NULL, NULL, NULL, NULL),
  ('feature','pt_pipeline_calibration','S',  NULL, NULL, NULL, NULL),
  ('feature','pt_pipeline_projection', 'S',  NULL, NULL, NULL, NULL),
  ('feature','pt_platform_admin',      'S',  NULL, NULL, NULL, NULL),
  -- Governed configuration only. The administrative role does NOT hold UPDATE on
  -- feature_value or feature_lineage, which are append-only.
  ('feature','pt_platform_admin',      'U',
     ARRAY['feature_definition','feature_calculator','feature_definition_context_kind',
           'feature_source','feature_dependency'], NULL, NULL, NULL),
  ('feature','pt_retention',           'S',  NULL, NULL, NULL, NULL),
  -- R-20/R-22. The DELETE policy carries the SAME session-marker condition the
  -- append guard of migration 015 enforces, so the rule is stated at two layers
  -- and a delete without the marker is blocked twice.
  ('feature','pt_retention',           'D',  ARRAY['feature_value','feature_lineage'], NULL,
     'current_setting(''pitchterminal.retention_operation'', true) = ''true''', NULL),

  -- ─── module — Layer 3.
  ('module','pt_pipeline_module',     'SI', NULL, NULL, NULL, NULL),
  ('module','pt_pipeline_calibration','S',  NULL, NULL, NULL, NULL),
  ('module','pt_pipeline_projection', 'S',  NULL, NULL, NULL, NULL),
  ('module','pt_platform_admin',      'S',  NULL, NULL, NULL, NULL),
  ('module','pt_retention',           'S',  NULL, NULL, NULL, NULL),
  ('module','pt_retention',           'D',
     ARRAY['module_reading','module_evidence','module_evidence_item'], NULL,
     'current_setting(''pitchterminal.retention_operation'', true) = ''true''', NULL),

  -- ─── snapshot — SEALED. NO DEFAULT PRIVILEGES, PER RELATION ONLY (A.16, R-66).
  --     No role holds UPDATE or DELETE on any relation in this schema, including
  --     the administrative role and the retention role (R-69, R-23). There is no
  --     'U' and no 'D' anywhere in this block, and the assertion of migration 018
  --     confirms it against the catalogue.
  ('snapshot','pt_pipeline_module','SI',
     ARRAY['match_snapshot','snapshot_version_component','snapshot_feature_state',
           'snapshot_module_reading','snapshot_verdict','snapshot_model_output',
           'snapshot_completeness','snapshot_completeness_item'], NULL, NULL, NULL),
  ('snapshot','pt_pipeline_module','S',
     ARRAY['snapshot_outcome_link','snapshot_outcome_link_currency'], NULL, NULL, NULL),
  -- R-67: calibration holds INSERT on the outcome link relations AND ON NO OTHER
  -- relation in this schema. A schema-level default grant would have given the
  -- calibration role the ability to CREATE SNAPSHOTS.
  ('snapshot','pt_pipeline_calibration','I',
     ARRAY['snapshot_outcome_link','snapshot_outcome_link_currency'], NULL, NULL, NULL),
  ('snapshot','pt_pipeline_calibration','S', NULL, NULL, NULL, NULL),
  ('snapshot','pt_pipeline_projection', 'S', NULL, NULL, NULL, NULL),
  ('snapshot','pt_platform_admin',      'S', NULL, NULL, NULL, NULL),

  -- ─── calibration.
  ('calibration','pt_pipeline_calibration','SI', NULL, NULL, NULL, NULL),
  ('calibration','pt_pipeline_module',     'S',  NULL, NULL, NULL, NULL),
  ('calibration','pt_pipeline_projection', 'S',  NULL, NULL, NULL, NULL),
  ('calibration','pt_platform_admin',      'S',  NULL, NULL, NULL, NULL),

  -- ─── product — the only schema exposed to end-user roles.
  --     Commercial configuration is readable by all, writable by none of them.
  ('product','anon',         'S', ARRAY['plan'], NULL, 'is_active', NULL),
  ('product','authenticated','S', ARRAY['plan'], NULL, 'is_active', NULL),
  ('product','anon',         'S',
     ARRAY['entitlement_feature','plan_entitlement','platform_setting'], NULL, NULL, NULL),
  ('product','authenticated','S',
     ARRAY['entitlement_feature','plan_entitlement','platform_setting'], NULL, NULL, NULL),
  -- User-owned relations restrict to the authenticated principal, on read AND on
  -- write: WITH CHECK prevents a principal inserting a row owned by another.
  ('product','authenticated','SIUD', ARRAY['watchlist','user_preference'], NULL,
     'user_id = (SELECT auth.uid())', 'user_id = (SELECT auth.uid())'),
  ('product','authenticated','S', ARRAY['subscription'], NULL,
     'user_id = (SELECT auth.uid())', NULL),
  ('product','authenticated','S', ARRAY['subscription_event'], NULL,
     'EXISTS (SELECT 1 FROM product.subscription s WHERE s.id = subscription_id AND s.user_id = (SELECT auth.uid()))', NULL),
  ('product','authenticated','S', ARRAY['notification_intent'], NULL,
     'user_id = (SELECT auth.uid())', NULL),
  ('product','pt_platform_admin','SIU',
     ARRAY['plan','entitlement_feature','plan_entitlement','subscription',
           'subscription_event','platform_setting','read_model','read_model_source'],
     NULL, NULL, NULL),
  ('product','pt_pipeline_projection','SIU', ARRAY['projection_refresh_state'], NULL, NULL, NULL),
  -- REVISION 2 (B-02, second instance). product.tf_watchlist__referential_defence
  -- of migration 015 is SECURITY DEFINER and executes as pt_owner, which FORCE
  -- ROW LEVEL SECURITY subjects to policy. Without these two the trigger would
  -- delete nothing and report success. Deliberately narrow — one relation, two
  -- commands — and declaring the owner's access explicitly is precisely the
  -- posture F-09 seeks rather than a weakening of it.
  ('product','pt_owner','SD', ARRAY['watchlist'], NULL, NULL, NULL),

  -- ─── operations — telemetry. Every pipeline role inserts; only administration
  --     reads broadly.
  ('operations','pt_pipeline_ingestion',  'SI', NULL, NULL, NULL, NULL),
  ('operations','pt_pipeline_feature',    'SI', NULL, NULL, NULL, NULL),
  ('operations','pt_pipeline_module',     'SI', NULL, NULL, NULL, NULL),
  ('operations','pt_pipeline_calibration','SI', NULL, NULL, NULL, NULL),
  ('operations','pt_pipeline_projection', 'SI', NULL, NULL, NULL, NULL),
  ('operations','pt_retention',           'SI', NULL, NULL, NULL, NULL),
  ('operations','pt_platform_admin',      'S',  NULL, NULL, NULL, NULL),
  -- REVISION 2 (B-11). The migration role seeds and maintains the operational
  -- CONFIGURATION relations — the quality check registry and the resumable
  -- validation ledger — from migrations that run AFTER row-level security is
  -- forced. Previously it held UPDATE on the ledger with no policy, so the
  -- resumable validation of F-25 would have recorded no progress and reported
  -- success, losing its resumability precisely when it was needed.
  ('operations','pt_migration','SIU',
     ARRAY['quality_check','constraint_validation_progress'], NULL, NULL, NULL);

-- -----------------------------------------------------------------------------
-- Expansion
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS _access_grant;
CREATE TEMP TABLE _access_grant (
  schema_name   text NOT NULL,
  relation_name text NOT NULL,
  role_name     text NOT NULL,
  mode          text NOT NULL,
  using_expr    text,
  check_expr    text,
  CONSTRAINT pk__access_grant PRIMARY KEY (schema_name, relation_name, role_name, mode)
);

INSERT INTO _access_grant (schema_name, relation_name, role_name, mode, using_expr, check_expr)
SELECT r.schema_name, c.relname::text, r.role_name, m.mode, r.using_expr, r.check_expr
FROM _access_rule r
JOIN pg_class c ON c.relnamespace = to_regnamespace(r.schema_name)::oid
CROSS JOIN LATERAL unnest(string_to_array(r.modes, NULL)) AS m(mode)
WHERE c.relkind IN ('r','p')
  AND NOT c.relispartition
  AND (r.include_only IS NULL OR c.relname = ANY (r.include_only))
  AND (r.exclude      IS NULL OR c.relname <> ALL (r.exclude));

-- Every relation named in an include_only list must exist. A typo would
-- otherwise silently produce no grant and no policy, which is the failure mode
-- this whole section exists to eliminate.
DO $chk$
DECLARE missing text;
BEGIN
  SELECT string_agg(format('%s.%s', r.schema_name, rel), ', ')
    INTO missing
  FROM _access_rule r
  CROSS JOIN LATERAL unnest(r.include_only) AS rel
  WHERE r.include_only IS NOT NULL
    AND to_regclass(format('%I.%I', r.schema_name, rel)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'access specification names relations that do not exist: %', missing;
  END IF;
END
$chk$;

-- -----------------------------------------------------------------------------
-- Schema usage
-- -----------------------------------------------------------------------------
-- USAGE on the schema is a precondition for every privilege below; it confers no
-- access by itself.

GRANT USAGE ON SCHEMA football, feature, module, snapshot, calibration, product, operations TO pt_platform_admin;
GRANT USAGE ON SCHEMA football   TO pt_pipeline_ingestion, pt_pipeline_feature, pt_pipeline_module,
                                    pt_pipeline_calibration, pt_pipeline_projection, anon, authenticated;
GRANT USAGE ON SCHEMA feature    TO pt_pipeline_feature, pt_pipeline_module, pt_pipeline_calibration,
                                    pt_pipeline_projection, pt_retention;
GRANT USAGE ON SCHEMA module     TO pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection, pt_retention;
GRANT USAGE ON SCHEMA snapshot   TO pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection;
GRANT USAGE ON SCHEMA calibration TO pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection;
GRANT USAGE ON SCHEMA product    TO pt_pipeline_projection, anon, authenticated;
GRANT USAGE ON SCHEMA operations TO pt_pipeline_ingestion, pt_pipeline_feature, pt_pipeline_module,
                                    pt_pipeline_calibration, pt_pipeline_projection, pt_retention, pt_migration;

-- -----------------------------------------------------------------------------
-- Application — policies and grants, from the one specification
-- -----------------------------------------------------------------------------
-- Grouped by PREDICATE as well as by principal. Two rules for one role on one
-- relation may carry different predicates — pt_retention reads every feature
-- relation unconditionally but deletes only under the retention marker — and
-- collapsing them would apply one rule's predicate to the other's command.

DO $apply$
DECLARE g record;
BEGIN
  FOR g IN SELECT schema_name, relation_name, role_name, using_expr, check_expr,
                  string_agg(mode, '' ORDER BY mode) AS modes
             FROM _access_grant
            GROUP BY schema_name, relation_name, role_name, using_expr, check_expr
  LOOP
    PERFORM operations.fn_apply_access(
      g.schema_name, g.relation_name, g.role_name, g.modes, g.using_expr, g.check_expr);
  END LOOP;
END
$apply$;

-- -----------------------------------------------------------------------------
-- Function execution
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION product.fn_resolve_entitlements(uuid) TO anon, authenticated, pt_pipeline_projection;
GRANT EXECUTE ON FUNCTION operations.fn_assert_access_correspondence() TO pt_platform_admin;

-- Sequences backing identity columns.
DO $seq$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname AS s, c.relname AS t FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('football','feature','module','snapshot','calibration','product','operations')
             AND c.relkind = 'S'
  LOOP
    EXECUTE format('GRANT USAGE ON SEQUENCE %I.%I TO pt_pipeline_ingestion, pt_pipeline_feature, pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection, pt_platform_admin, authenticated', r.s, r.t);
  END LOOP;
END
$seq$;

-- The specification has been applied; the working tables are no longer needed.
DROP TABLE _access_grant;
DROP TABLE _access_rule;

-- -----------------------------------------------------------------------------
-- Assertion
-- -----------------------------------------------------------------------------

SELECT operations.fn_assert_access_correspondence();

-- =============================================================================
-- ASSERTED POSTURE (re-verified by the conformance assertions of migration 018)
--   * No role holds UPDATE or DELETE on any relation in schema snapshot (R-69)
--   * No DEFAULT PRIVILEGES are configured on schema snapshot (R-66)
--   * Only pt_retention holds DELETE on a thinnable relation, and only under the
--     retention session marker (R-22)
--   * RLS is ENABLED and FORCED on every relation in every schema (PD-18, F-09)
--   * No end-user role holds any privilege on feature, module, snapshot,
--     calibration or operations
--   * REVISION 2: grants and policies come from ONE specification and are applied
--     by one function, so they cannot drift — and the correspondence is asserted
--     against the catalogue rather than assumed
-- =============================================================================
