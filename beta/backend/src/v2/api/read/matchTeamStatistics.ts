// ─────────────────────────────────────────────────────────────────────────────
// MATCH TEAM STATISTICS — read model (SQL + pure aggregation), evidence-honest
//
// Projects a fixture's TEAM-level match statistics from PERSISTED football state
// (`football.team_match_statistic`). Three layers kept strictly distinct:
//
//   OBSERVED DB EVIDENCE  — each stored statistic row: the provider's period,
//     group, key/name, and the raw home/away value + display strings, with the
//     provider's own value/compare/statistics/render type tags and provenance.
//   READ-MODEL SHAPING    — grouping rows by period, ordered for reading. No
//     arithmetic, no unit conversion, no comparison logic of our own.
//   GOVERNED INTELLIGENCE — NONE. No verdict, score, ranking, probability, or
//     prediction. These are the provider's observed match statistics, verbatim.
//
// Governance rules enforced by construction:
//   • Raw provider strings are passed through UNCHANGED (home_value/away_value and
//     their display strings). Nothing is parsed to a number or recomputed — the
//     provider's own compare_code is surfaced, never re-derived.
//   • Absence stays absence: a null provider value stays null (never 0 or ''); a
//     fixture with no statistics yields empty periods and coverage 'absent'.
//   • home/away orientation is the fixture's home/away teams (from the header),
//     never re-derived here.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

/** One team's side of a statistic: the provider's raw value and display string. */
export interface TeamStatValue {
  readonly value: string | null;     // provider homeValue/awayValue, raw
  readonly display: string | null;   // provider home/away display string, raw
}

/** One observed statistic for the fixture, carrying both teams' sides. */
export interface TeamStatLine {
  readonly groupName: string;         // provider groupName
  readonly statisticKey: string;      // provider key (identity within group)
  readonly statisticName: string | null;
  readonly home: TeamStatValue;       // oriented to match.homeTeam
  readonly away: TeamStatValue;       // oriented to match.awayTeam
  readonly valueType: string | null;
  readonly compareCode: string | null;   // provider compareCode, raw — never re-derived
  readonly statisticsType: string | null;
  readonly renderType: string | null;
}

/** Statistics for one provider period (e.g. ALL, 1ST, 2ND). */
export interface PeriodStatistics {
  readonly period: string;
  readonly statistics: readonly TeamStatLine[];
}

export type TeamStatisticsCoverageState = 'present' | 'absent';
export interface MatchTeamStatisticsCoverage {
  readonly teamStatistics: TeamStatisticsCoverageState;
  readonly periodsPresent: readonly string[];
  /** Marks these as the provider's observed statistics, not derived/governed metrics. */
  readonly statisticsAreObserved: true;
  /** Provenance: which provider, and when captured (ISO), from the stored rows. */
  readonly provider: string | null;
  readonly retrievedAt: string | null;
}

export interface MatchTeamStatistics {
  readonly periods: readonly PeriodStatistics[];
  readonly coverage: MatchTeamStatisticsCoverage;
}

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface TeamMatchStatRow {
  period: string;
  group_name: string;
  statistic_key: string;
  statistic_name: string | null;
  home_value: string | null;
  away_value: string | null;
  home_display: string | null;
  away_display: string | null;
  value_type: string | null;
  compare_code: string | null;
  statistics_type: string | null;
  render_type: string | null;
  provider_code: string;
  retrieved_at: Date | string;
}

// ── pure mappers/aggregation ───────────────────────────────────────────────────

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** A stable order for known periods; unknown periods sort after, alphabetically. */
const PERIOD_ORDER: Record<string, number> = { ALL: 0, '1ST': 1, '2ND': 2 };
function periodRank(p: string): number {
  return p in PERIOD_ORDER ? PERIOD_ORDER[p] : 100;
}

export function mapTeamStatLine(r: TeamMatchStatRow): TeamStatLine {
  return {
    groupName: r.group_name,
    statisticKey: r.statistic_key,
    statisticName: r.statistic_name,
    home: { value: r.home_value, display: r.home_display },
    away: { value: r.away_value, display: r.away_display },
    valueType: r.value_type,
    compareCode: r.compare_code,
    statisticsType: r.statistics_type,
    renderType: r.render_type,
  };
}

/**
 * Group rows into per-period statistics. Statistics keep first-seen (SQL) order
 * within a period; periods are ordered by a stable rank (ALL, 1ST, 2ND, …). Pure and
 * deterministic; does not mutate input. Coverage carries provenance (provider + the
 * latest retrieved_at) drawn from the stored rows — never fabricated.
 */
export function groupTeamStatistics(rows: readonly TeamMatchStatRow[]): MatchTeamStatistics {
  const order: string[] = [];
  const byPeriod = new Map<string, TeamStatLine[]>();
  for (const r of rows) {
    let bucket = byPeriod.get(r.period);
    if (!bucket) { bucket = []; byPeriod.set(r.period, bucket); order.push(r.period); }
    bucket.push(mapTeamStatLine(r));
  }
  const periods = order
    .map((period) => ({ period, statistics: byPeriod.get(period)! }))
    .sort((a, b) => periodRank(a.period) - periodRank(b.period) || a.period.localeCompare(b.period));

  // Provenance from the rows: uniform provider, latest capture instant.
  let provider: string | null = null;
  let retrievedAt: string | null = null;
  for (const r of rows) {
    provider = r.provider_code;
    const t = iso(r.retrieved_at);
    if (retrievedAt === null || t > retrievedAt) retrievedAt = t;
  }

  return {
    periods,
    coverage: {
      teamStatistics: rows.length > 0 ? 'present' : 'absent',
      periodsPresent: periods.map((p) => p.period),
      statisticsAreObserved: true,
      provider,
      retrievedAt,
    },
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

const MATCH_TEAM_STATISTICS_SQL = `
  SELECT tms.period AS period, tms.group_name AS group_name,
         tms.statistic_key AS statistic_key, tms.statistic_name AS statistic_name,
         tms.home_value AS home_value, tms.away_value AS away_value,
         tms.home_display AS home_display, tms.away_display AS away_display,
         tms.value_type AS value_type, tms.compare_code AS compare_code,
         tms.statistics_type AS statistics_type, tms.render_type AS render_type,
         tms.provider_code AS provider_code, tms.retrieved_at AS retrieved_at
    FROM football.team_match_statistic tms
   WHERE tms.fixture_id = $1::bigint
   ORDER BY tms.period, tms.group_name, tms.statistic_key
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readMatchTeamStatistics(tx: PoolClient, fixtureId: string): Promise<MatchTeamStatistics> {
  const res = await tx.query<TeamMatchStatRow>(MATCH_TEAM_STATISTICS_SQL, [fixtureId]);
  return groupTeamStatistics(res.rows);
}
