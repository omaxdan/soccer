'use client';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';

interface SignalChipProps {
  label: string;
  strength: number;         // 0–6
  direction: 'home' | 'away' | 'neutral' | 'avoid';
  compact?: boolean;
}

const DIR_COLORS = {
  home:    COLORS.green,
  away:    COLORS.red,
  neutral: COLORS.amber,
  avoid:   COLORS.orange,
};

const DIR_ARROWS = {
  home:    '→',
  away:    '←',
  neutral: '↔',
  avoid:   '⚠',
};

export default function SignalChip({ label, strength, direction, compact = false }: SignalChipProps) {
  const col = DIR_COLORS[direction] ?? COLORS.muted;
  const str = Math.max(0, Math.min(6, strength));

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: compact ? 5 : 7,
      background: col + '18',
      border: `1px solid ${col}40`,
      borderRadius: 8,
      padding: compact ? '3px 8px' : '5px 11px',
    }}>
      {/* Direction arrow */}
      <span style={{ fontSize: compact ? 10 : 12, color: col, fontWeight: 700 }}>
        {DIR_ARROWS[direction]}
      </span>

      {/* Label */}
      <span style={{
        ...TYPE.mono,
        fontSize: compact ? 10 : 12,
        fontWeight: 700,
        color: col,
        letterSpacing: '0.03em',
      }}>
        {label}
      </span>

      {/* Strength bar: █ squares out of 6 */}
      {!compact && (
        <div style={{ display: 'flex', gap: 2 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 7, height: 11,
                borderRadius: 2,
                background: i < str ? col : COLORS.border,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
