// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE STAGE — one date, one transaction
//
// The primary ingestion path. A single `/schedule/{date}` response carries
// entities at seven levels of the reference graph, which is what makes full
// coverage possible on one call a day against a 200-call budget.
//
// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION ORDER IS THE REFERENCE GRAPH, NOT A PREFERENCE
//
//   country (S-3, static)
//      └── competition ── competition_edition ── competition_stage
//   venue ─────────────┐            │
//                      ├── team ── team_registration
//                      │     │
//                      │     └──── fixture ── result ── result_revision
//                      │              └────── fixture_lifecycle_transition
//
// V1's master feed already resolved in dependency order and was right to. V2's
// graph is deeper because of the decompositions, but the discipline is the same
// and it is preserved.
//
// ─────────────────────────────────────────────────────────────────────────────
// ENTITIES ARE RESOLVED ONCE PER RESPONSE, NOT ONCE PER FIXTURE
//
// Ten fixtures in the Premier League reference one competition and one edition.
// Resolving per fixture would issue ten identical upserts, each taking a row
// lock. The caches below are per-response and per-transaction — deliberately not
// process-wide, because a long-lived cache would serve a stale surrogate id
// after a rollback, and a surrogate id that does not exist is the worst kind of
// wrong: the foreign key fails somewhere far from the cause.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { ProviderClient } from '../provider/client';
import { IngestionCounts } from '../write/index';
import {
  resolveCompetition,
  resolveCompetitionEdition,
  resolveCompetitionStage,
  resolveVenue,
} from '../entities/reference';
import { recordTeamRegistration, resolveTeam } from '../entities/participants';
import { recordResult, resolveFixture } from '../entities/fixtures';
import { fromUnixSeconds, nonNegativeInt, text, utcDateString } from '../normalise';
import { logger } from '../../../utils/logger';

/** Per-relation counts, which is the grain `operations.write_record` stores. */
export interface StageCounts {
  readonly total: IngestionCounts;
  readonly byRelation: ReadonlyMap<string, IngestionCounts>;
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

  /** Folds per-relation counts into the total. Called once, at the end. */
  seal(): StageCounts {
    for (const counts of this.byRelation.values()) this.total.add(counts);
    return { total: this.total, byRelation: this.byRelation };
  }
}

