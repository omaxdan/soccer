/**
 * PREDICTED LINEUPS ENGINE — per-player confidence
 *
 * Confidence answers one question: how sure are we that THIS player starts in
 * THIS slot?
 *
 * The v1 implementation compared each selected player against the next player
 * in the output array. Because that array was ordered by position group, the
 * goalkeeper was routinely compared against a right-back and the last defender
 * against the first midfielder. The resulting number was arithmetic performed
 * on unrelated players.
 *
 * Here, every selection is compared against the best alternative for the SAME
 * tactical slot — the understudy who would actually play there. A goalkeeper
 * 20 points clear of the backup scores very high; a right-back two points
 * clear of an equally established rival scores low, which is the honest
 * answer for a genuine selection dilemma.
 *
 * Four further signals shade the result, because a large gap over a weak
 * understudy is not the same as a large gap over nobody:
 *
 *   suitability   playing in your natural position is more predictable than
 *                 being shuffled somewhere else
 *   starts        an established starter is more predictable than someone with
 *                 two starts who happens to lead a thin position
 *   minutes       distinguishes a full-time starter from a rotation option
 *   rating        quality lends stability to selection
 *
 * Output is 0-1, matching the existing match_predicted_lineups.confidence
 * column (v1 also stored 0-1, having computed 0-100 and divided).
 */

import type { PlayerCandidate, SlotAssignment } from './types';

export const CONFIDENCE_WEIGHTS = {
  /** Gap to the best alternative for the same slot. */
  separation: 0.40,
  /** How natural the assignment is. */
  suitability: 0.20,
  /** Share of the squad-leading start count. */
  starts: 0.20,
  /** Share of the squad-leading minutes total. */
  minutes: 0.10,
  /** Match rating, normalized across the band that discriminates. */
  rating: 0.10,
} as const;

/** Squad-level maxima so the volume terms are relative to the player's own team. */
export interface ConfidenceNormalizers {
  maxStarts: number;
  maxMinutes: number;
}

/**
 * Confidence never reaches 0 or 1: a predicted lineup is a probabilistic
 * statement, and reporting certainty about a player who might be rested on the
 * morning of the match would be false precision. The floor keeps a genuinely
 * unconvincing selection visible as "we are guessing" rather than "no".
 */
const CONFIDENCE_FLOOR = 0.05;
const CONFIDENCE_CEILING = 0.97;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Confidence for one assignment.
 *
 * @param assignment  the selected player and the slot they fill
 * @param rivals      candidates NOT in the XI, in any order — the best fit for
 *                    this slot among them is the understudy to compare against
 * @param norm        squad maxima for the volume terms
 */
export function calculateConfidence(
  assignment: SlotAssignment,
  rivals: PlayerCandidate[],
  norm: ConfidenceNormalizers,
): number {
  const { candidate, slot, suitability } = assignment;
  const selectedScore = candidate.weightedScore * suitability * suitability;

  // Best alternative for this exact slot. Rivals who cannot play the slot at
  // all (suitability 0 — an outfielder for the goalkeeper slot) are not
  // competition and are excluded.
  let bestRivalScore = 0;
  for (const r of rivals) {
    const s = r.positionSuitability.get(slot.code) ?? 0;
    if (s <= 0) continue;
    const score = r.weightedScore * s * s;
    if (score > bestRivalScore) bestRivalScore = score;
  }

  // No credible understudy means the selection is as safe as the data allows.
  const separation =
    selectedScore > 0 ? clamp01((selectedScore - bestRivalScore) / selectedScore) : 0;

  const startsShare = clamp01(candidate.matchesStarted / Math.max(1, norm.maxStarts));
  const minutesShare = clamp01(candidate.minutesPlayed / Math.max(1, norm.maxMinutes));
  // Same 5.5-8.0 discriminating band used by the weighted score.
  const ratingNorm = candidate.averageRating > 0
    ? clamp01((candidate.averageRating - 5.5) / 2.5)
    : 0;

  const raw =
    CONFIDENCE_WEIGHTS.separation * separation +
    CONFIDENCE_WEIGHTS.suitability * suitability +
    CONFIDENCE_WEIGHTS.starts * startsShare +
    CONFIDENCE_WEIGHTS.minutes * minutesShare +
    CONFIDENCE_WEIGHTS.rating * ratingNorm;

  return round3(Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, raw)));
}

/**
 * Team-level confidence in the SHAPE, as opposed to the personnel.
 *
 * Starts from the mean per-player confidence, then damps it by how narrowly
 * the winning formation beat the runner-up: if two shapes fit the squad
 * equally well, we are less sure which one the manager picks, even when we are
 * confident about the eleven names.
 */
export function calculateFormationConfidence(
  playerConfidences: number[],
  formationMargin: number,
): number {
  if (playerConfidences.length === 0) return 0;
  const mean = playerConfidences.reduce((a, b) => a + b, 0) / playerConfidences.length;
  const damp = 0.85 + 0.15 * clamp01(formationMargin);
  return round3(clamp01(mean * damp));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
