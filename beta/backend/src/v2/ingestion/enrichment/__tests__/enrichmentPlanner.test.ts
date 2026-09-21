// STATISTICAL ENRICHMENT PLANNER + LAYER-2 UNLOCK tests (DB-free: pure + captured-tx).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  teamShortfalls, selectTargetedFixtures, evaluateUnlock,
  readEditionEnrichmentDemand, readForwardDemand, readLayer2UnlockStatus,
  DEMAND_COUNTS_SQL, MISSING_FIXTURES_SQL, UNLOCK_USABLE_SQL, FORWARD_DEMAND_SQL,
  type MissingFixture,
} from '../enrichmentPlanner';

// ── pure planning ───────────────────────────────────────────────────────────

describe('planner · shortfalls & selection', () => {
  test('teamShortfalls: covered→shortfall to floor, 0-covered teams included', () => {
    const s = teamShortfalls(new Map([['1', 6], ['2', 8]]), ['1', '2', '3'], 8);
    assert.deepEqual(s.find((t) => t.teamId === '3'), { teamId: '3', covered: 0, shortfall: 8 });
    assert.deepEqual(s.find((t) => t.teamId === '2'), { teamId: '2', covered: 8, shortfall: 0 });
  });

  test('selectTargetedFixtures: one fixture = one call (both teams); greedy on most-short; deterministic', () => {
    const missing: MissingFixture[] = [
      { fixtureId: '10', fixturePartitionOn: 'p', kickoffAt: '2026-02-01', homeTeamId: '1', awayTeamId: '2' },
      { fixtureId: '11', fixturePartitionOn: 'p', kickoffAt: '2026-02-02', homeTeamId: '1', awayTeamId: '3' },
      { fixtureId: '12', fixturePartitionOn: 'p', kickoffAt: '2026-02-03', homeTeamId: '4', awayTeamId: '4x' }, // 4x not tracked
    ];
    // teams 1,2,3 at 7 (short by 1 to floor 8); team 4 already at 8 (not short)
    const covered = new Map([['1', 7], ['2', 7], ['3', 7], ['4', 8], ['4x', 8]]);
    const sel = selectTargetedFixtures(missing, covered, 8);
    // fixture 10 lifts teams 1&2 (gain 2); then 11 lifts team 3 (team1 now at floor, gain 1); fixture 12 helps nobody short.
    assert.deepEqual(sel.selectedFixtureIds, ['10', '11']);
    assert.equal(sel.calls, 2);
    assert.equal(sel.teamsStillShort, 0);
    assert.ok(!sel.selectedFixtureIds.includes('12')); // adds no value → excluded
  });

  test('already-enriched teams do not inflate; nothing selected when no team is short', () => {
    const missing: MissingFixture[] = [{ fixtureId: '9', fixturePartitionOn: 'p', kickoffAt: '2026-02-01', homeTeamId: '1', awayTeamId: '2' }];
    const sel = selectTargetedFixtures(missing, new Map([['1', 10], ['2', 10]]), 8);
    assert.deepEqual(sel.selectedFixtureIds, []);
    assert.equal(sel.calls, 0);
  });

  test('evaluateUnlock: 2/20 stays locked; 16/20 (80%) unlocks at threshold 0.8', () => {
    const locked = evaluateUnlock([{ key: 'expectedGoals', teamsAny: 20, teamsGe5: 3, teamsGe8: 2 }], 20, 0.8, 8);
    assert.equal(locked[0].teamsGe8Percent, 0.1);
    assert.equal(locked[0].unlocked, false);
    const open = evaluateUnlock([{ key: 'expectedGoals', teamsAny: 20, teamsGe5: 18, teamsGe8: 16 }], 20, 0.8, 8);
    assert.equal(open[0].teamsGe8Percent, 0.8);
    assert.equal(open[0].unlocked, true);
  });
});

// ── SQL shape ────────────────────────────────────────────────────────────────

