import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchPlayer } from '@/lib/v2/api';
import { idFromParam, v2TeamSlug } from '@/lib/v2/slug';

export const dynamic = 'force-dynamic';

/** Whole years between an ISO date of birth and today (context only). */
function ageFrom(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age >= 0 && age < 120 ? age : null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p style={{ color: 'var(--text)', fontSize: 14, marginTop: 2 }}>{value}</p>
    </div>
  );
}

export default async function V2PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const playerId = idFromParam(slug);
  if (playerId === null) notFound();
  const data = await fetchPlayer(String(playerId));
  if (!data) notFound();
  const { player, currentTeam, competition } = data;
  const age = ageFrom(player.dateOfBirth);
  const foot = player.preferredFoot ? player.preferredFoot.toLowerCase() : null;

  return (
    <main className="space-y-5" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <nav><Link href="/v2/players" className="label-cap" style={{ color: 'var(--cool)' }}>← Players</Link></nav>

      {/* IDENTITY — biography context */}
      <header className="panel" style={{ padding: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>{player.fullName}</h1>
        {player.shortName && <p className="label-cap" style={{ color: 'var(--muted)', marginTop: 4 }}>{player.shortName}</p>}
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 8 }}>
          {currentTeam ? (
            <Link href={`/v2/teams/${v2TeamSlug(currentTeam)}`} style={{ color: 'var(--cool)' }}>{currentTeam.name}</Link>
          ) : 'No current team'}
          {competition ? ` · ${competition.name} · ${competition.seasonLabel}` : ''}
        </p>
      </header>

      {/* BIOGRAPHY FACTS — context, honest nulls */}
      <section className="panel" style={{ padding: 12 }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Profile</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Fact label="Nationality" value={player.nationalityCode ?? '—'} />
          <Fact label="Age" value={age === null ? '—' : String(age)} />
          <Fact label="Height" value={player.heightCm === null ? '—' : `${player.heightCm} cm`} />
          <Fact label="Preferred foot" value={foot ?? '—'} />
        </div>
      </section>
    </main>
  );
}
