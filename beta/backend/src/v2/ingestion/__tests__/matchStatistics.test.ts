// ─────────────────────────────────────────────────────────────────────────────
// MATCH RAW STATISTICS NORMALISERS — pure tests over the REAL captured payload
// (match 15237975, operator-run). No DB, no provider. Every fixture value below
// is copied from the live response; no field is invented.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseTeamMatchStatistics,
  normalisePlayerMatchStatistics,
  normaliseLineups,
} from '../entities/matchStatistics';
import { ENDPOINTS, resolvePath } from '../provider/endpoints';

// Real /match/15237975/lineups excerpt (Fábio = starter+captain; Guga = starter, no captain key).
const LINEUPS = {
  success: true,
  matchId: 15237975,
  endpoint: 'lineups',
  data: {
    confirmed: true,
    home: {
      formation: '4-3-3',
      players: [
        {
          player: { name: 'Fábio', position: 'G', jerseyNumber: '1', id: 17785 },
          teamId: 1961, shirtNumber: 1, jerseyNumber: '1', position: 'G',
          substitute: false, captain: true,
          statistics: {
            totalPass: 7, accuratePass: 7, saves: 1, minutesPlayed: 90, rating: 6.5,
            expectedAssists: 0.00006056, goalsPrevented: 0.0107,
            ratingVersions: { original: 6.5, alternative: 6.5 },
            statisticsType: { sportSlug: 'football', statisticsType: 'player' },
          },
          minutesPlayed: 90, played: true,
        },
        {
          player: { name: 'Guga', position: 'D', jerseyNumber: '23', id: 928134 },
          teamId: 1961, shirtNumber: 23, jerseyNumber: '23', position: 'D',
          substitute: false,
          statistics: { totalPass: 59, accuratePass: 54, minutesPlayed: 90, rating: 6.6 },
          minutesPlayed: 90, played: true,
        },
      ],
    },
    away: {
      formation: '4-4-2',
      players: [
        {
          player: { name: 'Cleiton', position: 'G', jerseyNumber: '1', id: 111111 },
          teamId: 1999, shirtNumber: 1, jerseyNumber: '1', position: 'G',
          substitute: true,
          statistics: { minutesPlayed: 0, rating: 0 },
          minutesPlayed: 0, played: false,
        },
      ],
    },
  },
};

// Real /match/15237975/statistics excerpt — note totalShotsOnGoal + expectedGoals
// appear in BOTH "Match overview" and "Shots" within period ALL.
const STATS = {
  success: true,
  matchId: 15237975,
  endpoint: 'statistics',
  data: {
    statistics: [
      {
        period: 'ALL',
        groups: [
          {
            groupName: 'Match overview',
            statisticsItems: [
              { name: 'Ball possession', home: '67%', away: '33%', compareCode: 1, statisticsType: 'positive', valueType: 'event', homeValue: 67, awayValue: 33, renderType: 2, key: 'ballPossession' },
              { name: 'Total shots', home: '24', away: '6', compareCode: 1, statisticsType: 'positive', valueType: 'event', homeValue: 24, awayValue: 6, renderType: 1, key: 'totalShotsOnGoal' },
              { name: 'Expected goals', home: '1.71', away: '0.89', compareCode: 1, statisticsType: 'positive', valueType: 'event', homeValue: 1.71, awayValue: 0.89, renderType: 1, key: 'expectedGoals' },
              { name: 'Red cards', home: '1', away: '2', compareCode: 2, statisticsType: 'negative', valueType: 'event', homeValue: 1, awayValue: 2, renderType: 1, key: 'redCards' },
            ],
          },
          {
            groupName: 'Shots',
            statisticsItems: [
              { name: 'Total shots', home: '24', away: '6', compareCode: 1, statisticsType: 'positive', valueType: 'event', homeValue: 24, awayValue: 6, renderType: 1, key: 'totalShotsOnGoal' },
              { name: 'Expected goals', home: '1.71', away: '0.89', compareCode: 1, statisticsType: 'positive', valueType: 'event', homeValue: 1.71, awayValue: 0.89, renderType: 1, key: 'expectedGoals' },
            ],
          },
        ],
      },
    ],
  },
};

