-- =============================================================================
-- 030_verdict_composition_version_1_2_0.sql
-- PitchTerminal V2 — register verdict_composition_version 1.2.0 (S-8 form edge)
-- =============================================================================
-- Source of truth : the S-8 form-edge governance gate —
--                   form_edge = home_team.home_form - away_team.away_form,
--                   home-relative sign (positive = home venue form stronger),
--                   projected from the sealed FIXTURE form_gap_accuracy reading
--                   and its two sealed underlying values; both present ⇒ compute
--                   (even below threshold; zero is real); a missing side ⇒ NULL;
--                   no aggregation with rest_edge; the successor version is 1.2.0.
-- Depends on      : 003 (verdict_composition_version), 028 (the 1.1.0 successor).
-- Transactional   : yes
--
-- Purpose
--   S-8 adds the second governed COMPARATIVE edge, form_edge, computed by the
--   verdict composition (snapshot/verdict.ts computeFormEdge + seal.ts) from the
--   sealed FIXTURE form_gap_accuracy reading and its two sealed underlying
--   team.home_form / team.away_form values. That is a NEW composition rule, so it
--   needs a new verdict_composition_version. 1.1.0 populates rest_edge only; 1.2.0
--   supersedes it, adding form_edge and nothing else (rest_edge still populates).
--
-- Succession model (identical to migration 028)
--   Closes the open 1.1.0 period at now() and opens 1.2.0 at the same instant,
--   predecessor_id = 1.1.0. The EXCLUDE (effective_period WITH &&) forbids overlap;
--   contiguous [lower_1.1.0, cut) then [cut, ) satisfies it with no gap. Snapshots
--   resolve their composition version by as_of (effective_period @> as_of), so
--   snapshots sealed before `cut` still resolve to 1.1.0 (rest_edge only, form_edge
--   NULL) or 1.0.0 (no edges) and are untouched; snapshots sealed at/after `cut`
--   resolve to 1.2.0 and carry rest_edge + form_edge.
--
-- Why a migration (not the seed)
--   Closing 1.1.0's period is an UPDATE on module.verdict_composition_version,
--   held by pt_owner, not the pipeline/seed role — the reason 024/027/028 are
--   migrations. Runs post-seed (depends on the 1.1.0 row). Idempotent: re-running
--   is a no-op once 1.2.0 exists.
--
-- Safety
--   Data-only. No schema object is created or altered. Wrapped in a guard so a
--   second run does nothing; asserts exactly one open 1.1.0 row before it acts and
--   raises otherwise. Existing sealed 1.0.0/1.1.0 snapshots reference their version
--   by id and are not mutated. The 1.2.0 rationale is BYTE-IDENTICAL to the note in
--   seed/moduleRegistry.ts (COMPOSITION_VERSIONS), so a fresh seed + this migration
--   and an upgraded database converge on the same value.
-- =============================================================================

DO $$
DECLARE
  v_1_1_0     bigint;
  lower_1_1_0 timestamptz;
  cut         timestamptz := now();
  n           integer;
BEGIN
  -- Idempotent: once 1.2.0 exists there is nothing to do.
  IF EXISTS (SELECT 1 FROM module.verdict_composition_version WHERE designation = '1.2.0') THEN
    RETURN;
  END IF;

  -- The single currently-in-force (open-ended) 1.1.0 row.
  SELECT id, lower(effective_period)
    INTO v_1_1_0, lower_1_1_0
    FROM module.verdict_composition_version
   WHERE designation = '1.1.0' AND upper_inf(effective_period);
  IF v_1_1_0 IS NULL THEN
    RAISE EXCEPTION 'migration 030: expected exactly one open verdict_composition_version 1.1.0 row, found none';
  END IF;

  -- Close 1.1.0 at the cut instant.
  UPDATE module.verdict_composition_version
     SET effective_period = tstzrange(lower_1_1_0, cut, '[)')
   WHERE id = v_1_1_0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 030: expected to close exactly 1 row of 1.1.0, closed %', n;
  END IF;

  -- Open 1.2.0 from the same instant, as the successor of 1.1.0.
  INSERT INTO module.verdict_composition_version (designation, effective_period, predecessor_id, rationale)
  VALUES (
    '1.2.0',
    tstzrange(cut, NULL, '[)'),
    v_1_1_0,
    '1.2.0. Adds the second governed comparative edge: form_edge = home_team.home_form '
    || '- away_team.away_form (venue-specific form index), derived from the sealed FIXTURE '
    || 'form_gap_accuracy reading and its two sealed underlying team.home_form / team.away_form '
    || 'values (each identified by featureKey and subject team, not citation order). The sign is '
    || 'home-relative: positive = home venue form stronger, negative = away stronger, zero = equal. '
    || 'NO aggregation with rest_edge or any other edge, no winner inference, no prediction, no risk, '
    || 'no confidence, no historical reliability - every other edge column remains NULL and rest_edge '
    || 'continues to populate as under 1.1.0. A missing required side produces NULL (computed only when '
    || 'both underlying values are present); a below-threshold numeric value remains calculable, with the '
    || 'below-threshold caveat recorded by the completeness state, and zero is a real form edge, never '
    || 'missing. Supersedes 1.1.0 (rest_edge only); 1.0.0 and 1.1.0 snapshots are unchanged and continue '
    || 'to resolve to their own version by as_of.'
  );
END
$$;
