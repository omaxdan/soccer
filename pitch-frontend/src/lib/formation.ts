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

const FWD_CODES = new Set(["F", "A", "S", "W"]); // forwards / attackers / strikers / wingers

function lineOf(code: string | null): "GK" | "DEF" | "MID" | "FWD" {
  const c = (code ?? "").charAt(0).toUpperCase();
  if (c === "G") return "GK";
  if (c === "D") return "DEF";
  if (c === "M") return "MID";
  if (FWD_CODES.has(c)) return "FWD";
  return "MID";
}

// y position per line, adapting to whether a midfield/forward line exists
const LINE_Y: Record<"GK" | "DEF" | "MID" | "FWD", number> = {
  GK: 0.94,
  DEF: 0.72,
  MID: 0.46,
  FWD: 0.18,
};

function spread(n: number): number[] {
  // even horizontal distribution with gentle edge insets
  if (n <= 0) return [];
  if (n === 1) return [0.5];
  const inset = 0.12;
  const span = 1 - inset * 2;
  return Array.from({ length: n }, (_, i) => inset + (span * i) / (n - 1));
}

export function placeLineup(players: PredictedLineupPlayer[]): {
  placed: PlacedPlayer[];
  formation: string;
} {
  const byLine: Record<"GK" | "DEF" | "MID" | "FWD", PredictedLineupPlayer[]> = {
    GK: [], DEF: [], MID: [], FWD: [],
  };
  for (const p of players) byLine[lineOf(p.position_code)].push(p);

  // rank within line for stable ordering
  (["GK", "DEF", "MID", "FWD"] as const).forEach((ln) =>
    byLine[ln].sort((a, b) => (a.rank_in_position ?? 0) - (b.rank_in_position ?? 0))
  );

  const placed: PlacedPlayer[] = [];
  (["GK", "DEF", "MID", "FWD"] as const).forEach((ln) => {
    const xs = spread(byLine[ln].length);
    byLine[ln].forEach((player, i) => {
      placed.push({ player, x: xs[i], y: LINE_Y[ln], line: ln });
    });
  });

  const formation = [byLine.DEF.length, byLine.MID.length, byLine.FWD.length]
    .filter((n) => n > 0)
    .join("-");

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
  DL: "LB", LB: "LB", DR: "RB", RB: "RB",
  DM: "DM", MD: "DM",
  MC: "CM", M: "CM", CM: "CM",
  AM: "AM", MA: "AM",
  ML: "LW", LW: "LW", MR: "RW", RW: "RW",
  ST: "ST", F: "ST", A: "ST", S: "ST", CF: "ST",
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
