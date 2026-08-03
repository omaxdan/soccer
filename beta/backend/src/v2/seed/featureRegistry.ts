// ─────────────────────────────────────────────────────────────────────────────
// FEATURE REGISTRY SEEDING — feature.feature_calculator, feature_definition,
// feature_definition_context_kind, feature_version
//
// EVERY FEATURE HERE MAPS TO A QUANTITY V1 ALREADY COMPUTES. Nothing is
// invented: each entry names the V1 column it corresponds to, so the mapping is
// checkable rather than asserted.
//
// WHAT IS DELIBERATELY NOT SEEDED
//   feature.feature_source      — describes which football relations a
//   feature.feature_dependency    calculation reads, and which features it
//                                 consumes. Neither is knowable until the
//                                 calculators exist, which is S-5. Seeding them
//                                 now would be describing calculations nobody
//                                 has written. (LC-44 acyclicity over
//                                 feature_dependency is enforced by the
//                                 validation assertion of migration 018 — TODO-3
//                                 in the S-3 inventory — which is another reason
//                                 to populate it only when it is real.)
//
// THE KEY FORMAT IS THE DATABASE'S. ck_feature_definition__key_namespaced
// requires ^(team|player|fixture|competition)\.[a-z0-9_]+$, so a bare
// 'readiness_score' is refused and 'team.readiness_score' is not. This module
// does not check that — PostgreSQL does, and a seed that pre-checked would
// duplicate a database rule in TypeScript.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { openEffectivePeriod, seedRows, seedRowsResolvingParent, type SeedOutcome } from './helpers';

/**
 * Calculators, each naming the V1 job that computes its features today.
 *
 * A calculator is the unit of implementation; a feature definition is the unit
 * of meaning. Several features share a calculator when one V1 processor produces
 * them together, which is exactly how the code is organised now.
 */
const CALCULATORS: readonly (readonly [string, string, string, string])[] = [
  [
    'form_backfill',
    'Form backfill',
    '1.0.0',
    'V1 jobs/processForm.ts and the form stage of processDbOnly.ts, writing team_form_history.',
  ],
  [
    'team_readiness',
    'Team readiness',
    '1.0.0',
    'V1 processTeamIntelligencePartial in jobs/processDbOnly.ts, writing team_intelligence.readiness_score.',
  ],
  [
    'fixture_load',
    'Fixture load',
    '1.0.0',
    'V1 processTeamFixtureLoad in jobs/processDbOnly.ts, writing team_fixture_load and rest days.',
  ],
  [
    'travel_load',
    'Travel load',
    '1.0.0',
    'V1 processTeamTravelLoad and processMatchTravelIntelligence in jobs/processDbOnly.ts.',
  ],
  [
    'squad_continuity',
    'Squad continuity',
    '1.0.0',
    'Derived from V1 team_squads_snapshot, which records squad composition per sync.',
  ],
];

interface FeatureSeed {
  readonly key: string;
  readonly calculator: string;
  readonly subjectKind: string;
  readonly displayName: string;
  readonly meaning: string;
  readonly unit: string;
  /** Decimal places retained. ck_feature_definition__scale_bounded: 0..12. */
  readonly valueScale: number;
  readonly direction: 'HIGHER_IS_STRONGER' | 'LOWER_IS_STRONGER' | 'UNSIGNED';
  /** The strongest provenance a value of this feature may ever claim. */
  readonly maxProvenance: string;
  readonly sampleThreshold: number;
  /** Context kinds this feature is defined at (A.11 binding relation). */
  readonly contextKinds: readonly string[];
}

/**
 * The seven features, each traced to the V1 quantity it represents.
 *
 * max_provenance_class_code is load-bearing and not decorative: the statement-
 * level provenance trigger of migration 015 (A.12) refuses a derived value
 * claiming a class stronger than the weakest in its lineage, and this column is
 * the ceiling for the definition. A feature computed from observed appearances
 * is DERIVED; one resting on an estimate can never be better than ESTIMATED.
 */
