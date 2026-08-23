// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE-AWARE WINDOW DERIVATION (Gate 6C) — pure read-side, no provider.
//
// Given an operator-requested inclusive window [from..to] and a competition
// edition, derives the UNCOVERED sub-windows that still need ingesting:
//
//     uncovered = (requested [∩ season_period]) − union(complete coverage)
//
// The interval arithmetic is done ENTIRELY IN POSTGRESQL using daterange /
// datemultirange (range_agg, `*` intersection, `-` difference, unnest). TypeScript
// only assembles the rows — it never reimplements interval math.
//
// Coverage is EVIDENCE, never authorization: this reads only
// operations.edition_ingestion_coverage (complete rows) and, when asked,
// football.competition_edition.season_period. It reads no governance, calls no
// provider, and authorizes nothing. Authorization stays with Gate 3 selection →
// Gate 5 dispatch → Gate 4 at-commit. Coverage only narrows future work.
//
// A database error THROWS — it is never turned into a "no work" result, because
// "nothing left to do" and "could not tell" must never look alike to a caller
// deciding whether to skip ingestion.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** A half-open date interval [from, to). ISO YYYY-MM-DD strings. */
export interface DateInterval {
  readonly from: string;
  readonly to: string;
}

export interface DeriveUncoveredParams {
  /** Internal anchor — football.competition_edition.id. */
  readonly competitionEditionId: string;
  /** Operator window start, inclusive, YYYY-MM-DD. */
  readonly requestedFrom: string;
  /** Operator window end, inclusive, YYYY-MM-DD. */
  readonly requestedTo: string;
  /** When true, intersect the requested window with the edition's season_period. */
  readonly clipToSeason?: boolean;
}

export interface UncoveredDerivation {
  /** The original operator window as a half-open range [from, to+1). */
  readonly requested: DateInterval;
  /** Complete coverage clipped to the (season-clipped) requested window; ascending. */
  readonly covered: readonly DateInterval[];
  /** The gaps still needing ingestion; ascending by lower bound. */
  readonly uncovered: readonly DateInterval[];
  /** True when there is no uncovered work. */
  readonly noWork: boolean;
  readonly reason?: 'FULLY_COVERED' | 'EMPTY_AFTER_SEASON_CLIP';
}

interface DerivedRow {
  readonly kind: 'requested' | 'covered' | 'uncovered';
  readonly lo: string;
  readonly hi: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertDate(value: string, field: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date, received '${value}'.`);
  }
}

/**
 * THE DERIVATION QUERY. One statement; all interval logic in PostgreSQL.
 *   $1 competition_edition_id, $2 requestedFrom, $3 requestedTo, $4 clipToSeason
 * Returns one 'requested' row plus zero+ 'covered' and 'uncovered' rows. `covered`
 * and `uncovered` partition the effective (possibly season-clipped) window, so an
 * empty effective window yields neither — which the assembler uses to tell
 * EMPTY_AFTER_SEASON_CLIP from FULLY_COVERED.
 */
export const DERIVE_UNCOVERED_SQL = `
  WITH p AS (
    SELECT $1::bigint AS edition,
           $4::boolean AS clip,
           daterange($2::date, ($3::date + 1), '[)') AS req
  ),
  season AS (
    SELECT ce.season_period FROM football.competition_edition ce
     WHERE ce.id = (SELECT edition FROM p)
  ),
  effective AS (
    SELECT CASE
             WHEN NOT (SELECT clip FROM p) THEN datemultirange((SELECT req FROM p))
             WHEN (SELECT season_period FROM season) IS NOT NULL
               THEN datemultirange((SELECT req FROM p)) * datemultirange((SELECT season_period FROM season))
             ELSE '{}'::datemultirange
           END AS req_mr
  ),
  covered AS (
    SELECT COALESCE(range_agg(cov.covered_period), '{}'::datemultirange) AS cov_mr
      FROM operations.edition_ingestion_coverage cov
     WHERE cov.competition_edition_id = (SELECT edition FROM p)
       AND cov.complete
  )
  SELECT 'requested'::text AS kind, lower((SELECT req FROM p))::text AS lo, upper((SELECT req FROM p))::text AS hi
  UNION ALL
  SELECT 'covered', lower(r)::text, upper(r)::text
    FROM unnest( (SELECT cov_mr FROM covered) * (SELECT req_mr FROM effective) ) AS r
  UNION ALL
  SELECT 'uncovered', lower(r)::text, upper(r)::text
    FROM unnest( (SELECT req_mr FROM effective) - (SELECT cov_mr FROM covered) ) AS r
`;

/** Pure assembly of the query rows into the result. No DB, no interval math. */
export function assembleDerivation(rows: readonly DerivedRow[], clipToSeason: boolean): UncoveredDerivation {
  const asc = (a: DerivedRow, b: DerivedRow) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0);
  const pick = (kind: DerivedRow['kind']) =>
    rows.filter((r) => r.kind === kind).sort(asc).map((r) => ({ from: r.lo, to: r.hi }));

  const requestedRow = rows.find((r) => r.kind === 'requested');
  if (!requestedRow) throw new Error('coverage derivation returned no requested row (query contract violated).');

  const covered = pick('covered');
  const uncovered = pick('uncovered');
  const noWork = uncovered.length === 0;
  // covered ∪ uncovered = the effective window. Both empty ⇒ the effective window
  // is empty, which under clipToSeason means the season removed it.
  const effectiveEmpty = covered.length === 0 && uncovered.length === 0;
  const reason = noWork
    ? clipToSeason && effectiveEmpty
      ? ('EMPTY_AFTER_SEASON_CLIP' as const)
      : ('FULLY_COVERED' as const)
    : undefined;

  return { requested: { from: requestedRow.lo, to: requestedRow.hi }, covered, uncovered, noWork, reason };
}

/**
 * Derives the uncovered sub-windows for one authorized edition. Read-only.
 * Throws on invalid input or any database error — never returns noWork on failure.
 */
export async function deriveUncoveredWindows(
  client: PoolClient,
  params: DeriveUncoveredParams
): Promise<UncoveredDerivation> {
  assertDate(params.requestedFrom, 'requestedFrom');
  assertDate(params.requestedTo, 'requestedTo');
  if (params.requestedTo < params.requestedFrom) {
    throw new Error(`requestedTo (${params.requestedTo}) precedes requestedFrom (${params.requestedFrom}).`);
  }
  const clipToSeason = params.clipToSeason === true;

  const result = await client.query<DerivedRow>(DERIVE_UNCOVERED_SQL, [
    params.competitionEditionId,
    params.requestedFrom,
    params.requestedTo,
    clipToSeason,
  ]);

  return assembleDerivation(result.rows, clipToSeason);
}
