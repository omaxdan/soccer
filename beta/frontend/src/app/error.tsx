'use client';

/**
 * Route error boundary (audit Phase 4): the old frontend swallowed
 * data-layer failures with `.catch(() => [])`, so an outage rendered as
 * "no matches today". This boundary makes failure a distinct, honest
 * state: empty = "no data", error = "the data layer failed — retry".
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: 12, padding: 24, textAlign: 'center' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, opacity: 0.6, letterSpacing: 1 }}>DATA LAYER ERROR</div>
      <div style={{ fontSize: 15, maxWidth: 480, lineHeight: 1.5 }}>
        This page couldn&apos;t load its data. This is a system failure, not an empty schedule — retrying usually resolves it.
      </div>
      {error?.digest && (
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, opacity: 0.4 }}>ref: {error.digest}</div>
      )}
      <button onClick={() => reset()} style={{ marginTop: 8, padding: '8px 20px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>
        Retry
      </button>
    </div>
  );
}
