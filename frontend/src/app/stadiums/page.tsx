import { supabase } from '@/lib/supabase';

export const metadata = { title: 'Stadiums' };
export const revalidate = 86400;

export default async function StadiumsPage() {
  const { data: stadiums } = await supabase
    .from('stadiums')
    .select('id, name, city, country, capacity, latitude, longitude, timezone')
    .not('latitude', 'is', null)
    .order('capacity', { ascending: false, nullsFirst: false })
    .limit(100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Stadiums</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>
          {stadiums?.length ?? 0} venues with GPS coordinates · Used for travel intelligence
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-3">
        {[
          { label: 'TOTAL VENUES', value: stadiums?.length ?? 0, col: 'var(--blue)' },
          { label: 'WITH COORDINATES', value: stadiums?.filter((s: any) => s.latitude).length ?? 0, col: 'var(--green)' },
          { label: 'COUNTRIES', value: new Set(stadiums?.map((s: any) => s.country)).size, col: 'var(--amber)' },
        ].map(c => (
          <div key={c.label} className="card">
            <div className="section-label" style={{ marginBottom: 6 }}>{c.label}</div>
            <div className="mono" style={{ fontSize: 28, fontWeight: 700, color: c.col }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>STADIUM</th>
              <th>CITY</th>
              <th>COUNTRY</th>
              <th>CAPACITY</th>
              <th>COORDINATES</th>
              <th>TIMEZONE</th>
            </tr>
          </thead>
          <tbody>
            {(stadiums ?? []).map((s: any, i: number) => (
              <tr key={s.id}>
                <td style={{ color: 'var(--dim)', fontSize: 11 }}>{i + 1}</td>
                <td style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{s.city ?? '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--muted)' }}>{s.country}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {s.capacity ? s.capacity.toLocaleString() : '—'}
                </td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--dim)' }}>
                  {s.latitude && s.longitude ? `${Number(s.latitude).toFixed(3)}, ${Number(s.longitude).toFixed(3)}` : '—'}
                </td>
                <td style={{ fontSize: 10, color: 'var(--muted)' }}>{s.timezone ?? '—'}</td>
              </tr>
            ))}
            {(stadiums ?? []).length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
                Run sync:today to populate stadium data
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
