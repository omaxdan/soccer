import Link from "next/link";
import { getAccessContext } from "@/lib/access";
import { MODULES } from "@/lib/modules";
import { IconSupports } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription" };

const FREE_MODULES = ["home_away", "travel", "league_goals", "form_gap", "confidence"];

export default async function SubscriptionPage() {
  const ctx = await getAccessContext();
  const free = MODULES.filter((m) => FREE_MODULES.includes(m.key));

  const plans = [
    {
      name: "Free",
      price: "Free",
      blurb: "Match discovery and the open intelligence modules.",
      features: [
        "Match and fixture discovery",
        `${free.length} of ${MODULES.length} intelligence modules`,
        "Consensus, historical lean and confidence band",
        "Sample sizes and intervals on every rate",
      ],
      featured: false,
    },
    {
      name: "Pro",
      price: "$19",
      blurb: "The full intelligence engine.",
      features: [
        `All ${MODULES.length} modules`,
        "Full evidence breakdown per fixture",
        "Advanced historical patterns and market profiles",
        "Player intelligence and predicted lineups",
        "Complete match reports",
      ],
      featured: true,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="panel p-6">
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Subscription</h1>
        <p className="mt-2 max-w-2xl text-[0.82rem] leading-relaxed text-muted">
          Access to intelligence depth. Basic football information stays open.
        </p>
        <p className="mono mt-3 text-[0.68rem] text-muted">
          {ctx.authenticated
            ? `Your plan: ${(ctx.plan ?? "free").toUpperCase()}${ctx.isAdmin ? " · ADMIN" : ""}`
            : "Create an account to manage access."}
        </p>
        {/* No feature-flag state here: what the platform's internal switch is
            set to is not a user-facing fact. The same sentence is said in
            product terms below instead. */}
        {!ctx.subscriptionsEnabled && (
          <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">
            Every module is currently available to everyone while PitchTerminal is in open
            beta.
          </p>
        )}
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {plans.map((p) => (
          <article
            key={p.name}
            className={p.featured ? "panel-raised p-5" : "panel p-5"}
            style={
              p.featured
                ? { borderColor: "color-mix(in srgb, var(--amber) 32%, var(--line))" }
                : undefined
            }
          >
            <h2 className="mono text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-text">
              {p.name}
            </h2>
            <div className="mono mt-3 flex items-baseline gap-1">
              <span className="tnum text-3xl font-semibold text-text">{p.price}</span>
              {p.featured && <span className="text-[0.7rem] text-faint">/month</span>}
            </div>
            <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{p.blurb}</p>
            <ul className="mt-4 space-y-2 border-t border-line pt-4">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5" style={{ color: "var(--edge)" }}>
                    <IconSupports size={12} />
                  </span>
                  <span className="text-[0.74rem] leading-relaxed text-text">{f}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <section className="panel p-5">
        <h2 className="label-cap mb-2">Included on Free</h2>
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {free.map((m) => (
            <li key={m.key} className="text-[0.72rem] text-text">
              {m.name}
              <span className="block text-[0.64rem] text-faint">{m.question}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[0.68rem] leading-relaxed text-faint">
        Payments are not connected. Plans are defined and permissions are configured, but
        nothing is charged and no account is required while the platform is in beta.{" "}
        <Link href="/method" className="text-amber underline underline-offset-2">
          How the intelligence works
        </Link>
        .
      </p>
    </div>
  );
}
