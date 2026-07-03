'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { parseIdFromSlug, matchUrl } from '@/lib/urls';
import Link from 'next/link';
import {
  getTeamIntelligence, getTeamFormHistory, getTeamFixtureLoad, getTeamTravelLoad,
  getTeamSquadSnapshot, getTeamUpcomingMatches, getTeamIntelligenceTrend,
  getTeamKeyPlayers, getTeamPositionDepth, getTeamNextMatch,
  getTeamFixtureDifficulty, getTeamMomentum,
} from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { COLORS, scoreColor } from '@/design/tokens';
import ReadinessGauge from '@/components/ReadinessGauge';
import FormString from '@/components/FormString';
import { SkeletonCard } from '@/components/SkeletonCard';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

function Card({ children, style = {} }: { children: React.ReactNode; style?: any }) {
  return <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, ...style }}>{children}</div>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>{children}</div>;
}

const POSITION_COLORS: Record<string, string> = { GK: COLORS.green, DEF: COLORS.blue, MID: COLORS.amber, FWD: COLORS.red };
const POSITION_LABELS: Record<string, string> = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };

function Donut({ segments, centerValue, centerLabel }: {
  segments: { label: string; count: number; color: string }[];
  centerValue: string | number; centerLabel: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.count, 0) || 1;
  let cumulative = 0;
  const r = 38, cx = 50, cy = 50;
  const paths = segments.map(seg => {
    const startAngle = (cumulative / total) * 360;
    cumulative += seg.count;
    const endAngle = (cumulative / total) * 360;
    const large = endAngle - startAngle > 180 ? 1 : 0;
    const toXY = (deg: number) => {
      const rad = (deg - 90) * (Math.PI / 180);
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    const [x1, y1] = toXY(startAngle);
    const [x2, y2] = toXY(endAngle);
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color: seg.color };
  });
  return (
    <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
      <svg width={90} height={90} viewBox="0 0 100 100">
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity={0.85} />)}
        <circle cx={50} cy={50} r={24} fill={COLORS.surface} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{centerValue}</div>
        <div style={{ fontSize: 7, color: COLORS.dim, textTransform: 'uppercase' }}>{centerLabel}</div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>();
  const id = parseIdFromSlug(slug)?.toString() ?? '';
  const [data, setData] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!id) return;
      const teamId = parseInt(id);
      setLoading(true);
      try {
        const { data: td } = await supabase.from('teams').select('id,name,short_name,country,slug').eq('id', teamId).single();
        setTeam(td);
        const [intel, form, fix, travel, squad, upcoming, trend, keyPlayers, positionBreakdown, nextMatch, fixtureDifficulty, momentum] = await Promise.all([
          getTeamIntelligence(teamId).catch(() => null),
          getTeamFormHistory(teamId, 10).catch(() => []),
          getTeamFixtureLoad(teamId).catch(() => null),
          getTeamTravelLoad(teamId).catch(() => null),
          getTeamSquadSnapshot(teamId).catch(() => null),
          getTeamUpcomingMatches(teamId, 14).catch(() => []),
          getTeamIntelligenceTrend(teamId, 14).catch(() => []),
          getTeamKeyPlayers(teamId, 5).catch(() => []),
          getTeamPositionDepth(teamId).catch(() => []),
          getTeamNextMatch(teamId).catch(() => null),
          getTeamFixtureDifficulty(teamId).catch(() => null),
          getTeamMomentum(teamId).catch(() => null),
        ]);
        setData({ intel, form, fix, travel, squad, upcoming, trend, keyPlayers, positionBreakdown, nextMatch, fixtureDifficulty, momentum });
      } finally { setLoading(false); }
    }
    load();
  }, [id]);

  if (loading) return <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}><SkeletonCard height={80} /><SkeletonCard height={140} /><SkeletonCard height={240} /></div>;
  if (!team) return <div style={{ padding: 40, textAlign: 'center', color: COLORS.muted }}>Team not found</div>;

  const { intel, form, fix, travel, squad, upcoming, trend, keyPlayers, positionBreakdown, nextMatch, fixtureDifficulty, momentum } = data ?? {};
  const formResults = (form ?? []).map((f: any) => f.result).reverse();

  const cleanSheets10 = (form ?? []).slice(0, 10).filter((f: any) => f.goals_against === 0).length;
  const goalsScored10 = (form ?? []).slice(0, 10).reduce((s: number, f: any) => s + (f.goals_for ?? 0), 0);
  const goalsConceded10 = (form ?? []).slice(0, 10).reduce((s: number, f: any) => s + (f.goals_against ?? 0), 0);

  // Readiness component breakdown — same weighting spec as Match Detail
  const components = [
    { label: 'Form', weight: 30, value: intel?.form_index },
    { label: 'Congestion', weight: 15, value: intel?.congestion_score != null ? 100 - intel.congestion_score : null },
    { label: 'Travel Impact', weight: 15, value: intel?.travel_fatigue_score != null ? 100 - intel.travel_fatigue_score : null },
    { label: 'Squad Stability', weight: 5, value: intel?.squad_stability_score },
    { label: 'Injury Burden', weight: 5, value: intel?.injury_burden_score != null ? 100 - intel.injury_burden_score : null },
    { label: 'Squad Depth', weight: 5, value: intel?.squad_depth_score },
    { label: 'Rest Days', weight: 5, value: intel?.rest_days_avg != null ? Math.min(100, Math.round((intel.rest_days_avg / 7) * 100)) : null },
  ];

  const squadTotal = (positionBreakdown ?? []).reduce((s: number, p: any) => s + (p.player_count ?? 0), 0);
  const positionSegments = ['GK', 'DEF', 'MID', 'FWD'].map(code => {
    const row = (positionBreakdown ?? []).find((p: any) => p.position_code === code);
    return { label: POSITION_LABELS[code], count: row?.player_count ?? 0, color: POSITION_COLORS[code] };
  }).filter(s => s.count > 0);

  const trendData = (trend ?? []).map((t: any) => ({
    date: new Date(t.snapshot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    readiness: t.readiness_score,
    form: t.form_index,
  }));

  const nextMatchIntel = nextMatch?.match_intelligence?.[0];
  const isHome = nextMatch?.home_team_id === parseInt(id);
  const opponent = isHome ? nextMatch?.away_team : nextMatch?.home_team;
  const ownReadiness = isHome ? nextMatchIntel?.home_readiness : nextMatchIntel?.away_readiness;
  const oppReadiness = isHome ? nextMatchIntel?.away_readiness : nextMatchIntel?.home_readiness;

  return (
    <main style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 56, height: 56, background: COLORS.green + '20', border: `2px solid ${COLORS.green}40`, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: 16, fontWeight: 'bold', color: COLORS.green, flexShrink: 0 }}>
          {team.short_name?.slice(0, 3) ?? team.name?.slice(0, 3)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text }}>{team.name}</div>
          <div style={{ display: 'flex', gap: 7, marginTop: 5, flexWrap: 'wrap' }}>
            {[
              { val: team.country, col: COLORS.blue },
              { val: intel?.active_competitions ? `${intel.active_competitions} active comps` : null, col: COLORS.amber },
              { val: squad?.players_count ? `${squad.players_count} players` : null, col: COLORS.muted },
              { val: squad?.avg_age ? `Avg age ${Number(squad.avg_age).toFixed(1)}` : null, col: COLORS.muted },
            ].filter(t => t.val).map((t, i) => (
              <span key={i} style={{ background: t.col + '20', color: t.col, border: `1px solid ${t.col}40`, borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t.val}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── ROW 1: Team Readiness | Key Intelligence | Squad Overview ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        {/* Team Readiness gauge + component breakdown */}
        <Card>
          <SectionTitle>Team Readiness</SectionTitle>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <ReadinessGauge score={intel?.readiness_score ?? null} label="READINESS" size={110} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {components.map(c => (
              <div key={c.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                  <span style={{ color: COLORS.muted }}>{c.label} <span style={{ color: COLORS.dim }}>({c.weight}%)</span></span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', color: scoreColor(c.value ?? null), fontWeight: 700 }}>{c.value != null ? Math.round(c.value) : '—'}</span>
                </div>
                <div style={{ height: 3, background: COLORS.border, borderRadius: 2 }}>
                  <div style={{ width: `${c.value ?? 0}%`, height: '100%', background: scoreColor(c.value ?? null), borderRadius: 2 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Key Intelligence sidebar */}
        <Card>
          <SectionTitle>Key Intelligence</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { icon: '📈', label: 'Form Index', val: intel?.form_index, color: scoreColor(intel?.form_index) },
              { icon: '🛡', label: 'Squad Stability', val: intel?.squad_stability_score, color: scoreColor(intel?.squad_stability_score) },
              { icon: '🔁', label: 'Rotation Pressure', val: intel?.rotation_pressure_index, color: scoreColor(intel?.rotation_pressure_index) },
              { icon: '🏆', label: 'Active Competitions', val: intel?.active_competitions, color: COLORS.text, raw: true },
              { icon: '🛌', label: 'Rest Days (Avg)', val: intel?.rest_days_avg?.toFixed(1), color: COLORS.text, raw: true },
              { icon: '✈', label: 'Travel Load (14d)', val: travel?.km_last_14_days ? `${Math.round(travel.km_last_14_days)} km` : null, color: COLORS.text, raw: true },
              { icon: '📅', label: 'Congestion Score', val: intel?.congestion_score, color: intel?.congestion_score != null ? (intel.congestion_score > 60 ? COLORS.red : intel.congestion_score > 40 ? COLORS.amber : COLORS.green) : COLORS.dim },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13 }}>{row.icon}</span>
                <span style={{ fontSize: 11, color: COLORS.muted, flex: 1 }}>{row.label}</span>
                <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 13, fontWeight: 700, color: row.color }}>
                  {row.val != null ? (row.raw ? row.val : Math.round(row.val)) : '—'}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Squad Overview */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <SectionTitle>Squad Overview</SectionTitle>
          </div>
          {squad ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                {[
                  ['Players', squad.players_count],
                  ['Avg Age', squad.avg_age?.toFixed(1)],
                  ['Foreign', `${squad.foreign_player_pct ?? 0}%`],
                  ['Squad Value', squad.average_market_value ? `€${(squad.average_market_value * (squad.players_count ?? 1) / 1_000_000).toFixed(1)}M` : '—'],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ background: COLORS.surface2, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>{k}</div>
                    <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 15, fontWeight: 700, color: COLORS.text }}>{v ?? '—'}</div>
                  </div>
                ))}
              </div>
              {positionSegments.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Donut centerValue={squadTotal} centerLabel="Squad" segments={positionSegments} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {positionSegments.map(s => (
                      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10 }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: s.color }} />
                        <span style={{ color: COLORS.muted }}>{s.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <div style={{ fontSize: 11, color: COLORS.dim }}>Position breakdown pending squad sync</div>}
            </>
          ) : <div style={{ fontSize: 11, color: COLORS.dim, padding: '20px 0', textAlign: 'center' }}>🔒 Squad data pending — run sync:squads:v2</div>}
        </Card>
      </div>

      {/* ── ROW 2: Trend | Next Match | Fixture Congestion ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 14 }}>
        <Card>
          <SectionTitle>Trend (Last 14 Days)</SectionTitle>
          {trendData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                <XAxis dataKey="date" tick={{ fill: COLORS.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: COLORS.muted, fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={{ background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="readiness" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} name="Readiness" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '30px 10px', textAlign: 'center', fontSize: 11, color: COLORS.dim }}>
              Not enough history yet — trend builds up as process:team-intelligence runs daily (migration 010).
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Next Match</SectionTitle>
          {nextMatch ? (
            <Link href={matchUrl(nextMatch)} style={{ textDecoration: 'none' }}>
              <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 8 }}>{nextMatch.competition}</div>
              <div style={{ fontSize: 11, color: COLORS.dim, marginBottom: 10 }}>
                {new Date(nextMatch.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(nextMatch.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{team.short_name ?? team.name}</div>
                <div style={{ fontSize: 10, color: COLORS.dim }}>VS</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{opponent?.short_name ?? opponent?.name ?? '?'}</div>
              </div>
              {ownReadiness != null && oppReadiness != null && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', marginBottom: 4 }}>Readiness Gap</div>
                  <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 18, fontWeight: 700, color: scoreColor(Math.abs(ownReadiness - oppReadiness) * 2) }}>
                    {Math.round(Math.abs(ownReadiness - oppReadiness))}
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.dim }}>{ownReadiness > oppReadiness ? `${team.short_name ?? team.name} advantage` : `${opponent?.short_name ?? 'Opponent'} advantage`}</div>
                </div>
              )}
            </Link>
          ) : <div style={{ fontSize: 11, color: COLORS.dim, padding: '20px 0', textAlign: 'center' }}>No upcoming match scheduled</div>}
        </Card>

        <Card>
          <SectionTitle>Fixture Congestion <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'none' }}>(14d)</span></SectionTitle>
          {fix ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Total Matches', fix.matches_next_14_days],
                ['Avg Rest Days', fix.avg_rest_days?.toFixed(1)],
                ['Congestion Score', fix.congestion_score != null ? Math.round(fix.congestion_score) : null],
              ].map(([k, v]) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: COLORS.muted }}>{k}</span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: COLORS.text }}>{v ?? '—'}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 11, color: COLORS.dim }}>Run process:fixture-load</div>}
        </Card>
      </div>

      {/* ── ROW 2.5: Fixture Difficulty | Momentum — both fully derivable
          from data already synced (team_strength_ratings, team_form_history),
          nothing computed either before processFixtureDifficulty/
          processTeamMomentum were added ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <SectionTitle>Fixture Difficulty <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'none' }}>(opponent strength)</span></SectionTitle>
          {fixtureDifficulty ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Next 5 Matches', fixtureDifficulty.next_5_difficulty != null ? Math.round(fixtureDifficulty.next_5_difficulty) : null, fixtureDifficulty.next_5_matches],
                ['Next 10 Matches', fixtureDifficulty.next_10_difficulty != null ? Math.round(fixtureDifficulty.next_10_difficulty) : null, fixtureDifficulty.next_10_matches],
              ].map(([label, value, count]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: COLORS.muted }}>{label} {count != null && count !== undefined ? `(${count} scheduled)` : ''}</span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: value != null ? scoreColor(100 - (value as number)) : COLORS.dim }}>
                    {value ?? '—'}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 9, color: COLORS.dim, marginTop: 2 }}>Higher = tougher run of fixtures (avg opponent strength_score)</div>
            </div>
          ) : <div style={{ fontSize: 11, color: COLORS.dim }}>Run process:fixture-difficulty</div>}
        </Card>

        <Card>
          <SectionTitle>Momentum <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'none' }}>(recent vs prior form)</span></SectionTitle>
          {momentum ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: COLORS.muted, fontSize: 12 }}>Momentum Score</span>
                <span style={{
                  fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 16,
                  color: (momentum.momentum_score ?? 0) > 0 ? COLORS.green : (momentum.momentum_score ?? 0) < 0 ? COLORS.red : COLORS.dim,
                }}>
                  {momentum.momentum_score != null ? (momentum.momentum_score > 0 ? '+' : '') + Math.round(momentum.momentum_score) : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: COLORS.muted }}>Last 5 vs Prior 5</span>
                <span style={{ fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>
                  {momentum.last_5_points ?? '—'}pts vs {momentum.prior_5_points ?? '—'}pts
                </span>
              </div>
              {momentum.trend && (
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                  color: momentum.trend === 'rising' ? COLORS.green : momentum.trend === 'declining' ? COLORS.red : COLORS.muted,
                }}>
                  {momentum.trend === 'rising' ? '↗ Rising' : momentum.trend === 'declining' ? '↘ Declining' : '→ Stable'}
                </div>
              )}
            </div>
          ) : <div style={{ fontSize: 11, color: COLORS.dim }}>Run process:momentum</div>}
        </Card>
      </div>

      {/* ── ROW 3: Key Players | Recent Form | Travel Analysis ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 14 }}>
        <Card>
  <SectionTitle>Key Players</SectionTitle>
  {(keyPlayers ?? []).length > 0 ? (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
          {['PLAYER', 'POS', 'RATING', 'CONFIDENCE', 'STATUS'].map(h => (
            <th key={h} style={{ 
              padding: '4px 6px', 
              textAlign: h === 'PLAYER' ? 'left' : 'center', 
              fontSize: 9, 
              color: COLORS.dim, 
              textTransform: 'uppercase' 
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {keyPlayers.map((p: any) => {
          const isInjured = p.current_injury || p.injury_status === 'out';
          const confidence = p.confidence !== null ? Math.round(p.confidence * 100) : null;
          
          return (
            <tr key={p.id} style={{ 
              borderBottom: `1px solid ${COLORS.border}`,
              opacity: isInjured ? 0.6 : 1,
            }}>
              <td style={{ padding: '6px', color: COLORS.text, fontWeight: 600 }}>
                {p.short_name ?? p.name}
                {p.goals > 0 && (
                  <span style={{ 
                    marginLeft: 4, 
                    fontSize: 9, 
                    color: COLORS.green,
                    fontWeight: 700 
                  }}>
                    ⚽{p.goals}
                  </span>
                )}
                {p.assists > 0 && (
                  <span style={{ 
                    marginLeft: 2, 
                    fontSize: 9, 
                    color: COLORS.blue,
                    fontWeight: 700 
                  }}>
                    🅰{p.assists}
                  </span>
                )}
              </td>
              <td style={{ padding: '6px', textAlign: 'center', color: COLORS.muted }}>
                {p.primary_position ?? p.position ?? '—'}
              </td>
              <td style={{ 
                padding: '6px', 
                textAlign: 'center',
                fontFamily: '"JetBrains Mono",monospace',
                fontWeight: 700,
                color: p.avg_rating !== null ? scoreColor((p.avg_rating / 10) * 100) : COLORS.dim,
              }}>
                {p.avg_rating !== null ? p.avg_rating.toFixed(2) : '—'}
              </td>
              <td style={{ 
                padding: '6px', 
                textAlign: 'center',
                fontFamily: '"JetBrains Mono",monospace',
                fontWeight: 700,
                color: confidence !== null ? scoreColor(confidence) : COLORS.dim,
              }}>
                {confidence !== null ? `${confidence}%` : '—'}
              </td>
              <td style={{ padding: '6px', textAlign: 'center' }}>
                {isInjured ? (
                  <span style={{
                    background: COLORS.red + '20',
                    color: COLORS.red,
                    fontSize: 8,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 4,
                    border: `1px solid ${COLORS.red}40`,
                  }}>
                    {p.injury_status?.toUpperCase() || 'OUT'}
                  </span>
                ) : (
                  <span style={{
                    background: COLORS.green + '20',
                    color: COLORS.green,
                    fontSize: 8,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 4,
                    border: `1px solid ${COLORS.green}40`,
                  }}>
                    FIT
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ) : (
    <div style={{ fontSize: 11, color: COLORS.dim, padding: '20px 0', textAlign: 'center' }}>
      <div>🔒 Player data pending</div>
      <div style={{ fontSize: 10, marginTop: 4, color: COLORS.muted }}>
        Run process:player-intelligence after squads sync
      </div>
    </div>
  )}
</Card>

        <Card>
          <SectionTitle>Recent Form</SectionTitle>
          <FormString results={formResults.slice(-10)} count={10} />
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            <div><div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Last 5 Pts</div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{intel?.last_5_points ?? '—'}/15</div></div>
            <div><div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Goals (10)</div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{goalsScored10}</div></div>
            <div><div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Conceded</div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{goalsConceded10}</div></div>
            <div><div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase' }}>Clean Sheets</div><div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{cleanSheets10}/10</div></div>
          </div>
        </Card>

        <Card>
          <SectionTitle>Travel Analysis <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'none' }}>(14d)</span></SectionTitle>
          {travel ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                ['Total Distance', travel.km_last_14_days ? `${Math.round(travel.km_last_14_days).toLocaleString()} km` : '—'],
                ['Away Matches', travel.away_matches_last_14_days ?? '—'],
                ['Avg Trip', travel.avg_trip_distance_km ? `${Math.round(travel.avg_trip_distance_km)} km` : '—'],
              ].map(([k, v]) => (
                <div key={k as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: COLORS.muted }}>{k}</span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: COLORS.text }}>{v}</span>
                </div>
              ))}
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', marginBottom: 4 }}>Travel Fatigue Score</div>
                <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 700, color: scoreColor(travel.travel_fatigue_score != null ? 100 - travel.travel_fatigue_score : null) }}>
                  {travel.travel_fatigue_score != null ? Math.round(travel.travel_fatigue_score) : '—'}
                </div>
              </div>
            </div>
          ) : <div style={{ fontSize: 11, color: COLORS.dim }}>Run process:travel-load</div>}
        </Card>
      </div>

      {/* ── UPCOMING FIXTURES (full width) ── */}
      {(upcoming ?? []).length > 0 && (
        <Card>
          <SectionTitle>Upcoming Fixtures</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {upcoming.slice(0, 7).map((u: any, i: number) => {
              const opp = u.home_team?.id === parseInt(id) ? u.away_team?.name : u.home_team?.name;
              const ha = u.home_team?.id === parseInt(id) ? 'H' : 'A';
              const dt = new Date(u.date);
              return (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: i < upcoming.length - 1 ? `1px solid ${COLORS.border}` : 'none', fontSize: 12 }}>
                  <div style={{ color: COLORS.dim, minWidth: 60 }}>{dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                  <div style={{ flex: 1, color: COLORS.muted, fontSize: 11 }}>{u.competition}</div>
                  <div style={{ color: COLORS.text, fontWeight: 600 }}>{opp}</div>
                  <div style={{ fontFamily: 'monospace', color: ha === 'H' ? COLORS.green : COLORS.amber, fontWeight: 700, minWidth: 16, textAlign: 'center' }}>{ha}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </main>
  );
}
