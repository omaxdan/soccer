-- ─── MIGRATION 024 — Atomic replace for player_match_load ────────────────────
-- Replaces the non-atomic delete().neq('id',0) + insert() pair in
-- processPlayerMatchLoad. Two PostgREST calls = two transactions: if the
-- insert failed after the delete, the table sat EMPTY until the next run,
-- and every run had a visible empty window. A single function call is one
-- transaction — readers see the old set or the new set, never nothing.
--
-- Caller (beta backend):
--   const { error } = await db.rpc('replace_player_match_load', { p_rows: rows });

CREATE OR REPLACE FUNCTION public.replace_player_match_load(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted integer;
BEGIN
  DELETE FROM public.player_match_load;

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

-- Pipeline-only: the anon-key frontend must not be able to call this.
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.replace_player_match_load(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_player_match_load(jsonb) TO service_role;
