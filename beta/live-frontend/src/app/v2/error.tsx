'use client';
export default function V2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600 }}>The V2 service is unavailable</p>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>The V2 API could not be reached. Please try again.</p>
        <button onClick={() => reset()} className="label-cap" style={{ marginTop: 14, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--raised)', color: 'var(--text)', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    </main>
  );
}
