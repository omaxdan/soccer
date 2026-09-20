// TEAM COMPARISON PANEL RENDER TESTS (DB-free; react-dom/server).
//
// Locks the B2 governed-exposure migration: the Match Comparison panel highlights
// the "stronger side per metric" using the GOVERNED `direction` the backend supplies
// on each ApiFeatureValue — the frontend no longer owns direction truth. UNSIGNED
// features get no highlight; a tie gets no highlight; missing values are honest.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { TeamIntelligencePanel } from '@/components/v2/ui';
import type { ApiFeatureValue, ApiTeamFeatures, MetricDirection } from '@/lib/v2/types';

function html(node: React.ReactElement): string { return renderToStaticMarkup(node); }

const fv = (value: number, direction: MetricDirection, unit = 'index'): ApiFeatureValue => ({
  value, sampleObservationCount: 8, sampleMeetsThreshold: true, asOf: '2026-08-23T19:00:00.000Z', direction, unit,
});

// The panel colours ONLY the leading side's value with var(--edge); its presence marks
// the highlighted (stronger) side, and its absence means no leader was highlighted.
function panel(home: Partial<ApiTeamFeatures>, away: Partial<ApiTeamFeatures>): string {
  const base: ApiTeamFeatures = { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null };
  return html(<TeamIntelligencePanel home={{ ...base, ...home }} away={{ ...base, ...away }} homeName="Home" awayName="Away" />);
}

describe('TeamIntelligencePanel · governed direction (B2)', () => {
  test('HIGHER_IS_STRONGER: the higher value is highlighted as the leader', () => {
    const markup = panel({ homeForm: fv(73, 'HIGHER_IS_STRONGER') }, { homeForm: fv(41, 'HIGHER_IS_STRONGER') });
    assert.match(markup, /var\(--edge\)[\s\S]*?73/); // home (higher) highlighted
    // 41 is not the edge-coloured value
    assert.doesNotMatch(markup, /var\(--edge\)[^0-9]*41\b/);
  });
  test('LOWER_IS_STRONGER (e.g. congestion): the LOWER value is highlighted — governed, not a frontend constant', () => {
    const markup = panel({ congestion: fv(60, 'LOWER_IS_STRONGER') }, { congestion: fv(20, 'LOWER_IS_STRONGER') });
    // away (20, lower) is the leader; shows the governed "lower better" annotation
    assert.match(markup, /lower better/);
    assert.match(markup, /var\(--edge\)[\s\S]*?20/);
  });
  test('UNSIGNED: neither side is highlighted (no "better" side)', () => {
    const markup = panel({ momentum: fv(9, 'UNSIGNED') }, { momentum: fv(-4, 'UNSIGNED') });
    assert.doesNotMatch(markup, /var\(--edge\)/); // no leader highlight at all
  });
  test('equal values → no leader highlight', () => {
    const markup = panel({ homeForm: fv(50, 'HIGHER_IS_STRONGER') }, { homeForm: fv(50, 'HIGHER_IS_STRONGER') });
    assert.doesNotMatch(markup, /var\(--edge\)/);
  });
  test('missing value on one side → honest state, no fabricated leader', () => {
    const markup = panel({ homeForm: fv(73, 'HIGHER_IS_STRONGER') }, {});
    assert.match(markup, /Not enough data/);
    assert.doesNotMatch(markup, /var\(--edge\)/);
  });
});
