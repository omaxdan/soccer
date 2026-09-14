// ─────────────────────────────────────────────────────────────────────────────
// V2 READ API — HANDLERS (Phase B.2)
//
// Read-only composition over PERSISTED V2 state. Each handler takes a connection,
// issues schema-qualified SELECTs (plus the existing read surfaces), and returns a
// typed contract or null (→ 404). No writes, no calculation, no provider calls.
//
// Reuses, never reimplements:
//   • readCompletedFixtures  — recent form (feature/read)
//   • readActiveMatchReadings — the two active module readings (module/read, B.1)
// The only new SQL is the fixture/edition/team "header + list" projection the
// product needs and which no existing surface provides.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readCompletedFixtures } from '../feature/read/fixtures';
import { readRecentVenueFormRows, selectRecentVenueForm, type RecentVenueFormRow, type TeamRecentVenueForm } from '../feature/read/recentVenueForm';
import { readCurrentTeamFeatures, TEAM_PANEL_FEATURE_KEYS, type TeamFeatureValue } from '../feature/read/currentValues';
import { readActiveMatchReadings, ACTIVE_MODULE_KEYS, type TeamModuleReading } from '../module/read/readings';
import { readCurrentReadingEvidence, type ReadingEvidence } from '../module/read/evidence';
import { readMatchIntelligence } from '../snapshot/read/matchIntelligence';
import type {
  MatchDetailResponse,
  MatchIntelligenceResponse,
  MatchLineupsResponse,
  MatchTeamStatisticsResponse,
  MatchResultResponse,
  MatchLifecycleResponse,
  MatchVenueResponse,
  EditionFixtureListResponse,
  EditionListResponse,
  EditionStandingsResponse,
  ApiTeamIntelligence,
  ApiTeamFeatures,
  ApiModuleReading,
  ApiModuleEvidence,
  ApiFeatureValue,
  ApiFormFixture,
  ApiRecentFormRow,
  ApiTeamRecentVenueForm,
  ApiScore,
  ApiTeamSummary,
  ApiPlayerSummary,
  TeamListResponse,
  TeamDetailResponse,
  TeamPerformanceResponse,
  TeamReadinessResponse,
  VenueResponse,
  CountryResponse,
  CompetitionResponse,
  PlayerListResponse,
  PlayerDetailResponse,
} from './contract';
import {
  aggregatePlayerStatistics, mapRegistration, mapAvailability, mapValuation,
  type PlayerStatRow, type PlayerRegistrationRow, type PlayerAvailabilityRow, type PlayerValuationRow,
} from './read/playerStatistics';
import { readTeamIntelligence } from './read/teamIntelligence';
import { readEditionStandings } from './read/editionStandings';
import { readMatchLineups } from './read/matchLineups';
import { readMatchTeamStatistics } from './read/matchTeamStatistics';
import { readMatchResult } from './read/matchResult';
import { readMatchLifecycle } from './read/matchLifecycle';
import { readMatchVenue } from './read/matchVenue';
import { readTeamPerformance } from './read/teamPerformance';
import { readTeamReadiness } from './read/teamReadiness';
import { readVenue } from './read/venue';
import { mapCountry, mapCompetitionSummary, buildCountryCoverage, type CountryRow, type CountryCompetitionRow } from './read/country';
import { mapCompetition, mapCompetitionEdition, buildCompetitionCoverage, type CompetitionRow, type CompetitionEditionRow } from './read/competition';

/** A fixture id is a bigint. Reject anything else BEFORE touching the database. */
export function isValidId(raw: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(raw);
}

/** A country is addressed by its ISO 3166-1 alpha-2 code (already upper-cased by the router). */
export function isValidCountryCode(raw: string): boolean {
  return /^[A-Z]{2}$/.test(raw);
}

const iso = (d: Date): string => new Date(d).toISOString();
const score = (h: number | null, a: number | null): ApiScore | null =>
  h === null || a === null ? null : { home: Number(h), away: Number(a) };

/** Projects a persisted evidence set to the wire shape. Counts/values pass through unchanged (zeros preserved). */
function toEvidenceDto(e: ReadingEvidence): ApiModuleEvidence {
  return {
    declaredInputCount: e.declaredInputCount,
    presentInputCount: e.presentInputCount,
    belowThresholdInputCount: e.belowThresholdInputCount,
    estimatedInputCount: e.estimatedInputCount,
    items: e.items.map((i) => ({
      featureKey: i.featureKey,
      displayName: i.displayName,
      value: i.value,
      asOf: i.asOf === null ? null : iso(i.asOf),
      contributionDirection: i.contributionDirection,
    })),
  };
}

/** Projects a persisted reading to the wire shape, attaching its evidence when present. */
function toReadingDto(r: TeamModuleReading, evidence: ReadingEvidence | undefined): ApiModuleReading {
  return {
    moduleKey: r.moduleKey,
    status: r.moduleStatusCode,
    strength: r.strength,
    confidence: r.confidence,
    sampleObservationCount: r.sampleObservationCount,
    sampleMeetsThreshold: r.sampleMeetsThreshold,
    asOf: iso(r.asOf),
    verdictText: r.verdictText,
    inactiveReason: r.inactiveReason,
    evidence: evidence ? toEvidenceDto(evidence) : null,
  };
}

function toFeatureDto(v: TeamFeatureValue): ApiFeatureValue {
  return { value: v.value, sampleObservationCount: v.sampleObservationCount, sampleMeetsThreshold: v.sampleMeetsThreshold, asOf: iso(v.asOf) };
}

/**
 * Pure mapping of the flat feature list into per-team panel features. A feature
 * with no persisted value for a team is `null` — never fabricated, never zeroed.
 * Exported so the "missing value" semantics are unit-testable without a database.
 */
export function mapTeamFeatures(
  values: readonly TeamFeatureValue[],
  homeTeamId: string,
  awayTeamId: string
): { home: ApiTeamFeatures; away: ApiTeamFeatures } {
  const pick = (teamId: string, featureKey: string): ApiFeatureValue | null => {
    const found = values.find((v) => v.teamId === teamId && v.featureKey === featureKey);
    return found ? toFeatureDto(found) : null;
  };
  const forTeam = (teamId: string): ApiTeamFeatures => ({
    homeForm: pick(teamId, 'team.home_form'),
    awayForm: pick(teamId, 'team.away_form'),
    momentum: pick(teamId, 'team.momentum'),
    rest: pick(teamId, 'team.rest_advantage'),
    congestion: pick(teamId, 'team.congestion_index'),
  });
  return { home: forTeam(homeTeamId), away: forTeam(awayTeamId) };
}

