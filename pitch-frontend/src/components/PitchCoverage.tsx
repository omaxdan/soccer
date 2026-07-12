import { coverage } from "@/lib/formation";
import type { PredictedLineupPlayer } from "@/lib/types";

const LEVEL_COLOR = {
  high: "var(--edge)",
  medium: "var(--warn)",
  low: "var(--faint)",
};

// Pitch versatility heatmap: how many players can cover each zone, and an
// overall shape-flexibility score. Precompute as team_positional_coverage in
// production; derived here from primary/secondary/tertiary positions.
export function PitchCoverage({ players }: { players: PredictedLineupPlayer[] }) {
  const { zones, flexibilityScore } = coverage(players);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="label-cap">Shape flexibility</div>
          <div className="mono text-[0.6rem] text-muted">can the shape change without subs?</div>
        </div>
        <div
          className="mono text-2xl font-bold tnum"
          style={{ color: flexibilityScore >= 60 ? "var(--edge)" : flexibilityScore >= 35 ? "var(--warn)" : "var(--risk)" }}
        >
          {flexibilityScore}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {zones.map((z) => (
          <div key={z.zone} className="rounded border border-line bg-raised/40 p-2 text-center">
            <div className="mono text-[0.5rem] tracking-wide text-faint">{z.label}</div>
            <div className="mono text-base font-bold tnum" style={{ color: LEVEL_COLOR[z.level] }}>
              {z.count}
            </div>
          </div>
        ))}
      </div>
      <div className="mono mt-2 flex gap-3 text-[0.55rem] text-faint">
        <span><span style={{ color: "var(--edge)" }}>●</span> high (3+)</span>
        <span><span style={{ color: "var(--warn)" }}>●</span> medium (2)</span>
        <span><span style={{ color: "var(--faint)" }}>●</span> thin (1)</span>
      </div>
    </div>
  );
}
