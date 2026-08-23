import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMatch } from '@/lib/v2/api';
import { Kickoff, StatusChip, Score, FormStrip, ReadingCard, TeamIntelligencePanel } from '@/components/v2/ui';
import type { ApiTeamIntelligence } from '@/lib/v2/types';

export const dynamic = 'force-dynamic';

function TeamIntel({ name, intel }: { name: string; intel: ApiTeamIntelligence }) {
  return (
    <section className="space-y-2" aria-label={`${name} intelligence`}>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{name}</h3>
      <ReadingCard title="Readiness Tracker" reading={intel.readiness} />
      <ReadingCard title="Home / Away Split" reading={intel.homeAwaySplit} />
    </section>
  );
}

export default async function V2MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const data = await fetchMatch(matchId);
  if (!data) notFound();
  const { match, form, intelligence, teamFeatures } = data;

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

      {/* RECENT FORM — raw facts */}
      <section className="space-y-3">
        <p className="eyebrow">Recent form</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="panel" style={{ padding: 12 }}>
            <p className="label-cap" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{match.homeTeam.name}</p>
            <FormStrip fixtures={form.home} />
          </div>
          <div className="panel" style={{ padding: 12 }}>
            <p className="label-cap" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{match.awayTeam.name}</p>
            <FormStrip fixtures={form.away} />
          </div>
        </div>
      </section>

      {/* INTELLIGENCE — clearly separated from raw facts */}
      <section className="space-y-3">
        <p className="eyebrow" style={{ color: 'var(--amber)' }}>PitchTerminal intelligence</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <TeamIntel name={match.homeTeam.name} intel={intelligence.home} />
          <TeamIntel name={match.awayTeam.name} intel={intelligence.away} />
        </div>
      </section>

      {/* TEAM INTELLIGENCE — supporting evidence: persisted feature comparison */}
      <section className="space-y-3">
        <p className="eyebrow">Team intelligence</p>
        <TeamIntelligencePanel home={teamFeatures.home} away={teamFeatures.away} homeName={match.homeTeam.name} awayName={match.awayTeam.name} />
      </section>
    </main>
  );
}
