// ─────────────────────────────────────────────────────────────────────────────
// SEASON EVENT PAGER TESTS
//
// NO PROVIDER AND NO DATABASE. Every page these tests walk is a body committed
// under docs/api-samples/v2-discovery/ during S-4 discovery, replayed from disk.
// That is deliberate twice over: the pager must be verifiable without spending
// quota, and a test written against a hand-made payload proves only that the
// pager agrees with my idea of the provider.
//
// Where a branch has NEVER been observed live — `hasNextPage: false`, a page out
// of order, one fixture in both feeds — the payload is synthetic and says so.
// Those are the branches where a fabricated fixture is the only option, and
// pretending otherwise would be the dishonest part.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  pageSeasonEvents,
  sweepSeason,
  interpretEvent,
  readScore,
  ENDPOINT_BY_DIRECTION,
  FIXTURE_WINDOW,
  type EventPageSource,
  type FixtureWindow,
  type PagedEvent,
} from '../provider/pager';
import { ProviderRequestError, type ProviderClient, type ProviderObservation } from '../provider/client';
import type { EndpointKey } from '../provider/endpoints';

const EVIDENCE = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'api-samples', 'v2-discovery');
const TOURNAMENT = '325';
const SEASON = '87678';

interface Capture {
  readonly status: number;
  readonly success: boolean;
  readonly body: { data?: { events?: unknown[]; hasNextPage?: boolean } } | null;
}

function capture(endpointKey: EndpointKey, page: number): Capture {
  const file = `${endpointKey}__page-${page}__seasonId-${SEASON}__tournamentId-${TOURNAMENT}.json`;
  return JSON.parse(readFileSync(join(EVIDENCE, file), 'utf8')) as Capture;
}

/** The events of one captured page, as the provider sent them. */
function capturedEvents(endpointKey: EndpointKey, page: number): Record<string, unknown>[] {
  return (capture(endpointKey, page).body?.data?.events ?? []) as Record<string, unknown>[];
}

function envelope(events: unknown[], hasNextPage: boolean): unknown {
  return { success: true, data: { events, hasNextPage }, source: 'live', cacheHit: false };
}

/**
 * A provider that answers only from what was captured.
 *
 * An unknown page throws the SAME 404 the real client raises, which is not an
 * invention: page 999 was requested live and the provider returned 404 with no
 * body. Past-the-end is 404, so a source with no page there is a faithful stand-in.
 */
class CapturedProvider implements EventPageSource {
  readonly requested: string[] = [];

  constructor(private readonly bodies: Map<string, unknown>) {}

  static fromEvidence(pages: ReadonlyArray<[EventDirectionKey, number]>): CapturedProvider {
    const bodies = new Map<string, unknown>();
    for (const [direction, page] of pages) {
      const key = ENDPOINT_BY_DIRECTION[direction];
      bodies.set(`${key}:${page}`, capture(key, page).body);
    }
    return new CapturedProvider(bodies);
  }

  with(direction: EventDirectionKey, page: number, body: unknown): this {
    this.bodies.set(`${ENDPOINT_BY_DIRECTION[direction]}:${page}`, body);
    return this;
  }

  async getObserved<T>(
    key: EndpointKey,
    params: Record<string, string | number>
  ): Promise<ProviderObservation<T>> {
    const page = Number(params.page);
    this.requested.push(`${key}:${page}`);
    const body = this.bodies.get(`${key}:${page}`);
    if (body === undefined) {
      throw new ProviderRequestError(`${key} page ${page} failed with status 404`, key, 404, 1);
    }
    return {
      endpointKey: key,
      path: `/tournament/${TOURNAMENT}/season/${SEASON}/events/${page}`,
      url: `https://example.invalid/tournament/${TOURNAMENT}/season/${SEASON}/events/${page}`,
      parameters: params,
      status: 200,
      attempts: 1,
      quotaRemaining: null,
      data: body as T,
    };
  }
}

type EventDirectionKey = 'last' | 'next';

