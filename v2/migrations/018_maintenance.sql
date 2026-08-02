-- =============================================================================
-- 018_maintenance.sql — Partition creation, retention, freeze, checksum, assertions
-- Source: Doc 08 Rev 1 §B.8.5 stage 19, §B.9, A.5, A.6, A.17, F-15, F-19
-- Depends: 001-017  |  Transactional (scheduling entries are data)
--
-- Every maintenance operation executes under a pipeline job run, so maintenance
-- activity is attributable on the same terms as calculation activity (§B.9.6).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Partition creation  (forward buffer of not fewer than three intervals)
-- -----------------------------------------------------------------------------

CREATE FUNCTION operations.fn_ensure_monthly_partitions(
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

CREATE FUNCTION operations.fn_maintain_partitions() RETURNS integer
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
  is_active             boolean     NOT NULL DEFAULT true,
  CONSTRAINT pk_retention_policy PRIMARY KEY (id),
  CONSTRAINT uq_retention_policy__target UNIQUE (target_schema_name, target_relation_name),
  CONSTRAINT ck_retention_policy__class_known
    CHECK (retention_class IN ('THINNED','BOUNDED'))
);
ALTER TABLE operations.retention_policy OWNER TO pt_owner;
COMMENT ON TABLE operations.retention_policy IS
  'PD-19 POSITIVE INCLUSION. Retention acts ONLY on relations named here. A relation not named is NEVER acted upon, so OMISSION FAILS SAFE — the correct default when the failure mode of the alternative is permanent loss of a claim.
   Note which relations are ABSENT: every snapshot relation, every calibration relation, quality_assertion_result and operational_aggregate. Their absence is their permanence.';

INSERT INTO operations.retention_policy
  (target_schema_name, target_relation_name, retention_class, recent_window, intermediate_window, bounded_window) VALUES
  ('feature','feature_value',   'THINNED', interval '90 days', interval '2 years', NULL),
  ('feature','feature_lineage', 'THINNED', interval '90 days', interval '2 years', NULL),
  ('module','module_reading',   'THINNED', interval '90 days', interval '2 years', NULL),
  ('module','module_evidence',  'THINNED', interval '90 days', interval '2 years', NULL),
  ('module','module_evidence_item','THINNED', interval '90 days', interval '2 years', NULL),
  ('operations','write_record', 'BOUNDED', NULL, NULL, interval '180 days'),
  ('operations','pipeline_run', 'BOUNDED', NULL, NULL, interval '180 days'),
  ('operations','pipeline_job_run','BOUNDED', NULL, NULL, interval '180 days'),
  ('operations','failure',      'BOUNDED', NULL, NULL, interval '2 years'),
  ('operations','failure_resolution','BOUNDED', NULL, NULL, interval '2 years'),
  ('operations','api_usage',    'BOUNDED', NULL, NULL, interval '3 years');

-- TODO: requires confirmation from Phase 5 schema catalogue
--   Window durations depend on the TEMPORAL GRANULARITY decision recorded as
--   open in Phase 4, which doc 08 §5.24.1 identifies as determining total
--   storage between roughly 150 GB and 1 TB. The values above are placeholders
--   consistent with §B.9.3''s age bands. Settle the granularity decision before
--   production; the structure is correct at any setting.

CREATE FUNCTION operations.fn_run_retention() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE p record; deleted integer := 0; n integer;
BEGIN
  IF current_user <> 'pt_retention' THEN
    RAISE EXCEPTION 'retention may be executed only by the retention role, not by %', current_user;
  END IF;

  -- R-21: set the session marker for the duration of the execution.
  PERFORM set_config('pitchterminal.retention_operation', 'true', false);

  FOR p IN SELECT * FROM operations.retention_policy WHERE is_active AND retention_class = 'THINNED'
  LOOP
    -- Thin the intermediate band to one value per subject, context and
    -- definition PER DAY, PRESERVING THE PREVAILING VALUE AT EVERY RETAINED
    -- BOUNDARY so that historical answers are unchanged at the retained
    -- resolution (§B.9.2, §B.9.3).
    --
    -- Eligibility conditions 1 and 2 of R-15 are enforced by ORDINARY
    -- REFERENTIAL CHECKING on delete, which is CERTAIN — a row cited by sealed
    -- content or by retained lineage cannot be deleted, and the delete raises.
    -- This is why A.4's correction from detachment to deletion also STRENGTHENS
    -- the enforcement basis (R-18).
    EXECUTE format($f$
      WITH ranked AS (
        SELECT ctid,
               row_number() OVER (
                 PARTITION BY subject_kind_code, subject_team_id, subject_player_id,
                              subject_fixture_id, subject_competition_edition_id,
                              context_kind_code, context_competition_edition_id,
                              feature_definition_id, date_trunc('day', as_of)
                 ORDER BY as_of DESC) AS rn
        FROM %I.%I
        WHERE as_of < now() - %L::interval
          AND as_of >= now() - %L::interval
      )
      DELETE FROM %I.%I t USING ranked r WHERE t.ctid = r.ctid AND r.rn > 1
    $f$, p.target_schema_name, p.target_relation_name,
         p.recent_window, p.intermediate_window,
         p.target_schema_name, p.target_relation_name);
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted := deleted + n;
  END LOOP;

  PERFORM set_config('pitchterminal.retention_operation', 'false', false);
  RETURN deleted;
