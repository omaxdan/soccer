import type { Metadata } from 'next';
import Link from 'next/link';
import { FixturesWorkspace } from '@/components/v2/fixtures';
import { loadFixturesProps } from '@/lib/v2/fixturesData';
import { isValidCalendarDate, todayUtc } from '@/lib/v2/fixtures';
import { routes } from '@/lib/v2/routes';

// Fixtures for a specific UTC calendar date (/fixtures/YYYY-MM-DD). The date is the
// same UTC-calendar semantics as GET /api/v2/fixtures/{date} — never a local-timezone
// conversion. A malformed/unreal date is not fetched; it renders the honest invalid
// state (no silent fall-through to "today").
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  return { title: isValidCalendarDate(date) ? `Fixtures · ${date}` : 'Fixtures · invalid date' };
}

export default async function FixturesByDate({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  if (!isValidCalendarDate(date)) {
    return (
      <main className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px' }}>
        <div role="alert" className="panel" style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span aria-hidden style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--warn)', borderRadius: 4, font: "700 13px 'JetBrains Mono',monospace", color: 'var(--warn)' }}>?</span>
          <h1 style={{ margin: 0, font: '600 15px Inter,sans-serif', color: 'var(--text)' }}>Invalid date</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>“{date}” is not a valid calendar date (expected YYYY-MM-DD).</p>
          <Link href={routes.fixtures(todayUtc())} className="mono" style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 14px', background: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 4, fontSize: 10, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink)', textDecoration: 'none' }}>Go to today</Link>
        </div>
      </main>
    );
  }

  const props = await loadFixturesProps(date);
  return <FixturesWorkspace {...props} />;
}
