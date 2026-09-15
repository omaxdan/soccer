import { notFound } from 'next/navigation';
import { fetchCountry } from '@/lib/v2/api';
import { routes } from '@/lib/v2/routes';
import { Breadcrumb } from '@/components/v2/nav';
import { CountryHeaderPanel, CountryCompetitionsPanel, CountryTeamsPanel } from '@/components/v2/entity';

export const dynamic = 'force-dynamic';

export default async function V2CountryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Country is addressed by its ISO alpha-2 code. Normalize to the stored upper-case
  // form and 404 on anything that is not a 2-letter code (a malformed code resolves
  // identically to an unknown one — no separate "unauthorized" interpretation).
  const normalized = decodeURIComponent(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) notFound();

  const data = await fetchCountry(normalized);
  if (!data) notFound();
  const { country, teams, competitions } = data;

  return (
    <main className="space-y-5 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Leagues', href: routes.leagues() }, { label: country.name }]} />
      <CountryHeaderPanel country={country} />
      <CountryCompetitionsPanel competitions={competitions} />
      <CountryTeamsPanel teams={teams} />
    </main>
  );
}
