// ─────────────────────────────────────────────────────────────────────────────
// INGESTION PIPELINE
//
// ─────────────────────────────────────────────────────────────────────────────
// ONE ROLE, UNLIKE S-3
//
// S-3 needed four roles because it wrote across four schemas and the privilege
// matrix assigns writes by layer. S-4 writes schema football and nothing else,
// so pt_pipeline_ingestion covers all of it — and unlike pt_platform_admin under
// finding S3-1, it holds S and I on operations, so EVERY STAGE IS ATTRIBUTED.
// There is no unattributed path here and no reason for one.
//
// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE IS NOT CALCULATED HERE, AND CANNOT BE
//
// pt_pipeline_ingestion holds no USAGE on feature, module, snapshot or
// calibration. A statement touching feature.feature_value fails with "permission
// denied for schema feature" before it reaches a policy. The constraint holds
// against a coding mistake, not merely against intent.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUOTA IS FLUSHED ON THE CONTROL CONNECTION
//
// A stage that fails rolls back its writes. It does NOT roll back what it spent
// — the provider charged for those calls whatever happened afterwards. Usage is
// therefore flushed outside the work transaction, so the next run reasons about
// a budget that was really consumed rather than one the rollback pretended back
// into existence.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { withConnection, withRun } from '../db/tx';
import { withPipelineRun } from '../operations/run';
import { installOperationalLayer } from '../operations/jobLifecycle';
import { recordWrite } from '../operations/writeRecord';
import { buildDiagnostic } from '../operations/failure';
import { assertDatabaseConfigured } from '../config/index';
import { ProviderClient, ProviderRequestError } from './provider/client';
import { PROVIDER_CODE, dailyQuota, loadProviderConfig } from './provider/config';
import { IngestionCounts } from './write/index';
import { ingestEvents, ingestScheduleDate, type IngestionScope } from './stages/schedule';
import { fetchSeasonStandings, ingestStandings } from './stages/standings';
import {
  sweepSeason,
  type EventDirection,
  type FixtureWindow,
  type PagedEvent,
  type StopReason,
  type SweepResult,
} from './provider/pager';
import { sweepTeam } from './provider/teamPager';
import { reconcileTeamSeason, type ReconcileCounts } from './stages/teamSpine';
import { ingestTeamSquad, type SquadTeam } from './stages/squad';
import type { StageCounts } from './stages/schedule';
import { AmbiguousFixtureIdentityError } from './entities/fixtures';
import { utcDateString } from './normalise';
import { logger } from '../../utils/logger';

/** The only role S-4 authenticates as. */
export const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;

export interface IngestionReport {
  readonly datesProcessed: number;
  readonly counts: IngestionCounts;
  readonly apiCalls: number;
  readonly failures: number;
}

export interface ScheduleIngestionOptions {
  /** First UTC date, inclusive. Defaults to today. */
  readonly from?: Date;
  /** Last UTC date, inclusive. Defaults to `from`. */
  readonly to?: Date;
  /**
   * Refuse to start when the range would exceed the daily budget.
   *
   * ON BY DEFAULT. A replay across a season is 300-odd calls against a 200/day
   * budget, and discovering that at call 201 leaves the run half-done with the
   * next day's quota already spent. Historical replay is a deliberate act (D-3),
   * so it passes false and accepts the cost knowingly.
   */
  readonly enforceQuotaBudget?: boolean;
}

