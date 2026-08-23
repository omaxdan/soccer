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

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

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
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18'), { kind: 'notFound' });
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

  it('unknown path → 404 not_found; POST → 405; invalid id → 400', async () => {
    assert.equal((await fetch(`${base}/api/v2/teams/1`)).status, 404);
    assert.equal((await fetch(`${base}/api/v2/matches/18`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/api/v2/matches/abc`)).status, 400);
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
  let subjectAB = '', bareCD = '';
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
  });

  it('GET the edition list → 200 including the seeded edition with its fixture count', async () => {
    const body = await (await fetch(`${base}/api/v2/editions`)).json() as any;
    const mine = body.editions.find((e: any) => e.id === editionId);
    assert.ok(mine, 'the seeded edition appears in the list');
    assert.equal(mine.competition.name, 'B2 League');
    assert.ok(mine.fixtureCount >= 4, 'reports its materialized fixture count');
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
