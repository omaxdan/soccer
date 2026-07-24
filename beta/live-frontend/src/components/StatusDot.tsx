export function StatusDot({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-1.5 rounded-full animate-pulse-dot"
        style={{ background: live ? "var(--edge)" : "var(--amber)" }}
        aria-hidden
      />
      <span className="mono text-[0.6rem] tracking-widest uppercase text-muted">
        {live ? "Live feed" : "Demo feed"}
      </span>
    </span>
  );
}
