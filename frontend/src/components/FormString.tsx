'use client';
import { COLORS, TYPE } from '@/design/tokens';

interface FormStringProps {
  results: string[];       // W / D / L array
  count?: 5 | 10;
  showPoints?: boolean;
  size?: 'sm' | 'md';
}

const RESULT_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  W: { bg: COLORS.green  + '28', border: COLORS.green  + '70', text: COLORS.green },
  D: { bg: COLORS.amber  + '28', border: COLORS.amber  + '70', text: COLORS.amber },
  L: { bg: COLORS.red    + '28', border: COLORS.red    + '70', text: COLORS.red },
};

const RESULT_PTS: Record<string, number> = { W: 3, D: 1, L: 0 };

export default function FormString({ results, count = 5, showPoints = false, size = 'md' }: FormStringProps) {
  const display = results.slice(-count);
  const sz = size === 'sm' ? 15 : 22;
  const pts = display.reduce((s, r) => s + (RESULT_PTS[r] ?? 0), 0);
  const maxPts = count * 3;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {display.map((r, i) => {
        const c = RESULT_COLORS[r] ?? { bg: COLORS.border, border: COLORS.dim, text: COLORS.dim };
        return (
          <div
            key={i}
            title={r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}
            style={{
              width: sz, height: sz,
              borderRadius: 3,
              background: c.bg,
              border: `1px solid ${c.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: sz * 0.56,
              fontWeight: 700,
              color: c.text,
              ...TYPE.mono,
            }}
          >
            {r}
          </div>
        );
      })}
      {showPoints && (
        <span style={{ ...TYPE.mono, fontSize: sz * 0.72, color: COLORS.muted, marginLeft: 4 }}>
          {pts}/{maxPts}
        </span>
      )}
    </div>
  );
}
