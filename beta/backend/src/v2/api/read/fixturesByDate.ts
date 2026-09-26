// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES BY DATE — canonical fixture-calendar read model (read-only, provider-free)
//
// GET /api/v2/fixtures/{YYYY-MM-DD}. The single date-addressed calendar surface for
// the frontend and (later) subscribers. Deterministic, read-only, backed entirely by
// persisted football state — no provider call, no snapshot, no intelligence, no writes.
//
// DATE SEMANTICS (locked): {date} is a UTC calendar date filtered on the CURRENT
// scheduled kickoff — `scheduled_kickoff_at ∈ [date 00:00:00Z, nextDate 00:00:00Z)`.
// NEVER server-local time, NEVER `fixture_partition_on` (the immutable original date).
// So a rescheduled fixture appears under its NEW date; postponed/cancelled remain under
// their current scheduled date; past and future dates behave identically.
//
// GROUPING (locked): date → countries[] → competitions[] → edition → fixtures[].
// country_code is nullable (schema): unknown country is a null bucket, sorted last,
// never fabricated. Ordering is fully deterministic (country, competition, edition,
// kickoff, fixtureId).
//
// STATUS (locked): every governed lifecycle_state_code is included (SCHEDULED,
// IN_PROGRESS, COMPLETED, POSTPONED, ABANDONED, CANCELLED, UNKNOWN) — never filtered to
// COMPLETED, never the raw provider status.
//
// RESULT (locked): each fixture carries the CANONICAL match-result object (reusing
// MatchResult / mapResult from matchResult.ts) — final + half-time + extra-time +
// penalties + confirmedAt — so a consumer displays a completed result without a second
// call. A completed fixture with no persisted result → result: null (missing ≠ zero);
// a genuine confirmed 0-0 → an actual {0,0}. `score` mirrors ApiEditionFixture's legacy
// final-only field for backward compatibility.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { ApiTeam, ApiScore } from '../contract';
import { mapResult, type MatchResult, type ResultRow } from './matchResult';

// ── wire DTOs (reuse ApiEditionFixture's fields; add the canonical result) ───────

/** One fixture on a calendar date. Reuses ApiEditionFixture's shape (fixtureId,
 *  kickoffAt, status, homeTeam, awayTeam, score) and adds the canonical `result`. */
export interface CalendarFixture {
  readonly fixtureId: string;
  readonly kickoffAt: string;                 // ISO-8601, the CURRENT scheduled kickoff
  readonly status: string;                    // governed lifecycle_state_code (never provider raw)
  readonly homeTeam: ApiTeam;
  readonly awayTeam: ApiTeam;
  readonly score: ApiScore | null;            // legacy final-only (ApiEditionFixture parity)
  readonly result: MatchResult | null;        // canonical full breakdown, or null (missing ≠ zero)
}

export interface CalendarCompetitionGroup {
  readonly competitionId: string;
  readonly name: string;
  readonly slug: string;
  readonly edition: { readonly editionId: string; readonly seasonLabel: string };
  readonly fixtures: readonly CalendarFixture[];
}

export interface CalendarCountryGroup {
  readonly country: { readonly code: string; readonly name: string } | null; // null = unknown bucket
  readonly competitions: readonly CalendarCompetitionGroup[];
}

export interface FixturesByDateResponse {
  readonly date: string;                      // echo of the queried UTC calendar date
  readonly fixtureCount: number;
  readonly countries: readonly CalendarCountryGroup[];
}

// ── date validation + UTC window (pure) ─────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a strict YYYY-MM-DD UTC calendar date and return its half-open UTC window
 *  [start, nextDay). Returns null for a malformed or non-existent date (e.g. 2026-02-30),
 *  so the caller can answer 400 via the existing badRequest convention. Pure. */
