// TEAM PAGE — pure presentation helpers (DB-free, no calculation of new statistics).
//
// These ONLY read values the API already returned:
//   • lineGoals  — GF/GA for THIS team. The backend TeamFixtureLine.score is ALREADY
//     team-relative (score.home = this team's goals FOR, score.away = opponent goals
//     AGAINST) for BOTH home and away fixtures, so we read the slots directly and never
//     re-orient by isHome (the score is supplied by the backend; nothing is computed);
//   • lineResult — classify a single completed fixture as W/D/L from that score
//     (identical semantics to the existing formResult, for TeamFixtureLine rows);
//   • lineMatchFixture — build the shape routes.match needs (home/away names) from a
//     team-oriented fixture line, so match links use the canonical slug.
// No aggregation, no ranking, no fabricated statistic.

import type { TeamFixtureLine } from './types';

/** GF/GA for THIS team. The backend TeamFixtureLine.score is already team-relative —
 *  score.home = team goals FOR, score.away = team goals AGAINST — for both home and away
 *  fixtures (teamIntelligence.ts: goals_for/goals_against → toScore). Read the slots
 *  directly; do NOT re-orient by isHome. Null when unplayed. */
export function lineGoals(line: TeamFixtureLine): { gf: number | null; ga: number | null } {
  if (!line.score) return { gf: null, ga: null };
  return { gf: line.score.home, ga: line.score.away };
}

/** W/D/L for THIS team from a completed line's score, or null when there is no score. */
export function lineResult(line: TeamFixtureLine): 'W' | 'D' | 'L' | null {
  const { gf, ga } = lineGoals(line);
  if (gf === null || ga === null) return null;
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D';
}

/** The V2SlugFixture routes.match needs, reconstructing home/away names from a
 *  team-oriented fixture line so the canonical match slug is built. Pure. */
export function lineMatchFixture(line: TeamFixtureLine, teamName: string): { fixtureId: string; homeTeam: { name: string }; awayTeam: { name: string } } {
  return line.isHome
    ? { fixtureId: line.fixtureId, homeTeam: { name: teamName }, awayTeam: { name: line.opponent.name } }
    : { fixtureId: line.fixtureId, homeTeam: { name: line.opponent.name }, awayTeam: { name: teamName } };
}
