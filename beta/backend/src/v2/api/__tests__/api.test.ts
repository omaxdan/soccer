// V2 READ API TESTS (Phase B.2).
//
// DB-free: id validation, pure routing, the intelligence null-mapping, and the
// HTTP layer end-to-end against INJECTED fake data seams (no database) — proving
// status codes, not-found/method/invalid-id semantics, and that the API issues no
// writes of its own.
//
// DB-gated (skip without PT_V2_DB_*): a real isolated fixture/edition persisted in
// a migrated PG16, with real module readings produced by the production module
// functions (module.module_reading is NOT mocked), retrieved THROUGH the real HTTP
// server. Proves DB → V2 read surfaces → HTTP → JSON for a real match and edition.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';

import { resolveRoute, createServer, type ApiDeps } from '../server';
import { isValidId, mapIntelligence, mapTeamFeatures } from '../handlers';
import type { TeamFeatureValue } from '../../feature/read/currentValues';
import type { TeamModuleReading } from '../../module/read/readings';
import type { ReadingEvidence } from '../../module/read/evidence';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

// module-write path (real production functions), mirroring B.1's authentic recipe
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { COMPETITION_SCOPED_CONTEXT_KIND, ALL_COMPETITIONS_SCOPE, type CalculationScope } from '../../feature/calculators/types';
import { fromInt } from '../../feature/write/scale';
import { homeAwaySplit } from '../../module/calculators/homeAwaySplit';
import { readinessTracker } from '../../module/calculators/readinessTracker';
import { assembleReading } from '../../module/pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../../module/registry/load';
import { readConsumedFeatures, consumedKey } from '../../module/read/consumedFeatures';
import { writeReading } from '../../module/write/readings';
import type { ModuleCalculator } from '../../module/types';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const stop = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE
// ─────────────────────────────────────────────────────────────────────────────
describe('v2 api · id validation and routing', () => {
  test('isValidId accepts bigints, rejects the rest', () => {
    for (const ok of ['1', '18', '999999999']) assert.equal(isValidId(ok), true, ok);
    for (const bad of ['', '0', '-1', 'abc', '1.5', '1e3', "1;DROP", '01']) assert.equal(isValidId(bad), false, bad);
  });

  test('resolveRoute maps method + path to intent', () => {
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18'), { kind: 'match', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/42/fixtures'), { kind: 'editionFixtures', id: '42' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions'), { kind: 'editionList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams'), { kind: 'teamList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18'), { kind: 'team', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/players'), { kind: 'playerList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/players/9'), { kind: 'player', id: '9' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/coaches/18'), { kind: 'notFound' });
    assert.deepEqual(resolveRoute('GET', '/'), { kind: 'notFound' });
  });
});

describe('v2 api · intelligence mapping (missing readings → null, never fabricated)', () => {
  const reading = (teamId: string, moduleKey: string): TeamModuleReading => ({
    moduleKey, teamId, contextKindCode: moduleKey === 'home_away_split' ? 'COMPETITION_SCOPED' : 'ALL_COMPETITIONS',
    contextCompetitionEditionId: moduleKey === 'home_away_split' ? '42' : null,
    asOf: new Date('2027-06-01T00:00:00Z'), calculatedAt: new Date('2027-06-01T00:00:00Z'),
    moduleStatusCode: 'SUPPORTS', strength: null, confidence: null, sampleObservationCount: 6,
    sampleMeetsThreshold: true, verdictText: 'v', inactiveReason: null,
  });

  test('present readings map; absent ones are null', () => {
    const readings = [reading('10', 'readiness_tracker'), reading('10', 'home_away_split'), reading('11', 'readiness_tracker')];
    const out = mapIntelligence(readings, '10', '11');
    assert.equal(out.home.readiness?.moduleKey, 'readiness_tracker');
    assert.equal(out.home.homeAwaySplit?.moduleKey, 'home_away_split');
    assert.equal(out.away.readiness?.moduleKey, 'readiness_tracker');
    assert.equal(out.away.homeAwaySplit, null, 'away has no home_away_split → null, not a fabricated default');
  });

  test('no readings at all → all null', () => {
    const out = mapIntelligence([], '10', '11');
    assert.deepEqual(out, { home: { readiness: null, homeAwaySplit: null }, away: { readiness: null, homeAwaySplit: null } });
  });

  test('a reading with no evidence carries evidence: null (never fabricated)', () => {
    const out = mapIntelligence([reading('10', 'readiness_tracker')], '10', '11');
    assert.equal(out.home.readiness?.evidence, null);
  });
});

