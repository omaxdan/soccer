// ─────────────────────────────────────────────────────────────────────────────
// MODULE CHARACTERIZED OUTCOME — ratified S-9A C-semantics (governance encoding)
//
// This module RECORDS, as a single governed source of truth, what each module
// version's status CHARACTERIZES against MATCH_RESULT. It performs NO calibration,
// NO hit-rate, NO scoring — it only states the ratified claim, so that S-9C (later)
// measures a PRE-DECLARED characterization rather than discovering one. This is the
// anti-circularity direction the governance mandates:
//
//   module semantics → characterized outcome → derivation → observation → calibration
//
// RATIFIED (S-9A, both modules; identical directional semantics):
//   SUPPORTS    → characterizes HOME_WIN   (specific opposite outcome)
//   CONTRADICTS → characterizes AWAY_WIN   (specific opposite outcome)
//   DRAW        → FAILURE for BOTH directional bands (structural: DRAW is neither
//                 HOME_WIN nor AWAY_WIN, so it can never satisfy either band)
//   NEUTRAL     → abstention; excluded from the directional denominator (C-e)
//   INACTIVE    → NOT a band; excluded entirely (C-f)
//
// The valid band vocabulary is SUPPORTS / CONTRADICTS / NEUTRAL. No V1 magnitude /
// probability / winner / edge bands.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchResultOutcome } from './outcome/deriveMatchResult';

/** The four module statuses (mirrors module.module_status). */
export type ModuleStatus = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL' | 'INACTIVE';

/** The three governed band values. INACTIVE is never a band. */
export type CalibrationBand = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/** What a status characterizes, without any scoring being performed. */
export type Characterization =
  | { readonly kind: 'DIRECTIONAL'; readonly band: 'SUPPORTS' | 'CONTRADICTS'; readonly outcome: MatchResultOutcome }
  | { readonly kind: 'ABSTAIN'; readonly band: 'NEUTRAL' }
  | { readonly kind: 'NOT_A_BAND' }; // INACTIVE

/** Composite key `moduleKey@designation`. */
type ModuleVersionKey = string;
const key = (moduleKey: string, designation: string): ModuleVersionKey => `${moduleKey}@${designation}`;

/**
 * The ratified per-module-version directional characterization. Every entry uses the
 * S-9A-ratified specific-opposite semantics (SUPPORTS→HOME_WIN, CONTRADICTS→AWAY_WIN).
 * A module version absent from this table has no ratified characterization and must
 * not be scored — S-9C must refuse rather than assume.
 */
const RATIFIED: ReadonlyMap<ModuleVersionKey, { readonly SUPPORTS: MatchResultOutcome; readonly CONTRADICTS: MatchResultOutcome }> = new Map([
  [key('rest_advantage', '1.0.0'), { SUPPORTS: 'HOME_WIN', CONTRADICTS: 'AWAY_WIN' }],
  [key('form_gap_accuracy', '1.0.0'), { SUPPORTS: 'HOME_WIN', CONTRADICTS: 'AWAY_WIN' }],
]);

/** True when a module version has a ratified characterization (governed for S-9C). */
export function hasRatifiedCharacterization(moduleKey: string, designation: string): boolean {
  return RATIFIED.has(key(moduleKey, designation));
}

/**
 * The ratified characterization of a status for a module version. Pure; performs no
 * scoring. Throws for an unratified module version (S-9C must not assume semantics).
 * INACTIVE → NOT_A_BAND; NEUTRAL → ABSTAIN; SUPPORTS/CONTRADICTS → DIRECTIONAL.
 */
export function characterizedOutcome(moduleKey: string, designation: string, status: ModuleStatus): Characterization {
  if (status === 'INACTIVE') return { kind: 'NOT_A_BAND' };
  if (status === 'NEUTRAL') return { kind: 'ABSTAIN', band: 'NEUTRAL' };
  const entry = RATIFIED.get(key(moduleKey, designation));
  if (!entry) {
    throw new Error(`no ratified characterized outcome for ${moduleKey}@${designation}; S-9A ratification required before scoring`);
  }
  return { kind: 'DIRECTIONAL', band: status, outcome: entry[status] };
}

/**
 * Structural statement of the ratified DRAW rule: a DRAW satisfies NEITHER
 * directional band, because neither band characterizes DRAW. Exposed so the S-9A
 * "DRAW = FAILURE for both bands" decision is verifiable here without any scoring
 * machinery. (This is a property of the characterization, not a calibration result.)
 */
export function directionalBandCharacterizesDraw(moduleKey: string, designation: string): boolean {
  const entry = RATIFIED.get(key(moduleKey, designation));
  if (!entry) return false;
  return (entry.SUPPORTS as MatchResultOutcome) === 'DRAW' || (entry.CONTRADICTS as MatchResultOutcome) === 'DRAW';
}
