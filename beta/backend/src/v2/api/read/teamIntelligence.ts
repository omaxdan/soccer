// ─────────────────────────────────────────────────────────────────────────────
// TEAM INTELLIGENCE — read model (SQL + pure aggregation), evidence-honest
//
// Assembles a Team Intelligence workspace projection from PERSISTED football state
// only. It keeps three layers strictly distinct and never collapses them:
//
//   OBSERVED DB EVIDENCE  — registrations, availability spells, valuations, fixtures/
//     results, and raw player_match_statistic rows.
//   READ-MODEL AGGREGATION — arithmetic/grouping over those rows (per-key sum/mean,
//     home/away split, fixture classification, next-fixture availability matching).
//   GOVERNED INTELLIGENCE — NONE here. No verdict, readiness, score, predicted XI,
//     or derived suspension. Governed intelligence lives only in sealed snapshots.
//
// Governance rules enforced by construction:
//   • Absence stays absence (empty arrays / null / a coverage flag — never zero-fill).
//   • Numeric aggregation ONLY for value_type='number' with a finite value.
//   • Availability for a next fixture is classified as EXPLICITLY UNAVAILABLE (an
//     availability spell covers the fixture date) or UNKNOWN — never "available",
//     never a suspension inferred from cards.
//   • No player position/appearance is invented (no appearance writer exists).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── small pure helpers ──────────────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function numericValue(value: string | null, valueType: string | null): number | null {
  if (valueType !== 'number' || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function formatDerived(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function toScore(h: number | string | null, a: number | string | null): { home: number; away: number } | null {
  if (h === null || a === null) return null;
  const hn = Number(h); const an = Number(a);
  return Number.isFinite(hn) && Number.isFinite(an) ? { home: hn, away: an } : null;
}

// ── contract view types ─────────────────────────────────────────────────────────

export interface TeamParticipation {
  readonly competitionEditionId: string;
  readonly seasonLabel: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly fixturesTotal: number;
  readonly completed: number;
  readonly scheduled: number;
  readonly postponed: number;
  readonly registered: boolean;         // registration evidence, distinct from fixture evidence
  readonly firstKickoff: string | null;
  readonly lastKickoff: string | null;
}

export interface TeamSquadMember {
  readonly playerId: string;
  readonly fullName: string;
  readonly shortName: string | null;
  readonly slug: string;
  readonly registrationKindCode: string;
  readonly registrationFrom: string | null;
  readonly registrationTo: string | null;
}

export interface TeamAvailabilityRecord {
  readonly playerId: string;
  readonly fullName: string;
  readonly unavailabilityKindCode: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly expectedReturnOn: string | null;
  readonly reason: string | null;
  readonly severityRank: number | null;
  readonly current: boolean;
}

export interface TeamValuationRecord {
  readonly playerId: string;
  readonly fullName: string;
  readonly amount: string;
  readonly currencyCode: string | null;
  readonly asOfOn: string;
  readonly sourceCode: string | null;
}

export interface TeamFixtureLine {
  readonly fixtureId: string;
  readonly kickoffAt: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  readonly isHome: boolean;
  readonly status: string;
  readonly score: { readonly home: number; readonly away: number } | null;
}

export interface TeamStatKeyCoverage {
  readonly statisticKey: string;
  readonly valueType: string | null;
  readonly fixtures: number;
  readonly players: number;
  readonly numericTotal: string | null;
  readonly numericMean: string | null;
}

export interface TeamPlayerPerformance {
  readonly playerId: string;
  readonly fullName: string;
  readonly statistics: readonly { readonly key: string; readonly value: string | null; readonly valueType: string | null }[];
}

export interface TeamNextFixtureContext {
  readonly fixture: TeamFixtureLine;
  readonly registeredCount: number;
  /** Players with an explicit availability spell covering the fixture date. */
  readonly explicitlyUnavailable: readonly { readonly playerId: string; readonly fullName: string; readonly unavailabilityKindCode: string; readonly reason: string | null; readonly expectedReturnOn: string | null }[];
  /** Registered players with NO covering availability record — status UNKNOWN, not "available". */
  readonly availabilityUnknown: readonly { readonly playerId: string; readonly fullName: string }[];
}

export type CoverageState = 'present' | 'absent' | 'not-supported';
export interface TeamCoverageMeta {
  readonly registrations: CoverageState;
  readonly availability: CoverageState;
  readonly valuations: CoverageState;
  readonly playerMatchStatistics: CoverageState;
  readonly appearances: CoverageState;      // 'not-supported' — no appearance writer
  readonly perPlayerCards: CoverageState;    // 'not-supported' — only team-level card stats exist
  readonly standings: CoverageState;         // 'not-supported' here — no team standings read model
  readonly managerReferee: CoverageState;    // 'not-supported' — no writer
  /** Marks that statistic totals are read-model arithmetic, not governed intelligence. */
  readonly statisticsAreDerivedAggregates: true;
}

export interface TeamIntelligence {
  readonly participation: readonly TeamParticipation[];
  readonly squad: readonly TeamSquadMember[];
  readonly availability: readonly TeamAvailabilityRecord[];
  readonly valuations: readonly TeamValuationRecord[];
  readonly fixtures: { readonly recent: readonly TeamFixtureLine[]; readonly upcoming: readonly TeamFixtureLine[] };
  readonly homeAwayContext: { readonly home: readonly TeamFixtureLine[]; readonly away: readonly TeamFixtureLine[] };
  readonly playerStatistics: { readonly playersWithStats: number; readonly statisticKeys: readonly TeamStatKeyCoverage[] };
  readonly playerPerformances: { readonly fixture: TeamFixtureLine | null; readonly performances: readonly TeamPlayerPerformance[] };
  readonly nextFixture: TeamNextFixtureContext | null;
  readonly coverage: TeamCoverageMeta;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface ParticipationRow {
  competition_edition_id: string; season_label: string;
  competition_id: string; competition_name: string; competition_slug: string;
  fixtures_total: number | string; completed: number | string; scheduled: number | string; postponed: number | string;
  registered: boolean; first_kickoff: Date | string | null; last_kickoff: Date | string | null;
}
export interface SquadRow { player_id: string; full_name: string; short_name: string | null; slug: string; registration_kind_code: string; registration_from: string | null; registration_to: string | null }
export interface AvailabilityRow { player_id: string; full_name: string; unavailability_kind_code: string; spell_from: string | null; spell_to: string | null; expected_return_on: string | null; reason: string | null; severity_rank: number | string | null; is_current: boolean }
export interface ValuationRow { player_id: string; full_name: string; amount: string; currency_code: string | null; as_of_on: string; source_code: string | null }
export interface FixtureRow {
  fixture_id: string; scheduled_kickoff_at: Date | string; status: string; is_home: boolean;
  competition_id: string; competition_name: string; competition_slug: string;
  opp_id: string; opp_name: string; opp_slug: string;
  goals_for: number | string | null; goals_against: number | string | null;
}
export interface StatKeyRow { statistic_key: string; value_type: string | null; fixtures: number | string; players: number | string; numeric_sum: string | null; numeric_count: number | string | null }
export interface PerformanceRow { player_id: string; full_name: string; statistic_key: string; statistic_value: string | null; value_type: string | null }

// ── pure mappers/aggregation ─────────────────────────────────────────────────────

export function mapParticipation(r: ParticipationRow): TeamParticipation {
  return {
    competitionEditionId: r.competition_edition_id, seasonLabel: r.season_label,
    competition: { id: r.competition_id, name: r.competition_name, slug: r.competition_slug },
    fixturesTotal: Number(r.fixtures_total), completed: Number(r.completed),
    scheduled: Number(r.scheduled), postponed: Number(r.postponed),
    registered: r.registered,
    firstKickoff: r.first_kickoff === null ? null : iso(r.first_kickoff),
    lastKickoff: r.last_kickoff === null ? null : iso(r.last_kickoff),
  };
}

export function mapSquadMember(r: SquadRow): TeamSquadMember {
  return { playerId: r.player_id, fullName: r.full_name, shortName: r.short_name, slug: r.slug, registrationKindCode: r.registration_kind_code, registrationFrom: r.registration_from, registrationTo: r.registration_to };
}

export function mapAvailability(r: AvailabilityRow): TeamAvailabilityRecord {
  return { playerId: r.player_id, fullName: r.full_name, unavailabilityKindCode: r.unavailability_kind_code, from: r.spell_from, to: r.spell_to, expectedReturnOn: r.expected_return_on, reason: r.reason, severityRank: r.severity_rank === null || r.severity_rank === undefined ? null : Number(r.severity_rank), current: r.is_current };
}

export function mapValuation(r: ValuationRow): TeamValuationRecord {
  return { playerId: r.player_id, fullName: r.full_name, amount: r.amount, currencyCode: r.currency_code, asOfOn: r.as_of_on, sourceCode: r.source_code };
}

export function mapFixture(r: FixtureRow): TeamFixtureLine {
  return {
    fixtureId: r.fixture_id, kickoffAt: iso(r.scheduled_kickoff_at), status: r.status, isHome: r.is_home,
    competition: { id: r.competition_id, name: r.competition_name, slug: r.competition_slug },
    opponent: { id: r.opp_id, name: r.opp_name, slug: r.opp_slug },
    score: toScore(r.goals_for, r.goals_against),
  };
}

/** Classify fixtures into recent (completed) and upcoming (scheduled/postponed), each
 *  ordered for reading. Deterministic; does not mutate the input. */
export function classifyTeamFixtures(rows: readonly FixtureRow[]): { recent: TeamFixtureLine[]; upcoming: TeamFixtureLine[] } {
  const lines = rows.map(mapFixture);
  const recent = lines.filter((f) => f.status === 'COMPLETED').sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
  const upcoming = lines.filter((f) => f.status === 'SCHEDULED' || f.status === 'POSTPONED').sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt));
  return { recent, upcoming };
}

/** Split recent completed fixtures into home and away context. */
export function splitHomeAway(recent: readonly TeamFixtureLine[]): { home: TeamFixtureLine[]; away: TeamFixtureLine[] } {
  return { home: recent.filter((f) => f.isHome), away: recent.filter((f) => !f.isHome) };
}

/** Aggregate per-key statistic coverage. Numeric total/mean only when value_type is
 *  'number' (carried in numeric_sum/numeric_count from SQL); non-numeric keys keep
 *  null totals — never a fabricated 0. Ordered by key for determinism. */
export function aggregateStatKeys(rows: readonly StatKeyRow[]): TeamStatKeyCoverage[] {
  return [...rows]
    .map((r) => {
      const count = r.numeric_count === null || r.numeric_count === undefined ? 0 : Number(r.numeric_count);
      const sum = r.numeric_sum === null ? null : Number(r.numeric_sum);
      const hasNumeric = count > 0 && sum !== null && Number.isFinite(sum);
      return {
        statisticKey: r.statistic_key, valueType: r.value_type,
        fixtures: Number(r.fixtures), players: Number(r.players),
        numericTotal: hasNumeric ? formatDerived(sum) : null,
        numericMean: hasNumeric ? formatDerived(sum / count) : null,
      };
    })
    .sort((a, b) => a.statisticKey.localeCompare(b.statisticKey));
}

/** Group raw performance rows (one recent fixture) into per-player stat maps. */
export function groupPerformances(rows: readonly PerformanceRow[]): TeamPlayerPerformance[] {
  const order: string[] = [];
  const byPlayer = new Map<string, { fullName: string; stats: PerformanceRow[] }>();
  for (const r of rows) {
    let p = byPlayer.get(r.player_id);
    if (!p) { p = { fullName: r.full_name, stats: [] }; byPlayer.set(r.player_id, p); order.push(r.player_id); }
    p.stats.push(r);
  }
  return order
    .map((playerId) => {
      const p = byPlayer.get(playerId)!;
      return {
        playerId, fullName: p.fullName,
        statistics: [...p.stats].sort((a, b) => a.statistic_key.localeCompare(b.statistic_key))
          .map((s) => ({ key: s.statistic_key, value: s.statistic_value, valueType: s.value_type })),
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** True when an availability spell [from, to) covers `date`. Null bounds are open. Pure. */
export function spellCoversDate(from: string | null, to: string | null, date: string): boolean {
  if (from !== null && date < from) return false;
  if (to !== null && date >= to) return false;
  return true;
}

/**
 * Next-fixture squad context. Registered players whose availability spell covers the
 * fixture date are EXPLICITLY UNAVAILABLE; all other registered players are UNKNOWN
 * (never "available", never inferred). No predicted XI, no card-derived suspension.
 */
export function classifyNextFixtureSquad(
  fixture: TeamFixtureLine,
  squad: readonly TeamSquadMember[],
  availability: readonly TeamAvailabilityRecord[],
): TeamNextFixtureContext {
  const date = fixture.kickoffAt.slice(0, 10); // UTC date of the fixture
  const unavailableByPlayer = new Map<string, TeamAvailabilityRecord>();
  for (const a of availability) {
    if (spellCoversDate(a.from, a.to, date)) unavailableByPlayer.set(a.playerId, a);
  }
  const explicitlyUnavailable: Array<TeamNextFixtureContext['explicitlyUnavailable'][number]> = [];
  const availabilityUnknown: Array<TeamNextFixtureContext['availabilityUnknown'][number]> = [];
  for (const m of squad) {
    const spell = unavailableByPlayer.get(m.playerId);
    if (spell) explicitlyUnavailable.push({ playerId: m.playerId, fullName: m.fullName, unavailabilityKindCode: spell.unavailabilityKindCode, reason: spell.reason, expectedReturnOn: spell.expectedReturnOn });
    else availabilityUnknown.push({ playerId: m.playerId, fullName: m.fullName });
  }
  return { fixture, registeredCount: squad.length, explicitlyUnavailable, availabilityUnknown };
}

export function buildCoverage(parts: {
  squad: readonly unknown[]; availability: readonly unknown[]; valuations: readonly unknown[]; playersWithStats: number;
}): TeamCoverageMeta {
  const state = (n: number): CoverageState => (n > 0 ? 'present' : 'absent');
  return {
    registrations: state(parts.squad.length),
    availability: state(parts.availability.length),
    valuations: state(parts.valuations.length),
    playerMatchStatistics: state(parts.playersWithStats),
    appearances: 'not-supported',
    perPlayerCards: 'not-supported',
    standings: 'not-supported',
    managerReferee: 'not-supported',
    statisticsAreDerivedAggregates: true,
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

const PARTICIPATION_SQL = `
  SELECT ce.id::text AS competition_edition_id, ce.season_label AS season_label,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         count(f.id) AS fixtures_total,
         count(*) FILTER (WHERE f.lifecycle_state_code='COMPLETED') AS completed,
         count(*) FILTER (WHERE f.lifecycle_state_code='SCHEDULED') AS scheduled,
         count(*) FILTER (WHERE f.lifecycle_state_code='POSTPONED') AS postponed,
         bool_or(reg.team_id IS NOT NULL) AS registered,
         min(f.scheduled_kickoff_at) AS first_kickoff, max(f.scheduled_kickoff_at) AS last_kickoff
    FROM football.fixture f
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
    LEFT JOIN LATERAL (
      SELECT tr.team_id FROM football.team_registration tr
      WHERE tr.competition_edition_id = ce.id AND tr.team_id = $1::bigint AND tr.withdrawn_on IS NULL LIMIT 1
    ) reg ON true
   WHERE f.home_team_id = $1::bigint OR f.away_team_id = $1::bigint
   GROUP BY ce.id, ce.season_label, c.id, c.name, c.slug
   ORDER BY last_kickoff DESC NULLS LAST
`;

const SQUAD_SQL = `
  SELECT p.id::text AS player_id, p.full_name, p.short_name, p.slug,
         pr.registration_kind_code AS registration_kind_code,
         to_char(lower(pr.registration_period),'YYYY-MM-DD') AS registration_from,
         to_char(upper(pr.registration_period),'YYYY-MM-DD') AS registration_to
    FROM football.player_registration pr
    JOIN football.player p ON p.id = pr.player_id
   WHERE pr.team_id = $1::bigint AND pr.registration_kind_code <> 'LOAN_OUT' AND pr.registration_period @> current_date
   ORDER BY p.full_name
`;

const AVAILABILITY_SQL = `
  SELECT p.id::text AS player_id, p.full_name,
         pa.unavailability_kind_code AS unavailability_kind_code,
         to_char(lower(pa.spell_period),'YYYY-MM-DD') AS spell_from,
         to_char(upper(pa.spell_period),'YYYY-MM-DD') AS spell_to,
         to_char(pa.expected_return_on,'YYYY-MM-DD') AS expected_return_on,
         pa.reason AS reason, pa.severity_rank AS severity_rank,
         (pa.spell_period @> current_date) AS is_current
    FROM football.player_availability pa
    JOIN football.player p ON p.id = pa.player_id
   WHERE EXISTS (SELECT 1 FROM football.player_registration pr
                  WHERE pr.player_id = pa.player_id AND pr.team_id = $1::bigint
                    AND pr.registration_kind_code <> 'LOAN_OUT' AND pr.registration_period @> current_date)
   ORDER BY lower(pa.spell_period) DESC NULLS LAST, p.full_name
`;

const VALUATION_SQL = `
  SELECT DISTINCT ON (v.player_id)
         v.player_id::text AS player_id, p.full_name,
         v.amount::text AS amount, v.currency_code AS currency_code,
         to_char(v.as_of_on,'YYYY-MM-DD') AS as_of_on, v.source_code AS source_code
    FROM football.player_valuation v
    JOIN football.player p ON p.id = v.player_id
   WHERE EXISTS (SELECT 1 FROM football.player_registration pr
                  WHERE pr.player_id = v.player_id AND pr.team_id = $1::bigint
                    AND pr.registration_kind_code <> 'LOAN_OUT' AND pr.registration_period @> current_date)
   ORDER BY v.player_id, v.as_of_on DESC, v.id DESC
`;

const FIXTURES_SQL = `
  WITH tf AS (
    SELECT f.id AS fixture_id, f.fixture_partition_on, f.scheduled_kickoff_at, f.lifecycle_state_code AS status,
           (f.home_team_id = $1::bigint) AS is_home,
           ce.competition_id, CASE WHEN f.home_team_id = $1::bigint THEN f.away_team_id ELSE f.home_team_id END AS opp_id,
           r.home_goals, r.away_goals
      FROM football.fixture f
      JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
      LEFT JOIN football.result r ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
     WHERE (f.home_team_id = $1::bigint OR f.away_team_id = $1::bigint)
       AND ( f.lifecycle_state_code = 'COMPLETED'
             OR (f.lifecycle_state_code IN ('SCHEDULED','POSTPONED') AND f.scheduled_kickoff_at >= now() - interval '2 days') )
  )
  SELECT tf.fixture_id::text AS fixture_id, tf.scheduled_kickoff_at, tf.status, tf.is_home,
         c.id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         o.id::text AS opp_id, o.name AS opp_name, o.slug AS opp_slug,
         CASE WHEN tf.is_home THEN tf.home_goals ELSE tf.away_goals END AS goals_for,
         CASE WHEN tf.is_home THEN tf.away_goals ELSE tf.home_goals END AS goals_against
    FROM tf
    JOIN football.competition c ON c.id = tf.competition_id
    JOIN football.team o ON o.id = tf.opp_id
   ORDER BY tf.scheduled_kickoff_at DESC
   LIMIT 40
`;

const STAT_KEYS_SQL = `
  SELECT pms.statistic_key AS statistic_key, pms.value_type AS value_type,
         count(DISTINCT pms.fixture_id) AS fixtures, count(DISTINCT pms.player_id) AS players,
         sum(CASE WHEN pms.value_type='number' AND pms.statistic_value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                  THEN pms.statistic_value::numeric ELSE NULL END) AS numeric_sum,
         count(*) FILTER (WHERE pms.value_type='number' AND pms.statistic_value ~ '^-?[0-9]+(\\.[0-9]+)?$') AS numeric_count
    FROM football.player_match_statistic pms
   WHERE pms.team_id = $1::bigint
   GROUP BY pms.statistic_key, pms.value_type
   ORDER BY pms.statistic_key
`;

// The most recent fixture (for this team) that carries player stats — its per-player
// stat rows for the "latest performances" block. Bounded to one fixture.
const LATEST_STAT_FIXTURE_SQL = `
  SELECT f.id::text AS fixture_id, f.scheduled_kickoff_at, f.lifecycle_state_code AS status,
         (f.home_team_id = $1::bigint) AS is_home,
         ce.competition_id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         o.id::text AS opp_id, o.name AS opp_name, o.slug AS opp_slug,
         CASE WHEN f.home_team_id=$1::bigint THEN r.home_goals ELSE r.away_goals END AS goals_for,
         CASE WHEN f.home_team_id=$1::bigint THEN r.away_goals ELSE r.home_goals END AS goals_against
    FROM football.fixture f
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
    JOIN football.team o ON o.id = CASE WHEN f.home_team_id=$1::bigint THEN f.away_team_id ELSE f.home_team_id END
    LEFT JOIN football.result r ON r.fixture_id=f.id AND r.fixture_partition_on=f.fixture_partition_on
   WHERE (f.home_team_id=$1::bigint OR f.away_team_id=$1::bigint)
     AND EXISTS (SELECT 1 FROM football.player_match_statistic pms
                  WHERE pms.fixture_id=f.id AND pms.fixture_partition_on=f.fixture_partition_on AND pms.team_id=$1::bigint)
   ORDER BY f.scheduled_kickoff_at DESC
   LIMIT 1
`;

const PERFORMANCE_ROWS_SQL = `
  SELECT pms.player_id::text AS player_id, p.full_name,
         pms.statistic_key AS statistic_key, pms.statistic_value AS statistic_value, pms.value_type AS value_type
    FROM football.player_match_statistic pms
    JOIN football.player p ON p.id = pms.player_id
   WHERE pms.team_id = $1::bigint AND pms.fixture_id = $2::bigint
   ORDER BY p.full_name, pms.statistic_key
`;

const NEXT_FIXTURE_SQL = `
  SELECT f.id::text AS fixture_id, f.scheduled_kickoff_at, f.lifecycle_state_code AS status,
         (f.home_team_id=$1::bigint) AS is_home,
         ce.competition_id::text AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
         o.id::text AS opp_id, o.name AS opp_name, o.slug AS opp_slug, NULL::int AS goals_for, NULL::int AS goals_against
    FROM football.fixture f
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
    JOIN football.team o ON o.id = CASE WHEN f.home_team_id=$1::bigint THEN f.away_team_id ELSE f.home_team_id END
   WHERE (f.home_team_id=$1::bigint OR f.away_team_id=$1::bigint)
     AND f.lifecycle_state_code='SCHEDULED' AND f.scheduled_kickoff_at > now()
   ORDER BY f.scheduled_kickoff_at ASC
   LIMIT 1
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readTeamIntelligence(tx: PoolClient, teamId: string): Promise<TeamIntelligence> {
  const [partRes, squadRes, availRes, valRes, fixRes, keyRes, latestRes, nextRes] = await Promise.all([
    tx.query<ParticipationRow>(PARTICIPATION_SQL, [teamId]),
    tx.query<SquadRow>(SQUAD_SQL, [teamId]),
    tx.query<AvailabilityRow>(AVAILABILITY_SQL, [teamId]),
    tx.query<ValuationRow>(VALUATION_SQL, [teamId]),
    tx.query<FixtureRow>(FIXTURES_SQL, [teamId]),
    tx.query<StatKeyRow>(STAT_KEYS_SQL, [teamId]),
    tx.query<FixtureRow>(LATEST_STAT_FIXTURE_SQL, [teamId]),
    tx.query<FixtureRow>(NEXT_FIXTURE_SQL, [teamId]),
  ]);

  const squad = squadRes.rows.map(mapSquadMember);
  const availability = availRes.rows.map(mapAvailability);
  const valuations = valRes.rows.map(mapValuation);
  const { recent, upcoming } = classifyTeamFixtures(fixRes.rows);
  const statisticKeys = aggregateStatKeys(keyRes.rows);
  const playersWithStats = statisticKeys.reduce((m, k) => Math.max(m, k.players), 0);

  // Latest performances block: one fixture + its per-player stat rows.
  const latestFixture = latestRes.rows[0] ? mapFixture(latestRes.rows[0]) : null;
  let performances: TeamPlayerPerformance[] = [];
  if (latestFixture) {
    const perfRows = await tx.query<PerformanceRow>(PERFORMANCE_ROWS_SQL, [teamId, latestFixture.fixtureId]);
    performances = groupPerformances(perfRows.rows);
  }

  // Next-fixture squad context — explicit availability only, never inferred.
  const nextRow = nextRes.rows[0];
  const nextFixture = nextRow ? classifyNextFixtureSquad(mapFixture(nextRow), squad, availability) : null;

  return {
    participation: partRes.rows.map(mapParticipation),
    squad,
    availability,
    valuations,
    fixtures: { recent: recent.slice(0, 10), upcoming: upcoming.slice(0, 10) },
    homeAwayContext: splitHomeAway(recent.slice(0, 10)),
    playerStatistics: { playersWithStats, statisticKeys },
    playerPerformances: { fixture: latestFixture, performances },
    nextFixture,
    coverage: buildCoverage({ squad, availability, valuations, playersWithStats }),
  };
}
