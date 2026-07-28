/**
 * PREDICTED LINEUPS ENGINE — candidate construction
 *
 * Converts raw player + season-statistics rows into fully scored
 * PlayerCandidates, with every suitability value precomputed.
 *
 * PERFORMANCE NOTE
 * Suitability is resolved once per (player, distinct slot code) here, not
 * inside the optimizer. Without this, the compatibility lookup would run
 * inside the assignment matrix build for every formation — squad size × 11 ×
 * 8 formations per team per match — and the same values would be recomputed
 * for every match a team plays in the window. Precomputing collapses that to
 * squad size × ~30 distinct slot codes, once per team per run.
 */

import type { CanonicalPosition, PlayerCandidate, PositionGroup } from './types';
import { SLOT_BASE_BY_CODE } from './formations';
import { groupFromBroadLetter, groupOf, normalizePosition, positionSuitability } from './positions';
import {
  buildTeamNormalizers,
  calculateWeightedScore,
  averageRating as meanRating,
  hasPlayingEvidence,
  type RawPlayerStats,
  type TeamScoreNormalizers,
} from './playerScoring';

/** One available player, already filtered for injuries and transfers. */
export interface CandidateInput {
  playerId: number;
  teamId: number;
  /** players.primary_position / secondary_position / tertiary_position, raw. */
  rawPositions: (string | null)[];
  /** players.position — the coarse G/D/M/F letter, used only as a last resort. */
  broadPosition: string | null;
  stats: RawPlayerStats;
}

export interface TeamCandidates {
  teamId: number;
  candidates: PlayerCandidate[];
  normalizers: TeamScoreNormalizers;
}

/**
 * Builds the candidate pool for one team.
 *
 * Players with no recorded involvement at all are dropped — they carry no
 * evidence in either direction and only add noise to the assignment. If that
 * would empty the pool (a squad with no synced statistics yet), the unfiltered
 * list is used instead, so a data gap degrades to "best guess from positions
 * alone" rather than to no lineup at all.
 */
export function buildCandidates(teamId: number, inputs: CandidateInput[]): TeamCandidates {
  const withEvidence = inputs.filter((i) => hasPlayingEvidence(i.stats));
  const pool = withEvidence.length > 0 ? withEvidence : inputs;

  const normalizers = buildTeamNormalizers(pool.map((i) => i.stats));

  const candidates = pool.map((input) => buildCandidate(input, normalizers));

  return { teamId, candidates, normalizers };
}

function buildCandidate(input: CandidateInput, norm: TeamScoreNormalizers): PlayerCandidate {
  const positions = input.rawPositions
    .slice(0, 3)
    .map((p) => normalizePosition(p)) as (CanonicalPosition | null)[];
  while (positions.length < 3) positions.push(null);

  const naturalPosition = positions.find((p): p is CanonicalPosition => p != null) ?? null;
  const naturalGroup: PositionGroup | null = naturalPosition
    ? groupOf(naturalPosition)
    : groupFromBroadLetter(input.broadPosition);

  // A player whose only positional evidence is the coarse letter 'G' is still
  // a goalkeeper for the purposes of the hard GK gate — otherwise a squad
  // whose keepers lack detailed positions would be reported as having none.
  const isGoalkeeper =
    naturalPosition === 'GK' || (naturalPosition === null && naturalGroup === 'G');

  // The gate in positionSuitability keys off an explicit 'GK' listing, so give
  // letter-only keepers one.
  const effectivePositions: (CanonicalPosition | null)[] =
    isGoalkeeper && naturalPosition === null ? ['GK', null, null] : positions;

  const suitability = new Map<string, number>();
  for (const [code, base] of SLOT_BASE_BY_CODE) {
    suitability.set(code, positionSuitability(base, effectivePositions, naturalGroup));
  }

  return {
    playerId: input.playerId,
    teamId: input.teamId,
    weightedScore: calculateWeightedScore(input.stats, norm),
    matchesStarted: input.stats.matchesStarted,
    appearances: input.stats.appearances,
    minutesPlayed: input.stats.minutesPlayed,
    averageRating: meanRating(input.stats),
    goals: input.stats.goals,
    assists: input.stats.assists,
    primaryPosition: effectivePositions[0] ?? null,
    secondaryPosition: effectivePositions[1] ?? null,
    tertiaryPosition: effectivePositions[2] ?? null,
    naturalPosition: effectivePositions[0] ?? null,
    naturalGroup,
    positionSuitability: suitability,
    isGoalkeeper,
  };
}
