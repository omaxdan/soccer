// ─────────────────────────────────────────────────────────────────────────────
// S-6 readiness_tracker — the second module, first TEAM × ALL_COMPETITIONS consumer
//
// PURE tests pin the ±10 status rule (transcribed from V1 classifyTrend, not the
// broken string comparison), the CONTRADICTS branch, and INACTIVE/zero handling.
// DB tests prove the end-to-end ALL_COMPETITIONS chain through the UNCHANGED E-i
// engine: read team.momentum (edition NULL) → assemble → write, with evidence,
// NULL strength/confidence/baseline, idempotency, team isolation, and no scoped
// reading.
//
// V1 golden: the numeric classifyTrend semantics are carried across, so V1-derived
// classification cases are valid (S-0-c-i). The broken V1 evaluator (which compares
// "SURGING (+12)" against "Surging" and thus always yields neutral) is explicitly
// regression-tested as NOT reproduced.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { seedFeatureRegistry } from '../../seed/featureRegistry';
import {
  CALCULATION_CONTEXT_KIND,
  ALL_COMPETITIONS_SCOPE,
  type CandidateValue,
} from '../../feature/calculators/types';
import { fromInt, type Exact } from '../../feature/write/scale';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { upsertMutable } from '../../ingestion/write/index';

import { readinessTracker } from '../calculators/readinessTracker';
import { assembleReading, INACTIVE_REASON_FEATURE_ABSENT, MODULE_CALCULATORS } from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { consumedKey, readConsumedFeatures } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import type { ConsumedFeature } from '../types';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

const MOMENTUM = 'team.momentum';
const AS_OF = new Date('2027-05-01T00:00:00Z'); // dedicated instant

// ─── the pure calculator + assembly ──────────────────────────────────────────

function momentumInput(value: Exact, count = 10, id = 'M'): Map<string, ConsumedFeature> {
  return new Map([[MOMENTUM, { featureKey: MOMENTUM, valueId: id, asOf: AS_OF, value, sampleObservationCount: count }]]);
}
function statusOf(value: Exact): string {
  return readinessTracker.evaluate(momentumInput(value)).status;
}

const DEF = {
  moduleKey: 'readiness_tracker',
  moduleDefinitionId: '1',
  subjectKindCode: 'TEAM',
  calibrationModeCode: 'OUTCOME_SCORED',
  outcomeDimensionCode: 'MATCH_RESULT',
  isActive: true,
};
const VERSION = { moduleVersionId: '20', designation: '1.0.0', minimumSampleObservationCount: 0 };

function assembleFor(inputs: Map<string, ConsumedFeature>) {
  return assembleReading({
    calculator: readinessTracker,
    definition: DEF,
    version: VERSION,
    asOf: AS_OF,
    scope: ALL_COMPETITIONS_SCOPE,
    teamId: '100',
    inputs,
  });
}

