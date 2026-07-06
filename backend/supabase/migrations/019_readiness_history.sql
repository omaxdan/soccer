-- ─── MIGRATION 019 — Readiness History Archive + League Gap Analytics ────────
-- The permanent, append-only accountability layer: a pre-match snapshot of
-- every fixture's readiness picture, frozen before kickoff, later joined to
-- the real result. This is what lets the platform measure — honestly, per
-- league, per gap tier — how well its readiness gaps actually predicted
-- outcomes.
--
-- DESIGN GUARANTEE (the whole point): readiness_history is written ONCE per
-- match, pre-match, and NEVER rewritten. The prediction columns are frozen
-- at snapshot; only the result columns are filled in later, by a separate
-- narrowly-scoped step. UNIQUE(match_id) + insert-if-absent enforces this at
-- the schema level, not just by application convention. If a "prediction"
-- could be regenerated after the result was known, the entire accuracy
-- layer would silently measure nothing.
--
-- Values are captured VERBATIM (denormalized league name, team names,
-- readiness numbers) on purpose — the archive must preserve what the
-- platform believed THEN, even if teams are renamed or the readiness
-- formula later changes. Live FK lookups would retroactively rewrite
-- history and defeat the archive.

CREATE TABLE IF NOT EXISTS public.readiness_history (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- ── identity / join keys ──
  match_id                  bigint NOT NULL UNIQUE
                              REFERENCES public.matches(id),
  match_external_id         bigint NOT NULL,

  -- ── snapshot provenance ──
  snapshot_at               timestamptz NOT NULL DEFAULT now(),
  match_date                timestamptz NOT NULL,
  readiness_formula_version text NOT NULL DEFAULT 'v1',

  -- ── verbatim pre-match facts ──
  league_name               text NOT NULL,
  home_team                 text NOT NULL,
  away_team                 text NOT NULL,
  home_team_id              bigint NOT NULL,
  away_team_id              bigint NOT NULL,

  home_readiness            numeric NOT NULL,
  away_readiness            numeric NOT NULL,

  -- Signed, oriented to predicted_pick: POSITIVE = picked side had the
  -- higher readiness (pick agrees with the gap); NEGATIVE = picked side
  -- was the LOWER-readiness side (pick driven by a non-readiness factor).
  -- This orientation is what makes the "Negative Edge" tier meaningful.
  predicted_gap             numeric NOT NULL,

  -- HOME / AWAY / DRAW. An internal analytical record of which side the
  -- readiness gap favored at snapshot time, used SOLELY to score accuracy.
  -- Not re-surfaced to users as a recommendation.
  predicted_pick            text NOT NULL,

  confidence_pct            numeric NOT NULL,

  -- ── optional / nullable metrics ──
  -- Squad versatility (tactical flexibility proxy) is not tracked for every
  -- league/tier yet. NULL means "not available at snapshot", NOT zero — the
  -- analytics layer must segment on presence, never impute.
  squad_versatility         numeric,

  -- Per-department predicted-lineup confidence at snapshot, derived by
  -- averaging match_predicted_lineups.confidence within each position area.
  -- NULL when no predicted lineup existed that night.
  defense_confidence_pct    numeric,
  midfield_confidence_pct   numeric,
  attack_confidence_pct     numeric,

  -- ── result-linked columns — written ONCE, later, by the finalization
  --    step. NULL until the match finishes. This step writes ONLY these
  --    columns and never touches the prediction columns above. ──
  result_linked_at          timestamptz,
  final_home_score          integer,
  final_away_score          integer,
  final_outcome             text,          -- HOME / AWAY / DRAW
  pick_correct_strict       boolean,       -- pick == outcome (draw is its own outcome)
  pick_correct_lenient      boolean,       -- higher-readiness side did not lose

  created_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.readiness_history IS
  'Append-only pre-match snapshot archive. One immutable row per match, written pre-kickoff; result columns filled in once, later. Basis of the League Gap Analytics accuracy layer.';

CREATE INDEX IF NOT EXISTS idx_readiness_history_league
  ON public.readiness_history (league_name);
CREATE INDEX IF NOT EXISTS idx_readiness_history_unlinked
  ON public.readiness_history (result_linked_at)
  WHERE result_linked_at IS NULL;   -- speeds the finalization sweep
CREATE INDEX IF NOT EXISTS idx_readiness_history_linked
  ON public.readiness_history (league_name, result_linked_at)
  WHERE result_linked_at IS NOT NULL;   -- speeds analytics aggregation


-- ─── AGGREGATE SUMMARY TABLES ───────────────────────────────────────────────
-- Precomputed per (league × gap tier) so the analytics page reads instant
-- pre-aggregated rows rather than scanning the full history per visitor —
-- matching this platform's precompute-everything architecture. Refreshed
-- nightly. TRUNCATE-and-rebuild (these are pure derivations of
-- readiness_history, so a full rebuild is always correct and simplest).

CREATE TABLE IF NOT EXISTS public.league_gap_analytics (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_name            text NOT NULL,
  gap_tier               text NOT NULL,   -- strong / moderate / small / negative
  total_picks            integer NOT NULL,
  hit_rate_strict        numeric,         -- share correct (strict)
  hit_rate_lenient       numeric,         -- share correct (lenient)
  avg_winning_gap        numeric,         -- mean gap among correct picks
  avg_losing_gap         numeric,         -- mean gap among incorrect picks
  baseline_rate          numeric,         -- naive league base rate (no model)
  lift_over_baseline     numeric,         -- hit_rate_strict − baseline_rate (pp)
  versatility_coverage   numeric,         -- fraction of cell with non-null versatility
  computed_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_name, gap_tier)
);

CREATE TABLE IF NOT EXISTS public.league_gap_summary (
  id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_name            text NOT NULL UNIQUE,
  total_picks            integer NOT NULL,
  hit_rate_strict        numeric,
  hit_rate_lenient       numeric,
  avg_winning_gap        numeric,
  baseline_rate          numeric,
  lift_over_baseline     numeric,
  readiness_status       text,            -- consistent / mixed / volatile / insufficient
  meets_sample_gate      boolean NOT NULL DEFAULT false,
  computed_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.league_gap_analytics IS
  'Nightly precomputed per (league × gap tier) accuracy aggregates over result-linked readiness_history rows.';
COMMENT ON TABLE public.league_gap_summary IS
  'Nightly precomputed per-league roll-up powering the League Analytics matrix and summary cards.';
