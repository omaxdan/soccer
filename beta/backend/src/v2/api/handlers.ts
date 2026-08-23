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
import { readActiveMatchReadings, type TeamModuleReading } from '../module/read/readings';
import type {
  MatchDetailResponse,
  EditionFixtureListResponse,
  ApiTeamIntelligence,
  ApiModuleReading,
  ApiFormFixture,
  ApiScore,
} from './contract';

/** A fixture id is a bigint. Reject anything else BEFORE touching the database. */
export function isValidId(raw: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(raw);
}

const iso = (d: Date): string => new Date(d).toISOString();
const score = (h: number | null, a: number | null): ApiScore | null =>
  h === null || a === null ? null : { home: Number(h), away: Number(a) };

/** Projects a persisted reading to the wire shape. */
function toReadingDto(r: TeamModuleReading): ApiModuleReading {
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
  };
}

/**
 * Pure mapping of the flat readings list into per-team intelligence. A module with
 * no persisted reading for a team is `null` — never fabricated. Exported so the
 * "missing reading" semantics are unit-testable without a database.
 */
export function mapIntelligence(
  readings: readonly TeamModuleReading[],
  homeTeamId: string,
  awayTeamId: string
): { home: ApiTeamIntelligence; away: ApiTeamIntelligence } {
  const pick = (teamId: string, moduleKey: string): ApiModuleReading | null => {
    const found = readings.find((r) => r.teamId === teamId && r.moduleKey === moduleKey);
    return found ? toReadingDto(found) : null;
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
  const readings = await readActiveMatchReadings(tx, {
    homeTeamId: h.home_id,
    awayTeamId: h.away_id,
    competitionEditionId: h.edition_id,
    asOf,
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
    intelligence: mapIntelligence(readings, h.home_id, h.away_id),
  };
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

const EDITION_HEADER_SQL = `
  SELECT e.id::text AS edition_id, e.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug
    FROM football.competition_edition e
    JOIN football.competition c ON c.id = e.competition_id
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
