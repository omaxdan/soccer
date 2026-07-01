import Link from 'next/link';
import { COLORS } from '@/design/tokens';
export default function IntelHub() {
  return (
    <main style={{ padding:'40px 24px', maxWidth:600, margin:'0 auto' }}>
      <div style={{ fontSize:20, fontWeight:700, color:'#f0f0ff', marginBottom:6 }}>📊 Intelligence Hub</div>
      <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:20 }}>
        {[
          { href:'/intel/travel', icon:'✈', label:'Travel Intelligence Hub', desc:'Travel distances, fatigue, journey analysis' },
          { href:'/intel/congestion', icon:'📅', label:'Fixture Congestion Hub', desc:'Forward-looking fixture density and schedule pressure' },
          { href:'/intel/form', icon:'📈', label:'Form Intelligence Hub', desc:'Power rankings, hot/cold streaks, goal analysis' },
        ].map(p => (
          <Link key={p.href} href={p.href} style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, textDecoration:'none', display:'flex', alignItems:'center', gap:14 }}>
            <span style={{ fontSize:28 }}>{p.icon}</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:'#f0f0ff' }}>{p.label}</div>
              <div style={{ fontSize:11, color:'#8888aa', marginTop:2 }}>{p.desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
