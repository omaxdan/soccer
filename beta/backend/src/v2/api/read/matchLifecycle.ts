// ─────────────────────────────────────────────────────────────────────────────
// MATCH LIFECYCLE — read model (SQL + pure mapping), evidence-honest
//
// Projects a fixture's APPEND-ONLY state-transition history from PERSISTED football
// state (`football.fixture_lifecycle_transition`). Layers kept strictly distinct:
//
//   OBSERVED DB EVIDENCE  — each recorded transition: from-state → to-state, when
//     it was observed, and the provider's raw status string at that point.
//   READ-MODEL SHAPING    — chronological ordering and joining each state code to
//     its display label. No inference, no arithmetic.
//   GOVERNED INTELLIGENCE — NONE. No risk score, no postponement prediction, no
//     verdict. This is the observed lifecycle history, verbatim.
//
// Governance rules enforced by construction:
//   • The initial transition has no from-state (from_state_code is nullable) —
//     represented as fromState: null, never a fabricated prior state.
//   • provider_status_raw is passed through unchanged (diagnosis only).
//   • A fixture with no recorded transitions yields an empty history and coverage
//     'absent' — never an invented transition.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

export interface LifecycleState {
  readonly code: string;
  readonly displayName: string | null;
}

export interface LifecycleTransition {
  /** The prior state, or null for the initial transition (from nothing). */
  readonly fromState: LifecycleState | null;
  readonly toState: LifecycleState;
  readonly transitionedAt: string;        // ISO-8601
  readonly providerStatusRaw: string | null;
}

export type LifecycleCoverageState = 'present' | 'absent';
export interface MatchLifecycleCoverage {
  readonly transitions: LifecycleCoverageState;
  /** Marks the history as observed evidence, not a derived risk/prediction. */
  readonly transitionsAreObserved: true;
}

export interface MatchLifecycle {
  readonly transitions: readonly LifecycleTransition[];
  readonly coverage: MatchLifecycleCoverage;
}

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface LifecycleTransitionRow {
  from_code: string | null;
  from_display: string | null;
  to_code: string;
  to_display: string | null;
  transitioned_at: Date | string;
  provider_status_raw: string | null;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapTransition(r: LifecycleTransitionRow): LifecycleTransition {
  return {
    fromState: r.from_code === null || r.from_code === undefined
      ? null
      : { code: r.from_code, displayName: r.from_display },
    toState: { code: r.to_code, displayName: r.to_display },
    transitionedAt: iso(r.transitioned_at),
    providerStatusRaw: r.provider_status_raw,
  };
}

/**
 * Build the lifecycle history: transitions in chronological order (earliest first).
 * Pure and deterministic; does not mutate input. A fixture with no transitions yields
 * an empty history and coverage 'absent'.
 */
export function buildMatchLifecycle(rows: readonly LifecycleTransitionRow[]): MatchLifecycle {
  const transitions = rows
    .map(mapTransition)
    .sort((a, b) => a.transitionedAt.localeCompare(b.transitionedAt) || a.toState.code.localeCompare(b.toState.code));
  return {
    transitions,
    coverage: {
      transitions: transitions.length > 0 ? 'present' : 'absent',
      transitionsAreObserved: true,
    },
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

const MATCH_LIFECYCLE_SQL = `
  SELECT flt.from_state_code AS from_code, fs.display_name AS from_display,
         flt.to_state_code AS to_code, ts.display_name AS to_display,
         flt.transitioned_at AS transitioned_at, flt.provider_status_raw AS provider_status_raw
    FROM football.fixture_lifecycle_transition flt
    LEFT JOIN football.fixture_lifecycle_state fs ON fs.code = flt.from_state_code
    JOIN football.fixture_lifecycle_state ts ON ts.code = flt.to_state_code
   WHERE flt.fixture_id = $1::bigint
   ORDER BY flt.transitioned_at
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readMatchLifecycle(tx: PoolClient, fixtureId: string): Promise<MatchLifecycle> {
  const res = await tx.query<LifecycleTransitionRow>(MATCH_LIFECYCLE_SQL, [fixtureId]);
  return buildMatchLifecycle(res.rows);
}
