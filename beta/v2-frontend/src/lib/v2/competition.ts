// COMPETITION / EDITION WORKSPACE — PURE PRESENTATION/ORGANIZATION LOGIC (DB-free, no React).
//
// The organizing logic for the Edition workspace: which tab is active, how the
// edition's fixtures organise for the Fixtures tab (grouped by kickoff day, filtered
// by governed status) and the Overview strip (latest results / next scheduled), plus
// small pure formatters. It fabricates NOTHING: standings come from the governed
// backend read (never computed here), status is displayed exactly as supplied (never
// relabelled by the clock), and missing scores stay missing.
//
// Information architecture (from the Competition/Edition wireframe): the workspace
// ships EXACTLY three tabs — Overview · Table · Fixtures. Advanced edition reads
// (observations, position-trajectory, temporal-performance, table-context) are
// available in the backend but the design specifies no surface for them yet, so they
// are intentionally not rendered (available-but-not-surfaced).

import type { ApiEditionFixture, ApiEditionSummary } from './types';
import { routes, type V2EditionRef } from './routes';

// ── tabs ─────────────────────────────────────────────────────────────────────────

export type EditionTab = 'overview' | 'table' | 'fixtures';

export const EDITION_TABS: readonly { readonly key: EditionTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'table', label: 'Table' },
  { key: 'fixtures', label: 'Fixtures' },
];

const TAB_KEYS = new Set<string>(EDITION_TABS.map((t) => t.key));

// Legacy `?tab=` values from the pre-reconciliation workspace fold onto the new grammar
// so old links keep working: Matches → Fixtures, Standings → Table, Teams/Intelligence
// (never shipped as tabs in the reconciled IA) → Overview.
const LEGACY_TAB: Record<string, EditionTab> = {
  matches: 'fixtures',
  standings: 'table',
  teams: 'overview',
  intelligence: 'overview',
};

/** Resolve a raw `?tab=` value to a valid tab; legacy values fold, anything else →
 *  'overview'. */
export function resolveEditionTab(raw: string | undefined): EditionTab {
  if (!raw) return 'overview';
  if (TAB_KEYS.has(raw)) return raw as EditionTab;
  return LEGACY_TAB[raw] ?? 'overview';
}

/** Href for a workspace tab. 'overview' is the clean canonical URL (no query), so the
 *  base edition route and Overview are the same address. Built on the centralized route
 *  helper — namespace-neutral, no hardcoded /v2. Accepts a bare id or an edition ref. */
export function editionTabHref(edition: string | V2EditionRef, tab: EditionTab): string {
  const base = routes.edition(edition);
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}

// ── fixture organisation (status displayed as supplied — never relabelled by clock) ─

function kickoffTime(f: ApiEditionFixture): number {
  const t = Date.parse(f.kickoffAt);
  return Number.isNaN(t) ? 0 : t;
}

/** The completed results, most recent first. */
export function recentResults(fixtures: readonly ApiEditionFixture[], limit?: number): ApiEditionFixture[] {
  const out = fixtures.filter((f) => f.status === 'COMPLETED').sort((a, b) => kickoffTime(b) - kickoffTime(a));
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

/** The scheduled fixtures, earliest first. Strictly SCHEDULED (not POSTPONED etc.). */
export function nextScheduled(fixtures: readonly ApiEditionFixture[], limit?: number): ApiEditionFixture[] {
  const out = fixtures.filter((f) => f.status === 'SCHEDULED').sort((a, b) => kickoffTime(a) - kickoffTime(b));
  return typeof limit === 'number' ? out.slice(0, limit) : out;
}

/** Every fixture of one governed status, ordered for reading (COMPLETED newest-first,
 *  everything else earliest-first). Does not mutate the input. */
export function fixturesForStatus(fixtures: readonly ApiEditionFixture[], status: string): ApiEditionFixture[] {
  const out = fixtures.filter((f) => f.status === status);
  return status === 'COMPLETED'
    ? out.sort((a, b) => kickoffTime(b) - kickoffTime(a))
    : out.sort((a, b) => kickoffTime(a) - kickoffTime(b));
}

/** Counts per governed status actually present, in a stable display order. Used to
 *  build the status filter — a segment appears only when that status has fixtures. */
export function statusCounts(fixtures: readonly ApiEditionFixture[]): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of fixtures) counts.set(f.status, (counts.get(f.status) ?? 0) + 1);
  const ORDER = ['COMPLETED', 'IN_PROGRESS', 'SCHEDULED', 'POSTPONED', 'ABANDONED', 'CANCELLED'];
  const ranked = [...counts.keys()].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
  });
  return ranked.map((status) => ({ status, count: counts.get(status)! }));
}

