import Link from 'next/link';
export default function V2NotFound() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
      <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text)', fontWeight: 600 }}>Not found</p>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>This league or match is not available in PitchTerminal V2.</p>
        <p style={{ marginTop: 14 }}><Link href="/v2" className="label-cap" style={{ color: 'var(--cool)' }}>← Back to leagues</Link></p>
      </div>
    </main>
  );
}
