import React from "react";
import Link from "next/link";

/**
 * A route that exists so navigation is complete, but has no data behind it yet.
 *
 * It says so plainly rather than showing an empty table or invented rows. A
 * page that looks broken is worse than a page that admits it is not built.
 */
export function Stub({
  title,
  purpose,
  needs,
  instead,
}: {
  title: string;
  purpose: string;
  /** What has to exist before this page can carry real data. */
  needs: string[];
  instead?: { label: string; href: string };
}) {
  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <div className="flex items-center gap-2">
          <h1 className="mono text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
            {title}
          </h1>
          <span
            className="mono rounded px-1.5 py-0.5 text-[0.5rem] font-bold tracking-widest"
            style={{
              color: "var(--warn)",
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
            }}
          >
            NOT BUILT
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-[0.8rem] leading-relaxed text-muted">{purpose}</p>
      </header>

      <section className="panel p-4">
        <h2 className="label-cap mb-2">Before this page can show anything real</h2>
        <ul className="space-y-1">
          {needs.map((n) => (
            <li key={n} className="flex gap-2 text-[0.74rem] leading-relaxed text-muted">
              <span
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full"
                style={{ background: "var(--faint)" }}
              />
              {n}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-faint">
          Nothing is shown here rather than placeholder rows — a fabricated example is worse
          than an empty page on a platform whose argument is that its numbers trace to counts.
        </p>
        {instead && (
          <Link
            href={instead.href}
            className="mono mt-3 inline-block text-[0.66rem] tracking-widest text-amber"
          >
            {instead.label} →
          </Link>
        )}
      </section>
    </div>
  );
}
