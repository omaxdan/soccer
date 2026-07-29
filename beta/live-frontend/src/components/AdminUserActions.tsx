"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeRole, setSuspended, applyPlanAction, addNote, type PlanActionType } from "@/lib/admin";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  };
  return { pending, error, run };
}

const btn = (tone: "default" | "warn" | "danger" = "default") => ({
  className: "mono rounded-term px-2.5 py-1.5 text-[0.62rem] font-semibold tracking-widest disabled:opacity-50",
  style: {
    default: { color: "var(--text)", border: "1px solid var(--line)" },
    warn: { color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 34%, transparent)" },
    danger: { color: "var(--risk)", border: "1px solid color-mix(in srgb, var(--risk) 34%, transparent)" },
  }[tone],
});

/** Role selector — only ranks below the ACTOR's own are offered, enforced again server-side. */
export function RoleActions({ userId, currentRole, actorRank }: { userId: string; currentRole: string; actorRank: number }) {
  const { pending, error, run } = useAction();
  const RANK: Record<string, number> = { user: 0, support: 1, moderator: 2, admin: 3, owner: 4 };
  const options = Object.keys(RANK).filter((r) => RANK[r] < actorRank);

  if (RANK[currentRole] >= actorRank) {
    return <p className="text-[0.68rem] text-faint">Cannot change a role equal to or above your own.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        disabled={pending}
        defaultValue={currentRole}
        onChange={(e) => {
          const next = e.target.value;
          if (next === currentRole) return;
          if (!confirm(`Change this user's role from ${currentRole} to ${next}?`)) {
            e.target.value = currentRole;
            return;
          }
          run(() => changeRole(userId, next));
        }}
        className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text"
      >
        {options.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      {error && <span className="mono text-[0.62rem]" style={{ color: "var(--risk)" }}>{error}</span>}
    </div>
  );
}

export function SuspendAction({ userId, suspended }: { userId: string; suspended: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <button
        {...btn(suspended ? "default" : "warn")}
        disabled={pending}
        onClick={() => {
          if (suspended) {
            run(() => setSuspended(userId, false));
            return;
          }
          const reason = prompt("Reason for suspension (shown in the audit log):");
          if (reason === null) return;
          if (!confirm("Suspend this account? They will lose access immediately.")) return;
          run(() => setSuspended(userId, true, reason));
        }}
      >
        {pending ? "WORKING…" : suspended ? "UNSUSPEND" : "SUSPEND ACCOUNT"}
      </button>
      {error && <p className="mono mt-1 text-[0.62rem]" style={{ color: "var(--risk)" }}>{error}</p>}
    </div>
  );
}

export function PlanActions({ userId, currentPlan }: { userId: string; currentPlan: string }) {
  const { pending, error, run } = useAction();
  const actions: { type: PlanActionType; label: string; tone: "default" | "warn" | "danger"; confirm?: string }[] = [
    { type: "upgrade", label: "Upgrade to Pro", tone: "default" },
    { type: "downgrade", label: "Downgrade to Free", tone: "warn", confirm: "Downgrade this account to Free now?" },
    { type: "extend", label: "Extend 30 days", tone: "default" },
    { type: "cancel", label: "Cancel", tone: "warn", confirm: "Cancel this subscription? It will end immediately rather than at period end." },
    { type: "reset", label: "Reset", tone: "danger", confirm: "Reset clears the subscription entirely, back to no plan on record. Continue?" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <button
          key={a.type}
          {...btn(a.tone)}
          disabled={pending}
          onClick={() => {
            if (a.confirm && !confirm(a.confirm)) return;
            run(() => applyPlanAction(userId, a.type));
          }}
        >
          {a.label}
        </button>
      ))}
      {error && <p className="mono w-full text-[0.62rem]" style={{ color: "var(--risk)" }}>{error}</p>}
    </div>
  );
}

export function NoteForm({ userId }: { userId: string }) {
  const { pending, error, run } = useAction();
  const [text, setText] = useState("");
  const [flag, setFlag] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const res = await addNote(userId, text, flag || undefined);
          if (res.ok) { setText(""); setFlag(""); }
          return res;
        });
      }}
      className="space-y-2"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Internal note — visible to admins only"
        rows={2}
        className="mono w-full rounded-term border border-line bg-raised p-2 text-[0.72rem] text-text outline-none focus:border-amber"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select value={flag} onChange={(e) => setFlag(e.target.value)} className="mono rounded-term border border-line bg-raised px-2 py-1 text-[0.64rem] text-text">
          <option value="">No flag</option>
          <option value="vip">VIP</option>
          <option value="suspicious">Suspicious</option>
          <option value="chargeback">Chargeback</option>
          <option value="support_priority">Support priority</option>
        </select>
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="mono rounded-term px-3 py-1.5 text-[0.62rem] font-semibold tracking-widest disabled:opacity-50"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          ADD NOTE
        </button>
        {error && <span className="mono text-[0.62rem]" style={{ color: "var(--risk)" }}>{error}</span>}
      </div>
    </form>
  );
}
