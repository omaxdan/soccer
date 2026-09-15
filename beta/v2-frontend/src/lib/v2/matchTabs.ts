// MATCH HUB tabs — server-rendered via ?tab=, mirroring the edition tab pattern.
// Four meaningful workspaces; no per-source fragmentation.

import { routes } from './routes';

export type MatchTab = 'intelligence' | 'evidence' | 'match-data' | 'context';

export const MATCH_TABS: readonly { readonly key: MatchTab; readonly label: string }[] = [
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'match-data', label: 'Match data' },
  { key: 'context', label: 'Context' },
];

const TAB_KEYS = new Set<string>(MATCH_TABS.map((t) => t.key));

/** Resolve the ?tab= param to a known tab; unknown/absent → 'intelligence' (default). */
export function resolveMatchTab(raw: string | undefined): MatchTab {
  return raw && TAB_KEYS.has(raw) ? (raw as MatchTab) : 'intelligence';
}

/** Tab href built from the current match slug param; the default tab is the clean URL. */
export function matchTabHref(slug: string, tab: MatchTab): string {
  const base = routes.matchBySlug(slug);
  return tab === 'intelligence' ? base : `${base}?tab=${tab}`;
}
