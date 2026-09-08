import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMatch } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { Kickoff, StatusChip, Score, RecentVenueForm, ReadingCard, TeamIntelligencePanel } from '@/components/v2/ui';
import type { ApiTeamIntelligence } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

function TeamIntel({ name, intel }: { name: string; intel: ApiTeamIntelligence }) {
  return (
    <section className="space-y-2" aria-label={`${name} intelligence`}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{name}</h3>
      {/* PD-6: the user-facing concept is Form Momentum / Trajectory (module key readiness_tracker, unchanged). */}
      <ReadingCard title="Form Momentum / Trajectory" reading={intel.readiness} />
      <ReadingCard title="Home / Away Split" reading={intel.homeAwaySplit} />
    </section>
  );
}

export default async function V2MatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {home}-vs-{away}-{id}; the trailing numeric fixture id is the
  // source of truth. Resolve it with the canonical extractor and 404 on a slug
  // that carries no valid numeric id — never guess. The backend API stays numeric.
  const fixtureId = idFromParam(slug);
  if (fixtureId === null) notFound();
  const data = await fetchMatch(String(fixtureId));
  if (!data) notFound();
  const { match, recentVenueForm, intelligence, teamFeatures } = data;

  return (
    <main className="space-y-5" style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <nav><Link href={`/v2/editions/${match.edition.id}`} className="label-cap" style={{ color: 'var(--cool)' }}>← {match.competition.name}</Link></nav>

      {/* MATCH HEADER — raw facts */}
      <header className="panel" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="eyebrow">{match.competition.name} · {match.edition.seasonLabel}</p>
          <StatusChip status={match.status} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{match.homeTeam.name}</div>
          <div style={{ textAlign: 'center', fontSize: 22 }}><Score score={match.score} /></div>
          <div style={{ textAlign: 'left', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>{match.awayTeam.name}</div>
        </div>
        <p className="label-cap" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 8 }}><Kickoff iso={match.kickoffAt} /></p>
      </header>

      {/* RECENT VENUE FORM — CONTEXT (PD-11). Last 5 home / last 5 away per team. */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Recent venue form</p>
          <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>
        </div>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>
          Descriptive recent results (all competitions), split by venue. Context for interpretation — not the calculation behind the Home / Away Split.
        </p>
        <RecentVenueForm homeName={match.homeTeam.name} awayName={match.awayTeam.name} home={recentVenueForm.home} away={recentVenueForm.away} />
      </section>

      {/* INTELLIGENCE — the governed reading, with its Why? (module substrate) inside each card. */}
      <section className="space-y-3">
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>PitchTerminal intelligence</p>
        {/* Two team columns on tablet/desktop; stacked to one column on mobile. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TeamIntel name={match.homeTeam.name} intel={intelligence.home} />
          <TeamIntel name={match.awayTeam.name} intel={intelligence.away} />
        </div>
      </section>

      {/* RELATED CONTEXT — persisted feature comparison; not any module's substrate (PD-10). */}
      <section className="space-y-2">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <p className="eyebrow">Team comparison</p>
          <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>context</span>
        </div>
        <TeamIntelligencePanel home={teamFeatures.home} away={teamFeatures.away} homeName={match.homeTeam.name} awayName={match.awayTeam.name} />
      </section>
    </main>
  );
}
