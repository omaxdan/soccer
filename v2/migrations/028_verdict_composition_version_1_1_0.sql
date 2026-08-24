-- =============================================================================
-- 028_verdict_composition_version_1_1_0.sql
-- PitchTerminal V2 — register verdict_composition_version 1.1.0 (S-8 rest edge)
-- =============================================================================
-- Source of truth : the S-8 governance decisions A/B/C —
--                   A: rest_edge = home.rest_advantage - away.rest_advantage,
--                      home-relative sign (positive = home has more rest);
--                   B: both underlying values present ⇒ calculate (even below
--                      threshold; zero is a real value); a missing side ⇒ NULL;
--                   C: the successor composition version is 1.1.0.
-- Depends on      : 003 (verdict_composition_version), and the seeded 1.0.0 row
--                   (seed/moduleRegistry.ts COMPOSITION_VERSIONS).
-- Transactional   : yes
--
-- Purpose
--   S-8 introduces the first governed COMPARATIVE edge, rest_edge, computed by the
--   verdict composition (snapshot/verdict.ts computeRestEdge + seal.ts) from the
--   sealed FIXTURE rest_advantage reading and its two sealed underlying
--   team.rest_advantage values. That is a NEW composition rule, so it needs a new
--   verdict_composition_version. The seeded 1.0.0 is identity-only and
--   non-directional (all edges NULL); 1.1.0 supersedes it, adding rest_edge and
--   nothing else.
--
-- Succession model (the governed one, from seed/helpers.ts openEffectivePeriod)
--   "A version's period opens at the moment the registry first records it and has
--   no close: the successor's arrival is what closes it." So this migration closes
--   the open 1.0.0 period at now() and opens 1.1.0 at the same instant, with
--   predecessor_id = 1.0.0. The EXCLUDE (effective_period WITH &&) forbids overlap;
--   contiguous [lower_1.0.0, cut) then [cut, ) satisfies it with no gap.
--   Snapshots resolve their composition version by as_of (snapshot/read/selection
--   tryResolveVersionInForce, effective_period @> as_of), so snapshots sealed
--   before `cut` still resolve to 1.0.0 (rest_edge stays NULL) and are untouched;
--   snapshots sealed at/after `cut` resolve to 1.1.0 and carry rest_edge.
--
-- Why a migration (not the seed)
--   Closing 1.0.0's period is an UPDATE on module.verdict_composition_version,
--   held by pt_owner, not the pipeline/seed role — the same reason 024/027 are
--   migrations. Runs post-seed (it depends on the seeded 1.0.0 row), mirroring the
--   024/027 precedent. Idempotent: re-running is a no-op once 1.1.0 exists.
--
-- Safety
--   Data-only. No schema object is created or altered. Wrapped in a guard so a
--   second run does nothing; asserts exactly one open 1.0.0 row before it acts and
--   raises otherwise. Existing sealed 1.0.0 snapshots reference their version by id
--   and are not mutated. The 1.1.0 rationale is BYTE-IDENTICAL to the note in
--   seed/moduleRegistry.ts (COMPOSITION_VERSIONS), so a fresh seed + this migration
--   and an upgraded database converge on the same value.
-- =============================================================================

DO $$
DECLARE
  v_1_0_0     bigint;
  lower_1_0_0 timestamptz;
  cut         timestamptz := now();
  n           integer;
BEGIN
  -- Idempotent: once 1.1.0 exists there is nothing to do.
  IF EXISTS (SELECT 1 FROM module.verdict_composition_version WHERE designation = '1.1.0') THEN
    RETURN;
  END IF;

  -- The single currently-in-force (open-ended) 1.0.0 row.
  SELECT id, lower(effective_period)
    INTO v_1_0_0, lower_1_0_0
    FROM module.verdict_composition_version
   WHERE designation = '1.0.0' AND upper_inf(effective_period);
  IF v_1_0_0 IS NULL THEN
    RAISE EXCEPTION 'migration 028: expected exactly one open verdict_composition_version 1.0.0 row, found none';
  END IF;

  -- Close 1.0.0 at the cut instant.
  UPDATE module.verdict_composition_version
     SET effective_period = tstzrange(lower_1_0_0, cut, '[)')
   WHERE id = v_1_0_0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 028: expected to close exactly 1 row of 1.0.0, closed %', n;
  END IF;

  -- Open 1.1.0 from the same instant, as the successor of 1.0.0.
  INSERT INTO module.verdict_composition_version (designation, effective_period, predecessor_id, rationale)
  VALUES (
    '1.1.0',
    tstzrange(cut, NULL, '[)'),
    v_1_0_0,
    '1.1.0. Adds the first governed comparative edge: rest_edge = home.rest_advantage '
    || '- away.rest_advantage (days), derived from the sealed FIXTURE rest_advantage reading '
    || 'and its two sealed underlying team.rest_advantage feature values. The sign is '
    || 'home-relative: positive = home has more rest, negative = away has more rest, zero = '
    || 'equal rest. NO aggregation, no winner inference, no prediction, no risk, no confidence, '
    || 'no historical reliability - every other edge column remains NULL. A missing required '
    || 'side produces NULL (rest_edge is computed only when both underlying values are present); '
    || 'a below-threshold numeric value remains calculable, with the below-threshold caveat '
    || 'recorded by the completeness state, and zero is a real rest value, never missing. '
    || 'Supersedes 1.0.0 (identity-only, non-directional); 1.0.0 snapshots are unchanged and '
    || 'continue to resolve to 1.0.0 by their as_of.'
  );
END
$$;
