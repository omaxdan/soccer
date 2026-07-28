import type { PredictedLineupPlayer } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Pitch geometry and lineup classification.
//
// Since backend migration 025 the lineup engine (beta/backend/src/lib/lineups)
// precomputes and stores everything this file used to infer: the formation
// name, the tactical slot per player, the broad zone, and exact pitch
// coordinates per formation slot. This module now READS those values and only
// falls back to its own geometry for rows written before the engine ran.
//
// Two things follow from that, and they are the whole point of the change:
//
//  1. A lineup is drawn where the engine put it, not where a client-side
//     lookup table guesses. A 4-2-3-1's two banks, a back three's wing-backs
//     and a 4-3-3's lone holding midfielder all render as the shape the
//     backend actually selected.
//  2. The formation LABEL and the DRAWN shape can no longer disagree, because
//     both come from the same stored row.
//
// Coordinates are normalized 0..1 on a portrait pitch: x 0 = left touchline,
// y 0.94 = own goal (goalkeeper), y ≈0.12 = attacking third. The backend uses
// the identical orientation on a 0-100 scale, so conversion is a divide by 100.
// ─────────────────────────────────────────────────────────────────────────────

export type PitchZone =
  | "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

export interface PlacedPlayer {
  player: PredictedLineupPlayer;
  x: number;
  y: number;
  line: "GK" | "DEF" | "MID" | "FWD";
}

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
const LINE_FROM_CODE: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  // goalkeeper
  G: "GK", GK: "GK",
  // defence
  D: "DEF", SW: "DEF",
  RB: "DEF", DR: "DEF", RWB: "DEF",
  LB: "DEF", DL: "DEF", LWB: "DEF",
  CB: "DEF", DC: "DEF", RCB: "DEF", LCB: "DEF",
  // midfield
  M: "MID",
  DM: "MID", CDM: "MID", RDM: "MID", LDM: "MID",
  CM: "MID", MC: "MID", RCM: "MID", LCM: "MID",
  AM: "MID", CAM: "MID",
  RM: "MID", MR: "MID", LM: "MID", ML: "MID",
  // attack
  F: "FWD", A: "FWD", S: "FWD",
  RW: "FWD", LW: "FWD",
  ST: "FWD", CF: "FWD", SS: "FWD", RST: "FWD", LST: "FWD",
};

/** Broad zone letter written by the engine -> display line. */
const LINE_FROM_GROUP: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  G: "GK", D: "DEF", M: "MID", F: "FWD",
};

/**
 * Display line for a position code, preferring the engine's stored
 * position_group when the caller has one.
 *
 * The group is authoritative where it exists because it is a property of the
 * FORMATION, not of the position: the wide players in a 4-2-3-1 are wingers
 * positionally but belong to the midfield band, which is exactly what makes
 * the shape a 4-2-3-1 rather than a 4-2-4.
 */
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
 * The player's own natural position, for versatility and squad-coverage
 * questions — which are about what a player IS, not where he is being played
 * this weekend. Falls back to the slot code, which on pre-025 rows is the
 * broad letter and on newer rows is at least a defensible approximation.
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

// ─── Per-player flexibility ──────────────────────────────────────────────────

/**
 * Position flexibility for a single lineup player: his natural position plus
 * the alternates he is listed for, and a simple 50-90 score rewarding cover.
 *
 * `primary` is the player's NATURAL position, not the slot he is filling this
 * match — listing a centre-midfielder's primary as "DM" because he is being
 * deployed there would double-count the deployment as versatility.
 */
export function getPositionFlexibility(player: PredictedLineupPlayer): {
  primary: string;
  alternatives: string[];
  flexibilityScore: number;
} {
  const primary = naturalPositionOf(player) || "M";
  const alternatives = [player.secondary_position, player.tertiary_position].filter(Boolean) as string[];
  const flexibilityScore = Math.min(100, 50 + alternatives.length * 20);
  return { primary, alternatives, flexibilityScore };
}

// ─── Placement ───────────────────────────────────────────────────────────────
//
// Fallback geometry for rows with no stored coordinates. Kept separate from
// the ZONE_FROM_CODE table further down (used by coverage()) so tuning where a
// role is DRAWN never changes what coverage() counts as positional depth.

type PlacementZone = "GK" | "LB" | "CB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

