// S-7 VERDICT / CONSENSUS / COMPLETENESS TESTS — DB-free.
//
// Proves the NON-DIRECTIONAL v1.0.0 semantics: (module,team) consensus unit,
// inactive separate from neutral, dissent retained, eligible-module completeness,
// absence recorded as absence, zeros preserved, and — structurally — that edges,
// risk, confidence and historical reliability are NULL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tallyConsensus, computeCompleteness, buildVerdict, buildManifest,
  computeRestEdge, restEdgeGovernedIn, REST_ADVANTAGE_FEATURE_KEY,
  type SpokeReading, type EligibleModule, type EngagedStatus, type CitedFeatureValue,
} from '../verdict';

const cv = (over: Partial<CitedFeatureValue> = {}): CitedFeatureValue => ({
  featureValueId: '10', featureValueAsOf: new Date('2027-07-01T00:00:00Z'), featureVersionId: '5',
  featureDefinitionId: '3', featureKey: 'team.momentum', subjectTeamId: null, value: '15', provenanceClassCode: 'DERIVED',
  sampleObservationCount: 10, sampleMeetsThreshold: true, contributionDirection: 'SUPPORTS', ...over,
});

let rid = 0;
const reading = (moduleKey: string, teamId: string, status: EngagedStatus, over: Partial<SpokeReading> = {}): SpokeReading => ({
  readingId: String(++rid), readingAsOf: new Date('2027-07-01T00:00:00Z'), moduleKey,
  moduleDefinitionId: moduleKey === 'home_away_split' ? '1' : '2',
  moduleVersionId: moduleKey === 'home_away_split' ? '11' : '12',
  subjectKindCode: 'TEAM', fixtureId: null,
  teamId, status, sampleObservationCount: 10, sampleMeetsThreshold: true,
  contextKindCode: moduleKey === 'home_away_split' ? 'COMPETITION_SCOPED' : 'ALL_COMPETITIONS',
  contextCompetitionEditionId: moduleKey === 'home_away_split' ? '42' : null,
  declaredInputCount: moduleKey === 'home_away_split' ? 2 : 1,
  presentInputCount: moduleKey === 'home_away_split' ? 2 : 1,
  citedValues: [cv()], ...over,
});

// Two eligible active modules (both TEAM → 2 slots each) plus one FIXTURE module (1 slot).
const eligible: EligibleModule[] = [
  { moduleKey: 'home_away_split', moduleDefinitionId: '1', subjectKindCode: 'TEAM', applicableSubjectCount: 2 },
  { moduleKey: 'readiness_tracker', moduleDefinitionId: '2', subjectKindCode: 'TEAM', applicableSubjectCount: 2 },
  { moduleKey: 'rest_advantage', moduleDefinitionId: '6', subjectKindCode: 'FIXTURE', applicableSubjectCount: 1 },
];
const eligibleSlots = 2 + 2 + 1; // 5

describe('consensus tallying (evidence distribution, never a vote)', () => {
  test('SUPPORTS / SUPPORTS → supports 2 (two engaged team readings, no winner)', () => {
    const c = tallyConsensus([reading('readiness_tracker', 'H', 'SUPPORTS'), reading('readiness_tracker', 'A', 'SUPPORTS')], eligible);
    assert.equal(c.supports, 2);
    assert.equal(c.contradicts, 0);
    assert.equal(c.evidenceCount, 2);
    assert.equal(c.inactive, eligibleSlots - 2);
  });

  test('SUPPORTS / CONTRADICTS → dissent retained (1 and 1)', () => {
    const c = tallyConsensus([reading('readiness_tracker', 'H', 'SUPPORTS'), reading('readiness_tracker', 'A', 'CONTRADICTS')], eligible);
    assert.equal(c.supports, 1);
    assert.equal(c.contradicts, 1);
    assert.equal(c.neutral, 0);
    assert.equal(c.evidenceCount, 2);
  });

  test('SUPPORTS / NEUTRAL', () => {
    const c = tallyConsensus([reading('readiness_tracker', 'H', 'SUPPORTS'), reading('readiness_tracker', 'A', 'NEUTRAL')], eligible);
    assert.equal(c.supports, 1);
    assert.equal(c.neutral, 1);
    assert.equal(c.evidenceCount, 2);
  });

  test('all neutral is distinct from no readings', () => {
    const c = tallyConsensus([reading('home_away_split', 'H', 'NEUTRAL'), reading('home_away_split', 'A', 'NEUTRAL')], eligible);
    assert.equal(c.neutral, 2);
    assert.equal(c.evidenceCount, 2);
    assert.notEqual(c.evidenceCount, 0);
  });

  test('no readings → all zero, every eligible slot inactive', () => {
    const c = tallyConsensus([], eligible);
    assert.deepEqual(
      { s: c.supports, c: c.contradicts, n: c.neutral, e: c.evidenceCount, i: c.inactive },
      { s: 0, c: 0, n: 0, e: 0, i: eligibleSlots }
    );
  });

  test('one team has a reading, the other does not → asymmetry preserved in inactive', () => {
    const c = tallyConsensus([reading('readiness_tracker', 'H', 'SUPPORTS')], eligible);
    assert.equal(c.evidenceCount, 1);
    assert.equal(c.inactive, eligibleSlots - 1);
  });

  test('inactive is never negative', () => {
    const many = [reading('home_away_split', 'H', 'SUPPORTS'), reading('home_away_split', 'A', 'SUPPORTS'),
      reading('readiness_tracker', 'H', 'SUPPORTS'), reading('readiness_tracker', 'A', 'SUPPORTS')];
    const c = tallyConsensus(many, eligible);
    assert.ok(c.inactive >= 0);
  });

  test('evidence_count excludes inactive (matches the schema CHECK)', () => {
    const c = tallyConsensus([reading('readiness_tracker', 'H', 'SUPPORTS')], eligible);
    assert.equal(c.evidenceCount, c.supports + c.contradicts + c.neutral);
  });
});

