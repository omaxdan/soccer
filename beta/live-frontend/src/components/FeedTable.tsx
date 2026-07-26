// ─────────────────────────────────────────────────────────────────────────────
// FeedTable — the dashboard feed as a dense grid.
//
// Two rows per fixture, home above away. Match-level columns carry rowspan=2;
// team-level columns render a value in each row. Every cell is tinted by that
// module's status for the fixture, so the table still scans like the pill grid
// it replaces while carrying real numbers.
//
// Mobile first: the wrapper scrolls on both axes, which is what lets the head
// stick to the top AND the first two columns stick to the left. A wrapper with
// only overflow-x becomes a scroll container on both axes anyway, and a
// `top: 0` header then sticks to a box that never scrolls vertically — so it
// would look sticky in devtools and do nothing in the hand.
//
// Server component. No client JavaScript.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  tally,
  overallVerdict,
  statusColor,
  MODULES,
  type ModuleDef,
  type ModuleReading,
  type ModuleStatus,
} from "@/lib/modules";
import type { MatchRow } from "@/lib/types";
import { canSee, type Tier } from "@/lib/tier";
import { Crest } from "./Crest";
import { kickoff } from "@/lib/intel";
import { matchSlug, teamSlug } from "@/lib/slug";
import type { FeedEntry } from "./ModuleFeed";

const DASH = "–";

const n0 = (v: unknown): string => {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? `${Math.round(n)}` : DASH;
};
const pct0 = (v: unknown): string => {
  const s = n0(v);
  return s === DASH ? DASH : `${s}%`;
};

/**
 * What a module contributes to one fixture's two rows.
 *
 * `away === null` means the value is match-level and the cell spans both rows.
 * Units are whatever the warehouse actually holds — see the note in the commit
 * message about why four of these are not 0–100 scores.
 */
interface Cell {
  home: string;
  away: string | null;
}

function cellFor(def: ModuleDef, e: FeedEntry): Cell {
  const m = e.match;
  const i = m.intel;
  const hv = m.homeVenue;
  const av = m.awayVenue;

  switch (def.key) {
    case "home_away":
      return {
        home: hv?.home_win_pct != null ? `H ${pct0(hv.home_win_pct)}` : "H",
        away: av?.away_win_pct != null ? `A ${pct0(av.away_win_pct)}` : "A",
      };
    case "readiness":
      return {
        home: n0(m.homeIntel?.readiness_score),
        away: n0(m.awayIntel?.readiness_score),
      };
    case "consistency": {
      // Volatility, not a 0–100 score: lower is steadier.
      const f = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : DASH;
      return {
        home: f(m.homeFormQuality?.volatility),
        away: f(m.awayFormQuality?.volatility),
      };
    }
    case "giant_killer":
      return {
        home: n0(m.homeFormQuality?.giant_killer_score),
        away: n0(m.awayFormQuality?.giant_killer_score),
      };
    case "travel": {
      const hf = m.travel?.home_fatigue_score;
      const af = m.travel?.away_fatigue_score;
      if (hf != null || af != null) return { home: n0(hf), away: n0(af) };
      const trip = m.travel?.away_trip_km ?? i?.away_travel_distance_km ?? null;
      return { home: "0", away: trip != null ? `${Math.round(trip)}` : DASH };
    }
    case "rest":
      return {
        home: i?.home_rest_days != null ? `${i.home_rest_days}d` : DASH,
        away: i?.away_rest_days != null ? `${i.away_rest_days}d` : DASH,
      };
    case "form_gap":
      return {
        home: n0(m.homeIntel?.form_index),
        away: n0(m.awayIntel?.form_index),
      };
    case "clean_sheet": {
      const sp = m.scoring;
      const hc = sp?.home_concedes_pct;
      const ac = sp?.away_concedes_pct;
      const inv = (v: unknown) => {
        const s = n0(v);
        return s === DASH ? DASH : `${100 - Number(s)}%`;
      };
      return { home: inv(hc), away: inv(ac) };
    }

    // ── Match-level from here: one value, spanning both rows ──────────────
    case "league_goals":
      return { home: pct0(m.scoring?.league_btts_pct), away: null };
    case "btts_fatigue":
      return { home: pct0(m.scoring?.btts_pct), away: null };
    case "confidence":
      return { home: n0(i?.confidence_score), away: null };
    case "halftime": {
      const ht = m.halfTime;
      if (!ht) return { home: DASH, away: null };
      const paths: [string, number | null | undefined][] = [
        ["H/H", ht.hh_prob],
        ["D/H", ht.dh_prob],
        ["D/D", ht.dd_prob],
        ["A/A", ht.aa_prob],
      ];
      const best = paths
        .filter(([, v]) => v != null)
        .sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      return { home: best ? best[0] : DASH, away: null };
    }
    case "weather": {
      const t = m.weather?.temperature_c;
      return { home: t != null ? `${Math.round(t)}°` : DASH, away: null };
    }
    default:
      return { home: DASH, away: null };
  }
}

function tint(status: ModuleStatus | null, locked: boolean) {
  if (locked || status == null || status === "inactive") {
    return { color: "var(--faint)", background: "transparent" };
  }
  const c = statusColor(status);
  return { color: c, background: `color-mix(in srgb, ${c} 15%, transparent)` };
}

// Sticky offsets must match the widths below or the columns overlap.
const TIME_W = "5.5rem";
const TEAM_W = "9rem";

