-- =============================================================================
-- 017_views.sql — Read models, projections, materialised views
-- Source: Doc 08 Rev 1 §B.8.5 stage 18, §B.13, F-04, F-05  |  Depends: 001-016
--
-- RULES
--   PR-07  Every projection is reconstructible and holds no attribute not
--          derivable from its sources. Verified by the reconstruction assertion
--          of migration 018, which is what makes their exclusion from backup safe.
--   F-05   A materialised view granted to an end-user role contains ONLY content
--          that role may see IN FULL. Row-level security does not apply to
--          materialised views. Entitlement-scoped content is held in PROJECTION
--          RELATIONS, which do support policies.
--   F-04   A view crossing a privilege boundary declares INVOKER semantics in
--          addition to security barrier. The two properties are independent.
--   §B.13.2 An unregistered read path is outside this design.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Read model registrations
-- -----------------------------------------------------------------------------
INSERT INTO product.read_model
  (read_model_key, display_name, strategy, freshness_tolerance, holds_scoped_content, rebuild_definition) VALUES
  ('landing',            'Landing',             'PROJECTION_RELATION', interval '15 minutes', true,
   'Rebuilt from snapshot.match_snapshot and snapshot.snapshot_verdict for fixtures in the forward window.'),
  ('competition',        'Competition',         'MATERIALISED_VIEW',   interval '6 hours',    false,
   'Rebuilt from football.standing, football.competition_edition and football.fixture.'),
  ('team',               'Team',                'PROJECTION_RELATION', interval '1 hour',     true,
   'Rebuilt from feature.feature_value prevailing values per context, plus football fixtures and availability.'),
  ('player',             'Player',              'VIEW',                interval '0',          false,
   'Direct view over football player relations; no materialisation required.'),
  ('fixture',            'Fixture',             'VIEW',                interval '0',          false,
   'Direct view over football.fixture and its participants.'),
  ('match_intelligence', 'Match intelligence',  'DIRECT',              interval '0',          true,
   'Served directly from the sealed snapshot aggregate; partition-pruned partition-wise gather. No projection.'),
  ('module_directory',   'Module directory',    'MATERIALISED_VIEW',   interval '24 hours',   false,
   'Rebuilt from module.module_definition and calibration.published_baseline.'),
  ('calibration_ledger', 'Calibration ledger',  'MATERIALISED_VIEW',   interval '24 hours',   false,
   'Rebuilt from calibration series, results and baselines. Administrative.');

COMMENT ON TABLE product.read_model IS
  'Registered read paths. Note that landing, team and match_intelligence hold entitlement-scoped content and are therefore NOT materialised views — the check constraint ck_read_model__scoped_content_not_materialised enforces F-05 declaratively.';

-- -----------------------------------------------------------------------------
-- Direct views  (F-04: invoker semantics AND security barrier)
-- -----------------------------------------------------------------------------

CREATE VIEW football.v_fixture
  WITH (security_invoker = true, security_barrier = true) AS
SELECT f.id                    AS fixture_id,
       f.fixture_partition_on,
       f.scheduled_kickoff_at,
       f.lifecycle_state_code,
       f.is_neutral_venue,
       ce.id                   AS competition_edition_id,
       c.id                    AS competition_id,
       c.name                  AS competition_name,
       ht.id                   AS home_team_id,
       ht.name                 AS home_team_name,
       at.id                   AS away_team_id,
       at.name                 AS away_team_name,
       v.id                    AS venue_id,
       v.name                  AS venue_name
FROM football.fixture f
JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
JOIN football.competition c          ON c.id  = ce.competition_id
JOIN football.team ht                ON ht.id = f.home_team_id
JOIN football.team at                ON at.id = f.away_team_id
LEFT JOIN football.venue v           ON v.id  = f.venue_id;
ALTER VIEW football.v_fixture OWNER TO pt_owner;
COMMENT ON VIEW football.v_fixture IS
  'F-04. security_invoker makes the querying principal''s policies apply; security_barrier prevents predicate leakage. The two are INDEPENDENT and both are required — barrier alone does not determine whose privileges apply, and a view owned by a policy-bypassing role would return rows the principal is not entitled to.';

CREATE VIEW football.v_player_current
  WITH (security_invoker = true, security_barrier = true) AS
SELECT p.id AS player_id, p.full_name, p.date_of_birth, p.nationality_code,
       pr.team_id AS current_team_id, pr.registration_kind_code,
       (pa.id IS NOT NULL) AS is_currently_unavailable,
       pa.unavailability_kind_code, pa.expected_return_on
FROM football.player p
LEFT JOIN football.player_registration pr
       ON pr.player_id = p.id AND upper_inf(pr.registration_period)
      AND pr.registration_kind_code IN ('PERMANENT','LOAN_IN')
LEFT JOIN football.player_availability pa
       ON pa.player_id = p.id AND upper_inf(pa.spell_period);
ALTER VIEW football.v_player_current OWNER TO pt_owner;
COMMENT ON VIEW football.v_player_current IS
  'Current club and current availability are QUERIES OVER OPEN PERIODS, never stored flags (LC-11). This view is the canonical expression of that rule.';

