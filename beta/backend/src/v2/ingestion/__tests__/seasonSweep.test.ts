// ─────────────────────────────────────────────────────────────────────────────
// B-1 — THE SEASON SWEEP, WIRED
//
// The pager and the writer both existed and were both proven; nothing joined
// them, so the season feed had no production caller and the only wired path was
// `/schedule/{date}`, which carries every competition playing that day.
//
// These pin the join itself: that pager output reaches the REAL writer, that the
// schedule path still reaches the SAME writer, that one budget covers the whole
// sweep, that an event outside the requested season is refused rather than
// imported, and that `/schedule/{date}` is never touched by a season sweep.
//
// No provider, no network. The captured Brasileirão evidence is the fixture for
// the integration half; a hand-built source drives the unit half so a payload
// the captures do not contain — an event from another season — can be tested.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import { parseArguments, DEFAULT_SEASON_MAX_CALLS, type Arguments } from '../cli';
import { ingestEvents, ingestScheduleDate } from '../stages/schedule';
import { ingestSeason } from '../pipeline';
import { sweepSeason, type EventPageSource } from '../provider/pager';
import { ProviderRequestError, type ProviderObservation } from '../provider/client';
import type { EndpointKey } from '../provider/endpoints';
import type { ProviderClient } from '../provider/client';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { BRASILEIRAO, capturedSource, hasEvidence, tally } from './support/replay';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const runnable = hasDatabase && hasEvidence();

// ─────────────────────────────────────────────────────────────────────────────
// The CLI window — explicit, required, validated before any call
// ─────────────────────────────────────────────────────────────────────────────

const season = (argv: readonly string[]): Extract<Arguments, { command: 'season' }> => {
  const args = parseArguments(argv);
  assert.equal(args.command, 'season');
  return args as Extract<Arguments, { command: 'season' }>;
};

const FULL = [
  'season',
  '--tournament', '325',
  '--season', '87678',
  '--from', '2026-05-31',
  '--to', '2026-08-11',
];

