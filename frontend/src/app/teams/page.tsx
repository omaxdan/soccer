import { getReadinessRankings } from '@/lib/queries';
import Link from 'next/link';
import { scoreColor } from '@/design/tokens';
import { teamUrl } from '@/lib/urls';
export default async function TeamsPage() {
  const teams = await getReadinessRankings(50).catch(() => []);
  return (
    <main style={{ padding:24, color:'#f0f0ff' }}>
      <div style={{ fontSize:18, fontWeight:700, marginBottom:16 }}>All Teams — Readiness Rankings</div>
      {(teams as any[]).map((t: any, i: number) => (
        <Link key={t.team_id} href={teamUrl(t.team)} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:'1px solid #2a2a3a', textDecoration:'none' }}>
          <span style={{ fontFamily:'monospace', fontSize:11, color:'#555570', width:24 }}>{i+1}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#f0f0ff' }}>{t.team?.name}</div>
            <div style={{ fontSize:10, color:'#555570' }}>{t.team?.country}</div>
          </div>
          <span style={{ fontFamily:'monospace', fontSize:16, fontWeight:700, color:scoreColor(t.readiness_score) }}>{Math.round(t.readiness_score ?? 0)}</span>
        </Link>
      ))}
    </main>
  );
}
