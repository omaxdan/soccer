// MATCH LINEUPS read-model tests (DB-free, pure).
//
// Proves the evidence-honest lineup projection:
//   • a selection row maps to a player line (position code/name/group, shirt) with
//     absent fields staying null
//   • rows split into starting XI vs substitutes, ordered by shirt number (nulls last)
//     then name — deterministic
//   • formation is taken once per team (stated once), null when not reported
//   • rows are oriented to the fixture header's home/away identities
//   • a team with no reported selections yields a null lineup (coverage fact), never
//     a fabricated XI; coverage 'absent' when neither team has one
//   • no predicted-XI / governed-intelligence surface leaks

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapLineupPlayer, buildTeamLineup, groupMatchLineups,
  type LineupSelectionRow, type TeamRef,
} from '../matchLineups';

const HOME: TeamRef = { id: '67', name: 'Fluminense', slug: 'fluminense' };
const AWAY: TeamRef = { id: '64', name: 'Red Bull Bragantino', slug: 'red-bull-bragantino' };

function sel(over: Partial<LineupSelectionRow> & { team_id: string; player_id: string; is_starting: boolean }): LineupSelectionRow {
  return {
    formation: '4-3-3',
    player_full_name: `Player ${over.player_id}`, player_slug: `player-${over.player_id}`,
    position_code: 'GK', position_name: 'Goalkeeper', position_group: 'GOALKEEPER',
    shirt_number: 1,
    ...over,
  };
}

describe('mapLineupPlayer', () => {
  test('maps identity/position/shirt; coerces shirt text; absent stays null', () => {
    assert.deepEqual(
      mapLineupPlayer(sel({ team_id: '67', player_id: '9', is_starting: true, position_code: 'ST', position_name: 'Striker', position_group: 'ATTACK', shirt_number: '10' })),
      { player: { id: '9', fullName: 'Player 9', slug: 'player-9' }, positionCode: 'ST', positionName: 'Striker', positionGroup: 'ATTACK', shirtNumber: 10 },
    );
    const noPos = mapLineupPlayer(sel({ team_id: '67', player_id: '5', is_starting: false, position_code: null, position_name: null, position_group: null, shirt_number: null }));
    assert.equal(noPos.positionCode, null);
    assert.equal(noPos.positionName, null);
    assert.equal(noPos.shirtNumber, null);
  });
});

describe('buildTeamLineup', () => {
  const rows: LineupSelectionRow[] = [
    sel({ team_id: '67', player_id: '1', is_starting: true, shirt_number: 1 }),
    sel({ team_id: '67', player_id: '10', is_starting: true, shirt_number: 10 }),
    sel({ team_id: '67', player_id: '7', is_starting: true, shirt_number: 7 }),
    sel({ team_id: '67', player_id: '30', is_starting: false, shirt_number: 30 }),
    sel({ team_id: '67', player_id: '25', is_starting: false, shirt_number: null }), // bench, no shirt → last
    // a different team's row that must NOT bleed in
    sel({ team_id: '64', player_id: '99', is_starting: true, shirt_number: 1 }),
  ];
  const lineup = buildTeamLineup(HOME, rows)!;

  test('only this team\'s rows are included', () => {
    const ids = [...lineup.starting, ...lineup.substitutes].map((p) => p.player.id);
    assert.equal(ids.includes('99'), false);
  });

  test('starting XI ordered by shirt number ascending', () => {
    assert.deepEqual(lineup.starting.map((p) => p.shirtNumber), [1, 7, 10]);
  });

  test('substitutes ordered by shirt (nulls last)', () => {
    assert.deepEqual(lineup.substitutes.map((p) => p.player.id), ['30', '25']);
  });

  test('formation carried once for the team', () => {
    assert.equal(lineup.formation, '4-3-3');
  });

  test('a team with no rows → null (never a fabricated lineup)', () => {
    assert.equal(buildTeamLineup({ id: '999', name: 'X', slug: 'x' }, rows), null);
  });

  test('formation null when not reported', () => {
    const noForm = buildTeamLineup(HOME, [sel({ team_id: '67', player_id: '1', is_starting: true, formation: null })])!;
    assert.equal(noForm.formation, null);
  });
});

describe('groupMatchLineups', () => {
  const rows: LineupSelectionRow[] = [
    sel({ team_id: '67', player_id: '1', is_starting: true, shirt_number: 1 }),
    sel({ team_id: '64', player_id: '1', is_starting: true, shirt_number: 1 }),
  ];

  test('orients rows to home/away header identities', () => {
    const out = groupMatchLineups(rows, HOME, AWAY);
    assert.equal(out.home!.team.id, '67');
    assert.equal(out.away!.team.id, '64');
    assert.equal(out.coverage.lineups, 'present');
    assert.equal(out.coverage.lineupsAreObserved, true);
  });

  test('a team with no lineup is null, coverage still present if the other has one', () => {
    const out = groupMatchLineups([sel({ team_id: '67', player_id: '1', is_starting: true })], HOME, AWAY);
    assert.notEqual(out.home, null);
    assert.equal(out.away, null);
    assert.equal(out.coverage.lineups, 'present');
  });

  test('no lineups at all → both null, coverage absent (never fabricated)', () => {
    const out = groupMatchLineups([], HOME, AWAY);
    assert.equal(out.home, null);
    assert.equal(out.away, null);
    assert.equal(out.coverage.lineups, 'absent');
  });

  test('projection is observed evidence only — no predicted/derived XI language', () => {
    const blob = JSON.stringify(groupMatchLineups(rows, HOME, AWAY)).toLowerCase();
    for (const term of ['predicted', 'probability', 'verdict', 'confidence', 'readiness', 'expected']) {
      assert.equal(blob.includes(term), false, `lineups must not emit "${term}"`);
    }
  });
});
