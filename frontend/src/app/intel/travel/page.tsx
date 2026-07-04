import { getTravelBurdenRankings, getTodayTravelMatches } from '@/lib/queries';
import { toOne } from '@/lib/relations';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';

export const metadata = { title: 'Travel Intelligence Hub' };
export const revalidate = 1800;

function Card({ children, style={} }: any) {
  return <div style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, ...style }}>{children}</div>;
}

export default async function TravelHub() {
  const [rankings, todayMatches] = await Promise.all([
    getTravelBurdenRankings(10).catch(() => []),
    getTodayTravelMatches().catch(() => []),
  ]);

  // Stats
  const totalKm = (todayMatches as any[]).reduce((s: number, m: any) => s + (toOne(m.match_travel_intelligence)?.away_team_distance_km ?? 0), 0);
  const maxTravel = (todayMatches as any[]).sort((a: any, b: any) => (toOne(b.match_travel_intelligence)?.away_team_distance_km ?? 0) - (toOne(a.match_travel_intelligence)?.away_team_distance_km ?? 0))[0];
  const avgTravel = (todayMatches as any[]).length ? Math.round(totalKm / (todayMatches as any[]).length) : 0;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* Hero banner — exact spec */}
      <div style={{ background:`linear-gradient(135deg, ${COLORS.blue}20, ${COLORS.purple}10)`, border:`1px solid ${COLORS.blue}30`, borderRadius:14, padding:'20px 28px' }}>
        <div style={{ fontSize:20, fontWeight:700, color:COLORS.text, marginBottom:4 }}>✈ Travel Intelligence</div>
        <div style={{ fontSize:13, color:COLORS.muted }}>The factor most betting sites ignore. Precomputed from real match venue coordinates.</div>
      </div>

      {/* 3 stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
        {[
          { label:'Total km Today', val:Math.round(totalKm).toLocaleString()+'km', color:COLORS.blue },
          { label:'Longest Trip Today', val:maxTravel ? `${Math.round(toOne(maxTravel.match_travel_intelligence)?.away_team_distance_km ?? 0).toLocaleString()}km` : '—', sub:(maxTravel?.away_team as any)?.name, color:COLORS.amber },
          { label:'Avg Away Travel', val:avgTravel ? avgTravel.toLocaleString()+'km' : '—', color:COLORS.green },
        ].map(c => (
          <Card key={c.label}>
            <div style={{ fontSize:10, color:COLORS.muted, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>{c.label}</div>
            <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:28, fontWeight:700, color:c.color, lineHeight:1 }}>{c.val}</div>
            {c.sub && <div style={{ fontSize:11, color:COLORS.dim, marginTop:4 }}>{c.sub}</div>}
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:20 }}>
        {/* Main table */}
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${COLORS.border}`, fontSize:12, fontWeight:700, color:COLORS.text }}>Today&apos;s Travel-Affected Matches</div>
          <table style={{ width:'100%' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                {['Match','Away Distance','Home Distance','Net Advantage','Signal'].map(h => (
                  <th key={h} style={{ padding:'8px 14px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(todayMatches as any[]).length === 0 && (
                <tr><td colSpan={5} style={{ padding:30, textAlign:'center', color:COLORS.dim, fontSize:12 }}>No travel data for today — run process:match-travel</td></tr>
              )}
              {(todayMatches as any[]).sort((a: any, b: any) => (toOne(b.match_travel_intelligence)?.away_team_distance_km??0)-(toOne(a.match_travel_intelligence)?.away_team_distance_km??0)).map((m: any, i: number) => {
                const t = toOne(m.match_travel_intelligence);
                const awayKm = Math.round(t?.away_team_distance_km ?? 0);
                const homeKm = Math.round(t?.home_team_distance_km ?? 0);
                const advKm  = Math.round(t?.travel_advantage_km ?? 0);
                const signal = awayKm > 1500 ? '🔴 Very Strong disadvantage' : awayKm > 800 ? '🟡 Moderate disadvantage' : '⚪ Minor';
                const col    = awayKm > 1500 ? COLORS.red : awayKm > 800 ? COLORS.amber : COLORS.dim;
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${COLORS.border}`, background:i%2===0?'transparent':COLORS.surface2+'40' }}>
                    <td style={{ padding:'10px 14px', fontSize:12, fontWeight:600, color:COLORS.text }}>{m.home_team?.name} vs {m.away_team?.name}</td>
                    <td style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:13, fontWeight:700, color:col }}>{awayKm.toLocaleString()}km</td>
                    <td style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:13, color:COLORS.muted }}>{homeKm.toLocaleString()}km</td>
                    <td style={{ padding:'10px 14px', fontFamily:'monospace', fontSize:12, color:COLORS.green }}>+{advKm.toLocaleString()}km HOME</td>
                    <td style={{ padding:'10px 14px', fontSize:11, color:col }}>{signal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {/* Sidebar: travel burden rankings */}
        <Card>
          <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>Most Traveled Teams (30d)</div>
          {(rankings as any[]).map((t: any, i: number) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${COLORS.border}` }}>
              <div style={{ fontFamily:'monospace', fontSize:10, color:COLORS.dim, width:16 }}>{i+1}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:11, fontWeight:700, color:COLORS.text }}>{t.team?.name}</div>
                <div style={{ fontSize:9, color:COLORS.dim }}>Fatigue: {t.travel_fatigue_score ? Math.round(t.travel_fatigue_score) : '—'}/100</div>
              </div>
              <div style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:(t.km_last_30_days??0)>3000?COLORS.red:(t.km_last_30_days??0)>1500?COLORS.amber:COLORS.text }}>
                {t.km_last_30_days ? Math.round(t.km_last_30_days).toLocaleString() : '—'}km
              </div>
            </div>
          ))}
          {(rankings as any[]).length === 0 && <div style={{ color:COLORS.dim, fontSize:11 }}>Run process:travel-load first</div>}
        </Card>
      </div>
    </div>
  );
}
