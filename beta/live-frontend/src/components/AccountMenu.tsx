import React from "react";
import Link from "next/link";
import type { ViewerIdentity } from "@/lib/access";

/**
 * Native <details>, so the menu needs no client JavaScript and the shell stays
 * a server component. Avatar falls back to an initial: a Google account may
 * grant email without picture scope, and a broken image is worse than a letter.
 */
export function AccountMenu({ identity }: { identity: ViewerIdentity }) {
  if (!identity.authenticated) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="mono rounded-term px-2.5 py-1.5 text-[0.62rem] tracking-widest text-muted transition-colors hover:text-text"
        >
          LOG IN
        </Link>
        <Link
          href="/signup"
          className="mono rounded-term px-2.5 py-1.5 text-[0.62rem] font-semibold tracking-widest"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          SIGN UP
        </Link>
      </div>
    );
  }

  const name = identity.displayName || identity.email?.split("@")[0] || "Account";
  const initial = name.charAt(0).toUpperCase();
  const tier = (identity.plan ?? "free").toUpperCase();

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-term px-1.5 py-1 transition-colors hover:bg-raised [&::-webkit-details-marker]:hidden">
        {identity.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={identity.avatarUrl}
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="mono flex h-6 w-6 items-center justify-center rounded-full text-[0.62rem] font-semibold"
            style={{ background: "var(--raised)", color: "var(--amber)" }}
          >
            {initial}
          </span>
        )}
        <span className="hidden min-w-0 flex-col text-left sm:flex">
          <span className="mono truncate text-[0.66rem] leading-tight text-text">{name}</span>
          <span
            className="mono text-[0.5rem] leading-tight tracking-widest"
            style={{ color: identity.isAdmin ? "var(--amber)" : "var(--faint)" }}
          >
            {identity.isAdmin ? "ADMIN" : tier}
          </span>
        </span>
      </summary>

      <div className="panel absolute right-0 z-30 mt-1 min-w-[11rem] p-1">
        <p className="mono truncate px-2 py-1.5 text-[0.58rem] text-faint">{identity.email}</p>
        <div className="my-1 h-px bg-line" />
        {[
          { href: "/settings", label: "Profile" },
          { href: "/subscription", label: "Subscription" },
          ...(identity.isAdmin ? [{ href: "/admin/settings", label: "Admin" }] : []),
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="mono block rounded-term px-2 py-1.5 text-[0.66rem] text-muted transition-colors hover:bg-raised hover:text-text"
          >
            {item.label}
          </Link>
        ))}
        <div className="my-1 h-px bg-line" />
        <Link
          href="/logout"
          className="mono block rounded-term px-2 py-1.5 text-[0.66rem] transition-colors hover:bg-raised"
          style={{ color: "var(--risk)" }}
        >
          Log out
        </Link>
      </div>
    </details>
  );
}
