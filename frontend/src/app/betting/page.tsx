'use client';
import { useState, useEffect } from 'react';
import { toOne } from '@/lib/relations';
import Link from 'next/link';
import { getTodaysMatches, getMatchSignalsForMatches } from '@/lib/queries';
import { computeMatchSignals } from '@/lib/signals';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';
import SignalChip from '@/components/SignalChip';
import { SkeletonCard } from '@/components/SkeletonCard';
import { matchUrl } from '@/lib/urls';
import { supabase } from '@/lib/supabase';

const MARKET_TABS = ['1X2','Over/Under','BTTS','Asian Handicap','Clean Sheets','Cards','Specials'];
const TAB_GROUP: Record<string, string[]> = {
  '1X2':           ['Match Result (1X2)','Double Chance (1X)','Away Win (Avoid)'],
  'Over/Under':    ['Over/Under Goals','Total Goals O/U','Home Team Goals','Away Team Goals'],
  'BTTS':          ['BTTS'],
  'Asian Handicap':['Asian Handicap'],
  'Clean Sheets':  ['Clean Sheet (Home)'],
  'Cards':         ['Cards Issued'],
  'Specials':      ['Win to Nil (Home)','First to Score','Competition Load'],
};

function Card({ children, style={} }: any) {
  return <div style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, ...style }}>{children}</div>;
}

