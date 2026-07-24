// Native <details>/<summary> disclosure — no client JS needed, so server
// components (league/leagues pages) can use it directly. Defaults closed;
// styled to match the Section eyebrow-header convention elsewhere.
export function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="panel group p-4" open={defaultOpen}>
      <summary className="mono flex cursor-pointer list-none items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-faint transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}
