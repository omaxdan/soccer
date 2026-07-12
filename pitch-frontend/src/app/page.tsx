import { getBoard } from "@/lib/queries";
import { BoardClient } from "@/components/BoardClient";
import { opportunityColor } from "@/lib/intel";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const matches = await getBoard(24);

  const scored = matches.filter((m) => m.opportunity);
  const top = scored[0];
  const avgOpp = scored.length
    ? Math.round(
        scored.reduce((s, m) => s + (m.opportunity?.opportunity_score ?? 0), 0) /
          scored.length
      )
    : 0;
  const lowRisk = matches.filter((m) => m.risk?.risk_band === "LOW").length;
  const strongEdges = matches.filter(
    (m) => (m.opportunity?.opportunity_score ?? 0) >= 60
  ).length;

  return (
    <div className="space-y-4">
      {/* Hero — the daily intelligence read */}
      <section className="scanlines panel overflow-hidden p-5">
        <p className="eyebrow">Today&rsquo;s board</p>
        <h1 className="mt-1 max-w-xl text-[1.35rem] font-semibold leading-tight tracking-tight sm:text-2xl">
          What the market may be missing, ranked by edge.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          Every fixture is scored on where the opportunity is and where the risk
          hides. Read the top card, then dig into the evidence.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <HeroStat
            label="Board avg edge"
            value={avgOpp}
            color={opportunityColor(avgOpp)}
          />
          <HeroStat label="Strong edges" value={strongEdges} color="var(--amber)" />
          <HeroStat label="Low-risk ties" value={lowRisk} color="var(--edge)" />
        </div>

        {top && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="label-cap">Lead read</p>
            <p className="mt-1 text-[0.85rem] leading-snug text-text">
              <span
                className="mono font-bold"
                style={{ color: opportunityColor(top.opportunity?.opportunity_score) }}
              >
                {top.home.short_name || top.home.name} v{" "}
                {top.away.short_name || top.away.name}
              </span>{" "}
              — {top.opportunity?.signals?.[0]?.text ?? top.opportunity?.executive_brief}
            </p>
          </div>
        )}
      </section>

      <BoardClient matches={matches} />
    </div>
  );
}

function HeroStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="panel-raised p-3">
      <div className="label-cap">{label}</div>
      <div
        className="mono mt-1 text-2xl font-bold leading-none tnum"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
