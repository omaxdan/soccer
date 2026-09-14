// EDITION — handler wiring guardrail (DB-free).
//
// Proves, against a FAKE PoolClient (no database), that getEditionDetail:
//   • returns null when the edition is unknown/unauthorized (→ 404);
//   • issues ONLY the gated EDITION_HEADER_SQL — the governance gate IS the read, so
//     no dependent query is attempted for a hidden edition (gate-before-read);
//   • composes identity + canonical parent competition for a governed edition.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getEditionDetail } from '../handlers';

function fakeTx(opts: { exists: boolean; onQuery?: () => void }): PoolClient {
  const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  const rowsFor = (sql: string): unknown[] => {
    opts.onQuery?.();
    const q = norm(sql);
    if (q.includes('football.competition_edition e') && q.includes('e.id = $1')) {
      return opts.exists
        ? [{ edition_id: '18', season_label: 'Brasileiro Serie A 2026',
             competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325' }]
        : [];
    }
    return [];
  };
  return { query: async (sql: string) => ({ rows: rowsFor(sql) }) } as unknown as PoolClient;
}

describe('getEditionDetail wiring (DB-free)', () => {
  test('an unknown/unauthorized edition returns null via the single gated read', async () => {
    let queries = 0;
    const body = await getEditionDetail(fakeTx({ exists: false, onQuery: () => { queries += 1; } }), '18');
    assert.equal(body, null);
    assert.equal(queries, 1); // only the gated header query; no dependent read attempted
  });

  test('a governed edition composes identity + canonical parent competition', async () => {
    let queries = 0;
    const body = await getEditionDetail(fakeTx({ exists: true, onQuery: () => { queries += 1; } }), '18');
    assert.notEqual(body, null);
    assert.equal(body!.edition.id, '18');
    assert.equal(body!.edition.seasonLabel, 'Brasileiro Serie A 2026');
    assert.deepEqual(body!.edition.competition, { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' });
    assert.deepEqual(body!.coverage, { edition: 'present', competition: 'present' });
    assert.equal(queries, 1);
  });
});