describe('completeness (eligible-module denominator; absence as absence)', () => {
  test('engaged vs expected modules, ratio, and MODULE_INACTIVE items for the silent ones', () => {
    const spoke = [reading('home_away_split', 'H', 'SUPPORTS'), reading('readiness_tracker', 'H', 'SUPPORTS')];
    const comp = computeCompleteness(spoke, eligible);
    assert.equal(comp.expectedModuleCount, 3);
    assert.equal(comp.engagedModuleCount, 2); // home_away_split + readiness_tracker
    assert.equal(comp.completenessRatio, 2 / 3);
    const inactiveItems = comp.items.filter((i) => i.absenceKind === 'MODULE_INACTIVE');
    assert.equal(inactiveItems.length, 1); // rest_advantage never engaged
    assert.equal(inactiveItems[0].moduleDefinitionId, '6');
  });

  test('no readings → completeness ratio 0, every eligible module MODULE_INACTIVE', () => {
    const comp = computeCompleteness([], eligible);
    assert.equal(comp.engagedModuleCount, 0);
    assert.equal(comp.completenessRatio, 0);
    assert.equal(comp.items.filter((i) => i.absenceKind === 'MODULE_INACTIVE').length, 3);
  });

  test('expected/present feature counts sum the engaged modules’ evidence declarations', () => {
    const spoke = [reading('home_away_split', 'H', 'SUPPORTS'), reading('readiness_tracker', 'H', 'SUPPORTS')];
    const comp = computeCompleteness(spoke, eligible);
    assert.equal(comp.expectedFeatureCount, 2 + 1); // home_away declares 2, readiness 1
    assert.equal(comp.presentFeatureCount, 2 + 1);
  });

  test('below-threshold cited value → count + FEATURE_BELOW_THRESHOLD item (not upgraded)', () => {
    const spoke = [reading('readiness_tracker', 'H', 'NEUTRAL', {
      citedValues: [cv({ featureValueId: '99', sampleMeetsThreshold: false })],
    })];
    const comp = computeCompleteness(spoke, eligible);
    assert.equal(comp.belowThresholdCount, 1);
    assert.equal(comp.items.filter((i) => i.absenceKind === 'FEATURE_BELOW_THRESHOLD').length, 1);
  });

  test('zero below-threshold when every cited value meets its threshold', () => {
    const comp = computeCompleteness([reading('readiness_tracker', 'H', 'SUPPORTS')], eligible);
    assert.equal(comp.belowThresholdCount, 0);
    assert.equal(comp.items.filter((i) => i.absenceKind === 'FEATURE_BELOW_THRESHOLD').length, 0);
  });

  test('estimated provenance → count + FEATURE_ESTIMATED item; zero otherwise', () => {
    const est = computeCompleteness([reading('readiness_tracker', 'H', 'SUPPORTS', {
      citedValues: [cv({ featureValueId: '77', provenanceClassCode: 'ESTIMATED' })],
    })], eligible);
    assert.equal(est.estimatedInputCount, 1);
    assert.equal(est.items.filter((i) => i.absenceKind === 'FEATURE_ESTIMATED').length, 1);
    const none = computeCompleteness([reading('readiness_tracker', 'H', 'SUPPORTS')], eligible);
    assert.equal(none.estimatedInputCount, 0);
  });

  test('a cited value shared by two readings is counted once', () => {
    const shared = cv({ featureValueId: '500', sampleMeetsThreshold: false });
    const comp = computeCompleteness([
      reading('home_away_split', 'H', 'SUPPORTS', { citedValues: [shared] }),
      reading('readiness_tracker', 'H', 'SUPPORTS', { citedValues: [shared] }),
    ], eligible);
    assert.equal(comp.belowThresholdCount, 1);
  });
});

