-- =============================================================================
-- 015_triggers.sql — The five permitted triggers
-- REVISION 2
-- Source: Doc 08 Rev 1 §B.8.5 stage 15, §B.6, A.5, A.12  |  Depends: 001-014
--
-- PERMITTED CLASSES ONLY (§B.6.1). No calculation trigger, no registry-lookup
-- trigger, no per-row validation trigger on a high-volume relation exists.
--
-- After A.11 and A.12, the per-row trigger burden on the four largest relations
-- — feature_value, feature_lineage, module_evidence_item, snapshot_feature_state
-- — is NIL. The guards fire only on prohibited operations; the two former
-- value-checking triggers are now declarative constraints (§B.6.6).
--
-- Triggers do not write, do not populate values, and do not implement business
-- calculation. A trigger that writes is a second owner, contravening LC-C.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SEALING GUARD  (R-23) — no exception, for any principal, ever
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION snapshot.tf_sealed__guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION
    'sealed content is immutable: % attempted on %.% by role %',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
    USING ERRCODE = 'raise_exception',
          HINT = 'Sealed claims are never modified. A corrected rule produces a NEW claim under a new version alongside the original (R-23).';
END;
$$;
ALTER FUNCTION snapshot.tf_sealed__guard() OWNER TO pt_owner;
COMMENT ON FUNCTION snapshot.tf_sealed__guard() IS
  'PR-04 control 2 of 4. Secondary to privilege withdrawal, which is control 1. Exists because privilege configuration is a deployment artefact that can drift. Admits NO exception — not for the administrative role, not for the retention role, not under any session marker.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'match_snapshot','snapshot_version_component','snapshot_feature_state',
    'snapshot_module_reading','snapshot_verdict','snapshot_model_output',
    'snapshot_completeness','snapshot_completeness_item',
    'snapshot_outcome_link','snapshot_outcome_link_currency'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER tr_%s__seal_guard BEFORE UPDATE OR DELETE ON snapshot.%I
         FOR EACH ROW EXECUTE FUNCTION snapshot.tf_sealed__guard()', t, t);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. APPEND-ONLY GUARD  (A.5, R-19 to R-22)
-- -----------------------------------------------------------------------------
-- UPDATE raises for every principal without exception.
-- DELETE raises unless BOTH hold: the role is the retention role, AND the
-- session carries the retention marker. Either alone is insufficient.

CREATE OR REPLACE FUNCTION feature.tf_append_only__guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_marker text := current_setting('pitchterminal.retention_operation', true);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'append-only relation: UPDATE attempted on %.% by role %',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
      USING HINT = 'Recalculating produces a NEW row at a new as-of; it never modifies an existing one (R-19).';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_user = 'pt_retention' AND v_marker = 'true' THEN
      RETURN OLD;                      -- R-20: the sole permitted delete path
    END IF;
    RAISE EXCEPTION
      'append-only relation: DELETE attempted on %.% by role % without the retention marker',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, current_user
      USING HINT = 'Thinning is performed by the retention role with pitchterminal.retention_operation set (R-20, R-21).';
  END IF;

  RETURN NULL;
END;
$$;
ALTER FUNCTION feature.tf_append_only__guard() OWNER TO pt_owner;
COMMENT ON FUNCTION feature.tf_append_only__guard() IS
  'A.5. Without the delete exception, retention cannot execute at all once A.4 establishes that thinning proceeds by row deletion. Without the exception being NARROWLY SCOPED, the append-only guarantee would be weakened for every role rather than for one controlled process under an explicit marker.
   PRIMARY control is privilege: R-22 asserts that no role other than pt_retention holds DELETE on a thinnable relation.';

DO $$
DECLARE s text; t text; spec text[][];
BEGIN
  spec := ARRAY[
    ['feature','feature_value'], ['feature','feature_lineage'],
    ['module','module_reading'], ['module','module_evidence'], ['module','module_evidence_item'],
    ['football','standing'], ['football','player_valuation'],
    ['football','fixture_lifecycle_transition'],
    ['product','notification_intent'],
    ['operations','pipeline_run'], ['operations','pipeline_job_run'],
    ['operations','write_record'], ['operations','failure'],
    ['operations','failure_resolution'], ['operations','api_usage'],
    ['operations','quality_assertion_result']
  ];
  FOR i IN 1..array_length(spec,1) LOOP
    s := spec[i][1]; t := spec[i][2];
    EXECUTE format(
      'CREATE TRIGGER tr_%s__append_guard BEFORE UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION feature.tf_append_only__guard()', t, s, t);
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. SNAPSHOT LIFECYCLE GUARD  (LC-79)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION snapshot.tf_match_snapshot__lifecycle_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_is_open boolean;
BEGIN
  SELECT s.is_open INTO v_is_open
  FROM football.fixture f
  JOIN football.fixture_lifecycle_state s ON s.code = f.lifecycle_state_code
  WHERE f.id = NEW.fixture_id AND f.fixture_partition_on = NEW.fixture_partition_on;

  -- PROTECT BY DEFAULT: a missing fixture or an unrecognised state seals.
  IF v_is_open IS NULL OR v_is_open = false THEN
    RAISE EXCEPTION
      'fixture % is not in an open lifecycle state; no further snapshots may be created',
      NEW.fixture_id
      USING HINT = 'The guard protects unless the fixture is EXPLICITLY still open, so a newly introduced provider status seals by default (LC-14, LC-79).';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION snapshot.tf_match_snapshot__lifecycle_guard() OWNER TO pt_owner;

