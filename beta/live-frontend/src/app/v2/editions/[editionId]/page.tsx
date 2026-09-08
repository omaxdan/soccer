import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchEditionFixtures } from '@/lib/v2/api';
import { v2MatchSlug } from '@/lib/v2/slug';
import { EmptyState, Kickoff, StatusChip, Score } from '@/components/v2/ui';

export const dynamic = 'force-dynamic';

export default async function V2EditionPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const data = await fetchEditionFixtures(editionId);
  if (!data) notFound();
  const { edition, fixtures } = data;
  return (
    <main className="space-y-4" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <nav><Link href="/v2" className="label-cap" style={{ color: 'var(--cool)' }}>← Leagues</Link></nav>
      <header>
        <p className="eyebrow">{edition.seasonLabel}</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{edition.competition.name}</h1>
      </header>
      {fixtures.length === 0 ? (
        <EmptyState message="No fixtures are currently available for this edition." />
      ) : (
        <ul className="space-y-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {fixtures.map((f) => (
            <li key={f.fixtureId}>
              <Link href={`/v2/matches/${v2MatchSlug(f)}`} className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: 12, textDecoration: 'none', color: 'inherit', alignItems: 'center' }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.homeTeam.name} <span style={{ color: 'var(--faint)' }}>v</span> {f.awayTeam.name}
                  </span>
                  <span className="label-cap" style={{ color: 'var(--muted)' }}><Kickoff iso={f.kickoffAt} /></span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Score score={f.score} />
                  <StatusChip status={f.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
