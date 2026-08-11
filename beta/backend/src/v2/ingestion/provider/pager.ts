// ─────────────────────────────────────────────────────────────────────────────
// SEASON EVENT PAGER
//
// Implements doc 38 §9 — and nothing beyond it. Every rule below traces to a
// line of that contract, which traces to a committed response body under
// docs/api-samples/v2-discovery/.
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE PAGER, BOTH DIRECTIONS
//
// `events/last` and `events/next` were shown to share an envelope, a page size,
// an ordering rule, an event shape and a `hasNextPage` flag (doc 38 §4). Two
// implementations would therefore be two places for the same bug, and the second
// one would be the one nobody re-checked when the provider changed. Direction is
// a PARAMETER: it selects an endpoint key and which side of the window bounds
// the walk. Nothing else about the loop differs.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE REFUSES TO KNOW
//
// The evidence proved four page sizes of exactly 30 and the contract still
// forbids depending on it, because every page observed was a page the provider
// had enough events to fill — a fixed size and a maximum-that-was-reached are
// indistinguishable from the outside. So:
//
//   30 DOES NOT APPEAR IN THIS FILE.
//   No page count is computed from a page size or from any total.
//   A SHORT PAGE IS NOT THE END. Only 404, `hasNextPage === false`, or a page
//   lying wholly outside the window stops the walk.
//
// `roundInfo.round` is read and carried, and is NEVER used to page or to select
// by date: page 1 of the observed season carries rounds 19, 18, 17 AND 4, so
// round is not chronological and any window filter built on it would silently
// drop rescheduled fixtures.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS PAGER DOES NOT WRITE
//
// It reads, classifies and hands back. No database handle reaches it, by
// construction, so it cannot begin ingestion by accident and can be tested
// against captured evidence with no provider and no schema. The write path
// consumes `PagedEvent` when ingestion is authorised; that wiring is deliberately
// absent.
// ─────────────────────────────────────────────────────────────────────────────

import { ENDPOINTS, type EndpointKey } from './endpoints';
import { ProviderRequestError, type ProviderObservation } from './client';
import { mapLifecycleState } from '../mapping/index';
import { asRecord, externalId, fromUnixSeconds, nonNegativeInt, text } from '../normalise';
import { logger } from '../../../utils/logger';

/** Which half of the season feed to walk. */
export type EventDirection = 'last' | 'next';

/**
 * The endpoint each direction reads.
 *
 * The only place direction becomes a path. Adding a third direction would mean
 * adding a row here, not a second pager.
 */
export const ENDPOINT_BY_DIRECTION: Readonly<Record<EventDirection, EndpointKey>> = {
  last: 'tournament_season_events_last',
  next: 'tournament_season_events_next',
};

/** The first page number. Observed, both feeds: paging is zero-based. */
export const FIRST_PAGE = 0;

/**
 * The fixture-universe window, as specified for S-5.
 *
 * `endsAt` is EXCLUSIVE of nothing and inclusive of the whole of 11 August: a
 * fixture kicking off at 22:30Z on the final day is inside the window, and a
 * boundary drawn at midnight would drop the evening round.
 *
 * NOTE, and it is a real one: `events/next/0` for the observed season begins
 * 2026-08-15, which is entirely AFTER this window. Walking `next` with this
 * window therefore terminates on the first page having yielded nothing — which
 * is the contract behaving correctly, not a defect. Widening the window is a
 * decision about what the platform is for, not a bug fix, so it is not made here.
 */
export const FIXTURE_WINDOW: FixtureWindow = {
  startsAt: new Date('2026-05-31T00:00:00.000Z'),
  endsAt: new Date('2026-08-11T23:59:59.999Z'),
};

export interface FixtureWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** A full-time score, present only when the provider says the match was decided. */
export interface PagedEventScore {
  readonly homeGoals: number;
  readonly awayGoals: number;
  readonly homeGoalsHalfTime: number | null;
  readonly awayGoalsHalfTime: number | null;
}

/**
 * One event, read from the feed and classified. Not yet written anywhere.
 *
 * The three competition identifiers are carried SEPARATELY and named for what
 * they are, because the provider ships all three on every event and they are
 * three different numbers — 325, 83 and 87678 for the observed season. Collapsing
 * any two would attach a season's fixtures to the wrong competition, and the
 * damage would not be visible until someone asked a question across seasons.
 */
