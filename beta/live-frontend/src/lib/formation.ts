import type { PredictedLineupPlayer } from "./types";

// Dynamic formation geometry — no hardcoded formations. Players are bucketed
// into lines from their position code, then distributed across coordinate
// templates. Coordinates are normalized 0..1 on a portrait pitch where the
// goalkeeper sits at the bottom (y≈0.94) and attackers at the top (y≈0.12).

export type PitchZone =
  | "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

export interface PlacedPlayer {
  player: PredictedLineupPlayer;
  x: number;
  y: number;
  line: "GK" | "DEF" | "MID" | "FWD";
}

const FWD_CODES = new Set(["F", "A", "S", "W", "CF", "SS"]); // forwards / attackers / strikers / wingers / second striker

export function lineOf(code: string | null): "GK" | "DEF" | "MID" | "FWD" {
  const c = (code ?? "").charAt(0).toUpperCase();
  if (c === "G") return "GK";
  if (c === "D") return "DEF";
  if (c === "M") return "MID";
  if (FWD_CODES.has(c)) return "FWD";
  return "MID";
}

// Named formation detection — ported from the backend's detectFormation()
// (beta/backend/src/jobs/processExtendedIntelligence.ts) so the frontend
// labels a lineup exactly the way the backend already does. Classification
// runs on the exact position_code per player, not a coarse GK/DEF/MID/FWD
// line count — that distinction matters: a flat 4-5-1 and a real 4-2-3-1
// (2 DM + 3 AM = 5 "mid-line" players either way) only come apart once you
// count DM/AM/wide-forward codes separately, which line-counting can't do.
const DEF_CODES = new Set(["LB", "CB", "RB", "LWB", "RWB", "D", "SW"]);
const MID_CODES = new Set(["LM", "CM", "RM", "DM", "AM", "M"]);
const ATT_CODES = new Set(["LW", "RW", "ST", "CF", "F"]);

function countByCodes(players: PredictedLineupPlayer[], codes: Set<string>): number {
  return players.filter((p) => codes.has((p.position_code ?? "").toUpperCase())).length;
}

