import { db } from "./supabase";
import { supabaseServer, getSessionUser } from "./supabase/server";
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
  userId: string | null;
  authenticated: boolean;
  email: string | null;
  role: "user" | "admin" | null;
  isAdmin: boolean;
  /** Plan slug of the current viewer, or null when nobody is signed in. */
  plan: string | null;
  planRank: number;
  subscriptionActive: boolean;
  /** False = beta mode: everything is open and no viewer is consulted. */
  subscriptionsEnabled: boolean;
  /** feature_key -> required plan slug, straight from the database. */
  required: Record<string, string>;
  /** Plan slug -> rank, so a new tier needs no code change. */
  rank: Record<string, number>;
  /** Resolved access per feature, so callers need no second round trip. */
  features: Record<string, boolean>;
}

const EMPTY: AccessContext = {
  userId: null,
  authenticated: false,
  email: null,
  role: null,
  isAdmin: false,
  plan: null,
  planRank: 0,
  subscriptionActive: false,
  subscriptionsEnabled: false,
  required: {},
  rank: {},
  features: {},
};

export const BETA_ACCESS: AccessContext = EMPTY;

/**
 * Resolved once per request and passed down. There is no session in the app
 * yet, so `plan` is always null and `isAdmin` always false; both are read from
 * the context the moment auth is wired, with no call site changing.
 */
/**
 * Resolved once per request and passed down.
 *
 * The identity lookup runs whether or not subscriptions are enabled, because
 * /settings and /subscription need to know who is signed in even in beta. Only
 * the ACCESS DECISION is short-circuited by the flag.
 */
export async function getAccessContext(): Promise<AccessContext> {
  const client = db();
  if (!client) return EMPTY;

  const user = await getSessionUser();
  let role: "user" | "admin" | null = null;
  let plan: string | null = null;
  let subscriptionActive = false;

  if (user) {
    const authed = await supabaseServer();
    if (authed) {
      try {
        const [profile, sub] = await Promise.all([
          authed.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle(),
          authed
            .from("user_subscriptions")
            .select("status, expires_at, plan:subscription_plans(slug)")
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle(),
        ]);
        role = ((profile.data as any)?.role as "user" | "admin") ?? "user";
        const row = sub.data as any;
        if (row) {
          const live = !row.expires_at || new Date(row.expires_at) > new Date();
          if (live) {
            subscriptionActive = true;
            plan = row.plan?.slug ?? null;
          }
        }
        // A signed-in user with no subscription row is on Free, not on nothing.
        if (!plan) plan = "free";
      } catch {
        role = "user";
        plan = "free";
      }
    }
  }

  let subscriptionsEnabled = false;
  const required: Record<string, string> = {};
  const rank: Record<string, number> = {};
  try {
    const [flag, perms, plans] = await Promise.all([
      client.from("platform_settings").select("value").eq("key", "subscriptions_enabled").maybeSingle(),
      client.from("feature_permissions").select("feature_key, required_plan"),
      client.from("subscription_plans").select("slug, rank"),
    ]);
    subscriptionsEnabled = (flag.data as any)?.value === "true";
    for (const r of ((perms.data as any[]) ?? [])) required[r.feature_key] = r.required_plan;
    for (const p of ((plans.data as any[]) ?? [])) rank[p.slug] = p.rank ?? 0;
  } catch {
    // A failed settings read must not lock the platform. Beta is the safe
    // default, and it is what the app already does today.
    subscriptionsEnabled = false;
  }

  const isAdmin = role === "admin";
  const ctx: AccessContext = {
    userId: user?.id ?? null,
    authenticated: Boolean(user),
    email: user?.email ?? null,
    role,
    isAdmin,
    plan,
    planRank: plan ? rank[plan] ?? 0 : 0,
    subscriptionActive,
    subscriptionsEnabled,
    required,
    rank,
    features: {},
  };

  // Precompute every feature so call sites never round-trip again.
  for (const key of Object.keys(required)) ctx.features[key] = canAccessFeature(ctx, key);
  return ctx;
}

export function canAccessFeature(ctx: AccessContext, feature: FeatureKey | string): boolean {
  if (!ctx.subscriptionsEnabled) return true;
  if (ctx.isAdmin) return true;
  const required = ctx.required[feature];
  // Unregistered feature stays open — otherwise every new module ships
  // invisible until someone remembers to seed a row for it.
  if (!required) return true;
  return ctx.planRank >= (ctx.rank[required] ?? 0);
}

export function canAccessModule(ctx: AccessContext, def: ModuleDef): boolean {
  const key = FEATURE_BY_MODULE[def.key];
  return key ? canAccessFeature(ctx, key) : true;
}


// ─────────────────────────────────────────────────────────────────────────────
// Enforcement
//
// Hiding a card in the UI is not enforcement: the reading is still in the HTML
// payload the server sent. redactReadings() strips the content BEFORE it
// leaves the server, so a locked module ships its name and status and nothing
// else — no numbers, no baseline, no verdict.
//
// The consensus is deliberately computed from the FULL set upstream of this.
// A Free viewer gets the same verdict a Pro viewer does; the tier decides how
// much working is shown, not whether the conclusion is right.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModuleReading } from "./modules";

export function redactReadings(
  readings: ModuleReading[],
  ctx: AccessContext
): ModuleReading[] {
  if (!ctx.subscriptionsEnabled || ctx.isAdmin) return readings;
  return readings.map((r) =>
    canAccessModule(ctx, r.def)
      ? r
      : {
          ...r,
          headline: "Available on Pro",
          rows: [],
          baseline: null,
          verdict:
            `${r.def.name} is part of the Pro intelligence set. Its reading is counted in ` +
            `the consensus above; the detail is not shown on this tier.`,
          code: undefined,
        }
  );
}


/**
 * Just enough to render the shell: is anyone signed in, and are they an admin.
 *
 * Deliberately NOT getAccessContext(). The layout wraps every route, and the
 * full context costs five reads (flag, permissions, plans, profile,
 * subscription) to answer a question the nav asks with two. Pages that need
 * the whole thing still call getAccessContext() themselves.
 */
export interface ViewerIdentity {
  authenticated: boolean;
  email: string | null;
  isAdmin: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  /** Plan slug for the tier badge. "free" when signed in with no subscription. */
  plan: string | null;
}

export const ANON_IDENTITY: ViewerIdentity = {
  authenticated: false,
  email: null,
  isAdmin: false,
  displayName: null,
  avatarUrl: null,
  plan: null,
};

export async function getViewerIdentity(): Promise<ViewerIdentity> {
  const user = await getSessionUser();
  if (!user) return ANON_IDENTITY;
  try {
    const client = await supabaseServer();
    if (!client)
      return { ...ANON_IDENTITY, authenticated: true, email: user.email, plan: "free" };

    const [profile, sub] = await Promise.all([
      client
        .from("user_profiles")
        .select("role, display_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle(),
      client
        .from("user_subscriptions")
        .select("status, expires_at, plan:subscription_plans(slug)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const p = profile.data as any;
    const row = sub.data as any;
    const live = row && (!row.expires_at || new Date(row.expires_at) > new Date());

    return {
      authenticated: true,
      email: user.email,
      isAdmin: p?.role === "admin",
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      plan: (live && row.plan?.slug) || "free",
    };
  } catch {
    // Signed in but the profile read failed — treat as a normal user rather
    // than hiding the session entirely.
    return { ...ANON_IDENTITY, authenticated: true, email: user.email, plan: "free" };
  }
}
