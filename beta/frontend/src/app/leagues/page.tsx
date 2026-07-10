import { getLeagueReadinessRankings } from '@/lib/queries';
import { COLORS, scoreColor } from '@/design/tokens';
import Link from 'next/link';
import { leagueUrl } from '@/lib/urls';

export const metadata = { title: 'Leagues' };
export const revalidate = 3600;

function KpiCard({ icon, value, label, sub, color }: {
  icon: string; value: string | number; label: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 16 }}>{icon}</div>
      <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 24, fontWeight: 700, color: color ?? COLORS.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.muted, fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: COLORS.dim }}>{sub}</div>}
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
            <span style={{ marginLeft: 'auto', fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{seg.count} ({Math.round((seg.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function LeaguesPage() {
  const rows = await getLeagueReadinessRankings().catch(() => []);

  const withReadiness = rows.filter(r => r.avgReadiness != null);
  const totalTeams = rows.reduce((s, r) => s + r.teamCount, 0);
  const avgReadinessAll = withReadiness.length > 0
    ? Math.round((withReadiness.reduce((s, r) => s + (r.avgReadiness ?? 0), 0) / withReadiness.length) * 10) / 10
    : null;
  const avgRestAll = withReadiness.length > 0
    ? Math.round((withReadiness.reduce((s, r) => s + (r.avgRestDays ?? 0), 0) / withReadiness.length) * 10) / 10
    : null;
  const avgTravelAll = withReadiness.length > 0
    ? Math.round(withReadiness.reduce((s, r) => s + (r.avgTravel14d ?? 0), 0) / withReadiness.length)
    : null;

  // Readiness distribution buckets — same bands as scoreColor()
  const buckets = { High: 0, Good: 0, Average: 0, Low: 0, Poor: 0 };
  for (const r of withReadiness) {
    const v = r.avgReadiness ?? 0;
    if (v >= 75) buckets.High++;
    else if (v >= 60) buckets.Good++;
    else if (v >= 40) buckets.Average++;
    else if (v >= 25) buckets.Low++;
    else buckets.Poor++;
  }

  // Congestion buckets
  const withCongestion = rows.filter(r => r.avgCongestion != null);
  let congLow = 0, congMed = 0, congHigh = 0;
  for (const r of withCongestion) {
    const v = r.avgCongestion ?? 0;
    if (v <= 40) congLow++; else if (v <= 70) congMed++; else congHigh++;
  }

  const mostCongested = [...withCongestion].sort((a, b) => (b.avgCongestion ?? 0) - (a.avgCongestion ?? 0))[0];
  const leastCongested = [...withCongestion].sort((a, b) => (a.avgCongestion ?? 0) - (b.avgCongestion ?? 0))[0];
  const mostTravel = [...rows].filter(r => r.avgTravel14d != null).sort((a, b) => (b.avgTravel14d ?? 0) - (a.avgTravel14d ?? 0))[0];
  const leastTravel = [...rows].filter(r => r.avgTravel14d != null).sort((a, b) => (a.avgTravel14d ?? 0) - (b.avgTravel14d ?? 0))[0];
  const mostRest = [...rows].filter(r => r.avgRestDays != null).sort((a, b) => (b.avgRestDays ?? 0) - (a.avgRestDays ?? 0))[0];
  const topReadiness = withReadiness[0];

  // Active competitions distribution (1/2/3/4/5+)
  const compBuckets = new Map<number, number>();
  for (const r of rows) {
    const c = Math.round(r.avgActiveComps ?? 1) || 1;
    const bucket = c >= 5 ? 5 : c;
    compBuckets.set(bucket, (compBuckets.get(bucket) ?? 0) + 1);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Leagues</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>Intelligence across all tracked competitions</div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
        <KpiCard icon="🌐" value={rows.length} label="Leagues Tracked" sub={`Across ${new Set(rows.map(r => r.tournament.category)).size} countries`} />
        <KpiCard icon="🛡" value={totalTeams} label="Teams Analyzed" sub="All active teams" />
        <KpiCard icon="📅" value={rows.filter(r => r.teamCount > 0).length} label="Leagues w/ Data" />
        <KpiCard icon="💓" value={avgReadinessAll ?? '—'} label="Avg Readiness" color={scoreColor(avgReadinessAll)} />
        <KpiCard icon="🛌" value={avgRestAll ?? '—'} label="Avg Rest Days" />
        <KpiCard icon="✈" value={avgTravelAll != null ? `${avgTravelAll} km` : '—'} label="Avg Travel (14D)" />
      </div>

      {/* Ranked table */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: COLORS.surface2 }}>
              {['#', 'LEAGUE', 'COUNTRY', 'TEAMS', 'AVG READINESS', 'FORM', 'CONGESTION', 'TRAVEL (14D)', 'REST DAYS'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'LEAGUE' || h === 'COUNTRY' ? 'left' : 'center', fontSize: 10, color: COLORS.dim, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.tournament.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <td style={{ padding: '10px 12px', color: COLORS.dim, fontFamily: '"JetBrains Mono",monospace' }}>{i + 1}</td>
                <td style={{ padding: '10px 12px' }}>
                  <Link href={leagueUrl(r.tournament)} style={{ color: COLORS.text, fontWeight: 600, textDecoration: 'none' }}>
                    {r.tournament.name}
                  </Link>
                </td>
                <td style={{ padding: '10px 12px', color: COLORS.muted }}>{r.tournament.category ?? '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: COLORS.muted, fontFamily: '"JetBrains Mono",monospace' }}>{r.teamCount}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', fontWeight: 700, color: scoreColor(r.avgReadiness) }}>
                    {r.avgReadiness ?? '—'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: scoreColor(r.avgForm) }}>{r.avgForm ?? '—'}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: r.avgCongestion != null ? (r.avgCongestion > 60 ? COLORS.red : r.avgCongestion > 40 ? COLORS.amber : COLORS.green) : COLORS.dim }}>
                  {r.avgCongestion ?? '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: r.avgTravel14d != null && r.avgTravel14d > 500 ? COLORS.red : COLORS.muted }}>
                  {r.avgTravel14d != null ? `${r.avgTravel14d} km` : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: '"JetBrains Mono",monospace', color: COLORS.muted }}>{r.avgRestDays ?? '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: COLORS.dim }}>No tracked leagues found — run sync:standings first</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom row: donuts + insights */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: 14 }}>
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Readiness Distribution</div>
          <Donut
            centerValue={rows.length} centerLabel="Leagues"
            segments={[
              { label: 'High (75-100)', count: buckets.High, color: COLORS.green },
              { label: 'Good (60-74)', count: buckets.Good, color: COLORS.greenDim },
              { label: 'Average (40-59)', count: buckets.Average, color: COLORS.amber },
              { label: 'Low (25-39)', count: buckets.Low, color: COLORS.orange },
              { label: 'Poor (0-24)', count: buckets.Poor, color: COLORS.red },
            ]}
          />
        </div>

        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>League Congestion</div>
          <Donut
            centerValue={rows.length} centerLabel="Leagues"
            segments={[
              { label: 'Low (0-40)', count: congLow, color: COLORS.green },
              { label: 'Medium (41-70)', count: congMed, color: COLORS.amber },
              { label: 'High (71-100)', count: congHigh, color: COLORS.red },
            ]}
          />
          {mostCongested && leastCongested && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}`, fontSize: 10 }}>
              <div>
                <div style={{ color: COLORS.dim, marginBottom: 2 }}>MOST CONGESTED</div>
                <div style={{ color: COLORS.text, fontWeight: 600 }}>{mostCongested.tournament.name}</div>
                <div style={{ color: COLORS.red, fontFamily: '"JetBrains Mono",monospace' }}>{mostCongested.avgCongestion} High</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: COLORS.dim, marginBottom: 2 }}>LEAST CONGESTED</div>
                <div style={{ color: COLORS.text, fontWeight: 600 }}>{leastCongested.tournament.name}</div>
                <div style={{ color: COLORS.green, fontFamily: '"JetBrains Mono",monospace' }}>{leastCongested.avgCongestion} Low</div>
              </div>
            </div>
          )}
        </div>

        {/* League Insights — rule-based, same pattern as generateMatchInsight */}
        <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>League Insights</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topReadiness && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span>📈</span>
                <span style={{ color: COLORS.text2 }}>
                  <strong>{topReadiness.tournament.category}</strong>'s <strong>{topReadiness.tournament.name}</strong> has the highest average readiness ({topReadiness.avgReadiness}).
                </span>
              </div>
            )}
            {mostCongested && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span>📅</span>
                <span style={{ color: COLORS.text2 }}>
                  Fixture congestion is highest in <strong>{mostCongested.tournament.name}</strong> ({mostCongested.avgCongestion}/100).
                </span>
              </div>
            )}
            {mostTravel && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span>✈</span>
                <span style={{ color: COLORS.text2 }}>
                  <strong>{mostTravel.tournament.name}</strong> teams travel the most, averaging {mostTravel.avgTravel14d}km over 14 days.
                </span>
              </div>
            )}
            {mostRest && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                <span>🛌</span>
                <span style={{ color: COLORS.text2 }}>
                  <strong>{mostRest.tournament.name}</strong> teams get the most rest on average ({mostRest.avgRestDays} days).
                </span>
              </div>
            )}
            {rows.length === 0 && (
              <div style={{ fontSize: 12, color: COLORS.dim }}>No data yet — insights populate once standings and team intelligence have synced.</div>
            )}
          </div>
        </div>
      </div>

      {/* Active competitions distribution */}
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Active Competitions Distribution</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, height: 100 }}>
          {[1, 2, 3, 4, 5].map(n => {
            const count = compBuckets.get(n) ?? 0;
            const max = Math.max(1, ...Array.from(compBuckets.values()));
            const heightPct = (count / max) * 100;
            return (
              <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                <div style={{ fontSize: 11, fontFamily: '"JetBrains Mono",monospace', color: COLORS.text }}>{count}</div>
                <div style={{ width: '60%', height: `${Math.max(4, heightPct)}%`, background: n >= 4 ? COLORS.orange : n >= 3 ? COLORS.amber : COLORS.green, borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                <div style={{ fontSize: 10, color: COLORS.dim }}>{n}{n === 5 ? '+' : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
