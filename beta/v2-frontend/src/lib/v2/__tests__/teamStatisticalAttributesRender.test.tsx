// STATISTICAL PROFILE RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// Verifies the Performance-tab Statistical Attributes panel renders the backend
// `statistical` block verbatim as product-facing content: strengths / weaknesses /
// style tendencies with a position word, the value and the league rank — no
// governance jargon, no prediction/probability, honest empty/insufficient states.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { TeamStatisticalAttributes } from '@/components/v2/team';
import type { StatisticalAttributesBlock, StatisticalAttribute } from '@/lib/v2/types';

const html = (node: React.ReactElement): string => renderToStaticMarkup(node);

function attr(over: Partial<StatisticalAttribute> & Pick<StatisticalAttribute, 'key' | 'label' | 'type' | 'level'>): StatisticalAttribute {
  return {
    qualityOrientation: 'HIGHER_IS_BETTER',
    evidence: { signalValue: 1.82, benchmark: { rank: 3, teams: 20, percentile: 0.85, median: 1.2, q1: 0.9, q3: 1.6 }, usableSample: 24 },
    ...over,
  };
}

function block(over: Partial<StatisticalAttributesBlock> = {}): StatisticalAttributesBlock {
  return {
    scope: { type: 'edition', editionId: '18', label: 'edition 18' },
    asOf: '2026-09-20T00:00:00.000Z',
    insufficientSample: false,
    sample: { completedFixtures: 24, classificationFloor: 8 },
    strengths: [], weaknesses: [], tendencies: [],
    ...over,
  };
}

describe('TeamStatisticalAttributes', () => {
  test('renders strengths, weaknesses and tendencies with position, value and rank', () => {
    const out = html(<TeamStatisticalAttributes block={block({
      strengths: [attr({ key: 'expectedGoals', label: 'Expected goals (xG)', type: 'strength', level: 'TOP_QUARTILE' })],
      weaknesses: [attr({ key: 'bigChanceMissed', label: 'Big chances missed', type: 'weakness', level: 'BOTTOM_QUARTILE', qualityOrientation: 'LOWER_IS_BETTER' })],
      tendencies: [attr({ key: 'ballPossession', label: 'Ball possession', type: 'tendency', level: 'TOP_QUARTILE', qualityOrientation: 'NEUTRAL', evidence: { signalValue: 58, benchmark: { rank: 2, teams: 20, percentile: 0.9, median: 50, q1: 45, q3: 55 }, usableSample: 24 } })],
    })} />);
    assert.ok(out.includes('Statistical profile'));
    assert.ok(out.includes('Strengths') && out.includes('Expected goals (xG)') && out.includes('Top quarter'));
    assert.ok(out.includes('Weaknesses') && out.includes('Big chances missed') && out.includes('Bottom quarter'));
    assert.ok(out.includes('Style tendencies') && out.includes('Ball possession') && out.includes('High'));
    assert.ok(out.includes('3rd of 20') && out.includes('2nd of 20'));
    assert.ok(out.includes('1.82') && out.includes('58'));
  });

  test('insufficientSample → honest empty state, no fabricated rows', () => {
    const out = html(<TeamStatisticalAttributes block={block({ insufficientSample: true, sample: { completedFixtures: 5, classificationFloor: 8 } })} />);
    assert.ok(/Not enough completed matches/.test(out));
    assert.ok(!out.includes('Strengths') && !out.includes('Style tendencies'));
  });

  test('null block → no-profile empty state', () => {
    const out = html(<TeamStatisticalAttributes block={null} />);
    assert.ok(/No statistical profile available/.test(out));
  });

  test('all mid-table → explicit no-standout message, never zero-filled rows', () => {
    const out = html(<TeamStatisticalAttributes block={block()} />);
    assert.ok(/mid-table/.test(out));
  });

  test('no governance jargon or prediction language leaks to the UI', () => {
    const out = html(<TeamStatisticalAttributes block={block({
      strengths: [attr({ key: 'expectedGoals', label: 'Expected goals (xG)', type: 'strength', level: 'TOP_QUARTILE' })],
    })} />);
    for (const banned of ['quartile', 'qualityOrientation', 'benchmark', 'percentile', 'probability', 'prediction', 'verdict']) {
      assert.ok(!new RegExp(banned, 'i').test(out), `UI must not surface '${banned}'`);
    }
  });
});
