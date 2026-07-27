import React from "react";
import Link from "next/link";
import { canAccessFeature, type AccessContext, type FeatureKey } from "@/lib/access";
import { IconLock } from "./icons/ModuleIcons";

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
