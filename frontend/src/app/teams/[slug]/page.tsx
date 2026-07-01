'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { parseIdFromSlug } from '@/lib/urls';
import Link from 'next/link';
import { getTeamIntelligence, getTeamFormHistory, getTeamFixtureLoad, getTeamTravelLoad, getTeamSquadSnapshot, getTeamUpcomingMatches } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { COLORS, scoreColor, TYPE } from '@/design/tokens';
import ReadinessGauge from '@/components/ReadinessGauge';
import FormString from '@/components/FormString';
import IntelligenceBar from '@/components/IntelligenceBar';
import { SkeletonCard } from '@/components/SkeletonCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const TABS = ['Form','Fixture Load','Travel','Squad','Intelligence','Matches'];

function Card({ children, style={} }: { children: React.ReactNode; style?: any }) {
  return <div style={{ background:COLORS.surface, border:`1px solid ${COLORS.border}`, borderRadius:12, padding:16, ...style }}>{children}</div>;
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TYPE.label, fontSize:10, marginBottom:5 }}>{children}</div>;
}
function Big({ val, unit='', score, color }: { val: any; unit?: string; score?: number; color?: string }) {
  const col = color ?? (score != null ? scoreColor(score) : COLORS.text);
  return <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:24, fontWeight:700, color:col, lineHeight:1 }}>{val ?? '—'}{unit && <span style={{fontSize:13,color:COLORS.dim,marginLeft:3}}>{unit}</span>}</div>;
}

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const id = parseIdFromSlug(slug)?.toString() ?? '';
  const [data, setData] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Form');

  useEffect(() => {
    async function load() {
      if (!id) return;
      const teamId = parseInt(id);
      setLoading(true);
      try {
        const { data: td } = await supabase.from('teams').select('id,name,short_name,country,slug').eq('id', teamId).single();
        setTeam(td);
        const [intel, form, fix, travel, squad, upcoming] = await Promise.all([
          getTeamIntelligence(teamId).catch(() => null),
          getTeamFormHistory(teamId, 10).catch(() => []),
          getTeamFixtureLoad(teamId).catch(() => null),
          getTeamTravelLoad(teamId).catch(() => null),
          getTeamSquadSnapshot(teamId).catch(() => null),
          getTeamUpcomingMatches(teamId, 14).catch(() => []),
        ]);
        setData({ intel, form, fix, travel, squad, upcoming });
      } finally { setLoading(false); }
    }
    load();
  }, [id]);

  if (loading) return <div style={{ padding:24, display:'flex', flexDirection:'column', gap:14 }}><SkeletonCard height={80}/><SkeletonCard height={140}/><SkeletonCard height={240}/></div>;
  if (!team) return <div style={{ padding:40, textAlign:'center', color:COLORS.muted }}>Team not found</div>;

  const { intel, form, fix, travel, squad, upcoming } = data ?? {};
  const formResults = (form ?? []).map((f: any) => f.result).reverse();

  // Form chart data
  const formChart = (form ?? []).slice(0,10).reverse().map((f: any, i: number) => ({
    match: i + 1,
    gf: f.goals_for ?? 0,
    ga: f.goals_against ?? 0,
  }));

  // Home vs Away split
  const homeForm = (form ?? []).filter((_: any, i: number) => {
    const m = form[i]?.match;
    return m?.home_team?.name === team?.name;
  });
  const awayForm = (form ?? []).filter((_: any, i: number) => {
    const m = form[i]?.match;
    return m?.away_team?.name === team?.name;
  });

  const cleanSheets10 = (form ?? []).slice(0,10).filter((f: any) => f.goals_against === 0).length;
  const failedScore10 = (form ?? []).slice(0,10).filter((f: any) => f.goals_for === 0).length;
  const goalsScored10 = (form ?? []).slice(0,10).reduce((s: number, f: any) => s + (f.goals_for ?? 0), 0);
  const goalsConceded10 = (form ?? []).slice(0,10).reduce((s: number, f: any) => s + (f.goals_against ?? 0), 0);

  return (
    <main style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:20 }}>

      {/* ── HEADER ── */}
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <div style={{ width:56, height:56, background:COLORS.green+'20', border:`2px solid ${COLORS.green}40`, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'monospace', fontSize:16, fontWeight:'bold', color:COLORS.green, flexShrink:0 }}>
          {team.short_name?.slice(0,3) ?? team.name?.slice(0,3)}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:700, color:COLORS.text }}>{team.name}</div>
          <div style={{ display:'flex', gap:7, marginTop:5, flexWrap:'wrap' }}>
            {[
              { val:team.country, col:COLORS.blue },
              { val:intel?.active_competitions ? `${intel.active_competitions} active comps` : null, col:COLORS.amber },
              { val:squad?.players_count ? `${squad.players_count} players` : null, col:COLORS.muted },
              { val:squad?.avg_age ? `Avg age ${Number(squad.avg_age).toFixed(1)}` : null, col:COLORS.muted },
            ].filter(t => t.val).map((t, i) => (
              <span key={i} style={{ background:t.col+'20', color:t.col, border:`1px solid ${t.col}40`, borderRadius:4, padding:'1px 7px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.07em' }}>{t.val}</span>
            ))}
          </div>
        </div>
        {/* Overall readiness gauge */}
        <ReadinessGauge score={intel?.readiness_score ?? null} label="READINESS" size={120} />
      </div>

      {/* ── HERO ROW: 6 Intelligence Gauges ── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:12 }}>
        {[
          { label:'Readiness', val:intel?.readiness_score, score:intel?.readiness_score },
          { label:'Form Index', val:intel?.form_index, score:intel?.form_index },
          { label:'Congestion', val:intel?.congestion_score, score:100-(intel?.congestion_score??0), rawScore:intel?.congestion_score },
          { label:'Travel Fatigue', val:intel?.travel_fatigue_score, score:100-(intel?.travel_fatigue_score??0), rawScore:intel?.travel_fatigue_score },
          { label:'Active Comps', val:intel?.active_competitions, noGauge:true },
          { label:'Rest Avg', val:intel?.rest_days_avg?.toFixed(1), unit:'d', noGauge:true },
        ].map((g, i) => (
          <Card key={i} style={{ padding:12, textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center' }}>
            <Label>{g.label}</Label>
            {g.noGauge ? (
              <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:26, fontWeight:700, color:COLORS.text, marginTop:4 }}>
                {g.val ?? '—'}{g.unit && <span style={{fontSize:12,color:COLORS.dim,marginLeft:2}}>{g.unit}</span>}
              </div>
            ) : (
              <div style={{ fontFamily:'"JetBrains Mono",monospace', fontSize:26, fontWeight:700, color:scoreColor(g.score ?? null), marginTop:4 }}>
                {g.rawScore != null ? Math.round(g.rawScore) : (g.val != null ? Math.round(g.val as number) : '—')}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* ── TABS ── */}
      <div style={{ display:'flex', gap:0, borderBottom:`1px solid ${COLORS.border}` }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding:'8px 16px', fontSize:11, fontWeight:700,
            borderBottom:`2px solid ${tab===t?COLORS.green:'transparent'}`,
            color:tab===t?COLORS.green:COLORS.muted,
            textTransform:'uppercase', letterSpacing:'0.07em', cursor:'pointer',
          }}>{t}</button>
        ))}
      </div>

      {/* ── FORM TAB ── */}
      {tab === 'Form' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:16 }}>
            <Card>
              <Label>Form String (Last 10)</Label>
              <div style={{ marginTop:6, marginBottom:14 }}>
                <FormString results={formResults.slice(-10)} count={10} />
              </div>
              <div style={{ display:'flex', gap:20, marginBottom:14 }}>
                <div><Label>Last 5 Pts</Label><Big val={intel?.last_5_points} unit="/15" score={(intel?.last_5_points/15)*100}/></div>
                <div><Label>Last 10 Pts</Label><Big val={intel?.last_10_points} unit="/30" score={(intel?.last_10_points/30)*100}/></div>
                <div><Label>Form Index</Label><Big val={intel?.form_index ? Math.round(intel.form_index) : '—'} score={intel?.form_index}/></div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
                {[['Goals (10)', goalsScored10],['Conceded (10)', goalsConceded10],['Clean Sheets', `${cleanSheets10}/10`],['Failed to Score', `${failedScore10}/10`]].map(([k,v]) => (
                  <div key={k as string} style={{ background:COLORS.surface2, borderRadius:8, padding:'8px 10px' }}>
                    <Label>{k as string}</Label>
                    <Big val={v} />
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <Label>Home vs Away</Label>
              <div style={{ display:'flex', flexDirection:'column', gap:10, marginTop:6 }}>
                {[{label:'Home',data:homeForm},{label:'Away',data:awayForm}].map(({label,data}) => {
                  const W = data.filter((f:any) => f.result==='W').length;
                  const D = data.filter((f:any) => f.result==='D').length;
                  const L = data.filter((f:any) => f.result==='L').length;
                  return (
                    <div key={label} style={{ background:COLORS.surface2, borderRadius:8, padding:'10px 12px' }}>
                      <div style={{ fontSize:10, color:COLORS.muted, fontWeight:700, textTransform:'uppercase', marginBottom:6 }}>{label}</div>
                      <div style={{ display:'flex', gap:10 }}>
                        <span style={{ fontFamily:'monospace', fontSize:13, color:COLORS.green, fontWeight:700 }}>{W}W</span>
                        <span style={{ fontFamily:'monospace', fontSize:13, color:COLORS.amber, fontWeight:700 }}>{D}D</span>
                        <span style={{ fontFamily:'monospace', fontSize:13, color:COLORS.red, fontWeight:700 }}>{L}L</span>
                        <span style={{ fontFamily:'monospace', fontSize:11, color:COLORS.dim }}>of {data.length}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
          {/* Goals chart */}
          <Card>
            <Label>Goals For vs Against (Last 10)</Label>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={formChart} barGap={2}>
                <XAxis dataKey="match" tick={{ fill:COLORS.muted, fontSize:10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill:COLORS.muted, fontSize:10 }} axisLine={false} tickLine={false} width={20} />
                <Tooltip contentStyle={{ background:COLORS.surface2, border:`1px solid ${COLORS.border}`, borderRadius:8, fontSize:11 }} labelStyle={{ color:COLORS.muted }} />
                <Bar dataKey="gf" name="Goals For" fill={COLORS.green} opacity={0.8} radius={[3,3,0,0]} />
                <Bar dataKey="ga" name="Goals Against" fill={COLORS.red} opacity={0.6} radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── FIXTURE LOAD TAB ── */}
      {tab === 'Fixture Load' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>Past Load</div>
            {fix ? (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {[['Last 7 days','matches_last_7_days',4],['Last 14 days','matches_last_14_days',6],['Last 30 days','matches_last_30_days',12],['Avg Rest',null,null,'avg_rest_days','d'],['Min Rest',null,null,'min_rest_days','d'],['Congestion',null,null,'congestion_score','/100']].map(([label,key,max,altKey,unit]: any) => {
                  const val = key ? fix[key] : fix[altKey];
                  const pct = key && max ? Math.min(100, ((val??0)/max)*100) : null;
                  const col = key ? scoreColor(100 - pct!) : scoreColor(altKey==='avg_rest_days' ? Math.min(100,(val??0)*10) : altKey==='min_rest_days' ? Math.min(100,(val??0)*15) : 100-(val??0));
                  return (
                    <div key={label}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontSize:11, color:COLORS.muted }}>{label}</span>
                        <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:col }}>{val != null ? (typeof val === 'number' && val % 1 !== 0 ? val.toFixed(1) : Math.round(val)) : '—'}{unit || ''}</span>
                      </div>
                      {pct !== null && (
                        <div style={{ height:5, background:COLORS.border, borderRadius:2, overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background:col, borderRadius:2 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <div style={{ color:COLORS.dim }}>Run process:fixture-load</div>}
          </Card>
          <Card>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>Upcoming Load</div>
            {fix ? (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {[['Next 7 days','matches_next_7_days',4],['Next 14 days','matches_next_14_days',6]].map(([label,key,max]: any) => {
                  const val = fix[key] ?? 0;
                  const pct = Math.min(100,(val/max)*100);
                  const col = scoreColor(100 - pct);
                  return (
                    <div key={label}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontSize:11, color:COLORS.muted }}>{label}</span>
                        <span style={{ fontFamily:'monospace', fontSize:16, fontWeight:700, color:col }}>{val}</span>
                      </div>
                      <div style={{ height:7, background:COLORS.border, borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:col, borderRadius:3 }} />
                      </div>
                    </div>
                  );
                })}
                {(upcoming ?? []).length > 0 && (
                  <div style={{ marginTop:10 }}>
                    <Label>Schedule (Next 14 days)</Label>
                    {(upcoming ?? []).slice(0,7).map((u: any, i: number) => {
                      const opp = u.home_team?.id === parseInt(id) ? u.away_team?.name : u.home_team?.name;
                      const ha  = u.home_team?.id === parseInt(id) ? 'H' : 'A';
                      const dt  = new Date(u.date);
                      const dayDiff = Math.round((dt.getTime() - Date.now()) / 86400000);
                      return (
                        <div key={i} style={{ display:'flex', gap:8, padding:'5px 0', borderBottom:`1px solid ${COLORS.border}`, fontSize:11 }}>
                          <div style={{ color:COLORS.dim, minWidth:36 }}>{dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</div>
                          <div style={{ flex:1, color:COLORS.muted, fontSize:10 }}>{u.competition}</div>
                          <div style={{ color:COLORS.text, fontWeight:600 }}>{opp}</div>
                          <div style={{ fontFamily:'monospace', color:ha==='H'?COLORS.green:COLORS.amber, fontWeight:700 }}>{ha}</div>
                          <div style={{ fontFamily:'monospace', color:dayDiff<=3?COLORS.amber:COLORS.dim, fontSize:10 }}>{dayDiff}d</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : <div style={{ color:COLORS.dim }}>Run process:fixture-load</div>}
          </Card>
        </div>
      )}

      {/* ── TRAVEL TAB ── */}
      {tab === 'Travel' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>Travel Summary (30 days)</div>
            {travel ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  ['Total km', travel.km_last_30_days ? Math.round(travel.km_last_30_days).toLocaleString() : '—', 'km'],
                  ['Away matches', travel.away_matches_last_30_days, 'trips'],
                  ['Avg trip', travel.avg_trip_distance_km ? Math.round(travel.avg_trip_distance_km) : '—', 'km'],
                  ['Travel Fatigue', travel.travel_fatigue_score ? Math.round(travel.travel_fatigue_score) : '—', '/100'],
                ].map(([k,v,u]) => (
                  <div key={k as string} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:`1px solid ${COLORS.border}` }}>
                    <span style={{ fontSize:12, color:COLORS.muted }}>{k}</span>
                    <span style={{ fontFamily:'monospace', fontSize:16, fontWeight:700, color:COLORS.text }}>{v}{u && <span style={{fontSize:11,color:COLORS.dim,marginLeft:2}}>{u}</span>}</span>
                  </div>
                ))}
                <div style={{ marginTop:8 }}>
                  <ReadinessGauge score={travel.travel_fatigue_score ? Math.round(travel.travel_fatigue_score) : null} label="TRAVEL FATIGUE" size={90} />
                </div>
              </div>
            ) : <div style={{ color:COLORS.dim }}>Run process:travel-load</div>}
          </Card>
          <Card>
            <div style={{ fontSize:12, fontWeight:700, color:COLORS.text, marginBottom:12 }}>Travel Intelligence</div>
            {travel ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[['Last 7d','km_last_7_days'],['Last 14d','km_last_14_days'],['Last 30d','km_last_30_days']].map(([label,key]: any) => {
                  const val = travel[key] ? Math.round(travel[key]) : 0;
                  const max = 5000;
                  return (
                    <div key={label}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontSize:11, color:COLORS.muted }}>{label}</span>
                        <span style={{ fontFamily:'monospace', fontSize:13, fontWeight:700, color:val>2000?COLORS.red:val>1000?COLORS.amber:COLORS.text }}>{val.toLocaleString()}km</span>
                      </div>
                      <div style={{ height:5, background:COLORS.border, borderRadius:2, overflow:'hidden' }}>
                        <div style={{ width:`${Math.min(100,(val/max)*100)}%`, height:'100%', background:val>2000?COLORS.red:val>1000?COLORS.amber:COLORS.green, borderRadius:2 }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop:8, padding:'10px 12px', background:COLORS.surface2, borderRadius:8, fontSize:11, color:COLORS.muted }}>
                  Travel map requires Leaflet.js — add to component for interactive venue plotting
                </div>
              </div>
            ) : <div style={{ color:COLORS.dim }}>Run process:travel-load</div>}
          </Card>
        </div>
      )}

      {/* ── SQUAD TAB ── */}
      {tab === 'Squad' && (
        <Card>
          {squad ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[['Squad Size',squad.players_count,'players'],['Avg Age',squad.avg_age?.toFixed(1),'yrs'],['Foreign',`${squad.foreign_players_count} (${squad.players_count ? Math.round(squad.foreign_players_count/squad.players_count*100) : 0}%)`, ''],['Domestic',`${squad.domestic_players_count} (${squad.players_count ? Math.round(squad.domestic_players_count/squad.players_count*100) : 0}%)`, '']].map(([k,v,u]) => (
                <div key={k as string} style={{ background:COLORS.surface2, borderRadius:10, padding:14, textAlign:'center' }}>
                  <Label>{k as string}</Label>
                  <div style={{ fontFamily:'monospace', fontSize:22, fontWeight:700, color:COLORS.text, marginTop:4 }}>{v ?? '—'}</div>
                  {u && <div style={{ fontSize:10, color:COLORS.dim, marginTop:2 }}>{u}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding:40, textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🔒</div>
              <div style={{ color:COLORS.muted, fontSize:14, fontWeight:700 }}>Squad data pending</div>
              <div style={{ color:COLORS.dim, fontSize:11, marginTop:6 }}>Run: npx ts-node src/cli.ts sync:squads:tracked</div>
            </div>
          )}
        </Card>
      )}

      {/* ── INTELLIGENCE TAB ── */}
      {tab === 'Intelligence' && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:COLORS.text, marginBottom:14 }}>Readiness Breakdown</div>
            <table style={{ width:'100%' }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                  {['Component','Value','Weight','Status'].map(h => (
                    <th key={h} style={{ padding:'5px 8px', fontSize:9, color:COLORS.dim, textAlign:'left', textTransform:'uppercase', letterSpacing:'0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label:'Form Index',       val:intel?.form_index,               weight:'25%', inverse:false, active:true },
                  { label:'Congestion (inv)', val:intel?.congestion_score,         weight:'25%', inverse:true,  active:true },
                  { label:'Travel Fatigue',   val:intel?.travel_fatigue_score,     weight:'20%', inverse:true,  active:true },
                  { label:'Fatigue Index',    val:intel?.fatigue_index,            weight:'10%', inverse:false, active:!!intel?.fatigue_index },
                  { label:'Squad Stability',  val:intel?.squad_stability_index,    weight:'10%', inverse:false, active:!!intel?.squad_stability_index },
                  { label:'Rotation Pressure',val:intel?.rotation_pressure_index,  weight:'10%', inverse:false, active:!!intel?.rotation_pressure_index },
                ].map((row, i) => {
                  const col = row.active ? (row.inverse ? scoreColor(100-(row.val??0)) : scoreColor(row.val)) : COLORS.dim;
                  return (
                    <tr key={i} style={{ borderBottom:`1px solid ${COLORS.border}` }}>
                      <td style={{ padding:'8px', fontSize:11, color:row.active?COLORS.muted:COLORS.dim }}>{row.label}</td>
                      <td style={{ padding:'8px', fontFamily:'monospace', fontSize:12, fontWeight:700, color:col }}>{row.active && row.val != null ? Math.round(row.val) : '—'}</td>
                      <td style={{ padding:'8px', fontSize:10, color:COLORS.dim, fontFamily:'monospace' }}>{row.weight}</td>
                      <td style={{ padding:'8px' }}>{row.active ? <span style={{ color:COLORS.green, fontSize:10 }}>✅ Active</span> : <span style={{ color:COLORS.purple, fontSize:10 }}>🔒 Awaiting players</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop:12, padding:'10px 14px', background:COLORS.surface2, borderRadius:8, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ fontSize:11, color:COLORS.muted }}>Partial Readiness Score (3/6 components)</div>
              <div style={{ fontFamily:'monospace', fontSize:22, fontWeight:700, color:scoreColor(intel?.readiness_score) }}>{intel?.readiness_score ? Math.round(intel.readiness_score) : '—'}</div>
            </div>
          </Card>
          <Card>
            <div style={{ fontSize:13, fontWeight:700, color:COLORS.text, marginBottom:14 }}>Active Competitions</div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontFamily:'monospace', fontSize:40, fontWeight:700, color:scoreColor(intel?.active_competitions ? 100 - intel.active_competitions*20 : null) }}>{intel?.active_competitions ?? '—'}</div>
              <div style={{ fontSize:11, color:COLORS.muted, marginTop:2 }}>competitions in last 90 days</div>
            </div>
            <div style={{ fontSize:11, color:COLORS.dim, padding:'10px 12px', background:COLORS.surface2, borderRadius:8 }}>
              Active competitions derived from DISTINCT competition values in matches table (last 90 days)
            </div>
          </Card>
        </div>
      )}

      {/* ── MATCHES TAB ── */}
      {tab === 'Matches' && (
        <Card>
          <div style={{ fontSize:13, fontWeight:700, color:COLORS.text, marginBottom:14 }}>Recent & Upcoming</div>
          {(form ?? []).map((f: any, i: number) => {
            const m = f.match;
            const opp = m?.home_team?.name === team?.name ? m?.away_team?.name : m?.home_team?.name;
            const col = f.result==='W'?COLORS.green:f.result==='D'?COLORS.amber:COLORS.red;
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:`1px solid ${COLORS.border}` }}>
                <div style={{ fontSize:10, color:COLORS.dim, minWidth:48 }}>{m?.date ? new Date(m.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) : '—'}</div>
                <div style={{ fontSize:11, color:COLORS.dim, minWidth:100 }}>{m?.competition}</div>
                <div style={{ flex:1, fontSize:12, color:COLORS.text, fontWeight:600 }}>{opp ?? '?'}</div>
                <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                  <div style={{ background:col+'28', border:`1px solid ${col}60`, borderRadius:3, width:20, height:20, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:col, fontFamily:'monospace' }}>{f.result}</div>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:COLORS.muted }}>{f.goals_for}–{f.goals_against}</div>
                  <div style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:col }}>{f.points}pts</div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </main>
  );
}
