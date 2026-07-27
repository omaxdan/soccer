import Link from "next/link";
import { getViewerIdentity } from "@/lib/access";
import { getLeagues } from "@/lib/queries";
import { getFavouriteLeagueIds } from "@/lib/preferences";
import { FavouriteLeagues } from "@/components/FavouriteLeagues";
import { IconLock, IconUnverified, IconSupports } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/**
 * Personal settings only.
 *
 * The subscription feature flag, the enable toggle and the feature-gate table
 * used to live here. They are platform controls, not preferences, and showing
 * a normal user a switch labelled "TESTING MODE · OFF" tells them about the
 * business's internal state while giving them nothing they can act on. They
 * now live behind /admin/settings.
 */
export default async function SettingsPage() {
  const [identity, leagues, favIds] = await Promise.all([
    getViewerIdentity(),
    getLeagues(),
    getFavouriteLeagueIds(),
  ]);

  if (!identity.authenticated) {
    return (
      <div className="panel mx-auto max-w-lg p-6 text-center">
        <span className="text-faint">
          <IconLock size={20} />
        </span>
        <h1 className="mono mt-2 text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Sign in to manage settings
        </h1>
        <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">
          Accounts are optional while PitchTerminal is in open beta — every module is
          currently available without one.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link href="/login" className="mono text-[0.64rem] tracking-widest text-amber">
            SIGN IN →
          </Link>
          <Link href="/app" className="mono text-[0.64rem] tracking-widest text-muted">
            CONTINUE BROWSING →
          </Link>
        </div>
      </div>
    );
  }

  const plan = (identity.plan ?? "free").toUpperCase();
  const isPro = plan === "PRO";
  const renewal = identity.subscriptionExpiresAt
    ? new Date(identity.subscriptionExpiresAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-0">
      <span className="label-cap">{label}</span>
      <span className="mono text-[0.76rem] text-text">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">Account</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
      </header>

      {/* Account */}
      <section className="panel p-5">
        <h2 className="mono mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Account
        </h2>
        <Row label="Name" value={identity.displayName ?? "—"} />
        <Row label="Email" value={identity.email ?? "—"} />
        <Row
          label="Signed in with"
          value={(identity.provider ?? "email").replace(/^\w/, (c) => c.toUpperCase())}
        />
        <Row
          label="Status"
          value={
            <span style={{ color: "var(--edge)" }}>
              Active{identity.isAdmin ? " · Admin" : ""}
            </span>
          }
        />
      </section>

      {/* Subscription */}
      <section className="panel p-5">
        <h2 className="mono mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Subscription
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="mono rounded px-2 py-0.5 text-[0.62rem] font-bold tracking-widest"
            style={{
              color: isPro ? "var(--amber)" : "var(--edge)",
              background: `color-mix(in srgb, ${isPro ? "var(--amber)" : "var(--edge)"} 14%, transparent)`,
            }}
          >
            {plan}
          </span>
          {identity.subscriptionStatus && (
            <span className="mono text-[0.66rem] text-muted">
              {identity.subscriptionStatus.toUpperCase()}
            </span>
          )}
        </div>

        {isPro ? (
          <>
            <div className="mt-3">
              <Row label="Price" value="$19 / month" />
              <Row label="Renews" value={renewal ?? "—"} />
            </div>
            <p className="mt-3 text-[0.7rem] leading-relaxed text-faint">
              Billing management and cancellation arrive with the payment provider. No card is
              on file and nothing is being charged.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-[0.74rem] leading-relaxed text-muted">
              You have the open modules and full match discovery. Pro adds the remaining
              intelligence modules and the complete evidence breakdown.
            </p>
            <Link
              href="/subscription"
              className="mono mt-3 inline-block rounded-term px-3 py-2 text-[0.64rem] font-semibold tracking-widest"
              style={{ color: "var(--ink)", background: "var(--amber)" }}
            >
              COMPARE PLANS →
            </Link>
          </>
        )}
      </section>

      {/* Favourites */}
      <section className="panel p-5">
        <h2 className="mono mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Favourite leagues
        </h2>
        <FavouriteLeagues
          leagues={leagues
            .filter((l) => l.tournament)
            .map((l) => ({
              id: l.tournament_id,
              name: l.tournament!.name,
              country:
                typeof l.tournament!.country === "string"
                  ? l.tournament!.country
                  : (l.tournament!.country as { name?: string } | null)?.name ?? null,
            }))}
          initial={favIds}
        />
      </section>

      {/* Notifications */}
      <section className="panel p-5">
        <h2 className="mono mb-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Notifications
        </h2>
        <p className="text-[0.74rem] leading-relaxed text-muted">
          Alerts when a fixture&rsquo;s consensus shifts, or when a module changes direction
          close to kickoff.
        </p>
        <p className="mono mt-2 flex items-center gap-1.5 text-[0.62rem]" style={{ color: "var(--warn)" }}>
          <IconUnverified size={11} />
          NOT YET AVAILABLE
        </p>
        <p className="mt-1 text-[0.68rem] leading-relaxed text-faint">
          Needs a delivery channel and a record of what changed between runs. Neither exists.
        </p>
      </section>

      {/* Actions */}
      <section className="panel p-5">
        <h2 className="mono mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text">
          Account actions
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/logout" className="mono text-[0.66rem] tracking-widest" style={{ color: "var(--risk)" }}>
            SIGN OUT →
          </Link>
          <span className="mono flex items-center gap-1.5 text-[0.64rem] text-faint">
            <IconSupports size={11} />
            Signed in as {identity.email}
          </span>
        </div>
      </section>
    </div>
  );
}
