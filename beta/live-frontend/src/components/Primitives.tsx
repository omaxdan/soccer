import React from "react";
import { IconHomeAway, IconSupports } from "./icons/ModuleIcons";
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
          className="mono grid h-4 w-4 shrink-0 place-items-center rounded-[3px] text-[0.6rem] font-bold leading-none"
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

// ── Form Index Pick badge (BANKER/STRONG from the daily betting card) ────
export function PickBadge({
  tier,
  compact = false,
}: {
  tier: "BANKER" | "STRONG" | null | undefined;
  compact?: boolean;
}) {
  if (tier !== "BANKER" && tier !== "STRONG") return null;
  const isBanker = tier === "BANKER";
  const color = isBanker ? "var(--edge)" : "var(--amber)";
  return (
    <span
      className="mono inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.55rem] font-bold tracking-wide"
      style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
      title={isBanker ? "Form Index Pick — Banker" : "Form Index Pick — Strong"}
    >
      {/* Was an emoji pair. The icon set is stroke SVG inheriting currentColor,
          so these take the badge's own colour instead of the platform's. */}
      <span aria-hidden="true" className="inline-flex">
        {isBanker ? <IconHomeAway size={10} /> : <IconSupports size={10} />}
      </span>
      {!compact && tier}
    </span>
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
