-- =============================================================================
-- 036_snapshot_team_preparedness.sql
-- PitchTerminal V2 — sealed Team Preparedness (B3 verdict-composition contribution)
-- =============================================================================
-- Source of truth : Team Preparedness B3 ratified contract — a per-SIDE absolute
--                   preparedness score composed AT SNAPSHOT SEAL from governed
--                   Layer-2 feature values, sealed through snapshot_feature_state,
--                   governed by verdict_composition_version 1.3.0 (migration 037).
-- Depends on      : 010 (snapshot.match_snapshot + the co-partitioned sealed family),
--                   015 (snapshot.tf_sealed__guard, reused below),
--                   016 (operations.fn_apply_access; the sealed access posture).
-- Transactional   : yes (closes with the two conformance assertions, which raise).
--
-- WHAT THIS MIGRATION IS
--   One new SEALED, co-partitioned child of snapshot.match_snapshot:
--   snapshot.snapshot_team_preparedness. Two rows per sealed snapshot (HOME, AWAY),
--   each an absolute preparedness score over the governed 60-point subset plus its
--   coverage. It is a SIBLING of snapshot_verdict (a child of the root), NOT a
--   home-vs-away differential and NOT a module reading — Team Preparedness lives
--   only in the seal/verdict-composition layer.
--
--   Evidence/lineage is the EXISTING snapshot_feature_state: the exact feature
--   values scored are sealed there by the seal driver (deduplicated against values
--   already cited by module readings), and their feature versions enter the version
--   manifest. This relation therefore carries NO citation columns and needs no
--   as-of / contamination column of its own — temporal integrity is inherited
--   through snapshot_feature_state's own `cited_as_of <= snapshot_as_of` check.
--
-- SEALED SCHEMA POSTURE (PD-01, R-23), matched exactly
--   INSERT-ONLY. No role holds UPDATE or DELETE. Immutability is enforced by the
--   SAME sealing guard the family uses (snapshot.tf_sealed__guard, 015), attached
--   explicitly here because the 015 guard loop and the 016 RLS/grant sweep were
--   enumerated at migration time and do not discover a relation added later
--   (precisely as migration 035 attached its own guard + RLS + grants).
--
-- SAFETY
--   Additive. Creates one relation (+ its monthly partitions) and its access
--   posture. Alters no existing relation, adds no column to any existing table,
--   registers no version row (that is migration 037), and touches no data row. The
--   two conformance assertions are re-run so the migration fails rather than
--   leaving a posture gap. `declared_points` is a stored column (never a hardcoded
--   60) so a future 100-point contract leaves these rows immutably at their own total.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- snapshot.snapshot_team_preparedness   (E4.x — per-side sealed preparedness)
-- -----------------------------------------------------------------------------

