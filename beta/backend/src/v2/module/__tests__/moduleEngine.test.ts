// ─────────────────────────────────────────────────────────────────────────────
// S-6 MODULE ENGINE + home_away_split
//
// PURE tests (no DB) pin the frozen status matrix, disparity boundaries, INACTIVE
// assembly, MIN(consumed) sample count, and evidence directions. DB tests prove
// the read → assemble → write chain against the real seeded editions, including
// idempotency, edition isolation, the INACTIVE lifecycle, TEAM-subject shape, and
// that the ALL_COMPETITIONS feature path is untouched.
//
// V2-derived goldens (S-0-c-i): the venue population is COMPETITION_SCOPED
// edition-cumulative, not V1's lifetime numbers.
//
// The engine reads COMMITTED feature values (module_evidence_item has an FK to
// feature_value, migration 014), so DB tests commit a small venue set at a
// DEDICATED as_of (2027-03-15) that no other suite references, then read/assemble/
// write inside rolled-back transactions.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry, type Registry } from '../../feature/registry/load';
import { buildScopedContext } from '../../feature/pipeline';
import { venueWinRate } from '../../feature/calculators/venueWinRate';
import { writeValues } from '../../feature/write/values';
import {
  CALCULATION_CONTEXT_KIND,
  COMPETITION_SCOPED_CONTEXT_KIND,
  ALL_COMPETITIONS_SCOPE,
  type CalculationScope,
  type CandidateValue,
} from '../../feature/calculators/types';
import { compare, fromInt, fromString, type Exact } from '../../feature/write/scale';
import { seedWorld, type SeededWorld } from '../../feature/__tests__/fixtures';
import { seedSecondEditionForModuleTests, type ModuleSecondEdition } from './secondEdition';

import { homeAwaySplit } from '../calculators/homeAwaySplit';
import { assembleReading, INACTIVE_REASON_FEATURE_ABSENT, MODULE_CALCULATORS, runModulePipeline } from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { consumedKey, readConsumedFeatures } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import type { ConsumedFeature, ModuleCalculator } from '../types';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

// A dedicated instant no other suite references (feature.test.ts uses
// 2026-11-10; scopedPipeline uses 2027-02-01), so the committed venue values
// below cannot perturb another test's counts.
const MODULE_AS_OF = new Date('2027-03-15T00:00:00Z');
const HOME = 'team.home_win_rate';
const AWAY = 'team.away_win_rate';

// The ALL_COMPETITIONS feature the E-i probe consumes — an existing registered
// feature (registered at both context kinds); its meaning is irrelevant here.
const PROBE_FEATURE = 'team.home_form';

/** A COMPETITION_SCOPED scope for one edition. */
function scoped(editionId: string): CalculationScope {
  return { contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: editionId };
}

// ─── the pure calculator + assembly ──────────────────────────────────────────

function consumed(featureKey: string, value: Exact, count: number, id = '1'): ConsumedFeature {
  return { featureKey, valueId: id, asOf: MODULE_AS_OF, value, sampleObservationCount: count };
}
function inputs(home: ConsumedFeature | null, away: ConsumedFeature | null): Map<string, ConsumedFeature> {
  const m = new Map<string, ConsumedFeature>();
  if (home) m.set(HOME, home);
  if (away) m.set(AWAY, away);
  return m;
}
const DEF = {
  moduleKey: 'home_away_split',
  moduleDefinitionId: '1',
  subjectKindCode: 'TEAM',
  calibrationModeCode: 'OUTCOME_SCORED',
  outcomeDimensionCode: 'MATCH_RESULT',
  isActive: true,
};
const VERSION = { moduleVersionId: '10', designation: '1.0.0', minimumSampleObservationCount: 0 };

function assemble(homeRate: Exact | null, awayRate: Exact | null, hc = 4, ac = 4) {
  return assembleReading({
    calculator: homeAwaySplit,
    definition: DEF,
    version: VERSION,
    asOf: MODULE_AS_OF,
    scope: scoped('999'),
    teamId: '100',
    inputs: inputs(
      homeRate ? consumed(HOME, homeRate, hc, 'H') : null,
      awayRate ? consumed(AWAY, awayRate, ac, 'A') : null
    ),
  });
}

