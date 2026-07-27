import { db } from "./supabase";
import type { ModuleDef } from "./modules";

// ─────────────────────────────────────────────────────────────────────────────
// Access service — one place that answers "can this viewer see this feature".
//
// Nothing else in the app should reason about subscriptions. canSee() in
// tier.ts remains the pure comparison; this wraps it with the flag, the
// database permission map and the admin override.
//
// THE FLAG IS THE WHOLE DESIGN. While subscriptions_enabled is false this
// returns true for everything and never asks who the viewer is, which is what
// lets the platform run in beta with no auth at all.
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureKey =
  | "HOME_AWAY_SPLIT" | "TRAVEL_IMPACT" | "LEAGUE_GOAL_PROFILE"
  | "FORM_GAP_ACCURACY" | "CONFIDENCE_CALIBRATION" | "READINESS_TRACKER"
  | "CONSISTENCY_INDEX" | "GIANT_KILLER_INDEX" | "REST_ADVANTAGE"
  | "BTTS_BY_FATIGUE" | "HALF_TIME_TRENDS" | "CLEAN_SHEET_PROBABILITY"
  | "WEATHER_IMPACT";

/** Module key -> feature key. The registry stays free of billing concerns. */
export const FEATURE_BY_MODULE: Record<string, FeatureKey> = {
  home_away: "HOME_AWAY_SPLIT",
  readiness: "READINESS_TRACKER",
  consistency: "CONSISTENCY_INDEX",
  giant_killer: "GIANT_KILLER_INDEX",
  travel: "TRAVEL_IMPACT",
  rest: "REST_ADVANTAGE",
  league_goals: "LEAGUE_GOAL_PROFILE",
  form_gap: "FORM_GAP_ACCURACY",
  btts_fatigue: "BTTS_BY_FATIGUE",
  confidence: "CONFIDENCE_CALIBRATION",
  halftime: "HALF_TIME_TRENDS",
  clean_sheet: "CLEAN_SHEET_PROBABILITY",
  weather: "WEATHER_IMPACT",
};

export interface AccessContext {
  /** False = beta mode: everything is open and no viewer is consulted. */
  subscriptionsEnabled: boolean;
  /** Plan slug of the current viewer, or null when nobody is signed in. */
  plan: string | null;
  isAdmin: boolean;
  /** feature_key -> required plan slug, straight from the database. */
  required: Record<string, string>;
  /** Plan slug -> rank, so a new tier needs no code change. */
  rank: Record<string, number>;
  /**
   * True when the flag is on but the app cannot identify anyone — the
   * misconfiguration described in migration 033. Surfaced rather than silently
   * treated as "everyone is Free".
   */
  enabledWithoutAuth: boolean;
}

export const BETA_ACCESS: AccessContext = {
  subscriptionsEnabled: false,
  plan: null,
  isAdmin: false,
  required: {},
  rank: {},
  enabledWithoutAuth: false,
};

/**
 * Resolved once per request and passed down. There is no session in the app
 * yet, so `plan` is always null and `isAdmin` always false; both are read from
 * the context the moment auth is wired, with no call site changing.
 */
export async function getAccessContext(): Promise<AccessContext> {
  const client = db();
  if (!client) return BETA_ACCESS;
  try {
    const [flag, perms, plans] = await Promise.all([
      client.from("platform_settings").select("value").eq("key", "subscriptions_enabled").maybeSingle(),
      client.from("feature_permissions").select("feature_key, required_plan"),
      client.from("subscription_plans").select("slug, rank"),
    ]);

    const enabled = (flag.data as any)?.value === "true";
    if (!enabled) return BETA_ACCESS;

    const required: Record<string, string> = {};
    for (const r of ((perms.data as any[]) ?? [])) required[r.feature_key] = r.required_plan;
    const rank: Record<string, number> = {};
    for (const p of ((plans.data as any[]) ?? [])) rank[p.slug] = p.rank ?? 0;

    return {
      subscriptionsEnabled: true,
      plan: null,
      isAdmin: false,
      required,
      rank,
      enabledWithoutAuth: true,
    };
  } catch {
    // A failed read must not lock the platform. Beta mode is the safe default.
    return BETA_ACCESS;
  }
}

export function canAccessFeature(ctx: AccessContext, feature: FeatureKey | string): boolean {
  if (!ctx.subscriptionsEnabled) return true;
  if (ctx.isAdmin) return true;
  const required = ctx.required[feature];
  // Unregistered feature stays open — otherwise every new module ships
  // invisible until someone remembers to seed a row for it.
  if (!required) return true;
  const need = ctx.rank[required] ?? 0;
  const have = ctx.plan ? ctx.rank[ctx.plan] ?? 0 : 0;
  return have >= need;
}

export function canAccessModule(ctx: AccessContext, def: ModuleDef): boolean {
  const key = FEATURE_BY_MODULE[def.key];
  return key ? canAccessFeature(ctx, key) : true;
}