describe('readiness_tracker — pure status rule and assembly', () => {
  it('1. momentum +10 → SUPPORTS', () => assert.equal(statusOf(fromInt(10)), 'SUPPORTS'));
  it('2. momentum -10 → CONTRADICTS', () => assert.equal(statusOf(fromInt(-10)), 'CONTRADICTS'));
  it('3. momentum +9 → NEUTRAL', () => assert.equal(statusOf(fromInt(9)), 'NEUTRAL'));
  it('4. momentum -9 → NEUTRAL', () => assert.equal(statusOf(fromInt(-9)), 'NEUTRAL'));
  it('5. momentum 0 → NEUTRAL', () => assert.equal(statusOf(fromInt(0)), 'NEUTRAL'));
  it('6. large positive (+15) → SUPPORTS', () => assert.equal(statusOf(fromInt(15)), 'SUPPORTS'));
  it('7. large negative (-15) → CONTRADICTS', () => assert.equal(statusOf(fromInt(-15)), 'CONTRADICTS'));
  it('8. exact positive boundary +10 is SUPPORTS, +9 is not', () => {
    assert.equal(statusOf(fromInt(10)), 'SUPPORTS');
    assert.equal(statusOf(fromInt(9)), 'NEUTRAL');
  });
  it('9. exact negative boundary -10 is CONTRADICTS, -9 is not', () => {
    assert.equal(statusOf(fromInt(-10)), 'CONTRADICTS');
    assert.equal(statusOf(fromInt(-9)), 'NEUTRAL');
  });

  it('is deterministic and declares its input (D-3): team.momentum, TEAM, ALL_COMPETITIONS', () => {
    assert.deepEqual(
      readinessTracker.evaluate(momentumInput(fromInt(12))),
      readinessTracker.evaluate(momentumInput(fromInt(12)))
    );
    assert.deepEqual([...readinessTracker.inputFeatureKeys], [MOMENTUM]);
    assert.equal(readinessTracker.subjectKind, 'TEAM');
    assert.equal(readinessTracker.contextKind, CALCULATION_CONTEXT_KIND);
  });

  it('24. V1 golden: +12 → SURGING → SUPPORTS; -12 → CRASHING → CONTRADICTS; +3 → steady → NEUTRAL', () => {
    assert.equal(statusOf(fromInt(12)), 'SUPPORTS');
    assert.equal(statusOf(fromInt(-12)), 'CONTRADICTS');
    assert.equal(statusOf(fromInt(3)), 'NEUTRAL');
  });
  it('25. broken-V1-string regression: +12 is SUPPORTS, NOT the always-neutral of evalReadinessTracker', () => {
    // V1 compared classifyTrend(...).trend ("SURGING (+12)") against "Surging" and
    // never matched, collapsing to neutral. The V2 rule follows the numeric ±10.
    const f = readinessTracker.evaluate(momentumInput(fromInt(12)));
    assert.equal(f.status, 'SUPPORTS');
    assert.notEqual(f.status, 'NEUTRAL', 'must not reproduce the broken always-neutral evaluator');
    assert.match(f.verdictText, /Surging/);
  });

  // ── assembly ────────────────────────────────────────────────────────────────

  it('14+15+16+17+18. valid input → engaged reading, one evidence item, inherited sample, NULLs', () => {
    const r = assembleFor(momentumInput(fromInt(15), 10, 'MV'));
    assert.equal(r.statusCode, 'SUPPORTS');
    assert.equal(r.contextKindCode, CALCULATION_CONTEXT_KIND);
    assert.equal(r.contextEditionId, null);
    assert.equal(r.inactiveReason, null);
    assert.equal(r.declaredInputCount, 1);
    assert.equal(r.presentInputCount, 1);
    assert.equal(r.sampleObservationCount, 10, 'D-5c-i: non-composite input count passes through');
    assert.equal(r.evidenceItems.length, 1, 'exactly one consumed feature cited');
    assert.equal(r.evidenceItems[0].citedFeatureValueId, 'MV');
    assert.equal(r.evidenceItems[0].contributionDirection, 'SUPPORTS');
    // strength/confidence/baseline are NULL at 1.0.0 — enforced by writeReading,
    // and assembleReading carries no such fields (they are hard-NULL in the write).
  });
  it('10+11+12. missing team.momentum → INACTIVE, FEATURE_ABSENT, no evidence, sample 0', () => {
    const r = assembleFor(new Map());
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.verdictText, null);
    assert.equal(r.presentInputCount, 0);
    assert.equal(r.declaredInputCount, 1);
    assert.equal(r.sampleObservationCount, 0);
    assert.equal(r.evidenceItems.length, 0);
  });
  it('13. zero momentum after ten matches is NEUTRAL, engaged — NOT INACTIVE', () => {
    const r = assembleFor(momentumInput(fromInt(0), 10));
    assert.equal(r.statusCode, 'NEUTRAL');
    assert.equal(r.presentInputCount, 1, 'a real 0 delta is present, not absent');
    assert.equal(r.inactiveReason, null);
    assert.equal(r.evidenceItems.length, 1);
  });

  it('26. MODULE_CALCULATORS holds exactly the authorized modules', () => {
    assert.deepEqual(
      [...MODULE_CALCULATORS.map((c) => c.moduleKey)].sort(),
      // S-9C added the two magnitude modules (TEAM × ALL_COMPETITIONS).
      ['consistency_index', 'giant_killer_index', 'home_away_split', 'readiness_tracker']
    );
  });
});

