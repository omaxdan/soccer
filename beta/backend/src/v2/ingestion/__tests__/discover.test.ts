// ─────────────────────────────────────────────────────────────────────────────
// S-4 DISCOVERY RUNNER TESTS
//
// No provider and no database. These pin the three properties that make a
// discovery tool safe to hand someone with a live key: it cannot overspend, it
// cannot write a credential, and it refuses to guess a shape it has not seen.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  parseArguments,
  evidenceFilename,
  firstSeasonId,
  describeShape,
  DEFAULT_MAX_CALLS,
} from '../discover';
import { ENDPOINTS, resolvePath } from '../provider/endpoints';

describe('discovery arguments', () => {
  test('a tournament id is required, and the error says how to find one', () => {
    assert.throws(
      () => parseArguments([]),
      (error: Error) => {
        assert.match(error.message, /--tournament/);
        assert.match(error.message, /football\.competition/, 'must name where to look');
        return true;
      }
    );
  });

  test('the default budget is the minimum that answers the pagination question', () => {
    // Seasons, page 0, page 1. One page shows the envelope; two show whether the
    // page number advances and what the second page contains.
    assert.equal(DEFAULT_MAX_CALLS, 3);
    assert.equal(parseArguments(['--tournament', '17']).maxCalls, 3);
  });

  test('a supplied season id is carried through, so the seasons call can be skipped', () => {
    const args = parseArguments(['--tournament', '17', '--season', '52186']);
    assert.equal(args.tournamentId, '17');
    assert.equal(args.seasonId, '52186');
  });

  test('a malformed or zero budget is refused rather than defaulted', () => {
    assert.throws(() => parseArguments(['--tournament', '17', '--max-calls', 'lots']), /whole number/);
    assert.throws(() => parseArguments(['--tournament', '17', '--max-calls', '0']), /at least 1/);
  });

  test('a flag without a value is refused', () => {
    assert.throws(() => parseArguments(['--tournament', '--season']), /expects a value/);
  });
});

describe('evidence filenames are deterministic', () => {
  test('the same request yields the same file, so a re-run overwrites its own evidence', () => {
    const a = evidenceFilename('tournament_season_events_last', { tournamentId: 17, seasonId: 52186, page: 0 });
    const b = evidenceFilename('tournament_season_events_last', { page: 0, seasonId: 52186, tournamentId: 17 });
    assert.equal(a, b, 'parameter order must not change the filename');
    assert.equal(a, 'tournament_season_events_last__page-0__seasonId-52186__tournamentId-17.json');
  });

  test('different pages are different files, so two pages can be compared', () => {
    const p0 = evidenceFilename('x', { page: 0 });
    const p1 = evidenceFilename('x', { page: 1 });
    assert.notEqual(p0, p1);
  });

  test('a value that would escape the directory is neutralised', () => {
    const name = evidenceFilename('x', { id: '../../etc/passwd' });
    assert.ok(!name.includes('/'), name);
    assert.ok(!name.includes('..'), name);
  });
});

describe('it refuses to guess a season id', () => {
  test('an unrecognised envelope yields null rather than a plausible number', () => {
    // The whole point. A creative search that found the wrong number would send
    // every later call to the wrong season and the evidence would look fine.
    assert.equal(firstSeasonId(null), null);
    assert.equal(firstSeasonId({ unexpected: { shape: true } }), null);
    assert.equal(firstSeasonId([]), null);
    assert.equal(firstSeasonId({ seasons: [] }), null);
    assert.equal(firstSeasonId({ seasons: [{ name: '2026' }] }), null, 'no id field, no guess');
  });

  test('the envelopes this provider is already known to use are recognised', () => {
    assert.equal(firstSeasonId([{ id: 52186 }]), '52186');
    assert.equal(firstSeasonId({ seasons: [{ id: 52186 }] }), '52186');
    assert.equal(firstSeasonId({ data: [{ id: 52186 }] }), '52186');
    assert.equal(firstSeasonId({ data: { seasons: [{ id: 52186 }] } }), '52186');
    assert.equal(firstSeasonId({ seasons: [{ seasonId: '52186' }] }), '52186');
  });
});

describe('shape description reveals structure, not contents', () => {
  test('an array reports its length and element shape', () => {
    assert.match(describeShape([{ id: 1, name: 'x' }, { id: 2, name: 'y' }]), /^array\(2\)/);
  });

  test('an object reports its keys', () => {
    assert.match(describeShape({ events: [], hasNextPage: false }), /events, hasNextPage/);
  });

  test('nesting is bounded, so a large payload cannot flood the terminal', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    assert.ok(describeShape(deep).length < 200);
  });
});

describe('the fixture-universe endpoints are registered and resolvable', () => {
  test('the three S-4 entry endpoints exist', () => {
    for (const key of [
      'tournament_seasons',
      'tournament_season_events_last',
      'tournament_season_events_next',
    ] as const) {
      assert.ok(ENDPOINTS[key], `${key} must be registered`);
    }
  });

  test('paths resolve with every parameter substituted', () => {
    assert.equal(resolvePath('tournament_seasons', { tournamentId: 17 }), '/tournaments/17/seasons');
    assert.equal(
      resolvePath('tournament_season_events_last', { tournamentId: 17, seasonId: 52186, page: 0 }),
      '/tournament/17/season/52186/events/last/0'
    );
  });

  test('a missing parameter is refused rather than sent as a literal brace', () => {
    assert.throws(
      () => resolvePath('tournament_season_events_last', { tournamentId: 17 }),
      /unresolved parameters/
    );
  });

  test('pagination semantics are declared UNVERIFIED until a live response says otherwise', () => {
    // Doc 35 and this phase both turn on not assuming. If someone later writes a
    // pager against an assumed page size, this test is where the assumption
    // should have been caught.
    assert.match(ENDPOINTS.tournament_season_events_last.description, /UNVERIFIED/);
  });
});

describe('no credential can reach the evidence files', () => {
  test('the runner never reads the key, and never writes a header', () => {
    const source = readFileSync(resolve(__dirname, '..', 'discover.ts'), 'utf8');
    const executable = source
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'));
    for (const forbidden of ['PT_V2_PROVIDER_KEY', 'x-api-key', 'authorization', 'config.keys[']) {
      assert.ok(
        !executable.some((line) => line.toLowerCase().includes(forbidden.toLowerCase())),
        `${forbidden} must not appear in executable code`
      );
    }
    // Key COUNT is reportable; key material is not.
    assert.ok(source.includes('config.keys.length'), 'the count is the only thing printed');
  });

  test('evidence is written beneath the existing sample area, not a new one', () => {
    const source = readFileSync(resolve(__dirname, '..', 'discover.ts'), 'utf8');
    assert.match(source, /'docs', 'api-samples', 'v2-discovery'/);
  });
});