/**
 * Pure mapping of the flat readings list into per-team intelligence. A module with
 * no persisted reading for a team is `null` — never fabricated. Exported so the
 * "missing reading" semantics are unit-testable without a database.
 */
export function mapIntelligence(
  readings: readonly TeamModuleReading[],
  homeTeamId: string,
  awayTeamId: string,
  evidence: readonly ReadingEvidence[] = []
): { home: ApiTeamIntelligence; away: ApiTeamIntelligence } {
  const evidenceKey = (teamId: string, moduleKey: string): string => `${teamId}|${moduleKey}`;
  const evidenceByKey = new Map(evidence.map((e) => [evidenceKey(e.teamId, e.moduleKey), e]));
  const pick = (teamId: string, moduleKey: string): ApiModuleReading | null => {
    const found = readings.find((r) => r.teamId === teamId && r.moduleKey === moduleKey);
    return found ? toReadingDto(found, evidenceByKey.get(evidenceKey(teamId, moduleKey))) : null;
  };
  const forTeam = (teamId: string): ApiTeamIntelligence => ({
    readiness: pick(teamId, 'readiness_tracker'),
    homeAwaySplit: pick(teamId, 'home_away_split'),
  });
  return { home: forTeam(homeTeamId), away: forTeam(awayTeamId) };
}

interface HeaderRow {
  fixture_id: string;
  scheduled_kickoff_at: Date;
  lifecycle_state_code: string;
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  home_id: string; home_name: string; home_slug: string;
  away_id: string; away_name: string; away_slug: string;
  home_goals: number | null;
  away_goals: number | null;
}

const FIXTURE_HEADER_SQL = `
  SELECT f.id::text                       AS fixture_id,
         f.scheduled_kickoff_at           AS scheduled_kickoff_at,
         f.lifecycle_state_code           AS lifecycle_state_code,
         e.id::text                       AS edition_id,
         e.season_label                   AS season_label,
         c.id::text                       AS competition_id,
         c.name                           AS competition_name,
         c.slug                           AS competition_slug,
         hf.id::text AS home_id, hf.name AS home_name, hf.slug AS home_slug,
         af.id::text AS away_id, af.name AS away_name, af.slug AS away_slug,
         r.home_goals                     AS home_goals,
         r.away_goals                     AS away_goals
    FROM football.fixture f
    JOIN football.competition_edition e ON e.id = f.competition_edition_id
    JOIN football.competition c         ON c.id = e.competition_id
    JOIN football.team hf               ON hf.id = f.home_team_id
    JOIN football.team af               ON af.id = f.away_team_id
    LEFT JOIN football.result r         ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.id = $1::bigint
`;

const toFormFixtures = (history: { fixtures: readonly { fixtureId: string; kickoffAt: Date; isHome: boolean; goalsFor: number | null; goalsAgainst: number | null }[] } | undefined): ApiFormFixture[] =>
  (history?.fixtures ?? []).map((f) => ({
    fixtureId: f.fixtureId,
    kickoffAt: iso(f.kickoffAt),
    isHome: f.isHome,
    goalsFor: f.goalsFor === null ? null : Number(f.goalsFor),
    goalsAgainst: f.goalsAgainst === null ? null : Number(f.goalsAgainst),
  }));

/** Projects one enriched recent-form row to the wire shape (dates → ISO). Pure. */
function toRecentFormRow(r: RecentVenueFormRow): ApiRecentFormRow {
  return {
    fixtureId: r.fixtureId,
    kickoffAt: iso(r.kickoffAt),
    isHome: r.isHome,
    goalsFor: r.goalsFor === null ? null : Number(r.goalsFor),
    goalsAgainst: r.goalsAgainst === null ? null : Number(r.goalsAgainst),
    opponent: r.opponent,
    venueName: r.venueName,
    competition: r.competition,
  };
}

/**
 * Projects a team's raw recent-form rows into the PD-11 venue-split wire shape.
 * Pure — selection (five per side, most-recent-first) is delegated to
 * `selectRecentVenueForm`, so the semantics are unit-testable without a database.
 * A team with no rows yields two empty sides — never fabricated, never mixed.
 */
export function toTeamRecentVenueForm(rows: readonly RecentVenueFormRow[] | undefined): ApiTeamRecentVenueForm {
  const selected: TeamRecentVenueForm = selectRecentVenueForm(rows ?? []);
  return {
    lastHome: selected.lastHome.map(toRecentFormRow),
    lastAway: selected.lastAway.map(toRecentFormRow),
  };
}

/**
 * Assembles the match-detail contract for one fixture, or null when it does not
 * exist. Form and intelligence are read AS OF the kickoff (pre-match), so a value
 * never sees the fixture it describes.
 */
export async function getMatchDetail(tx: PoolClient, fixtureId: string): Promise<MatchDetailResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];
  const asOf = new Date(h.scheduled_kickoff_at);

  const form = await readCompletedFixtures(tx, [h.home_id, h.away_id], asOf);
  // PD-11 Recent Venue Form — CONTEXT ONLY. Same `asOf = kickoff` boundary as every
  // other read here (strict `< asOf` in SQL), so the subject fixture can never enter
  // its own context. Sourced by a dedicated read that feeds no calculator.
  const venueForm = await readRecentVenueFormRows(tx, [h.home_id, h.away_id], asOf);
  const readings = await readActiveMatchReadings(tx, {
    homeTeamId: h.home_id,
    awayTeamId: h.away_id,
    competitionEditionId: h.edition_id,
    asOf,
  });
  // Persisted evidence behind those readings — same teams, module set and context
  // scope, at the same kickoff boundary, so evidence resolves for exactly the
  // readings shown (and only engaged ones; INACTIVE readings carry none).
  const evidence = await readCurrentReadingEvidence(tx, {
    teamIds: [h.home_id, h.away_id],
    asOf,
    moduleKeys: [...ACTIVE_MODULE_KEYS],
    contextCompetitionEditionId: h.edition_id,
  });
  // Team Intelligence panel features — persisted, as of the same kickoff boundary.
  const features = await readCurrentTeamFeatures(tx, {
    teamIds: [h.home_id, h.away_id],
    asOf,
    featureKeys: [...TEAM_PANEL_FEATURE_KEYS],
  });

  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      edition: { id: h.edition_id, seasonLabel: h.season_label },
      homeTeam: { id: h.home_id, name: h.home_name, slug: h.home_slug },
      awayTeam: { id: h.away_id, name: h.away_name, slug: h.away_slug },
      score: score(h.home_goals, h.away_goals),
    },
    form: {
      home: toFormFixtures(form.get(h.home_id)),
      away: toFormFixtures(form.get(h.away_id)),
    },
    recentVenueForm: {
      home: toTeamRecentVenueForm(venueForm.get(h.home_id)),
      away: toTeamRecentVenueForm(venueForm.get(h.away_id)),
    },
    intelligence: mapIntelligence(readings, h.home_id, h.away_id, evidence),
    teamFeatures: mapTeamFeatures(features, h.home_id, h.away_id),
  };
}

