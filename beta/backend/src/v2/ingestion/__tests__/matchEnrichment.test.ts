// ─────────────────────────────────────────────────────────────────────────────
// MATCH ENRICHMENT PERSISTENCE — DB-free tests over a fake connection
//
// The stage's SQL is exercised against a fake PoolClient that routes by target
// relation, returns canned identities, and RECORDS every INSERT so the tests can
// assert what was written, with which conflict target, from which raw value —
// without a database. Payload excerpts are copied verbatim from the live capture
// for match 15237975 (operator-run); no field is invented.
//
// The live idempotency proof (real rows, real duplicate-suppression) is Phase 6,
// operator-run. These tests pin the WRITE PATH: correct resolution, correct
// natural keys, raw preservation, captain/starter mapping, and the strict
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

// ── Captured payload excerpts (identical to matchStatistics.test.ts) ──────────
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

const RETRIEVED_AT = new Date('2026-09-10T12:00:00.000Z');

// ── A recorded INSERT, parsed from the statement the primitive built. ─────────
interface RecordedInsert {
  readonly relation: string;
  readonly columns: readonly string[];
  readonly conflictTarget: readonly string[];
  readonly value: Record<string, unknown>;
  readonly sql: string;
}

interface FakeOptions {
  /** Provider match ids that resolve to a fixture. */
  readonly fixture?: { id: string; partitionOn: string } | null;
  /** Natural keys already stored, to simulate a second (idempotent) run. */
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
}

function relationOfInsert(sql: string): string {
  return /INSERT INTO (football\.\w+)/.exec(sql)?.[1] ?? '';
}
function relationOfSelect(sql: string): string {
  return /FROM (football\.\w+)/.exec(sql)?.[1] ?? '';
}
function listBetween(sql: string, re: RegExp): string[] {
  const m = re.exec(sql);
  return m ? m[1].split(',').map((s) => s.trim()) : [];
}