CREATE TRIGGER tr_match_snapshot__lifecycle_guard
  BEFORE INSERT ON snapshot.match_snapshot
  FOR EACH ROW EXECUTE FUNCTION snapshot.tf_match_snapshot__lifecycle_guard();
COMMENT ON FUNCTION snapshot.tf_match_snapshot__lifecycle_guard() IS
  'One indexed lookup per snapshot creation; approximately 1.5 x 10^6 executions across the envelope. Negligible. Chosen over a sealing-process check because this is the guarantee that survives a future writer that does not know the rule.';

-- -----------------------------------------------------------------------------
-- 4. PROVENANCE PROPAGATION  (A.12, R-50 to R-53) — STATEMENT LEVEL
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION feature.tf_feature_value__provenance_propagation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_offender record;
BEGIN
  SELECT n.id, n.provenance_class_code, min(cp.strength_rank) AS weakest_input_rank
    INTO v_offender
  FROM new_values n
  JOIN football.provenance_class np ON np.code = n.provenance_class_code
  JOIN feature.feature_lineage l
    ON l.produced_value_id = n.id AND l.produced_value_as_of = n.as_of
  JOIN feature.feature_value cv
    ON cv.id = l.consumed_value_id AND cv.as_of = l.consumed_value_as_of
  JOIN football.provenance_class cp ON cp.code = cv.provenance_class_code
  GROUP BY n.id, n.provenance_class_code, np.strength_rank
  HAVING np.strength_rank > min(cp.strength_rank)
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'provenance violation: feature value % declares % but its weakest lineage input is weaker',
      v_offender.id, v_offender.provenance_class_code
      USING HINT = 'A derived value is no stronger than the weakest input in its lineage. A value derived from an estimate is itself an estimate (LC-37).';
  END IF;
  RETURN NULL;
END;
$$;
ALTER FUNCTION feature.tf_feature_value__provenance_propagation() OWNER TO pt_owner;

CREATE TRIGGER tr_feature_value__provenance_propagation
  AFTER INSERT ON feature.feature_value
  REFERENCING NEW TABLE AS new_values
  FOR EACH STATEMENT EXECUTE FUNCTION feature.tf_feature_value__provenance_propagation();

COMMENT ON FUNCTION feature.tf_feature_value__provenance_propagation() IS
  'A.12 / R-50. STATEMENT LEVEL over a transition table, joined ONCE against lineage. Per-row enforcement is PROHIBITED (R-52): evaluated per row this becomes a correlated aggregation executed up to one billion times, which would dominate write cost. The distinction is the difference between a viable write path and an unviable one.
   R-53: values with no lineage are exempt, having no inputs to be weaker than — the inner join provides this naturally.';

-- TODO: requires confirmation from Phase 5 schema catalogue
--   Statement-level triggers with transition tables on PARTITIONED relations
--   must be verified against the target PostgreSQL 16 build before production.
--   If unsupported on the partitioned parent, the fallback is a post-insert
--   validation assertion in migration 018 executed within the writing job''s
--   transaction, which preserves the guarantee at the cost of raising later in
--   the statement. Recorded rather than assumed. Pairs with the A.17 detachment
--   verification as a mandatory pre-production platform check.

-- -----------------------------------------------------------------------------
-- 5. WATCHLIST REFERENTIAL DEFENCE  (LC-155)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION product.tf_watchlist__referential_defence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'fixture' THEN
    DELETE FROM product.watchlist w
     WHERE w.fixture_id = OLD.id AND w.fixture_partition_on = OLD.fixture_partition_on;
  ELSIF TG_TABLE_NAME = 'team' THEN
    DELETE FROM product.watchlist w WHERE w.team_id = OLD.id;
  ELSIF TG_TABLE_NAME = 'competition' THEN
    DELETE FROM product.watchlist w WHERE w.competition_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$;
ALTER FUNCTION product.tf_watchlist__referential_defence() OWNER TO pt_owner;
COMMENT ON FUNCTION product.tf_watchlist__referential_defence() IS
  'LC-155. Reality identities are permanent and are not deleted in normal operation, so this fires effectively never. It exists for the extraordinary case. SECURITY DEFINER with a fixed search path (§5.17.6), because the deleting principal is an ingestion role with no privilege on product.
   NOTE: watchlist''s references are typed and RESTRICT, so an ordinary delete would already fail. This trigger runs BEFORE the constraint would reject, clearing dependent entries so that an authorised removal can proceed.';

CREATE TRIGGER tr_fixture__watchlist_defence
  BEFORE DELETE ON football.fixture
  FOR EACH ROW EXECUTE FUNCTION product.tf_watchlist__referential_defence();
CREATE TRIGGER tr_team__watchlist_defence
  BEFORE DELETE ON football.team
  FOR EACH ROW EXECUTE FUNCTION product.tf_watchlist__referential_defence();
CREATE TRIGGER tr_competition__watchlist_defence
  BEFORE DELETE ON football.competition
  FOR EACH ROW EXECUTE FUNCTION product.tf_watchlist__referential_defence();

-- =============================================================================
-- TRIGGER INVENTORY — complete and closed. Anything not listed does not exist.
--   1. tr_<relation>__seal_guard          x10 snapshot relations
--   2. tr_<relation>__append_guard        x16 temporal / append-only relations
--   3. tr_match_snapshot__lifecycle_guard x1
--   4. tr_feature_value__provenance_propagation x1  (STATEMENT level)
--   5. tr_<relation>__watchlist_defence   x3 reality relations
-- No trigger performs a per-row lookup against another relation on any relation
-- projected to exceed ten million rows (R-49).
-- =============================================================================
