// TEAM PAGE — pure presentation helpers (DB-free, no calculation of new statistics).
//
// These ONLY re-orient values the API already returned:
//   • lineGoals  — pick GF/GA for THIS team from a fixture line's final score + isHome
//     (the score is supplied by the backend; nothing is computed or inferred);
//   • lineResult — classify a single completed fixture as W/D/L from that score
//     (identical semantics to the existing formResult, for TeamFixtureLine rows);
//   • lineMatchFixture — build the shape routes.match needs (home/away names) from a
//     team-oriented fixture line, so match links use the canonical slug.
// No aggregation, no ranking, no fabricated statistic.

import type { TeamFixtureLine } from './types';

/** GF/GA for THIS team, from the line's final score and home/away orientation. Null when unplayed. */
export function lineGoals(line: TeamFixtureLine): { gf: number | null; ga: number | null } {
  if (!line.score) return { gf: null, ga: null };
  return line.isHome
    ? { gf: line.score.home, ga: line.score.away }
    : { gf: line.score.away, ga: line.score.home };
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
