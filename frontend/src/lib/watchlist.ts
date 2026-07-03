// ─── WATCHLIST — localStorage, no backend table ────────────────────────────
// This project has no user authentication system (checked before building
// this — no supabase.auth, no session, no login anywhere in the frontend),
// so a per-user Supabase table with a user_id column would be premature:
// there'd be no real user_id to populate it with. localStorage is the
// correct storage for a no-auth app; a real user_watchlists table becomes
// worth building once actual auth exists, not before.
//
// Single source of truth for the storage key and read/write logic — was
// previously defined locally inside teams/page.tsx only, meaning the
// dedicated /watchlist page had no way to read the same data (it was a
// static stub, always rendering "empty" regardless of what was actually
// starred). Both pages now import from here.

const WATCHLIST_KEY = 'rip_team_watchlist';

export function loadWatchlist(): Set<number> {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? new Set<number>(JSON.parse(raw)) : new Set<number>();
  } catch {
    return new Set<number>();
  }
}

export function saveWatchlist(ids: Set<number>) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private browsing, quota) — fail silently,
    // same as the original teams/page.tsx behavior.
  }
}
