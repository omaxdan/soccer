// ─────────────────────────────────────────────────────────────────────────────
// TEAM-SEASON RECONCILIATION TESTS  (no provider, no database)
//
// Proves the reconciliation KEYS ON event.id, indexes tournament-team-events as
// [instanceId][teamId] (never the first bucket, which is Cruzeiro for 325/87678),
// and returns spine-missing events as raws for the canonical writer — never
// discarding them.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileTeamSeason } from '../stages/teamSpine';
import { interpretEvent, type FixtureWindow, type PagedEvent } from '../provider/pager';
import { ProviderRequestError, type ProviderClient, type ProviderObservation } from '../provider/client';
import type { EndpointKey } from '../provider/endpoints';

const WINDOW: FixtureWindow = {
  startsAt: new Date(0),
  endsAt: new Date('2100-01-01T00:00:00.000Z'),
};

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

function paged(id: number, ts: number): PagedEvent {
  return interpretEvent(ev(id, ts)) as PagedEvent;
}

function seasonEnvelope(events: unknown[]): unknown {
  return { success: true, data: { events, hasNextPage: false }, source: 'live' };
}

/** A client that answers the season pager (getObserved) and tte (get). */
class FakeClient {
  constructor(
    private readonly seasonPage0: unknown[],
    private readonly tte: Record<string, Record<string, unknown[]>>
  ) {}

  async getObserved<T>(key: EndpointKey, params: Record<string, string | number>): Promise<ProviderObservation<T>> {
    const page = Number(params.page);
    if (key === 'tournament_season_events_last' && page === 0) {
      return this.obs(key, params, seasonEnvelope(this.seasonPage0) as T);
    }
    // next feed and any later last page: past the end.
    throw new ProviderRequestError('not found', key, 404, 1);
  }

  async get<T>(_key: EndpointKey): Promise<T> {
    return { success: true, data: { tournamentTeamEvents: this.tte } } as T;
  }

  private obs<T>(key: EndpointKey, params: Record<string, string | number>, data: T): ProviderObservation<T> {
    return { endpointKey: key, path: '', url: '', parameters: params, status: 200, attempts: 1, quotaRemaining: null, data };
  }
}

function client(seasonPage0: unknown[], tte: Record<string, Record<string, unknown[]>>): ProviderClient {
  return new FakeClient(seasonPage0, tte) as unknown as ProviderClient;
}

describe('team-season reconciliation', () => {
  test('keys on event.id; classifies present/missing/spine-only; returns missing raws', async () => {
    // spine holds A(1) and B(2) for 325/87678.
    const spine: PagedEvent[] = [paged(1, 100), paged(2, 200)];
    // season feed involving 1963: A(1) and C(3).
    const seasonPage0 = [ev(1, 100), ev(3, 300)];
    // tte: first bucket is Cruzeiro (1954) with event E(5); target 1963 has B(2), D(4).
    const tte = { '83': { '1954': [ev(5, 500, { home: 1954 })], '1963': [ev(2, 200), ev(4, 400)] } };

    const { counts, missingRaws } = await reconcileTeamSeason(
      client(seasonPage0, tte),
      { teamId: '1963', uniqueTournamentId: '325', seasonId: '87678', window: WINDOW, callBudget: 5 },
      spine
    );

    // recon set = season(A,C) ∪ tte-for-1963(B,D) = {1,3,2,4}; the Cruzeiro event 5
    // must NOT appear — proving [instanceId][teamId] selection, not first bucket.
    assert.equal(counts.reconciliationSourceEvents, 4);
    assert.equal(counts.presentBoth, 2); // A, B are in the spine
    assert.equal(counts.missingFromSpine, 2); // C, D are not
    assert.equal(counts.spineOnly, 0);
    const missingIds = missingRaws.map((r) => String(r.id)).sort();
    assert.deepEqual(missingIds, ['3', '4']);
    assert.ok(!missingIds.includes('5')); // Cruzeiro never selected
  });

  test('spine-only events are counted and not discarded', async () => {
    const spine: PagedEvent[] = [paged(1, 100), paged(9, 900)]; // 9 is spine-only
    const { counts } = await reconcileTeamSeason(
      client([ev(1, 100)], { '83': { '1963': [] } }),
      { teamId: '1963', uniqueTournamentId: '325', seasonId: '87678', window: WINDOW, callBudget: 5 },
      spine
    );
    assert.equal(counts.presentBoth, 1);
    assert.equal(counts.spineOnly, 1); // event 9 preserved, flagged, never deleted
    assert.equal(counts.missingFromSpine, 0);
  });
});
