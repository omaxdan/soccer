// ─────────────────────────────────────────────────────────────────────────────
// MATCH ENRICHMENT STAGE — one fixture, one transaction (Task 6C-P)
//
// Persists the RAW match substrate the 034 migration created, from the two
// VERIFIED provider sources and nothing else:
//
//   /match/{id}/lineups     → football.lineup, football.lineup_selection
//                             (formation, starter/sub, captain, shirt, position),
//                             and football.player_match_statistic (the per-player
//                             `statistics` object — canonical source)
//   /match/{id}/statistics  → football.team_match_statistic
//
// The normalisation is done by `entities/matchStatistics.ts`, which is pure and
// tested against the captured payload. This file is the DB half: it resolves
// PROVIDER identities to internal ids through the ESTABLISHED resolvers and
// writes through `upsertMutable`. It creates no identity table of its own.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS STAGE MUST NEVER PRODUCE
//
// No football.appearance, no football.match_event, no event-type vocabulary, no
// derived/intelligence output. It persists raw provider facts and stops. The
// /player-statistics alias and the 503 /incidents endpoint are never fetched —
// the endpoint registry does not carry them.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW A LINEUP ROW GETS ITS INTERNAL TEAM, AND ITS INTERNAL PLAYER
//
//   team    from the FIXTURE, by side. The lineup payload's teamId is in a
//           different id space than football.team (run-278: teamId 34318 for a
//           fixture whose teams are 1961/1999), so it is ignored for identity.
//           data.home → fixture.home_team_id, data.away → fixture.away_team_id.
//           The fixture is authoritative; no team is ever created from a lineup,
//           and a fixture genuinely missing a home/away team is a HARD STOP.
//   player  resolve-or-create (`resolvePlayer`). `match_lineups` is the registry-
//           declared CANONICAL per-fixture player source, so a player it names
//           that is not yet stored is created with the one biographical fact the
//           payload states — the name — and null everything else, to be filled in
//           later by squad ingestion through the same COALESCE upsert. Nothing is
//           fabricated: a null field says "unknown", never a guessed value.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXISTENCE IS PRE-READ, BECAUSE THE TARGETS ARE PARTITIONED
//
// All four relations are partitioned by fixture_partition_on, so `upsertMutable`
// cannot use `RETURNING (xmax = 0)` to tell an insert from an update — PostgreSQL
// refuses a system column on a partitioned target. Each write therefore states
// `existedBeforeWrite`, computed from a batch pre-read of the natural keys already
// present for this fixture. That is the same discipline `resolveFixture` and
// `recordResult` follow for football.fixture and football.result.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { ProviderClient } from '../provider/client';
import { PROVIDER_CODE } from '../provider/config';
import { IngestionCounts, upsertMutable } from '../write/index';
import { resolvePlayer } from '../entities/participants';
import { findFixtureByProviderIdentity, type StoredFixtureIdentity } from '../entities/fixtures';
import { mapPosition } from '../mapping/index';
import {
  normaliseLineups,
  normalisePlayerMatchStatistics,
  normaliseTeamMatchStatistics,
  type MatchSide,
} from '../entities/matchStatistics';
import type { StageCounts } from './schedule';
import { logger } from '../../../utils/logger';

/**
 * Raised when an identity the enrichment depends on cannot be resolved.
 *
 * A HARD STOP, not a skipped row: the whole enrichment is one transaction, and a
 * lineup written against a fixture or team that could not be resolved would be a
 * dangling half-record. The provider id is carried so the condition is
 * investigable without re-running.
 */
export class MatchEnrichmentIdentityError extends Error {
  constructor(
    readonly kind: 'fixture' | 'team',
    /** For 'fixture', the provider match id; for 'team', the side that has no team. */
    readonly detail: string
  ) {
    super(
      kind === 'fixture'
        ? `Match enrichment could not resolve fixture ${PROVIDER_CODE}/${detail}. ` +
          'The fixture must be ingested (schedule/season/team) before its match data can be enriched.'
        : `Match enrichment found no ${detail}-side team on the fixture. The fixture's home and ` +
          'away teams are the authoritative source of lineup team identity, and both are NOT NULL; ' +
          'a missing one is a fixture-integrity fault, not something enrichment invents around.'
    );
    this.name = 'MatchEnrichmentIdentityError';
  }
}

