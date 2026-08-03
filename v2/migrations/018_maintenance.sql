-- =============================================================================
-- 018_maintenance.sql — Partition creation, retention, freeze, checksum, assertions
-- REVISION 2
-- Source: Doc 08 Rev 1 §B.8.5 stage 19, §B.9, A.5, A.6, A.17, F-15, F-19
-- Depends: 001-017  |  Transactional (scheduling entries are data)
--
-- Every maintenance operation executes under a pipeline job run, so maintenance
-- activity is attributable on the same terms as calculation activity (§B.9.6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Partition creation  (forward buffer of not fewer than three intervals)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION operations.fn_ensure_monthly_partitions(
  p_schema text, p_relation text, p_from date, p_to date
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date := date_trunc('month', p_from)::date; d_end date; n integer := 0; part text;
BEGIN
  WHILE d < p_to LOOP
    d_end := (d + interval '1 month')::date;
    part  := p_relation || '_p' || to_char(d, 'YYYYMM');
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                   WHERE ns.nspname = p_schema AND c.relname = part) THEN
      EXECUTE format('CREATE TABLE %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
                     p_schema, part, p_schema, p_relation, d, d_end);
      EXECUTE format('ALTER TABLE %I.%I OWNER TO pt_owner', p_schema, part);
      EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC', p_schema, part);
      n := n + 1;
    END IF;
    d := d_end;
  END LOOP;
  RETURN n;
END;
$$;
ALTER FUNCTION operations.fn_ensure_monthly_partitions(text,text,date,date) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_ensure_monthly_partitions(text,text,date,date) IS
  'Extends a monthly-partitioned relation FORWARD to maintain the buffer, and BACKWARD before historical reconstruction. Partitions inherit the no-direct-privilege posture of F-09 by the REVOKE above, so a partition created later is protected by construction.
   CO-PARTITIONED FAMILIES MUST BE EXTENDED AS ONE OPERATION with identical boundaries (§5.11.6), which is what permits partition-wise joins. The scheduled job below does so.';

CREATE OR REPLACE FUNCTION operations.fn_maintain_partitions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  horizon date := (date_trunc('month', now()) + interval '4 months')::date;
  total integer := 0;
  spec text[][] := ARRAY[
    ['feature','feature_value'],['feature','feature_lineage'],
    ['module','module_reading'],['module','module_evidence'],['module','module_evidence_item'],
    ['snapshot','match_snapshot'],['snapshot','snapshot_version_component'],
    ['snapshot','snapshot_feature_state'],['snapshot','snapshot_module_reading'],
    ['snapshot','snapshot_model_output'],['snapshot','snapshot_completeness'],
    ['snapshot','snapshot_completeness_item'],['snapshot','snapshot_outcome_link'],
    ['snapshot','snapshot_outcome_link_currency'],
    ['product','notification_intent'],
    ['operations','pipeline_run'],['operations','pipeline_job_run'],['operations','write_record'],
    ['operations','failure'],['operations','failure_resolution'],['operations','api_usage'],
    ['operations','quality_assertion_result']
  ];
BEGIN
  FOR i IN 1..array_length(spec,1) LOOP
    total := total + operations.fn_ensure_monthly_partitions(
      spec[i][1], spec[i][2], date_trunc('month', now())::date, horizon);
  END LOOP;
  RETURN total;
END;
$$;
ALTER FUNCTION operations.fn_maintain_partitions() OWNER TO pt_owner;

-- -----------------------------------------------------------------------------
-- Retention  (A.4, A.5 — thinning by DELETION within partitions)
-- -----------------------------------------------------------------------------
-- Detachment is reserved for BOUNDED OPERATIONAL content whose entire period is
-- removed after aggregation. Thinnable content is thinned by deleting eligible
-- rows; the partition remains attached and continues to serve reads (R-14, R-16).

CREATE TABLE operations.retention_policy (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  target_schema_name    text        NOT NULL,
  target_relation_name  text        NOT NULL,
  retention_class       text        NOT NULL,
  recent_window         interval,
  intermediate_window   interval,
  bounded_window        interval,
  family_key            text,
  is_active             boolean     NOT NULL DEFAULT true,
  CONSTRAINT pk_retention_policy PRIMARY KEY (id),
  CONSTRAINT uq_retention_policy__target UNIQUE (target_schema_name, target_relation_name),
  CONSTRAINT ck_retention_policy__class_known
    CHECK (retention_class IN ('THINNED','BOUNDED')),
  -- REVISION 2 (B-06). A THINNED policy names the DRIVING relation of a family
  -- and must name the family; a BOUNDED policy has no family.
  CONSTRAINT ck_retention_policy__family_known
    CHECK (family_key IS NULL OR family_key IN ('FEATURE','MODULE')),
  CONSTRAINT ck_retention_policy__family_matches_class
    CHECK ((retention_class = 'THINNED') = (family_key IS NOT NULL)),
  CONSTRAINT ck_retention_policy__windows_match_class CHECK (
    CASE retention_class
      WHEN 'THINNED' THEN recent_window IS NOT NULL AND intermediate_window IS NOT NULL
                          AND bounded_window IS NULL
                          AND intermediate_window > recent_window
      WHEN 'BOUNDED' THEN bounded_window IS NOT NULL
                          AND recent_window IS NULL AND intermediate_window IS NULL
    END
  )
);
ALTER TABLE operations.retention_policy OWNER TO pt_owner;
-- REVISION 2 (B-09). This relation is created AFTER migration 016 has enabled
-- and forced row-level security across the seven schemas, so it must do so for
-- itself. PD-18 and F-09 admit no exception, and a relation that escaped the
-- sweep because of its position in the ordering would be exactly the kind of
-- silent gap the sweep exists to close.
ALTER TABLE operations.retention_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.retention_policy FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE operations.retention_policy IS
  'PD-19 POSITIVE INCLUSION. Retention acts ONLY on relations named here. A relation not named is NEVER acted upon, so OMISSION FAILS SAFE — the correct default when the failure mode of the alternative is permanent loss of a claim.
   Note which relations are ABSENT: every snapshot relation, every calibration relation, quality_assertion_result and operational_aggregate. Their absence is their permanence.';

-- Policies and grants from the one applicator of migration 016. pt_migration
-- seeds the registry below; pt_platform_admin maintains it thereafter.
SELECT operations.fn_apply_access('operations','retention_policy','pt_migration','SIU');
SELECT operations.fn_apply_access('operations','retention_policy','pt_platform_admin','SIU');
SELECT operations.fn_apply_access('operations','retention_policy','pt_retention','S');

COMMENT ON COLUMN operations.retention_policy.family_key IS
  'REVISION 2 (B-06). A THINNED policy names the DRIVING relation of a dependent family only. Dependent relations — feature_lineage, module_evidence, module_evidence_item — are NOT independently thinnable: each is referenced by, or references, its driver with ON DELETE RESTRICT, so a delete issued against one in isolation either raises or is blocked. They are removed as part of their family, in the order the family function defines. See fn_thin_feature_family and fn_thin_module_family below.';

INSERT INTO operations.retention_policy
  (target_schema_name, target_relation_name, retention_class, recent_window, intermediate_window, bounded_window, family_key) VALUES
  ('feature','feature_value',   'THINNED', interval '90 days', interval '2 years', NULL, 'FEATURE'),
  ('module','module_reading',   'THINNED', interval '90 days', interval '2 years', NULL, 'MODULE'),
  ('operations','write_record', 'BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','pipeline_run', 'BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','pipeline_job_run','BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','failure',      'BOUNDED', NULL, NULL, interval '2 years', NULL),
  ('operations','failure_resolution','BOUNDED', NULL, NULL, interval '2 years', NULL),
  ('operations','api_usage',    'BOUNDED', NULL, NULL, interval '3 years', NULL)
ON CONFLICT (target_schema_name, target_relation_name) DO NOTHING;

-- TODO: requires confirmation from Phase 5 schema catalogue
--   Window durations depend on the TEMPORAL GRANULARITY decision recorded as
--   open in Phase 4, which doc 08 §5.24.1 identifies as determining total
--   storage between roughly 150 GB and 1 TB. The values above are placeholders
--   consistent with §B.9.3''s age bands. Settle the granularity decision before
--   production; the structure is correct at any setting.

-- REVISION 2 (B-04, B-06) — per-family thinning with a defined internal order.
--
-- TWO DEFECTS ARE CORRECTED HERE.
--
-- B-04: the previous implementation correlated rows on ctid. ctid is unique only
-- within a physical relation, NOT across a partitioned hierarchy, so the DELETE
-- could match rows it had not selected — including prevailing boundary values
-- that §B.9.2 requires be preserved. Correlation is now on the primary key
-- (id, as_of), which is unique across the hierarchy and already indexed.
--
-- B-06: one feature_value-shaped statement was applied to relations that do not
-- carry those columns. Worse, and undetected by the audit: NEITHER relation was
-- thinnable at all. feature_lineage references feature_value on both endpoints
-- with ON DELETE RESTRICT, and module_evidence/module_evidence_item chain the
-- same way from module_reading — so every delete would have raised.
--
-- That RESTRICT is CORRECT and is untouched: on the CONSUMED endpoint it is what
-- enforces LC-31, blocking removal of any value still cited by retained lineage
-- or by sealed content. The error was treating relations as independently
-- thinnable when they form dependent families with a required deletion order.
--
-- Eligibility conditions 1 and 2 of R-15 therefore remain enforced BY THE
-- DATABASE through ordinary referential checking (R-18), not by the correctness
-- of this function.
--
-- THREE AGE BANDS, not two. §B.9.3 states the retained resolution as full in the
-- recent window, DAILY in the intermediate window, and WEEKLY beyond it. Both
-- family functions implement all three. The band discriminator is carried in the
-- window partition alongside the bucket, because a daily bucket and a weekly
-- bucket can name the same instant — a Monday — and without the discriminator a
-- row in the daily band and a row in the weekly band would compete for one
-- survivor across the band boundary, deleting a value the daily band retains.
--
-- Bucket truncation is pinned to UTC. date_trunc/2 on timestamptz resolves day
-- and week boundaries in the session's TimeZone, which would make WHICH ROW
-- SURVIVES depend on the setting of whichever session the scheduler happened to
-- open. The retained boundary must be a property of the data, not of the caller.

CREATE OR REPLACE FUNCTION operations.fn_thin_feature_family(
  p_recent_window interval, p_intermediate_window interval
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  cutoff_recent       timestamptz := now() - p_recent_window;
  cutoff_intermediate timestamptz := now() - p_intermediate_window;
  n_values  integer := 0;
  n_lineage integer := 0;
BEGIN
  DROP TABLE IF EXISTS pg_temp._eligible_values;
  -- Eligible: past the recent window, and not the LAST value of its bucket for
  -- its (subject, context, definition) group — daily buckets in the intermediate
  -- band, weekly buckets beyond it. The prevailing value at every retained
  -- boundary survives, so historical answers are unchanged at the retained
  -- resolution (§B.9.2, §B.9.3).
  CREATE TEMP TABLE _eligible_values ON COMMIT DROP AS
    SELECT id, as_of FROM (
      SELECT banded.id, banded.as_of,
             row_number() OVER (
               PARTITION BY banded.subject_kind_code, banded.subject_team_id,
                            banded.subject_player_id, banded.subject_fixture_id,
                            banded.subject_competition_edition_id,
                            banded.context_kind_code, banded.context_competition_edition_id,
                            banded.feature_definition_id, banded.band, banded.bucket
               ORDER BY banded.as_of DESC) AS rn
      FROM (
        SELECT fv.id, fv.as_of, fv.subject_kind_code, fv.subject_team_id,
               fv.subject_player_id, fv.subject_fixture_id,
               fv.subject_competition_edition_id, fv.context_kind_code,
               fv.context_competition_edition_id, fv.feature_definition_id,
               CASE WHEN fv.as_of >= cutoff_intermediate THEN 'DAILY' ELSE 'WEEKLY' END AS band,
               CASE WHEN fv.as_of >= cutoff_intermediate
                    THEN date_trunc('day',  fv.as_of, 'UTC')
                    ELSE date_trunc('week', fv.as_of, 'UTC') END AS bucket
        FROM feature.feature_value fv
        WHERE fv.as_of < cutoff_recent
      ) banded
    ) ranked
    WHERE rn > 1;

  -- ORDER MATTERS. Lineage rows whose PRODUCED value is eligible are removed
  -- first; LC-47 permits this because lineage travels with the value it
  -- describes. Lineage citing an eligible value as CONSUMED is untouched, and
  -- the RESTRICT on that endpoint will block the value's deletion if any
  -- remains — which is the eligibility guarantee working as designed.
  DELETE FROM feature.feature_lineage l
   USING pg_temp._eligible_values e
   WHERE l.produced_value_id = e.id AND l.produced_value_as_of = e.as_of;
  GET DIAGNOSTICS n_lineage = ROW_COUNT;

  DELETE FROM feature.feature_value v
   USING pg_temp._eligible_values e
   WHERE v.id = e.id AND v.as_of = e.as_of;
  GET DIAGNOSTICS n_values = ROW_COUNT;

  DROP TABLE pg_temp._eligible_values;
  RETURN n_values + n_lineage;
END;
$$;
ALTER FUNCTION operations.fn_thin_feature_family(interval, interval) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_thin_feature_family(interval, interval) IS
  'A.4 / R-14 / R-15, feature family. Deletion order is lineage-then-value, which is the only order the ON DELETE RESTRICT on feature_lineage permits. The RESTRICT on the CONSUMED endpoint is deliberately left in force: it is what makes eligibility condition 2 of R-15 a database guarantee rather than a property of this function (R-18).
   The predicate on as_of is the partition key predicate, so the pass addresses aged partitions only and never touches the hot recent ones (§5.10.6, F-15).';

CREATE OR REPLACE FUNCTION operations.fn_thin_module_family(
  p_recent_window interval, p_intermediate_window interval
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  cutoff_recent       timestamptz := now() - p_recent_window;
  cutoff_intermediate timestamptz := now() - p_intermediate_window;
  n integer := 0;
  c integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp._eligible_readings;
  CREATE TEMP TABLE _eligible_readings ON COMMIT DROP AS
    SELECT id, as_of FROM (
      SELECT banded.id, banded.as_of,
             row_number() OVER (
               PARTITION BY banded.subject_kind_code, banded.subject_team_id,
                            banded.subject_player_id, banded.subject_fixture_id,
                            banded.subject_competition_edition_id,
                            banded.context_kind_code, banded.context_competition_edition_id,
                            banded.module_definition_id, banded.band, banded.bucket
               ORDER BY banded.as_of DESC) AS rn
      FROM (
        SELECT mr.id, mr.as_of, mr.subject_kind_code, mr.subject_team_id,
               mr.subject_player_id, mr.subject_fixture_id,
               mr.subject_competition_edition_id, mr.context_kind_code,
               mr.context_competition_edition_id, mr.module_definition_id,
               CASE WHEN mr.as_of >= cutoff_intermediate THEN 'DAILY' ELSE 'WEEKLY' END AS band,
               CASE WHEN mr.as_of >= cutoff_intermediate
                    THEN date_trunc('day',  mr.as_of, 'UTC')
                    ELSE date_trunc('week', mr.as_of, 'UTC') END AS bucket
        FROM module.module_reading mr
        WHERE mr.as_of < cutoff_recent
      ) banded
    ) ranked
    WHERE rn > 1;

  -- Children first, deepest first: items, then evidence, then readings. Any
  -- other order raises on the RESTRICT, which is the point — the chain is
  -- enforced, not assumed.
  DELETE FROM module.module_evidence_item i
   USING module.module_evidence ev, pg_temp._eligible_readings e
   WHERE i.module_evidence_id = ev.id AND i.reading_as_of = ev.reading_as_of
     AND ev.module_reading_id = e.id  AND ev.reading_as_of = e.as_of;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;

  DELETE FROM module.module_evidence ev
   USING pg_temp._eligible_readings e
   WHERE ev.module_reading_id = e.id AND ev.reading_as_of = e.as_of;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;

  DELETE FROM module.module_reading mr
   USING pg_temp._eligible_readings e
   WHERE mr.id = e.id AND mr.as_of = e.as_of;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;

  DROP TABLE pg_temp._eligible_readings;
  RETURN n;
END;
$$;
ALTER FUNCTION operations.fn_thin_module_family(interval, interval) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_thin_module_family(interval, interval) IS
  'A.4 / R-14 / R-15, module family. Deletion order is item, evidence, reading — the only order the ON DELETE RESTRICT chain permits. A reading cited by sealed snapshot content cannot be removed at all, which is eligibility condition 1 of R-15 enforced by the database rather than by this function (R-18).';

CREATE OR REPLACE FUNCTION operations.fn_run_retention() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p record; total integer := 0;
BEGIN
  IF current_user <> 'pt_retention' THEN
    RAISE EXCEPTION 'retention may be executed only by the retention role, not by %', current_user;
  END IF;

  -- R-21. The marker satisfies BOTH the append guard of migration 015 AND the
  -- delete policy added to migration 016 by Revision 2 (B-03). The rule is
  -- stated at two layers and a delete without the marker is blocked twice.
  --
  -- Session-scoped, per R-21 and R-58 — pipeline connections run in session mode
  -- precisely so this state survives statement boundaries. Session scope means it
  -- also survives a FAILED run, so the body below is wrapped and the marker is
  -- cleared on every exit path. A connection left holding the marker would leave
  -- the retention role able to delete outside a retention execution, which is
  -- exactly what R-20's second condition exists to prevent.
  PERFORM set_config('pitchterminal.retention_operation', 'true', false);

  BEGIN
  -- PD-19 POSITIVE INCLUSION. The registry is the sole driver: a family is
  -- thinned because a policy names its driving relation, never because a
  -- function was written for it. Deactivating the policy stops the pass.
  FOR p IN SELECT * FROM operations.retention_policy
            WHERE is_active AND retention_class = 'THINNED'
            ORDER BY family_key
  LOOP
    CASE p.family_key
      WHEN 'FEATURE' THEN
        total := total + operations.fn_thin_feature_family(p.recent_window, p.intermediate_window);
      WHEN 'MODULE' THEN
        total := total + operations.fn_thin_module_family(p.recent_window, p.intermediate_window);
      ELSE
        -- Fails loudly rather than skipping. A THINNED policy naming a family
        -- with no implementation would otherwise thin nothing and report
        -- success, which is the failure mode B-03 and B-06 both took.
        RAISE EXCEPTION 'retention policy % names family % for which no thinning implementation exists',
          p.id, p.family_key;
    END CASE;
  END LOOP;

  -- BOUNDED policies are registered above and are NOT acted upon here.
  -- §B.9.4 removes bounded operational content by PARTITION DETACHMENT, and A.17
  -- / R-71 requires the detachment behaviour of the target platform version to be
  -- verified empirically — specifically, whether a partition may be detached
  -- while an inbound foreign key references rows within it — before any code
  -- relies on it. That matters concretely here: snapshot.match_snapshot and
  -- calibration.calibration_run reference operations.pipeline_job_run with
  -- RESTRICT precisely so that a job run cited by a sealed artefact survives
  -- operational retention. Until R-71's verification is recorded against the
  -- quality check registered below, no bounded pass executes, and omission fails
  -- safe in the direction PD-19 requires. R-74 states what the implementation
  -- must then do: determine eligibility procedurally before detaching.
  IF EXISTS (SELECT 1 FROM operations.retention_policy
              WHERE is_active AND retention_class = 'BOUNDED') THEN
    RAISE NOTICE 'bounded retention is registered but gated on the A.17 / R-71 detachment verification; no partition was detached';
  END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('pitchterminal.retention_operation', 'false', false);
    RAISE;
  END;

  PERFORM set_config('pitchterminal.retention_operation', 'false', false);
  RETURN total;
END;
$$;
ALTER FUNCTION operations.fn_run_retention() OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_run_retention() IS
  'A.4 / R-14. THINNING BY DELETION WITHIN PARTITIONS, never by partition detachment — detachment would remove every row in a period including the boundary values §B.9.2 requires be preserved, and would therefore ALTER HISTORICAL ANSWERS.
   Revision 2 delegates to per-family functions with a defined internal deletion order (B-06) and correlates on the primary key rather than ctid (B-04). Aggregation precedes thinning within one execution (§B.9.6).';

-- -----------------------------------------------------------------------------
-- Explicit freeze  (F-19)
-- -----------------------------------------------------------------------------

-- REVISION 2 (B-05). VACUUM cannot be executed from a function — every
-- PL/pgSQL body runs inside a transaction block, and VACUUM is prohibited
-- there. The previous implementation executed VACUUM inside a function while
-- its own comment stated the prohibition.
--
-- The function now ENUMERATES the partitions requiring freeze. The scheduled
-- job iterates the result and issues VACUUM (FREEZE, ANALYZE) per partition
-- from outside any transaction, which is a NON-TRANSACTIONAL operation under
-- R-61/R-62. F-19's intent is preserved exactly: scheduled freezing rather than
-- unpredictable anti-wraparound.

CREATE OR REPLACE FUNCTION operations.fn_partitions_requiring_freeze(p_inactive_before date)
RETURNS TABLE (schema_name text, partition_name text, partition_month date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ns.nspname::text, c.relname::text, to_date(right(c.relname, 6), 'YYYYMM')
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relispartition
    AND ns.nspname IN ('feature','module','snapshot','football','operations','product')
    AND c.relname ~ '_p[0-9]{6}$'
    AND to_date(right(c.relname, 6), 'YYYYMM') < p_inactive_before
  ORDER BY 1, 2;
$$;
ALTER FUNCTION operations.fn_partitions_requiring_freeze(date) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_partitions_requiring_freeze(date) IS
  'F-19 / B-05. Returns the partitions a freeze pass should cover. A partition written once and never touched still requires freezing before wraparound: relaxing vacuum on append-only relations is correct for SPACE RECLAMATION and incorrect for FREEZING.
   THE CALLER ISSUES THE VACUUM, outside any transaction. This function performs none.';

-- -----------------------------------------------------------------------------
-- Checksum verification  (A.6 / R-27)
-- -----------------------------------------------------------------------------

-- REVISION 2 (B-02, third instance). SECURITY INVOKER, not DEFINER.
-- The function only READS snapshot.match_snapshot, and its sole grantee —
-- pt_platform_admin — already holds SELECT on that relation together with the
-- matching SELECT policy generated in migration 016. Ownership elevation is
-- therefore unnecessary, and as DEFINER it executed as pt_owner against a
-- FORCE ROW LEVEL SECURITY relation, which returned the empty set unless a
-- policy was written for the owner. INVOKER removes both the silent-empty-result
-- failure mode and a definer function from the security surface, and it makes
-- the verification answer for the principal that ran it rather than for the
-- owner — which is the correct semantics for an audit control.
CREATE OR REPLACE FUNCTION operations.fn_verify_snapshot_checksums(p_from date, p_to date)
RETURNS TABLE (match_snapshot_id bigint, fixture_partition_on date, verified boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
  SELECT ms.id, ms.fixture_partition_on,
         -- TODO: requires confirmation from Phase 5 schema catalogue
         --   The canonical serialisation is DEFINED BY the referenced checksum
         --   algorithm version (module.checksum_algorithm_version.canonical_form).
         --   Implementing the digest requires that serialisation to be specified
         --   procedurally. Recorded rather than invented: recomputation returns
         --   NULL until the canonical form is implemented, and the assertion
         --   below reports unverified rather than falsely passing.
         NULL::boolean
  FROM snapshot.match_snapshot ms
  WHERE ms.fixture_partition_on >= p_from AND ms.fixture_partition_on < p_to;
END;
$$;
ALTER FUNCTION operations.fn_verify_snapshot_checksums(date,date) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_verify_snapshot_checksums(date,date) IS
  'A.6 / R-27. The RETROSPECTIVE DETECTION control — the fourth of PR-04''s four. Its purpose is to detect modification that circumvented the other three, which the design does not expect but does not rely on being impossible. A mismatch raises a DATA_QUALITY failure and is recorded as a permanent quality assertion result.';

-- -----------------------------------------------------------------------------
-- Registered quality checks  (§B.9.6, F-15, A.17)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- REVISION 2 — the security posture is ASSERTED, not merely described
-- -----------------------------------------------------------------------------
-- Migration 016 closes with a statement of the posture it establishes. Until
-- Revision 2 that statement was a comment, and the registry entries below were
-- descriptions of checks with no executable form. Four of them are ordinary
-- catalogue queries, so they are implemented here and RUN AS PART OF THE
-- MIGRATION: a deployment that does not satisfy them does not complete.

CREATE OR REPLACE FUNCTION operations.fn_assert_security_posture() RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE offenders text;
BEGIN
  -- PD-18 / F-09. Enabled AND forced on every non-partition relation in the
  -- seven design schemas. A partition is governed by its parent's policies and
  -- holds no direct privilege, so it is out of scope by construction.
  SELECT pg_catalog.string_agg(format('%s.%s', ns.nspname, c.relname), ', ' ORDER BY ns.nspname, c.relname)
    INTO offenders
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.relkind IN ('r','p') AND NOT c.relispartition
    AND ns.nspname IN ('football','feature','module','snapshot','calibration','product','operations')
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'row-level security is not enabled and forced on: %', offenders;
  END IF;

  -- R-69 / R-23. Sealed content is never modified by anyone. No role holds
  -- UPDATE or DELETE on any relation in schema snapshot, the administrative and
  -- retention roles included.
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

  -- R-66. No default privileges configured on schema snapshot. A default grant
  -- would confer on relations created LATER a privilege nobody reviewed.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d
             JOIN pg_catalog.pg_namespace ns ON ns.oid = d.defaclnamespace
             WHERE ns.nspname = 'snapshot') THEN
    RAISE EXCEPTION 'default privileges are configured on schema snapshot, contrary to A.16 / R-66';
  END IF;

  -- R-22. DELETE on a thinnable relation is held by pt_retention and by nobody
  -- else. This is the PRIMARY control; the append guard's exception is secondary.
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

  RETURN 0;
END;
$fn$;
ALTER FUNCTION operations.fn_assert_security_posture() OWNER TO pt_owner;
GRANT EXECUTE ON FUNCTION operations.fn_assert_security_posture() TO pt_platform_admin;
COMMENT ON FUNCTION operations.fn_assert_security_posture() IS
  'REVISION 2. The executable form of four of the BLOCKING checks registered below, and of the posture migration 016 closes by asserting. Run at the end of that migration and available to the administrative role thereafter, so drift introduced by a later migration is detected rather than assumed absent.';

INSERT INTO operations.quality_check
  (quality_check_key, display_name, assertion_text, scope_text, severity, cadence) VALUES
  ('default_partition_empty', 'Default partition occupancy',
   'No range-partitioned relation has rows in its default partition.', 'All schemas', 'HIGH', interval '1 hour'),
  ('feature_scale_conformance', 'Feature value scale conformance',
   'Every feature value conforms to the scale declared in its registry entry.', 'feature.feature_value', 'HIGH', interval '1 day'),
  ('module_input_conformance', 'Module input conformance',
   'Every evidence citation falls within the consuming module''s declared inputs.', 'module.module_evidence_item', 'HIGH', interval '1 day'),
  ('feature_dependency_acyclic', 'Feature dependency acyclicity',
   'The declared feature dependency graph contains no cycle.', 'feature.feature_dependency', 'BLOCKING', interval '1 day'),
  ('provenance_propagation', 'Provenance propagation',
   'No derived value carries a provenance class stronger than the weakest in its lineage.', 'feature.feature_value', 'HIGH', interval '1 day'),
  ('manifest_completeness', 'Snapshot manifest completeness',
   'Every version referenced by snapshot content appears in that snapshot''s manifest.', 'snapshot', 'HIGH', interval '1 day'),
  ('snapshot_checksum', 'Snapshot content checksum',
   'Every sealed snapshot''s recomputed checksum matches the value recorded at sealing.', 'snapshot.match_snapshot', 'BLOCKING', interval '7 days'),
  ('coverage_completeness', 'Coverage completeness',
   'Every fixture in window has the snapshots its cadence requires.', 'snapshot', 'HIGH', interval '1 hour'),
  ('freshness_conformance', 'Freshness conformance',
   'Every registered feature is within its declared tolerance.', 'feature', 'MEDIUM', interval '1 hour'),
  ('orphan_absence', 'Orphan absence',
   'No calculated row references a retired definition or an unregistered version.', 'feature, module', 'HIGH', interval '1 day'),
  ('structured_payload_conformance', 'Structured payload conformance',
   'No structured payload column exists outside the two circumstances permitted by PD-16.', 'All schemas', 'MEDIUM', interval '7 days'),
  ('snapshot_no_modification_privilege', 'Snapshot privilege posture',
   'No role holds UPDATE or DELETE on any relation in schema snapshot, and no default privileges are configured there.', 'snapshot', 'BLOCKING', interval '1 day'),
  ('retention_delete_privilege', 'Retention delete privilege',
   'No role other than pt_retention holds DELETE on a thinnable relation.', 'feature, module', 'BLOCKING', interval '1 day'),
  ('rls_enabled_and_forced', 'Row-level security posture',
   'Row-level security is enabled AND forced on every relation in every design schema.', 'All schemas', 'BLOCKING', interval '1 day'),
  ('pruning_conformance', 'Partition pruning conformance',
   'No production read path addresses a partitioned relation without a partition predicate.', 'All schemas', 'MEDIUM', interval '1 day'),
  ('partition_detachment_behaviour', 'Partition detachment behaviour verification',
   'Records whether PostgreSQL 16 blocks detachment of a partition whose rows are referenced by an inbound foreign key.', 'Platform', 'BLOCKING', interval '365 days'),
  ('privilege_policy_correspondence', 'Privilege and policy correspondence',
   'Every DML privilege held by a non-owner on a design relation has a policy covering that role and that command.', 'All schemas', 'BLOCKING', interval '1 day')
ON CONFLICT (quality_check_key) DO NOTHING;

COMMENT ON TABLE operations.quality_check IS
  'E9.07. Results are PERMANENT, so degradation is visible as a TREND rather than an isolated event.
   Note the last entry: A.17 / R-71 requires the partition detachment behaviour to be VERIFIED EMPIRICALLY on the target platform version before production, and the result RECORDED (R-72). A structural guarantee resting on unverified platform behaviour is not a structural guarantee. Where detachment is NOT confirmed to be blocked, R-74 applies: retention determines eligibility procedurally and this assertion detects any citation whose target is absent.
   Note also F-15: the pruning conformance check is what turns the mandatory partition-predicate rule of §5.10.6 from a convention into a detectable rule.';

CREATE OR REPLACE VIEW operations.v_coverage
  WITH (security_invoker = true, security_barrier = true) AS
SELECT f.competition_edition_id,
       date_trunc('month', f.scheduled_kickoff_at)::date AS period_start,
       sp.code AS snapshot_point_code,
       count(*) FILTER (WHERE ms.id IS NOT NULL) AS snapshots_present,
       count(*)                                   AS fixtures_expected
FROM football.fixture f
CROSS JOIN football.snapshot_point sp
LEFT JOIN snapshot.match_snapshot ms
       ON ms.fixture_id = f.id AND ms.fixture_partition_on = f.fixture_partition_on
      AND ms.snapshot_point_code = sp.code
GROUP BY f.competition_edition_id, date_trunc('month', f.scheduled_kickoff_at), sp.code;
ALTER VIEW operations.v_coverage OWNER TO pt_owner;
COMMENT ON VIEW operations.v_coverage IS
  'E9.09. Because calculation is append-only and snapshots are sealed, A FAILED RUN LEAVES A PERMANENT ABSENCE, AND ABSENCES ARE SILENT. Coverage reporting is the only mechanism by which a missing snapshot becomes visible; nothing raises when an artefact that should exist does not. Recomputable for any past period, because its inputs are permanent.';

CREATE OR REPLACE VIEW operations.v_freshness
  WITH (security_invoker = true, security_barrier = true) AS
SELECT fd.id AS feature_definition_id, fd.feature_key,
       fv.context_kind_code,
       max(fv.calculated_at) AS last_calculated_at,
       now() - max(fv.calculated_at) AS staleness
FROM feature.feature_definition fd
LEFT JOIN feature.feature_value fv ON fv.feature_definition_id = fd.id
WHERE fd.is_active
GROUP BY fd.id, fd.feature_key, fv.context_kind_code;
ALTER VIEW operations.v_freshness OWNER TO pt_owner;
COMMENT ON VIEW operations.v_freshness IS
  'E9.06. DERIVABLE from declared sources rather than hand-maintained: a fatigue feature sourcing from appearances is stale whenever appearance ingestion has not run, and nobody maintains that relationship separately. Reported PER CONTEXT, since a value may be current at one context and stale at another.';

GRANT SELECT ON operations.v_coverage, operations.v_freshness TO pt_platform_admin;
GRANT EXECUTE ON FUNCTION operations.fn_maintain_partitions() TO pt_migration, pt_platform_admin;
GRANT EXECUTE ON FUNCTION operations.fn_run_retention() TO pt_retention;
GRANT EXECUTE ON FUNCTION operations.fn_partitions_requiring_freeze(date) TO pt_migration, pt_platform_admin;
GRANT EXECUTE ON FUNCTION operations.fn_thin_feature_family(interval, interval) TO pt_retention;
GRANT EXECUTE ON FUNCTION operations.fn_thin_module_family(interval, interval) TO pt_retention;
GRANT EXECUTE ON FUNCTION operations.fn_verify_snapshot_checksums(date,date) TO pt_platform_admin;
-- The retention_policy grants are issued by fn_apply_access above, with the
-- policies that govern them.

-- -----------------------------------------------------------------------------
-- Scheduling
-- -----------------------------------------------------------------------------
-- TODO: requires confirmation from Phase 5 schema catalogue
--   Schedules are registered with pg_cron below as an illustrative cadence
--   consistent with §B.9.6. Confirm the operational cadence and the maintenance
--   window before production. Note that VACUUM and CREATE INDEX CONCURRENTLY
--   cannot run inside a transaction block, so those invocations must be issued
--   as non-transactional operations (R-62).

-- SELECT cron.schedule('pt_maintain_partitions', '0 2 * * *',
--   $$SELECT operations.fn_maintain_partitions()$$);
-- SELECT cron.schedule('pt_run_retention',       '0 3 * * 0',
--   $$SELECT operations.fn_run_retention()$$);
-- Freeze is NOT scheduled through pg_cron as a single statement: VACUUM cannot
-- run inside the transaction pg_cron establishes. The freeze pass is an external
-- non-transactional job that calls
--   SELECT * FROM operations.fn_partitions_requiring_freeze(...)
-- and issues VACUUM (FREEZE, ANALYZE) per returned partition (B-05, R-62).

-- =============================================================================
-- CLOSING CONFORMANCE GATE  (REVISION 2)
-- =============================================================================
-- The last statements of the last migration. Both raise rather than report, so a
-- deployment that does not satisfy the posture does not complete and no partial
-- state is left behind — every migration in this set is transactional.

SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();