const walk = (source: EventPageSource, over: Partial<Parameters<typeof pageSeasonEvents>[1]> = {}) =>
  pageSeasonEvents(source, {
    direction: 'last',
    competitionProviderId: TOURNAMENT,
    seasonProviderId: SEASON,
    callBudget: 10,
    ...over,
  });

// ─────────────────────────────────────────────────────────────────────────────

describe('the pager reads through the existing client, not a second one', () => {
  test('ProviderClient satisfies the page source with no adapter', () => {
    // A COMPILE-TIME assertion. If ProviderClient ever stops satisfying
    // EventPageSource, this stops type-checking — which is the point: the pager
    // must keep consuming the one client that does quota accounting, throttling
    // and key rotation, rather than acquiring an HTTP path of its own.
    const accepts = (_source: EventPageSource): void => undefined;
    const client = null as unknown as ProviderClient;
    accepts(client);
    assert.ok(true);
  });

  test('the pager module imports no HTTP library', () => {
    const source = readFileSync(resolve(__dirname, '..', 'provider', 'pager.ts'), 'utf8');
    for (const forbidden of ['axios', 'node-fetch', "from 'http'", "from 'https'", 'fetch(']) {
      assert.ok(!source.includes(forbidden), `${forbidden} must not appear in the pager`);
    }
  });
});

describe('the evidence this suite rests on is what it claims to be', () => {
  test('page 999 really was a 404 with no body', () => {
    // If this ever fails, the 404-termination test below is testing a fiction.
    const past = capture('tournament_season_events_last', 999);
    assert.equal(past.status, 404);
    assert.equal(past.success, false);
    assert.equal(past.body, null);
  });

  test('the four 200 pages are present and carry events', () => {
    for (const [direction, page] of [['last', 0], ['last', 1], ['last', 2], ['next', 0]] as const) {
      const events = capturedEvents(ENDPOINT_BY_DIRECTION[direction], page);
      assert.ok(events.length > 0, `${direction}/${page} must carry events`);
    }
  });
});

describe('last pagination', () => {
  test('walks backward across the captured pages and stops at the date floor', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));

    // 30 in-window on page 0, 17 on page 1, 0 on page 2 — 47, which is the figure
    // doc 38 §6 computed independently from the same bodies.
    assert.equal(result.events.length, 47);
    assert.equal(result.callsSpent, 3);
    assert.equal(result.pages.length, 3);
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
    assert.equal(result.resumeFromPage, null, 'a finished walk has no resume point');
    assert.deepEqual(result.orderingAnomalies, []);
    assert.deepEqual(result.rejections, []);
  });

  test('every page is fetched in order, and none twice', async () => {
    const source = CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]);
    await walk(source);
    assert.deepEqual(source.requested, [
      'tournament_season_events_last:0',
      'tournament_season_events_last:1',
      'tournament_season_events_last:2',
    ]);
  });

  test('events are returned in the order the provider sent them, never re-sorted', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1]]));
    const fromFeed = [...capturedEvents('tournament_season_events_last', 0), ...capturedEvents('tournament_season_events_last', 1)]
      .filter((event) => {
        const at = event.startTimestamp as number;
        return at >= FIXTURE_WINDOW.startsAt.getTime() / 1000 && at <= FIXTURE_WINDOW.endsAt.getTime() / 1000;
      })
      .map((event) => String(event.id));
    assert.deepEqual(result.events.map((event) => event.providerEventId), fromFeed);
  });
});

