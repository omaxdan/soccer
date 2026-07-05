import React from 'react';
import { getInactiveMatches } from '@/lib/queries';
import { matchUrl } from '@/lib/urls';
import { COLORS , withAlpha } from '@/design/tokens';
import Link from 'next/link';
import TeamCrest from '@/components/TeamCrest';

export const metadata = { title: 'Postponed & Cancelled | NinetyData RIP' };
export const revalidate = 900;

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  postponed: { label: 'POSTPONED', color: COLORS.amber },
  cancelled: { label: 'CANCELLED', color: COLORS.red },
  canceled:  { label: 'CANCELLED', color: COLORS.red },
  abandoned: { label: 'ABANDONED', color: COLORS.orange },
};

export default async function InactiveMatchesPage() {
  const matches = await getInactiveMatches();

  // Group by status for a scannable page rather than one mixed list
  const groups = new Map<string, any[]>();
  for (const m of matches) {
    const key = m.status === 'canceled' ? 'cancelled' : m.status;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const order = ['postponed', 'cancelled', 'abandoned'];
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, margin: 0 }}>
          Postponed &amp; Cancelled
        </h1>
        <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
          Matches that won&apos;t be played as scheduled — excluded from the main Match Center
          to keep it focused on games that will actually happen. Window: past 14 days to next 30.
        </p>
        <Link href="/matches" style={{ fontSize: 12, color: COLORS.blue, textDecoration: 'none' }}>
          ← Back to Match Center
        </Link>
      </div>

      {matches.length === 0 && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: COLORS.dim, fontSize: 13, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
          No postponed, cancelled, or abandoned matches in the current window. Good news, mostly.
        </div>
      )}

      {sortedGroups.map(([status, list]) => {
        const style = STATUS_STYLE[status] ?? { label: status.toUpperCase(), color: COLORS.dim };
        return (
          <div key={status} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: withAlpha(style.color, '20'), color: style.color, border: `1px solid ${withAlpha(style.color, '40')}`, borderRadius: 4, padding: '1px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
                {style.label}
              </span>
              <span style={{ fontSize: 11, color: COLORS.dim }}>{list.length} match{list.length === 1 ? '' : 'es'}</span>
            </div>
            <div>
              {list.map((m: any) => (
                <Link key={m.id} href={matchUrl(m)} style={{ textDecoration: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}`, fontSize: 12 }}>
                    <div style={{ color: COLORS.dim, minWidth: 76, fontFamily: '"JetBrains Mono",monospace', fontSize: 11 }}>
                      {new Date(m.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </div>
                    <div style={{ flex: 1, color: COLORS.text, fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 3, lineHeight: 1.3 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TeamCrest team={m.home_team} size={16} borderRadius={3} />
                        <span>{m.home_team?.short_name ?? m.home_team?.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TeamCrest team={m.away_team} size={16} borderRadius={3} />
                        <span>{m.away_team?.short_name ?? m.away_team?.name}</span>
                      </div>
                    </div>
                    <div className="rip-mobile-hide" style={{ color: COLORS.muted, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                      {m.competition}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
