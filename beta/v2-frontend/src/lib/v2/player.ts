// PLAYER PAGE — pure presentation helpers (DB-free, no new statistics).
//
// Re-orients values the API already returned. No aggregation, no averages, no age
// computation, no inference — the backend is the sole source of derived numbers.

import type { PlayerMatchStatLine } from './types';

/**
 * Build the V2SlugFixture routes.match needs (home/away NAMES) from a player match
 * line + the player's team name for that fixture, reconstructing orientation from
 * `isHome`. Pure. The trailing fixtureId is the resolver; names are cosmetic.
 */
export function playerMatchFixture(line: PlayerMatchStatLine, playerTeamName: string): { fixtureId: string; homeTeam: { name: string }; awayTeam: { name: string } } {
  return line.isHome
    ? { fixtureId: line.fixtureId, homeTeam: { name: playerTeamName }, awayTeam: { name: line.opponentName } }
    : { fixtureId: line.fixtureId, homeTeam: { name: line.opponentName }, awayTeam: { name: playerTeamName } };
}
