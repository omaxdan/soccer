"use client";

import { useState } from "react";
import Link from "next/link";
import { Crest } from "./Crest";
import { FormString, PickBadge } from "./Primitives";
import { kickoff, riskColor, normProb, bestLean } from "@/lib/intel";
import { matchSlug } from "@/lib/slug";
import type { MatchRow } from "@/lib/types";

function totalGoals(m: MatchRow): number | null {
  const h = m.intel?.predicted_home_goals, a = m.intel?.predicted_away_goals;
  return h != null && a != null ? h + a : null;
}

function Chip({ value, color }: { value: string; color: string }) {
  return <span className="mono text-[0.72rem] font-bold tnum" style={{ color }}>{value}</span>;
}

function Row({ m, pick }: { m: MatchRow; pick?: "BANKER" | "STRONG" }) {
  const [open, setOpen] = useState(false);
  const k = kickoff(m.date);
  const tg = totalGoals(m);
  const opp = m.opportunity?.opportunity_score ?? null;
  const lean = bestLean(m);
  // Edge chip is colored by risk band, not the opportunity score — this is
  // how risk is communicated now that the dedicated Risk column is gone.
  const edgeColor = riskColor(m.risk?.risk_band);

  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[2.6rem_1fr_auto] items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-raised lg:grid-cols-[3rem_1.6fr_1fr_3.5rem_5rem_1.2rem]"
      >
        {/* time */}
        <span className="mono text-[0.62rem] leading-tight text-muted">
          {k.time}<br /><span className="text-faint">{k.day}</span>
        </span>
        {/* match */}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[0.78rem]">
            <Crest team={m.home} size={16} /><span className="truncate">{m.home.short_name || m.home.name}</span>
            {pick && <PickBadge tier={pick} compact />}
          </span>
          <span className="flex items-center gap-1.5 text-[0.78rem]"><Crest team={m.away} size={16} /><span className="truncate">{m.away.short_name || m.away.name}</span></span>
        </span>
        {/* league (lg) */}
        <span className="mono hidden truncate text-[0.62rem] text-faint lg:block">{m.tournament?.name ?? m.competition}</span>
        {/* edge (opportunity score, colored by risk) */}
        <span className="hidden text-right lg:block"><Chip value={opp != null ? String(opp) : "—"} color={edgeColor} /></span>
        {/* H/A form */}
        <span className="hidden flex-col items-end gap-0.5 lg:flex">
          {m.home_form ? <FormString results={m.home_form} /> : <span className="mono text-[0.55rem] text-faint">—</span>}
          {m.away_form ? <FormString results={m.away_form} /> : <span className="mono text-[0.55rem] text-faint">—</span>}
        </span>
        {/* mobile compact edge + caret */}
        <span className="flex items-center gap-2 lg:hidden">
          {pick && <PickBadge tier={pick} compact />}
          <Chip value={opp != null ? String(opp) : "—"} color={edgeColor} />
          <span className="text-faint">{open ? "▾" : "▸"}</span>
        </span>
        <span className="hidden text-right text-faint lg:block">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="animate-fade-up border-t border-line bg-ink/40 px-3 py-3">
          {lean && (
            <div className="mb-2 flex items-center gap-2">
              <span className="label-cap">Best lean</span>
              <span className="mono text-[0.72rem] font-semibold text-amber">{lean.pick}</span>
            </div>
          )}
          {m.opportunity?.executive_brief && <p className="mb-2 text-[0.75rem] leading-relaxed text-muted">{m.opportunity.executive_brief}</p>}
          {/* Confidence, readiness gap and goal env — dropped from the row, live here now */}
          <div className="mono mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-muted">
            {m.risk?.risk_band && <span>Risk <span style={{ color: edgeColor }}>{m.risk.risk_band}</span></span>}
            {m.intel?.confidence_score != null && <span>Confidence <span className="text-text">{Math.round(m.intel.confidence_score)}%</span></span>}
            {m.intel?.readiness_gap != null && <span>Readiness gap <span className="text-text">{m.intel.readiness_gap > 0 ? "+" : ""}{m.intel.readiness_gap.toFixed(0)}</span></span>}
            {tg != null && <span>Goal env <span className="text-text">{tg.toFixed(1)}</span></span>}
          </div>
          <div className="mono mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-muted">
            {m.intel && <span>xG <span className="text-text">{(m.intel.predicted_home_goals ?? 0).toFixed(1)}–{(m.intel.predicted_away_goals ?? 0).toFixed(1)}</span></span>}
            {m.intel?.win_probability_home != null && <span>1 <span className="text-text">{Math.round(normProb(m.intel.win_probability_home))}%</span></span>}
            {m.intel?.win_probability_draw != null && <span>X <span className="text-text">{Math.round(normProb(m.intel.win_probability_draw))}%</span></span>}
            {m.intel?.win_probability_away != null && <span>2 <span className="text-text">{Math.round(normProb(m.intel.win_probability_away))}%</span></span>}
          </div>
          {m.opportunity && m.opportunity.signals.length > 0 && (
            <ul className="mb-2 space-y-1">
              {m.opportunity.signals.slice(0, 3).map((s) => (
                <li key={s.key} className="flex items-start gap-1.5 text-[0.72rem] leading-snug"><span className="text-edge">+</span><span className="text-muted">{s.text}</span></li>
              ))}
            </ul>
          )}
          <Link href={`/match/${matchSlug(m)}`} className="mono text-[0.7rem] font-semibold text-amber hover:underline">Open full analysis →</Link>
        </div>
      )}
    </div>
  );
}

export function BoardRows({
  matches,
  picks,
}: {
  matches: MatchRow[];
  /** Optional match_id → BANKER/STRONG lookup from the daily betting card. */
  picks?: Map<number, "BANKER" | "STRONG">;
}) {
  return (
    <div className="panel overflow-hidden p-0">
      {/* header (desktop) */}
      <div className="mono hidden grid-cols-[3rem_1.6fr_1fr_3.5rem_5rem_1.2rem] items-center gap-2 border-b border-line px-3 py-2 text-[0.55rem] uppercase tracking-wide text-faint lg:grid">
        <span>Time</span><span>Match</span><span>League</span>
        <span className="text-right">Edge</span>
        <span className="text-right">Form</span>
        <span />
      </div>
      {matches.map((m) => <Row key={m.id} m={m} pick={picks?.get(m.id)} />)}
    </div>
  );
}
