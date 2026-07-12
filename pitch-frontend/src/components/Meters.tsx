import { clamp, opportunityColor, riskColor } from "@/lib/intel";
import type { RiskBand } from "@/lib/types";

// ── Signature: Opportunity ÷ Risk split meter ───────────
// A single horizontal track split into an opportunity fill (from the
// left, amber→emerald) and a risk fill (from the right, coral). The gap
// between them is the "edge window" — the visual thesis of the product.
export function OpportunityRiskMeter({
  opportunity,
  risk,
  compact = false,
}: {
  opportunity: number | null | undefined;
  risk: number | null | undefined;
  compact?: boolean;
}) {
  const opp = clamp(opportunity ?? 0);
  const rsk = clamp(risk ?? 0);
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {!compact && (
        <div className="flex items-center justify-between label-cap">
          <span style={{ color: opportunityColor(opp) }}>Opportunity {Math.round(opp)}</span>
          <span style={{ color: riskColor(rsk >= 55 ? "HIGH" : rsk >= 30 ? "MEDIUM" : "LOW") }}>
            Risk {Math.round(rsk)}
          </span>
        </div>
      )}
      <div className="relative h-2 overflow-hidden rounded-full bg-ink">
        <div
          className="absolute inset-y-0 left-0 animate-meter-fill origin-left rounded-full"
          style={{
            width: `${opp}%`,
            background: `linear-gradient(90deg, var(--amber), ${opportunityColor(opp)})`,
          }}
        />
        <div
          className="absolute inset-y-0 right-0 origin-right rounded-full opacity-90"
          style={{
            width: `${rsk}%`,
            background:
              "repeating-linear-gradient(45deg, var(--risk) 0, var(--risk) 4px, color-mix(in srgb, var(--risk) 55%, transparent) 4px, color-mix(in srgb, var(--risk) 55%, transparent) 8px)",
          }}
        />
      </div>
    </div>
  );
}

// ── Simple labelled bar meter ────────────────────────────
export function BarMeter({
  value,
  max = 100,
  color = "var(--amber)",
  track = "var(--ink)",
  height = 8,
}: {
  value: number | null | undefined;
  max?: number;
  color?: string;
  track?: string;
  height?: number;
}) {
  const v = clamp(((value ?? 0) / max) * 100);
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: track }}
    >
      <div
        className="h-full animate-meter-fill origin-left rounded-full"
        style={{ width: `${v}%`, background: color }}
      />
    </div>
  );
}

// ── Head-to-head versus bar (home left, away right) ──────
export function VersusBar({
  home,
  away,
  homeColor = "var(--edge)",
  awayColor = "var(--cool)",
  max = 100,
}: {
  home: number | null | undefined;
  away: number | null | undefined;
  homeColor?: string;
  awayColor?: string;
  max?: number;
}) {
  const h = clamp(((home ?? 0) / max) * 100);
  const a = clamp(((away ?? 0) / max) * 100);
  const total = h + a || 1;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-ink">
      <div
        className="h-full animate-meter-fill origin-left"
        style={{ width: `${(h / total) * 100}%`, background: homeColor }}
      />
      <div className="h-full w-px bg-ink" />
      <div
        className="h-full animate-meter-fill origin-right"
        style={{ width: `${(a / total) * 100}%`, background: awayColor }}
      />
    </div>
  );
}

export function RiskBadge({ band }: { band: RiskBand }) {
  return (
    <span
      className="mono rounded px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest"
      style={{
        color: riskColor(band),
        background: `color-mix(in srgb, ${riskColor(band)} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${riskColor(band)} 30%, transparent)`,
      }}
    >
      {band} RISK
    </span>
  );
}
