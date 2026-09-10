// ─────────────────────────────────────────────────────────────────────────────
// MATCH ENRICHMENT PERSISTENCE — DB-free tests over a fake connection
//
// The stage's SQL is exercised against a fake PoolClient that routes by target
// relation, returns canned identities, and RECORDS every statement so the tests
// can assert what was written, with which conflict target, from which raw value —
// without a database. Payload excerpts are copied verbatim from the live capture
// for match 15237975 (operator-run); no field is invented.
//
// RUN-278 FINDING (fixed here): the lineup payload's per-player `teamId` is in a
// DIFFERENT id space than football.team (live teamId 34318 for a fixture whose
// teams are 1961/1999). Team identity therefore comes from the FIXTURE, by side —
// data.home → fixture.home_team_id, data.away → fixture.away_team_id — and the
// lineup teamId is ignored. These tests pin that: a player carrying an
// unresolvable teamId under data.home still lands on the home team, creating no
// team and raising no error.
//
// The live idempotency proof (real rows, real duplicate-suppression) is Phase 6,
// operator-run. These tests pin the WRITE PATH: side-based team resolution,
// correct natural keys, raw preservation, captain/starter mapping, and the strict
// exclusion of appearance / match_event / the /player-statistics alias /
// /incidents.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import {
  persistMatchEnrichment,
  MatchEnrichmentIdentityError,
  MatchEnrichmentPayloadError,
} from '../stages/matchEnrichment';

// ── Captured payload excerpts. Home players carry teamId 1961 (as observed live);
//    the away player carries 1999. The stage IGNORES these for identity. ────────
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

// The run-278 shape: a home player carrying a teamId that resolves to NO team
// (34318), and an away player likewise. Identity must still succeed via the side.
const LINEUPS_UNRESOLVABLE_TEAMID = {
  success: true, matchId: 15237975, endpoint: 'lineups',
  data: {
    home: {
      formation: '4-3-3',
      players: [
        { player: { name: 'Fábio', id: 17785 }, teamId: 34318, shirtNumber: 1, position: 'G', substitute: false, captain: true, statistics: { rating: 6.5 } },
      ],
    },
    away: {
      formation: '4-4-2',
      players: [
        { player: { name: 'Cleiton', id: 111111 }, teamId: 77777, shirtNumber: 1, position: 'G', substitute: true, statistics: { rating: 0 } },
      ],
    },
  },
};

