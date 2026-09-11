// ─────────────────────────────────────────────────────────────────────────────
// S-6 GATE C-ii — COMPETITION_SCOPED CALCULATION CAPABILITY
//
// Proves the reusable scoped path — enumeration, edition-cumulative read, scoped
// write with the fixed RETURNING correlation, and the separate pipeline pass —
// WITHOUT any venue-specific calculator. A trivial probe calculator emitting a
// registered COMPETITION_SCOPED-bound feature (`team.home_form`) exercises the
// pass end to end; the feature's meaning is irrelevant here — only the plumbing
// is under test.
//
// The hard guarantee is that the existing ALL_COMPETITIONS path is unchanged: it
// still writes `context_competition_edition_id = NULL`, its values are identical,
// and the two contexts coexist without collision.
//
// SKIPS without a V2 database, exactly like the S-5 database suite.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { findByProviderId, insertAppendOnly, upsertMutable } from '../../ingestion/write/index';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry, type Registry } from '../registry/load';
import { selectScopedBatches } from '../driver/eligibility';
import { readEditionVenueResults } from '../read/editionVenueResults';
import { writeValues } from '../write/values';
import { buildScopedContext, CALCULATORS } from '../pipeline';
import {
  CALCULATION_CONTEXT_KIND,
  COMPETITION_SCOPED_CONTEXT_KIND,
  type CalculationContext,
  type CalculationScope,
  type Calculator,
  type CandidateValue,
} from '../calculators/types';
import { fromInt, roundHalfUp, toNumericString } from '../write/scale';
import { venueWinRate } from '../calculators/venueWinRate';
import { seedWorld, TEST_PREFIX, type SeededWorld } from './fixtures';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;

// A registered feature that declares a COMPETITION_SCOPED binding — so a scoped
// value for it satisfies fk_feature_value__definition_context_kind. Its meaning
// is not exercised; it is a vehicle for the plumbing.
const SCOPED_PROBE_FEATURE = 'team.home_form';

// A prefix DISTINCT from the shared `S5TEST` world, so this suite's committed
// second-edition fixtures do not inflate the `S5TEST-%` fixture count that
// feature.test.ts test 102 asserts. The two suites share a rig; each counts only
// its own prefix.
const SECOND_PREFIX = 'S6CII';

/**
 * A second competition edition for the same teams, with MORE THAN TEN completed
 * home fixtures for Alpha, spread across MORE THAN 28 DAYS — so the tests can
 * prove the edition-cumulative read applies neither the rank-10 cap nor the
 * 28-day window, and that a second edition is isolated from the first.
 */
interface SecondEdition {
  readonly competitionId: string;
  readonly editionId: string;
  readonly alphaHomeCount: number;
  readonly firstKickoff: Date;
  readonly lastKickoff: Date;
}

const SECOND_EDITION_KICKOFFS: readonly string[] = [
  '2026-08-02T14:00:00Z', '2026-08-16T14:00:00Z', '2026-08-30T14:00:00Z',
  '2026-09-13T14:00:00Z', '2026-09-27T14:00:00Z', '2026-10-11T14:00:00Z',
  '2026-10-25T14:00:00Z', '2026-11-08T14:00:00Z', '2026-11-22T14:00:00Z',
  '2026-12-06T14:00:00Z', '2026-12-20T14:00:00Z', '2027-01-03T14:00:00Z',
]; // 12 fixtures, fortnightly — > 10, and end-to-end far more than 28 days.

