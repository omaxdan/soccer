// TEAM GOVERNED INTELLIGENCE — pure-mapper tests (DB-free). Proves the read model
// projects governed readings verbatim (status/strength/sample/scope/as_of/verdict),
// splits home_away_split per edition, and NEVER fabricates a value or a fallback.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTeamGovernedIntelligence, mapGovernedReading } from '../teamGovernedIntelligence';
import type { TeamModuleReading } from '../../../module/read/readings';

const reading = (over: Partial<TeamModuleReading>): TeamModuleReading => ({
  moduleKey: 'home_away_split', teamId: '72', contextKindCode: 'COMPETITION_SCOPED',
  contextCompetitionEditionId: '18', asOf: new Date('2026-09-13T12:30:00.000Z'),
  calculatedAt: new Date('2026-09-17T00:00:00.000Z'), moduleStatusCode: 'NEUTRAL',
  strength: null, confidence: null, sampleObservationCount: 3, sampleMeetsThreshold: true,
  verdictText: 'Balanced home and away', inactiveReason: null, ...over,
});

describe('mapGovernedReading — verbatim projection, as_of not calculated_at', () => {
  test('preserves status/strength/sample/scope/verdict and uses as_of', () => {
    const v = mapGovernedReading(reading({}), undefined);
    assert.equal(v.moduleKey, 'home_away_split');
    assert.equal(v.status, 'NEUTRAL');
    assert.equal(v.strength, null);            // NULL at 1.0.0 preserved, never fabricated
    assert.deepEqual(v.sample, { matches: 3, meetsThreshold: true });
    assert.deepEqual(v.scope, { kind: 'COMPETITION_SCOPED', competitionEditionId: '18' });
    assert.equal(v.verdictText, 'Balanced home and away');
    assert.equal(v.asOf, '2026-09-13T12:30:00.000Z'); // reading.as_of, NOT calculated_at
    assert.equal(v.evidence, null);
  });
  test('MEASURED consistency magnitude is exposed exactly as persisted', () => {
    const v = mapGovernedReading(reading({ moduleKey: 'consistency_index', contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null, moduleStatusCode: 'MEASURED', strength: 1.89, sampleObservationCount: 10 }), undefined);
    assert.equal(v.status, 'MEASURED');
    assert.equal(v.strength, 1.89);            // governed magnitude, not recomputed, not a 0-100
    assert.equal(v.scope.kind, 'ALL_COMPETITIONS');
    assert.equal(v.sample.matches, 10);
  });
});

describe('buildTeamGovernedIntelligence — split per edition, honest coverage', () => {
  test('splits home_away_split per edition and picks ALL_COMPETITIONS consistency', () => {
    const readings = [
      reading({ contextCompetitionEditionId: '19', verdictText: 'Away-reliant' }),
      reading({ contextCompetitionEditionId: '18', verdictText: 'Balanced' }),
      reading({ moduleKey: 'consistency_index', contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null, moduleStatusCode: 'MEASURED', strength: 1.89, sampleObservationCount: 10 }),
    ];
    const out = buildTeamGovernedIntelligence(readings, new Map());
    assert.equal(out.homeAwaySplit.length, 2);
    assert.deepEqual(out.homeAwaySplit.map((r) => r.scope.competitionEditionId), ['18', '19']); // sorted, deterministic
    assert.equal(out.consistency?.status, 'MEASURED');
    assert.deepEqual(out.coverage, { homeAwaySplit: 'present', consistency: 'present', isGoverned: true });
  });
  test('no readings → both surfaces absent (never fabricated)', () => {
    const out = buildTeamGovernedIntelligence([], new Map());
    assert.equal(out.homeAwaySplit.length, 0);
    assert.equal(out.consistency, null);
    assert.deepEqual(out.coverage, { homeAwaySplit: 'absent', consistency: 'absent', isGoverned: true });
  });
  test('INACTIVE reading surfaces as status + reason, not as absence', () => {
    const out = buildTeamGovernedIntelligence(
      [reading({ moduleStatusCode: 'INACTIVE', inactiveReason: 'FEATURE_ABSENT', verdictText: null })],
      new Map(),
    );
    assert.equal(out.homeAwaySplit.length, 1);
    assert.equal(out.homeAwaySplit[0].status, 'INACTIVE');
    assert.equal(out.homeAwaySplit[0].inactiveReason, 'FEATURE_ABSENT');
    assert.equal(out.coverage.homeAwaySplit, 'present'); // present-but-inactive, not absent
  });
});
