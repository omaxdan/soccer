// ─────────────────────────────────────────────────────────────────────────────
// S-5 FEATURE CALCULATION TESTS
//
// Eight classes, following the S-1…S-4 pattern:
//
//   DECLARATION   no database. Exact arithmetic, ordering, provenance, purity.
//   UNIT          calculators against synthetic contexts — where the V1 formulae
//                 are pinned to exact expected numbers.
//   DATABASE      real reads and writes against the real schema.
//   PRIVILEGE     the posture proven against the live catalogue, not the register.
//   LIFECYCLE     append-only refusals.
//   LEAKAGE       S-5's hardest guarantee: no value sees past its own `as_of`.
//   REPLAY        R-2, both scenarios.
//   MUTATION      six, each breaking a guarantee nothing else would reveal.
//
// The database half SKIPS when no V2 database is configured, so V2 work never
// blocks V1 work.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';

import {
  add,
  compare,
  divide,
  fromInt,
  fromString,
  multiply,
  rescale,
  roundHalfUp,
  subtract,
  toNumericString,
  WORKING_SCALE,
  type Exact,
} from '../write/scale';
import { resolve as resolveProvenance } from '../write/provenance';
import { writeValues } from '../write/values';
import { writeLineage } from '../write/lineage';
import {
  deriveExecutionPlan,
  findFeatureCycle,
  DependencyCycleError,
} from '../registry/order';
import { declareRegistryInputs, FEATURE_SOURCES, FEATURE_DEPENDENCIES } from '../registry/declare';
import { loadRegistry, assertCalculatorCoverage, type FeatureDefinition, type Registry } from '../registry/load';
import { deriveAsOf, selectBatches } from '../driver/eligibility';
import { readCompletedFixtures } from '../read/fixtures';
import { readHomeVenues, readVenueLocations } from '../read/venues';
import { readPriorValues } from '../read/featureValues';
import { runVerification, VERIFICATIONS } from '../verify';
import { formBackfill } from '../calculators/formBackfill';
import { fixtureLoad } from '../calculators/fixtureLoad';
import { travelLoad } from '../calculators/travelLoad';
import { teamReadiness } from '../calculators/teamReadiness';
import { CALCULATORS } from '../pipeline';
import {
  CALCULATION_CONTEXT_KIND,
  priorValueKey,
  type CalculationContext,
  type CandidateValue,
  type CompletedFixture,
  type ConsumedValueRef,
} from '../calculators/types';
import { parseArguments } from '../cli';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { seedWorld, REFERENCE_AS_OF, TEST_PREFIX, type SeededWorld } from './fixtures';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const FEATURE_DIR = join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The six features S-5 implements. Stated once so tests do not drift apart. */
const IMPLEMENTED_FEATURES = [
  'team.away_form',
  'team.congestion_index',
  'team.home_form',
  'team.readiness_score',
  'team.rest_advantage',
  'team.travel_impact',
] as const;

function definition(overrides: Partial<FeatureDefinition> & { featureKey: string }): FeatureDefinition {
  return {
    id: `id-${overrides.featureKey}`,
    subjectKindCode: 'TEAM',
    unit: 'index',
    valueScale: 2,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenanceClassCode: 'DERIVED',
    meaningfulSampleThreshold: 3,
    isActive: true,
    calculatorId: 'calc',
    calculatorKey: 'calc',
    versionId: `version-${overrides.featureKey}`,
    versionDesignation: '1.0.0',
    contextKinds: [CALCULATION_CONTEXT_KIND],
    ...overrides,
  };
}

function syntheticRegistry(
  definitions: readonly FeatureDefinition[],
  dependencies: Registry['dependencies'] = []
): Registry {
  return {
    definitionsByKey: new Map(definitions.map((d) => [d.featureKey, d])),
    snapshotPoints: [],
    dependencies,
    provenanceRankByCode: new Map([
      ['ESTIMATED', 1],
      ['INFERRED', 2],
      ['DERIVED', 3],
      ['OBSERVED', 4],
    ]),
  };
}

function fixture(overrides: Partial<CompletedFixture> & { kickoffAt: Date }): CompletedFixture {
  return {
    fixtureId: 'f1',
    fixturePartitionOn: overrides.kickoffAt.toISOString().slice(0, 10),
    isHome: true,
    goalsFor: 1,
    goalsAgainst: 0,
    venueId: null,
    ...overrides,
  };
}

function context(overrides: Partial<CalculationContext>): CalculationContext {
  return {
    definitions: new Map(),
    subjects: [],
    fixturesByTeam: new Map(),
    homeVenueByTeam: new Map(),
    venuesById: new Map(),
    priorValues: new Map(),
    ...overrides,
  };
}

function consumed(overrides: Partial<ConsumedValueRef> & { featureKey: string; value: Exact }): ConsumedValueRef {
  return {
    valueId: '1',
    asOf: REFERENCE_AS_OF,
    provenanceClassCode: 'DERIVED',
    sampleObservationCount: 5,
    ...overrides,
  };
}

/** Reads a source file, for the purity and conflict-target scans. */
function sourceOf(relativePath: string): string {
  return readFileSync(join(FEATURE_DIR, relativePath), 'utf8');
}