/**
 * A fixture's ACTUAL reported lineups (football.lineup / lineup_selection), or null
 * when the fixture does not exist. Reuses the match-surface existence gate
 * (FIXTURE_HEADER_SQL) for identity, then delegates the lineup projection to the read
 * model. Observed evidence only — never a predicted XI. No writes, no calculation.
 */
export async function getMatchLineups(tx: PoolClient, fixtureId: string): Promise<MatchLineupsResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];

  const homeTeam = { id: h.home_id, name: h.home_name, slug: h.home_slug };
  const awayTeam = { id: h.away_id, name: h.away_name, slug: h.away_slug };
  const lineups = await readMatchLineups(tx, fixtureId, homeTeam, awayTeam);

  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      homeTeam,
      awayTeam,
    },
    lineups,
  };
}

/**
 * A fixture's TEAM-level match statistics (football.team_match_statistic), or null
 * when the fixture does not exist. Reuses the match-surface existence gate
 * (FIXTURE_HEADER_SQL) for identity/orientation, then delegates the projection to the
 * read model. Observed provider evidence only — raw strings, no arithmetic, no
 * intelligence. No writes.
 */
export async function getMatchTeamStatistics(tx: PoolClient, fixtureId: string): Promise<MatchTeamStatisticsResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];

  const teamStatistics = await readMatchTeamStatistics(tx, fixtureId);
  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      homeTeam: { id: h.home_id, name: h.home_name, slug: h.home_slug },
      awayTeam: { id: h.away_id, name: h.away_name, slug: h.away_slug },
    },
    teamStatistics,
  };
}

/**
 * A fixture's COMPLETE observed scoreline (football.result) — final, half-time,
 * extra-time, penalties, confirmed-at — or null when the fixture does not exist.
 * Reuses the match-surface existence gate (FIXTURE_HEADER_SQL) for identity and
 * home/away orientation, then delegates the projection to the read model. Observed
 * evidence only — no derived outcome. No writes.
 */
export async function getMatchResult(tx: PoolClient, fixtureId: string): Promise<MatchResultResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];

  const { result, coverage } = await readMatchResult(tx, fixtureId);
  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      homeTeam: { id: h.home_id, name: h.home_name, slug: h.home_slug },
      awayTeam: { id: h.away_id, name: h.away_name, slug: h.away_slug },
    },
    result,
    coverage,
  };
}

/**
 * A fixture's APPEND-ONLY lifecycle history (football.fixture_lifecycle_transition),
 * or null when the fixture does not exist. Reuses the match-surface existence gate
 * (FIXTURE_HEADER_SQL) for identity, then delegates the projection to the read model.
 * Observed evidence only — no derived risk/prediction. No writes.
 */
export async function getMatchLifecycle(tx: PoolClient, fixtureId: string): Promise<MatchLifecycleResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];

  const lifecycle = await readMatchLifecycle(tx, fixtureId);
  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      homeTeam: { id: h.home_id, name: h.home_name, slug: h.home_slug },
      awayTeam: { id: h.away_id, name: h.away_name, slug: h.away_slug },
    },
    lifecycle,
  };
}

/**
 * A fixture's ACTUAL recorded venue (football.venue via football.fixture.venue_id)
 * and neutral-venue flag, or null when the fixture does not exist. Reuses the
 * match-surface existence gate (FIXTURE_HEADER_SQL) for identity, then delegates the
 * venue projection to the read model. Observed evidence only — no derived
 * home-advantage/travel/risk. No writes.
 */
export async function getMatchVenue(tx: PoolClient, fixtureId: string): Promise<MatchVenueResponse | null> {
  const header = await tx.query<HeaderRow>(FIXTURE_HEADER_SQL, [fixtureId]);
  if (header.rows.length === 0) return null;
  const h = header.rows[0];

  const { venue, isNeutralVenue, coverage } = await readMatchVenue(tx, fixtureId);
  return {
    match: {
      fixtureId: h.fixture_id,
      kickoffAt: iso(h.scheduled_kickoff_at),
      status: h.lifecycle_state_code,
      competition: { id: h.competition_id, name: h.competition_name, slug: h.competition_slug },
      homeTeam: { id: h.home_id, name: h.home_name, slug: h.home_slug },
      awayTeam: { id: h.away_id, name: h.away_name, slug: h.away_slug },
    },
    venue,
    isNeutralVenue,
    coverage,
  };
}

/**
 * Match Intelligence (Slice 2): the SEALED governed intelligence for a fixture,
 * plus the live contextual match detail, as two strictly separate properties.
 *
 * SEALED-ONLY for `intelligence`: it is produced solely by the Slice-1 read model
 * `readMatchIntelligence` (verdict, edges, Team Preparedness, cited evidence,
 * provenance). If the fixture has no sealed snapshot, this returns null → the route
 * responds with the established not-found convention. It NEVER fabricates an
 * intelligence object from live data.
 *
 * `context` is the existing live `getMatchDetail` composition (header, recent form,
 * venue form, live module readings, team features) — useful surrounding information,
 * NOT calculation substrate. The two are never merged: cited evidence lives only in
 * `intelligence.citedEvidence`; nothing from `context` is presented as cited evidence.
 * No writes, no calculation, no mutation — pure read orchestration reusing Slice 1.
 */
