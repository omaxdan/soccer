// ─────────────────────────────────────────────────────────────────────────────
// MODULE REGISTRY SEEDING — product.entitlement_feature, module.module_definition,
// module.module_version, and the two composition version registries
//
// IDENTITY AND VERSION ONLY. NO EVALUATION LOGIC.
// A module's reading is computed by S-6. What this file establishes is what S-6
// will need and cannot create for itself: a stable key, a display identity, the
// subject it speaks about, the entitlement that gates it, how it is calibrated,
// and a version to attribute readings to.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE APPROVED THIRTEEN, AND WHAT THAT MEANS FOR V1
//
// The set below is the approved V2 module set, which differs from V1's registry
// in both directions. That was a product decision, taken deliberately:
//
//   NEW, no V1 counterpart      Squad Stability, Historical Advantage,
//                               Risk Assessment, Match Context
//                               -> registered with identity and version,
//                                  is_active = FALSE until S-6 implements them
//
//   RETIRED, present in V1      BTTS by Fatigue, Half-Time Trends,
//                               Clean Sheet Probability, Weather Impact
//                               -> NOT SEEDED. Carrying them forward silently
//                                  would make V1 the source of truth again.
//
// is_active = false is the honest state for a registered module with no
// evaluation logic: it exists, it is addressable, and it produces nothing yet.
// The alternative — registering it active and having it silently emit no
// readings — is the class of silent absence the operational layer exists to make
// visible.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { openEffectivePeriod, seedRows, seedRowsResolvingParent, type SeedOutcome } from './helpers';

interface ModuleSeed {
  readonly key: string;
  readonly displayNumber: number;
  readonly displayName: string;
  /** The question the module answers, in the product's own words. */
  readonly question: string;
  readonly subjectKind: string;
  readonly entitlementKey: string;
  readonly calibrationMode: 'OUTCOME_SCORED' | 'CONTEXTUAL';
  /**
   * Required when and only when calibrationMode is OUTCOME_SCORED —
   * ck_module_definition__outcome_dimension_conditional enforces both-or-neither.
   */
  readonly outcomeDimension: string | null;
  readonly isActive: boolean;
  /** The V1 module key this carries forward, or null when newly approved. */
  readonly v1Key: string | null;
}

/**
 * The thirteen approved modules.
 *
 * calibration_mode is OUTCOME_SCORED where the module's V1 form published a rate
 * against a match outcome — those are the readings a calibration series can
 * measure. It is CONTEXTUAL where the module characterises rather than predicts,
 * which is not a lesser status: Confidence Calibration measures the platform's
 * own reliability, and scoring it against a match result would be a category
 * error.
 *
 * The four newly approved modules are CONTEXTUAL because no evaluation logic
 * exists to score, and assigning an outcome dimension to a module that produces
 * nothing would assert a measurement intention nobody has designed. S-6 may
 * promote any of them by appending a new module_version.
 */
