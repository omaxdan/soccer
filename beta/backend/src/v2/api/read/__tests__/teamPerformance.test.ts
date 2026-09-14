// TEAM PERFORMANCE read-model tests (DB-free, pure).
//
// Proves the evidence-honest performance projection over persisted feature values:
//   • a persisted feature maps to a metric with static unit/direction + verbatim
//     sample (matches, meetsThreshold); nothing recalculated
//   • ALL_COMPETITIONS values populate `overall`; COMPETITION_SCOPED win rates
//     populate `byCompetition` matched by edition — the two scopes never mix
//   • a scoped value for an edition NOT in the governed list is not surfaced
//   • a missing feature is null (never zero-filled)
//   • coverage: present (all five) / partial (some) / absent (none)
//   • no governed-intelligence / prediction / verdict / readiness fields leak

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toPerformanceMetric, assembleTeamPerformance, type EditionRef,
} from '../teamPerformance';
import type { TeamFeatureValue } from '../../../feature/read/currentValues';

function fv(over: Partial<TeamFeatureValue> & { featureKey: string; contextKindCode: string }): TeamFeatureValue {
  return {
    teamId: '67',
    contextCompetitionEditionId: null,
    value: 62.5,
    sampleObservationCount: 8,
    sampleMeetsThreshold: true,
    asOf: new Date('2026-07-17T23:00:00.000Z'),
    ...over,
  };
}

const EDITION: EditionRef = { id: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '9', name: 'Brasileirão Betano', slug: 'brasileirao-betano' } };

describe('toPerformanceMetric', () => {
  test('maps value + static unit/direction + verbatim sample; asOf ISO', () => {
    const m = toPerformanceMetric(fv({ featureKey: 'team.home_form', contextKindCode: 'ALL_COMPETITIONS', value: 62.5, sampleObservationCount: 8, sampleMeetsThreshold: true }))!;
    assert.deepEqual(m, {
      value: 62.5, unit: 'index', direction: 'HIGHER_IS_STRONGER',
      sample: { matches: 8, meetsThreshold: true }, asOf: '2026-07-17T23:00:00.000Z',
    });
  });

  test('undefined feature → null (missing, never fabricated)', () => {
    assert.equal(toPerformanceMetric(undefined), null);
  });

  test('sample passes through verbatim including meetsThreshold false (never "fixed")', () => {
    const m = toPerformanceMetric(fv({ featureKey: 'team.giant_killer_ppg', contextKindCode: 'ALL_COMPETITIONS', value: 1.5, sampleObservationCount: 2, sampleMeetsThreshold: false }))!;
    assert.equal(m.unit, 'ppg');
    assert.deepEqual(m.sample, { matches: 2, meetsThreshold: false });
  });
});

describe('assembleTeamPerformance — overall (ALL_COMPETITIONS)', () => {
  const values: TeamFeatureValue[] = [
    fv({ featureKey: 'team.home_form', contextKindCode: 'ALL_COMPETITIONS', value: 62.5 }),
    fv({ featureKey: 'team.away_form', contextKindCode: 'ALL_COMPETITIONS', value: 41 }),
    fv({ featureKey: 'team.momentum', contextKindCode: 'ALL_COMPETITIONS', value: 4 }),
    fv({ featureKey: 'team.goal_margin_volatility', contextKindCode: 'ALL_COMPETITIONS', value: 1.87 }),
    fv({ featureKey: 'team.giant_killer_ppg', contextKindCode: 'ALL_COMPETITIONS', value: 1.5 }),
  ];
  const out = assembleTeamPerformance(values, [EDITION]);

  test('all five overall metrics present → coverage present', () => {
    assert.equal(out.overall.homeForm!.value, 62.5);
    assert.equal(out.overall.momentum!.unit, 'points');
    assert.equal(out.overall.goalMarginVolatility!.direction, 'UNSIGNED');
    assert.equal(out.coverage.overall, 'present');
    assert.equal(out.coverage.performanceIsDescriptive, true);
  });

  test('partial coverage when some overall metrics missing', () => {
    const partial = assembleTeamPerformance(values.slice(0, 2), [EDITION]);
    assert.equal(partial.coverage.overall, 'partial');
    assert.equal(partial.overall.momentum, null);
  });

  test('absent coverage when no overall metrics', () => {
    const none = assembleTeamPerformance([], [EDITION]);
    assert.equal(none.coverage.overall, 'absent');
    assert.equal(none.overall.homeForm, null);
  });
});

describe('assembleTeamPerformance — byCompetition (COMPETITION_SCOPED)', () => {
  const values: TeamFeatureValue[] = [
    fv({ featureKey: 'team.home_win_rate', contextKindCode: 'COMPETITION_SCOPED', contextCompetitionEditionId: '18', value: 70, sampleObservationCount: 10, sampleMeetsThreshold: true }),
    fv({ featureKey: 'team.away_win_rate', contextKindCode: 'COMPETITION_SCOPED', contextCompetitionEditionId: '18', value: 30, sampleObservationCount: 10, sampleMeetsThreshold: true }),
    // a scoped value for a DIFFERENT edition (99) not in the governed list — must be ignored
    fv({ featureKey: 'team.home_win_rate', contextKindCode: 'COMPETITION_SCOPED', contextCompetitionEditionId: '99', value: 99 }),
  ];
  const out = assembleTeamPerformance(values, [EDITION]);

  test('scoped win rates matched to the governed edition', () => {
    assert.equal(out.byCompetition.length, 1);
    assert.equal(out.byCompetition[0].edition.id, '18');
    assert.equal(out.byCompetition[0].homeWinRate!.value, 70);
    assert.equal(out.byCompetition[0].awayWinRate!.value, 30);
  });

  test('a scoped value for a non-governed edition is not surfaced', () => {
    const surfaced = out.byCompetition.flatMap((c) => [c.homeWinRate?.value, c.awayWinRate?.value]);
    assert.equal(surfaced.includes(99), false);
  });

  test('governed edition with no scoped values → null metrics (never zero)', () => {
    const out2 = assembleTeamPerformance([], [EDITION]);
    assert.equal(out2.byCompetition[0].homeWinRate, null);
    assert.equal(out2.byCompetition[0].awayWinRate, null);
  });
});

describe('scope isolation & governance', () => {
  test('ALL_COMPETITIONS and COMPETITION_SCOPED never mix', () => {
    // A home_form value wrongly tagged scoped must NOT populate overall.homeForm.
    const values: TeamFeatureValue[] = [
      fv({ featureKey: 'team.home_form', contextKindCode: 'COMPETITION_SCOPED', contextCompetitionEditionId: '18', value: 88 }),
    ];
    const out = assembleTeamPerformance(values, [EDITION]);
    assert.equal(out.overall.homeForm, null); // only ALL_COMPETITIONS populates overall
  });

  test('projection carries no verdict/prediction/probability/readiness/ranking', () => {
    const out = assembleTeamPerformance([fv({ featureKey: 'team.home_form', contextKindCode: 'ALL_COMPETITIONS' })], [EDITION]);
    const blob = JSON.stringify(out).toLowerCase();
    for (const term of ['verdict', 'predicted', 'probability', 'confidence', 'readiness', 'ranking', 'recommend']) {
      assert.equal(blob.includes(term), false, `performance must not emit "${term}"`);
    }
  });
});