async function seedSecondEdition(tx: PoolClient, world: SeededWorld): Promise<SecondEdition> {
  const competition = await upsertMutable(tx, {
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code'],
    values: [PROVIDER_CODE, `${SECOND_PREFIX}-COMP`, 'S6 C-ii Cup', `${SECOND_PREFIX}-cup`, 'GB'],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });
  const edition = await upsertMutable(tx, {
    relation: 'football.competition_edition',
    columns: ['competition_id', 'season_label', 'season_period'],
    values: [competition.id, '2026/2027', '[2026-07-01,2027-07-01)'],
    conflictTarget: ['competition_id', 'season_period'],
  });

  for (let i = 0; i < SECOND_EDITION_KICKOFFS.length; i += 1) {
    const kickoffIso = SECOND_EDITION_KICKOFFS[i];
    const kickoff = new Date(kickoffIso);
    const partitionOn = kickoffIso.slice(0, 10);
    const externalId = `${SECOND_PREFIX}-E2-F${String(i + 1).padStart(2, '0')}`;

    const existing = await findByProviderId(tx, 'football.fixture', PROVIDER_CODE, externalId);
    const stored = await upsertMutable(tx, {
      relation: 'football.fixture',
      columns: [
        'provider_code', 'provider_external_id', 'fixture_partition_on',
        'competition_edition_id', 'venue_id', 'is_neutral_venue',
        'home_team_id', 'away_team_id', 'scheduled_kickoff_at', 'lifecycle_state_code',
      ],
      values: [
        PROVIDER_CODE, externalId, partitionOn,
        edition.id, world.alphaVenueId, false,
        world.alphaTeamId, world.betaTeamId, kickoff, 'COMPLETED',
      ],
      conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
      immutableColumns: ['fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    await upsertMutable(tx, {
      relation: 'football.result',
      columns: ['fixture_id', 'fixture_partition_on', 'home_goals', 'away_goals', 'confirmed_at'],
      values: [stored.id, partitionOn, 2, 0, kickoff],
      conflictTarget: ['fixture_partition_on', 'fixture_id'],
      immutableColumns: ['fixture_id', 'fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    await insertAppendOnly(tx, {
      relation: 'football.fixture_lifecycle_transition',
      columns: ['fixture_id', 'fixture_partition_on', 'from_state_code', 'to_state_code', 'transitioned_at'],
      rows: [[stored.id, partitionOn, null, 'COMPLETED', kickoff]],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'transitioned_at'],
    });
  }

  return {
    competitionId: String(competition.id),
    editionId: String(edition.id),
    alphaHomeCount: SECOND_EDITION_KICKOFFS.length,
    firstKickoff: new Date(SECOND_EDITION_KICKOFFS[0]),
    lastKickoff: new Date(SECOND_EDITION_KICKOFFS[SECOND_EDITION_KICKOFFS.length - 1]),
  };
}

/** A probe that emits one SCOPED_PROBE_FEATURE value per subject with a fixed value. */
function probeCalculator(observationBySubject: (teamId: string) => number): Calculator {
  return {
    calculatorKey: 'scoped_probe',
    featureKeys: [SCOPED_PROBE_FEATURE],
    contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
    calculate(context: CalculationContext): readonly CandidateValue[] {
      const out: CandidateValue[] = [];
      for (const subject of context.subjects) {
        const history = context.fixturesByTeam.get(subject.teamId);
        if (!history || history.fixtures.length === 0) continue; // NO VALUE, not zero
        out.push({
          featureKey: SCOPED_PROBE_FEATURE,
          teamId: subject.teamId,
          asOf: subject.asOf,
          value: fromInt(observationBySubject(subject.teamId)),
          sampleObservationCount: history.fixtures.length,
          consumed: [],
        });
      }
      return out;
    },
  };
}

describe('S-6 Gate C-ii — COMPETITION_SCOPED capability', { skip: !hasDatabase }, () => {
  let world: SeededWorld;
  let second: SecondEdition;

  before(async () => {
    world = await withConnection(INGESTION_ROLE, (tx) => seedWorld(tx));
    second = await withConnection(INGESTION_ROLE, (tx) => seedSecondEdition(tx, world));
  });

  after(async () => {
    await closeAllPools();
  });

  async function asFeature<T>(fn: (tx: PoolClient, registry: Registry) => Promise<T>): Promise<T> {
    return withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      return fn(tx, registry);
    });
  }

  async function inRolledBackTx<T>(fn: (tx: PoolClient, registry: Registry) => Promise<T>): Promise<T> {
    return asFeature(async (tx, registry) => {
      await tx.query('BEGIN');
      try {
        return await fn(tx, registry);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  const afterAll = new Date('2027-02-01T00:00:00Z');

  // ── Enumeration ────────────────────────────────────────────────────────────

  it('1. selectScopedBatches enumerates (as_of, team, edition) and isolates editions', async () => {
    await asFeature(async (tx, registry) => {
      const batches = await selectScopedBatches(tx, registry, afterAll, {
        replayFrom: new Date('2026-07-01T00:00:00Z'),
        replayTo: new Date('2027-03-01T00:00:00Z'),
      });
      // Both seeded editions appear, each with its own edition id. The rig may
      // hold other editions (e.g. the OPS harness); enumerating them too is the
      // capability being GENERAL, not a defect — so the assertions scope to the
      // two S5TEST editions rather than assuming the rig holds only these.
      const editions = new Set(batches.map((b) => b.competitionEditionId));
      assert.ok(editions.has(world.editionId), 'edition 1 present');
      assert.ok(editions.has(second.editionId), 'edition 2 present');
      // Within a seeded edition's batches, the only teams are the two seeded, and
      // each batch carries exactly one edition.
      const seededEditions = new Set([world.editionId, second.editionId]);
      for (const batch of batches.filter((b) => seededEditions.has(b.competitionEditionId))) {
        assert.ok(batch.competitionEditionId, 'batch has an edition');
        for (const teamId of batch.teamIds) {
          assert.ok([world.alphaTeamId, world.betaTeamId].includes(teamId));
        }
      }
    });
  });

  // ── Edition-cumulative read ─────────────────────────────────────────────────

  it('2. read is edition-cumulative: no rank-10 cap, no 28-day window', async () => {
    await asFeature(async (tx) => {
      const byTeam = await readEditionVenueResults(tx, [world.alphaTeamId], second.editionId, afterAll);
      const alpha = byTeam.get(world.alphaTeamId);
      assert.ok(alpha);
      const homeFixtures = alpha!.fixtures.filter((f) => f.isHome);
      // 12 home fixtures, all before as_of, all returned — proves neither the
      // rank-10 cap nor the 28-day window of readCompletedFixtures applies.
      assert.equal(homeFixtures.length, second.alphaHomeCount);
      assert.ok(second.alphaHomeCount > 10, 'the rig must exceed the rank-10 cap');
      const spanDays =
        (second.lastKickoff.getTime() - second.firstKickoff.getTime()) / 86_400_000;
      assert.ok(spanDays > 28, 'the rig must exceed a 28-day window');
    });
  });

  it('3. read excludes other editions (no cup/other-competition contamination)', async () => {
    await asFeature(async (tx) => {
      const byTeam = await readEditionVenueResults(tx, [world.alphaTeamId], second.editionId, afterAll);
      const alpha = byTeam.get(world.alphaTeamId);
      assert.ok(alpha);
      // Edition 2 has 12 fixtures; edition 1's 8 must not leak in.
      assert.equal(alpha!.fixtures.length, second.alphaHomeCount);
    });
  });

  it('4. read applies strict kickoff < as_of at the millisecond boundary', async () => {
    await asFeature(async (tx) => {
      const boundary = second.firstKickoff; // exactly a fixture's kickoff
      const exact = await readEditionVenueResults(tx, [world.alphaTeamId], second.editionId, boundary);
      const before1ms = await readEditionVenueResults(
        tx, [world.alphaTeamId], second.editionId, new Date(boundary.getTime() + 1)
      );
      const after1ms = await readEditionVenueResults(
        tx, [world.alphaTeamId], second.editionId, new Date(boundary.getTime() - 1)
      );
      const count = (m: Map<string, { fixtures: readonly unknown[] }>) =>
        m.get(world.alphaTeamId)?.fixtures.length ?? 0;
      // Exactly at as_of → excluded; 1 ms after that kickoff → included; 1 ms
      // before the earliest kickoff → nothing at all.
      assert.equal(count(exact), 0, 'fixture exactly at as_of is excluded');
      assert.equal(count(before1ms), 1, 'fixture 1 ms before as_of is included');
      assert.equal(count(after1ms), 0, 'as_of 1 ms before the first kickoff yields nothing');
    });
  });

  it('5. a team with no qualifying fixtures is absent (NO VALUE, not zero)', async () => {
    await asFeature(async (tx) => {
      // Before the edition began, no fixtures qualify.
      const byTeam = await readEditionVenueResults(
        tx, [world.alphaTeamId], second.editionId, new Date('2026-07-15T00:00:00Z')
      );
      assert.equal(byTeam.has(world.alphaTeamId), false);
    });
  });

  // ── Scoped write + coexistence + idempotency + correlation ──────────────────

  it('6. ALL_COMPETITIONS still writes edition = NULL (default scope unchanged)', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const candidate: CandidateValue = {
        featureKey: SCOPED_PROBE_FEATURE,
        teamId: world.alphaTeamId,
        asOf: afterAll,
        value: fromInt(50),
        sampleObservationCount: 3,
        consumed: [],
      };
      const result = await writeValues(tx, registry, [candidate], afterAll); // no scope arg
      assert.equal(result.written, 1);
      const { rows } = await tx.query(
        `SELECT context_kind_code, context_competition_edition_id
           FROM feature.feature_value WHERE id = $1`,
        [result.writtenValues[0].valueId]
      );
      assert.equal(rows[0].context_kind_code, CALCULATION_CONTEXT_KIND);
      assert.equal(rows[0].context_competition_edition_id, null);
    });
  });

  it('7. scoped and ALL_COMPETITIONS values coexist for the same team/as_of', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const base: Omit<CandidateValue, 'value'> = {
        featureKey: SCOPED_PROBE_FEATURE,
        teamId: world.alphaTeamId,
        asOf: afterAll,
        sampleObservationCount: 3,
        consumed: [],
      };
      const allComp = await writeValues(tx, registry, [{ ...base, value: fromInt(40) }], afterAll);
      const scope: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: second.editionId,
      };
      const scoped = await writeValues(tx, registry, [{ ...base, value: fromInt(60) }], afterAll, scope);
      assert.equal(allComp.written, 1);
      assert.equal(scoped.written, 1, 'scoped value does not collide with ALL_COMPETITIONS');
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM feature.feature_value
          WHERE subject_team_id = $1 AND as_of = $2`,
        [world.alphaTeamId, afterAll]
      );
      assert.equal(rows[0].n, 2, 'both rows exist');
    });
  });

  it('8. two different editions for the same team/as_of coexist and correlate correctly', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const base: Omit<CandidateValue, 'value'> = {
        featureKey: SCOPED_PROBE_FEATURE,
        teamId: world.alphaTeamId,
        asOf: afterAll,
        sampleObservationCount: 5,
        consumed: [],
      };
      const scopeA: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: world.editionId,
      };
      const scopeB: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: second.editionId,
      };
      const a = await writeValues(tx, registry, [{ ...base, value: fromInt(11) }], afterAll, scopeA);
      const b = await writeValues(tx, registry, [{ ...base, value: fromInt(22) }], afterAll, scopeB);
      assert.equal(a.written, 1);
      assert.equal(b.written, 1);
      // The RETURNING correlation must map each value to ITS OWN edition's row.
      const idToEdition = async (id: string): Promise<string> => {
        const { rows } = await tx.query(
          `SELECT context_competition_edition_id::text AS e FROM feature.feature_value WHERE id = $1`,
          [id]
        );
        return rows[0].e;
      };
      assert.equal(await idToEdition(a.writtenValues[0].valueId), world.editionId);
      assert.equal(await idToEdition(b.writtenValues[0].valueId), second.editionId);
    });
  });

  it('9. rerunning a scoped write is idempotent', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const candidate: CandidateValue = {
        featureKey: SCOPED_PROBE_FEATURE,
        teamId: world.alphaTeamId,
        asOf: afterAll,
        value: fromInt(77),
        sampleObservationCount: 4,
        consumed: [],
      };
      const scope: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: second.editionId,
      };
      const first = await writeValues(tx, registry, [candidate], afterAll, scope);
      const again = await writeValues(tx, registry, [candidate], afterAll, scope);
      assert.equal(first.written, 1);
      assert.equal(again.written, 0, 'the second write conflicts and is skipped');
      assert.equal(again.skipped, 1);
    });
  });

  // ── End-to-end scoped pass ──────────────────────────────────────────────────

  it('10. runScopedBatch reads edition-cumulative and writes under the edition', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const batch = {
        asOf: afterAll,
        competitionEditionId: second.editionId,
        teamIds: [world.alphaTeamId, world.betaTeamId],
        snapshotPointCodes: ['KICKOFF'],
      };
      const probe = probeCalculator(() => 99);
      // Drive the scoped batch inside this rolled-back tx with the SAME building
      // blocks the pass uses. `runScopedBatch` opens its own attributed run that
      // commits, so exercising `buildScopedContext` + `writeValues` here keeps
      // everything in one rollback — the discipline the whole feature suite uses.
      const context = await buildScopedContext(tx, registry, batch);
      const produced = probe.calculate(context);
      assert.ok(produced.length >= 1, 'the probe produced at least one scoped value');
      const scope: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: second.editionId,
      };
      const result = await writeValues(tx, registry, produced, afterAll, scope);
      assert.equal(result.written, produced.length);
      const { rows } = await tx.query(
        `SELECT DISTINCT context_kind_code, context_competition_edition_id::text AS e
           FROM feature.feature_value WHERE as_of = $1 AND subject_team_id = ANY($2::bigint[])`,
        [afterAll, [world.alphaTeamId, world.betaTeamId]]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].context_kind_code, COMPETITION_SCOPED_CONTEXT_KIND);
      assert.equal(rows[0].e, second.editionId);
    });
  });

  // ── Regression: the ALL_COMPETITIONS pipeline is untouched ──────────────────

  it('11. venue_win_rate is the first — and only — COMPETITION_SCOPED calculator', () => {
    // Updated at Gate C (as the C-ii version of this test foretold). The scoped
    // pass now has exactly one production consumer; every other calculator stays
    // ALL_COMPETITIONS. The ALL_COMPETITIONS byte-identical guarantee remains the
    // existing feature suite, which runs the untouched ALL_COMP path.
    const scoped = CALCULATORS.filter((c) => c.contextKind === COMPETITION_SCOPED_CONTEXT_KIND);
    assert.deepEqual(scoped.map((c) => c.calculatorKey), ['venue_win_rate']);
    for (const c of CALCULATORS) {
      if (c.calculatorKey !== 'venue_win_rate') {
        assert.notEqual(c.contextKind, COMPETITION_SCOPED_CONTEXT_KIND, `${c.calculatorKey} stays ALL_COMPETITIONS`);
      }
    }
  });

  // ── Gate C: venue_win_rate against the real seeded editions ─────────────────

  const stored = (v: ReturnType<typeof fromInt>) => toNumericString(roundHalfUp(v, 2));
  const rateOf = (produced: readonly CandidateValue[], featureKey: string, teamId: string) =>
    produced.find((c) => c.featureKey === featureKey && c.teamId === teamId);

  it('12. edition 1 win rates are edition-cumulative and correct (V1 formula, V2 population)', async () => {
    await asFeature(async (tx, registry) => {
      const batch = {
        asOf: afterAll,
        competitionEditionId: world.editionId,
        teamIds: [world.alphaTeamId],
        snapshotPointCodes: ['KICKOFF'],
      };
      const produced = venueWinRate.calculate(await buildScopedContext(tx, registry, batch));
      // Alpha in edition 1: home F01 W, F03 L, F05 D, F07 W → 2/4 = 50.00 (count 4).
      // away F02 D, F04 L, F06 W, F08 D → 1/4 = 25.00 (count 4).
      const home = rateOf(produced, 'team.home_win_rate', world.alphaTeamId);
      const away = rateOf(produced, 'team.away_win_rate', world.alphaTeamId);
      assert.equal(stored(home!.value), '50.00');
      assert.equal(home!.sampleObservationCount, 4);
      assert.equal(stored(away!.value), '25.00');
      assert.equal(away!.sampleObservationCount, 4);
    });
  });

  it('13. edition 2 retains >10 fixtures and excludes the other competition', async () => {
    await asFeature(async (tx, registry) => {
      const batch = {
        asOf: afterAll,
        competitionEditionId: second.editionId,
        teamIds: [world.alphaTeamId],
        snapshotPointCodes: ['KICKOFF'],
      };
      const produced = venueWinRate.calculate(await buildScopedContext(tx, registry, batch));
      const home = rateOf(produced, 'team.home_win_rate', world.alphaTeamId);
      const away = rateOf(produced, 'team.away_win_rate', world.alphaTeamId);
      // 12 home wins → 100.00 over 12 (proves no rank-10 cap, no 28-day window).
      assert.equal(stored(home!.value), '100.00');
      assert.equal(home!.sampleObservationCount, second.alphaHomeCount);
      assert.ok(second.alphaHomeCount > 10);
      // No away fixtures in edition 2 → NO VALUE, and edition 1's fixtures do not leak in.
      assert.equal(away, undefined);
    });
  });

  it('14. same team + same as_of + different editions produce distinct values', async () => {
    await asFeature(async (tx, registry) => {
      const e1 = venueWinRate.calculate(await buildScopedContext(tx, registry, {
        asOf: afterAll, competitionEditionId: world.editionId,
        teamIds: [world.alphaTeamId], snapshotPointCodes: ['KICKOFF'],
      }));
      const e2 = venueWinRate.calculate(await buildScopedContext(tx, registry, {
        asOf: afterAll, competitionEditionId: second.editionId,
        teamIds: [world.alphaTeamId], snapshotPointCodes: ['KICKOFF'],
      }));
      // Edition 1 home 50.00 vs edition 2 home 100.00 — the population isolation
      // that V1's lifetime all-competition calculation would have contaminated.
      assert.equal(stored(rateOf(e1, 'team.home_win_rate', world.alphaTeamId)!.value), '50.00');
      assert.equal(stored(rateOf(e2, 'team.home_win_rate', world.alphaTeamId)!.value), '100.00');
    });
  });

  it('15. strict boundary: a fixture exactly at as_of is excluded', async () => {
    await asFeature(async (tx, registry) => {
      // as_of exactly at edition 2's first kickoff → that fixture excluded; the
      // remaining 11 are all wins → still 100.00 but over 11, not 12.
      const batch = {
        asOf: second.firstKickoff,
        competitionEditionId: second.editionId,
        teamIds: [world.alphaTeamId],
        snapshotPointCodes: ['KICKOFF'],
      };
      const produced = venueWinRate.calculate(await buildScopedContext(tx, registry, batch));
      const home = rateOf(produced, 'team.home_win_rate', world.alphaTeamId);
      // Everything is before the first kickoff except… nothing: as_of = first
      // kickoff excludes it and there is nothing earlier → NO VALUE.
      assert.equal(home, undefined, 'as_of at the earliest kickoff leaves no qualifying fixture');
      const after1ms = venueWinRate.calculate(await buildScopedContext(tx, registry, {
        ...batch, asOf: new Date(second.firstKickoff.getTime() + 1),
      }));
      // 1 ms later, the first fixture qualifies → 100.00 over 1.
      const home1 = rateOf(after1ms, 'team.home_win_rate', world.alphaTeamId);
      assert.equal(stored(home1!.value), '100.00');
      assert.equal(home1!.sampleObservationCount, 1);
    });
  });

  it('16. scoped venue values persist under the edition, at scale 2, idempotently', async () => {
    await inRolledBackTx(async (tx, registry) => {
      const batch = {
        asOf: afterAll, competitionEditionId: world.editionId,
        teamIds: [world.alphaTeamId], snapshotPointCodes: ['KICKOFF'],
      };
      const produced = venueWinRate.calculate(await buildScopedContext(tx, registry, batch));
      const scope: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: world.editionId,
      };
      const first = await writeValues(tx, registry, produced, afterAll, scope);
      assert.equal(first.written, produced.length);
      // Stored at value_scale = 2, under the edition.
      const { rows } = await tx.query(
        `SELECT d.feature_key, v.value::text AS value, v.context_kind_code,
                v.context_competition_edition_id::text AS ed, v.sample_observation_count
           FROM feature.feature_value v
           JOIN feature.feature_definition d ON d.id = v.feature_definition_id
          WHERE v.subject_team_id = $1 AND v.as_of = $2
          ORDER BY d.feature_key`,
        [world.alphaTeamId, afterAll]
      );
      const byKey = Object.fromEntries(rows.map((r: any) => [r.feature_key, r]));
      assert.equal(byKey['team.home_win_rate'].value, '50.00');
      assert.equal(byKey['team.home_win_rate'].context_kind_code, COMPETITION_SCOPED_CONTEXT_KIND);
      assert.equal(byKey['team.home_win_rate'].ed, world.editionId);
      assert.equal(byKey['team.away_win_rate'].value, '25.00');
      // Idempotent rerun.
      const again = await writeValues(tx, registry, produced, afterAll, scope);
      assert.equal(again.written, 0);
      assert.equal(again.skipped, produced.length);
    });
  });

  it('17. ALL_COMPETITIONS home_form is unaffected by a scoped venue write', async () => {
    await inRolledBackTx(async (tx, registry) => {
      // A scoped venue write for alpha must not touch any ALL_COMPETITIONS row.
      const batch = {
        asOf: afterAll, competitionEditionId: world.editionId,
        teamIds: [world.alphaTeamId], snapshotPointCodes: ['KICKOFF'],
      };
      const produced = venueWinRate.calculate(await buildScopedContext(tx, registry, batch));
      const scope: CalculationScope = {
        contextKind: COMPETITION_SCOPED_CONTEXT_KIND,
        contextEditionId: world.editionId,
      };
      await writeValues(tx, registry, produced, afterAll, scope);
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM feature.feature_value
          WHERE subject_team_id = $1 AND context_kind_code = $2`,
        [world.alphaTeamId, CALCULATION_CONTEXT_KIND]
      );
      assert.equal(rows[0].n, 0, 'no ALL_COMPETITIONS row was created by the scoped write');
    });
  });
});
