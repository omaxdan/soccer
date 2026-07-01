'use client';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';

interface IntelligenceBarProps {
  homeValue: number | null;
  awayValue: number | null;
  label?: string;
  homeLabel?: string;
  awayLabel?: string;
  max?: number;
  inverse?: boolean;    // congestion / fatigue: lower = better
  unit?: string;
}

export default function IntelligenceBar({
  homeValue, awayValue, label, homeLabel = 'HOME', awayLabel = 'AWAY',
  max = 100, inverse = false, unit = '',
}: IntelligenceBarProps) {
  const hPct = Math.min(100, ((homeValue ?? 0) / max) * 100);
  const aPct = Math.min(100, ((awayValue ?? 0) / max) * 100);

  // For inverse metrics (congestion, fatigue): lower score = greener
  const hCol = inverse ? scoreColor(100 - (homeValue ?? 0)) : scoreColor(homeValue);
  const aCol = inverse ? scoreColor(100 - (awayValue ?? 0)) : scoreColor(awayValue);

  // Highlight winner (better performer)
  const hBetter = inverse
    ? (homeValue ?? 0) < (awayValue ?? 0)
    : (homeValue ?? 0) > (awayValue ?? 0);
  const aBetter = !hBetter && (homeValue ?? 0) !== (awayValue ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label && (
        <div style={{ ...TYPE.label, fontSize: 10 }}>{label}</div>
      )}

      {/* Home bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          ...TYPE.mono, fontSize: 10, fontWeight: 700,
          color: hBetter ? COLORS.text : COLORS.muted,
          width: 36, textAlign: 'right',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {homeLabel}
        </div>
        <div style={{ flex: 1, height: 6, background: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${hPct}%`, height: '100%',
            background: hCol, borderRadius: 3,
            boxShadow: hBetter ? `0 0 6px ${hCol}60` : 'none',
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{
          ...TYPE.mono, fontSize: 12,
          fontWeight: hBetter ? 700 : 400,
          color: hBetter ? hCol : COLORS.muted,
          minWidth: 44, textAlign: 'left',
        }}>
          {homeValue != null ? `${homeValue}${unit}` : '—'}
          {hBetter && <span style={{ fontSize: 9, marginLeft: 2 }}>✓</span>}
        </div>
      </div>

      {/* Away bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          ...TYPE.mono, fontSize: 10, fontWeight: 700,
          color: aBetter ? COLORS.text : COLORS.muted,
          width: 36, textAlign: 'right',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {awayLabel}
        </div>
        <div style={{ flex: 1, height: 6, background: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${aPct}%`, height: '100%',
            background: aCol, borderRadius: 3,
            boxShadow: aBetter ? `0 0 6px ${aCol}60` : 'none',
            transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{
          ...TYPE.mono, fontSize: 12,
          fontWeight: aBetter ? 700 : 400,
          color: aBetter ? aCol : COLORS.muted,
          minWidth: 44, textAlign: 'left',
        }}>
          {awayValue != null ? `${awayValue}${unit}` : '—'}
          {aBetter && <span style={{ fontSize: 9, marginLeft: 2 }}>✓</span>}
        </div>
      </div>
    </div>
  );
}
