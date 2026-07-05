import { getCongestionRankings, getWeekHeatmap } from '@/lib/queries';
import { COLORS, scoreColor, TYPE , withAlpha } from '@/design/tokens';
import Link from 'next/link';
import { teamUrl } from '@/lib/urls';

export const metadata = { title: 'Fixture Congestion Hub' };
export const revalidate = 1800;

function Card({ children, style={} }: any) {
  return <div style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, ...style }}>{children}</div>;
}

export default async function CongestionHub() {
  const [congestion, heatmap] = await Promise.all([
    getCongestionRankings(30).catch(() => []),
    getWeekHeatmap().catch(() => []),
  ]);

  const C = (congestion as any[]);
  const top = C[0];
  const mostGames7 = [...C].sort((a,b) => (b.matches_next_7_days??0)-(a.matches_next_7_days??0))[0];
  const lowestRest = [...C].filter(t => t.min_rest_days != null).sort((a,b) => (a.min_rest_days??99)-(b.min_rest_days??99))[0];

  // Build 7-day heatmap: { teamId: { date: count } }
  const today = new Date();
  const days  = Array.from({length:7}).map((_,i) => {
    const d = new Date(today); d.setDate(today.getDate()+i);
    return d.toISOString().split('T')[0];
  });

  const teamDayMap = new Map<number, Map<string, number>>();
  (heatmap as any[]).forEach((m: any) => {
    const date = m.date?.split('T')[0];
    if (!date) return;
    [m.home_team_id, m.away_team_id].forEach((tid: number) => {
      if (!tid) return;
      if (!teamDayMap.has(tid)) teamDayMap.set(tid, new Map());
      teamDayMap.get(tid)!.set(date, (teamDayMap.get(tid)!.get(date)??0)+1);
    });
  });

  // Get team names from heatmap matches
  const teamNames = new Map<number, string>();
  (heatmap as any[]).forEach((m: any) => {
    if (m.home_team_id) teamNames.set(m.home_team_id, String(m.home_team?.name ?? m.home_team_id));
    if (m.away_team_id) teamNames.set(m.away_team_id, String(m.away_team?.name ?? m.away_team_id));
  });

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <div style={{ fontSize:18, fontWeight:700, color:COLORS.text }}>📅 Fixture Congestion Hub</div>
        <div style={{ fontSize:12, color:COLORS.muted, marginTop:4 }}>Forward-looking fixture density — who&apos;s running on empty</div>
      </div>

      {/* Top 3 cards */}
      <div className="rip-stack-mobile" style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
        {[
          { label:'Most Congested', val:top?.congestion_score ? Math.round(top.congestion_score) : '—', unit:'/100', sub:top?.team?.name, color:scoreColor(top?.congestion_score ? 100-top.congestion_score : null) },
          { label:'Most Games (Next 7d)', val:mostGames7?.matches_next_7_days ?? '—', unit:' matches', sub:mostGames7?.team?.name, color:COLORS.orange },
          { label:'Lowest Rest Upcoming', val:lowestRest?.min_rest_days ?? '—', unit:'d min', sub:lowestRest?.team?.name, color:scoreColor(lowestRest?.min_rest_days ? Math.min(100, lowestRest.min_rest_days*15) : null) },
        ].map(c => (
          <Card key={c.label}>
            <div style={{ fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{c.label}</div>
            <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:28, fontWeight:700, color:c.color, lineHeight:1 }}>{c.val}{c.unit && <span style={{fontSize:13,color:COLORS.dim}}>{c.unit}</span>}</div>
            {c.sub && <div style={{ fontSize:11, color:COLORS.dim, marginTop:4 }}>{c.sub}</div>}
          </Card>
        ))}
      </div>

      <div className="rip-stack-mobile" style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:20 }}>
        {/* Congestion table */}
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${COLORS.border}`, fontSize:12, fontWeight:700, color:COLORS.text }}>Congestion League Table</div>
          <table style={{ width:'100%' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                {['Team','Congestion','Last 7','Last 14','Next 7','Next 14','Min Rest','Avg Rest'].map(h => (
                  <th key={h} style={{ padding:'8px 10px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {C.length === 0 && <tr><td colSpan={8} style={{ padding:20, textAlign:'center', color:COLORS.dim, fontSize:12 }}>Run process:fixture-load first</td></tr>}
              {C.map((t: any, i: number) => {
                const cScore = Math.round(t.congestion_score ?? 0);
                const cCol = scoreColor(100 - cScore);
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${COLORS.border}`, background:i%2===0?'transparent':withAlpha(COLORS.surface2, '40') }}>
                    <td style={{ padding:'8px 10px' }}>
                      <Link href={teamUrl(t.team)} style={{ fontSize:12, fontWeight:700, color:COLORS.text }}>{t.team?.name}</Link>
                    </td>
                    <td style={{ padding:'8px 10px' }}>
                      <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:cCol }}>{cScore}</span>
                      {cScore > 65 && <span style={{ marginLeft:4, fontSize:10 }}>⚠️</span>}
                    </td>
                    {[t.matches_last_7_days,t.matches_last_14_days,t.matches_next_7_days,t.matches_next_14_days].map((v: any, j: number) => (
                      <td key={j} style={{ padding:'8px 10px', fontFamily:'monospace', fontSize:12, color:COLORS.muted }}>{v ?? '—'}</td>
                    ))}
                    <td style={{ padding:'8px 10px', fontFamily:'monospace', fontSize:12, color:(t.min_rest_days??99)<=2?COLORS.red:(t.min_rest_days??99)<=3?COLORS.amber:COLORS.muted }}>{t.min_rest_days ?? '—'}d</td>
                    <td style={{ padding:'8px 10px', fontFamily:'monospace', fontSize:12, color:COLORS.muted }}>{t.avg_rest_days ? Number(t.avg_rest_days).toFixed(1) : '—'}d</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* 7-day heatmap */}
        <Card>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>7-Day Schedule Heatmap</div>
          <div className="rip-table-scroll">
          <div style={{ display:'grid', gridTemplateColumns:`110px repeat(7,minmax(34px,1fr))`, gap:2, fontSize:9, minWidth:400 }}>
            {/* Header: dates */}
            <div style={{ color:COLORS.dim }}></div>
            {days.map(d => (
              <div key={d} style={{ textAlign:'center', color:COLORS.muted, fontSize:9 }}>
                {new Date(d).toLocaleDateString('en-GB',{weekday:'short'}).slice(0,3)}<br/>
                <span style={{ color:COLORS.dim }}>{new Date(d).getDate()}</span>
              </div>
            ))}
            {/* Rows: teams */}
            {Array.from(teamDayMap.entries()).slice(0,12).map(([teamId, dayMap]) => (
              <div key={teamId} style={{ display:'contents' }}>
                <div style={{ fontSize:9, color:COLORS.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', paddingRight:4, alignSelf:'center' }}>
                  {String(teamNames.get(teamId) ?? teamId)}
                </div>
                {days.map(d => {
                  const count = dayMap.get(d) ?? 0;
                  const bg = count === 0 ? COLORS.border : count === 1 ? withAlpha(COLORS.green, '30') : count === 2 ? withAlpha(COLORS.amber, '50') : withAlpha(COLORS.red, '60');
                  const col = count === 0 ? 'transparent' : count === 1 ? COLORS.green : count === 2 ? COLORS.amber : COLORS.red;
                  return (
                    <div key={d} style={{ background:bg, borderRadius:3, height:22, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontFamily:'monospace', color:col, fontWeight:count>0?700:400 }}>
                      {count > 0 ? count : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          </div>
          <div style={{ display:'flex', gap:10, marginTop:12, fontSize:9 }}>
            {[['',COLORS.border,'Empty'],['1',COLORS.green,'1 match'],['2',COLORS.amber,'2 matches'],['3+',COLORS.red,'3+ matches']].map(([n,c,l]) => (
              <div key={l as string} style={{ display:'flex', alignItems:'center', gap:4 }}>
                <div style={{ width:12, height:12, background:withAlpha(c as string, '50'), border:`1px solid ${withAlpha(c as string, '60')}`, borderRadius:2 }} />
                <span style={{ color:COLORS.muted }}>{l}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