function makeFake(options: FakeOptions = {}): FakeConnection {
  const fixture = options.fixture === undefined ? { id: '61', partitionOn: '2025-06-01' } : options.fixture;
  const existing = options.existing ?? {};
  const inserts: RecordedInsert[] = [];

  const query = async (sql: string, params: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    const trimmed = sql.trim();

    if (trimmed.startsWith('SELECT')) {
      const relation = relationOfSelect(sql);
      switch (relation) {
        case 'football.fixture':
          return fixture
            ? { rows: [{ id: fixture.id, fixture_partition_on: fixture.partitionOn, lifecycle_state_code: 'COMPLETED' }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        case 'football.team':
          // findByProviderId: provider_external_id is $2.
          return { rows: [{ id: `team-${params[1]}` }], rowCount: 1 };
        case 'football.lineup':
          return {
            rows: (existing.lineupTeamIds ?? []).map((teamId) => ({ team_id: teamId, id: `lineup-${teamId}` })),
            rowCount: (existing.lineupTeamIds ?? []).length,
          };
        case 'football.lineup_selection':
          return {
            rows: (existing.selectionKeys ?? []).map((k) => {
              const [lineup_id, player_id] = k.split(':');
              return { lineup_id, player_id };
            }),
            rowCount: (existing.selectionKeys ?? []).length,
          };
        case 'football.player_match_statistic':
          return {
            rows: (existing.playerStatKeys ?? []).map((k) => {
              const [player_id, statistic_key] = k.split(':');
              return { player_id, statistic_key };
            }),
            rowCount: (existing.playerStatKeys ?? []).length,
          };
        case 'football.team_match_statistic':
          return {
            rows: (existing.teamStatKeys ?? []).map((k) => {
              const [period, group_name, statistic_key] = k.split(':');
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

      // football.player uses RETURNING id, (xmax = 0) AS inserted (not partitioned).
      if (relation === 'football.player') {
        return { rows: [{ id: `player-${params[1]}`, inserted: true }], rowCount: 1 };
      }
      // The partitioned targets return only id; upsertMutable supplies `inserted`.
      const id =
        relation === 'football.lineup' ? `lineup-${value['team_id']}` : `${relation}-row`;
      return { rows: [{ id }], rowCount: 1 };
    }

    throw new Error(`fake tx: unrouted statement: ${trimmed.slice(0, 80)}`);
  };

  return { tx: { query } as unknown as PoolClient, inserts };
}

const only = (inserts: readonly RecordedInsert[], relation: string): RecordedInsert[] =>
  inserts.filter((i) => i.relation === relation);

// ─────────────────────────────────────────────────────────────────────────────
describe('persistMatchEnrichment — resolution and writes', () => {
  test('resolves the fixture by provider identity and writes under it', async () => {
    const fake = makeFake();
    const result = await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975',
      lineupsPayload: LINEUPS,
      statisticsPayload: STATS,
      retrievedAt: RETRIEVED_AT,
    });
    assert.equal(result.fixture.id, '61');
    assert.equal(result.fixture.partitionOn, '2025-06-01');
    for (const rel of ['football.lineup', 'football.lineup_selection', 'football.player_match_statistic', 'football.team_match_statistic']) {
      for (const ins of only(fake.inserts, rel)) {
        assert.equal(ins.value['fixture_partition_on'], '2025-06-01', `${rel} co-partitioned with the fixture`);
      }
    }
  });

  test('a fixture that does not resolve is a HARD STOP, not a shell write', async () => {
    const fake = makeFake({ fixture: null });
    await assert.rejects(
      () =>
        persistMatchEnrichment(fake.tx, {
          fixtureProviderId: '15237975',
          lineupsPayload: LINEUPS,
          statisticsPayload: STATS,
          retrievedAt: RETRIEVED_AT,
        }),
      (e) => e instanceof MatchEnrichmentIdentityError && e.kind === 'fixture'
    );
    assert.equal(fake.inserts.length, 0, 'nothing is written when the fixture is unresolved');
  });

  test('an empty statistics payload is a material difference and stops', async () => {
    const fake = makeFake();
    await assert.rejects(
      () =>
        persistMatchEnrichment(fake.tx, {
          fixtureProviderId: '15237975',
          lineupsPayload: LINEUPS,
          statisticsPayload: { success: true, data: { statistics: [] } },
          retrievedAt: RETRIEVED_AT,
        }),
      (e) => e instanceof MatchEnrichmentPayloadError
    );
  });
});

describe('persistMatchEnrichment — lineups, captain, starter, position', () => {
  test('one lineup per side with formation, keyed on (partition, fixture, team)', async () => {
    const fake = makeFake();
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    const lineups = only(fake.inserts, 'football.lineup');
    assert.equal(lineups.length, 2);
    assert.deepEqual(
      lineups.map((l) => l.value['team_id']).sort(),
      ['team-1961', 'team-1999']
    );
    assert.equal(lineups.find((l) => l.value['team_id'] === 'team-1961')?.value['formation'], '4-3-3');
    assert.deepEqual(lineups[0].conflictTarget, ['fixture_partition_on', 'fixture_id', 'team_id']);
  });

  test('captain, starter/sub and position are mapped from the provider flags', async () => {
    const fake = makeFake();
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
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
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    const rows = only(fake.inserts, 'football.player_match_statistic');
    // Fábio 9 keys + Guga 4 + Cleiton 2 = 15.
    assert.equal(rows.length, 15);

    const fabioRating = rows.find((r) => r.value['player_id'] === 'player-17785' && r.value['statistic_key'] === 'rating')!;
    assert.equal(fabioRating.value['statistic_value'], '6.5');
    assert.equal(fabioRating.value['value_type'], 'number');
    assert.equal(fabioRating.value['team_id'], 'team-1961');
    assert.equal(fabioRating.value['provider_code'], 'SPORTSAPI_API');
    assert.equal(fabioRating.value['retrieved_at'], RETRIEVED_AT);

    const rv = rows.find((r) => r.value['player_id'] === 'player-17785' && r.value['statistic_key'] === 'ratingVersions')!;
    assert.equal(rv.value['value_type'], 'json');
    assert.equal(rv.value['statistic_value'], JSON.stringify({ original: 6.5, alternative: 6.5 }));

    assert.deepEqual(rows[0].conflictTarget, ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key']);
  });
});

describe('persistMatchEnrichment — team match statistics', () => {
  test('one row per (period, group, key); raw display strings preserved; key recurs across groups', async () => {
    const fake = makeFake();
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    const rows = only(fake.inserts, 'football.team_match_statistic');
    assert.equal(rows.length, 6); // 4 in "Match overview" + 2 in "Shots"

    const poss = rows.find((r) => r.value['statistic_key'] === 'ballPossession')!;
    assert.equal(poss.value['home_display'], '67%');
    assert.equal(poss.value['away_display'], '33%');
    assert.equal(poss.value['home_value'], '67');
    assert.equal(poss.value['statistic_name'], 'Ball possession');
    assert.equal(poss.value['render_type'], '2');
    assert.equal(poss.value['provider_code'], 'SPORTSAPI_API');

    const shots = rows.filter((r) => r.value['statistic_key'] === 'totalShotsOnGoal');
    assert.equal(shots.length, 2);
    assert.deepEqual(shots.map((r) => r.value['group_name']).sort(), ['Match overview', 'Shots']);

    assert.deepEqual(rows[0].conflictTarget, ['fixture_partition_on', 'fixture_id', 'period', 'group_name', 'statistic_key']);
  });
});

describe('persistMatchEnrichment — strict exclusions', () => {
  test('appearance and match_event are NEVER written', async () => {
    const fake = makeFake();
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    assert.equal(only(fake.inserts, 'football.appearance').length, 0);
    assert.equal(only(fake.inserts, 'football.match_event').length, 0);
  });

  test('every INSERT is idempotent (ON CONFLICT DO UPDATE), never delete/reinsert', async () => {
    const fake = makeFake();
    await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    for (const ins of fake.inserts) {
      assert.ok(/ON CONFLICT .* DO UPDATE/.test(ins.sql), `${ins.relation} upserts rather than blind-inserts`);
    }
  });
});

describe('persistMatchEnrichment — idempotency path', () => {
  test('a second run over already-stored keys reports updates, not inserts', async () => {
    // Simulate the state left by a first run: both lineups, all selections, all
    // player-stat and team-stat keys already present.
    const fake = makeFake({
      existing: {
        lineupTeamIds: ['team-1961', 'team-1999'],
        selectionKeys: ['lineup-team-1961:player-17785', 'lineup-team-1961:player-928134', 'lineup-team-1999:player-111111'],
        playerStatKeys: [
          'player-17785:totalPass', 'player-17785:accuratePass', 'player-17785:saves', 'player-17785:minutesPlayed',
          'player-17785:rating', 'player-17785:expectedAssists', 'player-17785:goalsPrevented',
          'player-17785:ratingVersions', 'player-17785:statisticsType',
          'player-928134:totalPass', 'player-928134:accuratePass', 'player-928134:minutesPlayed', 'player-928134:rating',
          'player-111111:minutesPlayed', 'player-111111:rating',
        ],
        teamStatKeys: [
          'ALL:Match overview:ballPossession', 'ALL:Match overview:totalShotsOnGoal',
          'ALL:Match overview:expectedGoals', 'ALL:Match overview:redCards',
          'ALL:Shots:totalShotsOnGoal', 'ALL:Shots:expectedGoals',
        ],
      },
    });
    const result = await persistMatchEnrichment(fake.tx, {
      fixtureProviderId: '15237975', lineupsPayload: LINEUPS, statisticsPayload: STATS, retrievedAt: RETRIEVED_AT,
    });
    const pstat = result.byRelation.get('football.player_match_statistic')!;
    assert.equal(pstat.inserted, 0, 'no new player-stat rows on the second run');
    assert.equal(pstat.updated, 15, 'every player-stat row lands on an existing row');
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
// SOURCE-LEVEL GUARANTEES — the alias and the 503 endpoint are never reached,
// and no appearance/match_event write exists in the stage at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('match enrichment — endpoints and relations by construction', () => {
  const stageSrc = readFileSync(resolve(__dirname, '..', 'stages', 'matchEnrichment.ts'), 'utf8');
  const pipelineSrc = readFileSync(resolve(__dirname, '..', 'pipeline.ts'), 'utf8');

  test('the stage writes neither appearance nor match_event', () => {
    // A write target is a quoted relation literal handed to upsertMutable; the
    // header comment names both tables in prose to say they are OUT of scope, so
    // the check is for the write-target string, not the words.
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
