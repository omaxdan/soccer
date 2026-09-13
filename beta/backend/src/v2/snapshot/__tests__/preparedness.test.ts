// TEAM PREPAREDNESS TESTS (S-7 B3, v1.3.0) — DB-free.
//
// Proves the pure composition and its checksum fold:
//   • coverage over any subset of the four components (all/one/two/three/none);
//   • a MISSING input never becomes zero (it lowers available, points are NULL when
//     nothing is present) while a PRESENT-but-zero input is a real 0;
//   • NO redistribution of missing weights (denominator stays 60);
//   • congestion orientation (100 − x) and squad 0–1 scaling;
//   • HOME/AWAY independence + deterministic side ordering;
//   • per-feature scope assignment (venue is the edition-scoped group);
//   • determinism (same inputs → byte-identical output);
//   • the teamPreparedness fold changes the checksum, and its ABSENCE leaves the
//     pre-1.3.0 verdict checksum byte-identical (edges unaffected);
//   • the governing-version gate.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeTeamPreparedness,
  preparednessGovernedIn,
  HOME_FORM_FEATURE_KEY,
  AWAY_FORM_FEATURE_KEY,
  CONGESTION_FEATURE_KEY,
  HOME_WIN_RATE_FEATURE_KEY,
  AWAY_WIN_RATE_FEATURE_KEY,
  SQUAD_STABILITY_FEATURE_KEY,
  type PreparednessInput,
  type PreparednessSideInputs,
  type Side,
} from '../preparedness';
import { ALL_COMPETITIONS_KEYS, COMPETITION_SCOPED_KEYS } from '../read/preparednessInputs';
import { fromString } from '../../feature/write/scale';
import { buildContent } from '../seal';
import { contentChecksumHex } from '../canonical';
import { computeFormEdge, computeRestEdge } from '../verdict';
import type { FixtureToSeal } from '../read/selection';

// ── helpers ──────────────────────────────────────────────────────────────────

let seq = 1;
function input(featureKey: string, value: string): PreparednessInput {
  const n = seq++;
  return {
    featureKey,
    value: fromString(value),
    featureValueId: String(1000 + n),
    featureValueAsOf: new Date('2027-05-01T00:00:00.000Z'),
    featureVersionId: String(200 + n),
  };
}

function side(s: Side, parts: Partial<Omit<PreparednessSideInputs, 'side' | 'teamId'>>): PreparednessSideInputs {
  return { side: s, teamId: s === 'HOME' ? '11' : '22', ...parts };
}

function only(side: Side, results: readonly { side: Side }[]) {
  const r = results.find((x) => x.side === side);
  assert.ok(r, `expected a ${side} result`);
  return r as ReturnType<typeof computeTeamPreparedness>[number];
}

// ── coverage over subsets ──────────────────────────────────────────────────────

describe('team preparedness — coverage', () => {
  test('1. all four present → full available, weighted sum', () => {
    const home = side('HOME', {
      form: input(HOME_FORM_FEATURE_KEY, '80'),      // 80/100*30 = 24
      congestion: input(CONGESTION_FEATURE_KEY, '40'), // (100-40)/100*15 = 9
      venue: input(HOME_WIN_RATE_FEATURE_KEY, '60'),   // 60/100*10 = 6
      squad: input(SQUAD_STABILITY_FEATURE_KEY, '0.75'), // 0.75*5 = 3.75
    });
    const away = side('AWAY', {});
    const h = only('HOME', computeTeamPreparedness(home, away));
    assert.equal(h.preparednessPoints, '42.7500'); // 24+9+6+3.75
    assert.equal(h.availablePoints, '60');
    assert.equal(h.declaredPoints, '60');
    assert.equal(h.coverageRatio, '1.0000');
  });

  test('2. one missing (no squad) → available 55, no redistribution', () => {
    const home = side('HOME', {
      form: input(HOME_FORM_FEATURE_KEY, '80'),
      congestion: input(CONGESTION_FEATURE_KEY, '40'),
      venue: input(HOME_WIN_RATE_FEATURE_KEY, '60'),
    });
    const h = only('HOME', computeTeamPreparedness(home, side('AWAY', {})));
    assert.equal(h.preparednessPoints, '39.0000'); // 24+9+6 — squad's 3.75 is NOT redistributed
    assert.equal(h.availablePoints, '55');
    assert.equal(h.coverageRatio, '0.9167'); // 55/60
  });

  test('3. two missing (form + congestion only) → available 45', () => {
    const home = side('HOME', {
      form: input(HOME_FORM_FEATURE_KEY, '100'),       // 30
      congestion: input(CONGESTION_FEATURE_KEY, '0'),  // (100-0)/100*15 = 15
    });
    const h = only('HOME', computeTeamPreparedness(home, side('AWAY', {})));
    assert.equal(h.preparednessPoints, '45.0000');
    assert.equal(h.availablePoints, '45');
    assert.equal(h.coverageRatio, '0.7500');
  });

  test('4. three missing (squad only) → available 5, NO rescale to 60', () => {
    const home = side('HOME', { squad: input(SQUAD_STABILITY_FEATURE_KEY, '0.5') });
    const h = only('HOME', computeTeamPreparedness(home, side('AWAY', {})));
    assert.equal(h.preparednessPoints, '2.5000'); // 0.5*5 — not 0.5*60
    assert.equal(h.availablePoints, '5');
    assert.equal(h.coverageRatio, '0.0833'); // 5/60
  });

  test('5. all missing → points NULL, available 0, coverage 0 (never zero-as-score)', () => {
    const h = only('HOME', computeTeamPreparedness(side('HOME', {}), side('AWAY', {})));
    assert.equal(h.preparednessPoints, null);
    assert.equal(h.availablePoints, '0');
    assert.equal(h.declaredPoints, '60');
    assert.equal(h.coverageRatio, '0.0000');
  });
});

