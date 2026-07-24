import { getBoard, getBettingCard } from "@/lib/queries";
import { ModuleFeed } from "@/components/ModuleFeed";
import { MODULES } from "@/lib/modules";
import { currentTier } from "@/lib/tier";
import { IconConfidence, IconModules, IconGate } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [matches, bettingCard] = await Promise.all([getBoard(24), getBettingCard()]);
  const viewer = currentTier();

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const bankers = bettingCard.singles.filter((s) => s.confidence === "BANKER");
  const strong = bettingCard.singles.filter((s) => s.confidence === "STRONG");
  const covered = new Set(bettingCard.singles.map((s) => s.match_id)).size;

  return (
    <div className="space-y-4">
      {/* ── Hero: intelligence briefing ───────────────────── */}
      <section className="panel scanlines p-5">
        <div className="flex items-center gap-2">
          <span className="text-amber">
            <IconModules size={16} />
          </span>
          <h1 className="mono text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-text">
            Intelligence briefing
          </h1>
        </div>
        <p className="mono mt-1 text-[0.68rem] text-muted">{today}</p>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="label-cap">Modules active</div>
            <div className="mono tnum text-xl font-semibold text-text">
              {MODULES.length}
            </div>
          </div>
          <div>
            <div className="label-cap">Fixtures covered</div>
            <div className="mono tnum text-xl font-semibold text-text">{covered}</div>
          </div>
          <div>
            <div className="label-cap">Window</div>
            <div className="mono text-xl font-semibold text-text">3 days</div>
          </div>
          <div>
            <div className="label-cap">Banker picks</div>
            <div className="mono tnum text-xl font-semibold" style={{ color: "var(--edge)" }}>
              {bankers.length}
            </div>
          </div>
          <div>
            <div className="label-cap">Strong picks</div>
            <div className="mono tnum text-xl font-semibold" style={{ color: "var(--amber)" }}>
              {strong.length}
            </div>
          </div>
        </div>

        {/* Calibration status — deliberately on the hero, not buried */}
        <div className="mt-4 flex items-start gap-2.5 border-t border-line pt-3">
          <span className="mt-0.5 text-warn">
            <IconGate size={14} />
          </span>
          <p className="text-[0.68rem] leading-relaxed text-muted">
            Confidence-band accuracy is currently derived from present-day team form applied
            to historical fixtures. Until the point-in-time replay lands, band rates are shown
            with their intervals and marked accordingly — see{" "}
            <a href="/method" className="text-amber underline underline-offset-2">
              Method
            </a>
            .
          </p>
        </div>
      </section>

      {/* ── Module activation feed ────────────────────────── */}
      <section>
        <header className="mb-3 flex items-center gap-2">
          <span className="text-amber">
            <IconConfidence size={14} />
          </span>
          <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
            Module activations
          </h2>
          <span className="mono ml-auto text-[0.6rem] tracking-widest text-faint">
            SORTED BY CONSENSUS
          </span>
        </header>
        <ModuleFeed matches={matches} singles={bettingCard.singles} viewer={viewer} />
      </section>
    </div>
  );
}
