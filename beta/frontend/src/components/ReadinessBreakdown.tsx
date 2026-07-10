'use client';
import { scoreColor } from '@/design/tokens';

export interface ReadinessComponent {
  label: string;
  weight: number;      // e.g. 30 for 30%
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: string;
  awayTeam: string;
  sub?: { label: string; home: string; away: string }[]; // optional extra detail rows
}

interface Props {
  components: ReadinessComponent[];
}

function ComponentCard({ c }: { c: ReadinessComponent }) {
  const homeColor = scoreColor(c.homeScore);
  const awayColor = scoreColor(c.awayScore);
  const homeW = c.homeScore != null ? Math.min(100, c.homeScore) : 0;
  const awayW = c.awayScore != null ? Math.min(100, c.awayScore) : 0;

  return (
    <div className="component-card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
        <span className="component-label">{c.label}</span>
        <span className="component-weight">({c.weight}%)</span>
      </div>

      {/* Home score */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 }}>
          <div className="component-score" style={{ color: homeColor }}>
            {c.homeScore != null ? Math.round(c.homeScore) : '—'}
          </div>
          <div className="component-team">{c.homeTeam}</div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width:`${homeW}%`, background: homeColor }} />
        </div>
      </div>

      {/* Away score */}
      <div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4 }}>
          <div className="component-score" style={{ color: awayColor, fontSize:18 }}>
            {c.awayScore != null ? Math.round(c.awayScore) : '—'}
          </div>
          <div className="component-team">{c.awayTeam}</div>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width:`${awayW}%`, background: awayColor }} />
        </div>
      </div>

      {/* Optional detail rows */}
      {c.sub && c.sub.map((s, i) => (
        <div key={i} style={{ marginTop: 6, paddingTop: 6, borderTop:'1px solid var(--border)' }}>
          <div style={{ fontSize:9, color:'var(--dim)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:2 }}>{s.label}</div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
            <span style={{ color:'var(--text2)' }}>{s.home}</span>
            <span style={{ color:'var(--dim)' }}>{s.away}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReadinessBreakdown({ components }: Props) {
  return (
    <div>
      <div className="section-header" style={{ marginBottom:10 }}>
        <span className="section-title">Readiness Breakdown</span>
      </div>
      <div className="component-grid">
        {components.map((c, i) => <ComponentCard key={i} c={c} />)}
      </div>
    </div>
  );
}
