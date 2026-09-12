-- =============================================================================
-- 035_governed_invalidation_quarantine.sql
-- PitchTerminal V2 — governed, NON-DESTRUCTIVE invalidation (Gate 87, Option B)
-- =============================================================================
-- Source of truth : Gate 87 invalidation-mechanism design (Option B, append-only
--                   quarantine relations); S-6 governance posture.
-- Depends on      : 008 (module.module_reading), 010 (snapshot.match_snapshot),
--                   015 (the two immutability guards reused below),
--                   016 (operations.fn_apply_access; the access posture),
--                   025 (governance schema + the assertion functions extended to it).
-- Transactional   : yes (close with the two conformance assertions, which raise).
--
-- WHAT THIS MIGRATION IS
--
--   The MECHANISM by which a specific, already-persisted module reading or match
--   snapshot can be marked as NOT FIT FOR PRODUCTION INTELLIGENCE, without ever
--   mutating or deleting the artifact itself. It is the schema half of the
--   Gate 87 remediation: three relations and the access posture that makes them
--   safe. It classifies NOTHING — it inserts no quarantine row — and it changes
--   no existing artifact row anywhere.
--
--   WHY QUARANTINE RELATIONS RATHER THAN A VALIDITY COLUMN
--     module.module_reading and snapshot.match_snapshot are APPEND-ONLY / SEALED:
--     no UPDATE path exists to either (015), and a snapshot is immutable by
--     construction (010). A mutable validity column would require the very UPDATE
--     path the architecture forbids. Invalidation is therefore expressed the way
--     every other correction in this platform is — as an APPEND-ONLY COMPANION
--     relation that adds a fact ALONGSIDE the artifact and modifies nothing within
--     it (the same discipline as snapshot_outcome_link / snapshot_outcome_link_
--     currency). The read paths honor it by anti-join; empty tables are a no-op.
--
--   WHY module_status INACTIVE IS NOT REUSED
--     INACTIVE means "the module had insufficient data to speak" (008,
--     ck_module_reading__inactive_is_silent). A reading that SPOKE but was
--     produced by a corrupt/test process is not silent; overloading INACTIVE would
--     destroy the LC-69 coverage-honesty distinction and would still require an
--     UPDATE to an append-only row. Invalidation is a governance classification
--     ABOUT a reading, orthogonal to what the reading says.
--
-- WHAT THIS MIGRATION IS NOT
--   It is NOT remediation. There is NO UPDATE or DELETE path to any artifact, NO
--   job that inserts Gate-87 quarantine rows, and NO reclassification of the 175
--   readings / 87 snapshots. Those are a later, separately-authorized owner action.
--
-- SAFETY
--   Additive. Creates one governance vocabulary and two append-only companion
--   relations, each under enable+FORCE row-level security with grants issued
--   through operations.fn_apply_access (policy before grant, PR-02). No role holds
--   UPDATE or DELETE on either quarantine relation; the snapshot companion adds no
--   UPDATE/DELETE privilege of any kind (R-69). Alters no existing relation, adds
--   no column to module_reading or match_snapshot, and touches no data row. The
--   two conformance assertions of 025 are re-run at the end so the migration fails
--   rather than leaving a posture gap.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- governance.invalidation_reason — the governed vocabulary of WHY
--
-- Lookup table per the migration 002 / 025 convention: code / display_name /
-- meaning / effective period / created_at. NOT an enum, NOT free text. Extension
-- is a later governed act by pt_platform_admin, exactly as for the other
-- governance vocabularies. Seeded with the two codes the Gate 87 remediation
-- needs; more may be added without a schema change.
-- -----------------------------------------------------------------------------

CREATE TABLE governance.invalidation_reason (
  code            text        NOT NULL,
  display_name    text        NOT NULL,
  meaning         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_invalidation_reason                 PRIMARY KEY (code),
  CONSTRAINT ck_invalidation_reason__period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from)
);
ALTER TABLE governance.invalidation_reason OWNER TO pt_owner;
COMMENT ON TABLE governance.invalidation_reason IS
  'Governed vocabulary of reasons a persisted artifact (a module reading or a match snapshot) may be quarantined from production intelligence. A quarantine is a GOVERNANCE CLASSIFICATION about the artifact, never a mutation of it. This is PT policy (governance), not provider reality and not telemetry.';