-- -----------------------------------------------------------------------------
-- Derived views over the feature store  (E5.01–E5.04, no stored entities)
-- -----------------------------------------------------------------------------
-- Team intelligence is NOT a relation. It is a view over the feature store,
-- parameterised by subject, context and instant. The previous platform needed a
-- separate history structure because its primary store could not hold history;
-- V2 does not relocate that structure — IT STOPS NEEDING ONE.

CREATE FUNCTION feature.fn_team_state(
  p_team_id bigint,
  p_context_kind_code text,
  p_competition_edition_id bigint,
  p_as_of timestamptz
) RETURNS TABLE (
  feature_key text, value numeric, feature_version_id bigint,
  provenance_class_code text, sample_observation_count integer,
  sample_meets_threshold boolean, as_of timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT ON (fd.feature_key)
         fd.feature_key, fv.value, fv.feature_version_id,
         fv.provenance_class_code, fv.sample_observation_count,
         fv.sample_meets_threshold, fv.as_of
  FROM feature.feature_value fv
  JOIN feature.feature_definition fd ON fd.id = fv.feature_definition_id
  WHERE fv.subject_kind_code = 'TEAM'
    AND fv.subject_team_id = p_team_id
    AND fv.context_kind_code = p_context_kind_code
    AND fv.context_competition_edition_id IS NOT DISTINCT FROM p_competition_edition_id
    AND fv.as_of <= p_as_of
  ORDER BY fd.feature_key, fv.as_of DESC;
$$;
ALTER FUNCTION feature.fn_team_state(bigint, text, bigint, timestamptz) OWNER TO pt_owner;
COMMENT ON FUNCTION feature.fn_team_state(bigint, text, bigint, timestamptz) IS
  'E5.01–E5.04. CURRENT state and HISTORICAL state are the SAME QUERY with a different instant — which is what makes point-in-time reconstruction cheap rather than a reconstruction project. E5.03 competition state is this function at a competition-scoped context; E5.04 cross-competition state at that context kind.
   Returns values under the versions IN FORCE AT THAT MOMENT, not under current versions (LC-107) — the distinction between reconstructing history and rewriting it.';

-- -----------------------------------------------------------------------------
-- Materialised views  (F-05: NO entitlement-scoped content)
-- -----------------------------------------------------------------------------

CREATE MATERIALIZED VIEW product.mv_module_directory AS
SELECT md.id                AS module_definition_id,
       md.module_key, md.display_number, md.display_name, md.question,
       md.subject_kind_code, md.entitlement_feature_key,
       md.calibration_mode_code, md.is_active,
       pb.id                AS published_baseline_id,
       pb.band_code, pb.is_verified, pb.is_pooled, pb.measurement_provenance,
       cr.observation_count, cr.hit_rate, cr.baseline_rate, cr.lift,
       cr.interval_low, cr.interval_high, cr.interval_suppressed, cr.meets_sample_gate
FROM module.module_definition md
LEFT JOIN module.module_version mv
       ON mv.module_definition_id = md.id AND upper_inf(mv.effective_period)
LEFT JOIN calibration.published_baseline pb
       ON pb.module_version_id = mv.id AND upper_inf(pb.effective_period)
LEFT JOIN calibration.calibration_result cr ON cr.id = pb.calibration_result_id;
ALTER MATERIALIZED VIEW product.mv_module_directory OWNER TO pt_owner;
-- REVISION 2 (P-03). published_baseline_id is nullable because the view is
-- built on LEFT JOINs, and standard uniqueness treats nulls as distinct — so
-- the index did NOT guarantee row uniqueness and REFRESH ... CONCURRENTLY would
-- fail for any module with no published baseline and more than one version row.
-- NULLS NOT DISTINCT (PostgreSQL 15+) makes the index genuinely unique.
CREATE UNIQUE INDEX ux_mv_module_directory__module_baseline
  ON product.mv_module_directory (module_definition_id, published_baseline_id)
  NULLS NOT DISTINCT;
COMMENT ON MATERIALIZED VIEW product.mv_module_directory IS
  'F-05 COMPLIANT: contains module definitions and PUBLISHED baselines only — content every principal may see in full. It contains no per-user, per-subscription or otherwise entitlement-scoped data. It carries an ENTITLEMENT KEY so a consumer can determine gating, but no gated content.
   Unique index present, so concurrent refresh is available.';

CREATE MATERIALIZED VIEW product.mv_competition_summary AS
SELECT ce.id AS competition_edition_id, c.id AS competition_id, c.name AS competition_name,
       c.country_code, ce.season_label, ce.season_period,
       count(DISTINCT tr.team_id) AS registered_team_count,
       count(DISTINCT f.id)       AS fixture_count
FROM football.competition_edition ce
JOIN football.competition c ON c.id = ce.competition_id
LEFT JOIN football.team_registration tr ON tr.competition_edition_id = ce.id
LEFT JOIN football.fixture f ON f.competition_edition_id = ce.id
GROUP BY ce.id, c.id, c.name, c.country_code, ce.season_label, ce.season_period;
ALTER MATERIALIZED VIEW product.mv_competition_summary OWNER TO pt_owner;
CREATE UNIQUE INDEX ux_mv_competition_summary__edition
  ON product.mv_competition_summary (competition_edition_id);
COMMENT ON MATERIALIZED VIEW product.mv_competition_summary IS
  'F-05 COMPLIANT: reality only, which is not confidential.';

-- -----------------------------------------------------------------------------
-- Projection relations  (entitlement-scoped content — RLS applies)
-- -----------------------------------------------------------------------------

CREATE TABLE product.p_landing (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on      date        NOT NULL,
  fixture_id                bigint      NOT NULL,
  match_snapshot_id         bigint      NOT NULL,
  scheduled_kickoff_at      timestamptz NOT NULL,
  competition_id            bigint      NOT NULL,
  home_team_id              bigint      NOT NULL,
  away_team_id              bigint      NOT NULL,
  snapshot_point_code       text        NOT NULL,
  readiness_edge            numeric,
  form_edge                 numeric,
  risk_score                numeric,
  confidence                numeric,
  evidence_count            integer     NOT NULL,
  completeness_ratio        numeric     NOT NULL,
  required_entitlement_key  text,
  refreshed_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_p_landing PRIMARY KEY (id),
  CONSTRAINT uq_p_landing__fixture_point UNIQUE (fixture_partition_on, fixture_id, snapshot_point_code)
);
ALTER TABLE product.p_landing OWNER TO pt_owner;
ALTER TABLE product.p_landing ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.p_landing FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE product.p_landing IS
  'F-05. A PROJECTION RELATION, not a materialised view, because it holds entitlement-scoped content and only a relation supports row-level security. DISPOSABLE (LC-145): dropping it loses nothing but recomputation, which is what makes its exclusion from backup safe.';

-- Entitlement enforcement AT THE PROJECTION BOUNDARY (§B.7.6). Consults the
-- single resolution function; never resolves entitlement inline.
CREATE POLICY pl_p_landing__entitled__select ON product.p_landing
  FOR SELECT TO authenticated
  USING (
    required_entitlement_key IS NULL
    OR required_entitlement_key IN (SELECT entitlement_feature_key
                                    FROM product.fn_resolve_entitlements((SELECT auth.uid())))
  );
CREATE POLICY pl_p_landing__anon__select ON product.p_landing
  FOR SELECT TO anon USING (required_entitlement_key IS NULL);

CREATE TABLE product.p_team_state (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  team_id                   bigint      NOT NULL,
  context_kind_code         text        NOT NULL,
  competition_edition_id    bigint,
  feature_key               text        NOT NULL,
  value                     numeric     NOT NULL,
  provenance_class_code     text        NOT NULL,
  sample_observation_count  integer     NOT NULL,
  sample_meets_threshold    boolean     NOT NULL,
  value_as_of               timestamptz NOT NULL,
  required_entitlement_key  text,
  refreshed_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_p_team_state PRIMARY KEY (id),
  CONSTRAINT uq_p_team_state__team_context_feature
    UNIQUE (team_id, context_kind_code, competition_edition_id, feature_key)
);
ALTER TABLE product.p_team_state OWNER TO pt_owner;
ALTER TABLE product.p_team_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE product.p_team_state FORCE ROW LEVEL SECURITY;
CREATE POLICY pl_p_team_state__entitled__select ON product.p_team_state
  FOR SELECT TO authenticated
  USING (
    required_entitlement_key IS NULL
    OR required_entitlement_key IN (SELECT entitlement_feature_key
                                    FROM product.fn_resolve_entitlements((SELECT auth.uid())))
  );
CREATE POLICY pl_p_team_state__anon__select ON product.p_team_state
  FOR SELECT TO anon USING (required_entitlement_key IS NULL);
COMMENT ON TABLE product.p_team_state IS
  'Materialisation of fn_team_state across contexts. LABELS THE CONTEXT of every element (LC-110), so a reader can tell which competition a figure describes — the previous platform presented all such figures as unqualified club-level numbers.';

GRANT SELECT ON product.p_landing, product.p_team_state,
                product.mv_module_directory, product.mv_competition_summary
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON product.p_landing, product.p_team_state
  TO pt_pipeline_projection;
GRANT SELECT ON football.v_fixture, football.v_player_current TO anon, authenticated;
GRANT EXECUTE ON FUNCTION feature.fn_team_state(bigint, text, bigint, timestamptz)
  TO pt_pipeline_projection, pt_platform_admin;

-- =============================================================================
-- MATCH INTELLIGENCE has NO projection, deliberately (§B.13.3). A sealed
-- snapshot is immutable, so a projection offers no consistency benefit; and
-- because the aggregate is co-partitioned on fixture_partition_on, assembly is a
-- partition-pruned, partition-wise gather of a small number of rows within one
-- partition per relation. Interposing a projection would add refresh machinery,
-- staleness and rebuild cost for no gain.
-- This is the direct correction of the previous platform's costliest read
-- pattern, in which a single fixture required ~30 independent round trips.
-- =============================================================================
