import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchTeam } from '@/lib/v2/api';
import { idFromParam, v2PlayerSlug } from '@/lib/v2/slug';
import { Kickoff } from '@/components/v2/ui';
import { formResult } from '@/lib/v2/types';
import type { ApiTeamResult } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

function ResultPill({ r }: { r: ApiTeamResult }) {
  const res = formResult(r);
  const map = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' } as const;
  const color = res ? map[res] : 'var(--faint)';
  const full = res === 'W' ? 'Win' : res === 'D' ? 'Draw' : res === 'L' ? 'Loss' : 'No result';
  return <span className="mono" aria-label={full} title={full} style={{ fontWeight: 700, color, minWidth: 12, textAlign: 'center' }}>{res ?? '·'}</span>;
}

export default async function V2TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const teamId = idFromParam(slug);
  if (teamId === null) notFound();
  const data = await fetchTeam(String(teamId));
  if (!data) notFound();
  const { team, competitions, squad, recentResults } = data;

  return (
    <main className="space-y-5" style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <nav><Link href="/v2/teams" className="label-cap" style={{ color: 'var(--cool)' }}>← Teams</Link></nav>

      {/* IDENTITY — context */}
      <header className="panel" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{team.name}</h1>
        <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>
          {team.shortName ?? '—'}{team.countryCode ? ` · ${team.countryCode}` : ''}{team.homeVenueName ? ` · ${team.homeVenueName}` : ''}
        </p>
        {competitions.length > 0 && (
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 8 }}>
            {competitions.map((c) => `${c.competition.name} · ${c.seasonLabel}`).join('  |  ')}
          </p>
        )}
      </header>

      {/* RECENT RESULTS — context */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Recent results</p>
          <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>
        </div>
        {recentResults.length === 0 ? (
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>No completed matches yet</p>
        ) : (
          <div className="panel" style={{ padding: 12 }}>
            <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {recentResults.map((r) => (
                <div role="listitem" key={r.fixtureId} style={{ display: 'grid', gridTemplateColumns: '5rem 18px minmax(0,1fr) 2.4rem 0.85rem', gap: 6, alignItems: 'center', fontSize: 11 }}>
                  <span className="label-cap tnum" style={{ color: 'var(--faint)' }}><Kickoff iso={r.kickoffAt} /></span>
                  <span className="label-cap" style={{ color: 'var(--faint)' }}>{r.isHome ? 'H' : 'A'}</span>
                  <span title={r.opponent.name} style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{r.opponent.name}</span>
                  <span className="mono tnum" style={{ color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.goalsFor ?? '-'}–{r.goalsAgainst ?? '-'}</span>
                  <span style={{ display: 'flex', justifyContent: 'center' }}><ResultPill r={r} /></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* CURRENT SQUAD — context */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Current squad</p>
          <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>
          <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{squad.length}</span>
        </div>
        {squad.length === 0 ? (
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>No squad registered yet</p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {squad.map((p) => (
              <li key={p.id}>
                <Link href={`/v2/players/${v2PlayerSlug(p)}`} className="panel" style={{ display: 'block', padding: 10, textDecoration: 'none', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.fullName}{p.shortName ? <span className="label-cap" style={{ color: 'var(--faint)', marginLeft: 6 }}>{p.shortName}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
