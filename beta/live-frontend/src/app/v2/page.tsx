import Link from 'next/link';
import { fetchEditions } from '@/lib/v2/api';
import { EmptyState } from '@/components/v2/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PitchTerminal V2 · Leagues' };

export default async function V2LeaguesPage() {
  const { editions } = await fetchEditions();
  return (
    <main className="space-y-4" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <header>
        <p className="eyebrow">PitchTerminal V2</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Leagues</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Tracked competition editions with ingested fixtures.</p>
      </header>
      {editions.length === 0 ? (
        <EmptyState message="No leagues with fixtures are available yet." />
      ) : (
        <ul className="space-y-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {editions.map((e) => (
            <li key={e.id}>
              <Link href={`/v2/editions/${e.id}`} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, textDecoration: 'none', color: 'inherit' }}>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)' }}>{e.competition.name}</span>
                  <span className="label-cap" style={{ color: 'var(--muted)' }}>{e.seasonLabel}</span>
                </span>
                <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 12 }}>{e.fixtureCount} fixtures →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