END;
$$;
ALTER FUNCTION operations.fn_run_retention() OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_run_retention() IS
  'A.4 / R-14. THINNING BY DELETION WITHIN PARTITIONS, not by partition detachment. Detachment would remove every row in a period, including the boundary values §B.9.2 requires be preserved, and would therefore ALTER HISTORICAL ANSWERS — which no retention process may do.
   The statement above is illustrative of the thinning rule; the feature_value column list is specific to that relation and the executable form is generated per relation. Aggregation precedes thinning within one execution (§B.9.6).';

-- -----------------------------------------------------------------------------
-- Explicit freeze  (F-19)
-- -----------------------------------------------------------------------------

CREATE FUNCTION operations.fn_freeze_inactive_partitions(p_inactive_before date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT ns.nspname AS s, c.relname AS t
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE c.relispartition
      AND ns.nspname IN ('feature','module','snapshot','football','operations','product')
      AND c.relname ~ '_p[0-9]{6}$'
      AND to_date(right(c.relname, 6), 'YYYYMM') < p_inactive_before
  LOOP
    EXECUTE format('VACUUM (FREEZE, ANALYZE) %I.%I', r.s, r.t);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
ALTER FUNCTION operations.fn_freeze_inactive_partitions(date) OWNER TO pt_owner;
COMMENT ON FUNCTION operations.fn_freeze_inactive_partitions(date) IS
  'F-19. A partition written once and never touched still requires freezing before wraparound. Relaxing vacuum on append-only relations is correct for SPACE RECLAMATION and incorrect for FREEZING. Explicit scheduled freezing converts an unpredictable, large, uninterruptible anti-wraparound scan into a scheduled one.
   NOTE: VACUUM cannot run inside a transaction block, so the scheduled invocation is a non-transactional operation (R-62).';

-- -----------------------------------------------------------------------------
-- Checksum verification  (A.6 / R-27)
-- -----------------------------------------------------------------------------

CREATE FUNCTION operations.fn_verify_snapshot_checksums(p_from date, p_to date)
RETURNS TABLE (match_snapshot_id bigint, fixture_partition_on date, verified boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
   'Records whether PostgreSQL 16 blocks detachment of a partition whose rows are referenced by an inbound foreign key.', 'Platform', 'BLOCKING', interval '365 days');

COMMENT ON TABLE operations.quality_check IS
  'E9.07. Results are PERMANENT, so degradation is visible as a TREND rather than an isolated event.
   Note the last entry: A.17 / R-71 requires the partition detachment behaviour to be VERIFIED EMPIRICALLY on the target platform version before production, and the result RECORDED (R-72). A structural guarantee resting on unverified platform behaviour is not a structural guarantee. Where detachment is NOT confirmed to be blocked, R-74 applies: retention determines eligibility procedurally and this assertion detects any citation whose target is absent.
   Note also F-15: the pruning conformance check is what turns the mandatory partition-predicate rule of §5.10.6 from a convention into a detectable rule.';

CREATE VIEW operations.v_coverage
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

CREATE VIEW operations.v_freshness
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
GRANT EXECUTE ON FUNCTION operations.fn_freeze_inactive_partitions(date) TO pt_migration, pt_platform_admin;
GRANT EXECUTE ON FUNCTION operations.fn_verify_snapshot_checksums(date,date) TO pt_platform_admin;
GRANT SELECT, INSERT, UPDATE ON operations.retention_policy TO pt_platform_admin;

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
-- SELECT cron.schedule('pt_freeze_partitions',   '0 4 * * 0',
--   $$SELECT operations.fn_freeze_inactive_partitions((now() - interval '3 months')::date)$$);
