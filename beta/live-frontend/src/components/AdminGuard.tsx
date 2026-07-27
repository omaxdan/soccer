import React from "react";
import Link from "next/link";
import { getAccessContext } from "@/lib/access";
import { IconLock } from "./icons/ModuleIcons";

/**
 * Server-side role check for every admin route.
 *
 * This is not the only defence — RLS rejects the underlying reads and writes
 * regardless — but it means a non-admin never receives admin markup in the
 * first place, and an anonymous visitor is pointed at sign-in rather than
 * shown a denial they cannot act on.
 */
export async function requireAdmin(): Promise<
  { ok: true; ctx: Awaited<ReturnType<typeof getAccessContext>> } | { ok: false; ui: React.ReactElement }
> {
  const ctx = await getAccessContext();
  if (ctx.isAdmin) return { ok: true, ctx };
  return {
    ok: false,
    ui: (
      <div className="panel mx-auto max-w-lg p-4 text-center">
        <span className="text-faint">
          <IconLock size={20} />
        </span>
        <h1 className="mono mt-2 text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Access denied
        </h1>
        <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">
          {ctx.authenticated
            ? "This area requires an admin role. Your account does not have one."
            : "Sign in with an admin account to reach platform controls."}
        </p>
        <Link
          href={ctx.authenticated ? "/app" : "/login"}
          className="mono mt-4 inline-block text-[0.64rem] tracking-widest text-amber"
        >
          {ctx.authenticated ? "BACK TO DASHBOARD" : "SIGN IN"} →
        </Link>
      </div>
    ),
  };
}
