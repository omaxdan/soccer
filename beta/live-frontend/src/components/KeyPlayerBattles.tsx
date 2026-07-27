// ─────────────────────────────────────────────────────────────────────────────
// KeyPlayerBattles — two attackers, two midfielders and two defenders per side,
// paired across the fixture.
//
// Ranked on player_match_impact, which is already scoped to THIS match, so its
// scores carry the opponent context that player_intelligence deliberately does
// not. Every criterion is a column: no rating is invented, and no player is
// ranked on a metric their position does not have.
//
// The brief's rule that this "should not simply list the highest-rated players"
// is what the per-line ranking implements — a defender is ranked against
// defenders on defensive columns, not against a striker on impact_score.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { MatchRow, MatchPlayerImpact } from "@/lib/types";
import { lineOf } from "@/lib/formation";

type Line = "FWD" | "MID" | "DEF";

const LINES: { key: Line; label: string }[] = [
  { key: "FWD", label: "Attack" },
  { key: "MID", label: "Midfield" },
  { key: "DEF", label: "Defence" },
];

const avg = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Ranking metric per line, and the label naming it. Which columns matter is
 * the brief's selection criteria, mapped onto what player_match_impact holds.
 */
function rankOf(p: MatchPlayerImpact, line: Line): { score: number | null; basis: string } {
  if (line === "FWD")
    return { score: avg([p.goal_threat, p.assist_threat, p.impact_score]), basis: "goal threat" };
  if (line === "MID")
    return {
      score: avg([p.creativity_score, p.defensive_contribution, p.impact_score]),
      basis: "creativity and cover",
    };
  return {
    score: avg([p.defensive_contribution, p.impact_score]),
    basis: "defensive contribution",
  };
}

function pickTwo(pool: MatchPlayerImpact[], line: Line) {
  return pool
    .filter((p) => lineOf(p.position_code) === line)
    .map((p) => ({ p, ...rankOf(p, line) }))
    .filter((x): x is { p: MatchPlayerImpact; score: number; basis: string } => x.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

function tone(score: number): string {
  if (score >= 75) return "var(--edge)";
  if (score >= 55) return "var(--warn)";
  return "var(--muted)";
}

function Side({
  entry,
  align,
}: {
  entry: { p: MatchPlayerImpact; score: number } | undefined;
  align: "left" | "right";
}) {
  if (!entry)
    return <span className="mono flex-1 text-[0.66rem] text-faint">Not enough data</span>;
  const { p, score } = entry;
  const rounded = Math.round(score);
  return (
    <span className={`flex min-w-0 flex-1 flex-col ${align === "right" ? "items-end text-right" : ""}`}>
      <span className="mono truncate text-[0.74rem] font-semibold text-text">
        {p.jersey_number != null && (
          <span className="mr-1 text-[0.58rem] text-faint">{p.jersey_number}</span>
        )}
        {p.short_name || p.name}
      </span>
      <span className="mono text-[0.56rem] text-faint">{p.position_code ?? "—"}</span>
      <span className="mono tnum text-[0.95rem] font-semibold" style={{ color: tone(rounded) }}>
        {rounded}
      </span>
    </span>
  );
}

export function KeyPlayerBattles({
  match,
  impacts,
}: {
  match: MatchRow;
  impacts: MatchPlayerImpact[];
}) {
  if (impacts.length === 0) return null;

  const home = impacts.filter((p) => p.team_id === match.home.id);
  const away = impacts.filter((p) => p.team_id === match.away.id);

  const rows = LINES.map(({ key, label }) => {
    const h = pickTwo(home, key);
    const a = pickTwo(away, key);
    return { key, label, h, a, basis: rankOf(home[0] ?? away[0] ?? ({} as any), key).basis };
  }).filter((r) => r.h.length > 0 || r.a.length > 0);

  if (rows.length === 0) return null;

  const homeName = match.home.short_name || match.home.name;
  const awayName = match.away.short_name || match.away.name;

  return (
    <section>
      <h2 className="mono mb-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Key player battles
      </h2>
      <p className="mb-3 text-[0.65rem] leading-relaxed text-faint">
        Two per line from each side, ranked within their own line on this fixture&rsquo;s impact
        scores — a defender against defenders, not against a striker.
      </p>

      <div className="space-y-3">
        {rows.map((r) => (
          <article key={r.key} className="panel p-3.5">
            <header className="mb-2 flex items-baseline gap-2 border-b border-line pb-1.5">
              <h3 className="mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted">
                {r.label}
              </h3>
              <span className="mono ml-auto text-[0.55rem] text-faint">by {r.basis}</span>
            </header>
            <div className="space-y-2">
              {[0, 1].map((idx) => {
                const h = r.h[idx];
                const a = r.a[idx];
                if (!h && !a) return null;
                return (
                  <div key={idx} className="flex items-center gap-3">
                    <Side entry={h} align="left" />
                    <span className="mono shrink-0 text-[0.55rem] tracking-widest text-faint">
                      VS
                    </span>
                    <Side entry={a} align="right" />
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      <p className="mono mt-2 text-[0.56rem] text-faint">
        {homeName} left · {awayName} right
      </p>
    </section>
  );
}
