// MATCH HUB tabs — server-rendered via ?tab=, mirroring the edition tab pattern.
// Each tab answers a DIFFERENT question about the fixture (Overview = "what matters?",
// Comparison = "how do they compare?", Form = "what have they done recently?", …).
// The default is Overview — the intelligence-first landing, never a raw comparison.

import { routes } from './routes';

export type MatchTab =
  | 'overview' | 'comparison' | 'form' | 'lineups' | 'h2h' | 'statistics' | 'venue' | 'intelligence';

export const MATCH_TABS: readonly { readonly key: MatchTab; readonly label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'comparison', label: 'Comparison' },
  { key: 'form', label: 'Form' },
  { key: 'lineups', label: 'Lineups' },
  { key: 'h2h', label: 'H2H' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'venue', label: 'Venue' },
  { key: 'intelligence', label: 'Intelligence' },
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