export interface PagedEvent {
  readonly providerEventId: string;
  /** `tournament.uniqueTournament.id` — THE COMPETITION. Stable across seasons. */
  readonly competitionProviderId: string;
  /** `tournament.id` — the season's instance of the competition. NOT the competition. */
  readonly tournamentInstanceProviderId: string | null;
  /** `season.id` — the edition. NOT the competition and NOT the instance. */
  readonly seasonProviderId: string | null;
  /** Unix seconds, exactly as sent. The authoritative kickoff. */
  readonly startTimestamp: number;
  readonly kickoffAt: Date;
  readonly homeTeamProviderId: string;
  readonly awayTeamProviderId: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly providerStatusCode: number | null;
  /** Platform vocabulary, via the existing mapping. */
  readonly lifecycleState: string;
  /** `winnerCode`, or null when absent — which is how an unplayed fixture arrives. */
  readonly winnerCode: number | null;
  /** Null unless the provider reported a decided match. NEVER a substituted 0–0. */
  readonly score: PagedEventScore | null;
  /** Carried for stage resolution. Never used to page or to filter by date. */
  readonly roundNumber: number | null;
  /** The untouched payload, for the writer that eventually consumes this. */
  readonly raw: Record<string, unknown>;
}

/**
 * Why the walk stopped.
 *
 * Ordered as doc 38 §9 orders them. `EMPTY_PAGE` is the one addition and is
 * marked as what it is below.
 */
export type StopReason =
  | 'NOT_FOUND'
  | 'HAS_NEXT_PAGE_FALSE'
  | 'BEYOND_WINDOW'
  | 'BUDGET_EXHAUSTED'
  | 'EMPTY_PAGE';

/** What one page contained, for telemetry and for the ordering re-check. */
export interface PageSummary {
  readonly page: number;
  readonly eventCount: number;
  readonly inWindowCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
  readonly hasNextPage: boolean;
  readonly earliestTimestamp: number | null;
  readonly latestTimestamp: number | null;
  /** Whether the page arrived non-strictly ascending, as the contract expects. */
  readonly ascending: boolean;
}

export interface SweepResult {
  readonly direction: EventDirection;
  /** Window-filtered, de-duplicated, IN PROVIDER ORDER. Never re-sorted. */
  readonly events: readonly PagedEvent[];
  readonly pages: readonly PageSummary[];
  readonly callsSpent: number;
  /**
   * What the provider last said it had left, or null when it said nothing.
   *
   * Carried so the orchestrator can record it without a second request. Null is
   * reported as null and never as a computed estimate — `api_usage.quota_remaining`
   * means "what the provider said", and a figure derived here would be a
   * fabricated observation the next run would act on.
   */
  readonly quotaRemaining: number | null;
  readonly stoppedBecause: StopReason;
  /** The page to resume from, set only when the budget ran out mid-walk. */
  readonly resumeFromPage: number | null;
  /** Ordering expectations that did not hold. Reported, never corrected. */
  readonly orderingAnomalies: readonly string[];
  /** Events that could not be interpreted, with the reason. */
  readonly rejections: readonly string[];
}

export interface SweepOptions {
  readonly direction: EventDirection;
  /** `uniqueTournament.id`. */
  readonly competitionProviderId: string | number;
  /** `season.id`. */
  readonly seasonProviderId: string | number;
  readonly window?: FixtureWindow;
  /** Maximum provider calls this walk may spend. Required — quota is the constraint. */
  readonly callBudget: number;
  readonly startPage?: number;
  /**
   * Event ids already seen. Supplied when both directions share one sweep, so a
   * fixture appearing in both feeds is carried once.
   */
  readonly seen?: Set<string>;
}

/**
 * The narrowest view of ProviderClient this pager needs.
 *
 * Structural, so the real client satisfies it with no adapter and no second HTTP
 * implementation, and a test satisfies it with captured evidence and no network.
 * `getObserved` rather than `get` because the walk needs the status and the
 * attempt count, not only the body.
 */
export interface EventPageSource {
  getObserved<T>(
    key: EndpointKey,
    params: Record<string, string | number>
  ): Promise<ProviderObservation<T>>;
}

/** The envelope, verified identical in both directions (doc 38 §1). */
interface EventsEnvelope {
  readonly data?: {
    readonly events?: unknown;
    readonly hasNextPage?: unknown;
  };
}

