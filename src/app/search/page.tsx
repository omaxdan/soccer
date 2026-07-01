'use client';
import { useState } from 'react';
import Link from 'next/link';
import { searchTeams, searchTournaments } from '@/lib/queries';
import { COLORS } from '@/design/tokens';
import { teamUrl, leagueUrl } from '@/lib/urls';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [teams, setTeams] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(q: string) {
    setQuery(q);
    if (q.length < 2) { setTeams([]); setTournaments([]); return; }
    setLoading(true);
    const [t, tr] = await Promise.all([
      searchTeams(q, 8).catch(() => []),
      searchTournaments(q, 5).catch(() => []),
    ]);
    setTeams(t as any[]);
    setTournaments(tr as any[]);
    setLoading(false);
  }

  return (
    <main style={{ padding:'40px 24px', maxWidth:640, margin:'0 auto' }}>
      <div style={{ fontSize:20, fontWeight:700, color:'#f0f0ff', marginBottom:6 }}>🔍 Search</div>
      <div style={{ fontSize:12, color:COLORS.muted, marginBottom:20 }}>Teams, tournaments, players</div>

      <input
        value={query}
        onChange={e => handleSearch(e.target.value)}
        placeholder="Search teams, leagues..."
        style={{
          width:'100%', padding:'12px 16px',
          background:COLORS.surface, border:`1px solid ${COLORS.border2}`,
          borderRadius:10, color:COLORS.text, fontSize:14,
          outline:'none', fontFamily:'Inter,sans-serif',
        }}
        onFocus={e => (e.target as HTMLInputElement).style.borderColor = COLORS.green}
        onBlur={e => (e.target as HTMLInputElement).style.borderColor = COLORS.border2}
      />

      {loading && <div style={{ padding:20, textAlign:'center', color:COLORS.muted, fontSize:12 }}>Searching...</div>}

      {teams.length > 0 && (
        <div style={{ marginTop:16, background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:10, overflow:'hidden' }}>
          <div style={{ padding:'8px 14px', borderBottom:`1px solid ${COLORS.border}`, fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Teams</div>
          {teams.map((t: any) => (
            <Link key={t.id} href={teamUrl(t)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${COLORS.border}`, textDecoration:'none' }}>
              <div style={{ width:28, height:28, background:COLORS.green+'20', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace', fontSize:10, fontWeight:700, color:COLORS.green }}>{t.short_name?.slice(0,3)}</div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:COLORS.text }}>{t.name}</div>
                <div style={{ fontSize:10, color:COLORS.muted }}>{t.country}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tournaments.length > 0 && (
        <div style={{ marginTop:12, background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:10, overflow:'hidden' }}>
          <div style={{ padding:'8px 14px', borderBottom:`1px solid ${COLORS.border}`, fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>Tournaments</div>
          {tournaments.map((t: any) => (
            <Link key={t.id} href={leagueUrl(t)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderBottom:`1px solid ${COLORS.border}`, textDecoration:'none' }}>
              <div style={{ fontSize:13, fontWeight:700, color:COLORS.text }}>{t.name}</div>
            </Link>
          ))}
        </div>
      )}

      {query.length >= 2 && !loading && teams.length === 0 && tournaments.length === 0 && (
        <div style={{ padding:30, textAlign:'center', color:COLORS.muted, fontSize:12 }}>No results for &ldquo;{query}&rdquo;</div>
      )}
    </main>
  );
}
