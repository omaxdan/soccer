-- =============================================================================
-- 016_security.sql — Row-level security, then grants
-- Source: Doc 08 Rev 1 §B.8.5 stages 16-17, §B.7, A.16, F-05, F-09, F-21
-- Depends: 001-015  |  Transactional
--
-- ORDER IS DELIBERATE: RLS is enabled and FORCED and policies are created
-- BEFORE any privilege is granted (D-10, §B.8.5). No window exists in which an
-- object is reachable without its policies in force.
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

CREATE FUNCTION product.fn_resolve_entitlements(p_user_id uuid)
RETURNS TABLE (entitlement_feature_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
  'F-21. THE SOLE ENTITLEMENT RESOLUTION PATH, preserving the single-path requirement of the entitlement architecture. STABLE so it evaluates once per statement. The previous platform carried two paths — an environment-variable tier and a database-backed context — live simultaneously.';

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
-- Policies
-- -----------------------------------------------------------------------------

-- football: reality is not confidential. Permissive read for end-user roles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text = 'football'
             AND c.relkind IN ('r','p') AND c.relispartition = false
  LOOP
    EXECUTE format(
      'CREATE POLICY pl_%s__public__select ON football.%I FOR SELECT TO anon, authenticated USING (true)',
      r.t, r.t);
  END LOOP;
END
$$;

-- feature, module, snapshot, calibration, operations: NO policy granting any
-- end-user principal access. Enabled with no permitting policy denies by
-- default. Calculated content reaches end users EXCLUSIVELY through product
-- projections (§B.7.2).

-- product: user-owned relations restrict to the authenticated principal.
CREATE POLICY pl_watchlist__owner__all ON product.watchlist
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY pl_user_preference__owner__all ON product.user_preference
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY pl_subscription__owner__select ON product.subscription
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY pl_subscription_event__owner__select ON product.subscription_event
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM product.subscription s
                 WHERE s.id = subscription_id AND s.user_id = (SELECT auth.uid())));
CREATE POLICY pl_notification_intent__owner__select ON product.notification_intent
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- product: commercial configuration is readable by all, writable by none of the
-- end-user roles.
CREATE POLICY pl_plan__public__select ON product.plan
  FOR SELECT TO anon, authenticated USING (is_active);
CREATE POLICY pl_entitlement_feature__public__select ON product.entitlement_feature
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pl_plan_entitlement__public__select ON product.plan_entitlement
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY pl_platform_setting__public__select ON product.platform_setting
  FOR SELECT TO anon, authenticated USING (true);

-- -----------------------------------------------------------------------------
-- Grants — per relation, applied LAST
-- -----------------------------------------------------------------------------

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
                                    pt_pipeline_calibration, pt_pipeline_projection, pt_retention;

-- football
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='football' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON football.%I TO pt_pipeline_ingestion', r.t);
    EXECUTE format('GRANT SELECT ON football.%I TO pt_pipeline_feature, pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection, pt_platform_admin, anon, authenticated', r.t);
  END LOOP;
END
$$;

-- feature: insert only for the feature pipeline; DELETE only for retention.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='feature' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON feature.%I TO pt_pipeline_feature', r.t);
    EXECUTE format('GRANT SELECT ON feature.%I TO pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection, pt_platform_admin', r.t);
  END LOOP;
END
$$;
GRANT SELECT, DELETE ON feature.feature_value, feature.feature_lineage TO pt_retention;
GRANT SELECT, UPDATE ON feature.feature_definition, feature.feature_calculator,
                        feature.feature_definition_context_kind, feature.feature_source,
                        feature.feature_dependency TO pt_platform_admin;

-- module
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='module' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON module.%I TO pt_pipeline_module', r.t);
    EXECUTE format('GRANT SELECT ON module.%I TO pt_pipeline_calibration, pt_pipeline_projection, pt_platform_admin', r.t);
  END LOOP;
END
$$;
GRANT SELECT, DELETE ON module.module_reading, module.module_evidence, module.module_evidence_item TO pt_retention;

-- ─── snapshot: NO DEFAULT PRIVILEGES. PER-RELATION ONLY. (A.16, R-66 to R-70) ──
-- No role holds UPDATE or DELETE on any relation in this schema, including the
-- administrative role and the retention role.

GRANT SELECT, INSERT ON snapshot.match_snapshot,
                        snapshot.snapshot_version_component,
                        snapshot.snapshot_feature_state,
                        snapshot.snapshot_module_reading,
                        snapshot.snapshot_verdict,
                        snapshot.snapshot_model_output,
                        snapshot.snapshot_completeness,
                        snapshot.snapshot_completeness_item
  TO pt_pipeline_module;

GRANT SELECT ON snapshot.snapshot_outcome_link, snapshot.snapshot_outcome_link_currency
  TO pt_pipeline_module;

-- R-67: calibration holds INSERT on the outcome link relations AND ON NO OTHER
-- relation in this schema. A schema-level default grant would have given the
-- calibration role the ability to CREATE SNAPSHOTS.
GRANT SELECT, INSERT ON snapshot.snapshot_outcome_link,
                        snapshot.snapshot_outcome_link_currency
  TO pt_pipeline_calibration;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='snapshot' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT ON snapshot.%I TO pt_pipeline_calibration, pt_pipeline_projection, pt_platform_admin', r.t);
  END LOOP;
END
$$;

-- calibration
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='calibration' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON calibration.%I TO pt_pipeline_calibration', r.t);
    EXECUTE format('GRANT SELECT ON calibration.%I TO pt_pipeline_module, pt_pipeline_projection, pt_platform_admin', r.t);
  END LOOP;
END
$$;

-- product
GRANT SELECT ON product.plan, product.entitlement_feature, product.plan_entitlement,
                product.platform_setting TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product.watchlist, product.user_preference TO authenticated;
GRANT SELECT ON product.subscription, product.subscription_event, product.notification_intent TO authenticated;
GRANT SELECT, INSERT, UPDATE ON product.plan, product.entitlement_feature, product.plan_entitlement,
                                product.subscription, product.subscription_event,
                                product.platform_setting, product.read_model,
                                product.read_model_source TO pt_platform_admin;
GRANT SELECT, INSERT, UPDATE ON product.projection_refresh_state TO pt_pipeline_projection;
GRANT EXECUTE ON FUNCTION product.fn_resolve_entitlements(uuid) TO anon, authenticated, pt_pipeline_projection;

-- operations: every pipeline role inserts; only administration reads broadly.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname AS t FROM pg_class c
           WHERE c.relnamespace::regnamespace::text='operations' AND c.relkind IN ('r','p') AND NOT c.relispartition
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON operations.%I TO pt_pipeline_ingestion, pt_pipeline_feature, pt_pipeline_module, pt_pipeline_calibration, pt_pipeline_projection, pt_retention', r.t);
    EXECUTE format('GRANT SELECT ON operations.%I TO pt_platform_admin', r.t);
  END LOOP;
END
$$;
GRANT UPDATE ON operations.constraint_validation_progress TO pt_migration;

-- Sequences backing identity columns.
DO $$
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
$$;

-- =============================================================================
-- ASSERTED POSTURE (verified by the conformance assertions of migration 018)
--   * No role holds UPDATE or DELETE on any relation in schema snapshot (R-69)
--   * No DEFAULT PRIVILEGES are configured on schema snapshot (R-66)
--   * Only pt_retention holds DELETE on a thinnable relation (R-22)
--   * RLS is ENABLED and FORCED on every relation in every schema (PD-18, F-09)
--   * No end-user role holds any privilege on feature, module, snapshot,
--     calibration or operations
-- =============================================================================
