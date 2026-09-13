export default function V2Loading() {
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }} aria-busy="true">
      <p className="eyebrow">PitchTerminal V2</p>
      <div className="panel" style={{ padding: 24, marginTop: 12 }}>
        <p style={{ color: 'var(--muted)' }}>Loading…</p>
      </div>
    </main>
  );
}