/** Source with comments stripped, so prose about a construct is not a match. */
function codeOf(relativePath: string): string {
  return sourceOf(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// A — Exact arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe('exact arithmetic', () => {
  it('1. parses a decimal literal without loss', () => {
    assert.equal(toNumericString(fromString('123.45')), '123.45');
    assert.equal(toNumericString(fromString('0.1')), '0.1');
    assert.equal(toNumericString(fromString('-7.250')), '-7.250');
  });

  it('2. refuses anything that is not an exact decimal literal', () => {
    // There is deliberately no `fromNumber`: accepting a double would let 0.1
    // enter already wrong, and no later exactness would recover it.
    for (const bad of ['1e5', 'NaN', '', '1.2.3', '0x10']) {
      assert.throws(() => fromString(bad), RangeError, `'${bad}' must be refused`);
    }
  });

  it('3. adds without the classic floating-point error', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754. Calibration compares stored values for
    // equality, so this is the whole reason PD-06 forbids binary floating point.
    const sum = add(fromString('0.1'), fromString('0.2'));
    assert.equal(toNumericString(sum), '0.3');
    assert.equal(compare(sum, fromString('0.3')), 0);
  });

  it('4. multiplies exactly, widening the scale', () => {
    const product = multiply(fromString('1.05'), fromString('1.05'));
    assert.equal(toNumericString(product), '1.1025');
  });

  it('5. subtracts across differing scales', () => {
    assert.equal(toNumericString(subtract(fromInt(100), fromString('12.5'))), '87.5');
  });

  it('6. divides at working scale', () => {
    const third = divide(fromInt(1), fromInt(3));
    assert.equal(third.scale, WORKING_SCALE);
    assert.ok(toNumericString(third).startsWith('0.333333333'));
  });

  it('7. refuses division by zero rather than substituting', () => {
    assert.throws(() => divide(fromInt(1), fromInt(0)), RangeError);
  });

  it('8. rounds half-up, not half-even', () => {
    assert.equal(toNumericString(roundHalfUp(fromString('2.345'), 2)), '2.35');
    assert.equal(toNumericString(roundHalfUp(fromString('2.355'), 2)), '2.36');
    // Half-even would give 2.34 for the first. Banker's rounding is a different
    // rule and would silently change every boundary value.
    assert.notEqual(toNumericString(roundHalfUp(fromString('2.345'), 2)), '2.34');
  });

  it('9. rounds half away from zero for negatives', () => {
    assert.equal(toNumericString(roundHalfUp(fromString('-2.345'), 2)), '-2.35');
  });

  it('10. refuses to narrow a scale silently', () => {
    // `rescale` widens only. Narrowing must go through roundHalfUp, which says
    // that it is rounding — otherwise a caller could discard digits with a
    // function whose name suggests it merely re-expresses the value.
    assert.throws(() => rescale(fromString('1.234'), 2), RangeError);
    assert.equal(rescale(fromString('1.2'), 4).scale, 4);
    assert.equal(roundHalfUp(fromString('1.234'), 2).scale, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — Execution ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('execution ordering', () => {
  const registryWithoutEdges = syntheticRegistry([
    definition({ featureKey: 'team.a', calculatorKey: 'zebra' }),
    definition({ featureKey: 'team.b', calculatorKey: 'alpha' }),
    definition({ featureKey: 'team.c', calculatorKey: 'mike' }),
  ]);

  it('11. puts independent calculators in one stage, ascending by key', () => {
    const plan = deriveExecutionPlan(registryWithoutEdges, ['zebra', 'alpha', 'mike']);
    assert.equal(plan.stages.length, 1);
    // R-2 obligation 4: ties break by calculator_key ascending. Iteration order
    // over a Set is a runtime detail and would give a different valid order on a
    // different day, breaking the replay guarantee.
    assert.deepEqual(plan.stages[0].calculatorKeys, ['alpha', 'mike', 'zebra']);
  });

  it('12. derives a second stage from a declared edge', () => {
    const registry = syntheticRegistry(
      [
        definition({ featureKey: 'team.a', calculatorKey: 'zebra' }),
        definition({ featureKey: 'team.b', calculatorKey: 'alpha' }),
      ],
      [
        {
          consumerFeatureKey: 'team.a',
          consumedFeatureKey: 'team.b',
          consumerContextKindCode: CALCULATION_CONTEXT_KIND,
          consumedContextKindCode: CALCULATION_CONTEXT_KIND,
        },
      ]
    );
    const plan = deriveExecutionPlan(registry, ['zebra', 'alpha']);
    assert.deepEqual(plan.stages.map((s) => s.calculatorKeys), [['alpha'], ['zebra']]);
  });

  it('13. is stable across repeated calls', () => {
    const first = deriveExecutionPlan(registryWithoutEdges, ['zebra', 'alpha', 'mike']);
    const second = deriveExecutionPlan(registryWithoutEdges, ['mike', 'zebra', 'alpha']);
    assert.deepEqual(first.sequence, second.sequence);
  });

  it('14. raises on a cycle rather than emitting a partial order', () => {
    const registry = syntheticRegistry(
      [
        definition({ featureKey: 'team.a', calculatorKey: 'one' }),
        definition({ featureKey: 'team.b', calculatorKey: 'two' }),
      ],
      [
        { consumerFeatureKey: 'team.a', consumedFeatureKey: 'team.b', consumerContextKindCode: 'X', consumedContextKindCode: 'X' },
        { consumerFeatureKey: 'team.b', consumedFeatureKey: 'team.a', consumerContextKindCode: 'X', consumedContextKindCode: 'X' },
      ]
    );
    assert.throws(() => deriveExecutionPlan(registry, ['one', 'two']), DependencyCycleError);
  });

  it('15. detects a feature-level cycle for the acyclicity control', () => {
    const cycle = findFeatureCycle([
      { consumerFeatureKey: 'team.a', consumedFeatureKey: 'team.b', consumerContextKindCode: 'X', consumedContextKindCode: 'X' },
      { consumerFeatureKey: 'team.b', consumedFeatureKey: 'team.a', consumerContextKindCode: 'X', consumedContextKindCode: 'X' },
    ]);
    assert.ok(cycle, 'a cycle must be reported');
    assert.equal(findFeatureCycle(FEATURE_DEPENDENCIES.map((edge) => ({
      consumerFeatureKey: edge.consumer,
      consumedFeatureKey: edge.consumed,
      consumerContextKindCode: CALCULATION_CONTEXT_KIND,
      consumedContextKindCode: CALCULATION_CONTEXT_KIND,
    }))), null, 'the declared S-5 graph must be acyclic');
  });

  it('16. ignores edges touching an unimplemented calculator', () => {
    // team.squad_stability is registered and never calculated (R-1). An edge
    // touching it must not block the plan.
    const registry = syntheticRegistry(
      [
        definition({ featureKey: 'team.a', calculatorKey: 'implemented' }),
        definition({ featureKey: 'team.squad_stability', calculatorKey: 'squad_continuity' }),
      ],
      [
        {
          consumerFeatureKey: 'team.a',
          consumedFeatureKey: 'team.squad_stability',
          consumerContextKindCode: 'X',
          consumedContextKindCode: 'X',
        },
      ]
    );
    const plan = deriveExecutionPlan(registry, ['implemented']);
    assert.deepEqual(plan.sequence, ['implemented']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — Scope
// ─────────────────────────────────────────────────────────────────────────────

describe('scope', () => {
  it('17. implements exactly six features', () => {
    const claimed = CALCULATORS.flatMap((calculator) => calculator.featureKeys).sort();
    assert.deepEqual(claimed, [...IMPLEMENTED_FEATURES]);
  });

  it('18. has no calculator for team.squad_stability', () => {
    // R-1. Registered, never implemented — its meaning is selection continuity,
    // and the lineup data that would measure it is not ingested.
    for (const calculator of CALCULATORS) {
      assert.ok(!calculator.featureKeys.includes('team.squad_stability'));
      assert.notEqual(calculator.calculatorKey, 'squad_continuity');
    }
  });

  it('19. declares no feature_source for team.squad_stability', () => {
    // Declaring a source for a calculation that does not exist would assert a
    // dependency nobody has.
    assert.equal(FEATURE_SOURCES['team.squad_stability'], undefined);
  });

  it('20. declares only Layer 1 relations as sources', () => {
    // ck_feature_source__layer_one_only enforces schema `football`; the relation
    // names here must be football relations.
    const layerOne = new Set(['fixture', 'result', 'venue', 'team', 'competition_edition', 'standing']);
    for (const [featureKey, relations] of Object.entries(FEATURE_SOURCES)) {
      for (const relation of relations) {
        assert.ok(layerOne.has(relation), `${featureKey} declares non-Layer-1 source '${relation}'`);
      }
    }
  });

  it('21. gives the pure composite no source, only dependencies', () => {
    // readiness reads no football relation under the final ADR — it consumes two
    // features. Sources and dependencies are different things, and conflating
    // them "makes the layer boundary unauditable".
    assert.equal(FEATURE_SOURCES['team.readiness_score'], undefined);
    assert.deepEqual(
      FEATURE_DEPENDENCIES.map((edge) => edge.consumed).sort(),
      ['team.congestion_index', 'team.rest_advantage']
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Calculator units
// ─────────────────────────────────────────────────────────────────────────────

describe('form_backfill', () => {
  const teamId = '1';

  function homeFixtures(results: readonly [number, number][]): CompletedFixture[] {
    // Most recent first, one week apart, all home.
    return results.map(([goalsFor, goalsAgainst], index) =>
      fixture({
        fixtureId: `h${index}`,
        kickoffAt: new Date(REFERENCE_AS_OF.getTime() - (index + 1) * 7 * 86_400_000),
        isHome: true,
        goalsFor,
        goalsAgainst,
      })
    );
  }

  function homeForm(results: readonly [number, number][]): CandidateValue | undefined {
    const produced = formBackfill.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures: homeFixtures(results) }]]),
      })
    );
    return produced.find((candidate) => candidate.featureKey === 'team.home_form');
  }

  it('22. reproduces V1 exactly for five straight wins', () => {
    // last5 = 15/15 → 100; last10 = 15/30 → 50
    // form = 100×0.7 + 50×0.3 = 85
    const candidate = homeForm([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0]]);
    assert.ok(candidate);
    assert.equal(toNumericString(roundHalfUp(candidate.value, 2)), '85.00');
  });

  it('23. reproduces V1 exactly for ten straight wins', () => {
    // last5 = 100; last10 = 30/30 → 100; form = 100
    const candidate = homeForm(Array(10).fill([1, 0] as [number, number]));
    assert.ok(candidate);
    assert.equal(toNumericString(roundHalfUp(candidate.value, 2)), '100.00');
  });

  it('24. normalises by the FULL window, penalising short history', () => {
    // One win: last5 = 3/15 → 20; last10 = 3/30 → 10
    // form = 20×0.7 + 10×0.3 = 17
    const candidate = homeForm([[1, 0]]);
    assert.ok(candidate);
    assert.equal(toNumericString(roundHalfUp(candidate.value, 2)), '17.00');
    assert.equal(candidate.sampleObservationCount, 1);
  });

  it('25. scores draws at one point', () => {
    // Five draws: last5 = 5/15 → 33.333…; last10 = 5/30 → 16.666…
    // form = 33.333…×0.7 + 16.666…×0.3 = 23.333… + 5 = 28.333… → 28.33
    //
    // A repeating expansion, which is the case that would expose any drift in
    // the working-scale division: the exact value is 85/3 and lands nowhere near
    // a half-way boundary at scale 2.
    const candidate = homeForm([[1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
    assert.ok(candidate);
    assert.equal(toNumericString(roundHalfUp(candidate.value, 2)), '28.33');
  });

  it('26. produces NO ROW when the window is empty', () => {
    // PD-07: absence of a fact is the absence of a row. A zero would assert the
    // worst possible form on no evidence.
    const produced = formBackfill.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures: [] }]]),
      })
    );
    assert.equal(produced.length, 0);
  });

  it('27. keeps home and away separate', () => {
    const mixed = [
      fixture({ fixtureId: 'a', kickoffAt: new Date('2026-11-01T14:00:00Z'), isHome: true, goalsFor: 3, goalsAgainst: 0 }),
      fixture({ fixtureId: 'b', kickoffAt: new Date('2026-10-25T14:00:00Z'), isHome: false, goalsFor: 0, goalsAgainst: 3 }),
    ];
    const produced = formBackfill.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures: mixed }]]),
      })
    );
    const home = produced.find((c) => c.featureKey === 'team.home_form');
    const away = produced.find((c) => c.featureKey === 'team.away_form');
    assert.ok(home && away);
    assert.notEqual(toNumericString(home.value), toNumericString(away.value));
  });

  it('28. excludes fixtures with no recorded result', () => {
    const produced = formBackfill.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([
          [teamId, { teamId, fixtures: [fixture({ kickoffAt: new Date('2026-11-01T14:00:00Z'), goalsFor: null, goalsAgainst: null })] }],
        ]),
      })
    );
    assert.equal(produced.length, 0);
  });
});