export async function getMatchIntelligence(
  tx: PoolClient,
  fixtureId: string
): Promise<MatchIntelligenceResponse | null> {
  const intelligence = await readMatchIntelligence(tx, fixtureId);
  if (intelligence === null) return null; // sealed-only: no snapshot ⇒ 404, never a live fabrication
  const context = await getMatchDetail(tx, fixtureId); // live/contextual, kept strictly separate
  return { intelligence, context };
}

interface EditionRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
}
interface EditionFixtureRow {
  fixture_id: string;
  scheduled_kickoff_at: Date;
  lifecycle_state_code: string;
  home_id: string; home_name: string; home_slug: string;
  away_id: string; away_name: string; away_slug: string;
  home_goals: number | null;
  away_goals: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAY-1 GOVERNED EXPOSURE (PD-D1.1)
//
// The public Day-1 edition navigation exposes ONLY the authorized/certified active
// edition. An edition is exposed iff it is linked to a governance.tracked_edition
// that is ACTIVE and authorized_for_ingestion, under a tracked_competition whose
// tracking_status is TRACKED — the existing governed authorization contract
// (migration 025), never a name/date heuristic. This is a public READ/exposure
// filter only: it changes no snapshot eligibility, no ingestion lifecycle, and no
// fixture lifecycle semantics. Other ingested editions remain fully in the data;
// they are simply not surfaced through Day-1 navigation until Product Owner policy
// activates them. The read API role (pt_platform_admin) holds SELECT + policy on
// these governance relations (migration 025), so the join is authorized under RLS.
// ─────────────────────────────────────────────────────────────────────────────
const DAY1_AUTHORIZED_EDITION_JOIN = `
    JOIN governance.tracked_edition te
      ON te.competition_edition_id = e.id
     AND te.edition_status_code = 'ACTIVE'
     AND te.authorized_for_ingestion = true
    JOIN governance.tracked_competition tc
      ON tc.id = te.tracked_competition_id
     AND tc.tracking_status_code = 'TRACKED'`;

const EDITION_HEADER_SQL = `
  SELECT e.id::text AS edition_id, e.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug
    FROM football.competition_edition e
    JOIN football.competition c ON c.id = e.competition_id
${DAY1_AUTHORIZED_EDITION_JOIN}
   WHERE e.id = $1::bigint
`;

const EDITION_FIXTURES_SQL = `
  SELECT f.id::text AS fixture_id, f.scheduled_kickoff_at AS scheduled_kickoff_at,
         f.lifecycle_state_code AS lifecycle_state_code,
         hf.id::text AS home_id, hf.name AS home_name, hf.slug AS home_slug,
         af.id::text AS away_id, af.name AS away_name, af.slug AS away_slug,
         r.home_goals AS home_goals, r.away_goals AS away_goals
    FROM football.fixture f
    JOIN football.team hf ON hf.id = f.home_team_id
    JOIN football.team af ON af.id = f.away_team_id
    LEFT JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.competition_edition_id = $1::bigint
   ORDER BY f.scheduled_kickoff_at, f.id
`;

interface EditionSummaryRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  fixture_count: string;
}

const EDITION_LIST_SQL = `
  SELECT e.id::text AS edition_id, e.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         count(f.id)::text AS fixture_count
    FROM football.competition_edition e
    JOIN football.competition c ON c.id = e.competition_id
    JOIN football.fixture f     ON f.competition_edition_id = e.id
${DAY1_AUTHORIZED_EDITION_JOIN}
   GROUP BY e.id, e.season_label, c.id, c.name, c.slug
   ORDER BY c.name, e.season_label
`;

/**
 * Lists the editions exposed for Day-1: those with materialized fixtures that are
 * ALSO governed-authorized for public exposure (PD-D1.1 — ACTIVE, authorized
 * tracked_edition under a TRACKED competition). Read-only; filters BY governance
 * without exposing any governance data, and performs no writes.
 */
export async function getEditions(tx: PoolClient): Promise<EditionListResponse> {
  const rows = await tx.query<EditionSummaryRow>(EDITION_LIST_SQL);
  return {
    editions: rows.rows.map((e) => ({
      id: e.edition_id,
      seasonLabel: e.season_label,
      competition: { id: e.competition_id, name: e.competition_name, slug: e.competition_slug },
      fixtureCount: Number(e.fixture_count),
    })),
  };
}

/**
 * An edition's league table(s) — the standings projection — or null when the edition
 * is not governed-exposed. Reuses the SAME Day-1 exposure gate as the fixtures list
 * (EDITION_HEADER_SQL) so no ungoverned edition is surfaced, then delegates the
 * standings projection to the read model. Observed evidence only; no intelligence.
 */
export async function getEditionStandings(tx: PoolClient, editionId: string): Promise<EditionStandingsResponse | null> {
  const ed = await tx.query<EditionRow>(EDITION_HEADER_SQL, [editionId]);
  if (ed.rows.length === 0) return null;
  const e = ed.rows[0];

  const standings = await readEditionStandings(tx, editionId);
  return {
    edition: {
      id: e.edition_id,
      seasonLabel: e.season_label,
      competition: { id: e.competition_id, name: e.competition_name, slug: e.competition_slug },
    },
    standings,
  };
}

