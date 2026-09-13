-- =============================================================================
-- 037_verdict_composition_version_1_3_0.sql
-- PitchTerminal V2 — register verdict_composition_version 1.3.0 (Team Preparedness)
-- =============================================================================
-- Source of truth : the Team Preparedness B3 governance gate — a per-side absolute
--                   preparedness score over the governed 60-point subset (Form 30 /
--                   Congestion 15 / Home-Venue 10 / Squad Stability 5), composed at
--                   snapshot seal from governed Layer-2 feature values and sealed as
--                   snapshot.snapshot_team_preparedness (migration 036), with the
--                   per-side result also folded into the verdict canonical object.
--                   The successor version is 1.3.0.
-- Depends on      : 003 (verdict_composition_version), 028 (1.1.0), 030 (1.2.0),
--                   036 (the snapshot_team_preparedness relation it governs).
-- Transactional   : yes
--
-- Purpose
--   Team Preparedness is a NEW verdict-composition contribution, so it needs a new
--   verdict_composition_version. 1.2.0 populates rest_edge + form_edge; 1.3.0
--   supersedes it, ADDING Team Preparedness and nothing else (both edges still
--   populate exactly as under 1.2.0). Governing it through verdict_composition_version
--   reuses the established succession/manifest/gating machinery; no second
--   preparedness-version system is introduced at this stage.
--
-- Succession model (identical to migrations 028/030)
--   Closes the open 1.2.0 period at now() and opens 1.3.0 at the same instant,
--   predecessor_id = 1.2.0. The EXCLUDE (effective_period WITH &&) forbids overlap;
--   contiguous [lower_1.2.0, cut) then [cut, ) satisfies it with no gap. Snapshots
--   resolve their composition version by as_of (effective_period @> as_of), so
--   snapshots sealed before `cut` still resolve to 1.2.0 / 1.1.0 / 1.0.0 (no
--   preparedness rows, verdict object unchanged, checksum unchanged) and are
--   untouched; snapshots sealed at/after `cut` resolve to 1.3.0 and carry the two
--   preparedness rows plus the folded verdict contribution.
--
-- Why a migration (not the seed)
--   Closing 1.2.0's period is an UPDATE on module.verdict_composition_version, held
--   by pt_owner, not the pipeline/seed role — the reason 028/030 are migrations.
--   The seed registers ONLY genesis 1.0.0; every successor is migration-registered.
--   Runs post-seed (depends on the 1.2.0 row). Idempotent: re-running is a no-op
--   once 1.3.0 exists.
--
-- Safety
--   Data-only. No schema object is created or altered. Wrapped in a guard so a
--   second run does nothing; asserts exactly one open 1.2.0 row before it acts and
--   raises otherwise. Existing sealed 1.0.0/1.1.0/1.2.0 snapshots reference their
--   version by id and are not mutated.
-- =============================================================================

DO $$
DECLARE
  v_1_2_0     bigint;
  lower_1_2_0 timestamptz;
  cut         timestamptz := now();
  n           integer;
BEGIN
  -- Idempotent: once 1.3.0 exists there is nothing to do.
  IF EXISTS (SELECT 1 FROM module.verdict_composition_version WHERE designation = '1.3.0') THEN
    RETURN;
  END IF;

  -- The single currently-in-force (open-ended) 1.2.0 row.
  SELECT id, lower(effective_period)
    INTO v_1_2_0, lower_1_2_0
    FROM module.verdict_composition_version
   WHERE designation = '1.2.0' AND upper_inf(effective_period);
  IF v_1_2_0 IS NULL THEN
    RAISE EXCEPTION 'migration 037: expected exactly one open verdict_composition_version 1.2.0 row, found none';
  END IF;

  -- Close 1.2.0 at the cut instant.
  UPDATE module.verdict_composition_version
     SET effective_period = tstzrange(lower_1_2_0, cut, '[)')
   WHERE id = v_1_2_0;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 037: expected to close exactly 1 row of 1.2.0, closed %', n;
  END IF;

  -- Open 1.3.0 from the same instant, as the successor of 1.2.0.
  INSERT INTO module.verdict_composition_version (designation, effective_period, predecessor_id, rationale)
  VALUES (
    '1.3.0',
    tstzrange(cut, NULL, '[)'),
    v_1_2_0,
    '1.3.0. Adds Team Preparedness: a per-side ABSOLUTE preparedness score over the governed '
    || '60-point subset - Form 30 (team.home_form for the home side, team.away_form for the away '
    || 'side), Congestion 15 (team.congestion_index, oriented 100 - x), Home/Venue 10 '
    || '(team.home_win_rate / team.away_win_rate, resolved against the fixture competition edition), '
    || 'Squad Stability 5 (team.squad_stability, a 0-1 ratio) - composed at snapshot seal from '
    || 'governed Layer-2 feature values, sealed as snapshot.snapshot_team_preparedness (two rows, '
    || 'HOME and AWAY) with those feature values sealed through snapshot_feature_state and their '
    || 'versions in the manifest. available_points is the sum of the present components'' weights; '
    || 'preparedness_points is the sum of the present components'' points with NO redistribution of '
    || 'missing weights; coverage_ratio = available_points / 60; all four absent leaves '
    || 'preparedness_points NULL, never a fabricated zero. The deferred 40 points (Travel 15, '
    || 'Opponent Strength 20, Motivation 5) are NOT implemented and NOT redistributed. rest_edge and '
    || 'form_edge continue to populate exactly as under 1.2.0; there is NO aggregation of preparedness '
    || 'with any edge, no winner inference, no prediction, no risk, no confidence. Supersedes 1.2.0; '
    || '1.0.0/1.1.0/1.2.0 snapshots are unchanged and continue to resolve to their own version by as_of.'
  );
END
$$;
