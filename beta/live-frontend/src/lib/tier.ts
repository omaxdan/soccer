import type { ModuleDef, Tier } from "./modules";

export type { Tier };

export const TIER_RANK: Record<Tier, number> = {
  starter: 0,
  pro: 1,
  proplus: 2,
};

export interface TierPlan {
  id: Tier;
  name: string;
  priceMonthly: number;
  blurb: string;
  moduleCount: number | "all";
  picksPerDay: number;
  features: string[];
}

export const PLANS: TierPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthly: 0,
    blurb: "The five modules that need no explanation.",
    moduleCount: 5,
    picksPerDay: 3,
    features: [
      "Modules 1, 5, 7, 8 and 10",
      "3 picks per day",
      "Sample sizes and intervals on every rate",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 19,
    blurb: "Every active module, every fixture in the window.",
    moduleCount: "all",
    picksPerDay: 12,
    features: [
      "All 12 active modules",
      "12 picks per day",
      "Accumulator builder",
      "Full module report on every fixture",
    ],
  },
  {
    id: "proplus",
    name: "Pro+",
    priceMonthly: 29,
    blurb: "Pro, plus the raw material to check our work.",
    moduleCount: "all",
    picksPerDay: 12,
    features: [
      "Everything in Pro",
      "Historical data export (CSV)",
      "Module comparison tool",
      "Per-module backtest ledger with sample gates",
    ],
  },
];

export function canSee(def: ModuleDef, viewer: Tier): boolean {
  return TIER_RANK[viewer] >= TIER_RANK[def.tier];
}

export function upgradeTarget(def: ModuleDef): TierPlan {
  return PLANS.find((p) => p.id === def.tier) ?? PLANS[1];
}

/**
 * Placeholder resolver. Swap for the real entitlement lookup when billing
 * lands — every call site already reads through this one function.
 */
export function currentTier(): Tier {
  const raw = process.env.NEXT_PUBLIC_DEFAULT_TIER as Tier | undefined;
  if (raw && raw in TIER_RANK) return raw;
  return "pro";
}
