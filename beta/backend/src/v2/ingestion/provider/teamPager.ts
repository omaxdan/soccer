// ─────────────────────────────────────────────────────────────────────────────
// TEAM EVENT PAGER  (D2 C4)
//
// A SIBLING of `pageSeasonEvents` — NOT a modification of it. The frozen season
// pager stays byte-for-byte as validated in S-4; this walks the team feed:
//
//   /teams/{id}/events/last/{page}
//   /teams/{id}/events/next/{page}
//
// It shares the season pager's parse (`interpretEvent`/`readScore`), its event
// shape (`PagedEvent`), its window/termination model and its `seen` dedup — the
// one thing that differs is the endpoint and its single `{id}` subject, so the
// duplication here is the loop, not the rules.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FINAL PATH PARAMETER IS A ZERO-BASED PAGE (D2, EMPIRICALLY ESTABLISHED)
//
// The endpoint registry declares it `{limit}` (a V1 misnomer we are told NOT to
// edit). Empirically the value is a zero-based PAGE — `/teams/1963/events/last/30`
// returned page 30 (events from 2013), not "30 events". So the page number is
// passed positionally as the endpoint's `limit` parameter, which resolves to the
// correct URL without touching `endpoints.ts`. 30/page was observed and is NOT
// hard-coded here; nothing derives a page count from a size.
//
// ─────────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED (D2 §6). Termination is 404, `hasNextPage === false`, a page wholly
// outside the window, or the call budget — whichever fires first. A SHORT PAGE IS
// NOT THE END. A non-2xx other than 404 is a ProviderRequestError that propagates
// (the caller hard-stops the run); this pager never retries and never fabricates
// completeness. Behaviour that depends on the still-uncertified provider contract
// (whether `hasNextPage` is authoritative, V1) is reported, never assumed.
//
// THIS PAGER DOES NOT WRITE. No database handle reaches it.
// ─────────────────────────────────────────────────────────────────────────────

import { ENDPOINTS, type EndpointKey } from './endpoints';
import { ProviderRequestError } from './client';
import {
  interpretEvent,
  FIXTURE_WINDOW,
  FIRST_PAGE,
  type EventDirection,
  type EventPageSource,
  type FixtureWindow,
  type PagedEvent,
  type PageSummary,
  type StopReason,
  type SweepResult,
} from './pager';
import { logger } from '../../../utils/logger';

/** The endpoint each direction reads. The only place direction becomes a path. */
export const TEAM_ENDPOINT_BY_DIRECTION: Readonly<Record<EventDirection, EndpointKey>> = {
  last: 'team_events_last',
  next: 'team_events_next',
};

export interface TeamSweepOptions {
  readonly teamId: string | number;
  readonly direction: EventDirection;
  readonly window?: FixtureWindow;
  /** Maximum provider calls this walk may spend. Required — quota is the constraint. */
  readonly callBudget: number;
  readonly startPage?: number;
  /** Ids already seen, shared across directions so a fixture in both arrives once. */
  readonly seen?: Set<string>;
}

/** The envelope, identical in shape to the season feed (D2/EMP). */
interface EventsEnvelope {
  readonly data?: { readonly events?: unknown; readonly hasNextPage?: unknown };
}

interface Rejection {
  readonly reason: string;
}

function isEvent(value: PagedEvent | Rejection | null): value is PagedEvent {
  return value !== null && 'providerEventId' in value;
}

/** Whether a whole page lies past the window in the direction of travel. */
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

/**
 * Walks one direction of a team's event feed. Mirrors the season pager's
 * termination order: 404 → hasNextPage=false → page beyond window → budget, plus
 * the one defensive empty-page stop (never "short page = end").
 */
