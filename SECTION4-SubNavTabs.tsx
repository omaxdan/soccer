import React, { useState } from 'react';
import { COLORS } from '@/design/tokens';

interface SubNavTabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  matchData: {
    readinessGap: number;
    strength: { home: number; away: number };
    venueImpact: { home: number; away: number };
    matchRisk: string; // 'high' | 'medium' | 'low'
  };
}

const TAB_LIST = [
  { id: 'overview', label: 'Overview' },
  { id: 'insights', label: 'Insights' },
  { id: 'readiness', label: 'Readiness', isNew: true },
  { id: 'form', label: 'Form' },
  { id: 'injury', label: 'Injury' },
];

export default function SubNavTabs({ activeTab, onTabChange, matchData }: SubNavTabsProps) {
  const [expandedTeamMetrics, setExpandedTeamMetrics] = useState<'home' | 'away' | null>(null);

  return (
    <div className="w-full">
      {/* ─── TAB NAVIGATION ─── */}
      <div className="flex items-center gap-2 border-b border-slate-700 overflow-x-auto -mx-4 px-4">
        {TAB_LIST.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-3 text-sm font-semibold tracking-wide whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.id
                ? `text-slate-100 border-b-emerald-500`
                : `text-slate-500 hover:text-slate-400 border-b-transparent`
            }`}
          >
            {tab.label}
            {tab.isNew && <span className="ml-1 text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full">New</span>}
          </button>
        ))}
      </div>

      {/* ─── 3-COLUMN CONDENSED ROW (below tabs) ─── */}
      {(activeTab === 'overview' || activeTab === 'insights') && (
        <div className="mt-6 grid grid-cols-3 gap-4 px-4">
          {/* STRENGTH */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Strength</p>
              <div className="flex items-center justify-center gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-emerald-400">{Math.round(matchData.strength.home)}</p>
                  <p className="text-xs text-slate-500 mt-1">Home</p>
                </div>
                <span className="text-slate-600 font-light">vs</span>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-400">{Math.round(matchData.strength.away)}</p>
                  <p className="text-xs text-slate-500 mt-1">Away</p>
                </div>
              </div>
            </div>
          </div>

          {/* VENUE IMPACT */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Venue Impact</p>
              <div className="flex items-center justify-center gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-amber-400">{Math.round(matchData.venueImpact.home)}</p>
                  <p className="text-xs text-slate-500 mt-1">Home +</p>
                </div>
                <span className="text-slate-600 font-light">+</span>
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-500">{Math.round(matchData.venueImpact.away)}</p>
                  <p className="text-xs text-slate-500 mt-1">Away −</p>
                </div>
              </div>
            </div>
          </div>

          {/* MATCH RISK */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
            <div className="text-center">
              <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">Statistical Risk</p>
              <div className="flex items-center justify-center">
                <div
                  className={`px-4 py-2 rounded-full font-bold text-sm ${
                    matchData.matchRisk === 'high'
                      ? 'bg-red-500 text-white'
                      : matchData.matchRisk === 'medium'
                      ? 'bg-amber-500 text-white'
                      : 'bg-emerald-500 text-white'
                  }`}
                >
                  {matchData.matchRisk.charAt(0).toUpperCase() + matchData.matchRisk.slice(1)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── EMBEDDED TEAM METRICS (below 3-col row) ─── */}
      {(activeTab === 'overview' || activeTab === 'insights') && (
        <div className="mt-6 space-y-4 px-4">
          {/* HOME TEAM METRICS */}
          <div
            className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden cursor-pointer hover:border-slate-600 transition-colors"
            onClick={() => setExpandedTeamMetrics(expandedTeamMetrics === 'home' ? null : 'home')}
          >
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-100">Home Team Metrics</h4>
              <span className="text-slate-500 text-lg">{expandedTeamMetrics === 'home' ? '−' : '+'}</span>
            </div>
            {expandedTeamMetrics === 'home' && (
              <div className="p-4 space-y-3 border-t border-slate-700">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500 mb-1">Form Index</p>
                    <p className="text-lg font-bold text-slate-100">+2.4</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Fixture Load</p>
                    <p className="text-lg font-bold text-slate-100">Medium</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Squad Stability</p>
                    <p className="text-lg font-bold text-slate-100">72%</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Rest Days Avg</p>
                    <p className="text-lg font-bold text-slate-100">3.2d</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AWAY TEAM METRICS */}
          <div
            className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden cursor-pointer hover:border-slate-600 transition-colors"
            onClick={() => setExpandedTeamMetrics(expandedTeamMetrics === 'away' ? null : 'away')}
          >
            <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-100">Away Team Metrics</h4>
              <span className="text-slate-500 text-lg">{expandedTeamMetrics === 'away' ? '−' : '+'}</span>
            </div>
            {expandedTeamMetrics === 'away' && (
              <div className="p-4 space-y-3 border-t border-slate-700">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-500 mb-1">Form Index</p>
                    <p className="text-lg font-bold text-slate-100">+1.1</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Fixture Load</p>
                    <p className="text-lg font-bold text-slate-100">High</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Squad Stability</p>
                    <p className="text-lg font-bold text-slate-100">65%</p>
                  </div>
                  <div>
                    <p className="text-slate-500 mb-1">Rest Days Avg</p>
                    <p className="text-lg font-bold text-slate-100">2.8d</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
