// MATCH TIMELINE RENDER TESTS (DB-free; react-dom/server, no DOM/network).
//
// The Timeline tab merges the observed lifecycle transitions with the other known
// instants — kickoff, the intelligence lock, and result confirmation — into one
// chronological dot-timeline. Covers:
//   • merge + chronological order of all four event sources;
//   • status transitions surface their to-state, never the raw provider status;
//   • a fixture with no lifecycle still shows the known instants (kickoff), honestly;
//   • no betting / prediction lexicon.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { LifecycleTimeline } from '@/components/v2/match';
import type { MatchLifecycle } from '@/lib/v2/types';

function text(node: React.ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const LIFECYCLE: MatchLifecycle = {
  transitions: [
    { fromState: null, toState: { code: 'SCHEDULED', displayName: 'Scheduled' }, transitionedAt: '2026-08-01T00:00:00.000Z', providerStatusRaw: 'notstarted' },
    { fromState: { code: 'SCHEDULED', displayName: 'Scheduled' }, toState: { code: 'COMPLETED', displayName: 'Completed' }, transitionedAt: '2026-09-07T23:00:00.000Z', providerStatusRaw: 'finished' },
  ],
  coverage: { transitions: 'present', transitionsAreObserved: true },
};

describe('Timeline — merged lifecycle', () => {
  const t = text(
    <LifecycleTimeline
      lifecycle={LIFECYCLE}
      kickoffAt="2026-09-07T23:00:00.000Z"
      lockedAt="2026-09-08T07:25:04.000Z"
      confirmedAt="2026-09-08T01:00:00.000Z"
    />,
  );
  test('merges kickoff, status transitions, intelligence lock and result confirmation', () => {
    assert.match(t, /Timeline/);
    assert.match(t, /Kickoff/);
    assert.match(t, /Scheduled/); assert.match(t, /Completed/);
    assert.match(t, /Intelligence locked/);
    assert.match(t, /Result confirmed/);
  });
  test('never exposes the raw provider status', () => {
    assert.doesNotMatch(t, /finished/i);
    assert.doesNotMatch(t, /notstarted/i);
    assert.doesNotMatch(t.toLowerCase(), /providerstatus/);
  });
});

describe('Timeline — no lifecycle', () => {
  test('still shows the known instants (kickoff) honestly, never fabricated status', () => {
    const t = text(<LifecycleTimeline lifecycle={null} kickoffAt="2026-09-07T23:00:00.000Z" />);
    assert.match(t, /Kickoff/);
    assert.match(t, /not recorded/i);
  });
});

describe('no betting / prediction lexicon', () => {
  test('timeline carries no forbidden terms', () => {
    const all = text(
      <LifecycleTimeline lifecycle={LIFECYCLE} kickoffAt="2026-09-07T23:00:00.000Z" lockedAt="2026-09-08T07:25:04.000Z" confirmedAt={null} />,
    ).toLowerCase();
    for (const term of ['predicted', 'prediction', 'probability', 'odds', 'bookmaker', 'stake', 'wager', 'betting', 'tip', 'guaranteed', 'best bet']) {
      assert.equal(all.includes(term), false, `must not contain "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