const FEATURES: readonly FeatureSeed[] = [
  {
    key: 'team.home_form',
    calculator: 'form_backfill',
    subjectKind: 'TEAM',
    displayName: 'Home form',
    meaning:
      'Weighted recent result quality in home fixtures. V1: team_form_history filtered to is_home, surfaced as team_intelligence.form_index for the home split.',
    unit: 'index',
    valueScale: 2,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 5,
    contextKinds: ['ALL_COMPETITIONS', 'COMPETITION_SCOPED'],
  },
  {
    key: 'team.away_form',
    calculator: 'form_backfill',
    subjectKind: 'TEAM',
    displayName: 'Away form',
    meaning:
      'Weighted recent result quality in away fixtures. V1: team_form_history filtered to NOT is_home. Held separately from home form because collapsing the two destroys the distinction the Home/Away Split module exists to report.',
    unit: 'index',
    valueScale: 2,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 5,
    contextKinds: ['ALL_COMPETITIONS', 'COMPETITION_SCOPED'],
  },
  {
    key: 'team.readiness_score',
    calculator: 'team_readiness',
    subjectKind: 'TEAM',
    displayName: 'Readiness score',
    meaning:
      'Composite of availability, rest and recent load — how prepared a side is to perform. V1: team_intelligence.readiness_score, the quantity readiness_history archives before each fixture.',
    unit: 'index',
    valueScale: 2,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 3,
    contextKinds: ['ALL_COMPETITIONS'],
  },
  {
    key: 'team.rest_advantage',
    calculator: 'fixture_load',
    subjectKind: 'TEAM',
    displayName: 'Rest advantage',
    meaning:
      'Days of recovery since the previous fixture. V1: team_intelligence.rest_days_avg and the rest inputs of match_intelligence. OBSERVED rather than derived — it is arithmetic over recorded kickoff times, not an estimate.',
    unit: 'days',
    valueScale: 1,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenance: 'OBSERVED',
    sampleThreshold: 1,
    contextKinds: ['ALL_COMPETITIONS'],
  },
  {
    key: 'team.travel_impact',
    calculator: 'travel_load',
    subjectKind: 'TEAM',
    displayName: 'Travel impact',
    meaning:
      'Accumulated travel burden from recent away fixtures, by distance and frequency. V1: team_intelligence.travel_fatigue_score, computed from team_locations and match_travel_intelligence.',
    unit: 'index',
    valueScale: 2,
    direction: 'LOWER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 3,
    contextKinds: ['ALL_COMPETITIONS'],
  },
  {
    key: 'team.congestion_index',
    calculator: 'fixture_load',
    subjectKind: 'TEAM',
    displayName: 'Congestion index',
    meaning:
      'Fixture density over the recent window — how compressed a side’s schedule has been. V1: team_fixture_load, the congestion inputs behind rotation risk.',
    unit: 'index',
    valueScale: 2,
    direction: 'LOWER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 3,
    contextKinds: ['ALL_COMPETITIONS', 'COMPETITION_SCOPED'],
  },
  {
    key: 'team.squad_stability',
    calculator: 'squad_continuity',
    subjectKind: 'TEAM',
    displayName: 'Squad stability',
    meaning:
      'Continuity of selection across recent fixtures — how settled a side is. V1: derived from team_squads_snapshot, which records composition at each squad sync.',
    unit: 'ratio',
    valueScale: 4,
    direction: 'HIGHER_IS_STRONGER',
    maxProvenance: 'DERIVED',
    sampleThreshold: 3,
    contextKinds: ['ALL_COMPETITIONS'],
  },
];

/**
 * Seeds the feature registry.
 *
 * Runs as pt_pipeline_feature, the role holding INSERT on schema feature. The
 * administrative role cannot do this — it holds SELECT, plus UPDATE on the five
 * registry relations, and no INSERT. That is the privilege matrix assigning
 * writes by layer, not an oversight.
 */
export async function seedFeatureRegistry(tx: PoolClient): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];

  outcomes.push(
    await seedRows(
      tx,
      'feature.feature_calculator',
      ['calculator_key', 'display_name', 'implementation_version', 'description'],
      CALCULATORS,
      ['calculator_key']
    )
  );

  // feature_calculator_id is resolved from the calculator's natural key in the
  // same statement — a surrogate id is not stable across environments and must
  // never appear in a seed.
  outcomes.push(
    await seedRowsResolvingParent(
      tx,
      'feature.feature_definition',
      [
        'feature_key',
        'subject_kind_code',
        'display_name',
        'meaning',
        'unit',
        'value_scale',
        'direction',
        'max_provenance_class_code',
        'meaningful_sample_threshold',
        'feature_calculator_id',
      ],
      `$1, $2, $3, $4, $5, $6, $7, $8, $9,
       (SELECT c.id FROM feature.feature_calculator c WHERE c.calculator_key = $10)`,
      FEATURES.map((f) => [
        f.key,
        f.subjectKind,
        f.displayName,
        f.meaning,
        f.unit,
        f.valueScale,
        f.direction,
        f.maxProvenance,
        f.sampleThreshold,
        f.calculator,
      ]),
      ['feature_key']
    )
  );

  // A.11 — the binding relation that replaces a registry-lookup trigger. Every
  // feature value's (definition, context) pair is validated by a composite
  // foreign key onto this relation rather than by procedural checking.
  const contextRows = FEATURES.flatMap((f) => f.contextKinds.map((c) => [f.key, c] as const));
  outcomes.push(
    await seedRowsResolvingParent(
      tx,
      'feature.feature_definition_context_kind',
      ['feature_definition_id', 'context_kind_code'],
      `(SELECT d.id FROM feature.feature_definition d WHERE d.feature_key = $1), $2`,
      contextRows,
      ['feature_definition_id', 'context_kind_code']
    )
  );

  // One version per definition. Versions are IMMUTABLE: a change in how a
  // feature is computed is a new version row, never an amendment, because a
  // feature value references the version that produced it and rewriting the
  // version would restate what a past value meant.
  outcomes.push(
    await seedRowsResolvingParent(
      tx,
      'feature.feature_version',
      ['feature_definition_id', 'designation', 'effective_period', 'rationale'],
      `(SELECT d.id FROM feature.feature_definition d WHERE d.feature_key = $1), $2, $3::tstzrange, $4`,
      FEATURES.map((f) => [
        f.key,
        '1.0.0',
        openEffectivePeriod(),
        'Initial registration. Represents the V1 computation named in the definition’s meaning, ' +
          'carried across unchanged. The calculator that implements it arrives in S-5.',
      ]),
      ['feature_definition_id', 'designation']
    )
  );

  return outcomes;
}

/** Exposed for the test suite. */
export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const CALCULATOR_KEYS = CALCULATORS.map((c) => c[0]);
export const FEATURE_CONTEXT_PAIRS = FEATURES.reduce((n, f) => n + f.contextKinds.length, 0);
