-- ─── MIGRATION 036 — Search infrastructure ──────────────────────────────────
--
-- Discovery and performance only. No intelligence table is written to, no
-- calculation changes, and nothing here affects gating or subscriptions.
--
-- WHY AN RPC RATHER THAN FOUR ilike QUERIES
-- PostgREST can do `name=ilike.*term*` per table, and that is what a naive
-- global search would do: four round trips, four unranked result sets, then
-- interleaving them in JavaScript with no way to say a team called "Arsenal"
-- should outrank a player whose surname merely contains it.
--
-- A single function does the union and the ranking in one query, on indexes
-- built for the job. It also means the client cannot forget a table when a
-- fifth entity type is added.
--
-- WHY TRIGRAM RATHER THAN FULL TEXT
-- Football names are short proper nouns, frequently misspelled, and often
-- non-English. tsvector stemming is built for prose and would treat
-- "Wanderers" and "Wanderer" as one token while offering nothing for a
-- three-character prefix. Trigram similarity handles partial input and typos,
-- which is what a search box actually receives.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Indexes ─────────────────────────────────────────────────────────────────
-- GIN over trigrams: ILIKE '%term%' cannot use a btree index at all, so
-- without these each keystroke is a sequential scan of every row.
CREATE INDEX IF NOT EXISTS idx_players_name_trgm
  ON public.players USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_teams_name_trgm
  ON public.teams USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tournaments_name_trgm
  ON public.tournaments USING gin (name gin_trgm_ops);

-- Player listing is ordered by team; without this the directory sorts on a
-- sequential scan every time it loads.
CREATE INDEX IF NOT EXISTS idx_players_team ON public.players(team_id);

-- ── Global search ───────────────────────────────────────────────────────────
/**
 * One ranked result set across matches, teams, players and competitions.
 *
 * Ranking is deliberate rather than incidental:
 *   - exact and prefix matches outrank a substring buried mid-name, so typing
 *     "ars" surfaces Arsenal before Kamara
 *   - entity_rank breaks ties toward the thing a person is most often looking
 *     for. Teams and competitions are navigation targets; a player shares a
 *     surname with dozens of others
 *   - upcoming fixtures outrank finished ones, since a search for a fixture is
 *     nearly always about the next one
 *
 * STABLE and read-only. No SECURITY DEFINER: every table it reads is already
 * world-readable, so it needs no privilege the caller lacks.
 */
CREATE OR REPLACE FUNCTION public.global_search(
  q text,
  max_results integer DEFAULT 20
)
RETURNS TABLE (
  entity_type text,
  entity_id bigint,
  title text,
  subtitle text,
  score real
)
LANGUAGE sql STABLE
AS $$
  WITH term AS (SELECT btrim(q) AS t)
  SELECT * FROM (
    -- Teams
    SELECT
      'team'::text AS entity_type,
      t.id AS entity_id,
      t.name AS title,
      COALESCE(t.country, '') AS subtitle,
      (similarity(t.name, (SELECT t FROM term))
        + CASE WHEN t.name ILIKE (SELECT t FROM term) || '%' THEN 0.4 ELSE 0 END
        + 0.10)::real AS score
    FROM public.teams t
    WHERE t.name ILIKE '%' || (SELECT t FROM term) || '%'

    UNION ALL

    -- Competitions
    SELECT
      'league', tr.id, tr.name, COALESCE(c.name, ''),
      (similarity(tr.name, (SELECT t FROM term))
        + CASE WHEN tr.name ILIKE (SELECT t FROM term) || '%' THEN 0.4 ELSE 0 END
        + 0.10)::real
    FROM public.tournaments tr
    LEFT JOIN public.countries c ON c.id = tr.country_id
    WHERE tr.name ILIKE '%' || (SELECT t FROM term) || '%'

    UNION ALL

    -- Players
    SELECT
      'player', p.id, p.name,
      COALESCE(tm.name, '') ||
        CASE WHEN p.primary_position IS NOT NULL
             THEN ' · ' || p.primary_position ELSE '' END,
      (similarity(p.name, (SELECT t FROM term))
        + CASE WHEN p.name ILIKE (SELECT t FROM term) || '%' THEN 0.4 ELSE 0 END)::real
    FROM public.players p
    LEFT JOIN public.teams tm ON tm.id = p.team_id
    WHERE p.name ILIKE '%' || (SELECT t FROM term) || '%'

    UNION ALL

    -- Fixtures, matched on either side's name
    SELECT
      'match', m.id,
      h.name || ' v ' || a.name,
      COALESCE(m.competition, '') || ' · ' || to_char(m.date, 'DD Mon'),
      (GREATEST(
         similarity(h.name, (SELECT t FROM term)),
         similarity(a.name, (SELECT t FROM term))
       )
       + CASE WHEN m.date >= now() THEN 0.15 ELSE 0 END)::real
    FROM public.matches m
    JOIN public.teams h ON h.id = m.home_team_id
    JOIN public.teams a ON a.id = m.away_team_id
    WHERE h.name ILIKE '%' || (SELECT t FROM term) || '%'
       OR a.name ILIKE '%' || (SELECT t FROM term) || '%'
  ) results
  -- A two-character query matches almost everything; the floor keeps noise out
  -- without excluding a deliberate short search like "PSG".
  WHERE length((SELECT t FROM term)) >= 2
  ORDER BY score DESC, title ASC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.global_search(text, integer) TO anon, authenticated;

COMMENT ON FUNCTION public.global_search(text, integer) IS
  'Ranked search across teams, competitions, players and fixtures. Read-only and world-readable, matching the tables it reads.';

-- ── Verification ────────────────────────────────────────────────────────────
--   SELECT * FROM global_search('ars', 10);
--   EXPLAIN ANALYZE SELECT * FROM global_search('arsenal', 20);
--     -> expect Bitmap Index Scan on the *_name_trgm indexes, not Seq Scan.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.global_search(text, integer);
--   DROP INDEX IF EXISTS idx_players_name_trgm, idx_teams_name_trgm,
--     idx_tournaments_name_trgm, idx_players_team;
--   -- pg_trgm is left installed; other things may come to depend on it.