describe('fixture_load', () => {
  const teamId = '1';

  function run(fixtures: readonly CompletedFixture[], asOf = REFERENCE_AS_OF): readonly CandidateValue[] {
    return fixtureLoad.calculate(
      context({
        subjects: [{ teamId, asOf }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures: [...fixtures] }]]),
      })
    );
  }

  it('29. computes rest as days since the MOST RECENT fixture, not a mean', () => {
    // DEC-3: V1's mean-of-last-four-gaps is superseded by D-2's latest gap.
    const produced = run([
      fixture({ fixtureId: 'r1', kickoffAt: new Date('2026-11-08T12:00:00Z') }),
      fixture({ fixtureId: 'r2', kickoffAt: new Date('2026-10-01T12:00:00Z') }),
    ]);
    const rest = produced.find((c) => c.featureKey === 'team.rest_advantage');
    assert.ok(rest);
    // 2026-11-10T12:00 minus 2026-11-08T12:00 = exactly 2 days.
    assert.equal(toNumericString(roundHalfUp(rest.value, 1)), '2.0');
    // A mean over both gaps would be far larger — this is the assertion that
    // the superseded definition has not crept back in.
    assert.notEqual(toNumericString(roundHalfUp(rest.value, 1)), '20.0');
  });

  it('30. records exactly one observation for rest', () => {
    const rest = run([fixture({ kickoffAt: new Date('2026-11-08T12:00:00Z') })]).find(
      (c) => c.featureKey === 'team.rest_advantage'
    );
    assert.equal(rest?.sampleObservationCount, 1);
  });

  it('31. produces no rest row when no fixture precedes as_of', () => {
    const produced = run([]);
    assert.equal(produced.filter((c) => c.featureKey === 'team.rest_advantage').length, 0);
  });

  it('32. applies V1 bands to the 28-day count HALVED', () => {
    // Six fixtures in 28 days → rate 3 → band 25.
    // Applying V1's bands to the raw count of 6 would give 80, which is the
    // saturation DEC-3's transform exists to prevent.
    const fixtures = Array.from({ length: 6 }, (_, index) =>
      fixture({
        fixtureId: `c${index}`,
        kickoffAt: new Date(REFERENCE_AS_OF.getTime() - (index + 1) * 4 * 86_400_000),
      })
    );
    const congestion = run(fixtures).find((c) => c.featureKey === 'team.congestion_index');
    assert.ok(congestion);
    assert.equal(toNumericString(roundHalfUp(congestion.value, 2)), '25.00');
    assert.equal(congestion.sampleObservationCount, 6);
  });

  it('33. bands a light schedule low', () => {
    // Two fixtures in 28 days → rate 1 → band 0.
    const fixtures = [
      fixture({ fixtureId: 'c1', kickoffAt: new Date('2026-11-05T12:00:00Z') }),
      fixture({ fixtureId: 'c2', kickoffAt: new Date('2026-10-28T12:00:00Z') }),
    ];
    const congestion = run(fixtures).find((c) => c.featureKey === 'team.congestion_index');
    assert.equal(toNumericString(roundHalfUp(congestion!.value, 2)), '0.00');
  });

  it('34. bands a punishing schedule at the ceiling', () => {
    // Twelve fixtures in 28 days → rate 6 → band 80.
    const fixtures = Array.from({ length: 12 }, (_, index) =>
      fixture({
        fixtureId: `c${index}`,
        kickoffAt: new Date(REFERENCE_AS_OF.getTime() - (index + 1) * 2 * 86_400_000),
      })
    );
    const congestion = run(fixtures).find((c) => c.featureKey === 'team.congestion_index');
    assert.equal(toNumericString(roundHalfUp(congestion!.value, 2)), '80.00');
  });

  it('35. excludes fixtures outside the 28-day window from congestion', () => {
    const produced = run([fixture({ kickoffAt: new Date('2026-01-01T12:00:00Z') })]);
    // Old enough for rest, too old for congestion — so rest exists and
    // congestion does not.
    assert.ok(produced.find((c) => c.featureKey === 'team.rest_advantage'));
    assert.equal(produced.filter((c) => c.featureKey === 'team.congestion_index').length, 0);
  });
});

describe('travel_load', () => {
  const teamId = '1';
  const HOME = 'v-home';
  const NEAR = 'v-near';
  const FAR = 'v-far';

  const venues = new Map([
    [HOME, { venueId: HOME, latitude: '51.500000', longitude: '-0.120000' }],
    [NEAR, { venueId: NEAR, latitude: '51.600000', longitude: '-0.200000' }],
    [FAR, { venueId: FAR, latitude: '41.900000', longitude: '12.500000' }],
  ]);

  function run(awayVenues: readonly (string | null)[], homeVenueId: string | null = HOME) {
    const fixtures = awayVenues.map((venueId, index) =>
      fixture({
        fixtureId: `t${index}`,
        kickoffAt: new Date(REFERENCE_AS_OF.getTime() - (index + 1) * 7 * 86_400_000),
        isHome: false,
        venueId,
      })
    );
    return travelLoad.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures }]]),
        homeVenueByTeam: new Map([[teamId, homeVenueId]]),
        venuesById: venues,
      })
    );
  }

  it('36. scores a short trip at the best band', () => {
    // ~13 km → band 100 → impact 100 − 100 = 0.
    const produced = run([NEAR]);
    assert.equal(toNumericString(roundHalfUp(produced[0].value, 2)), '0.00');
  });

  it('37. scores a long trip at a worse band', () => {
    // London to Rome ~1430 km → band 45 → impact 55.
    const produced = run([FAR]);
    assert.equal(toNumericString(roundHalfUp(produced[0].value, 2)), '55.00');
  });

  it('38. averages per trip, not per period', () => {
    // V1's avgKm is `sum / trips.length`, which is why the band table carries
    // across to a five-fixture window unchanged.
    const produced = run([NEAR, NEAR, NEAR]);
    assert.equal(toNumericString(roundHalfUp(produced[0].value, 2)), '0.00');
    assert.equal(produced[0].sampleObservationCount, 3);
  });

  it('39. produces no row when the home ground has no coordinates', () => {
    assert.equal(run([NEAR], null).length, 0);
    assert.equal(run([NEAR], 'v-unlocated').length, 0);
  });

  it('40. skips trips to venues with no coordinates, keeping the rest', () => {
    // LC-05: absence rather than a substituted distance.
    const produced = run([NEAR, null, 'v-unlocated']);
    assert.equal(produced.length, 1);
    assert.equal(produced[0].sampleObservationCount, 1);
  });

  it('41. produces no row when no trip can be measured', () => {
    assert.equal(run([null, null]).length, 0);
  });

  it('42. ignores home fixtures', () => {
    const fixtures = [fixture({ kickoffAt: new Date('2026-11-01T12:00:00Z'), isHome: true, venueId: FAR })];
    const produced = travelLoad.calculate(
      context({
        subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
        fixturesByTeam: new Map([[teamId, { teamId, fixtures }]]),
        homeVenueByTeam: new Map([[teamId, HOME]]),
        venuesById: venues,
      })
    );
    assert.equal(produced.length, 0);
  });
});

