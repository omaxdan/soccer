// ─── WATCHLIST — localStorage, no backend table ────────────────────────────
// This project has no user authentication system (checked before building
// this — no supabase.auth, no session, no login anywhere in the frontend),
// so a per-user Supabase table with a user_id column would be premature:
// there'd be no real user_id to populate it with. localStorage is the
// correct storage for a no-auth app; a real user_watchlists table becomes
// worth building once actual auth exists, not before.
//
// Single source of truth for storage keys and read/write logic — the team
// watchlist was previously defined locally inside teams/page.tsx only,
// meaning the dedicated /watchlist page had no way to read the same data
// (it was a static stub, always rendering "empty" regardless of what was
// actually starred). Every page now imports from here.
//
// Generic over entity TYPE (team | match) rather than two near-duplicate
// modules — same lesson as the team-only bug above: one storage
// implementation, not two copies that can drift out of sync with each
// other. Each type gets its own separate localStorage key (matches and
// teams are unrelated entities, never mixed in one list).

export type WatchlistType = 'team' | 'match';

const KEYS: Record<WatchlistType, string> = {
  team: 'rip_team_watchlist',
  match: 'rip_match_watchlist',
};

export function loadWatchlistOf(type: WatchlistType): Set<number> {
  try {
    const raw = localStorage.getItem(KEYS[type]);
    return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
  } catch {
    return new Set<number>();
  }
}

export function saveWatchlistOf(type: WatchlistType, ids: Set<number>) {
  try {
    localStorage.setItem(KEYS[type], JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private browsing, quota) — fail silently,
    // same as the original teams/page.tsx behavior.
  }
}

// ─── Backward-compatible team-only wrappers ────────────────────────────────
// Existing call sites (teams/page.tsx, watchlist/page.tsx) use these —
// kept so this genericization doesn't force updating every existing
// caller at once. New code (matches) should call loadWatchlistOf/
// saveWatchlistOf directly with an explicit type.
export function loadWatchlist(): Set<number> {
  return loadWatchlistOf('team');
}
export function saveWatchlist(ids: Set<number>) {
  saveWatchlistOf('team', ids);
}
