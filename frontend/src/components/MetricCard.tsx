'use client';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';

interface MetricCardProps {
  value: string | number | null;
  label: string;
  subLabel?: string;
  icon?: React.ReactNode;
  trend?: number | null;       // positive = up, negative = down
  nullText?: string;
  colorScore?: number | null;  // if set, value color determined by this score
  color?: string;              // direct color override
  onClick?: () => void;
  className?: string;
}

export default function MetricCard({
  value, label, subLabel, icon, trend, nullText = '—',
  colorScore, color, onClick,
}: MetricCardProps) {
  const col = color ?? (colorScore != null ? scoreColor(colorScore) : COLORS.blue);
  const displayValue = value ?? nullText;
  const isNull = value == null;

  return (
    <div
      onClick={onClick}
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s, background 0.2s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => { if (onClick) (e.currentTarget as HTMLElement).style.borderColor = COLORS.border2; }}
      onMouseLeave={e => { if (onClick) (e.currentTarget as HTMLElement).style.borderColor = COLORS.border; }}
    >
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ ...TYPE.label, fontSize: 10 }}>{label}</div>
        {icon && <div style={{ color: COLORS.muted, opacity: 0.7 }}>{icon}</div>}
      </div>

      {/* Value — JetBrains Mono 28px semi-bold per spec */}
      <div style={{
        ...TYPE.cardValue,
        color: isNull ? COLORS.dim : col,
        lineHeight: 1.1,
        marginBottom: subLabel ? 6 : 0,
      }}>
        {displayValue}
      </div>

      {/* Sub-label */}
      {subLabel && (
        <div style={{ ...TYPE.smallData, marginTop: 4, lineHeight: 1.3 }}>{subLabel}</div>
      )}

      {/* Trend chip */}
      {trend != null && trend !== 0 && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          background: (trend > 0 ? COLORS.green : COLORS.red) + '20',
          border: `1px solid ${(trend > 0 ? COLORS.green : COLORS.red)}40`,
          borderRadius: 5,
          padding: '2px 6px',
          fontSize: 10,
          ...TYPE.mono,
          color: trend > 0 ? COLORS.green : COLORS.red,
        }}>
          {trend > 0 ? '▲' : '▼'}{Math.abs(trend).toFixed(1)}
        </div>
      )}

      {/* Colour accent bar at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 2, borderRadius: '12px 12px 0 0',
        background: isNull ? COLORS.border : col + '60',
      }} />
    </div>
  );
}
