// ─────────────────────────────────────────────────────────────────────────────
// giant_killer_ppg — team.giant_killer_ppg
//
// S-6 Phase 3B substrate feature (owner-authorized). The V1 Giant Killer "Stage B"
// quantity: how many points-per-game a team earns against TOP-tertile opponents,
// recency-weighted, over the previous 730 days across all competitions. It is the
// descriptive substrate a future giant_killer_index module would consume — the
// MODULE is DEFERRED (no approved 1.0.0 numeric/categorical output slot; strength
// NULL-frozen; owner barred inventing thresholds).
//
// V1-EXACT ARITHMETIC (source: jobs/processExtendedIntelligence.ts):
//   tier ............ fixtures whose opponent's pre-match band is `top`
//   sample gate ..... require ≥ 3 top-tier matches, else ABSENT (V1 MIN_TIER_SAMPLE)
//   recencyWeight ... 0.5 ^ (daysAgo / 45)                 (HALF_LIFE_DAYS = 45)
//   ppgTop .......... Σ(pointsEarned · recencyWeight) / Σ(recencyWeight)
// The stored value is ppgTop (range 0–3). The V1 presentation score is
// 100 · ppgTop / 3; that scaling — and any categorical verdict — is the deferred
// MODULE's concern, not this substrate's. Storing the PPG keeps the module free to
// derive the score once a numeric output path legitimately exists (S-9).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE INTENTIONAL DEVIATION FROM V1 (owner-authorized, R-2-mandated)
//
// V1 anchors recency to the WALL CLOCK: `now = Date.now()`
// (processExtendedIntelligence.ts:154). That is non-deterministic AND temporally
// wrong for a point-in-time snapshot. V2 anchors recency to the subject's `as_of`:
//   daysAgo = (as_of − kickoffAt) / 86_400_000
// so the same fixture at the same `as_of` weighs identically on every run and
// every machine. This calculator reads NO clock — R-2 obligation 6 — only the
// `as_of` and the kickoff instants handed to it.
//
// LEAK-FREE: only fixtures with kickoff strictly before `as_of` count (the read
// enforces this too), so the target fixture never contributes to its own value.
//
// PURE: `Math.pow`/division are floating point; the irrational weighted mean is
// bridged to Exact via `fromString(toFixed(P))` — the sanctioned float→Exact
// pattern (as travel_distance and goal_margin_volatility use). The write boundary
// rounds once to the registered scale.
// ─────────────────────────────────────────────────────────────────────────────

import type { Calculator, CalculationContext, CandidateValue } from './types';
import { fromString, type Exact } from '../write/scale';

const GIANT_KILLER_PPG = 'team.giant_killer_ppg';
/** V1 MIN_TIER_SAMPLE — minimum top-tier matches to emit a value. */
const MIN_TOP_TIER_SAMPLE = 3;
/** V1 MAX_WINDOW_DAYS — the 730-day recency horizon. */
const WINDOW_DAYS = 730;
/** V1 HALF_LIFE_DAYS — the recency-decay half-life. */
const HALF_LIFE_DAYS = 45;
const MS_PER_DAY = 86_400_000;
// Working precision for the float→Exact bridge; kept well above the registered
// value_scale so the single rounding happens at the write boundary, not here.
const WORKING_PRECISION = 10;

export const giantKillerPpg: Calculator = {
  calculatorKey: 'giant_killer_ppg',
  featureKeys: [GIANT_KILLER_PPG],
  needsEditionRankedHistory: true,

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const out: CandidateValue[] = [];
    for (const subject of context.subjects) {
      const history = context.editionRankedHistoryByTeam?.get(subject.teamId);
      if (!history) continue;

      const asOfMs = subject.asOf.getTime();
      const windowStartMs = asOfMs - WINDOW_DAYS * MS_PER_DAY;

      let weightSum = 0;
      let weightedPointsSum = 0;
      let topTierCount = 0;

      for (const f of history.fixtures) {
        if (f.opponentBand !== 'top') continue; // only top-tertile opponents
        const kickoffMs = f.kickoffAt.getTime();
        if (kickoffMs >= asOfMs) continue; // strict < as_of — never see the future
        if (kickoffMs < windowStartMs) continue; // 730-day lower bound

        const daysAgo = (asOfMs - kickoffMs) / MS_PER_DAY;
        const recencyWeight = Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
        weightSum += recencyWeight;
        weightedPointsSum += f.pointsEarned * recencyWeight;
        topTierCount += 1;
      }

      // Fewer than three top-tier matches → feature ABSENT (never a fabricated 0).
      if (topTierCount < MIN_TOP_TIER_SAMPLE) continue;

      // topTierCount ≥ 3 ⇒ weightSum > 0 (every weight is strictly positive).
      const ppgTop = weightedPointsSum / weightSum;
      const value: Exact = fromString(ppgTop.toFixed(WORKING_PRECISION));
      out.push({
        featureKey: GIANT_KILLER_PPG,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value,
        sampleObservationCount: topTierCount,
        consumed: [],
      });
    }
    return out;
  },
};
