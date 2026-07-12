import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
      <p className="mono text-4xl font-bold text-amber">404</p>
      <p className="mono mt-2 text-[0.7rem] uppercase tracking-widest text-muted">
        No signal on this route
      </p>
      <p className="mt-3 max-w-xs text-[0.8rem] leading-relaxed text-muted">
        The fixture or page you&rsquo;re after isn&rsquo;t on the board. It may
        have kicked off already or never been tracked.
      </p>
      <Link
        href="/"
        className="mono mt-5 rounded-term border border-amber px-4 py-2 text-[0.7rem] font-semibold tracking-wide text-amber transition-colors hover:bg-amber hover:text-ink"
      >
        Back to the board
      </Link>
    </div>
  );
}
