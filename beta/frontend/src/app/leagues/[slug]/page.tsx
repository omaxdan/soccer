import { getLeagueDetail } from '@/lib/queries';
import { parseIdFromSlug, teamUrl } from '@/lib/urls';
import { COLORS, scoreColor } from '@/design/tokens';
import Link from 'next/link';
import TeamCrest from '@/components/TeamCrest';
import { getCrestUrl } from '@/lib/images';

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseIdFromSlug(slug);
  if (!id) return { title: 'League' };
  const { tournament } = await getLeagueDetail(id);
  return { title: tournament ? `${tournament.name}` : 'League' };
}

function KpiCard({ icon, value, label, color }: { icon: string; value: string | number; label: string; color?: string }) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 16 }}>{icon}</div>
      <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 22, fontWeight: 700, color: color ?? COLORS.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.muted, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

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
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
        <svg width={100} height={100} viewBox="0 0 100 100">
          {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity={0.85} />)}
          <circle cx={50} cy={50} r={26} fill={COLORS.surface} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 20, fontWeight: 700, color: COLORS.text }}>{centerValue}</div>
          <div style={{ fontSize: 8, color: COLORS.dim, textTransform: 'uppercase' }}>{centerLabel}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: COLORS.muted }}>{seg.label}</span>
            <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{seg.count} ({Math.round((seg.count / (segments.reduce((s, x) => s + x.count, 0) || 1)) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function LeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseIdFromSlug(slug);

  if (!id) {
    return <div style={{ padding: 40, textAlign: 'center', color: COLORS.dim }}>League not found.</div>;
  }

  const { tournament, teams, seasonStats, fixtureCongestion } = await getLeagueDetail(id);

  const withReadiness = teams.filter(t => t.readiness_score != null);
  const avgReadiness = withReadiness.length > 0 ? Math.round(withReadiness.reduce((s, t) => s + (t.readiness_score ?? 0), 0) / withReadiness.length) : null;
  const avgForm = withReadiness.length > 0 ? Math.round(teams.filter(t => t.form_index != null).reduce((s, t) => s + (t.form_index ?? 0), 0) / (teams.filter(t => t.form_index != null).length || 1)) : null;
  const avgRest = teams.filter(t => t.rest_days_avg != null).length > 0
    ? Math.round((teams.reduce((s, t) => s + (t.rest_days_avg ?? 0), 0) / teams.filter(t => t.rest_days_avg != null).length) * 10) / 10 : null;
  const avgCongestion = teams.filter(t => t.congestion_score != null).length > 0
    ? Math.round(teams.reduce((s, t) => s + (t.congestion_score ?? 0), 0) / teams.filter(t => t.congestion_score != null).length) : null;

  // Readiness distribution buckets
  const buckets = { High: 0, Good: 0, Average: 0, Low: 0, Poor: 0 };
  for (const t of withReadiness) {
    const v = t.readiness_score ?? 0;
    if (v >= 75) buckets.High++;
    else if (v >= 60) buckets.Good++;
    else if (v >= 40) buckets.Average++;
    else if (v >= 25) buckets.Low++;
    else buckets.Poor++;
  }

  const highestReadiness = withReadiness[0];
  const lowestReadiness = withReadiness[withReadiness.length - 1];
  const bestForm = [...teams].filter(t => t.form_index != null).sort((a, b) => (b.form_index ?? 0) - (a.form_index ?? 0))[0];
  const mostRest = [...teams].filter(t => t.rest_days_avg != null).sort((a, b) => (b.rest_days_avg ?? 0) - (a.rest_days_avg ?? 0))[0];
  const leastCongested = [...teams].filter(t => t.congestion_score != null).sort((a, b) => (a.congestion_score ?? 0) - (b.congestion_score ?? 0))[0];

  if (!tournament) {
    return <div style={{ padding: 40, textAlign: 'center', color: COLORS.dim }}>League not found.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link href="/leagues" style={{ color: COLORS.muted, fontSize: 12, textDecoration: 'none' }}>← Leagues</Link>
        <span style={{ color: COLORS.dim }}>›</span>
        <span style={{ fontSize: 12, color: COLORS.text }}>{tournament.name}</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {getCrestUrl(tournament.logo_storage_path) && (
          <img src={getCrestUrl(tournament.logo_storage_path)!} alt={tournament.name} width={40} height={40} style={{ objectFit: 'contain', borderRadius: 8, flexShrink: 0 }} />
        )}
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text }}>{tournament.name}</div>
          <div style={{ fontSize: 12, color: COLORS.dim, marginTop: 3 }}>{tournament.category ?? '—'} · {teams.length} teams tracked</div>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <KpiCard icon="💓" value={avgReadiness ?? '—'} label="Avg Readiness" color={scoreColor(avgReadiness)} />
        <KpiCard icon="📈" value={avgForm ?? '—'} label="Avg Form Index" color={scoreColor(avgForm)} />
        <KpiCard icon="🛌" value={avgRest ?? '—'} label="Avg Rest Days" />
        <KpiCard icon="📅" value={avgCongestion ?? '—'} label="Avg Congestion" color={avgCongestion != null ? (avgCongestion > 60 ? COLORS.red : avgCongestion > 40 ? COLORS.amber : COLORS.green) : undefined} />
        <KpiCard icon="⚽" value={seasonStats.avgGoalsPerMatch ?? '—'} label="Goals / Match" />
        <KpiCard icon="🧤" value={seasonStats.avgCleanSheetsPerMatch ?? '—'} label="Clean Sheets / Match" />
      </div>

      {/* Unified League Dashboard — standings + readiness intelligence */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>League Dashboard — Standings × Readiness</span>
          <span style={{ fontSize: 10, color: COLORS.dim }}>{teams.length} teams · sorted by readiness score</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 980 }}>
            <thead>
              <tr style={{ background: COLORS.surface2 }}>
                {['POS', 'TEAM', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'PTS', 'READY', 'FORM', 'CONG', 'TRAVEL', 'FATIGUE', 'STAB', 'ROT'].map((h, idx) => (
                  <th key={h} style={{ padding: '8px 8px', textAlign: h === 'TEAM' ? 'left' : 'center', fontSize: 9.5, color: idx >= 10 ? COLORS.blue : COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap', borderLeft: idx === 10 ? `1px solid ${COLORS.border}` : undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const num = (v: number | null | undefined) => (v != null ? v : '—');
                const mono: React.CSSProperties = { fontFamily: '"JetBrains Mono",monospace' };
                return (
                  <tr key={t.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.dim, ...mono }}>{num(t.position)}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <Link href={teamUrl(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                        <TeamCrest team={t} size={20} borderRadius={5} />
                        <span style={{ color: COLORS.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{t.short_name ?? t.name}</span>
                      </Link>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.played)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.wins)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.draws)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.losses)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.goals_for)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.muted, ...mono }}>{num(t.goals_against)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: t.goal_diff != null ? (t.goal_diff > 0 ? COLORS.green : t.goal_diff < 0 ? COLORS.red : COLORS.muted) : COLORS.dim, ...mono }}>{t.goal_diff != null ? (t.goal_diff > 0 ? `+${t.goal_diff}` : t.goal_diff) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: COLORS.text, fontWeight: 700, ...mono }}>{num(t.points)}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, color: scoreColor(t.readiness_score), borderLeft: `1px solid ${COLORS.border}`, ...mono }}>{t.readiness_score != null ? Math.round(t.readiness_score) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: scoreColor(t.form_index), ...mono }}>{t.form_index != null ? Math.round(t.form_index) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: t.congestion_score != null ? (t.congestion_score > 60 ? COLORS.red : t.congestion_score > 40 ? COLORS.amber : COLORS.green) : COLORS.dim, ...mono }}>{t.congestion_score != null ? Math.round(t.congestion_score) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: t.travel_fatigue_score != null ? (t.travel_fatigue_score > 60 ? COLORS.red : t.travel_fatigue_score > 40 ? COLORS.amber : COLORS.green) : COLORS.dim, ...mono }}>{t.travel_fatigue_score != null ? Math.round(t.travel_fatigue_score) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: t.fatigue_index != null ? scoreColor(100 - t.fatigue_index) : COLORS.dim, ...mono }}>{t.fatigue_index != null ? Math.round(t.fatigue_index) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: scoreColor(t.squad_stability_score), ...mono }}>{t.squad_stability_score != null ? Math.round(t.squad_stability_score) : '—'}</td>
                    <td style={{ padding: '7px 8px', textAlign: 'center', color: t.rotation_pressure_index != null ? scoreColor(100 - t.rotation_pressure_index) : COLORS.dim, ...mono }}>{t.rotation_pressure_index != null ? Math.round(t.rotation_pressure_index) : '—'}</td>
                  </tr>
                );
              })}
              {teams.length === 0 && (
                <tr><td colSpan={17} style={{ padding: 32, textAlign: 'center', color: COLORS.dim }}>No standings synced for this league yet — run sync:standings</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Readiness Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Readiness Distribution</div>
          <Donut
            centerValue={teams.length} centerLabel="Teams"
            segments={[
              { label: 'High (75-100)', count: buckets.High, color: COLORS.green },
              { label: 'Good (60-74)', count: buckets.Good, color: COLORS.greenDim },
              { label: 'Average (40-59)', count: buckets.Average, color: COLORS.amber },
              { label: 'Low (25-39)', count: buckets.Low, color: COLORS.orange },
              { label: 'Poor (0-24)', count: buckets.Poor, color: COLORS.red },
            ]}
          />
          {highestReadiness && lowestReadiness && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}`, fontSize: 10 }}>
              <div>
                <div style={{ color: COLORS.dim, marginBottom: 2 }}>HIGHEST READINESS</div>
                <div style={{ color: COLORS.text, fontWeight: 600 }}>{highestReadiness.name}</div>
                <div style={{ color: COLORS.green, fontFamily: '"JetBrains Mono",monospace' }}>{Math.round(highestReadiness.readiness_score ?? 0)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: COLORS.dim, marginBottom: 2 }}>LOWEST READINESS</div>
                <div style={{ color: COLORS.text, fontWeight: 600 }}>{lowestReadiness.name}</div>
                <div style={{ color: COLORS.red, fontFamily: '"JetBrains Mono",monospace' }}>{Math.round(lowestReadiness.readiness_score ?? 0)}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Key League Stats + Upcoming Fixture Congestion + Top 3 by Category */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Key League Stats</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { label: 'Goals (Per Match)', value: seasonStats.avgGoalsPerMatch },
              { label: 'Clean Sheets (Per Match)', value: seasonStats.avgCleanSheetsPerMatch },
              { label: 'Red Cards (Per Match)', value: seasonStats.avgRedCardsPerMatch },
              { label: 'Home Win %', value: seasonStats.homeWinPct != null ? `${Math.round(seasonStats.homeWinPct)}%` : null },
              { label: 'Away Win %', value: seasonStats.awayWinPct != null ? `${Math.round(seasonStats.awayWinPct)}%` : null },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: COLORS.muted }}>{s.label}</span>
                <span style={{ fontFamily: '"JetBrains Mono",monospace', color: COLORS.text, fontWeight: 600 }}>{s.value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Upcoming Fixture Congestion <span style={{ color: COLORS.dim, fontWeight: 400, textTransform: 'none' }}>(14d)</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fixtureCongestion.map(f => {
              const max = Math.max(1, ...fixtureCongestion.map(x => x.matches_next_14_days ?? 0));
              const pct = ((f.matches_next_14_days ?? 0) / max) * 100;
              return (
                <div key={f.team_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                    <span style={{ color: COLORS.text }}>{f.name}</span>
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{f.matches_next_14_days} matches</span>
                  </div>
                  <div style={{ height: 4, background: COLORS.border, borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: COLORS.orange, borderRadius: 2 }} />
                  </div>
                </div>
              );
            })}
            {fixtureCongestion.length === 0 && <div style={{ fontSize: 11, color: COLORS.dim }}>No fixture load data yet</div>}
          </div>
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Top 3 By Category</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'BEST FORM', team: bestForm, value: bestForm?.form_index != null ? Math.round(bestForm.form_index) : null, color: COLORS.green },
              { label: 'MOST REST DAYS', team: mostRest, value: mostRest?.rest_days_avg != null ? mostRest.rest_days_avg.toFixed(1) : null, color: COLORS.blue },
              { label: 'LEAST CONGESTION', team: leastCongested, value: leastCongested?.congestion_score != null ? Math.round(leastCongested.congestion_score) : null, color: COLORS.purple },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 9, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
                {item.team ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: COLORS.text, fontWeight: 600 }}>{item.team.name}</span>
                    <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</span>
                  </div>
                ) : <span style={{ fontSize: 11, color: COLORS.dim }}>—</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Honest gap notice — Trend Over Time and Next 5 Matchdays from the
          mockup are not shown here. See backend/docs/SCHEMA_GAP_ANALYSIS.md:
          Trend needs team_intelligence_history to accumulate more than one
          day of data (migration 010 — just added, needs time to build up);
          Matchdays needs a matchweek/round column that doesn't exist in
          the matches table yet. */}
      <div style={{ fontSize: 10, color: COLORS.dim, padding: '4px 4px' }}>
        Trend charts will appear once team_intelligence_history has accumulated a few days of snapshots (migration 010).
      </div>
    </div>
  );
}
