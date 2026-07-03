'use client';
import Link from 'next/link';
import { toOne } from '@/lib/relations';
import { COLORS, scoreColor } from '@/design/tokens';
import { matchUrl } from '@/lib/urls';

interface MatchIntelTableProps {
  matches: any[];
  teamIntelMap: Map<number, any>;
}

function fmtPair(home: number | null | undefined, away: number | null | undefined, invert = false): { h: string; a: string; hColor: string; aColor: string } {
  const h = home == null ? null : Math.round(home);
  const a = away == null ? null : Math.round(away);
  // invert: for congestion/travel-fatigue, higher = worse, so flip the
  // color scale (a high number should read amber/red, not green) without
  // changing the displayed number itself.
  const colorFor = (v: number | null) => v == null ? COLORS.dim : scoreColor(invert ? 100 - v : v);
  return {
    h: h == null ? '—' : String(h),
    a: a == null ? '—' : String(a),
    hColor: colorFor(h),
    aColor: colorFor(a),
  };
}

function PairCell({ home, away, invert = false, suffix = '' }: { home: number | null | undefined; away: number | null | undefined; invert?: boolean; suffix?: string }) {
  const { h, a, hColor, aColor } = fmtPair(home, away, invert);
  return (
    <td style={{ padding: '0 8px', fontFamily: '"JetBrains Mono",monospace', fontSize: 11, whiteSpace: 'nowrap' }}>
      <span style={{ color: hColor, fontWeight: 600 }}>{h}{h !== '—' ? suffix : ''}</span>
      <span style={{ color: COLORS.dim, margin: '0 3px' }}>/</span>
      <span style={{ color: aColor, fontWeight: 600 }}>{a}{a !== '—' ? suffix : ''}</span>
    </td>
  );
}

export default function MatchIntelTable({ matches, teamIntelMap }: MatchIntelTableProps) {
  if (matches.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted, fontSize: 14 }}>
        No matches today — run sync:today or check credentials
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${COLORS.border}`, background: COLORS.surface2 }}>
            {[
              'TIME', 'TOURNAMENT', 'TEAMS',
              'READINESS', 'FORM IDX', 'CONGESTION', 'TRAVEL FAT.',
              'FATIGUE IDX', 'SQUAD STAB.', 'ROTATION', 'REST AVG',
            ].map((label, i) => (
              <th
                key={label}
                style={{
                  padding: '8px',
                  textAlign: i < 3 ? 'left' : 'center',
                  fontSize: 9, color: COLORS.dim, textTransform: 'uppercase',
                  letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap',
                  position: 'sticky', top: 0, background: COLORS.surface2, zIndex: 1,
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matches.map((m: any) => {
            const intel = toOne(m.match_intelligence);
            const result = toOne(m.match_results);
            const homeIntel = teamIntelMap.get(m.home_team_id);
            const awayIntel = teamIntelMap.get(m.away_team_id);
            const isLive = m.status === 'live';
            const isDone = m.status === 'finished';

            const time = isLive ? '● LIVE' : isDone ? 'FT' : new Date(m.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

            return (
              <tr
                key={m.id}
                style={{ height: 40, borderBottom: `1px solid ${COLORS.border}80`, cursor: 'pointer' }}
                className="match-intel-row"
              >
                <td style={{ padding: '0 8px' }}>
                  <Link href={matchUrl(m)} style={{ display: 'block', fontSize: 11, color: isLive ? COLORS.green : COLORS.muted, fontWeight: isLive ? 700 : 400, whiteSpace: 'nowrap' }}>
                    {time}
                  </Link>
                </td>
                <td style={{ padding: '0 8px', fontSize: 11, color: COLORS.muted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.competition ?? '—'}
                </td>
                <td style={{ padding: '0 8px', fontSize: 12, color: COLORS.text, whiteSpace: 'nowrap' }}>
                  <Link href={matchUrl(m)} style={{ color: 'inherit' }}>
                    {isDone ? (
                      <span style={{ fontFamily: '"JetBrains Mono",monospace' }}>
                        {m.home_team?.short_name ?? '?'} {result?.home_score ?? 0}–{result?.away_score ?? 0} {m.away_team?.short_name ?? '?'}
                      </span>
                    ) : (
                      <span>{m.home_team?.short_name ?? '?'} <span style={{ color: COLORS.dim }}>v</span> {m.away_team?.short_name ?? '?'}</span>
                    )}
                  </Link>
                </td>

                {/* Readiness — match-specific first, team baseline fallback */}
                <PairCell
                  home={intel?.home_readiness ?? homeIntel?.readiness_score}
                  away={intel?.away_readiness ?? awayIntel?.readiness_score}
                />
                {/* Form Index — team-level only, no match-specific equivalent exists */}
                <PairCell home={homeIntel?.form_index} away={awayIntel?.form_index} />
                {/* Congestion — team-level score, higher = worse (inverted color) */}
                <PairCell home={homeIntel?.congestion_score} away={awayIntel?.congestion_score} invert />
                {/* Travel Fatigue — team-level score, higher = worse (inverted color) */}
                <PairCell home={homeIntel?.travel_fatigue_score} away={awayIntel?.travel_fatigue_score} invert />
                {/* Fatigue Index — requires player_season_statistics, not yet populated platform-wide */}
                <PairCell home={homeIntel?.fatigue_index} away={awayIntel?.fatigue_index} />
                {/* Squad Stability — team-level, from squad sync + transfer intelligence */}
                <PairCell home={homeIntel?.squad_stability_score} away={awayIntel?.squad_stability_score} />
                {/* Rotation Pressure — requires player_season_statistics, not yet populated platform-wide */}
                <PairCell home={homeIntel?.rotation_pressure_index} away={awayIntel?.rotation_pressure_index} />
                {/* Rest Avg — match-specific rest days first, team average fallback */}
                <PairCell
                  home={intel?.home_rest_days ?? homeIntel?.rest_days_avg}
                  away={intel?.away_rest_days ?? awayIntel?.rest_days_avg}
                  suffix="d"
                />
              </tr>
            );
          })}
        </tbody>
      </table>
      <style>{`
        .match-intel-row:hover { background: ${COLORS.surface2}60; }
      `}</style>
    </div>
  );
}
