-- =============================================================================
-- 019_operational_completion.sql — Append-only completion for operational runs
-- REVISION 1
-- Source: Phase 8 S-2 finding M-1 (Correction B) and finding M-2
-- Depends: 001-018  |  Transactional
--
-- WHY THIS MIGRATION EXISTS
--
-- operations.pipeline_run and operations.pipeline_job_run are the only relations
-- in the design modelled with an explicit open -> close lifecycle:
--
--     ended_at  timestamptz NULL          -- only meaningful if set later
--     outcome   CHECK (... 'RUNNING' ...) -- only meaningful as an initial state
--
-- That lifecycle was unreachable. Both relations carry the append-only guard,
-- which raises on UPDATE for every principal without exception (R-19) — verified
-- by executing the UPDATE as the cluster superuser and watching it refuse — and
-- no role holds UPDATE on either. A row inserted as RUNNING could never be
-- transitioned, so run outcome and duration were never recorded.
--
-- Inserting once at completion instead is FORECLOSED BY P-04:
-- snapshot.match_snapshot.pipeline_job_run_id is NOT NULL and pairs compositely
-- with pipeline_job_run_occurred_at, and ck_match_snapshot__job_run_reference_
-- complete enforces both-or-neither. A sealing transaction must reference a job
-- run that already exists AND IS COMMITTED at the moment it inserts the
-- snapshot — during the work, not after it. The job row must therefore exist
-- early, and the schema forbids amending it later.
--
-- THE RESOLUTION IS THE PATTERN THE ARCHITECTURE ALREADY USES.
--
-- Correction A.2 faced exactly this shape for snapshot outcome revision: a
-- sealed row whose conclusion may change. It did not weaken the guard and did
-- not add an update path. It appended a companion carrying ordinal succession,
-- so the earlier judgement stays readable and the latest ordinal prevails.
--
-- This migration applies that pattern to operational runs. Nothing is weakened:
--   * no append-only guard is removed or exempted
--   * no UPDATE privilege is granted, to any role, anywhere
--   * RUNNING remains the immutable initial state of the run row itself
-- =============================================================================

-- -----------------------------------------------------------------------------
-- pipeline_run_completion
-- -----------------------------------------------------------------------------

CREATE TABLE operations.pipeline_run_completion (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  pipeline_run_id   bigint      NOT NULL,
  run_occurred_at   timestamptz NOT NULL,
  ended_at          timestamptz NOT NULL,
  outcome           text        NOT NULL,
  -- A.2 ORDINAL SUCCESSION. A correction is a NEW row at a higher ordinal; the
  -- earlier record remains readable. Nothing is ever updated.
  ordinal           integer     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_pipeline_run_completion PRIMARY KEY (id, occurred_at),   -- C-02
  -- The partition key is part of the uniqueness because the relation is
  -- partitioned (F-03: no partial or non-covering unique index on a partitioned
  -- relation). A duplicate ordinal in a different month is therefore possible in
  -- principle; fn_current_run_completion below orders on
  -- (ordinal, occurred_at, id) so the resolution is deterministic regardless.
  CONSTRAINT uq_pipeline_run_completion__succession
    UNIQUE (pipeline_run_id, run_occurred_at, ordinal, occurred_at),
  -- A.1 / R-01: every reference to a partitioned relation is composite.
  CONSTRAINT fk_pipeline_run_completion__run
    FOREIGN KEY (pipeline_run_id, run_occurred_at)
    REFERENCES operations.pipeline_run (id, occurred_at)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- The same terminal vocabulary as the run itself, minus RUNNING: a completion
  -- record that says the run is still running is not a completion.
  CONSTRAINT ck_pipeline_run_completion__outcome_known
    CHECK (outcome IN ('SUCCEEDED','FAILED','PARTIAL')),
  CONSTRAINT ck_pipeline_run_completion__ordinal_positive CHECK (ordinal >= 1)
) PARTITION BY RANGE (occurred_at);

ALTER TABLE operations.pipeline_run_completion OWNER TO pt_owner;

CREATE TABLE operations.pipeline_run_completion_pdefault
  PARTITION OF operations.pipeline_run_completion DEFAULT;
ALTER TABLE operations.pipeline_run_completion_pdefault OWNER TO pt_owner;

