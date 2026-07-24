"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Region } from "@/lib/region";

export interface LeagueCard {
  id: number;
  name: string;
  href: string;
  teamCount: number | null;
  region: Region;
  calibrated: boolean | null; // null = no model-performance data yet
}

export function LeaguesByRegion({ leagues, regions }: { leagues: LeagueCard[]; regions: Region[] }) {
  const [region, setRegion] = useState<Region | "all">("all");

  const filtered = useMemo(
    () => (region === "all" ? leagues : leagues.filter((l) => l.region === region)),
    [leagues, region]
  );

  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        <RegionPill label="All" active={region === "all"} onClick={() => setRegion("all")} />
        {regions.map((r) => (
          <RegionPill key={r} label={r} active={region === r} onClick={() => setRegion(r)} />
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="mono panel p-6 text-center text-[0.7rem] text-muted">No leagues in this region yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((l) => (
            <Link key={l.id} href={l.href} className="panel-raised block p-4 transition-colors hover:border-faint">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold tracking-tight">{l.name}</h3>
                {l.calibrated === true && (
                  <span className="mono shrink-0 rounded bg-edge/15 px-1.5 py-0.5 text-[0.5rem] font-bold tracking-wider text-edge">CALIBRATED</span>
                )}
                {l.calibrated === false && (
                  <span className="mono shrink-0 rounded bg-warn/15 px-1.5 py-0.5 text-[0.5rem] font-bold tracking-wider text-warn">MONITORING</span>
                )}
              </div>
              <p className="mono mt-1.5 text-[0.6rem] text-faint">{l.teamCount != null ? `${l.teamCount} teams` : "—"}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function RegionPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mono shrink-0 rounded-full px-3 py-1.5 text-[0.65rem] font-semibold tracking-wide transition-colors"
      style={{
        color: active ? "var(--ink)" : "var(--muted)",
        background: active ? "var(--amber)" : "var(--panel)",
        border: `1px solid ${active ? "var(--amber)" : "var(--line)"}`,
      }}
    >
      {label}
    </button>
  );
}