export async function pageTeamEvents(
  source: EventPageSource,
  options: TeamSweepOptions
): Promise<SweepResult> {
  const window = options.window ?? FIXTURE_WINDOW;
  const endpointKey = TEAM_ENDPOINT_BY_DIRECTION[options.direction];
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

  while (callsSpent < options.callBudget) {
    let envelope: EventsEnvelope;
    try {
      // The page is passed as the endpoint's declared `limit` parameter — a
      // V1 misnomer we do not edit; positionally it is the zero-based page.
      const observation = await source.getObserved<EventsEnvelope>(endpointKey, {
        id: options.teamId,
        limit: page,
      });
      callsSpent += 1;
      if (observation.quotaRemaining !== null) quotaRemaining = observation.quotaRemaining;
      envelope = observation.data;
    } catch (error) {
      callsSpent += 1;
      if (error instanceof ProviderRequestError && error.isNotFound) {
        stoppedBecause = 'NOT_FOUND';
        break;
      }
      // Any other non-2xx (incl. 403) is not terminal and not retried here — it
      // propagates so the run hard-stops (D2 §6).
      throw error;
    }

    const raw = Array.isArray(envelope.data?.events) ? envelope.data.events : [];
    const hasNextPage = envelope.data?.hasNextPage === true;

    if (raw.length === 0) {
      pages.push(emptySummary(page, hasNextPage));
      stoppedBecause = 'EMPTY_PAGE';
      break;
    }

    const read = raw.map((candidate) => interpretEvent(candidate) as PagedEvent | Rejection | null);
    const parsed = read.filter(isEvent);
    for (const entry of read) {
      if (entry === null) rejections.push('event payload was not an object');
      else if (!isEvent(entry)) rejections.push(entry.reason);
    }

    const timestamps = parsed.map((event) => event.startTimestamp);
    const earliest = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const latest = timestamps.length > 0 ? Math.max(...timestamps) : null;
    // Ordering re-checked, never trusted, never corrected (non-strict ascending).
    const ascending = timestamps.every((value, index) => index === 0 || timestamps[index - 1] <= value);
    if (!ascending) orderingAnomalies.push(`page ${page} is not non-strictly ascending by startTimestamp`);

    let inWindow = 0;
    let duplicates = 0;
    for (const event of parsed) {
      if (event.startTimestamp < windowStartSeconds || event.startTimestamp > windowEndSeconds) continue;
      inWindow += 1;
      // ONE FIXTURE, ONE ENTRY — dedup by provider event id across pages and
      // across directions (the shared `seen`), never by any other field.
      if (seen.has(event.providerEventId)) {
        duplicates += 1;
        continue;
      }
      seen.add(event.providerEventId);
      events.push(event);
    }

    pages.push({
      page,
      eventCount: parsed.length,
      inWindowCount: inWindow,
      duplicateCount: duplicates,
      rejectedCount: read.length - parsed.length,
      hasNextPage,
      earliestTimestamp: earliest,
      latestTimestamp: latest,
      ascending,
    });

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

  if (stoppedBecause === 'BUDGET_EXHAUSTED') resumeFromPage = page;

  logger.info(
    {
      endpoint: ENDPOINTS[endpointKey].key,
      direction: options.direction,
      team: String(options.teamId),
      pages: pages.length,
      calls: callsSpent,
      events: events.length,
      stoppedBecause,
    },
    'v2 ingestion: team event walk complete'
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
 * Both halves of one team, sharing a budget and a `seen` set — `last` first
 * (bounded by the date floor), then `next` with the remaining budget, so a
 * truncated sweep loses forward fixtures rather than historical ones.
 */
export async function sweepTeam(
  source: EventPageSource,
  options: Omit<TeamSweepOptions, 'direction' | 'startPage'>
): Promise<Readonly<Record<EventDirection, SweepResult>>> {
  const seen = options.seen ?? new Set<string>();
  const last = await pageTeamEvents(source, { ...options, direction: 'last', seen });
  const next = await pageTeamEvents(source, {
    ...options,
    direction: 'next',
    seen,
    callBudget: Math.max(0, options.callBudget - last.callsSpent),
  });
  return { last, next };
}