CREATE TABLE snapshot.snapshot_team_preparedness (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  match_snapshot_id     bigint      NOT NULL,
  side                  text        NOT NULL,
  -- Achieved score over PRESENT components, in [0, available_points]. NULL when no
  -- component was present (LC-97: absence is absence, never a fabricated zero).
  preparedness_points   numeric,
  -- Sum of the weights whose input was present (the reachable maximum this seal).
  available_points      numeric     NOT NULL,
  -- The governed subset total for the governing version (60 at 1.3.0). Stored, not
  -- constant, so a later 100-point contract does not retro-alter these rows.
  declared_points       numeric     NOT NULL,
  -- available_points / declared_points, in [0,1].
  coverage_ratio        numeric     NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_snapshot_team_preparedness PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_snapshot_team_preparedness__snapshot_side
    UNIQUE (fixture_partition_on, match_snapshot_id, side),
  CONSTRAINT fk_snapshot_team_preparedness__snapshot
    FOREIGN KEY (match_snapshot_id, fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_snapshot_team_preparedness__side_known
    CHECK (side IN ('HOME','AWAY')),
  CONSTRAINT ck_snapshot_team_preparedness__coverage_bounded
    CHECK (coverage_ratio BETWEEN 0 AND 1),
  CONSTRAINT ck_snapshot_team_preparedness__available_within_declared
    CHECK (available_points >= 0 AND available_points <= declared_points),
  CONSTRAINT ck_snapshot_team_preparedness__points_within_available
    CHECK (preparedness_points IS NULL
           OR (preparedness_points >= 0 AND preparedness_points <= available_points))
) PARTITION BY RANGE (fixture_partition_on);

COMMENT ON TABLE snapshot.snapshot_team_preparedness IS
  'Sealed Team Preparedness — a per-SIDE ABSOLUTE preparedness score over the governed 60-point subset (Form 30 / Congestion 15 / Home-Venue 10 / Squad Stability 5), composed at seal from governed Layer-2 feature values and sealed through snapshot_feature_state. Two rows per snapshot (HOME, AWAY). NOT a home-vs-away differential (that is the verdict edges) and NOT a module reading. A SIBLING of snapshot_verdict: a child of match_snapshot, governed by the snapshot''s verdict_composition_version (>= 1.3.0). Absence of a component reduces available_points and is never scored as zero; all four absent leaves preparedness_points NULL. The deferred 40 points (Travel/Opponent/Motivation) are not implemented and never redistributed.';
COMMENT ON COLUMN snapshot.snapshot_team_preparedness.declared_points IS
  'The governed subset total for the governing composition version (60 under 1.3.0). Stored per row, never a hardcoded constant, so a later contract that adds the deferred 40 (declared 100) leaves existing sealed rows immutably at their own total.';
COMMENT ON COLUMN snapshot.snapshot_team_preparedness.preparedness_points IS
  'Achieved score over PRESENT components only, in [0, available_points]. There is NO renormalisation over the present weight (that is team_readiness''s rule, not this one): a missing component lowers the reachable maximum, it does not inflate the survivors. NULL only when no component was present.';

-- Immutable through the SAME sealing guard the sealed family uses (015): UPDATE and
-- DELETE raise for EVERY principal, no exception. Attached explicitly because the
-- 015 guard loop was a fixed array enumerated at migration time and does not cover
-- a relation created later (the migration-035 precedent). INSERT is unaffected.
CREATE TRIGGER tr_snapshot_team_preparedness__seal_guard
  BEFORE UPDATE OR DELETE ON snapshot.snapshot_team_preparedness
  FOR EACH ROW EXECUTE FUNCTION snapshot.tf_sealed__guard();

-- -----------------------------------------------------------------------------
-- Monthly partitions, co-partitioned with the rest of the sealed family on
-- fixture_partition_on with IDENTICAL boundaries (010): partition-wise assembly of
-- the match-intelligence read path depends on it. Owner pt_owner, as the family.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  d     date := date '2024-01-01';
  d_end date;
BEGIN
  WHILE d < date '2029-01-01' LOOP
    d_end := (d + interval '1 month')::date;
    EXECUTE format(
      'CREATE TABLE snapshot.%I PARTITION OF snapshot.snapshot_team_preparedness FOR VALUES FROM (%L) TO (%L)',
      'snapshot_team_preparedness_p' || to_char(d, 'YYYYMM'), d, d_end);
    EXECUTE format('ALTER TABLE snapshot.%I OWNER TO pt_owner',
      'snapshot_team_preparedness_p' || to_char(d, 'YYYYMM'));
    d := d_end;
  END LOOP;
  EXECUTE 'CREATE TABLE snapshot.snapshot_team_preparedness_pdefault PARTITION OF snapshot.snapshot_team_preparedness DEFAULT';
  EXECUTE 'ALTER TABLE snapshot.snapshot_team_preparedness_pdefault OWNER TO pt_owner';
END
$$;

ALTER TABLE snapshot.snapshot_team_preparedness OWNER TO pt_owner;

-- =============================================================================
-- ROW-LEVEL SECURITY — enable + FORCE on the new parent, exactly as every design
-- relation carries it (PD-18, F-09). Done explicitly because this relation is
-- created after the 016 sweep, precisely as 035 did for its new relations.
-- =============================================================================

ALTER TABLE snapshot.snapshot_team_preparedness ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot.snapshot_team_preparedness FORCE  ROW LEVEL SECURITY;

-- =============================================================================
-- GRANTS + POLICIES — through operations.fn_apply_access (policy before grant,
-- PR-02), matching the sealed-family posture exactly (016): the sealing pipeline
-- role writes it (SELECT + INSERT); the read/API and the other snapshot-SELECT
-- holders read it; NO role holds UPDATE or DELETE (R-69, sealed).
-- =============================================================================

SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_module',     'SI');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_platform_admin',      'S');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_calibration','S');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_projection', 'S');

-- Sequence backing the IDENTITY column. GENERATED ALWAYS AS IDENTITY needs no
-- separate USAGE for the owning table's inserts, but the platform grants it
-- explicitly (016); matched here for the sealing (inserting) role.
GRANT USAGE ON SEQUENCE snapshot.snapshot_team_preparedness_id_seq TO pt_pipeline_module;

-- =============================================================================
-- CONFORMANCE ASSERTIONS — re-run the two BLOCKING posture checks so this
-- migration fails rather than leaving a gap:
--   * every non-owner DML privilege on a design relation has a covering policy;
--   * RLS enabled+forced everywhere; snapshot holds NO non-owner UPDATE/DELETE and
--     NO default privileges.
-- =============================================================================

SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();

-- =============================================================================
-- ASSERTED POSTURE
--   * snapshot.snapshot_team_preparedness created, co-partitioned monthly on
--     fixture_partition_on with the family's boundaries, owner pt_owner
--   * SEALED: INSERT-only; immutable via snapshot.tf_sealed__guard (reused)
--   * FK to match_snapshot(id, fixture_partition_on) ON DELETE CASCADE
--   * no citation/as-of columns — lineage is snapshot_feature_state
--   * RLS enabled+forced; SI to pt_pipeline_module, S to read/calibration/projection;
--     NO role holds UPDATE or DELETE
--   * declared_points stored (not constant) — 100-point-contract ready
-- NOT IN THIS MIGRATION: the 1.3.0 version row (migration 037), any seal-time
--   computation (application layer), any data row, and any change to an existing
--   relation, sealed snapshot, module reading, or Layer-2 feature.
-- =============================================================================
