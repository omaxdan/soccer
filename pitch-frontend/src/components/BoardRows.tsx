"use client";

import { useState } from "react";
import Link from "next/link";
import { Crest } from "./Crest";
import { FormString } from "./Primitives";
import { kickoff, opportunityColor, normProb, bestLean } from "@/lib/intel";
import { matchSlug } from "@/lib/slug";
import type { MatchRow } from "@/lib/types";

const RISK_COLOR: Record<string, string> = {
  LOW: "var(--edge)", MEDIUM: "var(--warn)", HIGH: "var(--risk)",
};

function totalGoals(m: MatchRow): number | null {
  const h = m.intel?.predicted_home_goals, a = m.intel?.predicted_away_goals;
  return h != null && a != null ? h + a : null;
}

function Chip({ value, color }: { value: string; color: string }) {
  return <span className="mono text-[0.72rem] font-bold tnum" style={{ color }}>{value}</span>;
}

function Row({ m }: { m: MatchRow }) {
  const [open, setOpen] = useState(false);
  const k = kickoff(m.date);
  const tg = totalGoals(m);
  const opp = m.opportunity?.opportunity_score ?? null;
  const lean = bestLean(m);

  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[2.6rem_1fr_auto] items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-raised lg:grid-cols-[3rem_1.6fr_1fr_repeat(5,3rem)_5rem_1.2rem]"
      >
        {/* time */}
        <span className="mono text-[0.62rem] leading-tight text-muted">
          {k.time}<br /><span className="text-faint">{k.day}</span>
        </span>
        {/* match */}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[0.78rem]"><Crest team={m.home} size={16} /><span className="truncate">{m.home.short_name || m.home.name}</span></span>
          <span className="flex items-center gap-1.5 text-[0.78rem]"><Crest team={m.away} size={16} /><span className="truncate">{m.away.short_name || m.away.name}</span></span>
        </span>
        {/* league (lg) */}
        <span className="mono hidden truncate text-[0.62rem] text-faint lg:block">{m.tournament?.name ?? m.competition}</span>
        {/* opp */}
        <span className="hidden text-right lg:block"><Chip value={opp != null ? String(opp) : "—"} color={opportunityColor(opp)} /></span>
        {/* risk */}
        <span className="hidden text-right lg:block"><Chip value={m.risk?.risk_band ?? "—"} color={RISK_COLOR[m.risk?.risk_band ?? ""] ?? "var(--muted)"} /></span>
        {/* conf */}
        <span className="hidden text-right lg:block"><Chip value={m.intel?.confidence_score != null ? `${Math.round(m.intel.confidence_score)}` : "—"} color="var(--text)" /></span>
        {/* readiness gap */}
        <span className="hidden text-right lg:block"><Chip value={m.intel?.readiness_gap != null ? m.intel.readiness_gap.toFixed(0) : "—"} color="var(--muted)" /></span>
        {/* goal env */}
        <span className="hidden text-right lg:block"><Chip value={tg != null ? tg.toFixed(1) : "—"} color={tg != null && tg >= 2.8 ? "var(--amber)" : "var(--muted)"} /></span>
        {/* H/A form */}
        <span className="hidden flex-col items-end gap-0.5 lg:flex">
          {m.home_form ? <FormString results={m.home_form} /> : <span className="mono text-[0.55rem] text-faint">—</span>}
          {m.away_form ? <FormString results={m.away_form} /> : <span className="mono text-[0.55rem] text-faint">—</span>}
        </span>
        {/* mobile compact opp/risk + caret */}
        <span className="flex items-center gap-2 lg:hidden">
          <Chip value={opp != null ? String(opp) : "—"} color={opportunityColor(opp)} />
          <span className="mono text-[0.6rem]" style={{ color: RISK_COLOR[m.risk?.risk_band ?? ""] ?? "var(--faint)" }}>{m.risk?.risk_band?.[0] ?? ""}</span>
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

export function BoardRows({ matches }: { matches: MatchRow[] }) {
  return (
    <div className="panel overflow-hidden p-0">
      {/* header (desktop) */}
      <div className="mono hidden grid-cols-[3rem_1.6fr_1fr_repeat(5,3rem)_5rem_1.2rem] items-center gap-2 border-b border-line px-3 py-2 text-[0.55rem] uppercase tracking-wide text-faint lg:grid">
        <span>Time</span><span>Match</span><span>League</span>
        <span className="text-right">Opp</span>
        <span className="text-right">Risk</span>
        <span className="text-right">Conf</span>
        <span className="text-right">RdGap</span>
        <span className="text-right">Goals</span>
        <span className="text-right">Form</span>
        <span />
      </div>
      {matches.map((m) => <Row key={m.id} m={m} />)}
    </div>
  );
}
