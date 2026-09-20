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
import { isValidId, mapIntelligence, mapTeamFeatures, toFixtureReadingDto } from '../handlers';
import type { FixtureModuleReading } from '../../module/read/fixtureReadings';
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
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/intelligence'), { kind: 'matchIntelligence', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/lineups'), { kind: 'matchLineups', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/lineups'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/lineups'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/team-statistics'), { kind: 'matchTeamStatistics', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/team-statistics'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/team-statistics'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/result'), { kind: 'matchResult', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/result'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/result'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/lifecycle'), { kind: 'matchLifecycle', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/lifecycle'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/lifecycle'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/18/venue'), { kind: 'matchVenue', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/venue'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/venue'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/matches/abc/intelligence'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/matches/18/intelligence'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/42/fixtures'), { kind: 'editionFixtures', id: '42' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/42/standings'), { kind: 'editionStandings', id: '42' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/18'), { kind: 'edition', id: '18' });          // bare edition entity
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/editions/18'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions/abc/standings'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/editions/42/standings'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/editions'), { kind: 'editionList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams'), { kind: 'teamList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18'), { kind: 'team', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18/performance'), { kind: 'teamPerformance', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/abc/performance'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/teams/18/performance'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18/readiness'), { kind: 'teamReadiness', id: '18' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/abc/readiness'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/teams/18/readiness'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/players'), { kind: 'playerList' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/players/9'), { kind: 'player', id: '9' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/venues/25'), { kind: 'venue', id: '25' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/venues/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/venues/25'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/countries/BR'), { kind: 'country', code: 'BR' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/countries/br'), { kind: 'country', code: 'BR' }); // case-normalized
    assert.deepEqual(resolveRoute('GET', '/api/v2/countries/BRA'), { kind: 'badRequest' });         // alpha-3 not accepted
    assert.deepEqual(resolveRoute('GET', '/api/v2/countries/1'), { kind: 'badRequest' });           // not a numeric id route
    assert.deepEqual(resolveRoute('POST', '/api/v2/countries/BR'), { kind: 'methodNotAllowed' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/competitions/28'), { kind: 'competition', id: '28' });
    assert.deepEqual(resolveRoute('GET', '/api/v2/competitions/abc'), { kind: 'badRequest' });
    assert.deepEqual(resolveRoute('POST', '/api/v2/competitions/28'), { kind: 'methodNotAllowed' });
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
    direction: featureKey === 'team.congestion_index' ? 'LOWER_IS_STRONGER' : 'HIGHER_IS_STRONGER',
    unit: featureKey === 'team.rest_advantage' ? 'days' : 'index',
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

  test('governed direction + unit are carried through to the DTO verbatim (not re-derived)', () => {
    const out = mapTeamFeatures(
      [fv('10', 'team.home_form', 73), fv('10', 'team.congestion_index', 40), fv('10', 'team.rest_advantage', 4)],
      '10', '11',
    );
    assert.equal(out.home.homeForm?.direction, 'HIGHER_IS_STRONGER');
    assert.equal(out.home.homeForm?.unit, 'index');
    assert.equal(out.home.congestion?.direction, 'LOWER_IS_STRONGER'); // governed, not a frontend constant
    assert.equal(out.home.rest?.unit, 'days');
  });

  test('governed FIXTURE readings map to ApiModuleReading verbatim (status/verdict/sample), evidence null', () => {
    const r: FixtureModuleReading = {
      moduleKey: 'form_gap_accuracy', fixtureId: '292',
      asOf: new Date('2026-08-23T17:30:00Z'), calculatedAt: new Date('2026-08-23T18:00:00Z'),
      moduleStatusCode: 'SUPPORTS', strength: null, confidence: null,
      sampleObservationCount: 6, sampleMeetsThreshold: true,
      verdictText: 'Home venue form stronger by 12.50.', inactiveReason: null,
    };
    assert.deepEqual(toFixtureReadingDto(r), {
      moduleKey: 'form_gap_accuracy', status: 'SUPPORTS', strength: null, confidence: null,
      sampleObservationCount: 6, sampleMeetsThreshold: true, asOf: '2026-08-23T17:30:00.000Z',
      verdictText: 'Home venue form stronger by 12.50.', inactiveReason: null, evidence: null,
    });
  });

  test('no values at all → every slot null', () => {
    const out = mapTeamFeatures([], '10', '11');
    assert.deepEqual(out, {
      home: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null },
      away: { homeForm: null, awayForm: null, momentum: null, rest: null, congestion: null },
    });
  });
});

