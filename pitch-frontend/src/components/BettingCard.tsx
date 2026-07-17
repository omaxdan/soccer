"use client";

import Link from "next/link";
import type { DailyBettingCard, BankerSingle, Accumulator } from "@/lib/types";
import { Crest } from "@/components/Crest";

interface Props {
  card: DailyBettingCard;
}

function bettingSlug(single: BankerSingle): string {
  const home = (single.home_short || "team").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const away = (single.away_short || "team").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${home}-v-${away}-${single.match_id}`;
}

function groupByDate(singles: BankerSingle[]): Map<string, BankerSingle[]> {
  const map = new Map<string, BankerSingle[]>();
  const sorted = [...singles].sort((a, b) => a.match_date.localeCompare(b.match_date));
  for (const s of sorted) {
    const existing = map.get(s.match_date) || [];
    existing.push(s);
    map.set(s.match_date, existing);
  }
  return map;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dateOnly = (dt: Date) => dt.toISOString().split("T")[0];
  
  if (dateOnly(d) === dateOnly(today)) {
    return `Today — ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  }
  if (dateOnly(d) === dateOnly(tomorrow)) {
    return `Tomorrow — ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
  }
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

// SVG Home Icon
function HomeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h3v-5h6v5h3a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function BettingCard({ card }: Props) {
  const bankers = card.singles.filter((s) => s.confidence === "BANKER");
  const strongs = card.singles.filter((s) => s.confidence === "STRONG");
  
  const todayDouble = card.accumulators.find((a) => a.bet_type === "DOUBLE");
  const todayTreble = card.accumulators.find((a) => a.bet_type === "TREBLE");

  const allPicks = [...bankers, ...strongs];
  const grouped = groupByDate(allPicks);


  return (
    <section className="scanlines panel overflow-hidden p-5">
      <p className="eyebrow">Form Index Picks</p>
      <h2 className="mt-1 text-[1.35rem] font-semibold leading-tight tracking-tight sm:text-2xl">
        {card.day}&rsquo;s Banker Bets
      </h2>
      <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
        {card.description}
    </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <MiniStat label="BANKERS" value={bankers.length} color="var(--edge)" />
        <MiniStat label="STRONG" value={strongs.length} color="var(--amber)" />
        <MiniStat 
          label="Best Acc" 
          value={`${todayDouble ? Math.round(todayDouble.acc_probability * 100) : 0}%`}
          color="var(--accent)" 
        />
      </div>


      {/* Pick of the day */}
      {bankers[0] && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label-cap">Pick of the day</p>
          <Link
            href={`/match/${bettingSlug(bankers[0])}`}
            className="mt-1 block text-[0.85rem] leading-snug text-text hover:text-amber transition-colors"
          >
            <span className="mono font-bold" style={{ color: "var(--edge)" }}>
              {bankers[0].bet_label}
            </span>{" "}
            — Gap +{bankers[0].form_gap}, {bankers[0].historical_win_pct}% win rate,
            {" "}{bankers[0].competition}
          </Link>
        </div>
      )}
      
      {/* Accumulators */}
      {(todayDouble || todayTreble) && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="label-cap mb-3">ACCUMULATORS</p>
          <div className="space-y-3">
            {todayDouble && <AccumulatorRow acc={todayDouble} />}
            {todayTreble && <AccumulatorRow acc={todayTreble} />}
          </div>
        </div>
      )}

      {/* Singles by date */}
      <div className="mt-4 space-y-4">
        {Array.from(grouped.entries()).map(([date, picks]) => (
          <div key={date}>
            <p className="label-cap mb-2 text-text">
              {formatDateLabel(date)}
              <span className="ml-2 text-faint mono text-[0.65rem]">
                {picks.length} pick{picks.length > 1 ? "s" : ""}
              </span>
            </p>

            {/* Header - updated to match data rows */}
            <div className="mono grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-2 border-b border-line px-2 pb-1 text-[0.55rem] uppercase tracking-wide text-faint">
              <span>Teams</span>
              <span className="text-center">Form</span>
              <span className="text-center">Gap</span>
            </div>

            <div className="divide-y divide-line">
              {picks.map((pick) => (
                <PicksRow key={pick.match_id} single={pick} />
              ))}
            </div>
          </div>
        ))}
      </div>

    </section>
  );
}

function MiniStat({
  label, value, color,
}: {
  label: string; value: string | number; color: string;
}) {
  return (
    <div className="panel-raised p-3">
      <div className="label-cap">{label}</div>
      <div className="mono mt-1 text-2xl font-bold leading-none tnum" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function teamIdFromName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Form result colors
function formPillColor(result: string): { text: string; bg: string } {
  if (result === "W") return { text: "var(--edge)", bg: "color-mix(in srgb, var(--edge) 16%, transparent)" };
  if (result === "D") return { text: "var(--amber)", bg: "color-mix(in srgb, var(--amber) 16%, transparent)" };
  if (result === "L") return { text: "#E5787A", bg: "color-mix(in srgb, #E5787A 16%, transparent)" };
  return { text: "var(--faint)", bg: "transparent" };
}

function FormPill({ result }: { result: string }) {
  const { text, bg } = formPillColor(result);
  return (
    <span
      className="mono grid h-4 w-4 place-items-center rounded-[3px] text-[0.6rem] font-bold"
      style={{ color: text, background: bg }}
    >
      {result}
    </span>
  );
}

function FormString({ results }: { results: string }) {
  if (!results || results.length === 0) {
    return <span className="mono text-[0.55rem] text-faint">—</span>;
  }
  return (
    <span className="flex gap-0.5">
      {results.slice(0, 5).split("").map((r, i) => (
        <FormPill key={i} result={r} />
      ))}
    </span>
  );
}

function PicksRow({ single }: { single: BankerSingle }) {
  return (
    <Link
      href={`/match/${bettingSlug(single)}`}
      className="grid grid-cols-[1fr_3.5rem_3.5rem] items-center gap-2 py-2 transition-colors hover:bg-raised"
    >
      {/* Teams - takes up the first column */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <Crest
            team={{
              id: teamIdFromName(single.home_short),
              name: single.home_short,
              short_name: single.home_short,
              crest_storage_path: single.home_crest,
            }}
            size={16}
          />
          <span className="text-[0.75rem] font-medium truncate">{single.home_short}</span>
          {single.confidence === "BANKER" && (
            <span
              className="mono text-[0.5rem] px-1 py-0.5 rounded font-bold inline-flex items-center gap-0.5"
              style={{
                color: "var(--edge)",
                background: "color-mix(in srgb, var(--edge) 15%, transparent)",
              }}
            >
              <HomeIcon />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Crest
            team={{
              id: teamIdFromName(single.away_short),
              name: single.away_short,
              short_name: single.away_short,
              crest_storage_path: single.away_crest,
            }}
            size={16}
          />
          <span className="text-[0.75rem] truncate text-muted">{single.away_short}</span>
        </div>
      </div>

      {/* Form - second column, contains both home and away forms stacked */}
      <div className="flex flex-col gap-1 items-center">
        <FormString results={single.home_form_string || ""} />
        <FormString results={single.away_form_string || ""} />
      </div>

      {/* Gap - third column */}
      <span className="text-center mono text-[0.75rem] font-bold" style={{ color: "var(--edge)" }}>
        +{single.form_gap}
      </span>
    </Link>
  );
}

function AccumulatorRow({ acc }: { acc: Accumulator }) {
  return (
    <div className="panel-raised p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">{acc.name}</span>
        <span className="mono text-sm font-bold" style={{ color: "var(--amber)" }}>
          {(acc.acc_probability * 100).toFixed(1)}%
        </span>
      </div>

      {acc.matches.map((m, i) => (
        <div key={m.match_id}>
          {i > 0 && <div className="border-t border-line my-1.5" />}
          <p className="text-[0.75rem] text-muted leading-snug py-0.5">{m.match_up}</p>
        </div>
      ))}
    </div>
  );
}