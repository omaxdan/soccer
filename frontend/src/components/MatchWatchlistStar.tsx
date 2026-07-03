'use client';
import { useState, useEffect } from 'react';
import { loadWatchlistOf, saveWatchlistOf } from '@/lib/watchlist';
import { COLORS } from '@/design/tokens';

interface Props {
  matchId: number;
}

/** A single star toggle button for adding/removing one match from the
 *  match watchlist. Deliberately a tiny, self-contained CLIENT component
 *  ('use client') rather than converting matches/page.tsx (a server
 *  component doing server-side data fetching) into a client component —
 *  Next.js's standard pattern for adding one small island of
 *  interactivity to an otherwise server-rendered page, avoiding the much
 *  bigger structural change full client-side conversion would require
 *  (losing server rendering, restructuring how searchParams is read).
 *
 *  Reads/writes localStorage directly (via the shared watchlist.ts
 *  module, same 'match' entity type used by the /watchlist page) — no
 *  props needed from the parent beyond the match's own ID. */
export default function MatchWatchlistStar({ matchId }: Props) {
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    setStarred(loadWatchlistOf('match').has(matchId));
  }, [matchId]);

  const toggle = (e: React.MouseEvent) => {
    // Stop the click reaching the row's own <Link> (the match row is a
    // clickable link to the match detail page) — starring shouldn't
    // navigate away.
    e.preventDefault();
    e.stopPropagation();
    const ids = loadWatchlistOf('match');
    if (ids.has(matchId)) ids.delete(matchId);
    else ids.add(matchId);
    saveWatchlistOf('match', ids);
    setStarred(!starred);
  };

  return (
    <button
      onClick={toggle}
      title={starred ? 'Remove from watchlist' : 'Add to watchlist'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2, color: starred ? COLORS.amber : COLORS.dim }}
    >
      ★
    </button>
  );
}