describe('B-1 · the season CLI states its own scope', () => {
  it('1. every scope flag is required — no defaulted competition or window', () => {
    // A sweep with a defaulted window is a sweep whose scope nobody stated. The
    // refusal is here, BEFORE a provider call, not after one.
    for (const omit of ['--tournament', '--season', '--from', '--to']) {
      const argv = FULL.filter((token, index) => token !== omit && FULL[index - 1] !== omit);
      assert.throws(() => parseArguments(argv), new RegExp(`\\${omit} is required`), omit);
    }
  });

  it('2. the window reaches the parsed arguments as given', () => {
    const args = season(FULL);
    assert.equal(args.competitionProviderId, '325');
    assert.equal(args.seasonProviderId, '87678');
    assert.equal(args.from.toISOString(), '2026-05-31T00:00:00.000Z');
    assert.equal(args.to.toISOString(), '2026-08-11T00:00:00.000Z');
  });

  it('3. an inverted range is refused before anything is fetched', () => {
    assert.throws(
      () => parseArguments(['season', '--tournament', '325', '--season', '87678', '--from', '2026-08-11', '--to', '2026-05-31']),
      /precedes/
    );
  });

  it('4. a malformed date is refused', () => {
    assert.throws(
      () => parseArguments([...FULL.slice(0, -1), 'August']),
      /expects YYYY-MM-DD/
    );
  });

  it('5. --max-calls is the whole sweep budget, and defaults sanely', () => {
    assert.equal(season(FULL).maxCalls, DEFAULT_SEASON_MAX_CALLS);
    assert.equal(season([...FULL, '--max-calls', '4']).maxCalls, 4);
    assert.throws(() => parseArguments([...FULL, '--max-calls', '0']), /at least 1/);
    assert.throws(() => parseArguments([...FULL, '--max-calls', 'lots']), /whole number/);
  });

  it('5a. --with-standings is OFF unless asked, and does not eat the next flag', () => {
    assert.equal(season(FULL).withStandings, false, 'default OFF');
    assert.equal(season([...FULL, '--with-standings']).withStandings, true);
    // A standalone flag must not consume the token after it.
    const mid = season(['season', '--tournament', '325', '--with-standings',
      '--season', '87678', '--from', '2026-05-31', '--to', '2026-08-11']);
    assert.equal(mid.withStandings, true);
    assert.equal(mid.seasonProviderId, '87678');
    assert.equal(mid.maxCalls, DEFAULT_SEASON_MAX_CALLS);
  });

  it('6. `season` does not disturb the existing commands', () => {
    assert.equal(parseArguments([]).command, 'schedule');
    assert.equal(parseArguments(['--date', '2026-08-01']).command, 'schedule');
    assert.equal(parseArguments(['squads']).command, 'squads');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The budget is shared across both directions
// ─────────────────────────────────────────────────────────────────────────────

/** A source that always answers, so a walk stops only on budget or window. */
function endlessSource(): EventPageSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getObserved<T>(key: EndpointKey, params: Record<string, string | number>) {
      calls.push(`${key}/${params.page}`);
      const base = 1780185600 + Number(params.page) * 86_400;
      return {
        endpointKey: key,
        path: '(stub)',
        url: '(stub)',
        parameters: params,
        status: 200,
        attempts: 1,
        quotaRemaining: 97 - calls.length,
        data: {
          data: {
            hasNextPage: true,
            events: [
              {
                id: `${key}-${params.page}`,
                startTimestamp: base,
                tournament: { id: 83, uniqueTournament: { id: 325, name: 'X' } },
                season: { id: 87678, year: '2026' },
                homeTeam: { id: 1, name: 'H' },
                awayTeam: { id: 2, name: 'A' },
                status: { code: 0, description: 'Not started' },
              },
            ],
          },
        } as T,
      } as ProviderObservation<T>;
    },
  };
}

describe('B-1 · one budget covers the whole sweep', () => {
  it('7. `last` spends first and `next` receives only the remainder', async () => {
    const source = endlessSource();
    const { last, next } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 5 });
    assert.equal(last.callsSpent + next.callsSpent, 5, 'the budget is shared, not per direction');
    assert.equal(last.stoppedBecause, 'BUDGET_EXHAUSTED');
    assert.equal(next.callsSpent, 0, 'the historical half is bounded by a date floor and goes first');
    assert.equal(source.calls.length, 5);
  });

  it('8. a budget of zero makes no call at all', async () => {
    const source = endlessSource();
    const { last, next } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 0 });
    assert.deepEqual(source.calls, []);
    assert.equal(last.callsSpent + next.callsSpent, 0);
  });

  it('9. quota remaining is carried from the provider, never computed', async () => {
    const source = endlessSource();
    const { last } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 3 });
    assert.equal(last.quotaRemaining, 94, 'the last figure the provider actually reported');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One writer, two feeds — and a scope that cannot widen
// ─────────────────────────────────────────────────────────────────────────────

