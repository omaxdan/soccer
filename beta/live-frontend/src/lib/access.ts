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
  /** Descriptive only — never used to authorise. */
  provider: string | null;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
}

export const ANON_IDENTITY: ViewerIdentity = {
  authenticated: false,
  email: null,
  isAdmin: false,
  displayName: null,
  avatarUrl: null,
  plan: null,
  provider: null,
  subscriptionStatus: null,
  subscriptionExpiresAt: null,
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
        .select("role, display_name, avatar_url, provider")
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
      provider: p?.provider ?? null,
      subscriptionStatus: live ? row.status : null,
      subscriptionExpiresAt: live ? row.expires_at ?? null : null,
    };
  } catch {
    // Signed in but the profile read failed — treat as a normal user rather
    // than hiding the session entirely.
    return { ...ANON_IDENTITY, authenticated: true, email: user.email, plan: "free" };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Admin statistics
//
// Read through the SESSION client, so RLS decides what comes back. A non-admin
// calling this gets their own rows and nothing else — the numbers are protected
// by the policies from migration 033, not by the page choosing not to render.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformStats {
  users: number;
  admins: number;
  freeUsers: number;
  proUsers: number;
  activeSubscriptions: number;
  plans: { slug: string; name: string; price: number; active: boolean }[];
}

export async function getPlatformStats(): Promise<PlatformStats | null> {
  const client = await supabaseServer();
  if (!client) return null;
  try {
    const [profiles, subs, plans] = await Promise.all([
      client.from("user_profiles").select("user_id, role"),
      client
        .from("user_subscriptions")
        .select("user_id, status, expires_at, plan:subscription_plans(slug)")
        .eq("status", "active"),
      client.from("subscription_plans").select("slug, name, price, active").order("rank"),
    ]);

    const rows = (profiles.data as any[]) ?? [];
    const now = Date.now();
    const live = ((subs.data as any[]) ?? []).filter(
      (s) => !s.expires_at || new Date(s.expires_at).getTime() > now
    );
    const proIds = new Set(live.filter((s) => s.plan?.slug === "pro").map((s) => s.user_id));

    return {
      users: rows.length,
      admins: rows.filter((r) => r.role === "admin").length,
      proUsers: proIds.size,
      // Everyone without a live Pro subscription is on Free — there is no
      // third state, so this is a subtraction rather than another query.
      freeUsers: Math.max(0, rows.length - proIds.size),
      activeSubscriptions: live.length,
      plans: ((plans.data as any[]) ?? []).map((p) => ({
        slug: p.slug,
        name: p.name,
        price: Number(p.price ?? 0),
        active: p.active !== false,
      })),
    };
  } catch {
    return null;
  }
}

export interface AdminUserRow {
  userId: string;
  displayName: string | null;
  role: string;
  provider: string | null;
  plan: string;
  status: string | null;
  expiresAt: string | null;
  lastLoginAt: string | null;
}

export async function getAdminUsers(limit = 200): Promise<AdminUserRow[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const [profiles, subs] = await Promise.all([
      client
        .from("user_profiles")
        .select("user_id, display_name, role, provider, last_login_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      client
        .from("user_subscriptions")
        .select("user_id, status, expires_at, plan:subscription_plans(slug)")
        .eq("status", "active"),
    ]);

    const byUser = new Map(((subs.data as any[]) ?? []).map((s) => [s.user_id, s]));
    return ((profiles.data as any[]) ?? []).map((p) => {
      const s = byUser.get(p.user_id);
      const live = s && (!s.expires_at || new Date(s.expires_at) > new Date());
      return {
        userId: p.user_id,
        displayName: p.display_name ?? null,
        role: p.role ?? "user",
        provider: p.provider ?? null,
        plan: (live && s.plan?.slug) || "free",
        status: live ? s.status : null,
        expiresAt: live ? s.expires_at ?? null : null,
        lastLoginAt: p.last_login_at ?? null,
      };
    });
  } catch {
    return [];
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Team brief redaction
//
// The brief derives its summary, insights, pillars and danger zone FROM the
// metric tables. Redacting the finished output would mean the premium numbers
// had already been read and interpolated into sentences; nulling the INPUT
// means they are never available to the derivation at all, so no wording can
// leak one by accident.
//
// Module ownership:
//   venue         Home/Away Split          FREE
//   formQuality   Consistency, Giant Killer PRO
//   momentum      Readiness Tracker         PRO
//   intel         team identity and form    open — basic football information,
//                 which the product deliberately does not gate
// ─────────────────────────────────────────────────────────────────────────────

export interface TeamBriefRedaction<T> {
  input: T;
  /** Names of the streams withheld, for an honest upgrade prompt. */
  withheld: string[];
}

export function redactTeamInputs<
  T extends { formQuality: unknown; momentum: unknown; betting: unknown }
>(input: T, ctx: AccessContext): TeamBriefRedaction<T> {
  if (!ctx.subscriptionsEnabled || ctx.isAdmin) return { input, withheld: [] };

  const withheld: string[] = [];
  const out = { ...input };

  if (!canAccessFeature(ctx, "CONSISTENCY_INDEX") || !canAccessFeature(ctx, "GIANT_KILLER_INDEX")) {
    out.formQuality = null;
    withheld.push("Consistency Index", "Giant Killer Index");
  }
  if (!canAccessFeature(ctx, "READINESS_TRACKER")) {
    out.momentum = null;
    withheld.push("Readiness Tracker");
  }
  return { input: out, withheld };
}
