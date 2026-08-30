// ─────────────────────────────────────────────────────────────────────────────
// goal_margin_volatility — team.goal_margin_volatility
//
// S-6 Phase 2 prerequisite substrate (owner Option A). The CONTEXTUAL descriptive
// input the future `consistency_index` module will consume: how volatile a team's
// goal margin has been. HIGHER volatility = less consistent / more unpredictable.
// It is a MEASUREMENT (a sample standard deviation), not a judgement — direction
// is UNSIGNED, exactly as `team.travel_distance` is a measurement.
//
// V1-EXACT (source: beta/backend/src/jobs/processExtendedIntelligence.ts:368-379),
// carried across unchanged:
//   margin     = team_goals − opponent_goals              (per fixture, signed)
//   mean       = Σ margin / n
//   volatility = sqrt( Σ(margin − mean)² / (n − 1) )       — UNWEIGHTED sample stddev
//
// Population (owner-locked): ALL completed fixtures in the ≤730-day window with
// kickoff < as_of, taken from `context.longWindowFixturesByTeam` (NOT the shared
// windowed `fixturesByTeam`); all competitions; home and away; opponent strength
// irrelevant. The V1 45-day half-life is NOT applied to this stddev (in V1 it
// weights PPG/OAF only, never the volatility — audit-established).
//
// SAMPLE GATE: n ≥ 3. Below 3 → NO candidate (feature ABSENT), never a fabricated
// 0. With n ≥ 3 and all margins equal → 0, a legitimate volatility (not absence).
//
// PURE and deterministic: a function of the provided history; no clock, no DB.
// V1 computes the stddev in floating point (`Math.sqrt`), so doing the same and
// bridging the irrational result to Exact via `fromString(toFixed(...))` — the
// same float→Exact bridge `team.travel_distance` uses for its haversine — is both
// the sanctioned pattern and V1-exact. The write boundary rounds once to scale.
// ─────────────────────────────────────────────────────────────────────────────

import type { Calculator, CalculationContext, CandidateValue } from './types';
import { fromString, type Exact } from '../write/scale';

const GOAL_MARGIN_VOLATILITY = 'team.goal_margin_volatility';
const MIN_OBSERVATIONS = 3;
// Working precision for the float→Exact bridge; kept well above the registered
// value_scale so the single rounding happens at the write boundary, not here.
const WORKING_PRECISION = 10;

export const goalMarginVolatility: Calculator = {
  calculatorKey: 'goal_margin_volatility',
  featureKeys: [GOAL_MARGIN_VOLATILITY],
  needsLongWindowHistory: true,

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const out: CandidateValue[] = [];
    for (const subject of context.subjects) {
      // Absent long window (a context that did not populate it) ⇒ nothing to compute.
      const history = context.longWindowFixturesByTeam?.get(subject.teamId);
      if (!history) continue;

      // Signed margin per completed fixture; goalsFor/goalsAgainst are already
      // oriented to the subject team by the read layer. Skip any fixture whose
      // result is absent (null goals) — an incomplete result contributes nothing.
      const margins: number[] = [];
      for (const f of history.fixtures) {
        if (f.goalsFor === null || f.goalsAgainst === null) continue;
        margins.push(f.goalsFor - f.goalsAgainst);
      }

      const n = margins.length;
      if (n < MIN_OBSERVATIONS) continue; // feature ABSENT below 3 — never fabricate

      const mean = margins.reduce((sum, m) => sum + m, 0) / n;
      const sumSquaredDeviations = margins.reduce((sum, m) => sum + (m - mean) ** 2, 0);
      const variance = sumSquaredDeviations / (n - 1); // sample variance, UNWEIGHTED
      const volatility = Math.sqrt(variance);

      const value: Exact = fromString(volatility.toFixed(WORKING_PRECISION));
      out.push({
        featureKey: GOAL_MARGIN_VOLATILITY,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value,
        sampleObservationCount: n,
        consumed: [],
      });
    }
    return out;
  },
};
