import React, { useState } from 'react';
import { COLORS } from '@/design/tokens';

interface Match {
  id: string;
  home: { short_name: string; name: string };
  away: { short_name: string; name: string };
  gap: number;
}

interface GapDistributionTiersProps {
  matches: Match[];
  title?: string;
}

interface TierConfig {
  key: string;
  label: string;
  color: string;
  min: number;
  max: number;
}

const TIER_CONFIG: TierConfig[] = [
  {
    key: 'strong',
    label: 'Strong Edge (20+)',
    color: 'text-emerald-600',
    min: 20,
    max: Infinity,
  },
  {
    key: 'moderate',
    label: 'Moderate Edge (10–20)',
    color: 'text-amber-600',
    min: 10,
    max: 20,
  },
  {
    key: 'small',
    label: 'Small Edge (0–10)',
    color: 'text-orange-500',
    min: 0,
    max: 10,
  },
  {
    key: 'negative',
    label: 'Negative Edge (<0)',
    color: 'text-red-500',
    min: -Infinity,
    max: 0,
  },
];

export default function GapDistributionTiers({ matches, title = 'Readiness Gap Distribution' }: GapDistributionTiersProps) {
  const [expandedTier, setExpandedTier] = useState<string | null>(null);

  // Group matches by tier
  const tierGroups = TIER_CONFIG.map(tier => ({
    ...tier,
    matches: matches.filter(m => {
      const absGap = Math.abs(m.gap);
      return absGap >= tier.min && absGap <= tier.max;
    }),
  }));

  // Calculate distribution percentages
  const totalMatches = matches.length;
  const tierStats = tierGroups.map(tier => ({
    ...tier,
    count: tier.matches.length,
    percentage: totalMatches > 0 ? (tier.matches.length / totalMatches) * 100 : 0,
  }));

  return (
    <div className="w-full space-y-4">
      {/* Title */}
      {title && <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">{title}</h3>}

      {/* Tier groups */}
      <div className="space-y-2">
        {tierStats.map(tier => (
          <div
            key={tier.key}
            className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden"
          >
            {/* Tier header (clickable) */}
            <button
              onClick={() => setExpandedTier(expandedTier === tier.key ? null : tier.key)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800 transition-colors cursor-pointer border-b border-slate-700"
            >
              <div className="flex items-center gap-3 flex-1 text-left">
                {/* Tier label */}
                <span className="text-sm font-semibold text-slate-100">{tier.label}</span>
                {/* Match count badge */}
                {tier.count > 0 && (
                  <span className="text-xs font-bold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full">
                    {tier.count}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              <div className="hidden sm:flex items-center gap-2 flex-1 mx-4">
                <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      tier.key === 'strong'
                        ? 'bg-emerald-500'
                        : tier.key === 'moderate'
                        ? 'bg-amber-500'
                        : tier.key === 'small'
                        ? 'bg-orange-500'
                        : 'bg-red-500'
                    }`}
                    style={{ width: `${tier.percentage}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 w-8 text-right">{Math.round(tier.percentage)}%</span>
              </div>
              {/* Expand indicator */}
              <span className="text-slate-500 text-lg font-light">
                {expandedTier === tier.key ? '−' : '+'}
              </span>
            </button>

            {/* Tier match list (expanded) */}
            {expandedTier === tier.key && tier.count > 0 && (
              <div className="border-t border-slate-700 p-3 space-y-2 bg-slate-950">
                {tier.matches.map(match => (
                  <div
                    key={match.id}
                    className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-slate-900 transition-colors"
                  >
                    {/* Team names left-aligned */}
                    <span className="text-slate-100 font-semibold truncate flex-1">
                      {match.home.short_name} vs {match.away.short_name}
                    </span>
                    {/* Gap right-aligned with tier color */}
                    <span className={`font-bold ml-3 whitespace-nowrap ${tier.color}`}>
                      Gap: {Math.abs(match.gap)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state for tier */}
            {expandedTier === tier.key && tier.count === 0 && (
              <div className="border-t border-slate-700 p-4 text-center text-slate-500 text-xs bg-slate-950">
                No matches in this tier
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Overall summary */}
      <div className="grid grid-cols-4 gap-2 text-xs mt-4">
        {tierStats.map(tier => (
          <div key={tier.key} className="bg-slate-900 border border-slate-700 rounded p-2 text-center">
            <p className="text-slate-500 text-xs mb-1 uppercase tracking-widest">
              {tier.key === 'strong' ? '20+' : tier.key === 'moderate' ? '10-20' : tier.key === 'small' ? '0-10' : '<0'}
            </p>
            <p className={`text-lg font-bold ${tier.color}`}>{tier.count}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