COMMENT ON TABLE operations.pipeline_run_completion IS
  'S-2 finding M-1, Correction B. The terminal state of a pipeline run, recorded by APPENDING rather than by updating the run.
   operations.pipeline_run carries the append-only guard and no role holds UPDATE on it, so its outcome cannot be transitioned from RUNNING. Inserting the run at completion instead is foreclosed by P-04, which requires the job run to be committed DURING the work so snapshot.match_snapshot can reference it.
   This is the A.2 pattern: ordinal succession over an append-only companion. The guard is not weakened, no UPDATE privilege is granted, and RUNNING remains the immutable initial state of the run row.';
COMMENT ON COLUMN operations.pipeline_run_completion.ordinal IS
  'A.2. A correction to a recorded outcome is a NEW row at a higher ordinal, never an amendment. The earlier record stays readable, which is the point — a run whose outcome was revised is a different fact from one that was always SUCCEEDED.';

-- -----------------------------------------------------------------------------
-- pipeline_job_run_completion
-- -----------------------------------------------------------------------------
-- Required, not optional. pipeline_job_run carries the same guard, the same
-- absent UPDATE grant, and the same RUNNING initial state — and it is the
-- relation snapshot.match_snapshot actually references, so it is the one whose
-- outcome matters most to a later reader asking whether the sealing job that
-- produced a snapshot had succeeded.

CREATE TABLE operations.pipeline_job_run_completion (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  pipeline_job_run_id   bigint      NOT NULL,
  job_occurred_at       timestamptz NOT NULL,
  ended_at              timestamptz NOT NULL,
  outcome               text        NOT NULL,
  ordinal               integer     NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_pipeline_job_run_completion PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_pipeline_job_run_completion__succession
    UNIQUE (pipeline_job_run_id, job_occurred_at, ordinal, occurred_at),
  CONSTRAINT fk_pipeline_job_run_completion__job
    FOREIGN KEY (pipeline_job_run_id, job_occurred_at)
    REFERENCES operations.pipeline_job_run (id, occurred_at)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- The job vocabulary, minus RUNNING. SKIPPED and PRECONDITION_UNMET are
  -- terminal states a stage can legitimately reach and were equally unreachable
  -- before this relation existed.
  CONSTRAINT ck_pipeline_job_run_completion__outcome_known
    CHECK (outcome IN ('SUCCEEDED','FAILED','SKIPPED','PRECONDITION_UNMET')),
  CONSTRAINT ck_pipeline_job_run_completion__ordinal_positive CHECK (ordinal >= 1)
) PARTITION BY RANGE (occurred_at);

ALTER TABLE operations.pipeline_job_run_completion OWNER TO pt_owner;

CREATE TABLE operations.pipeline_job_run_completion_pdefault
  PARTITION OF operations.pipeline_job_run_completion DEFAULT;
ALTER TABLE operations.pipeline_job_run_completion_pdefault OWNER TO pt_owner;

COMMENT ON TABLE operations.pipeline_job_run_completion IS
  'S-2 finding M-1, Correction B, applied to job runs. See operations.pipeline_run_completion. This is the relation that makes "did the sealing job that produced this snapshot succeed" answerable — snapshot.match_snapshot references the job run, and until now that job run said RUNNING for ever.';

-- -----------------------------------------------------------------------------
-- Access paths for current-state lookup
-- -----------------------------------------------------------------------------
-- The only question these relations are asked: what is the latest completion for
-- this run. Ordering the index by ordinal DESC makes that a backwards index scan
-- of one row rather than a sort.

CREATE INDEX ix_pipeline_run_completion__current
  ON operations.pipeline_run_completion (pipeline_run_id, run_occurred_at, ordinal DESC);

CREATE INDEX ix_pipeline_job_run_completion__current
  ON operations.pipeline_job_run_completion (pipeline_job_run_id, job_occurred_at, ordinal DESC);

-- -----------------------------------------------------------------------------
-- Append-only guards  (R-19, R-20)
-- -----------------------------------------------------------------------------
-- The same guard every other append-only relation carries, and for the same
-- reason. A completion record is a statement about something that already
-- happened; correcting it means appending a higher ordinal, never rewriting the
-- earlier one.

CREATE TRIGGER tr_pipeline_run_completion__append_guard
  BEFORE UPDATE OR DELETE ON operations.pipeline_run_completion
  FOR EACH ROW EXECUTE FUNCTION feature.tf_append_only__guard();