describe('planner · SQL shape (strict, result-tier eligibility, dedup)', () => {
  test('demand + missing SQL: COMPLETED, strict `< $2`, period ALL', () => {
    for (const s of [DEMAND_COUNTS_SQL, MISSING_FIXTURES_SQL]) {
      assert.match(s, /lifecycle_state_code = 'COMPLETED'/);
      assert.match(s, /scheduled_kickoff_at < \$2::timestamptz/);
      assert.match(s, /statistic_key = \$3::text AND s\.period = 'ALL'/);
      assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
    }
  });
  test('unlock SQL: usable numeric oriented value + count(DISTINCT fixture) (group_name-safe)', () => {
    assert.match(UNLOCK_USABLE_SQL, /home_value ~ '\^-\?\[0-9\.\]\+\$'/);
    assert.match(UNLOCK_USABLE_SQL, /away_value ~ '\^-\?\[0-9\.\]\+\$'/);
    assert.match(UNLOCK_USABLE_SQL, /count\(DISTINCT fixture\)/);
    assert.match(UNLOCK_USABLE_SQL, /statistic_key = ANY\(\$3::text\[\]\)/);
  });
  test('forward SQL: SCHEDULED and strictly future', () => {
    assert.match(FORWARD_DEMAND_SQL, /lifecycle_state_code = 'SCHEDULED'/);
    assert.match(FORWARD_DEMAND_SQL, /scheduled_kickoff_at > \$2::timestamptz/);
  });
});

// ── read binding ───────────────────────────────────────────────────────────

function captureTx(queue: unknown[][]) {
  let i = 0;
  return { query: async (_s: string, _p: unknown[] = []) => ({ rows: queue[i++] ?? [] }) } as unknown as PoolClient;
}

describe('planner · read binding', () => {
  test('readEditionEnrichmentDemand composes counts/missing/per-team/all-teams; calls = missing count', async () => {
    const counts = [{ completed: '250', covered: '37' }];
    const missing = [
      { fixture_id: '100', fixture_partition_on: 'p', kickoff_at: '2026-02-01T00:00:00Z', home_team_id: '1', away_team_id: '2' },
      { fixture_id: '101', fixture_partition_on: 'p', kickoff_at: '2026-02-02T00:00:00Z', home_team_id: '1', away_team_id: '3' },
    ];
    const perTeam = [{ team_id: '1', covered: '2' }, { team_id: '2', covered: '1' }];
    const allTeams = [{ t: '1' }, { t: '2' }, { t: '3' }];
    const res = await readEditionEnrichmentDemand(captureTx([counts, missing, perTeam, allTeams]), '18', { asOf: new Date('2026-06-01T00:00:00Z') });
    assert.equal(res.completedFixtures, 250);
    assert.equal(res.coveredFixtures, 37);
    assert.equal(res.missingFixtures, 2);
    assert.equal(res.callsForFullBackfill, 2);
    assert.equal(res.teams.find((t) => t.teamId === '3')!.covered, 0); // 0-covered team present
    assert.equal(res.teamsBelowFloor, 3); // all three below floor 8
  });

  test('readForwardDemand maps 24/48/72h buckets', async () => {
    const res = await readForwardDemand(captureTx([[{ n24: '2', n48: '5', n72: '9' }]]), '18', new Date());
    assert.deepEqual(res, { next24h: 2, next48h: 5, next72h: 9 });
  });

  test('readLayer2UnlockStatus stays locked at current coverage (2/20 < 80%)', async () => {
    const editionTeams = [{ teams: '20' }];
    const perKey = [{ key: 'expectedGoals', teams_any: '20', teams_ge5: '3', teams_ge8: '2' }];
    const res = await readLayer2UnlockStatus(captureTx([editionTeams, perKey]), '18', { asOf: new Date(), keys: ['expectedGoals'], thresholdPercent: 0.8 });
    assert.equal(res.editionTeams, 20);
    assert.equal(res.keys[0].unlocked, false);
    assert.equal(res.anyUnlocked, false);
  });
});
