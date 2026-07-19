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
 *
 *   // Optional label — shows up in retry/page logs, so a failure tells you
 *   // WHICH call died instead of just "page 0":
 *   const players = await fetchAllRows(db.from('players').select('id'), 1000, 'id', 'players');
 */
import { logger } from '../utils/logger';

// postgrest-js's own fetch wrapper (see @supabase/postgrest-js dist/index.cjs,
// PostgrestBuilder's `.catch`) already unwraps `err.cause` into
// `error.details` ("Caused by: <Name>: <message> (<code>)" + stack) and sets
// `error.hint` for known patterns (e.g. an oversized `.in()` array blowing
// past header/URL limits). We were only ever reading `error.message` — the
// generic top-level string like "TypeError: fetch failed" — and silently
// discarding the useful part. This pulls all three fields in.
function describePostgrestError(error: any): string {
  const parts: string[] = [error?.message ?? String(error)];
  if (error?.details) parts.push(error.details);
  if (error?.hint) parts.push(`hint: ${error.hint}`);
  return parts.join(' | ');
}

// Belt-and-suspenders for the rarer case where the query builder throws
// instead of resolving with `{ error }`. Unwraps `err.cause` the same way.
function describeFetchError(err: any): string {
  const parts: string[] = [err?.message ?? String(err)];
  let cause = err?.cause;
  let depth = 0;
  while (cause && depth < 5) {
    parts.push(cause.code ? `${cause.code}: ${cause.message ?? cause}` : String(cause.message ?? cause));
    cause = cause.cause;
    depth++;
  }
  return parts.join(' <- ');
}

export async function fetchAllRows<T = any>(
  queryBuilder: any,
  pageSize = 1000,
  orderColumn = 'id',
  label = 'query'
): Promise<T[]> {
  queryBuilder.order(orderColumn, { ascending: true });

  // Transient network failures (stale keep-alive sockets, connection
  // resets, DNS blips — 'TypeError: fetch failed' from undici) are a fact
  // of life on shared hosting. Since every read funnels through here, one
  // retry policy hardens the whole pipeline: 3 attempts, 1s/3s backoff,
  // retrying ONLY network-shaped errors — real errors (bad column, RLS)
  // still throw immediately.
  const isTransient = (msg: string) =>
    /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|EPIPE|socket|network|terminat/i.test(msg);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let all: T[] = [];
  let page = 0;

  for (;;) {
    const from = page * pageSize;

    let data: T[] | null = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await queryBuilder.range(from, from + pageSize - 1);
        if (!res.error) { data = res.data; break; }
        lastErr = describePostgrestError(res.error);
      } catch (err: any) {
        lastErr = describeFetchError(err);
      }

      logger.warn({ label, page, attempt, error: lastErr }, 'fetchAllRows attempt failed');

      if (!isTransient(lastErr) || attempt === 3) {
        throw new Error(`Paginated query failed [${label}] at page ${page}: ${lastErr}`);
      }
      // ✅ Increased backoff: 2s → 5s → 10s
      await sleep(attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000);
    }

    if (!data || data.length === 0) break;
    all = all.concat(data);
    logger.info({ label, page, pageRows: data.length, totalSoFar: all.length }, 'fetchAllRows page fetched');
    if (data.length < pageSize) break;
    page++;
  }

  return all;
}
