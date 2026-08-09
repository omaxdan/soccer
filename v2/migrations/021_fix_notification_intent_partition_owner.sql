-- =============================================================================
-- 021_fix_notification_intent_partition_owner.sql — one default partition,
--   owned by the wrong role
-- REVISION 1
-- Source: Doc 08 Rev 1 §5.17.5 (ownership), F-09 second limb (partition access)
-- Depends: 001-020  |  Transactional
--
-- WHY THIS MIGRATION EXISTS
--
-- `product.notification_intent_pdefault` is owned by the role that ran the
-- migrations rather than by `pt_owner`. It is the ONLY relation in the seven
-- design schemas that is, including the sixty monthly partitions of its own
-- parent.
--
-- ROOT CAUSE — 011_product.sql:196. The monthly partitions are created in a loop
-- that assigns ownership on the next line (011:191). The DEFAULT partition is
-- created OUTSIDE that loop, and the ownership assignment was not repeated for
-- it. Seven default-partition creations exist across the migration set; six pair
-- `CREATE TABLE … PARTITION OF … DEFAULT` with `ALTER TABLE … OWNER TO pt_owner`
-- on the very next line. 011:196 is the single deviation.
--
-- WHY IT MATTERS
--
-- Ownership confers ALTER and DROP. §5.17.5 places ownership on a NOLOGIN role
-- precisely so that no principal able to authenticate can alter or drop a V2
-- object, and F-09's second limb withholds direct privileges on partitions from
-- every role other than the owner — a rule this partition satisfies only because
-- its owner is wrong, leaving a login-capable role holding all seven privileges
-- on it and able to read and write it directly, outside the parent's policies.
--
-- WHAT THIS IS NOT
--
-- Not an active breach. No `pt_pipeline_*` role holds any privilege on the
-- partition, and no application process authenticates as the migration role.
-- This restores a structural guarantee; it does not close an open door.
--
-- WHY 021 AND NOT A CORRECTION TO 011
--
-- 011 is applied. Editing an applied migration makes the file disagree with the
-- deployed database, and the set has no migration-history table that would
-- record the divergence. Forward-only correction is the only option that keeps
-- file history and database state in agreement.
--
-- SCOPE — OWNERSHIP ONLY. No privilege is granted or revoked, no policy is
-- created, altered or dropped, no RLS state is changed, no role is altered. The
-- two closing gates prove that: both are the assertions the architecture already
-- uses to detect a privilege without its policy and a weakened posture, and both
-- must still return without raising.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The correction
-- -----------------------------------------------------------------------------
-- ONE STATEMENT IS SUFFICIENT. Index ownership follows the table in PostgreSQL,
-- so `notification_intent_pdefault_pkey` and
-- `notification_intent_pdefault_user_id_occurred_at_idx` are corrected by this
-- statement alone. Verified by execution against a reference database rather
-- than assumed.
--
-- IDEMPOTENT. `ALTER TABLE … OWNER TO` against a relation already owned by the
-- target role is accepted and changes nothing, so re-running this migration is
-- safe. It takes ACCESS EXCLUSIVE on this partition only — not the parent, not
-- the sibling partitions — and the relation is empty.

ALTER TABLE product.notification_intent_pdefault OWNER TO pt_owner;

-- -----------------------------------------------------------------------------
-- Ownership conformance
-- -----------------------------------------------------------------------------
-- Raises rather than reports, in the pattern of 016 and 018: a deployment that
-- does not satisfy the invariant does not complete, and because the file is
-- transactional no partial state is left behind.
--
-- Scoped to tables and partitioned tables. Indexes, sequences and views follow
-- their parent object and are not independently assertable.

DO $chk$
DECLARE offenders text;
BEGIN
  SELECT string_agg(format('%s.%s (owner %s)',
                           n.nspname, c.relname, pg_get_userbyid(c.relowner)), ', '
                    ORDER BY n.nspname, c.relname)
    INTO offenders
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('football','feature','module','snapshot',
                      'calibration','product','operations')
    AND c.relkind IN ('r','p')
    AND pg_get_userbyid(c.relowner) <> 'pt_owner';

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'ownership conformance failed: governed relations not owned by pt_owner: %',
      offenders;
  END IF;
END
$chk$;

-- =============================================================================
-- CLOSING CONFORMANCE GATES
-- =============================================================================
-- Unchanged from 016/018. This migration grants nothing and drops no policy, so
-- both must return zero exactly as they did before it ran. A non-zero result
-- here would mean the ownership change had a side effect it must not have.

SELECT operations.fn_assert_access_correspondence();
SELECT operations.fn_assert_security_posture();
