// ─────────────────────────────────────────────────────────────────────────────
// CAPTURED-EVIDENCE REPLAY HARNESS
//
// The smallest thing that lets the REAL pager and the REAL writer run against
// the REAL provider shapes, with no network and no quota. Test-scoped: nothing
// here is imported by production code, and it adds no second HTTP client, no
// second pager and no second write path.
//
// TWO ADAPTERS, AND ONLY TWO.
//
//   capturedSource()   satisfies `EventPageSource` from files on disk. The pager
//                      takes a structural interface precisely so this is
//                      possible; a page with no captured file raises the same
//                      404 the live client raises, which is how the walk
//                      terminates without a special case.
//
//   replayClient()     satisfies the one method `ingestScheduleDate` calls,
//                      returning `{ events }`. The season feed wraps its events
//                      in `data`, the schedule feed does not; unwrapping happens
//                      HERE rather than in the stage, because the stage is
//                      production code and this is a difference between two
//                      provider endpoints, not a defect in it.
//
// Everything between the two adapters — window selection, ordering, scoring,
// identity, partitioning, lifecycle — is the code that will run in production,
// unmodified.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import { ProviderRequestError, type ProviderObservation } from '../../provider/client';
import type { EndpointKey } from '../../provider/endpoints';
import type { EventPageSource, PagedEvent } from '../../provider/pager';
import { ingestScheduleDate, type StageCounts } from '../../stages/schedule';
import type { ProviderClient } from '../../provider/client';

/** Where the discovery captures live. Ignored in some checkouts — see `hasEvidence`. */
export const EVIDENCE_DIR = resolve(__dirname, '..', '..', '..', '..', '..', '..', '..', 'docs', 'api-samples', 'v2-discovery');

/** The competition and season the captures are of. */
export const BRASILEIRAO = { competitionProviderId: '325', seasonProviderId: '87678' } as const;

interface CapturedFile {
  readonly endpointKey: EndpointKey;
  readonly parameters: Record<string, string | number>;
  readonly status: number;
  readonly body: unknown;
}

/**
 * Whether the captured evidence is present in this checkout.
 *
 * The directory is ignored in some working copies, so every test built on it
 * SKIPS rather than fails when it is absent. A replay proof that turned into a
 * red suite on a machine without the files would get deleted rather than fixed.
 */
export function hasEvidence(): boolean {
  if (!existsSync(EVIDENCE_DIR)) return false;
  return readdirSync(EVIDENCE_DIR).some((name) => name.startsWith('tournament_season_events_'));
}

function loadCaptures(): CapturedFile[] {
  return readdirSync(EVIDENCE_DIR)
    .filter((name) => name.startsWith('tournament_season_events_') && name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(EVIDENCE_DIR, name), 'utf8')) as CapturedFile);
}

/**
 * An `EventPageSource` served from the captured bodies.
 *
 * A requested page with no capture raises `ProviderRequestError` with status
 * 404 — the same terminal signal `events/last/999` returned live, and the same
 * one the pager stops on. Nothing about termination is special-cased for replay.
 */
export function capturedSource(): EventPageSource & { calls: { key: string; page: number }[] } {
  const captures = loadCaptures();
  const calls: { key: string; page: number }[] = [];

  const find = (key: EndpointKey, page: number): CapturedFile | undefined =>
    captures.find(
      (file) => file.endpointKey === key && Number(file.parameters.page) === page && file.status === 200
    );

  return {
    calls,
    async getObserved<T>(
      key: EndpointKey,
      params: Record<string, string | number>
    ): Promise<ProviderObservation<T>> {
      const page = Number(params.page);
      calls.push({ key, page });
      const file = find(key, page);
      if (!file) {
        throw new ProviderRequestError(`${key} page ${page} not captured`, key, 404, 1);
      }
      return {
        endpointKey: key,
        path: `(replay) ${key}/${page}`,
        url: `(replay) ${key}/${page}`,
        parameters: params,
        status: 200,
        attempts: 1,
        quotaRemaining: null,
        data: file.body as T,
      };
    },
  };
}

/** Raw events for one captured page, unfiltered. For fixtures the window excludes. */
export function capturedPageEvents(
  endpointKey: EndpointKey,
  page: number
): Record<string, unknown>[] {
  const file = loadCaptures().find(
    (entry) => entry.endpointKey === endpointKey && Number(entry.parameters.page) === page
  );
  const body = file?.body as { data?: { events?: unknown } } | undefined;
  return Array.isArray(body?.data?.events) ? (body.data.events as Record<string, unknown>[]) : [];
}

/**
 * Runs the real writer over a set of events.
 *
 * `ingestScheduleDate` fetches its own payload, so the adapter is a client that
 * answers with the events already in hand. The stage's `date` argument reaches
 * only a log line; the label says where the events came from.
 */
export async function writeEvents(
  tx: PoolClient,
  events: readonly Record<string, unknown>[],
  label = 'replay'
): Promise<StageCounts> {
  const client = { async get() { return { events }; } } as unknown as ProviderClient;
  return ingestScheduleDate(tx, client, label);
}

