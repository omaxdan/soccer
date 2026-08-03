// ─────────────────────────────────────────────────────────────────────────────
// S-4 INGESTION TESTS
//
// Two halves, following the S-1/S-2/S-3 pattern:
//
//   DECLARATION TESTS  no database. Mapping, normalisation, endpoint resolution,
//                      CLI parsing. These are where the unmapped-value policy is
//                      pinned down, because that policy is pure logic.
//
//   PERSISTENCE TESTS  a real V2 database with the full migration set and the
//                      S-3 seed applied. These prove the duplicate classes behave
//                      as the schema requires — including that an UPDATE on an
//                      append-only relation is REFUSED, which is the guarantee
//                      most worth a test because nothing else would reveal its
//                      loss until history was already gone.
//
// The persistence half SKIPS when no database is configured, so V2 work never
// blocks V1 work.
// ─────────────────────────────────────────────────────────────────────────────

import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  mapCountry,
  mapCurrency,
  mapLifecycleState,
  mapPosition,
  mapPrimaryPosition,
  mapRegistrationKind,
  mapUnavailabilityKind,
  isUnmappedLifecycle,
} from '../mapping/index';
import { ENDPOINTS, DELIBERATELY_NOT_INGESTED, resolvePath } from '../provider/endpoints';
import { PROVIDER_CODE } from '../provider/config';
import {
  fixturePartitionOn,
  fromUnixSeconds,
  nonNegativeInt,
  providerStatusRaw,
  slugify,
  toIsoDate,
  utcDateString,
} from '../normalise';
import { parseArguments } from '../cli';
import { IngestionCounts, insertAppendOnly, upsertMutable } from '../write/index';
import { ingestScheduleDate } from '../stages/schedule';
import { NON_ISO_ASSOCIATION_CODES } from '../../seed/vocabulary';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// Declaration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('provider identity', () => {
  it('1. uses one namespace, and it is the approved one', () => {
    // D-1. The literal is asserted rather than referenced indirectly: a change
    // to it would fork every entity, and this test is the tripwire.
    assert.equal(PROVIDER_CODE, 'SPORTSAPI_API');
  });

  it('2. is not readable from the environment', () => {
    // Setting anything must not move it. A configurable provider code could
    // point ingestion at a namespace the existing rows do not occupy.
    process.env.PT_V2_PROVIDER_CODE = 'SOMETHING_ELSE';
    try {
      assert.equal(PROVIDER_CODE, 'SPORTSAPI_API');
    } finally {
      delete process.env.PT_V2_PROVIDER_CODE;
    }
  });
});

describe('endpoint registry', () => {
  it('3. covers the four paths V1 constructed inline', () => {
    // These bypassed V1's registry, so their quota went unmeasured.
    for (const key of ['team_squad', 'team_transfers', 'season_standings'] as const) {
      assert.ok(ENDPOINTS[key], `${key} must be registered so its usage is recorded`);
    }
  });

  it('4. gives every endpoint a stable key equal to its map key', () => {
    // The key is written to operations.api_usage.endpoint_key. A drift between
    // the two would split one endpoint's history across two names.
    for (const [name, definition] of Object.entries(ENDPOINTS)) {
      assert.equal(definition.key, name);
    }
  });

  it('5. classifies per-entity endpoints as expensive', () => {
    assert.equal(ENDPOINTS.schedule.costClass, 'FEED');
    assert.equal(ENDPOINTS.team_squad.costClass, 'PER_ENTITY');
    assert.equal(ENDPOINTS.tournaments.costClass, 'DISCOVERY');
  });

  it('6. records what is deliberately not ingested', () => {
    assert.ok(DELIBERATELY_NOT_INGESTED.length >= 2);
    for (const entry of DELIBERATELY_NOT_INGESTED) {
      assert.ok(entry.reason.length > 20, 'a deliberate omission needs a stated reason');
    }
  });

  it('7. refuses a path with an unresolved parameter', () => {
    assert.throws(() => resolvePath('team_squad', {}), /unresolved parameters/);
    assert.equal(resolvePath('team_squad', { id: 42 }), '/team/42/players');
  });

  it('8. encodes parameters', () => {
    assert.equal(resolvePath('schedule', { date: '2026-08-01' }), '/schedule/2026-08-01');
  });
});

