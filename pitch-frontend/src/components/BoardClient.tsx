"use client";

import { useMemo, useState } from "react";
import { BoardRows } from "./BoardRows";
import type { MatchRow } from "@/lib/types";

type Lens = "all" | "opportunity" | "lowrisk" | "goals";

const LENSES: { id: Lens; label: string }[] = [
  { id: "all", label: "All" },
  { id: "opportunity", label: "Top edge" },
  { id: "lowrisk", label: "Low risk" },
  { id: "goals", label: "Goal-rich" },
];

export function BoardClient({ matches }: { matches: MatchRow[] }) {
  const [lens, setLens] = useState<Lens>("all");
  const [comp, setComp] = useState<string>("all");

  const competitions = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m) => {
      const c = m.tournament?.name ?? m.competition;
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [matches]);

  const filtered = useMemo(() => {
    let out = matches;
    if (comp !== "all") out = out.filter((m) => (m.tournament?.name ?? m.competition) === comp);
    if (lens === "opportunity")
      out = out.filter((m) => (m.opportunity?.opportunity_score ?? 0) >= 60);
    if (lens === "lowrisk") out = out.filter((m) => m.risk?.risk_band === "LOW");
    if (lens === "goals")
      out = out.filter(
        (m) =>
          (m.intel?.predicted_home_goals ?? 0) + (m.intel?.predicted_away_goals ?? 0) >= 2.8
      );
    return out;
  }, [matches, lens, comp]);

  return (
    <div className="space-y-3">
      {/* Lens selector */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {LENSES.map((l) => (
          <button
            key={l.id}
            onClick={() => setLens(l.id)}
            className="mono shrink-0 rounded-full px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide transition-colors"
            style={{
              color: lens === l.id ? "var(--ink)" : "var(--muted)",
              background: lens === l.id ? "var(--amber)" : "var(--panel)",
              border: `1px solid ${lens === l.id ? "var(--amber)" : "var(--line)"}`,
            }}
          >
            {l.label}
          </button>
        ))}
        {competitions.length > 1 && (
          <select
            value={comp}
            onChange={(e) => setComp(e.target.value)}
            className="mono ml-auto shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-[0.65rem] text-muted"
            aria-label="Filter by competition"
          >
            <option value="all">All leagues</option>
            {competitions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="mono text-sm text-muted">No fixtures match this lens.</p>
          <button
            onClick={() => {
              setLens("all");
              setComp("all");
            }}
            className="mono mt-2 text-[0.7rem] text-amber underline"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <BoardRows matches={filtered} />
      )}
    </div>
  );
}
