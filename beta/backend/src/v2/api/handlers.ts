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
import type {
  MatchDetailResponse,
  EditionFixtureListResponse,
  EditionListResponse,
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
  PlayerListResponse,
  PlayerDetailResponse,
} from './contract';

/** A fixture id is a bigint. Reject anything else BEFORE touching the database. */
export function isValidId(raw: string): boolean {
  return /^[1-9][0-9]{0,18}$/.test(raw);
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

/**
 * A player's biography + current governed team/competition, or null when the
 * player has no current registration within a governed authorized edition.
 */
export async function getPlayerDetail(tx: PoolClient, playerId: string): Promise<PlayerDetailResponse | null> {
  // Exposure gate: only players in a governed edition's current squad are surfaced.
  const teamRes = await tx.query<PlayerTeamRow>(PLAYER_CURRENT_TEAM_SQL, [playerId]);
  if (teamRes.rows.length === 0) return null;

  const idRes = await tx.query<PlayerIdentityRow>(PLAYER_IDENTITY_SQL, [playerId]);
  if (idRes.rows.length === 0) return null;
  const p = idRes.rows[0];
  const ct = teamRes.rows[0];

  return {
    player: {
      id: p.id, fullName: p.full_name, shortName: p.short_name, slug: p.slug,
      dateOfBirth: p.date_of_birth, nationalityCode: p.nationality_code,
      heightCm: p.height_cm === null ? null : Number(p.height_cm), preferredFoot: p.preferred_foot,
    },
    currentTeam: { id: ct.team_id, name: ct.team_name, slug: ct.team_slug, shortName: ct.team_short, countryCode: ct.team_country },
    competition: { id: ct.competition_id, name: ct.competition_name, slug: ct.competition_slug, seasonLabel: ct.season_label },
  };
}
