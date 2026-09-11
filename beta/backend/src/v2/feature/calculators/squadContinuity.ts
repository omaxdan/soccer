// ─────────────────────────────────────────────────────────────────────────────
// squad_continuity — team.squad_stability
//
// THE FIRST SELECTION-CONTINUITY DERIVED FEATURE (doc 98, governed).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE GOVERNED DEFINITION, VERBATIM (doc 98)
//
//   measure   A3 on A1 — the arithmetic MEAN of the per-transition
//             player-retention ratios `|XIₙ ∩ XIₙ₋₁| / 11` over the window.
//   window    the last 6 ELIGIBLE completed fixtures (up to 5 transitions).
//   eligible  a COMPLETED fixture, kickoff < as_of, with EXACTLY 11 determinable
//             starters. Anything else is a chain-breaking gap.
//   gaps      break the chain — only ADJACENT eligible fixtures in the completed
//             sequence form a transition; never bridge across a gap.
//   threshold 3 valid transitions. 0–2 → NO VALUE (no row). 3–5 → a value.
//   output    raw ratio in [0,1]; the write boundary rounds once to scale 4.
//   sample    `sampleObservationCount` counts TRANSITIONS, not fixtures.
//
// Player IDENTITY only: not position, not minutes, not rating. Source-based on
// football fixture/lineup/lineup_selection (declared in registry/declare.ts) —
// it consumes NO feature, so it has no `feature_dependency` edge and its
// `consumed` is empty.
//
// ─────────────────────────────────────────────────────────────────────────────
// PURE AND AS-OF SAFE
//
// No clock, no database. The read already bounds the substrate to
// `kickoff < as_of`; this re-applies the same strict bound (mirroring `before()`)
// so a calculator handed a stray fixture would still exclude it. Deterministic:
// the substrate is sorted by `(kickoffAt, fixtureId)` before any comparison.
// ─────────────────────────────────────────────────────────────────────────────

import { divide, fromInt, type Exact } from '../write/scale';
import type {
  CalculationContext,
  Calculator,
  CandidateValue,
  StartingLineupObservation,
  TeamStartingLineups,
} from './types';

const SQUAD_STABILITY = 'team.squad_stability';

/** The governed window: last 6 eligible completed fixtures → up to 5 transitions. */
const WINDOW = 6;
/** A starting XI is exactly eleven; anything else is ineligible (doc 98 §6). */
const STARTERS = 11;
/** Governed minimum valid transitions (doc 98 §5); the registry threshold is also 3. */
const MIN_TRANSITIONS = 3;

/** Exactly-11 determinable starters is the eligibility test. */
function isEligible(observation: StartingLineupObservation): boolean {
  return observation.starterPlayerIds.length === STARTERS;
}

/** Completed fixtures strictly before `as_of`, ascending `(kickoffAt, fixtureId)`. */
function orderedBefore(
  history: TeamStartingLineups,
  asOf: Date
): readonly StartingLineupObservation[] {
  return history.fixtures
    .filter((observation) => observation.kickoffAt.getTime() < asOf.getTime())
    .slice()
    .sort((a, b) => {
      const byTime = a.kickoffAt.getTime() - b.kickoffAt.getTime();
      if (byTime !== 0) return byTime;
      return a.fixtureId < b.fixtureId ? -1 : a.fixtureId > b.fixtureId ? 1 : 0;
    });
}

/** Starters retained from `previous` to `current` — set intersection size. */
function retained(
  previous: StartingLineupObservation,
  current: StartingLineupObservation
): number {
  const previousStarters = new Set(previous.starterPlayerIds);
  let count = 0;
  for (const playerId of current.starterPlayerIds) {
    if (previousStarters.has(playerId)) count += 1;
  }
  return count;
}

export const squadContinuity: Calculator = {
  calculatorKey: 'squad_continuity',
  featureKeys: [SQUAD_STABILITY],
  // Reads the per-team starting XIs; the pipeline populates them only for this.
  needsStartingLineups: true,

  calculate(context: CalculationContext): readonly CandidateValue[] {
    const lineupsByTeam = context.startingLineupsByTeam ?? new Map();
    const candidates: CandidateValue[] = [];

    for (const subject of context.subjects) {
      const history = lineupsByTeam.get(subject.teamId);
      if (!history) continue;

      const completed = orderedBefore(history, subject.asOf);

      // The window is the SUFFIX of the completed sequence beginning at the
      // 6th-most-recent eligible fixture, so it holds exactly the last ≤6
      // eligible fixtures — plus any interleaved ineligible ones, which the
      // transition loop skips (that is how a gap breaks the chain).
      const eligibleIndices: number[] = [];
      completed.forEach((observation, index) => {
        if (isEligible(observation)) eligibleIndices.push(index);
      });
      if (eligibleIndices.length === 0) continue;
      const windowStart = eligibleIndices[Math.max(0, eligibleIndices.length - WINDOW)];
      const window = completed.slice(windowStart);

      // Transitions between ADJACENT completed fixtures that are BOTH eligible.
      let retainedSum = 0;
      let transitions = 0;
      for (let i = 1; i < window.length; i++) {
        const previous = window[i - 1];
        const current = window[i];
        if (!isEligible(previous) || !isEligible(current)) continue; // gap breaks
        retainedSum += retained(previous, current);
        transitions += 1;
      }

      // 0–2 valid transitions → NO VALUE (absent row), never a floor (doc 98 §9).
      if (transitions < MIN_TRANSITIONS) continue;

      // A3: mean of (retained / 11) over the transitions = retainedSum / (11·n).
      // Unrounded; the write boundary rounds once to the registry scale (4).
      const value: Exact = divide(fromInt(retainedSum), fromInt(STARTERS * transitions));

      candidates.push({
        featureKey: SQUAD_STABILITY,
        teamId: subject.teamId,
        asOf: subject.asOf,
        value,
        // Source-based: the calculator OWNS the observation count — the number of
        // valid transitions the value rests on (doc 98). Not a composite, so the
        // write layer does not derive it.
        sampleObservationCount: transitions,
        consumed: [],
      });
    }

    return candidates;
  },
};
