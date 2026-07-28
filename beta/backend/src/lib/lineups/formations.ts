/**
 * PREDICTED LINEUPS ENGINE — formation catalogue
 *
 * Each formation is eleven fully specified slots: the tactical code stored on
 * the row, the canonical position it demands, its broad zone, its pitch
 * coordinates, its render order and its role label.
 *
 * COORDINATE SYSTEM
 *   x: 0 = left touchline, 100 = right touchline
 *   y: 0 = opponent goal line, 100 = own goal line
 * So the goalkeeper sits at (50, 95) and a lone striker at (50, ~11). This is
 * the convention the frontend pitch renderer consumes directly — no
 * transformation, no inference, just circles at (x, y).
 *
 * RENDER ORDER
 *   Back to front, right to left within each line: GK, then the defensive
 *   line right-to-left, then midfield, then attack. lineup_order is this
 *   number; it is NOT the same as rank_in_position, which is a depth-chart
 *   rank within a position family (see FormationSlot.family in types.ts).
 *
 * ADDING A FORMATION
 *   Append one entry to FORMATIONS with eleven slots. Nothing else needs to
 *   change: scoring, the optimizer, confidence, coordinates and persistence
 *   all read from this structure. The invariant checks at the bottom of this
 *   file run at import time and will fail loudly on a malformed definition.
 */

import type { CanonicalPosition, Formation, FormationSlot, PositionGroup } from './types';

/** Role label per canonical position — keeps the slot table terse. */
const ROLE_LABELS: Record<CanonicalPosition, string> = {
  GK: 'goalkeeper',
  RB: 'right-back',
  LB: 'left-back',
  RWB: 'right wing-back',
  LWB: 'left wing-back',
  CB: 'centre-back',
  DM: 'holding midfielder',
  CM: 'central midfielder',
  AM: 'attacking midfielder',
  RM: 'right midfielder',
  LM: 'left midfielder',
  RW: 'right winger',
  LW: 'left winger',
  ST: 'striker',
};

/**
 * Slot factory. `order` is assigned by position in the array, so the slot
 * lists below read in exactly the order they render.
 *
 * @param code   tactical code stored on the row (side-qualified where needed)
 * @param base   canonical position the slot demands
 * @param group  broad zone — explicit because it is a property of the SHAPE,
 *               not of the position (a 4-2-3-1's wide players are wingers
 *               positionally but count as midfielders in the notation)
 */
function slot(
  code: string,
  base: CanonicalPosition,
  group: PositionGroup,
  x: number,
  y: number,
  family?: CanonicalPosition,
): Omit<FormationSlot, 'order'> {
  return { code, base, family: family ?? base, group, x, y, role: ROLE_LABELS[base] };
}

function formation(name: string, key: string, slots: Omit<FormationSlot, 'order'>[]): Formation {
  return {
    name,
    key,
    slots: slots.map((s, i) => ({ ...s, order: i + 1 })),
  };
}

// ─── The catalogue ───────────────────────────────────────────────────────────

/** Standard flat back four, reused by every four-at-the-back shape. */
const BACK_FOUR = [
  slot('RB',  'RB', 'D', 85, 75),
  slot('RCB', 'CB', 'D', 65, 80, 'CB'),
  slot('LCB', 'CB', 'D', 35, 80, 'CB'),
  slot('LB',  'LB', 'D', 15, 75),
];

/** Back three, reused by 3-5-2 and 3-4-3. */
const BACK_THREE = [
  slot('RCB', 'CB', 'D', 72, 80, 'CB'),
  slot('CB',  'CB', 'D', 50, 82, 'CB'),
  slot('LCB', 'CB', 'D', 28, 80, 'CB'),
];

const GOALKEEPER = slot('GK', 'GK', 'G', 50, 95);

