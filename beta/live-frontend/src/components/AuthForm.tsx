"use client";

import React from "react";
import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "@/lib/authActions";
import { signInWithGoogle } from "@/lib/authActions";

export function AuthForm({
  action,
  title,
  submitLabel,
  footer,
  oauthError,
}: {
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
  title: string;
  submitLabel: string;
  footer: React.ReactNode;
  /** Surfaced by the callback route when the provider leg fails. */
  oauthError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <div className="mx-auto max-w-sm">
      {oauthError && (
        <p
          role="alert"
          className="mono mb-3 rounded px-2 py-1.5 text-[0.68rem]"
          style={{
            color: "var(--risk)",
            background: "color-mix(in srgb, var(--risk) 12%, transparent)",
          }}
        >
          {oauthError}
        </p>
      )}

      {/* Its own form: a Server Action that redirects cannot share a form with
          one that returns state. */}
      <form action={signInWithGoogle} className="panel mb-3 p-4">
        <button
          type="submit"
          className="mono flex w-full items-center justify-center gap-2 rounded-term py-2 text-[0.7rem] font-semibold tracking-wide"
          style={{ color: "var(--text)", border: "1px solid var(--line)", background: "var(--raised)" }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.6-5.2 3.6-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.3v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.3 14.3a7.1 7.1 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8z" />
          </svg>
          Continue with Google
        </button>
      </form>

      <div className="mb-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="mono text-[0.55rem] tracking-widest text-faint">OR</span>
        <span className="h-px flex-1 bg-line" />
      </div>

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