const PLACEMENT_ZONE_FROM_CODE: Record<string, PlacementZone> = {
  G: "GK", GK: "GK",
  DL: "LB", LB: "LB", LWB: "LB",
  DR: "RB", RB: "RB", RWB: "RB",
  DC: "CB", CB: "CB", D: "CB", SW: "CB", RCB: "CB", LCB: "CB",
  DM: "DM", MD: "DM", CDM: "DM", RDM: "DM", LDM: "DM",
  MC: "CM", M: "CM", CM: "CM", LM: "CM", RM: "CM", RCM: "CM", LCM: "CM",
  AM: "AM", MA: "AM", CAM: "AM",
  ML: "LW", LW: "LW",
  MR: "RW", RW: "RW",
  ST: "ST", F: "ST", A: "ST", S: "ST", CF: "ST", SS: "ST", RST: "ST", LST: "ST",
};

function placementZoneOf(code: string | null): PlacementZone {
  const c = (code ?? "").toUpperCase();
  return PLACEMENT_ZONE_FROM_CODE[c] ?? "CM"; // unknown code → safest central default
}

const ZONE_TO_LINE: Record<PlacementZone, "GK" | "DEF" | "MID" | "FWD"> = {
  GK: "GK", LB: "DEF", CB: "DEF", RB: "DEF",
  DM: "MID", CM: "MID", AM: "MID",
  LW: "FWD", RW: "FWD", ST: "FWD",
};

// y (depth) per zone — portrait pitch, GK at bottom (0.94), attackers top.
// DM sits deeper than CM, AM higher, so a split midfield reads as two banks.
const ZONE_Y: Record<PlacementZone, number> = {
  GK: 0.94,
  LB: 0.70, CB: 0.74, RB: 0.70,
  DM: 0.58, CM: 0.46, AM: 0.32,
  LW: 0.16, RW: 0.16, ST: 0.13,
};

// x positions per zone, keyed by how many players share that zone this lineup
// — inset well short of the touchlines so wingers sit near the edge of the
// penalty box and central roles stay in the middle third.
const ZONE_X: Record<PlacementZone, number[][]> = {
  GK:  [[0.5]],
  LB:  [[0.14]],
  RB:  [[0.86]],
  CB:  [[0.5], [0.36, 0.64], [0.28, 0.5, 0.72], [0.22, 0.41, 0.59, 0.78]],
  DM:  [[0.5], [0.36, 0.64], [0.28, 0.5, 0.72]],
  CM:  [[0.5], [0.4, 0.6], [0.32, 0.5, 0.68], [0.26, 0.42, 0.58, 0.74]],
  AM:  [[0.5], [0.38, 0.62], [0.22, 0.5, 0.78], [0.18, 0.39, 0.61, 0.82]],
  LW:  [[0.18]],
  RW:  [[0.82]],
  ST:  [[0.5], [0.42, 0.58], [0.32, 0.5, 0.68]],
};

function xsFor(zone: PlacementZone, count: number): number[] {
  const table = ZONE_X[zone];
  const row = table[count - 1] ?? table[table.length - 1];
  if (count <= row.length) return row;
  // more players than templated (rare) — even-spread within the same inset
  // bounds as the widest templated row for this zone.
  const lo = row[0], hi = row[row.length - 1];
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, count - 1));
}

/** True when the engine stored real coordinates for this row. */
function hasStoredCoords(p: PredictedLineupPlayer): boolean {
  return (
    p.x != null && p.y != null &&
    Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
  );
}

/**
 * Places an XI on the pitch.
 *
 * Uses the engine's stored per-slot coordinates when every player has them —
 * the formation was chosen as a whole, so mixing stored positions with
 * fallback-template positions would draw a shape that is neither. A single
 * missing coordinate drops the whole team back to the zone templates, which
 * is the correct all-or-nothing behaviour.
 */
export function placeLineup(players: PredictedLineupPlayer[]): {
  placed: PlacedPlayer[];
  formation: string;
} {
  const formation = getFormationName(players);

  // Per-player, not all-or-nothing.
  //
  // This previously required players.every(hasStoredCoords), so ONE null
  // coordinate anywhere in the eleven dropped the whole team to template
  // geometry — a partially populated engine run rendered identically to no
  // engine run at all, which is the hardest kind of failure to notice.
  //
  // Stored coordinates are now used wherever they exist. Anyone missing them
  // is placed by the fallback geometry below, so a mixed row draws the real
  // shape for the players the engine reached and a sensible approximation for
  // the rest.
  const stored: PlacedPlayer[] = [];
  const needsFallback: PredictedLineupPlayer[] = [];
  for (const player of players) {
    if (hasStoredCoords(player)) {
      stored.push({
        player,
        x: Number(player.x) / 100,
        y: Number(player.y) / 100,
        line: lineOfPlayer(player),
      });
    } else {
      needsFallback.push(player);
    }
  }
  if (needsFallback.length === 0) return { placed: stored, formation };

  // Fallback geometry for whoever the engine did not place (pre-025 rows, or a
  // partial run).
  const byZone = new Map<PlacementZone, PredictedLineupPlayer[]>();
  for (const p of needsFallback) {
    const z = placementZoneOf(p.position_code);
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  }
  // rank within zone for stable left-to-right ordering
  for (const list of byZone.values()) {
    list.sort((a, b) => (a.rank_in_position ?? 0) - (b.rank_in_position ?? 0));
  }

  const placed: PlacedPlayer[] = [...stored];
  for (const [zone, list] of byZone) {
    const xs = xsFor(zone, list.length);
    list.forEach((player, i) => {
      placed.push({ player, x: xs[i], y: ZONE_Y[zone], line: ZONE_TO_LINE[zone] });
    });
  }

  return { placed, formation };
}

