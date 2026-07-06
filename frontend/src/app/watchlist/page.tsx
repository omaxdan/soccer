'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getWatchlistTeams, getWatchlistMatches, WatchlistTeamRow, WatchlistMatchRow } from '@/lib/queries';
import { loadWatchlistOf, saveWatchlistOf } from '@/lib/watchlist';
import { COLORS, scoreColor } from '@/design/tokens';
import { teamUrl, matchUrl } from '@/lib/urls';
import { SkeletonCard } from '@/components/SkeletonCard';

function Card({ children, style = {} }: any) {
  return <div style={{ background: COLORS.surface, border: COLORS.cardBorder, boxShadow: COLORS.shadowCard, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}

export default function WatchlistPage() {
  const [teams, setTeams] = useState<WatchlistTeamRow[]>([]);
  const [matches, setMatches] = useState<WatchlistMatchRow[]>([]);
  const [watchedTeamIds, setWatchedTeamIds] = useState<Set<number>>(new Set());
  const [watchedMatchIds, setWatchedMatchIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const teamIds = loadWatchlistOf('team');
    const matchIds = loadWatchlistOf('match');
    setWatchedTeamIds(teamIds);
    setWatchedMatchIds(matchIds);

    Promise.all([
      teamIds.size > 0 ? getWatchlistTeams([...teamIds]).catch(() => []) : Promise.resolve([]),
      matchIds.size > 0 ? getWatchlistMatches([...matchIds]).catch(() => []) : Promise.resolve([]),
    ]).then(([t, m]) => {
      setTeams(t);
      setMatches(m);
      setLoading(false);
    });
  }, []);

  const removeTeam = (id: number) => {
    const next = new Set(watchedTeamIds);
    next.delete(id);
    setWatchedTeamIds(next);
    saveWatchlistOf('team', next);
    setTeams(prev => prev.filter(t => t.id !== id));
  };

  const removeMatch = (id: number) => {
    const next = new Set(watchedMatchIds);
    next.delete(id);
    setWatchedMatchIds(next);
    saveWatchlistOf('match', next);
    setMatches(prev => prev.filter(m => m.id !== id));
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

  const isEmpty = teams.length === 0 && matches.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>⭐ My Watchlist</div>
        <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 2 }}>
          {!isEmpty ? `${teams.length} team${teams.length === 1 ? '' : 's'}, ${matches.length} match${matches.length === 1 ? '' : 'es'} you're tracking` : 'Save teams and matches to monitor here'}
        </div>
      </div>

      {isEmpty ? (
        <Card style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⭐</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, marginBottom: 8 }}>Your watchlist is empty</div>
          <div style={{ fontSize: 13, color: COLORS.muted, marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
            Click the ★ icon next to any team or match to track it here.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Link href="/teams" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: COLORS.blue, color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              Browse Teams →
            </Link>
            <Link href="/matches" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              Browse Matches →
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {matches.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Matches
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {matches.map(m => {
                  const hasScore = m.homeScore != null && m.awayScore != null;
                  return (
                    <Card key={m.id} style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <Link href={matchUrl({ id: m.id, home_team: m.home_team, away_team: m.away_team })} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, textDecoration: 'none' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.home_team?.short_name ?? m.home_team?.name ?? 'Home'}
                              {hasScore
                                ? <span style={{ fontFamily: '"JetBrains Mono",monospace', color: COLORS.green, fontWeight: 700 }}> {m.homeScore}–{m.awayScore} </span>
                                : ' v '}
                              {m.away_team?.short_name ?? m.away_team?.name ?? 'Away'}
                            </div>
                            <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 2 }}>
                              {m.competition} · {m.status === 'finished' ? 'FT' : new Date(m.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </Link>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                          {(m.homeReadiness != null || m.awayReadiness != null) && (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Readiness</div>
                              <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 13, fontWeight: 700 }}>
                                <span style={{ color: m.homeReadiness != null ? scoreColor(m.homeReadiness) : COLORS.dim }}>{m.homeReadiness != null ? Math.round(m.homeReadiness) : '—'}</span>
                                <span style={{ color: COLORS.dim }}> / </span>
                                <span style={{ color: m.awayReadiness != null ? scoreColor(m.awayReadiness) : COLORS.dim }}>{m.awayReadiness != null ? Math.round(m.awayReadiness) : '—'}</span>
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => removeMatch(m.id)}
                            title="Remove from watchlist"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: COLORS.amber }}
                          >
                            ★
                          </button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {teams.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Teams
              </div>
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
                          onClick={() => removeTeam(t.id)}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