describe('team preparedness — absence vs zero', () => {
  test('6. a missing input does not become zero; a present-but-zero input is a real 0', () => {
    // Only congestion present, at 100 → oriented 0 → 0 points, but PRESENT.
    const h = only('HOME', computeTeamPreparedness(
      side('HOME', { congestion: input(CONGESTION_FEATURE_KEY, '100') }),
      side('AWAY', {})
    ));
    assert.equal(h.preparednessPoints, '0.0000'); // present-but-zero: a real 0
    assert.equal(h.availablePoints, '15');        // congestion counted as present
    // Contrast: a side with NOTHING present is NULL, not 0 (case 5).
    const empty = only('AWAY', computeTeamPreparedness(side('HOME', {}), side('AWAY', {})));
    assert.equal(empty.preparednessPoints, null);
  });

  test('7. no redistribution: available reflects only present weights', () => {
    const h = only('HOME', computeTeamPreparedness(
      side('HOME', { venue: input(HOME_WIN_RATE_FEATURE_KEY, '100') }), // 10
      side('AWAY', {})
    ));
    assert.equal(h.preparednessPoints, '10.0000');
    assert.equal(h.availablePoints, '10'); // NOT 60
    assert.equal(h.coverageRatio, '0.1667'); // 10/60
  });
});

describe('team preparedness — orientation & scaling', () => {
  test('8. congestion orientation is 100 − x', () => {
    const low = only('HOME', computeTeamPreparedness(
      side('HOME', { congestion: input(CONGESTION_FEATURE_KEY, '0') }), side('AWAY', {})));
    const high = only('HOME', computeTeamPreparedness(
      side('HOME', { congestion: input(CONGESTION_FEATURE_KEY, '100') }), side('AWAY', {})));
    assert.equal(low.preparednessPoints, '15.0000');  // (100-0)/100*15
    assert.equal(high.preparednessPoints, '0.0000');  // (100-100)/100*15
  });

  test('9. squad stability scales a 0–1 ratio by 5', () => {
    const full = only('HOME', computeTeamPreparedness(
      side('HOME', { squad: input(SQUAD_STABILITY_FEATURE_KEY, '1') }), side('AWAY', {})));
    const half = only('HOME', computeTeamPreparedness(
      side('HOME', { squad: input(SQUAD_STABILITY_FEATURE_KEY, '0.5') }), side('AWAY', {})));
    assert.equal(full.preparednessPoints, '5.0000');
    assert.equal(half.preparednessPoints, '2.5000');
  });
});

describe('team preparedness — sides, scopes, determinism', () => {
  test('10. HOME/AWAY are independent and the output is ordered AWAY, HOME', () => {
    const results = computeTeamPreparedness(
      side('HOME', { form: input(HOME_FORM_FEATURE_KEY, '90') }),  // 27
      side('AWAY', { form: input(AWAY_FORM_FEATURE_KEY, '10') })   // 3
    );
    assert.deepEqual(results.map((r) => r.side), ['AWAY', 'HOME']); // deterministic order
    assert.equal(only('HOME', results).preparednessPoints, '27.0000');
    assert.equal(only('AWAY', results).preparednessPoints, '3.0000');
  });

  test('11/12. scope assignment: venue keys are edition-scoped; the rest ALL_COMPETITIONS', () => {
    assert.deepEqual([...COMPETITION_SCOPED_KEYS], [HOME_WIN_RATE_FEATURE_KEY, AWAY_WIN_RATE_FEATURE_KEY]);
    assert.deepEqual([...ALL_COMPETITIONS_KEYS], [
      HOME_FORM_FEATURE_KEY, AWAY_FORM_FEATURE_KEY, CONGESTION_FEATURE_KEY, SQUAD_STABILITY_FEATURE_KEY,
    ]);
    // Exact governed repository names (guards against a rename such as team_continuity).
    assert.equal(SQUAD_STABILITY_FEATURE_KEY, 'team.squad_stability');
  });

  test('13. deterministic: identical inputs → byte-identical results', () => {
    const mk = () => computeTeamPreparedness(
      side('HOME', {
        form: input(HOME_FORM_FEATURE_KEY, '73.5'),
        congestion: input(CONGESTION_FEATURE_KEY, '22'),
        venue: input(HOME_WIN_RATE_FEATURE_KEY, '48'),
        squad: input(SQUAD_STABILITY_FEATURE_KEY, '0.6667'),
      }),
      side('AWAY', { form: input(AWAY_FORM_FEATURE_KEY, '61') })
    );
    const a = mk();
    const b = mk();
    assert.deepEqual(
      a.map((r) => [r.side, r.preparednessPoints, r.availablePoints, r.coverageRatio]),
      b.map((r) => [r.side, r.preparednessPoints, r.availablePoints, r.coverageRatio])
    );
  });

  test('governing-version gate: preparedness is 1.3.0+ only', () => {
    assert.equal(preparednessGovernedIn('1.2.0'), false);
    assert.equal(preparednessGovernedIn('1.3.0'), true);
    assert.equal(preparednessGovernedIn('1.10.0'), true); // numeric, not lexical
    assert.equal(preparednessGovernedIn('2.0.0'), true);
    assert.equal(preparednessGovernedIn('nonsense'), false);
  });
});

