import { supabase } from '@/lib/supabase';
import { COLORS, scoreColor } from '@/design/tokens';
import Link from 'next/link';
import { leagueUrl } from '@/lib/urls';

export const metadata = { title: 'Leagues | NinetyData RIP' };
export const revalidate = 86400;

export default async function LeaguesPage() {
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, slug, category')
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  // Group by category (country)
  const byCountry = new Map<string, any[]>();
  for (const t of tournaments ?? []) {
    const country = t.category ?? 'Other';
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country)!.push(t);
  }

  const sorted = Array.from(byCountry.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <main style={{ padding: '20px 24px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>
        Leagues & Tournaments
      </div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 20 }}>
        {(tournaments ?? []).length} tournaments across {sorted.length} countries
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {sorted.map(([country, leagues]) => (
          <div key={country} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              {country}
            </div>
            {leagues.map((l: any) => (
              <Link key={l.id} href={leagueUrl(l)} style={{ textDecoration: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${COLORS.border}`, cursor: 'pointer' }}>
                  <div style={{ fontSize: 12, color: COLORS.text, fontWeight: 500 }}>{l.name}</div>
                  <div style={{ fontSize: 9, color: COLORS.dim, fontFamily: 'monospace' }}>{l.slug}</div>
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