// A canned Slice-2 Match Intelligence response, modelled on the production sealed
// snapshot 1163 (fixture 1384, home 599 / away 602): PARTIAL 55/60, squad absent,
// governed edge present, ungoverned graded fields null. Used to prove the wire
// contract keeps `intelligence` (sealed) and `context` (live) strictly separate.
const INTEL_18 = {
  intelligence: {
    provenance: {
      fixtureId: '18', matchSnapshotId: '1163', fixturePartitionOn: '2026-09-13',
      snapshotPointCode: 'T_MINUS_7D', snapshotAsOf: '2026-09-13T12:30:00.000Z',
      sealedAt: '2026-09-13T12:36:35.000Z', verdictCompositionVersion: '1.3.0',
      checksumAlgorithmVersion: 'v1', contentChecksumHex: 'deadbeef', immutable: true,
    },
    verdict: {
      consensusSupportsCount: 1, consensusContradictsCount: 0, consensusNeutralCount: 1,
      consensusInactiveCount: 2, evidenceCount: 2, completenessRatio: '0.500000',
      formEdge: '5.2000', restEdge: null, readinessEdge: null, travelEdge: null,
      congestionEdge: null, availabilityEdge: null, riskScore: null, confidence: null,
      historicalReliabilityBaselineId: null,
    },
    modules: [
      { moduleKey: 'home_away_split', displayName: 'Home/Away Split', displayNumber: 1, moduleVersion: '1.0.0', subjectKindCode: 'TEAM', subjectTeamId: '599', status: 'SUPPORTS', strength: null, confidence: null, sampleObservationCount: 6, sampleMeetsThreshold: true, asOf: '2026-09-13T12:30:00.000Z', verdictText: 'Strongly home-reliant' },
      { moduleKey: 'home_away_split', displayName: 'Home/Away Split', displayNumber: 1, moduleVersion: '1.0.0', subjectKindCode: 'TEAM', subjectTeamId: '602', status: 'NEUTRAL', strength: null, confidence: null, sampleObservationCount: 4, sampleMeetsThreshold: false, asOf: '2026-09-13T12:30:00.000Z', verdictText: null },
    ],
    preparedness: [
      { side: 'AWAY', teamId: '602', preparednessPoints: '28.6000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167' },
      { side: 'HOME', teamId: '599', preparednessPoints: '13.5000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167' },
    ],
    citedEvidence: [
      { featureKey: 'team.home_form', subjectTeamId: '599', value: '0.00', featureVersionId: '11', featureValueId: '903', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 5, sampleMeetsThreshold: true },
      { featureKey: 'team.congestion_index', subjectTeamId: '599', value: '10.00', featureVersionId: '13', featureValueId: '902', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 3, sampleMeetsThreshold: true },
    ],
  },
  // `context` carries a live value (recent form) that must NEVER be treated as cited evidence.
  context: { match: { fixtureId: '18' }, teamFeatures: { home: { homeForm: { value: 73 } } } },
};

