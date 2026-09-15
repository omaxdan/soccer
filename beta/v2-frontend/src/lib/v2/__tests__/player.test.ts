// PLAYER helper test (DB-free, pure). Presentation-only re-orientation, no new stats.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { playerMatchFixture } from '../player';
import type { PlayerMatchStatLine } from '../types';

const line = (over: Partial<PlayerMatchStatLine>): PlayerMatchStatLine => ({
  fixtureId: '344', kickoffAt: '2026-09-02T22:30:00.000Z', competitionEditionId: '18', seasonLabel: '2026',
  teamId: '68', opponentTeamId: '59', opponentName: 'Mirassol', isHome: true, score: { home: 2, away: 0 }, statistics: [], ...over,
});

describe('playerMatchFixture — canonical home/away names for routes.match', () => {
  test('home: player team is home', () => {
    assert.deepEqual(playerMatchFixture(line({}), 'Flamengo'), { fixtureId: '344', homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Mirassol' } });
  });
  test('away: player team is away', () => {
    assert.deepEqual(playerMatchFixture(line({ isHome: false }), 'Flamengo'), { fixtureId: '344', homeTeam: { name: 'Mirassol' }, awayTeam: { name: 'Flamengo' } });
  });
});