// ─── DB: the ALL_COMPETITIONS read → assemble → write chain (E-i engine) ─────

// Dedicated teams (no fixtures) whose momentum is committed synthetically, so the
// classification is exact and no shared team is touched.
const RT_PREFIX = 'S6RT';
type Band = 'surge' | 'crash' | 'steady' | 'zero' | 'absent';
const RT_MOMENTUM: Record<Exclude<Band, 'absent'>, number> = { surge: 15, crash: -12, steady: 5, zero: 0 };

describe('readiness_tracker against the DB (E-i ALL_COMPETITIONS routing)', { skip: !hasDatabase }, () => {
  const teamIds = new Map<Band, string>();

  before(async () => {
    // team.momentum must exist in the registry (idempotent).
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    // Seed dedicated teams (a shared venue; the teams play no fixtures).
    await withConnection(INGESTION_ROLE, async (tx) => {
      const venue = await upsertMutable(tx, {
        relation: 'football.venue',
        columns: ['provider_external_id', 'name', 'country_code'],
        values: [`${RT_PREFIX}-V`, 'Readiness Park', 'GB'],
        conflictTarget: ['provider_external_id'],
      });
      for (const band of ['surge', 'crash', 'steady', 'zero', 'absent'] as Band[]) {
        const team = await upsertMutable(tx, {
          relation: 'football.team',
          columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
          values: [PROVIDER_CODE, `${RT_PREFIX}-T-${band}`, `RT ${band}`, `${RT_PREFIX}-t-${band}`.toLowerCase(), 'GB', venue.id],
          conflictTarget: ['provider_code', 'provider_external_id'],
        });
        teamIds.set(band, String(team.id));
      }
    });
    // Commit ALL_COMPETITIONS team.momentum for every band except 'absent'.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const candidates: CandidateValue[] = (['surge', 'crash', 'steady', 'zero'] as const).map((band) => ({
        featureKey: MOMENTUM,
        teamId: teamIds.get(band)!,
        asOf: AS_OF,
        value: fromInt(RT_MOMENTUM[band]),
        sampleObservationCount: 10,
        consumed: [],
      }));
      await writeValues(tx, registry, candidates, AS_OF); // default scope = ALL_COMPETITIONS
    });
  });

  after(async () => {
    await closeAllPools();
  });

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

  async function readingFor(tx: PoolClient, band: Band) {
    const registry = await loadModuleRegistry(tx);
    const def = registry.definitionsByKey.get('readiness_tracker')!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
    const teamId = teamIds.get(band)!;
    const consumedMap = await readConsumedFeatures(tx, readinessTracker.inputFeatureKeys, [teamId], AS_OF, ALL_COMPETITIONS_SCOPE);
    const inputs = new Map<string, ConsumedFeature>();
    for (const k of readinessTracker.inputFeatureKeys) {
      const c = consumedMap.get(consumedKey(k, teamId));
      if (c) inputs.set(k, c);
    }
    const reading = assembleReading({
      calculator: readinessTracker, definition: def, version: version!,
      asOf: AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId, inputs,
    });
    return { reading, def, version: version!, teamId };
  }

  it('resolves version and reads team.momentum at ALL_COMPETITIONS', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('readiness_tracker')!;
      assert.equal(def.subjectKindCode, 'TEAM');
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
      assert.ok(version, 'a module version covers as_of (as_of/version resolution)');
      const consumed = await readConsumedFeatures(tx, [MOMENTUM], [teamIds.get('surge')!], AS_OF, ALL_COMPETITIONS_SCOPE);
      assert.ok(consumed.get(consumedKey(MOMENTUM, teamIds.get('surge')!)), 'ALL_COMP momentum is read');
    });
  });

  it('19+20. end-to-end SUPPORTS: persists ALL_COMPETITIONS reading with NULL edition, one evidence item, NULLs', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading, teamId } = await readingFor(tx, 'surge');
      assert.equal(reading.statusCode, 'SUPPORTS');
      const res = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.context_kind_code, r.context_competition_edition_id AS ed, r.module_status_code,
                r.strength, r.confidence, r.published_baseline_id, r.subject_kind_code,
                r.sample_observation_count, r.verdict_text, r.inactive_reason,
                (SELECT count(*)::int FROM module.module_evidence e
                   JOIN module.module_evidence_item i
                     ON i.module_evidence_id = e.id AND i.reading_as_of = e.reading_as_of
                  WHERE e.module_reading_id = r.id
                    AND i.cited_feature_value_id = (
                      SELECT fv.id FROM feature.feature_value fv
                        JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
                       WHERE d.feature_key = $3 AND fv.subject_team_id = $2 AND fv.as_of = $1
                         AND fv.context_kind_code = 'ALL_COMPETITIONS')) AS items_citing_momentum
           FROM module.module_reading r
          WHERE r.as_of = $1 AND r.subject_team_id = $2`,
        [AS_OF, teamId, MOMENTUM]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].context_kind_code, 'ALL_COMPETITIONS');
      assert.equal(rows[0].ed, null, 'ALL_COMPETITIONS reading carries NULL edition; no COMPETITION_SCOPED reading');
      assert.equal(rows[0].module_status_code, 'SUPPORTS');
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].published_baseline_id, null);
      assert.equal(rows[0].subject_kind_code, 'TEAM');
      assert.equal(rows[0].sample_observation_count, 10);
      assert.ok(rows[0].verdict_text);
      assert.equal(rows[0].inactive_reason, null);
      assert.equal(rows[0].items_citing_momentum, 1);
    });
  });

  it('end-to-end CONTRADICTS: a crashing team persists a CONTRADICTS reading', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading, teamId } = await readingFor(tx, 'crash');
      assert.equal(reading.statusCode, 'CONTRADICTS');
      const res = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT module_status_code FROM module.module_reading WHERE as_of = $1 AND subject_team_id = $2`,
        [AS_OF, teamId]
      );
      assert.equal(rows[0].module_status_code, 'CONTRADICTS');
    });
  });

  it('end-to-end NEUTRAL vs zero: steady (+5) and zero (0) are both engaged NEUTRAL, never INACTIVE', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const steady = await readingFor(tx, 'steady');
      const zero = await readingFor(tx, 'zero');
      assert.equal(steady.reading.statusCode, 'NEUTRAL');
      assert.equal(zero.reading.statusCode, 'NEUTRAL');
      assert.equal(zero.reading.inactiveReason, null, 'zero momentum is a real NEUTRAL, not absent');
      assert.equal(zero.reading.presentInputCount, 1);
    });
  });

  it('end-to-end INACTIVE: a team with no committed momentum is silent with FEATURE_ABSENT and no items', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading, teamId } = await readingFor(tx, 'absent');
      assert.equal(reading.statusCode, 'INACTIVE');
      assert.equal(reading.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
      const res = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(res.written, 1, 'INACTIVE reading persists');
      const { rows } = await tx.query(
        `SELECT r.module_status_code, r.inactive_reason, r.verdict_text,
                (SELECT count(*)::int FROM module.module_evidence_item i
                   JOIN module.module_evidence e ON e.id = i.module_evidence_id AND e.reading_as_of = i.reading_as_of
                  WHERE e.module_reading_id = r.id) AS items
           FROM module.module_reading r WHERE r.as_of = $1 AND r.subject_team_id = $2`,
        [AS_OF, teamId]
      );
      assert.equal(rows[0].module_status_code, 'INACTIVE');
      assert.equal(rows[0].inactive_reason, INACTIVE_REASON_FEATURE_ABSENT);
      assert.equal(rows[0].verdict_text, null);
      assert.equal(rows[0].items, 0);
    });
  });

  it('21+22. idempotent rerun, and teams are isolated', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await readingFor(tx, 'surge');
      const first = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      const again = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(first.written, 1);
      assert.equal(again.written, 0);
      assert.equal(again.skipped, 1);
      // A different team's reading does not collide with surge's.
      const crash = await readingFor(tx, 'crash');
      const other = await writeReading(tx, { ...crash.reading, calculatedAt: AS_OF });
      assert.equal(other.written, 1, 'a different team writes independently');
    });
  });
});
