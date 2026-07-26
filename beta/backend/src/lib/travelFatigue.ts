/**
 * TRAVEL FATIGUE — cumulative, time-decayed.
 *
 * WHY THIS EXISTS
 * ───────────────
 * processTeamTravelLoad already walks each team's chronological venue log and
 * counts a trip on every venue CHANGE, so the return leg home after an away
 * fixture is captured and a home match is not a reset. That part was correct.
 *
 * What was weak is what it did with those trips:
 *
 *   1. The score used the AVERAGE trip distance over 14 days. One 900 km trip
 *      and four 900 km trips produced an identical score. Total load — the
 *      thing that actually accumulates — was computed into km_last_7/14/30_days
 *      and then never read.
 *   2. No time decay. A trip 13 days ago counted exactly as much as one
 *      yesterday, then dropped to zero on day 15. Recovery was a cliff, not a
 *      curve.
 *   3. away_matches_last_*_days were stored and never used, so consecutive
 *      away runs carried no weight.
 *
 * WHAT THIS DOES
 * ──────────────
 * Load is summed with an exponential decay, so a trip's contribution halves
 * every HALF_LIFE_DAYS. Three modifiers then apply: an unrecovered recent long
 * haul, a consecutive-away run, and a short turnaround since the last trip.
 *
 * ON THE CONSTANTS
 * ────────────────
 * These are stated assumptions, not measured values, and are named so they can
 * be argued with. The literature this leans on — congested fixture periods
 * showing elevated injury risk and depressed performance for several days, and
 * long-haul travel effects persisting well beyond the next fixture — supports
 * decay over days rather than a hard window, but does not pin a half-life for
 * football club travel specifically. Nothing downstream should present output
 * from this as a measured rate. Bump FORMULA_VERSION when any constant moves,
 * so a change starts a new cohort rather than silently rewriting history.
 */

export const FORMULA_VERSION = 'travel-v2';

/** A trip's contribution halves every this many days. */
export const HALF_LIFE_DAYS = 5;

/** Decayed km at which the load term saturates at 100. */
export const LOAD_SATURATION_KM = 2200;

/** A single trip at or above this is treated as a long haul. */
export const LONG_HAUL_KM = 600;

/** Days within which an unrecovered long haul still carries a penalty. */
export const LONG_HAUL_RECOVERY_DAYS = 4;

/** Look-back for the decayed sum. Beyond this a trip contributes ~1.6%. */
export const WINDOW_DAYS = 30;

export interface Trip {
  date: Date;
  km: number;
  /** True when the fixture at the far end was an away fixture for this team. */
  isAway?: boolean;
}

export interface TravelFatigue {
  /** 0–100, higher is worse — same polarity as congestion_score. */
  score: number;
  /** Decay-weighted km behind the score. */
  decayedKm: number;
  /** Days since the most recent long haul, null when there is none in window. */
  daysSinceLongHaul: number | null;
  /** Trips at the end of the log that were away fixtures. */
  consecutiveAway: number;
  /** Days since the most recent trip of any length. */
  daysSinceLastTrip: number | null;
  version: string;
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/**
 * Cumulative travel fatigue as of `asOf`.
 *
 * Trips after `asOf` are ignored, so this is safe to call for a historical
 * fixture without leaking travel the team had not yet done.
 */
export function computeTravelFatigue(trips: Trip[], asOf: Date): TravelFatigue {
  const cutoff = asOf.getTime() - WINDOW_DAYS * DAY_MS;
  const inWindow = trips
    .filter((t) => t.date.getTime() <= asOf.getTime() && t.date.getTime() >= cutoff)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (inWindow.length === 0) {
    return {
      score: 0,
      decayedKm: 0,
      daysSinceLongHaul: null,
      consecutiveAway: 0,
      daysSinceLastTrip: null,
      version: FORMULA_VERSION,
    };
  }

  // ── 1. Decayed load ──────────────────────────────────────────────────────
  let decayedKm = 0;
  for (const t of inWindow) {
    const ageDays = (asOf.getTime() - t.date.getTime()) / DAY_MS;
    decayedKm += t.km * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }
  const loadTerm = clamp((decayedKm / LOAD_SATURATION_KM) * 100);

  // ── 2. Unrecovered long haul ─────────────────────────────────────────────
  // A 900 km trip three days ago is a different state from the same trip three
  // weeks ago, even where the decayed sums happen to land close together.
  const longHauls = inWindow.filter((t) => t.km >= LONG_HAUL_KM);
  const lastLong = longHauls.length ? longHauls[longHauls.length - 1] : null;
  const daysSinceLongHaul = lastLong
    ? (asOf.getTime() - lastLong.date.getTime()) / DAY_MS
    : null;
  const longHaulTerm =
    daysSinceLongHaul != null && daysSinceLongHaul <= LONG_HAUL_RECOVERY_DAYS
      ? 12 * (1 - daysSinceLongHaul / LONG_HAUL_RECOVERY_DAYS)
      : 0;

  // ── 3. Consecutive away fixtures ─────────────────────────────────────────
  let consecutiveAway = 0;
  for (let i = inWindow.length - 1; i >= 0; i--) {
    if (inWindow[i].isAway) consecutiveAway++;
    else break;
  }
  const runTerm = Math.min(10, Math.max(0, consecutiveAway - 1) * 5);

  // ── 4. Short turnaround since the last trip of any length ────────────────
  const last = inWindow[inWindow.length - 1];
  const daysSinceLastTrip = (asOf.getTime() - last.date.getTime()) / DAY_MS;
  const turnaroundTerm = daysSinceLastTrip <= 2 ? 8 * (1 - daysSinceLastTrip / 2) : 0;

  return {
    score: Math.round(clamp(loadTerm + longHaulTerm + runTerm + turnaroundTerm)),
    decayedKm: Math.round(decayedKm),
    daysSinceLongHaul: daysSinceLongHaul != null ? Math.round(daysSinceLongHaul * 10) / 10 : null,
    consecutiveAway,
    daysSinceLastTrip: Math.round(daysSinceLastTrip * 10) / 10,
    version: FORMULA_VERSION,
  };
}
