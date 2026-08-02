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
import Link from "next/link";
import type { MatchRow, PredictedLineupPlayer } from "@/lib/types";
import { getFormationName, lineOfPlayer, naturalPositionOf } from "@/lib/formation";
import { playerSlug } from "@/lib/slug";
import { Crest } from "./Crest";

/** Shared thresholds — the legend below renders from this same table. */
const BANDS = [
  { min: 80, color: "var(--edge)", label: "High ≥80%" },
  { min: 60, color: "var(--warn)", label: "Medium 60–79%" },
  { min: 0, color: "var(--risk)", label: "Low <60%" },
] as const;

/**
 * match_predicted_lineups.confidence is stored as a FRACTION (0.95, not 95).
 * Math.round() on it returned 1, which rendered as "1%" for every player and
 * an average of "1%" for the XI. Scaled here, tolerant of either convention in
 * case the column is ever normalised.
 */
function asPct(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v <= 1 ? v * 100 : v;
}

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
  const raw = asPct(p.confidence);
  const pct = raw != null ? Math.round(raw) : null;
  const color = confColor(pct);
  const name = p.player?.short_name || p.player?.name || `#${p.player_id}`;
  // Alternative positions come from players.secondary/tertiary_position — real
  // columns, so an absent one simply renders nothing.
  const alts = [p.secondary_position, p.tertiary_position].filter(Boolean) as string[];

  // The engine stores both where a player is being PLAYED (the tactical slot,
  // shown in the right-hand column) and where he normally plays. When they
  // differ, that is a real selection call worth surfacing rather than hiding
  // behind a single position label.
  const natural = naturalPositionOf(p);
  const slot = p.tactical_position ?? p.position_code;
  const outOfPosition =
    natural != null && slot != null && natural.toUpperCase() !== slot.toUpperCase();

  return (
    <li className="flex items-center gap-2 rounded-term px-2 py-1.5 odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]">
      <span className="mono tnum w-6 shrink-0 text-right text-[0.62rem] text-faint">
        {p.shirt_number ?? "—"}
      </span>
      <span className="min-w-0 flex-1">
        <Link
          href={`/player/${playerSlug({ id: p.player_id, name: p.player?.name ?? p.player?.short_name ?? `Player ${p.player_id}` })}`}
          className="mono block truncate text-[0.74rem] font-semibold text-text hover:text-amber active:text-amber"
        >
          {name}
          {p.is_captain && (
            <span
              className="ml-1.5 rounded px-1 text-[0.5rem] font-bold tracking-wide"
              style={{ color: "var(--amber)", background: "var(--amber-dim)" }}
              title="Captain"
            >
              C
            </span>
          )}
          {p.is_vice_captain && (
            <span className="ml-1.5 text-[0.5rem] font-bold tracking-wide text-faint" title="Vice-captain">
              VC
            </span>
          )}
          {p.player?.current_injury && (
            <span className="ml-1.5 text-[0.55rem]" style={{ color: "var(--risk)" }}>
              DOUBT
            </span>
          )}
        </Link>
        {outOfPosition && (
          <span className="mono block truncate text-[0.56rem]" style={{ color: "var(--warn)" }}>
            Natural {natural}
          </span>
        )}
        {!outOfPosition && alts.length > 0 && (
          <span className="mono block truncate text-[0.56rem] text-faint">
            Also plays {alts.join(", ")}
          </span>
        )}
      </span>
      <span className="mono w-9 shrink-0 text-[0.6rem] text-muted">{slot ?? "—"}</span>
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
    .map((p) => asPct(p.confidence))
    .filter((c): c is number => c != null);
  const avg = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;

  const starts = players
    .map((p) => p.matches_started)
    .filter((s): s is number => s != null)
    .reduce((a, b) => a + b, 0);

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
              <dt className="label-cap">Average XI confidence</dt>
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
              <dt className="label-cap">Historical starts</dt>
              <dd className="mono tnum text-[0.78rem] text-text">{starts.toLocaleString()}</dd>
            </div>
          )}
        </dl>
      </header>

      {/* Formation first — it frames everything below it. */}
      {GROUPS.map(({ key, label }) => {
        const group = players.filter((p) => lineOfPlayer(p) === key);
        if (group.length === 0) return null;
        return (
          <div key={key} className="mt-2.5">
            <div className="label-cap mb-1">{label}</div>
            <ul className="space-y-px">
              {[...group]
                .sort((a, b) => (asPct(b.confidence) ?? 0) - (asPct(a.confidence) ?? 0))
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
        Each percentage is the likelihood that player starts, from season starts, recent form,
        injury status and availability.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <TeamXI team={match.home} players={homeLineup} />
        <TeamXI team={match.away} players={awayLineup} />
      </div>
    </section>
  );
}