describe('next pagination', () => {
  test('the same pager walks forward — direction is a parameter, not a second implementation', async () => {
    // The specified window ends 11 August; next/0 begins 15 August. The forward
    // half of THIS season is entirely outside THIS window, so the correct
    // behaviour is one call and nothing carried. That is the contract working,
    // not a defect — see the report.
    const result = await walk(CapturedProvider.fromEvidence([['next', 0]]), { direction: 'next' });
    assert.equal(result.callsSpent, 1);
    assert.equal(result.events.length, 0);
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
    assert.equal(result.pages[0].eventCount, 30, 'the page was read, it was simply out of window');
  });

  test('with a window that reaches them, the forward fixtures are carried', async () => {
    const window: FixtureWindow = {
      startsAt: FIXTURE_WINDOW.startsAt,
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
    };
    const result = await walk(CapturedProvider.fromEvidence([['next', 0]]), { direction: 'next', window });
    assert.equal(result.events.length, 30);
    // Page 1 was never captured, so the stand-in 404s — the same signal the live
    // provider gave for page 999.
    assert.equal(result.stoppedBecause, 'NOT_FOUND');
    assert.equal(result.callsSpent, 2);
  });

  test('forward pages are bounded by the far end of the window, backward by the near end', async () => {
    // Walking `last` with a window that closes before every observed page must
    // NOT stop on the first page: `last` is bounded by windowStart, not windowEnd.
    const window: FixtureWindow = {
      startsAt: new Date('2026-07-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-11T23:59:59.999Z'),
    };
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]), { window });
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
    assert.ok(result.events.length > 0);
    assert.ok(result.pages.length >= 2, 'page 1 straddles the floor and must be read');
  });
});

describe('hasNextPage', () => {
  test('false stops the walk even though a further page exists', async () => {
    // SYNTHETIC. `hasNextPage: false` has never been observed live — it was true
    // on all four captured pages — so this branch cannot be driven from evidence.
    const source = CapturedProvider.fromEvidence([['last', 0], ['last', 1]]).with(
      'last',
      0,
      envelope(capturedEvents('tournament_season_events_last', 0), false)
    );
    const result = await walk(source);
    assert.equal(result.stoppedBecause, 'HAS_NEXT_PAGE_FALSE');
    assert.equal(result.callsSpent, 1);
    assert.deepEqual(source.requested, ['tournament_season_events_last:0'], 'page 1 must not be fetched');
  });

  test('true keeps the walk going, and is the state every captured page was in', async () => {
    for (const [direction, page] of [['last', 0], ['last', 1], ['last', 2], ['next', 0]] as const) {
      const body = capture(ENDPOINT_BY_DIRECTION[direction], page).body;
      assert.equal(body?.data?.hasNextPage, true, `${direction}/${page}`);
    }
  });

  test('a missing flag is treated as false rather than as permission to continue', async () => {
    const source = new CapturedProvider(new Map()).with('last', 0, {
      data: { events: capturedEvents('tournament_season_events_last', 0) },
    });
    const result = await walk(source);
    assert.equal(result.stoppedBecause, 'HAS_NEXT_PAGE_FALSE');
  });
});

describe('404 termination', () => {
  test('past-the-end ends the walk without an error and without a retry', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]), {
      // A window wide enough that the date floor never fires, so 404 is the only
      // thing that can stop it.
      window: { startsAt: new Date('2000-01-01T00:00:00Z'), endsAt: new Date('2030-01-01T00:00:00Z') },
    });
    assert.equal(result.stoppedBecause, 'NOT_FOUND');
    assert.equal(result.callsSpent, 4, 'three pages plus the one that 404ed');
    assert.equal(result.events.length, 90);
    assert.equal(result.resumeFromPage, null, 'past the end is finished, not paused');
  });

  test('a non-404 provider failure is raised, not swallowed as a terminal page', async () => {
    const source: EventPageSource = {
      async getObserved() {
        throw new ProviderRequestError('upstream exploded', 'tournament_season_events_last', 500, 4);
      },
    };
    await assert.rejects(() => walk(source), /upstream exploded/);
  });

  test('no maximum page number appears anywhere — 404 is what bounds the walk', () => {
    const source = readFileSync(resolve(__dirname, '..', 'provider', 'pager.ts'), 'utf8');
    const executable = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    });
    // The page size is 30 on every page observed and the contract still forbids
    // depending on it. If 30 ever appears in executable code, this is where the
    // assumption should have been caught.
    for (const forbidden of [/\b30\b/, /maxPages/i, /pageCount/i, /pageSize/i]) {
      const offender = executable.find((line) => forbidden.test(line));
      assert.equal(offender, undefined, `${forbidden} must not appear: ${offender}`);
    }
  });
});

