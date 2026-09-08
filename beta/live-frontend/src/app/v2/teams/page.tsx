import Link from 'next/link';
import { fetchTeams } from '@/lib/v2/api';
import { v2TeamSlug } from '@/lib/v2/slug';
import { EmptyState } from '@/components/v2/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PitchTerminal V2 · Teams' };

export default async function V2TeamsPage() {
  const { teams } = await fetchTeams();
  return (
    <main className="space-y-4" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <nav><Link href="/v2" className="label-cap" style={{ color: 'var(--cool)' }}>← PitchTerminal V2</Link></nav>
      <header>
        <p className="eyebrow">PitchTerminal V2</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Teams</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Teams in the current governed competition.</p>
      </header>
      {teams.length === 0 ? (
        <EmptyState message="No teams are available yet." />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {teams.map((t) => (
            <li key={t.id}>
              <Link href={`/v2/teams/${v2TeamSlug(t)}`} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, textDecoration: 'none', color: 'inherit' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text)' }}>{t.name}</span>
                  {t.shortName && <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 6 }}>{t.shortName}</span>}
                </span>
                {t.countryCode && <span className="label-cap tnum" style={{ color: 'var(--faint)' }}>{t.countryCode}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