INSERT INTO governance.invalidation_reason (code, display_name, meaning) VALUES
  ('TEST_GENERATED', 'Test-generated',
   'The artifact was produced against production by a DB-gated test process rather than by the governed pipeline. It is structurally valid but was never a real production reading/snapshot, and must not inform product intelligence or calibration. (Gate 87.)'),
  ('PROVENANCE_CORRUPT', 'Provenance corrupt',
   'The artifact''s provenance cannot be trusted — its producing process, inputs, or timing are known to be wrong — so its content, however well-formed, must not be treated as a governed claim.');

-- -----------------------------------------------------------------------------
-- module.module_reading_quarantine — append-only companion to module_reading
--
-- One row = one governed classification of one reading under one reason. It sits
-- in the module schema alongside the artifact it annotates, so the module-schema
-- readers can honor it without a cross-schema USAGE grant.
--
-- FK BEHAVIOR (the crux). The reference to the reading is ON DELETE RESTRICT:
--   * it PRESERVES THE AUDIT ARTIFACT — a quarantine row is never cascade-deleted
--     when something happens to the reading; and
--   * it PREVENTS THE ROW OUTLIVING ITS TARGET — the reading cannot be deleted
--     (thinned) while a quarantine row references it, so the classification can
--     never point at nothing. A quarantined reading is thereby pinned against
--     retention, which is the correct posture for an artifact under governance.
-- The composite (module_reading_id, reading_as_of) mirrors module_evidence's
-- reference into the partitioned module_reading (id, as_of) exactly.
-- -----------------------------------------------------------------------------

