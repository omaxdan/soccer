// Shared loading skeleton for route-level loading.tsx files.
export function PageSkeleton({ label = "Loading intelligence" }: { label?: string }) {
  return (
    <div className="space-y-4 animate-fade-up" aria-busy="true">
      <div className="panel p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-raised" />
        <div className="mt-4 h-8 w-3/4 animate-pulse rounded bg-raised" />
        <div className="mt-4 h-2 w-full animate-pulse rounded bg-raised" />
      </div>
      <div className="no-scrollbar flex gap-1 border-b border-line py-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-6 w-20 shrink-0 animate-pulse rounded-md bg-raised" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel-raised p-3">
            <div className="h-2 w-12 animate-pulse rounded bg-raised" />
            <div className="mt-2 h-6 w-10 animate-pulse rounded bg-raised" />
          </div>
        ))}
      </div>
      <div className="panel p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-3 w-full animate-pulse rounded bg-raised" />
        ))}
      </div>
      <p className="mono text-center text-[0.6rem] text-faint">{label}…</p>
    </div>
  );
}
