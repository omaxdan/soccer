// ─────────────────────────────────────────────────────────────────────────────
// MATCH_RESULT/1.0.0 — outcome derivation (S-9B substrate; NOT calibration)
//
// The governed rule (S-9A A1/A2), stated once in code and matching migration 031:
//
//   home_goals > away_goals → HOME_WIN
//   home_goals = away_goals → DRAW
//   home_goals < away_goals → AWAY_WIN
//
// AUTHORITATIVE SCORE = REGULATION/FULL-TIME goals only (football.result.home_goals
// / away_goals). Extra-time goals and penalty-shootout results are NOT consumed by
// this version; AET/penalty-aware treatment is a FUTURE derivation version, never a
// silent change to 1.0.0.
//
// PURE: a function of the two integer goal counts. No clock, no database, no module
// input. It derives a fact about the world (the result), independent of any module's
// prediction — the anti-circularity direction the governance mandates.
// ─────────────────────────────────────────────────────────────────────────────

/** The outcome dimension this derivation addresses. */
export const MATCH_RESULT_DIMENSION = 'MATCH_RESULT' as const;
/** The governed derivation version this module implements. */
export const MATCH_RESULT_DERIVATION_DESIGNATION = '1.0.0' as const;

/** The three MATCH_RESULT outcome classes. */
export type MatchResultOutcome = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

/**
 * Derives MATCH_RESULT/1.0.0 from regulation/full-time goals. Both counts are the
 * authoritative `football.result.home_goals` / `away_goals` (non-negative integers);
 * extra-time and penalties are deliberately not parameters of this version.
 */
export function deriveMatchResult(homeGoals: number, awayGoals: number): MatchResultOutcome {
  if (!Number.isInteger(homeGoals) || !Number.isInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) {
    throw new Error(`MATCH_RESULT/1.0.0 requires non-negative integer regulation goals, got ${homeGoals}:${awayGoals}`);
  }
  if (homeGoals > awayGoals) return 'HOME_WIN';
  if (homeGoals < awayGoals) return 'AWAY_WIN';
  return 'DRAW';
}
