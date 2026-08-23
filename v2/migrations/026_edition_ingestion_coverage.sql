-- =============================================================================
-- 026_edition_ingestion_coverage.sql — Append-only coverage ledger (Gate 6A)
-- Source: docs Gate 6 — Coverage / Cursor Design (verdict PASS)
-- Depends: 001-025  |  Transactional
--
-- WHAT THIS MIGRATION IS
--
-- One append-only ledger relation, operations.edition_ingestion_coverage, that
-- records the date intervals successfully COMMITTED for a specific
-- football.competition_edition, each attested by the pipeline run that produced
-- it. It answers, for a later window-derivation/scheduler gate: "what range of
-- this edition is already covered, and therefore what remains?"
--
-- WHAT IT IS NOT (per the frozen Gate 6 design)
--   * NOT authorization — coverage lives in operations, is keyed on the internal
--     competition_edition_id, and grants nothing. Authorization stays exclusively
--     with governance (Gate 3) and the at-commit guard (Gate 4).
--   * NOT a provider page cursor — provider page numbers are unstable and are
--     deliberately not persisted. The durable anchor is the covered DATE range;
--     the resume cursor is DERIVED (season_period − union(covered)) by a later gate.
--   * NOT mutable state — this is a pure append-only ledger. Current coverage is
--     the union of committed intervals, read at query time. Nothing is updated.
--
-- The design's transaction-boundary intent (coverage advanced inside the season
-- write transaction, after the Gate 4 guard, before commit) is an APPLICATION
-- concern for a later gate. This migration only provides the durable relation and
-- follows the append-only operations conventions established by migration 019.
-- =============================================================================