/** Every UTC date in an inclusive range. */
function datesInRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= last) {
    dates.push(utcDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Ingests the schedule feed for a date range.
 *
 * DATE-RANGE DRIVEN THROUGHOUT (decision D-3). The feed is fetched per day
 * regardless, so a range costs nothing structurally and makes historical replay
 * the same code path rather than a second implementation. Default operation is a
 * single day — forward-only from cut-over — and a replay is an explicit,
 * quota-gated invocation.
 *
 * ONE TRANSACTION PER DATE. A date that fails rolls back entirely and the run
 * continues to the next: a partially ingested day is worse than an absent one,
 * because the next attempt would find some fixtures present. Days are
 * independent, so one bad response does not cost the rest of the range.
 */
export async function ingestSchedule(options: ScheduleIngestionOptions = {}): Promise<IngestionReport> {
  assertDatabaseConfigured();
  installOperationalLayer();

  const config = loadProviderConfig();
  const from = options.from ?? new Date();
  const to = options.to ?? from;
  const dates = datesInRange(from, to);

  if (options.enforceQuotaBudget !== false && dates.length > dailyQuota(config)) {
    throw new Error(
      `Refusing to ingest ${dates.length} dates against a daily budget of ${dailyQuota(config)} calls. ` +
        'Historical replay is a deliberate act (D-3): pass enforceQuotaBudget: false to accept the cost.'
    );
  }

  const client = new ProviderClient(config);
  const total = new IngestionCounts();
  let failures = 0;
  let apiCalls = 0;

  await withPipelineRun(INGESTION_ROLE, 'v2.ingest.schedule', async () => {
    for (const date of dates) {
      try {
        const counts = await withRun(
          INGESTION_ROLE,
          'ingest.schedule',
          async (tx: PoolClient, job) => {
            const stageCounts = await ingestScheduleDate(tx, client, date);
            await reportWrites(job, stageCounts);
            return stageCounts;
          },
          { detail: { date } }
        );
        total.add(counts.total);
        logger.info(
          {
            date,
            written: counts.total.written,
            inserted: counts.total.inserted,
            updated: counts.total.updated,
            skipped: counts.total.skipped,
            rejected: counts.total.rejected,
          },
          'v2 ingestion: date complete'
        );
      } catch (error) {
        failures += 1;
        const notFound = error instanceof ProviderRequestError && error.isNotFound;
        // NOT recorded here. The S-2 job lifecycle already wrote the
        // operations.failure row when withRun rejected — with the job run
        // attribution this scope no longer has, on the control connection, and
        // outside the transaction that rolled back. Recording it again would
        // duplicate the row, and recording it here without a job run could not
        // work at all: operations.failure.pipeline_job_run_id is NOT NULL.
        logger[notFound ? 'warn' : 'error'](
          { date, error: buildDiagnostic(error) },
          notFound
            ? 'v2 ingestion: provider has no schedule for this date'
            : 'v2 ingestion: date failed, continuing with the range'
        );
      } finally {
        // Flush before the next date, so a crash mid-range still leaves an
        // accurate record of what was spent up to that point.
        apiCalls += client.pendingCallCount;
        await withConnection(INGESTION_ROLE, (control) => client.flushUsage(control));
      }
    }
  });

  return { datesProcessed: dates.length, counts: total, apiCalls, failures };
}

/**
 * Writes one `operations.write_record` per relation touched.
 *
 * Per relation rather than per stage, because `write_record` keys on
 * `(target_schema_name, target_relation_name)` and a single aggregate row would
 * lose the thing the relation exists to reveal: WHICH relation received nothing.
 * "A job completing successfully while writing nothing is among the most
 * dangerous states in a precompute platform and is invisible without this
 * record."
 */
async function reportWrites(
  job: Parameters<typeof recordWrite>[1],
  stage: { readonly byRelation: ReadonlyMap<string, IngestionCounts> }
): Promise<void> {
  await withConnection(INGESTION_ROLE, async (control) => {
    for (const [relation, counts] of stage.byRelation) {
      const [schema, name] = relation.split('.');
      await recordWrite(control, job, { schema, relation: name }, counts.toWriteCounts());
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SQUAD INGESTION — G-4 and G-9
//
// ─────────────────────────────────────────────────────────────────────────────
// THE WORK LIST IS A QUERY, NOT A TABLE
//
// `team_players` is a PER_ENTITY endpoint: one call per team. Against a 200-call
// daily budget an unbounded pass over the estate is not affordable, so the stage
// takes the STALEST teams and stops.
//
// Staleness is derived rather than recorded, because recording it would need a
// relation the architecture does not have and S-4 may not add. The squad
// response carries valuations, `recordValuations` writes at most one row per
// player per source per day, and the grain is therefore exactly "the day this
// squad was last observed". `max(player_valuation.as_of_on)` is that date.
//
// NULLS FIRST puts never-observed teams ahead of stale ones: a squad never
// fetched is worth more than one fetched three days ago. `team.id` is the final
// tie-break, so the list is TOTALLY ORDERED and two runs against the same state
// choose the same teams in the same order.
// ─────────────────────────────────────────────────────────────────────────────

export interface SquadIngestionOptions {
  /** Maximum teams to fetch in this run. One provider call each. */
  readonly limit?: number;
  /** Ingest exactly one team, by provider id. Overrides the work list. */
  readonly teamProviderExternalId?: string;
  /** Refuse to start when the run would exceed the daily budget. ON by default. */
  readonly enforceQuotaBudget?: boolean;
  /**
   * The run's single observation date, `YYYY-MM-DD` UTC.
   *
   * Captured ONCE and passed down, per the S-5 discipline. Tests supply it;
   * production does not.
   */
  readonly observedOn?: string;
}

const DEFAULT_SQUAD_LIMIT = 20;

/** The stalest teams first, bounded. See the header for why this is a query. */
export async function selectSquadWorkList(
  tx: PoolClient,
  options: SquadIngestionOptions = {}
): Promise<SquadTeam[]> {
  if (options.teamProviderExternalId) {
    const { rows } = await tx.query<{ id: string; provider_external_id: string; name: string }>(
      `SELECT id::text, provider_external_id, name
         FROM football.team
        WHERE provider_code = $1 AND provider_external_id = $2`,
      [PROVIDER_CODE, options.teamProviderExternalId]
    );
    return rows.map((r) => ({
      teamId: r.id,
      providerExternalId: r.provider_external_id,
      name: r.name,
    }));
  }

  const { rows } = await tx.query<{ id: string; provider_external_id: string; name: string }>(
    `SELECT t.id::text, t.provider_external_id, t.name
       FROM football.team t
       LEFT JOIN football.player_registration r
              ON r.team_id = t.id AND upper_inf(r.registration_period)
       LEFT JOIN football.player_valuation v
              ON v.player_id = r.player_id
      WHERE t.provider_code = $1
      GROUP BY t.id, t.provider_external_id, t.name
      ORDER BY max(v.as_of_on) NULLS FIRST, t.id
      LIMIT $2`,
    [PROVIDER_CODE, options.limit ?? DEFAULT_SQUAD_LIMIT]
  );
  return rows.map((r) => ({
    teamId: r.id,
    providerExternalId: r.provider_external_id,
    name: r.name,
  }));
}

/**
 * Ingests squads for the stalest teams.
 *
 * ONE TRANSACTION PER TEAM. A team that fails rolls back entirely — including
 * its `closeResolvedSpells` — and the run continues to the next. Teams are
 * independent, so one bad response does not cost the rest of the list.
 *
 * Quota is flushed per team on the control connection, outside the work
 * transaction, exactly as the schedule stage does: the provider charged for the
 * call whatever happened afterwards.
 */
export async function ingestSquads(options: SquadIngestionOptions = {}): Promise<IngestionReport> {
  assertDatabaseConfigured();
  installOperationalLayer();

  const config = loadProviderConfig();
  // One observation date for the whole run.
  const observedOn = options.observedOn ?? utcDateString(new Date());

  const teams = await withConnection(INGESTION_ROLE, (tx) => selectSquadWorkList(tx, options));

  if (options.enforceQuotaBudget !== false && teams.length > dailyQuota(config)) {
    throw new Error(
      `Refusing to fetch ${teams.length} squads against a daily budget of ${dailyQuota(config)} calls. ` +
        'Lower --limit, or pass enforceQuotaBudget: false to accept the cost.'
    );
  }

  const client = new ProviderClient(config);
  const total = new IngestionCounts();
  let failures = 0;
  let apiCalls = 0;

  await withPipelineRun(INGESTION_ROLE, 'v2.ingest.squads', async () => {
    for (const team of teams) {
      try {
        const counts = await withRun(
          INGESTION_ROLE,
          'ingest.squad',
          async (tx: PoolClient, job) => {
            const stageCounts = await ingestTeamSquad(tx, client, team, observedOn);
            await reportWrites(job, stageCounts);
            return stageCounts;
          },
          { detail: { team: team.providerExternalId, observedOn } }
        );
        total.add(counts.total);
      } catch (error) {
        failures += 1;
        const notFound = error instanceof ProviderRequestError && error.isNotFound;
        // NOT recorded here — the S-2 job lifecycle already wrote the
        // operations.failure row when withRun rejected, on the control
        // connection and outside the transaction that rolled back.
        logger[notFound ? 'warn' : 'error'](
          { team: team.name, providerExternalId: team.providerExternalId, error: buildDiagnostic(error) },
          notFound
            ? 'v2 ingestion: provider has no squad for this team'
            : 'v2 ingestion: squad failed, continuing with the work list'
        );
      } finally {
        apiCalls += client.pendingCallCount;
        await withConnection(INGESTION_ROLE, (control) => client.flushUsage(control));
      }
    }
  });

  return { datesProcessed: teams.length, counts: total, apiCalls, failures };
}


// ─────────────────────────────────────────────────────────────────────────────
// SEASON INGESTION — the season feed, joined to the shared writer
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS SEPARATELY FROM ingestSchedule
//
// Not because the writing differs — it does not, and `ingestEvents` is the same
// function both paths call. It exists because the READING differs: the schedule
// feed is one call per date and carries every competition playing, while the
// season feed is a paged walk of one competition's one season. A date range and
// a paged walk are different traversals, and folding them into one function
// would mean a function whose arguments contradict each other.
//
// ─────────────────────────────────────────────────────────────────────────────
// FETCH OUTSIDE THE TRANSACTION, WRITE INSIDE IT
//
// The pager makes up to `maxCalls` HTTP requests, each throttled to the
// provider's minimum interval. Holding a database transaction open across that
// would pin a pooled connection for the duration of a network walk and take row
// locks nobody is contending for yet. So the walk completes first and the whole
// season is written in ONE transaction: 47 fixtures either all land or none do,
// and a re-run finds a clean slate rather than a half-season.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeasonIngestionOptions {
  /** `tournament.uniqueTournament.id` — THE COMPETITION. */
  readonly competitionProviderId: string;
  /** `season.id` — the edition. Not `tournament.id`. */
  readonly seasonProviderId: string;
  /** Window start, inclusive. Required: this is not a defaulted value. */
  readonly from: Date;
  /** Window end, inclusive to the end of that UTC day. */
  readonly to: Date;
  /** Maximum provider calls for the WHOLE sweep, both directions. */
  readonly maxCalls: number;
  /**
   * Also capture the season's league table. OFF unless asked.
   *
   * Default-off is the point: the four-call sweep is proven, and a flag that
   * quietly added a fifth call would change what "the proven sweep" means.
   */
  readonly withStandings?: boolean;
  /** Supplied by tests. Production passes nothing and gets a real client. */
  readonly client?: ProviderClient;
}

export interface SeasonDirectionReport {
  readonly direction: EventDirection;
  readonly pages: readonly number[];
  readonly eventsRead: number;
  readonly eventsSelected: number;
  readonly duplicates: number;
  readonly callsSpent: number;
  readonly stoppedBecause: StopReason;
  readonly resumeFromPage: number | null;
  readonly orderingAnomalies: readonly string[];
}

export interface SeasonIngestionReport {
  readonly competitionProviderId: string;
  readonly seasonProviderId: string;
  readonly window: { readonly from: string; readonly to: string };
  readonly directions: readonly SeasonDirectionReport[];
  readonly eventsRead: number;
  readonly eventsSelected: number;
  readonly callsSpent: number;
  /** What the provider last said. Null when it said nothing. */
  readonly quotaRemaining: number | null;
  readonly counts: IngestionCounts;
  readonly byRelation: ReadonlyMap<string, IngestionCounts>;
  /** Whether standings were requested — recorded so a run states its own scope. */
  readonly standingsRequested: boolean;
  /** The UTC date the standings snapshot was OBSERVED, or null when not asked. */
  readonly standingsAsOfOn: string | null;
  readonly standingsCounts: IngestionCounts | null;
  /** Editions resolved for this provider season. Must be exactly 1. */
  readonly editionsForSeason: number;
  readonly competitionEditionId: string | null;
  readonly failed: boolean;
}

/**
 * Ingests one competition season, bounded by an explicit window and budget.
 *
 * THE WINDOW IS A PARAMETER, NOT A CONSTANT. `FIXTURE_WINDOW` remains in the
 * pager as the evidence-derived default for tests and exploration; production
 * passes its own, from the CLI, and the resolved values are printed before the
 * first call. A window that lives only in a module constant cannot appear in a
 * run record, and an operator cannot see what a run actually used.
 *
 * ONE BUDGET FOR THE WHOLE SWEEP. `sweepSeason` walks `last` first and hands the
 * remainder to `next`, so a truncated sweep loses forward fixtures rather than
 * historical ones — the half bounded by a hard date floor is the half whose cost
 * is predictable.
 *
 * SCOPE IS ENFORCED AT THE WRITER, not here. Passing `scope` means every event
 * is checked against the requested competition and season immediately before it
 * would be written, so a provider response containing something else is rejected
 * and counted rather than imported. Checking here would leave the writer
 * trusting its caller.
 */
export async function ingestSeason(
  options: SeasonIngestionOptions
): Promise<SeasonIngestionReport> {
  assertDatabaseConfigured();
  installOperationalLayer();

  if (!(options.from instanceof Date) || Number.isNaN(options.from.getTime())) {
    throw new Error('ingestSeason requires a valid `from` date.');
  }
  if (!(options.to instanceof Date) || Number.isNaN(options.to.getTime())) {
    throw new Error('ingestSeason requires a valid `to` date.');
  }
  if (options.to.getTime() < options.from.getTime()) {
    throw new Error(
      `Window end ${utcDateString(options.to)} precedes its start ${utcDateString(options.from)}.`
    );
  }
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 1) {
    throw new Error('ingestSeason requires --max-calls to be a whole number of at least 1.');
  }

  // Config is loaded ONLY to build a client. An injected one carries its own,
  // so requiring PT_V2_PROVIDER_BASE_URL to run a sweep that makes no request of
  // its own would be demanding configuration for a dependency already supplied.
  const client = options.client ?? new ProviderClient(loadProviderConfig());

  // Inclusive of the whole final day: a fixture kicking off at 22:30Z on the
  // last date is inside the window, and a boundary at midnight would drop the
  // evening round.
  const window: FixtureWindow = {
    startsAt: new Date(`${utcDateString(options.from)}T00:00:00.000Z`),
    endsAt: new Date(`${utcDateString(options.to)}T23:59:59.999Z`),
  };

  const scope: IngestionScope = {
    competitionProviderId: options.competitionProviderId,
    seasonProviderId: options.seasonProviderId,
  };

  let sweep: Readonly<Record<EventDirection, SweepResult>> | null = null;
  let counts = new IngestionCounts();
  let byRelation: ReadonlyMap<string, IngestionCounts> = new Map();
  let editionsForSeason = 0;
  let competitionEditionId: string | null = null;
  let standingsCounts: IngestionCounts | null = null;
  let standingsCallsSpent = 0;
  let failed = false;

  // `scopeText` is what an operator reads in the run ledger to know WHAT was
  // swept without opening the job's detail. A run key alone says only that a
  // season sweep happened.
  const withStandings = options.withStandings === true;
  // ONE DATE FOR THE RUN. `season_standings` takes no historical parameter and
  // returns the CURRENT table whatever window was asked for, so the honest stamp
  // is the UTC calendar date the snapshot was observed — not `--to`, which would
  // date an August table as June on any backfill. Established here so twenty
  // rows cannot disagree about when they were seen.
  const standingsAsOfOn = withStandings ? utcDateString(new Date()) : null;

  const scopeText =
    `competition ${options.competitionProviderId} season ${options.seasonProviderId} ` +
    `${utcDateString(options.from)}..${utcDateString(options.to)}` +
    (withStandings ? ` +standings@${standingsAsOfOn}` : '');

  await withPipelineRun(INGESTION_ROLE, 'v2.ingest.season', async () => {
    try {
      // ── Read. No transaction is held across the network walk. ──────────────
      sweep = await sweepSeason(client, {
        competitionProviderId: options.competitionProviderId,
        seasonProviderId: options.seasonProviderId,
        window,
        // The standings call is RESERVED out of the budget rather than added to
        // it, so --max-calls bounds the whole run and not merely the pager.
        callBudget: withStandings ? Math.max(0, options.maxCalls - 1) : options.maxCalls,
      });

      const selected = [...sweep.last.events, ...sweep.next.events];

      // FETCHED OUTSIDE THE TRANSACTION, like the walk, for the same reason: a
      // database transaction must not be held open across a network request.
      let standingsResponse: Awaited<ReturnType<typeof fetchSeasonStandings>> | null = null;
      if (withStandings) {
        standingsResponse = await fetchSeasonStandings(
          client,
          options.competitionProviderId,
          options.seasonProviderId
        );
        // COUNTED SEPARATELY AND ADDED TO THE TOTAL. The pager reports only its
        // own walk, so a report summing directions alone would understate a
        // standings run by exactly one call — the same shape of telemetry gap as
        // F-2, and not worth repeating.
        standingsCallsSpent = 1;
      }

      // ── Write. One transaction for the whole season. ───────────────────────
      const stageCounts = await withRun(
        INGESTION_ROLE,
        'ingest.season',
        async (tx: PoolClient, job) => {
          const written = await ingestEvents(tx, selected.map((event) => event.raw), {
            label: `season ${options.competitionProviderId}/${options.seasonProviderId}`,
            scope,
          });
          await reportWrites(job, written);

          // THE F-1 ASSERTION, made from the database rather than assumed. If
          // this is ever not 1, the run has produced the defect doc 41
          // investigated and the transaction is rolled back rather than
          // committed and reported.
          const { rows } = await tx.query<{ id: string; n: string }>(
            `SELECT id::text, count(*) OVER ()::text AS n
               FROM football.competition_edition
              WHERE provider_external_id = $1`,
            [options.seasonProviderId]
          );
          editionsForSeason = rows.length;
          competitionEditionId = rows[0]?.id ?? null;
          if (selected.length > 0 && editionsForSeason !== 1) {
            throw new Error(
              `provider season ${options.seasonProviderId} resolved to ${editionsForSeason} ` +
                'competition editions; exactly one is required (F-1, doc 41)'
            );
          }
          // STANDINGS LAST. It needs the edition the events resolved, and the
          // assertion above has just proved there is exactly one.
          if (standingsResponse && competitionEditionId && standingsAsOfOn) {
            const standings = await ingestStandings(tx, {
              competitionEditionId,
              asOfOn: standingsAsOfOn,
              response: standingsResponse,
            });
            await reportWrites(job, standings);
            standingsCounts = standings.total;
          } else if (standingsResponse) {
            logger.warn(
              { competition: options.competitionProviderId, season: options.seasonProviderId },
              'v2 ingestion: standings fetched but no competition edition was resolved, table not written'
            );
          }

          return written;
        },
        {
          detail: {
            competition: options.competitionProviderId,
            season: options.seasonProviderId,
            from: utcDateString(options.from),
            to: utcDateString(options.to),
            maxCalls: options.maxCalls,
            withStandings,
            standingsAsOfOn,
          },
        }
      );

      counts = stageCounts.total;
      byRelation = stageCounts.byRelation;
    } catch (error) {
      failed = true;
      // NOT recorded here. `withRun` already wrote the operations.failure row
      // with the job attribution this scope no longer has, on the control
      // connection, outside the transaction that rolled back.
      logger.error(
        {
          competition: options.competitionProviderId,
          season: options.seasonProviderId,
          error: buildDiagnostic(error),
        },
        'v2 ingestion: season sweep failed'
      );
      throw error;
    } finally {
      // Flush what was spent even when the write rolled back. The provider
      // charged for those calls whatever happened afterwards.
      await withConnection(INGESTION_ROLE, (control) => client.flushUsage(control));
    }
  }, { scopeText });

  const result = sweep as unknown as Readonly<Record<EventDirection, SweepResult>>;
  const directions: SeasonDirectionReport[] = (['last', 'next'] as const).map((direction) => {
    const walk = result[direction];
    return {
      direction,
      pages: walk.pages.map((page) => page.page),
      eventsRead: walk.pages.reduce((total, page) => total + page.eventCount, 0),
      eventsSelected: walk.events.length,
      duplicates: walk.pages.reduce((total, page) => total + page.duplicateCount, 0),
      callsSpent: walk.callsSpent,
      stoppedBecause: walk.stoppedBecause,
      resumeFromPage: walk.resumeFromPage,
      orderingAnomalies: walk.orderingAnomalies,
    };
  });

  return {
    competitionProviderId: options.competitionProviderId,
    seasonProviderId: options.seasonProviderId,
    window: { from: utcDateString(options.from), to: utcDateString(options.to) },
    directions,
    eventsRead: directions.reduce((total, entry) => total + entry.eventsRead, 0),
    eventsSelected: directions.reduce((total, entry) => total + entry.eventsSelected, 0),
    callsSpent:
      directions.reduce((total, entry) => total + entry.callsSpent, 0) + standingsCallsSpent,
    quotaRemaining: result.next.quotaRemaining ?? result.last.quotaRemaining,
    counts,
    byRelation,
    editionsForSeason,
    competitionEditionId,
    standingsRequested: withStandings,
    standingsAsOfOn,
    standingsCounts,
    failed,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// TEAM-DRIVEN INGESTION — the bounded first-run controller (D2 I1)
//
// ONE explicit (team, uniqueTournament, season). C1 enumeration and C2 season
// selection are BYPASSED — the ids are supplied. The team-event spine is walked
// and written through the SAME shared writer as schedule/season, WITH NO SCOPE,
// so its complete cross-competition chronology is preserved (D2 §2). Then the
// competition-season feeds reconcile it; anything missing from the spine is fed
// back through the same writer and audited, never discarded. Writes football.*
// and operations.* only — the role holds no other USAGE.
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamIngestionOptions {
  readonly teamId: string;
  readonly uniqueTournamentId: string;
  readonly seasonId: string;
  /** Historical date floor, inclusive. */
  readonly from: Date;
  /** Window end, inclusive to end of day. Defaults to today. */
  readonly to?: Date;
  /** Maximum provider calls for the WHOLE run (spine walk + reconciliation). */
  readonly maxCalls: number;
  /** Reconcile against season / tournament-team-events feeds. On unless false. */
  readonly reconcile?: boolean;
  /** Tests supply a client; production gets a real one. */
  readonly client?: ProviderClient;
}

export interface TeamIngestionReport {
  readonly team: string;
  readonly uniqueTournament: string;
  readonly season: string;
  readonly pagesLast: readonly number[];
  readonly pagesNext: readonly number[];
  readonly eventsObserved: number;
  readonly distinctEventIds: number;
  readonly fixturesCreated: number;
  readonly fixturesReused: number;
  readonly duplicatesSuppressed: number;
  readonly teamRegistrationsCreated: number;
  readonly resultsWritten: number;
  readonly lifecycleTransitions: number;
  readonly reconciliationMatches: number;
  readonly missingFromSpine: number;
  readonly spineOnly: number;
  readonly identityMismatches: number;
  readonly dateDiscrepancies: number;
  readonly statusDiscrepancies: number;
  readonly unknownStatusCount: number;
  readonly quarantinedEvents: number;
  readonly failures: number;
  readonly providerCalls: number;
  readonly providerBudget: number;
  readonly budgetRemaining: number;
  readonly moduleWrites: number;
  readonly featureWrites: number;
  readonly snapshotWrites: number;
  readonly calibrationWrites: number;
  readonly runStatus: 'SUCCEEDED' | 'HARD_STOP';
  readonly hardStopReason: string | null;
  readonly resumeFromPage: number | null;
  readonly anomalies: readonly string[];
}

/** Folds several stages' per-relation counts into one map for the report. */
function mergeRelationCounts(...stages: (StageCounts | null)[]): Map<string, IngestionCounts> {
  const merged = new Map<string, IngestionCounts>();
  for (const stage of stages) {
    if (!stage) continue;
    for (const [relation, counts] of stage.byRelation) {
      let into = merged.get(relation);
      if (!into) {
        into = new IngestionCounts();
        merged.set(relation, into);
      }
      into.add(counts);
    }
  }
  return merged;
}

function classifyHardStop(error: unknown): string {
  if (error instanceof AmbiguousFixtureIdentityError) return 'ambiguous fixture identity (U-9)';
  if (error instanceof ProviderRequestError) {
    return error.status === 403
      ? 'HTTP 403 provider access failure'
      : `provider request failed (status ${error.status ?? 'none'})`;
  }
  return 'unrecoverable error';
}

/**
 * Ingests one team's cross-competition event spine, bounded and reconciled.
 *
 * FETCH OUTSIDE THE TRANSACTION, WRITE INSIDE IT, exactly as `ingestSeason` does.
 * The spine is written in ONE transaction (all-or-nothing) through `ingestEvents`
 * with NO scope, so no competition is filtered out. A hard stop (403, ambiguous
 * identity, provider failure) is captured, recorded via the operations layer, and
 * surfaced in the report rather than rethrown, so a verification report is always
 * produced (D2 §17).
 */
export async function ingestTeam(options: TeamIngestionOptions): Promise<TeamIngestionReport> {
  assertDatabaseConfigured();
  installOperationalLayer();

  if (!options.teamId || !options.uniqueTournamentId || !options.seasonId) {
    throw new Error(
      'ingestTeam requires explicit --team, --tournament and --season (C1/C2 are bypassed for I1).'
    );
  }
  if (!Number.isInteger(options.maxCalls) || options.maxCalls < 2) {
    throw new Error(
      'ingestTeam requires --max-calls to be a whole number of at least 2 (spine walk + reconciliation).'
    );
  }

  const client = options.client ?? new ProviderClient(loadProviderConfig());
  const window: FixtureWindow = {
    startsAt: new Date(`${utcDateString(options.from)}T00:00:00.000Z`),
    endsAt: new Date(`${utcDateString(options.to ?? new Date())}T23:59:59.999Z`),
  };
  const doReconcile = options.reconcile !== false;

  const scopeText =
    `team ${options.teamId} competition ${options.uniqueTournamentId} ` +
    `season ${options.seasonId} from ${utcDateString(options.from)}`;

  // The callback RETURNS its state rather than mutating outer `let`s: TypeScript's
  // control-flow analysis does not track assignments made inside a callback, so
  // reading them back after the await is the only form it narrows correctly.
  interface TeamRunState {
    sweep: Readonly<Record<EventDirection, SweepResult>> | null;
    spineEvents: PagedEvent[];
    spineStage: StageCounts | null;
    missingStage: StageCounts | null;
    recon: { readonly counts: ReconcileCounts; readonly anomalies: readonly string[] } | null;
    runStatus: 'SUCCEEDED' | 'HARD_STOP';
    hardStopReason: string | null;
  }

  const state = await withPipelineRun(
    INGESTION_ROLE,
    'v2.ingest.team',
    async (): Promise<TeamRunState> => {
      let sweep: Readonly<Record<EventDirection, SweepResult>> | null = null;
      let spineEvents: PagedEvent[] = [];
      let spineStage: StageCounts | null = null;
      let missingStage: StageCounts | null = null;
      let recon: { readonly counts: ReconcileCounts; readonly anomalies: readonly string[] } | null = null;
      let runStatus: 'SUCCEEDED' | 'HARD_STOP' = 'SUCCEEDED';
      let hardStopReason: string | null = null;
      try {
        // ── READ: team spine, outside any transaction ───────────────────────
        sweep = await sweepTeam(client, {
          teamId: options.teamId,
          window,
          callBudget: options.maxCalls,
        });
        spineEvents = [...sweep.last.events, ...sweep.next.events];

        // ── WRITE: the whole spine in one transaction, NO SCOPE (D2 §2) ──────
        spineStage = await withRun(
          INGESTION_ROLE,
          'ingest.team.spine',
          async (tx: PoolClient, job) => {
            const written = await ingestEvents(
              tx,
              spineEvents.map((event) => event.raw),
              { label: `team ${options.teamId} spine` }
            );
            await reportWrites(job, written);
            return written;
          },
          {
            detail: {
              team: options.teamId,
              competition: options.uniqueTournamentId,
              season: options.seasonId,
            },
          }
        );

        // ── RECONCILE: season + tournament-team-events, ingest any gap ───────
        if (doReconcile) {
          const remaining = Math.max(
            0,
            options.maxCalls - (sweep.last.callsSpent + sweep.next.callsSpent)
          );
          const result = await reconcileTeamSeason(
            client,
            {
              teamId: options.teamId,
              uniqueTournamentId: options.uniqueTournamentId,
              seasonId: options.seasonId,
              window,
              callBudget: remaining,
            },
            spineEvents
          );
          recon = { counts: result.counts, anomalies: result.anomalies };

          if (result.missingRaws.length > 0) {
            missingStage = await withRun(
              INGESTION_ROLE,
              'ingest.team.reconcile',
              async (tx: PoolClient, job) => {
                const written = await ingestEvents(tx, result.missingRaws, {
                  label: `team ${options.teamId} reconcile`,
                });
                await reportWrites(job, written);
                return written;
              },
              { detail: { team: options.teamId, missing: result.missingRaws.length } }
            );
          }
        }
      } catch (error) {
        runStatus = 'HARD_STOP';
        hardStopReason = classifyHardStop(error);
        // `withRun` already wrote operations.failure with job attribution, and
        // the run's outcome reflects the failed job via jobOutcomes. Not
        // rethrown, so the verification report can still be produced.
        logger.error(
          { team: options.teamId, error: buildDiagnostic(error) },
          'v2 ingestion: team run hard-stopped'
        );
      } finally {
        await withConnection(INGESTION_ROLE, (control) => client.flushUsage(control));
      }
      return { sweep, spineEvents, spineStage, missingStage, recon, runStatus, hardStopReason };
    },
    { scopeText }
  );

  // ── Assemble the verification report ────────────────────────────────────────
  const { sweep, spineEvents, recon, runStatus, hardStopReason } = state;
  const merged = mergeRelationCounts(state.spineStage, state.missingStage);
  const fixtures = merged.get('football.fixture') ?? new IngestionCounts();
  const registrations = merged.get('football.team_registration') ?? new IngestionCounts();
  const results = merged.get('football.result') ?? new IngestionCounts();
  const transitions = merged.get('football.fixture_lifecycle_transition') ?? new IngestionCounts();
  let quarantined = 0;
  for (const counts of merged.values()) quarantined += counts.rejected;

  const walkCalls = sweep ? sweep.last.callsSpent + sweep.next.callsSpent : 0;
  const reconCalls = recon ? recon.counts.callsSpent : 0;
  const providerCalls = walkCalls + reconCalls;
  const duplicates =
    (sweep?.last.pages.reduce((n, p) => n + p.duplicateCount, 0) ?? 0) +
    (sweep?.next.pages.reduce((n, p) => n + p.duplicateCount, 0) ?? 0);
  const eventsObserved =
    (sweep?.last.pages.reduce((n, p) => n + p.eventCount, 0) ?? 0) +
    (sweep?.next.pages.reduce((n, p) => n + p.eventCount, 0) ?? 0);
  const lastQuota = sweep ? sweep.next.quotaRemaining ?? sweep.last.quotaRemaining : null;

  return {
    team: options.teamId,
    uniqueTournament: options.uniqueTournamentId,
    season: options.seasonId,
    pagesLast: sweep ? sweep.last.pages.map((p) => p.page) : [],
    pagesNext: sweep ? sweep.next.pages.map((p) => p.page) : [],
    eventsObserved,
    distinctEventIds: spineEvents.length,
    fixturesCreated: fixtures.inserted,
    fixturesReused: fixtures.updated,
    duplicatesSuppressed: duplicates,
    teamRegistrationsCreated: registrations.inserted,
    resultsWritten: results.written,
    lifecycleTransitions: transitions.written,
    reconciliationMatches: recon ? recon.counts.presentBoth : 0,
    missingFromSpine: recon ? recon.counts.missingFromSpine : 0,
    spineOnly: recon ? recon.counts.spineOnly : 0,
    identityMismatches: recon ? recon.counts.identityMismatches : 0,
    dateDiscrepancies: recon ? recon.counts.dateDiscrepancies : 0,
    statusDiscrepancies: recon ? recon.counts.statusDiscrepancies : 0,
    unknownStatusCount: spineEvents.filter((event) => event.lifecycleState === 'UNKNOWN').length,
    quarantinedEvents: quarantined,
    failures: runStatus === 'HARD_STOP' ? 1 : 0,
    providerCalls,
    providerBudget: options.maxCalls,
    budgetRemaining: lastQuota ?? Math.max(0, options.maxCalls - providerCalls),
    moduleWrites: 0,
    featureWrites: 0,
    snapshotWrites: 0,
    calibrationWrites: 0,
    runStatus,
    hardStopReason,
    resumeFromPage: sweep ? sweep.last.resumeFromPage ?? sweep.next.resumeFromPage : null,
    anomalies: recon ? recon.anomalies : [],
  };
}
