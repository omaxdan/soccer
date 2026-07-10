import React, { useState } from 'react';
import { COLORS } from '@/design/tokens';
import LineupsTable from './SECTION2-LineupsTable';

interface MatchLineupTabProps {
  matchId: string;
  homeTeam: any;
  awayTeam: any;
  homeLineup: any[];
  awayLineup: any[];
  areaVersatility?: { home: number; away: number };
  squadReadiness?: {
    homeBase: number;
    awayBase: number;
    homeInjuryImpact: number;
    awayInjuryImpact: number;
  };
  positionDepth?: Record<string, any>;
}

/**
 * SECTION 3: Restructured Lineups Tab
 * 
 * NEW HIERARCHY (Top to Bottom):
 * 1. AREA VERSATILITY (top)
 * 2. PREDICTED LINEUPS
 * 3. SQUAD READINESS IMPACT
 * 4. POSITION DEPTH + Other metrics (bottom)
 * 
 * SIGNAL REMOVAL:
 * - No "WINNER: Team X" predictions
 * - No "MATCH RISK: HIGH/LOW" tags
 * - No directional betting tips
 * - Retain all statistical numbers, confidence bars, factual lists
 */

export default function MatchLineupTab({
  matchId,
  homeTeam,
  awayTeam,
  homeLineup,
  awayLineup,
  areaVersatility,
  squadReadiness,
  positionDepth,
}: MatchLineupTabProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  return (
    <div className="w-full space-y-6 pb-8">
      {/* ─────────────────────────────────────────────────────────────────────── */
      /* POSITION 1: AREA VERSATILITY (ABSOLUTE TOP) */
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {areaVersatility && (
        <section className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Area Versatility</h3>
            <p className="text-xs text-slate-500 mt-1">
              Squad composition flexibility across all pitch zones. Higher values indicate roster depth and position coverage.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4">
            {/* Home */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">{homeTeam.short_name}</p>
              <div className="relative w-full h-6 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-300"
                  style={{ width: `${Math.min(100, (areaVersatility.home ?? 0) * 10)}%` }}
                />
              </div>
              <p className="text-lg font-bold text-slate-100">{Math.round(areaVersatility.home * 10)}%</p>
            </div>
            {/* Away */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">{awayTeam.short_name}</p>
              <div className="relative w-full h-6 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                  style={{ width: `${Math.min(100, (areaVersatility.away ?? 0) * 10)}%` }}
                />
              </div>
              <p className="text-lg font-bold text-slate-100">{Math.round(areaVersatility.away * 10)}%</p>
            </div>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */
      /* POSITION 2: PREDICTED LINEUPS */
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        {/* Home Lineup */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800">
            <h4 className="text-sm font-bold text-slate-100">{homeTeam.name}</h4>
          </div>
          <div className="p-4">
            <LineupsTable players={homeLineup} teamName={homeTeam.name} />
          </div>
        </div>

        {/* Away Lineup */}
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800">
            <h4 className="text-sm font-bold text-slate-100">{awayTeam.name}</h4>
          </div>
          <div className="p-4">
            <LineupsTable players={awayLineup} teamName={awayTeam.name} />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */
      /* POSITION 3: SQUAD READINESS IMPACT */
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {squadReadiness && (
        <section className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Squad Readiness Impact</h3>
            <p className="text-xs text-slate-500 mt-1">
              Base squad readiness plus injury/absence impact. Statistical snapshot only — not a forecast.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 p-4">
            {/* Home */}
            <div className="space-y-3 border-r border-slate-700 pr-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-1">{homeTeam.short_name} Base</p>
                <p className="text-2xl font-bold text-slate-100">{Math.round(squadReadiness.homeBase)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-1">Injury Impact</p>
                <p className={`text-lg font-semibold ${squadReadiness.homeInjuryImpact < 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                  {squadReadiness.homeInjuryImpact >= 0 ? '+' : ''}{Math.round(squadReadiness.homeInjuryImpact)}
                </p>
              </div>
            </div>
            {/* Away */}
            <div className="space-y-3 pl-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-1">{awayTeam.short_name} Base</p>
                <p className="text-2xl font-bold text-slate-100">{Math.round(squadReadiness.awayBase)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 mb-1">Injury Impact</p>
                <p className={`text-lg font-semibold ${squadReadiness.awayInjuryImpact < 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                  {squadReadiness.awayInjuryImpact >= 0 ? '+' : ''}{Math.round(squadReadiness.awayInjuryImpact)}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */
      /* POSITION 4: POSITION DEPTH & OTHER METRICS */
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {positionDepth && (
        <section className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div
            className="px-4 py-3 border-b border-slate-700 cursor-pointer hover:bg-slate-800 transition-colors"
            onClick={() => setExpandedSection(expandedSection === 'depth' ? null : 'depth')}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Position Depth Analysis</h3>
              <span className="text-slate-500 text-lg">{expandedSection === 'depth' ? '−' : '+'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Backup availability and positional coverage. Factual inventory only.
            </p>
          </div>
          {expandedSection === 'depth' && (
            <div className="p-4 space-y-4 border-t border-slate-700">
              <div className="grid grid-cols-2 gap-4">
                {/* Home depth */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">{homeTeam.short_name}</p>
                  {positionDepth.home &&
                    Object.entries(positionDepth.home).map(([pos, count]: [string, any]) => (
                      <div key={pos} className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">{pos}:</span>
                        <span className="font-bold text-slate-100">{count} available</span>
                      </div>
                    ))}
                </div>
                {/* Away depth */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">{awayTeam.short_name}</p>
                  {positionDepth.away &&
                    Object.entries(positionDepth.away).map(([pos, count]: [string, any]) => (
                      <div key={pos} className="flex justify-between items-center text-xs">
                        <span className="text-slate-400">{pos}:</span>
                        <span className="font-bold text-slate-100">{count} available</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Empty state */}
      {!homeLineup && !awayLineup && (
        <div className="text-center py-12 text-slate-500 text-sm">
          No lineup data available for this match
        </div>
      )}
    </div>
  );
}
