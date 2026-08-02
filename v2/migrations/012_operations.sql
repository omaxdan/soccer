-- =============================================================================
-- 012_operations.sql — Operational telemetry
-- Source: Doc 08 Rev 1 §B.8.5 stage 13, §B.9  |  Depends: 001-011  |  Transactional
--
-- Why this matters more in V2 than before: when calculations were overwritten a
-- failed run was self-correcting — the next run fixed it. When calculations
-- APPEND and snapshots SEAL, a failed run leaves a PERMANENT GAP, and a snapshot
-- that should exist and does not is indistinguishable, later, from a fixture
-- that never warranted one. Operational data is therefore part of the historical
-- record, not tooling.
--
-- Isolation: operations holds NO outbound foreign key to any authoritative
-- relation. It observes without participating, so no authoritative row can be
-- made to depend on a telemetry row's survival.
-- =============================================================================

CREATE TABLE operations.pipeline_run (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  run_key       text        NOT NULL,
  trigger_kind  text        NOT NULL,
  scope_text    text,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  outcome       text        NOT NULL,
  code_revision text        NOT NULL,
  CONSTRAINT pk_pipeline_run PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_pipeline_run__run_key UNIQUE (run_key, occurred_at),
  CONSTRAINT uq_pipeline_run__id_occurred UNIQUE (id, occurred_at),
  CONSTRAINT ck_pipeline_run__trigger_known CHECK (trigger_kind IN ('SCHEDULED','MANUAL','BACKFILL','RECONSTRUCTION')),
  CONSTRAINT ck_pipeline_run__outcome_known CHECK (outcome IN ('RUNNING','SUCCEEDED','FAILED','PARTIAL'))
) PARTITION BY RANGE (occurred_at);
COMMENT ON COLUMN operations.pipeline_run.code_revision IS
  '§5.16.6. Distinct from formula version: formula version says WHICH RULE, code revision says WHICH IMPLEMENTATION. When output moves unexpectedly, distinguishing the two is the first diagnostic question and is unanswerable with only one recorded.';

