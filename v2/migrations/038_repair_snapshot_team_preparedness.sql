-- =============================================================================
-- 038_repair_snapshot_team_preparedness.sql
-- PitchTerminal V2 — forward-only completion of the PARTIAL migration 036
-- =============================================================================
-- Source of truth : the 036 contract (snapshot.snapshot_team_preparedness) and the
--                   partial-application evidence — table + triggers + PK/UNIQUE
--                   committed by an earlier non-transactional 036 run, but owner
--                   left as postgres, 0 partitions, FORCE RLS off, and no
--                   fn_apply_access grants/policies. This completes the missing
--                   ownership / partition / RLS-force / access phase. It creates no
--                   new table and alters no existing column, constraint, trigger or
--                   guard. (Precedent: migration 021, a forward-only partition-owner fix.)
-- Depends on      : 010 (snapshot family), 015 (tf_sealed__guard), 016 (fn_apply_access
--                   + fn_assert_access_correspondence), 018/025 (fn_assert_security_posture),
--                   036 (the partially-applied relation this repairs).
-- Transactional   : YES — self-wrapped in BEGIN/COMMIT (020 precedent). 036's partial
--                   commit proved operator-side wrapping was not applied; this file
--                   guarantees atomicity itself. Every statement is idempotent, so a
--                   re-run against the now-repaired production state is a clean no-op
--                   (no 42P07, no destructive action). MUST be applied BEFORE migration 037.
--
-- SCOPE — TEAM PREPAREDNESS ONLY. This migration completes and verifies exactly one
--   relation family: snapshot.snapshot_team_preparedness and its partitions. Its
--   closing ownership check is SCOPED to that family. It deliberately does NOT run a
--   global ownership-conformance sweep over all eight design schemas: an earlier
--   draft of this repair copied migration 021's global sweep, which RAISED on six
--   pre-existing postgres-owned governance tables (competition_scope, competition_type,
--   edition_status, tracked_competition, tracked_edition, tracking_status) created
--   without an OWNER assignment in migration 025. That governance-ownership drift is
--   a SEPARATE, independently-authorized concern (a 021-style reconciliation) and is
--   NOT in this migration's remit. Conflating it here blocked the Team Preparedness
--   repair for an unrelated reason. The two standing gates below already enforce the
--   platform-wide access and RLS posture; ownership is asserted only for this family.
--
-- WHY 038 AND NOT AN EDIT TO 036 (021 rationale)
--   036 is already (partially) applied and there is no migration-history table.
--   Editing an applied migration makes the file disagree with the deployed database
--   with no record of the divergence. Forward-only correction keeps file history and
--   database state in agreement.
--
-- SAFETY
--   Additive + ownership + posture only. No DROP, no TRUNCATE, no table/constraint/
--   trigger recreation, no data touched, no change to any other schema's objects.
--   Closes with a family-scoped ownership assertion and the two standing conformance
--   assertions, all of which RAISE — so a non-conformant result rolls the whole
--   transaction back and leaves no new partial state.
-- =============================================================================

BEGIN;

-- 1) The 61 partitions 036 never created — exact 010 family scheme (monthly
--    [2024-01-01, 2029-01-01) + default), each owned pt_owner. IF NOT EXISTS makes
--    the step idempotent: with the 61 partitions already present it is a clean no-op
--    (no 42P07); the ALTER OWNER is likewise a no-op when already pt_owner.
DO $$
DECLARE d date := date '2024-01-01'; d_end date; part text;
BEGIN
  WHILE d < date '2029-01-01' LOOP
    d_end := (d + interval '1 month')::date;
    part := 'snapshot_team_preparedness_p' || to_char(d, 'YYYYMM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS snapshot.%I PARTITION OF snapshot.snapshot_team_preparedness FOR VALUES FROM (%L) TO (%L)',
      part, d, d_end);
    EXECUTE format('ALTER TABLE snapshot.%I OWNER TO pt_owner', part);
    d := d_end;
  END LOOP;
  EXECUTE 'CREATE TABLE IF NOT EXISTS snapshot.snapshot_team_preparedness_pdefault PARTITION OF snapshot.snapshot_team_preparedness DEFAULT';
  EXECUTE 'ALTER TABLE snapshot.snapshot_team_preparedness_pdefault OWNER TO pt_owner';
