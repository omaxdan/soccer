// ─────────────────────────────────────────────────────────────────────────────
// TEST FOOTBALL REALITY
//
// Seeds a small, fixed world through the S-4 write primitives — not through
// hand-written SQL — so the tests exercise the same insert path production uses
// and cannot accidentally create a row production could not.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS COMMITS, AND WHY THE FEATURE TESTS DO NOT
//
// `pt_pipeline_ingestion` writes `football`; `pt_pipeline_feature` writes
// `feature`. No role does both, which is the privilege model working. So the
// world has to be committed by ingestion before the feature role can read it.
//
// The feature-side tests then run inside their own transactions and ROLL BACK,
// which is what makes "two clean runs from empty over identical reality"
// (Replay A) testable at all: neither role holds DELETE on anything, so rollback
// is the only way to return to an empty `feature` schema.
//
// Seeding is idempotent — every statement conflicts on a named target — so the
// suite can run repeatedly against the same rig.
//
// ─────────────────────────────────────────────────────────────────────────────
// EVERY INSTANT IS A FIXED ABSOLUTE DATE
//
// Nothing here is relative to `now()`. A test whose data moves with the clock
// passes on Tuesday and fails on Wednesday, and the determinism this subsystem
// is built around would be the first casualty.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { insertAppendOnly, upsertMutable } from '../../ingestion/write/index';

/** Distinguishes this suite's rows from anything else in the rig. */
export const TEST_PREFIX = 'S5TEST';

/** The season the fixtures sit in. Inside `feature_value`'s 2024–2028 partitions. */
const SEASON_START = '2026-07-01';
const SEASON_END = '2027-07-01';

/**
 * Fixture calendar, fixed and absolute.
 *
 * Home and away alternate so both form features have a population, and the
 * spacing is deliberate: fixtures 1–6 fall inside a 28-day window before the
 * reference instant so congestion has something to count, while 7–10 sit
 * further back so the ten-fixture form window reaches past it.
 */
export interface SeededFixture {
  readonly externalId: string;
  readonly kickoffAt: string;
  readonly homeIsAlpha: boolean;
  readonly homeGoals: number;
  readonly awayGoals: number;
  /** Which venue it was played at. Alpha's ground, Beta's, or the remote one. */
  readonly venue: 'ALPHA' | 'BETA' | 'REMOTE';
}

export const SEEDED_FIXTURES: readonly SeededFixture[] = [
  { externalId: 'F01', kickoffAt: '2026-09-01T14:00:00Z', homeIsAlpha: true, homeGoals: 2, awayGoals: 0, venue: 'ALPHA' },
  { externalId: 'F02', kickoffAt: '2026-09-08T14:00:00Z', homeIsAlpha: false, homeGoals: 1, awayGoals: 1, venue: 'BETA' },
  { externalId: 'F03', kickoffAt: '2026-09-15T14:00:00Z', homeIsAlpha: true, homeGoals: 0, awayGoals: 1, venue: 'ALPHA' },
  { externalId: 'F04', kickoffAt: '2026-09-22T14:00:00Z', homeIsAlpha: false, homeGoals: 3, awayGoals: 2, venue: 'REMOTE' },
  { externalId: 'F05', kickoffAt: '2026-09-29T14:00:00Z', homeIsAlpha: true, homeGoals: 1, awayGoals: 1, venue: 'ALPHA' },
  { externalId: 'F06', kickoffAt: '2026-10-06T14:00:00Z', homeIsAlpha: false, homeGoals: 0, awayGoals: 2, venue: 'BETA' },
  { externalId: 'F07', kickoffAt: '2026-10-20T14:00:00Z', homeIsAlpha: true, homeGoals: 4, awayGoals: 0, venue: 'ALPHA' },
  { externalId: 'F08', kickoffAt: '2026-11-03T14:00:00Z', homeIsAlpha: false, homeGoals: 2, awayGoals: 2, venue: 'REMOTE' },
];

/** The instant most tests calculate at — after every seeded fixture. */
export const REFERENCE_AS_OF = new Date('2026-11-10T12:00:00Z');

/** Ids of the seeded world, returned so tests do not re-query for them. */
export interface SeededWorld {
  readonly competitionId: string;
  readonly editionId: string;
  readonly alphaTeamId: string;
  readonly betaTeamId: string;
  readonly alphaVenueId: string;
  readonly betaVenueId: string;
  readonly remoteVenueId: string;
}

/**
 * Seeds the world. Idempotent.
 *
 * Runs as `pt_pipeline_ingestion` and COMMITS, because the feature role cannot
 * write `football` and cannot see another connection's uncommitted rows.
 */