describe('team_readiness', () => {
  const teamId = '1';

  function run(rest: string | null, congestion: string | null): readonly CandidateValue[] {
    const priorValues = new Map<string, ConsumedValueRef>();
    if (rest !== null) {
      priorValues.set(
        priorValueKey('team.rest_advantage', teamId, REFERENCE_AS_OF),
        consumed({ featureKey: 'team.rest_advantage', value: fromString(rest), valueId: '10', provenanceClassCode: 'OBSERVED', sampleObservationCount: 1 })
      );
    }
    if (congestion !== null) {
      priorValues.set(
        priorValueKey('team.congestion_index', teamId, REFERENCE_AS_OF),
        consumed({ featureKey: 'team.congestion_index', value: fromString(congestion), valueId: '11', sampleObservationCount: 6 })
      );
    }
    return teamReadiness.calculate(
      context({ subjects: [{ teamId, asOf: REFERENCE_AS_OF }], priorValues })
    );
  }

  it('43. combines both inputs at equal weight', () => {
    // rest 7 days → clamp(7/7,0,1)×100 = 100; congestion 20 → 100−20 = 80
    // readiness = (50×100 + 50×80)/100 = 90
    const produced = run('7.0', '20.00');
    assert.equal(produced.length, 1);
    assert.equal(toNumericString(roundHalfUp(produced[0].value, 2)), '90.00');
  });

  it('44. clamps rest at seven days', () => {
    // 30 days of rest is still 100 — beyond a week further rest adds nothing.
    const long = run('30.0', '20.00');
    const week = run('7.0', '20.00');
    assert.equal(toNumericString(roundHalfUp(long[0].value, 2)), toNumericString(roundHalfUp(week[0].value, 2)));
  });

  it('45. inverts congestion before combining', () => {
    // Congestion is LOWER_IS_STRONGER and readiness is HIGHER_IS_STRONGER;
    // combining without orienting would subtract fitness from fitness.
    const light = run('7.0', '0.00');
    const heavy = run('7.0', '80.00');
    assert.ok(compare(light[0].value, heavy[0].value) > 0);
  });

  it('46. renormalises over the present weight when one input is absent', () => {
    // Rest alone: (50×100)/50 = 100, not 50.
    const produced = run('7.0', null);
    assert.equal(toNumericString(roundHalfUp(produced[0].value, 2)), '100.00');
  });

  it('47. cites exactly one lineage edge when one input is absent', () => {
    // Lineage is instance-level: it records what this value actually read.
    const produced = run('7.0', null);
    assert.equal(produced[0].consumed.length, 1);
    assert.equal(produced[0].consumed[0].featureKey, 'team.rest_advantage');
  });

  it('48. cites two edges when both are present', () => {
    const produced = run('7.0', '20.00');
    assert.deepEqual(produced[0].consumed.map((c) => c.featureKey).sort(), [
      'team.congestion_index',
      'team.rest_advantage',
    ]);
  });

  it('49. produces NO ROW when both inputs are absent', () => {
    // A readiness of 0 would read as a side in the worst possible condition
    // rather than as a side nobody has measured.
    assert.equal(run(null, null).length, 0);
  });

  it('50. leaves the sample count for the write layer to derive', () => {
    // DEC-5: MIN(consumed). Set here it could contradict the lineage the very
    // same candidate carries.
    assert.equal(run('7.0', '20.00')[0].sampleObservationCount, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E — Provenance and sampling
// ─────────────────────────────────────────────────────────────────────────────

describe('provenance and sampling', () => {
  const registry = syntheticRegistry([
    definition({ featureKey: 'team.derived', maxProvenanceClassCode: 'DERIVED', meaningfulSampleThreshold: 3 }),
    definition({ featureKey: 'team.observed', maxProvenanceClassCode: 'OBSERVED', meaningfulSampleThreshold: 1 }),
  ]);

  function candidate(overrides: Partial<CandidateValue> & { featureKey: string }): CandidateValue {
    return {
      teamId: '1',
      asOf: REFERENCE_AS_OF,
      value: fromInt(1),
      sampleObservationCount: 5,
      consumed: [],
      ...overrides,
    };
  }

  it('51. takes the registry ceiling when there is no lineage', () => {
    // R-53 exempts values with no lineage — five of six S-5 features.
    const resolved = resolveProvenance(
      registry,
      registry.definitionsByKey.get('team.observed')!,
      candidate({ featureKey: 'team.observed' })
    );
    assert.equal(resolved.provenanceClassCode, 'OBSERVED');
  });

  it('52. applies the lineage floor when an input is weaker', () => {
    // LC-37: "A value derived from an estimate is itself an estimate."
    const resolved = resolveProvenance(
      registry,
      registry.definitionsByKey.get('team.observed')!,
      candidate({
        featureKey: 'team.observed',
        consumed: [consumed({ featureKey: 'x', value: fromInt(1), provenanceClassCode: 'ESTIMATED' })],
      })
    );
    assert.equal(resolved.provenanceClassCode, 'ESTIMATED');
  });

  it('53. never exceeds the ceiling even when every input is stronger', () => {
    const resolved = resolveProvenance(
      registry,
      registry.definitionsByKey.get('team.derived')!,
      candidate({
        featureKey: 'team.derived',
        consumed: [consumed({ featureKey: 'x', value: fromInt(1), provenanceClassCode: 'OBSERVED' })],
      })
    );
    assert.equal(resolved.provenanceClassCode, 'DERIVED');
  });

  it('54. takes the MINIMUM sample count of consumed values', () => {
    // DEC-5, exactly: never SUM, never MAX, never a component count.
    const resolved = resolveProvenance(
      registry,
      registry.definitionsByKey.get('team.derived')!,
      candidate({
        featureKey: 'team.derived',
        sampleObservationCount: null,
        consumed: [
          consumed({ featureKey: 'a', value: fromInt(1), sampleObservationCount: 1 }),
          consumed({ featureKey: 'b', value: fromInt(1), sampleObservationCount: 9 }),
        ],
      })
    );
    assert.equal(resolved.sampleObservationCount, 1, 'MIN, not MAX');
    assert.notEqual(resolved.sampleObservationCount, 10, 'not SUM');
    assert.notEqual(resolved.sampleObservationCount, 2, 'not the component count');
  });

  it('55. evaluates the threshold against the derived count', () => {
    const resolved = resolveProvenance(
      registry,
      registry.definitionsByKey.get('team.derived')!,
      candidate({ featureKey: 'team.derived', sampleObservationCount: 2 })
    );
    // Threshold 3, count 2 → not met. Stored, not derived at read time (LC-41).
    assert.equal(resolved.sampleMeetsThreshold, false);
  });

  it('56. raises on an unregistered provenance class rather than guessing', () => {
    assert.throws(
      () =>
        resolveProvenance(
          registry,
          registry.definitionsByKey.get('team.derived')!,
          candidate({
            featureKey: 'team.derived',
            consumed: [consumed({ featureKey: 'x', value: fromInt(1), provenanceClassCode: 'INVENTED' })],
          })
        ),
      /not registered/
    );
  });

  it('57. raises when a Layer 1 candidate states no observation count', () => {
    assert.throws(
      () =>
        resolveProvenance(
          registry,
          registry.definitionsByKey.get('team.derived')!,
          candidate({ featureKey: 'team.derived', sampleObservationCount: null })
        ),
      /must state how many observations/
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F — CLI
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI', () => {
  it('58. defaults to calculate', () => {
    assert.equal(parseArguments([]).command, 'calculate');
    assert.equal(parseArguments([]).dryRun, false);
  });

  it('59. accepts dry-run', () => {
    assert.equal(parseArguments(['calculate', '--dry-run']).dryRun, true);
  });

  it('60. requires an explicit range for replay', () => {
    // D-4: historical replay is a DELIBERATE act. Defaulting its range would
    // make it something a scheduled run could drift into.
    assert.throws(() => parseArguments(['replay']), /requires --from and --to/);
    const replay = parseArguments(['replay', '--from', '2026-09-01', '--to', '2026-09-30']);
    assert.equal(replay.command, 'replay');
    assert.equal(replay.replayFrom?.toISOString(), '2026-09-01T00:00:00.000Z');
  });

  it('61. refuses a reversed replay range', () => {
    assert.throws(() => parseArguments(['replay', '--from', '2026-09-30', '--to', '2026-09-01']), /precedes/);
  });

  it('62. accepts verify', () => {
    assert.equal(parseArguments(['verify']).command, 'verify');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G — MUTATION TESTS (source-level)
// ─────────────────────────────────────────────────────────────────────────────

describe('mutation: wall clock inside a calculator', () => {
  const calculatorFiles = [
    'calculators/formBackfill.ts',
    'calculators/fixtureLoad.ts',
    'calculators/travelLoad.ts',
    'calculators/teamReadiness.ts',
  ];

  it('63. no calculator reads the wall clock', () => {
    // R-2 obligation 6, and the sharpest of them. A calculator computing "days
    // since" against Date.now() instead of against as_of would be
    // non-deterministic AND temporally incorrect, and both look like small
    // numeric drift.
    for (const file of calculatorFiles) {
      const code = codeOf(file);
      assert.ok(!/\bDate\.now\s*\(/.test(code), `${file} calls Date.now()`);
      assert.ok(!/\bnew\s+Date\s*\(\s*\)/.test(code), `${file} constructs a current Date`);
      assert.ok(!/\bnow\s*\(\s*\)/.test(code), `${file} calls now()`);
    }
  });

  it('64. no calculator opens a connection or writes', () => {
    for (const file of calculatorFiles) {
      const code = codeOf(file);
      assert.ok(!/\btx\.query\b/.test(code), `${file} issues a query`);
      assert.ok(!/INSERT\s+INTO/i.test(code), `${file} contains an INSERT`);
      assert.ok(!/PoolClient/.test(code), `${file} takes a database client`);
    }
  });

  it('65. calculators are deterministic across repeated invocation', () => {
    const teamId = '1';
    const ctx = context({
      subjects: [{ teamId, asOf: REFERENCE_AS_OF }],
      fixturesByTeam: new Map([
        [teamId, { teamId, fixtures: [fixture({ kickoffAt: new Date('2026-11-08T12:00:00Z') })] }],
      ]),
    });
    const first = fixtureLoad.calculate(ctx);
    const second = fixtureLoad.calculate(ctx);
    assert.deepEqual(
      first.map((c) => `${c.featureKey}=${toNumericString(c.value)}`),
      second.map((c) => `${c.featureKey}=${toNumericString(c.value)}`)
    );
  });
});

describe('mutation: hard-coded execution order', () => {
  it('66. the pipeline contains no literal calculator ordering', () => {
    // The CALCULATORS export is a SET, not an order. If a literal sequence
    // appeared here, mutation test 74 (the database one) could not move a
    // calculator between stages.
    const code = codeOf('pipeline.ts');
    assert.ok(
      !/\[\s*'form_backfill'|\[\s*"form_backfill"/.test(code),
      'pipeline.ts contains a literal calculator sequence'
    );
    assert.ok(/deriveExecutionPlan\(/.test(code), 'pipeline.ts must derive the plan');
  });

  it('67. changing the declared graph changes the derived order', () => {
    // The pure form of the derivation proof. Same calculators, different graph,
    // different order — impossible if the order were written down.
    const definitions = [
      definition({ featureKey: 'team.a', calculatorKey: 'alpha' }),
      definition({ featureKey: 'team.b', calculatorKey: 'bravo' }),
    ];
    const independent = deriveExecutionPlan(syntheticRegistry(definitions), ['alpha', 'bravo']);
    const dependent = deriveExecutionPlan(
      syntheticRegistry(definitions, [
        {
          consumerFeatureKey: 'team.a',
          consumedFeatureKey: 'team.b',
          consumerContextKindCode: 'X',
          consumedContextKindCode: 'X',
        },
      ]),
      ['alpha', 'bravo']
    );
    assert.equal(independent.stages.length, 1);
    assert.equal(dependent.stages.length, 2);
    assert.deepEqual(dependent.sequence, ['bravo', 'alpha']);
  });
});

describe('mutation: bare ON CONFLICT', () => {
  it('68. every conflict target in the write layer is named', () => {
    // A bare DO NOTHING swallows EVERY constraint violation — the composite
    // version/definition binding, subject exclusivity, the context obligation —
    // each of which means the calculator is wrong and must be heard.
    for (const file of ['write/values.ts', 'write/lineage.ts', 'registry/declare.ts']) {
      const code = codeOf(file);
      const conflicts = code.match(/ON CONFLICT[\s\S]{0,120}?DO NOTHING/gi) ?? [];
      assert.ok(conflicts.length > 0, `${file} has no ON CONFLICT clause`);
      for (const clause of conflicts) {
        assert.ok(
          /ON CONFLICT\s+ON CONSTRAINT\s+\w+/i.test(clause),
          `${file} has an unnamed conflict target: ${clause.replace(/\s+/g, ' ')}`
        );
      }
    }
  });

  it('69. no UPDATE or DELETE statement exists anywhere in S-5', () => {
    // Append-only, and the role holds neither privilege in any case.
    for (const file of [
      'write/values.ts',
      'write/lineage.ts',
      'registry/declare.ts',
      'pipeline.ts',
      'verify.ts',
    ]) {
      const code = codeOf(file);
      assert.ok(!/\bUPDATE\s+feature\./i.test(code), `${file} contains an UPDATE`);
      assert.ok(!/\bDELETE\s+FROM\b/i.test(code), `${file} contains a DELETE`);
    }
  });
});

describe('mutation: double rounding', () => {
  it('70. rounding twice differs from rounding once', () => {
    // This is why scale.ts rounds exactly once at the write boundary. 1.4449
    // rounds to 1.44 in one step and to 1.45 in two — a full unit of the last
    // place, from an operation that looks harmless.
    const value = fromString('1.4449');
    const once = roundHalfUp(value, 2);
    const twice = roundHalfUp(roundHalfUp(value, 3), 2);
    assert.equal(toNumericString(once), '1.44');
    assert.equal(toNumericString(twice), '1.45');
    assert.notEqual(toNumericString(once), toNumericString(twice));
  });

  it('71. the write layer rounds exactly once', () => {
    const code = codeOf('write/values.ts');
    const occurrences = (code.match(/roundHalfUp\(/g) ?? []).length;
    assert.equal(occurrences, 1, 'values.ts must call roundHalfUp exactly once');
  });
});

describe('mutation: provenance floor removed', () => {
  it('72. removing the floor would change the result', () => {
    // The direct proof that the floor does something. It is the ONLY enforcement
    // of LC-37 that exists — the A.12 trigger cannot fire (S5-1) and the
    // compensating quality check has no implementation (S5-2).
    const registry = syntheticRegistry([
      definition({ featureKey: 'team.x', maxProvenanceClassCode: 'OBSERVED' }),
    ]);
    const withWeakInput = resolveProvenance(registry, registry.definitionsByKey.get('team.x')!, {
      featureKey: 'team.x',
      teamId: '1',
      asOf: REFERENCE_AS_OF,
      value: fromInt(1),
      sampleObservationCount: null,
      consumed: [consumed({ featureKey: 'y', value: fromInt(1), provenanceClassCode: 'ESTIMATED' })],
    });
    const ceilingOnly = registry.definitionsByKey.get('team.x')!.maxProvenanceClassCode;
    assert.equal(withWeakInput.provenanceClassCode, 'ESTIMATED');
    assert.notEqual(withWeakInput.provenanceClassCode, ceilingOnly);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H — Database, privilege, lifecycle, leakage, replay
// ─────────────────────────────────────────────────────────────────────────────

describe('feature pipeline against a V2 database', { skip: !hasDatabase }, () => {
  const FEATURE_ROLE = 'pt_pipeline_feature' as const;
  const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
  let world: SeededWorld;

  before(async () => {
    // Seeded and COMMITTED as ingestion — the feature role cannot write football
    // and cannot see another connection's uncommitted rows. Idempotent, so the
    // suite can run repeatedly against the same rig.
    world = await withConnection(INGESTION_ROLE, (tx) => seedWorld(tx));
  });

  after(async () => {
    await closeAllPools();
  });

  async function asFeature<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(FEATURE_ROLE, fn);
  }

  /** Runs inside a transaction that is always rolled back. */
  async function inRolledBackTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return asFeature(async (tx) => {
      await tx.query('BEGIN');
      try {
        return await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  // ── Registry and driver ───────────────────────────────────────────────────

  it('73. loads the registry from the database', async () => {
    await asFeature(async (tx) => {
      const registry = await loadRegistry(tx);
      for (const featureKey of IMPLEMENTED_FEATURES) {
        assert.ok(registry.definitionsByKey.get(featureKey), `${featureKey} must be registered`);
      }
      // The one registered but never implemented.
      assert.ok(registry.definitionsByKey.get('team.squad_stability'));
    });
  });

  it('74. reconciles the calculators against the registry', async () => {
    await asFeature(async (tx) => {
      const registry = await loadRegistry(tx);
      assert.doesNotThrow(() =>
        assertCalculatorCoverage(
          registry,
          new Map(CALCULATORS.map((c) => [c.calculatorKey, c.featureKeys]))
        )
      );
      // A claim the registry does not hold must fail loudly at startup.
      assert.throws(
        () => assertCalculatorCoverage(registry, new Map([['ghost', ['team.not_registered']]])),
        /not registered/
      );
    });
  });

  it('75. reads snapshot offsets from the database, not from source', async () => {
    await asFeature(async (tx) => {
      const registry = await loadRegistry(tx);
      assert.ok(registry.snapshotPoints.length > 0);
      const offsets = registry.snapshotPoints.map((point) => point.offsetSeconds).sort((a, b) => a - b);
      // The seeded set is T-7d, T-3d, T-1d and KICKOFF. Asserted as data read
      // back, not as a constant this file also declares.
      assert.ok(offsets.includes(0), 'KICKOFF must be present');
      assert.ok(offsets.includes(7 * 86_400), 'T-7d must be present');
    });
  });

  it('76. derives as_of by subtracting the offset, truncated to seconds', () => {
    const kickoff = new Date('2026-11-10T14:00:00.750Z');
    const asOf = deriveAsOf(kickoff, 3 * 86_400);
    assert.equal(asOf.toISOString(), '2026-11-07T14:00:00.000Z');
    assert.equal(asOf.getMilliseconds(), 0, 'ER-01: no sub-second component may survive');
  });

  it('77. never selects a pair before its as_of has passed', async () => {
    await asFeature(async (tx) => {
      const registry = await loadRegistry(tx);
      // A "now" long before the seeded fixtures: nothing is eligible yet.
      const early = await selectBatches(tx, registry, new Date('2026-01-01T00:00:00Z'), {
        replayFrom: new Date('2026-09-01T00:00:00Z'),
        replayTo: new Date('2026-12-01T00:00:00Z'),
      });
      assert.equal(early.length, 0, 'no pair may be calculated ahead of its own as_of');

      const late = await selectBatches(tx, registry, new Date('2027-01-01T00:00:00Z'), {
        replayFrom: new Date('2026-09-01T00:00:00Z'),
        replayTo: new Date('2026-12-01T00:00:00Z'),
      });
      assert.ok(late.length > 0, 'past fixtures must yield batches');
      for (const batch of late) {
        assert.ok(batch.teamIds.length >= 1);
      }
    });
  });

  it('78. orders batches ascending by instant', async () => {
    await asFeature(async (tx) => {
      const registry = await loadRegistry(tx);
      const batches = await selectBatches(tx, registry, new Date('2027-01-01T00:00:00Z'), {
        replayFrom: new Date('2026-09-01T00:00:00Z'),
        replayTo: new Date('2026-12-01T00:00:00Z'),
      });
      for (let i = 1; i < batches.length; i++) {
        assert.ok(batches[i].asOf.getTime() >= batches[i - 1].asOf.getTime());
      }
    });
  });

  // ── Reads ─────────────────────────────────────────────────────────────────

  it('79. reads completed fixtures oriented to the subject team', async () => {
    await asFeature(async (tx) => {
      const histories = await readCompletedFixtures(tx, [world.alphaTeamId], REFERENCE_AS_OF);
      const history = histories.get(world.alphaTeamId);
      assert.ok(history && history.fixtures.length > 0);
      for (const item of history.fixtures) {
        assert.ok(item.kickoffAt.getTime() < REFERENCE_AS_OF.getTime(), 'bound is strict');
      }
      // Most recent first — the order every window slice depends on.
      for (let i = 1; i < history.fixtures.length; i++) {
        assert.ok(history.fixtures[i - 1].kickoffAt.getTime() >= history.fixtures[i].kickoffAt.getTime());
      }
    });
  });

  it('80. reads home venues and located venues', async () => {
    await asFeature(async (tx) => {
      const homes = await readHomeVenues(tx, [world.alphaTeamId, world.betaTeamId]);
      assert.equal(homes.get(world.alphaTeamId), world.alphaVenueId);
      const venues = await readVenueLocations(tx, [world.alphaVenueId, world.remoteVenueId]);
      assert.equal(venues.size, 2);
      // Coordinates stay strings until the haversine parses them.
      assert.equal(typeof venues.get(world.alphaVenueId)!.latitude, 'string');
    });
  });

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Calculates and writes Stage 1 for one instant, inside the caller's tx. */
  async function writeStageOne(tx: PoolClient, asOf: Date, calculatedAt: Date) {
    const registry = await loadRegistry(tx);
    const teamIds = [world.alphaTeamId, world.betaTeamId];
    const fixturesByTeam = await readCompletedFixtures(tx, teamIds, asOf);
    const homeVenueByTeam = await readHomeVenues(tx, teamIds);
    const venueIds = new Set<string>();
    for (const venueId of homeVenueByTeam.values()) if (venueId) venueIds.add(venueId);
    for (const history of fixturesByTeam.values()) {
      for (const item of history.fixtures) if (item.venueId) venueIds.add(item.venueId);
    }
    const venuesById = await readVenueLocations(tx, [...venueIds].sort());

    const ctx = context({
      definitions: registry.definitionsByKey,
      subjects: teamIds.map((teamId) => ({ teamId, asOf })),
      fixturesByTeam,
      homeVenueByTeam,
      venuesById,
    });

    const candidates = [
      ...formBackfill.calculate(ctx),
      ...fixtureLoad.calculate(ctx),
      ...travelLoad.calculate(ctx),
    ];
    return { registry, teamIds, result: await writeValues(tx, registry, candidates, calculatedAt) };
  }

  it('81. writes Stage 1 values with the registry version and context', async () => {
    await inRolledBackTx(async (tx) => {
      const { result } = await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-10T13:00:00Z'));
      assert.ok(result.written > 0, 'the seeded world must produce values');

      const { rows } = await tx.query<{
        feature_key: string;
        context_kind_code: string;
        context_competition_edition_id: string | null;
        designation: string;
        value: string;
      }>(
        `SELECT d.feature_key, fv.context_kind_code,
                fv.context_competition_edition_id::text, v.designation, fv.value::text
           FROM feature.feature_value fv
           JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
           JOIN feature.feature_version v ON v.id = fv.feature_version_id
          WHERE fv.as_of = $1
          ORDER BY d.feature_key, fv.subject_team_id`,
        [REFERENCE_AS_OF]
      );
      assert.ok(rows.length > 0);
      for (const row of rows) {
        // D-3: ALL_COMPETITIONS only, and the edition must be NULL — which
        // ck_feature_value__context_edition_conditional independently requires.
        assert.equal(row.context_kind_code, 'ALL_COMPETITIONS');
        assert.equal(row.context_competition_edition_id, null);
        assert.equal(row.designation, '1.0.0');
      }
    });
  });

  it('82. writes no value for team.squad_stability', async () => {
    await inRolledBackTx(async (tx) => {
      await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-10T13:00:00Z'));
      const { rows } = await tx.query(
        `SELECT 1 FROM feature.feature_value fv
           JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
          WHERE d.feature_key = 'team.squad_stability'`
      );
      assert.equal(rows.length, 0, 'R-1: registered, never calculated');
    });
  });

  it('83. conforms to the declared value scale', async () => {
    await inRolledBackTx(async (tx) => {
      await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-10T13:00:00Z'));
      const { rows } = await tx.query<{ offenders: string }>(
        `SELECT count(*)::text AS offenders
           FROM feature.feature_value fv
           JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
          WHERE fv.value <> round(fv.value, d.value_scale)`
      );
      assert.equal(rows[0].offenders, '0');
    });
  });

  it('84. writes lineage for readiness and for nothing else', async () => {
    await inRolledBackTx(async (tx) => {
      const calculatedAt = new Date('2026-11-10T13:00:00Z');
      const { registry, teamIds } = await writeStageOne(tx, REFERENCE_AS_OF, calculatedAt);

      // Stage 2 reads what Stage 1 wrote — in the same transaction here, which
      // is the same visibility guarantee the pipeline gets from committing.
      const priorValues = await readPriorValues(
        tx,
        ['team.rest_advantage', 'team.congestion_index'],
        teamIds,
        REFERENCE_AS_OF,
        CALCULATION_CONTEXT_KIND
      );
      const candidates = teamReadiness.calculate(
        context({
          definitions: registry.definitionsByKey,
          subjects: teamIds.map((teamId) => ({ teamId, asOf: REFERENCE_AS_OF })),
          priorValues,
        })
      );
      assert.ok(candidates.length > 0, 'Stage 1 must have produced readiness inputs');

      const written = await writeValues(tx, registry, candidates, calculatedAt);
      const lineage = await writeLineage(tx, written.writtenValues);
      assert.ok(lineage.written > 0);

      const { rows } = await tx.query<{ feature_key: string; edges: string }>(
        `SELECT d.feature_key, count(*)::text AS edges
           FROM feature.feature_lineage l
           JOIN feature.feature_value fv
             ON fv.id = l.produced_value_id AND fv.as_of = l.produced_value_as_of
           JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
          GROUP BY d.feature_key
          ORDER BY d.feature_key`
      );
      assert.deepEqual(rows.map((row) => row.feature_key), ['team.readiness_score']);
    });
  });

  it('85. derives the readiness sample count as MIN of its inputs', async () => {
    await inRolledBackTx(async (tx) => {
      const calculatedAt = new Date('2026-11-10T13:00:00Z');
      const { registry, teamIds } = await writeStageOne(tx, REFERENCE_AS_OF, calculatedAt);
      const priorValues = await readPriorValues(
        tx,
        ['team.rest_advantage', 'team.congestion_index'],
        teamIds,
        REFERENCE_AS_OF,
        CALCULATION_CONTEXT_KIND
      );
      const candidates = teamReadiness.calculate(
        context({
          definitions: registry.definitionsByKey,
          subjects: teamIds.map((teamId) => ({ teamId, asOf: REFERENCE_AS_OF })),
          priorValues,
        })
      );
      await writeValues(tx, registry, candidates, calculatedAt);

      const { rows } = await tx.query<{ readiness: number; rest: number }>(
        `SELECT r.sample_observation_count AS readiness,
                rest.sample_observation_count AS rest
           FROM feature.feature_value r
           JOIN feature.feature_definition rd ON rd.id = r.feature_definition_id
           JOIN feature.feature_value rest ON rest.subject_team_id = r.subject_team_id
                                          AND rest.as_of = r.as_of
           JOIN feature.feature_definition restd ON restd.id = rest.feature_definition_id
          WHERE rd.feature_key = 'team.readiness_score'
            AND restd.feature_key = 'team.rest_advantage'
          ORDER BY r.subject_team_id`
      );
      assert.ok(rows.length > 0);
      for (const row of rows) {
        // rest always contributes exactly 1 (D-2 §5), so MIN pins readiness to 1.
        assert.equal(row.rest, 1);
        assert.equal(row.readiness, 1, 'DEC-5: MIN(consumed), never SUM or MAX');
      }
    });
  });

  it('86. declares sources and dependencies, idempotently', async () => {
    await inRolledBackTx(async (tx) => {
      const registry = await loadRegistry(tx);
      const first = await declareRegistryInputs(tx, registry);
      const second = await declareRegistryInputs(tx, registry);
      assert.equal(second.sourcesWritten, 0, 'a second declaration writes nothing');
      assert.equal(second.dependenciesWritten, 0);
      assert.equal(first.dependenciesExamined, 2, 'exactly two readiness edges');

      const { rows } = await tx.query<{ feature_key: string }>(
        `SELECT DISTINCT d.feature_key
           FROM feature.feature_source s
           JOIN feature.feature_definition d ON d.id = s.feature_definition_id
          ORDER BY d.feature_key`
      );
      const declared = rows.map((row) => row.feature_key);
      assert.ok(!declared.includes('team.squad_stability'));
      assert.ok(!declared.includes('team.readiness_score'), 'the pure composite declares no source');
    });
  });

  // ── Privilege ─────────────────────────────────────────────────────────────

  it('87. the role holds NO UPDATE anywhere in schema feature', async () => {
    await asFeature(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'feature' AND c.relkind IN ('r','p')
            AND has_table_privilege('pt_pipeline_feature', c.oid, 'UPDATE')
          ORDER BY c.relname`
      );
      assert.deepEqual(rows, [], 'append-only, and the registry is S-3s');
    });
  });

  it('88. the role holds NO DELETE anywhere in schema feature', async () => {
    await asFeature(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'feature' AND c.relkind IN ('r','p')
            AND has_table_privilege('pt_pipeline_feature', c.oid, 'DELETE')
          ORDER BY c.relname`
      );
      assert.deepEqual(rows, [], 'only pt_retention deletes, under the session marker');
    });
  });

  it('89. the role cannot reach module, snapshot, calibration or product', async () => {
    await asFeature(async (tx) => {
      for (const schema of ['module', 'snapshot', 'calibration', 'product']) {
        const { rows } = await tx.query<{ can: boolean }>(
          `SELECT has_schema_privilege('pt_pipeline_feature', $1, 'USAGE') AS can`,
          [schema]
        );
        assert.equal(rows[0].can, false, `S-5 must hold no USAGE on ${schema}`);
      }
    });
  });

  it('90. the role holds only SELECT on football', async () => {
    await asFeature(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'football' AND c.relkind IN ('r','p')
            AND (has_table_privilege('pt_pipeline_feature', c.oid, 'INSERT')
              OR has_table_privilege('pt_pipeline_feature', c.oid, 'UPDATE')
              OR has_table_privilege('pt_pipeline_feature', c.oid, 'DELETE'))
          ORDER BY c.relname`
      );
      assert.deepEqual(rows, [], 'S-5 must not be able to alter reality');
    });
  });

  it('91. the role can write its own telemetry', async () => {
    // The contrast with finding S3-1: there is no unattributed path in S-5.
    await asFeature(async (tx) => {
      const { rows } = await tx.query<{ can: boolean }>(
        `SELECT has_table_privilege('pt_pipeline_feature', 'operations.pipeline_run', 'INSERT') AS can`
      );
      assert.equal(rows[0].can, true);
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('92. an UPDATE on feature_value is REFUSED', async () => {
    // Three layers should refuse it — grant, policy and the append guard — and
    // any one of them is a pass. Nothing else would reveal the loss of this
    // until the history was already gone.
    await inRolledBackTx(async (tx) => {
      await assert.rejects(
        tx.query(`UPDATE feature.feature_value SET value = value + 1 WHERE false`),
        (error: Error & { code?: string }) =>
          /permission denied|append-only|cannot be updated|not permitted/i.test(error.message) ||
          error.code === '42501'
      );
    });
  });

  it('93. a DELETE on feature_value is REFUSED', async () => {
    await inRolledBackTx(async (tx) => {
      await assert.rejects(
        tx.query(`DELETE FROM feature.feature_value WHERE false`),
        (error: Error & { code?: string }) =>
          /permission denied/i.test(error.message) || error.code === '42501'
      );
    });
  });

  it('94. a genuine constraint violation is NOT swallowed by the conflict clause', async () => {
    // The named target keeps exactly one condition quiet: the row already
    // exists. A subject-exclusivity violation must still raise.
    await inRolledBackTx(async (tx) => {
      const registry = await loadRegistry(tx);
      const rest = registry.definitionsByKey.get('team.rest_advantage')!;
      await assert.rejects(
        tx.query(
          `INSERT INTO feature.feature_value
             (as_of, feature_definition_id, feature_version_id, subject_kind_code,
              subject_team_id, subject_player_id, context_kind_code, value,
              provenance_class_code, sample_observation_count, sample_meets_threshold)
           VALUES ($1, $2, $3, 'TEAM', $4, $4, 'ALL_COMPETITIONS', 1, 'OBSERVED', 1, true)
           ON CONFLICT ON CONSTRAINT uq_feature_value__subject_context_definition_asof_version
           DO NOTHING`,
          [REFERENCE_AS_OF, rest.id, rest.versionId, world.alphaTeamId]
        ),
        /ck_feature_value__subject_exclusive|violates check constraint/i
      );
    });
  });

  // ── Leakage ───────────────────────────────────────────────────────────────

  it('95. a value never sees a fixture at or after its own as_of', async () => {
    // S-5's hardest guarantee. Two instants: one strictly after a fixture, one
    // exactly at it. The second must not include it.
    await asFeature(async (tx) => {
      const kickoff = new Date('2026-11-03T14:00:00Z'); // seeded fixture F08
      const atKickoff = await readCompletedFixtures(tx, [world.alphaTeamId], kickoff);
      const justAfter = await readCompletedFixtures(
        tx,
        [world.alphaTeamId],
        new Date(kickoff.getTime() + 1000)
      );
      const atCount = atKickoff.get(world.alphaTeamId)?.fixtures.length ?? 0;
      const afterCount = justAfter.get(world.alphaTeamId)?.fixtures.length ?? 0;
      assert.equal(afterCount, atCount + 1, 'the boundary fixture appears only strictly after it');
    });
  });

  it('96. a value computed at a fixture instant equals one from the earlier set alone', async () => {
    await asFeature(async (tx) => {
      const kickoff = new Date('2026-11-03T14:00:00Z');
      const histories = await readCompletedFixtures(tx, [world.alphaTeamId], kickoff);
      const ctx = context({
        subjects: [{ teamId: world.alphaTeamId, asOf: kickoff }],
        fixturesByTeam: histories,
      });
      const atInstant = formBackfill.calculate(ctx);

      // The same calculation, with the boundary fixture manually excluded — the
      // sets are identical, so the values must be too.
      const trimmed = new Map(histories);
      const history = trimmed.get(world.alphaTeamId)!;
      trimmed.set(world.alphaTeamId, {
        teamId: history.teamId,
        fixtures: history.fixtures.filter((f) => f.kickoffAt.getTime() < kickoff.getTime()),
      });
      const fromEarlier = formBackfill.calculate(context({ ...ctx, fixturesByTeam: trimmed }));

      assert.deepEqual(
        atInstant.map((c) => `${c.featureKey}=${toNumericString(c.value)}`),
        fromEarlier.map((c) => `${c.featureKey}=${toNumericString(c.value)}`)
      );
    });
  });

  // ── Replay ────────────────────────────────────────────────────────────────

  /** The business identity of every value, excluding id and calculated_at. */
  async function valueFingerprint(tx: PoolClient): Promise<string[]> {
    const { rows } = await tx.query<{ line: string }>(
      `SELECT format('%s|%s|%s|%s|%s|%s|%s|%s',
                     d.feature_key, fv.subject_kind_code, fv.subject_team_id,
                     fv.context_kind_code, fv.as_of, fv.value,
                     fv.provenance_class_code, fv.sample_observation_count) AS line
         FROM feature.feature_value fv
         JOIN feature.feature_definition d ON d.id = fv.feature_definition_id
        ORDER BY d.feature_key, fv.subject_team_id, fv.as_of`
    );
    return rows.map((row) => row.line);
  }

  /** Lineage by the NATURAL keys of both endpoints — surrogate ids necessarily differ. */
  async function lineageFingerprint(tx: PoolClient): Promise<string[]> {
    const { rows } = await tx.query<{ line: string }>(
      `SELECT format('%s@%s|%s -> %s@%s|%s',
                     pd.feature_key, p.subject_team_id, p.as_of,
                     cd.feature_key, c.subject_team_id, c.as_of) AS line
         FROM feature.feature_lineage l
         JOIN feature.feature_value p ON p.id = l.produced_value_id AND p.as_of = l.produced_value_as_of
         JOIN feature.feature_definition pd ON pd.id = p.feature_definition_id
         JOIN feature.feature_value c ON c.id = l.consumed_value_id AND c.as_of = l.consumed_value_as_of
         JOIN feature.feature_definition cd ON cd.id = c.feature_definition_id
        ORDER BY 1`
    );
    return rows.map((row) => row.line);
  }

  /** A whole clean run inside one transaction, fingerprinted, then rolled back. */
  async function cleanRun(calculatedAt: Date) {
    return asFeature(async (tx) => {
      await tx.query('BEGIN');
      try {
        const { registry, teamIds, result } = await writeStageOne(tx, REFERENCE_AS_OF, calculatedAt);
        const priorValues = await readPriorValues(
          tx,
          ['team.rest_advantage', 'team.congestion_index'],
          teamIds,
          REFERENCE_AS_OF,
          CALCULATION_CONTEXT_KIND
        );
        const readinessCandidates = teamReadiness.calculate(
          context({
            definitions: registry.definitionsByKey,
            subjects: teamIds.map((teamId) => ({ teamId, asOf: REFERENCE_AS_OF })),
            priorValues,
          })
        );
        const readiness = await writeValues(tx, registry, readinessCandidates, calculatedAt);
        const lineage = await writeLineage(tx, readiness.writtenValues);

        return {
          values: await valueFingerprint(tx),
          lineage: await lineageFingerprint(tx),
          written: result.written + readiness.written,
          skipped: result.skipped + readiness.skipped,
          lineageWritten: lineage.written,
        };
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  it('97. REPLAY A — two clean runs produce identical business output', async () => {
    // Rollback returns the feature schema to empty, so these are genuinely two
    // runs from nothing over identical reality. Only calculated_at differs, and
    // it is excluded from the fingerprint — as is `id`, which is drawn from a
    // sequence that does not reset.
    const first = await cleanRun(new Date('2026-11-10T13:00:00Z'));
    const second = await cleanRun(new Date('2026-11-11T09:30:00Z'));

    assert.deepEqual(second.values, first.values, 'values must be identical');
    assert.deepEqual(second.lineage, first.lineage, 'lineage must be identical');
    assert.equal(second.written, first.written, 'written counts must be identical');
    assert.equal(second.skipped, first.skipped, 'skipped counts must be identical');
    assert.equal(second.lineageWritten, first.lineageWritten);
    assert.ok(first.values.length > 0, 'the comparison must not be vacuous');
  });

  it('98. REPLAY B — a second run over unchanged reality writes nothing', async () => {
    await inRolledBackTx(async (tx) => {
      const calculatedAt = new Date('2026-11-10T13:00:00Z');
      const first = await writeStageOne(tx, REFERENCE_AS_OF, calculatedAt);
      assert.ok(first.result.written > 0);

      const second = await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-12T13:00:00Z'));
      assert.equal(second.result.written, 0, 'nothing new may be written');
      assert.equal(second.result.skipped, second.result.examined, 'everything must be reported skipped');
    });
  });

  it('99. calculated_at is not part of the business identity', async () => {
    await inRolledBackTx(async (tx) => {
      await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-10T13:00:00Z'));
      await writeStageOne(tx, REFERENCE_AS_OF, new Date('2026-11-12T13:00:00Z'));
      const { rows } = await tx.query<{ distinct_calculated: string }>(
        `SELECT count(DISTINCT calculated_at)::text AS distinct_calculated
           FROM feature.feature_value WHERE as_of = $1`,
        [REFERENCE_AS_OF]
      );
      // The second run wrote nothing, so exactly one calculated_at survives —
      // the row that exists keeps the instant it was created with.
      assert.equal(rows[0].distinct_calculated, '1');
    });
  });

  // ── MUTATION: the dependency graph, in the database ───────────────────────

  it('100. MUTATION — inserting a dependency edge moves a calculator between stages', async () => {
    // The direct proof that execution order is DERIVED. INSERT rather than
    // DELETE deliberately: the production role holds no DELETE, and a test
    // needing one would be a test production could not run. ROLLBACK undoes it.
    await inRolledBackTx(async (tx) => {
      const before = await loadRegistry(tx);
      const beforePlan = deriveExecutionPlan(before, CALCULATORS.map((c) => c.calculatorKey));
      const travelStageBefore = beforePlan.stages.findIndex((stage) =>
        stage.calculatorKeys.includes('travel_load')
      );
      assert.equal(travelStageBefore, 0, 'travel_load starts in stage 1');

      const travel = before.definitionsByKey.get('team.travel_impact')!;
      const rest = before.definitionsByKey.get('team.rest_advantage')!;
      await tx.query(
        `INSERT INTO feature.feature_dependency
           (consumer_definition_id, consumer_version_id, consumed_definition_id,
            consumer_context_kind_code, consumed_context_kind_code)
         VALUES ($1::bigint, $2::bigint, $3::bigint, 'ALL_COMPETITIONS', 'ALL_COMPETITIONS')
         ON CONFLICT ON CONSTRAINT uq_feature_dependency__consumer_version_consumed DO NOTHING`,
        [travel.id, travel.versionId, rest.id]
      );

      const after = await loadRegistry(tx);
      const afterPlan = deriveExecutionPlan(after, CALCULATORS.map((c) => c.calculatorKey));
      const travelStageAfter = afterPlan.stages.findIndex((stage) =>
        stage.calculatorKeys.includes('travel_load')
      );

      assert.ok(travelStageAfter > 0, 'travel_load must move out of stage 1');
      // Compared as STAGES, not as the flattened sequence. `travel_load` sorts
      // last alphabetically, so the flattened order is unchanged even though the
      // staging is not — asserting on the sequence would have hidden the move.
      assert.notDeepEqual(
        afterPlan.stages.map((stage) => stage.calculatorKeys),
        beforePlan.stages.map((stage) => stage.calculatorKeys)
      );
      // If the order were hard-coded, nothing above could have changed.
    });
  });

  // ── Temporary verification controls ───────────────────────────────────────

  it('101. every temporary verification control passes and says it is temporary', async () => {
    await withConnection('pt_platform_admin', async (tx) => {
      for (const key of VERIFICATIONS) {
        const result = await runVerification(tx, key);
        assert.equal(result.temporary, true, `${key} must declare itself temporary`);
        assert.ok(result.standsInFor.length > 20, `${key} must say what it stands in for`);
        assert.equal(result.passed, true, `${key} failed: ${result.examples.join('; ')}`);
      }
    });
  });

  it('102. the seeded world is untouched by the feature role', async () => {
    // Everything above rolled back or wrote only to `feature`. Reality is
    // exactly as ingestion left it — which the privilege model guarantees, and
    // this confirms end to end.
    await asFeature(async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `SELECT count(*)::text FROM football.fixture
          WHERE provider_external_id LIKE $1`,
        [`${TEST_PREFIX}-%`]
      );
      assert.equal(rows[0].count, '8');
    });
  });
});