describe('v2 api · evidence attachment (persisted evidence → the matching reading only)', () => {
  const reading = (teamId: string, moduleKey: string): TeamModuleReading => ({
    moduleKey, teamId, contextKindCode: moduleKey === 'home_away_split' ? 'COMPETITION_SCOPED' : 'ALL_COMPETITIONS',
    contextCompetitionEditionId: moduleKey === 'home_away_split' ? '42' : null,
    asOf: new Date('2027-06-01T00:00:00Z'), calculatedAt: new Date('2027-06-01T00:00:00Z'),
    moduleStatusCode: 'SUPPORTS', strength: null, confidence: null, sampleObservationCount: 10,
    sampleMeetsThreshold: true, verdictText: 'v', inactiveReason: null,
  });
  const evidence = (teamId: string, moduleKey: string): ReadingEvidence => ({
    moduleKey, teamId, contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null,
    declaredInputCount: 1, presentInputCount: 1, belowThresholdInputCount: 0, estimatedInputCount: 0,
    items: [{ featureKey: 'team.momentum', displayName: 'Momentum', value: 15, asOf: new Date('2027-06-01T00:00:00Z'), contributionDirection: 'SUPPORTS' }],
  });

  test('evidence attaches to its own (team, module) reading and to no other', () => {
    const out = mapIntelligence(
      [reading('10', 'readiness_tracker'), reading('11', 'readiness_tracker')],
      '10', '11',
      [evidence('10', 'readiness_tracker')]
    );
    assert.equal(out.home.readiness?.evidence?.items[0].value, 15);
    assert.equal(out.home.readiness?.evidence?.items[0].contributionDirection, 'SUPPORTS');
    assert.equal(out.away.readiness?.evidence, null, 'team 11 has no evidence → null, not team 10’s');
  });

  test('a zero count survives projection (present 0 of 2 is not treated as absent)', () => {
    const zero: ReadingEvidence = { ...evidence('10', 'readiness_tracker'), declaredInputCount: 2, presentInputCount: 0, items: [] };
    const out = mapIntelligence([reading('10', 'readiness_tracker')], '10', '11', [zero]);
    assert.equal(out.home.readiness?.evidence?.presentInputCount, 0);
    assert.equal(out.home.readiness?.evidence?.declaredInputCount, 2);
  });
});

describe('v2 api · team-feature mapping (missing values → null, never fabricated)', () => {
  const fv = (teamId: string, featureKey: string, value: number): TeamFeatureValue => ({
    featureKey, teamId, contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null,
    value, sampleObservationCount: 8, sampleMeetsThreshold: true, asOf: new Date('2027-06-01T00:00:00Z'),
  });

  test('present features map to the named slots; absent ones are null', () => {
    const values = [fv('10', 'team.home_form', 73), fv('10', 'team.momentum', 15), fv('11', 'team.rest_advantage', 4)];
    const out = mapTeamFeatures(values, '10', '11');
    assert.equal(out.home.homeForm?.value, 73);
    assert.equal(out.home.momentum?.value, 15);
    assert.equal(out.home.awayForm, null, 'no away_form for home team → null');
    assert.equal(out.home.rest, null);
    assert.equal(out.home.congestion, null);
    assert.equal(out.away.rest?.value, 4);
    assert.equal(out.away.homeForm, null);
  });

  test('a zero value is preserved, not treated as missing', () => {
    const out = mapTeamFeatures([fv('10', 'team.momentum', 0)], '10', '11');
    assert.equal(out.home.momentum?.value, 0);
    assert.notEqual(out.home.momentum, null);
  });

  test('no values at all → every slot null', () => {
    const out = mapTeamFeatures([], '10', '11');
    assert.deepEqual(out, {
      home: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null },
      away: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null },
    });
  });
});

