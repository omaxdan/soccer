// MATCH HUB tabs — server-rendered via ?tab=, mirroring the edition tab pattern.
// Reconciled to the Claude Design Match workspace: five tabs, each answering a
// DIFFERENT question about the fixture. The design intentionally CONSOLIDATES the
// former Comparison / Form / H2H tabs into the Overview landing, folds Venue into the
// match header + Overview, and adds Timeline (the fixture's status history + the
// reading/context as of kickoff). The default is Overview — the intelligence-first
// landing, never a raw comparison.
//
// Legacy links to a removed tab (?tab=comparison|form|h2h|venue) resolve to Overview,
// where that content now lives — see resolveMatchTab.

import { routes } from './routes';

export type MatchTab =
  | 'overview' | 'lineups' | 'statistics' | 'intelligence' | 'timeline';

export const MATCH_TABS: readonly { readonly key: MatchTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lineups', label: 'Lineups' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'timeline', label: 'Timeline' },
];

const TAB_KEYS = new Set<string>(MATCH_TABS.map((t) => t.key));

/** Resolve the ?tab= param to a known tab; unknown/absent → 'overview' (default). */
export function resolveMatchTab(raw: string | undefined): MatchTab {
  return raw && TAB_KEYS.has(raw) ? (raw as MatchTab) : 'overview';
}

/** Tab href built from the current match slug param; the default tab is the clean URL. */
export function matchTabHref(slug: string, tab: MatchTab): string {
  const base = routes.matchBySlug(slug);
  return tab === 'overview' ? base : `${base}?tab=${tab}`;
}
