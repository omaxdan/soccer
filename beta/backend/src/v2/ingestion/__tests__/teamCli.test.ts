// CLI parsing for the bounded team command. No provider, no database.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseArguments, DEFAULT_TEAM_MAX_CALLS } from '../cli';

describe('cli · team command', () => {
  test('accepts explicit team/tournament/season/from and defaults max-calls', () => {
    const args = parseArguments(['team', '--team', '1963', '--tournament', '325', '--season', '87678', '--from', '2026-05-31']);
    assert.equal(args.command, 'team');
    if (args.command !== 'team') return;
    assert.equal(args.teamId, '1963');
    assert.equal(args.uniqueTournamentId, '325');
    assert.equal(args.seasonId, '87678');
    assert.equal(args.from.toISOString().slice(0, 10), '2026-05-31');
    assert.equal(args.to, undefined);
    assert.equal(args.maxCalls, DEFAULT_TEAM_MAX_CALLS);
  });

  test('accepts --to and --max-calls', () => {
    const args = parseArguments([
      'team', '--team', '1963', '--tournament', '325', '--season', '87678',
      '--from', '2026-05-31', '--to', '2026-08-18', '--max-calls', '8',
    ]);
    if (args.command !== 'team') return assert.fail('expected team command');
    assert.equal(args.maxCalls, 8);
    assert.equal(args.to?.toISOString().slice(0, 10), '2026-08-18');
  });

  test('requires --team', () => {
    assert.throws(
      () => parseArguments(['team', '--tournament', '325', '--season', '87678', '--from', '2026-05-31']),
      /--team is required/
    );
  });

  test('rejects a non-positive --max-calls', () => {
    assert.throws(
      () => parseArguments(['team', '--team', '1963', '--tournament', '325', '--season', '87678', '--from', '2026-05-31', '--max-calls', '0']),
      /--max-calls/
    );
  });
});