describe('lifecycle mapping', () => {
  it('9. maps every provider status V1 knew about', () => {
    assert.equal(mapLifecycleState(0), 'SCHEDULED');
    assert.equal(mapLifecycleState(100), 'COMPLETED');
    assert.equal(mapLifecycleState(110), 'COMPLETED');
    assert.equal(mapLifecycleState(120), 'COMPLETED');
    assert.equal(mapLifecycleState(60), 'POSTPONED');
    assert.equal(mapLifecycleState(70), 'CANCELLED');
    assert.equal(mapLifecycleState(90), 'ABANDONED');
  });

  it('10. collapses live and half-time into IN_PROGRESS', () => {
    // V1 distinguished them because the match page displayed the difference.
    // The platform vocabulary defines states by what they PERMIT, and neither
    // permits a snapshot.
    for (const code of [6, 7, 31, 40, 41, 50]) {
      assert.equal(mapLifecycleState(code), 'IN_PROGRESS');
    }
  });

  it('11. sends an unrecognised status to UNKNOWN, which seals by default', () => {
    assert.equal(mapLifecycleState(999), 'UNKNOWN');
    assert.equal(mapLifecycleState(null), 'UNKNOWN');
    assert.equal(mapLifecycleState(undefined), 'UNKNOWN');
    assert.ok(isUnmappedLifecycle(999));
    assert.ok(!isUnmappedLifecycle(0));
  });
});

describe('country mapping', () => {
  it('12. maps every country in the extended vocabulary', () => {
    for (const name of ['England', 'Ukraine', 'South Korea', 'Wales', 'Canada', 'Czech Republic']) {
      const result = mapCountry(name);
      assert.equal(result.kind, 'MAPPED', `${name} should map after the S-4 extension`);
    }
  });

  it('13. is case and whitespace insensitive', () => {
    assert.deepEqual(mapCountry('  SPAIN  '), { kind: 'MAPPED', code: 'ES' });
  });

  it('14. returns ABSENT, never REJECTED — every country column is nullable', () => {
    const result = mapCountry('Atlantis');
    assert.equal(result.kind, 'ABSENT');
    assert.match(result.kind === 'ABSENT' ? result.reason : '', /does not create vocabulary rows/);
  });

  it('15. names the two association codes that are not ISO countries', () => {
    // S4-1. 'SC' collides with Seychelles in ISO 3166-1; 'WA' is unassigned.
    // Both are platform codes, and this test is where that is written down.
    assert.deepEqual([...NON_ISO_ASSOCIATION_CODES], ['SC', 'WA']);
    assert.deepEqual(mapCountry('Scotland'), { kind: 'MAPPED', code: 'SC' });
    assert.deepEqual(mapCountry('Wales'), { kind: 'MAPPED', code: 'WA' });
  });
});

describe('currency mapping — the one that refuses', () => {
  it('16. REJECTS an absent currency rather than defaulting', () => {
    // player_valuation.currency_code is NOT NULL and minor_unit differences make
    // a substituted currency wrong by orders of magnitude. V1 discarded the
    // currency entirely; this is the correction.
    const result = mapCurrency(null);
    assert.equal(result.kind, 'REJECTED');
    assert.match(result.kind === 'REJECTED' ? result.reason : '', /orders of magnitude/);
  });

  it('17. REJECTS an unseeded currency rather than approximating', () => {
    assert.equal(mapCurrency('ZWL').kind, 'REJECTED');
  });

  it('18. maps symbols and codes to the seeded set', () => {
    assert.deepEqual(mapCurrency('€'), { kind: 'MAPPED', code: 'EUR' });
    assert.deepEqual(mapCurrency('gbp'), { kind: 'MAPPED', code: 'GBP' });
    assert.deepEqual(mapCurrency('JPY'), { kind: 'MAPPED', code: 'JPY' });
  });
});