CREATE TABLE module.module_reading_quarantine (
  id                  bigint      GENERATED ALWAYS AS IDENTITY,
  -- Target identity — the EXACT partitioned reading being classified.
  module_reading_id   bigint      NOT NULL,
  reading_as_of       timestamptz NOT NULL,
  -- Classification.
  reason_code         text        NOT NULL,
  incident_ref        text,
  quarantined_at      timestamptz NOT NULL DEFAULT now(),
  quarantined_by      text        NOT NULL,
  source              text        NOT NULL,
  notes               text,
  CONSTRAINT pk_module_reading_quarantine PRIMARY KEY (id),
  -- Prevents a DUPLICATE IDENTICAL classification: the same reading may not be
  -- quarantined twice under the same reason. A second, different reason for the
  -- same reading is allowed (an artifact can be both test-generated and later
  -- found provenance-corrupt); an exact restatement is rejected.
  CONSTRAINT uq_module_reading_quarantine__reading_reason
    UNIQUE (module_reading_id, reading_as_of, reason_code),
  CONSTRAINT fk_module_reading_quarantine__reading
    FOREIGN KEY (module_reading_id, reading_as_of)
    REFERENCES module.module_reading (id, as_of) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_module_reading_quarantine__reason
    FOREIGN KEY (reason_code)
    REFERENCES governance.invalidation_reason (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_module_reading_quarantine__attribution_present
    CHECK (length(btrim(quarantined_by)) > 0 AND length(btrim(source)) > 0)
);
ALTER TABLE module.module_reading_quarantine OWNER TO pt_owner;
COMMENT ON TABLE module.module_reading_quarantine IS
  'APPEND-ONLY governance companion to module.module_reading. A row classifies one reading as unfit for production intelligence (see governance.invalidation_reason); it adds a fact alongside the reading and MUTATES NOTHING within it. Production-intelligence readers exclude quarantined readings by anti-join; an empty table is a no-op. The reference to the reading is ON DELETE RESTRICT, so the classification can neither outlive its target nor be cascade-destroyed. Not a partitioned relation and not named in any retention policy — its absence there is its permanence.';
COMMENT ON COLUMN module.module_reading_quarantine.source IS
  'How the classification arose (e.g. the incident/audit identifier or the governed procedure), for audit. Free text, required.';

-- APPEND-ONLY at the trigger layer too (defense in depth beyond privilege
-- withholding). Reuses the platform''s shared append-only guard, already attached
-- to every module_reading-family relation in 015: UPDATE raises for every
-- principal; DELETE raises for every principal but the retention role under its
-- marker — and no DELETE privilege is granted here at all, so in practice the row
-- is immutable once written.
CREATE TRIGGER tr_module_reading_quarantine__append_guard
  BEFORE UPDATE OR DELETE ON module.module_reading_quarantine
  FOR EACH ROW EXECUTE FUNCTION feature.tf_append_only__guard();

-- -----------------------------------------------------------------------------
-- snapshot.match_snapshot_quarantine — append-only companion to match_snapshot
--
-- The snapshot-schema analogue. The snapshot schema is SEALED (010): no role
-- holds UPDATE or DELETE on any relation in it, and the migration-018 posture
-- assertion enforces that against the catalogue. This companion honors that
-- posture exactly — it is granted SELECT and INSERT only, never UPDATE or DELETE
-- — and is made immutable by the schema''s own sealing guard, so a quarantine
-- classification, once recorded, is as immutable as the snapshot it annotates.
--
-- FK BEHAVIOR: identical rationale to the module companion. ON DELETE RESTRICT
-- against match_snapshot (id, fixture_partition_on) preserves the audit artifact
-- and stops the row outliving its target. (No snapshot is deletable in normal
-- operation regardless; the RESTRICT states the intent and holds under the one
-- extraordinary administrative removal path.)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.match_snapshot_quarantine (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  -- Target identity — the EXACT partitioned snapshot being classified.
  match_snapshot_id     bigint      NOT NULL,
  fixture_partition_on  date        NOT NULL,
  -- Classification.
  reason_code           text        NOT NULL,
  incident_ref          text,
  quarantined_at        timestamptz NOT NULL DEFAULT now(),
  quarantined_by        text        NOT NULL,
  source                text        NOT NULL,
  notes                 text,
  CONSTRAINT pk_match_snapshot_quarantine PRIMARY KEY (id),
  CONSTRAINT uq_match_snapshot_quarantine__snapshot_reason
    UNIQUE (match_snapshot_id, fixture_partition_on, reason_code),
  CONSTRAINT fk_match_snapshot_quarantine__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_match_snapshot_quarantine__reason
    FOREIGN KEY (reason_code)
    REFERENCES governance.invalidation_reason (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_match_snapshot_quarantine__attribution_present
    CHECK (length(btrim(quarantined_by)) > 0 AND length(btrim(source)) > 0)
);
ALTER TABLE snapshot.match_snapshot_quarantine OWNER TO pt_owner;
COMMENT ON TABLE snapshot.match_snapshot_quarantine IS
  'APPEND-ONLY governance companion to snapshot.match_snapshot. A row classifies one sealed snapshot as unfit for downstream intelligence/calibration (see governance.invalidation_reason); it adds a fact alongside the snapshot and MUTATES NOTHING within it — consistent with the sealed-schema posture, which grants this relation SELECT and INSERT only and makes it immutable through the schema sealing guard. Calibration accrual excludes quarantined snapshots by anti-join; an empty table is a no-op. ON DELETE RESTRICT against the snapshot preserves the audit artifact and stops the classification outliving its target. Not partitioned and not named in any retention policy — its absence there is its permanence.';

-- Immutable through the SAME sealing guard the sealed family uses (015): UPDATE
-- and DELETE raise for EVERY principal, no exception. Reused deliberately so this
-- companion is exactly as immutable as the snapshot it annotates. INSERT is
-- unaffected (the guard fires only BEFORE UPDATE OR DELETE).
CREATE TRIGGER tr_match_snapshot_quarantine__seal_guard
  BEFORE UPDATE OR DELETE ON snapshot.match_snapshot_quarantine
  FOR EACH ROW EXECUTE FUNCTION snapshot.tf_sealed__guard();

-- =============================================================================
-- ROW-LEVEL SECURITY — enable + FORCE on the three new relations, exactly as
-- every design relation carries it (PD-18, F-09). Done explicitly because these
-- relations are created after the 016 sweep, precisely as 025 did for governance.
-- =============================================================================

ALTER TABLE governance.invalidation_reason         ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance.invalidation_reason         FORCE  ROW LEVEL SECURITY;
ALTER TABLE module.module_reading_quarantine       ENABLE ROW LEVEL SECURITY;
ALTER TABLE module.module_reading_quarantine       FORCE  ROW LEVEL SECURITY;
ALTER TABLE snapshot.match_snapshot_quarantine     ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot.match_snapshot_quarantine     FORCE  ROW LEVEL SECURITY;

-- =============================================================================
-- GRANTS + POLICIES — one specification, applied through operations.fn_apply_access
-- so every privilege is issued with its covering policy (PR-02, B-03).
-- =============================================================================

-- governance.invalidation_reason — administration maintains the vocabulary; no
-- other role needs it (the quarantine relations carry reason_code directly, and
-- the read-path anti-joins never join the vocabulary). No DELETE (governance
-- change is a status transition, never destruction — Doc 95 / 025 posture).
SELECT operations.fn_apply_access('governance','invalidation_reason','pt_platform_admin','SIU');

-- module.module_reading_quarantine — pt_platform_admin is the governed classifier
-- (SELECT + INSERT; no UPDATE/DELETE — append-only). Every role that reads module
-- readings gets SELECT so its anti-join can see the quarantine set: the API path
-- runs as pt_platform_admin, snapshot sealing selection as pt_pipeline_module,
-- and the remaining module-SELECT holders are granted it for uniformity.
SELECT operations.fn_apply_access('module','module_reading_quarantine','pt_platform_admin',     'SI');
SELECT operations.fn_apply_access('module','module_reading_quarantine','pt_pipeline_module',     'S');
SELECT operations.fn_apply_access('module','module_reading_quarantine','pt_pipeline_calibration','S');
SELECT operations.fn_apply_access('module','module_reading_quarantine','pt_pipeline_projection', 'S');
SELECT operations.fn_apply_access('module','module_reading_quarantine','pt_retention',           'S');

-- snapshot.match_snapshot_quarantine — SEALED posture: SELECT and INSERT only, no
-- role holds UPDATE or DELETE (R-69). pt_platform_admin is the governed classifier
-- (SI); calibration accrual reads it (pt_pipeline_calibration), and the other
-- snapshot-SELECT holders get SELECT for uniformity.
SELECT operations.fn_apply_access('snapshot','match_snapshot_quarantine','pt_platform_admin',     'SI');
SELECT operations.fn_apply_access('snapshot','match_snapshot_quarantine','pt_pipeline_calibration','S');
SELECT operations.fn_apply_access('snapshot','match_snapshot_quarantine','pt_pipeline_module',     'S');
SELECT operations.fn_apply_access('snapshot','match_snapshot_quarantine','pt_pipeline_projection', 'S');

-- Sequences backing the two IDENTITY columns. GENERATED ALWAYS AS IDENTITY needs
-- no separate USAGE for the owning table''s inserts, but the platform grants it
-- explicitly (016); matched here for the classifier role so the convention holds.
GRANT USAGE ON SEQUENCE module.module_reading_quarantine_id_seq   TO pt_platform_admin;
GRANT USAGE ON SEQUENCE snapshot.match_snapshot_quarantine_id_seq TO pt_platform_admin;

-- =============================================================================
-- CONFORMANCE ASSERTIONS — re-run the two BLOCKING posture checks (as extended to
-- the governance schema in 025) so this migration fails rather than leaving a gap:
--   * every non-owner DML privilege on a design relation has a covering policy;
--   * RLS enabled+forced everywhere; snapshot holds NO non-owner UPDATE/DELETE and
--     NO default privileges; module/feature DELETE only by pt_retention; no role
--     but the owner holds DELETE on any governance relation.
-- =============================================================================

SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();

-- =============================================================================
-- ASSERTED POSTURE
--   * governance.invalidation_reason created + seeded (TEST_GENERATED,
--     PROVENANCE_CORRUPT); admin SIU, no DELETE
--   * module.module_reading_quarantine + snapshot.match_snapshot_quarantine created,
--     append-only, RLS enabled+forced
--   * no role holds UPDATE or DELETE on either quarantine relation
--   * snapshot companion holds SELECT/INSERT only; no default privileges added
--   * both companions ON DELETE RESTRICT against their artifact (preserve + pin)
--   * uniqueness prevents duplicate identical classification
--   * both companions immutable at the trigger layer (append/seal guards reused)
-- NOT IN THIS MIGRATION: any UPDATE/DELETE to an artifact, any Gate-87 quarantine
--   INSERT, any reclassification of the 175 readings / 87 snapshots, and any
--   remediation job. The mechanism only; classification is a later owner action.
-- =============================================================================
