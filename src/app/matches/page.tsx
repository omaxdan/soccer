import { getTodaysMatches, getMatchesForDate, getTeamIntelligenceMap } from '@/lib/queries';
import MatchIntelTable from '@/components/MatchIntelTable';
import Link from 'next/link';

export const metadata = { title: 'Match Center' };
export const revalidate = 900; // 15 min — shorter for live navigation

// Helpers ─────────────────────────────────────────────────────────────────────

function toUTCDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + days);
  return toUTCDateStr(d);
}

function formatDisplayDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const todayStr = toUTCDateStr(new Date());
  const tomorrowStr = shiftDate(todayStr, 1);
  const yesterdayStr = shiftDate(todayStr, -1);
  if (dateStr === todayStr)       return 'Today';
  if (dateStr === tomorrowStr)    return 'Tomorrow';
  if (dateStr === yesterdayStr)   return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function NavPill({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link href={href} style={{
      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: active ? 700 : 400,
      background: active ? '#6060cc' : 'var(--surface2)',
      color: active ? '#fff' : 'var(--dim)',
      border: `1px solid ${active ? '#6060cc' : 'var(--border)'}`,
      textDecoration: 'none', whiteSpace: 'nowrap',
    }}>
      {label}
    </Link>
  );
}

// Page ────────────────────────────────────────────────────────────────────────

export default async function MatchCenter({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params   = await searchParams;
  const todayStr = toUTCDateStr(new Date());

  // Validate the date param — reject anything that isn't YYYY-MM-DD,
  // or dates outside the ±7-day window (no point fetching further)
  let activeDateStr = todayStr;
  if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    const requested = new Date(params.date + 'T12:00:00Z');
    const today     = new Date(todayStr + 'T12:00:00Z');
    const diffDays  = Math.round((requested.getTime() - today.getTime()) / 86400000);
    if (diffDays >= -7 && diffDays <= 7) {
      activeDateStr = params.date;
    }
  }

  const isToday   = activeDateStr === todayStr;
  const matches   = await (isToday ? getTodaysMatches() : getMatchesForDate(activeDateStr)).catch(() => []);
  const teamIds   = (matches as any[]).flatMap((m: any) => [m.home_team_id, m.away_team_id]).filter(Boolean);
  const teamIntelMap = await getTeamIntelligenceMap(teamIds);

  // Build the ±7-day pill strip
  const days: { dateStr: string; label: string }[] = [];
  for (let i = -7; i <= 7; i++) {
    const ds = shiftDate(todayStr, i);
    const d  = new Date(ds + 'T12:00:00Z');
    days.push({
      dateStr: ds,
      label: i === 0 ? 'Today'
        : i === 1 ? 'Tomorrow'
        : i === -1 ? 'Yesterday'
        : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    });
  }

  const prevDate = shiftDate(activeDateStr, -1);
  const nextDate = shiftDate(activeDateStr, 1);
  const prevOk   = new Date(prevDate + 'T12:00:00Z') >= new Date(shiftDate(todayStr, -7) + 'T12:00:00Z');
  const nextOk   = new Date(nextDate + 'T12:00:00Z') <= new Date(shiftDate(todayStr, 7) + 'T12:00:00Z');

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f0ff' }}>🎯 Match Center</div>
          <div style={{ fontSize: 12, color: '#8888aa', marginTop: 2 }}>
            {formatDisplayDate(activeDateStr)} · {(matches as any[]).length} matches · H/A columns show home/away values
          </div>
        </div>
        <Link href="/matches" style={{ fontSize: 11, color: 'var(--dim)', textDecoration: 'none' }}>
          {!isToday ? '← Back to Today' : ''}
        </Link>
      </div>

      {/* Prev / Next arrows + pill strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Prev arrow */}
        {prevOk ? (
          <Link href={`/matches?date=${prevDate}`} style={{
            width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', textDecoration: 'none', fontSize: 14, flexShrink: 0,
          }}>‹</Link>
        ) : (
          <div style={{ width: 30, height: 30, flexShrink: 0 }} />
        )}

        {/* Scrollable pill strip */}
        <div style={{ overflowX: 'auto', display: 'flex', gap: 6, flex: 1, scrollbarWidth: 'none' }}>
          {days.map(({ dateStr, label }) => (
            <span key={dateStr}><NavPill
              href={dateStr === todayStr ? '/matches' : `/matches?date=${dateStr}`}
              label={label}
              active={dateStr === activeDateStr}
            /></span>
          ))}
        </div>

        {/* Next arrow */}
        {nextOk ? (
          <Link href={`/matches?date=${nextDate}`} style={{
            width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', textDecoration: 'none', fontSize: 14, flexShrink: 0,
          }}>›</Link>
        ) : (
          <div style={{ width: 30, height: 30, flexShrink: 0 }} />
        )}
      </div>

      <MatchIntelTable matches={matches as any[]} teamIntelMap={teamIntelMap} />
    </main>
  );
}
