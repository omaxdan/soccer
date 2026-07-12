"use client";

import { useState } from "react";
import type { PredictedLineupPlayer, TeamLite } from "@/lib/types";
import { placeLineup, unitConfidence, versatilityBadge } from "@/lib/formation";

const LINE_COLOR: Record<string, string> = {
  GK: "var(--amber)",
  DEF: "var(--cool)",
  MID: "var(--edge)",
  FWD: "var(--amber)",
};

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

export function PitchLineup({
  team,
  players,
}: {
  team: TeamLite;
  players: PredictedLineupPlayer[];
}) {
  const [sel, setSel] = useState<number | null>(null);
  const { placed, formation } = placeLineup(players);
  const units = unitConfidence(players);
  const selected = players.find((p) => p.player_id === sel) ?? null;

  const W = 100;
  const H = 148;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="mono text-[0.65rem] text-muted">
          {team.short_name || team.name}
        </span>
        <span className="mono rounded bg-raised px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wider text-amber">
          {formation || "—"}
        </span>
      </div>

      <div className="relative overflow-hidden rounded-term border border-line" style={{ background: "linear-gradient(180deg, #0e141c, #0b1016)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`${team.name} projected shape`}>
          {/* pitch markings */}
          <g stroke="var(--line)" strokeWidth="0.4" fill="none" opacity="0.9">
            <rect x="4" y="4" width={W - 8} height={H - 8} rx="1.5" />
            <line x1="4" y1={H / 2} x2={W - 4} y2={H / 2} />
            <circle cx={W / 2} cy={H / 2} r="9" />
            <circle cx={W / 2} cy={H / 2} r="0.6" fill="var(--line)" />
            {/* penalty boxes */}
            <rect x={(W - 40) / 2} y="4" width="40" height="16" />
            <rect x={(W - 18) / 2} y="4" width="18" height="7" />
            <rect x={(W - 40) / 2} y={H - 20} width="40" height="16" />
            <rect x={(W - 18) / 2} y={H - 11} width="18" height="7" />
          </g>

          {/* players */}
          {placed.map(({ player, x, y, line }) => {
            const cx = x * W;
            const cy = y * H;
            const p = player.player;
            const injured = p?.current_injury || p?.injury_status === "DOUBTFUL";
            const color = LINE_COLOR[line];
            const on = sel === player.player_id;
            const badge = versatilityBadge(player);
            return (
              <g
                key={player.player_id}
                transform={`translate(${cx} ${cy})`}
                onClick={() => setSel(on ? null : player.player_id)}
                style={{ cursor: "pointer" }}
              >
                <circle r="4.6" fill="var(--ink)" stroke={color} strokeWidth={on ? "1.2" : "0.7"} />
                {injured && <circle r="6" fill="none" stroke="var(--risk)" strokeWidth="0.5" strokeDasharray="1.5 1" />}
                <text textAnchor="middle" y="1.4" fontSize="3.6" fontWeight="700" fill={color} className="mono">
                  {player.shirt_number ?? (p?.name ? p.name.charAt(0) : "?")}
                </text>
                <text textAnchor="middle" y="9.2" fontSize="3.2" fill="var(--text)" className="mono">
                  {p?.name ? lastName(p.name) : `#${player.player_id}`}
                </text>
                {badge && badge.includes("/") && (
                  <text textAnchor="middle" y="12.8" fontSize="2.5" fill="var(--muted)" className="mono">
                    {badge}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* unit confidence rail */}
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {[
          ["GK", units.goalkeeper],
          ["DEF", units.defence],
          ["MID", units.midfield],
          ["ATT", units.attack],
        ].map(([lbl, v]) => (
          <div key={lbl as string} className="rounded border border-line bg-raised/40 py-1 text-center">
            <div className="mono text-[0.5rem] tracking-widest text-faint">{lbl}</div>
            <div className="mono text-[0.75rem] font-bold tnum" style={{ color: (v as number) != null && (v as number) >= 80 ? "var(--edge)" : "var(--warn)" }}>
              {v != null ? `${v}%` : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* selected player detail */}
      {selected && (
        <div className="mt-2 rounded-term border border-line bg-raised p-3 animate-fade-up">
          <div className="flex items-center gap-2">
            <span className="mono grid h-6 w-6 place-items-center rounded bg-ink text-[0.65rem] font-bold text-amber">
              {selected.shirt_number ?? "•"}
            </span>
            <span className="text-sm font-semibold">{selected.player?.name}</span>
            <span className="mono ml-auto text-[0.65rem] text-muted">
              {selected.confidence != null
                ? `${Math.round(selected.confidence * (selected.confidence <= 1 ? 100 : 1))}% likely`
                : ""}
            </span>
          </div>
          <div className="mono mt-2 flex flex-wrap gap-1.5 text-[0.6rem]">
            {[selected.position_code, selected.secondary_position, selected.tertiary_position]
              .filter(Boolean)
              .map((c, idx) => (
                <span
                  key={idx}
                  className="rounded px-1.5 py-0.5"
                  style={{
                    color: idx === 0 ? "var(--amber)" : "var(--muted)",
                    background: idx === 0 ? "var(--amber-dim)" : "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {(c as string).toUpperCase()}
                  {idx === 0 ? " · primary" : idx === 1 ? " · secondary" : " · tertiary"}
                </span>
              ))}
          </div>
          {selected.player?.intelligence?.importance_score != null && (
            <div className="mono mt-2 flex gap-3 text-[0.6rem] text-muted">
              <span>Importance <span className="text-text">{Math.round(selected.player.intelligence.importance_score)}</span></span>
              {selected.player.intelligence.goal_share_pct != null && (
                <span>Goal share <span className="text-text">{Math.round(selected.player.intelligence.goal_share_pct)}%</span></span>
              )}
            </div>
          )}
          {(selected.player?.current_injury || selected.player?.injury_status === "DOUBTFUL") && (
            <p className="mono mt-2 text-[0.6rem] text-risk">
              {selected.player?.injury_status ?? "Fitness doubt"}
              {selected.player?.injury_reason ? ` · ${selected.player.injury_reason}` : ""}
            </p>
          )}
        </div>
      )}
      <p className="mono mt-2 text-[0.55rem] text-faint">Tap a player for versatility & role detail.</p>
    </div>
  );
}