const STATS = {
  success: true, matchId: 15237975, endpoint: 'statistics',
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

const RETRIEVED_AT = new Date('2026-09-10T12:00:00.000Z');

// Fixture 61's authoritative teams (mirrors the live diagnostic: 67 home, 64 away).
const HOME_TEAM = '67';
const AWAY_TEAM = '64';

interface RecordedInsert {
  readonly relation: string;
  readonly columns: readonly string[];
  readonly conflictTarget: readonly string[];
  readonly value: Record<string, unknown>;
  readonly sql: string;
}

interface FakeOptions {
  readonly fixture?: { id: string; partitionOn: string } | null;
  /** Override the fixture's home/away team ids; null on a side simulates a missing team. */
  readonly teams?: { home: string | null; away: string | null };
  readonly existing?: {
    lineupTeamIds?: string[];
    selectionKeys?: string[];
    playerStatKeys?: string[];
    teamStatKeys?: string[];
  };
}

interface FakeConnection {
  readonly tx: PoolClient;
  readonly inserts: RecordedInsert[];
  readonly selectRelations: string[];
}

const relationOfInsert = (sql: string): string => /INSERT INTO (football\.\w+)/.exec(sql)?.[1] ?? '';
const relationOfSelect = (sql: string): string => /FROM (football\.\w+)/.exec(sql)?.[1] ?? '';
function listBetween(sql: string, re: RegExp): string[] {
  const m = re.exec(sql);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
}

function makeFake(options: FakeOptions = {}): FakeConnection {
  const fixture = options.fixture === undefined ? { id: '61', partitionOn: '2025-06-01' } : options.fixture;
  const teams = options.teams ?? { home: HOME_TEAM, away: AWAY_TEAM };
  const existing = options.existing ?? {};
  const inserts: RecordedInsert[] = [];
  const selectRelations: string[] = [];

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    const trimmed = sql.trim();

    if (trimmed.startsWith('SELECT')) {
      const relation = relationOfSelect(sql);
      selectRelations.push(relation);
      switch (relation) {
        case 'football.fixture':
          // Two different reads hit the fixture: identity (by provider id) and the
          // home/away team ids (selects home_team_id).
          if (sql.includes('home_team_id')) {
            return fixture
              ? { rows: [{ home_team_id: teams.home, away_team_id: teams.away }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          return fixture
            ? { rows: [{ id: fixture.id, fixture_partition_on: fixture.partitionOn, lifecycle_state_code: 'COMPLETED' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        case 'football.lineup':
          return {
            rows: (existing.lineupTeamIds ?? []).map((teamId) => ({ team_id: teamId, id: `lineup-${teamId}` })),
            rowCount: (existing.lineupTeamIds ?? []).length,
          };
        case 'football.lineup_selection':
          return {
            rows: (existing.selectionKeys ?? []).map((k) => {
              const [lineup_id, player_id] = k.split('~');
              return { lineup_id, player_id };
            }),
            rowCount: (existing.selectionKeys ?? []).length,
          };
        case 'football.player_match_statistic':
          return {
            rows: (existing.playerStatKeys ?? []).map((k) => {
              const [player_id, statistic_key] = k.split('~');
              return { player_id, statistic_key };
            }),
            rowCount: (existing.playerStatKeys ?? []).length,
          };
        case 'football.team_match_statistic':
          return {
            rows: (existing.teamStatKeys ?? []).map((k) => {
              const [period, group_name, statistic_key] = k.split('~');
              return { period, group_name, statistic_key };
            }),
            rowCount: (existing.teamStatKeys ?? []).length,
          };
        default:
          throw new Error(`fake tx: unrouted SELECT on '${relation}': ${trimmed.slice(0, 80)}`);
      }
    }

    if (trimmed.startsWith('INSERT')) {
      const relation = relationOfInsert(sql);
      const columns = listBetween(sql, /INSERT INTO football\.\w+ \(([^)]*)\)/);
      const conflictTarget = listBetween(sql, /ON CONFLICT \(([^)]*)\)/);
      const value: Record<string, unknown> = {};
      columns.forEach((c, i) => (value[c] = params[i]));
      inserts.push({ relation, columns, conflictTarget, value, sql });

      if (relation === 'football.player') {
        // player is NOT partitioned → RETURNING id, (xmax = 0) AS inserted.
        return { rows: [{ id: `player-${params[1]}`, inserted: true }], rowCount: 1 };
      }
      const id = relation === 'football.lineup' ? `lineup-${value['team_id']}` : `${relation}-row`;
      return { rows: [{ id }], rowCount: 1 };
    }

    throw new Error(`fake tx: unrouted statement: ${trimmed.slice(0, 80)}`);
  };

  return { tx: { query } as unknown as PoolClient, inserts, selectRelations };
}

const only = (inserts: readonly RecordedInsert[], relation: string): RecordedInsert[] =>
  inserts.filter((i) => i.relation === relation);

const run = (fake: FakeConnection, lineupsPayload: unknown = LINEUPS, statisticsPayload: unknown = STATS) =>
  persistMatchEnrichment(fake.tx, { fixtureProviderId: '15237975', lineupsPayload, statisticsPayload, retrievedAt: RETRIEVED_AT });

// ─────────────────────────────────────────────────────────────────────────────
describe('persistMatchEnrichment — resolution and writes', () => {
  test('resolves the fixture by provider identity and co-partitions every write', async () => {
    const fake = makeFake();
    const result = await run(fake);
    assert.equal(result.fixture.id, '61');
    assert.equal(result.fixture.partitionOn, '2025-06-01');
    for (const rel of ['football.lineup', 'football.lineup_selection', 'football.player_match_statistic', 'football.team_match_statistic']) {
      for (const ins of only(fake.inserts, rel)) {
        assert.equal(ins.value['fixture_partition_on'], '2025-06-01', `${rel} co-partitioned with the fixture`);
      }
    }
  });

  test('a fixture that does not resolve is a HARD STOP, nothing written', async () => {
    const fake = makeFake({ fixture: null });
    await assert.rejects(
      () => run(fake),
      (e) => e instanceof MatchEnrichmentIdentityError && e.kind === 'fixture'
    );
    assert.equal(fake.inserts.length, 0);
  });

  test('a fixture missing a side team is a HARD STOP (fixture integrity), nothing written', async () => {
    const fake = makeFake({ teams: { home: HOME_TEAM, away: null } });
    await assert.rejects(
      () => run(fake),
      (e) => e instanceof MatchEnrichmentIdentityError && e.kind === 'team'
    );
    assert.equal(fake.inserts.length, 0);
  });

  test('an empty statistics payload is a material difference and stops', async () => {
    const fake = makeFake();
    await assert.rejects(
      () => run(fake, LINEUPS, { success: true, data: { statistics: [] } }),
      (e) => e instanceof MatchEnrichmentPayloadError
    );
  });
});

describe('persistMatchEnrichment — team identity comes from the fixture side', () => {
  test('home players resolve to fixture.home_team_id, away players to fixture.away_team_id', async () => {
    const fake = makeFake();
    await run(fake);

    const lineups = only(fake.inserts, 'football.lineup');
    assert.equal(lineups.length, 2);
    assert.deepEqual(lineups.map((l) => l.value['team_id']).sort(), [AWAY_TEAM, HOME_TEAM].sort());

    // Fábio + Guga (home) → HOME_TEAM; Cleiton (away) → AWAY_TEAM.
    const pstats = only(fake.inserts, 'football.player_match_statistic');
    assert.equal(pstats.find((r) => r.value['player_id'] === 'player-17785')?.value['team_id'], HOME_TEAM);
    assert.equal(pstats.find((r) => r.value['player_id'] === 'player-928134')?.value['team_id'], HOME_TEAM);
    assert.equal(pstats.find((r) => r.value['player_id'] === 'player-111111')?.value['team_id'], AWAY_TEAM);
  });

  test('RUN-278 REGRESSION: unresolvable lineup teamId (34318) still maps by side, no failure, no team created', async () => {
    const fake = makeFake();
    // Home player carries teamId 34318, away carries 77777 — neither resolvable.
    const result = await run(fake, LINEUPS_UNRESOLVABLE_TEAMID);
    // No throw; the home player landed on HOME_TEAM, the away on AWAY_TEAM.
    const lineups = only(fake.inserts, 'football.lineup');
    assert.equal(lineups.find((l) => l.value['formation'] === '4-3-3')?.value['team_id'], HOME_TEAM);
    assert.equal(lineups.find((l) => l.value['formation'] === '4-4-2')?.value['team_id'], AWAY_TEAM);
    const sel = result.byRelation.get('football.lineup_selection')!;
    assert.equal(sel.written, 2);
  });

  test('team identity never touches football.team (no read, no write, no alias)', async () => {
    const fake = makeFake();
    await run(fake, LINEUPS_UNRESOLVABLE_TEAMID);
    assert.ok(!fake.selectRelations.includes('football.team'), 'the lineup teamId is never resolved against football.team');
    assert.equal(only(fake.inserts, 'football.team').length, 0, 'no team is ever created from a lineup');
  });
});

describe('persistMatchEnrichment — captain, starter, position', () => {
  test('captain, starter/sub and position mapped from the provider flags', async () => {
    const fake = makeFake();
    await run(fake);
    const selections = only(fake.inserts, 'football.lineup_selection');
    assert.equal(selections.length, 3);

    const fabio = selections.find((s) => s.value['player_id'] === 'player-17785')!;
    assert.equal(fabio.value['is_captain'], true);
    assert.equal(fabio.value['is_starting'], true);
    assert.equal(fabio.value['shirt_number'], 1);
    assert.equal(fabio.value['position_code'], 'GK'); // provider 'G' → seeded GK

    const guga = selections.find((s) => s.value['player_id'] === 'player-928134')!;
    assert.equal(guga.value['is_captain'], false); // captain key absent → false, not fabricated
    assert.equal(guga.value['is_starting'], true);
    assert.equal(guga.value['position_code'], 'CB'); // provider 'D' → seeded CB

    const cleiton = selections.find((s) => s.value['player_id'] === 'player-111111')!;
    assert.equal(cleiton.value['is_starting'], false); // substitute:true
    assert.equal(cleiton.value['is_captain'], false);

    assert.deepEqual(fabio.conflictTarget, ['fixture_partition_on', 'lineup_id', 'player_id']);
  });
});

describe('persistMatchEnrichment — player match statistics', () => {
  test('one row per player per key; scalars and nested JSON preserved as raw text', async () => {
    const fake = makeFake();
    await run(fake);
    const rows = only(fake.inserts, 'football.player_match_statistic');
    assert.equal(rows.length, 15); // Fábio 9 + Guga 4 + Cleiton 2

    const fabioRating = rows.find((r) => r.value['player_id'] === 'player-17785' && r.value['statistic_key'] === 'rating')!;
    assert.equal(fabioRating.value['statistic_value'], '6.5');
    assert.equal(fabioRating.value['value_type'], 'number');
    assert.equal(fabioRating.value['provider_code'], 'SPORTSAPI_API');
    assert.equal(fabioRating.value['retrieved_at'], RETRIEVED_AT);

    const rv = rows.find((r) => r.value['player_id'] === 'player-17785' && r.value['statistic_key'] === 'ratingVersions')!;
    assert.equal(rv.value['value_type'], 'json');
    assert.equal(rv.value['statistic_value'], JSON.stringify({ original: 6.5, alternative: 6.5 }));

    assert.deepEqual(rows[0].conflictTarget, ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key']);
  });
});

describe('persistMatchEnrichment — team match statistics', () => {
  test('one row per (period, group, key); raw display preserved; key recurs across groups', async () => {
    const fake = makeFake();
    await run(fake);
    const rows = only(fake.inserts, 'football.team_match_statistic');
    assert.equal(rows.length, 6);

    const poss = rows.find((r) => r.value['statistic_key'] === 'ballPossession')!;
    assert.equal(poss.value['home_display'], '67%');
    assert.equal(poss.value['away_display'], '33%');
    assert.equal(poss.value['home_value'], '67');
    assert.equal(poss.value['statistic_name'], 'Ball possession');
    assert.equal(poss.value['render_type'], '2');

    const shots = rows.filter((r) => r.value['statistic_key'] === 'totalShotsOnGoal');
    assert.equal(shots.length, 2);
    assert.deepEqual(shots.map((r) => r.value['group_name']).sort(), ['Match overview', 'Shots']);

    assert.deepEqual(rows[0].conflictTarget, ['fixture_partition_on', 'fixture_id', 'period', 'group_name', 'statistic_key']);
  });
});

describe('persistMatchEnrichment — strict exclusions', () => {
  test('appearance and match_event are NEVER written', async () => {
    const fake = makeFake();
    await run(fake);
    assert.equal(only(fake.inserts, 'football.appearance').length, 0);
    assert.equal(only(fake.inserts, 'football.match_event').length, 0);
  });

  test('every INSERT is idempotent (ON CONFLICT DO UPDATE), never delete/reinsert', async () => {
    const fake = makeFake();
    await run(fake);
    for (const ins of fake.inserts) {
      assert.ok(/ON CONFLICT .* DO UPDATE/.test(ins.sql), `${ins.relation} upserts rather than blind-inserts`);
    }
  });
});

describe('persistMatchEnrichment — idempotency path', () => {
  test('a second run over already-stored keys reports updates, not inserts', async () => {
    const fake = makeFake({
      existing: {
        lineupTeamIds: [HOME_TEAM, AWAY_TEAM],
        selectionKeys: [
          `lineup-${HOME_TEAM}~player-17785`, `lineup-${HOME_TEAM}~player-928134`, `lineup-${AWAY_TEAM}~player-111111`,
        ],
        playerStatKeys: [
          'player-17785~totalPass', 'player-17785~accuratePass', 'player-17785~saves', 'player-17785~minutesPlayed',
          'player-17785~rating', 'player-17785~expectedAssists', 'player-17785~goalsPrevented',
          'player-17785~ratingVersions', 'player-17785~statisticsType',
          'player-928134~totalPass', 'player-928134~accuratePass', 'player-928134~minutesPlayed', 'player-928134~rating',
          'player-111111~minutesPlayed', 'player-111111~rating',
        ],
        teamStatKeys: [
          'ALL~Match overview~ballPossession', 'ALL~Match overview~totalShotsOnGoal',
          'ALL~Match overview~expectedGoals', 'ALL~Match overview~redCards',
          'ALL~Shots~totalShotsOnGoal', 'ALL~Shots~expectedGoals',
        ],
      },
    });
    const result = await run(fake);
    const pstat = result.byRelation.get('football.player_match_statistic')!;
    assert.equal(pstat.inserted, 0);
    assert.equal(pstat.updated, 15);
    const tstat = result.byRelation.get('football.team_match_statistic')!;
    assert.equal(tstat.inserted, 0);
    assert.equal(tstat.updated, 6);
    const sel = result.byRelation.get('football.lineup_selection')!;
    assert.equal(sel.inserted, 0);
    assert.equal(sel.updated, 3);
    const lu = result.byRelation.get('football.lineup')!;
    assert.equal(lu.inserted, 0);
    assert.equal(lu.updated, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('match enrichment — endpoints and relations by construction', () => {
  const stageSrc = readFileSync(resolve(__dirname, '..', 'stages', 'matchEnrichment.ts'), 'utf8');
  const pipelineSrc = readFileSync(resolve(__dirname, '..', 'pipeline.ts'), 'utf8');

  test('the stage writes neither appearance nor match_event', () => {
    assert.ok(!/'football\.appearance'/.test(stageSrc), 'no appearance write target');
    assert.ok(!/'football\.match_event'/.test(stageSrc), 'no match_event write target');
    assert.ok(!/INSERT INTO football\.appearance/.test(stageSrc));
    assert.ok(!/INSERT INTO football\.match_event/.test(stageSrc));
  });

  test('enrichment fetches only match_lineups and match_statistics', () => {
    const enrichBlock = pipelineSrc.slice(pipelineSrc.indexOf('enrichMatchFixture'));
    assert.ok(enrichBlock.includes("getObserved('match_lineups'"));
    assert.ok(enrichBlock.includes("getObserved('match_statistics'"));
    assert.ok(!/player-statistics|match_player_statistics/.test(enrichBlock), 'the /player-statistics alias is never fetched');
    assert.ok(!/incidents/.test(enrichBlock), '/incidents (503) is never fetched');
  });
});