export function parseUtcCalendarDate(date: string): { readonly startIso: string; readonly endIso: string } | null {
  if (!DATE_RE.test(date)) return null;
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  // Reject values that rolled over (e.g. month 13, day 32): the round-trip must match.
  if (start.toISOString().slice(0, 10) !== date) return null;
  const end = new Date(start.getTime() + 86_400_000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** True for a well-formed, real UTC calendar date. */
export function isValidCalendarDate(date: string): boolean {
  return parseUtcCalendarDate(date) !== null;
}

// ── raw row shape ────────────────────────────────────────────────────────────────

export interface CalendarRow extends ResultRow {
  fixture_id: string;
  scheduled_kickoff_at: Date | string;
  status: string;
  country_code: string | null;
  country_name: string | null;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  edition_id: string;
  season_label: string;
  home_id: string; home_name: string; home_slug: string;
  away_id: string; away_name: string; away_slug: string;
}

function iso(v: Date | string): string { return v instanceof Date ? v.toISOString() : new Date(v).toISOString(); }

// ── pure assembly ────────────────────────────────────────────────────────────────

/** Group ordered rows into country → competition(+edition) → fixtures. The SQL guarantees
 *  the order (country nulls last, competition, edition, kickoff, fixtureId), so grouping is
 *  a single sequential pass and the output is deterministic. Pure. */
export function assembleFixturesByDate(date: string, rows: readonly CalendarRow[]): FixturesByDateResponse {
  const countries: CalendarCountryGroup[] = [];
  let curCountryKey: string | null = null;
  let curCountry: { country: { code: string; name: string } | null; competitions: CalendarCompetitionGroup[] } | null = null;
  let curCompKey: string | null = null;
  let curComp: (CalendarCompetitionGroup & { fixtures: CalendarFixture[] }) | null = null;

  for (const row of rows) {
    const countryKey = row.country_code ?? '\u0000null'; // stable key; real codes are [A-Z]{2}
    if (curCountry === null || countryKey !== curCountryKey) {
      curCountry = {
        country: row.country_code ? { code: row.country_code, name: row.country_name ?? row.country_code } : null,
        competitions: [],
      };
      countries.push(curCountry);
      curCountryKey = countryKey;
      curCompKey = null; curComp = null;
    }
    // A competition group is per (competition, edition) — the locked shape nests ONE
    // edition; a competition running two editions on a date yields two entries (rare, honest).
    const compKey = `${row.competition_id}\u0000${row.edition_id}`;
    if (curComp === null || compKey !== curCompKey) {
      curComp = {
        competitionId: row.competition_id, name: row.competition_name, slug: row.competition_slug,
        edition: { editionId: row.edition_id, seasonLabel: row.season_label },
        fixtures: [],
      };
      curCountry.competitions.push(curComp);
      curCompKey = compKey;
    }
    // The LEFT JOIN yields a row even with no result: detect absence by the NOT-NULL final
    // goals being null. 0 is a real score, so only null (not falsiness) means "no result".
    const hasResult = row.home_goals !== null && row.home_goals !== undefined
      && row.away_goals !== null && row.away_goals !== undefined;
    const result = hasResult ? mapResult(row) : null;
    curComp.fixtures.push({
      fixtureId: row.fixture_id,
      kickoffAt: iso(row.scheduled_kickoff_at),
      status: row.status,
      homeTeam: { id: row.home_id, name: row.home_name, slug: row.home_slug },
      awayTeam: { id: row.away_id, name: row.away_name, slug: row.away_slug },
      score: result ? { home: result.final.home, away: result.final.away } : null,
      result,
    });
  }

  return { date, fixtureCount: rows.length, countries };
}

// ── SQL (read-only, set-based) ──────────────────────────────────────────────────

/** Every fixture whose CURRENT scheduled kickoff falls in the UTC window, with its
 *  edition/competition/country/teams and full result. All lifecycle states; result via
 *  LEFT JOIN (absent → null). Ordered for deterministic grouping. $1 start, $2 end. */
export const FIXTURES_BY_DATE_SQL = `
  SELECT f.id::text                     AS fixture_id,
         f.scheduled_kickoff_at         AS scheduled_kickoff_at,
         f.lifecycle_state_code         AS status,
         ct.code                        AS country_code,
         ct.display_name                AS country_name,
         c.id::text                     AS competition_id,
         c.name                         AS competition_name,
         c.slug                         AS competition_slug,
         e.id::text                     AS edition_id,
         e.season_label                 AS season_label,
         hf.id::text AS home_id, hf.name AS home_name, hf.slug AS home_slug,
         af.id::text AS away_id, af.name AS away_name, af.slug AS away_slug,
         r.home_goals, r.away_goals,
         r.home_goals_half_time, r.away_goals_half_time,
         r.home_goals_extra_time, r.away_goals_extra_time,
         r.home_penalties, r.away_penalties, r.confirmed_at
    FROM football.fixture f
    JOIN football.competition_edition e ON e.id = f.competition_edition_id
    JOIN football.competition c         ON c.id = e.competition_id
    LEFT JOIN football.country ct       ON ct.code = c.country_code
    JOIN football.team hf               ON hf.id = f.home_team_id
    JOIN football.team af               ON af.id = f.away_team_id
    LEFT JOIN football.result r         ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.scheduled_kickoff_at >= $1::timestamptz
     AND f.scheduled_kickoff_at <  $2::timestamptz
   ORDER BY (ct.code IS NULL), ct.code, c.name, c.id, e.season_label, e.id, f.scheduled_kickoff_at, f.id
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** The fixture calendar for one UTC date, or null when the date is malformed/non-existent
 *  (caller answers 400). A valid date with no fixtures yields an empty, 200-worthy response.
 *  One bounded set-based query; no provider call, no write. */
export async function readFixturesByDate(tx: PoolClient, date: string): Promise<FixturesByDateResponse | null> {
  const window = parseUtcCalendarDate(date);
  if (window === null) return null;
  const res = await tx.query<CalendarRow>(FIXTURES_BY_DATE_SQL, [window.startIso, window.endIso]);
  return assembleFixturesByDate(date, res.rows);
}