/** Raised when a provider response does not carry the substrate it must. */
export class MatchEnrichmentPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchEnrichmentPayloadError';
  }
}

class StageAccumulator {
  readonly total = new IngestionCounts();
  readonly byRelation = new Map<string, IngestionCounts>();

  for(relation: string): IngestionCounts {
    let counts = this.byRelation.get(relation);
    if (!counts) {
      counts = new IngestionCounts();
      this.byRelation.set(relation, counts);
    }
    return counts;
  }

  seal(): StageCounts {
    for (const counts of this.byRelation.values()) this.total.add(counts);
    return { total: this.total, byRelation: this.byRelation };
  }
}

/** The two verified payloads plus the run's single retrieval instant. */
export interface MatchEnrichmentInput {
  /** Provider match id, which equals fixture.provider_external_id. */
  readonly fixtureProviderId: string;
  readonly lineupsPayload: unknown;
  readonly statisticsPayload: unknown;
  /**
   * The instant the payloads were retrieved, captured ONCE by the controller and
   * passed down (the S-5 discipline). Written to every row's `retrieved_at`.
   */
  readonly retrievedAt: Date;
}

export interface MatchEnrichmentStageResult extends StageCounts {
  readonly fixture: StoredFixtureIdentity;
}

/** Reads the (team_id → lineup id) already stored for this fixture. */
async function existingLineupsByTeam(
  tx: PoolClient,
  fixture: StoredFixtureIdentity
): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ team_id: string; id: string }>(
    `SELECT team_id::text, id::text
       FROM football.lineup
      WHERE fixture_partition_on = $1 AND fixture_id = $2`,
    [fixture.partitionOn, fixture.id]
  );
  return new Map(rows.map((r) => [r.team_id, r.id]));
}

/** Reads the (lineup_id, player_id) selections already stored for these lineups. */
async function existingSelectionKeys(
  tx: PoolClient,
  fixture: StoredFixtureIdentity,
  lineupIds: readonly string[]
): Promise<Set<string>> {
  if (lineupIds.length === 0) return new Set();
  const { rows } = await tx.query<{ lineup_id: string; player_id: string }>(
    `SELECT lineup_id::text, player_id::text
       FROM football.lineup_selection
      WHERE fixture_partition_on = $1 AND lineup_id = ANY($2::bigint[])`,
    [fixture.partitionOn, lineupIds]
  );
  return new Set(rows.map((r) => `${r.lineup_id}:${r.player_id}`));
}

/** Reads the (player_id, statistic_key) rows already stored for this fixture. */
async function existingPlayerStatKeys(
  tx: PoolClient,
  fixture: StoredFixtureIdentity
): Promise<Set<string>> {
  const { rows } = await tx.query<{ player_id: string; statistic_key: string }>(
    `SELECT player_id::text, statistic_key
       FROM football.player_match_statistic
      WHERE fixture_partition_on = $1 AND fixture_id = $2`,
    [fixture.partitionOn, fixture.id]
  );
  return new Set(rows.map((r) => `${r.player_id}:${r.statistic_key}`));
}

/** Reads the (period, group_name, statistic_key) rows already stored. */
async function existingTeamStatKeys(
  tx: PoolClient,
  fixture: StoredFixtureIdentity
): Promise<Set<string>> {
  const { rows } = await tx.query<{ period: string; group_name: string; statistic_key: string }>(
    `SELECT period, group_name, statistic_key
       FROM football.team_match_statistic
      WHERE fixture_partition_on = $1 AND fixture_id = $2`,
    [fixture.partitionOn, fixture.id]
  );
  return new Set(rows.map((r) => `${r.period}:${r.group_name}:${r.statistic_key}`));
}

/**
 * The fixture's authoritative home/away internal team ids.
 *
 * This is where lineup team identity comes from — NOT the lineup payload's
 * teamId. Both columns are NOT NULL on football.fixture, so a null here is a
 * fixture-integrity fault and a HARD STOP.
 */