describe('date-floor termination', () => {
  test('a page entirely before the window stops the walk', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));
    const final = result.pages[result.pages.length - 1];
    assert.equal(final.page, 2);
    assert.equal(final.inWindowCount, 0);
    assert.ok(
      final.latestTimestamp !== null && final.latestTimestamp < FIXTURE_WINDOW.startsAt.getTime() / 1000,
      'the whole page predates the floor'
    );
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
  });

  test('a page STRADDLING the floor is kept, not discarded', async () => {
    // Page 1 runs 2026-05-23 → 2026-07-23 across a 2026-05-31 floor. Seventeen of
    // its thirty events are inside. Stopping on it, or dropping it whole, would
    // lose two and a half weeks of fixtures.
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));
    const straddling = result.pages[1];
    assert.equal(straddling.eventCount, 30);
    assert.equal(straddling.inWindowCount, 17);
    assert.equal(result.events.length, 47);
  });

  test('the window is applied to startTimestamp, never to the round number', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));
    // Page 1 carries round 4 fixtures replayed in July — inside the window by
    // date and nowhere near it by round. A round-based filter would drop them.
    const rounds = new Set(result.events.map((event) => event.roundNumber));
    assert.ok(rounds.has(4), 'a rescheduled round-4 fixture is inside the window by date');
    assert.ok(rounds.has(22));
    for (const event of result.events) {
      assert.ok(event.startTimestamp >= FIXTURE_WINDOW.startsAt.getTime() / 1000);
      assert.ok(event.startTimestamp <= FIXTURE_WINDOW.endsAt.getTime() / 1000);
    }
  });
});

describe('empty score objects never become a nil-nil', () => {
  test('every unplayed fixture in the forward feed carries no score at all', async () => {
    const events = capturedEvents('tournament_season_events_next', 0).map(interpretEvent) as PagedEvent[];
    assert.equal(events.length, 30);
    for (const event of events) {
      assert.equal(event.score, null, `event ${event.providerEventId} must have no score`);
      assert.equal(event.winnerCode, null);
    }
  });

  test('an empty score object is not a zero', () => {
    // The specific corruption this guards: `{}` read as 0–0 is a plausible
    // result that nothing downstream would ever flag.
    assert.equal(readScore({ homeScore: {}, awayScore: {}, time: {} }), null);
    assert.equal(readScore({ homeScore: {}, awayScore: {}, winnerCode: 1 }), null);
    assert.equal(readScore({ winnerCode: 3 }), null);
  });

  test('a real full-time score IS read, including the half-time figures', async () => {
    const events = capturedEvents('tournament_season_events_last', 0).map(interpretEvent) as PagedEvent[];
    const decided = events.filter((event) => event.score !== null);
    assert.equal(decided.length, 26, '26 ended events on the page, 4 postponed');
    for (const event of decided) {
      assert.ok(event.winnerCode !== null, 'a score is only read where a winner was declared');
      assert.ok(Number.isInteger(event.score?.homeGoals));
      assert.ok(Number.isInteger(event.score?.awayGoals));
    }
    // A genuine 0–0 must still survive — the guard is on winnerCode, not on the
    // goals being non-zero.
    assert.deepEqual(
      readScore({ winnerCode: 3, homeScore: { current: 0, normaltime: 0, period1: 0 }, awayScore: { current: 0, normaltime: 0, period1: 0 } }),
      { homeGoals: 0, awayGoals: 0, homeGoalsHalfTime: 0, awayGoalsHalfTime: 0 }
    );
  });
});