describe('normaliseTeamMatchStatistics', () => {
  const rows = normaliseTeamMatchStatistics(STATS);

  test('preserves both display and typed values as raw text', () => {
    const poss = rows.find((r) => r.statisticKey === 'ballPossession' && r.groupName === 'Match overview');
    assert.equal(poss?.homeDisplay, '67%');
    assert.equal(poss?.awayDisplay, '33%');
    assert.equal(poss?.homeValue, '67');
    assert.equal(poss?.awayValue, '33');
    assert.equal(poss?.valueType, 'event');
    assert.equal(poss?.renderType, '2');
    assert.equal(poss?.statisticName, 'Ball possession');
  });

  test('the SAME key across two groups yields two distinct rows (group_name is part of identity)', () => {
    const shots = rows.filter((r) => r.statisticKey === 'totalShotsOnGoal');
    assert.equal(shots.length, 2);
    assert.deepEqual(shots.map((r) => r.groupName).sort(), ['Match overview', 'Shots']);
    // ⇒ UNIQUE(fixture, period, group_name, key) is required and safe.
  });

  test('within a single group, keys are unique (no collision under the natural key)', () => {
    const overview = rows.filter((r) => r.groupName === 'Match overview');
    const keys = overview.map((r) => r.statisticKey);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe('normalisePlayerMatchStatistics', () => {
  const rows = normalisePlayerMatchStatistics(LINEUPS);

  test('one row per statistics key per player; scalars as text, nested objects as json', () => {
    const fabio = rows.filter((r) => r.playerProviderId === '17785');
    const minutes = fabio.find((r) => r.statisticKey === 'minutesPlayed');
    assert.equal(minutes?.statisticValue, '90');
    assert.equal(minutes?.valueType, 'number');
    assert.equal(fabio.find((r) => r.statisticKey === 'rating')?.statisticValue, '6.5');
    const rv = fabio.find((r) => r.statisticKey === 'ratingVersions');
    assert.equal(rv?.valueType, 'json');
    assert.equal(rv?.statisticValue, JSON.stringify({ original: 6.5, alternative: 6.5 }));
    assert.equal(fabio.find((r) => r.statisticKey === 'statisticsType')?.valueType, 'json');
  });

  test('a player cannot produce a duplicate statistic key (object keys are unique)', () => {
    const fabio = rows.filter((r) => r.playerProviderId === '17785');
    const keys = fabio.map((r) => r.statisticKey);
    assert.equal(new Set(keys).size, keys.length, 'confirms UNIQUE(fixture, player, key) is safe');
  });

  test('carries provider player identity and the fixture side, never the lineup teamId', () => {
    assert.ok(rows.every((r) => /^\d+$/.test(r.playerProviderId)));
    assert.ok(rows.every((r) => r.side === 'home' || r.side === 'away'));
    // The lineup teamId is deliberately absent from the row shape.
    assert.ok(rows.every((r) => !('teamProviderId' in r)));
  });
});

describe('normaliseLineups', () => {
  const { lineups, selections } = normaliseLineups(LINEUPS);

  test('one lineup per side, keyed by side (not by the lineup teamId), formation preserved', () => {
    assert.equal(lineups.length, 2);
    assert.deepEqual(lineups.map((l) => l.side).sort(), ['away', 'home']);
    assert.equal(lineups.find((l) => l.side === 'home')?.formation, '4-3-3');
    assert.equal(lineups.find((l) => l.side === 'away')?.formation, '4-4-2');
  });

  test('starter/substitute and captain mapped from provider flags; side carried', () => {
    const fabio = selections.find((s) => s.playerProviderId === '17785');
    assert.equal(fabio?.side, 'home');
    assert.equal(fabio?.isStarting, true); // substitute:false
    assert.equal(fabio?.isCaptain, true); // captain:true
    assert.equal(fabio?.shirtNumber, 1);
    assert.equal(fabio?.positionCode, 'G');

    const guga = selections.find((s) => s.playerProviderId === '928134');
    assert.equal(guga?.side, 'home');
    assert.equal(guga?.isStarting, true);
    assert.equal(guga?.isCaptain, false); // captain key absent → false, not fabricated

    const sub = selections.find((s) => s.playerProviderId === '111111');
    assert.equal(sub?.side, 'away');
    assert.equal(sub?.isStarting, false); // substitute:true
    assert.equal(sub?.isCaptain, false);
  });
});

describe('endpoint registry — canonical decisions', () => {
  test('match_lineups and match_statistics are registered and resolve', () => {
    assert.equal(resolvePath('match_lineups', { matchId: 15237975 }), '/match/15237975/lineups');
    assert.equal(resolvePath('match_statistics', { matchId: 15237975 }), '/match/15237975/statistics');
    assert.equal(ENDPOINTS.match_lineups.costClass, 'PER_ENTITY');
  });

  test('the /player-statistics alias and /incidents are NOT registered as sources', () => {
    const keys = Object.keys(ENDPOINTS);
    assert.ok(!keys.includes('match_player_statistics'), 'player-statistics is an alias, not a separate source');
    assert.ok(!keys.includes('match_incidents'), 'incidents is unresolved (503) and not registered');
  });
});
