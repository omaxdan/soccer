import { supabase } from '@/lib/supabase';

export const metadata = { title: 'Players' };
export const revalidate = 3600;

export default async function PlayersPage() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, short_name, position, nationality, current_injury, injury_severity_score, market_value, team:teams!team_id(name, country)')
    .order('market_value', { ascending: false, nullsFirst: false })
    .limit(100);

  const posColor = (p: string | null) => {
    if (p === 'G') return '#2979ff';
    if (p === 'D') return '#00e676';
    if (p === 'M') return '#ffb300';
    if (p === 'F') return '#ff1744';
    return 'var(--dim)';
  };

  const total    = players?.length ?? 0;
  const injured  = players?.filter((p: any) => p.current_injury).length ?? 0;
  const withValue = players?.filter((p: any) => p.market_value).length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Player Intelligence</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
          {total} players synced · {injured} currently injured · {withValue} with market value
        </div>
      </div>

      {/* Stats row */}
      <div className="grid-4">
        {[
          { label: 'TOTAL PLAYERS', value: total, col: 'var(--blue)' },
          { label: 'CURRENTLY INJURED', value: injured, col: 'var(--red)' },
          { label: 'GOALKEEPERS', value: players?.filter((p: any) => p.position === 'G').length ?? 0, col: '#2979ff' },
          { label: 'OUTFIELD', value: players?.filter((p: any) => p.position !== 'G').length ?? 0, col: 'var(--green)' },
        ].map(c => (
          <div key={c.label} className="card">
            <div className="section-label" style={{ marginBottom: 6 }}>{c.label}</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: c.col }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>PLAYER</th>
              <th>TEAM</th>
              <th>POS</th>
              <th>NAT</th>
              <th>STATUS</th>
              <th>MARKET VALUE</th>
              <th>SEVERITY</th>
            </tr>
          </thead>
          <tbody>
            {(players ?? []).map((p: any, i: number) => (
              <tr key={p.id}>
                <td style={{ color: 'var(--dim)', fontSize: 11 }}>{i + 1}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                      {(p.short_name ?? p.name ?? '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
                      {p.short_name && p.short_name !== p.name && (
                        <div style={{ fontSize: 10, color: 'var(--dim)' }}>{p.short_name}</div>
                      )}
                    </div>
                  </div>
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{(p.team as any)?.name ?? '—'}</td>
                <td>
                  <span style={{ background: posColor(p.position) + '25', color: posColor(p.position), border: `1px solid ${posColor(p.position)}50`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
                    {p.position ?? '—'}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{p.nationality ?? '—'}</td>
                <td>
                  {p.current_injury
                    ? <span style={{ fontSize: 10, color: 'var(--red)', background: 'var(--red)18', border: '1px solid var(--red)40', borderRadius: 4, padding: '2px 8px' }}>Injured</span>
                    : <span style={{ fontSize: 10, color: 'var(--green)', background: 'var(--green)18', border: '1px solid var(--green)40', borderRadius: 4, padding: '2px 8px' }}>Fit</span>
                  }
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {p.market_value ? `€${(p.market_value / 1000000).toFixed(1)}M` : '—'}
                </td>
                <td>
                  {p.injury_severity_score ? (
                    <span className="mono" style={{ fontSize: 11, color: Number(p.injury_severity_score) >= 75 ? 'var(--red)' : Number(p.injury_severity_score) >= 50 ? 'var(--amber)' : 'var(--orange)' }}>
                      {Number(p.injury_severity_score)}/100
                    </span>
                  ) : <span style={{ color: 'var(--dim)' }}>—</span>}
                </td>
              </tr>
            ))}
            {(players ?? []).length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>👤</div>
                Run <code style={{ background: 'var(--surface2)', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>sync:squads:v2</code> to populate player data
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