CREATE TABLE operations.pipeline_job_run (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  pipeline_run_id   bigint      NOT NULL,
  run_occurred_at   timestamptz NOT NULL,
  job_key           text        NOT NULL,
  scope_text        text,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,
  outcome           text        NOT NULL,
  formula_versions  jsonb,
  CONSTRAINT pk_pipeline_job_run PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_pipeline_job_run__id_occurred UNIQUE (id, occurred_at),
  CONSTRAINT fk_pipeline_job_run__run FOREIGN KEY (pipeline_run_id, run_occurred_at)
    REFERENCES operations.pipeline_run (id, occurred_at) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_pipeline_job_run__outcome_known
    CHECK (outcome IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED','PRECONDITION_UNMET'))
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE operations.pipeline_job_run IS
  'E9.02. Job-level granularity is where failure becomes diagnosable: "the run failed" is not actionable; "the travel calculator failed for forty of sixty-one competitions" is.
   RETENTION EXCEPTION (§B.9.4): a job run referenced by a sealed artefact or a calibration run is retained PERMANENTLY regardless of the bounded window, enforced by the RESTRICT references added in migration 014.';
COMMENT ON COLUMN operations.pipeline_job_run.formula_versions IS
  'PERMITTED structured payload under PD-16 circumstance 2: operational diagnostic detail, heterogeneous by nature.';

CREATE TABLE operations.write_record (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  pipeline_job_run_id   bigint      NOT NULL,
  job_occurred_at       timestamptz NOT NULL,
  target_schema_name    text        NOT NULL,
  target_relation_name  text        NOT NULL,
  rows_examined         bigint      NOT NULL DEFAULT 0,
  rows_written          bigint      NOT NULL DEFAULT 0,
  rows_skipped          bigint      NOT NULL DEFAULT 0,
  rows_rejected         bigint      NOT NULL DEFAULT 0,
  CONSTRAINT pk_write_record PRIMARY KEY (id, occurred_at),
  CONSTRAINT fk_write_record__job FOREIGN KEY (pipeline_job_run_id, job_occurred_at)
    REFERENCES operations.pipeline_job_run (id, occurred_at) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_write_record__counts_non_negative CHECK (
    rows_examined >= 0 AND rows_written >= 0 AND rows_skipped >= 0 AND rows_rejected >= 0)
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE operations.write_record IS
  'E9.03. A job completing successfully while writing nothing is among the most dangerous states in a precompute platform and is invisible without this record. Because conflict handling on append-only relations DISCARDS rather than updates (§5.12.6), a calculation that conflicted on every row reports zero written and a high skipped count — which is diagnostic.';

CREATE TABLE operations.failure (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  pipeline_job_run_id   bigint      NOT NULL,
  job_occurred_at       timestamptz NOT NULL,
  failure_class_code    text        NOT NULL,
  affected_entity_text  text,
  diagnostic            text        NOT NULL,
  CONSTRAINT pk_failure PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_failure__id_occurred UNIQUE (id, occurred_at),
  CONSTRAINT fk_failure__job FOREIGN KEY (pipeline_job_run_id, job_occurred_at)
    REFERENCES operations.pipeline_job_run (id, occurred_at) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_failure__class FOREIGN KEY (failure_class_code)
    REFERENCES operations.failure_class (code) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (occurred_at);

CREATE TABLE operations.failure_resolution (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  failure_id        bigint      NOT NULL,
  failure_occurred_at timestamptz NOT NULL,
  resolution_state  text        NOT NULL,
  note              text,
  CONSTRAINT pk_failure_resolution PRIMARY KEY (id, occurred_at),
  CONSTRAINT fk_failure_resolution__failure FOREIGN KEY (failure_id, failure_occurred_at)
    REFERENCES operations.failure (id, occurred_at) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_failure_resolution__state_known
    CHECK (resolution_state IN ('OPEN','INVESTIGATING','RESOLVED','WONT_FIX'))
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE operations.failure_resolution IS
  'E9.04. The failure record is append-only; resolution state is the sole mutable concern and is expressed as a SEPARATE APPEND-ONLY RELATION rather than as an update to the failure, preserving the append-only posture of the schema.';

CREATE TABLE operations.api_usage (
  id                  bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  provider_code       text        NOT NULL,
  endpoint_key        text        NOT NULL,
  window_start        timestamptz NOT NULL,
  window_end          timestamptz NOT NULL,
  requests_made       integer     NOT NULL,
  quota_consumed      integer     NOT NULL,
  quota_remaining     integer,
  throttled_count     integer     NOT NULL DEFAULT 0,
  CONSTRAINT pk_api_usage PRIMARY KEY (id, occurred_at),
  CONSTRAINT uq_api_usage__provider_endpoint_window
    UNIQUE (provider_code, endpoint_key, window_start, occurred_at),
  CONSTRAINT ck_api_usage__counts_non_negative
    CHECK (requests_made >= 0 AND quota_consumed >= 0 AND throttled_count >= 0),
  CONSTRAINT ck_api_usage__window_ordered CHECK (window_end > window_start)
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE operations.api_usage IS
  'E9.05. Ingestion is QUOTA-BOUND rather than compute-bound — the previous platform carried configuration specifically to double a daily quota by adding a second credential, and nothing recorded consumption. At the coverage target, quota is the binding constraint on freshness, and an unmeasured binding constraint cannot be managed. Retained longest among operational content (§B.9.4).';

CREATE TABLE operations.quality_check (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  quality_check_key     text        NOT NULL,
  display_name          text        NOT NULL,
  assertion_text        text        NOT NULL,
  scope_text            text        NOT NULL,
  severity              text        NOT NULL,
  cadence               interval    NOT NULL,
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_quality_check       PRIMARY KEY (id),
  CONSTRAINT uq_quality_check__key  UNIQUE (quality_check_key),
  CONSTRAINT ck_quality_check__severity_known CHECK (severity IN ('BLOCKING','HIGH','MEDIUM','LOW'))
);

CREATE TABLE operations.quality_assertion_result (
  id                        bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  quality_check_id          bigint      NOT NULL,
  quality_check_version_id  bigint      NOT NULL,
  pipeline_job_run_id       bigint,
  job_occurred_at           timestamptz,
  passed                    boolean     NOT NULL,
  observed_value            text,
  detail                    text,
  CONSTRAINT pk_quality_assertion_result PRIMARY KEY (id, occurred_at),
  CONSTRAINT fk_quality_assertion_result__check FOREIGN KEY (quality_check_id)
    REFERENCES operations.quality_check (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_quality_assertion_result__version FOREIGN KEY (quality_check_version_id)
    REFERENCES operations.quality_check_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_quality_assertion_result__job FOREIGN KEY (pipeline_job_run_id, job_occurred_at)
    REFERENCES operations.pipeline_job_run (id, occurred_at) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE operations.quality_assertion_result IS
  'E9.08. PERMANENT (§B.9.4) so degradation is visible as a TREND rather than an isolated event. The previous platform had verification logic that printed and exited — valuable logic whose output was not retained, so verification was a manual act rather than a monitorable trend.';

CREATE TABLE operations.operational_aggregate (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  period_start      date        NOT NULL,
  aggregate_kind    text        NOT NULL,
  scope_key         text        NOT NULL,
  measures          jsonb       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_operational_aggregate PRIMARY KEY (id),
  CONSTRAINT uq_operational_aggregate__period_kind_scope
    UNIQUE (period_start, aggregate_kind, scope_key)
);
COMMENT ON TABLE operations.operational_aggregate IS
  'E9.10. PERMANENT. Written BEFORE the corresponding detail is thinned — the ordering is significant, so no detail is removed before its contribution to the permanent record exists (§B.9.6).';

DO $$
DECLARE rel text; d date; d_end date;
BEGIN
  FOREACH rel IN ARRAY ARRAY['pipeline_run','pipeline_job_run','write_record','failure',
                             'failure_resolution','api_usage','quality_assertion_result'] LOOP
    d := date '2024-01-01';
    WHILE d < date '2029-01-01' LOOP
      d_end := (d + interval '1 month')::date;
      EXECUTE format('CREATE TABLE operations.%I PARTITION OF operations.%I FOR VALUES FROM (%L) TO (%L)',
                     rel || '_p' || to_char(d,'YYYYMM'), rel, d, d_end);
      EXECUTE format('ALTER TABLE operations.%I OWNER TO pt_owner', rel || '_p' || to_char(d,'YYYYMM'));
      d := d_end;
    END LOOP;
    EXECUTE format('CREATE TABLE operations.%I PARTITION OF operations.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE operations.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pipeline_run','pipeline_job_run','write_record','failure',
    'failure_resolution','api_usage','quality_check','quality_assertion_result',
    'operational_aggregate'] LOOP
    EXECUTE format('ALTER TABLE operations.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;