CREATE TRIGGER tr_pipeline_job_run_completion__append_guard
  BEFORE UPDATE OR DELETE ON operations.pipeline_job_run_completion
  FOR EACH ROW EXECUTE FUNCTION feature.tf_append_only__guard();

-- -----------------------------------------------------------------------------
-- Row-level security  (PD-18, F-09)
-- -----------------------------------------------------------------------------
-- These relations are created AFTER migration 016 forced RLS across the seven
-- schemas, so they must do it for themselves. This is the B-09 lesson: a
-- relation that escapes the sweep because of its position in the ordering is
-- exactly the silent gap the sweep exists to close.

ALTER TABLE operations.pipeline_run_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.pipeline_run_completion FORCE ROW LEVEL SECURITY;
ALTER TABLE operations.pipeline_job_run_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.pipeline_job_run_completion FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE operations.pipeline_run_completion_pdefault FROM PUBLIC;
REVOKE ALL ON TABLE operations.pipeline_job_run_completion_pdefault FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Access — SELECT and INSERT only, through the one applicator
-- -----------------------------------------------------------------------------
-- NO UPDATE AND NO DELETE ARE GRANTED, to any role. Appending is the only way a
-- completion is recorded and the only way one is corrected.
--
-- Issued through operations.fn_apply_access so every grant carries its matching
-- policy. A grant without a policy on a FORCE ROW LEVEL SECURITY relation fails
-- silently — INSERT raises, SELECT returns nothing — which is the defect class
-- of B-03, B-09 and B-11. fn_assert_access_correspondence() at the end of this
-- file proves it did not happen again.

DO $access$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'pt_pipeline_ingestion', 'pt_pipeline_feature', 'pt_pipeline_module',
    'pt_pipeline_calibration', 'pt_pipeline_projection', 'pt_retention'
  ] LOOP
    PERFORM operations.fn_apply_access('operations','pipeline_run_completion', r, 'SI');
    PERFORM operations.fn_apply_access('operations','pipeline_job_run_completion', r, 'SI');
  END LOOP;

  -- The administrative role reads operational history and does not write it.
  PERFORM operations.fn_apply_access('operations','pipeline_run_completion','pt_platform_admin','S');
  PERFORM operations.fn_apply_access('operations','pipeline_job_run_completion','pt_platform_admin','S');
END
$access$;

-- -----------------------------------------------------------------------------
-- FINDING M-2 — the administrative role may resolve a failure
-- -----------------------------------------------------------------------------
-- operations.failure_resolution exists so a failure can be triaged:
-- OPEN -> INVESTIGATING -> RESOLVED / WONT_FIX. That is an OPERATOR action, and
-- pt_platform_admin is the role an operator uses — but migration 016 grants it
-- SELECT only on operations, so resolutions had to be written by a pipeline
-- role. A pipeline resolving its own failures is not oversight.
--
-- INSERT ONLY. The relation is append-only and carries the guard; a resolution
-- history is the sequence of its rows, so no amendment capability is conferred
-- and none is needed.

SELECT operations.fn_apply_access('operations','failure_resolution','pt_platform_admin','SI');

COMMENT ON TABLE operations.failure_resolution IS
  'The triage history of a failure, as an APPEND-ONLY SEQUENCE rather than a mutable status column — the same shape A.2 uses for snapshot outcome revision, and for the same reason: the earlier judgement remains readable.
   S-2 finding M-2: pt_platform_admin now holds INSERT here, and here alone among the operational telemetry relations. Resolution is the one operational record an operator writes.';

-- -----------------------------------------------------------------------------
-- Partition maintenance
-- -----------------------------------------------------------------------------
-- The completion relations are co-partitioned with the runs they describe, so
-- they must be extended in the same operation with identical boundaries
-- (§5.11.6). Replacing the function rather than editing migration 018 keeps the
-- approved set intact.

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
    -- REVISION 019 (M-1): co-partitioned with the runs they complete.
    ['operations','pipeline_run_completion'],['operations','pipeline_job_run_completion']
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
-- Retention
-- -----------------------------------------------------------------------------
-- A completion outlives nothing its run does not. Same class, same window as the
-- runs, so a bounded period is removed as one co-partitioned unit rather than
-- leaving orphan completions behind a RESTRICT.

