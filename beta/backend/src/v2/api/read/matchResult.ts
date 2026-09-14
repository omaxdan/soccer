// ─────────────────────────────────────────────────────────────────────────────
// MATCH RESULT — read model (SQL + pure mapping), evidence-honest
//
// Projects a fixture's COMPLETE observed scoreline from PERSISTED football state
// (`football.result`). The existing match/edition/team surfaces expose only the
// FINAL score; this surfaces the full breakdown the provider reported. Layers:
//
//   OBSERVED DB EVIDENCE  — final, half-time, extra-time and penalty scores, and
//     the confirmation instant, exactly as stored.
//   READ-MODEL SHAPING    — orienting each pair to home/away and dropping a
//     both-null phase to a single null. No arithmetic, no inference.
//   GOVERNED INTELLIGENCE — NONE. No verdict, no outcome label, no derived W/D/L.
//
// Governance rules enforced by construction:
//   • A phase the provider did not report (half-time / extra-time / penalties) is
//     null — never a fabricated 0-0. The stored columns are paired both-or-neither
//     (schema CHECKs), and the read model preserves that: a phase is present only
//     when both its sides are present.
//   • A fixture with no persisted result (e.g. not yet played) yields result: null
//     and coverage 'absent' — never an invented scoreline.
//   • home/away orientation is the fixture's home/away teams (from the header).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

export interface ResultScore {
  readonly home: number;
  readonly away: number;
}

export interface MatchResult {
  /** Final score (regulation/as-played total). Always present when a result exists. */
  readonly final: ResultScore;
  /** Half-time score, or null when not reported. */
  readonly halfTime: ResultScore | null;
  /** Extra-time score, or null when the fixture had no extra time reported. */
  readonly extraTime: ResultScore | null;
  /** Penalty shootout score, or null when there was no shootout reported. */
  readonly penalties: ResultScore | null;
  /** When the result was confirmed (ISO), or null. */
  readonly confirmedAt: string | null;
}

export type ResultCoverageState = 'present' | 'absent';
export interface MatchResultCoverage {
  readonly result: ResultCoverageState;
  /** Marks the scoreline as observed provider evidence, not a derived outcome. */
  readonly resultIsObserved: true;
}

export interface MatchResultProjection {
  readonly result: MatchResult | null;
  readonly coverage: MatchResultCoverage;
}

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface ResultRow {
  home_goals: number | string;
  away_goals: number | string;
  home_goals_half_time: number | string | null;
  away_goals_half_time: number | string | null;
  home_goals_extra_time: number | string | null;
  away_goals_extra_time: number | string | null;
  home_penalties: number | string | null;
  away_penalties: number | string | null;
  confirmed_at: Date | string | null;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** A score pair present only when BOTH sides are non-null; otherwise null. Pure. */
function pairedScore(home: number | string | null, away: number | string | null): ResultScore | null {
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return { home: Number(home), away: Number(away) };
}

export function mapResult(row: ResultRow | null | undefined): MatchResult | null {
  if (!row) return null;
  return {
    final: { home: Number(row.home_goals), away: Number(row.away_goals) },
    halfTime: pairedScore(row.home_goals_half_time, row.away_goals_half_time),
    extraTime: pairedScore(row.home_goals_extra_time, row.away_goals_extra_time),
    penalties: pairedScore(row.home_penalties, row.away_penalties),
    confirmedAt: row.confirmed_at === null || row.confirmed_at === undefined ? null : iso(row.confirmed_at),
  };
}

export function buildMatchResult(row: ResultRow | null | undefined): MatchResultProjection {
  const result = mapResult(row);
  return {
    result,
    coverage: { result: result !== null ? 'present' : 'absent', resultIsObserved: true },
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

// One result per fixture (uq_result__fixture). The FINAL score is exposed elsewhere;
// here the full breakdown is surfaced.
const MATCH_RESULT_SQL = `
  SELECT r.home_goals AS home_goals, r.away_goals AS away_goals,
         r.home_goals_half_time AS home_goals_half_time, r.away_goals_half_time AS away_goals_half_time,
         r.home_goals_extra_time AS home_goals_extra_time, r.away_goals_extra_time AS away_goals_extra_time,
         r.home_penalties AS home_penalties, r.away_penalties AS away_penalties,
         r.confirmed_at AS confirmed_at
    FROM football.result r
   WHERE r.fixture_id = $1::bigint
   LIMIT 1
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readMatchResult(tx: PoolClient, fixtureId: string): Promise<MatchResultProjection> {
  const res = await tx.query<ResultRow>(MATCH_RESULT_SQL, [fixtureId]);
  return buildMatchResult(res.rows[0]);
}