describe('home_away_split — pure status rule and assembly', () => {
  it('home 100 / away 0 → SUPPORTS', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(100), 4), consumed(AWAY, fromInt(0), 4))).status, 'SUPPORTS');
  });
  it('home 0 / away 100 → SUPPORTS (absolute disparity)', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(0), 4), consumed(AWAY, fromInt(100), 4))).status, 'SUPPORTS');
  });
  it('disparity exactly 40 → SUPPORTS', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(40), 4), consumed(AWAY, fromInt(0), 4))).status, 'SUPPORTS');
  });
  it('disparity exactly -40 → SUPPORTS', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(0), 4), consumed(AWAY, fromInt(40), 4))).status, 'SUPPORTS');
  });
  it('disparity 39.99 → NEUTRAL', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromString('39.99'), 4), consumed(AWAY, fromInt(0), 4))).status, 'NEUTRAL');
  });
  it('disparity -39.99 → NEUTRAL', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(0), 4), consumed(AWAY, fromString('39.99'), 4))).status, 'NEUTRAL');
  });
  it('equal rates → NEUTRAL', () => {
    assert.equal(homeAwaySplit.evaluate(inputs(consumed(HOME, fromString('55.55'), 4), consumed(AWAY, fromString('55.55'), 4))).status, 'NEUTRAL');
  });
  it('fractional rates: 70.5 − 20.25 = 50.25 → SUPPORTS', () => {
    const f = homeAwaySplit.evaluate(inputs(consumed(HOME, fromString('70.50'), 4), consumed(AWAY, fromString('20.25'), 4)));
    assert.equal(f.status, 'SUPPORTS');
    assert.match(f.verdictText, /50\.25/);
  });
  it('is deterministic: identical inputs → identical finding', () => {
    const a = homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(90), 4), consumed(AWAY, fromInt(10), 4)));
    const b = homeAwaySplit.evaluate(inputs(consumed(HOME, fromInt(90), 4), consumed(AWAY, fromInt(10), 4)));
    assert.deepEqual(a, b);
  });
  it('declares its inputs in code (D-3): home_win_rate, away_win_rate', () => {
    assert.deepEqual([...homeAwaySplit.inputFeatureKeys].sort(), [AWAY, HOME]);
    assert.equal(homeAwaySplit.subjectKind, 'TEAM');
    assert.equal(homeAwaySplit.contextKind, 'COMPETITION_SCOPED');
  });

  it('assembles SUPPORTS with MIN(consumed) sample and directional evidence', () => {
    const r = assemble(fromInt(100), fromInt(0), 4, 6);
    assert.equal(r.statusCode, 'SUPPORTS');
    assert.equal(r.sampleObservationCount, 4, 'MIN(4, 6)');
    assert.equal(r.sampleMeetsThreshold, true);
    assert.equal(r.inactiveReason, null);
    assert.equal(r.declaredInputCount, 2);
    assert.equal(r.presentInputCount, 2);
    assert.equal(r.evidenceItems.length, 2);
    const home = r.evidenceItems.find((e) => e.citedFeatureValueId === 'H');
    const away = r.evidenceItems.find((e) => e.citedFeatureValueId === 'A');
    assert.ok(home && away, 'evidence identifies both directional features by their value ids');
    assert.equal(home!.contributionDirection, 'SUPPORTS');
  });
  it('assembles NEUTRAL', () => {
    const r = assemble(fromInt(50), fromInt(25));
    assert.equal(r.statusCode, 'NEUTRAL');
    assert.equal(r.evidenceItems.every((e) => e.contributionDirection === 'NEUTRAL'), true);
  });
  it('missing home feature → INACTIVE (silent, reason, no items, sample 0)', () => {
    const r = assemble(null, fromInt(25));
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.verdictText, null);
    assert.equal(r.sampleObservationCount, 0);
    assert.equal(r.sampleMeetsThreshold, false);
    assert.equal(r.presentInputCount, 1);
    assert.equal(r.declaredInputCount, 2);
    assert.equal(r.evidenceItems.length, 0);
  });
  it('missing away feature → INACTIVE', () => {
    assert.equal(assemble(fromInt(80), null).statusCode, 'INACTIVE');
  });
  it('both missing → INACTIVE (present 0)', () => {
    const r = assemble(null, null);
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.presentInputCount, 0);
  });
  it('zero is a valid measured value, not absence: home 0 / away 0 → NEUTRAL, engaged', () => {
    const r = assemble(fromInt(0), fromInt(0));
    assert.equal(r.statusCode, 'NEUTRAL');
    assert.equal(r.presentInputCount, 2, 'both present; 0 % is a real rate');
  });
  it('threshold: sample below minimum → not met', () => {
    const r = assembleReading({
      calculator: homeAwaySplit, definition: DEF,
      version: { ...VERSION, minimumSampleObservationCount: 5 },
      asOf: MODULE_AS_OF, scope: scoped('999'), teamId: '100',
      inputs: inputs(consumed(HOME, fromInt(90), 3, 'H'), consumed(AWAY, fromInt(10), 4, 'A')),
    });
    assert.equal(r.sampleObservationCount, 3);
    assert.equal(r.sampleMeetsThreshold, false, '3 < 5');
  });
  it('MODULE_CALCULATORS holds exactly home_away_split', () => {
    assert.deepEqual(MODULE_CALCULATORS.map((c) => c.moduleKey), ['home_away_split']);
  });

  // ── Gate E-i: assembleReading honours the declared scope (pure) ──────────────

  it('E-i: a COMPETITION_SCOPED scope persists the edition on the reading', () => {
    const r = assemble(fromInt(100), fromInt(0)); // uses scoped('999')
    assert.equal(r.contextKindCode, COMPETITION_SCOPED_CONTEXT_KIND);
    assert.equal(r.contextEditionId, '999');
  });
  it('E-i: an ALL_COMPETITIONS scope persists context kind ALL_COMPETITIONS with NULL edition', () => {
    const r = assembleReading({
      calculator: homeAwaySplit, definition: DEF, version: VERSION,
      asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: '100',
      inputs: inputs(consumed(HOME, fromInt(100), 4, 'H'), consumed(AWAY, fromInt(0), 4, 'A')),
    });
    assert.equal(r.contextKindCode, CALCULATION_CONTEXT_KIND);
    assert.equal(r.contextEditionId, null, 'ALL_COMPETITIONS carries no edition');
  });
  it('E-i: scope does not alter the finding — same inputs, same status/sample across scopes', () => {
    const scopedR = assemble(fromInt(100), fromInt(0));
    const allCompR = assembleReading({
      calculator: homeAwaySplit, definition: DEF, version: VERSION,
      asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: '100',
      inputs: inputs(consumed(HOME, fromInt(100), 4, 'H'), consumed(AWAY, fromInt(0), 4, 'A')),
    });
    assert.equal(scopedR.statusCode, allCompR.statusCode);
    assert.equal(scopedR.sampleObservationCount, allCompR.sampleObservationCount);
    assert.equal(scopedR.verdictText, allCompR.verdictText);
  });
});