END
$$;

-- 2) Parent ownership → pt_owner (idempotent; no-op if already pt_owner). Align the
--    identity sequence owner too, guarded for portability.
ALTER TABLE snapshot.snapshot_team_preparedness OWNER TO pt_owner;
DO $$
BEGIN
  IF pg_get_userbyid((SELECT relowner FROM pg_class
                        WHERE oid = 'snapshot.snapshot_team_preparedness_id_seq'::regclass)) <> 'pt_owner' THEN
    EXECUTE 'ALTER SEQUENCE snapshot.snapshot_team_preparedness_id_seq OWNER TO pt_owner';
  END IF;
END
$$;

-- 3) RLS: ENABLE + FORCE (both idempotent; already true in the repaired state).
ALTER TABLE snapshot.snapshot_team_preparedness ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot.snapshot_team_preparedness FORCE  ROW LEVEL SECURITY;

-- 4) Access posture via the established mechanism (idempotent: fn_apply_access does
--    DROP POLICY IF EXISTS → CREATE POLICY → GRANT). Sealed posture: SELECT+INSERT
--    for the sealing role; SELECT for read/API, calibration, projection; NO U/D.
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_module',     'SI');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_platform_admin',      'S');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_calibration','S');
SELECT operations.fn_apply_access('snapshot','snapshot_team_preparedness','pt_pipeline_projection', 'S');

-- 5) Sequence USAGE for the sealing (inserting) role (036's missing line; idempotent).
GRANT USAGE ON SEQUENCE snapshot.snapshot_team_preparedness_id_seq TO pt_pipeline_module;

-- 6) TEAM-PREPAREDNESS-SCOPED ownership assertion (replaces the removed global sweep).
--    Verifies ONLY this relation family: the parent and every child partition are
--    owned by pt_owner, and the partition set is exactly the expected 61 (60 monthly
--    + default) so a missing or extra partition is caught. It references no other
--    schema, so it CANNOT fail because of the six pre-existing postgres-owned
--    governance tables. Raises → the transaction rolls back.
DO $tp_owner$
DECLARE
  v_parent_owner text;
  v_bad_children integer;
  v_child_count  integer;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_parent_owner
    FROM pg_class WHERE oid = 'snapshot.snapshot_team_preparedness'::regclass;
  IF v_parent_owner IS DISTINCT FROM 'pt_owner' THEN
    RAISE EXCEPTION 'team preparedness ownership: parent snapshot.snapshot_team_preparedness owned by % (expected pt_owner)', v_parent_owner;
  END IF;

  SELECT count(*) FILTER (WHERE pg_get_userbyid(c.relowner) <> 'pt_owner'),
         count(*)
    INTO v_bad_children, v_child_count
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'snapshot.snapshot_team_preparedness'::regclass;

  IF v_bad_children > 0 THEN
    RAISE EXCEPTION 'team preparedness ownership: % child partition(s) not owned by pt_owner', v_bad_children;
  END IF;
  IF v_child_count <> 61 THEN
    RAISE EXCEPTION 'team preparedness partition set incomplete: % partitions (expected 61 = 60 monthly + default)', v_child_count;
  END IF;
END
$tp_owner$;

-- 7) The two STANDING platform gates, unchanged. Neither checks ownership; both
--    already return 0 for the repaired Team Preparedness relation. They enforce the
--    platform-wide access-correspondence and RLS posture, and are the same assertions
--    migrations 016/017/018/021/025/035 close with.
SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();

COMMIT;

-- =============================================================================
-- ASSERTED POSTURE (Team Preparedness only)
--   * snapshot.snapshot_team_preparedness owned by pt_owner; 61 partitions, all pt_owner
--   * RLS enabled + forced; SI to pt_pipeline_module, S to read/calibration/projection;
--     no role holds UPDATE or DELETE; sequence USAGE to pt_pipeline_module
--   * fn_assert_access_correspondence() = 0 and fn_assert_security_posture() = 0
-- EXPLICITLY OUT OF SCOPE (do NOT let it block this migration):
--   * the six migration-025 governance tables owned by postgres — a separate,
--     separately-authorized 021-style ownership reconciliation, not handled here.
-- =============================================================================