describe('verdict NULL guarantees (non-directional, structural)', () => {
  test('every graded field is NULL; only counts and completeness are populated', () => {
    const spoke = [reading('readiness_tracker', 'H', 'SUPPORTS'), reading('readiness_tracker', 'A', 'CONTRADICTS')];
    const v = buildVerdict(tallyConsensus(spoke, eligible), computeCompleteness(spoke, eligible));
    assert.equal(v.readinessEdge, null);
    assert.equal(v.formEdge, null);
    assert.equal(v.travelEdge, null);
    assert.equal(v.restEdge, null);
    assert.equal(v.congestionEdge, null);
    assert.equal(v.availabilityEdge, null);
    assert.equal(v.riskScore, null);
    assert.equal(v.confidence, null);
    assert.equal(v.historicalReliabilityBaselineId, null);
    assert.equal(v.consensusSupportsCount, 1);
    assert.equal(v.consensusContradictsCount, 1);
    assert.equal(v.evidenceCount, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-8 — rest edge composition (v1.1.0). home.rest_advantage − away.rest_advantage.
// ─────────────────────────────────────────────────────────────────────────────
const HOME = '100';
const AWAY = '200';
const fx = { homeTeamId: HOME, awayTeamId: AWAY };

// A FIXTURE rest_advantage reading citing the two teams' rest values. `homeVal`/
// `awayVal` are PostgreSQL numeric text; undefined omits that side's value.
const restReading = (
  homeVal: string | undefined,
  awayVal: string | undefined,
  over: Partial<CitedFeatureValue> = {}
): SpokeReading => {
  const cited: CitedFeatureValue[] = [];
  if (homeVal !== undefined) cited.push(cv({ featureKey: REST_ADVANTAGE_FEATURE_KEY, subjectTeamId: HOME, value: homeVal, featureValueId: '1001', ...over }));
  if (awayVal !== undefined) cited.push(cv({ featureKey: REST_ADVANTAGE_FEATURE_KEY, subjectTeamId: AWAY, value: awayVal, featureValueId: '1002', ...over }));
  return reading('rest_advantage', HOME, 'SUPPORTS', {
    subjectKindCode: 'FIXTURE', teamId: null, fixtureId: '500',
    contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null,
    declaredInputCount: 2, presentInputCount: cited.length, citedValues: cited,
  });
};

describe('S-8 rest edge (home − away, home-relative sign)', () => {
  test('home has more rest → positive edge', () => {
    assert.equal(computeRestEdge([restReading('5', '2')], fx), '3');
  });
  test('away has more rest → negative edge', () => {
    assert.equal(computeRestEdge([restReading('2', '5')], fx), '-3');
  });
  test('equal rest → zero edge', () => {
    assert.equal(computeRestEdge([restReading('3', '3')], fx), '0');
  });
  test('zero is a real value, never treated as missing (home 0, away 3 → -3)', () => {
    assert.equal(computeRestEdge([restReading('0', '3')], fx), '-3');
  });
  test('missing home value → NULL', () => {
    assert.equal(computeRestEdge([restReading(undefined, '3')], fx), null);
  });
  test('missing away value → NULL', () => {
    assert.equal(computeRestEdge([restReading('3', undefined)], fx), null);
  });
  test('no FIXTURE rest reading at all → NULL', () => {
    assert.equal(computeRestEdge([reading('readiness_tracker', HOME, 'SUPPORTS')], fx), null);
  });
  test('below-threshold values still yield an edge (caveat lives in completeness, not here)', () => {
    assert.equal(computeRestEdge([restReading('5', '2', { sampleMeetsThreshold: false })], fx), '3');
  });
  test('HOME/AWAY are resolved by each value’s own subject team, not citation order', () => {
    // Build with cited values deliberately in away-then-home order.
    const away = cv({ featureKey: REST_ADVANTAGE_FEATURE_KEY, subjectTeamId: AWAY, value: '1', featureValueId: '1002' });
    const home = cv({ featureKey: REST_ADVANTAGE_FEATURE_KEY, subjectTeamId: HOME, value: '9', featureValueId: '1001' });
    const r = reading('rest_advantage', HOME, 'SUPPORTS', {
      subjectKindCode: 'FIXTURE', teamId: null, fixtureId: '500',
      contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null,
      declaredInputCount: 2, presentInputCount: 2, citedValues: [away, home],
    });
    assert.equal(computeRestEdge([r], fx), '8'); // 9 (home) − 1 (away), regardless of order
  });
  test('decimal scale is preserved (2.50 − 0.25 = 2.25)', () => {
    assert.equal(computeRestEdge([restReading('2.50', '0.25')], fx), '2.25');
  });

  test('buildVerdict carries a supplied rest edge; every other graded field stays NULL', () => {
    const spoke = [restReading('5', '2')];
    const v = buildVerdict(tallyConsensus(spoke, eligible), computeCompleteness(spoke, eligible), '3');
    assert.equal(v.restEdge, '3');
    assert.equal(v.readinessEdge, null);
    assert.equal(v.formEdge, null);
    assert.equal(v.travelEdge, null);
    assert.equal(v.congestionEdge, null);
    assert.equal(v.availabilityEdge, null);
    assert.equal(v.riskScore, null);
    assert.equal(v.confidence, null);
    assert.equal(v.historicalReliabilityBaselineId, null);
  });
});

describe('S-8 rest edge is governed only from composition 1.1.0+', () => {
  test('1.0.0 does not govern the rest edge; 1.1.0 and later do', () => {
    assert.equal(restEdgeGovernedIn('1.0.0'), false);
    assert.equal(restEdgeGovernedIn('1.1.0'), true);
    assert.equal(restEdgeGovernedIn('1.2.0'), true);
    assert.equal(restEdgeGovernedIn('2.0.0'), true);
  });
  test('minor is compared numerically, not lexically (1.10.0 > 1.2.0)', () => {
    assert.equal(restEdgeGovernedIn('1.10.0'), true);
  });
  test('an unparseable designation never governs the edge', () => {
    assert.equal(restEdgeGovernedIn('nonsense'), false);
    assert.equal(restEdgeGovernedIn('1.0'), false);
  });
});

describe('version manifest (LC-103 complete, distinct, ordered)', () => {
  test('includes every referenced module & feature version plus the three rule versions', () => {
    const spoke = [reading('home_away_split', 'H', 'SUPPORTS', { moduleVersionId: '11', citedValues: [cv({ featureVersionId: '5' })] }),
      reading('readiness_tracker', 'A', 'SUPPORTS', { moduleVersionId: '12', citedValues: [cv({ featureVersionId: '6' })] })];
    const m = buildManifest(spoke, { verdictCompositionVersionId: '20', consensusRuleVersionId: '21', checksumAlgorithmVersionId: '22' });
    const kinds = m.map((c) => `${c.componentKind}:${c.componentVersionId}`);
    assert.ok(kinds.includes('MODULE_VERSION:11'));
    assert.ok(kinds.includes('MODULE_VERSION:12'));
    assert.ok(kinds.includes('FEATURE_VERSION:5'));
    assert.ok(kinds.includes('FEATURE_VERSION:6'));
    assert.ok(kinds.includes('VERDICT_COMPOSITION_VERSION:20'));
    assert.ok(kinds.includes('CONSENSUS_RULE_VERSION:21'));
    assert.ok(kinds.includes('CHECKSUM_ALGORITHM_VERSION:22'));
  });

  test('distinct: a module version referenced by both teams appears once', () => {
    const spoke = [reading('readiness_tracker', 'H', 'SUPPORTS', { moduleVersionId: '12', citedValues: [cv({ featureVersionId: '6' })] }),
      reading('readiness_tracker', 'A', 'SUPPORTS', { moduleVersionId: '12', citedValues: [cv({ featureVersionId: '6' })] })];
    const m = buildManifest(spoke, { verdictCompositionVersionId: '20', consensusRuleVersionId: '21', checksumAlgorithmVersionId: '22' });
    assert.equal(m.filter((c) => c.componentKind === 'MODULE_VERSION' && c.componentVersionId === '12').length, 1);
    assert.equal(m.filter((c) => c.componentKind === 'FEATURE_VERSION' && c.componentVersionId === '6').length, 1);
  });

  test('deterministic order (kind asc, then numeric id asc)', () => {
    const spoke = [reading('readiness_tracker', 'H', 'SUPPORTS', { moduleVersionId: '12', citedValues: [cv({ featureVersionId: '6' })] })];
    const a = buildManifest(spoke, { verdictCompositionVersionId: '20', consensusRuleVersionId: '21', checksumAlgorithmVersionId: '22' });
    const b = buildManifest(spoke, { verdictCompositionVersionId: '20', consensusRuleVersionId: '21', checksumAlgorithmVersionId: '22' });
    assert.deepEqual(a, b);
  });
});
