/**
 * Fetches ALL rows from a Supabase query, paginating past the server's
 * silent row cap (PostgREST max_rows, default 1000 — `.range(0, 99999)`
 * returns the first 1000 with no error).
 *
 * V2 (beta backend) — fixes the ordering gap in the original:
 *
 * LIMIT/OFFSET pagination over an UNORDERED result set has no stability
 * guarantee in Postgres. Between page requests, the planner may change
 * strategy or concurrent writes may reshuffle physical order — rows get
 * skipped or duplicated across pages, silently. Only 4 of the original's
 * 37 call sites passed .order(); the other 33 paginated on luck. For an
 * intelligence pipeline, one skipped form row = a wrong readiness score
 * with no error anywhere.
 *
 * Fix: ALWAYS append .order('id') before paginating. When the caller has
 * already ordered, this becomes a trailing tiebreaker — which also makes
 * THEIR ordering deterministic (e.g. two matches with identical
 * match_date now page consistently).
 *
 * Callers with tables that have no `id` column must pass orderColumn.
 *
 * Usage (unchanged from v1):
 *   const players = await fetchAllRows(
 *     db.from('players').select('team_id, market_value, current_injury')
 *   );
 */
export async function fetchAllRows<T = any>(
  queryBuilder: any,
  pageSize = 1000,
  orderColumn = 'id'
): Promise<T[]> {
  queryBuilder.order(orderColumn, { ascending: true });

  let all: T[] = [];
  let page = 0;

  for (;;) {
    const from = page * pageSize;
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Paginated query failed at page ${page}: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    all = all.concat(data);

    // A short page is the only reliable end-of-data signal — a "requested
    // range satisfied" check breaks when the server cap is lower than the
    // requested page size (see v1 comment history).
    if (data.length < pageSize) break;
    page++;
  }

  return all;
}
