// TEAM HUB tabs — server-rendered via ?tab=, mirroring the match/edition tab pattern.
// Each tab answers a different question: Overview = the current intelligence briefing,
// Squad = the roster + availability, Fixtures = schedule/results, Performance = season
// evidence, Intelligence = the deep analytical readings, History = long-term patterns.
// Default is Overview.

import { routes } from './routes';

export type TeamTab = 'overview' | 'squad' | 'fixtures' | 'performance' | 'intelligence' | 'history';

export const TEAM_TABS: readonly { readonly key: TeamTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'squad', label: 'Squad' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'performance', label: 'Performance' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'history', label: 'History' },
];

const TAB_KEYS = new Set<string>(TEAM_TABS.map((t) => t.key));

/** Resolve the ?tab= param to a known tab; unknown/absent → 'overview' (default). */
export function resolveTeamTab(raw: string | undefined): TeamTab {
  return raw && TAB_KEYS.has(raw) ? (raw as TeamTab) : 'overview';
}

/** Tab href built from the current team slug param (it already carries the trailing id);
 *  the default tab is the clean URL. Uses the teams base so V2_BASE flattening applies. */
export function teamTabHref(slug: string, tab: TeamTab): string {
  const base = `${routes.teams()}/${slug}`;
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}
