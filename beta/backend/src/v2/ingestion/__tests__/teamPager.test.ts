// ─────────────────────────────────────────────────────────────────────────────
// TEAM EVENT PAGER TESTS
//
// NO PROVIDER, NO DATABASE. The team feed was never committed to the evidence
// dir (only season captures were), so these pages are SYNTHETIC — which is the
// pager suite's own convention for branches with no committed body. They prove
// the walk ALGORITHM (page traversal, termination, dedup, ordering), not a claim
// about the provider's contract, which stays validation-pending (V1).
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pageTeamEvents, sweepTeam, TEAM_ENDPOINT_BY_DIRECTION } from '../provider/teamPager';
import type { EventDirection, EventPageSource, FixtureWindow } from '../provider/pager';
import { ProviderRequestError, type ProviderObservation } from '../provider/client';
import type { EndpointKey } from '../provider/endpoints';

const WINDOW: FixtureWindow = {
  startsAt: new Date(0),
  endsAt: new Date('2100-01-01T00:00:00.000Z'),
};

/** A synthetic event interpretable by the shared `interpretEvent`. */
function ev(id: number, ts: number, opts: { home?: number; away?: number; ut?: number } = {}): Record<string, unknown> {
  return {
    id,
    startTimestamp: ts,
    tournament: { id: 83, uniqueTournament: { id: opts.ut ?? 325, name: 'X' } },
    season: { id: 87678 },
    homeTeam: { id: opts.home ?? 1963, name: 'H' },
    awayTeam: { id: opts.away ?? 999, name: 'A' },
    status: { code: 100, type: 'finished' },
    winnerCode: 1,
  };
}

function envelope(events: unknown[], hasNextPage: boolean): unknown {
  return { success: true, data: { events, hasNextPage }, source: 'live', cacheHit: false };
}

/** Answers from a page map keyed `endpointKey:page`; anything else is 404. */
class FakeSource implements EventPageSource {
  readonly requested: string[] = [];
  constructor(private readonly bodies: Map<string, unknown>) {}

  async getObserved<T>(key: EndpointKey, params: Record<string, string | number>): Promise<ProviderObservation<T>> {
    const page = Number(params.limit); // the page is passed positionally as `limit`
    this.requested.push(`${key}:${page}`);
    const body = this.bodies.get(`${key}:${page}`);
    if (body === undefined) throw new ProviderRequestError('not found', key, 404, 1);
    return {
      endpointKey: key, path: '', url: '', parameters: params, status: 200, attempts: 1,
      quotaRemaining: null, data: body as T,
    };
  }
}

const LAST = TEAM_ENDPOINT_BY_DIRECTION.last;
const NEXT = TEAM_ENDPOINT_BY_DIRECTION.next;

function source(pages: Record<string, unknown>): FakeSource {
  return new FakeSource(new Map(Object.entries(pages)));
}

describe('team event pager', () => {
  test('walks zero-based pages and stops on hasNextPage=false', async () => {
    const src = source({
      [`${LAST}:0`]: envelope([ev(1, 100), ev(2, 200)], true),
      [`${LAST}:1`]: envelope([ev(3, 300)], false),
    });
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: WINDOW, callBudget: 10 });
    assert.deepEqual(src.requested, [`${LAST}:0`, `${LAST}:1`]);
    assert.equal(result.stoppedBecause, 'HAS_NEXT_PAGE_FALSE');
    assert.deepEqual(result.events.map((e) => e.providerEventId), ['1', '2', '3']);
  });

  test('404 is terminal and costs one call', async () => {
    const src = source({ [`${LAST}:0`]: envelope([ev(1, 100)], true) });
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: WINDOW, callBudget: 10 });
    assert.equal(result.stoppedBecause, 'NOT_FOUND');
    assert.deepEqual(src.requested, [`${LAST}:0`, `${LAST}:1`]);
  });

  test('a short page is NOT terminal', async () => {
    const src = source({
      [`${LAST}:0`]: envelope([ev(1, 100)], true), // 1 event, but hasNextPage true
      [`${LAST}:1`]: envelope([ev(2, 200), ev(3, 300)], false),
    });
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: WINDOW, callBudget: 10 });
    assert.equal(result.events.length, 3);
    assert.equal(result.stoppedBecause, 'HAS_NEXT_PAGE_FALSE');
  });

  test('budget exhaustion stops with a resume point', async () => {
    const src = source({
      [`${LAST}:0`]: envelope([ev(1, 100)], true),
      [`${LAST}:1`]: envelope([ev(2, 200)], true),
    });
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: WINDOW, callBudget: 1 });
    assert.equal(result.stoppedBecause, 'BUDGET_EXHAUSTED');
    assert.equal(result.resumeFromPage, 1);
    assert.equal(result.callsSpent, 1);
  });

  test('a page wholly before the window ends the backward walk', async () => {
    const narrow: FixtureWindow = { startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z') };
    const src = source({ [`${LAST}:0`]: envelope([ev(1, 100), ev(2, 200)], true) }); // 1970 timestamps < window
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: narrow, callBudget: 10 });
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
    assert.equal(result.events.length, 0);
  });

  test('deduplicates by event id across pages, preserving order (no sort)', async () => {
    const src = source({
      [`${LAST}:0`]: envelope([ev(3, 300), ev(1, 100)], true), // deliberately not sorted
      [`${LAST}:1`]: envelope([ev(1, 100), ev(2, 200)], false), // id 1 repeats
    });
    const result = await pageTeamEvents(src, { teamId: 1963, direction: 'last', window: WINDOW, callBudget: 10 });
    assert.deepEqual(result.events.map((e) => e.providerEventId), ['3', '1', '2']);
    assert.equal(result.pages[1].duplicateCount, 1);
    assert.equal(result.pages[0].ascending, false); // ordering re-checked, never corrected
  });

  test('sweepTeam shares the seen-set so a fixture in both feeds arrives once', async () => {
    const src = source({
      [`${LAST}:0`]: envelope([ev(1, 100)], false),
      [`${NEXT}:0`]: envelope([ev(1, 100), ev(2, 200)], false), // id 1 shared with last
    });
    const result = await sweepTeam(src, { teamId: 1963, window: WINDOW, callBudget: 10 });
    const ids = [...result.last.events, ...result.next.events].map((e) => e.providerEventId);
    assert.deepEqual(ids, ['1', '2']);
  });

  test('a non-404 provider error propagates (hard stop)', async () => {
    const src = new FakeSource(new Map());
    src.getObserved = async () => {
      throw new ProviderRequestError('forbidden', LAST, 403, 1);
    };
    await assert.rejects(
      pageTeamEvents(src, { teamId: 1963, direction: 'last' as EventDirection, window: WINDOW, callBudget: 10 }),
      (error: unknown) => error instanceof ProviderRequestError && error.status === 403
    );
  });
});
