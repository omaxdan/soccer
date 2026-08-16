// ─────────────────────────────────────────────────────────────────────────────
// home_away_split — "Home-reliant or road warrior?"
//
// The first S-6 module, and a pure transcription of V1 `evalHomeAway` (doc 55):
//
//   disparity = home_win_rate − away_win_rate      (one team's own venue split)
//   |disparity| ≥ 40 → SUPPORTS                    (a strong home/away skew)
//   otherwise        → NEUTRAL
//
// TEAM-subject (ratified): the disparity is a SINGLE team's home rate against its
// OWN away rate, which is why no orientation is needed and none is invented. Both
// inputs are the same team's COMPETITION_SCOPED, edition-cumulative venue win
// rates (Gate C, `venue_win_rate`).
//
// The 40 is V1's threshold, transcribed — not invented here. There is no
// CONTRADICTS branch: V1's rule produces only SUPPORTS or NEUTRAL.
//
// PURE: a function of the two consumed values. No clock, no database, no
// orientation state — identical inputs give an identical finding.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MODULE_STATUS,
  type ConsumedFeature,
  type ModuleCalculator,
  type ModuleFinding,
} from '../types';
import { compare, fromInt, subtract, toNumericString, ZERO, type Exact } from '../../feature/write/scale';

const HOME_WIN_RATE = 'team.home_win_rate';
const AWAY_WIN_RATE = 'team.away_win_rate';

/** V1's threshold, transcribed. |disparity| at or above this is a strong split. */
const SUPPORT_THRESHOLD = fromInt(40);

/** Absolute value of an exact decimal. */
function magnitude(value: Exact): Exact {
  return compare(value, ZERO) < 0 ? subtract(ZERO, value) : value;
}

export const homeAwaySplit: ModuleCalculator = {
  moduleKey: 'home_away_split',
  subjectKind: 'TEAM',
  contextKind: 'COMPETITION_SCOPED',
  inputFeatureKeys: [HOME_WIN_RATE, AWAY_WIN_RATE],

  evaluate(inputs: ReadonlyMap<string, ConsumedFeature>): ModuleFinding {
    // The engine guarantees both are present before calling; assert rather than
    // silently coerce, so a contract breach is loud.
    const home = inputs.get(HOME_WIN_RATE);
    const away = inputs.get(AWAY_WIN_RATE);
    if (!home || !away) {
      throw new Error('home_away_split.evaluate called without both declared inputs present');
    }

    const disparity = subtract(home.value, away.value);
    const supports = compare(magnitude(disparity), SUPPORT_THRESHOLD) >= 0;
    const shown = toNumericString(disparity);

    return {
      status: supports ? MODULE_STATUS.SUPPORTS : MODULE_STATUS.NEUTRAL,
      // A characterisation, never a recommendation (LC-71). Deterministic from
      // the disparity.
      verdictText: supports
        ? `Pronounced home/away split: home minus away win rate is ${shown} points.`
        : `Balanced home and away record: home minus away win rate is ${shown} points.`,
    };
  },
};
