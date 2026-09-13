// MATCH INTELLIGENCE — PRESENTATION LOGIC TESTS (DB-free, pure). Run with:
//   npx tsx --test src/lib/v2/__tests__/matchIntelligence.test.ts
//
// Exercises the renderer-side honesty rules against the shapes of the two
// production-validated sealed snapshots (1163/1164): coverage 0.9167 → 91.67%;
// partial 55/60 preserved; HOME/AWAY components resolved to the right team; absent
// squad_stability → "No data" (never 0); a cited zero → present-zero (shown as 0);
// null edges/confidence → honest unavailable states, never a fabricated value;
// numeric text preserved exactly. No DOM, no network.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isZeroText,
  formatRatioPercent,
  trimNumericText,
  confidenceDisplay,
  governedEdgeDisplay,
  ungovernedFieldDisplay,
  verdictFieldDisplay,
  VERDICT_GRADED_FIELDS,
  resolveTeamComponents,
  preparednessScoreDisplay,
  formatProvenanceTime,
  humanizeFeatureKey,
} from '../matchIntelligence';
import type { IntelligenceVerdict, CitedEvidenceItem } from '../types';

// ── canary shapes (snapshot 1163, fixture 1384, home 599 / away 602) ─────────────

const VERDICT_1163: IntelligenceVerdict = {
  consensusSupportsCount: 1,
  consensusContradictsCount: 0,
  consensusNeutralCount: 1,
  consensusInactiveCount: 2,
  evidenceCount: 2,
  completenessRatio: '0.500000',
  formEdge: '5.2000',
  restEdge: null,
  readinessEdge: null,
  travelEdge: null,
  congestionEdge: null,
  availabilityEdge: null,
  riskScore: null,
  confidence: null,
  historicalReliabilityBaselineId: null,
};

// The components 1163 cites for HOME 599 and AWAY 602 — squad_stability deliberately
// ABSENT for both; team.home_form present-but-ZERO (0.00) for 599.
const CITED_1163: CitedEvidenceItem[] = [
  { featureKey: 'team.home_form', subjectTeamId: '599', value: '0.00', featureVersionId: '11', featureValueId: '903', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 5, sampleMeetsThreshold: true },
  { featureKey: 'team.congestion_index', subjectTeamId: '599', value: '10.00', featureVersionId: '13', featureValueId: '902', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 3, sampleMeetsThreshold: true },
  { featureKey: 'team.home_win_rate', subjectTeamId: '599', value: '40.00', featureVersionId: '14', featureValueId: '904', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 4, sampleMeetsThreshold: true },
  { featureKey: 'team.away_form', subjectTeamId: '602', value: '28.60', featureVersionId: '11', featureValueId: '900', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 6, sampleMeetsThreshold: true },
  { featureKey: 'team.congestion_index', subjectTeamId: '602', value: '20.00', featureVersionId: '13', featureValueId: '905', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 3, sampleMeetsThreshold: true },
  { featureKey: 'team.away_win_rate', subjectTeamId: '602', value: '100.00', featureVersionId: '12', featureValueId: '901', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 4, sampleMeetsThreshold: false },
];

describe('numeric-text formatting', () => {
  test('coverage ratio 0.9167 renders as 91.67%, not the raw ratio', () => {
    assert.equal(formatRatioPercent('0.9167'), '91.67%');
    assert.notEqual(formatRatioPercent('0.9167'), '0.9167');
  });

  test('completeness 0.500000 → 50.00%; full/zero coverage handled', () => {
    assert.equal(formatRatioPercent('0.500000'), '50.00%');
    assert.equal(formatRatioPercent('1.0000'), '100.00%');
    assert.equal(formatRatioPercent('0.0000'), '0.00%');
  });

  test('isZeroText distinguishes a real zero from a value', () => {
    assert.equal(isZeroText('0.00'), true);
    assert.equal(isZeroText('0.0000'), true);
    assert.equal(isZeroText('0'), true);
    assert.equal(isZeroText('13.5000'), false);
  });

  test('trimNumericText keeps exact value, drops only scale zeros', () => {
    assert.equal(trimNumericText('13.5000'), '13.5');
    assert.equal(trimNumericText('55'), '55');
    assert.equal(trimNumericText('0.00'), '0');
    assert.equal(trimNumericText('28.6000'), '28.6');
  });
});

describe('graded-field honesty (null ≠ zero, never fabricated)', () => {
  test('null confidence → "Not yet calibrated", never a percentage', () => {
    const d = confidenceDisplay(null);
    assert.equal(d.present, false);
    assert.equal(d.text, 'Not yet calibrated');
    assert.equal(/\d/.test(d.text), false); // no fabricated number at all
  });

  test('present confidence surfaces the exact value', () => {
    assert.deepEqual(confidenceDisplay('0.73'), { present: true, text: '0.73' });
  });

  test('null governed edge → "No governed value"; present edge verbatim', () => {
    assert.equal(governedEdgeDisplay(null).text, 'No governed value');
    assert.deepEqual(governedEdgeDisplay('5.2000'), { present: true, text: '5.2000' });
  });

  test('null ungoverned field → "Not available"', () => {
    assert.deepEqual(ungovernedFieldDisplay(null), { present: false, text: 'Not available' });
  });

  test('verdict field resolution: formEdge governed present; risk/confidence honest-null', () => {
    const byLabel = (l: string) => VERDICT_GRADED_FIELDS.find((s) => s.label === l)!;
    assert.deepEqual(verdictFieldDisplay(byLabel('Form edge'), VERDICT_1163), { present: true, text: '5.2000' });
    assert.equal(verdictFieldDisplay(byLabel('Rest edge'), VERDICT_1163).text, 'No governed value');
    assert.equal(verdictFieldDisplay(byLabel('Risk score'), VERDICT_1163).text, 'Not available');
    assert.equal(verdictFieldDisplay(byLabel('Confidence'), VERDICT_1163).text, 'Not yet calibrated');
    // none of the honest-null labels contain a digit (no fabricated 0/percentage)
    for (const s of VERDICT_GRADED_FIELDS) {
      const d = verdictFieldDisplay(s, VERDICT_1163);
      if (!d.present) assert.equal(/\d/.test(d.text), false, `${s.label} unavailable label must carry no number`);
    }
  });
});

