-- ─── MIGRATION 025 — Fix replace_player_match_load for pg-safeupdate ─────────
-- Supabase loads pg-safeupdate, which rejects DELETE without WHERE even
-- inside SECURITY DEFINER functions ("DELETE requires a WHERE clause") —
-- migration 024's bare DELETE failed on the first live run (2026-07-10).
-- WHERE id IS NOT NULL is semantically a full-table delete that satisfies
-- the guard. TRUNCATE rejected: not MVCC-safe for concurrent readers.

CREATE OR REPLACE FUNCTION public.replace_player_match_load(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  DELETE FROM public.player_match_load WHERE id IS NOT NULL;

  INSERT INTO public.player_match_load
    (player_id, match_id, match_date, minutes_played, started, substitute)
  SELECT
    (r->>'player_id')::bigint,
    NULLIF(r->>'match_id','')::bigint,
    (r->>'match_date')::date,
    NULLIF(r->>'minutes_played','')::integer,
    COALESCE((r->>'started')::boolean, false),
    COALESCE((r->>'substitute')::boolean, false)
  FROM jsonb_array_elements(p_rows) AS r;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

-- Re-assert grants (CREATE OR REPLACE preserves them, but explicit is safer
-- if this file is ever run on a fresh database where 024 never ran):
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_player_match_load(jsonb) TO service_role;