describe('status 0 and status 60 are both scoreless, and are not the same thing', () => {
  test('0 is scheduled, 60 is postponed, and only status tells them apart', async () => {
    const forward = capturedEvents('tournament_season_events_next', 0).map(interpretEvent) as PagedEvent[];
    const backward = capturedEvents('tournament_season_events_last', 0).map(interpretEvent) as PagedEvent[];

    const scheduled = forward.filter((event) => event.providerStatusCode === 0);
    const postponed = backward.filter((event) => event.providerStatusCode === 60);
    const completed = backward.filter((event) => event.providerStatusCode === 100);

    assert.equal(scheduled.length, 30);
    assert.equal(postponed.length, 4);
    assert.equal(completed.length, 26);

    for (const event of scheduled) assert.equal(event.lifecycleState, 'SCHEDULED');
    for (const event of postponed) assert.equal(event.lifecycleState, 'POSTPONED');
    for (const event of completed) assert.equal(event.lifecycleState, 'COMPLETED');

    // The payloads are IDENTICAL in every score-bearing respect. Anything that
    // classified by score rather than by status would merge the two.
    for (const event of [...scheduled, ...postponed]) {
      assert.equal(event.score, null);
      assert.equal(event.winnerCode, null);
    }
  });

  test('an unmapped status seals rather than guessing', () => {
    const event = interpretEvent({
      id: 1,
      startTimestamp: 1786822200,
      tournament: { id: 83, uniqueTournament: { id: 325 } },
      homeTeam: { id: 1 },
      awayTeam: { id: 2 },
      status: { code: 999, description: 'Who knows' },
    }) as PagedEvent;
    assert.equal(event.lifecycleState, 'UNKNOWN');
  });
});

describe('cross-page ordering is re-checked, never assumed and never corrected', () => {
  test('the captured pages hold the contract: ascending within, descending across', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));
    assert.deepEqual(result.orderingAnomalies, []);
    for (const page of result.pages) assert.equal(page.ascending, true);
    for (let i = 1; i < result.pages.length; i += 1) {
      const previous = result.pages[i - 1];
      const current = result.pages[i];
      assert.ok(
        current.latestTimestamp! < previous.earliestTimestamp!,
        `page ${current.page} must be entirely earlier than page ${previous.page}`
      );
    }
  });

  test('ties do not count as a violation', async () => {
    // Ten events on the captured forward page share one timestamp. A strict
    // ascending check would fail on correct live data.
    const window: FixtureWindow = { startsAt: FIXTURE_WINDOW.startsAt, endsAt: new Date('2026-09-01T00:00:00Z') };
    const result = await walk(CapturedProvider.fromEvidence([['next', 0]]), { direction: 'next', window });
    const timestamps = result.events.map((event) => event.startTimestamp);
    assert.ok(new Set(timestamps).size < timestamps.length, 'the captured page really does contain ties');
    assert.equal(result.pages[0].ascending, true);
    assert.deepEqual(result.orderingAnomalies, []);
  });

  test('a page out of order is REPORTED and its events are still carried unchanged', async () => {
    // SYNTHETIC — no captured page is out of order. Reversing one proves the
    // check fires and that the pager does not quietly re-sort the feed.
    const reversed = [...capturedEvents('tournament_season_events_last', 0)].reverse();
    const source = new CapturedProvider(new Map()).with('last', 0, envelope(reversed, false));
    const result = await walk(source);
    assert.equal(result.pages[0].ascending, false);
    assert.match(result.orderingAnomalies[0], /page 0 is not non-strictly ascending/);
    assert.deepEqual(
      result.events.map((event) => event.providerEventId),
      reversed.map((event) => String(event.id)),
      'the provider order is preserved, anomaly or not'
    );
  });

  test('a page that breaks the cross-page rule is reported too', async () => {
    // SYNTHETIC: page 1 served as a copy of page 0, so it is not earlier.
    const page0 = capturedEvents('tournament_season_events_last', 0);
    const source = new CapturedProvider(new Map())
      .with('last', 0, envelope(page0, true))
      .with('last', 1, envelope(page0, false));
    const result = await walk(source);
    assert.ok(
      result.orderingAnomalies.some((anomaly) => /page 1 is not entirely earlier than page 0/.test(anomaly)),
      result.orderingAnomalies.join('; ')
    );
  });
});

