// ─────────────────────────────────────────────────────────────────────────────
// venue_win_rate — team.home_win_rate, team.away_win_rate
//
// COMPETITION_SCOPED. The two features supply the Home/Away Split module (#1)
// with a team's venue identity WITHIN A COMPETITION EDITION.
//
//   win_rate = wins / matches × 100     (per venue side)
//
// From V1 `processTeamVenuePerformance` (`processDbOnly.ts:2690-2691`), carried
// across as a FORMULA but with the POPULATION deliberately superseded: V1
// computed this over all competitions, all seasons, lifetime; V2 computes it over
// ONE competition edition, cumulatively (Gate C-i, doc 76). The edition-scoped
// population is supplied by the scoped pass through `readEditionVenueResults`, so
// this calculator reads `fixturesByTeam` exactly as the ALL_COMPETITIONS
// calculators do — it does not know or care which read populated it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS NOT `home_form` / `away_form`, AND THE DIFFERENCE IS THE WHOLE POINT
//
// Form (`formBackfill`) is a WEIGHTED POINTS PERCENTAGE over a rolling ten, a
// recent-quality signal. This is an UNWEIGHTED WIN PERCENTAGE over the whole
// edition, a venue-identity signal. Same venue-side split, different quantity and
// different window. The two never derive from one another.
//
// ─────────────────────────────────────────────────────────────────────────────
// DRAWS AND LOSSES ARE IN THE DENOMINATOR, NEVER THE NUMERATOR
//
// `matches` counts every completed fixture with a result on the side; `wins`
// counts only those the team won. A draw or a loss is a match played and not
// won, so it lowers the rate rather than being excluded. This is V1's `h.wins /
// h.matches`, exactly.
//
// ─────────────────────────────────────────────────────────────────────────────
// ZERO MATCHES IS NO VALUE, NEVER A ZERO RATE
//
// A side with no completed-with-result fixture in the edition before `as_of` has
// NO home (or away) win rate — no row, per PD-07/LC-05. V1 wrote `null` for
// `matches = 0`; V2 writes nothing. A side that PLAYED and never won is a
// genuine 0 %, a row like any other — the distinction the module relies on.
//
// ─────────────────────────────────────────────────────────────────────────────
// ORIENTATION STAYS OUT
//
// Each rate is `HIGHER_IS_STRONGER` on its own. The disparity between home and
// away, the "home-reliant / road-warrior" type, and the `|disparity| ≥ 40`
// status are the Home/Away Split MODULE's concern (Gate D) — none of that is here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  before,
  COMPETITION_SCOPED_CONTEXT_KIND,
  type CalculationContext,
  type Calculator,
  type CandidateValue,
  type CompletedFixture,
} from './types';
import { divide, fromInt, multiply, ONE_HUNDRED, type Exact } from '../write/scale';

const HOME_WIN_RATE = 'team.home_win_rate';
const AWAY_WIN_RATE = 'team.away_win_rate';

/** A completed fixture is scored only when its result is present. */
function hasResult(fixture: CompletedFixture): boolean {
  return fixture.goalsFor !== null && fixture.goalsAgainst !== null;
}

/**
 * Win rate over one venue side, or null when nothing qualifies.
 *
 * Returns null — not zero — when the side has no completed-with-result fixture,
 * because absence of a played match is absence of a rate (PD-07). A side that
 * played and lost every game returns 0, a real value.
 */
function winRateOver(
  fixtures: readonly CompletedFixture[]
): { value: Exact; observations: number } | null {
  const scored = fixtures.filter(hasResult);
  if (scored.length === 0) return null;

  let wins = 0;
  for (const fixture of scored) {
    if ((fixture.goalsFor as number) > (fixture.goalsAgainst as number)) wins += 1;
  }

  // (wins / matches) × 100 at working precision; the write boundary rounds once
  // to value_scale = 2. A draw or loss is in `scored` (the denominator) but not
  // in `wins` (the numerator).
  const value = multiply(divide(fromInt(wins), fromInt(scored.length)), ONE_HUNDRED);
  return { value, observations: scored.length };
}

export const venueWinRate: Calculator = {
  calculatorKey: 'venue_win_rate',
  featureKeys: [HOME_WIN_RATE, AWAY_WIN_RATE],
  contextKind: COMPETITION_SCOPED_CONTEXT_KIND,

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = context.fixturesByTeam.get(subject.teamId);
      if (!history) continue;

      // Strict `< as_of` again, defence-in-depth. The scoped read already
      // applied it in SQL; a value must never see the fixture it is generated for.
      const played = before(history.fixtures, subject.asOf);

      for (const [featureKey, isHome] of [
        [HOME_WIN_RATE, true],
        [AWAY_WIN_RATE, false],
      ] as const) {
        const side = played.filter((fixture) => fixture.isHome === isHome);
        const rate = winRateOver(side);
        if (!rate) continue; // NO VALUE — no row, never a substituted zero.

        candidates.push({
          featureKey,
          teamId: subject.teamId,
          asOf: subject.asOf,
          value: rate.value,
          // The side's own qualifying match count (D-5c-i, non-composite).
          sampleObservationCount: rate.observations,
          // Layer 1 over football relations — consumes no feature.
          consumed: [],
        });
      }
    }

    return candidates;
  },
};
