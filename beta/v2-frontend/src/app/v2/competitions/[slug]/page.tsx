import { notFound } from 'next/navigation';
import { fetchCompetition } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { Breadcrumb } from '@/components/v2/nav';
import { CompetitionHeaderPanel, CompetitionEditionsPanel } from '@/components/v2/entity';

export const dynamic = 'force-dynamic';

export default async function V2CompetitionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {competition.slug}-{id}; the trailing DB id is the source of truth.
  // The human-readable portion is never consulted — the API only receives the id.
  const competitionId = idFromParam(slug);
  if (competitionId === null) notFound();

  const data = await fetchCompetition(String(competitionId));
  if (!data) notFound();
  const { competition, editions } = data;

  return (
    <main className="space-y-5 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Leagues', href: routes.leagues() }, { label: competition.name }]} />
      <CompetitionHeaderPanel competition={competition} />
      <CompetitionEditionsPanel editions={editions} />
    </main>
  );
}
