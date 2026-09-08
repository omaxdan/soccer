import Link from 'next/link';
import { fetchPlayers } from '@/lib/v2/api';
import { v2PlayerSlug } from '@/lib/v2/slug';
import { EmptyState } from '@/components/v2/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PitchTerminal V2 · Players' };

export default async function V2PlayersPage() {
  const { players } = await fetchPlayers();
  return (
    <main className="space-y-4" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <nav><Link href="/v2" className="label-cap" style={{ color: 'var(--cool)' }}>← PitchTerminal V2</Link></nav>
      <header>
        <p className="eyebrow">PitchTerminal V2</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Players</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>Players currently registered in the governed competition.</p>
      </header>
      {players.length === 0 ? (
        <EmptyState message="No players are available yet." />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {players.map((p) => (
            <li key={p.id}>
              <Link href={`/v2/players/${v2PlayerSlug(p)}`} className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: 12, textDecoration: 'none', color: 'inherit' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text)' }}>{p.fullName}</span>
                {p.team && <span className="label-cap" style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{p.team.shortName ?? p.team.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
