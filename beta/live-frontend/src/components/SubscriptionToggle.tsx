"use client";

import React, { useState, useTransition } from "react";
import { setSubscriptionsEnabled } from "@/lib/authActions";

/**
 * Two-step by design. Enabling changes what every visitor can see, so it asks
 * first and names the consequence. Disabling is safe and immediate — the
 * confirmation only guards the direction that restricts.
 */
export function SubscriptionToggle({ enabled }: { enabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const apply = (next: boolean) => {
    setError(null);
    start(async () => {
      const res = await setSubscriptionsEnabled(next);
      if (res.error) setError(res.error);
      setConfirming(false);
    });
  };

  if (enabled) {
    return (
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(false)}
          className="mono rounded-term px-3 py-2 text-[0.66rem] font-semibold tracking-widest disabled:opacity-50"
          style={{
            color: "var(--warn)",
            border: "1px solid color-mix(in srgb, var(--warn) 34%, transparent)",
          }}
        >
          {pending ? "WORKING…" : "RETURN TO BETA MODE"}
        </button>
        {error && (
          <p className="mono mt-2 text-[0.66rem]" style={{ color: "var(--risk)" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mono rounded-term px-3 py-2 text-[0.66rem] font-semibold tracking-widest"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          ENABLE SUBSCRIPTIONS
        </button>
        {error && (
          <p className="mono mt-2 text-[0.66rem]" style={{ color: "var(--risk)" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-term p-3"
      style={{
        border: "1px solid color-mix(in srgb, var(--warn) 34%, transparent)",
        background: "color-mix(in srgb, var(--warn) 6%, transparent)",
      }}
    >
      <p className="mono text-[0.7rem] font-semibold" style={{ color: "var(--warn)" }}>
        Activate subscriptions?
      </p>
      <p className="mt-1.5 text-[0.72rem] leading-relaxed text-muted">
        Enabling subscriptions will restrict Pro modules for Free users. This activates free
        tier restrictions, Pro feature locks and upgrade prompts across the platform.
      </p>
      <p className="mt-1.5 text-[0.7rem] leading-relaxed text-muted">
        Anonymous visitors will see the five free modules only. You will keep full access as an
        admin, and can return to beta mode from this page at any time.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => apply(true)}
          className="mono rounded-term px-3 py-1.5 text-[0.64rem] font-semibold tracking-widest disabled:opacity-50"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          {pending ? "WORKING…" : "CONTINUE"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="mono rounded-term px-3 py-1.5 text-[0.64rem] tracking-widest text-muted"
          style={{ border: "1px solid var(--line)" }}
        >
          CANCEL
        </button>
      </div>
      {error && (
        <p className="mono mt-2 text-[0.66rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
