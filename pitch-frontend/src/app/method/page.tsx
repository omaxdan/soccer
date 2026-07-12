import { Section } from "@/components/Primitives";
import { OpportunityRiskMeter } from "@/components/Meters";

export const metadata = { title: "Method" };

const PILLARS = [
  {
    k: "01",
    title: "Readiness over raw form",
    body: "A win means less if it came against a depleted side after a week's rest. The engine weighs squad availability, rest days, travel load and rotation pressure to judge how prepared each side actually is — not just what the table says.",
  },
  {
    k: "02",
    title: "Contrast is the edge",
    body: "Opportunity comes from mismatch: a readiness gap, an injury asymmetry, a goal-friendly environment, an over-performing favourite due to regress. The opportunity score composites those contrasts into one number you can rank on.",
  },
  {
    k: "03",
    title: "Risk is separate from opportunity",
    body: "A high-edge fixture can still be a trap. Weakened elevens, tight probabilities, small samples and low model confidence each add risk points. Predictability is simply the inverse — how much the read can be trusted.",
  },
  {
    k: "04",
    title: "Every stat becomes a sentence",
    body: "A 42% top-scorer share is not a number to admire — it is a dependency to exploit if that striker is doubtful. The terminal translates each figure into the decision it implies.",
  },
];

export default function MethodPage() {
  return (
    <div className="space-y-4">
      <header className="scanlines panel overflow-hidden p-5">
        <p className="eyebrow">Method</p>
        <h1 className="mt-1 max-w-xl text-xl font-semibold leading-tight tracking-tight sm:text-2xl">
          Data is the engine. The explanation is the product.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          PitchTerminal never dumps raw stats. It reads a precomputed
          intelligence warehouse and answers three questions for every match:
          where is the edge, where is the mispricing, and where is the risk.
        </p>
      </header>

      <Section index="00" title="The core meter">
        <p className="mb-3 text-[0.8rem] leading-relaxed text-muted">
          Everything reduces to this: opportunity fills from the left, risk
          hatches in from the right. A wide amber band with little coral is a
          clean read. A narrow gap means proceed with care.
        </p>
        <div className="space-y-4">
          <div>
            <p className="label-cap mb-1.5">Clean edge — Novorizontino v Sport</p>
            <OpportunityRiskMeter opportunity={86} risk={18} />
          </div>
          <div>
            <p className="label-cap mb-1.5">Coin-flip — level fixture</p>
            <OpportunityRiskMeter opportunity={34} risk={57} />
          </div>
        </div>
      </Section>

      {PILLARS.map((p) => (
        <Section key={p.k} index={p.k} title={p.title}>
          <p className="text-[0.85rem] leading-relaxed text-muted">{p.body}</p>
        </Section>
      ))}

      <section className="panel border-l-2 border-l-amber p-5">
        <p className="eyebrow mb-1">On responsibility</p>
        <p className="text-[0.85rem] leading-relaxed text-text">
          PitchTerminal is an intelligence tool, not a tipping service. It
          surfaces where the data disagrees with the obvious read. Every number
          is precomputed and read-only — no live odds, no guarantees, and
          nothing here is betting advice.
        </p>
      </section>
    </div>
  );
}
