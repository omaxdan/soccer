// ─────────────────────────────────────────────────────────────────────────────
// ModuleCard — the atom of the whole product.
//
// Every card carries, without exception: module number, module name, the live
// data, the historical baseline (via <Rate />, so never without an n or an
// unverified marker), and a one-line verdict.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  statusColor,
  statusWord,
  type ModuleReading,
  type ModuleDef,
  type ModuleStatus,
} from "@/lib/modules";
import { canSee, upgradeTarget, type Tier } from "@/lib/tier";
import { Rate } from "./Rate";
import { ModuleIcon, StatusIcon, IconLock, IconArrowRight } from "./icons/ModuleIcons";

// ── Small status chip used in feeds and tag rails ────────

export function ModuleChip({
  def,
  status,
  detail,
  locked = false,
}: {
  def: ModuleDef;
  status: ModuleStatus;
  detail?: string;
  locked?: boolean;
}) {
  const color = locked ? "var(--faint)" : statusColor(status);
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[0.6rem] tracking-wide"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
      }}
      title={`Module ${def.n} — ${def.name}: ${def.question}`}
    >
      {locked ? <IconLock size={11} /> : <ModuleIcon moduleKey={def.key} size={12} />}
      <span className="font-semibold">M{def.n}</span>
      {detail && <span className="text-[0.58rem] opacity-80">{detail}</span>}
    </span>
  );
}

// ── Locked state ─────────────────────────────────────────

function LockedCard({ def }: { def: ModuleDef }) {
  const plan = upgradeTarget(def);
  return (
    <article className="panel relative overflow-hidden p-4">
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 text-faint">
          <ModuleIcon moduleKey={def.key} size={18} />
        </span>
        <div className="min-w-0">
          <div className="mono text-[0.6rem] tracking-[0.14em] text-faint">
            MODULE {def.n}
          </div>
          <h3 className="mono text-[0.78rem] font-semibold tracking-tight text-muted">
            {def.name}
          </h3>
        </div>
        <span className="ml-auto text-faint">
          <IconLock size={16} />
        </span>
      </header>
      <p className="mt-2 text-[0.72rem] text-faint">{def.question}</p>
      <Link
        href="/pricing"
        className="mono mt-3 inline-flex items-center gap-1.5 rounded-term px-2 py-1 text-[0.6rem] font-semibold tracking-widest transition-colors hover:bg-raised"
        style={{
          color: "var(--amber)",
          border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
        }}
      >
        UNLOCK WITH {plan.name.toUpperCase()}
        <IconArrowRight size={12} />
      </Link>
    </article>
  );
}

// ── Full card ────────────────────────────────────────────

export function ModuleCard({
  reading,
  viewer,
  hideInactive = false,
}: {
  reading: ModuleReading;
  viewer: Tier;
  hideInactive?: boolean;
}) {
  const { def, status, headline, rows, baseline, verdict } = reading;

  if (!canSee(def, viewer)) return <LockedCard def={def} />;
  if (status === "inactive" && hideInactive) return null;

  const color = statusColor(status);
  const dim = status === "inactive";

  return (
    <article
      className="panel p-4"
      style={{
        borderColor:
          status === "inactive"
            ? "var(--line)"
            : `color-mix(in srgb, ${color} 26%, var(--line))`,
      }}
    >
      {/* Header — number, name, status */}
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5" style={{ color: dim ? "var(--faint)" : color }}>
          <ModuleIcon moduleKey={def.key} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mono text-[0.6rem] tracking-[0.14em] text-faint">
            MODULE {def.n}
          </div>
          <h3 className="mono text-[0.78rem] font-semibold tracking-tight text-text">
            {def.name}
          </h3>
        </div>
        <span
          className="mono inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[0.55rem] font-semibold tracking-widest"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}
        >
          <StatusIcon status={status} size={11} />
          {statusWord(status)}
        </span>
      </header>

      {/* Live datum */}
      <p
        className="mono mt-2.5 text-[0.85rem] font-semibold tracking-tight"
        style={{ color: dim ? "var(--faint)" : "var(--text)" }}
      >
        {headline}
      </p>

      {/* Data rows */}
      {rows.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="label-cap">{r.label}</dt>
              <dd
                className="mono tnum text-[0.78rem] font-medium"
                style={{ color: r.color ?? "var(--text)" }}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Historical baseline — always via <Rate /> */}
      {baseline && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="label-cap mb-1">Historical baseline</div>
          <Rate baseline={baseline} size="md" />
        </div>
      )}

      {/* Verdict */}
      <p
        className="mt-3 border-t border-line pt-2.5 text-[0.73rem] leading-relaxed"
        style={{ color: dim ? "var(--faint)" : "var(--muted)" }}
      >
        <span className="mono mr-1.5 text-[0.6rem] tracking-widest" style={{ color }}>
          VERDICT
        </span>
        {verdict}
      </p>
    </article>
  );
}

// ── Verdict summary block ────────────────────────────────

export function ModuleVerdictSummary({
  readings,
  narrative,
}: {
  readings: ModuleReading[];
  narrative?: string;
}) {
  const supports = readings.filter((r) => r.status === "supports");
  const neutral = readings.filter((r) => r.status === "neutral");
  const contradicts = readings.filter((r) => r.status === "contradicts");

  const Line = ({
    status,
    items,
    word,
  }: {
    status: ModuleStatus;
    items: ModuleReading[];
    word: string;
  }) => (
    <div className="flex items-start gap-2">
      <span className="mt-0.5" style={{ color: statusColor(status) }}>
        <StatusIcon status={status} size={13} />
      </span>
      <span className="mono text-[0.72rem]">
        <span className="tnum font-semibold" style={{ color: statusColor(status) }}>
          {items.length}
        </span>{" "}
        <span className="text-muted">{word}</span>
        {items.length > 0 && (
          <span className="ml-1.5 text-[0.65rem] text-faint">
            {items.map((r) => `M${r.def.n}`).join(" · ")}
          </span>
        )}
      </span>
    </div>
  );

  return (
    <section className="panel-raised p-4">
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Module verdict summary
      </h2>
      <div className="space-y-1.5">
        <Line status="supports" items={supports} word="support the pick" />
        <Line status="neutral" items={neutral} word="neutral" />
        <Line status="contradicts" items={contradicts} word="contradict" />
      </div>
      {narrative && (
        <p className="mt-3 border-t border-line pt-3 text-[0.75rem] leading-relaxed text-muted">
          {narrative}
        </p>
      )}

    </section>
  );
}
