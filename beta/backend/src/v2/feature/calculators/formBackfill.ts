// ─────────────────────────────────────────────────────────────────────────────
// form_backfill — team.home_form, team.away_form
//
// V1'S WEIGHTING, CARRIED ACROSS UNCHANGED (DEC-3).
//
//   last5Score  = (points_last_5  / 15) × 100
//   last10Score = (points_last_10 / 30) × 100
//   form        = last5Score × 0.7 + last10Score × 0.3
//
// From `processDbOnly.ts:1534–1542`, itself citing "Form Score PER SPEC
// (section 1)". The 0.7/0.3 weighting operates INSIDE the ten-fixture window, so
// it is compatible with the S-5 window and carries across intact; only the
// population is filtered — to home or away fixtures — which the definition's own
// registered `meaning` already specifies.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE NORMALISATION IS BY THE FULL WINDOW, NOT BY MATCHES PLAYED
//
// 15 is five matches at three points; 30 is ten. A side with three completed
// home fixtures that won all three scores (9/30)×100 = 30 on the ten-match
// component, not 100. Short history therefore reads as weak form rather than as
// perfect form on thin evidence.
//
// That is V1's behaviour and it is carried across deliberately. It also makes
// `sample_observation_count` load-bearing rather than decorative: the count says
// how many fixtures the figure rests on, and `meaningful_sample_threshold = 5`
// tells a consumer when to distrust it.
//
// HOME AND AWAY ARE SEPARATE FEATURES, never one index with a split flag —
// "collapsing the two destroys the distinction the Home/Away Split module exists
// to report."
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type CompletedFixture,
} from './types';
import { add, divide, fromInt, fromString, multiply, ONE_HUNDRED, type Exact } from '../write/scale';

const HOME_FORM = 'team.home_form';
const AWAY_FORM = 'team.away_form';

/** Fixtures considered. V1's ten-match window; the five-match term is its head. */
const WINDOW = 10;
const SHORT_WINDOW = 5;

/** Denominators: matches × three points. Fixed by V1's formula, not by the data. */
const SHORT_DENOMINATOR = fromInt(SHORT_WINDOW * 3);
const FULL_DENOMINATOR = fromInt(WINDOW * 3);

const SHORT_WEIGHT = fromString('0.7');
const FULL_WEIGHT = fromString('0.3');

/**
 * Points from one completed fixture, from the subject team's perspective.
 *
 * Three for a win, one for a draw, none for a defeat — the scale V1's `/15` and
 * `/30` denominators encode. A fixture whose result is absent contributes
 * nothing and is excluded upstream, so this never sees a null.
 */
function pointsFrom(fixture: CompletedFixture): number {
  const scored = fixture.goalsFor as number;
  const conceded = fixture.goalsAgainst as number;
  if (scored > conceded) return 3;
  if (scored === conceded) return 1;
  return 0;
}

function sumPoints(fixtures: readonly CompletedFixture[]): Exact {
  let total = 0;
  for (const fixture of fixtures) total += pointsFrom(fixture);
  return fromInt(total);
}

/**
 * Form over one venue side.
 *
 * Returns null when the window holds no fixture. V1 guards the same way
 * (`if (last5.length > 0)`), and PD-07 requires it: a side with no completed
 * home fixture has no home form, and a zero would assert the worst possible form
 * on no evidence.
 */
function formOver(fixtures: readonly CompletedFixture[]): { value: Exact; observations: number } | null {
  const window = fixtures.slice(0, WINDOW);
  if (window.length === 0) return null;

  const shortTerm = window.slice(0, SHORT_WINDOW);

  // (points / denominator) × 100, at working precision. Division happens here
  // rather than at the end because V1's formula is a weighted mean of two
  // already-normalised scores, and reassociating it would change the result.
  const shortScore = multiply(divide(sumPoints(shortTerm), SHORT_DENOMINATOR), ONE_HUNDRED);
  const fullScore = multiply(divide(sumPoints(window), FULL_DENOMINATOR), ONE_HUNDRED);

  const value = add(multiply(shortScore, SHORT_WEIGHT), multiply(fullScore, FULL_WEIGHT));
  return { value, observations: window.length };
}

export const formBackfill: Calculator = {
  calculatorKey: 'form_backfill',
  featureKeys: [HOME_FORM, AWAY_FORM],

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      // Strict upper bound. At the KICKOFF snapshot point `as_of` equals the
      // generating fixture's kickoff, and `<=` would let the value see the very
      // fixture it describes.
      const played = before(history.fixtures, subject.asOf).filter(
        (fixture) => fixture.goalsFor !== null && fixture.goalsAgainst !== null
      );

      for (const [featureKey, isHome] of [
        [HOME_FORM, true],
        [AWAY_FORM, false],
      ] as const) {
        const side = played.filter((fixture) => fixture.isHome === isHome);
        const form = formOver(side);
        if (!form) continue;

        candidates.push({
          featureKey,
          teamId: subject.teamId,
          asOf: subject.asOf,
          value: form.value,
          sampleObservationCount: form.observations,
          consumed: [],
        });
      }
    }

    return candidates;
  },
};