CREATE TABLE operations.edition_ingestion_coverage (
  id                          bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at                 timestamptz NOT NULL DEFAULT now(),
  -- The INTERNAL edition anchor (Gate 6 §9/§10): stable relational identity.
  competition_edition_id      bigint      NOT NULL,
  -- Provider identity, retained for audit/debugging only — never the anchor.
  provider_code               text        NOT NULL,
  provider_external_id        text        NOT NULL,
  provider_season_external_id text        NOT NULL,
  -- The committed covered interval (matches the season_period daterange convention).
  covered_period              daterange   NOT NULL,
  -- true iff the pager definitively exhausted the window (no direction was
  -- BUDGET_EXHAUSTED). false marks a partial/truncated claim a later
  -- window-derivation gate must treat conservatively.
  complete                    boolean     NOT NULL,
  events_committed            integer     NOT NULL,
  -- Evidence: the run whose committed work this interval attests to. Composite,
  -- because operations.pipeline_run is partitioned (A.1 / R-01).
  pipeline_run_id             bigint      NOT NULL,
  run_occurred_at             timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_edition_ingestion_coverage PRIMARY KEY (id, occurred_at),   -- C-02
  -- NO UNIQUE on the interval: re-covering a range is a legitimate new
  -- attestation (Gate 6 §10, criterion "duplicate provider data safe").
  CONSTRAINT ck_edition_ingestion_coverage__period_nonempty
    CHECK (NOT isempty(covered_period)),
  CONSTRAINT ck_edition_ingestion_coverage__events_non_negative
    CHECK (events_committed >= 0),
  -- The internal anchor. competition_edition is unpartitioned (single-column PK),
  -- so this is a single-column cross-schema FK, RESTRICT — coverage can never be
  -- orphaned by deleting the edition it describes.
  CONSTRAINT fk_edition_ingestion_coverage__edition
    FOREIGN KEY (competition_edition_id)
    REFERENCES football.competition_edition (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A.1 / R-01: every reference to a partitioned relation is composite. Ties the
  -- attestation to its originating, committed run.
  CONSTRAINT fk_edition_ingestion_coverage__run
    FOREIGN KEY (pipeline_run_id, run_occurred_at)
    REFERENCES operations.pipeline_run (id, occurred_at)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (occurred_at);

ALTER TABLE operations.edition_ingestion_coverage OWNER TO pt_owner;

CREATE TABLE operations.edition_ingestion_coverage_pdefault
  PARTITION OF operations.edition_ingestion_coverage DEFAULT;
ALTER TABLE operations.edition_ingestion_coverage_pdefault OWNER TO pt_owner;

COMMENT ON TABLE operations.edition_ingestion_coverage IS
  'Gate 6A. Append-only ledger of date intervals successfully committed for a football.competition_edition, each attested by the pipeline run that produced it. NOT authorization (that is governance): a coverage row grants nothing and can never permit ingestion of a revoked edition. NOT a provider cursor: the resume point is DERIVED (season_period minus the union of covered intervals). Current coverage is the union of rows at read time; nothing is ever updated.';
COMMENT ON COLUMN operations.edition_ingestion_coverage.competition_edition_id IS
  'The internal, stable anchor. Provider identity columns are audit-only.';
COMMENT ON COLUMN operations.edition_ingestion_coverage.complete IS
  'true iff the provider walk exhausted the window (no direction BUDGET_EXHAUSTED). A later window-derivation gate counts only complete intervals as fully covered.';

-- -----------------------------------------------------------------------------
-- Access path — the question asked is "what is covered for this edition".
-- -----------------------------------------------------------------------------
CREATE INDEX ix_edition_ingestion_coverage__edition
  ON operations.edition_ingestion_coverage (competition_edition_id, occurred_at);

-- -----------------------------------------------------------------------------
-- Append-only guard (R-19, R-20) — one of the five permitted trigger classes.
-- A coverage attestation is a statement about work that already committed;
-- correcting it means appending another row, never rewriting one.
-- -----------------------------------------------------------------------------
CREATE TRIGGER tr_edition_ingestion_coverage__append_guard
  BEFORE UPDATE OR DELETE ON operations.edition_ingestion_coverage
  FOR EACH ROW EXECUTE FUNCTION feature.tf_append_only__guard();

-- -----------------------------------------------------------------------------
-- Row-level security (PD-18, F-09). Created after migration 016 forced RLS, so
-- it enables and forces it for itself — the B-09 lesson.
-- -----------------------------------------------------------------------------
ALTER TABLE operations.edition_ingestion_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.edition_ingestion_coverage FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE operations.edition_ingestion_coverage_pdefault FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Access — SELECT and INSERT only, through the one applicator (migration 016).
-- NO UPDATE and NO DELETE are granted, to any role. The ingestion role writes
-- coverage (S,I); the administrative role reads it (S). A grant without its
-- policy on a FORCE RLS relation fails silently, so both come from fn_apply_access
-- and are proven by the correspondence assertion below.
-- -----------------------------------------------------------------------------
SELECT operations.fn_apply_access('operations','edition_ingestion_coverage','pt_pipeline_ingestion','SI');
SELECT operations.fn_apply_access('operations','edition_ingestion_coverage','pt_platform_admin','S');

-- -----------------------------------------------------------------------------
-- Partition maintenance. A new partitioned relation is NOT covered automatically
-- by operations.fn_maintain_partitions (its spec is explicit), so — exactly as
-- migration 019 did for the completion relations — the function is replaced
-- forward with this relation added. Migration 018/019 are left intact.
-- -----------------------------------------------------------------------------
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
    ['operations','quality_assertion_result'],
    ['operations','pipeline_run_completion'],['operations','pipeline_job_run_completion'],
    -- REVISION 026 (Gate 6A): co-maintained with the runs it attests to.
    ['operations','edition_ingestion_coverage']
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

-- Create this relation's live partitions now, so the first coverage row lands in
-- a monthly partition rather than the default (the default_partition_empty
-- quality check, migration 018).
SELECT operations.fn_ensure_monthly_partitions(
  'operations','edition_ingestion_coverage',
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '4 months')::date);

-- =============================================================================
-- CONFORMANCE GATE — the same two assertions migrations 016/017/018/019 close
-- with. operations is already in both functions' schema lists, so no assertion
-- function is modified; this file only proves the new relation conforms.
-- =============================================================================
SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();

-- =============================================================================
-- ASSERTED POSTURE
--   * operations.edition_ingestion_coverage is append-only, guarded, RLS-forced
--   * pt_pipeline_ingestion holds SELECT + INSERT; pt_platform_admin holds SELECT
--   * NO UPDATE and NO DELETE granted to any role (no mutable coverage state)
--   * coverage is anchored on the internal competition_edition_id and grants no
--     authorization
--   * NOT in this migration: coverage-advancement application logic, window
--     derivation, scheduling, backfill, reconciliation, team parity
-- =============================================================================