export default function BettingHub() {
  const [matches, setMatches] = useState<any[]>([]);
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('1X2');
  const [isPro] = useState(true); // PRO gating disabled for local testing — revert to false before any public deploy

  useEffect(() => {
    getTodaysMatches()
      .then(async data => {
        setMatches(data as any[]);
        const matchList = data as any[];
        const matchIds = matchList.map((m: any) => m.id).filter(Boolean);

        // Precomputed signals first — see processMatchSignals() in the
        // backend (match_signals table). Bulk-fetched for all of today's
        // matches in one query rather than one live computation per match.
        const storedMap = await getMatchSignalsForMatches(matchIds).catch(() => new Map());

        // Fetch team_intelligence for squad signals (squad_depth_score,
        // injury_burden_score, squad_stability_score) — still needed for
        // the LIVE fallback path below, for any match that doesn't have a
        // precomputed row yet.
        const teamIds = matchList.flatMap((m: any) => [m.home_team_id, m.away_team_id]).filter(Boolean);

        let intelRows: any[] = [];
        if (teamIds.length > 0) {
          try {
            const { data: rows } = await supabase
              .from('team_intelligence')
              .select('team_id, squad_depth_score, injury_burden_score, squad_stability_score, form_index, travel_fatigue_score, congestion_score, last_5_points, active_competitions')
              .in('team_id', [...new Set(teamIds)]);
            intelRows = rows || [];
          } catch (err) {
            console.error('Failed to fetch team intelligence:', err);
          }
        }

        const tiMap = new Map<number, any>((intelRows ?? []).map((r: any) => [r.team_id, r]));

        const computed = matchList.map((m: any) => {
          const stored = storedMap.get(m.id);
          if (stored && stored.length > 0) {
            return { match: m, intel: toOne(m.match_intelligence), signals: stored };
          }

          // Fall back to live computation — same as before this change,
          // for any match process:match-signals hasn't reached yet.
          const intel = toOne(m.match_intelligence);
          if (!intel) return null;
          const hti = tiMap.get(m.home_team_id) || {};
          const ati = tiMap.get(m.away_team_id) || {};
          const sigs = computeMatchSignals({
            home_readiness: intel.home_readiness,
            away_readiness: intel.away_readiness,
            readiness_gap: intel.readiness_gap,
            congestion_factor: intel.congestion_factor,
            home_rest_days: intel.home_rest_days,
            away_rest_days: intel.away_rest_days,
            home_travel_distance_km: intel.home_travel_distance_km,
            away_travel_distance_km: intel.away_travel_distance_km,
            home_active_competitions: intel.home_active_competitions,
            away_active_competitions: intel.away_active_competitions,
            travel_advantage_km: toOne(m.match_travel_intelligence)?.travel_advantage_km,
            home_form_index:    hti?.form_index ?? null,
            away_form_index:    ati?.form_index ?? null,
            home_travel_fatigue: hti?.travel_fatigue_score ?? null,
            away_travel_fatigue: ati?.travel_fatigue_score ?? null,
            home_congestion:    hti?.congestion_score ?? null,
            away_congestion:    ati?.congestion_score ?? null,
            home_last_5_pts:    hti?.last_5_points ?? null,
            away_last_5_pts:    ati?.last_5_points ?? null,
            home_squad_depth:   hti?.squad_depth_score ?? null,
            away_squad_depth:   ati?.squad_depth_score ?? null,
            home_injury_burden: hti?.injury_burden_score ?? null,
            away_injury_burden: ati?.injury_burden_score ?? null,
            home_squad_stability: hti?.squad_stability_score ?? null,
            away_squad_stability: ati?.squad_stability_score ?? null,
          });
          return { match: m, intel, signals: sigs };
        }).filter(Boolean);
        setAllSignals(computed as any[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter signals for current tab
  const allowedMarkets = TAB_GROUP[tab] ?? [];
  const tabData = allSignals.map(entry => ({
    ...entry,
    signals: entry.signals.filter((s: any) => allowedMarkets.includes(s.market)),
  })).filter(e => e.signals.length > 0);

  // Summary counts
  const strongHome = allSignals.flatMap(e => e.signals).filter((s: any) => s.direction==='home' && s.strength>=4).length;
  const strongAway = allSignals.flatMap(e => e.signals).filter((s: any) => s.direction==='away' && s.strength>=4).length;
  const underSignals = allSignals.flatMap(e => e.signals).filter((s: any) => s.signal?.includes('Under')).length;
  const travelAlerts = allSignals.filter(e => (e.intel?.away_travel_distance_km ?? 0) > 800).length;

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>

      {/* Disclaimer — always visible per spec */}
      <div style={{ background:COLORS.amber+'15', border:`1px solid ${COLORS.amber}35`, borderRadius:10, padding:'12px 18px', fontSize:12, color:COLORS.amber, display:'flex', gap:10, alignItems:'flex-start' }}>
        <span style={{ fontSize:16, flexShrink:0 }}>⚠️</span>
        <div>
          <div style={{ fontWeight:700, marginBottom:2 }}>Intelligence signals are derived from precomputed data for informational purposes only.</div>
          <div style={{ fontSize:11, opacity:0.8 }}>Not financial or betting advice. Please bet responsibly. Signals reflect team readiness intelligence — not historical odds or guarantee of outcome.</div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
        {[
          { label:'Strong Home Signals', val:strongHome, color:COLORS.green },
          { label:'Strong Away Signals', val:strongAway, color:COLORS.red },
          { label:'Under Signals', val:underSignals, color:COLORS.blue },
          { label:'Travel Alerts', val:travelAlerts, color:COLORS.amber },
        ].map(c => (
          <Card key={c.label} style={{ textAlign:'center' }}>
            <div style={{ ...TYPE.label, fontSize:9, marginBottom:8 }}>{c.label}</div>
            <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:36, fontWeight:700, color:c.color }}>{c.val}</div>
            <div style={{ fontSize:10, color:COLORS.dim, marginTop:2 }}>today&apos;s matches</div>
          </Card>
        ))}
      </div>

      {/* PRO badge + upgrade hint */}
      {!isPro && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:COLORS.purple+'12', border:`1px solid ${COLORS.purple}30`, borderRadius:10, padding:'10px 18px' }}>
          <div>
            <div style={{ fontSize:12, color:COLORS.text, fontWeight:700 }}>🔒 PRO — Full signal access</div>
            <div style={{ fontSize:11, color:COLORS.muted, marginTop:2 }}>Full market coverage, all signals, data export, alerts</div>
          </div>
          <div style={{ background:COLORS.purple, borderRadius:8, padding:'7px 18px', fontSize:12, fontWeight:700, color:'#fff', cursor:'pointer' }}>
            Unlock 47 more signals today →
          </div>
        </div>
      )}

      {/* Market tabs */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {MARKET_TABS.map((t, i) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'6px 14px', borderRadius:8, fontSize:11, fontWeight:700,
            border:`1px solid ${tab===t?COLORS.green:COLORS.border}`,
            background:tab===t?COLORS.green+'18':'none',
            color:tab===t?COLORS.green:COLORS.muted, cursor:'pointer',
            textTransform:'uppercase', letterSpacing:'0.06em',
            position:'relative',
          }}>
            {t}
            {i >= 2 && !isPro && <span style={{ position:'absolute', top:-4, right:-4, background:COLORS.purple, borderRadius:3, fontSize:8, color:'#fff', padding:'1px 3px', fontWeight:700 }}>PRO</span>}
          </button>
        ))}
      </div>

      {/* Signal tables */}
      {loading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>{Array(3).fill(0).map((_,i) => <SkeletonCard key={i} height={80}/>)}</div>
      ) : (
        <>
          {tabData.length === 0 && (
            <div style={{ textAlign:'center', padding:40, color:COLORS.muted }}>
              <div style={{ fontSize:24, marginBottom:8 }}>📊</div>
              <div>No signals for this market today — ensure process:all-db has run</div>
            </div>
          )}

          {/* 1X2 tab has home/away/draw groupings per spec */}
          {tab === '1X2' && tabData.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {['home','away','neutral'].map(dir => {
                const rows = tabData.filter(e => {
                  const s = e.signals.find((s: any) => s.market === 'Match Result (1X2)');
                  return s?.direction === dir && s?.strength >= 2;
                });
                if (rows.length === 0) return null;
                const title = dir==='home' ? '🟢 Strongest Home Signals' : dir==='away' ? '🔴 Strongest Away Signals' : '⬜ Draw Signals';
                const color = dir==='home' ? COLORS.green : dir==='away' ? COLORS.red : COLORS.amber;
                return (
                  <div key={dir}>
                    <div style={{ ...TYPE.sectionHeader, fontSize:10, color, marginBottom:8 }}>{title}</div>
                    <Card style={{ padding:0, overflow:'hidden' }}>
                      <table style={{ width:'100%' }}>
                        <thead>
                          <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                            {['Match','Competition','Home','Away','Gap','Signals','Strength'].map(h => (
                              <th key={h} style={{ padding:'8px 12px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[...rows].sort((a,b) => {
                            const sa = a.signals.find((s: any) => s.market==='Match Result (1X2)')?.strength ?? 0;
                            const sb = b.signals.find((s: any) => s.market==='Match Result (1X2)')?.strength ?? 0;
                            return sb - sa;
                          }).map((entry, i) => {
                            const m = entry.match; const intel = entry.intel;
                            const sig = entry.signals.find((s: any) => s.market==='Match Result (1X2)');
                            const isBlurred = !isPro && i >= 3;
                            const restDiff = Math.abs((intel?.home_rest_days??0)-(intel?.away_rest_days??0));
                            const hasTravel = (intel?.away_travel_distance_km??0) > 800;
                            const hasForm = intel?.home_readiness > 70;
                            return (
                              <tr key={i} style={{ borderBottom:`1px solid ${COLORS.border}`, background:i%2===0?'transparent':COLORS.surface2+'40', position:'relative' }}>
                                <td style={{ padding:'10px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                                  <Link href={matchUrl(m)} style={{ fontSize:12, fontWeight:700, color:COLORS.text }}>{m.home_team?.short_name} vs {m.away_team?.short_name}</Link>
                                </td>
                                <td style={{ padding:'10px 12px', fontSize:10, color:COLORS.muted, filter:isBlurred?'blur(4px)':'none' }}>{m.competition}</td>
                                <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:13, fontWeight:700, color:scoreColor(intel?.home_readiness), filter:isBlurred?'blur(4px)':'none' }}>{intel?.home_readiness ?? '—'}</td>
                                <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:13, fontWeight:700, color:scoreColor(intel?.away_readiness), filter:isBlurred?'blur(4px)':'none' }}>{intel?.away_readiness ?? '—'}</td>
                                <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:12, filter:isBlurred?'blur(4px)':'none' }}>{intel?.readiness_gap != null ? Math.abs(intel.readiness_gap) : '—'}</td>
                                <td style={{ padding:'10px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                                  <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                                    {restDiff>2 && <span style={{ fontSize:9, color:COLORS.green, background:COLORS.green+'15', border:`1px solid ${COLORS.green}30`, borderRadius:3, padding:'1px 5px', fontWeight:700 }}>Rest✓</span>}
                                    {hasTravel && <span style={{ fontSize:9, color:COLORS.green, background:COLORS.green+'15', border:`1px solid ${COLORS.green}30`, borderRadius:3, padding:'1px 5px', fontWeight:700 }}>Travel✓</span>}
                                    {hasForm && <span style={{ fontSize:9, color:COLORS.green, background:COLORS.green+'15', border:`1px solid ${COLORS.green}30`, borderRadius:3, padding:'1px 5px', fontWeight:700 }}>Form✓</span>}
                                  </div>
                                </td>
                                <td style={{ padding:'10px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                                  <div style={{ display:'flex', gap:2 }}>
                                    {Array.from({length:6}).map((_,j) => <div key={j} style={{ width:7, height:12, borderRadius:2, background:j<(sig?.strength??0)?color:COLORS.border }} />)}
                                  </div>
                                </td>
                                {isBlurred && (
                                  <td colSpan={0} style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:COLORS.surface+'90' }}>
                                    <div style={{ background:COLORS.purple+'20', border:`1px solid ${COLORS.purple}40`, borderRadius:8, padding:'4px 14px', fontSize:11, color:COLORS.purple, fontWeight:700 }}>
                                      🔒 Unlock with PRO →
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}

          {/* Generic signal table for other tabs */}
          {tab !== '1X2' && tabData.length > 0 && (
            <Card style={{ padding:0, overflow:'hidden' }}>
              <div style={{ padding:'12px 16px', borderBottom:`1px solid ${COLORS.border}`, fontSize:12, fontWeight:700, color:COLORS.text }}>
                {tab} — Signal Table
              </div>
              <table style={{ width:'100%' }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                    {['Match','Competition','Market','Signal','Strength','Intelligence Driver'].map(h => (
                      <th key={h} style={{ padding:'8px 12px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tabData.flatMap((entry, ei) =>
                    entry.signals.map((sig: any, si: number) => {
                      const m = entry.match;
                      const col = sig.direction==='home'?COLORS.green:sig.direction==='away'?COLORS.red:sig.direction==='avoid'?COLORS.orange:COLORS.muted;
                      const isEdge = !['No Edge','No Flag','Balanced','Level'].includes(sig.signal);
                      const isBlurred = !isPro && (ei*3+si) >= 3;
                      return (
                        <tr key={`${ei}-${si}`} style={{ borderBottom:`1px solid ${COLORS.border}`, background:(ei*3+si)%2===0?'transparent':COLORS.surface2+'40', position:'relative' }}>
                          <td style={{ padding:'9px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                            <Link href={matchUrl(m)} style={{ fontSize:11, fontWeight:700, color:COLORS.text }}>{m.home_team?.short_name} vs {m.away_team?.short_name}</Link>
                          </td>
                          <td style={{ padding:'9px 12px', fontSize:10, color:COLORS.muted, filter:isBlurred?'blur(4px)':'none' }}>{m.competition}</td>
                          <td style={{ padding:'9px 12px', fontSize:11, fontWeight:600, color:COLORS.text, filter:isBlurred?'blur(4px)':'none' }}>{sig.market}{sig.locked && <span style={{ marginLeft:4, fontSize:9, color:COLORS.purple }}>🔒</span>}</td>
                          <td style={{ padding:'9px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                            <span style={{ background:(isEdge?col:COLORS.dim)+'20', color:isEdge?col:COLORS.dim, border:`1px solid ${isEdge?col:COLORS.dim}40`, borderRadius:6, padding:'2px 7px', fontSize:10, fontWeight:700 }}>{sig.signal}</span>
                          </td>
                          <td style={{ padding:'9px 12px', filter:isBlurred?'blur(4px)':'none' }}>
                            <div style={{ display:'flex', gap:2 }}>
                              {Array.from({length:6}).map((_,j) => <div key={j} style={{ width:6, height:10, borderRadius:2, background:j<sig.strength?(isEdge?col:COLORS.dim):COLORS.border }} />)}
                            </div>
                          </td>
                          <td style={{ padding:'9px 12px', fontSize:10, color:COLORS.muted, filter:isBlurred?'blur(4px)':'none' }}>{sig.drivers}</td>
                          {isBlurred && (
                            <td colSpan={0} style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:COLORS.surface+'90' }}>
                              <div style={{ background:COLORS.purple+'20', border:`1px solid ${COLORS.purple}40`, borderRadius:8, padding:'4px 14px', fontSize:11, color:COLORS.purple, fontWeight:700 }}>🔒 Unlock with PRO →</div>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}