const MODULES: readonly ModuleSeed[] = [
  {
    key: 'home_away_split',
    displayNumber: 1,
    displayName: 'Home/Away Split',
    question: 'Home-reliant or road warrior?',
    subjectKind: 'TEAM',
    entitlementKey: 'HOME_AWAY_SPLIT',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'home_away',
  },
  {
    key: 'readiness_tracker',
    displayNumber: 2,
    displayName: 'Readiness Tracker',
    question: 'Peaking or crashing?',
    subjectKind: 'TEAM',
    entitlementKey: 'READINESS_TRACKER',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'readiness',
  },
  {
    key: 'consistency_index',
    displayNumber: 3,
    displayName: 'Consistency Index',
    question: 'Predictable or volatile?',
    subjectKind: 'TEAM',
    entitlementKey: 'CONSISTENCY_INDEX',
    // Volatility is a property of a side, not a prediction of a result.
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    isActive: true,
    v1Key: 'consistency',
  },
  {
    key: 'giant_killer_index',
    displayNumber: 4,
    displayName: 'Giant Killer Index',
    question: 'Steps up against top teams?',
    subjectKind: 'TEAM',
    entitlementKey: 'GIANT_KILLER_INDEX',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'giant_killer',
  },
  {
    key: 'travel_impact',
    displayNumber: 5,
    displayName: 'Travel Impact',
    question: 'Does distance matter here?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'TRAVEL_IMPACT',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'travel',
  },
  {
    key: 'rest_advantage',
    displayNumber: 6,
    displayName: 'Rest Advantage',
    question: 'Who is fresher, and does it register?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'REST_ADVANTAGE',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'rest',
  },
  {
    key: 'league_goal_profiles',
    displayNumber: 7,
    displayName: 'League Goal Profiles',
    question: 'Over or under league?',
    subjectKind: 'COMPETITION_EDITION',
    entitlementKey: 'LEAGUE_GOAL_PROFILE',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'GOAL_TOTAL',
    isActive: true,
    v1Key: 'league_goals',
  },
  {
    key: 'form_gap_accuracy',
    displayNumber: 8,
    displayName: 'Form Gap Accuracy',
    question: 'Does the form gap hold up?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'FORM_GAP_ACCURACY',
    calibrationMode: 'OUTCOME_SCORED',
    outcomeDimension: 'MATCH_RESULT',
    isActive: true,
    v1Key: 'form_gap',
  },
  {
    key: 'squad_stability',
    displayNumber: 9,
    displayName: 'Squad Stability',
    question: 'Settled side or rotation risk?',
    subjectKind: 'TEAM',
    entitlementKey: 'SQUAD_STABILITY',
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    // Newly approved. Identity registered; evaluation logic arrives in S-6.
    isActive: false,
    v1Key: null,
  },
  {
    key: 'confidence_calibration',
    displayNumber: 10,
    displayName: 'Confidence Calibration',
    question: 'How reliable has this pattern been?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'CONFIDENCE_CALIBRATION',
    // Measures the platform's own reliability. Scoring it against a match result
    // would be a category error.
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    isActive: true,
    v1Key: 'confidence',
  },
  {
    key: 'historical_advantage',
    displayNumber: 11,
    displayName: 'Historical Advantage',
    question: 'Does the head-to-head record say anything?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'HISTORICAL_ADVANTAGE',
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    isActive: false,
    v1Key: null,
  },
  {
    key: 'risk_assessment',
    displayNumber: 12,
    displayName: 'Risk Assessment',
    question: 'How much could go wrong here?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'RISK_ASSESSMENT',
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    isActive: false,
    v1Key: null,
  },
  {
    key: 'match_context',
    displayNumber: 13,
    displayName: 'Match Context',
    question: 'What is at stake, and for whom?',
    subjectKind: 'FIXTURE',
    entitlementKey: 'MATCH_CONTEXT',
    calibrationMode: 'CONTEXTUAL',
    outcomeDimension: null,
    isActive: false,
    v1Key: null,
  },
];

/**
 * The entitlement features the modules gate on.
 *
 * One per module, keys carried across from V1's FEATURE_BY_MODULE map so an
 * existing subscription continues to mean what it meant. Seeded here because
 * module_definition.entitlement_feature_key is NOT NULL with a foreign key onto
 * this relation — the module registry cannot exist without it.
 *
 * product.plan and product.plan_entitlement are NOT seeded. Those are commercial
 * configuration — pricing, tiers, billing — and belong to a later phase. S-3
 * establishes what features exist and which module requires which; it does not
 * establish what anything costs.
 */
const ENTITLEMENT_FEATURES: readonly (readonly [string, string, string])[] = MODULES.map((m) => [
  m.entitlementKey,
  m.displayName,
  `Gates the ${m.displayName} module. Resolved exclusively through ` +
    'product.fn_resolve_entitlements (F-21); no application code compares plans.',
]);

/**
 * Composition version registries.
 *
 * snapshot.match_snapshot requires BOTH of these as NOT NULL foreign keys: a
 * sealed snapshot names the verdict composition rule and the consensus rule in
 * force when it was sealed, so a later reader can tell whether two snapshots
 * were produced under the same rules. Without them nothing can be sealed at all.
 *
 * Registered here as identity only — the rules themselves are S-6's. This is the
 * same principle the brief states for modules: register identity and version,
 * not evaluation.
 */
