'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { getTeamIntelligenceList, TeamIntelRow } from '@/lib/queries';
import { COLORS, scoreColor } from '@/design/tokens';
import { teamUrl } from '@/lib/urls';

import { loadWatchlist, saveWatchlist } from '@/lib/watchlist';

function Donut({ segments, centerValue, centerLabel }: {
  segments: { label: string; count: number; color: string }[];
  centerValue: string | number; centerLabel: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.count, 0) || 1;
  let cumulative = 0;
  const r = 42, cx = 50, cy = 50;
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
        <svg width={90} height={90} viewBox="0 0 100 100">
          {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity={0.85} />)}
          <circle cx={50} cy={50} r={26} fill={COLORS.surface} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 16, fontWeight: 700, color: COLORS.text }}>{centerValue}</div>
          <div style={{ fontSize: 7, color: COLORS.dim, textTransform: 'uppercase' }}>{centerLabel}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: COLORS.muted }}>{seg.label}</span>
            <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{seg.count} ({Math.round((seg.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const FORM_COLOR: Record<'W' | 'D' | 'L', string> = { W: COLORS.green, D: COLORS.amber, L: COLORS.red };

export default function TeamsPage() {
  const [teams, setTeams] = useState<TeamIntelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'watchlist'>('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setWatchlist(loadWatchlist());
    getTeamIntelligenceList(10000).then(setTeams).finally(() => setLoading(false));
  }, []);

  const toggleWatch = (id: number) => {
    setWatchlist(prev => {
      const next = new Set<number>(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveWatchlist(next);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let rows = teams;
    if (filter === 'watchlist') rows = rows.filter(t => watchlist.has(t.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(t => t.name.toLowerCase().includes(q) || t.league?.toLowerCase().includes(q));
    }
    if (quickFilter === 'elite') rows = rows.filter(t => (t.readiness_score ?? 0) >= 75);
    if (quickFilter === 'form') rows = rows.filter(t => (t.form_index ?? 0) >= 70);
    if (quickFilter === 'lowcong') rows = rows.filter(t => (t.congestion_score ?? 100) < 40);
    if (quickFilter === 'rested') rows = rows.filter(t => (t.rest_days_avg ?? 0) >= 5);
    if (quickFilter === 'lowtravel') rows = rows.filter(t => (t.travel_14d ?? 999) < 150);
    if (quickFilter === 'multicomp') rows = rows.filter(t => (t.active_competitions ?? 0) >= 2);
    return rows;
  }, [teams, filter, watchlist, search, quickFilter]);

  const buckets = { Elite: 0, High: 0, Moderate: 0, Low: 0, Critical: 0 };
  for (const t of teams) {
    const v = t.readiness_score ?? 0;
    if (v >= 75) buckets.Elite++;
    else if (v >= 60) buckets.High++;
    else if (v >= 40) buckets.Moderate++;
    else if (v >= 25) buckets.Low++;
    else buckets.Critical++;
  }

  const top5 = teams.slice(0, 5);
  const highestTeam = teams[0];
  const eliteCount = buckets.Elite;
  const highestTravel = [...teams].filter(t => t.travel_14d != null).sort((a, b) => (b.travel_14d ?? 0) - (a.travel_14d ?? 0))[0];
  const multiCompCount = teams.filter(t => (t.active_competitions ?? 0) >= 2).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Team Intelligence</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Browse and compare teams with readiness intelligence</div>
      </div>

      {/* Tabs + search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: 'All Teams' },
          { key: 'watchlist', label: `⭐ Watchlist (${watchlist.size})` },
        ].map(t => (
          <button key={t.key} onClick={() => setFilter(t.key as any)} style={{
            padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: filter === t.key ? COLORS.purple : COLORS.surface2,
            color: filter === t.key ? '#fff' : COLORS.muted,
            border: `1px solid ${filter === t.key ? COLORS.purple : COLORS.border}`,
          }}>{t.label}</button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search teams or leagues..."
          style={{ marginLeft: 'auto', background: COLORS.surface2, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, color: COLORS.text, minWidth: 220 }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2.6fr 1fr', gap: 14 }}>
        {/* Main table */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: COLORS.surface2 }}>
                {['#', 'TEAM', 'LEAGUE', 'POS', 'READINESS', 'FORM (5)', 'REST', 'TRAVEL(14D)', 'CONGESTION', 'COMP', 'TREND(7D)', ''].map(h => (
                  <th key={h} style={{ padding: '9px 10px', textAlign: h === 'TEAM' || h === 'LEAGUE' ? 'left' : 'center', fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((t, i) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '9px 10px', color: COLORS.dim, fontFamily: '"JetBrains Mono",monospace' }}>{i + 1}</td>
                  <td style={{ padding: '9px 10px' }}>
                    <Link href={teamUrl(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                      <div style={{ width: 20, height: 20, background: COLORS.surface2, borderRadius: 5, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7, fontWeight: 700, flexShrink: 0, color: COLORS.text }}>
                        {t.short_name?.slice(0, 3) ?? t.name.slice(0, 3)}
                      </div>
                      <span style={{ color: COLORS.text, fontWeight: 600 }}>{t.name}</span>
                    </Link>
                  </td>
                  <td style={{ padding: '9px 10px', color: COLORS.muted, fontSize: 11 }}>{t.league ?? '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: COLORS.muted, fontFamily: '"JetBrains Mono",monospace' }}>{t.position ?? '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, fontSize: 14, color: scoreColor(t.readiness_score) }}>{t.readiness_score != null ? Math.round(t.readiness_score) : '—'}</span>
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      {t.form_pills.length > 0 ? t.form_pills.map((r: 'W' | 'D' | 'L', j: number) => (
                        <span key={j} style={{ width: 16, height: 16, borderRadius: 3, background: FORM_COLOR[r] + '30', color: FORM_COLOR[r], border: `1px solid ${FORM_COLOR[r]}50`, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r}</span>
                      )) : <span style={{ color: COLORS.dim, fontSize: 10 }}>—</span>}
                    </div>
                  </td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{t.rest_days_avg != null ? t.rest_days_avg.toFixed(1) : '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: t.travel_14d != null && t.travel_14d > 300 ? COLORS.red : COLORS.muted }}>{t.travel_14d != null ? `${Math.round(t.travel_14d)}km` : '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: t.congestion_score != null ? (t.congestion_score > 60 ? COLORS.red : t.congestion_score > 40 ? COLORS.amber : COLORS.green) : COLORS.dim }}>{t.congestion_score != null ? Math.round(t.congestion_score) : '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', color: COLORS.muted, fontFamily: '"JetBrains Mono",monospace' }}>{t.active_competitions ?? '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', fontSize: 11 }}>
                    {t.trend_7d != null ? (
                      <span style={{ color: t.trend_7d >= 0 ? COLORS.green : COLORS.red }}>{t.trend_7d >= 0 ? '▲' : '▼'} {Math.abs(t.trend_7d).toFixed(1)}</span>
                    ) : <span style={{ color: COLORS.dim }}>—</span>}
                  </td>
                  <td style={{ padding: '9px 6px', textAlign: 'center' }}>
                    <button onClick={() => toggleWatch(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: watchlist.has(t.id) ? COLORS.amber : COLORS.dim }}>★</button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={12} style={{ padding: 32, textAlign: 'center', color: COLORS.dim }}>
                  {filter === 'watchlist' ? 'No teams in your watchlist yet — click the star on any team to add it' : 'No teams match these filters'}
                </td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <div style={{ padding: '10px 16px', textAlign: 'center', borderTop: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.dim }}>
              Showing 50 of {filtered.length} teams
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Top Readiness</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {top5.map((t, i) => (
                <Link key={t.id} href={teamUrl(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                  <span style={{ fontSize: 10, color: COLORS.dim, width: 12 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: COLORS.text, fontWeight: 600, flex: 1 }}>{t.name}</span>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 13, fontWeight: 700, color: scoreColor(t.readiness_score) }}>{Math.round(t.readiness_score ?? 0)}</span>
                </Link>
              ))}
            </div>
          </div>

          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Readiness Distribution</div>
            <Donut centerValue={teams.length} centerLabel="Teams" segments={[
              { label: 'Elite (75-100)', count: buckets.Elite, color: COLORS.green },
              { label: 'High (60-74)', count: buckets.High, color: COLORS.greenDim },
              { label: 'Moderate (40-59)', count: buckets.Moderate, color: COLORS.amber },
              { label: 'Low (25-39)', count: buckets.Low, color: COLORS.orange },
              { label: 'Critical (0-24)', count: buckets.Critical, color: COLORS.red },
            ]} />
          </div>

          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Insights</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11 }}>
              {highestTeam && <div style={{ display: 'flex', gap: 6 }}><span>📈</span><span style={{ color: COLORS.text2 }}><strong>{highestTeam.name}</strong> have the highest readiness ({Math.round(highestTeam.readiness_score ?? 0)}).</span></div>}
              {eliteCount > 0 && <div style={{ display: 'flex', gap: 6 }}><span>🎯</span><span style={{ color: COLORS.text2 }}>{eliteCount} teams have elite readiness (75+).</span></div>}
              {highestTravel && <div style={{ display: 'flex', gap: 6 }}><span>✈</span><span style={{ color: COLORS.text2 }}><strong>{highestTravel.name}</strong> have the highest travel load ({Math.round(highestTravel.travel_14d ?? 0)}km).</span></div>}
              {multiCompCount > 0 && <div style={{ display: 'flex', gap: 6 }}><span>🏆</span><span style={{ color: COLORS.text2 }}>{multiCompCount} teams are playing in 2+ competitions.</span></div>}
            </div>
          </div>

          <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Quick Filters</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[
                { key: 'elite', label: 'Elite Teams (75+)' },
                { key: 'form', label: 'High Form Teams' },
                { key: 'lowcong', label: 'Low Congestion (<40)' },
                { key: 'rested', label: 'Well Rested (5+ days)' },
                { key: 'lowtravel', label: 'Low Travel Load (<150km)' },
                { key: 'multicomp', label: 'Multi Competition (2+)' },
              ].map(f => (
                <button key={f.key} onClick={() => setQuickFilter(quickFilter === f.key ? null : f.key)} style={{
                  fontSize: 10, padding: '5px 10px', borderRadius: 6,
                  background: quickFilter === f.key ? COLORS.purple + '30' : COLORS.surface2,
                  color: quickFilter === f.key ? COLORS.purple : COLORS.muted,
                  border: `1px solid ${quickFilter === f.key ? COLORS.purple : COLORS.border}`,
                }}>{f.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