/** Lists an edition's fixtures for a league page, or null when the edition does not exist. */
export async function getEditionFixtures(tx: PoolClient, editionId: string): Promise<EditionFixtureListResponse | null> {
  const ed = await tx.query<EditionRow>(EDITION_HEADER_SQL, [editionId]);
  if (ed.rows.length === 0) return null;
  const e = ed.rows[0];

  const rows = await tx.query<EditionFixtureRow>(EDITION_FIXTURES_SQL, [editionId]);
  return {
    edition: {
      id: e.edition_id,
      seasonLabel: e.season_label,
      competition: { id: e.competition_id, name: e.competition_name, slug: e.competition_slug },
    },
    fixtures: rows.rows.map((f) => ({
      fixtureId: f.fixture_id,
      kickoffAt: iso(f.scheduled_kickoff_at),
      status: f.lifecycle_state_code,
      homeTeam: { id: f.home_id, name: f.home_name, slug: f.home_slug },
      awayTeam: { id: f.away_id, name: f.away_name, slug: f.away_slug },
      score: score(f.home_goals, f.away_goals),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS & PLAYERS — factual directory + identity surfaces (read-only).
//
// Every team/player exposed is scoped to the governed authorized-active edition
// (the same Day-1 gate as the edition list), so no ungoverned or V1 data leaks.
// These are context surfaces: identity + biography + current registration + a
// short results tail — NO intelligence reading, NO fabricated statistic. "Current
// squad / registration" filters on registration_period @> current_date, which is
// a factual "who is registered now" question — deliberately distinct from, and not
// a change to, the as_of=kickoff temporal contract that governs match intelligence.
// ─────────────────────────────────────────────────────────────────────────────

// Governed-edition join for queries that alias football.competition_edition as `ce`
// (mirrors DAY1_AUTHORIZED_EDITION_JOIN, which aliases it `e`).
const GOVERNED_EDITION_JOIN_CE = `
    JOIN governance.tracked_edition te
      ON te.competition_edition_id = ce.id
     AND te.edition_status_code = 'ACTIVE'
     AND te.authorized_for_ingestion = true
    JOIN governance.tracked_competition tc
      ON tc.id = te.tracked_competition_id
     AND tc.tracking_status_code = 'TRACKED'`;

interface TeamSummaryRow { id: string; name: string; slug: string; short_name: string | null; country_code: string | null }
const toTeamSummary = (r: TeamSummaryRow): ApiTeamSummary =>
  ({ id: r.id, name: r.name, slug: r.slug, shortName: r.short_name, countryCode: r.country_code });

const TEAMS_LIST_SQL = `
  SELECT DISTINCT t.id::text AS id, t.name AS name, t.slug AS slug,
         t.short_name AS short_name, t.country_code AS country_code
    FROM football.team t
    JOIN football.team_registration tr ON tr.team_id = t.id AND tr.withdrawn_on IS NULL
    JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
${GOVERNED_EDITION_JOIN_CE}
   ORDER BY t.name
`;

/** Teams registered in a governed authorized-active edition. Directory, identity only. */
export async function getTeams(tx: PoolClient): Promise<TeamListResponse> {
  const rows = await tx.query<TeamSummaryRow>(TEAMS_LIST_SQL);
  return { teams: rows.rows.map(toTeamSummary) };
}

interface TeamCompetitionRow { edition_id: string; season_label: string; competition_id: string; competition_name: string; competition_slug: string }
const TEAM_COMPETITIONS_SQL = `
  SELECT ce.id::text AS edition_id, ce.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug
    FROM football.team_registration tr
    JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
${GOVERNED_EDITION_JOIN_CE}
   WHERE tr.team_id = $1::bigint AND tr.withdrawn_on IS NULL
   ORDER BY c.name, ce.season_label
`;

interface TeamIdentityRow extends TeamSummaryRow { home_venue_name: string | null }
const TEAM_IDENTITY_SQL = `
  SELECT t.id::text AS id, t.name AS name, t.slug AS slug, t.short_name AS short_name,
         t.country_code AS country_code, v.name AS home_venue_name
    FROM football.team t
    LEFT JOIN football.venue v ON v.id = t.home_venue_id
   WHERE t.id = $1::bigint
`;

interface PlayerSummaryRow { id: string; full_name: string; short_name: string | null; slug: string }
const TEAM_SQUAD_SQL = `
  SELECT p.id::text AS id, p.full_name AS full_name, p.short_name AS short_name, p.slug AS slug
    FROM football.player_registration pr
    JOIN football.player p ON p.id = pr.player_id
   WHERE pr.team_id = $1::bigint
     AND pr.registration_kind_code <> 'LOAN_OUT'
     AND pr.registration_period @> current_date
   ORDER BY p.full_name
`;

interface TeamResultRow {
  fixture_id: string; scheduled_kickoff_at: Date; is_home: boolean;
  goals_for: number | null; goals_against: number | null;
  opp_id: string; opp_name: string; opp_slug: string;
}
const TEAM_RESULTS_SQL = `
  WITH played AS (
    SELECT f.id AS fixture_id, f.scheduled_kickoff_at, true AS is_home,
           r.home_goals AS goals_for, r.away_goals AS goals_against, f.away_team_id AS opp_id
      FROM football.fixture f
      JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
     WHERE f.home_team_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
    UNION ALL
    SELECT f.id, f.scheduled_kickoff_at, false,
           r.away_goals, r.home_goals, f.home_team_id
      FROM football.fixture f
      JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
     WHERE f.away_team_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
  )
  SELECT played.fixture_id::text AS fixture_id, played.scheduled_kickoff_at, played.is_home,
         played.goals_for, played.goals_against,
         o.id::text AS opp_id, o.name AS opp_name, o.slug AS opp_slug
    FROM played
    JOIN football.team o ON o.id = played.opp_id
   ORDER BY played.scheduled_kickoff_at DESC, played.fixture_id DESC
   LIMIT 8
`;

/**
 * A team's identity + governed competition context + current squad + a short
 * results tail, or null when the team is not exposed under a governed edition.
 */
export async function getTeamDetail(tx: PoolClient, teamId: string): Promise<TeamDetailResponse | null> {
  // Exposure gate: the team must be registered in a governed authorized edition.
  const comps = await tx.query<TeamCompetitionRow>(TEAM_COMPETITIONS_SQL, [teamId]);
  if (comps.rows.length === 0) return null;

  const idRes = await tx.query<TeamIdentityRow>(TEAM_IDENTITY_SQL, [teamId]);
  if (idRes.rows.length === 0) return null;
  const t = idRes.rows[0];

  const squadRes = await tx.query<PlayerSummaryRow>(TEAM_SQUAD_SQL, [teamId]);
  const resultsRes = await tx.query<TeamResultRow>(TEAM_RESULTS_SQL, [teamId]);
  const teamSummary = toTeamSummary(t);
  // The Team Intelligence workspace projection (raw evidence + read-model aggregation only).
  const intelligence = await readTeamIntelligence(tx, teamId);

  return {
    team: { ...teamSummary, homeVenueName: t.home_venue_name },
    competitions: comps.rows.map((c) => ({
      editionId: c.edition_id,
      seasonLabel: c.season_label,
      competition: { id: c.competition_id, name: c.competition_name, slug: c.competition_slug },
    })),
    squad: squadRes.rows.map((p) => ({ id: p.id, fullName: p.full_name, shortName: p.short_name, slug: p.slug, team: teamSummary })),
    recentResults: resultsRes.rows.map((r) => ({
      fixtureId: r.fixture_id,
      kickoffAt: iso(r.scheduled_kickoff_at),
      isHome: r.is_home,
      opponent: { id: r.opp_id, name: r.opp_name, slug: r.opp_slug },
      goalsFor: r.goals_for === null ? null : Number(r.goals_for),
      goalsAgainst: r.goals_against === null ? null : Number(r.goals_against),
    })),
    intelligence,
  };
}

/**
 * A team's descriptive performance evidence (persisted features), or null when the
 * team is not in a governed authorized edition. Reuses the SAME governed exposure
 * gate as Team Detail (TEAM_COMPETITIONS_SQL) for identity + the scoped-edition list,
 * then delegates the projection to the read model. No calculation, no writes; every
 * value is read verbatim from feature.feature_value.
 */
export async function getTeamPerformance(tx: PoolClient, teamId: string): Promise<TeamPerformanceResponse | null> {
  // Exposure gate: the team must be registered in a governed authorized edition.
  const comps = await tx.query<TeamCompetitionRow>(TEAM_COMPETITIONS_SQL, [teamId]);
  if (comps.rows.length === 0) return null;

  const idRes = await tx.query<TeamIdentityRow>(TEAM_IDENTITY_SQL, [teamId]);
  if (idRes.rows.length === 0) return null;

  const editions = comps.rows.map((c) => ({
    id: c.edition_id,
    seasonLabel: c.season_label,
    competition: { id: c.competition_id, name: c.competition_name, slug: c.competition_slug },
  }));
  const performance = await readTeamPerformance(tx, teamId, editions);

  return {
    team: toTeamSummary(idRes.rows[0]),
    overall: performance.overall,
    byCompetition: performance.byCompetition,
    coverage: performance.coverage,
  };
}

/**
 * A team's GOVERNED readiness reading (readiness_tracker), or null when the team is
 * not in a governed authorized edition. Reuses the SAME exposure gate as Team Detail
 * (TEAM_COMPETITIONS_SQL) — the readiness reader is reached only after the gate
 * succeeds — then delegates to the read model, which reuses the existing
 * quarantine-aware current-reading reader. No calculation, no writes.
 */
export async function getTeamReadiness(tx: PoolClient, teamId: string): Promise<TeamReadinessResponse | null> {
  // Exposure gate: the team must be registered in a governed authorized edition.
  const comps = await tx.query<TeamCompetitionRow>(TEAM_COMPETITIONS_SQL, [teamId]);
  if (comps.rows.length === 0) return null;

  const idRes = await tx.query<TeamIdentityRow>(TEAM_IDENTITY_SQL, [teamId]);
  if (idRes.rows.length === 0) return null;

  const { readiness, coverage } = await readTeamReadiness(tx, teamId);
  return { team: toTeamSummary(idRes.rows[0]), readiness, coverage };
}

/**
 * The canonical Venue entity (identity + geography + canonical home teams), or null
 * when the venue does not exist. Read-only Evidence/Context; delegates entirely to
 * the venue read model. No governance gate (venues are not governed entities), no
 * travel/map calculation, no governed reading.
 */
export async function getVenue(tx: PoolClient, venueId: string): Promise<VenueResponse | null> {
  return readVenue(tx, venueId);
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTRY — canonical entity keystone (identity + canonical members). Read-only.
//
// football.country is a governed code vocabulary keyed by ISO alpha-2 `code`. The
// country's own existence is the gate (404 when the code is unknown). Its members —
// teams and competitions — are the CANONICAL foreign-key relationships
// (team.country_code / competition.country_code), never inferred from matches,
// venues, or fixtures, and each is surfaced through the SAME Day-1 governed exposure
// gate as the teams directory and edition list. So Country never lists an entity that
// /teams/:id or the edition list would hide: no ungoverned/V1 leaks, no broken links.
// Identity/Context only — no geography, ranking, readiness, performance, or prediction.
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_SQL = `
  SELECT c.code AS code, c.display_name AS display_name, c.alpha3_code AS alpha3_code
    FROM football.country c
   WHERE c.code = $1::text
   LIMIT 1
`;

// Teams whose CANONICAL country is this one, exposed through the governed gate
// (mirrors TEAMS_LIST_SQL, adding only the canonical country filter).
const COUNTRY_TEAMS_SQL = `
  SELECT DISTINCT t.id::text AS id, t.name AS name, t.slug AS slug,
         t.short_name AS short_name, t.country_code AS country_code
    FROM football.team t
    JOIN football.team_registration tr ON tr.team_id = t.id AND tr.withdrawn_on IS NULL
    JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
${GOVERNED_EDITION_JOIN_CE}
   WHERE t.country_code = $1::text
   ORDER BY t.name
`;

// Competitions whose CANONICAL country is this one, exposed through the governed gate
// (only competitions with an authorized-active edition, mirroring the edition list).
const COUNTRY_COMPETITIONS_SQL = `
  SELECT DISTINCT c.id::text AS id, c.name AS name, c.slug AS slug
    FROM football.competition c
    JOIN football.competition_edition e ON e.competition_id = c.id
${DAY1_AUTHORIZED_EDITION_JOIN}
   WHERE c.country_code = $1::text
   ORDER BY c.name
`;

/**
 * The canonical Country entity (identity + canonically-related governed teams and
 * competitions), or null when the country code is unknown (→ 404). The country
 * existence check gates BEFORE the member reads, so an unknown code never queries
 * teams or competitions. Read-only Identity/Context; no governed intelligence.
 */
export async function getCountry(tx: PoolClient, countryCode: string): Promise<CountryResponse | null> {
  const cRes = await tx.query<CountryRow>(COUNTRY_SQL, [countryCode]);
  if (cRes.rows.length === 0) return null;

  const teamRes = await tx.query<TeamSummaryRow>(COUNTRY_TEAMS_SQL, [countryCode]);
  const compRes = await tx.query<CountryCompetitionRow>(COUNTRY_COMPETITIONS_SQL, [countryCode]);
  const teams = teamRes.rows.map(toTeamSummary);
  const competitions = compRes.rows.map(mapCompetitionSummary);
  return {
    country: mapCountry(cRes.rows[0]),
    teams,
    competitions,
    coverage: buildCountryCoverage(teams, competitions),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITION — canonical entity keystone (identity + canonical editions). Read-only.
//
// A competition is EXPOSED iff it has an authorized-active edition under a TRACKED
// competition — the SAME Day-1 governed gate as the edition list and Country's
// competitions. So the competition's existence-under-governance IS the gate: an
// unknown OR unauthorized competition is a 404 (the two are not distinguished
// externally), and the gate runs BEFORE the editions read. Editions come from the
// canonical competition_edition.competition_id relationship (never inferred from
// fixtures/matches/standings); the LEFT JOIN to fixture only counts them. Because the
// gate is itself edition-based, a gated competition always has ≥1 governed edition —
// so editions:'absent' is a defensive coverage state, not expected in production.
// Identity/Context only — no standings, league intelligence, ranking, or prediction.
// ─────────────────────────────────────────────────────────────────────────────

const COMPETITION_SQL = `
  SELECT c.id::text AS id, c.name AS name, c.slug AS slug, c.country_code AS country_code
    FROM football.competition c
   WHERE c.id = $1::bigint
     AND EXISTS (
       SELECT 1
         FROM football.competition_edition e
${DAY1_AUTHORIZED_EDITION_JOIN}
        WHERE e.competition_id = c.id
     )
   LIMIT 1
`;

// Governed authorized-active editions of this competition (canonical competition_id
// relationship; fixtures LEFT-joined only to count them, mirroring the edition list).
const COMPETITION_EDITIONS_SQL = `
  SELECT e.id::text AS edition_id, e.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         count(f.id)::text AS fixture_count
    FROM football.competition_edition e
    JOIN football.competition c ON c.id = e.competition_id
${DAY1_AUTHORIZED_EDITION_JOIN}
    LEFT JOIN football.fixture f ON f.competition_edition_id = e.id
   WHERE e.competition_id = $1::bigint
   GROUP BY e.id, e.season_label, c.id, c.name, c.slug
   ORDER BY e.season_label
`;

/**
 * The canonical Competition entity (identity + its governed editions), or null when
 * the competition is unknown or has no governed edition (→ 404). The governed gate
 * check runs BEFORE the editions read, so a hidden competition never queries editions.
 * Read-only Identity/Context; no standings, no league intelligence.
 */
export async function getCompetition(tx: PoolClient, competitionId: string): Promise<CompetitionResponse | null> {
  const cRes = await tx.query<CompetitionRow>(COMPETITION_SQL, [competitionId]);
  if (cRes.rows.length === 0) return null;

  const edRes = await tx.query<CompetitionEditionRow>(COMPETITION_EDITIONS_SQL, [competitionId]);
  const editions = edRes.rows.map(mapCompetitionEdition);
  return {
    competition: mapCompetition(cRes.rows[0]),
    editions,
    coverage: buildCompetitionCoverage(editions),
  };
}

interface PlayerDirectoryRow extends PlayerSummaryRow {
  team_id: string; team_name: string; team_slug: string; team_short: string | null; team_country: string | null;
}
const PLAYERS_LIST_SQL = `
  SELECT DISTINCT ON (p.id)
         p.id::text AS id, p.full_name AS full_name, p.short_name AS short_name, p.slug AS slug,
         t.id::text AS team_id, t.name AS team_name, t.slug AS team_slug,
         t.short_name AS team_short, t.country_code AS team_country
    FROM football.player p
    JOIN football.player_registration pr
      ON pr.player_id = p.id AND pr.registration_kind_code <> 'LOAN_OUT' AND pr.registration_period @> current_date
    JOIN football.team t ON t.id = pr.team_id
    JOIN football.team_registration tr ON tr.team_id = t.id AND tr.withdrawn_on IS NULL
    JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
${GOVERNED_EDITION_JOIN_CE}
   ORDER BY p.id
`;

/** Players currently registered to a team in a governed authorized-active edition. */
export async function getPlayers(tx: PoolClient): Promise<PlayerListResponse> {
  const rows = await tx.query<PlayerDirectoryRow>(PLAYERS_LIST_SQL);
  const players: ApiPlayerSummary[] = rows.rows.map((r) => ({
    id: r.id, fullName: r.full_name, shortName: r.short_name, slug: r.slug,
    team: { id: r.team_id, name: r.team_name, slug: r.team_slug, shortName: r.team_short, countryCode: r.team_country },
  }));
  players.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { players };
}

interface PlayerIdentityRow {
  id: string; full_name: string; short_name: string | null; slug: string;
  date_of_birth: string | null; nationality_code: string | null; height_cm: number | null; preferred_foot: string | null;
}
const PLAYER_IDENTITY_SQL = `
  SELECT p.id::text AS id, p.full_name AS full_name, p.short_name AS short_name, p.slug AS slug,
         to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.nationality_code AS nationality_code,
         p.height_cm AS height_cm, p.preferred_foot AS preferred_foot
    FROM football.player p
   WHERE p.id = $1::bigint
`;

interface PlayerTeamRow {
  team_id: string; team_name: string; team_slug: string; team_short: string | null; team_country: string | null;
  competition_id: string; competition_name: string; competition_slug: string; season_label: string;
}
const PLAYER_CURRENT_TEAM_SQL = `
  SELECT t.id::text AS team_id, t.name AS team_name, t.slug AS team_slug,
         t.short_name AS team_short, t.country_code AS team_country,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug, ce.season_label AS season_label
    FROM football.player_registration pr
    JOIN football.team t ON t.id = pr.team_id
    JOIN football.team_registration tr ON tr.team_id = t.id AND tr.withdrawn_on IS NULL
    JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
${GOVERNED_EDITION_JOIN_CE}
   WHERE pr.player_id = $1::bigint
     AND pr.registration_kind_code <> 'LOAN_OUT'
     AND pr.registration_period @> current_date
   ORDER BY ce.season_label DESC
   LIMIT 1
`;

// The player's current registration (kind + period), with its edition link when one
// is recorded. Squad ingestion records the registration WITHOUT a competition_edition_id
// (that column stays null — the edition is carried on the TEAM's registration, which is
// what the exposure gate above resolves). The join to competition_edition MUST therefore
// be a LEFT JOIN: an INNER JOIN drops the whole registration whenever the edition link is
// absent, which is every squad-ingested row — surfacing a null registration for a player
// who is in fact registered. Edition fields are null when the link is absent (honest
// absence); the governed competition/season context is still carried by the top-level
// `competition` field, which the gate derives via team_registration.
const PLAYER_REGISTRATION_SQL = `
  SELECT pr.team_id::text AS team_id, pr.registration_kind_code AS registration_kind_code,
         to_char(lower(pr.registration_period), 'YYYY-MM-DD') AS registration_from,
         to_char(upper(pr.registration_period), 'YYYY-MM-DD') AS registration_to,
         pr.competition_edition_id::text AS competition_edition_id, ce.season_label AS season_label
    FROM football.player_registration pr
    LEFT JOIN football.competition_edition ce ON ce.id = pr.competition_edition_id
   WHERE pr.player_id = $1::bigint
     AND pr.registration_kind_code <> 'LOAN_OUT'
     AND pr.registration_period @> current_date
   ORDER BY ce.season_label DESC NULLS LAST, lower(pr.registration_period) DESC
   LIMIT 1
`;

// The most relevant availability spell: a current one (covering today) first, else
// the most recent. `is_current` reports whether the spell covers today. Raw evidence.
const PLAYER_AVAILABILITY_SQL = `
  SELECT pa.unavailability_kind_code AS unavailability_kind_code,
         to_char(lower(pa.spell_period), 'YYYY-MM-DD') AS spell_from,
         to_char(upper(pa.spell_period), 'YYYY-MM-DD') AS spell_to,
         to_char(pa.expected_return_on, 'YYYY-MM-DD') AS expected_return_on,
         pa.reason AS reason, pa.severity_rank AS severity_rank,
         (pa.spell_period @> current_date) AS is_current
    FROM football.player_availability pa
   WHERE pa.player_id = $1::bigint
   ORDER BY (pa.spell_period @> current_date) DESC, lower(pa.spell_period) DESC
   LIMIT 1
`;

// The latest stored valuation for the player. Raw evidence (amount + currency + date).
const PLAYER_VALUATION_SQL = `
  SELECT v.amount::text AS amount, v.currency_code AS currency_code,
         to_char(v.as_of_on, 'YYYY-MM-DD') AS as_of_on, v.source_code AS source_code
    FROM football.player_valuation v
   WHERE v.player_id = $1::bigint
   ORDER BY v.as_of_on DESC, v.id DESC
   LIMIT 1
`;

// Every stored per-match statistic row for the player, with fixture/team/opponent/
// result context, ordered newest-first. RAW rows — the read model aggregates them.
const PLAYER_STAT_ROWS_SQL = `
  SELECT pms.fixture_id::text AS fixture_id, pms.team_id::text AS team_id,
         pms.statistic_key AS statistic_key, pms.statistic_value AS statistic_value, pms.value_type AS value_type,
         f.scheduled_kickoff_at AS scheduled_kickoff_at,
         f.competition_edition_id::text AS competition_edition_id, ce.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         f.home_team_id::text AS home_team_id, f.away_team_id::text AS away_team_id,
         ht.name AS home_name, at.name AS away_name,
         r.home_goals AS home_goals, r.away_goals AS away_goals
    FROM football.player_match_statistic pms
    JOIN football.fixture f ON f.id = pms.fixture_id AND f.fixture_partition_on = pms.fixture_partition_on
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
    JOIN football.team ht ON ht.id = f.home_team_id
    JOIN football.team at ON at.id = f.away_team_id
    LEFT JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE pms.player_id = $1::bigint
   ORDER BY f.scheduled_kickoff_at DESC, f.id DESC, pms.statistic_key ASC
`;

/**
 * A player's biography, current governed team/competition, registration, availability,
 * valuation, and statistics projected from stored `player_match_statistic` rows.
 * Null when the player has no current registration within a governed authorized
 * edition (the exposure gate — unchanged). Statistics are raw evidence + derived
 * arithmetic aggregates only; NO governed intelligence is produced here.
 */
export async function getPlayerDetail(tx: PoolClient, playerId: string): Promise<PlayerDetailResponse | null> {
  // Exposure gate: only players in a governed edition's current squad are surfaced.
  const teamRes = await tx.query<PlayerTeamRow>(PLAYER_CURRENT_TEAM_SQL, [playerId]);
  if (teamRes.rows.length === 0) return null;

  const idRes = await tx.query<PlayerIdentityRow>(PLAYER_IDENTITY_SQL, [playerId]);
  if (idRes.rows.length === 0) return null;
  const p = idRes.rows[0];
  const ct = teamRes.rows[0];

  const [regRes, availRes, valRes, statRes] = await Promise.all([
    tx.query<PlayerRegistrationRow>(PLAYER_REGISTRATION_SQL, [playerId]),
    tx.query<PlayerAvailabilityRow>(PLAYER_AVAILABILITY_SQL, [playerId]),
    tx.query<PlayerValuationRow>(PLAYER_VALUATION_SQL, [playerId]),
    tx.query<PlayerStatRow>(PLAYER_STAT_ROWS_SQL, [playerId]),
  ]);

  return {
    player: {
      id: p.id, fullName: p.full_name, shortName: p.short_name, slug: p.slug,
      dateOfBirth: p.date_of_birth, nationalityCode: p.nationality_code,
      heightCm: p.height_cm === null ? null : Number(p.height_cm), preferredFoot: p.preferred_foot,
    },
    currentTeam: { id: ct.team_id, name: ct.team_name, slug: ct.team_slug, shortName: ct.team_short, countryCode: ct.team_country },
    competition: { id: ct.competition_id, name: ct.competition_name, slug: ct.competition_slug, seasonLabel: ct.season_label },
    registration: mapRegistration(regRes.rows[0]),
    availability: mapAvailability(availRes.rows[0]),
    valuation: mapValuation(valRes.rows[0]),
    statistics: aggregatePlayerStatistics(statRes.rows),
  };
}
