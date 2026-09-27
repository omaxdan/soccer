// Route-transition loading state for the Fixtures workspace (shown while the server
// fetches GET /api/v2/fixtures/{date}).
export default function FixturesLoading() {
  return (
    <main aria-busy="true" className="mx-auto w-full max-w-6xl" style={{ padding: 'clamp(16px,3vw,28px) 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <p className="eyebrow" style={{ margin: 0 }}>Fixtures</p>
        <div className="panel" style={{ padding: 24, marginTop: 8 }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>Loading fixtures…</p>
        </div>
      </div>
      <span role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading fixtures</span>
    </main>
  );
}
