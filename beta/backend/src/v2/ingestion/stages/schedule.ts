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
import { asRecord, externalId, fromUnixSeconds, nonNegativeInt, text, utcDateString } from '../normalise';
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

export interface SeasonPeriod {
  readonly startsOn: string;
  readonly endsOn: string;
}

/**
 * Two digits to a year, on the standard pivot.
 *
 * The provider writes some seasons as `20/21`. 50 is the conventional pivot and
 * it is right for this data: the captured season list for competition 325 runs
 * from 2001 to 2026, and the only two-digit form in it is `20/21`. A `99/00`
 * season would resolve to 1999/2000, which is also correct.
 */
function pivotYear(twoDigits: string): number {
  const value = Number(twoDigits);
  return value < 50 ? 2000 + value : 1900 + value;
}

/**
 * Derives a bounded season period FROM THE SEASON'S OWN YEAR TOKEN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT TAKES NO KICKOFF, AND IT MUST NOT.
 *
 * This function previously accepted the fixture's kickoff and used it whenever a
 * label failed to parse. That is F-1: `season.name` is prose — "Brasileiro Serie
 * A 2026" — so it never parsed, every fixture derived a period from ITS OWN
 * date, and one provider season became two editions split at 1 July. The
 * signature is the fix. A period that cannot be derived from a fixture cannot be
 * derived differently for two fixtures of one season.
 *
 * THE SOURCE IS `season.year`, NOT `season.name`. The provider ships both on
 * every event and on every entry of `tournament_seasons`. `year` is the machine
 * field and is one of exactly two shapes across all 25 captured seasons of
 * competition 325 — `2026` and `20/21`. `name` is a display string carrying a
 * sponsor ("Brasileirão Betano 2024"), and the old code preferred it. That
 * preference was backwards.
 *
 * The captured `tournament_seasons` payload carries NO start or end dates —
 * its keys are exactly `id`, `name`, `year`, `tournamentId` — so an authoritative
 * period is not available from the provider and the year token is the strongest
 * source there is. If a future endpoint supplies real dates, they replace this.
 *
 * NULL MEANS REFUSE, and the caller rejects the fixture with a stated reason.
 * The alternative — guessing — is what F-1 was. A season the platform cannot
 * date is a governance problem to be seen, not a period to be invented.
 *
 * The conventions themselves are unchanged: a split season runs 1 July to 1
 * July, a calendar season 1 January to 1 January.
 */
export function seasonPeriod(yearToken: string | null | undefined): SeasonPeriod | null {
  const token = (yearToken ?? '').trim();
  if (token === '') return null;

  const calendar = token.match(/^(\d{4})$/);
  if (calendar) {
    const year = Number(calendar[1]);
    return { startsOn: `${year}-01-01`, endsOn: `${year + 1}-01-01` };
  }

  // `2025/2026`, `2025/26` and `20/21`, plus hyphen and en-dash separators.
  const split = token.match(/^(\d{4}|\d{2})\s*[/\-–]\s*(\d{4}|\d{2})$/);
  if (split) {
    const start = split[1].length === 4 ? Number(split[1]) : pivotYear(split[1]);
    const end = split[2].length === 4 ? Number(split[2]) : pivotYear(split[2]);
    // A split season spans exactly one year boundary. `2025/2027` is not a
    // season this platform can represent, and asserting a period for it would
    // be inventing one.
    if (end !== start + 1) return null;
    return { startsOn: `${start}-07-01`, endsOn: `${start + 1}-07-01` };
  }

  return null;
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
  // THE EDITION IS IDENTIFIED BY `season.id` AND DATED BY `season.year`. Neither
  // is derived from this fixture, which is what makes two fixtures of one season
  // resolve to one edition however far apart they kick off (F-1).
  const season = asRecord(raw.season);
  const seasonExternalId = externalId(season?.id);
  // `year` FIRST, because it is the machine field: across all 25 captured
  // seasons of competition 325 it is either `2026` or `20/21`, never prose.
  // `name` is a fallback rather than a second chance — `seasonPeriod` accepts
  // only a whole-string year token, so a prose name ("Brasileiro Serie A 2026",
  // "Brasileirão Betano 2024") still refuses. Nothing is extracted from prose,
  // which is the trap the tempting one-line fix falls into.
  const period = seasonPeriod(text(season?.year)) ?? seasonPeriod(text(season?.name));
  if (!seasonExternalId || !period) {
    stage
      .for('football.competition_edition')
      .reject(
        seasonExternalId
          ? `season ${seasonExternalId} has no interpretable year token; the edition cannot be dated`
          : 'event carries no season.id; the edition cannot be identified'
      );
    stage.for('football.fixture').reject('the fixture has no resolvable competition edition');
    logger.warn(
      { fixture: fixtureExternalId, season: seasonExternalId, year: text(season?.year) },
      'v2 ingestion: season could not be identified and dated, fixture not written'
    );
    return;
  }
  const seasonLabel = text(season?.name) ?? text(season?.year) ?? seasonExternalId;
  // Keyed on the PROVIDER SEASON, not on the derived period. The old cache key
  // was the period, so two derived periods were two cache entries and the cache
  // could not notice the split it was helping to create.
  const editionKey = `${competitionId}:${seasonExternalId}`;
  let editionId = caches.editions.get(editionKey);
  if (!editionId) {
    editionId = await resolveCompetitionEdition(
      tx,
      competitionId,
      {
        externalId: seasonExternalId,
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
