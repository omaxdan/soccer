import type { Metadata } from "next";
import Link from "next/link";
import { getBoard } from "@/lib/queries";
import {
  MODULES,
  evaluateMatchModules,
  derivePickSide,
  statusColor,
  type ModuleKey,
} from "@/lib/modules";
import { canSee, currentTier, upgradeTarget } from "@/lib/tier";
import { ModuleIcon, IconLock, IconArrowRight } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Modules",
  description:
    "Twelve intelligence modules. Each answers one betting question from historical patterns — no models, no black box.",
};

export default async function ModuleDirectory() {
  const matches = await getBoard(24);
  const viewer = currentTier();

  // How many fixtures in the current window each match-scope module fires for.
  const counts = new Map<ModuleKey, number>();
  for (const m of matches) {
    const readings = evaluateMatchModules({ match: m, pickSide: derivePickSide(m) });
    for (const r of readings) {
      if (r.status === "inactive") continue;
      counts.set(r.def.key, (counts.get(r.def.key) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <h1 className="mono text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Module directory
        </h1>
        <p className="mt-2 max-w-2xl text-[0.78rem] leading-relaxed text-muted">
          Twelve modules. Each answers exactly one question from historical patterns in the
          match record. Nothing here is a model output — every figure traces to a count of
          finished matches, and every rate is shown with the sample behind it.
        </p>
        <div className="mono mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.62rem] tracking-widest text-faint">
          <span>{MODULES.length} MODULES</span>
          <span>{MODULES.filter((m) => m.tier === "starter").length} FREE</span>
          <span>{matches.length} FIXTURES IN WINDOW</span>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((def) => {
          const unlocked = canSee(def, viewer);
          const fires = counts.get(def.key) ?? null;
          const plan = upgradeTarget(def);
          const accent = unlocked ? "var(--amber)" : "var(--faint)";

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
                <div className="flex items-baseline justify-between">
                  <dt className="label-cap">Firing now</dt>
                  <dd className="mono tnum text-[0.75rem] font-semibold text-text">
                    {def.scope === "match"
                      ? fires != null
                        ? `${fires} fixture${fires === 1 ? "" : "s"}`
                        : "0 fixtures"
                      : "Per team"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="label-cap">Tier</dt>
                  <dd
                    className="mono text-[0.7rem] font-semibold"
                    style={{ color: def.tier === "starter" ? "var(--edge)" : "var(--amber)" }}
                  >
                    {def.tier === "starter" ? "FREE" : def.tier === "pro" ? "PRO" : "PRO+"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="label-cap">Source</dt>
                  <dd className="mono text-[0.65rem] text-faint">{def.source}</dd>
                </div>
              </dl>

              <div className="mt-auto pt-3">
                {unlocked ? (
                  <Link
                    href="/"
                    className="mono inline-flex items-center gap-1.5 text-[0.62rem] tracking-widest text-amber"
                  >
                    VIEW ACTIVATIONS
                    <IconArrowRight size={12} />
                  </Link>
                ) : (
                  <Link
                    href="/pricing"
                    className="mono inline-flex items-center gap-1.5 text-[0.62rem] tracking-widest"
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

      <p className="text-[0.68rem] leading-relaxed text-faint">
        Colour key —{" "}
        <span style={{ color: statusColor("supports") }}>supports the pick</span>,{" "}
        <span style={{ color: statusColor("neutral") }}>neutral</span>,{" "}
        <span style={{ color: statusColor("contradicts") }}>contradicts the pick</span>.
      </p>
    </div>
  );
}
