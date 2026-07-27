"use client";

import React from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "@/lib/authActions";

export function AuthForm({
  action,
  title,
  submitLabel,
  footer,
}: {
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
  title: string;
  submitLabel: string;
  footer: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="mx-auto max-w-sm">
      <form action={formAction} className="panel p-5">
        <h1 className="mono text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          {title}
        </h1>

        <label className="mt-4 block">
          <span className="label-cap">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mono mt-1 w-full rounded-term border border-line bg-raised px-2.5 py-2 text-[0.8rem] text-text outline-none focus:border-amber"
          />
        </label>

        <label className="mt-3 block">
          <span className="label-cap">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="mono mt-1 w-full rounded-term border border-line bg-raised px-2.5 py-2 text-[0.8rem] text-text outline-none focus:border-amber"
          />
        </label>

        {state?.error && (
          <p
            role="alert"
            className="mono mt-3 rounded px-2 py-1.5 text-[0.68rem]"
            style={{
              color: "var(--risk)",
              background: "color-mix(in srgb, var(--risk) 12%, transparent)",
            }}
          >
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mono mt-4 w-full rounded-term py-2 text-[0.68rem] font-semibold tracking-widest disabled:opacity-50"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          {pending ? "WORKING…" : submitLabel}
        </button>

        <p className="mt-3 text-center text-[0.68rem] text-muted">{footer}</p>
      </form>

      <p className="mt-3 text-center text-[0.64rem] leading-relaxed text-faint">
        Accounts are not required while PitchTerminal is in open beta — every module is
        currently available to everyone.{" "}
        <Link href="/app" className="text-amber underline underline-offset-2">
          Continue without an account
        </Link>
        .
      </p>
    </div>
  );
}