export interface FixtureDay {
  readonly dayKey: string;   // YYYY-MM-DD (UTC) — stable grouping key
  readonly fixtures: ApiEditionFixture[];
}

/** Group an already-ordered fixture list into calendar days (UTC), preserving the
 *  incoming order of both days and fixtures-within-day. Grouping key is the kickoff
 *  date only — the payload carries no round/matchday. */
export function groupFixturesByDay(fixtures: readonly ApiEditionFixture[]): FixtureDay[] {
  const days: FixtureDay[] = [];
  const index = new Map<string, ApiEditionFixture[]>();
  for (const f of fixtures) {
    const dayKey = f.kickoffAt.slice(0, 10); // ISO date portion (UTC)
    let bucket = index.get(dayKey);
    if (!bucket) { bucket = []; index.set(dayKey, bucket); days.push({ dayKey, fixtures: bucket }); }
    bucket.push(f);
  }
  return days;
}

// ── edition facts (derived from the real fixtures — never invented) ────────────────

export interface EditionFixtureFacts {
  readonly count: number;
  readonly firstKickoff: string | null;   // ISO — earliest kickoff of any status
  readonly lastKickoff: string | null;    // ISO — latest scheduled/known kickoff
  readonly latestResult: string | null;   // ISO — latest kickoff among COMPLETED
}

/** Summary facts about the edition's fixtures, all from real kickoff data. Empty list
 *  → all nulls (absence stays absence). */
export function editionFixtureFacts(fixtures: readonly ApiEditionFixture[]): EditionFixtureFacts {
  let first: number | null = null, last: number | null = null, latest: number | null = null;
  let firstIso: string | null = null, lastIso: string | null = null, latestIso: string | null = null;
  for (const f of fixtures) {
    const t = kickoffTime(f);
    if (first === null || t < first) { first = t; firstIso = f.kickoffAt; }
    if (last === null || t > last) { last = t; lastIso = f.kickoffAt; }
    if (f.status === 'COMPLETED' && (latest === null || t > latest)) { latest = t; latestIso = f.kickoffAt; }
  }
  return { count: fixtures.length, firstKickoff: firstIso, lastKickoff: lastIso, latestResult: latestIso };
}

// ── seasons (for the edition switcher) ─────────────────────────────────────────────

/** The competition's tracked editions, newest season label first. Never invents a
 *  season; a single tracked edition returns just itself. */
export function sortSeasonsDesc(editions: readonly ApiEditionSummary[]): ApiEditionSummary[] {
  return [...editions].sort((a, b) => b.seasonLabel.localeCompare(a.seasonLabel));
}

// ── formatters (deterministic presentation transforms only) ────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A YYYY-MM-DD snapshot date as "DD Mon YYYY" (e.g. "11 Aug 2026"). Returns the raw
 *  input unchanged if it is not a plain calendar date. Point-in-time is never hidden. */
export function formatAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return iso;
  return `${Number(d)} ${month} ${y}`;
}

/** A full UTC day label for a fixture date group, e.g. "Sat 6 Sep 2026". */
export function fixtureDayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A compact UTC date, e.g. "6 Sep" (Overview strip rows). */
export function fixtureShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