describe('B-1 · writer sharing and endpoint discipline (requires a V2 database)', { skip: !runnable }, () => {
  async function scenario(fn: (tx: PoolClient) => Promise<void>): Promise<void> {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      await tx.query('BEGIN');
      try {
        await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  const event = (id: string, competition: number, seasonId: number): Record<string, unknown> => ({
    id: `B1-${id}`,
    startTimestamp: Math.floor(Date.UTC(2026, 6, 20, 18, 0) / 1000),
    // A DISTINCT NAME PER COMPETITION. `resolveCompetition` slugifies the name
    // and `uq_competition__slug` is unique, so two provider ids sharing a name
    // collide — a property of the fixture, not of the writer.
    tournament: {
      id: 83,
      uniqueTournament: { id: competition, name: `B1 League ${competition}`, category: { name: 'Brazil' } },
    },
    season: { id: seasonId, name: `Season ${seasonId}`, year: '2026' },
    roundInfo: { round: 1 },
    venue: { id: 'B1-V', name: 'B1 Arena', city: { name: 'Rio' }, country: { name: 'Brazil' } },
    homeTeam: { id: 'B1-H', name: 'B1 Home', country: { name: 'Brazil' } },
    awayTeam: { id: 'B1-A', name: 'B1 Away', country: { name: 'Brazil' } },
    status: { code: 100, description: 'Ended' },
    winnerCode: 1,
    homeScore: { current: 1, normaltime: 1, period1: 0 },
    awayScore: { current: 0, normaltime: 0, period1: 0 },
  });

  it('10. an event outside the requested season is REJECTED, not imported', async () => {
    await scenario(async (tx) => {
      const counts = await ingestEvents(
        tx,
        [
          event('IN', 325, 87678),      // the requested scope
          event('OTHER-SEASON', 325, 72034),
          event('OTHER-COMP', 999, 87678),
        ],
        { label: 'scope', scope: { competitionProviderId: '325', seasonProviderId: '87678' } }
      );

      const { rows } = await tx.query<{ ext: string }>(
        `SELECT provider_external_id AS ext FROM football.fixture
          WHERE provider_external_id LIKE 'B1-%' ORDER BY 1`
      );
      assert.deepEqual(rows.map((row) => row.ext), ['B1-IN'], 'only the in-scope fixture was written');
      assert.ok(counts.total.rejected >= 2, 'and both refusals are counted');

      const { rows: editions } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM football.competition_edition
          WHERE provider_external_id IN ('72034','87678')`
      );
      assert.equal(editions[0].n, '1', 'no edition was created for the out-of-scope season');
    });
  });

  it('11. without a scope the same writer accepts everything — the schedule feed is date-scoped', async () => {
    await scenario(async (tx) => {
      await ingestEvents(tx, [event('IN', 325, 87678), event('OTHER-COMP', 999, 55555)], {
        label: 'no scope',
      });
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM football.fixture WHERE provider_external_id LIKE 'B1-%'`
      );
      assert.equal(rows[0].n, '2', 'both written — a date carries every competition playing');
    });
  });

  it('12. the schedule path reaches the SAME writer, and still works', async () => {
    // `ingestScheduleDate` is now fetch-then-`ingestEvents`. If it had grown its
    // own writer this would still pass — so the assertion that matters is the
    // one below it, on the source.
    await scenario(async (tx) => {
      const client = {
        async get() {
          return { events: [event('SCHED', 325, 87678)] };
        },
      } as unknown as ProviderClient;
      const counts = await ingestScheduleDate(tx, client, '2026-07-20');
      assert.ok(counts.byRelation.has('football.fixture'));

      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM football.fixture WHERE provider_external_id = 'B1-SCHED'`
      );
      assert.equal(rows[0].n, '1');
    });
  });

  it('13. there is ONE writer: the schedule stage delegates rather than duplicating', () => {
    // Structural, and deliberately so. Two writers would both pass every
    // behavioural test above and diverge on the next rule someone adds to one.
    const source = readFileSync(resolve(__dirname, '..', 'stages', 'schedule.ts'), 'utf8');
    const scheduleBody = source.slice(source.indexOf('export async function ingestScheduleDate'));
    assert.match(scheduleBody, /return ingestEvents\(/, 'the date path delegates to the shared writer');
    assert.equal(
      (source.match(/for \(const raw of events\)/g) ?? []).length,
      1,
      'exactly one event loop exists in this file'
    );
  });

  it('14. a season sweep reads only the season endpoints — never /schedule/{date}', async () => {
    await scenario(async (tx) => {
      const source = capturedSource();
      const { last, next } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 10 });
      await ingestEvents(tx, [...last.events, ...next.events].map((e) => e.raw), {
        label: 'season',
        scope: { competitionProviderId: '325', seasonProviderId: '87678' },
      });

      assert.deepEqual(
        source.calls.map((call) => call.key),
        [
          'tournament_season_events_last',
          'tournament_season_events_last',
          'tournament_season_events_last',
          'tournament_season_events_next',
        ],
        'four season-feed reads, and nothing else'
      );
      assert.ok(!source.calls.some((call) => call.key === 'schedule'));
    });
  });

  it('15. pager output reaches the writer and produces the proven universe', async () => {
    await scenario(async (tx) => {
      const { last, next } = await sweepSeason(capturedSource(), { ...BRASILEIRAO, callBudget: 10 });
      const selected = [...last.events, ...next.events];
      assert.equal(selected.length, 47);

      await ingestEvents(tx, selected.map((e) => e.raw), {
        label: 'season',
        scope: { competitionProviderId: '325', seasonProviderId: '87678' },
      });

      const counted = await tally(tx);
      assert.equal(counted.fixtures, 47);
      assert.equal(counted.completed, 43);
      assert.equal(counted.postponed, 4);
      assert.equal(counted.results, 43);
      assert.equal(counted.editions, 1);
    });
  });

  it('16. a repeated season sweep is idempotent', async () => {
    await scenario(async (tx) => {
      const run = async () => {
        const { last, next } = await sweepSeason(capturedSource(), { ...BRASILEIRAO, callBudget: 10 });
        await ingestEvents(tx, [...last.events, ...next.events].map((e) => e.raw), {
          label: 'season',
          scope: { competitionProviderId: '325', seasonProviderId: '87678' },
        });
      };
      await run();
      const first = await tally(tx);
      await run();
      assert.deepEqual(await tally(tx), first, 'a second sweep changes nothing');
      assert.equal(first.transitions, 47, 'and fabricates no transitions');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The operational lifecycle
//
// These call `ingestSeason` for real, so they COMMIT — `withPipelineRun` and
// `withRun` manage their own connections and cannot be wrapped in a test's
// rolled-back transaction. They therefore use a competition and season nobody
// else touches, and clean up after themselves.
// ─────────────────────────────────────────────────────────────────────────────

describe('B-1 · operational lifecycle (requires a V2 database)', { skip: !hasDatabase }, () => {
  const COMPETITION = '90325';
  const SEASON = '90678';
  const WINDOW = { from: new Date('2026-05-31T00:00:00Z'), to: new Date('2026-08-11T00:00:00Z') };

  after(async () => {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      // Superuser in the scratch cluster; a no-op where the grant is absent.
      await tx.query(
        `DELETE FROM football.fixture WHERE provider_external_id LIKE 'OPS-%'`
      ).catch(() => undefined);
    });
  });

  /** One page, one in-window event, `hasNextPage: false` so the walk ends cleanly. */
  function oneSeasonPage(options: { throwOn?: 'last' } = {}) {
    let calls = 0;
    const seen: string[] = [];
    return {
      get calls() {
        return calls;
      },
      seen,
      // `get` is what the standings stage calls; `getObserved` is the pager's.
      // Both record the endpoint, so a test can assert exactly what was reached.
      async get<T>(key: EndpointKey) {
        calls += 1;
        seen.push(key);
        return {
          standings: [
            {
              teamId: 'OPS-H', position: 1, played: 1, won: 1, drawn: 0, lost: 0,
              goalsFor: 2, goalsAgainst: 1, points: 3,
            },
          ],
        } as T;
      },
      async getObserved<T>(key: EndpointKey, params: Record<string, string | number>) {
        calls += 1;
        seen.push(key);
        if (options.throwOn === 'last' && key === 'tournament_season_events_last') {
          throw new ProviderRequestError('upstream exploded', key, 500, 4);
        }
        return {
          endpointKey: key,
          path: '(stub)',
          url: '(stub)',
          parameters: params,
          status: 200,
          attempts: 1,
          quotaRemaining: 91,
          data: {
            data: {
              hasNextPage: false,
              events:
                key === 'tournament_season_events_last'
                  ? [
                      {
                        id: 'OPS-1',
                        startTimestamp: Math.floor(Date.UTC(2026, 6, 20, 18, 0) / 1000),
                        tournament: {
                          id: 83,
                          uniqueTournament: {
                            id: Number(COMPETITION),
                            name: 'Ops League',
                            category: { name: 'Brazil' },
                          },
                        },
                        season: { id: Number(SEASON), name: 'Ops 2026', year: '2026' },
                        roundInfo: { round: 1 },
                        venue: { id: 'OPS-V', name: 'Ops Arena', city: { name: 'Rio' }, country: { name: 'Brazil' } },
                        homeTeam: { id: 'OPS-H', name: 'Ops Home', country: { name: 'Brazil' } },
                        awayTeam: { id: 'OPS-A', name: 'Ops Away', country: { name: 'Brazil' } },
                        status: { code: 100, description: 'Ended' },
                        winnerCode: 1,
                        homeScore: { current: 2, normaltime: 2, period1: 1 },
                        awayScore: { current: 1, normaltime: 1, period1: 0 },
                      },
                    ]
                  : [],
            },
          } as T,
        } as ProviderObservation<T>;
      },
      async flushUsage() {
        return 0;
      },
    } as unknown as ProviderClient;
  }

  const runsFor = async (outcome: string): Promise<number> => {
    const { rows } = await withConnection('pt_pipeline_ingestion', (tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM operations.pipeline_run r
           LEFT JOIN operations.pipeline_run_completion c
             ON c.pipeline_run_id = r.id AND c.run_occurred_at = r.occurred_at
          WHERE r.run_key = 'v2.ingest.season' AND coalesce(c.outcome, r.outcome) = $1`,
        [outcome]
      )
    );
    return Number(rows[0].n);
  };

  it('17. a successful sweep opens a run, a job, write records, and completes', async () => {
    const before = await runsFor('SUCCEEDED');

    const report = await ingestSeason({
      competitionProviderId: COMPETITION,
      seasonProviderId: SEASON,
      ...WINDOW,
      maxCalls: 4,
      client: oneSeasonPage(),
    });

    assert.equal(report.failed, false);
    assert.equal(report.eventsRead, 1);
    assert.equal(report.eventsSelected, 1);
    assert.equal(report.callsSpent, 2, 'one page each direction, both hasNextPage:false');
    assert.equal(report.quotaRemaining, 91, 'carried from the provider');
    assert.equal(report.editionsForSeason, 1, 'the F-1 assertion, made from the database');
    assert.ok(report.competitionEditionId);
    assert.deepEqual(report.window, { from: '2026-05-31', to: '2026-08-11' });
    // `next` returns no events at all, so the pager's defensive EMPTY_PAGE stop
    // fires before it reads `hasNextPage`. Both terminations are recorded per
    // direction, which is what an operator needs to tell "the feed ended" from
    // "the budget ran out".
    assert.deepEqual(
      report.directions.map((d) => `${d.direction}:${d.stoppedBecause}`),
      ['last:HAS_NEXT_PAGE_FALSE', 'next:EMPTY_PAGE']
    );

    assert.equal(await runsFor('SUCCEEDED'), before + 1, 'the run completed');

    await withConnection('pt_pipeline_ingestion', async (tx) => {
      const { rows: jobs } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.pipeline_job_run WHERE job_key = 'ingest.season'`
      );
      assert.ok(Number(jobs[0].n) >= 1, 'a job run was recorded');

      const { rows: scope } = await tx.query<{ scope_text: string }>(
        `SELECT scope_text FROM operations.pipeline_run
          WHERE run_key = 'v2.ingest.season' ORDER BY occurred_at DESC LIMIT 1`
      );
      assert.match(scope[0].scope_text, /competition 90325 season 90678 2026-05-31\.\.2026-08-11/);

      const { rows: writes } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM operations.write_record
          WHERE target_schema_name = 'football' AND target_relation_name = 'fixture'`
      );
      assert.ok(Number(writes[0].n) >= 1, 'per-relation write records were attributed');
    });
  });

  it('17a. WITHOUT the flag, the proven sweep is untouched — no standings call', async () => {
    const source = oneSeasonPage();
    const report = await ingestSeason({
      competitionProviderId: COMPETITION,
      seasonProviderId: SEASON,
      ...WINDOW,
      maxCalls: 4,
      client: source,
    });

    assert.equal(report.standingsRequested, false);
    assert.equal(report.standingsAsOfOn, null);
    assert.equal(report.standingsCounts, null);
    assert.deepEqual(
      (source as unknown as { seen: string[] }).seen,
      ['tournament_season_events_last', 'tournament_season_events_next'],
      'the season feed only — season_standings is never reached'
    );
    assert.equal(report.callsSpent, 2);
  });

  it('17b. WITH the flag, exactly one season_standings call is added', async () => {
    const source = oneSeasonPage();
    const report = await ingestSeason({
      competitionProviderId: COMPETITION,
      seasonProviderId: SEASON,
      ...WINDOW,
      maxCalls: 4,
      withStandings: true,
      client: source,
    });

    const seen = (source as unknown as { seen: string[] }).seen;
    assert.equal(
      seen.filter((key) => key === 'season_standings').length,
      1,
      'exactly one standings call'
    );
    assert.equal(report.standingsRequested, true);
    assert.match(report.standingsAsOfOn ?? '', /^\d{4}-\d{2}-\d{2}$/, 'a UTC calendar date');
    assert.equal(report.callsSpent, seen.length, 'the standings call is counted in the spend');
  });

  it('17c. the run ledger records that standings were requested', async () => {
    await ingestSeason({
      competitionProviderId: COMPETITION,
      seasonProviderId: SEASON,
      ...WINDOW,
      maxCalls: 4,
      withStandings: true,
      client: oneSeasonPage(),
    });

    const { rows } = await withConnection('pt_pipeline_ingestion', (tx) =>
      tx.query<{ scope_text: string }>(
        `SELECT scope_text FROM operations.pipeline_run
          WHERE run_key = 'v2.ingest.season' ORDER BY occurred_at DESC LIMIT 1`
      )
    );
    // Auditable from the ledger alone: an enabled standings ingestion must not
    // be invisible to anyone reading the run afterwards.
    assert.match(rows[0].scope_text, /\+standings@\d{4}-\d{2}-\d{2}/);
  });

  it('18. a failing sweep is recorded as failed, not silently swallowed', async () => {
    const before = await runsFor('FAILED');

    await assert.rejects(
      () =>
        ingestSeason({
          competitionProviderId: COMPETITION,
          seasonProviderId: SEASON,
          ...WINDOW,
          maxCalls: 4,
          client: oneSeasonPage({ throwOn: 'last' }),
        }),
      /upstream exploded/
    );

    assert.equal(await runsFor('FAILED'), before + 1, 'the failure reached the run ledger');
  });

  it('19. an invalid window is refused before the run is opened', async () => {
    const before = await runsFor('SUCCEEDED');
    await assert.rejects(
      () =>
        ingestSeason({
          competitionProviderId: COMPETITION,
          seasonProviderId: SEASON,
          from: WINDOW.to,
          to: WINDOW.from,
          maxCalls: 4,
          client: oneSeasonPage(),
        }),
      /precedes its start/
    );
    assert.equal(await runsFor('SUCCEEDED'), before, 'no run was opened for a refused configuration');
  });
});

// ONE shutdown hook for the whole file. Two `after` blocks each calling
// closeAllPools() is a race: the first fires when its own describe ends and
// refuses connections to the next one, which is exactly the guard's job.
after(async () => {
  await closeAllPools();
});