describe('duplicate event protection within a sweep', () => {
  test('no captured page repeats an event, and the pager confirms it rather than assuming it', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]));
    for (const page of result.pages) assert.equal(page.duplicateCount, 0);
    assert.equal(new Set(result.events.map((event) => event.providerEventId)).size, result.events.length);
  });

  test('one fixture served on two pages is carried once', async () => {
    // SYNTHETIC — the provider has never repeated one. "Not observed" is not
    // "cannot happen", and a fixture carried twice would be upserted twice.
    const page0 = capturedEvents('tournament_season_events_last', 0);
    const source = new CapturedProvider(new Map())
      .with('last', 0, envelope(page0, true))
      .with('last', 1, envelope([page0[0], ...capturedEvents('tournament_season_events_last', 1)], false));
    const result = await walk(source);
    assert.equal(result.pages[1].duplicateCount, 1);
    assert.equal(new Set(result.events.map((event) => event.providerEventId)).size, result.events.length);
  });

  test('a sweep of both directions carries a fixture appearing in both feeds once', async () => {
    // SYNTHETIC — `last` and `next` were disjoint in the captured season. The
    // shared `seen` set is the only thing that can prevent this, and it is the
    // reason sweepSeason exists rather than two independent walks.
    const shared = capturedEvents('tournament_season_events_last', 0)[0];
    const source = new CapturedProvider(new Map())
      .with('last', 0, envelope(capturedEvents('tournament_season_events_last', 0), false))
      .with('next', 0, envelope([shared, ...capturedEvents('tournament_season_events_next', 0)], false));

    const result = await sweepSeason(source, {
      competitionProviderId: TOURNAMENT,
      seasonProviderId: SEASON,
      callBudget: 10,
      window: { startsAt: FIXTURE_WINDOW.startsAt, endsAt: new Date('2026-09-01T00:00:00Z') },
    });

    assert.equal(result.next.pages[0].duplicateCount, 1);
    const ids = [...result.last.events, ...result.next.events].map((event) => event.providerEventId);
    assert.equal(new Set(ids).size, ids.length, 'no id survives twice across the sweep');
  });

  test('a sweep spends one budget across both halves, historical first', async () => {
    const source = CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2], ['next', 0]]);
    const result = await sweepSeason(source, {
      competitionProviderId: TOURNAMENT,
      seasonProviderId: SEASON,
      callBudget: 4,
    });
    assert.equal(result.last.callsSpent + result.next.callsSpent, 4);
    assert.equal(source.requested[0], 'tournament_season_events_last:0', 'the bounded half runs first');
  });
});

describe('home and away are never inferred from the slug', () => {
  test('the reversed slugs in the captured feeds do not reach the participants', () => {
    const forward = capturedEvents('tournament_season_events_next', 0);
    const reversed = forward.filter((event) => {
      const home = (event.homeTeam as { slug: string }).slug;
      const away = (event.awayTeam as { slug: string }).slug;
      return event.slug !== `${home}-${away}`;
    });
    assert.equal(reversed.length, 16, 'the captured forward page really is 16/30 reversed');

    for (const raw of reversed) {
      const event = interpretEvent(raw) as PagedEvent;
      assert.equal(event.homeTeamProviderId, String((raw.homeTeam as { id: number }).id));
      assert.equal(event.awayTeamProviderId, String((raw.awayTeam as { id: number }).id));
      // The slug's leading segment is the AWAY team on these events. If the
      // pager ever parsed the slug, this is the assertion that would fail.
      assert.ok(
        (raw.slug as string).startsWith((raw.awayTeam as { slug: string }).slug),
        `${raw.slug} leads with the away team`
      );
    }
  });

  test('participants survive a slug that contradicts them outright', () => {
    const event = interpretEvent({
      id: 99,
      slug: 'away-team-home-team',
      startTimestamp: 1786822200,
      tournament: { id: 83, uniqueTournament: { id: 325 } },
      homeTeam: { id: 11, name: 'Home Team', slug: 'home-team' },
      awayTeam: { id: 22, name: 'Away Team', slug: 'away-team' },
    }) as PagedEvent;
    assert.equal(event.homeTeamProviderId, '11');
    assert.equal(event.awayTeamProviderId, '22');
    assert.equal(event.homeTeamName, 'Home Team');
  });

  test('the pager never reads a slug at all', () => {
    const source = readFileSync(resolve(__dirname, '..', 'provider', 'pager.ts'), 'utf8');
    const executable = source.split(/\r?\n/).filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    });
    assert.equal(
      executable.find((line) => /\bslug\b/.test(line)),
      undefined
    );
  });
});

