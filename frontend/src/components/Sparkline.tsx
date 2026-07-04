'use client';
import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';
import { COLORS } from '@/design/tokens';

interface Props {
  data: { value: number | null }[];
  height?: number;
  color?: string;
}

/** A minimal trend line with no axes, gridlines, or tooltip — the
 *  "under the hero number" chart from a stock quote page, not a full
 *  analytical chart. Deliberately reuses recharts (already installed
 *  and used elsewhere in this app, e.g. the Team Detail readiness
 *  trend) rather than a hand-rolled SVG chart, so this stays consistent
 *  with the one charting library the codebase already depends on. */
export default function Sparkline({ data, height = 40, color }: Props) {
  const values = data.map(d => d.value).filter((v): v is number => v != null);
  if (values.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', fontSize: 10, color: COLORS.dim }}>Not enough history yet</div>;
  }
  const last = values[values.length - 1];
  const first = values[0];
  const lineColor = color ?? (last >= first ? COLORS.green : COLORS.red);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
        <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
