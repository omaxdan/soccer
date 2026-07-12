import React from "react";
import { Explain } from "./Explain";
import type { GlossaryKey } from "@/lib/glossary";

// ── Recent form string (W/D/L) ───────────────────────────
export function FormString({ results }: { results: string | null | undefined }) {
  if (!results) return <span className="text-faint">—</span>;
  const map: Record<string, string> = {
    W: "var(--edge)",
    D: "var(--warn)",
    L: "var(--risk)",
  };
  return (
    <span className="flex gap-1">
      {results.split("").map((r, i) => (
        <span
          key={i}
          className="mono grid h-4 w-4 place-items-center rounded-[3px] text-[0.6rem] font-bold"
          style={{
            color: map[r] ?? "var(--muted)",
            background: `color-mix(in srgb, ${map[r] ?? "var(--muted)"} 16%, transparent)`,
          }}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

// ── Labelled stat cell ───────────────────────────────────
export function StatCell({
  label,
  value,
  sub,
  color,
  explain,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  explain?: GlossaryKey;
}) {
  return (
    <div>
      <div className="label-cap flex items-center">{label}{explain && <Explain metric={explain} />}</div>
      <div className="mono mt-0.5 text-lg font-semibold tnum" style={{ color: color ?? "var(--text)" }}>
        {value}
      </div>
      {sub != null && <div className="text-[0.65rem] text-muted">{sub}</div>}
    </div>
  );
}

// ── Section with terminal eyebrow header ─────────────────
export function Section({
  index,
  title,
  action,
  children,
  className = "",
}: {
  index?: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-4 ${className}`}>
      <header className="mb-3 flex items-center gap-2">
        {index && (
          <span className="mono text-[0.6rem] font-semibold text-amber">{index}</span>
        )}
        <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
          {title}
        </h2>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}
