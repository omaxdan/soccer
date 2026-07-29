// ─────────────────────────────────────────────────────────────────────────────
// TeamMatchup — the match page's comparison layer.
//
// Presentation only. Every number here was already computed by lib/teamBrief.ts
// or lib/modules.ts; this file arranges it as a head-to-head rather than two
// standalone team summaries. Nothing in this file reads a database field
// directly — it only reads the output of lib/matchCompare.ts.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type {
  AttackDefenceMatchup,
  MomentumComparison,
  VolatilityComparison,
  SustainabilityComparison,
  ComparativeRisk,
  VenueDependenceComparison,
  EdgeItem,
} from "@/lib/matchCompare";
import { IconSupports } from "./icons/ModuleIcons";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mono mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text">
        {title}
      </h3>
      {children}
    </section>
  );
}

// ── 1. Attack vs Defence matchup ────────────────────────────────────────────

export function AttackDefenceCard({
  matchup,
  homeName,
  awayName,
}: {
  matchup: AttackDefenceMatchup;
  homeName: string;
  awayName: string;
}) {
  if (matchup.matchups.length === 0) return null;
  return (
    <Section title="Attack vs defence">
      <div className="grid gap-2 sm:grid-cols-2">
        {matchup.matchups.map((m) => (
          <div key={m.label} className="panel p-3">
            <p className="mono text-[0.62rem] text-faint">{m.label}</p>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="mono tnum text-[0.95rem] font-semibold text-text">
                {m.attackValue}
              </span>
              <span className="mono text-[0.6rem] text-faint">vs</span>
              <span className="mono tnum text-[0.95rem] font-semibold text-text">
                {m.defenceValue}
              </span>
            </div>
            {m.edge && (
              <p
                className="mono mt-1.5 text-[0.62rem] font-semibold tracking-widest"
                style={{ color: "var(--edge)" }}
              >
                EDGE {m.edge === "home" ? homeName.toUpperCase() : awayName.toUpperCase()} ({Math.abs(m.gap)})
              </p>
            )}
          </div>
        ))}
      </div>
      {matchup.sentence && (
        <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{matchup.sentence}</p>
      )}
    </Section>
  );
}

// ── 2. Momentum ──────────────────────────────────────────────────────────────

export function MomentumCard({
  momentum,
  homeName,
  awayName,
}: {
  momentum: MomentumComparison;
  homeName: string;
  awayName: string;
}) {
  if (!momentum.home && !momentum.away) return null;
  return (
    <Section title="Momentum">
      <div className="grid grid-cols-2 gap-2">
        {[
          { name: homeName, v: momentum.home },
          { name: awayName, v: momentum.away },
        ].map(({ name, v }) => (
          <div key={name} className="panel p-3">
            <p className="mono truncate text-[0.62rem] text-faint">{name}</p>
            <p className="mono mt-1 text-[0.8rem] font-semibold text-text">
              {v ? v.base.charAt(0) + v.base.slice(1).toLowerCase() : "—"}
            </p>
            {v && (
              <p className="mono text-[0.6rem] text-faint">
                {v.change > 0 ? "+" : ""}
                {v.change} pts vs prior 5
              </p>
            )}
          </div>
        ))}
      </div>
      {momentum.sentence && (
        <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{momentum.sentence}</p>
      )}
    </Section>
  );
}

// ── 3. Volatility ─────────────────────────────────────────────────────────────

export function VolatilityCard({
  volatility,
  homeName,
  awayName,
}: {
  volatility: VolatilityComparison;
  homeName: string;
  awayName: string;
}) {
  if (!volatility.home && !volatility.away) return null;
  return (
    <Section title="Volatility">
      <div className="grid grid-cols-2 gap-2">
        {[
          { name: homeName, v: volatility.home },
          { name: awayName, v: volatility.away },
        ].map(({ name, v }) => (
          <div key={name} className="panel p-3">
            <p className="mono truncate text-[0.62rem] text-faint">{name}</p>
            <p className="mono tnum mt-1 text-[0.9rem] font-semibold text-text">
              {v ? v.value.toFixed(2) : "—"}
            </p>
            {v && <p className="mono text-[0.6rem] text-faint">{v.label}</p>}
          </div>
        ))}
      </div>
      {volatility.sentence && (
        <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{volatility.sentence}</p>
      )}
    </Section>
  );
}

// ── 4. Sustainability ──────────────────────────────────────────────────────

export function SustainabilityCard({
  sustainability,
  homeName,
  awayName,
}: {
  sustainability: SustainabilityComparison;
  homeName: string;
  awayName: string;
}) {
  if (!sustainability.home && !sustainability.away) return null;
  const riskColor = (r: string) =>
    r === "High" ? "var(--risk)" : r === "Medium" ? "var(--warn)" : "var(--edge)";
  return (
    <Section title="Sustainability">
      <table className="w-full border-collapse text-[0.72rem]">
        <thead>
          <tr className="border-b border-line">
            <th className="label-cap py-1.5 pr-3 text-left font-normal">Metric</th>
            <th className="label-cap py-1.5 pr-3 text-left font-normal">{homeName}</th>
            <th className="label-cap py-1.5 text-left font-normal">{awayName}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <td className="py-1.5 pr-3 text-muted">Regression</td>
            <td
              className="mono py-1.5 pr-3 font-semibold"
              style={{ color: sustainability.home ? riskColor(sustainability.home.regression) : "var(--faint)" }}
            >
              {sustainability.home?.regression ?? "—"}
            </td>
            <td
              className="mono py-1.5 font-semibold"
              style={{ color: sustainability.away ? riskColor(sustainability.away.regression) : "var(--faint)" }}
            >
              {sustainability.away?.regression ?? "—"}
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-3 text-muted">xPts delta</td>
            <td className="mono tnum py-1.5 pr-3 text-text">
              {sustainability.home?.xPtsDelta != null
                ? `${sustainability.home.xPtsDelta > 0 ? "+" : ""}${sustainability.home.xPtsDelta.toFixed(1)}`
                : "—"}
            </td>
            <td className="mono tnum py-1.5 text-text">
              {sustainability.away?.xPtsDelta != null
                ? `${sustainability.away.xPtsDelta > 0 ? "+" : ""}${sustainability.away.xPtsDelta.toFixed(1)}`
                : "—"}
            </td>
          </tr>
        </tbody>
      </table>
      {sustainability.sentence && (
        <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{sustainability.sentence}</p>
      )}
    </Section>
  );
}