describe('preparedness score & coverage (partial 55/60 preserved)', () => {
  test('HOME 13.5000 / 60 and AWAY 28.6000 / 60 preserve exact values', () => {
    assert.deepEqual(preparednessScoreDisplay('13.5000', '60'), { present: true, text: '13.5 / 60' });
    assert.deepEqual(preparednessScoreDisplay('28.6000', '60'), { present: true, text: '28.6 / 60' });
  });

  test('null preparedness points → honest "No score", never 0', () => {
    const d = preparednessScoreDisplay(null, '60');
    assert.equal(d.present, false);
    assert.equal(d.text, 'No score');
  });

  test('55/60 is a partial coverage of 91.67% (not promoted to full, not recomputed)', () => {
    assert.equal(formatRatioPercent('0.9167'), '91.67%');
    // available < declared is the honest disclosure that a component is missing
    assert.equal(Number.parseFloat('55') < Number.parseFloat('60'), true);
  });
});

describe('component breakdown from cited evidence (absence-honest)', () => {
  test('HOME 599: Form present-zero (0), Congestion & Venue present, Squad stability ABSENT', () => {
    const comps = resolveTeamComponents('HOME', '599', CITED_1163);
    const form = comps.find((c) => c.label === 'Form')!;
    const cong = comps.find((c) => c.label === 'Fixture congestion')!;
    const venue = comps.find((c) => c.label === 'Venue win rate')!;
    const squad = comps.find((c) => c.label === 'Squad stability')!;

    // present-but-zero: a real cited 0, shown as 0 — NOT "No data"
    assert.equal(form.presence, 'present-zero');
    assert.equal(form.value, '0.00');
    assert.equal(trimNumericText(form.value!), '0');

    assert.equal(cong.presence, 'present');
    assert.equal(cong.value, '10.00');
    assert.equal(venue.presence, 'present');
    assert.equal(venue.value, '40.00'); // home_win_rate resolved for HOME

    // absent → "No data" (the frontend renders this presence as No data), never 0
    assert.equal(squad.presence, 'absent');
    assert.equal(squad.value, null);
  });

  test('AWAY 602: resolves away-side keys to the away team, squad still absent', () => {
    const comps = resolveTeamComponents('AWAY', '602', CITED_1163);
    const form = comps.find((c) => c.label === 'Form')!;
    const venue = comps.find((c) => c.label === 'Venue win rate')!;
    const cong = comps.find((c) => c.label === 'Fixture congestion')!;
    const squad = comps.find((c) => c.label === 'Squad stability')!;

    assert.equal(form.presence, 'present');
    assert.equal(form.value, '28.60'); // away_form, not home_form
    assert.equal(venue.value, '100.00'); // away_win_rate for AWAY, below threshold
    assert.equal(venue.sampleMeetsThreshold, false);
    assert.equal(cong.value, '20.00'); // shared key attributed to 602 by subject team
    assert.equal(squad.presence, 'absent');
  });

  test('shared-key components are attributed by subject team, not leaked across sides', () => {
    // congestion for HOME (599) must be 10.00, AWAY (602) must be 20.00 — never swapped
    const home = resolveTeamComponents('HOME', '599', CITED_1163).find((c) => c.label === 'Fixture congestion')!;
    const away = resolveTeamComponents('AWAY', '602', CITED_1163).find((c) => c.label === 'Fixture congestion')!;
    assert.equal(home.value, '10.00');
    assert.equal(away.value, '20.00');
  });

  test('the four governed components are always enumerated (present or absent)', () => {
    const comps = resolveTeamComponents('HOME', '599', CITED_1163);
    assert.deepEqual(comps.map((c) => c.label), ['Form', 'Fixture congestion', 'Venue win rate', 'Squad stability']);
    // declared weights mirror the governed composition, summing to 60
    assert.equal(comps.reduce((s, c) => s + c.declaredPoints, 0), 60);
  });
});

describe('cited-evidence labelling & provenance time', () => {
  test('humanizeFeatureKey turns keys into readable labels without hiding the key', () => {
    assert.equal(humanizeFeatureKey('team.home_form'), 'Home form');
    assert.equal(humanizeFeatureKey('team.squad_stability'), 'Squad stability');
  });

  test('provenance timestamp renders a friendly UTC string', () => {
    // Node's ICU abbreviates September as "Sept"; assert on the real rendered form.
    assert.equal(formatProvenanceTime('2026-09-13T12:30:00.000Z'), '13 Sept 2026, 12:30 UTC');
  });
});