export const FORMATIONS: Formation[] = [
  formation('4-3-3', '433', [
    GOALKEEPER,
    ...BACK_FOUR,
    slot('DM',  'DM', 'M', 50, 60),
    slot('RCM', 'CM', 'M', 68, 45, 'CM'),
    slot('LCM', 'CM', 'M', 32, 45, 'CM'),
    slot('RW',  'RW', 'F', 82, 20),
    slot('ST',  'ST', 'F', 50, 10),
    slot('LW',  'LW', 'F', 18, 20),
  ]),

  formation('4-2-3-1', '4231', [
    GOALKEEPER,
    ...BACK_FOUR,
    slot('RDM', 'DM', 'M', 62, 58, 'DM'),
    slot('LDM', 'DM', 'M', 38, 58, 'DM'),
    // The wide three behind the striker. Positionally wingers — hence base
    // RW/LW for compatibility — but counted in the midfield band, which is
    // what makes this a 4-2-3-1 rather than a 4-2-4.
    slot('RW',  'RW', 'M', 82, 33),
    slot('AM',  'AM', 'M', 50, 30),
    slot('LW',  'LW', 'M', 18, 33),
    slot('ST',  'ST', 'F', 50, 10),
  ]),

  formation('4-4-2', '442', [
    GOALKEEPER,
    ...BACK_FOUR,
    slot('RM',  'RM', 'M', 85, 45),
    slot('RCM', 'CM', 'M', 62, 48, 'CM'),
    slot('LCM', 'CM', 'M', 38, 48, 'CM'),
    slot('LM',  'LM', 'M', 15, 45),
    slot('RST', 'ST', 'F', 62, 15, 'ST'),
    slot('LST', 'ST', 'F', 38, 15, 'ST'),
  ]),

  formation('4-1-4-1', '4141', [
    GOALKEEPER,
    ...BACK_FOUR,
    slot('DM',  'DM', 'M', 50, 60),
    slot('RM',  'RM', 'M', 85, 40),
    slot('RCM', 'CM', 'M', 64, 42, 'CM'),
    slot('LCM', 'CM', 'M', 36, 42, 'CM'),
    slot('LM',  'LM', 'M', 15, 40),
    slot('ST',  'ST', 'F', 50, 12),
  ]),

  // Distinguished from 4-1-4-1 by a flat central three rather than a single
  // screening midfielder — a different demand on the squad, so it is worth
  // evaluating separately even though both notate as four defenders, five
  // midfielders and one striker.
  formation('4-5-1', '451', [
    GOALKEEPER,
    ...BACK_FOUR,
    slot('RM',  'RM', 'M', 85, 45),
    slot('RCM', 'CM', 'M', 68, 48, 'CM'),
    slot('CM',  'CM', 'M', 50, 52, 'CM'),
    slot('LCM', 'CM', 'M', 32, 48, 'CM'),
    slot('LM',  'LM', 'M', 15, 45),
    slot('ST',  'ST', 'F', 50, 12),
  ]),

  formation('3-5-2', '352', [
    GOALKEEPER,
    ...BACK_THREE,
    slot('RWB', 'RWB', 'M', 90, 52),
    slot('RCM', 'CM',  'M', 66, 48, 'CM'),
    slot('CM',  'CM',  'M', 50, 55, 'CM'),
    slot('LCM', 'CM',  'M', 34, 48, 'CM'),
    slot('LWB', 'LWB', 'M', 10, 52),
    slot('RST', 'ST',  'F', 60, 14, 'ST'),
    slot('LST', 'ST',  'F', 40, 14, 'ST'),
  ]),

  formation('3-4-3', '343', [
    GOALKEEPER,
    ...BACK_THREE,
    slot('RM',  'RM', 'M', 88, 50),
    slot('RCM', 'CM', 'M', 62, 50, 'CM'),
    slot('LCM', 'CM', 'M', 38, 50, 'CM'),
    slot('LM',  'LM', 'M', 12, 50),
    slot('RW',  'RW', 'F', 80, 18),
    slot('ST',  'ST', 'F', 50, 10),
    slot('LW',  'LW', 'F', 20, 18),
  ]),

  formation('5-4-1', '541', [
    GOALKEEPER,
    slot('RWB', 'RWB', 'D', 92, 62),
    slot('RCB', 'CB',  'D', 72, 82, 'CB'),
    slot('CB',  'CB',  'D', 50, 84, 'CB'),
    slot('LCB', 'CB',  'D', 28, 82, 'CB'),
    slot('LWB', 'LWB', 'D', 8,  62),
    slot('RM',  'RM',  'M', 85, 45),
    slot('RCM', 'CM',  'M', 62, 46, 'CM'),
    slot('LCM', 'CM',  'M', 38, 46, 'CM'),
    slot('LM',  'LM',  'M', 15, 45),
    slot('ST',  'ST',  'F', 50, 14),
  ]),
];

