// ─────────────────────────────────────────────────────────────────────────────
// A SECOND COMPETITION EDITION FOR THE MODULE DB TESTS
//
// The engine's INACTIVE path needs a scoped population where one declared input
// exists and the other does not: a team with home fixtures (→ home_win_rate) and
// NO away fixtures (→ away_win_rate absent → INACTIVE). This seeder builds exactly
// that — a distinct edition in which Alpha plays TWELVE completed HOME games (all
// wins) and no away games at all.
//
// Seeded through the S-4 write primitives (not raw SQL), committed by
// `pt_pipeline_ingestion`, and idempotent — every statement conflicts on a named
// target — so the suite can run repeatedly against the same rig.
//
// PREFIX ISOLATION: rows use `S6MOD`, distinct from the shared `S5TEST` world and
// from Gate C-ii's `S6CII` edition, so this suite's committed fixtures never
// inflate another suite's prefix-scoped counts (the Gate C-ii lesson).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { findByProviderId, insertAppendOnly, upsertMutable } from '../../ingestion/write/index';
import type { SeededWorld } from '../../feature/__tests__/fixtures';

/** DISTINCT from `S5TEST` and `S6CII` — this suite counts only its own rows. */
const SECOND_PREFIX = 'S6MOD';

/**
 * Twelve completed HOME fixtures for Alpha, all wins, spread fortnightly. No away
 * fixtures — the asymmetry that drives the INACTIVE reading (home present, away
 * absent) in edition 2.
 */
const SECOND_EDITION_KICKOFFS: readonly string[] = [
  '2026-08-01T14:00:00Z', '2026-08-15T14:00:00Z', '2026-08-29T14:00:00Z',
  '2026-09-12T14:00:00Z', '2026-09-26T14:00:00Z', '2026-10-10T14:00:00Z',
  '2026-10-24T14:00:00Z', '2026-11-07T14:00:00Z', '2026-11-21T14:00:00Z',
  '2026-12-05T14:00:00Z', '2026-12-19T14:00:00Z', '2027-01-02T14:00:00Z',
];

export interface ModuleSecondEdition {
  readonly competitionId: string;
  readonly editionId: string;
  readonly alphaHomeCount: number;
  /**
   * A DEDICATED team owned by this suite (no fixtures, in no edition), used solely
   * as the subject of a committed ALL_COMPETITIONS feature value in the Gate E-i
   * tests. Kept off the shared Alpha/Beta so an ALL_COMP commit here cannot touch
   * another suite's global invariants (e.g. Gate C-ii's "Alpha has no ALL_COMP
   * row"). It carries the `S6MOD` prefix like the rest of this seeder.
   */
  readonly gammaTeamId: string;
}

/**
 * Seeds the second edition. Idempotent. Runs as `pt_pipeline_ingestion` and
 * commits, because the feature/module roles cannot write `football` and cannot
 * see another connection's uncommitted rows.
 */
export async function seedSecondEditionForModuleTests(
  tx: PoolClient,
  world: SeededWorld
): Promise<ModuleSecondEdition> {
  const competition = await upsertMutable(tx, {
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code'],
    values: [PROVIDER_CODE, `${SECOND_PREFIX}-COMP`, 'S6 Module Cup', `${SECOND_PREFIX}-cup`, 'GB'],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });
  const edition = await upsertMutable(tx, {
    relation: 'football.competition_edition',
    columns: ['competition_id', 'season_label', 'season_period'],
    values: [competition.id, '2026/2027', '[2026-07-01,2027-07-01)'],
    conflictTarget: ['competition_id', 'season_period'],
  });

  for (let i = 0; i < SECOND_EDITION_KICKOFFS.length; i += 1) {
    const kickoffIso = SECOND_EDITION_KICKOFFS[i];
    const kickoff = new Date(kickoffIso);
    const partitionOn = kickoffIso.slice(0, 10);
    const externalId = `${SECOND_PREFIX}-E2-F${String(i + 1).padStart(2, '0')}`;

    const existing = await findByProviderId(tx, 'football.fixture', PROVIDER_CODE, externalId);
    const stored = await upsertMutable(tx, {
      relation: 'football.fixture',
      columns: [
        'provider_code', 'provider_external_id', 'fixture_partition_on',
        'competition_edition_id', 'venue_id', 'is_neutral_venue',
        'home_team_id', 'away_team_id', 'scheduled_kickoff_at', 'lifecycle_state_code',
      ],
      values: [
        PROVIDER_CODE, externalId, partitionOn,
        edition.id, world.alphaVenueId, false,
        world.alphaTeamId, world.betaTeamId, kickoff, 'COMPLETED',
      ],
      conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
      immutableColumns: ['fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    await upsertMutable(tx, {
      relation: 'football.result',
      columns: ['fixture_id', 'fixture_partition_on', 'home_goals', 'away_goals', 'confirmed_at'],
      values: [stored.id, partitionOn, 2, 0, kickoff],
      conflictTarget: ['fixture_partition_on', 'fixture_id'],
      immutableColumns: ['fixture_id', 'fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    await insertAppendOnly(tx, {
      relation: 'football.fixture_lifecycle_transition',
      columns: ['fixture_id', 'fixture_partition_on', 'from_state_code', 'to_state_code', 'transitioned_at'],
      rows: [[stored.id, partitionOn, null, 'COMPLETED', kickoff]],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'transitioned_at'],
    });
  }

  // A dedicated, fixture-less team for the ALL_COMPETITIONS probe. Its home venue
  // reuses Alpha's — arbitrary; the team is never played, only referenced as a
  // feature-value subject.
  const gamma = await upsertMutable(tx, {
    relation: 'football.team',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
    values: [
      PROVIDER_CODE,
      `${SECOND_PREFIX}-T-GAMMA`,
      'S6 Module Gamma',
      `${SECOND_PREFIX}-t-gamma`.toLowerCase(),
      'GB',
      world.alphaVenueId,
    ],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  return {
    competitionId: String(competition.id),
    editionId: String(edition.id),
    alphaHomeCount: SECOND_EDITION_KICKOFFS.length,
    gammaTeamId: String(gamma.id),
  };
}
