import type { Metadata } from 'next';
import Link from 'next/link';
import { routes } from '@/lib/v2/routes';

// Fixtures root (/fixtures) — navigation-contract placeholder ONLY.
//
// This establishes the /fixtures route so the global header's Fixtures link is real
// (not a 404). The fixtures-by-date WORKSPACE — the two-column date/list + selected
// fixture, the date navigation, and the /api/v2/fixtures/:date fetch — is Phase C and
// is deliberately NOT implemented here. Until then this offers the interim path:
// browse fixtures by competition.
export const metadata: Metadata = { title: 'Fixtures' };

export default function FixturesRoot() {
  return (
    <main className="space-y-4 mx-auto w-full max-w-6xl px-4 py-4">
      <div>
        <p className="eyebrow">Fixtures</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>Fixtures</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>The fixtures-by-date workspace is arriving next.</p>
      </div>
      <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: 0 }}>In the meantime, browse matches by competition.</p>
        <Link href={routes.leagues()} className="label-cap" style={{ color: 'var(--cool)' }}>Browse competitions →</Link>
      </div>
    </main>
  );
}
