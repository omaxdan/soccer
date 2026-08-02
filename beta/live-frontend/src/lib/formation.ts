import type { PredictedLineupPlayer } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lineup classification.
//
// Since backend migration 025/037 the lineup engine (beta/backend/src/lib/lineups)
// precomputes and stores the formation name and the tactical slot per player.
// This module reads those values and only falls back to its own detection for
// rows written before the engine ran.
//
// This file previously also carried pitch-coordinate placement (placeLineup),
// a versatility badge, and a squad-coverage heatmap — all of it built for the
// pitch view. That view has been removed from the product, and none of those
// three had any other caller, so they were removed with it rather than kept
// as unreachable code. What remains is exactly what PredictedXI.tsx and
// KeyPlayerBattles.tsx import: line classification, natural position, and the
// formation name.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Code vocabulary ─────────────────────────────────────────────────────────
//
// One table covering every notation that can reach this app:
//   - tactical slots written by the engine   GK RB RCB LCB LB RWB LWB
//                                            DM RDM LDM CM RCM LCM AM RM LM
//                                            RW LW ST RST LST
//   - SofaScore squad codes on players.*     DR DC DL MC MR ML DM AM RW LW ST
//   - legacy broad letters on pre-025 rows   G D M F
//
// Reading a code by its first character — which this file used to do — is
// specifically wrong for the tactical vocabulary: 'RB' would classify as a
// midfielder, 'LCB' as a midfielder, 'DM' as a defender.
// LINE_FROM_CODE is the fallback for rows with no position_group at all — a
// pure code-only guess with no formation context. LWB/RWB moved from DEF to
// MID: the request's own explicit mapping lists wing-backs under midfield
// unconditionally, and a code-only fallback can't distinguish a back-3 wing-
// back from a back-4 full-back anyway, so MID is the safer default of the two
// — DEF was silently wrong for every back-3/back-5 shape.
const LINE_FROM_CODE: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  G: "GK", GK: "GK",
  D: "DEF", DC: "DEF", DL: "DEF", DR: "DEF", CB: "DEF", LB: "DEF", RB: "DEF",
  SW: "DEF", RCB: "DEF", LCB: "DEF",
  M: "MID", MC: "MID", ML: "MID", MR: "MID", DM: "MID", AM: "MID", CM: "MID",
  LM: "MID", RM: "MID", RCM: "MID", LCM: "MID", RDM: "MID", LDM: "MID",
  MD: "MID", CDM: "MID", MA: "MID", CAM: "MID", LWB: "MID", RWB: "MID",
  F: "FWD", A: "FWD", S: "FWD", ST: "FWD", CF: "FWD", LW: "FWD", RW: "FWD",
  SS: "FWD", RST: "FWD", LST: "FWD",
};

// The engine's own broad grouping — preferred over the code table above
// because it is the classification the engine actually used to build the
// lineup (formation-context-aware: the same base position can sit in a
// different zone depending on the shape, per
// beta/backend/src/lib/lineups/types.ts's own documented example — wide
// players in a 4-2-3-1 are positionally wingers but count as midfielders in
// that notation), not a code-only re-derivation of it.
//
// FOUND WHILE FIXING PART 1: the backend writes this column as a single
// letter — PositionGroup = 'G' | 'D' | 'M' | 'F' (confirmed directly in the
// backend's own type definition, not assumed from this file's stale
// comment). This lookup table had no single-letter keys at all, meaning
// group.toUpperCase() never matched anything, on any row, ever — the
// backend's already-correct, formation-aware classification was being
// silently discarded on every single lineup, and every player fell through
// to the code-only fallback above regardless of whether a better answer was
// available. The single-letter keys below are the actual fix; the fallback
// table's LWB/RWB correction is defense-in-depth for the genuinely
// contextless case (a row with no group at all), not the primary fix.
const LINE_FROM_GROUP: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  G: "GK", GK: "GK", GOALKEEPER: "GK",
  D: "DEF", DEF: "DEF", DEFENCE: "DEF", DEFENSE: "DEF", DEFENDER: "DEF",
  M: "MID", MID: "MID", MIDFIELD: "MID", MIDFIELDER: "MID",
  F: "FWD", FWD: "FWD", FORWARD: "FWD", ATTACK: "FWD", ATTACKER: "FWD",
};

