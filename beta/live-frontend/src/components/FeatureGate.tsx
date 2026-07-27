import React from "react";
import Link from "next/link";
import { canAccessFeature, type AccessContext, type FeatureKey } from "@/lib/access";
import { IconLock, IconArrowRight, IconSupports } from "./icons/ModuleIcons";
import { ModuleIcon } from "./icons/ModuleIcons";
import type { ModuleDef } from "@/lib/modules";

/**
 * Wraps Pro content. While subscriptions are disabled this renders children
 * unconditionally, so the component can be adopted everywhere now and starts
 * doing something the day the flag flips.
 *
 * The locked state describes what is behind it rather than hiding that it
 * exists — someone deciding whether to upgrade needs to know what they would
 * be getting.
 */
export function FeatureGate({
  feature,
  ctx,
  title,
  summary,
  children,
}: {
  feature: FeatureKey | string;
  ctx: AccessContext;
  /** Shown on the locked card so the reader knows what is gated. */
  title: string;
  summary?: string;
  children: React.ReactNode;
}) {
  if (canAccessFeature(ctx, feature)) return <>{children}</>;
  return <LockedFeature title={title} summary={summary} />;
}

export function LockedFeature({ title, summary }: { title: string; summary?: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <span className="text-faint">
          <IconLock size={14} />
        </span>
        <span className="mono text-[0.58rem] font-semibold tracking-widest text-faint">
          PRO INTELLIGENCE
        </span>
      </div>
      <h3 className="mono mt-1.5 text-[0.8rem] font-semibold text-text">{title}</h3>
      {summary && (
        <p className="mt-1 text-[0.72rem] leading-relaxed text-muted">{summary}</p>
      )}
      <Link
        href="/subscription"
        className="mono mt-3 inline-block text-[0.62rem] tracking-widest"
        style={{ color: "var(--amber)" }}
      >
        SEE PLANS →
      </Link>
    </div>
  );
}


/** What a locked module would show, stated as evidence rather than as a pitch. */
const UNLOCKS = [
  "Historical rate for this scenario",
  "Sample size behind it",
  "95% confidence interval",
  "Match-specific evidence",
];

/**
 * A locked module, written to inform rather than to sell.
 *
 * It names the question the module answers and the evidence Pro adds, so a
 * reader can judge whether that is worth paying for. The alternative — a bare
 * "Available on Pro" — tells someone only that they are being kept out, which
 * reads as the platform hiding football rather than offering depth.
 */
export function LockedModuleCard({ defs }: { defs: ModuleDef[] }) {
  return (
    <article
      className="panel p-4"
      style={{ borderColor: "color-mix(in srgb, var(--amber) 22%, var(--line))" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--amber)" }}>
          <IconLock size={13} />
        </span>
        <h3 className="mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Available with Pro
        </h3>
      </div>

      <ul className="mt-2.5 grid gap-x-5 gap-y-1 sm:grid-cols-2">
        {defs.map((d) => (
          <li key={d.key} className="flex items-start gap-1.5 text-[0.74rem] text-text">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--edge)" }}>
              <IconSupports size={10} />
            </span>
            <span className="min-w-0">
              {d.name}
              <span className="block text-[0.64rem] leading-snug text-faint">{d.question}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-line pt-2.5">
        <p className="label-cap mb-1">Each adds</p>
        <p className="text-[0.7rem] leading-relaxed text-muted">
          {UNLOCKS.join(" · ")}
        </p>
      </div>

      <Link
        href="/subscription"
        className="mono mt-3 inline-flex items-center gap-1.5 rounded-term px-2.5 py-1.5 text-[0.62rem] font-semibold tracking-widest"
        style={{ color: "var(--ink)", background: "var(--amber)" }}
      >
        UPGRADE TO PRO
        <IconArrowRight size={11} />
      </Link>
    </article>
  );
}

/** A single locked module in the list beneath the card. */
export function LockedRow({ def }: { def: ModuleDef }) {
  return (
    <li className="flex items-center gap-2 rounded-term px-2 py-1.5" style={{ background: "var(--raised)" }}>
      <span className="text-faint">
        <ModuleIcon moduleKey={def.key} size={13} />
      </span>
      <span className="mono min-w-0 flex-1 truncate text-[0.72rem] text-muted">{def.name}</span>
      <span
        className="mono shrink-0 rounded px-1.5 py-0.5 text-[0.5rem] font-bold tracking-widest"
        style={{ color: "var(--amber)", background: "color-mix(in srgb, var(--amber) 12%, transparent)" }}
      >
        PRO
      </span>
    </li>
  );
}

/**
 * Sits directly under the Instant Verdict, so the value case appears before a
 * reader scrolls the whole report rather than after it.
 */
export function ProTeaser({ lockedCount }: { lockedCount: number }) {
  return (
    <section
      className="panel p-4"
      style={{ borderColor: "color-mix(in srgb, var(--amber) 22%, var(--line))" }}
    >
      <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Full intelligence report
      </h2>
      <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">
        See why this fixture leans the way it does. {lockedCount} further evidence streams are
        counted in this reading but not shown in full.
      </p>
      <ul className="mt-2 grid gap-x-5 gap-y-0.5 sm:grid-cols-2">
        {[
          "Evidence breakdown",
          "Confidence calibration",
          "Module agreement",
          "Historical samples",
          "Risk factors",
        ].map((f) => (
          <li key={f} className="flex items-center gap-1.5 text-[0.72rem] text-text">
            <span style={{ color: "var(--edge)" }}>
              <IconSupports size={10} />
            </span>
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/subscription"
        className="mono mt-3 inline-flex items-center gap-1.5 rounded-term px-2.5 py-1.5 text-[0.62rem] font-semibold tracking-widest"
        style={{ color: "var(--ink)", background: "var(--amber)" }}
      >
        UPGRADE TO PRO
        <IconArrowRight size={11} />
      </Link>
    </section>
  );
}

/**
 * Placed after the evidence scorecard for Free viewers. Deliberately styled as
 * a panel like everything else on the page rather than a banner — it is a
 * product unlock, not an advertisement interrupting the report.
 */
export function UpgradePrompt({ moduleCount, lockedCount }: { moduleCount: number; lockedCount: number }) {
  return (
    <section className="panel p-5">
      <h2 className="mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
        Want to understand why this pattern exists?
      </h2>
      <p className="mt-2 max-w-2xl text-[0.76rem] leading-relaxed text-muted">
        {lockedCount} of {moduleCount} evidence streams are counted in the consensus above but
        not shown in full on this tier. Pro opens the working behind them.
      </p>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {[
          `All ${moduleCount} intelligence modules`,
          "Full evidence breakdown per fixture",
          "Historical samples and confidence intervals",
          "Player intelligence and predicted lineups",
        ].map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-[0.74rem] text-text">
            <span className="mt-0.5 shrink-0" style={{ color: "var(--edge)" }}>
              <IconSupports size={11} />
            </span>
            {f}
          </li>
        ))}
      </ul>
      <Link
        href="/subscription"
        className="mono mt-4 inline-flex items-center gap-1.5 rounded-term px-3 py-2 text-[0.64rem] font-semibold tracking-widest"
        style={{ color: "var(--ink)", background: "var(--amber)" }}
      >
        UPGRADE TO PRO
        <IconArrowRight size={12} />
      </Link>
    </section>
  );
}
