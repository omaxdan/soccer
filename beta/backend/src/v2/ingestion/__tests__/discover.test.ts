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
  parsePageList,
  planCalls,
  requestPath,
  DEFAULT_MAX_CALLS,
  MAX_ALLOWED_CALLS,
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

  test('the page size is still declared UNVERIFIED, now that the rest is not', () => {
    // This began as a tripwire against writing a pager on assumed semantics.
    // The semantics are now established from live bodies (doc 38 §3) — except
    // the page size, which four pages of exactly 30 still do not prove, because
    // every one of them was a page the provider could fill. That is the part
    // worth keeping a tripwire on, so the assertion narrows rather than retires.
    for (const key of ['tournament_season_events_last', 'tournament_season_events_next'] as const) {
      assert.match(ENDPOINTS[key].description, /PAGE SIZE REMAINS UNVERIFIED/);
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// THE PLANNED EXPERIMENT
//
// The five-call experiment closes U-2 (past-the-end behaviour) and U-3 (the
// events/next envelope). These pin that the plan is built and priced BEFORE any
// request, that naming a step replaces the default rather than adding to it, and
// that a plan larger than the budget is refused rather than half-executed.
// ─────────────────────────────────────────────────────────────────────────────

describe('page lists', () => {
  test('a comma-separated list becomes pages', () => {
    assert.deepEqual(parsePageList('0,1,999', '--last'), [0, 1, 999]);
    assert.deepEqual(parsePageList(' 2 ', '--last'), [2]);
  });

  test('anything that is not a page number is refused', () => {
    for (const bad of ['0,x', '-1', '1.5', '', 'last']) {
      assert.throws(() => parsePageList(bad, '--last'), /comma-separated page numbers/, bad);
    }
  });

  test('the flags reach the parsed arguments', () => {
    const args = parseArguments([
      '--tournament', '325', '--season', '87678',
      '--last', '2,999', '--next', '0', '--max-calls', '3',
    ]);
    assert.deepEqual(args.lastPages, [2, 999]);
    assert.deepEqual(args.nextPages, [0]);
    assert.equal(args.maxCalls, 3);
  });
});

describe('the plan is built before anything is sent', () => {
  test('with no step named, the default three-call sequence stands', () => {
    const plan = planCalls(parseArguments(['--tournament', '325']));
    assert.deepEqual(
      plan.map((p) => p.endpointKey),
      ['tournament_seasons', 'tournament_season_events_last', 'tournament_season_events_last']
    );
    assert.equal(plan.length, DEFAULT_MAX_CALLS, 'the default plan fits the default budget');
  });

  test('naming steps REPLACES the default rather than adding to it', () => {
    // An explicit run must do exactly what was asked. Appending to the default
    // would silently spend two extra calls on a question already answered.
    const plan = planCalls(
      parseArguments(['--tournament', '325', '--season', '87678', '--last', '2,999', '--next', '0'])
    );
    assert.deepEqual(plan.map((p) => p.endpointKey), [
      'tournament_season_events_last',
      'tournament_season_events_last',
      'tournament_season_events_next',
    ]);
    assert.deepEqual(plan.map((p) => p.parameters.page), [2, 999, 0]);
  });

  test('a known season id removes the seasons call', () => {
    const withSeason = planCalls(
      parseArguments(['--tournament', '325', '--season', '87678', '--last', '0'])
    );
    assert.equal(withSeason.length, 1, 'no seasons call is needed');

    const withoutSeason = planCalls(parseArguments(['--tournament', '999', '--last', '0']));
    assert.equal(withoutSeason.length, 2, 'an unknown season must be resolved first');
    assert.equal(withoutSeason[0].endpointKey, 'tournament_seasons');
  });

  test('the cup probe costs exactly two calls', () => {
    // Seasons plus events/last/0, which is what makes the five-call experiment
    // add up: three on the known season, two on a second competition.
    const plan = planCalls(parseArguments(['--tournament', '1234', '--last', '0']));
    assert.equal(plan.length, 2);
  });

  test('every planned call states what it is for', () => {
    for (const step of planCalls(parseArguments(['--tournament', '325']))) {
      assert.ok(step.purpose.length > 10, `${step.endpointKey} needs a stated purpose`);
    }
  });
});

describe('a failure record reproduces the request that failed', () => {
  // The events/last/999 capture — the one that proved 404 is the terminal
  // signal — was written with a URL of
  // `https://…/apitournament_season_events_last`, scraped out of an error
  // message. The 404 itself was sound; the record of how it was obtained was
  // not, and a failure nobody can replay is not evidence.
  test('the path is the one that was sent, not a fragment of the error text', () => {
    assert.equal(
      requestPath('tournament_season_events_last', { tournamentId: '325', seasonId: '87678', page: 999 }),
      '/tournament/325/season/87678/events/last/999'
    );
  });

  test('an unresolvable path degrades rather than throwing over the real error', () => {
    // This runs inside the catch block. A throw here would replace the
    // diagnosis with a second, less useful one.
    assert.doesNotThrow(() => requestPath('tournament_season_events_last', { tournamentId: '325' }));
    assert.match(requestPath('tournament_season_events_last', { tournamentId: '325' }), /could not be resolved/);
  });
});

describe('standings capture', () => {
  // `season_standings` declares tournamentId and seasonId and nothing else. It
  // is not paged, so there is no pagination question to answer and one call
  // settles the shape football.standing must be written from.
  test('--standings with a known season plans EXACTLY ONE call', () => {
    const plan = planCalls(parseArguments(['--tournament', '325', '--season', '87678', '--standings']));
    assert.equal(plan.length, 1, 'one call, and no event pages alongside it');
    assert.equal(plan[0].endpointKey, 'season_standings');
    assert.deepEqual(plan[0].parameters, { tournamentId: '325', seasonId: '(resolved)' });
    assert.ok(!('page' in plan[0].parameters), 'an unpaged endpoint carries no page');
  });

  test('naming standings suppresses the default event pages', () => {
    // Without this, --standings would inherit the default last/0 and last/1 and
    // spend three calls to answer a one-call question.
    const plan = planCalls(parseArguments(['--tournament', '325', '--season', '87678', '--standings']));
    assert.ok(!plan.some((step) => step.endpointKey.startsWith('tournament_season_events')));
  });

  test('without a season id the seasons call is planned first, and still only two', () => {
    const plan = planCalls(parseArguments(['--tournament', '325', '--standings']));
    assert.deepEqual(plan.map((step) => step.endpointKey), ['tournament_seasons', 'season_standings']);
  });

  test('the evidence artifact is named without a page component', () => {
    assert.equal(
      evidenceFilename('season_standings', { tournamentId: '325', seasonId: '87678' }),
      'season_standings__seasonId-87678__tournamentId-325.json'
    );
  });

  test('a standing-less run is completely unchanged', () => {
    // The regression that matters: the proven default plan must not move.
    const plan = planCalls(parseArguments(['--tournament', '325']));
    assert.deepEqual(plan.map((step) => step.endpointKey), [
      'tournament_seasons',
      'tournament_season_events_last',
      'tournament_season_events_last',
    ]);
  });
});

describe('flags that carry no value', () => {
  test('a standalone boolean flag is accepted rather than demanding a value', () => {
    // `--seasons` was documented and unusable: the parser threw
    // "--seasons expects a value" before argv.includes() was ever reached.
    // Found while adding --standings, which could not work without the fix.
    assert.equal(parseArguments(['--tournament', '325', '--seasons']).wantSeasons, true);
    assert.equal(parseArguments(['--tournament', '325', '--standings']).wantStandings, true);
    assert.equal(
      parseArguments(['--tournament', '325', '--standings', '--season', '87678']).seasonId,
      '87678',
      'a boolean flag does not swallow the flag that follows it'
    );
  });

  test('a value-bearing flag still demands its value', () => {
    assert.throws(() => parseArguments(['--tournament', '325', '--season']), /expects a value/);
  });

  test('neither flag is set unless asked for', () => {
    const args = parseArguments(['--tournament', '325']);
    assert.equal(args.wantSeasons, false);
    assert.equal(args.wantStandings, false);
  });
});

describe('the budget cannot be exceeded', () => {
  test('a plan larger than the budget is refusable before spending', () => {
    const args = parseArguments(['--tournament', '325', '--last', '0,1,2,3', '--max-calls', '2']);
    assert.ok(planCalls(args).length > args.maxCalls, 'main() refuses this rather than half-running it');
  });

  test('a mistyped budget cannot spend days of quota', () => {
    assert.throws(
      () => parseArguments(['--tournament', '325', '--max-calls', '500']),
      /exceeds the discovery ceiling/
    );
    assert.equal(MAX_ALLOWED_CALLS, 25);
    assert.doesNotThrow(() => parseArguments(['--tournament', '325', '--max-calls', '25']));
  });
});