export async function seedWorld(tx: PoolClient): Promise<SeededWorld> {
  const competition = await upsertMutable(tx, {
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code'],
    values: [PROVIDER_CODE, `${TEST_PREFIX}-COMP`, 'S5 Test League', `${TEST_PREFIX}-league`.toLowerCase(), 'GB'],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  const edition = await upsertMutable(tx, {
    relation: 'football.competition_edition',
    columns: ['competition_id', 'season_label', 'season_period'],
    values: [competition.id, '2026/2027', `[${SEASON_START},${SEASON_END})`],
    conflictTarget: ['competition_id', 'season_period'],
  });

  // Alpha and Beta are 100 km apart; Remote is far enough to land in a higher
  // travel band, so the band table is exercised rather than assumed.
  const alphaVenue = await seedVenue(tx, 'ALPHA', 'Alpha Park', '51.500000', '-0.120000');
  const betaVenue = await seedVenue(tx, 'BETA', 'Beta Stadium', '52.400000', '-1.500000');
  const remoteVenue = await seedVenue(tx, 'REMOTE', 'Remote Arena', '41.900000', '12.500000');

  const alpha = await seedTeam(tx, 'ALPHA', 'Alpha United', alphaVenue);
  const beta = await seedTeam(tx, 'BETA', 'Beta City', betaVenue);

  const venueIds: Record<SeededFixture['venue'], string> = {
    ALPHA: alphaVenue,
    BETA: betaVenue,
    REMOTE: remoteVenue,
  };

  for (const fixture of SEEDED_FIXTURES) {
    const homeTeamId = fixture.homeIsAlpha ? alpha : beta;
    const awayTeamId = fixture.homeIsAlpha ? beta : alpha;
    const kickoff = new Date(fixture.kickoffAt);
    const partitionOn = fixture.kickoffAt.slice(0, 10);

    const stored = await upsertMutable(tx, {
      relation: 'football.fixture',
      columns: [
        'provider_code', 'provider_external_id', 'fixture_partition_on',
        'competition_edition_id', 'venue_id', 'is_neutral_venue',
        'home_team_id', 'away_team_id', 'scheduled_kickoff_at', 'lifecycle_state_code',
      ],
      values: [
        PROVIDER_CODE, `${TEST_PREFIX}-${fixture.externalId}`, partitionOn,
        edition.id, venueIds[fixture.venue], false,
        homeTeamId, awayTeamId, kickoff, 'COMPLETED',
      ],
      conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
      immutableColumns: ['fixture_partition_on'],
    });

    await upsertMutable(tx, {
      relation: 'football.result',
      columns: ['fixture_id', 'fixture_partition_on', 'home_goals', 'away_goals', 'confirmed_at'],
      values: [stored.id, partitionOn, fixture.homeGoals, fixture.awayGoals, kickoff],
      conflictTarget: ['fixture_partition_on', 'fixture_id'],
      immutableColumns: ['fixture_id', 'fixture_partition_on'],
    });

    // The lifecycle transition every fixture needs; append-only, so a re-run
    // conflicts and is skipped.
    await insertAppendOnly(tx, {
      relation: 'football.fixture_lifecycle_transition',
      columns: ['fixture_id', 'fixture_partition_on', 'from_state_code', 'to_state_code', 'transitioned_at'],
      rows: [[stored.id, partitionOn, null, 'COMPLETED', kickoff]],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'transitioned_at'],
    });
  }

  return {
    competitionId: String(competition.id),
    editionId: String(edition.id),
    alphaTeamId: alpha,
    betaTeamId: beta,
    alphaVenueId: alphaVenue,
    betaVenueId: betaVenue,
    remoteVenueId: remoteVenue,
  };
}

async function seedVenue(
  tx: PoolClient,
  suffix: string,
  name: string,
  latitude: string,
  longitude: string
): Promise<string> {
  const row = await upsertMutable(tx, {
    relation: 'football.venue',
    columns: ['provider_external_id', 'name', 'country_code', 'latitude', 'longitude'],
    values: [`${TEST_PREFIX}-V-${suffix}`, name, 'GB', latitude, longitude],
    conflictTarget: ['provider_external_id'],
  });
  return String(row.id);
}

async function seedTeam(
  tx: PoolClient,
  suffix: string,
  name: string,
  homeVenueId: string
): Promise<string> {
  const row = await upsertMutable(tx, {
    relation: 'football.team',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
    values: [
      PROVIDER_CODE,
      `${TEST_PREFIX}-T-${suffix}`,
      name,
      `${TEST_PREFIX}-t-${suffix}`.toLowerCase(),
      'GB',
      homeVenueId,
    ],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });
  return String(row.id);
}
