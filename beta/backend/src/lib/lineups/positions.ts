/**
 * PREDICTED LINEUPS ENGINE — position vocabulary and compatibility
 *
 * Two responsibilities:
 *
 *   1. NORMALIZATION. Squad sync stores `players.primary_position` verbatim
 *      from SofaScore's `positionsDetailed` array (syncSquadSofaScore.ts), which
 *      uses DR/DC/DL/MC/MR/ML notation. Other rows carry the coarse
 *      `players.position` letter (G/D/M/F), and a few carry Anglo notation
 *      (RB/CB/CDM). Everything is folded into one canonical vocabulary here so
 *      no downstream module has to know about the variants.
 *
 *   2. COMPATIBILITY. How well a player whose natural position is X can fill a
 *      slot demanding position Y, expressed 0..1. This is the football
 *      knowledge in the engine: a right-back covers at right wing-back almost
 *      for free (0.95), can be pushed into central defence at a real cost
 *      (0.70), and should essentially never appear at left-back (0.55) —
 *      left/right is a genuine barrier, not a rounding error.
 *
 * Suitability then combines compatibility with WHERE the position appeared in
 * the player's own listing: their primary position counts in full, their
 * secondary at 0.90, their tertiary at 0.75 (POSITION_TIER_WEIGHTS).
 */

import type { CanonicalPosition, PositionGroup } from './types';

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Raw source code -> canonical position. Covers SofaScore's own notation
 * (DR/DC/DL/MC/MR/ML/AM/DM/LW/RW/ST), Anglo notation that appears in some
 * rows, and the sweeper/centre-forward variants.
 *
 * Deliberately does NOT include the coarse G/D/M/F letters — those are far
 * less specific than a real position code and would silently claim, for
 * example, that every 'D' is a centre-back. They are handled separately by
 * `groupFromBroadLetter`, which yields a zone but no position.
 */
const POSITION_ALIASES: Record<string, CanonicalPosition> = {
  // Goalkeeper
  GK: 'GK', G: 'GK', GOALKEEPER: 'GK',

  // Full-backs / wing-backs
  DR: 'RB', RB: 'RB', RCB: 'CB', RWB: 'RWB', WBR: 'RWB',
  DL: 'LB', LB: 'LB', LCB: 'CB', LWB: 'LWB', WBL: 'LWB',

  // Central defence
  DC: 'CB', CB: 'CB', SW: 'CB', CD: 'CB',

  // Midfield
  DM: 'DM', CDM: 'DM', DMC: 'DM', RDM: 'DM', LDM: 'DM',
  MC: 'CM', CM: 'CM', RCM: 'CM', LCM: 'CM',
  AM: 'AM', CAM: 'AM', AMC: 'AM',
  MR: 'RM', RM: 'RM',
  ML: 'LM', LM: 'LM',

  // Wide attack
  RW: 'RW', AMR: 'RW', RAM: 'RW', RF: 'RW',
  LW: 'LW', AML: 'LW', LAM: 'LW', LF: 'LW',

  // Central attack
  ST: 'ST', CF: 'ST', FW: 'ST', SS: 'ST', RST: 'ST', LST: 'ST',
};

/** Normalizes any raw position string to the canonical vocabulary, or null. */
export function normalizePosition(raw: string | null | undefined): CanonicalPosition | null {
  if (!raw) return null;
  return POSITION_ALIASES[raw.trim().toUpperCase()] ?? null;
}

/** Broad zone of a canonical position. */
const POSITION_GROUPS: Record<CanonicalPosition, PositionGroup> = {
  GK: 'G',
  RB: 'D', RWB: 'D', CB: 'D', LB: 'D', LWB: 'D',
  DM: 'M', CM: 'M', AM: 'M', RM: 'M', LM: 'M',
  RW: 'F', LW: 'F', ST: 'F',
};

export function groupOf(position: CanonicalPosition): PositionGroup {
  return POSITION_GROUPS[position];
}

/**
 * Zone from the coarse `players.position` letter. Used only when a player has
 * no usable detailed position at all — it supports the 0.50 fallback tier but
 * never claims a specific position.
 */
export function groupFromBroadLetter(raw: string | null | undefined): PositionGroup | null {
  const c = (raw ?? '').trim().toUpperCase();
  if (c === 'G' || c === 'GK') return 'G';
  if (c === 'D') return 'D';
  if (c === 'M') return 'M';
  if (c === 'F') return 'F';
  return null;
}

/**
 * Broad zone of a position code as STORED on a row — a tactical slot code
 * ('RCB'), a raw squad-sync code ('DC'), or a legacy broad letter ('D').
 *
 * This is the compatibility shim for everything that used to read
 * match_predicted_lineups.position_code as a G/D/M/F letter. New code should
 * read the position_group column directly; this exists for rows written before
 * migration 025 and for callers that only have a code in hand.
 */
export function zoneOfPositionCode(code: string | null | undefined): PositionGroup | null {
  const canonical = normalizePosition(code);
  if (canonical) return groupOf(canonical);
  return groupFromBroadLetter(code);
}

// ─── Compatibility matrix ────────────────────────────────────────────────────

/**
 * SLOT -> { natural position: compatibility 0..1 }.
 *
 * Read as: "to fill a <SLOT>, a natural <key> player is worth <value>".
 * A position absent from a slot's map is not flatly ineligible — it falls
 * through to the same-zone fallback in `positionSuitability` — but it is
 * heavily penalized, which is the intent.
 *
 * Symmetry note: same-side moves are cheap (RB->RWB 0.95), vertical moves cost
 * moderately (RB->RM 0.75, CB->DM 0.80), and cross-side moves are expensive
 * (RB->LB 0.55). The v1 matrix treated left and right as interchangeable,
 * which produced lineups with inverted full-backs at no cost.
 */
