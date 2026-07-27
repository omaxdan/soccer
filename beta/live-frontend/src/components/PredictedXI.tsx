// ─────────────────────────────────────────────────────────────────────────────
// PredictedXI — the full predicted starting eleven, per team.
//
// Replaces the two-line summary ("4-4-2 — DEF 82% · MID 74% · ATT 84%"), which
// told a reader nothing they could act on. Same prediction, same confidence
// values, same formation logic — this only exposes more of what was already
// computed.
//
// Versatility renders only where player_versatility holds a row. No score is
// derived for players without one.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { MatchRow, PredictedLineupPlayer } from "@/lib/types";
import { getFormationName, lineOf } from "@/lib/formation";
import { Crest } from "./Crest";

/** Shared thresholds — the legend below renders from this same table. */
const BANDS = [
  { min: 80, color: "var(--edge)", label: "High ≥80%" },
  { min: 60, color: "var(--warn)", label: "Medium 60–79%" },
  { min: 0, color: "var(--risk)", label: "Low <60%" },
] as const;

function confColor(pct: number | null): string {
  if (pct == null) return "var(--faint)";
  return (BANDS.find((b) => pct >= b.min) ?? BANDS[2]).color;
}

const GROUPS: { key: "GK" | "DEF" | "MID" | "FWD"; label: string }[] = [
  { key: "GK", label: "Goalkeeper" },
  { key: "DEF", label: "Defenders" },
  { key: "MID", label: "Midfielders" },
  { key: "FWD", label: "Forwards" },
];

function PlayerChip({ p }: { p: PredictedLineupPlayer }) {
  const pct = p.confidence != null ? Math.round(p.confidence) : null;
  const color = confColor(pct);
  const name = p.player?.short_name || p.player?.name || `#${p.player_id}`;
  // Alternative positions come from players.secondary/tertiary_position — real
  // columns, so an absent one simply renders nothing.
  const alts = [p.secondary_position, p.tertiary_position].filter(Boolean) as string[];

  return (
    <li className="flex items-center gap-2 rounded-term px-2 py-1.5 odd:bg-raised/40">
      <span className="mono tnum w-6 shrink-0 text-right text-[0.62rem] text-faint">
        {p.shirt_number ?? "—"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[0.74rem] font-semibold text-text">
          {name}
          {p.player?.current_injury && (
            <span className="ml-1.5 text-[0.55rem]" style={{ color: "var(--risk)" }}>
              DOUBT
            </span>
          )}
        </span>
        {(alts.length > 0 || p.versatility_score != null) && (
          <span className="mono block truncate text-[0.56rem] text-faint">
            {alts.join(" · ")}
            {alts.length > 0 && p.versatility_score != null && " · "}
            {p.versatility_score != null && `${Math.round(p.versatility_score)}% versatility`}
          </span>
        )}
      </span>
      <span className="mono w-9 shrink-0 text-[0.6rem] text-muted">{p.position_code ?? "—"}</span>
      <span
        className="mono tnum w-10 shrink-0 text-right text-[0.7rem] font-semibold"
        style={{ color }}
      >
        {pct != null ? `${pct}%` : "—"}
      </span>
    </li>
  );
}

function TeamXI({
  team,
  players,
}: {
  team: MatchRow["home"];
  players: PredictedLineupPlayer[];
}) {
  if (players.length === 0) return null;

  const confs = players
    .map((p) => p.confidence)
    .filter((c): c is number => c != null);
  const avg = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  const starts = players
    .map((p) => p.matches_started)
    .filter((s): s is number => s != null)
    .reduce((a, b) => a + b, 0);

  const vers = players
    .map((p) => p.versatility_score)
    .filter((v): v is number => v != null);
  const avgVers = vers.length ? vers.reduce((a, b) => a + b, 0) / vers.length : null;

  return (
    <article className="panel p-4">
      <header className="border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <Crest team={team} size={22} />
          <h3 className="mono truncate text-[0.82rem] font-semibold text-text">
            {team.short_name || team.name}
          </h3>
          <span className="mono ml-auto shrink-0 text-[0.62rem] text-muted">
            {getFormationName(players)}
          </span>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {avg != null && (
            <div>
              <dt className="label-cap">Avg confidence</dt>
              <dd
                className="mono tnum text-[0.78rem] font-semibold"
                style={{ color: confColor(avg) }}
              >
                {Math.round(avg)}%
              </dd>
            </div>
          )}
          {starts > 0 && (
            <div>
              <dt className="label-cap">Starts represented</dt>
              <dd className="mono tnum text-[0.78rem] text-text">{starts.toLocaleString()}</dd>
            </div>
          )}
          {avgVers != null && (
            <div>
              <dt className="label-cap">Positional versatility</dt>
              <dd className="mono tnum text-[0.78rem] text-text">{Math.round(avgVers)}%</dd>
            </div>
          )}
        </dl>
      </header>

      {GROUPS.map(({ key, label }) => {
        const group = players.filter((p) => lineOf(p.position_code) === key);
        if (group.length === 0) return null;
        return (
          <div key={key} className="mt-2.5">
            <div className="label-cap mb-1">{label}</div>
            <ul className="space-y-px">
              {[...group]
                .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
                .map((p) => (
                  <PlayerChip key={p.player_id} p={p} />
                ))}
            </ul>
          </div>
        );
      })}

      <p className="mono mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[0.56rem]">
        {BANDS.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: b.color }}
              aria-hidden="true"
            />
            <span className="text-faint">{b.label}</span>
          </span>
        ))}
      </p>
    </article>
  );
}

export function PredictedXI({
  match,
  homeLineup,
  awayLineup,
}: {
  match: MatchRow;
  homeLineup: PredictedLineupPlayer[];
  awayLineup: PredictedLineupPlayer[];
}) {
  if (homeLineup.length === 0 && awayLineup.length === 0) return null;
  return (
    <section>
      <h2 className="mono mb-1 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Predicted lineups
      </h2>
      <p className="mb-3 text-[0.65rem] leading-relaxed text-faint">
        From season starts, recent form, injury status and availability. Confidence is the
        prediction&rsquo;s own, unchanged.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <TeamXI team={match.home} players={homeLineup} />
        <TeamXI team={match.away} players={awayLineup} />
      </div>
    </section>
  );
}
