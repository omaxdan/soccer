// ─────────────────────────────────────────────────────────────────────────────
// EDITION STANDINGS — read model (SQL + pure aggregation), evidence-honest
//
// Projects an edition's league table from PERSISTED football state only
// (`football.standing`). It keeps the three layers strictly distinct:
//
//   OBSERVED DB EVIDENCE  — each stored standing row: position, played, W/D/L,
//     goals for/against, points, at an observed as-of date, per variant.
//   READ-MODEL DERIVATION — goal difference (goalsFor − goalsAgainst), exact
//     integer arithmetic over two stored NOT-NULL columns. Labeled as derived.
//   GOVERNED INTELLIGENCE — NONE here. No verdict, score, ranking projection,
//     or prediction. A standing is a provider-observed snapshot, not a claim.
//
// Governance rules enforced by construction:
//   • `football.standing` is APPEND-ONLY and temporal (multiple as-of snapshots).
//     The CURRENT table is the LATEST as_of_on per variant — selected here, never
//     an average, never a fabricated "now".
//   • Only variants actually stored are surfaced. The provider supplies a single
//     overall table classified TOTAL (no HOME/AWAY split); their absence stays a
//     visible coverage fact, never an invented split.
//   • Absence stays absence: an edition with no ingested standings yields an empty
//     table set and coverage 'absent' — never a zero-filled placeholder table.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

export interface StandingLine {
  readonly position: number;
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  /** DERIVED read-layer value: goalsFor − goalsAgainst (exact integer arithmetic
   *  over two stored columns). `football.standing` stores no goal-difference. */
  readonly goalDifference: number;
  readonly points: number;
}

export interface StandingTable {
  readonly variant: string;      // 'TOTAL' | 'HOME' | 'AWAY' (as stored)
  readonly asOf: string;         // observed snapshot date, YYYY-MM-DD
  readonly rows: readonly StandingLine[];
}

export type StandingsCoverageState = 'present' | 'absent';
export interface EditionStandingsCoverage {
  readonly standings: StandingsCoverageState;
  readonly variantsPresent: readonly string[];
  /** Marks that goalDifference is read-model arithmetic, not a stored/governed value. */
  readonly goalDifferenceIsDerived: true;
  /** Marks that standings are provider-observed point-in-time snapshots, not intelligence. */
  readonly standingsAreObservedSnapshots: true;
}

export interface EditionStandings {
  readonly tables: readonly StandingTable[];
  readonly coverage: EditionStandingsCoverage;
}

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface StandingRow {
  standing_variant: string;
  as_of: string;                 // YYYY-MM-DD (to_char in SQL)
  position: number | string;
  played: number | string;
  won: number | string;
  drawn: number | string;
  lost: number | string;
  goals_for: number | string;
  goals_against: number | string;
  points: number | string;
  team_id: string;
  team_name: string;
  team_slug: string;
}

// ── pure mappers/aggregation ───────────────────────────────────────────────────

/** A stable order for known variants; unknown variants sort after, alphabetically. */
const VARIANT_ORDER: Record<string, number> = { TOTAL: 0, HOME: 1, AWAY: 2 };
function variantRank(v: string): number {
  return v in VARIANT_ORDER ? VARIANT_ORDER[v] : 100;
}

export function mapStandingLine(r: StandingRow): StandingLine {
  const goalsFor = Number(r.goals_for);
  const goalsAgainst = Number(r.goals_against);
  return {
    position: Number(r.position),
    team: { id: r.team_id, name: r.team_name, slug: r.team_slug },
    played: Number(r.played),
    won: Number(r.won),
    drawn: Number(r.drawn),
    lost: Number(r.lost),
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst, // derived, exact integer arithmetic
    points: Number(r.points),
  };
}

/**
 * Group raw standing rows into per-variant tables. For each variant only the LATEST
 * as-of snapshot is kept (temporal correctness — an older snapshot is superseded,
 * never merged). Rows are ordered by position; variants by a stable rank. Pure and
 * deterministic; does not mutate input.
 */
export function groupStandings(rows: readonly StandingRow[]): StandingTable[] {
  // Latest as-of per variant.
  const latestAsOf = new Map<string, string>();
  for (const r of rows) {
    const cur = latestAsOf.get(r.standing_variant);
    if (cur === undefined || r.as_of > cur) latestAsOf.set(r.standing_variant, r.as_of);
  }
  // Collect rows at the latest as-of for their variant.
  const byVariant = new Map<string, StandingRow[]>();
  for (const r of rows) {
    if (r.as_of !== latestAsOf.get(r.standing_variant)) continue;
    let bucket = byVariant.get(r.standing_variant);
    if (!bucket) { bucket = []; byVariant.set(r.standing_variant, bucket); }
    bucket.push(r);
  }
  return [...byVariant.entries()]
    .map(([variant, variantRows]) => ({
      variant,
      asOf: latestAsOf.get(variant)!,
      rows: [...variantRows]
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map(mapStandingLine),
    }))
    .sort((a, b) => variantRank(a.variant) - variantRank(b.variant) || a.variant.localeCompare(b.variant));
}

export function buildStandingsCoverage(tables: readonly StandingTable[]): EditionStandingsCoverage {
  return {
    standings: tables.length > 0 ? 'present' : 'absent',
    variantsPresent: tables.map((t) => t.variant),
    goalDifferenceIsDerived: true,
    standingsAreObservedSnapshots: true,
  };
}

export function assembleEditionStandings(rows: readonly StandingRow[]): EditionStandings {
  const tables = groupStandings(rows);
  return { tables, coverage: buildStandingsCoverage(tables) };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

// Every stored standing row for the edition, joined to canonical team identity.
// Latest-per-variant selection is done in the pure layer (groupStandings) so it is
// unit-testable without a database; standings are sparse, so the row count is small.
const EDITION_STANDINGS_SQL = `
  SELECT s.standing_variant AS standing_variant,
         to_char(s.as_of_on, 'YYYY-MM-DD') AS as_of,
         s.position AS position, s.played AS played, s.won AS won, s.drawn AS drawn, s.lost AS lost,
         s.goals_for AS goals_for, s.goals_against AS goals_against, s.points AS points,
         t.id::text AS team_id, t.name AS team_name, t.slug AS team_slug
    FROM football.standing s
    JOIN football.team t ON t.id = s.team_id
   WHERE s.competition_edition_id = $1::bigint
   ORDER BY s.standing_variant, s.as_of_on DESC, s.position
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readEditionStandings(tx: PoolClient, editionId: string): Promise<EditionStandings> {
  const res = await tx.query<StandingRow>(EDITION_STANDINGS_SQL, [editionId]);
  return assembleEditionStandings(res.rows);
}
