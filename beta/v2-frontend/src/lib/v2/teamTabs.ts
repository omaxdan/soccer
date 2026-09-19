// TEAM HUB tabs — server-rendered via ?tab=. Three destinations, each a distinct job:
// Overview = the current intelligence briefing (summaries + links), Squad = the roster
// and availability, Performance = the single canonical deep-evidence home (form, governed
// readings, fixture history, season statistics, last match).
//
// Intelligence, Fixtures and History were removed after an IA audit: Intelligence only
// re-showed the evidence behind Overview's briefing (→ folded into Performance), Fixtures
// duplicated Overview's next fixture + Performance's recent results, and History was a
// dead-end until a multi-season substrate exists. Unknown ?tab= values resolve to Overview,
// so any old Intelligence/Fixtures/History links degrade gracefully.

import { routes } from './routes';

export type TeamTab = 'overview' | 'squad' | 'performance';

export const TEAM_TABS: readonly { readonly key: TeamTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'squad', label: 'Squad' },
  { key: 'performance', label: 'Performance' },
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
