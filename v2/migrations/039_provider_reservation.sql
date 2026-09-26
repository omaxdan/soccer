-- ─────────────────────────────────────────────────────────────────────────────
-- 039_provider_reservation.sql
--
-- Durable provider-quota reservations for the GOVERNED BOOTSTRAP (and any future
-- reservation-admitted enrichment). Backs src/v2/ingestion/enrichment/reservationStore.ts
-- (admitAndReserve / reconcileReservation / expire / release). Reservations survive
-- process restart and, under the transaction-scoped advisory lock the store takes on
-- (provider_code, quota_day), two concurrent jobs cannot both consume the same remaining
-- quota. Actual spend remains operations.api_usage; a reservation is only a pre-spend claim.
--
-- MUTABLE LEASE TABLE — DELIBERATELY NOT APPEND-ONLY. Unlike the operational telemetry
-- relations (pipeline_run, api_usage, *_completion, failure_resolution), a reservation's
-- status legitimately transitions (ACTIVE → EXPIRED / RELEASED / RECONCILED) via UPDATE.
-- It is therefore NOT attached to feature.tf_append_only__guard, and it is granted UPDATE.
-- fn_apply_access pairs every grant with its matching policy (F-09 / PR-02), so
-- fn_assert_access_correspondence() still holds for the UPDATE privilege. This is a
-- recorded design decision, not an oversight: a lease is a claim you revise, not a fact
-- you append.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE operations.provider_reservation (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  job_id           text        NOT NULL,
  provider_code    text        NOT NULL,
  quota_day        date        NOT NULL,
  estimated_calls  integer     NOT NULL,
  status           text        NOT NULL DEFAULT 'ACTIVE',
  actual_attempts  integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  released_at      timestamptz,
  reconciled_at    timestamptz,
  CONSTRAINT pk_provider_reservation PRIMARY KEY (id),
  -- Idempotency key: admitAndReserve's INSERT ... ON CONFLICT (job_id) DO NOTHING.
  CONSTRAINT uq_provider_reservation__job_id UNIQUE (job_id),
  CONSTRAINT ck_provider_reservation__status
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'RELEASED', 'RECONCILED')),
  CONSTRAINT ck_provider_reservation__calls_non_negative
    CHECK (estimated_calls >= 0 AND (actual_attempts IS NULL OR actual_attempts >= 0)),
  CONSTRAINT ck_provider_reservation__expiry_after_creation
    CHECK (expires_at > created_at)
);
ALTER TABLE operations.provider_reservation OWNER TO pt_owner;

-- Serves ACTIVE_COMMITTED_SQL: SUM(estimated_calls) WHERE provider_code + quota_day +
-- status='ACTIVE' + expires_at > asOf.
CREATE INDEX ix_provider_reservation__active_window
  ON operations.provider_reservation (provider_code, quota_day, status, expires_at);

COMMENT ON TABLE operations.provider_reservation IS
  'Durable pre-spend claims on provider daily quota, for the governed bootstrap. UNIQUE(job_id) is the idempotency key; the prevailing state is the row''s current status. A MUTABLE LEASE (status transitions by UPDATE) — deliberately NOT append-only telemetry and NOT attached to the append-only guard, hence the UPDATE grant. Actual spend is operations.api_usage; a reservation is reconciled to actual attempts (a 429 counts as consumed). Concurrency-safe via a transaction-scoped advisory lock on (provider_code, quota_day).';

-- Security posture: RLS enabled + forced, then grants issued ONLY through fn_apply_access
-- so every grant carries its matching policy (a grant without a policy on a FORCE RLS
-- relation fails silently — the B-03/B-09/B-11 defect class).
ALTER TABLE operations.provider_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations.provider_reservation FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE operations.provider_reservation FROM PUBLIC;

-- The ingestion role admits, expires, releases and reconciles reservations → SELECT +
-- INSERT + UPDATE. No DELETE to any role (a reservation is closed by status, never removed).
SELECT operations.fn_apply_access('operations', 'provider_reservation', 'pt_pipeline_ingestion', 'SIU');
-- The administrative role reads reservation state and does not write it.
SELECT operations.fn_apply_access('operations', 'provider_reservation', 'pt_platform_admin', 'S');