function TeamCell({ team, sub }: { team: MatchRow["home"]; sub: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Crest team={team} size={16} />
      <Link
        href={`/team/${teamSlug(team)}`}
        className="mono truncate text-[0.7rem] font-semibold text-text transition-colors hover:text-amber md:text-[0.78rem]"
      >
        {team.short_name || team.name}
      </Link>
      <span className="mono ml-auto shrink-0 text-[0.55rem] text-faint">{sub}</span>
    </span>
  );
}

/** How the table breaks fixtures into sections. */
export type FeedGrouping = "league" | "day";

function groupLabel(e: FeedEntry, by: FeedGrouping): string {
  if (by === "day")
    return new Date(e.match.date).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  return e.match.competition ?? e.match.tournament?.name ?? "Other";
}

export function FeedTable({
  entries,
  viewer,
  groupBy = "league",
  maxHeight = "calc(100vh - 11rem)",
}: {
  entries: FeedEntry[];
  viewer: Tier;
  /** Board groups by competition; the schedule view groups by match day. */
  groupBy?: FeedGrouping;
  /** The wrapper must scroll vertically for the sticky head to do anything. */
  maxHeight?: string;
}) {
  // Ordering was already applied by the caller; grouping preserves it.
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const key = groupLabel(e, groupBy);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const headCell =
    "sticky top-0 z-20 whitespace-nowrap bg-panel px-1 py-2 text-center font-normal";
  const stickyBody = "sticky z-10 bg-panel";

  return (
    <div className="panel overflow-auto" style={{ maxHeight }}>
      <table className="w-full min-w-[54rem] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th
              className={`${headCell} !z-30 text-left`}
              style={{ left: 0, position: "sticky", width: TIME_W, minWidth: TIME_W }}
            >
              <span className="label-cap">Time</span>
            </th>
            <th
              className={`${headCell} !z-30 text-left`}
              style={{ left: TIME_W, position: "sticky", width: TEAM_W, minWidth: TEAM_W }}
            >
              <span className="label-cap">Team</span>
            </th>
            {MODULES.map((def) => (
              <th key={def.key} className={headCell} title={`M${def.n} ${def.name}`}>
                <span className="label-cap">{def.abbrev}</span>
              </th>
            ))}
          </tr>
        </thead>

        {[...groups.entries()].map(([label, list]) => (
          <tbody key={label}>
            <tr>
              <td
                colSpan={MODULES.length + 2}
                className="mono border-y border-line bg-raised px-2 py-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted"
              >
                {label}
                <span className="ml-2 tnum text-faint">{list.length}</span>
              </td>
            </tr>

            {list.map((e) => {
              const m = e.match;
              const k = kickoff(m.date);
              const t = tally(e.readings);
              const overall = overallVerdict(t);
              const byKey = new Map(e.readings.map((r) => [r.def.key, r]));

              return (
                <React.Fragment key={m.id}>
                  {/* Home row */}
                  <tr className="border-t border-line/70 transition-colors hover:bg-raised">
                    <td
                      rowSpan={2}
                      className={`${stickyBody} px-2 py-1.5 align-middle`}
                      style={{ left: 0, minWidth: TIME_W }}
                    >
                      <Link href={`/match/${matchSlug(m)}`} className="block">
                        <span className="mono block text-[0.65rem] text-faint">{k.day}</span>
                        <span className="mono tnum block text-[0.75rem] text-text">{k.time}</span>
                        <span
                          className="mono mt-1 inline-block rounded px-1 py-px text-[0.5rem] font-bold tracking-widest"
                          style={{
                            color: overall.color,
                            background: `color-mix(in srgb, ${overall.color} 15%, transparent)`,
                          }}
                        >
                          {overall.label}
                        </span>
                      </Link>
                    </td>
                    <td
                      className={`${stickyBody} px-2 py-1`}
                      style={{ left: TIME_W, minWidth: TEAM_W }}
                    >
                      <TeamCell team={m.home} sub="H" />
                    </td>
                    {MODULES.map((def) => {
                      const r = byKey.get(def.key) ?? null;
                      const locked = !canSee(def, viewer);
                      const c = cellFor(def, e);
                      const span = c.away === null ? 2 : 1;
                      return (
                        <td
                          key={def.key}
                          rowSpan={span}
                          className="mono tnum px-1 py-1 text-center text-[0.68rem] md:text-[0.75rem]"
                          style={tint(r?.status ?? null, locked)}
                        >
                          {locked ? DASH : c.home}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Away row — rowspan columns are omitted, not blanked */}
                  <tr className="transition-colors hover:bg-raised">
                    <td
                      className={`${stickyBody} px-2 py-1`}
                      style={{ left: TIME_W, minWidth: TEAM_W }}
                    >
                      <TeamCell team={m.away} sub="A" />
                    </td>
                    {MODULES.filter((def) => cellFor(def, e).away !== null).map((def) => {
                      const r = byKey.get(def.key) ?? null;
                      const locked = !canSee(def, viewer);
                      const c = cellFor(def, e);
                      return (
                        <td
                          key={def.key}
                          className="mono tnum px-1 py-1 text-center text-[0.68rem] md:text-[0.75rem]"
                          style={tint(r?.status ?? null, locked)}
                        >
                          {locked ? DASH : (c.away as string)}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