describe('the three competition identifiers stay three', () => {
  test('uniqueTournament.id, tournament.id and season.id are carried separately', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0]]));
    for (const event of result.events) {
      assert.equal(event.competitionProviderId, '325');
      assert.equal(event.tournamentInstanceProviderId, '83');
      assert.equal(event.seasonProviderId, '87678');
    }
    const first = result.events[0];
    assert.equal(new Set([first.competitionProviderId, first.tournamentInstanceProviderId, first.seasonProviderId]).size, 3);
  });

  test('an event without uniqueTournament is refused, never demoted to tournament.id', () => {
    // The dangerous fallback: 83 filed as a competition would attach a season's
    // fixtures to a competition that does not exist, and nothing would complain.
    const outcome = interpretEvent({
      id: 7,
      startTimestamp: 1786822200,
      tournament: { id: 83 },
      homeTeam: { id: 1 },
      awayTeam: { id: 2 },
    });
    assert.ok(outcome && 'reason' in outcome);
    assert.match(outcome.reason, /uniqueTournament/);
  });
});

describe('the budget is the binding constraint', () => {
  test('a walk stopped by its budget reports where to resume', async () => {
    const result = await walk(CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]), {
      callBudget: 2,
    });
    assert.equal(result.callsSpent, 2);
    assert.equal(result.stoppedBecause, 'BUDGET_EXHAUSTED');
    assert.equal(result.resumeFromPage, 2);
    assert.equal(result.events.length, 47, 'both fetched pages were still fully read');
  });

  test('a zero budget spends nothing and resumes where it started', async () => {
    const source = CapturedProvider.fromEvidence([['last', 0]]);
    const result = await walk(source, { callBudget: 0 });
    assert.equal(result.callsSpent, 0);
    assert.deepEqual(source.requested, []);
    assert.equal(result.resumeFromPage, 0);
  });

  test('a resumed walk starts where the previous one stopped', async () => {
    const source = CapturedProvider.fromEvidence([['last', 0], ['last', 1], ['last', 2]]);
    const result = await walk(source, { callBudget: 2, startPage: 1 });
    assert.deepEqual(source.requested, ['tournament_season_events_last:1', 'tournament_season_events_last:2']);
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
  });
});

describe('malformed events are counted, not crashed on and not silently dropped', () => {
  test('a page of rubbish yields rejections rather than an exception', async () => {
    const source = new CapturedProvider(new Map()).with(
      'last',
      0,
      envelope([null, 'not an event', { id: 1 }, { id: 2, startTimestamp: 1786822200 }], false)
    );
    const result = await walk(source);
    assert.equal(result.events.length, 0);
    assert.equal(result.rejections.length, 4);
    assert.equal(result.pages[0].rejectedCount, 4);
  });

  test('a page with no events at all stops the walk instead of spending the budget on it', async () => {
    // DEFENSIVE, not contractual. Distinct from a SHORT page, which the contract
    // forbids treating as the end and which this pager does not.
    const source = new CapturedProvider(new Map()).with('last', 0, envelope([], true));
    const result = await walk(source, { callBudget: 10 });
    assert.equal(result.stoppedBecause, 'EMPTY_PAGE');
    assert.equal(result.callsSpent, 1);
  });

  test('a SHORT page does not stop the walk', async () => {
    const short = capturedEvents('tournament_season_events_last', 0).slice(0, 3);
    const source = new CapturedProvider(new Map())
      .with('last', 0, envelope(short, true))
      .with('last', 1, envelope(capturedEvents('tournament_season_events_last', 1), false));
    const result = await walk(source);
    assert.equal(result.callsSpent, 2, 'three events is not evidence of the end');
    assert.equal(result.stoppedBecause, 'HAS_NEXT_PAGE_FALSE');
  });
});
