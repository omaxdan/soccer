import { notFound } from 'next/navigation';
import { fetchVenue } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { Breadcrumb } from '@/components/v2/nav';
import { VenueHeaderPanel, VenueGeographyPanel, VenueHomeTeamsPanel } from '@/components/v2/entity';

export const dynamic = 'force-dynamic';

export default async function V2VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {slugify(name)}-{id}; venue names are not unique, so the trailing DB
  // id is the mandatory source of truth. The human-readable portion is never consulted.
  const venueId = idFromParam(slug);
  if (venueId === null) notFound();

  const data = await fetchVenue(String(venueId));
  if (!data) notFound();
  const { venue, homeTeams } = data;

  return (
    <main className="space-y-5 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Leagues', href: routes.leagues() }, { label: venue.name }]} />
      <VenueHeaderPanel venue={venue} />
      <VenueGeographyPanel venue={venue} />
      <VenueHomeTeamsPanel homeTeams={homeTeams} />
    </main>
  );
}
