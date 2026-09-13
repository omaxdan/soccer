// COMPETITION (EDITION) PAGE — PURE PRESENTATION/ORGANIZATION LOGIC (DB-free, no React).
//
// The organizing logic for the competition workspace: which tab is active, how the
// edition's fixtures group into live / upcoming / recent (and by day), which teams
// participate (derived from the fixtures — the real set, never invented), and which
// other seasons of the same competition exist. It fabricates NOTHING: standings and
// competition-level governed intelligence are NOT derived here because the backend
// does not serve them (see the competition page's honest "unavailable" states).

import type { ApiEditionFixture, ApiEditionSummary, ApiTeam } from './types';
import { routes, type V2EditionRef } from './routes';

// ── tabs ─────────────────────────────────────────────────────────────────────────

export type EditionTab = 'overview' | 'matches' | 'standings' | 'teams' | 'intelligence';

export const EDITION_TABS: readonly { readonly key: EditionTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'matches', label: 'Matches' },
  { key: 'standings', label: 'Standings' },
  { key: 'teams', label: 'Teams' },
  { key: 'intelligence', label: 'Intelligence' },
];

const TAB_KEYS = new Set<string>(EDITION_TABS.map((t) => t.key));

/** Resolve a raw `?tab=` value to a valid tab; anything unknown/absent → 'overview'. */
export function resolveEditionTab(raw: string | undefined): EditionTab {
  return raw && TAB_KEYS.has(raw) ? (raw as EditionTab) : 'overview';
}

/** Href for a competition tab. 'overview' is the clean canonical URL (no query), so
 *  the base edition route and the Overview tab are the same address. Built on the
 *  centralized route helper — namespace-neutral, no hardcoded /v2. Accepts a bare id
 *  or an edition ref (for the readable slug). */
export function editionTabHref(edition: string | V2EditionRef, tab: EditionTab): string {
  const base = routes.edition(edition);
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}

// ── fixture organization ───────────────────────────────────────────────────────

export interface GroupedFixtures {
  readonly live: ApiEditionFixture[];      // IN_PROGRESS
  readonly upcoming: ApiEditionFixture[];  // not completed / not live — chronological
  readonly recent: ApiEditionFixture[];    // COMPLETED — reverse-chronological
}

function kickoffTime(f: ApiEditionFixture): number {
  const t = Date.parse(f.kickoffAt);
  return Number.isNaN(t) ? 0 : t;
}

/** Split fixtures into live / upcoming / recent by governed status, each ordered for
 *  reading (upcoming ascending, recent descending). Does not mutate the input. */
export function classifyFixtures(fixtures: readonly ApiEditionFixture[]): GroupedFixtures {
  const live: ApiEditionFixture[] = [];
  const upcoming: ApiEditionFixture[] = [];
  const recent: ApiEditionFixture[] = [];
  for (const f of fixtures) {
    if (f.status === 'IN_PROGRESS') live.push(f);
    else if (f.status === 'COMPLETED') recent.push(f);
    else upcoming.push(f);
  }
  upcoming.sort((a, b) => kickoffTime(a) - kickoffTime(b));
  recent.sort((a, b) => kickoffTime(b) - kickoffTime(a));
  live.sort((a, b) => kickoffTime(a) - kickoffTime(b));
  return { live, upcoming, recent };
}

export interface FixtureDay {
  readonly dayKey: string;   // YYYY-MM-DD (UTC) — stable grouping key
  readonly fixtures: ApiEditionFixture[];
}

/** Group an already-ordered fixture list into calendar days (UTC), preserving the
 *  incoming order of both days and fixtures-within-day. */
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

// ── team discovery (derived from real fixtures) ──────────────────────────────────

/** The distinct teams that actually appear in this edition's fixtures, sorted by
 *  name. Derived from real fixture data — never a fabricated roster. */
export function deriveEditionTeams(fixtures: readonly ApiEditionFixture[]): ApiTeam[] {
  const byId = new Map<string, ApiTeam>();
  for (const f of fixtures) {
    if (!byId.has(f.homeTeam.id)) byId.set(f.homeTeam.id, f.homeTeam);
    if (!byId.has(f.awayTeam.id)) byId.set(f.awayTeam.id, f.awayTeam);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── season siblings (from the editions list) ─────────────────────────────────────

/** Other tracked seasons of the SAME competition, newest label first, including the
 *  current one. Used for the season selector; returns just the current edition when
 *  no siblings are tracked. Never invents a season. */
export function siblingSeasons(
  editions: readonly ApiEditionSummary[],
  competitionId: string,
): ApiEditionSummary[] {
  return editions
    .filter((e) => e.competition.id === competitionId)
    .sort((a, b) => b.seasonLabel.localeCompare(a.seasonLabel));
}
