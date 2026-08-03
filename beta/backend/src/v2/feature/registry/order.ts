// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION ORDER — DERIVED, NEVER WRITTEN DOWN
//
// "EXECUTION ORDER IS DERIVED FROM THESE DECLARATIONS (§B.8, §5.12.2)."
//
// V1's dependency graph — roughly fifty edges — "lived entirely in the ordering
// of calls within one orchestration process: correct, carefully documented, and
// completely invisible to the model, such that a missing input produced empty
// values rather than an error."
//
// So there is no array of calculator names in this file, and none anywhere else
// in S-5. The order is computed from `feature_dependency` on every run. Declaring
// a new edge changes the order by being declared, which is the property mutation
// test 5 exists to prove: inserting an edge must move a calculator between
// stages, and it cannot if the order is hard-coded.
//
// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISM
//
// R-2 obligation 4: ties break by `calculator_key` ASCENDING. Iteration order
// over a Map or a Set is an implementation detail of the runtime, and a
// topological sort that depends on it produces a different — still valid —
// order on a different day, which breaks the replay guarantee that execution
// order is identical between runs.
//
// Kahn's algorithm with a sorted ready-set gives one canonical answer.
// ─────────────────────────────────────────────────────────────────────────────

import type { DependencyEdge, FeatureDefinition, Registry } from './load';

/** One execution stage: calculators with no unsatisfied dependency between them. */
export interface Stage {
  readonly ordinal: number;
  /** Calculator keys, ascending. Every one may run once the prior stage commits. */
  readonly calculatorKeys: readonly string[];
}

export interface ExecutionPlan {
  readonly stages: readonly Stage[];
  /** Flattened order, stage by stage — what a sequential runner walks. */
  readonly sequence: readonly string[];
}

/** Raised when the declared graph contains a cycle (LC-44). */
export class DependencyCycleError extends Error {
  constructor(readonly remainingCalculatorKeys: readonly string[]) {
    super(
      'the declared feature dependency graph contains a cycle involving calculators: ' +
        remainingCalculatorKeys.join(', ') +
        '. LC-44 requires acyclicity; execution order cannot be derived from a cyclic graph.'
    );
    this.name = 'DependencyCycleError';
  }
}

/**
 * Derives the execution plan for a set of calculators.
 *
 * `calculatorKeys` is the set actually implemented. Edges touching a feature
 * whose calculator is not implemented are IGNORED rather than treated as an
 * unsatisfiable prerequisite — otherwise `team.squad_stability`, which is
 * registered and deliberately never calculated (R-1), would block the entire
 * plan. Ignoring is safe because a calculator that is not run writes nothing,
 * so nothing downstream can consume its output.
 */
export function deriveExecutionPlan(
  registry: Registry,
  calculatorKeys: readonly string[]
): ExecutionPlan {
  const implemented = new Set(calculatorKeys);
  const edges = calculatorEdges(registry, implemented);

  // Kahn's algorithm. `blockedBy` counts unsatisfied prerequisites; `unblocks`
  // is the reverse adjacency used to decrement them.
  const blockedBy = new Map<string, number>();
  const unblocks = new Map<string, Set<string>>();
  for (const key of implemented) {
    blockedBy.set(key, 0);
    unblocks.set(key, new Set());
  }
  for (const [before, after] of edges) {
    // A duplicate edge must not inflate the count, or the dependent calculator
    // would never unblock. Declared edges are unique per (consumer version,
    // consumed definition, consumed context), so one feature pair can legitimately
    // appear more than once at different contexts.
    if (unblocks.get(before)!.has(after)) continue;
    unblocks.get(before)!.add(after);
    blockedBy.set(after, (blockedBy.get(after) ?? 0) + 1);
  }

  const stages: Stage[] = [];
  const sequence: string[] = [];
  let ready = [...implemented].filter((key) => blockedBy.get(key) === 0).sort(compareKeys);
  let ordinal = 1;

  while (ready.length > 0) {
    stages.push({ ordinal, calculatorKeys: [...ready] });
    sequence.push(...ready);

    const next: string[] = [];
    for (const key of ready) {
      for (const dependent of [...unblocks.get(key)!].sort(compareKeys)) {
        const remaining = (blockedBy.get(dependent) ?? 0) - 1;
        blockedBy.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    ready = next.sort(compareKeys);
    ordinal += 1;
  }

  if (sequence.length !== implemented.size) {
    const stuck = [...implemented].filter((key) => !sequence.includes(key)).sort(compareKeys);
    throw new DependencyCycleError(stuck);
  }

  return { stages, sequence };
}

/**
 * Projects feature → feature edges onto calculator → calculator edges.
 *
 * The ordering unit is the CALCULATOR, not the feature: a calculator produces
 * several features together and cannot be split across stages. An edge within
 * one calculator (a feature consuming another the same calculator produces) is
 * dropped — it would be a self-edge, and a calculator cannot run before itself.
 */
function calculatorEdges(registry: Registry, implemented: ReadonlySet<string>): [string, string][] {
  const edges: [string, string][] = [];
  for (const edge of registry.dependencies) {
    const consumer = registry.definitionsByKey.get(edge.consumerFeatureKey);
    const consumed = registry.definitionsByKey.get(edge.consumedFeatureKey);
    if (!consumer || !consumed) continue;
    if (!implemented.has(consumer.calculatorKey) || !implemented.has(consumed.calculatorKey)) continue;
    if (consumer.calculatorKey === consumed.calculatorKey) continue;
    edges.push([consumed.calculatorKey, consumer.calculatorKey]);
  }
  // Sorted so the edge list itself is order-independent, which matters because a
  // differently ordered edge list could otherwise seed the ready-set differently.
  return edges.sort((a, b) => compareKeys(a[0], b[0]) || compareKeys(a[1], b[1]));
}

/** Ascending by calculator key — the declared tie-break. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Detects a cycle in the declared graph at FEATURE level.
 *
 * Separate from `deriveExecutionPlan`, which works at calculator level and would
 * miss a cycle between two features owned by one calculator. Used by
 * `verify.ts feature_dependency_acyclic`, the temporary stand-in for the
 * BLOCKING registered assertion that has no implementation (S5-2).
 */
export function findFeatureCycle(edges: readonly DependencyEdge[]): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    // consumed -> consumer: the direction data flows.
    const list = outgoing.get(edge.consumedFeatureKey) ?? [];
    list.push(edge.consumerFeatureKey);
    outgoing.set(edge.consumedFeatureKey, list);
  }
  for (const list of outgoing.values()) list.sort(compareKeys);

  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const path: string[] = [];

  const walk = (node: string): string[] | null => {
    state.set(node, VISITING);
    path.push(node);
    for (const next of outgoing.get(node) ?? []) {
      if (state.get(next) === VISITING) {
        return [...path.slice(path.indexOf(next)), next];
      }
      if (state.get(next) === undefined) {
        const cycle = walk(next);
        if (cycle) return cycle;
      }
    }
    path.pop();
    state.set(node, DONE);
    return null;
  };

  for (const node of [...outgoing.keys()].sort(compareKeys)) {
    if (state.get(node) === undefined) {
      const cycle = walk(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

/** The definitions a calculator owns, ascending by feature key. */
export function featuresOfCalculator(
  registry: Registry,
  calculatorKey: string
): FeatureDefinition[] {
  return [...registry.definitionsByKey.values()]
    .filter((definition) => definition.calculatorKey === calculatorKey)
    .sort((a, b) => compareKeys(a.featureKey, b.featureKey));
}
