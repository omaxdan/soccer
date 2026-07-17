import { getBoard, getBettingCard } from "@/lib/queries";
import { BoardClient } from "@/components/BoardClient";
import { BettingCard } from "@/components/BettingCard";
import { opportunityColor } from "@/lib/intel";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // ✅ Destructure the array from Promise.all
  const [matches, bettingCard] = await Promise.all([
    getBoard(24),
    getBettingCard(),
  ]);

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
      <BettingCard card={bettingCard} /> 
    </div>
  );
}
 
