import { Crest } from "./Crest";
import { positionLabel, money } from "@/lib/intel";
import { placeLineup, lineOfPlayer } from "@/lib/formation";
import type { PredictedLineupPlayer, TeamLite } from "@/lib/types";

const LINE_LABEL: Record<"GK" | "DEF" | "MID" | "FWD", string> = {
  GK: "Goalkeeper", DEF: "Defence", MID: "Midfield", FWD: "Attack",
};
const LINE_ORDER = ["GK", "DEF", "MID", "FWD"] as const;

export function TeamLineup({
  team,
  players,
}: {
  team: TeamLite;
  players: PredictedLineupPlayer[];
}) {
  // Reuses the same zone classification the pitch view is built from, so
  // the list groups (and the formation label) always agree with the shape
  // drawn on the pitch.
  const { placed, formation } = placeLineup(players);
  const byLine: Record<"GK" | "DEF" | "MID" | "FWD", PredictedLineupPlayer[]> = {
    GK: [], DEF: [], MID: [], FWD: [],
  };
  for (const { player, line } of placed) byLine[line].push(player);

  const doubtful = players.filter(
    (p) => p.player?.injury_status === "DOUBTFUL"
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Crest team={team} size={22} />
        <span className="text-sm font-medium tracking-tight">{team.name}</span>
        <span className="mono ml-auto flex items-center gap-2 text-[0.6rem] text-faint">
          <span className="rounded bg-raised px-1.5 py-0.5 font-semibold tracking-wider text-amber">
            {formation || "—"}
          </span>
          Projected XI
        </span>
      </div>
      {LINE_ORDER.filter((ln) => byLine[ln].length > 0).map((ln) => (
        <div key={ln} className="mt-3 first:mt-0">
          <div className="mb-1 flex items-center gap-2 px-2">
            <span className="mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-faint">
              {LINE_LABEL[ln]}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="space-y-0.5">
            {byLine[ln].map((p) => {
              const inj = p.player?.current_injury;
              const imp = p.player?.intelligence?.importance_score ?? null;
              return (
                <li
                  key={p.player_id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 odd:bg-raised/40"
                >
                  {/* Zone letter, resolved through the shared classifier —
                      the old first-character read broke on tactical slot
                      codes ('RCB' rendered as 'R', 'DM' as 'D'). */}
                  <span className="mono w-6 shrink-0 text-[0.6rem] text-faint">
                    {lineOfPlayer(p).charAt(0)}
                  </span>
                  <span className="truncate text-[0.8rem]">
                    {p.player?.name ?? `#${p.player_id}`}
                  </span>
                  {inj && (
                    <span className="mono shrink-0 rounded bg-risk/15 px-1 text-[0.5rem] font-bold tracking-wide text-risk">
                      DOUBT
                    </span>
                  )}
                  {imp != null && (
                    <span
                      className="mono ml-auto shrink-0 text-[0.6rem]"
                      style={{ color: imp >= 85 ? "var(--amber)" : "var(--faint)" }}
                    >
                      IMP {Math.round(imp)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {doubtful.length > 0 && (
        <p className="mono mt-2 text-[0.6rem] text-warn">
          {doubtful.length} fitness doubt{doubtful.length > 1 ? "s" : ""} in the XI
        </p>
      )}
    </div>
  );
}

export function AvailabilityList({
  players,
}: {
  players: PredictedLineupPlayer[];
}) {
  const out = players.filter(
    (p) => p.player?.current_injury || p.player?.injury_status === "OUT" || p.player?.injury_status === "DOUBTFUL"
  );
  if (out.length === 0) {
    return (
      <p className="mono text-[0.7rem] text-edge">
        No fitness concerns flagged across projected elevens.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {out.map((p) => {
        const pl = p.player!;
        const isOut = pl.injury_status === "OUT";
        return (
          <li
            key={p.player_id}
            className="flex items-start gap-2.5 rounded-term border border-line p-2.5"
          >
            <span
              className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[0.55rem] font-bold tracking-wider"
              style={{
                color: isOut ? "var(--risk)" : "var(--warn)",
                background: isOut
                  ? "color-mix(in srgb, var(--risk) 15%, transparent)"
                  : "color-mix(in srgb, var(--warn) 15%, transparent)",
              }}
            >
              {isOut ? "OUT" : "DOUBT"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[0.8rem] font-medium">{pl.name}</span>
                {pl.market_value ? (
                  <span className="mono ml-auto shrink-0 text-[0.6rem] text-faint">
                    {money(pl.market_value)}
                  </span>
                ) : null}
              </div>
              <p className="mono mt-0.5 text-[0.65rem] text-muted">
                {positionLabel(pl.position ?? "")}
                {pl.injury_reason ? ` · ${pl.injury_reason}` : ""}
                {pl.injury_return_days != null
                  ? ` · ~${pl.injury_return_days}d return`
                  : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
