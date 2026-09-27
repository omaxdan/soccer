import type { Metadata } from 'next';
import { FixturesWorkspace } from '@/components/v2/fixtures';
import { loadFixturesProps } from '@/lib/v2/fixturesData';
import { todayUtc } from '@/lib/v2/fixtures';

// Fixtures root (/fixtures) — the clean canonical entry. It shows the CURRENT UTC
// calendar date (the API's timezone), without redirecting to /fixtures/today. When a
// user picks a specific date, the URL becomes /fixtures/YYYY-MM-DD.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Fixtures' };

export default async function FixturesRoot() {
  const props = await loadFixturesProps(todayUtc());
  return <FixturesWorkspace {...props} />;
}
