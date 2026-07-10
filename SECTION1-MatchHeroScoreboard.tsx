import React from 'react';
import { COLORS } from '@/design/tokens';

interface MatchScoreboardProps {
  homeTeam: { name: string; short_name: string; logo_url?: string; readiness: number };
  awayTeam: { name: string; short_name: string; logo_url?: string; readiness: number };
  homeScore: number | null;
  awayScore: number | null;
  halfTimeScore?: { home: number; away: number } | null;
  isLive: boolean;
  isFinished: boolean;
}

export default function MatchHeroScoreboard({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  halfTimeScore,
  isLive,
  isFinished,
}: MatchScoreboardProps) {
  const hasScore = homeScore != null && awayScore != null;
  const scoreColor = !hasScore ? COLORS.dim : isLive ? COLORS.red : isFinished ? COLORS.text : COLORS.text;

  return (
    <div className="w-full bg-gradient-to-b from-slate-900 to-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      {/* Status badge */}
      <div className="px-6 py-2 border-b border-slate-700 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wider uppercase text-slate-400">Live Match</span>
        {isLive && <span className="text-red-500 text-sm font-bold">● LIVE</span>}
        {isFinished && <span className="text-slate-400 text-sm font-bold">FT</span>}
      </div>

      {/* 3-column strict layout */}
      <div className="grid grid-cols-[1fr_0.6fr_1fr] gap-0 items-stretch px-6 py-8">
        {/* LEFT COLUMN: Home Team (38%) */}
        <div className="flex flex-col items-start justify-center pr-4">
          <div className="flex items-center gap-3 mb-3">
            {homeTeam.logo_url && (
              <img src={homeTeam.logo_url} alt={homeTeam.name} className="w-10 h-10 rounded object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-base lg:text-lg font-semibold tracking-tight leading-tight text-white truncate">
                {homeTeam.short_name}
              </h3>
              <p className="text-xs text-slate-400 truncate">{homeTeam.name}</p>
            </div>
          </div>

          {/* Readiness Gauge */}
          <div className="relative w-16 h-16 mt-4 mb-2">
            <svg className="w-full h-full" viewBox="0 0 100 100">
              {/* Background circle */}
              <circle cx="50" cy="50" r="40" fill="none" stroke={COLORS.surface2} strokeWidth="6" />
              {/* Progress arc */}
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={homeTeam.readiness > 70 ? COLORS.green : homeTeam.readiness > 50 ? COLORS.amber : COLORS.orange}
                strokeWidth="6"
                strokeDasharray={`${(homeTeam.readiness / 100) * 251.2} 251.2`}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dasharray 0.3s ease' }}
              />
              {/* Center text */}
              <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="font-bold text-lg" fill={COLORS.text}>
                {Math.round(homeTeam.readiness)}
              </text>
            </svg>
          </div>
          <p className="text-xs text-slate-500 text-center w-full mt-1">Readiness</p>
        </div>

        {/* CENTER COLUMN: Score (24%) */}
        <div className="flex flex-col items-center justify-center border-x border-slate-700 px-3">
          {hasScore ? (
            <>
              <div className="text-4xl lg:text-5xl font-bold font-mono text-center leading-none mb-2" style={{ color: scoreColor }}>
                {homeScore}
                <span className="text-2xl lg:text-3xl mx-2 font-light">−</span>
                {awayScore}
              </div>
              {halfTimeScore && (
                <p className="text-xs text-slate-400 font-mono mt-2">HT: {halfTimeScore.home}-{halfTimeScore.away}</p>
              )}
            </>
          ) : (
            <p className="text-2xl font-light text-slate-500">—</p>
          )}
        </div>

        {/* RIGHT COLUMN: Away Team (38%) */}
        <div className="flex flex-col items-end justify-center pl-4">
          <div className="flex items-center gap-3 mb-3 flex-row-reverse">
            {awayTeam.logo_url && (
              <img src={awayTeam.logo_url} alt={awayTeam.name} className="w-10 h-10 rounded object-cover" />
            )}
            <div className="flex-1 min-w-0 text-right">
              <h3 className="text-base lg:text-lg font-semibold tracking-tight leading-tight text-white truncate">
                {awayTeam.short_name}
              </h3>
              <p className="text-xs text-slate-400 truncate">{awayTeam.name}</p>
            </div>
          </div>

          {/* Readiness Gauge */}
          <div className="relative w-16 h-16 mt-4 mb-2">
            <svg className="w-full h-full" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke={COLORS.surface2} strokeWidth="6" />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={awayTeam.readiness > 70 ? COLORS.green : awayTeam.readiness > 50 ? COLORS.amber : COLORS.orange}
                strokeWidth="6"
                strokeDasharray={`${(awayTeam.readiness / 100) * 251.2} 251.2`}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dasharray 0.3s ease' }}
              />
              <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="font-bold text-lg" fill={COLORS.text}>
                {Math.round(awayTeam.readiness)}
              </text>
            </svg>
          </div>
          <p className="text-xs text-slate-500 text-center w-full mt-1">Readiness</p>
        </div>
      </div>
    </div>
  );
}