describe('v2 api · match intelligence wire contract (Slice 2, injected seams)', () => {
  let server: Server;
  let base = '';
  before(async () => {
    const deps: ApiDeps = {
      getMatch: async () => null,
      getMatchIntelligence: async (id) => (id === '18' ? INTEL_18 : null),
      getMatchLineups: async () => null,
      getMatchTeamStatistics: async () => null,
      getMatchResult: async () => null,
      getMatchLifecycle: async () => null,
      getMatchVenue: async () => null,
      getEdition: async () => null, getEditionStandings: async () => null, getEditionObservations: async () => null, getSeasonPositionTrajectory: async () => null, getEditions: async () => ({ editions: [] }),
      getTeams: async () => ({ teams: [] }), getTeam: async () => null, getTeamPerformance: async () => null, getTeamReadiness: async () => null, getTeamGovernedIntelligence: async () => null, getTeamObservations: async () => null, getTeamTemporalPerformance: async () => null,
      getPlayers: async () => ({ players: [] }), getPlayer: async () => null, getPlayerObservations: async () => null, getPlayerTemporalPerformance: async () => null, getVenue: async () => null, getCountry: async () => null, getCompetition: async () => null, getEditionDetail: async () => null,
    };
    server = createServer(deps);
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  after(async () => { await stop(server); });

  it('200: intelligence and context are separate top-level properties', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/intelligence`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok('intelligence' in body && 'context' in body);
    assert.notEqual(body.intelligence, undefined);
    assert.notEqual(body.context, undefined);
  });

  it('provenance + VCV preserved (sealed analysis is identifiable)', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/18/intelligence`)).json() as any;
    assert.equal(body.intelligence.provenance.verdictCompositionVersion, '1.3.0');
    assert.equal(body.intelligence.provenance.snapshotAsOf, '2026-09-13T12:30:00.000Z');
    assert.equal(body.intelligence.provenance.matchSnapshotId, '1163');
    assert.equal(body.intelligence.provenance.immutable, true);
    assert.equal(body.intelligence.verdict.formEdge, '5.2000');
  });

  it('Team Preparedness preserves HOME/AWAY mapping, 55/60, 0.9167 and exact values', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/18/intelligence`)).json() as any;
    const home = body.intelligence.preparedness.find((p: any) => p.side === 'HOME');
    const away = body.intelligence.preparedness.find((p: any) => p.side === 'AWAY');
    assert.equal(home.teamId, '599');
    assert.equal(away.teamId, '602');
    assert.equal(home.preparednessPoints, '13.5000');
    assert.equal(away.preparednessPoints, '28.6000');
    assert.equal(home.availablePoints, '55');
    assert.equal(home.declaredPoints, '60');
    assert.equal(home.coverageRatio, '0.9167');
  });

  it('sealed governed module readings (home_away_split) are surfaced, per team, governed and not from context', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/18/intelligence`)).json() as any;
    const has = body.intelligence.modules.filter((m: any) => m.moduleKey === 'home_away_split');
    assert.equal(has.length, 2); // one governed reading per team
    const home = has.find((m: any) => m.subjectTeamId === '599');
    const away = has.find((m: any) => m.subjectTeamId === '602');
    assert.equal(home.moduleVersion, '1.0.0');   // governed module version travels on the wire
    assert.equal(home.status, 'SUPPORTS');
    assert.equal(away.status, 'NEUTRAL');
    assert.equal(home.strength, null);           // v1.0.0 → null, never a fabricated number
    assert.equal(away.sampleMeetsThreshold, false);
    // the live context value (73) is never smuggled into a governed module reading
    assert.equal(body.intelligence.modules.some((m: any) => m.strength === 73 || m.verdictText === 73), false);
  });

  it('absent squad_stability stays absent; present-but-zero preserved; ungoverned fields null', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/18/intelligence`)).json() as any;
    const keys = body.intelligence.citedEvidence.map((e: any) => e.featureKey);
    assert.equal(keys.includes('team.squad_stability'), false); // absent stays absent
    const homeForm = body.intelligence.citedEvidence.find((e: any) => e.featureKey === 'team.home_form');
    assert.equal(homeForm.value, '0.00'); // present-but-zero preserved (not dropped, not treated as missing)
    assert.equal(body.intelligence.verdict.restEdge, null);
    assert.equal(body.intelligence.verdict.confidence, null); // never a fabricated percentage
    assert.equal(body.intelligence.verdict.riskScore, null);
  });

  it('cited evidence does not contain context; a live context value is not presented as evidence', async () => {
    const body = await (await fetch(`${base}/api/v2/matches/18/intelligence`)).json() as any;
    // The live recent-form value 73 lives only under context, never in citedEvidence.
    assert.equal(body.context.teamFeatures.home.homeForm.value, 73);
    assert.equal(body.intelligence.citedEvidence.some((e: any) => e.value === '73' || e.value === 73), false);
    // citedEvidence carries only sealed feature citations, each with lineage.
    assert.ok(body.intelligence.citedEvidence.every((e: any) => typeof e.featureVersionId === 'string'));
  });

  it('no sealed snapshot → 404 match_intelligence_not_found (never a live fabrication)', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/intelligence`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_intelligence_not_found' });
  });

  it('invalid id → 400; POST → 405', async () => {
    assert.equal((await fetch(`${base}/api/v2/matches/abc/intelligence`)).status, 400);
    assert.equal((await fetch(`${base}/api/v2/matches/18/intelligence`, { method: 'POST' })).status, 405);
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
      getMatchIntelligence: async (id) => (id === '18' ? INTEL_18 : null),
      getMatchLineups: async (id) => (id === '18' ? { match: { fixtureId: '18' }, lineups: { home: null, away: null, coverage: { lineups: 'absent', lineupsAreObserved: true } } } : null),
      getMatchTeamStatistics: async (id) => (id === '18' ? { match: { fixtureId: '18' }, teamStatistics: { periods: [], coverage: { teamStatistics: 'absent', periodsPresent: [], statisticsAreObserved: true, provider: null, retrievedAt: null } } } : null),
      getMatchResult: async (id) => (id === '18' ? { match: { fixtureId: '18' }, result: null, coverage: { result: 'absent', resultIsObserved: true } } : null),
      getMatchLifecycle: async (id) => (id === '18' ? { match: { fixtureId: '18' }, lifecycle: { transitions: [], coverage: { transitions: 'absent', transitionsAreObserved: true } } } : null),
      getMatchVenue: async (id) => (id === '18' ? { match: { fixtureId: '18' }, venue: null, isNeutralVenue: false, coverage: { venue: 'absent', venueIsObserved: true } } : null),
      getEdition: async (id) => { editionCalls.push(id); return id === '42' ? { edition: { id: '42' }, fixtures: [] } : null; },
      getEditionStandings: async (id) => (id === '42' ? { edition: { id: '42' }, standings: { tables: [], coverage: { standings: 'absent', variantsPresent: [], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true } } } : null),
      getEditionObservations: async (id) => (id === '42' ? { edition: { id: '42', seasonLabel: 'S' }, competition: { id: '1', name: 'L', slug: 'l' }, scope: { asOf: '2026-09-20T00:00:00.000Z', order: 'asc' }, asOf: '2026-09-20T00:00:00.000Z', observationCount: 0, series: [], current: null, coverage: { resultMetrics: { class: 'full-edition', matchesCompleted: 0, matchesScheduled: 0 }, statMetrics: [] }, provenance: { statTier: null } } : null),
      getSeasonPositionTrajectory: async (id) => (id === '42' ? { edition: { id: '42', seasonLabel: 'S' }, competition: { id: '1', name: 'L', slug: 'l' }, scope: { asOf: '2026-09-20T00:00:00.000Z', order: 'asc', teamId: null }, asOf: '2026-09-20T00:00:00.000Z', mode: 'RAW_DETERMINISTIC', positionMethod: { comparator: ['points DESC'], version: 'raw-det-1', note: 'x' }, teamCount: 0, teams: [] } : null),
      getEditions: async () => ({ editions: [{ id: '42', seasonLabel: 'S', competition: { id: '1', name: 'L', slug: 'l' }, fixtureCount: 3 }] }),
      getTeams: async () => ({ teams: [{ id: '7', name: 'T', slug: 't', shortName: null, countryCode: null }] }),
      getTeam: async (id) => (id === '7' ? { team: { id: '7' } } : null),
      getTeamPerformance: async (id) => (id === '7' ? { team: { id: '7' }, overall: { homeForm: null, awayForm: null, momentum: null, goalMarginVolatility: null, giantKillerPpg: null }, byCompetition: [], coverage: { overall: 'absent', performanceIsDescriptive: true } } : null),
      getTeamReadiness: async (id) => (id === '7' ? { team: { id: '7' }, readiness: { moduleKey: 'readiness_tracker', status: 'NEUTRAL', strength: null, confidence: null, sample: { matches: 10, meetsThreshold: true }, verdictText: 'Steady form.', inactiveReason: null, asOf: '2026-07-17T23:00:00.000Z', evidence: null }, coverage: { readiness: 'present', readinessIsGoverned: true } } : null),
      getTeamGovernedIntelligence: async (id) => (id === '7' ? { team: { id: '7' }, homeAwaySplit: [], consistency: null, coverage: { homeAwaySplit: 'absent', consistency: 'absent', isGoverned: true } } : null),
      getTeamObservations: async () => null,
      getTeamTemporalPerformance: async (id) => (id === '7' ? { team: { id: '7', name: 'T', slug: 't' }, scope: { competition: 'all', editionId: null, label: 'all competitions' }, asOf: '2026-09-20T00:00:00.000Z', aggregation: { version: 'temporal-1' }, comparisonStatus: 'insufficient_sample', sample: { eligibleObservations: 0, requiredForComparison: 10 }, windows: { last5: { status: 'insufficient', observationCount: 0, windowSize: 5, from: null, to: null, fixtureIds: [] }, previous5: null }, results: { last5: null, previous5: null, change: null }, comparisons: [], season: { observationCount: 0, scopeLabel: 'all competitions', results: { wins: 0, draws: 0, losses: 0, points: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0 }, metrics: [] }, provenance: { source: 'teamObservations', aggregationVersion: 'temporal-1', asOf: '2026-09-20T00:00:00.000Z', last5FixtureIds: [], previous5FixtureIds: [] } } : null),
      getPlayers: async () => ({ players: [{ id: '9', fullName: 'P', shortName: null, slug: 'p', team: null }] }),
      getPlayer: async (id) => (id === '9' ? { player: { id: '9' } } : null),
      getPlayerTemporalPerformance: async (id) => (id === '9' ? { player: { id: '9', fullName: 'P', slug: 'p' }, scope: { competition: 'all', editionId: null, label: 'all competitions' }, asOf: '2026-09-20T00:00:00.000Z', aggregation: { version: 'player-temporal-1' }, comparisonStatus: 'insufficient_sample', sample: { eligibleObservations: 0, requiredForComparison: 10 }, windows: { last5: { status: 'insufficient', observationCount: 0, windowSize: 5, from: null, to: null, fixtureIds: [] }, previous5: null }, participation: { last5: null, previous5: null, change: null }, comparisons: [], season: { observationCount: 0, scopeLabel: 'all competitions', participation: { started: 0, bench: 0, unknown: 0 }, metrics: [] }, provenance: { source: 'playerObservations', aggregationVersion: 'player-temporal-1', asOf: '2026-09-20T00:00:00.000Z', last5FixtureIds: [], previous5FixtureIds: [] } } : null),
      getPlayerObservations: async (id) => (id === '9' ? { player: { id: '9', fullName: 'P', slug: 'p' }, scope: { competition: 'all', editionId: null, venue: 'all', order: 'asc' }, asOf: '2026-09-20T00:00:00.000Z', observationCount: 0, coverage: { observations: 'absent', metrics: [] }, observations: [] } : null),
      getVenue: async (id) => (id === '25' ? { venue: { id: '25', name: 'Maracanã', city: 'Rio de Janeiro', countryCode: 'BR', latitude: -22.9, longitude: -43.2, elevationMetres: 9, timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass' }, homeTeams: [{ id: '67', name: 'Fluminense', slug: 'fluminense', shortName: 'FLU', countryCode: 'BR' }], coverage: { venue: 'present', homeTeams: 'present' } } : null),
      getCountry: async (code) => (code === 'BR' ? { country: { code: 'BR', name: 'Brazil', alpha3Code: 'BRA' }, teams: [{ id: '68', name: 'Flamengo', slug: 'flamengo-5981', shortName: 'Flamengo', countryCode: 'BR' }], competitions: [{ id: '1', name: 'Brasileirão Série A', slug: 'brasileirao-serie-a' }], coverage: { country: 'present', teams: 'present', competitions: 'present' } } : null),
      getCompetition: async (id) => (id === '28' ? { competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', countryCode: 'BR' }, editions: [{ id: '42', seasonLabel: '2025', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' }, fixtureCount: 380 }], coverage: { competition: 'present', editions: 'present' } } : null),
      getEditionDetail: async (id) => (id === '18' ? { edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026', competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' } }, coverage: { edition: 'present', competition: 'present' } } : null),
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

  it('GET a known fixture lineups → 200 with a lineups projection', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/lineups`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.match.fixtureId, '18');
    assert.equal(body.lineups.coverage.lineupsAreObserved, true);
  });

  it('GET lineups for an unknown fixture → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/lineups`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known fixture team-statistics → 200 with observed-evidence coverage', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/team-statistics`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.match.fixtureId, '18');
    assert.equal(body.teamStatistics.coverage.statisticsAreObserved, true);
  });

  it('GET team-statistics for an unknown fixture → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/team-statistics`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known fixture result → 200 with observed-evidence coverage', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/result`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.match.fixtureId, '18');
    assert.equal(body.coverage.resultIsObserved, true);
  });

  it('GET result for an unknown fixture → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/result`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known fixture lifecycle → 200 with observed-evidence coverage', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/lifecycle`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.match.fixtureId, '18');
    assert.equal(body.lifecycle.coverage.transitionsAreObserved, true);
  });

  it('GET lifecycle for an unknown fixture → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/lifecycle`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known fixture venue → 200 with observed-evidence coverage', async () => {
    const res = await fetch(`${base}/api/v2/matches/18/venue`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.match.fixtureId, '18');
    assert.equal(body.coverage.venueIsObserved, true);
    assert.equal(body.isNeutralVenue, false);
  });

  it('GET venue for an unknown fixture → 404 match_not_found', async () => {
    const res = await fetch(`${base}/api/v2/matches/19/venue`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'match_not_found' });
  });

  it('GET a known edition standings → 200 with a standings projection', async () => {
    const res = await fetch(`${base}/api/v2/editions/42/standings`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.edition.id, '42');
    assert.equal(body.standings.coverage.standings, 'absent');
  });

  it('GET standings for a non-exposed edition → 404 edition_not_found', async () => {
    const res = await fetch(`${base}/api/v2/editions/43/standings`);
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

  it('GET team performance → 200 descriptive coverage; unauthorized team → 404', async () => {
    const res = await fetch(`${base}/api/v2/teams/7/performance`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.team.id, '7');
    assert.equal(body.coverage.performanceIsDescriptive, true);
    const miss = await fetch(`${base}/api/v2/teams/8/performance`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'team_not_found' });
  });

  it('GET team readiness → 200 governed reading; unauthorized team → 404', async () => {
    const res = await fetch(`${base}/api/v2/teams/7/readiness`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.team.id, '7');
    assert.equal(body.readiness.moduleKey, 'readiness_tracker');
    assert.equal(body.coverage.readinessIsGoverned, true);
    assert.equal(Object.prototype.hasOwnProperty.call(body.readiness, 'score'), false); // no fabricated score
    const miss = await fetch(`${base}/api/v2/teams/8/readiness`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'team_not_found' });
  });

  it('GET team governed intelligence → 200 with homeAwaySplit + consistency + governed coverage; unauthorized → 404', async () => {
    assert.deepEqual(resolveRoute('GET', '/api/v2/teams/18/intelligence'), { kind: 'teamIntelligence', id: '18' });
    const res = await fetch(`${base}/api/v2/teams/7/intelligence`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.team.id, '7');
    assert.equal(Array.isArray(body.homeAwaySplit), true);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'consistency'), true);
    assert.equal(body.coverage.isGoverned, true);
    const miss = await fetch(`${base}/api/v2/teams/8/intelligence`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'team_not_found' });
  });

  it('GET a known venue → 200 with geography + homeTeams; unknown venue → 404', async () => {
    const res = await fetch(`${base}/api/v2/venues/25`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.venue.id, '25');
    assert.equal(body.venue.name, 'Maracanã');
    assert.equal(body.coverage.homeTeams, 'present');
    const miss = await fetch(`${base}/api/v2/venues/26`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'venue_not_found' });
  });

  it('GET a known country → 200 with identity + teams + competitions; unknown → 404', async () => {
    const res = await fetch(`${base}/api/v2/countries/BR`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.country.code, 'BR');
    assert.equal(body.country.name, 'Brazil');
    assert.equal(body.teams[0].id, '68');
    assert.equal(body.competitions[0].slug, 'brasileirao-serie-a');
    assert.deepEqual(body.coverage, { country: 'present', teams: 'present', competitions: 'present' });
    assert.equal((await fetch(`${base}/api/v2/countries/br`)).status, 200); // case-normalized
    const miss = await fetch(`${base}/api/v2/countries/ZZ`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'country_not_found' });
    assert.equal((await fetch(`${base}/api/v2/countries/BRA`)).status, 400); // invalid identifier
  });

  it('GET a known competition → 200 with identity + country + editions; unknown → 404', async () => {
    const res = await fetch(`${base}/api/v2/competitions/28`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.competition.id, '28');
    assert.equal(body.competition.countryCode, 'BR');
    assert.equal(body.editions[0].id, '42');
    assert.equal(body.editions[0].fixtureCount, 380);
    assert.deepEqual(body.coverage, { competition: 'present', editions: 'present' });
    const miss = await fetch(`${base}/api/v2/competitions/29`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'competition_not_found' });
    assert.equal((await fetch(`${base}/api/v2/competitions/abc`)).status, 400); // malformed identifier
  });

  it('GET a known edition → 200 with identity + competition; unknown → 404; malformed → 400', async () => {
    const res = await fetch(`${base}/api/v2/editions/18`);
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.edition.id, '18');
    assert.equal(body.edition.seasonLabel, 'Brasileiro Serie A 2026');
    assert.equal(body.edition.competition.id, '28');
    assert.equal(body.edition.fixtureCount, undefined); // fixtureCount intentionally not exposed here
    assert.deepEqual(body.coverage, { edition: 'present', competition: 'present' });
    const miss = await fetch(`${base}/api/v2/editions/19`);
    assert.equal(miss.status, 404);
    assert.deepEqual(await miss.json(), { error: 'edition_not_found' });
    assert.equal((await fetch(`${base}/api/v2/editions/abc`)).status, 400);
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