/**
 * Walks one direction of a season's event feed.
 *
 * TERMINATION, in the contract's order, whichever fires first:
 *
 *   1. 404                       proven terminal (page 999 → 404, no body). The
 *                                client breaks on 404 without retrying, so a
 *                                terminal page costs exactly one call.
 *   2. `hasNextPage === false`   honoured if it ever appears. It never has been
 *                                observed to — true on all four 200 pages — so it
 *                                is a cheap correct stop, not the primary one.
 *   3. page wholly outside       walking `last` backwards past `window.startsAt`,
 *      the window               or `next` forwards past `window.endsAt`, cannot
 *                                reach an event the window wants.
 *   4. budget exhausted          stop and report where to resume.
 *
 * and one defensive stop that is NOT in the contract and is labelled so:
 *
 *   5. a page with ZERO events. Not "a short page means the last page" — that
 *      inference is forbidden and is not made. A page carrying nothing at all,
 *      while claiming a next page, is a shape the evidence has never shown; the
 *      alternative to stopping is spending the whole budget on it.
 */
export async function pageSeasonEvents(
  source: EventPageSource,
  options: SweepOptions
): Promise<SweepResult> {
  const window = options.window ?? FIXTURE_WINDOW;
  const endpointKey = ENDPOINT_BY_DIRECTION[options.direction];
  const windowStartSeconds = Math.floor(window.startsAt.getTime() / 1000);
  const windowEndSeconds = Math.floor(window.endsAt.getTime() / 1000);

  const seen = options.seen ?? new Set<string>();
  const events: PagedEvent[] = [];
  const pages: PageSummary[] = [];
  const orderingAnomalies: string[] = [];
  const rejections: string[] = [];

  let page = options.startPage ?? FIRST_PAGE;
  let callsSpent = 0;
  let quotaRemaining: number | null = null;
  let stoppedBecause: StopReason = 'BUDGET_EXHAUSTED';
  let resumeFromPage: number | null = null;
  let previousPage: PageSummary | null = null;

  while (callsSpent < options.callBudget) {
    let envelope: EventsEnvelope;
    try {
      const observation = await source.getObserved<EventsEnvelope>(endpointKey, {
        tournamentId: options.competitionProviderId,
        seasonId: options.seasonProviderId,
        page,
      });
      callsSpent += 1;
      if (observation.quotaRemaining !== null) quotaRemaining = observation.quotaRemaining;
      envelope = observation.data;
    } catch (error) {
      callsSpent += 1;
      if (error instanceof ProviderRequestError && error.isNotFound) {
        // Past the end. The proven terminal signal, and the reason the walk
        // needs no maximum page number.
        stoppedBecause = 'NOT_FOUND';
        break;
      }
      throw error;
    }

    const raw = Array.isArray(envelope.data?.events) ? envelope.data.events : [];
    const hasNextPage = envelope.data?.hasNextPage === true;

    if (raw.length === 0) {
      pages.push(emptySummary(page, hasNextPage));
      stoppedBecause = 'EMPTY_PAGE';
      break;
    }

    const read = raw.map((candidate) => interpretEvent(candidate));
    const parsed = read.filter((entry): entry is PagedEvent => entry !== null && !isRejection(entry));
    for (const entry of read) {
      if (entry === null) rejections.push('event payload was not an object');
      else if (isRejection(entry)) rejections.push(entry.reason);
    }

    const timestamps = parsed.map((event) => event.startTimestamp);
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const latest = timestamps.length > 0 ? Math.max(...timestamps) : null;

    // ORDER IS RE-CHECKED, NOT TRUSTED — and never corrected. Ascending is
    // NON-STRICT: ten events on the observed `next/0` share one timestamp, so a
    // strict comparison would report a violation on correct live data.
    const ascending = timestamps.every((value, index) => index === 0 || timestamps[index - 1] <= value);
    if (!ascending) {
      orderingAnomalies.push(`page ${page} is not non-strictly ascending by startTimestamp`);
    }
    if (previousPage) {
      const anomaly = crossPageAnomaly(options.direction, previousPage, page, earliest, latest);
      if (anomaly) orderingAnomalies.push(anomaly);
    }

    let inWindow = 0;
    let duplicates = 0;
    for (const event of parsed) {
      if (event.startTimestamp < windowStartSeconds || event.startTimestamp > windowEndSeconds) {
        continue;
      }
      inWindow += 1;
      // ONE FIXTURE, ONE ENTRY. No id was observed on two pages, in either feed
      // or across them — but "not observed" is not "cannot happen", and a
      // fixture carried twice would be upserted twice against a conflict target
      // that would silently accept the second as an update of the first.
      if (seen.has(event.providerEventId)) {
        duplicates += 1;
        continue;
      }
      seen.add(event.providerEventId);
      events.push(event);
    }

    const summary: PageSummary = {
      page,
      eventCount: parsed.length,
      inWindowCount: inWindow,
      duplicateCount: duplicates,
      rejectedCount: read.length - parsed.length,
      hasNextPage,
      earliestTimestamp: earliest,
      latestTimestamp: latest,
      ascending,
    };
    pages.push(summary);
    previousPage = summary;

    if (!hasNextPage) {
      stoppedBecause = 'HAS_NEXT_PAGE_FALSE';
      break;
    }
    if (isBeyondWindow(options.direction, earliest, latest, windowStartSeconds, windowEndSeconds)) {
      stoppedBecause = 'BEYOND_WINDOW';
      break;
    }

    page += 1;
  }

  // `page` always holds the page that would have been fetched next, so it is the
  // resume point — and it is recorded ONLY when the budget was what stopped the
  // walk. A walk stopped by 404, by the flag or by the window is finished, and a
  // resume point on a finished walk would invite someone to spend quota
  // re-reading past the end.
  if (stoppedBecause === 'BUDGET_EXHAUSTED') {
    resumeFromPage = page;
  }

  logger.info(
    {
      endpoint: ENDPOINTS[endpointKey].key,
      direction: options.direction,
      competition: String(options.competitionProviderId),
      season: String(options.seasonProviderId),
      pages: pages.length,
      calls: callsSpent,
      events: events.length,
      stoppedBecause,
    },
    'v2 ingestion: season event walk complete'
  );

  return {
    direction: options.direction,
    events,
    pages,
    callsSpent,
    quotaRemaining,
    stoppedBecause,
    resumeFromPage,
    orderingAnomalies,
    rejections,
  };
}