const COMPOSITION_VERSIONS: readonly (readonly [string, string, string])[] = [
  [
    'module.verdict_composition_version',
    '1.0.0',
    'Initial registration. The composition rule that combines module readings into a verdict ' +
      'is implemented in S-6; this row is the identity sealed snapshots will reference.',
  ],
  [
    'module.consensus_rule_version',
    '1.0.0',
    'Initial registration. The rule that counts module agreement — retaining dissent rather ' +
      'than averaging it away (LC-73) — is implemented in S-6.',
  ],
];

/**
 * Seeds product.entitlement_feature.
 *
 * Runs as pt_platform_admin, the only role holding INSERT on product. Separated
 * from the module seed because it is a different role on a different connection.
 */
export async function seedEntitlementFeatures(tx: PoolClient): Promise<SeedOutcome[]> {
  return [
    await seedRows(
      tx,
      'product.entitlement_feature',
      ['feature_key', 'display_name', 'meaning'],
      ENTITLEMENT_FEATURES,
      ['feature_key']
    ),
  ];
}

/**
 * Seeds the module registry and the composition version registries.
 *
 * Runs as pt_pipeline_module, the role holding INSERT on schema module.
 */
export async function seedModuleRegistry(tx: PoolClient): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];

  for (const [relation, designation, rationale] of COMPOSITION_VERSIONS) {
    outcomes.push(
      await seedRows(
        tx,
        relation,
        ['designation', 'effective_period', 'rationale'],
        [[designation, openEffectivePeriod(), rationale]],
        ['designation']
      )
    );
  }

  outcomes.push(
    await seedRows(
      tx,
      'module.module_definition',
      [
        'module_key',
        'display_number',
        'display_name',
        'question',
        'subject_kind_code',
        'entitlement_feature_key',
        'calibration_mode_code',
        'outcome_dimension_code',
        'is_active',
      ],
      MODULES.map((m) => [
        m.key,
        m.displayNumber,
        m.displayName,
        m.question,
        m.subjectKind,
        m.entitlementKey,
        m.calibrationMode,
        m.outcomeDimension,
        m.isActive,
      ]),
      ['module_key']
    )
  );

  // Every module gets a version. Versions are immutable — new behaviour is a new
  // version row, never an amendment — because module_reading references the
  // version that produced it, and rewriting it would restate what a past reading
  // meant.
  outcomes.push(
    await seedRowsResolvingParent(
      tx,
      'module.module_version',
      ['module_definition_id', 'designation', 'effective_period', 'rationale'],
      `(SELECT d.id FROM module.module_definition d WHERE d.module_key = $1), $2, $3::tstzrange, $4`,
      MODULES.map((m) => [
        m.key,
        '1.0.0',
        openEffectivePeriod(),
        m.v1Key
          ? `Initial registration. Carries forward the V1 module '${m.v1Key}' unchanged; the ` +
            'evaluation logic is ported in S-6.'
          : 'Initial registration of a newly approved module. Identity and version only — no ' +
            'evaluation logic exists, which is why the definition is registered inactive.',
      ]),
      ['module_definition_id', 'designation']
    )
  );

  return outcomes;
}

/** Exposed for the test suite, so expectations are not restated by hand. */
export const MODULE_KEYS = MODULES.map((m) => m.key);
export const ACTIVE_MODULE_KEYS = MODULES.filter((m) => m.isActive).map((m) => m.key);
export const INACTIVE_MODULE_KEYS = MODULES.filter((m) => !m.isActive).map((m) => m.key);
export const ENTITLEMENT_KEYS = MODULES.map((m) => m.entitlementKey);
/** V1 modules deliberately not carried forward. */
export const RETIRED_V1_MODULE_KEYS = ['btts_fatigue', 'halftime', 'clean_sheet', 'weather'] as const;