/** Lookup by display name ('4-3-3') or compact key ('433'). */
const FORMATION_INDEX = new Map<string, Formation>();
for (const f of FORMATIONS) {
  FORMATION_INDEX.set(f.name, f);
  FORMATION_INDEX.set(f.key, f);
}

export function getFormation(nameOrKey: string): Formation | undefined {
  return FORMATION_INDEX.get(nameOrKey);
}

/**
 * The shape used when a single canonical formation is needed rather than the
 * best-fitting one — notably by processStartingXIStrength, which compares a
 * projected XI against a best-available XI and must hold the shape constant so
 * the ratio means something.
 */
export const REFERENCE_FORMATION: Formation = getFormation('4-3-3')!;

/** Every distinct slot code across the catalogue — used to size the suitability cache. */
export const ALL_SLOT_CODES: string[] = [
  ...new Set(FORMATIONS.flatMap((f) => f.slots.map((s) => s.code))),
];

/**
 * Distinct (code, base) pairs across the catalogue. Suitability depends only
 * on the base position, so this is what actually gets precomputed per player.
 */
export const SLOT_BASE_BY_CODE: Map<string, CanonicalPosition> = new Map(
  FORMATIONS.flatMap((f) => f.slots.map((s) => [s.code, s.base] as [string, CanonicalPosition])),
);

// ─── Import-time invariants ──────────────────────────────────────────────────
//
// A formation with ten slots, two goalkeepers, duplicate codes or a coordinate
// off the pitch is a definition bug that would otherwise surface as a subtly
// wrong lineup hours later. Fail at import instead.
for (const f of FORMATIONS) {
  if (f.slots.length !== 11) {
    throw new Error(`Formation ${f.name} has ${f.slots.length} slots, expected 11`);
  }
  const keepers = f.slots.filter((s) => s.base === 'GK');
  if (keepers.length !== 1) {
    throw new Error(`Formation ${f.name} has ${keepers.length} goalkeeper slots, expected exactly 1`);
  }
  const codes = new Set(f.slots.map((s) => s.code));
  if (codes.size !== 11) {
    throw new Error(`Formation ${f.name} has duplicate slot codes`);
  }
  for (const s of f.slots) {
    if (s.x < 0 || s.x > 100 || s.y < 0 || s.y > 100) {
      throw new Error(`Formation ${f.name} slot ${s.code} has off-pitch coordinates (${s.x}, ${s.y})`);
    }
  }
  // The notation must match the zone counts, e.g. '4-2-3-1' -> 4+2+3+1 = 10
  // outfielders with 4 defenders. Catches a mislabelled group on a slot.
  const bands = f.name.split('-').map(Number);
  const defenders = f.slots.filter((s) => s.group === 'D').length;
  const midfielders = f.slots.filter((s) => s.group === 'M').length;
  const forwards = f.slots.filter((s) => s.group === 'F').length;
  if (bands[0] !== defenders) {
    throw new Error(`Formation ${f.name} declares ${bands[0]} defenders but has ${defenders}`);
  }
  if (bands[bands.length - 1] !== forwards) {
    throw new Error(`Formation ${f.name} declares ${bands[bands.length - 1]} forwards but has ${forwards}`);
  }
  const declaredMids = bands.slice(1, -1).reduce((a, b) => a + b, 0);
  if (declaredMids !== midfielders) {
    throw new Error(`Formation ${f.name} declares ${declaredMids} midfielders but has ${midfielders}`);
  }
}
