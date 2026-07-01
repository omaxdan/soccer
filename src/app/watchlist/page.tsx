'use client';
import Link from 'next/link';

export default function WatchlistPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>⭐ My Watchlist</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Save matches and teams to monitor</div>
      </div>
      <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⭐</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>Your watchlist is empty</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
          Add matches and teams from the matches list or team pages to track them here.
        </div>
        <Link href="/matches" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--blue)', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600 }}>
          Browse Today&apos;s Matches →
        </Link>
      </div>
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>How it works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {['Browse matches on the Matches page', 'Click the ⭐ icon on any match or team', 'Get alerts when readiness changes significantly', 'Export watchlist data for analysis (Pro)'].map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ width: 20, height: 20, background: 'var(--blue)20', color: 'var(--blue)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
