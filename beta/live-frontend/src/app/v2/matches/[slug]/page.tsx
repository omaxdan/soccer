import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchMatchIntelligence, fetchMatch } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { Kickoff, StatusChip, Score, RecentVenueForm, ReadingCard, TeamIntelligencePanel } from '@/components/v2/ui';
import { ProvenanceBar, VerdictBand, PreparednessBand, CitedEvidencePanel, IntelligenceUnavailable } from '@/components/v2/intelligence';
import type { ApiTeamIntelligence, MatchDetailResponse, MatchIntelligence } from '@/lib/v2/types';

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

/**
 * MATCH CONTEXT — deliberately separate from the sealed calculation. Everything
 * here is live/descriptive information from getMatchDetail (recent venue form, live
 * module readings, feature comparison). It is NOT the substrate the sealed
 * intelligence cited and is labelled so the distinction is unmistakable.
 */
function MatchContext({ context }: { context: MatchDetailResponse }) {
  const { match, recentVenueForm, intelligence, teamFeatures } = context;
  return (
    <div className="space-y-5">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="eyebrow" style={{ color: 'var(--cool)' }}>Match context</p>
        <span className="label-cap" style={{ color: 'var(--cool)', border: '1px solid var(--cool)', borderRadius: 4, padding: '0 5px', fontSize: 9 }}>not part of calculation</span>
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: -8 }}>
        Live, descriptive information for interpretation. None of this is the substrate the sealed calculation cited.
      </p>

      {/* RECENT VENUE FORM — CONTEXT (PD-11). Last 5 home / last 5 away per team. */}
      <section className="space-y-2">
        <p className="label-cap" style={{ color: 'var(--muted)' }}>Recent venue form</p>
        <RecentVenueForm homeName={match.homeTeam.name} awayName={match.awayTeam.name} home={recentVenueForm.home} away={recentVenueForm.away} />
      </section>

      {/* LIVE MODULE READINGS — the current (non-sealed) readings, with their own Why? substrate. */}
      <section className="space-y-2">
        <p className="label-cap" style={{ color: 'var(--muted)' }}>Live module readings</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TeamIntel name={match.homeTeam.name} intel={intelligence.home} />
          <TeamIntel name={match.awayTeam.name} intel={intelligence.away} />
        </div>
      </section>

      {/* FEATURE COMPARISON — persisted feature values; not any module's substrate (PD-10). */}
      <section className="space-y-2">
        <p className="label-cap" style={{ color: 'var(--muted)' }}>Team comparison</p>
        <TeamIntelligencePanel home={teamFeatures.home} away={teamFeatures.away} homeName={match.homeTeam.name} awayName={match.awayTeam.name} />
      </section>
    </div>
  );
}

/** Raw-facts match header. Prefers the sealed header when present (identical
 *  fixture facts), else the context header — the fixture always renders. */
function MatchHeader({ context }: { context: MatchDetailResponse }) {
  const { match } = context;
  return (
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
  );
}

/** The sealed surfaces, in evidence-first order: provenance → verdict → preparedness
 *  → cited evidence. Rendered only when a sealed snapshot exists. */
function SealedIntelligence({ intelligence, homeName, awayName }: { intelligence: MatchIntelligence; homeName: string; awayName: string }) {
  return (
    <div className="space-y-5">
      <ProvenanceBar provenance={intelligence.provenance} />
      <VerdictBand verdict={intelligence.verdict} />
      <PreparednessBand intelligence={intelligence} homeName={homeName} awayName={awayName} />
      <CitedEvidencePanel citedEvidence={intelligence.citedEvidence} />
    </div>
  );
}

export default async function V2MatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {home}-vs-{away}-{id}; the trailing numeric fixture id is the
  // source of truth. Resolve it with the canonical extractor and 404 on a slug
  // that carries no valid numeric id — never guess. The backend API stays numeric.
  const fixtureId = idFromParam(slug);
  if (fixtureId === null) notFound();
  const id = String(fixtureId);

  // Sealed-first: the intelligence endpoint returns { intelligence, context } when a
  // snapshot is sealed, and 404s otherwise. A 404 there does NOT mean the fixture is
  // absent — it means "no sealed snapshot". So fall back to the plain match read to
  // tell "unsealed fixture" (render context + honest unavailable state) apart from
  // "no such fixture" (real 404). No backend change; two existing read endpoints.
  const sealed = await fetchMatchIntelligence(id);
  const context: MatchDetailResponse | null = sealed?.context ?? (sealed ? null : await fetchMatch(id));
  if (!sealed && !context) notFound();

  // The header/context need a MatchDetailResponse; it is present in every non-404
  // path (sealed response carries it; fallback fetched it).
  const detail = sealed?.context ?? context;
  const editionId = detail?.match.edition.id;
  const competitionName = detail?.match.competition.name;
  const homeName = detail?.match.homeTeam.name ?? 'Home';
  const awayName = detail?.match.awayTeam.name ?? 'Away';

  return (
    <main className="space-y-6" style={{ maxWidth: 860, margin: '0 auto', padding: 16 }}>
      {editionId && (
        <nav><Link href={`/v2/editions/${editionId}`} className="label-cap" style={{ color: 'var(--cool)' }}>← {competitionName}</Link></nav>
      )}

      {detail && <MatchHeader context={detail} />}

      {/* SEALED, GOVERNED INTELLIGENCE — evidence-first. Honest unavailable state when unsealed. */}
      {sealed
        ? <SealedIntelligence intelligence={sealed.intelligence} homeName={homeName} awayName={awayName} />
        : <IntelligenceUnavailable />}

      {/* MATCH CONTEXT — strictly separate from the calculation. */}
      {detail && <MatchContext context={detail} />}
    </main>
  );
}