export function lineOf(code: string | null, group?: string | null): "GK" | "DEF" | "MID" | "FWD" {
  if (group) {
    const fromGroup = LINE_FROM_GROUP[group.toUpperCase()];
    if (fromGroup) return fromGroup;
  }
  return LINE_FROM_CODE[(code ?? "").toUpperCase()] ?? "MID";
}

/** Convenience for lineup rows, which carry both fields. */
export function lineOfPlayer(p: PredictedLineupPlayer): "GK" | "DEF" | "MID" | "FWD" {
  return lineOf(p.position_code, p.position_group);
}

/**
 * The player's own natural position, for the out-of-position indicator and
 * alternate-position display — which are about what a player IS, not where he
 * is being played this weekend. Falls back to the slot code, which on pre-025
 * rows is the broad letter and on newer rows is at least a defensible
 * approximation.
 */
export function naturalPositionOf(p: PredictedLineupPlayer): string | null {
  return p.natural_position ?? p.position_code ?? null;
}

// ─── Formation name ──────────────────────────────────────────────────────────

const DEF_CODES = new Set(["LB", "CB", "RB", "LWB", "RWB", "D", "SW", "DR", "DC", "DL", "RCB", "LCB"]);
const MID_CODES = new Set(["LM", "CM", "RM", "DM", "AM", "M", "MC", "MR", "ML", "RCM", "LCM", "RDM", "LDM"]);
const ATT_CODES = new Set(["LW", "RW", "ST", "CF", "F", "RST", "LST"]);

function countByCodes(players: PredictedLineupPlayer[], codes: Set<string>): number {
  return players.filter((p) => codes.has((p.position_code ?? "").toUpperCase())).length;
}

/**
 * Formation name for a lineup.
 *
 * The engine scores every candidate shape against the available squad and
 * stores the winner on each row, so the stored value is read first — there is
 * nothing left to detect, and detecting it again could only ever disagree.
 *
 * The heuristic below survives as the fallback for rows written before
 * migration 025, where the only positional information stored was a broad
 * G/D/M/F letter. It is deliberately unchanged, including its documented
 * ambiguity between a flat 4-5-1 and a real 4-2-3-1.
 */
export function getFormationName(players: PredictedLineupPlayer[]): string {
  const stored = players.find((p) => p.formation)?.formation;
  if (stored) return stored;

  const defs = countByCodes(players, DEF_CODES);
  const mids = countByCodes(players, MID_CODES);
  const atts = countByCodes(players, ATT_CODES);
  const dms = countByCodes(players, new Set(["DM", "RDM", "LDM"]));
  const ams = countByCodes(players, new Set(["AM"]));

  // A DM count is a much less ambiguous signal than raw band counts for these
  // two specific shapes, so it is checked first.
  if (defs === 4 && dms === 2 && ams >= 1 && mids - dms <= 3) return "4-2-3-1";
  if (defs === 4 && dms === 1 && mids - dms === 4) return "4-1-4-1";

  if (defs === 4 && mids === 4 && atts === 2) return "4-4-2";
  if (defs === 4 && mids === 3 && atts === 3) return "4-3-3";
  if (defs === 4 && mids === 2 && atts >= 3) return "4-2-3-1";
  if (defs === 3 && mids === 5 && atts === 2) return "3-5-2";
  if (defs === 3 && mids === 4 && atts === 3) return "3-4-3";
  if (defs === 5 && mids === 3 && atts === 2) return "5-3-2";
  if (defs === 5 && mids === 4 && atts === 1) return "5-4-1";
  if (defs === 4 && mids === 1 && atts >= 4) return "4-1-4-1";

  return `${defs}-${mids}-${atts}`;
}
