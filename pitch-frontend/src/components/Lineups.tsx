import { Crest } from "./Crest";
import { positionLabel, money } from "@/lib/intel";
import type { PredictedLineupPlayer, TeamLite } from "@/lib/types";

const ORDER = ["G", "D", "M", "F", "A"];
function posRank(code: string | null) {
  const c = (code ?? "").charAt(0).toUpperCase();
  const i = ORDER.indexOf(c);
  return i === -1 ? 99 : i;
}

export function TeamLineup({
  team,
  players,
}: {
  team: TeamLite;
  players: PredictedLineupPlayer[];
}) {
  const starters = [...players].sort(
    (a, b) => posRank(a.position_code) - posRank(b.position_code) || (a.rank_in_position ?? 0) - (b.rank_in_position ?? 0)
  );
  const doubtful = players.filter(
    (p) => p.player?.injury_status === "DOUBTFUL"
  );

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Crest team={team} size={22} />
        <span className="text-sm font-medium tracking-tight">{team.name}</span>
        <span className="mono ml-auto text-[0.6rem] text-faint">Projected XI</span>
      </div>
      <ul className="space-y-0.5">
        {starters.map((p) => {
          const inj = p.player?.current_injury;
          const imp = p.player?.intelligence?.importance_score ?? null;
          return (
            <li
              key={p.player_id}
              className="flex items-center gap-2 rounded px-2 py-1.5 odd:bg-raised/40"
            >
              <span className="mono w-6 shrink-0 text-[0.6rem] text-faint">
                {(p.position_code ?? "").charAt(0)}
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
