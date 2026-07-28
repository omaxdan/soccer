/**
 * PREDICTED LINEUPS ENGINE — shared types
 *
 * These types are the contract between the engine modules (positions,
 * formations, scoring, optimizer, confidence) and the jobs that use them
 * (processPredictedLineups, processStartingXIStrength). Nothing here touches
 * the database or the network.
 */

// ─── Positions ───────────────────────────────────────────────────────────────

/**
 * Canonical position vocabulary. Source data (SofaScore `positionsDetailed`)
 * uses a mix of notations — DR/DC/DL/MC/MR/ML alongside RB/CB/LB/CM — so every
 * raw code is normalized into exactly one of these before use.
 */
export type CanonicalPosition =
  | 'GK'
  | 'RB' | 'RWB' | 'CB' | 'LB' | 'LWB'
  | 'DM' | 'CM' | 'AM' | 'RM' | 'LM'
  | 'RW' | 'LW' | 'ST';

/** Broad zone. Matches the G/D/M/F letters the v1 engine wrote to position_code. */
export type PositionGroup = 'G' | 'D' | 'M' | 'F';

// ─── Formations ──────────────────────────────────────────────────────────────

/**
 * One slot in a formation — a position on the pitch that needs exactly one
 * player.
 */
export interface FormationSlot {
  /**
   * Tactical slot code as stored in match_predicted_lineups.position_code /
   * .tactical_position. Side-qualified where a formation fields more than one
   * of a position: 'RCB' and 'LCB' rather than 'CB' twice.
   */
  code: string;
  /**
   * Canonical position this slot demands, used to look up compatibility.
   * 'RCB' and 'LCB' both demand 'CB'.
   */
  base: CanonicalPosition;
  /**
   * Depth-chart family for rank_in_position. Both centre-backs rank within
   * 'CB' (CB 1, CB 2); all three central midfielders rank within 'CM'.
   * Usually equal to `base`.
   */
  family: CanonicalPosition;
  /**
   * Broad zone written to position_group. Declared per slot rather than
   * derived from `base`, because the same base position sits in different
   * zones in different shapes: the wide players in a 4-2-3-1 are wingers
   * positionally ('RW'/'LW') but count as midfielders in the 4-2-3-1 notation.
   */
  group: PositionGroup;
  /** Pitch x, 0 = left touchline, 100 = right touchline. */
  x: number;
  /** Pitch y, 0 = opponent goal line, 100 = own goal line. */
  y: number;
  /** Render order within the XI, 1..11 — back to front, right to left. */
  order: number;
  /** Human-readable role, e.g. 'centre-back', 'holding midfielder'. */
  role: string;
}

export interface Formation {
  /** Display name as stored, e.g. '4-3-3'. */
  name: string;
  /** Compact key used in config and logs, e.g. '433'. */
  key: string;
  /** Exactly 11 slots, exactly one of which is the goalkeeper. */
  slots: FormationSlot[];
}

// ─── Candidates ──────────────────────────────────────────────────────────────

/**
 * A player considered for selection, with every signal the engine needs
 * precomputed. Built once per team per run; reused across every formation
 * evaluated for that team.
 */
export interface PlayerCandidate {
  playerId: number;
  teamId: number;

  /** 0-100 selection score, normalized within the player's own team. */
  weightedScore: number;

  // Raw signals behind weightedScore, kept for confidence and for storage.
  matchesStarted: number;
  appearances: number;
  minutesPlayed: number;
  averageRating: number;
  goals: number;
  assists: number;

  /** Normalized primary/secondary/tertiary positions; null when absent. */
  primaryPosition: CanonicalPosition | null;
  secondaryPosition: CanonicalPosition | null;
  tertiaryPosition: CanonicalPosition | null;

  /**
   * Best available statement of where this player actually plays: the
   * primary position, falling back to the broad `players.position` letter.
   */
  naturalPosition: CanonicalPosition | null;

  /** Broad zone of naturalPosition — used for the fallback suitability tier. */
  naturalGroup: PositionGroup | null;

  /**
   * Suitability for every slot code in every formation, precomputed once:
   * slotCode -> 0..1. Avoids recomputing the compatibility lookup inside the
   * per-formation optimizer loop.
   */
  positionSuitability: Map<string, number>;

  /** True when this player can keep goal — the GK slot is closed to everyone else. */
  isGoalkeeper: boolean;
}

// ─── Assignment ──────────────────────────────────────────────────────────────

/** One player placed in one slot. */
export interface SlotAssignment {
  slot: FormationSlot;
  candidate: PlayerCandidate;
  /** Suitability of this candidate for this slot, 0..1. */
  suitability: number;
  /** weightedScore × suitability² — the quantity the optimizer maximizes. */
  score: number;
}

/** Result of assigning a full XI under one candidate formation. */
export interface FormationEvaluation {
  formation: Formation;
  assignments: SlotAssignment[];
  /** Σ of assignment scores. Comparable across formations. */
  totalScore: number;
  /** Players filling a slot that is not their natural position. */
  outOfPositionCount: number;
  /** False when the shape could not be filled (no goalkeeper, too few players). */
  feasible: boolean;
  /** Why an infeasible evaluation failed — for logging. */
  reason?: string;
}

/** A fully resolved XI, ready to be written. */
export interface PredictedLineup {
  teamId: number;
  formation: Formation;
  formationScore: number;
  /** 0-1 team-level confidence in the shape itself. */
  formationConfidence: number;
  outOfPositionCount: number;
  players: PredictedLineupPlayer[];
}

export interface PredictedLineupPlayer {
  playerId: number;
  slot: FormationSlot;
  candidate: PlayerCandidate;
  suitability: number;
  /** 0-1 confidence that this specific player starts in this specific slot. */
  confidence: number;
  /** Depth-chart rank within the slot family: CB 1, CB 2, CM 1, CM 2, CM 3. */
  rankInPosition: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
}