export const POSITION_COMPATIBILITY: Record<CanonicalPosition, Partial<Record<CanonicalPosition, number>>> = {
  // The goalkeeper slot is closed — see GK_ONLY handling in positionSuitability.
  GK: { GK: 1.00 },

  RB:  { RB: 1.00, RWB: 0.95, RM: 0.75, CB: 0.70, RW: 0.65, LB: 0.55, LWB: 0.50 },
  RWB: { RWB: 1.00, RB: 0.95, RM: 0.85, RW: 0.80, CB: 0.55, LWB: 0.50, LB: 0.50 },
  LB:  { LB: 1.00, LWB: 0.95, LM: 0.75, CB: 0.70, LW: 0.65, RB: 0.55, RWB: 0.50 },
  LWB: { LWB: 1.00, LB: 0.95, LM: 0.85, LW: 0.80, CB: 0.55, RWB: 0.50, RB: 0.50 },
  CB:  { CB: 1.00, DM: 0.80, RB: 0.70, LB: 0.70, RWB: 0.55, LWB: 0.55, CM: 0.50 },

  DM:  { DM: 1.00, CM: 0.90, CB: 0.75, AM: 0.65, RM: 0.55, LM: 0.55 },
  CM:  { CM: 1.00, DM: 0.95, AM: 0.90, RM: 0.70, LM: 0.70, RW: 0.55, LW: 0.55 },
  AM:  { AM: 1.00, CM: 0.90, RW: 0.80, LW: 0.80, ST: 0.75, RM: 0.70, LM: 0.70, DM: 0.60 },
  RM:  { RM: 1.00, RW: 0.90, RWB: 0.80, CM: 0.70, RB: 0.70, AM: 0.70, LM: 0.55 },
  LM:  { LM: 1.00, LW: 0.90, LWB: 0.80, CM: 0.70, LB: 0.70, AM: 0.70, RM: 0.55 },

  RW:  { RW: 1.00, RM: 0.90, AM: 0.80, ST: 0.70, RWB: 0.65, LW: 0.55, RB: 0.50, CM: 0.50 },
  LW:  { LW: 1.00, LM: 0.90, AM: 0.80, ST: 0.70, LWB: 0.65, RW: 0.55, LB: 0.50, CM: 0.50 },
  ST:  { ST: 1.00, AM: 0.75, RW: 0.70, LW: 0.70, CM: 0.45 },
};

/**
 * How much a position counts depending on where it appears in the player's own
 * listing. `players.primary_position` is positionsDetailed[0] — the position
 * SofaScore ranks first for that player — so it is taken at face value, while
 * a tertiary listing is a genuine but weaker claim.
 */
export const POSITION_TIER_WEIGHTS = [1.00, 0.90, 0.75] as const;

/**
 * Suitability when the player has no position in common with the slot but does
 * play in the same broad zone (a natural CB asked to play RB with no RB listing
 * at all). Low enough that the optimizer avoids it whenever a real option
 * exists, high enough that it still beats leaving the slot empty.
 */
export const SAME_GROUP_FALLBACK = 0.50;

/**
 * Suitability for a completely alien assignment (a striker at centre-back).
 * Non-zero purely so the assignment problem always has a solution and the
 * engine can guarantee eleven players — never because such a move is
 * defensible. Squared inside the optimizer this contributes ~0.06 of a
 * natural-position player's score, so it only ever wins when nothing else is
 * available.
 */
export const CROSS_GROUP_FALLBACK = 0.25;

/**
 * Suitability of one player for one slot, 0..1.
 *
 * Takes the best of the player's up-to-three listed positions, each scored as
 * compatibility(slot, position) × tier weight, then falls back to the zone
 * tiers when none of them are recognized by the slot.
 *
 * The goalkeeper slot is a hard gate: a player with no goalkeeping listing
 * scores exactly 0 and therefore can never be assigned there, no matter how
 * short the squad is. Fielding an outfielder in goal was the single worst
 * failure mode available to the v1 engine.
 */
export function positionSuitability(
  slotBase: CanonicalPosition,
  playerPositions: (CanonicalPosition | null)[],
  playerGroup: PositionGroup | null,
): number {
  const compat = POSITION_COMPATIBILITY[slotBase];

  if (slotBase === 'GK') {
    return playerPositions.some((p) => p === 'GK') ? 1.00 : 0;
  }
  // A goalkeeper is never an outfield option either — the reverse of the gate
  // above. Without this a squad's third-choice keeper can outscore a genuine
  // but low-minutes defender on weightedScore alone.
  if (playerPositions[0] === 'GK') return 0;

  let best = 0;
  for (let tier = 0; tier < playerPositions.length && tier < POSITION_TIER_WEIGHTS.length; tier++) {
    const pos = playerPositions[tier];
    if (!pos) continue;
    const c = compat[pos];
    if (c === undefined) continue;
    const value = c * POSITION_TIER_WEIGHTS[tier];
    if (value > best) best = value;
  }
  if (best > 0) return best;

  if (playerGroup && playerGroup === groupOf(slotBase)) return SAME_GROUP_FALLBACK;
  return CROSS_GROUP_FALLBACK;
}

/**
 * Whether an assignment counts as "out of position" for reporting and for the
 * formation tie-break.
 *
 * The threshold sits just under the secondary-position tier: a player listed
 * at the slot as their second position scores 0.90 and is NOT flagged (that is
 * a normal, intended selection), while anything relying on cross-position
 * compatibility or a zone fallback is.
 */
export const OUT_OF_POSITION_THRESHOLD = 0.90;

export function isOutOfPosition(suitability: number): boolean {
  return suitability < OUT_OF_POSITION_THRESHOLD;
}