INSERT INTO operations.retention_policy
  (target_schema_name, target_relation_name, retention_class,
   recent_window, intermediate_window, bounded_window, family_key) VALUES
  ('operations','pipeline_run_completion',    'BOUNDED', NULL, NULL, interval '180 days', NULL),
  ('operations','pipeline_job_run_completion','BOUNDED', NULL, NULL, interval '180 days', NULL)
ON CONFLICT (target_schema_name, target_relation_name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Current-state resolution
-- -----------------------------------------------------------------------------
-- The prevailing completion for a run: the highest ordinal, with occurred_at and
-- id breaking a tie deterministically. The tie is possible because the partition
-- key participates in the uniqueness constraint (see the note on
-- uq_pipeline_run_completion__succession), and an arbitrary winner is exactly
-- the defect class Phase 7 recorded as DB-04.

CREATE OR REPLACE VIEW operations.v_pipeline_run_current
  WITH (security_invoker = true, security_barrier = true) AS
SELECT r.id                AS pipeline_run_id,
       r.occurred_at       AS run_occurred_at,
       r.run_key,
       r.trigger_kind,
       r.started_at,
       c.ended_at,
       COALESCE(c.outcome, r.outcome) AS outcome,
       c.ordinal           AS completion_ordinal,
       (c.ended_at - r.started_at)    AS duration,
       r.code_revision
FROM operations.pipeline_run r
LEFT JOIN LATERAL (
  SELECT pc.ended_at, pc.outcome, pc.ordinal
  FROM operations.pipeline_run_completion pc
  WHERE pc.pipeline_run_id = r.id AND pc.run_occurred_at = r.occurred_at
  ORDER BY pc.ordinal DESC, pc.occurred_at DESC, pc.id DESC
  LIMIT 1
) c ON true;
ALTER VIEW operations.v_pipeline_run_current OWNER TO pt_owner;
COMMENT ON VIEW operations.v_pipeline_run_current IS
  'The question a dashboard asks: did this run finish, when, and how. COALESCE keeps RUNNING for a run with no completion yet — which is now a true statement about an in-flight run rather than a permanent lie about a finished one.';

CREATE OR REPLACE VIEW operations.v_pipeline_job_run_current
  WITH (security_invoker = true, security_barrier = true) AS
SELECT j.id                AS pipeline_job_run_id,
       j.occurred_at       AS job_occurred_at,
       j.pipeline_run_id,
       j.run_occurred_at,
       j.job_key,
       j.started_at,
       c.ended_at,
       COALESCE(c.outcome, j.outcome) AS outcome,
       c.ordinal           AS completion_ordinal,
       (c.ended_at - j.started_at)    AS duration
FROM operations.pipeline_job_run j
LEFT JOIN LATERAL (
  SELECT jc.ended_at, jc.outcome, jc.ordinal
  FROM operations.pipeline_job_run_completion jc
  WHERE jc.pipeline_job_run_id = j.id AND jc.job_occurred_at = j.occurred_at
  ORDER BY jc.ordinal DESC, jc.occurred_at DESC, jc.id DESC
  LIMIT 1
) c ON true;
ALTER VIEW operations.v_pipeline_job_run_current OWNER TO pt_owner;

GRANT SELECT ON operations.v_pipeline_run_current, operations.v_pipeline_job_run_current
  TO pt_platform_admin, pt_pipeline_ingestion, pt_pipeline_feature, pt_pipeline_module,
     pt_pipeline_calibration, pt_pipeline_projection, pt_retention;

-- =============================================================================
-- CONFORMANCE GATE
-- =============================================================================
-- The same two assertions migrations 016, 017 and 018 close with. A relation
-- added after the privilege matrix ran is precisely where correspondence breaks,
-- so this file proves it did not.

SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();

-- =============================================================================
-- ASSERTED POSTURE
--   * No append-only guard was removed, exempted or weakened
--   * No UPDATE privilege was granted, to any role, on any relation
--   * No DELETE privilege was granted beyond the existing retention path
--   * RUNNING remains the immutable initial state of a run and of a job run
--   * The completion relations are append-only, guarded, RLS-forced, and carry
--     a policy for every privilege granted on them
-- =============================================================================