// ─── Unit confidence ─────────────────────────────────────────────────────────

/** Average predicted-lineup confidence per line. */
export function unitConfidence(players: PredictedLineupPlayer[]) {
  const acc: Record<string, number[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of players) {
    const ln = lineOfPlayer(p);
    if (p.confidence != null) acc[ln].push(p.confidence * (p.confidence <= 1 ? 100 : 1));
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  return {
    goalkeeper: avg(acc.GK),
    defence: avg(acc.DEF),
    midfield: avg(acc.MID),
    attack: avg(acc.FWD),
  };
}

// ─── Versatility ─────────────────────────────────────────────────────────────

/**
 * Versatility badge, e.g. "AM/MC/RW" — the positions the player can play.
 *
 * Built from his NATURAL position plus his listed alternates. Using the
 * tactical slot here would report a centre-midfielder fielded at DM as
 * "DM/MC/AM" and count the deployment itself as versatility.
 */
export function versatilityBadge(p: PredictedLineupPlayer): string {
  const parts = [naturalPositionOf(p), p.secondary_position, p.tertiary_position]
    .filter(Boolean)
    .map((c) => (c as string).toUpperCase());
  return Array.from(new Set(parts)).join("/");
}

// Positional coverage across a squad: how many players can cover each zone,
// counting primary/secondary/tertiary positions.
const ZONE_FROM_CODE: Record<string, PitchZone> = {
  G: "GK", GK: "GK",
  DC: "CB", CB: "CB", D: "CB", RCB: "CB", LCB: "CB", SW: "CB",
  DL: "LB", LB: "LB", LWB: "LB",
  DR: "RB", RB: "RB", RWB: "RB",
  DM: "DM", MD: "DM", CDM: "DM", RDM: "DM", LDM: "DM",
  MC: "CM", M: "CM", CM: "CM", RCM: "CM", LCM: "CM",
  AM: "AM", MA: "AM", CAM: "AM",
  ML: "LW", LW: "LW", LM: "LW",
  MR: "RW", RW: "RW", RM: "RW",
  ST: "ST", F: "ST", A: "ST", S: "ST", CF: "ST", SS: "ST", RST: "ST", LST: "ST",
};

function zoneOf(code: string | null | undefined): PitchZone | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return ZONE_FROM_CODE[c] ?? ZONE_FROM_CODE[c.charAt(0)] ?? null;
}

export interface ZoneCoverage {
  zone: PitchZone;
  label: string;
  count: number;
  level: "high" | "medium" | "low";
}

const ZONE_LABELS: Record<PitchZone, string> = {
  GK: "Goalkeeper", CB: "Centre back", LB: "Left back", RB: "Right back",
  DM: "Defensive mid", CM: "Central mid", AM: "Attacking mid",
  LW: "Left wing", RW: "Right wing", ST: "Striker",
};

export function coverage(players: PredictedLineupPlayer[]): {
  zones: ZoneCoverage[];
  flexibilityScore: number;
} {
  const counts = new Map<PitchZone, number>();
  for (const p of players) {
    // Natural position, not the assigned slot — coverage asks what the squad
    // CAN field, which is independent of this weekend's team sheet.
    const zs = new Set(
      [naturalPositionOf(p), p.secondary_position, p.tertiary_position]
        .map(zoneOf)
        .filter(Boolean) as PitchZone[]
    );
    zs.forEach((z) => counts.set(z, (counts.get(z) ?? 0) + 1));
  }
  const order: PitchZone[] = ["GK", "LB", "CB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
  const zones: ZoneCoverage[] = order.map((z) => {
    const count = counts.get(z) ?? 0;
    const level = count >= 3 ? "high" : count === 2 ? "medium" : "low";
    return { zone: z, label: ZONE_LABELS[z], count, level };
  });
  // flexibility = share of zones with 2+ options, scaled
  const covered = zones.filter((z) => z.count >= 2).length;
  const flexibilityScore = Math.round((covered / order.length) * 100);
  return { zones, flexibilityScore };
}
