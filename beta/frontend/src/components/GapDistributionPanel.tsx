'use client';

import { useState } from 'react';
import { COLORS } from '@/design/tokens';
import { matchUrl } from '@/lib/urls';
import Link from 'next/link';

type TierKey = 'strong' | 'moderate' | 'small' | 'negative';

const TIER_META: Record<TierKey, { label: string; color: string }> = {
  strong:   { label: '20+ Strong Edge',    color: COLORS.green },
  moderate: { label: '10-20 Moderate Edge', color: COLORS.amber },
  small:    { label: '0-10 Small Edge',    color: COLORS.orange },
  negative: { label: 'Negative Edge',      color: COLORS.red },
};
const TIER_ORDER: TierKey[] = ['strong', 'moderate', 'small', 'negative'];

export default function GapDistributionPanel({
  tierMatches, totalWithGap,
}: {
  tierMatches: Record<TierKey, Array<{ match: any; gap: number | null; confidence?: number | null; confidenceBand?: string | null }>>;
  totalWithGap: number;
}) {
  const [expanded, setExpanded] = useState<TierKey | null>(null);
  const counts: Record<TierKey, number> = {
    strong: tierMatches.strong.length,
    moderate: tierMatches.moderate.length,
    small: tierMatches.small.length,
    negative: tierMatches.negative.length,
  };

  return (
    <div style={{ background: COLORS.surface, borderRadius: '0.75rem', padding: '0.875rem', boxShadow: COLORS.shadowCard, border: COLORS.cardBorder }}>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.625rem' }}>Readiness Gap Distribution</div>

      <div style={{ position: 'relative', width: '5.625rem', height: '5.625rem', margin: '0 auto 0.625rem' }}>
        <svg width="100%" height="100%" viewBox="0 0 100 100">
          {(() => {
            const segs = TIER_ORDER.map(t => ({ count: counts[t], color: TIER_META[t].color }));
            let cum = 0;
            return segs.map((s, i) => {
              const start = (cum / totalWithGap) * 360; cum += s.count;
              const end = (cum / totalWithGap) * 360;
              const large = end - start > 180 ? 1 : 0;
              const toXY = (deg: number) => { const r = (deg - 90) * Math.PI / 180; return [50 + 42 * Math.cos(r), 50 + 42 * Math.sin(r)]; };
              const [x1, y1] = toXY(start); const [x2, y2] = toXY(end);
              return <path key={i} d={`M 50 50 L ${x1} ${y1} A 42 42 0 ${large} 1 ${x2} ${y2} Z`} fill={s.color} opacity={0.85} />;
            });
          })()}
          <circle cx={50} cy={50} r={26} fill={COLORS.surface} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '1.125rem', fontWeight: 700, color: COLORS.text }}>{totalWithGap}</div>
          <div style={{ fontSize: '0.4375rem', color: COLORS.dim }}>MATCHES</div>
        </div>
      </div>

      {TIER_ORDER.map(tier => {
        const meta = TIER_META[tier];
        const count = counts[tier];
        const isOpen = expanded === tier;
        // Highest confidence first within the tier — nulls (no confidence
        // computed yet) sorted to the end rather than treated as 0, since
        // absence of data isn't the same as low confidence.
        const fixtures = [...tierMatches[tier]].sort((a, b) => {
          if (a.confidence == null && b.confidence == null) return 0;
          if (a.confidence == null) return 1;
          if (b.confidence == null) return -1;
          return b.confidence - a.confidence;
        });
        return (
          <div key={tier}>
            <button
              onClick={() => count > 0 && setExpanded(isOpen ? null : tier)}
              disabled={count === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem', width: '100%',
                fontSize: '0.625rem', marginBottom: '0.25rem', padding: '0.1875rem 0',
                background: 'transparent', border: 'none', cursor: count > 0 ? 'pointer' : 'default', textAlign: 'left',
              }}
            >
              <div style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: '0.125rem', background: meta.color, flexShrink: 0 }} />
              <span style={{ color: COLORS.muted }}>{meta.label}</span>
              {count > 0 && <span style={{ color: COLORS.dim, fontSize: '0.5625rem' }}>{isOpen ? '▾' : '▸'}</span>}
              <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{count} ({totalWithGap > 0 ? Math.round((count / totalWithGap) * 100) : 0}%)</span>
            </button>

            {isOpen && count > 0 && (
              <div style={{ marginBottom: '0.375rem', paddingLeft: '0.75rem' }}>
                {fixtures.map((e, i) => (
                  <Link
                    key={e.match.id}
                    href={matchUrl(e.match)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.375rem 0.5rem', textDecoration: 'none',
                      borderTop: i > 0 ? `1px solid ${COLORS.border}` : 'none',
                    }}
                  >
                    <span style={{ fontSize: '0.875rem', color: COLORS.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '0.5rem' }}>
                      {e.match.home_team?.short_name ?? e.match.home_team?.name} vs {e.match.away_team?.short_name ?? e.match.away_team?.name}
                    </span>
                    <span style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.0625rem' }}>
                      <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: '0.75rem', color: meta.color }}>
                        Gap: {Math.round(Math.abs(e.gap ?? 0))}
                      </span>
                      {e.confidence != null && (
                        <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '0.625rem', color: COLORS.dim }}>
                          {Math.round(e.confidence)}% conf
                        </span>
                      )}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