// ── checksum fold ───────────────────────────────────────────────────────────────

const FIXTURE: FixtureToSeal = {
  fixtureId: '900',
  fixturePartitionOn: '2027-05-01',
  kickoffAt: new Date('2027-05-01T15:00:00.000Z'),
  homeTeamId: '11',
  awayTeamId: '22',
  competitionEditionId: '5',
};

function baseVerdictArgs(teamPreparedness?: Parameters<typeof buildContent>[0]['verdict']['teamPreparedness']) {
  return {
    fixture: FIXTURE,
    snapshotPointCode: 'T_MINUS_24H',
    snapshotAsOf: new Date('2027-04-30T15:00:00.000Z'),
    verdictCompositionDesignation: teamPreparedness ? '1.3.0' : '1.2.0',
    consensusRuleDesignation: '1.0.0',
    checksumAlgorithmDesignation: 'v1',
    spoke: [],
    manifest: [],
    completenessItems: [],
    verdict: {
      consensusSupportsCount: 0, consensusContradictsCount: 0, consensusNeutralCount: 0,
      consensusInactiveCount: 3, evidenceCount: 0, completenessRatioText: '0.000000',
      restEdge: null, formEdge: null, teamPreparedness,
    },
  };
}

describe('team preparedness — checksum fold (canonical v1 preserved)', () => {
  test('15. omitting preparedness leaves the verdict byte-identical (no teamPreparedness key)', () => {
    const withUndefined = buildContent(baseVerdictArgs(undefined));
    // The canonical content must not contain the key at all when ungoverned.
    const json = JSON.stringify(withUndefined.verdict);
    assert.ok(!json.includes('teamPreparedness'), 'pre-1.3.0 verdict must carry no teamPreparedness key');
  });

  test('14. adding preparedness changes the checksum; different scores → different digests', () => {
    const none = contentChecksumHex(buildContent(baseVerdictArgs(undefined)));
    const prepA = contentChecksumHex(buildContent(baseVerdictArgs([
      { side: 'AWAY', preparednessPoints: '3.0000', availablePoints: '30', declaredPoints: '60', coverageRatio: '0.5000' },
      { side: 'HOME', preparednessPoints: '27.0000', availablePoints: '30', declaredPoints: '60', coverageRatio: '0.5000' },
    ])));
    const prepB = contentChecksumHex(buildContent(baseVerdictArgs([
      { side: 'AWAY', preparednessPoints: '4.0000', availablePoints: '30', declaredPoints: '60', coverageRatio: '0.5000' },
      { side: 'HOME', preparednessPoints: '27.0000', availablePoints: '30', declaredPoints: '60', coverageRatio: '0.5000' },
    ])));
    assert.notEqual(none, prepA);   // presence changes the digest
    assert.notEqual(prepA, prepB);  // a changed score changes the digest
  });

  test('a NULL preparedness_points is distinct from a zero score in the digest', () => {
    const withNull = contentChecksumHex(buildContent(baseVerdictArgs([
      { side: 'AWAY', preparednessPoints: null, availablePoints: '0', declaredPoints: '60', coverageRatio: '0.0000' },
      { side: 'HOME', preparednessPoints: '0.0000', availablePoints: '15', declaredPoints: '60', coverageRatio: '0.2500' },
    ])));
    const withZero = contentChecksumHex(buildContent(baseVerdictArgs([
      { side: 'AWAY', preparednessPoints: '0.0000', availablePoints: '0', declaredPoints: '60', coverageRatio: '0.0000' },
      { side: 'HOME', preparednessPoints: '0.0000', availablePoints: '15', declaredPoints: '60', coverageRatio: '0.2500' },
    ])));
    assert.notEqual(withNull, withZero);
  });
});

describe('16. existing edge composition is untouched', () => {
  test('form/rest edge functions still return null when their reading is absent', () => {
    // No FIXTURE reading present → both edges null, exactly as before this change.
    assert.equal(computeFormEdge([], { homeTeamId: '11', awayTeamId: '22' }), null);
    assert.equal(computeRestEdge([], { homeTeamId: '11', awayTeamId: '22' }), null);
  });
});
