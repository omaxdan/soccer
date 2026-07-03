'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getWatchlistTeams, WatchlistTeamRow } from '@/lib/queries';
import { loadWatchlist, saveWatchlist } from '@/lib/watchlist';
import { COLORS, scoreColor } from '@/design/tokens';
import { teamUrl } from '@/lib/urls';
import { SkeletonCard } from '@/components/SkeletonCard';

function Card({ children, style = {} }: any) {
  return <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}

export default function WatchlistPage() {
  const [teams, setTeams] = useState<WatchlistTeamRow[]>([]);
  const [watchedIds, setWatchedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = loadWatchlist();
    setWatchedIds(ids);
    if (ids.size === 0) {
      setLoading(false);
      return;
    }
    getWatchlistTeams([...ids])
      .then(setTeams)
      .catch(() => setTeams([]))
      .finally(() => setLoading(false));
  }, []);

  const removeFromWatchlist = (id: number) => {
    const next = new Set(watchedIds);
    next.delete(id);
    setWatchedIds(next);
    saveWatchlist(next);
    setTeams(prev => prev.filter(t => t.id !== id));
  };

  if (loading) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SkeletonCard height={40} />
        <SkeletonCard height={80} />
        <SkeletonCard height={80} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>⭐ My Watchlist</div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>
          {teams.length > 0 ? `${teams.length} team${teams.length === 1 ? '' : 's'} you're tracking` : 'Save teams to monitor here'}
        </div>
      </div>

      {teams.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⭐</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>Your watchlist is empty</div>
          <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
            Click the ★ icon next to any team on the Teams page to track it here.
          </div>
          <Link href="/teams" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: COLORS.blue, color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Browse Teams →
          </Link>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {teams.map(t => (
            <Card key={t.id} style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Link href={teamUrl({ id: t.id, slug: t.slug, name: t.name })} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.short_name ?? t.name}
                    </div>
                    <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>
                      {t.league ?? t.country ?? '—'}{t.position != null ? ` · #${t.position}` : ''}
                    </div>
                  </div>
                </Link>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Readiness</div>
                    <div style={{
                      fontFamily: '"JetBrains Mono",monospace', fontSize: 15, fontWeight: 700,
                      color: t.readiness_score != null ? scoreColor(t.readiness_score) : COLORS.dim,
                    }}>
                      {t.readiness_score != null ? Math.round(t.readiness_score) : '—'}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFromWatchlist(t.id)}
                    title="Remove from watchlist"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: COLORS.amber }}
                  >
                    ★
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
