import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Oversized-URL protection for .in() filters.
//
// CONFIRMED PRODUCTION FAILURE this exists to close:
//   HeadersOverflowError (UND_ERR_HEADERS_OVERFLOW)
//   processFormationMatchup — request URL 16623 characters, ~202 match IDs.
//
// WHY fetchAllRows() DOES NOT ALREADY SOLVE THIS
// It looks like it should — it's the thing every processor already calls to
// "fetch a lot of rows" — but it structurally can't help here. fetchAllRows
// paginates via .range(from, from+pageSize-1) on a query builder the CALLER
// already constructed, .in() clause and all. The oversized URL exists the
// moment that builder is built, before fetchAllRows's first .range() call
// ever runs — page 0 is already too large. Row-range pagination and ID-array
// chunking are two different operations solving two different problems
// (PostgREST's 1000-row response cap vs. an oversized request URL), and
// nothing in this codebase did the second one before this file. Checked
// fetchAllRows.ts directly before writing this, not assumed.
//
// WHY A SHARED HELPER, NOT A PER-PROCESSOR FIX
// The same pattern — build an ID array from an upcoming-matches window (7
// days, but spanning every tracked league at once, easily 100-300+ matches
// during a busy multi-league week) then .in() it, sometimes into a
// team_id list (~2x the match count) or a player_id list (~20-22x, one full
// squad per side) — recurs across roughly fifty processor functions in
// processExtendedIntelligence.ts and processDbOnly.ts. Patching the one
// confirmed-broken processor would leave the same bug latent in every other
// one built the same way.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits `ids` into chunks of `chunkSize`, runs `queryFn` once per chunk,
 * and merges the results. Each chunk is an independent request — one
 * chunk's failure doesn't need to fail the others, though by default a
 * failure still throws (matching the existing fail-loud convention this
 * pipeline already uses elsewhere — see the immutability trigger's own
 * documented reasoning for why "fail loud" over "best effort").
 *
 * chunkSize default of 100 is conservative, not derived from a measured
 * limit: the confirmed failure was ~202 IDs producing a 16623-char URL
 * (~82 chars/ID including the column name, quoting, and comma). Common
 * PostgREST/proxy header limits run 8KB-16KB; 100 IDs at that rate stays
 * comfortably under 8KB even for longer column names, with real headroom
 * for whatever the actual server-side limit turns out to be. This number
 * has not been tuned against the real limit — nobody has access to the
 * production server config to confirm it precisely. It is a safe default
 * a caller can override, not a validated constant.
 */
export async function chunkedIn<T, I extends string | number>(
  ids: I[],
  queryFn: (chunk: I[]) => Promise<{ data: T[] | null; error: any }>,
  opts: { chunkSize?: number; label?: string } = {}
): Promise<T[]> {
  const chunkSize = opts.chunkSize ?? 100;
  const label = opts.label ?? 'chunkedIn';
  if (ids.length === 0) return [];

  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await queryFn(chunk);
    if (error) {
      logger.error(
        { label, chunkIndex: i / chunkSize, chunkSize: chunk.length, totalIds: ids.length, error: error.message ?? String(error) },
        'chunkedIn: chunk failed'
      );
      throw new Error(`chunkedIn [${label}] chunk ${i / chunkSize} failed: ${error.message ?? error}`);
    }
    if (data) results.push(...data);
  }

  if (ids.length > chunkSize) {
    logger.debug({ label, totalIds: ids.length, chunks: Math.ceil(ids.length / chunkSize) }, 'chunkedIn: completed across multiple chunks');
  }
  return results;
}
