import { matchUrl } from '@/lib/urls';
import { toOne } from '@/lib/relations';
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';
import FormString from './FormString';
import IntelligenceBar from './IntelligenceBar';

interface MatchRowProps {
  match: {
    id: number;
    date: string;
    competition: string;
    status: string;
    home_team?: any;
    away_team?: any;
    venue?: any;
    match_results?: any[];
    match_intelligence?: any[];
    match_travel_intelligence?: any[];
  };
  homeIntel?: any;
  awayIntel?: any;
  homeForm?: string[];
  awayForm?: string[];
}

function ScoreChip({ score }: { score: number | null }) {
  const col = scoreColor(score);
  return (
    <div style={{
      background: col + '18', border: `1px solid ${col}40`,
      borderRadius: 7, padding: '3px 10px',
      ...TYPE.mono, fontSize: 17, fontWeight: 700, color: col,
      minWidth: 46, textAlign: 'center', flexShrink: 0,
    }}>
      {score ?? '—'}
    </div>
  );
}

export default function MatchRow({ match, homeIntel, awayIntel, homeForm = [], awayForm = [] }: MatchRowProps) {
  const [expanded, setExpanded] = useState(false);
  const intel  = toOne(match.match_intelligence);
  const travel = toOne(match.match_travel_intelligence);
  const result = toOne(match.match_results);
  const isLive = match.status === 'live';
  const isDone = match.status === 'finished';

  const restDiff = intel ? Math.abs((intel.home_rest_days ?? 0) - (intel.away_rest_days ?? 0)) : 0;
  const awayKm   = intel?.away_travel_distance_km ?? 0;
  const compDiff = Math.abs((intel?.home_active_competitions ?? 0) - (intel?.away_active_competitions ?? 0));

  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${expanded ? COLORS.border2 : COLORS.border}`,
      borderRadius: 12, overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* ── Main Row ── */}
      <div
        style={{ padding: '12px 16px', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Header: status + competition */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{
              background: (isLive ? COLORS.red : isDone ? COLORS.dim : COLORS.blue) + '20',
              color: isLive ? COLORS.red : isDone ? COLORS.dim : COLORS.blue,
              border: `1px solid ${(isLive ? COLORS.red : isDone ? COLORS.dim : COLORS.blue)}40`,
              borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.07em', ...TYPE.mono,
            }}>
              {isLive ? '● LIVE' : isDone ? 'FT' : new Date(match.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
            <span style={{ fontSize: 11, color: COLORS.muted }}>{match.competition}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {match.venue?.city && <span style={{ fontSize: 10, color: COLORS.dim }}>{match.venue.city}</span>}
            <span style={{ color: COLORS.dim, fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Teams + Chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Home */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 9 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, textAlign: 'right' }}>
              {match.home_team?.name ?? '?'}
            </span>
            {/* Falls back to the team's own current baseline (homeIntel) when
                match_intelligence hasn't been computed for this specific
                match yet — see queries.ts getTeamIntelligenceMap(). */}
            <ScoreChip score={intel?.home_readiness ?? homeIntel?.readiness_score ?? null} />
          </div>

          {/* Score or VS */}
          <div style={{ textAlign: 'center', minWidth: 56 }}>
            {(isDone || isLive) ? (
              <span style={{ ...TYPE.mono, fontSize: 20, fontWeight: 700, color: COLORS.text }}>
                {result?.home_score ?? 0} – {result?.away_score ?? 0}
              </span>
            ) : (
              <span style={{ fontSize: 13, color: COLORS.dim }}>vs</span>
            )}
          </div>

          {/* Away */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9 }}>
            <ScoreChip score={intel?.away_readiness ?? awayIntel?.readiness_score ?? null} />
            <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>
              {match.away_team?.name ?? '?'}
            </span>
          </div>
        </div>

        {/* Intel summary row */}
        {intel && (
          <div style={{
            display: 'flex', gap: 14, marginTop: 9, paddingTop: 9,
            borderTop: `1px solid ${COLORS.border}`,
            flexWrap: 'wrap',
          }}>
            {[
              { k: 'Gap', v: `${intel.readiness_gap != null ? Math.abs(intel.readiness_gap) : '—'} pts`, warn: Math.abs(intel.readiness_gap ?? 0) > 15 },
              { k: 'Rest H/A', v: `${intel.home_rest_days ?? '—'}d / ${intel.away_rest_days ?? '—'}d`, warn: restDiff > 2 },
              { k: 'Travel', v: awayKm ? `${Math.round(awayKm)}km away` : '—', warn: awayKm > 800 },
              { k: 'Comps H/A', v: `${intel.home_active_competitions ?? '—'} / ${intel.away_active_competitions ?? '—'}`, warn: compDiff > 1 },
              { k: 'Congestion', v: `${Math.round(intel.congestion_factor ?? 0)}/100`, warn: (intel.congestion_factor ?? 0) > 65 },
            ].map(item => (
              <div key={item.k} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.k}</div>
                <div style={{ fontSize: 11, ...TYPE.mono, color: item.warn ? COLORS.amber : COLORS.muted, fontWeight: item.warn ? 700 : 400 }}>
                  {item.warn ? '⚠ ' : ''}{item.v}
                </div>
              </div>
            ))}

            {/* Signals */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {restDiff > 2 && <span style={{ fontSize: 10, color: COLORS.green }}>Rest✓</span>}
              {awayKm > 800 && <span style={{ fontSize: 10, color: COLORS.green }}>Travel✓</span>}
              {(intel.form_index > 70 || (homeIntel?.form_index ?? 0) > 70) && <span style={{ fontSize: 10, color: COLORS.green }}>Form✓</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── Expanded Accordion — spec: Form last 5, Congestion bars, Travel fatigue, Active comps ── */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.surface2,
          padding: '12px 16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}>
          {/* Form */}
          <div>
            <div style={{ ...TYPE.label, fontSize: 9, marginBottom: 6 }}>Form Last 5</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <FormString results={homeForm.slice(-5)} size="sm" />
              <span style={{ color: COLORS.dim, fontSize: 11 }}>vs</span>
              <FormString results={awayForm.slice(-5)} size="sm" />
            </div>
          </div>

          {/* Congestion */}
          <div>
            <IntelligenceBar
              label="CONGESTION"
              homeValue={homeIntel?.congestion_score != null ? Math.round(homeIntel.congestion_score) : null}
              awayValue={awayIntel?.congestion_score != null ? Math.round(awayIntel.congestion_score) : null}
              homeLabel={match.home_team?.short_name ?? 'H'}
              awayLabel={match.away_team?.short_name ?? 'A'}
              inverse max={100}
            />
          </div>

          {/* Travel Fatigue */}
          <div>
            <IntelligenceBar
              label="TRAVEL FATIGUE"
              homeValue={homeIntel?.travel_fatigue_score != null ? Math.round(homeIntel.travel_fatigue_score) : null}
              awayValue={awayIntel?.travel_fatigue_score != null ? Math.round(awayIntel.travel_fatigue_score) : null}
              homeLabel={match.home_team?.short_name ?? 'H'}
              awayLabel={match.away_team?.short_name ?? 'A'}
              inverse max={100}
            />
          </div>

          {/* Active competitions */}
          <div>
            <div style={{ ...TYPE.label, fontSize: 9, marginBottom: 6 }}>Active Competitions</div>
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
              {[
                { label: match.home_team?.short_name ?? 'H', val: intel?.home_active_competitions },
                { label: match.away_team?.short_name ?? 'A', val: intel?.away_active_competitions },
              ].map(t => (
                <div key={t.label} style={{ textAlign: 'center' }}>
                  <div style={{ ...TYPE.mono, fontSize: 22, fontWeight: 700, color: (t.val ?? 0) > 2 ? COLORS.amber : COLORS.text }}>
                    {t.val ?? '—'}
                  </div>
                  <div style={{ fontSize: 9, color: COLORS.dim }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Link */}
          <div style={{ gridColumn: '1/-1', textAlign: 'center', paddingTop: 6 }}>
            <Link href={matchUrl(match)} style={{
              fontSize: 11, color: COLORS.blue, borderBottom: `1px solid ${COLORS.blue}40`,
            }}>
              View Full Match Intelligence →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
