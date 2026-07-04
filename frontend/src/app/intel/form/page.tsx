import { getFormPowerRankings } from '@/lib/queries';
import { COLORS, scoreColor, TYPE , withAlpha } from '@/design/tokens';
import Link from 'next/link';
import { teamUrl } from '@/lib/urls';

export const metadata = { title: 'Form Intelligence Hub' };
export const revalidate = 1800;

function Card({ children, style={} }: any) {
  return <div style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, ...style }}>{children}</div>;
}

export default async function FormHub() {
  const rankings = await getFormPowerRankings(30).catch(() => []);
  const R = (rankings as any[]);

  const hot  = R.filter(t => (t.last_5_points ?? 0) >= 12); // 4W+ from last 5
  const cold = R.filter(t => (t.last_5_points ?? 99) <= 3);  // max 1W from last 5

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <div style={{ fontSize:18, fontWeight:700, color:COLORS.text }}>📈 Form Intelligence Hub</div>
        <div style={{ fontSize:12, color:COLORS.muted, marginTop:4 }}>Precomputed form rankings for all tracked league teams</div>
      </div>

      <div className="rip-stack-mobile" style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:20 }}>
        {/* Power Rankings table */}
        <Card style={{ padding:0, overflow:'hidden' }}>
          <div style={{ padding:'12px 16px', borderBottom:`1px solid ${COLORS.border}`, fontSize:12, fontWeight:700, color:COLORS.text }}>Form Power Rankings</div>
          <div className="rip-table-scroll">
          <table style={{ width:'100%' }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                {[
                  { label: 'Rank' }, { label: 'Team' },
                  { label: 'Form (L5)', mobileHide: true }, { label: 'Last 10', mobileHide: true },
                  { label: 'Form Index' }, { label: 'Pts L5' }, { label: 'Pts L10' },
                ].map(({ label: h, mobileHide }) => (
                  <th key={h} className={mobileHide ? 'rip-mobile-hide' : undefined} style={{ padding:'8px 12px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {R.length === 0 && <tr><td colSpan={7} style={{ padding:20, textAlign:'center', color:COLORS.dim, fontSize:12 }}>Run process:form:backfill first</td></tr>}
              {R.map((t: any, i: number) => {
                const fi = Math.round(t.form_index ?? 0);
                const col = scoreColor(fi);
                return (
                  <tr key={i} style={{ borderBottom:`1px solid ${COLORS.border}`, background:i%2===0?'transparent':withAlpha(COLORS.surface2, '40') }}>
                    <td style={{ padding:'8px 12px', fontFamily:'monospace', fontSize:11, color:COLORS.dim }}>{i+1}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <Link href={teamUrl(t.team)} style={{ fontSize:12, fontWeight:700, color:COLORS.text }}>{t.team?.name}</Link>
                      <div style={{ fontSize:9, color:COLORS.dim }}>{t.team?.country}</div>
                    </td>
                    <td className="rip-mobile-hide" style={{ padding:'8px 12px' }}>
                      <div style={{ display:'flex', gap:2 }}>
                        {/* Placeholder form display */}
                        <span style={{ fontFamily:'monospace', fontSize:10, color:COLORS.muted }}>—</span>
                      </div>
                    </td>
                    <td className="rip-mobile-hide" style={{ padding:'8px 12px', fontFamily:'monospace', fontSize:11, color:COLORS.muted }}>—</td>
                    <td style={{ padding:'8px 12px' }}>
                      <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:700, color:col }}>{fi}</span>
                      <span style={{ fontSize:10, color:COLORS.dim }}>/100</span>
                    </td>
                    <td style={{ padding:'8px 12px', fontFamily:'monospace', fontSize:12, fontWeight:700, color:scoreColor((t.last_5_points/15)*100) }}>{t.last_5_points ?? '—'}<span style={{fontSize:9,color:COLORS.dim}}>/15</span></td>
                    <td style={{ padding:'8px 12px', fontFamily:'monospace', fontSize:12, color:scoreColor((t.last_10_points/30)*100) }}>{t.last_10_points ?? '—'}<span style={{fontSize:9,color:COLORS.dim}}>/30</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>

        {/* Hot/Cold sidebar */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>🔥 Hot Streak</div>
            {hot.length === 0 && <div style={{ color:COLORS.dim, fontSize:11 }}>No teams on hot streak</div>}
            {hot.slice(0,5).map((t: any, i: number) => (
              <Link key={i} href={teamUrl(t.team)} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:`1px solid ${COLORS.border}`, cursor:'pointer' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:COLORS.text }}>{t.team?.name}</div>
                    <div style={{ fontSize:9, color:COLORS.dim }}>{t.team?.country}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:14, fontWeight:700, color:COLORS.green }}>{t.last_5_points}<span style={{fontSize:10,color:COLORS.dim}}>pts</span></div>
                  </div>
                </div>
              </Link>
            ))}
          </Card>

          <Card>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:12 }}>❄️ Cold Streak</div>
            {cold.length === 0 && <div style={{ color:COLORS.dim, fontSize:11 }}>No teams on cold streak</div>}
            {cold.slice(0,5).map((t: any, i: number) => (
              <Link key={i} href={teamUrl(t.team)} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:`1px solid ${COLORS.border}`, cursor:'pointer' }}>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:COLORS.text }}>{t.team?.name}</div>
                    <div style={{ fontSize:9, color:COLORS.dim }}>{t.team?.country}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:14, fontWeight:700, color:COLORS.red }}>{t.last_5_points}<span style={{fontSize:10,color:COLORS.dim}}>pts</span></div>
                  </div>
                </div>
              </Link>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