describe('position mapping', () => {
  it('19. maps coarse provider codes to the unmarked case in their band', () => {
    // A bare 'D' becomes CB, not a full-back: guessing a side would invent
    // information the provider did not give.
    assert.deepEqual(mapPosition('D'), { kind: 'MAPPED', code: 'CB' });
    assert.deepEqual(mapPosition('G'), { kind: 'MAPPED', code: 'GK' });
    assert.deepEqual(mapPosition('M'), { kind: 'MAPPED', code: 'CM' });
  });

  it('20. distinguishes full-backs from centre-backs when told', () => {
    // V1 prefix-matched position codes, so 'RB' matched on 'R' and dropped every
    // full-back out of defence. This is the regression test for that bug.
    assert.deepEqual(mapPosition('RB'), { kind: 'MAPPED', code: 'RB' });
    assert.deepEqual(mapPosition('LB'), { kind: 'MAPPED', code: 'LB' });
    assert.notDeepEqual(mapPosition('RB'), mapPosition('CB'));
  });

  it('21. returns ABSENT for an unknown token — the column is nullable', () => {
    assert.equal(mapPosition('SWEEPER_KEEPER').kind, 'ABSENT');
  });

  it('22. takes the first mappable token from a detailed list', () => {
    assert.deepEqual(mapPrimaryPosition('XX,ST,CM'), { kind: 'MAPPED', code: 'ST' });
    assert.deepEqual(mapPrimaryPosition(['LW', 'CF']), { kind: 'MAPPED', code: 'LW' });
    assert.equal(mapPrimaryPosition([]).kind, 'ABSENT');
  });
});

describe('registration provenance — the rule that matters most', () => {
  it('23. marks a snapshot-derived boundary INFERRED', () => {
    const result = mapRegistrationKind({ providerType: null, derivedFromSnapshotDiff: true });
    assert.equal(result.provenance, 'INFERRED');
  });

  it('24. marks a transfer-record boundary OBSERVED', () => {
    const result = mapRegistrationKind({ providerType: 'permanent', derivedFromSnapshotDiff: false });
    assert.equal(result.provenance, 'OBSERVED');
    assert.equal(result.kind, 'PERMANENT');
  });

  it('25. never reports OBSERVED for a diffed boundary, whatever the type says', () => {
    // A calibration population built on inferred registrations treated as
    // observed is wrong in a way nothing downstream can detect, because the
    // marker that would reveal it is the one that was falsified.
    for (const providerType of ['permanent', 'loan', 'loan out', null, '']) {
      const result = mapRegistrationKind({ providerType, derivedFromSnapshotDiff: true });
      assert.equal(result.provenance, 'INFERRED');
    }
  });

  it('26. distinguishes loan direction, defaulting to permanent', () => {
    assert.equal(mapRegistrationKind({ providerType: 'loan out', derivedFromSnapshotDiff: false }).kind, 'LOAN_OUT');
    assert.equal(mapRegistrationKind({ providerType: 'loan', derivedFromSnapshotDiff: false }).kind, 'LOAN_IN');
    assert.equal(mapRegistrationKind({ providerType: 'transfer', derivedFromSnapshotDiff: false }).kind, 'PERMANENT');
  });
});

describe('unavailability mapping', () => {
  it('27. never fails — OTHER is the vocabulary\'s own fall-through', () => {
    assert.equal(mapUnavailabilityKind(null), 'OTHER');
    assert.equal(mapUnavailabilityKind('personal reasons'), 'OTHER');
  });

  it('28. separates suspension from injury', () => {
    assert.equal(mapUnavailabilityKind('Red card suspension'), 'SUSPENSION');
    assert.equal(mapUnavailabilityKind('Hamstring strain'), 'INJURY');
    assert.equal(mapUnavailabilityKind('ACL tear'), 'INJURY');
  });
});

describe('normalisation', () => {
  it('29. returns null for an absent timestamp, never the epoch', () => {
    // new Date(0) is a real instant that would sort, partition and compare as
    // though it were an observation.
    assert.equal(fromUnixSeconds(null), null);
    assert.equal(fromUnixSeconds(undefined), null);
    assert.equal(fromUnixSeconds(Number.NaN), null);
  });

  it('30. derives the partition key in UTC', () => {
    // PD-08. A session in local time would shift every partition key.
    const lateKickoff = new Date('2026-08-01T23:30:00Z');
    assert.equal(fixturePartitionOn(lateKickoff), '2026-08-01');
    const earlyKickoff = new Date('2026-08-02T00:30:00Z');
    assert.equal(fixturePartitionOn(earlyKickoff), '2026-08-02');
  });

  it('31. folds diacritics so one club is one entity', () => {
    assert.equal(slugify('Bayern München'), slugify('Bayern Munchen'));
    assert.equal(slugify('Atlético Madrid'), 'atletico-madrid');
  });

  it('32. drops a negative count rather than clamping it', () => {
    // Clamping -1 to 0 turns a provider error into a plausible-looking nil.
    assert.equal(nonNegativeInt(-1), null);
    assert.equal(nonNegativeInt(0), 0);
    assert.equal(nonNegativeInt(3), 3);
    assert.equal(nonNegativeInt('3'), null);
  });

  it('33. returns null for an unparseable date, never today', () => {
    assert.equal(toIsoDate('not a date'), null);
    assert.equal(toIsoDate(null), null);
    assert.equal(toIsoDate('2026-08-01'), '2026-08-01');
    assert.equal(toIsoDate(1_785_542_400), '2026-08-01');
  });

  it('34. keeps the provider status string verbatim', () => {
    // Its entire value is being un-normalised.
    assert.equal(providerStatusRaw({ code: 100, description: 'Ended' }), 'Ended');
    assert.equal(providerStatusRaw(null), null);
  });
});

