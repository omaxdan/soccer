'use client';
import { scoreColor } from '@/design/tokens';

interface Props {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  label?: string;
  change?: number;
  showLabel?: boolean;
}

export default function ReadinessGauge({
  score, size = 100, strokeWidth = 8,
  label = 'READINESS', change, showLabel = true,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2; const cy = size / 2;
  const startAngle = -220; const arcSpan = 260;
  const pct = score != null ? Math.min(1, Math.max(0, score / 100)) : 0;
  const filled = arcSpan * pct;
  const color = scoreColor(score);

  const polar = (deg: number) => {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arcPath = (start: number, sweep: number) => {
    const a = polar(start); const b = polar(start + sweep);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
  };

  const fs   = size < 80 ? 18 : size < 120 ? 22 : 28;
  const ls   = size < 80 ? 7  : size < 120 ? 8  : 9;

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
      <div style={{ position:'relative', width:size, height:size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path d={arcPath(startAngle, arcSpan)} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} strokeLinecap="round" />
          {score != null && score > 0 && (
            <path d={arcPath(startAngle, filled)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
              style={{ filter: score >= 85 ? `drop-shadow(0 0 6px ${color}80)` : undefined }} />
          )}
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:1 }}>
          <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:fs, fontWeight:800, color: score != null ? color : 'var(--dim)', lineHeight:1 }}>
            {score != null ? Math.round(score) : '—'}
          </div>
          {showLabel && <div style={{ fontSize:ls, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--muted)' }}>{label}</div>}
          {change != null && <div style={{ fontSize:ls, fontWeight:600, color: change >= 0 ? 'var(--green)' : 'var(--red)' }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}</div>}
        </div>
      </div>
    </div>
  );
}
