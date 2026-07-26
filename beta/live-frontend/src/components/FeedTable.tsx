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
import { matchSlug } from "@/lib/slug";
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
      <span className="mono truncate text-[0.7rem] font-semibold text-text md:text-[0.78rem]">
        {team.short_name || team.name}
      </span>
      <span className="mono ml-auto shrink-0 text-[0.55rem] text-faint">{sub}</span>
    </span>
  );
}

/**
 * Fills a cell with a link to the fixture, so the whole row is a target
 * without any client JavaScript.
 *
 * Only the kickoff cell carries an accessible name; the rest are hidden from
 * assistive tech and removed from the tab order. Otherwise a screen reader
 * would announce thirty identical "Santos vs Chapecoense" links per fixture
 * and the keyboard would need thirty tabs to cross one row.
 */
function CellLink({
  href,
  children,
  label,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const hidden = label == null;
  return (
    <Link
      href={href}
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      className={`block h-full w-full ${className}`}
    >
      {children}
    </Link>
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

/**
 * Column key. Open by default so the abbreviations are discoverable without a
 * hover — the <th> title attributes only help on a pointer device, and this
 * table is designed for a phone first.
 */
export function ColumnKey() {
  const swatch = (status: ModuleStatus, label: string) => {
    const c = statusColor(status);
    return (
      <span key={label} className="inline-flex items-center gap-1">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: `color-mix(in srgb, ${c} 55%, transparent)` }}
          aria-hidden="true"
        />
        <span className="text-faint">{label}</span>
      </span>
    );
  };
  return (
    <details open className="panel px-3 py-2">
      <summary className="mono flex cursor-pointer list-none items-center gap-2 text-[0.6rem] uppercase tracking-[0.14em] text-muted [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-faint transition-transform [details[open]_&]:rotate-90">
          ›
        </span>
        Column key
      </summary>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {MODULES.map((def) => (
          <li key={def.key} className="text-[0.6rem] leading-relaxed">
            <span className="mono font-semibold text-text">{def.abbrev}</span>{" "}
            <span className="text-muted">{def.name}</span>
          </li>
        ))}
      </ul>
      <p className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-2 text-[0.58rem]">
        {swatch("supports", "supports the pick")}
        {swatch("neutral", "neutral")}
        {swatch("contradicts", "contradicts the pick")}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-line" aria-hidden="true" />
          <span className="text-faint">did not fire</span>
        </span>
      </p>
    </details>
  );
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
                  <tr className="border-t border-line transition-colors hover:bg-raised">
                    <td
                      rowSpan={2}
                      className={`${stickyBody} px-2 py-1.5 align-middle`}
                      style={{ left: 0, minWidth: TIME_W }}
                    >
                      <CellLink
                        href={`/match/${matchSlug(m)}`}
                        label={`${m.home.short_name || m.home.name} versus ${m.away.short_name || m.away.name}, ${k.day} ${k.time}`}
                      >
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
                      </CellLink>
                    </td>
                    <td
                      className={`${stickyBody} px-2 py-1`}
                      style={{ left: TIME_W, minWidth: TEAM_W }}
                    >
                      <CellLink href={`/match/${matchSlug(m)}`}>
                        <TeamCell team={m.home} sub="H" />
                      </CellLink>
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
                          <CellLink href={`/match/${matchSlug(m)}`}>
                            {locked ? DASH : c.home}
                          </CellLink>
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
                      <CellLink href={`/match/${matchSlug(m)}`}>
                        <TeamCell team={m.away} sub="A" />
                      </CellLink>
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
                          <CellLink href={`/match/${matchSlug(m)}`}>
                            {locked ? DASH : (c.away as string)}
                          </CellLink>
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


// ── Date navigation ──────────────────────────────────────
// A strip rather than a dropdown: the days come from the fixtures actually
// present, so it never offers an empty date, and one compact scrollable line
// is less friction than opening a menu to change the thing this page is
// organised around. Links, so it works without JavaScript and is shareable.

export interface DayOption {
  /** YYYY-MM-DD, the value carried in ?date= */
  key: string;
  label: string;
  count: number;
  isToday: boolean;
}

export function dayKeyOf(date: string | Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function buildDayOptions(entries: FeedEntry[]): DayOption[] {
  const today = dayKeyOf(new Date());
  const counts = new Map<string, number>();
  for (const e of entries) {
    const k = dayKeyOf(e.match.date);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const d = new Date(`${key}T12:00:00`);
      return {
        key,
        count,
        isToday: key === today,
        label:
          key === today
            ? "Today"
            : d.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
      };
    });
}

export function DateNav({
  days,
  active,
  total,
}: {
  days: DayOption[];
  active: string | null;
  total: number;
}) {
  if (days.length <= 1) return null;
  const chip = (href: string, label: string, count: number, on: boolean) => (
    <Link
      key={href}
      href={href}
      className="mono shrink-0 rounded-term px-2.5 py-1.5 text-[0.62rem] tracking-wide transition-colors"
      style={{
        color: on ? "var(--ink)" : "var(--muted)",
        background: on ? "var(--amber)" : "transparent",
        border: `1px solid ${on ? "var(--amber)" : "var(--line)"}`,
      }}
    >
      {label}
      <span className={`ml-1.5 tnum ${on ? "opacity-70" : "text-faint"}`}>{count}</span>
    </Link>
  );
  return (
    <nav
      aria-label="Match day"
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chip("/matches", "All", total, active == null)}
      {days.map((d) =>
        chip(`/matches?date=${d.key}`, d.label, d.count, active === d.key)
      )}
    </nav>
  );
}
