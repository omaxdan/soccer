import type { Metadata } from "next";
import Link from "next/link";
import { PLANS } from "@/lib/tier";
import { MODULES } from "@/lib/modules";
import {
  ModuleIcon,
  IconSupports,
  IconArrowRight,
  IconGate,
} from "@/components/icons/ModuleIcons";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Twelve intelligence modules for football bettors. Free tier includes five modules and three picks a day.",
};

export default function PricingPage() {
  const starterModules = MODULES.filter((m) => m.tier === "starter");

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <h1 className="mono text-[0.9rem] font-semibold uppercase tracking-[0.16em] text-text">
          Pricing
        </h1>
        <p className="mt-2 max-w-2xl text-[0.82rem] leading-relaxed text-muted">
          Twelve modules, each answering one question from the historical match record.
          Every rate we publish carries its sample size and confidence interval — including
          the ones that make us look worse.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const featured = plan.id === "pro";
          return (
            <article
              key={plan.id}
              className={featured ? "panel-raised p-4" : "panel p-4"}
              style={
                featured
                  ? { borderColor: "color-mix(in srgb, var(--amber) 32%, var(--line))" }
                  : undefined
              }
            >
              <div className="flex items-baseline gap-2">
                <h2 className="mono text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-text">
                  {plan.name}
                </h2>
                {featured && (
                  <span
                    className="mono rounded px-1.5 py-0.5 text-[0.52rem] font-bold tracking-widest"
                    style={{
                      color: "var(--amber)",
                      background: "color-mix(in srgb, var(--amber) 14%, transparent)",
                    }}
                  >
                    MOST USED
                  </span>
                )}
              </div>

              <div className="mono mt-3 flex items-baseline gap-1">
                <span className="tnum text-3xl font-semibold text-text">
                  {plan.priceMonthly === 0 ? "Free" : `$${plan.priceMonthly}`}
                </span>
                {plan.priceMonthly > 0 && (
                  <span className="text-[0.7rem] text-faint">/month</span>
                )}
              </div>

              <p className="mt-2 text-[0.73rem] leading-relaxed text-muted">{plan.blurb}</p>

              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5" style={{ color: "var(--edge)" }}>
                      <IconSupports size={12} />
                    </span>
                    <span className="text-[0.73rem] leading-relaxed text-text">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.priceMonthly === 0 ? "/" : "/pricing"}
                className="mono mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-term py-2 text-[0.65rem] font-semibold tracking-widest transition-colors"
                style={{
                  color: featured ? "var(--ink)" : "var(--amber)",
                  background: featured ? "var(--amber)" : "transparent",
                  border: featured
                    ? "1px solid var(--amber)"
                    : "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
                }}
              >
                {plan.priceMonthly === 0 ? "START FREE" : `CHOOSE ${plan.name.toUpperCase()}`}
                <IconArrowRight size={12} />
              </Link>
            </article>
          );
        })}
      </div>

      {/* What free actually gets you */}
      <section className="panel p-4">
        <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
          Included on the free tier
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {starterModules.map((m) => (
            <li key={m.key} className="flex items-start gap-2">
              <span className="mt-0.5 text-amber">
                <ModuleIcon moduleKey={m.key} size={15} />
              </span>
              <div>
                <div className="mono text-[0.72rem] font-semibold text-text">
                  M{m.n} · {m.name}
                </div>
                <div className="text-[0.66rem] text-faint">{m.question}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Honest footing */}
      <section className="panel p-4">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-warn">
            <IconGate size={15} />
          </span>
          <div>
            <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
              What we do not claim
            </h2>
            <p className="mt-2 max-w-3xl text-[0.73rem] leading-relaxed text-muted">
              PitchTerminal reports historical frequencies. It does not predict results, does
              not price markets, and does not tell you what to stake. A published rate means
              only that this pattern held at that frequency in the matches we counted, within
              the interval shown. Rules that fall below our sample gate are marked, not hidden.
              Betting involves risk of loss.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