// A throwaway ALL_COMPETITIONS × TEAM probe module. It consumes an existing
// ALL_COMPETITIONS feature and exists ONLY to prove the engine routes by the
// calculator's declared contextKind — never a hardcoded scope — and reads/writes
// the ALL_COMPETITIONS path correctly. It is NOT readiness_tracker: no registry
// row, no team-momentum feature, no production wiring; it borrows the registered
// home_away_split definition purely so the reading's FK resolves.
const allCompProbe: ModuleCalculator = {
  moduleKey: 'home_away_split',
  subjectKind: 'TEAM',
  contextKind: CALCULATION_CONTEXT_KIND,
  inputFeatureKeys: [PROBE_FEATURE],
  evaluate(map) {
    const v = map.get(PROBE_FEATURE)!;
    return compare(v.value, fromInt(50)) >= 0
      ? { status: 'SUPPORTS', verdictText: 'probe: ALL_COMPETITIONS input >= 50' }
      : { status: 'NEUTRAL', verdictText: 'probe: ALL_COMPETITIONS input < 50' };
  },
};

// ─── DB: the read → assemble → write chain ───────────────────────────────────

describe('S-6 module engine against the DB', { skip: !hasDatabase }, () => {
  let world: SeededWorld;
  let second: ModuleSecondEdition;

  before(async () => {
    world = await withConnection(INGESTION_ROLE, (tx) => seedWorld(tx));
    // A second edition where Alpha plays home (→ home_win_rate) but never away
    // (→ away_win_rate absent), so edition 2 drives the INACTIVE lifecycle.
    second = await withConnection(INGESTION_ROLE, (tx) => seedSecondEditionForModuleTests(tx, world));
    // Commit venue feature values at the dedicated instant, as the feature role.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      for (const editionId of [world.editionId, second.editionId]) {
        const produced = venueWinRate.calculate(
          await buildScopedContext(tx, registry, {
            asOf: MODULE_AS_OF,
            competitionEditionId: editionId,
            teamIds: [world.alphaTeamId, world.betaTeamId],
            snapshotPointCodes: ['KICKOFF'],
          })
        );
        const scope: CalculationScope = { contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: editionId };
        await writeValues(tx, registry, produced, MODULE_AS_OF, scope);
      }
      // An ALL_COMPETITIONS value (edition NULL) for the E-i probe, committed on
      // the DEDICATED gamma team (→ SUPPORTS). Kept off shared Alpha/Beta so it
      // cannot perturb another suite's global ALL_COMP invariants.
      const allCompValue: CandidateValue = {
        featureKey: PROBE_FEATURE,
        teamId: second.gammaTeamId,
        asOf: MODULE_AS_OF,
        value: fromInt(70),
        sampleObservationCount: 6,
        consumed: [],
      };
      await writeValues(tx, registry, [allCompValue], MODULE_AS_OF); // default scope = ALL_COMPETITIONS
    });
  });

  after(async () => {
    await closeAllPools();
  });

  async function asModule<T>(fn: (tx: PoolClient, registry: Registry) => Promise<T>): Promise<T> {
    return withConnection(MODULE_ROLE, async (tx) => fn(tx, await loadRegistry(tx)));
  }
  async function inRolledBackModuleTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(MODULE_ROLE, async (tx) => {
      await tx.query('BEGIN');
      try {
        return await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  it('reads edition-scoped consumed features, isolated per edition', async () => {
    await asModule(async (tx) => {
      const e1 = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(world.editionId));
      // Edition 1 alpha: home 50.00 (4 matches), away 25.00 (4 matches).
      assert.equal(e1.get(consumedKey(HOME, world.alphaTeamId))!.sampleObservationCount, 4);
      assert.equal(e1.get(consumedKey(AWAY, world.alphaTeamId))!.sampleObservationCount, 4);
      const e2 = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(second.editionId));
      // Edition 2 alpha: home present (>10 wins), away ABSENT.
      assert.ok(e2.get(consumedKey(HOME, world.alphaTeamId)));
      assert.equal(e2.get(consumedKey(AWAY, world.alphaTeamId)), undefined, 'no away rate in edition 2');
    });
  });

  it('end-to-end NEUTRAL: edition 1 (disparity 25) persists reading + evidence + 2 items', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(world.editionId));
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of homeAwaySplit.inputFeatureKeys) teamInputs.set(k, consumedMap.get(consumedKey(k, world.alphaTeamId))!);
      const reading = assembleReading({
        calculator: homeAwaySplit, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: scoped(world.editionId), teamId: world.alphaTeamId, inputs: teamInputs,
      });
      assert.equal(reading.statusCode, 'NEUTRAL', 'disparity 25 < 40');
      assert.equal(reading.sampleObservationCount, 4);
      const res = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.module_status_code, r.strength, r.confidence, r.published_baseline_id,
                r.verdict_text, r.inactive_reason, r.subject_kind_code, r.subject_team_id::text AS team,
                r.context_kind_code, r.context_competition_edition_id::text AS ed,
                r.sample_observation_count, r.sample_meets_threshold,
                e.declared_input_count, e.present_input_count,
                (SELECT count(*)::int FROM module.module_evidence_item i
                   WHERE i.module_evidence_id = e.id AND i.reading_as_of = e.reading_as_of) AS items
           FROM module.module_reading r
           JOIN module.module_evidence e ON e.module_reading_id = r.id AND e.reading_as_of = r.as_of
          WHERE r.as_of = $1 AND r.subject_team_id = $2 AND r.context_competition_edition_id = $3`,
        [MODULE_AS_OF, world.alphaTeamId, world.editionId]
      );
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.module_status_code, 'NEUTRAL');
      assert.equal(row.strength, null);
      assert.equal(row.confidence, null);
      assert.equal(row.published_baseline_id, null);
      assert.equal(row.inactive_reason, null);
      assert.ok(row.verdict_text);
      assert.equal(row.subject_kind_code, 'TEAM');
      assert.equal(row.team, world.alphaTeamId);
      assert.equal(row.context_kind_code, 'COMPETITION_SCOPED');
      assert.equal(row.ed, world.editionId);
      assert.equal(row.sample_observation_count, 4);
      assert.equal(row.declared_input_count, 2);
      assert.equal(row.present_input_count, 2);
      assert.equal(row.items, 2);
    });
  });

  it('end-to-end INACTIVE: edition 2 (no away rate) is silent with a reason and no items', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(second.editionId));
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of homeAwaySplit.inputFeatureKeys) {
        const c = consumedMap.get(consumedKey(k, world.alphaTeamId));
        if (c) teamInputs.set(k, c);
      }
      const reading = assembleReading({
        calculator: homeAwaySplit, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: scoped(second.editionId), teamId: world.alphaTeamId, inputs: teamInputs,
      });
      assert.equal(reading.statusCode, 'INACTIVE');
      assert.equal(reading.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
      const res = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(res.written, 1, 'INACTIVE reading persists (satisfies inactive_is_silent + reason-iff-inactive)');
      const { rows } = await tx.query(
        `SELECT r.module_status_code, r.strength, r.inactive_reason, r.verdict_text,
                (SELECT count(*)::int FROM module.module_evidence_item i
                   JOIN module.module_evidence e ON e.id = i.module_evidence_id AND e.reading_as_of = i.reading_as_of
                  WHERE e.module_reading_id = r.id) AS items
           FROM module.module_reading r
          WHERE r.as_of = $1 AND r.subject_team_id = $2 AND r.context_competition_edition_id = $3`,
        [MODULE_AS_OF, world.alphaTeamId, second.editionId]
      );
      assert.equal(rows[0].module_status_code, 'INACTIVE');
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].inactive_reason, INACTIVE_REASON_FEATURE_ABSENT);
      assert.equal(rows[0].verdict_text, null);
      assert.equal(rows[0].items, 0);
    });
  });

  it('is idempotent: a second identical writeReading is skipped', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(world.editionId));
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of homeAwaySplit.inputFeatureKeys) teamInputs.set(k, consumedMap.get(consumedKey(k, world.alphaTeamId))!);
      const reading = assembleReading({
        calculator: homeAwaySplit, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: scoped(world.editionId), teamId: world.alphaTeamId, inputs: teamInputs,
      });
      const first = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      const again = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(first.written, 1);
      assert.equal(again.written, 0);
      assert.equal(again.skipped, 1);
    });
  });

  it('the module write creates no ALL_COMPETITIONS feature rows (feature path untouched)', async () => {
    await asModule(async (tx) => {
      // Alpha carries no ALL_COMPETITIONS feature value (the E-i probe is on the
      // dedicated gamma team), so the module layer having written none is exact.
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM feature.feature_value
          WHERE subject_team_id = $1 AND as_of = $2 AND context_kind_code = 'ALL_COMPETITIONS'`,
        [world.alphaTeamId, MODULE_AS_OF]
      );
      assert.equal(rows[0].n, 0);
    });
  });

  it('reconciliation: an unregistered module calculator is refused', async () => {
    const ghost = { ...homeAwaySplit, moduleKey: 'not_a_module' };
    await assert.rejects(
      runModulePipeline({ now: MODULE_AS_OF, calculators: [ghost], dryRun: true, replayFrom: MODULE_AS_OF, replayTo: MODULE_AS_OF }),
      /not a registered module/
    );
  });

  // ── Gate E-i: the ALL_COMPETITIONS × TEAM path, and coexistence ──────────────

  it('E-i: reads ALL_COMPETITIONS features (edition NULL), not edition-scoped ones', async () => {
    await asModule(async (tx) => {
      // Gamma has an ALL_COMP probe value; reading at ALL_COMPETITIONS finds it.
      const allComp = await readConsumedFeatures(
        tx, [PROBE_FEATURE], [second.gammaTeamId], MODULE_AS_OF, ALL_COMPETITIONS_SCOPE
      );
      assert.ok(allComp.get(consumedKey(PROBE_FEATURE, second.gammaTeamId)), 'ALL_COMP probe value is read');
      // The scoped venue rate (Alpha, edition 1) is NOT visible to an ALL_COMP read…
      const allCompVenue = await readConsumedFeatures(
        tx, [HOME], [world.alphaTeamId], MODULE_AS_OF, ALL_COMPETITIONS_SCOPE
      );
      assert.equal(allCompVenue.get(consumedKey(HOME, world.alphaTeamId)), undefined, 'edition-scoped value invisible to ALL_COMP read');
      // …and the ALL_COMP probe value is NOT visible to an edition-scoped read.
      const scopedProbe = await readConsumedFeatures(
        tx, [PROBE_FEATURE], [second.gammaTeamId], MODULE_AS_OF, scoped(world.editionId)
      );
      assert.equal(scopedProbe.get(consumedKey(PROBE_FEATURE, second.gammaTeamId)), undefined, 'ALL_COMP value invisible to scoped read');
    });
  });

  it('E-i: end-to-end ALL_COMPETITIONS reading persists with NULL edition + evidence citing the ALL_COMP value', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!; // any TEAM def; the probe is a throwaway
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(
        tx, allCompProbe.inputFeatureKeys, [second.gammaTeamId], MODULE_AS_OF, ALL_COMPETITIONS_SCOPE
      );
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of allCompProbe.inputFeatureKeys) teamInputs.set(k, consumedMap.get(consumedKey(k, second.gammaTeamId))!);
      const reading = assembleReading({
        calculator: allCompProbe, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: second.gammaTeamId, inputs: teamInputs,
      });
      assert.equal(reading.statusCode, 'SUPPORTS', 'probe: home_form 70 >= 50');
      assert.equal(reading.contextKindCode, CALCULATION_CONTEXT_KIND);
      assert.equal(reading.contextEditionId, null);
      const res = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.context_kind_code, r.context_competition_edition_id AS ed, r.module_status_code,
                r.strength, r.confidence, r.published_baseline_id,
                (SELECT count(*)::int FROM module.module_evidence_item i
                   JOIN module.module_evidence e ON e.id = i.module_evidence_id AND e.reading_as_of = i.reading_as_of
                  WHERE e.module_reading_id = r.id
                    AND i.cited_feature_value_id = (
                      SELECT fv.id FROM feature.feature_value fv
                        JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
                       WHERE d.feature_key = $4 AND fv.subject_team_id = $2 AND fv.as_of = $3
                         AND fv.context_kind_code = 'ALL_COMPETITIONS')) AS items_citing_allcomp
           FROM module.module_reading r
          WHERE r.as_of = $1 AND r.subject_team_id = $2 AND r.context_kind_code = 'ALL_COMPETITIONS'`,
        [MODULE_AS_OF, second.gammaTeamId, MODULE_AS_OF, PROBE_FEATURE]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].context_kind_code, 'ALL_COMPETITIONS');
      assert.equal(rows[0].ed, null, 'ALL_COMPETITIONS reading carries NULL edition — impossible under the Gate D hardcoding');
      assert.equal(rows[0].module_status_code, 'SUPPORTS');
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].published_baseline_id, null);
      assert.equal(rows[0].items_citing_allcomp, 1, 'evidence cites the ALL_COMPETITIONS feature value');
    });
  });

  it('E-i: an absent ALL_COMPETITIONS input is INACTIVE (beta has no probe value)', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(
        tx, allCompProbe.inputFeatureKeys, [world.betaTeamId], MODULE_AS_OF, ALL_COMPETITIONS_SCOPE
      );
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of allCompProbe.inputFeatureKeys) {
        const c = consumedMap.get(consumedKey(k, world.betaTeamId));
        if (c) teamInputs.set(k, c);
      }
      const reading = assembleReading({
        calculator: allCompProbe, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: world.betaTeamId, inputs: teamInputs,
      });
      assert.equal(reading.statusCode, 'INACTIVE');
      assert.equal(reading.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
      assert.equal(reading.contextEditionId, null);
      const res = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(res.written, 1, 'INACTIVE ALL_COMPETITIONS reading persists (NULL edition satisfies the conditional check)');
    });
  });

  it('E-i: ALL_COMPETITIONS and COMPETITION_SCOPED readings coexist for the same team/as_of/definition', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      // Scoped reading (real home_away_split, edition 1).
      const scopedInputsMap = await readConsumedFeatures(tx, [HOME, AWAY], [world.alphaTeamId], MODULE_AS_OF, scoped(world.editionId));
      const scopedInputs = new Map<string, ConsumedFeature>();
      for (const k of homeAwaySplit.inputFeatureKeys) scopedInputs.set(k, scopedInputsMap.get(consumedKey(k, world.alphaTeamId))!);
      const scopedReading = assembleReading({
        calculator: homeAwaySplit, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: scoped(world.editionId), teamId: world.alphaTeamId, inputs: scopedInputs,
      });
      // ALL_COMP reading for the SAME def/team/as_of/version. Alpha carries no
      // ALL_COMP input (the probe value is on gamma), so this reading is INACTIVE
      // — which is all coexistence needs: it differs only in context from the
      // scoped reading and must not collide with it.
      const allCompReading = assembleReading({
        calculator: allCompProbe, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: world.alphaTeamId,
        inputs: new Map<string, ConsumedFeature>(),
      });
      assert.equal(allCompReading.statusCode, 'INACTIVE');

      const a = await writeReading(tx, { ...scopedReading, calculatedAt: MODULE_AS_OF });
      const b = await writeReading(tx, { ...allCompReading, calculatedAt: MODULE_AS_OF });
      assert.equal(a.written, 1, 'scoped reading written');
      assert.equal(b.written, 1, 'ALL_COMP reading written — no collision with the scoped one');
      const { rows } = await tx.query(
        `SELECT context_kind_code, context_competition_edition_id::text AS ed
           FROM module.module_reading
          WHERE as_of = $1 AND subject_team_id = $2 AND module_definition_id = $3 AND module_version_id = $4
          ORDER BY context_kind_code`,
        [MODULE_AS_OF, world.alphaTeamId, def.moduleDefinitionId, version!.moduleVersionId]
      );
      assert.equal(rows.length, 2, 'both scopes coexist for the same subject/def/as_of/version');
      assert.deepEqual(rows.map((r: { context_kind_code: string }) => r.context_kind_code), ['ALL_COMPETITIONS', 'COMPETITION_SCOPED']);
      assert.equal(rows.find((r: { context_kind_code: string }) => r.context_kind_code === 'ALL_COMPETITIONS')!.ed, null);
      assert.equal(rows.find((r: { context_kind_code: string }) => r.context_kind_code === 'COMPETITION_SCOPED')!.ed, world.editionId);
    });
  });

  it('E-i: ALL_COMPETITIONS reading is idempotent on rerun', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('home_away_split')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, MODULE_AS_OF);
      const consumedMap = await readConsumedFeatures(tx, allCompProbe.inputFeatureKeys, [second.gammaTeamId], MODULE_AS_OF, ALL_COMPETITIONS_SCOPE);
      const teamInputs = new Map<string, ConsumedFeature>();
      for (const k of allCompProbe.inputFeatureKeys) teamInputs.set(k, consumedMap.get(consumedKey(k, second.gammaTeamId))!);
      const reading = assembleReading({
        calculator: allCompProbe, definition: def, version: version!,
        asOf: MODULE_AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: second.gammaTeamId, inputs: teamInputs,
      });
      const first = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      const again = await writeReading(tx, { ...reading, calculatedAt: MODULE_AS_OF });
      assert.equal(first.written, 1);
      assert.equal(again.written, 0);
      assert.equal(again.skipped, 1);
    });
  });

  it('E-i: runModulePipeline routes by declared contextKind (ALL_COMP probe → ALL_COMP enumerator)', async () => {
    // dryRun: no writes. An ALL_COMPETITIONS probe must enumerate via selectBatches
    // and complete without failures — impossible if the engine were hardwired to
    // the scoped enumerator only (Gate D). Contrast with the scoped calculator.
    const allCompReport = await runModulePipeline({
      now: MODULE_AS_OF, calculators: [allCompProbe], dryRun: true,
      replayFrom: new Date('2026-07-01T00:00:00Z'), replayTo: new Date('2027-03-01T00:00:00Z'),
    });
    assert.equal(allCompReport.failures, 0, 'ALL_COMP probe routed and ran without failure');
    assert.ok(allCompReport.batches > 0, 'ALL_COMP enumerator produced batches');

    const scopedReport = await runModulePipeline({
      now: MODULE_AS_OF, calculators: [homeAwaySplit], dryRun: true,
      replayFrom: new Date('2026-07-01T00:00:00Z'), replayTo: new Date('2027-03-01T00:00:00Z'),
    });
    assert.equal(scopedReport.failures, 0, 'scoped calculator routed and ran without failure');
    assert.ok(scopedReport.batches > 0, 'scoped enumerator produced batches');
  });
});
