// ─────────────────────────────────────────────────────────────────────────────
// THE MODULE CALCULATOR CONTRACT (S-6)
//
// The Layer-3 analogue of the S-5 feature Calculator. A module calculator is
// PURE: it receives already-read consumed feature values and returns a finding
// (status + verdict). It is handed no PoolClient and no clock, so it cannot read
// a database or a wall clock (the same R-2 obligation the feature calculators
// observe). The engine does everything else — eligibility, version selection,
// evidence assembly, sample counting, threshold evaluation, persistence,
// telemetry — so a module never re-implements any of it.
//
// WHAT A CALCULATOR DECIDES, AND WHAT IT DOES NOT
//   decides:      module_status_code (SUPPORTS/NEUTRAL/CONTRADICTS) and verdict
//   does NOT:     INACTIVE (the engine raises it when a declared input is absent
//                 — the calculator is only called when every input is present, so
//                 it never sees absence); the sample count (MIN(consumed), D-5c-i);
//                 sample_meets_threshold (engine, vs the module version); strength
//                 and confidence (NULL at 1.0.0, D-5a/D-5b); the baseline (NULL,
//                 S-9 out of scope).
// ─────────────────────────────────────────────────────────────────────────────

import type { Exact } from '../feature/write/scale';
import type {
  CALCULATION_CONTEXT_KIND,
  COMPETITION_SCOPED_CONTEXT_KIND,
} from '../feature/calculators/types';

/**
 * The module statuses (E3.07). INACTIVE is the engine's, never a calculator's.
 *
 * MEASURED (S-9C, OD-1) is an engaged, NON-DIRECTIONAL status: a valid
 * measured/characterised result that does not assert SUPPORTS/NEUTRAL/CONTRADICTS.
 * It is emitted ONLY by the 2.0.0 magnitude path; the 1.0.0 categorical contract
 * is unchanged. A MEASURED reading carries `strength`; its evidence items, whose
 * `contribution_direction` is schema-constrained to SUPPORTS/CONTRADICTS/NEUTRAL,
 * record NEUTRAL (a magnitude input has no directional contribution).
 */
export const MODULE_STATUS = {
  SUPPORTS: 'SUPPORTS',
  NEUTRAL: 'NEUTRAL',
  CONTRADICTS: 'CONTRADICTS',
  MEASURED: 'MEASURED',
  INACTIVE: 'INACTIVE',
} as const;

/** The engaged statuses a calculator may return. MEASURED is non-directional (S-9C). */
export type EngagedStatus = 'SUPPORTS' | 'NEUTRAL' | 'CONTRADICTS' | 'MEASURED';

/** The directional statuses valid as an evidence item's contribution_direction (schema CHECK). */
export type ContributionDirection = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/**
 * The contribution_direction an evidence item records for a finding. Directional
 * statuses pass through; a non-directional MEASURED finding contributes NEUTRAL,
 * the only faithful non-directional value the schema CHECK admits.
 */
export function contributionDirectionOf(status: EngagedStatus): ContributionDirection {
  return status === 'MEASURED' ? 'NEUTRAL' : status;
}

/** A feature value a module consumed, with the identity evidence and lineage need. */
export interface ConsumedFeature {
  readonly featureKey: string;
  /** `feature_value.id`, cited by module_evidence_item. */
  readonly valueId: string;
  /** The consumed value's own `as_of` — the other half of the composite citation. */
  readonly asOf: Date;
  readonly value: Exact;
  readonly sampleObservationCount: number;
}

/** What a pure module calculator returns when it can speak. */
export interface ModuleFinding {
  readonly status: EngagedStatus;
  /** The module's own plain conclusion (E3.09). No action, stake or selection (LC-71). */
  readonly verdictText: string;
  /**
   * The measured magnitude, when the module is magnitude-bearing (S-9C, MEASURED).
   * Carried at the module's own scale, converted to numeric at the write boundary.
   * The engine writes it ONLY at the 2.0.0 magnitude version; at 1.0.0 it stays
   * NULL (D-5a). A directional (SUPPORTS/NEUTRAL/CONTRADICTS) finding omits it.
   */
  readonly strength?: Exact;
}

/**
 * A module calculator — pure and deterministic.
 *
 * `inputFeatureKeys` is the D-3 declaration site: the module names the features
 * it consumes IN CODE, and the engine derives `declared_input_count` from it. No
 * `module_input` relation exists or is needed.
 */