describe('v2 api · HTTP layer over injected seams (no database)', () => {
  let server: Server;
  let base = '';
  let matchCalls: string[] = [];
  let editionCalls: string[] = [];

  before(async () => {
    const deps: ApiDeps = {
      getMatch: async (id) => { matchCalls.push(id); return id === '18' ? { match: { fixtureId: '18' } } : null; },
      getEdition: async (id) => { editionCalls.push(id); return id === '42' ? { edition: { id: '42' }, fixtures: [] } : null; },
      getEditions: async () => ({ editions: [{ id: '42', seasonLabel: 'S', competition: { id: '1', name: 'L', slug: 'l' }, fixtureCount: 3 }] }),
      getTeams: async () => ({ teams: [{ id: '7', name: 'T', slug: 't', shortName: null, countryCode: null }] }),
      getTeam: async (id) => (id === '7' ? { team: { id: '7' } } : null),
      getPlayers: async () => ({ players: [{ id: '9', fullName: 'P', shortName: null, slug: 'p', team: null }] }),
      getPlayer: async (id) => (id === '9' ? { player: { id: '9' } } : null),
    };
    server = createServer(deps);
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  after(async () => { await stop(server); });

  it('GET a known match → 200 with the body', async () => {
    const res = await fetch(`${base}/api/v2/matches/18`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.deepEqual(await res.json(), { match: { fixtureId: '18' } });
  });

  it('GET an unknown match → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known edition fixtures → 200', async () => {
    const res = await fetch(`${base}/api/v2/editions/42/fixtures`);
    assert.equal(res.status, 200);
    assert.equal((await res.json() as any).edition.id, '42');
  });

  it('GET an unknown edition → 404 edition_not_found', async () => {
    const res = await fetch(`${base}/api/v2/editions/43/fixtures`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'edition_not_found' });
  });

  it('GET the edition list → 200 with editions', async () => {
    const res = await fetch(`${base}/api/v2/editions`);
    assert.equal(res.status, 200);
    assert.equal((await res.json() as any).editions[0].id, '42');
  });

  it('GET the team list → 200; known team → 200; unknown team → 404', async () => {
    assert.equal((await fetch(`${base}/api/v2/teams`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/v2/teams`)).json() as any).teams[0].id, '7');
    assert.equal((await fetch(`${base}/api/v2/teams/7`)).status, 200);
    const miss = await fetch(`${base}/api/v2/teams/8`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'team_not_found' });
  });

  it('GET the player list → 200; known player → 200; unknown player → 404', async () => {
    assert.equal((await fetch(`${base}/api/v2/players`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/v2/players`)).json() as any).players[0].id, '9');
    assert.equal((await fetch(`${base}/api/v2/players/9`)).status, 200);
    const miss = await fetch(`${base}/api/v2/players/8`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'player_not_found' });
  });

  it('unknown path → 404 not_found; POST → 405; invalid id → 400', async () => {
    assert.equal((await fetch(`${base}/api/v2/coaches/1`)).status, 404);
    assert.equal((await fetch(`${base}/api/v2/matches/18`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/api/v2/matches/abc`)).status, 400);
    assert.equal((await fetch(`${base}/api/v2/teams/abc`)).status, 400);
    assert.equal((await fetch(`${base}/api/v2/players/abc`)).status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED
// ─────────────────────────────────────────────────────────────────────────────
describe('v2 api · real match/edition through HTTP (requires a V2 database)', { skip: !hasDatabase }, () => {
  const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
  const FEATURE_ROLE = 'pt_pipeline_feature' as const;
  const MODULE_ROLE = 'pt_pipeline_module' as const;
  const ADMIN_ROLE = 'pt_platform_admin' as const;
  const TAG = String(Date.now() % 1_000_000);
  const AS_OF = new Date(Date.UTC(2027, 5, 10) + (Date.now() % 5_000_000) * 60_000); // features/readings, unique
  const KICKOFF = new Date(AS_OF.getTime() + 5 * 86_400_000);   // subject kickoff, after AS_OF
  const HIST1 = new Date(AS_OF.getTime() - 20 * 86_400_000);
  const HIST2 = new Date(AS_OF.getTime() - 10 * 86_400_000);

  let editionId = '', teamA = '', teamB = '', teamC = '', teamD = '';
  let subjectAB = '', bareCD = '', postponedAB = '', playerX = '';
  // A second, materialized edition that is deliberately NOT governed-authorized —
  // it must never appear in Day-1 edition navigation (PD-D1.1).
  let unauthEditionId = '';
  let server: Server;
  let base = '';

  const iso = (d: Date) => d.toISOString();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const scoped = (ed: string): CalculationScope => ({ contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: ed });

  async function team(tx: PoolClient, s: string): Promise<string> {
    return (await tx.query<{ id: string }>(
      `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
       VALUES ('SPORTSAPI_API',$1,$2,$3) ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name
       RETURNING id::text`, [`B2-T${s}-${TAG}`, `B2 Team ${s}`, `b2-team-${s}-${TAG}`])).rows[0].id;
  }
  async function fixture(tx: PoolClient, ext: string, home: string, away: string, when: Date, state: string): Promise<string> {
    const f = await tx.query<{ id: string }>(
      `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
                                     is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
       VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,$7)
       ON CONFLICT (provider_code, provider_external_id, fixture_partition_on) DO UPDATE SET lifecycle_state_code=EXCLUDED.lifecycle_state_code
       RETURNING id::text`, [`B2-F${ext}-${TAG}`, day(when), editionId, home, away, iso(when), state]);
    return f.rows[0].id;
  }
  async function result(tx: PoolClient, fixtureId: string, when: Date, hg: number, ag: number): Promise<void> {
    await tx.query(
      `INSERT INTO football.result (fixture_id, fixture_partition_on, home_goals, away_goals, confirmed_at)
       VALUES ($1,$2::date,$3,$4,$5) ON CONFLICT (fixture_partition_on, fixture_id) DO NOTHING`,
      [fixtureId, day(when), hg, ag, iso(when)]);
  }
  async function produceReading(tx: PoolClient, moduleKey: string, calc: ModuleCalculator, teamId: string, scope: CalculationScope): Promise<void> {
    const registry = await loadModuleRegistry(tx);
    const def = registry.definitionsByKey.get(moduleKey)!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
    const consumed = await readConsumedFeatures(tx, calc.inputFeatureKeys, [teamId], AS_OF, scope);
    const inputs = new Map();
    for (const k of calc.inputFeatureKeys) { const v = consumed.get(consumedKey(k, teamId)); if (v) inputs.set(k, v); }
    const reading = assembleReading({ calculator: calc, definition: def, version: version!, asOf: AS_OF, scope, teamId, inputs });
    await writeReading(tx, { ...reading, calculatedAt: AS_OF });
  }

  before(async () => {
    await withConnection(INGESTION_ROLE, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'B2 League',$2,'GB') ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name
         RETURNING id::text`, [`B2-COMP-${TAG}`, `b2-league-${TAG}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'B2 2026', daterange('2026-01-01','2028-01-01')) ON CONFLICT (provider_external_id) DO UPDATE SET season_label=EXCLUDED.season_label
         RETURNING id::text`, [comp.rows[0].id, `B2-S-${TAG}`]);
      editionId = ed.rows[0].id;
      teamA = await team(tx, 'A'); teamB = await team(tx, 'B'); teamC = await team(tx, 'C'); teamD = await team(tx, 'D');
      // Recent completed history for A & B, before the subject kickoff.
      const h1 = await fixture(tx, 'H1', teamA, teamB, HIST1, 'COMPLETED'); await result(tx, h1, HIST1, 2, 0);
      const h2 = await fixture(tx, 'H2', teamB, teamA, HIST2, 'COMPLETED'); await result(tx, h2, HIST2, 1, 1);
      // Subject SCHEDULED fixture A vs B; a bare SCHEDULED fixture C vs D (no readings, no history).
      subjectAB = await fixture(tx, 'SAB', teamA, teamB, KICKOFF, 'SCHEDULED');
      bareCD = await fixture(tx, 'SCD', teamC, teamD, KICKOFF, 'SCHEDULED');
      // A POSTPONED fixture in the SAME edition — PD-D1.2 keeps non-playable
      // lifecycle states visible in edition navigation (exposure ≠ eligibility).
      postponedAB = await fixture(tx, 'PAB', teamA, teamB, new Date(KICKOFF.getTime() + 86_400_000), 'POSTPONED');

      // Team & player registrations for the governed edition — the substrate the
      // /teams and /players surfaces read (registration_period @> current_date).
      for (const t of [teamA, teamB]) {
        await tx.query(
          `INSERT INTO football.team_registration (team_id, competition_edition_id, registered_on)
           VALUES ($1,$2,'2026-01-01') ON CONFLICT (team_id, competition_edition_id) DO NOTHING`,
          [t, editionId]);
      }
      const pl = await tx.query<{ id: string }>(
        `INSERT INTO football.player (provider_code, provider_external_id, full_name, slug, nationality_code, height_cm, preferred_foot, date_of_birth)
         VALUES ('SPORTSAPI_API',$1,'B2 Player X',$2,'GB',182,'RIGHT','1998-01-01')
         ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET full_name=EXCLUDED.full_name
         RETURNING id::text`, [`B2-PX-${TAG}`, `b2-player-x-${TAG}`]);
      playerX = pl.rows[0].id;
      await tx.query(
        `INSERT INTO football.player_registration
           (player_id, team_id, registration_kind_code, competition_edition_id, registration_period, provenance_class_code)
         VALUES ($1,$2,'PERMANENT',$3, daterange('2020-01-01', NULL), 'OBSERVED')
         ON CONFLICT DO NOTHING`,
        [playerX, teamA, editionId]);

      // A second edition under the same competition, with one fixture, left
      // GOVERNED-UNAUTHORIZED — the negative case for Day-1 exposure (PD-D1.1).
      const ed2 = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'B2 2025', daterange('2024-01-01','2026-01-01')) ON CONFLICT (provider_external_id) DO UPDATE SET season_label=EXCLUDED.season_label
         RETURNING id::text`, [comp.rows[0].id, `B2-S2-${TAG}`]);
      unauthEditionId = ed2.rows[0].id;
      await tx.query(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
                                       is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED')
         ON CONFLICT (provider_code, provider_external_id, fixture_partition_on) DO NOTHING`,
        [`B2-F-UNAUTH-${TAG}`, day(KICKOFF), unauthEditionId, teamC, teamD, iso(KICKOFF)]);
    });

    // Day-1 governed exposure (PD-D1.1): authorize ONLY editionId — a TRACKED
    // competition with an ACTIVE, authorized tracked_edition linked to it. The
    // second edition is intentionally left un-authorized. Governance writes use the
    // admin role (SIU on governance; migration 025).
    await withConnection(ADMIN_ROLE, async (tx) => {
      const tc = await tx.query<{ id: string }>(
        `INSERT INTO governance.tracked_competition
           (provider_code, provider_external_id, competition_type_code, competition_scope_code, tracking_status_code)
         VALUES ('SPORTSAPI_API',$1,'LEAGUE','DOMESTIC','TRACKED')
         ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET tracking_status_code='TRACKED'
         RETURNING id::text`, [`B2-GOVCOMP-${TAG}`]);
      await tx.query(
        `INSERT INTO governance.tracked_edition
           (tracked_competition_id, provider_season_external_id, edition_status_code,
            authorized_for_ingestion, season_period, competition_edition_id)
         VALUES ($1,$2,'ACTIVE',true, daterange('2026-01-01','2028-01-01'), $3)
         ON CONFLICT (tracked_competition_id, provider_season_external_id)
           DO UPDATE SET edition_status_code='ACTIVE', authorized_for_ingestion=true,
                         competition_edition_id=EXCLUDED.competition_edition_id`,
        [tc.rows[0].id, `B2-GOVSEASON-${TAG}`, editionId]);
    });
    // Feature values for A & B at AS_OF (real writer), then readings via production path.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      await writeValues(tx, registry, [
        { featureKey: 'team.home_win_rate', teamId: teamA, asOf: AS_OF, value: fromInt(80), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_win_rate', teamId: teamA, asOf: AS_OF, value: fromInt(20), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.home_win_rate', teamId: teamB, asOf: AS_OF, value: fromInt(55), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_win_rate', teamId: teamB, asOf: AS_OF, value: fromInt(45), sampleObservationCount: 8, consumed: [] },
      ], AS_OF, scoped(editionId));
      await writeValues(tx, registry, [
        { featureKey: 'team.momentum', teamId: teamA, asOf: AS_OF, value: fromInt(15), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.momentum', teamId: teamB, asOf: AS_OF, value: fromInt(-5), sampleObservationCount: 8, consumed: [] },
        // Team Intelligence panel features (ALL_COMPETITIONS). teamB omits congestion → null in the panel.
        { featureKey: 'team.home_form', teamId: teamA, asOf: AS_OF, value: fromInt(73), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_form', teamId: teamA, asOf: AS_OF, value: fromInt(41), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.rest_advantage', teamId: teamA, asOf: AS_OF, value: fromInt(6), sampleObservationCount: 1, consumed: [] },
        { featureKey: 'team.congestion_index', teamId: teamA, asOf: AS_OF, value: fromInt(20), sampleObservationCount: 3, consumed: [] },
        { featureKey: 'team.home_form', teamId: teamB, asOf: AS_OF, value: fromInt(55), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_form', teamId: teamB, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.rest_advantage', teamId: teamB, asOf: AS_OF, value: fromInt(3), sampleObservationCount: 1, consumed: [] },
      ], AS_OF);
    });
    await withConnection(MODULE_ROLE, async (tx) => {
      for (const t of [teamA, teamB]) {
        await produceReading(tx, 'home_away_split', homeAwaySplit, t, scoped(editionId));
        await produceReading(tx, 'readiness_tracker', readinessTracker, t, ALL_COMPETITIONS_SCOPE);
      }
    });
    server = createServer();               // real production data seams
    base = `http://127.0.0.1:${await listen(server)}`;
  });

  after(async () => { await stop(server); await closeAllPools(); });

  const countRows = () => withConnection(ADMIN_ROLE, async (tx) => {
    const mr = await tx.query<{ n: string }>(`SELECT count(*)::text n FROM module.module_reading`);
    const fx = await tx.query<{ n: string }>(`SELECT count(*)::text n FROM football.fixture`);
    return { readings: Number(mr.rows[0].n), fixtures: Number(fx.rows[0].n) };
  });

  it('GET a real match → 200 with correct header, form, and both teams intelligence', async () => {
    const res = await fetch(`${base}/api/v2/matches/${subjectAB}`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    // header from persisted V2 data
    assert.equal(body.match.fixtureId, subjectAB);
    assert.equal(body.match.status, 'SCHEDULED');
    assert.equal(body.match.kickoffAt, KICKOFF.toISOString());
    assert.equal(body.match.homeTeam.id, teamA);
    assert.equal(body.match.awayTeam.id, teamB);
    assert.equal(body.match.competition.name, 'B2 League');
    assert.equal(body.match.edition.id, editionId);
    assert.equal(body.match.score, null, 'a scheduled fixture has no score');
    // recent form from persisted completed fixtures (each team played the 2 history games)
    assert.equal(body.form.home.length, 2, 'team A form');
    assert.equal(body.form.away.length, 2, 'team B form');
    assert.ok(body.form.home.every((f: any) => typeof f.goalsFor === 'number'));
    // intelligence: both active modules for both teams
    assert.equal(body.intelligence.home.readiness.moduleKey, 'readiness_tracker');
    assert.equal(body.intelligence.home.homeAwaySplit.moduleKey, 'home_away_split');
    assert.equal(body.intelligence.away.readiness.moduleKey, 'readiness_tracker');
    assert.equal(body.intelligence.away.homeAwaySplit.moduleKey, 'home_away_split');
    // scope: readiness ALL_COMPETITIONS (verified by presence for the team); home_away split reflects A's 80/20
    assert.equal(body.intelligence.home.homeAwaySplit.status, 'SUPPORTS');
    // TEAM FEATURES panel — persisted values surfaced per team, missing ones null.
    assert.equal(body.teamFeatures.home.homeForm.value, 73);
    assert.equal(body.teamFeatures.home.awayForm.value, 41);
    assert.equal(body.teamFeatures.home.momentum.value, 15);
    assert.equal(body.teamFeatures.home.rest.value, 6);
    assert.equal(body.teamFeatures.home.congestion.value, 20);
    assert.equal(body.teamFeatures.away.momentum.value, -5, 'negative value preserved');
    assert.equal(body.teamFeatures.away.congestion, null, 'team B has no congestion value → null, not zero');
    // EVIDENCE — the persisted explainability substrate behind each engaged reading.
    const ha = body.intelligence.home.homeAwaySplit.evidence;
    assert.ok(ha, 'home_away_split carries persisted evidence');
    assert.equal(ha.declaredInputCount, 2);
    assert.equal(ha.presentInputCount, 2);
    assert.equal(ha.items.length, 2, 'two cited win-rate values');
    assert.ok(ha.items.every((i: any) => i.contributionDirection === 'SUPPORTS'), 'A’s 80/20 disparity → SUPPORTS');
    assert.deepEqual(ha.items.map((i: any) => i.value).sort((x: number, y: number) => x - y), [20, 80]);
    assert.ok(ha.items.every((i: any) => typeof i.featureKey === 'string' && typeof i.displayName === 'string'));
    const rt = body.intelligence.home.readiness.evidence;
    assert.ok(rt, 'readiness_tracker carries persisted evidence');
    assert.equal(rt.items.length, 1, 'one cited momentum value');
    assert.equal(rt.items[0].value, 15);
    assert.equal(rt.items[0].contributionDirection, 'SUPPORTS');
  });

  it('Recent Venue Form (PD-11): venue-split, enriched, strictly before kickoff', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/${subjectAB}`)).json() as any;
    const rvf = body.recentVenueForm;
    assert.ok(rvf, 'recentVenueForm present');

    // History: H1 = A(home) vs B(away), H2 = B(home) vs A(away). Split by venue side.
    // Team A: one home fixture (H1), one away fixture (H2).
    assert.equal(rvf.home.lastHome.length, 1, 'A last-5-home has the one home fixture');
    assert.equal(rvf.home.lastAway.length, 1, 'A last-5-away has the one away fixture');
    assert.ok(rvf.home.lastHome.every((r: any) => r.isHome === true));
    assert.ok(rvf.home.lastAway.every((r: any) => r.isHome === false));
    // Team B: mirror — one home fixture (H2), one away fixture (H1).
    assert.equal(rvf.away.lastHome.length, 1, 'B last-5-home has the one home fixture');
    assert.equal(rvf.away.lastAway.length, 1, 'B last-5-away has the one away fixture');

    // Enrichment: opponent, competition, venue (null here — fixtures seeded without a venue).
    const aHome = rvf.home.lastHome[0];
    assert.equal(aHome.opponent.id, teamB, 'A’s home-fixture opponent is B');
    assert.equal(aHome.competition.name, 'B2 League');
    assert.equal(aHome.venueName, null, 'no venue seeded → honest null, never fabricated');
    assert.ok('goalsFor' in aHome && 'goalsAgainst' in aHome, 'subject-oriented goals present for W/D/L derivation');
    assert.equal(aHome.result, undefined, 'no server-side W/D/L — derivation is presentation-only');

    // Temporal safety (PD-7): the subject fixture is strictly excluded from its own context.
    const allIds = [
      ...rvf.home.lastHome, ...rvf.home.lastAway, ...rvf.away.lastHome, ...rvf.away.lastAway,
    ].map((r: any) => r.fixtureId);
    assert.ok(!allIds.includes(subjectAB), 'the current fixture never appears in its own venue form');
    assert.ok(allIds.every((id: string) => id !== null));
  });

  it('home_away_split respects the competition-edition scope; readiness is ALL_COMPETITIONS', async () => {
    // Correspondence with the persisted row for the requested edition.
    const [surfaceStatus, direct] = await withConnection(MODULE_ROLE, async (tx) => {
      const d = await tx.query<{ status: string; ctx: string | null }>(
        `SELECT mr.module_status_code status, mr.context_competition_edition_id::text ctx
           FROM module.module_reading mr JOIN module.module_definition md ON md.id=mr.module_definition_id
          WHERE md.module_key='home_away_split' AND mr.subject_team_id=$1 AND mr.context_competition_edition_id=$2
          ORDER BY mr.as_of DESC LIMIT 1`, [teamA, editionId]);
      return [d.rows[0].status, d.rows[0].ctx];
    });
    const body = await (await fetch(`${base}/api/v2/matches/${subjectAB}`)).json() as any;
    assert.equal(body.intelligence.home.homeAwaySplit.status, surfaceStatus);
    assert.equal(direct, editionId, 'the home_away reading is scoped to this edition');
    assert.equal(body.intelligence.home.readiness.moduleKey, 'readiness_tracker');
  });

  it('a match whose teams have no readings → intelligence null (never fabricated), form empty', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/${bareCD}`)).json() as any;
    assert.equal(body.match.fixtureId, bareCD);
    assert.deepEqual(body.intelligence.home, { readiness: null, homeAwaySplit: null });
    assert.deepEqual(body.intelligence.away, { readiness: null, homeAwaySplit: null });
    assert.equal(body.form.home.length, 0);
    assert.equal(body.form.away.length, 0);
    // No completed history → both venue-form sides empty for both teams (never fabricated).
    assert.deepEqual(body.recentVenueForm.home, { lastHome: [], lastAway: [] });
    assert.deepEqual(body.recentVenueForm.away, { lastHome: [], lastAway: [] });
    // No feature values for these teams → every panel slot null (never fabricated).
    assert.deepEqual(body.teamFeatures.home, { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null });
    assert.deepEqual(body.teamFeatures.away, { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null });
  });

  it('GET the edition fixtures → 200 with every fixture, teams, status and score', async () => {
    const body = await (await fetch(`${base}/api/v2/editions/${editionId}/fixtures`)).json() as any;
    assert.equal(body.edition.id, editionId);
    assert.equal(body.edition.competition.name, 'B2 League');
    const ids = body.fixtures.map((f: any) => f.fixtureId);
    for (const id of [subjectAB, bareCD]) assert.ok(ids.includes(id), `edition list includes ${id}`);
    const completed = body.fixtures.find((f: any) => f.score !== null);
    assert.ok(completed, 'a completed fixture carries a score');
    assert.ok(body.fixtures.every((f: any) => f.homeTeam.id && f.awayTeam.id && f.status));
    // PD-D1.2: non-playable lifecycle states stay visible with their real status.
    const postponed = body.fixtures.find((f: any) => f.fixtureId === postponedAB);
    assert.ok(postponed, 'the postponed fixture remains visible in edition navigation');
    assert.equal(postponed.status, 'POSTPONED', 'its real lifecycle status is shown, not hidden');
  });

  it('GET the edition list → 200 including the authorized edition, excluding the unauthorized one (PD-D1.1)', async () => {
    const body = await (await fetch(`${base}/api/v2/editions`)).json() as any;
    const mine = body.editions.find((e: any) => e.id === editionId);
    assert.ok(mine, 'the authorized (ACTIVE, TRACKED) edition appears in the list');
    assert.equal(mine.competition.name, 'B2 League');
    assert.ok(mine.fixtureCount >= 4, 'reports its materialized fixture count');
    // The un-authorized edition is materialized with a fixture but must not surface.
    assert.equal(body.editions.find((e: any) => e.id === unauthEditionId), undefined,
      'an un-authorized ingested edition is NOT exposed in Day-1 navigation');
  });

  it('GET fixtures for an un-authorized edition → 404 (PD-D1.1 direct-URL guard)', async () => {
    const res = await fetch(`${base}/api/v2/editions/${unauthEditionId}/fixtures`);
    assert.equal(res.status, 404, 'a governed-unauthorized edition is not reachable by direct URL');
    assert.deepEqual(await res.json(), { error: 'edition_not_found' });
  });

  it('Teams: list is governed-scoped; detail carries identity, competitions, squad, results', async () => {
    const list = await (await fetch(`${base}/api/v2/teams`)).json() as any;
    const ids = list.teams.map((t: any) => t.id);
    assert.ok(ids.includes(teamA) && ids.includes(teamB), 'registered teams appear');
    assert.ok(!ids.includes(teamC) && !ids.includes(teamD), 'teams with no governed registration are excluded');
    assert.ok(list.teams.every((t: any) => t.id && t.name && t.slug), 'identity fields present');

    const detail = await (await fetch(`${base}/api/v2/teams/${teamA}`)).json() as any;
    assert.equal(detail.team.id, teamA);
    assert.ok(detail.competitions.some((c: any) => c.editionId === editionId && c.competition.name === 'B2 League'));
    assert.ok(detail.squad.some((p: any) => p.id === playerX), 'current squad includes the registered player');
    assert.equal(detail.recentResults.length, 2, 'team A has two completed results (H1, H2)');
    assert.ok(detail.recentResults.every((r: any) => r.opponent.id && typeof r.isHome === 'boolean'));
  });

  it('GET a team with no governed registration → 404 (governed exposure gate)', async () => {
    const res = await fetch(`${base}/api/v2/teams/${teamC}`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'team_not_found' });
  });

  it('Players: directory is governed-scoped; detail carries biography + current team', async () => {
    const list = await (await fetch(`${base}/api/v2/players`)).json() as any;
    const mine = list.players.find((p: any) => p.id === playerX);
    assert.ok(mine, 'the registered player appears in the directory');
    assert.equal(mine.team.id, teamA, 'directory row carries the current team');

    const detail = await (await fetch(`${base}/api/v2/players/${playerX}`)).json() as any;
    assert.equal(detail.player.id, playerX);
    assert.equal(detail.player.fullName, 'B2 Player X');
    assert.equal(detail.currentTeam.id, teamA);
    assert.equal(detail.competition.name, 'B2 League');
  });

  it('GET a non-existent player → 404', async () => {
    const res = await fetch(`${base}/api/v2/players/999999999`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'player_not_found' });
  });

  it('unknown match id → 404; unknown edition id → 404', async () => {
    assert.equal((await fetch(`${base}/api/v2/matches/999999999`)).status, 404);
    assert.equal((await fetch(`${base}/api/v2/editions/999999999/fixtures`)).status, 404);
  });

  it('the API performs no writes', async () => {
    const before = await countRows();
    await fetch(`${base}/api/v2/matches/${subjectAB}`);
    await fetch(`${base}/api/v2/editions/${editionId}/fixtures`);
    const afterCounts = await countRows();
    assert.deepEqual(afterCounts, before, 'reading the API changed no rows');
  });
});