/**
 * Both halves of one season, sharing a budget and a de-duplication set.
 *
 * The SAME pager, called twice with a different direction — not a second
 * implementation. Sharing `seen` across the two calls is what makes a fixture
 * appearing in both feeds arrive once, which no single-direction walk can
 * guarantee on its own.
 *
 * `last` runs first: it is the half bounded by a hard date floor, so it is the
 * half whose cost is predictable, and spending the budget on it first means a
 * truncated sweep loses forward fixtures rather than historical ones.
 */
export async function sweepSeason(
  source: EventPageSource,
  options: Omit<SweepOptions, 'direction' | 'startPage'>
): Promise<Readonly<Record<EventDirection, SweepResult>>> {
  const seen = options.seen ?? new Set<string>();
  const last = await pageSeasonEvents(source, { ...options, direction: 'last', seen });
  const next = await pageSeasonEvents(source, {
    ...options,
    direction: 'next',
    seen,
    callBudget: Math.max(0, options.callBudget - last.callsSpent),
  });
  return { last, next };
}

/**
 * Whether a whole page lies past the window in the direction of travel.
 *
 * `last` walks backwards, so it is finished once the page's NEWEST event is
 * already older than the window opens. `next` walks forwards, so it is finished
 * once the page's OLDEST event is already newer than the window closes. Using
 * the wrong end of the page would stop on the first page containing a single
 * out-of-window fixture and lose the rest of it.
 */
function isBeyondWindow(
  direction: EventDirection,
  earliest: number | null,
  latest: number | null,
  windowStartSeconds: number,
  windowEndSeconds: number
): boolean {
  if (earliest === null || latest === null) return false;
  return direction === 'last' ? latest < windowStartSeconds : earliest > windowEndSeconds;
}

/**
 * Whether consecutive pages related as the contract observed them.
 *
 * `last` page N+1 was entirely earlier than page N; `next` runs the other way.
 * Reported rather than enforced — a violation means the provider changed, and
 * the walk should say so and carry on rather than silently reorder the feed into
 * a shape the evidence does not support.
 */
function crossPageAnomaly(
  direction: EventDirection,
  previous: PageSummary,
  page: number,
  earliest: number | null,
  latest: number | null
): string | null {
  if (earliest === null || latest === null) return null;
  if (direction === 'last') {
    if (previous.earliestTimestamp !== null && latest > previous.earliestTimestamp) {
      return `page ${page} is not entirely earlier than page ${previous.page}`;
    }
    return null;
  }
  if (previous.latestTimestamp !== null && earliest < previous.latestTimestamp) {
    return `page ${page} is not entirely later than page ${previous.page}`;
  }
  return null;
}

function emptySummary(page: number, hasNextPage: boolean): PageSummary {
  return {
    page,
    eventCount: 0,
    inWindowCount: 0,
    duplicateCount: 0,
    rejectedCount: 0,
    hasNextPage,
    earliestTimestamp: null,
    latestTimestamp: null,
    ascending: true,
  };
}

interface Rejection {
  readonly reason: string;
}

function isRejection(value: PagedEvent | Rejection): value is Rejection {
  return !('providerEventId' in value);
}

