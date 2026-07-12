import Link from "next/link";
import { Crest } from "./Crest";
import { OpportunityRiskMeter, RiskBadge } from "./Meters";
import { kickoff, opportunityColor, bestLean, normProb } from "@/lib/intel";
import type { MatchRow } from "@/lib/types";

export function MatchCard({ m, rank }: { m: MatchRow; rank?: number }) {
  const k = kickoff(m.date);
  const opp = m.opportunity?.opportunity_score ?? null;
  const lean = bestLean(m);
  const topSignal = m.opportunity?.signals?.[0]?.text;
  const topWarning = m.opportunity?.warnings?.[0]?.text;
  const wp = m.intel
    ? [
        normProb(m.intel.win_probability_home),
        normProb(m.intel.win_probability_draw),
        normProb(m.intel.win_probability_away),
      ]
    : null;

  return (
    <Link
      href={`/matches/${m.id}`}
      className="panel block p-4 transition-colors hover:border-faint animate-fade-up"
    >
      <div className="mb-3 flex items-center gap-2">
        {rank != null && (
          <span
            className="mono grid h-5 w-5 place-items-center rounded text-[0.65rem] font-bold"
            style={{
              color: opportunityColor(opp),
              background: `color-mix(in srgb, ${opportunityColor(opp)} 14%, transparent)`,
            }}
          >
            {rank}
          </span>
        )}
        <span className="mono truncate text-[0.6rem] uppercase tracking-widest text-muted">
          {m.tournament?.name ?? m.competition}
        </span>
        <span className="mono ml-auto shrink-0 text-[0.6rem] text-faint">
          {k.day} · {k.time}
        </span>
        <span
          className="mono shrink-0 rounded px-1 text-[0.55rem] font-semibold tracking-wider"
          style={{
            color: k.rel === "LIVE" ? "var(--risk)" : "var(--amber)",
            background:
              k.rel === "LIVE"
                ? "color-mix(in srgb, var(--risk) 16%, transparent)"
                : "var(--amber-dim)",
          }}
        >
          {k.rel}
        </span>
      </div>

      {/* Teams */}
      <div className="space-y-2">
        <TeamLine team={m.home} score={m.home_score} />
        <TeamLine team={m.away} score={m.away_score} />
      </div>

      {/* Opportunity / Risk */}
      <div className="mt-3.5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="flex items-baseline gap-1.5">
            <span className="label-cap">O-Score</span>
            <span
              className="mono text-xl font-bold leading-none tnum"
              style={{ color: opportunityColor(opp) }}
            >
              {opp ?? "—"}
            </span>
          </span>
          {m.risk && <RiskBadge band={m.risk.risk_band} />}
        </div>
        <OpportunityRiskMeter opportunity={opp} risk={m.risk?.risk_score} compact />
      </div>

      {/* Win prob strip */}
      {wp && (
        <div className="mono mt-2.5 flex items-center gap-2 text-[0.65rem] text-muted">
          <span>
            <span className="text-edge">{Math.round(wp[0])}</span> H
          </span>
          <span>
            <span className="text-warn">{Math.round(wp[1])}</span> D
          </span>
          <span>
            <span className="text-cool">{Math.round(wp[2])}</span> A
          </span>
          {lean && lean.pick !== "No clear market edge" && (
            <span className="ml-auto truncate text-amber">➜ {lean.pick}</span>
          )}
        </div>
      )}

      {/* Lead signal / warning */}
      {(topSignal || topWarning) && (
        <p className="mt-2.5 line-clamp-2 text-[0.75rem] leading-snug text-muted">
          {topSignal ? (
            <span>
              <span className="text-edge">+ </span>
              {topSignal}
            </span>
          ) : (
            <span>
              <span className="text-risk">! </span>
              {topWarning}
            </span>
          )}
        </p>
      )}
    </Link>
  );
}

function TeamLine({
  team,
  score,
}: {
  team: MatchRow["home"];
  score?: number | null;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Crest team={team} size={26} />
      <span className="truncate text-sm font-medium tracking-tight">{team.name}</span>
      {score != null && (
        <span className="mono ml-auto text-sm font-bold tnum">{score}</span>
      )}
    </div>
  );
}