/** The same, taking what the pager produced. `raw` is the untouched payload. */
export function rawOf(events: readonly PagedEvent[]): Record<string, unknown>[] {
  return events.map((event) => event.raw);
}

export interface ReplayTally {
  readonly fixtures: number;
  readonly completed: number;
  readonly postponed: number;
  readonly scheduled: number;
  readonly results: number;
  readonly transitions: number;
  readonly venues: number;
  readonly teams: number;
  readonly competitions: number;
  readonly editions: number;
  readonly stages: number;
}

/**
 * Every count SCOPED TO THE COMPETITION UNDER REPLAY.
 *
 * Not a stylistic choice. `feature/__tests__/fixtures.ts` deliberately COMMITS
 * football rows — the feature role cannot write them, so its own fixtures have
 * to be there before it runs — and `node --test` runs files concurrently. A
 * global `count(*)` therefore measures whatever else the suite happens to have
 * left behind, and the replay would pass alone and fail in the suite. Scoping to
 * competition 325 makes every number below a statement about THIS replay.
 */
export const SCOPE = `
  WITH scoped_competition AS (
    SELECT id FROM football.competition WHERE provider_external_id = '325'
  ),
  scoped_edition AS (
    SELECT ce.id FROM football.competition_edition ce
     WHERE ce.competition_id IN (SELECT id FROM scoped_competition)
  ),
  scoped_fixture AS (
    SELECT f.* FROM football.fixture f
     WHERE f.competition_edition_id IN (SELECT id FROM scoped_edition)
  )`;

export async function tally(tx: PoolClient): Promise<ReplayTally> {
  const one = async (select: string): Promise<number> => {
    const { rows } = await tx.query<{ n: string }>(`${SCOPE} SELECT (${select})::text AS n`);
    return Number(rows[0].n);
  };
  const fixturesWhere = (predicate: string): string =>
    `SELECT count(*) FROM scoped_fixture WHERE ${predicate}`;

  return {
    fixtures: await one(`SELECT count(*) FROM scoped_fixture`),
    completed: await one(fixturesWhere(`lifecycle_state_code = 'COMPLETED'`)),
    postponed: await one(fixturesWhere(`lifecycle_state_code = 'POSTPONED'`)),
    scheduled: await one(fixturesWhere(`lifecycle_state_code = 'SCHEDULED'`)),
    results: await one(
      `SELECT count(*) FROM football.result r
        WHERE (r.fixture_id, r.fixture_partition_on)
              IN (SELECT id, fixture_partition_on FROM scoped_fixture)`
    ),
    transitions: await one(
      `SELECT count(*) FROM football.fixture_lifecycle_transition t
        WHERE (t.fixture_id, t.fixture_partition_on)
              IN (SELECT id, fixture_partition_on FROM scoped_fixture)`
    ),
    venues: await one(`SELECT count(DISTINCT venue_id) FROM scoped_fixture`),
    teams: await one(
      `SELECT count(*) FROM (
         SELECT home_team_id AS t FROM scoped_fixture
         UNION SELECT away_team_id FROM scoped_fixture) AS participants`
    ),
    competitions: await one(`SELECT count(*) FROM scoped_competition`),
    editions: await one(`SELECT count(*) FROM scoped_edition`),
    stages: await one(
      `SELECT count(*) FROM football.competition_stage
        WHERE competition_edition_id IN (SELECT id FROM scoped_edition)`
    ),
  };
}

/** One fixture as stored, joined to what a reader would want to see. */
export async function fixtureRow(
  tx: PoolClient,
  providerExternalId: string
): Promise<Record<string, unknown> | null> {
  const { rows } = await tx.query(
    `SELECT f.provider_external_id,
            f.id::text                                              AS fixture_id,
            to_char(f.fixture_partition_on, 'YYYY-MM-DD')           AS fixture_partition_on,
            f.tableoid::regclass::text                              AS physical_partition,
            to_char(f.scheduled_kickoff_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"')                   AS scheduled_kickoff_at,
            f.lifecycle_state_code,
            f.provider_status_raw,
            home.name                                               AS home_team,
            away.name                                               AS away_team,
            v.provider_external_id                                  AS venue_external_id,
            v.name                                                  AS venue_name,
            v.capacity                                              AS venue_capacity,
            v.city                                                  AS venue_city,
            v.country_code                                          AS venue_country,
            v.latitude, v.longitude,
            r.home_goals, r.away_goals,
            r.home_goals_half_time, r.away_goals_half_time
       FROM football.fixture f
       JOIN football.team home ON home.id = f.home_team_id
       JOIN football.team away ON away.id = f.away_team_id
       LEFT JOIN football.venue v ON v.id = f.venue_id
       LEFT JOIN football.result r
         ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
      WHERE f.provider_code = 'SPORTSAPI_API' AND f.provider_external_id = $1`,
    [providerExternalId]
  );
  return rows[0] ?? null;
}
