// EDITION read-model tests (DB-free, pure).
//
// Proves the canonical-keystone projection:
//   • edition identity (id, season label) + parent competition map from the gated
//     header row; competition comes from the canonical join (not fixtures);
//   • coverage: edition always 'present' (unknown/unauthorized is a 404), competition
//     invariantly 'present' (mandatory FK);
//   • no fixtures/standings/fixtureCount/ranking/readiness/prediction leak.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mapEditionIdentity, buildEditionCoverage, type EditionIdentityRow } from '../edition';

const row: EditionIdentityRow = {
  edition_id: '18', season_label: 'Brasileiro Serie A 2026',
  competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325',
};

describe('mapEditionIdentity', () => {
  test('maps id/seasonLabel + canonical parent competition', () => {
    assert.deepEqual(mapEditionIdentity(row), {
      id: '18', seasonLabel: 'Brasileiro Serie A 2026',
      competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
    });
  });

  test('carries no fixtureCount (target contract omits it; not calculated)', () => {
    const e = mapEditionIdentity(row) as unknown as Record<string, unknown>;
    assert.equal('fixtureCount' in e, false);
  });
});

describe('buildEditionCoverage', () => {
  test('edition present; competition present (mandatory FK)', () => {
    assert.deepEqual(buildEditionCoverage(), { edition: 'present', competition: 'present' });
  });
});

describe('governance', () => {
  test('projection carries no fixtures/standings/ranking/readiness/prediction language', () => {
    const blob = JSON.stringify({ edition: mapEditionIdentity(row), coverage: buildEditionCoverage() }).toLowerCase();
    for (const term of ['fixture', 'standing', 'ranking', 'rank', 'readiness', 'performance', 'predicted', 'probability', 'verdict', 'score', 'travel']) {
      assert.equal(blob.includes(term), false, `edition must not emit "${term}"`);
    }
  });
});
