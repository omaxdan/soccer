// ─────────────────────────────────────────────────────────────────────────────
// <Rate /> — the only component in PitchTerminal allowed to print a historical
// percentage.
//
// It takes a Baseline, which cannot be constructed without a `sample` field.
// If the sample is null the number renders in the "unverified" treatment with
// a visible marker, not as a clean stat. If the sample is small, the 95%
// Wilson interval is printed next to it, because a 97.9% on n=23 and a 97.9%
// on n=3,000 are not the same claim and should not look the same.
//
// This is a deliberate constraint on ourselves, not a UI flourish.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { wilson, type Baseline } from "@/lib/modules";
import { IconUnverified } from "./icons/ModuleIcons";

/** Below this, an interval is always shown. */
const SMALL_SAMPLE = 500;

export function Rate({
  baseline,
  size = "md",
  showLabel = true,
}: {
  baseline: Baseline | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  if (!baseline) {
    return <span className="mono text-faint">—</span>;
  }

  const { rate, sample, label, baseRate, provenance, pooled } = baseline;
  const textSize =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-[0.8rem]" : "text-base";

  // ── Unverified: a rate with no sample behind it ────────
  if (sample == null) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="inline-flex items-baseline gap-1.5">
          <span
            className={`mono tnum font-semibold ${textSize}`}
            style={{ color: "var(--muted)" }}
            title="No sample size is carried for this rate — treat it as an estimate, not a measurement."
          >
            {rate.toFixed(1)}%
          </span>
          <span
            className="inline-flex items-center gap-1 rounded px-1 py-px text-[0.55rem] tracking-widest"
            style={{
              color: "var(--warn)",
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
            }}
          >
            <IconUnverified size={10} />
            NO n
          </span>
        </span>
        {showLabel && (
          <span className="text-[0.65rem] text-faint">{label} · sample not carried</span>
        )}
      </span>
    );
  }

  const [lo, hi] = wilson(rate, sample);
  const wide = hi - lo > 12;
  const unreplayed = provenance === "unreplayed";
  // An unreplayed rate is not made trustworthy by having an n beside it. The
  // 1,893-match analysis scored finished matches with current team form, so
  // the count is real while the percentage still carries lookahead. Colour it
  // like the caveat it is.
  const color = unreplayed || wide ? "var(--warn)" : "var(--text)";

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`mono tnum font-semibold ${textSize}`} style={{ color }}>
          {rate.toFixed(1)}%
        </span>
        <span className="mono text-[0.65rem] tnum text-muted">
          n={sample.toLocaleString()}
          {pooled && <span className="ml-1 text-faint">pooled</span>}
        </span>
        {unreplayed && (
          <span
            className="mono rounded px-1 py-px text-[0.55rem] tracking-widest"
            style={{
              color: "var(--warn)",
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
            }}
            title="From the 1,893-match analysis, which scored finished matches using current team form. Awaiting the point-in-time replay (backtest:bands)."
          >
            UNREPLAYED
          </span>
        )}
      </span>
      {pooled ? (
        <span className="mono text-[0.62rem] text-faint">
          total across all bands — no per-band interval
        </span>
      ) : (
        <span className="mono text-[0.62rem] tnum" style={{ color: wide ? "var(--warn)" : "var(--faint)" }}>
          95% CI {lo.toFixed(1)}–{hi.toFixed(1)}
          {wide && " · wide"}
        </span>
      )}
      {showLabel && (
        <span className="text-[0.65rem] text-faint">
          {label}
          {baseRate != null && ` · base ${baseRate.toFixed(1)}%`}
        </span>
      )}
    </span>
  );
}

/**
 * Compact inline variant for dense rows — still refuses to print a bare
 * percentage without either an n or the unverified marker.
 */
export function RateInline({ baseline }: { baseline: Baseline | null }) {
  if (!baseline) return <span className="mono text-faint">—</span>;
  const { rate, sample } = baseline;
  if (sample == null) {
    return (
      <span className="mono tnum text-[0.7rem]" style={{ color: "var(--muted)" }}>
        ~{rate.toFixed(0)}%
        <span style={{ color: "var(--warn)" }} className="ml-1 text-[0.55rem]">
          NO n
        </span>
      </span>
    );
  }
  return (
    <span className="mono tnum text-[0.7rem] text-text">
      {rate.toFixed(1)}%
      <span className="ml-1 text-[0.6rem] text-muted">n={sample.toLocaleString()}</span>
    </span>
  );
}

/**
 * Calibration gate badge. Mirrors the backend rule already in place
 * (sample ≥ 200 and lift ≥ 1.05) so the frontend never presents a rule as
 * published when the backend would have withheld it.
 */
export function GateBadge({
  sample,
  lift,
  minSample = 200,
  minLift = 1.05,
}: {
  sample: number | null | undefined;
  lift: number | null | undefined;
  minSample?: number;
  minLift?: number;
}) {
  const passes =
    sample != null && lift != null && sample >= minSample && lift >= minLift;
  const color = passes ? "var(--edge)" : "var(--warn)";
  return (
    <span
      className="mono inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.55rem] font-semibold tracking-widest"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      }}
      title={`Calibration gate: sample ≥ ${minSample} and lift ≥ ${minLift}`}
    >
      {passes ? "CALIBRATED" : "BELOW GATE"}
    </span>
  );
}
