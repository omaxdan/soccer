import { supabase } from '@/lib/supabase';
import { parseIdFromSlug, teamUrl } from '@/lib/urls';
import Link from 'next/link';

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseIdFromSlug(slug)?.toString() ?? '';
  return { title: `League ${id}` };
}

export default async function LeaguePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = parseIdFromSlug(slug)?.toString() ?? '';

  // Get tournament
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, slug, category')
    .eq('id', id)
    .single();

  // Get teams that played in this competition
  const { data: matches } = await supabase
    .from('matches')
    .select(`
      home_team:teams!home_team_id(id, name, short_name, slug, country),
      away_team:teams!away_team_id(id, name, short_name, slug, country)
    `)
    .eq('competition', tournament?.name ?? '')
    .limit(200);

  const teamMap = new Map<number, any>();
  (matches ?? []).forEach((m: any) => {
    [m.home_team, m.away_team].forEach((t: any) => { if (t) teamMap.set(t.id, t); });
  });
  const teams = Array.from(teamMap.values());

  // Get team intelligence for those teams
  const teamIds = teams.map(t => t.id);
  const { data: intelligence } = teamIds.length > 0 ? await supabase
    .from('team_intelligence')
    .select('team_id, readiness_score, form_index, congestion_score, travel_fatigue_score, active_competitions, last_5_points')
    .in('team_id', teamIds) : { data: [] };

  const intelMap = new Map((intelligence ?? []).map((t: any) => [t.team_id, t]));

  const rows = teams.map(t => ({
    ...t,
    intel: intelMap.get(t.id) ?? null,
  })).sort((a, b) => (b.intel?.readiness_score ?? 0) - (a.intel?.readiness_score ?? 0));

  function scoreColor(s: number | null) {
    if (s == null) return 'var(--dim)';
    if (s >= 85) return '#00e676';
    if (s >= 65) return '#69f0ae';
    if (s >= 45) return '#ffb300';
    if (s >= 25) return '#ff6d00';
    return '#ff1744';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/leagues" style={{ color: 'var(--muted)', fontSize: 12 }}>← Leagues</Link>
        <span style={{ color: 'var(--dim)' }}>›</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tournament?.category}</span>
        <span style={{ color: 'var(--dim)' }}>›</span>
        <span style={{ fontSize: 12, color: 'var(--text)' }}>{tournament?.name ?? `League ${id}`}</span>
      </div>

      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
          {tournament?.name ?? `League ${id}`}
        </div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}>
          {tournament?.category} · {rows.length} teams · Slug: {tournament?.slug}
        </div>
      </div>

      {/* Stats */}
      <div className="grid-4">
        {[
          { label: 'TEAMS', value: rows.length, col: 'var(--blue)' },
          { label: 'WITH READINESS', value: rows.filter(r => r.intel?.readiness_score != null).length, col: 'var(--green)' },
          { label: 'AVG READINESS', value: rows.filter(r => r.intel?.readiness_score).length
              ? Math.round(rows.reduce((s, r) => s + (r.intel?.readiness_score ?? 0), 0) / rows.filter(r => r.intel?.readiness_score).length)
              : '—', col: 'var(--amber)' },
          { label: 'TOTAL MATCHES', value: (matches ?? []).length, col: 'var(--text)' },
        ].map(c => (
          <div key={c.label} className="card">
            <div className="section-label" style={{ marginBottom: 6 }}>{c.label}</div>
            <div className="mono" style={{ fontSize: 26, fontWeight: 700, color: c.col }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* League Intelligence Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="section-title">League Intelligence Table</span>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>Sorted by readiness score</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>RANK</th>
              <th>TEAM</th>
              <th>READINESS</th>
              <th>FORM (L5)</th>
              <th>CONGESTION</th>
              <th>TRAVEL FAT.</th>
              <th>ACTIVE COMPS</th>
              <th>LAST 5 PTS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={t.id}>
                <td style={{ color: 'var(--dim)', fontSize: 11 }}>{i + 1}</td>
                <td>
                  <Link href={teamUrl(t)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 26, height: 26, background: 'var(--surface2)', borderRadius: 5, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, flexShrink: 0 }}>
                      {t.short_name?.slice(0, 3) ?? t.name?.slice(0, 3)}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{t.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--dim)' }}>{t.country}</div>
                    </div>
                  </Link>
                </td>
                <td>
                  <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: scoreColor(t.intel?.readiness_score ?? null) }}>
                    {t.intel?.readiness_score != null ? Math.round(t.intel.readiness_score) : '—'}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>—</td>
                <td>
                  <span className="mono" style={{ fontSize: 12, color: (t.intel?.congestion_score ?? 0) > 65 ? 'var(--red)' : 'var(--muted)' }}>
                    {t.intel?.congestion_score != null ? Math.round(t.intel.congestion_score) : '—'}
                    {(t.intel?.congestion_score ?? 0) > 65 && ' ⚠️'}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t.intel?.travel_fatigue_score != null ? Math.round(t.intel.travel_fatigue_score) : '—'}
                </td>
                <td>
                  <span style={{ fontSize: 12, color: (t.intel?.active_competitions ?? 0) > 2 ? 'var(--amber)' : 'var(--muted)' }}>
                    {t.intel?.active_competitions ?? '—'}
                    {(t.intel?.active_competitions ?? 0) > 2 && ' ⚠️'}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>
                  {t.intel?.last_5_points != null ? `${t.intel.last_5_points}/15` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
                No team data for this competition yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
