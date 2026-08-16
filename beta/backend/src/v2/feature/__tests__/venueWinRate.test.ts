// ─────────────────────────────────────────────────────────────────────────────
// GATE C — venue_win_rate PURE-CALCULATOR TESTS (no database)
//
// The frozen formula (wins / matches × 100 per side), draw/loss handling, NO
// VALUE, home/away independence and observation count, pinned against synthetic
// contexts. V1's raw lifetime numbers are NOT used as goldens — the population
// was superseded (doc 76); these expectations are derived from the declared V2
// rule. The database-backed edition/boundary/isolation tests live in
// scopedPipeline.test.ts, where the scoped rig is.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { venueWinRate } from '../calculators/venueWinRate';
import { roundHalfUp, toNumericString } from '../write/scale';
import type { CalculationContext, CandidateValue, CompletedFixture } from '../calculators/types';

const AS_OF = new Date('2027-02-01T00:00:00Z');
const TEAM = '100';

let seq = 0;
function fx(isHome: boolean, goalsFor: number | null, goalsAgainst: number | null): CompletedFixture {
  seq += 1;
  return {
    fixtureId: String(seq),
    fixturePartitionOn: '2026-09-01',
    kickoffAt: new Date('2026-09-01T14:00:00Z'),
    isHome,
    goalsFor,
    goalsAgainst,
    venueId: '1',
  };
}

function contextFor(fixtures: CompletedFixture[], teamId = TEAM): CalculationContext {
  return {
    definitions: new Map(),
    subjects: [{ teamId, asOf: AS_OF }],
    fixturesByTeam: new Map([[teamId, { teamId, fixtures }]]),
    homeVenueByTeam: new Map(),
    venuesById: new Map(),
    priorValues: new Map(),
  };
}

function candidate(fixtures: CompletedFixture[], featureKey: string): CandidateValue | undefined {
  return venueWinRate
    .calculate(contextFor(fixtures))
    .find((c) => c.featureKey === featureKey && c.teamId === TEAM);
}

/** Rounded to the declared write scale (2), as the write boundary would store it. */
function stored(value: CandidateValue['value']): string {
  return toNumericString(roundHalfUp(value, 2));
}

describe('venue_win_rate — pure calculator', () => {
  it('1. 100% home win rate', () => {
    const c = candidate([fx(true, 2, 0), fx(true, 1, 0), fx(true, 3, 1)], 'team.home_win_rate');
    assert.ok(c);
    assert.equal(stored(c!.value), '100.00');
    assert.equal(c!.sampleObservationCount, 3);
  });

  it('2. 0% home win rate with matches present (not NO VALUE)', () => {
    const c = candidate([fx(true, 0, 1), fx(true, 1, 2)], 'team.home_win_rate');
    assert.ok(c, 'a played-and-never-won side is a real 0, not absence');
    assert.equal(stored(c!.value), '0.00');
    assert.equal(c!.sampleObservationCount, 2);
  });

  it('3. mixed wins/draws/losses', () => {
    // 4 home: 2W, 1D, 1L → 2/4 = 50.00
    const c = candidate([fx(true, 2, 0), fx(true, 1, 0), fx(true, 1, 1), fx(true, 0, 2)], 'team.home_win_rate');
    assert.equal(stored(c!.value), '50.00');
    assert.equal(c!.sampleObservationCount, 4);
  });

  it('4. draws count in the denominator, never the numerator', () => {
    // 1W, 1D → 1/2 = 50, NOT 1/1 = 100.
    const c = candidate([fx(true, 2, 0), fx(true, 1, 1)], 'team.home_win_rate');
    assert.equal(stored(c!.value), '50.00');
    assert.equal(c!.sampleObservationCount, 2);
  });

  it('5. losses count in the denominator', () => {
    // 1W, 1L → 1/2 = 50.
    const c = candidate([fx(true, 2, 0), fx(true, 0, 3)], 'team.home_win_rate');
    assert.equal(stored(c!.value), '50.00');
    assert.equal(c!.sampleObservationCount, 2);
  });

  it('6. zero qualifying home matches → NO home_win_rate row (away still present)', () => {
    const produced = venueWinRate.calculate(contextFor([fx(false, 1, 0), fx(false, 2, 1)]));
    assert.equal(produced.find((c) => c.featureKey === 'team.home_win_rate'), undefined);
    assert.ok(produced.find((c) => c.featureKey === 'team.away_win_rate'));
  });

  it('7. zero qualifying away matches → NO away_win_rate row (home still present)', () => {
    const produced = venueWinRate.calculate(contextFor([fx(true, 1, 0)]));
    assert.equal(produced.find((c) => c.featureKey === 'team.away_win_rate'), undefined);
    assert.ok(produced.find((c) => c.featureKey === 'team.home_win_rate'));
  });

  it('15. home and away populations are independently correct', () => {
    // Home: 2W/2 = 100. Away: 0W/2 = 0.
    const produced = venueWinRate.calculate(
      contextFor([fx(true, 1, 0), fx(true, 2, 1), fx(false, 0, 1), fx(false, 1, 3)])
    );
    const home = produced.find((c) => c.featureKey === 'team.home_win_rate');
    const away = produced.find((c) => c.featureKey === 'team.away_win_rate');
    assert.equal(stored(home!.value), '100.00');
    assert.equal(stored(away!.value), '0.00');
    assert.equal(home!.sampleObservationCount, 2);
    assert.equal(away!.sampleObservationCount, 2);
  });

  it('19. observation count equals the side’s qualifying match count', () => {
    // 3 home + 5 away; a completed fixture with no result is NOT counted.
    const c = candidate(
      [fx(true, 1, 0), fx(true, 0, 0), fx(true, 2, 2), fx(true, null, null)],
      'team.home_win_rate'
    );
    assert.equal(c!.sampleObservationCount, 3, 'the result-less fixture is excluded from matches');
  });

  it('a completed fixture with no result is excluded from the rate', () => {
    // 1W + 1 result-less → 1/1 = 100, not 1/2.
    const c = candidate([fx(true, 3, 0), fx(true, null, null)], 'team.home_win_rate');
    assert.equal(stored(c!.value), '100.00');
    assert.equal(c!.sampleObservationCount, 1);
  });

  it('a repeated non-round rate is exact before the write boundary rounds it', () => {
    // 1W / 3 = 33.333…%. Stored at scale 2 → 33.33.
    const c = candidate([fx(true, 1, 0), fx(true, 0, 1), fx(true, 1, 1)], 'team.home_win_rate');
    assert.equal(stored(c!.value), '33.33');
    assert.equal(c!.sampleObservationCount, 3);
  });

  it('is Layer 1: consumes no feature (independent of home_form / away_form)', () => {
    // Structural: the calculator declares COMPETITION_SCOPED, owns exactly the
    // two win-rate keys, and every candidate consumes nothing. It cannot be
    // deriving from form, which is a different calculator and quantity.
    assert.equal(venueWinRate.contextKind, 'COMPETITION_SCOPED');
    assert.deepEqual([...venueWinRate.featureKeys].sort(), ['team.away_win_rate', 'team.home_win_rate']);
    const produced = venueWinRate.calculate(contextFor([fx(true, 1, 0), fx(false, 0, 1)]));
    for (const c of produced) assert.deepEqual(c.consumed, []);
  });
});
