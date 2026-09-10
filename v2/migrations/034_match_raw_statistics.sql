-- =============================================================================
-- 034_match_raw_statistics.sql — Match-level RAW statistics substrate (Task 6C)
-- Source: Task 6B/6C contract, verified against live payloads for match 15237975
-- Depends: 001-033  |  Transactional
--
-- WHAT THIS MIGRATION IS
--
-- Two mutable, co-partitioned football relations that hold RAW provider match
-- statistics, plus one column on lineup_selection. NOTHING derived: no ratings
-- rollups, no readiness/fatigue/rotation, no completeness. Raw provider facts
-- preserved for later, separately-governed layers.
--
--   football.team_match_statistic   — /match/{id}/statistics, per (period, group,
--                                     provider key), home/away values + raw display
--   football.player_match_statistic — /match/{id}/lineups per-player statistics
--                                     object (canonical source), one row per
--                                     (fixture, player, provider statistic key)
--   football.lineup_selection.is_captain — the VERIFIED captain fact (6B gap)
--
-- KEYS VERIFIED AGAINST THE LIVE PAYLOAD (not assumed):
--   * player statistics arrive as a JSON OBJECT keyed by statistic name, so a
--     player cannot carry a duplicate key → UNIQUE (fixture, player, key) is safe.
--   * team statistics reuse the same `key` across different groups in one period
--     (e.g. totalShotsOnGoal in "Match overview" and "Shots"), so group_name is
--     part of the key → UNIQUE (fixture, period, group_name, key) is safe.
--
-- RAW FIDELITY: provider values are stored as TEXT. The payload gives both a
-- display string (e.g. "67%", "100.6 km") and a typed value (67, 100.62); BOTH
-- are preserved as text so nothing is lost and no type is guessed at ingestion.
--
-- MUTABLE, NOT append-only: a re-fetch may legitimately correct a raw value, so
-- these tables are upserted (SIU for the ingestion role) and carry NO append
-- guard — matching football.lineup / lineup_selection / appearance, not the
-- operations append-only ledgers.
--
-- OUT OF SCOPE (unchanged): football.appearance, football.match_event, incidents,
-- event-type vocabulary, any intelligence/module/snapshot/completeness work.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- team_match_statistic  (/match/{id}/statistics)
-- -----------------------------------------------------------------------------
CREATE TABLE football.team_match_statistic (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  period                text        NOT NULL,   -- provider `period` (e.g. ALL, 1ST, 2ND)
  group_name            text        NOT NULL,   -- provider `groupName`
  statistic_key         text        NOT NULL,   -- provider `key` (stat identity within group)
  statistic_name        text,                   -- provider `name` (display label)
  home_value            text,                   -- provider `homeValue`, raw
  away_value            text,                   -- provider `awayValue`, raw
  home_display          text,                   -- provider `home`, raw display string
  away_display          text,                   -- provider `away`, raw display string
  value_type            text,                   -- provider `valueType`
  compare_code          text,                   -- provider `compareCode`, raw
  statistics_type       text,                   -- provider `statisticsType`
  render_type           text,                   -- provider `renderType`, raw
  provider_code         text        NOT NULL,   -- provenance: which provider
  retrieved_at          timestamptz NOT NULL,   -- provenance: when captured
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_team_match_statistic PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_team_match_statistic__fixture_period_group_key
    UNIQUE (fixture_partition_on, fixture_id, period, group_name, statistic_key),
  CONSTRAINT fk_team_match_statistic__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

ALTER TABLE football.team_match_statistic OWNER TO pt_owner;

COMMENT ON TABLE football.team_match_statistic IS
  'RAW team-level match statistics from /match/{id}/statistics. One row per (fixture, period, groupName, provider key). Values stored as text (both display and typed) to preserve raw provider fidelity; NO derived metric. group_name is part of the natural key because the provider reuses a key across groups within one period.';

-- -----------------------------------------------------------------------------
-- player_match_statistic  (/match/{id}/lineups — canonical; /player-statistics is an alias)
-- -----------------------------------------------------------------------------
CREATE TABLE football.player_match_statistic (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  fixture_partition_on  date        NOT NULL,
  fixture_id            bigint      NOT NULL,
  player_id             bigint      NOT NULL,
  team_id               bigint      NOT NULL,
  statistic_key         text        NOT NULL,   -- key of the per-player statistics object
  statistic_value       text,                   -- raw value (scalar as text; nested object as JSON text)
  value_type            text,                   -- 'number' | 'json' (shape tag only, not a provider claim)
  provider_code         text        NOT NULL,
  retrieved_at          timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_player_match_statistic PRIMARY KEY (id, fixture_partition_on),
  CONSTRAINT uq_player_match_statistic__fixture_player_key
    UNIQUE (fixture_partition_on, fixture_id, player_id, statistic_key),
  CONSTRAINT fk_player_match_statistic__fixture
    FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_match_statistic__player FOREIGN KEY (player_id)
    REFERENCES football.player (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_player_match_statistic__team FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (fixture_partition_on);

ALTER TABLE football.player_match_statistic OWNER TO pt_owner;

COMMENT ON TABLE football.player_match_statistic IS
  'RAW per-player match statistics from the canonical /match/{id}/lineups per-player statistics object (/player-statistics is a verified alias and is NOT separately ingested). EAV: one row per (fixture, player, provider statistic key); the payload object cannot carry a duplicate key. Values stored as text (nested objects such as ratingVersions serialized as JSON text) — NO derived metric.';

-- -----------------------------------------------------------------------------
-- lineup_selection.is_captain — the VERIFIED captain fact (6B identified the gap)
-- -----------------------------------------------------------------------------
ALTER TABLE football.lineup_selection
  ADD COLUMN is_captain boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN football.lineup_selection.is_captain IS
  'Provider `captain` flag from /match/{id}/lineups. Present-only-when-true in the payload, so DEFAULT false is the correct absence semantics.';

-- -----------------------------------------------------------------------------
-- Static per-year partitions + default, matching the football family (005).
-- -----------------------------------------------------------------------------
DO $$
DECLARE rel text; y integer;
BEGIN
  FOREACH rel IN ARRAY ARRAY['team_match_statistic','player_match_statistic']
  LOOP
    FOR y IN 2015..2035 LOOP
      EXECUTE format(
        'CREATE TABLE football.%I PARTITION OF football.%I FOR VALUES FROM (%L) TO (%L)',
        rel || '_p' || y, rel, format('%s-01-01', y), format('%s-01-01', y + 1));
      EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', rel || '_p' || y);
    END LOOP;
    EXECUTE format('CREATE TABLE football.%I PARTITION OF football.%I DEFAULT', rel || '_pdefault', rel);
    EXECUTE format('ALTER TABLE football.%I OWNER TO pt_owner', rel || '_pdefault');
  END LOOP;
END
$$;

-- -----------------------------------------------------------------------------
-- Row-level security (PD-18, F-09) — created after 016 forced RLS, so each new
-- relation enables and forces it for itself (the B-09 lesson, as migration 026).
-- -----------------------------------------------------------------------------
ALTER TABLE football.team_match_statistic   ENABLE ROW LEVEL SECURITY;
ALTER TABLE football.team_match_statistic   FORCE  ROW LEVEL SECURITY;
ALTER TABLE football.player_match_statistic ENABLE ROW LEVEL SECURITY;
ALTER TABLE football.player_match_statistic FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE football.team_match_statistic_pdefault   FROM PUBLIC;
REVOKE ALL ON TABLE football.player_match_statistic_pdefault FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Access — mirrors the football Layer-1 posture (016): reality is read by
-- everyone and written by ingestion alone. These are MUTABLE raw relations, so
-- the ingestion role holds SELECT+INSERT+UPDATE (SIU); all others SELECT.
-- Grant AND policy are applied together through the one applicator, or a grant
-- would fail silently under FORCE RLS.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text; r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_match_statistic','player_match_statistic']
  LOOP
    PERFORM operations.fn_apply_access('football', t, 'pt_pipeline_ingestion', 'SIU');
    FOR r IN SELECT unnest(ARRAY[
        'pt_pipeline_feature','pt_pipeline_module','pt_pipeline_calibration',
        'pt_pipeline_projection','pt_platform_admin','anon','authenticated'
      ]) AS role
    LOOP
      PERFORM operations.fn_apply_access('football', t, r.role, 'S');
    END LOOP;
  END LOOP;
END
$$;

-- =============================================================================
-- CONFORMANCE GATE — the same assertions migrations 016/017/026 close with.
-- football is already in both functions' schema lists.
-- =============================================================================
SELECT operations.fn_assert_security_posture();
SELECT operations.fn_assert_access_correspondence();

-- =============================================================================
-- ASSERTED POSTURE
--   * football.team_match_statistic and football.player_match_statistic exist,
--     partitioned by fixture_partition_on, RLS enabled+forced
--   * pt_pipeline_ingestion holds SELECT+INSERT+UPDATE; all other roles SELECT
--   * both natural keys VERIFIED safe against the live payload structure
--   * lineup_selection.is_captain added (NOT NULL DEFAULT false)
--   * NOT in this migration: appearance, match_event, incidents, event-type
--     vocabulary, ingestion application logic, any derived/intelligence output
-- =============================================================================