// Named formation detection from a lineup — recognizes the common shapes,
// falls back to the raw def-mid-fwd string for anything else.
export function getFormationName(players: PredictedLineupPlayer[]): string {
  const defs = countByCodes(players, DEF_CODES);
  const mids = countByCodes(players, MID_CODES);
  const atts = countByCodes(players, ATT_CODES);
  const dms = countByCodes(players, new Set(["DM"]));
  const ams = countByCodes(players, new Set(["AM"]));

  // Refinements ahead of the ported backend rules below: the backend's raw
  // defs/mids/atts counts assume a 4-2-3-1's advanced "3" and a 4-1-4-1's
  // flat "4" are coded with forward-bucket codes (LW/RW/ST) — real data
  // often codes them as AM/CM instead, which the counts alone can't tell
  // apart from a 4-3-3 or 4-5-1. A DM count is a much less ambiguous
  // signal for these two specific required shapes, so it's checked first.
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

// Position flexibility for a single lineup player: primary + alternates and
// a simple 50-90 score that rewards having secondary/tertiary cover.
export function getPositionFlexibility(player: PredictedLineupPlayer): {
  primary: string;
  alternatives: string[];
  flexibilityScore: number;
} {
  const primary = player.position_code || "M";
  const alternatives = [player.secondary_position, player.tertiary_position].filter(Boolean) as string[];
  const flexibilityScore = Math.min(100, 50 + alternatives.length * 20);
  return { primary, alternatives, flexibilityScore };
}

// ── Realistic role placement ──────────────────────────────────────────────
// Placement zone — finer-grained than the GK/DEF/MID/FWD line, used only to
// pick a realistic (x, y) on the pitch. Kept local to this file (separate
// from the ZONE_FROM_CODE table below used by coverage()) so tuning where a
// role is DRAWN never changes what coverage() counts as a team's positional
// depth.
type PlacementZone = "GK" | "LB" | "CB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

const PLACEMENT_ZONE_FROM_CODE: Record<string, PlacementZone> = {
  G: "GK", GK: "GK",
  DL: "LB", LB: "LB", LWB: "LB",
  DR: "RB", RB: "RB", RWB: "RB",
  DC: "CB", CB: "CB", D: "CB", SW: "CB",
  DM: "DM", MD: "DM", CDM: "DM",
  MC: "CM", M: "CM", CM: "CM", LM: "CM", RM: "CM",
  AM: "AM", MA: "AM", CAM: "AM",
  ML: "LW", LW: "LW",
  MR: "RW", RW: "RW",
  ST: "ST", F: "ST", A: "ST", S: "ST", CF: "ST", SS: "ST",
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
// DM sits deeper than CM, AM sits higher than CM, so a split midfield (e.g.
// 4-2-3-1's 2 DM + 3 AM) actually reads as two banks, not one flat line.
const ZONE_Y: Record<PlacementZone, number> = {
  GK: 0.94,
  LB: 0.70, CB: 0.74, RB: 0.70,
  DM: 0.58, CM: 0.46, AM: 0.32,
  LW: 0.16, RW: 0.16, ST: 0.13,
};

// x positions per zone, keyed by how many players share that zone this
// lineup — inset well short of the touchlines/corner flags (unlike the old
// flat 0.12..0.88 line spread) so wingers sit near the edge of the penalty
// box and central roles stay in the middle third, matching real shape.
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

export function placeLineup(players: PredictedLineupPlayer[]): {
  placed: PlacedPlayer[];
  formation: string;
} {
  const byZone = new Map<PlacementZone, PredictedLineupPlayer[]>();
  for (const p of players) {
    const z = placementZoneOf(p.position_code);
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(p);
  }
  // rank within zone for stable left-to-right ordering
  for (const list of byZone.values()) {
    list.sort((a, b) => (a.rank_in_position ?? 0) - (b.rank_in_position ?? 0));
  }

  const placed: PlacedPlayer[] = [];
  for (const [zone, list] of byZone) {
    const xs = xsFor(zone, list.length);
    list.forEach((player, i) => {
      placed.push({ player, x: xs[i], y: ZONE_Y[zone], line: ZONE_TO_LINE[zone] });
    });
  }

  const formation = getFormationName(players);

  return { placed, formation };
}

// Unit confidence: average predicted-lineup confidence per line.
export function unitConfidence(players: PredictedLineupPlayer[]) {
  const acc: Record<string, number[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of players) {
    const ln = lineOf(p.position_code);
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

// Versatility badge, e.g. "AM/MC/RW" from primary + secondary + tertiary.
export function versatilityBadge(p: PredictedLineupPlayer): string {
  const parts = [p.position_code, p.secondary_position, p.tertiary_position]
    .filter(Boolean)
    .map((c) => (c as string).toUpperCase());
  return Array.from(new Set(parts)).join("/");
}

// Positional coverage across a squad: how many players can cover each zone,
// counting primary/secondary/tertiary positions. Precompute this in the
// warehouse (team_positional_coverage) for production; derived here for demo.
const ZONE_FROM_CODE: Record<string, PitchZone> = {
  G: "GK", GK: "GK",
  DC: "CB", CB: "CB", D: "CB",
  DL: "LB", LB: "LB", LWB: "LB",
  DR: "RB", RB: "RB", RWB: "RB",
  DM: "DM", MD: "DM", CDM: "DM",
  MC: "CM", M: "CM", CM: "CM",
  AM: "AM", MA: "AM", CAM: "AM",
  ML: "LW", LW: "LW", LM: "LW",
  MR: "RW", RW: "RW", RM: "RW",
  ST: "ST", F: "ST", A: "ST", S: "ST", CF: "ST", SS: "ST",
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
    const zs = new Set(
      [p.position_code, p.secondary_position, p.tertiary_position]
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
