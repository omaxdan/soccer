import type { Metadata } from "next";
import Link from "next/link";
import { getModuleViewCounts, getUpcomingFixtureCount } from "@/lib/queries";
import { MODULES, countUnit, moduleSlug, statusColor } from "@/lib/modules";
import { canSee, currentTier, upgradeTarget } from "@/lib/tier";
import {
  ModuleIcon,
  IconLock,
  IconArrowRight,
  IconUnverified,
} from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Modules",
  description:
    "Twelve intelligence modules. Each answers one betting question from historical patterns — no models, no black box.",
};

export default async function ModuleDirectory() {
  const [counts, fixtureCount] = await Promise.all([
    getModuleViewCounts(),
    getUpcomingFixtureCount(3),
  ]);
  const viewer = currentTier();

  const freeCount = MODULES.filter((m) => m.tier === "starter").length;
  const unreadable = MODULES.filter((m) => counts[m.key]?.count == null);

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <h1 className="mono text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Module directory
        </h1>
        <p className="mt-2 max-w-2xl text-[0.78rem] leading-relaxed text-muted">
          Twelve modules. Each answers exactly one question from historical patterns in the
          match record. Nothing here is a model output — every figure traces to a count of
          finished matches.
        </p>
        <div className="mono mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.62rem] tracking-widest text-faint">
          <span>{MODULES.length} MODULES</span>
          <span style={{ color: "var(--edge)" }}>{freeCount} FREE</span>
          <span>
            {fixtureCount != null
              ? `${fixtureCount.toLocaleString()} FIXTURES IN 3-DAY WINDOW`
              : "FIXTURE WINDOW UNAVAILABLE"}
          </span>
        </div>
      </header>

      {unreadable.length > 0 && (
        <div
          className="panel flex items-start gap-2.5 p-4"
          style={{ borderColor: "color-mix(in srgb, var(--warn) 30%, var(--line))" }}
        >
          <span className="mt-0.5" style={{ color: "var(--warn)" }}>
            <IconUnverified size={15} />
          </span>
          <div>
            <p className="mono text-[0.7rem] font-semibold" style={{ color: "var(--warn)" }}>
              {unreadable.length} view{unreadable.length === 1 ? "" : "s"} could not be read
            </p>
            <p className="mt-1 text-[0.68rem] leading-relaxed text-muted">
              {unreadable.map((m) => m.source).join(", ")}. A materialized view that exists but
              has no <span className="mono">GRANT SELECT</span> to the anon role is invisible to
              PostgREST — that is the usual cause. Counts show as — rather than 0, because
              &ldquo;unknown&rdquo; and &ldquo;none&rdquo; are not the same answer.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((def) => {
          const unlocked = canSee(def, viewer);
          const row = counts[def.key];
          const n = row?.count ?? null;
          const plan = upgradeTarget(def);
          const accent = unlocked ? "var(--amber)" : "var(--faint)";
          const isFree = def.tier === "starter";

          return (
            <article key={def.key} className="panel flex flex-col p-4">
              <header className="flex items-start gap-2.5">
                <span className="mt-0.5" style={{ color: accent }}>
                  <ModuleIcon moduleKey={def.key} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mono text-[0.58rem] tracking-[0.14em] text-faint">
                    MODULE {def.n} · {def.scope.toUpperCase()}
                  </div>
                  <h2 className="mono text-[0.8rem] font-semibold tracking-tight text-text">
                    {def.name}
                  </h2>
                </div>
                {!unlocked && (
                  <span className="text-faint">
                    <IconLock size={14} />
                  </span>
                )}
              </header>

              <p className="mt-2 text-[0.73rem] leading-relaxed text-muted">{def.question}</p>

              <dl className="mt-3 space-y-1.5 border-t border-line pt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="label-cap">Firing now</dt>
                  <dd className="mono tnum text-[0.75rem] font-semibold text-text">
                    {n != null ? (
                      <>
                        {n.toLocaleString()}{" "}
                        <span className="font-normal text-faint">{countUnit(def, n)}</span>
                      </>
                    ) : (
                      <span className="text-faint" title={row?.error ?? "unavailable"}>
                        —
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="label-cap">Tier</dt>
                  <dd>
                    <span
                      className="mono rounded px-1.5 py-0.5 text-[0.58rem] font-bold tracking-widest"
                      style={{
                        color: isFree ? "var(--edge)" : "var(--amber)",
                        background: `color-mix(in srgb, ${
                          isFree ? "var(--edge)" : "var(--amber)"
                        } 14%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${
                          isFree ? "var(--edge)" : "var(--amber)"
                        } 32%, transparent)`,
                      }}
                    >
                      {isFree ? "FREE" : def.tier === "pro" ? "PRO" : "PRO+"}
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="label-cap">Source</dt>
                  <dd className="mono truncate text-[0.62rem] text-faint" title={def.source}>
                    {def.source}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto pt-3">
                {unlocked ? (
                  <Link
                    href={`/?module=${moduleSlug(def)}`}
                    className="mono inline-flex items-center gap-1.5 text-[0.62rem] tracking-widest text-amber transition-opacity hover:opacity-75"
                  >
                    VIEW ACTIVATIONS
                    <IconArrowRight size={12} />
                  </Link>
                ) : (
                  <Link
                    href="/pricing"
                    className="mono inline-flex items-center gap-1.5 text-[0.62rem] tracking-widest transition-opacity hover:opacity-75"
                    style={{ color: "var(--faint)" }}
                  >
                    UNLOCK WITH {plan.name.toUpperCase()}
                    <IconArrowRight size={12} />
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* MODULE_COUNT_CAVEAT */}
      <p className="text-[0.68rem] leading-relaxed text-faint">
        &ldquo;Firing now&rdquo; is the row count of each module&rsquo;s view. The dashboard
        evaluates modules from the base tables rather than these views, so a filtered feed can
        show a different number — the view&rsquo;s WHERE clause and the evaluator&rsquo;s
        null-checks are not the same rule.
      </p>

      <p className="text-[0.68rem] leading-relaxed text-faint">
        Colour key —{" "}
        <span style={{ color: statusColor("supports") }}>supports the pick</span>,{" "}
        <span style={{ color: statusColor("neutral") }}>neutral</span>,{" "}
        <span style={{ color: statusColor("contradicts") }}>contradicts the pick</span>.
      </p>
    </div>
  );
}
