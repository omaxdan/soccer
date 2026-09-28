// TEAM WORKSPACE tabs — server-rendered via ?tab=. Four destinations, each a distinct
// job matched to the Team Workspace wireframe:
//   Overview    = current readings (readiness / home-away / consistency) + team attributes
//                 + recent results, with a rail of competitions this season + unavailable
//                 players. Fixture context and the deep signal tables live elsewhere.
//   Squad       = the registered roster joined with per-player observations (minutes,
//                 started/bench, goals) + valuations + availability.
//   Performance = descriptive performance indicators, the recent home/away split, and the
//                 performance-signals table. This is where fixture/venue context sits.
//   History     = the whole recorded period — season record, match-by-match, match log and
//                 season statistics (observations + temporal-performance).
//
// There is no Intelligence or Fixtures tab: readings sit in Overview, and fixture context
// sits in Performance. Unknown ?tab= values (including the old 'intelligence' / 'fixtures')
// resolve to Overview, so any old links degrade gracefully.

import { routes } from './routes';

export type TeamTab = 'overview' | 'squad' | 'performance' | 'history';

export const TEAM_TABS: readonly { readonly key: TeamTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'squad', label: 'Squad' },
  { key: 'performance', label: 'Performance' },
  { key: 'history', label: 'History' },
];

const TAB_KEYS = new Set<string>(TEAM_TABS.map((t) => t.key));

// Legacy ?tab= values from before the IA reconciliation fold onto the new grammar.
const LEGACY_TAB: Record<string, TeamTab> = {
  intelligence: 'overview',
  fixtures: 'performance',
};

/** Resolve the ?tab= param to a known tab; legacy values fold, unknown/absent → overview. */
export function resolveTeamTab(raw: string | undefined): TeamTab {
  if (!raw) return 'overview';
  if (TAB_KEYS.has(raw)) return raw as TeamTab;
  return LEGACY_TAB[raw] ?? 'overview';
}

/** Tab href built from the current team slug param (it already carries the trailing id);
 *  the default tab is the clean URL. Uses the teams base so V2_BASE flattening applies. */
export function teamTabHref(slug: string, tab: TeamTab): string {
  const base = `${routes.teams()}/${slug}`;
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}