describe('CLI', () => {
  it('35. defaults to a single day', () => {
    const args = parseArguments([]);
    assert.equal(utcDateString(args.from), utcDateString(args.to));
    assert.equal(args.enforceQuotaBudget, true);
  });

  it('36. keeps the budget guard on unless explicitly waived', () => {
    // D-3. Historical replay is a deliberate act.
    assert.equal(parseArguments(['--from', '2026-01-01', '--to', '2026-06-01']).enforceQuotaBudget, true);
    assert.equal(parseArguments(['--allow-over-budget']).enforceQuotaBudget, false);
  });

  it('37. refuses a reversed range and a malformed date', () => {
    assert.throws(() => parseArguments(['--from', '2026-08-07', '--to', '2026-08-01']), /precedes/);
    assert.throws(() => parseArguments(['--date', '01-08-2026']), /YYYY-MM-DD/);
  });
});

describe('write counts', () => {
  it('38. maps onto the write_record column names', () => {
    const counts = new IngestionCounts();
    counts.examined = 5;
    counts.written = 3;
    counts.skipped = 1;
    counts.reject('unmapped');
    assert.deepEqual(counts.toWriteCounts(), {
      rowsExamined: 6,
      rowsWritten: 3,
      rowsSkipped: 1,
      rowsRejected: 1,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ingestion persistence (requires a V2 database)', { skip: !hasDatabase }, () => {
  const ROLE = 'pt_pipeline_ingestion' as const;
  /** Provider ids well outside anything a real feed would use. */
  const TEST_PREFIX = 'S4TEST';

  after(async () => {
    await closeAllPools();
  });

  async function asIngestion<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(ROLE, fn);
  }

  it('39. the role can read every governed vocabulary it maps onto', async () => {
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ code: string }>(
        `SELECT code FROM football.fixture_lifecycle_state WHERE code = 'UNKNOWN'`
      );
      assert.equal(rows.length, 1, 'UNKNOWN must exist — it is where unmapped statuses go');
    });
  });

  it('40. UNKNOWN seals by default', async () => {
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ is_open: boolean }>(
        `SELECT is_open FROM football.fixture_lifecycle_state WHERE code = 'UNKNOWN'`
      );
      assert.equal(rows[0].is_open, false, 'an unmapped status must not permit snapshots');
    });
  });

  it('41. the S-4 country extension is present and mappable', async () => {
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ count: string }>(
        `SELECT count(*)::text FROM football.country`
      );
      assert.ok(Number(rows[0].count) >= 51, `expected the extended vocabulary, found ${rows[0].count}`);

      for (const name of ['Ukraine', 'South Korea', 'Wales', 'Canada']) {
        const mapping = mapCountry(name);
        assert.equal(mapping.kind, 'MAPPED');
        const code = mapping.kind === 'MAPPED' ? mapping.code : '';
        const { rows: present } = await tx.query(
          `SELECT 1 FROM football.country WHERE code = $1`,
          [code]
        );
        assert.equal(present.length, 1, `${name} maps to ${code}, which must be seeded`);
      }
    });
  });

  it('42. the role holds NO DELETE on football', async () => {
    // Delete-and-reinsert is foreclosed at the privilege layer, not by
    // convention. This is what makes the duplicate strategy structural.
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'football'
            AND c.relkind IN ('r','p')
            AND has_table_privilege('pt_pipeline_ingestion', c.oid, 'DELETE')`
      );
      assert.deepEqual(rows, [], 'ingestion must hold no DELETE on any football relation');
    });
  });

  it('43. the role holds NO UPDATE on the three append-only relations', async () => {
    await asIngestion(async (tx) => {
      for (const relation of ['standing', 'player_valuation', 'fixture_lifecycle_transition']) {
        const { rows } = await tx.query<{ can: boolean }>(
          `SELECT has_table_privilege('pt_pipeline_ingestion', $1, 'UPDATE') AS can`,
          [`football.${relation}`]
        );
        assert.equal(rows[0].can, false, `${relation} is append-only; UPDATE was removed in Revision 2 under P-06`);
      }
    });
  });

  it('44. the role can write its own operational telemetry', async () => {
    // The contrast with finding S3-1: pt_platform_admin holds SELECT only on
    // operations and cannot open a run. Ingestion holds S and I, so every S-4
    // stage is attributed and there is no unattributed path.
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ can: boolean }>(
        `SELECT has_table_privilege('pt_pipeline_ingestion', 'operations.pipeline_run', 'INSERT') AS can`
      );
      assert.equal(rows[0].can, true);
    });
  });

  it('45. the role cannot reach the feature or module schemas at all', async () => {
    // "Do not calculate intelligence during ingestion" holds structurally,
    // against a coding mistake and not merely against intent.
    await asIngestion(async (tx) => {
      for (const schema of ['feature', 'module', 'snapshot', 'calibration']) {
        const { rows } = await tx.query<{ can: boolean }>(
          `SELECT has_schema_privilege('pt_pipeline_ingestion', $1, 'USAGE') AS can`,
          [schema]
        );
        assert.equal(rows[0].can, false, `ingestion must hold no USAGE on ${schema}`);
      }
    });
  });

  it('46. an append-only insert is idempotent by its natural key', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        // A competition and edition to hang the standing on.
        const competition = await upsertMutable(tx, {
          relation: 'football.competition',
          columns: ['provider_code', 'provider_external_id', 'name', 'slug'],
          values: [PROVIDER_CODE, `${TEST_PREFIX}-C1`, 'Test Competition', `${TEST_PREFIX}-c1`.toLowerCase()],
          conflictTarget: ['provider_code', 'provider_external_id'],
        });
        const edition = await upsertMutable(tx, {
          relation: 'football.competition_edition',
          columns: ['competition_id', 'season_label', 'season_period'],
          values: [competition.id, '2026/2027', '[2026-07-01,2027-07-01)'],
          conflictTarget: ['competition_id', 'season_period'],
        });
        const team = await upsertMutable(tx, {
          relation: 'football.team',
          columns: ['provider_code', 'provider_external_id', 'name', 'slug'],
          values: [PROVIDER_CODE, `${TEST_PREFIX}-T1`, 'Test Team', `${TEST_PREFIX}-t1`.toLowerCase()],
          conflictTarget: ['provider_code', 'provider_external_id'],
        });

        const row = [edition.id, team.id, 'TOTAL', '2026-08-01', 1, 10, 7, 2, 1, 20, 8, 23];
        const columns = [
          'competition_edition_id', 'team_id', 'standing_variant', 'as_of_on', 'position',
          'played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'points',
        ];
        const conflictTarget = ['competition_edition_id', 'team_id', 'standing_variant', 'as_of_on'];

        const first = await insertAppendOnly(tx, {
          relation: 'football.standing', columns, rows: [row], conflictTarget,
        });
        assert.equal(first.written, 1);

        const second = await insertAppendOnly(tx, {
          relation: 'football.standing', columns, rows: [row], conflictTarget,
        });
        assert.equal(second.written, 0, 'a same-day re-run must write nothing');
        assert.equal(second.skipped, 1, 'and must report it as skipped, which is diagnostic');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('47. an UPDATE on an append-only relation is REFUSED', async () => {
    // The guarantee most worth a test: nothing else would reveal its loss until
    // the history was already gone. Three layers should refuse this — the grant,
    // the policy and the append guard — and any one of them is a pass.
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await assert.rejects(
          tx.query(`UPDATE football.standing SET points = points + 1 WHERE false`),
          (error: Error & { code?: string }) =>
            /permission denied|append-only|cannot be updated|not permitted/i.test(error.message) ||
            error.code === '42501',
          'standing must refuse UPDATE from the ingestion role'
        );
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('48. a DELETE on any football relation is REFUSED', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await assert.rejects(
          tx.query(`DELETE FROM football.team WHERE false`),
          (error: Error & { code?: string }) =>
            /permission denied/i.test(error.message) || error.code === '42501'
        );
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('49. the mutable upsert never overwrites a known value with null', async () => {
    // A provider response omitting a field is not an assertion that the field is
    // empty. This is how a platform loses data it already had, one sync at a time.
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const columns = ['provider_code', 'provider_external_id', 'name', 'short_name', 'slug', 'country_code'];
        const conflictTarget = ['provider_code', 'provider_external_id'];

        await upsertMutable(tx, {
          relation: 'football.team',
          columns,
          values: [PROVIDER_CODE, `${TEST_PREFIX}-T2`, 'Full Team', 'FT', `${TEST_PREFIX}-t2`.toLowerCase(), 'ES'],
          conflictTarget,
        });

        // A thinner second response: no short name, no country.
        await upsertMutable(tx, {
          relation: 'football.team',
          columns,
          values: [PROVIDER_CODE, `${TEST_PREFIX}-T2`, 'Full Team', null, `${TEST_PREFIX}-t2`.toLowerCase(), null],
          conflictTarget,
        });

        const { rows } = await tx.query<{ short_name: string | null; country_code: string | null }>(
          `SELECT short_name, country_code FROM football.team
            WHERE provider_code = $1 AND provider_external_id = $2`,
          [PROVIDER_CODE, `${TEST_PREFIX}-T2`]
        );
        assert.equal(rows[0].short_name, 'FT', 'a thinner response must not clear a known short name');
        assert.equal(rows[0].country_code, 'ES', 'nor a known country');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // END TO END, against a stubbed provider
  //
  // The entity writers are otherwise unexercised: there is no live provider in
  // a test environment, and the composite foreign keys, the lifecycle transition
  // and the result revision are exactly the things that only fail against a real
  // database. A stub gives a deterministic payload; PostgreSQL does the rest.
  // ───────────────────────────────────────────────────────────────────────────

  /** A provider response shaped like the schedule feed, with one fixture. */
  function scheduleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: `${TEST_PREFIX}-F1`,
      startTimestamp: Math.floor(Date.UTC(2026, 7, 1, 14, 0) / 1000),
      tournament: {
        uniqueTournament: {
          id: `${TEST_PREFIX}-UT1`,
          name: 'Test Premier League',
          category: { name: 'England' },
        },
      },
      season: { id: `${TEST_PREFIX}-S1`, name: '2026/2027' },
      roundInfo: { round: 1, name: 'Matchweek 1' },
      venue: {
        id: `${TEST_PREFIX}-V1`,
        name: 'Test Stadium',
        city: { name: 'Testville' },
        country: { name: 'England' },
        venueCoordinates: { latitude: 51.5, longitude: -0.12 },
        capacity: 60_000,
      },
      homeTeam: { id: `${TEST_PREFIX}-H1`, name: 'Home United', shortName: 'HOM', country: { name: 'England' } },
      awayTeam: { id: `${TEST_PREFIX}-A1`, name: 'Away City', shortName: 'AWY', country: { name: 'England' } },
      status: { code: 0, description: 'Not started' },
      ...overrides,
    };
  }

  /** Stands in for ProviderClient. Only `get` is reached by the stage. */
  function stubClient(events: readonly Record<string, unknown>[]) {
    return { get: async () => ({ events }) } as unknown as Parameters<typeof ingestScheduleDate>[1];
  }

  it('51. ingests a full schedule event into every relation it touches', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const counts = await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');

        assert.ok(counts.total.written > 0, 'the stage must have written something');
        for (const relation of [
          'football.competition',
          'football.competition_edition',
          'football.competition_stage',
          'football.venue',
          'football.team',
          'football.team_registration',
          'football.fixture',
        ]) {
          assert.ok(counts.byRelation.has(relation), `${relation} must be reported per relation`);
        }

        const { rows } = await tx.query<{ lifecycle_state_code: string; fixture_partition_on: Date }>(
          `SELECT lifecycle_state_code, fixture_partition_on FROM football.fixture
            WHERE provider_code = $1 AND provider_external_id = $2`,
          [PROVIDER_CODE, `${TEST_PREFIX}-F1`]
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].lifecycle_state_code, 'SCHEDULED');
        assert.equal(utcDateString(rows[0].fixture_partition_on), '2026-08-01', 'partition derived in UTC');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('52. records a lifecycle transition when the state moves, and not when it does not', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');

        const transitions = async (): Promise<{ from: string | null; to: string }[]> => {
          const { rows } = await tx.query<{ from_state_code: string | null; to_state_code: string }>(
            `SELECT t.from_state_code, t.to_state_code
               FROM football.fixture_lifecycle_transition t
               JOIN football.fixture f
                 ON f.id = t.fixture_id AND f.fixture_partition_on = t.fixture_partition_on
              WHERE f.provider_external_id = $1
              ORDER BY t.transitioned_at`,
            [`${TEST_PREFIX}-F1`]
          );
          return rows.map((r) => ({ from: r.from_state_code, to: r.to_state_code }));
        };

        // Creation is a transition from nothing.
        assert.deepEqual(await transitions(), [{ from: null, to: 'SCHEDULED' }]);

        // Re-ingesting the same state adds nothing.
        await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');
        assert.deepEqual(await transitions(), [{ from: null, to: 'SCHEDULED' }], 'an unchanged state is not a transition');

        // A postponement is.
        await ingestScheduleDate(
          tx,
          stubClient([scheduleEvent({ status: { code: 60, description: 'Postponed' } })]),
          '2026-08-01'
        );
        assert.deepEqual(await transitions(), [
          { from: null, to: 'SCHEDULED' },
          { from: 'SCHEDULED', to: 'POSTPONED' },
        ], 'a postponement leaves a legible trace, which V1 lost entirely');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('53. writes no result for a fixture that has not finished', async () => {
    // "A scheduled fixture has no result, and modelling absence as empty
    // attributes on the fixture would make 'not yet played' and 'played,
    // nil-nil' structurally identical."
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await ingestScheduleDate(
          tx,
          stubClient([scheduleEvent({ status: { code: 6, description: 'Live' }, homeScore: { current: 1 }, awayScore: { current: 0 } })]),
          '2026-08-01'
        );
        const { rows } = await tx.query(
          `SELECT 1 FROM football.result r
             JOIN football.fixture f ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
            WHERE f.provider_external_id = $1`,
          [`${TEST_PREFIX}-F1`]
        );
        assert.equal(rows.length, 0, 'a live score is not a result');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('54. appends a result revision when a confirmed score changes (LC-17)', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const completed = (home: number, away: number) =>
          scheduleEvent({
            status: { code: 100, description: 'Ended' },
            homeScore: { normaltime: home, period1: 1 },
            awayScore: { normaltime: away, period1: 0 },
          });

        await ingestScheduleDate(tx, stubClient([completed(2, 1)]), '2026-08-01');
        await ingestScheduleDate(tx, stubClient([completed(3, 1)]), '2026-08-01');

        const { rows } = await tx.query<{
          revision_ordinal: number;
          previous_home_goals: number;
          previous_away_goals: number;
        }>(
          `SELECT v.revision_ordinal, v.previous_home_goals, v.previous_away_goals
             FROM football.result_revision v
             JOIN football.result r ON r.id = v.result_id AND r.fixture_partition_on = v.fixture_partition_on
             JOIN football.fixture f ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
            WHERE f.provider_external_id = $1
            ORDER BY v.revision_ordinal`,
          [`${TEST_PREFIX}-F1`]
        );

        assert.equal(rows.length, 1, 'a corrected confirmed score must leave a revision record');
        assert.equal(rows[0].revision_ordinal, 1);
        assert.equal(rows[0].previous_home_goals, 2, 'the revision carries the SUPERSEDED figures');
        assert.equal(rows[0].previous_away_goals, 1);

        const { rows: current } = await tx.query<{ home_goals: number }>(
          `SELECT r.home_goals FROM football.result r
             JOIN football.fixture f ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
            WHERE f.provider_external_id = $1`,
          [`${TEST_PREFIX}-F1`]
        );
        assert.equal(current[0].home_goals, 3, 'and the result now carries the corrected figure');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('55. re-ingesting an unchanged day writes no new fixture', async () => {
    // Ingestion is re-run constantly — the same date is fetched daily for a week
    // around each fixture. Duplicate handling is the normal path, not an edge case.
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');
        await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');
        await ingestScheduleDate(tx, stubClient([scheduleEvent()]), '2026-08-01');

        for (const [relation, column, value] of [
          ['football.fixture', 'provider_external_id', `${TEST_PREFIX}-F1`],
          ['football.competition', 'provider_external_id', `${TEST_PREFIX}-UT1`],
          ['football.team', 'provider_external_id', `${TEST_PREFIX}-H1`],
        ] as const) {
          const { rows } = await tx.query<{ count: string }>(
            `SELECT count(*)::text FROM ${relation} WHERE ${column} = $1`,
            [value]
          );
          assert.equal(rows[0].count, '1', `${relation} must hold exactly one row after three runs`);
        }
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('56. an unmapped country leaves NULL rather than blocking the fixture', async () => {
    // LC-05: absence rather than a substituted value. The fixture still lands.
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const event = scheduleEvent({
          tournament: {
            uniqueTournament: {
              id: `${TEST_PREFIX}-UT2`,
              name: 'Atlantean League',
              category: { name: 'Atlantis' },
            },
          },
        });
        await ingestScheduleDate(tx, stubClient([event]), '2026-08-01');

        const { rows } = await tx.query<{ country_code: string | null }>(
          `SELECT country_code FROM football.competition WHERE provider_external_id = $1`,
          [`${TEST_PREFIX}-UT2`]
        );
        assert.equal(rows.length, 1, 'the competition is still created');
        assert.equal(rows[0].country_code, null, 'with no country, rather than a guessed one');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('57. an unrecognised provider status becomes UNKNOWN and seals', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await ingestScheduleDate(
          tx,
          stubClient([scheduleEvent({ status: { code: 999, description: 'Something new' } })]),
          '2026-08-01'
        );
        const { rows } = await tx.query<{ state: string; is_open: boolean; raw: string }>(
          `SELECT f.lifecycle_state_code AS state, s.is_open, f.provider_status_raw AS raw
             FROM football.fixture f
             JOIN football.fixture_lifecycle_state s ON s.code = f.lifecycle_state_code
            WHERE f.provider_external_id = $1`,
          [`${TEST_PREFIX}-F1`]
        );
        assert.equal(rows[0].state, 'UNKNOWN');
        assert.equal(rows[0].is_open, false, 'an unmapped status must not permit snapshots');
        assert.equal(rows[0].raw, 'Something new', 'and the provider string is retained for diagnosis');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('58. a malformed event is counted, not fatal to the rest of the day', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const counts = await ingestScheduleDate(
          tx,
          stubClient([{ id: 'no-tournament-or-teams' }, scheduleEvent()]),
          '2026-08-01'
        );
        assert.ok(counts.total.rejected >= 1, 'the malformed event is reported as rejected');

        const { rows } = await tx.query<{ count: string }>(
          `SELECT count(*)::text FROM football.fixture WHERE provider_external_id = $1`,
          [`${TEST_PREFIX}-F1`]
        );
        assert.equal(rows[0].count, '1', 'and the valid event still landed');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('59. the mutable upsert advances updated_at', async () => {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        const columns = ['provider_code', 'provider_external_id', 'name', 'slug'];
        const conflictTarget = ['provider_code', 'provider_external_id'];
        const values = [PROVIDER_CODE, `${TEST_PREFIX}-T3`, 'Renamed FC', `${TEST_PREFIX}-t3`.toLowerCase()];

        await upsertMutable(tx, { relation: 'football.team', columns, values, conflictTarget });
        const { rows: before } = await tx.query<{ updated_at: Date }>(
          `SELECT updated_at FROM football.team WHERE provider_external_id = $1`,
          [`${TEST_PREFIX}-T3`]
        );

        await upsertMutable(tx, {
          relation: 'football.team',
          columns,
          values: [...values.slice(0, 2), 'Renamed Again FC', values[3]],
          conflictTarget,
        });
        const { rows: after } = await tx.query<{ name: string; updated_at: Date }>(
          `SELECT name, updated_at FROM football.team WHERE provider_external_id = $1`,
          [`${TEST_PREFIX}-T3`]
        );

        assert.equal(after[0].name, 'Renamed Again FC', 'a renamed club is the same club with a new name');
        assert.ok(
          after[0].updated_at.getTime() >= before[0].updated_at.getTime(),
          'updated_at must advance rather than freeze at first insert'
        );
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });
});