/** The provider's schedule payload, kept loose because it is external data. */
interface ScheduleResponse {
  readonly events?: readonly Record<string, unknown>[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function externalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

/**
 * Derives a bounded season period from a provider season.
 *
 * `competition_edition.season_period` is a NOT NULL daterange with an exclusion
 * constraint forbidding overlap, because "a season is a BOUNDED PERIOD, not a
 * label. The previous platform stored season as free text, which made 'which
 * season was active on this date' unanswerable."
 *
 * The provider sends a label like '2025/2026' and often no dates. Deriving the
 * period from the label is a real inference, and it is stated as one: a split
 * season runs 1 July to 30 June, a calendar season 1 January to 31 December.
 * That is the convention the label encodes, and encoding it here is the only
 * alternative to refusing every edition the provider dates loosely.
 *
 * The kickoff date is the fallback when no label parses — the season containing
 * this fixture, bounded to the year around it. Wrong boundaries would surface as
 * an exclusion-constraint violation naming the overlap, which is loud.
 */
function seasonPeriod(label: string, kickoff: Date): { startsOn: string; endsOn: string } {
  const split = label.match(/(\d{4})\s*[/\-–]\s*(\d{2,4})/);
  if (split) {
    const start = Number(split[1]);
    return { startsOn: `${start}-07-01`, endsOn: `${start + 1}-07-01` };
  }
  const calendar = label.match(/^(\d{4})$/);
  if (calendar) {
    const year = Number(calendar[1]);
    return { startsOn: `${year}-01-01`, endsOn: `${year + 1}-01-01` };
  }
  const year = kickoff.getUTCFullYear();
  const julyOrLater = kickoff.getUTCMonth() >= 6;
  return julyOrLater
    ? { startsOn: `${year}-07-01`, endsOn: `${year + 1}-07-01` }
    : { startsOn: `${year - 1}-07-01`, endsOn: `${year}-07-01` };
}

/**
 * Ingests one UTC date of the schedule feed.
 *
 * Runs inside a `withRun` transaction as `pt_pipeline_ingestion`. Everything
 * this function writes commits together or not at all — a half-ingested day is
 * worse than an absent one, because the next attempt would find some fixtures
 * present and skip them.
 */
export async function ingestScheduleDate(
  tx: PoolClient,
  client: ProviderClient,
  date: string
): Promise<StageCounts> {
  const response = await client.get<ScheduleResponse>('schedule', { date });
  const events = response.events ?? [];
  const stage = new StageAccumulator();

  // Per-response, per-transaction. See the header for why these are not
  // process-wide.
  const competitions = new Map<string, string>();
  const editions = new Map<string, string>();
  const stages = new Map<string, string>();
  const venues = new Map<string, string>();
  const teams = new Map<string, string>();

  for (const raw of events) {
    try {
      await ingestEvent(tx, raw, stage, { competitions, editions, stages, venues, teams });
    } catch (error) {
      // One malformed event does not cost the rest of the day. The transaction
      // is still intact — a constraint violation would have aborted it, and this
      // catch handles shape failures before any statement is issued. A statement
      // that DID fail rethrows below, because the transaction is then poisoned
      // and continuing would fail every subsequent statement with
      // "current transaction is aborted".
      if (isPostgresError(error)) throw error;
      stage.for('football.fixture').reject('event payload could not be interpreted');
      logger.warn({ date, error: (error as Error).message }, 'v2 ingestion: skipping malformed event');
    }
  }

  logger.info({ date, events: events.length }, 'v2 ingestion: schedule date processed');
  return stage.seal();
}

/** A driver error carries a SQLSTATE; a shape error does not. */
function isPostgresError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string');
}

interface ResolutionCaches {
  readonly competitions: Map<string, string>;
  readonly editions: Map<string, string>;
  readonly stages: Map<string, string>;
  readonly venues: Map<string, string>;
  readonly teams: Map<string, string>;
}

async function ingestEvent(
  tx: PoolClient,
  raw: Record<string, unknown>,
  stage: StageAccumulator,
  caches: ResolutionCaches
): Promise<void> {
  const fixtureExternalId = externalId(raw.id);
  const tournament = asRecord(raw.tournament);
  const uniqueTournament = asRecord(tournament?.uniqueTournament) ?? tournament;
  const homeTeam = asRecord(raw.homeTeam);
  const awayTeam = asRecord(raw.awayTeam);
  const kickoff = fromUnixSeconds(raw.startTimestamp as number | null);

  if (!fixtureExternalId || !uniqueTournament || !homeTeam || !awayTeam || !kickoff) {
    // Not a rejection of a value — a payload that is not an event. Counted so it
    // appears in telemetry rather than vanishing.
    stage.for('football.fixture').reject('event lacks id, tournament, participants or kickoff');
    return;
  }

  // ── 1. Competition ────────────────────────────────────────────────────────
  const competitionExternalId = externalId(uniqueTournament.id);
  if (!competitionExternalId) {
    stage.for('football.competition').reject('tournament has no external id');
    return;
  }
  let competitionId = caches.competitions.get(competitionExternalId);
  if (!competitionId) {
    competitionId = await resolveCompetition(
      tx,
      {
        externalId: competitionExternalId,
        name: text(uniqueTournament.name) ?? `Competition ${competitionExternalId}`,
        categoryName: text(asRecord(uniqueTournament.category)?.name),
      },
      stage.for('football.competition')
    );
    caches.competitions.set(competitionExternalId, competitionId);
  }

  // ── 2. Edition ────────────────────────────────────────────────────────────
  const season = asRecord(raw.season);
  const seasonLabel = text(season?.name) ?? text(season?.year) ?? String(kickoff.getUTCFullYear());
  const period = seasonPeriod(seasonLabel, kickoff);
  const editionKey = `${competitionId}:${period.startsOn}`;
  let editionId = caches.editions.get(editionKey);
  if (!editionId) {
    editionId = await resolveCompetitionEdition(
      tx,
      competitionId,
      {
        externalId: externalId(season?.id),
        label: seasonLabel,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
      },
      stage.for('football.competition_edition')
    );
    caches.editions.set(editionKey, editionId);
  }

  // ── 3. Stage — optional. A feed reporting no round leaves it null rather
  //       than inventing a round 1.
  const roundInfo = asRecord(raw.roundInfo);
  const roundNumber = nonNegativeInt(roundInfo?.round);
  let stageId: string | null = null;
  if (roundInfo && roundNumber !== null) {
    const stageKey = `${editionId}:${roundNumber}`;
    stageId = caches.stages.get(stageKey) ?? null;
    if (!stageId) {
      stageId = await resolveCompetitionStage(
        tx,
        editionId,
        { ordinal: roundNumber, name: text(roundInfo.name) ?? `Round ${roundNumber}` },
        stage.for('football.competition_stage')
      );
      caches.stages.set(stageKey, stageId);
    }
  }

  // ── 4. Venue — optional.
  const venue = asRecord(raw.venue);
  const venueExternalId = externalId(venue?.id);
  let venueId: string | null = null;
  if (venue && venueExternalId) {
    venueId = caches.venues.get(venueExternalId) ?? null;
    if (!venueId) {
      const coordinates = asRecord(venue.venueCoordinates);
      venueId = await resolveVenue(
        tx,
        {
          externalId: venueExternalId,
          name: text(venue.name) ?? `Venue ${venueExternalId}`,
          city: text(asRecord(venue.city)?.name) ?? text(venue.city),
          countryName: text(asRecord(venue.country)?.name),
          latitude: typeof coordinates?.latitude === 'number' ? coordinates.latitude : null,
          longitude: typeof coordinates?.longitude === 'number' ? coordinates.longitude : null,
          capacity: nonNegativeInt(venue.capacity),
        },
        stage.for('football.venue')
      );
      caches.venues.set(venueExternalId, venueId);
    }
  }

  // ── 5. Teams ──────────────────────────────────────────────────────────────
  const homeId = await resolveTeamCached(tx, homeTeam, venueId, caches, stage);
  const awayId = await resolveTeamCached(tx, awayTeam, null, caches, stage);
  if (!homeId || !awayId) {
    stage.for('football.fixture').reject('a participant could not be resolved');
    return;
  }

  const registeredOn = utcDateString(kickoff);
  await recordTeamRegistration(tx, homeId, editionId, registeredOn, stage.for('football.team_registration'));
  await recordTeamRegistration(tx, awayId, editionId, registeredOn, stage.for('football.team_registration'));

  // ── 6. Fixture, and its lifecycle transition if the state moved ───────────
  const status = asRecord(raw.status);
  const fixture = await resolveFixture(
    tx,
    {
      externalId: fixtureExternalId,
      competitionEditionId: editionId,
      competitionStageId: stageId,
      venueId,
      // The stated home and away roles are how the fixture is CONSTITUTED, not
      // an assertion about geography. Neutral-venue fixtures retain their roles.
      isNeutralVenue: raw.neutralGround === true,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledKickoffAt: kickoff,
      providerStatusCode: typeof status?.code === 'number' ? status.code : null,
      providerStatusRaw: status ?? raw.status,
    },
    stage.for('football.fixture')
  );

  // The transition writer is called from resolveFixture, so its counts land on
  // the fixture relation. Attribute them where they belong.
  stage.for('football.fixture_lifecycle_transition');

  // ── 7. Result — only for a COMPLETED fixture ──────────────────────────────
  const homeScore = asRecord(raw.homeScore);
  const awayScore = asRecord(raw.awayScore);
  await recordResult(
    tx,
    fixture,
    {
      homeGoals: pickScore(homeScore, ['normaltime', 'current']),
      awayGoals: pickScore(awayScore, ['normaltime', 'current']),
      homeGoalsHalfTime: pickScore(homeScore, ['period1']),
      awayGoalsHalfTime: pickScore(awayScore, ['period1']),
      homeGoalsExtraTime: pickScore(homeScore, ['extra1', 'overtime']),
      awayGoalsExtraTime: pickScore(awayScore, ['extra1', 'overtime']),
      homePenalties: pickScore(homeScore, ['penalties']),
      awayPenalties: pickScore(awayScore, ['penalties']),
    },
    stage.for('football.result')
  );
}

async function resolveTeamCached(
  tx: PoolClient,
  team: Record<string, unknown>,
  homeVenueId: string | null,
  caches: ResolutionCaches,
  stage: StageAccumulator
): Promise<string | null> {
  const teamExternalId = externalId(team.id);
  if (!teamExternalId) return null;

  const cached = caches.teams.get(teamExternalId);
  if (cached) return cached;

  const id = await resolveTeam(
    tx,
    {
      externalId: teamExternalId,
      name: text(team.name) ?? `Team ${teamExternalId}`,
      shortName: text(team.shortName),
      countryName: text(asRecord(team.country)?.name),
      homeVenueId,
    },
    stage.for('football.team')
  );
  caches.teams.set(teamExternalId, id);
  return id;
}

/** The first present score among the provider's several spellings. */
function pickScore(score: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!score) return null;
  for (const key of keys) {
    const value = nonNegativeInt(score[key]);
    if (value !== null) return value;
  }
  return null;
}