async function fixtureTeamsBySide(
  tx: PoolClient,
  fixture: StoredFixtureIdentity
): Promise<Record<MatchSide, string>> {
  const { rows } = await tx.query<{ home_team_id: string; away_team_id: string }>(
    `SELECT home_team_id::text, away_team_id::text
       FROM football.fixture
      WHERE id = $1 AND fixture_partition_on = $2`,
    [fixture.id, fixture.partitionOn]
  );
  const row = rows[0];
  if (!row?.home_team_id) throw new MatchEnrichmentIdentityError('team', 'home');
  if (!row?.away_team_id) throw new MatchEnrichmentIdentityError('team', 'away');
  return { home: row.home_team_id, away: row.away_team_id };
}

/**
 * Persists one fixture's raw match substrate. Runs inside a `withRun`
 * transaction as `pt_pipeline_ingestion`; everything commits together or not at
 * all, so a re-run never finds a half-written fixture.
 */
export async function persistMatchEnrichment(
  tx: PoolClient,
  input: MatchEnrichmentInput
): Promise<MatchEnrichmentStageResult> {
  const stage = new StageAccumulator();

  // ── Fixture identity, first ────────────────────────────────────────────────
  const fixture = await findFixtureByProviderIdentity(tx, input.fixtureProviderId);
  if (!fixture) throw new MatchEnrichmentIdentityError('fixture', input.fixtureProviderId);

  const { lineups, selections } = normaliseLineups(input.lineupsPayload);
  const playerStats = normalisePlayerMatchStatistics(input.lineupsPayload);
  const teamStats = normaliseTeamMatchStatistics(input.statisticsPayload);

  if (selections.length === 0) {
    throw new MatchEnrichmentPayloadError(
      `/match/${input.fixtureProviderId}/lineups carried no resolvable player selections; ` +
        'the response differs materially from the verified payload.'
    );
  }
  if (teamStats.length === 0) {
    throw new MatchEnrichmentPayloadError(
      `/match/${input.fixtureProviderId}/statistics carried no resolvable team statistics; ` +
        'the response differs materially from the verified payload.'
    );
  }

  // ── Team identity — from the FIXTURE, by side. The lineup teamId is ignored. ─
  const teamBySide = await fixtureTeamsBySide(tx, fixture);

  // ── Player identity — resolve-or-create through the established resolver ───
  // Selections enumerate every player in the payload; player statistics are a
  // subset of the same set, so resolving from selections covers both.
  const playerByProvider = new Map<string, string>();
  for (const s of selections) {
    if (playerByProvider.has(s.playerProviderId)) continue;
    const playerId = await resolvePlayer(
      tx,
      {
        externalId: s.playerProviderId,
        name: s.playerName ?? `Player ${s.playerProviderId}`,
        shortName: null,
        dateOfBirth: null,
        nationalityName: null,
        heightCm: null,
        preferredFoot: null,
      },
      stage.for('football.player')
    );
    playerByProvider.set(s.playerProviderId, playerId);
  }

  // ── football.lineup ────────────────────────────────────────────────────────
  const existingLineups = await existingLineupsByTeam(tx, fixture);
  const lineupIdBySide = new Map<MatchSide, string>();
  for (const l of lineups) {
    const teamId = teamBySide[l.side];
    const row = await upsertMutable(tx, {
      relation: 'football.lineup',
      columns: ['fixture_id', 'fixture_partition_on', 'team_id', 'formation'],
      values: [fixture.id, fixture.partitionOn, teamId, l.formation],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'team_id'],
      immutableColumns: ['fixture_partition_on', 'fixture_id', 'team_id'],
      returning: ['id'],
      existedBeforeWrite: existingLineups.has(teamId),
    });
    lineupIdBySide.set(l.side, String(row.id));
    stage.for('football.lineup').countUpsert(row);
  }

  // ── football.lineup_selection ──────────────────────────────────────────────
  const existingSelections = await existingSelectionKeys(tx, fixture, [
    ...lineupIdBySide.values(),
  ]);
  for (const s of selections) {
    const lineupId = lineupIdBySide.get(s.side);
    if (!lineupId) {
      // A selection whose side produced no lineup row means the side had no
      // players at all — no lineup was created for it — so this is unreachable.
      stage.for('football.lineup_selection').reject('selection has no parent lineup');
      continue;
    }
    const playerId = playerByProvider.get(s.playerProviderId)!;
    const position = mapPosition(s.positionCode);
    const row = await upsertMutable(tx, {
      relation: 'football.lineup_selection',
      columns: [
        'lineup_id',
        'fixture_partition_on',
        'player_id',
        'position_code',
        'shirt_number',
        'is_starting',
        'is_captain',
      ],
      values: [
        lineupId,
        fixture.partitionOn,
        playerId,
        position.kind === 'MAPPED' ? position.code : null,
        s.shirtNumber,
        s.isStarting,
        s.isCaptain,
      ],
      conflictTarget: ['fixture_partition_on', 'lineup_id', 'player_id'],
      immutableColumns: ['fixture_partition_on', 'lineup_id', 'player_id'],
      // lineup_selection carries no updated_at (migration 005), so the primitive
      // must not try to advance one.
      hasUpdatedAt: false,
      returning: ['id'],
      existedBeforeWrite: existingSelections.has(`${lineupId}:${playerId}`),
    });
    stage.for('football.lineup_selection').countUpsert(row);
  }

  // ── football.player_match_statistic ────────────────────────────────────────
  const existingPlayerStats = await existingPlayerStatKeys(tx, fixture);
  for (const p of playerStats) {
    const playerId = playerByProvider.get(p.playerProviderId);
    const teamId = teamBySide[p.side];
    if (!playerId || !teamId) {
      stage.for('football.player_match_statistic').reject('player-statistic identity unresolved');
      continue;
    }
    const row = await upsertMutable(tx, {
      relation: 'football.player_match_statistic',
      columns: [
        'fixture_id',
        'fixture_partition_on',
        'player_id',
        'team_id',
        'statistic_key',
        'statistic_value',
        'value_type',
        'provider_code',
        'retrieved_at',
      ],
      values: [
        fixture.id,
        fixture.partitionOn,
        playerId,
        teamId,
        p.statisticKey,
        p.statisticValue,
        p.valueType,
        PROVIDER_CODE,
        input.retrievedAt,
      ],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key'],
      immutableColumns: ['fixture_partition_on', 'fixture_id', 'player_id', 'statistic_key'],
      returning: ['id'],
      existedBeforeWrite: existingPlayerStats.has(`${playerId}:${p.statisticKey}`),
    });
    stage.for('football.player_match_statistic').countUpsert(row);
  }

  // ── football.team_match_statistic ──────────────────────────────────────────
  const existingTeamStats = await existingTeamStatKeys(tx, fixture);
  for (const t of teamStats) {
    const row = await upsertMutable(tx, {
      relation: 'football.team_match_statistic',
      columns: [
        'fixture_id',
        'fixture_partition_on',
        'period',
        'group_name',
        'statistic_key',
        'statistic_name',
        'home_value',
        'away_value',
        'home_display',
        'away_display',
        'value_type',
        'compare_code',
        'statistics_type',
        'render_type',
        'provider_code',
        'retrieved_at',
      ],
      values: [
        fixture.id,
        fixture.partitionOn,
        t.period,
        t.groupName,
        t.statisticKey,
        t.statisticName,
        t.homeValue,
        t.awayValue,
        t.homeDisplay,
        t.awayDisplay,
        t.valueType,
        t.compareCode,
        t.statisticsType,
        t.renderType,
        PROVIDER_CODE,
        input.retrievedAt,
      ],
      conflictTarget: [
        'fixture_partition_on',
        'fixture_id',
        'period',
        'group_name',
        'statistic_key',
      ],
      immutableColumns: [
        'fixture_partition_on',
        'fixture_id',
        'period',
        'group_name',
        'statistic_key',
      ],
      returning: ['id'],
      existedBeforeWrite: existingTeamStats.has(`${t.period}:${t.groupName}:${t.statisticKey}`),
    });
    stage.for('football.team_match_statistic').countUpsert(row);
  }

  logger.info(
    {
      fixture: fixture.id,
      providerMatch: input.fixtureProviderId,
      lineups: lineups.length,
      selections: selections.length,
      playerStats: playerStats.length,
      teamStats: teamStats.length,
    },
    'v2 ingestion: match enrichment persisted'
  );

  return { ...stage.seal(), fixture };
}