export interface ModuleCalculator {
  readonly moduleKey: string;
  readonly subjectKind: 'TEAM';
  /**
   * The scope at which the engine reads this module's declared inputs, over the
   * shared `football.context_kind` vocabulary — the module-layer analogue of the
   * feature `Calculator.contextKind`, reusing its constants rather than a parallel
   * vocabulary (Gate E-i). `COMPETITION_SCOPED` reads edition-keyed feature values
   * (`home_away_split`); `ALL_COMPETITIONS` reads values with a NULL edition. A
   * calculator declares exactly ONE scope: every input in `inputFeatureKeys` is
   * read at it. Mixed-context modules are unsupported (Gate E-i §Q9).
   */
  readonly contextKind: typeof CALCULATION_CONTEXT_KIND | typeof COMPETITION_SCOPED_CONTEXT_KIND;
  readonly inputFeatureKeys: readonly string[];
  /**
   * True for a magnitude-bearing module (S-9C): it returns a MEASURED finding with
   * `strength`, and the engine produces it ONLY at the 2.0.0 version. Omitted/false
   * is the default — the existing categorical modules, unchanged. Additive.
   */
  readonly emitsMagnitude?: boolean;
  /**
   * Called ONLY when every declared input is present, so `inputs` always holds
   * all of `inputFeatureKeys`. Must be deterministic: same inputs → same finding.
   */
  evaluate(inputs: ReadonlyMap<string, ConsumedFeature>): ModuleFinding;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE-SUBJECT COMPARISON MODULES (S-6.x)
//
// The first module family whose subject is the FIXTURE, comparing the two teams.
// Governed by D-4 (a FIXTURE module may consume TEAM-subject features) and D-4a
// (a per-side input is TWO declared inputs — the same feature read for home AND
// away). It is a SIBLING of `ModuleCalculator`, not a modification: the TEAM path
// is untouched, so a change here cannot alter `home_away_split`/`readiness_tracker`.
//
// The status is still the four governed codes; its meaning is the module's OWN
// characterisation (doc 56 C-2), anchored by the version rationale. No orientation
// column is needed (doc 56 C-3): the favoured side lives in `verdict_text`.
// ─────────────────────────────────────────────────────────────────────────────

/** The two teams' consumed inputs for a fixture comparison. */
export interface FixtureInputs {
  readonly home: ReadonlyMap<string, ConsumedFeature>;
  readonly away: ReadonlyMap<string, ConsumedFeature>;
}

/**
 * A FIXTURE-subject module calculator — pure and deterministic.
 *
 * By default the comparison is SYMMETRIC: `inputFeatureKeys` names the features
 * read for EACH side, the engine reads them for both teams, and
 * `declared_input_count = inputFeatureKeys.length * 2` (D-4a) — this is
 * `rest_advantage` (both sides consume `team.rest_advantage`).
 *
 * A module whose sides consume DIFFERENT features declares them per side with the
 * optional `homeInputFeatureKeys` / `awayInputFeatureKeys` (S-6.x form_gap_accuracy:
 * the home side reads `team.home_form`, the away side `team.away_form`). When a
 * per-side list is omitted it falls back to `inputFeatureKeys`, so the symmetric
 * modules are byte-for-byte unchanged. `declared_input_count` is then
 * `homeInputKeys.length + awayInputKeys.length`. `evaluate` is called ONLY when
 * every declared input is present for its own side.
 */
export interface FixtureModuleCalculator {
  readonly moduleKey: string;
  readonly subjectKind: 'FIXTURE';
  readonly contextKind: typeof CALCULATION_CONTEXT_KIND | typeof COMPETITION_SCOPED_CONTEXT_KIND;
  readonly inputFeatureKeys: readonly string[];
  /** The features read for the HOME side; defaults to `inputFeatureKeys` (symmetric). */
  readonly homeInputFeatureKeys?: readonly string[];
  /** The features read for the AWAY side; defaults to `inputFeatureKeys` (symmetric). */
  readonly awayInputFeatureKeys?: readonly string[];
  evaluate(inputs: FixtureInputs): ModuleFinding;
}

/** The features a FIXTURE calculator reads for the HOME side (per-side or symmetric default). */
export function homeInputKeys(c: FixtureModuleCalculator): readonly string[] {
  return c.homeInputFeatureKeys ?? c.inputFeatureKeys;
}

/** The features a FIXTURE calculator reads for the AWAY side (per-side or symmetric default). */
export function awayInputKeys(c: FixtureModuleCalculator): readonly string[] {
  return c.awayInputFeatureKeys ?? c.inputFeatureKeys;
}
