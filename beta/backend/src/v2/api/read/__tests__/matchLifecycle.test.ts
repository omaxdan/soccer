// MATCH LIFECYCLE read-model tests (DB-free, pure).
//
// Proves the evidence-honest lifecycle-history projection:
//   • a transition maps from/to state (code + display) and raw provider status
//   • the INITIAL transition (from_state_code null) → fromState null, never a
//     fabricated prior state
//   • transitions are ordered chronologically (earliest first), deterministic
//   • a null provider status stays null
//   • no transitions → empty history, coverage 'absent' (never invented)
//   • no risk/prediction/verdict language leaks

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mapTransition, buildMatchLifecycle, type LifecycleTransitionRow } from '../matchLifecycle';

function row(over: Partial<LifecycleTransitionRow> & { to_code: string; transitioned_at: string }): LifecycleTransitionRow {
  return {
    from_code: 'SCHEDULED', from_display: 'Scheduled',
    to_display: over.to_code === 'COMPLETED' ? 'Completed' : null,
    provider_status_raw: 'finished',
    ...over,
  };
}

describe('mapTransition', () => {
  test('maps from/to state (code + display) and raw provider status', () => {
    const t = mapTransition(row({ from_code: 'SCHEDULED', from_display: 'Scheduled', to_code: 'COMPLETED', to_display: 'Completed', transitioned_at: '2026-07-18T01:00:00.000Z', provider_status_raw: 'finished' }));
    assert.deepEqual(t, {
      fromState: { code: 'SCHEDULED', displayName: 'Scheduled' },
      toState: { code: 'COMPLETED', displayName: 'Completed' },
      transitionedAt: '2026-07-18T01:00:00.000Z',
      providerStatusRaw: 'finished',
    });
  });

  test('the initial transition (from null) → fromState null, never fabricated', () => {
    const t = mapTransition(row({ from_code: null, from_display: null, to_code: 'SCHEDULED', to_display: 'Scheduled', transitioned_at: '2026-06-01T00:00:00.000Z' }));
    assert.equal(t.fromState, null);
    assert.deepEqual(t.toState, { code: 'SCHEDULED', displayName: 'Scheduled' });
  });

  test('a null provider status stays null', () => {
    const t = mapTransition(row({ to_code: 'POSTPONED', to_display: 'Postponed', transitioned_at: '2026-06-10T00:00:00.000Z', provider_status_raw: null }));
    assert.equal(t.providerStatusRaw, null);
  });
});

describe('buildMatchLifecycle', () => {
  const rows: LifecycleTransitionRow[] = [
    // deliberately out of chronological order
    row({ from_code: 'SCHEDULED', from_display: 'Scheduled', to_code: 'COMPLETED', to_display: 'Completed', transitioned_at: '2026-07-18T01:00:00.000Z' }),
    row({ from_code: null, from_display: null, to_code: 'SCHEDULED', to_display: 'Scheduled', transitioned_at: '2026-06-01T00:00:00.000Z' }),
    row({ from_code: 'SCHEDULED', from_display: 'Scheduled', to_code: 'POSTPONED', to_display: 'Postponed', transitioned_at: '2026-06-20T00:00:00.000Z' }),
  ];
  const out = buildMatchLifecycle(rows);

  test('transitions ordered chronologically (earliest first)', () => {
    assert.deepEqual(out.transitions.map((t) => t.toState.code), ['SCHEDULED', 'POSTPONED', 'COMPLETED']);
  });

  test('first transition is the initial one (fromState null)', () => {
    assert.equal(out.transitions[0].fromState, null);
  });

  test('coverage present + observed flag set', () => {
    assert.equal(out.coverage.transitions, 'present');
    assert.equal(out.coverage.transitionsAreObserved, true);
  });

  test('does not mutate the input array order', () => {
    assert.equal(rows[0].to_code, 'COMPLETED');
  });
});

describe('absence & governance', () => {
  test('no transitions → empty history, coverage absent (never fabricated)', () => {
    const out = buildMatchLifecycle([]);
    assert.deepEqual(out.transitions, []);
    assert.equal(out.coverage.transitions, 'absent');
    assert.equal(out.coverage.transitionsAreObserved, true);
  });

  test('projection carries no risk/prediction/verdict language', () => {
    const blob = JSON.stringify(buildMatchLifecycle([row({ to_code: 'COMPLETED', to_display: 'Completed', transitioned_at: '2026-07-18T01:00:00.000Z' })])).toLowerCase();
    for (const term of ['risk', 'predicted', 'probability', 'verdict', 'confidence', 'readiness']) {
      assert.equal(blob.includes(term), false, `lifecycle must not emit "${term}"`);
    }
  });
});