// ── 5. Comparative risk ────────────────────────────────────────────────────

export function ComparativeRiskCard({
  risk,
  homeName,
  awayName,
}: {
  risk: ComparativeRisk;
  homeName: string;
  awayName: string;
}) {
  if (risk.rows.length === 0) return null;
  return (
    <Section title="Comparative risk">
      <table className="w-full border-collapse text-[0.72rem]">
        <thead>
          <tr className="border-b border-line">
            <th className="label-cap py-1.5 pr-3 text-left font-normal">Risk</th>
            <th className="label-cap py-1.5 pr-3 text-left font-normal">{homeName}</th>
            <th className="label-cap py-1.5 text-left font-normal">{awayName}</th>
          </tr>
        </thead>
        <tbody>
          {risk.rows.map((r) => (
            <tr key={r.category} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-3 text-muted">{r.category}</td>
              <td className="mono py-1.5 pr-3" style={{ color: r.home ? "var(--risk)" : "var(--edge)" }}>
                {r.home ? "Flagged" : "Clear"}
              </td>
              <td className="mono py-1.5" style={{ color: r.away ? "var(--risk)" : "var(--edge)" }}>
                {r.away ? "Flagged" : "Clear"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{risk.verdict}</p>
    </Section>
  );
}

// ── 6. Venue dependence ─────────────────────────────────────────────────────

export function VenueDependenceCard({
  venue,
  homeName,
  awayName,
}: {
  venue: VenueDependenceComparison;
  homeName: string;
  awayName: string;
}) {
  if (venue.homePct == null && venue.awayPct == null) return null;
  return (
    <Section title="Venue dependence">
      <div className="grid grid-cols-2 gap-2">
        <div className="panel p-3">
          <p className="mono truncate text-[0.62rem] text-faint">{homeName} at home</p>
          <p className="mono tnum mt-1 text-[0.9rem] font-semibold text-text">
            {venue.homePct != null ? `${Math.round(venue.homePct)}%` : "—"}
          </p>
          <p className="mono text-[0.58rem] text-faint">n={venue.homeSample ?? 0}</p>
        </div>
        <div className="panel p-3">
          <p className="mono truncate text-[0.62rem] text-faint">{awayName} away</p>
          <p className="mono tnum mt-1 text-[0.9rem] font-semibold text-text">
            {venue.awayPct != null ? `${Math.round(venue.awayPct)}%` : "—"}
          </p>
          <p className="mono text-[0.58rem] text-faint">n={venue.awaySample ?? 0}</p>
        </div>
      </div>
      {venue.sentence && (
        <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">{venue.sentence}</p>
      )}
    </Section>
  );
}

// ── 7. Where each team has the edge ─────────────────────────────────────────

export function EdgeSummaryCard({
  edges,
  homeName,
  awayName,
}: {
  edges: { home: EdgeItem[]; away: EdgeItem[] };
  homeName: string;
  awayName: string;
}) {
  if (edges.home.length === 0 && edges.away.length === 0) return null;
  const List = ({ name, items }: { name: string; items: EdgeItem[] }) => (
    <div className="panel p-3">
      <p className="mono text-[0.66rem] font-semibold uppercase tracking-widest text-text">
        {name} advantages
      </p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[0.68rem] text-faint">No metric favours this side.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.map((i) => (
            <li key={i.label} className="flex items-start gap-1.5 text-[0.72rem] text-text">
              <span className="mt-0.5 shrink-0" style={{ color: "var(--edge)" }}>
                <IconSupports size={11} />
              </span>
              {i.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Section title="Where each team has the edge">
      <div className="grid gap-2 sm:grid-cols-2">
        <List name={homeName} items={edges.home} />
        <List name={awayName} items={edges.away} />
      </div>
    </Section>
  );
}

// ── 8. Narrative ─────────────────────────────────────────────────────────────

export function MatchNarrativeCard({ narrative }: { narrative: string | null }) {
  if (!narrative) return null;
  return (
    <Section title="Head-to-head summary">
      <p className="max-w-3xl text-[0.8rem] leading-relaxed text-text">{narrative}</p>
    </Section>
  );
}

// ── Wrapper ──────────────────────────────────────────────────────────────────
// One panel, internal sections spaced with space-y-3, matching MatchReport's
// own rhythm so this reads as a continuation of the same report rather than a
// second, differently-paced block underneath it.

export function TeamMatchup({ children }: { children: React.ReactNode }) {
  return (
    <section className="panel space-y-3 p-4" aria-label="Head-to-head comparison">
      <header>
        <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
          Head-to-head
        </h2>
        <p className="mt-1 text-[0.66rem] leading-relaxed text-faint">
          How these two teams compare, built from the same intelligence each team&rsquo;s own page
          shows — not a repeat of it.
        </p>
      </header>
      {children}
    </section>
  );
}