/**
 * Reads one event, refusing anything it cannot identify.
 *
 * HOME AND AWAY COME FROM `homeTeam` AND `awayTeam`, NEVER FROM `slug`. On the
 * observed forward page, 16 of 30 slugs are in away-home order — event 15235422
 * is slugged `palmeiras-fluminense` and is Fluminense at home. A slug-derived
 * fixture would invert better than half the forward universe, and every home
 * advantage computed from it would be backwards.
 */
export function interpretEvent(candidate: unknown): PagedEvent | Rejection | null {
  const raw = asRecord(candidate);
  if (!raw) return null;

  const providerEventId = externalId(raw.id);
  const tournament = asRecord(raw.tournament);
  const uniqueTournament = asRecord(tournament?.uniqueTournament);
  const homeTeam = asRecord(raw.homeTeam);
  const awayTeam = asRecord(raw.awayTeam);
  const startTimestamp = nonNegativeInt(raw.startTimestamp);

  if (!providerEventId) return { reason: 'event has no id' };
  if (startTimestamp === null) {
    return { reason: `event ${providerEventId} has no startTimestamp` };
  }
  const kickoffAt = fromUnixSeconds(startTimestamp);
  if (!kickoffAt) return { reason: `event ${providerEventId} has an uninterpretable startTimestamp` };

  // The competition is `uniqueTournament.id` and nothing else. `tournament.id` is
  // the season's instance — 83 where the competition is 325 — and falling back to
  // it would file a season's fixtures under a competition that does not exist.
  const competitionProviderId = externalId(uniqueTournament?.id);
  if (!competitionProviderId) {
    return { reason: `event ${providerEventId} has no tournament.uniqueTournament.id` };
  }

  const homeTeamProviderId = externalId(homeTeam?.id);
  const awayTeamProviderId = externalId(awayTeam?.id);
  if (!homeTeamProviderId || !awayTeamProviderId) {
    return { reason: `event ${providerEventId} is missing a participant id` };
  }

  const status = asRecord(raw.status);
  const providerStatusCode = typeof status?.code === 'number' ? status.code : null;

  return {
    providerEventId,
    competitionProviderId,
    tournamentInstanceProviderId: externalId(tournament?.id),
    seasonProviderId: externalId(asRecord(raw.season)?.id),
    startTimestamp,
    kickoffAt,
    homeTeamProviderId,
    awayTeamProviderId,
    homeTeamName: text(homeTeam?.name) ?? `Team ${homeTeamProviderId}`,
    awayTeamName: text(awayTeam?.name) ?? `Team ${awayTeamProviderId}`,
    providerStatusCode,
    lifecycleState: mapLifecycleState(providerStatusCode),
    winnerCode: nonNegativeInt(raw.winnerCode),
    score: readScore(raw),
    roundNumber: nonNegativeInt(asRecord(raw.roundInfo)?.round),
    raw,
  };
}

/**
 * The full-time score, or null.
 *
 * NULL IS THE ANSWER FOR EVERY UNPLAYED FIXTURE, and getting this wrong is the
 * single most damaging thing this file could do. An unplayed fixture arrives with
 * `homeScore: {}`, `awayScore: {}`, `time: {}` and NO `winnerCode` — verified on
 * 30 of 30 events of the observed forward page. Anything that coerces a missing
 * goal count to zero turns every future fixture in the universe into a 0–0
 * result, and a 0–0 is a perfectly plausible score, so nothing downstream would
 * ever flag it.
 *
 * `winnerCode` is therefore the gate, exactly as doc 38 §9 specifies: the
 * provider states a winner only for a decided match. A postponed fixture (status
 * 60) is represented identically to an unplayed one (status 0) and is excluded by
 * the same test — the two are distinguished by status alone, never by score.
 */
export function readScore(raw: Record<string, unknown>): PagedEventScore | null {
  if (nonNegativeInt(raw.winnerCode) === null) return null;

  const home = asRecord(raw.homeScore);
  const away = asRecord(raw.awayScore);
  if (!home || !away) return null;

  const homeGoals = firstPresent(home, ['normaltime', 'current']);
  const awayGoals = firstPresent(away, ['normaltime', 'current']);
  // A winner was declared but no goals came with it. That is a provider data
  // condition, and the honest representation is the absence of a score — not a
  // nil-nil assembled to fill the shape.
  if (homeGoals === null || awayGoals === null) return null;

  return {
    homeGoals,
    awayGoals,
    homeGoalsHalfTime: firstPresent(home, ['period1']),
    awayGoalsHalfTime: firstPresent(away, ['period1']),
  };
}

/** The first present value among the provider's several spellings for one figure. */
function firstPresent(score: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = nonNegativeInt(score[key]);
    if (value !== null) return value;
  }
  return null;
}
