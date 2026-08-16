// ─────────────────────────────────────────────────────────────────────────────
// team_momentum — team.momentum
//
// ALL_COMPETITIONS. A short-term FORM-TREND signal: the change in points taken
// across a team's two most-recent five-match windows.
//
//   momentum = last5Points − prior5Points          (points, signed)
//
// From V1 `processTeamMomentum` (`processDbOnly.ts:3682-3706`), carried across as
// the FORMULA and the POPULATION unchanged: the ten most-recent completed,
// result-bearing fixtures across ALL competitions and seasons, ordered by kickoff,
// split into the most-recent five (`last5`) and the five before them (`prior5`),
// each scored 3 / 1 / 0 for win / draw / loss. The only V2 difference is the
// mandatory point-in-time boundary: V1 computed a single "now" snapshot over the
// whole form table; V2 evaluates the quantity as of a given instant, reading only
// fixtures strictly before `as_of`. The number itself is identical.
//
// ─────────────────────────────────────────────────────────────────────────────
// A TREND (DELTA), NOT A LEVEL — AND NOT A RATE
//
// `home_form` / `away_form` are weighted result-quality LEVELS, per venue side.
// `home_win_rate` / `away_win_rate` are unweighted win RATES over a competition
// edition. Momentum is neither: it is a signed DELTA between two consecutive
// five-match windows, over BOTH venue sides, across all competitions — the
// acceleration of form, not its level. The three never derive from one another.
//
// The ±10 / ±3 banding that turns this delta into "Surging / Crashing" is the
// Readiness Tracker MODULE's concern (Gate E-iii), not this feature's. This
// primitive emits the number; it classifies nothing.
//
// ─────────────────────────────────────────────────────────────────────────────
// FEWER THAN TEN QUALIFYING MATCHES IS NO VALUE, NEVER A ZERO
//
// The delta compares two FULL five-match windows. With fewer than ten completed,
// result-bearing fixtures before `as_of`, the prior window is not full and V1
// wrote `null` (momentum_score is null unless `prior5.length === 5`). V2 writes
// nothing — no feature_value row (PD-07 / LC-05). A zero delta is a real "form
// held level", never a stand-in for insufficient history.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHICH TEN, AND WHY THIS READS `fixturesByTeam` LIKE THE OTHERS
//
// The window is the ten most-recent RESULT-BEARING fixtures, counted — not a
// time-bounded window (V1 imposed no elapsed-time bound). `readCompletedFixtures`
// returns, per team, at least the ten most-recent per side, which necessarily
// contains the ten most-recent overall, so this calculator consumes the same
// `fixturesByTeam` the other ALL_COMPETITIONS calculators do and needs no reader
// of its own. It re-applies the strict `< as_of` bound and the result-bearing
// filter itself, then takes the ten most recent by kickoff (fixture id breaking
// ties, deterministically).
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type CompletedFixture,
} from './types';
import { fromInt, subtract } from '../write/scale';

const MOMENTUM = 'team.momentum';

/** The two windows the delta compares, and how many matches each must hold. */
const WINDOW = 5;
const REQUIRED = WINDOW * 2; // both windows full — V1's `prior5.length === 5`

/** A completed fixture contributes only when its result is present. */
function hasResult(fixture: CompletedFixture): boolean {
  return fixture.goalsFor !== null && fixture.goalsAgainst !== null;
}

/** Points for the subject team in one result-bearing fixture: 3 / 1 / 0. */
function pointsOf(fixture: CompletedFixture): number {
  const gf = fixture.goalsFor as number;
  const ga = fixture.goalsAgainst as number;
  if (gf > ga) return 3;
  if (gf === ga) return 1;
  return 0;
}

/** Most-recent-first, deterministic: kickoff desc, then fixture id desc. */
function mostRecentFirst(a: CompletedFixture, b: CompletedFixture): number {
  const byKickoff = b.kickoffAt.getTime() - a.kickoffAt.getTime();
  if (byKickoff !== 0) return byKickoff;
  const ai = BigInt(a.fixtureId);
  const bi = BigInt(b.fixtureId);
  return ai < bi ? 1 : ai > bi ? -1 : 0;
}

export const teamMomentum: Calculator = {
  calculatorKey: 'team_momentum',
  featureKeys: [MOMENTUM],
  // contextKind omitted → ALL_COMPETITIONS, the default pass.

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      // Strict `< as_of` (defence-in-depth; the reader applied it too), then only
      // result-bearing fixtures, most recent first.
      const played = before(history.fixtures, subject.asOf)
        .filter(hasResult)
        .sort(mostRecentFirst);

      // The delta needs two full windows. Fewer than ten → NO VALUE, never a zero.
      if (played.length < REQUIRED) continue;

      const last5 = played.slice(0, WINDOW);
      const prior5 = played.slice(WINDOW, REQUIRED);
      const last5Points = last5.reduce((sum, fixture) => sum + pointsOf(fixture), 0);
      const prior5Points = prior5.reduce((sum, fixture) => sum + pointsOf(fixture), 0);

      candidates.push({
        featureKey: MOMENTUM,
        teamId: subject.teamId,
        asOf: subject.asOf,
        // last5 − prior5, exact. value_scale = 0, so the write boundary stores the
        // integer as-is; a negative delta (declining form) is a real value.
        value: subtract(fromInt(last5Points), fromInt(prior5Points)),
        // The matches the delta rests on — the full ten (D-5c-i, non-composite).
        sampleObservationCount: REQUIRED,
        // Layer 1 over football relations — consumes no feature.
        consumed: [],
      });
    }

    return candidates;
  },
};
