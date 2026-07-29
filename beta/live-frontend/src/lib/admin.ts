"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, getSessionUser } from "./supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Admin user management.
//
// Every read here goes through the SESSION client, so RLS (migration 038)
// decides what actually comes back — a non-admin calling any function in this
// file gets nothing, regardless of what the function claims to return. That is
// the real enforcement; the checks below are a courtesy for a readable error,
// the same split already used for setSubscriptionsEnabled in authActions.ts.
//
// ROLE HIERARCHY: user(0) < support(1) < moderator(2) < admin(3) < owner(4).
// Two rules enforced identically in every mutating action below:
//   - you cannot act on someone whose rank is >= your own (an admin cannot
//     touch another admin or an owner; only an owner can act on an admin)
//   - you cannot grant a rank >= your own (an admin cannot create another
//     admin or an owner)
// Owner is otherwise unprotected by anything except these two rules, which is
// what "cannot be modified" and "cannot lose owner role" actually reduce to:
// nobody outranks an owner, so no rank-based action can ever target one.
// ─────────────────────────────────────────────────────────────────────────────

const RANK: Record<string, number> = { user: 0, support: 1, moderator: 2, admin: 3, owner: 4 };

export type ActionResult = { ok: true } | { ok: false; error: string };

interface Actor {
  id: string;
  role: string;
  rank: number;
}

async function requireActor(): Promise<Actor | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };
  const client = await supabaseServer();
  if (!client) return { error: "Not configured." };
  const { data } = await client.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  const role = (data as any)?.role ?? "user";
  if (RANK[role] < RANK.admin) return { error: "Admin role required." };
  return { id: user.id, role, rank: RANK[role] };
}

async function logAction(
  actorId: string,
  targetUserId: string,
  action: string,
  detail?: string,
  metadata: Record<string, unknown> = {}
) {
  const client = await supabaseServer(true);
  if (!client) return;
  await client.from("admin_actions").insert({ actor_id: actorId, target_user_id: targetUserId, action, detail, metadata });
}

// ── Actor's own role, for the client action components ─────────────────────
// A narrow addition rather than widening AccessContext.role (typed
// "user" | "admin" | null and used across settings/subscription pages) to the
// five-tier hierarchy everywhere it appears. This is admin-console-internal.
export async function getOwnRole(): Promise<{ role: string; rank: number }> {
  const user = await getSessionUser();
  if (!user) return { role: "user", rank: 0 };
  const client = await supabaseServer();
  if (!client) return { role: "user", rank: 0 };
  const { data } = await client.from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  const role = (data as any)?.role ?? "user";
  return { role, rank: RANK[role] ?? 0 };
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface UserListRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string;
  provider: string | null;
  plan: string;
  status: string | null;
  suspended: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UserListFilters {
  q?: string;
  role?: string;
  plan?: string;
  provider?: string;
  status?: "active" | "suspended";
  page?: number;
  pageSize?: number;
}

export interface UserListResult {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Server-side search, filter and pagination — never fetch-everything-then-
 * slice-in-the-browser. Search matches email or display name.
 */
export async function listUsers(filters: UserListFilters = {}): Promise<UserListResult> {
  const client = await supabaseServer();
  if (!client) return { rows: [], total: 0, page: 1, pageSize: 25 };

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    let query = client
      .from("user_profiles")
      .select("user_id, email, display_name, avatar_url, role, provider, suspended, created_at, last_login_at", {
        count: "exact",
      });

    if (filters.q && filters.q.trim().length >= 2) {
      const q = filters.q.trim();
      query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);
    }
    if (filters.role) query = query.eq("role", filters.role);
    if (filters.provider) query = query.eq("provider", filters.provider);
    if (filters.status === "suspended") query = query.eq("suspended", true);
    if (filters.status === "active") query = query.eq("suspended", false);

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error || !data) return { rows: [], total: 0, page, pageSize };

    const ids = (data as any[]).map((r) => r.user_id);
    const { data: subs } = ids.length
      ? await client
          .from("user_subscriptions")
          .select("user_id, status, plan:subscription_plans(slug)")
          .in("user_id", ids)
          .eq("status", "active")
      : { data: [] as any[] };
    const subByUser = new Map(((subs as any[]) ?? []).map((s) => [s.user_id, s]));

    let rows: UserListRow[] = (data as any[]).map((p) => {
      const s = subByUser.get(p.user_id);
      return {
        userId: p.user_id,
        email: p.email ?? null,
        displayName: p.display_name ?? null,
        avatarUrl: p.avatar_url ?? null,
        role: p.role ?? "user",
        provider: p.provider ?? null,
        plan: s?.plan?.slug ?? "free",
        status: s?.status ?? null,
        suspended: Boolean(p.suspended),
        createdAt: p.created_at,
        lastLoginAt: p.last_login_at ?? null,
      };
    });

    // Plan filter applied after the join: subscription_plans isn't reachable
    // from user_profiles in one PostgREST filter without a second round trip
    // for the id, and the page size (<=100) makes filtering the already-
    // fetched page trivial rather than worth a second query.
    if (filters.plan) rows = rows.filter((r) => r.plan === filters.plan);

    return { rows, total: count ?? rows.length, page, pageSize };
  } catch {
    return { rows: [], total: 0, page, pageSize };
  }
}

export interface UserDetail extends UserListRow {
  updatedAt: string;
  verified: boolean;
  subscription: {
    plan: string;
    status: string | null;
    startedAt: string | null;
    renewsAt: string | null;
    provider: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  suspendedReason: string | null;
  suspendedAt: string | null;
}

export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const client = await supabaseServer();
  if (!client) return null;
  try {
    const [profile, sub] = await Promise.all([
      client.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
      client
        .from("user_subscriptions")
        .select("status, started_at, current_period_end, provider, cancel_at_period_end, plan:subscription_plans(slug)")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    const p = profile.data as any;
    if (!p) return null;
    const s = sub.data as any;
    return {
      userId: p.user_id,
      email: p.email ?? null,
      displayName: p.display_name ?? null,
      avatarUrl: p.avatar_url ?? null,
      role: p.role ?? "user",
      provider: p.provider ?? null,
      plan: s?.plan?.slug ?? "free",
      status: s?.status ?? null,
      suspended: Boolean(p.suspended),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      verified: Boolean(p.email),
      lastLoginAt: p.last_login_at ?? null,
      suspendedReason: p.suspended_reason ?? null,
      suspendedAt: p.suspended_at ?? null,
      subscription: s
        ? {
            plan: s.plan?.slug ?? "free",
            status: s.status,
            startedAt: s.started_at,
            renewsAt: s.current_period_end,
            provider: s.provider ?? "manual",
            cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
          }
        : null,
    };
  } catch {
    return null;
  }
}

export interface AdminActionRow {
  id: number;
  actorId: string;
  actorName: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
}

export async function getUserActivity(userId: string, limit = 50): Promise<AdminActionRow[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("admin_actions")
      .select("id, actor_id, action, detail, created_at, actor:user_profiles!admin_actions_actor_id_fkey(display_name)")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor?.display_name ?? null,
      action: r.action,
      detail: r.detail ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export interface UserNoteRow {
  id: number;
  authorName: string | null;
  note: string;
  flag: string | null;
  createdAt: string;
}

export async function getUserNotes(userId: string): Promise<UserNoteRow[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("user_notes")
      .select("id, note, flag, created_at, author:user_profiles!user_notes_author_id_fkey(display_name)")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false });
    return ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      authorName: r.author?.display_name ?? null,
      note: r.note,
      flag: r.flag ?? null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

// ── Summary cards ────────────────────────────────────────────────────────────

export interface AdminSummary {
  totalUsers: number;
  newThisWeek: number;
  activeToday: number;
  payingUsers: number;
  conversionPct: number;
  churnPct: number;
  planCounts: { plan: string; count: number }[];
}

export async function getAdminSummary(): Promise<AdminSummary | null> {
  const client = await supabaseServer();
  if (!client) return null;
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const [totalQ, newQ, activeQ, subsQ, cancelledQ] = await Promise.all([
      client.from("user_profiles").select("user_id", { count: "exact", head: true }),
      client.from("user_profiles").select("user_id", { count: "exact", head: true }).gte("created_at", weekAgo),
      client.from("user_profiles").select("user_id", { count: "exact", head: true }).gte("last_login_at", dayAgo),
      client.from("user_subscriptions").select("status, plan:subscription_plans(slug)").eq("status", "active"),
      client.from("user_subscriptions").select("user_id", { count: "exact", head: true }).in("status", ["cancelled", "expired"]),
    ]);

    const totalUsers = totalQ.count ?? 0;
    const payingUsers = ((subsQ.data as any[]) ?? []).filter((s) => s.plan?.slug === "pro").length;
    const planCounts = new Map<string, number>();
    for (const s of (subsQ.data as any[]) ?? []) {
      const plan = s.plan?.slug ?? "free";
      planCounts.set(plan, (planCounts.get(plan) ?? 0) + 1);
    }
    planCounts.set("free", Math.max(0, totalUsers - payingUsers));

    return {
      totalUsers,
      newThisWeek: newQ.count ?? 0,
      activeToday: activeQ.count ?? 0,
      payingUsers,
      conversionPct: totalUsers > 0 ? Math.round((payingUsers / totalUsers) * 1000) / 10 : 0,
      churnPct:
        payingUsers > 0
          ? Math.round(((cancelledQ.count ?? 0) / (payingUsers + (cancelledQ.count ?? 0))) * 1000) / 10
          : 0,
      planCounts: [...planCounts.entries()].map(([plan, count]) => ({ plan, count })),
    };
  } catch {
    return null;
  }
}

// ── Mutating actions ─────────────────────────────────────────────────────────

export async function changeRole(targetUserId: string, newRole: string): Promise<ActionResult> {
  const actor = await requireActor();
  if ("error" in actor) return { ok: false, error: actor.error };
  if (!(newRole in RANK)) return { ok: false, error: "Unknown role." };

  const client = await supabaseServer(true);
  if (!client) return { ok: false, error: "Not configured." };
  const { data: target } = await client
    .from("user_profiles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();
  const targetRank = RANK[(target as any)?.role ?? "user"];

  if (targetRank >= actor.rank) return { ok: false, error: "Cannot act on an equal or higher role." };
  if (RANK[newRole] >= actor.rank) return { ok: false, error: "Cannot grant a role equal to or above your own." };

  const { error } = await client
    .from("user_profiles")
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq("user_id", targetUserId);
  if (error) return { ok: false, error: error.message };

  await logAction(actor.id, targetUserId, "role_changed", `${(target as any)?.role ?? "user"} -> ${newRole}`);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

export async function setSuspended(
  targetUserId: string,
  suspended: boolean,
  reason?: string
): Promise<ActionResult> {
  const actor = await requireActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const client = await supabaseServer(true);
  if (!client) return { ok: false, error: "Not configured." };
  const { data: target } = await client
    .from("user_profiles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (RANK[(target as any)?.role ?? "user"] >= actor.rank)
    return { ok: false, error: "Cannot act on an equal or higher role." };

  const { error } = await client
    .from("user_profiles")
    .update({
      suspended,
      suspended_reason: suspended ? reason ?? null : null,
      suspended_at: suspended ? new Date().toISOString() : null,
      suspended_by: suspended ? actor.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", targetUserId);
  if (error) return { ok: false, error: error.message };

  await logAction(actor.id, targetUserId, suspended ? "suspended" : "unsuspended", reason);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

export type PlanActionType = "upgrade" | "downgrade" | "cancel" | "extend" | "reset";

/**
 * The one place user_subscriptions is written to by an admin. Every branch
 * logs to subscription_events (migration 035's lifecycle table) AND
 * admin_actions (038's actor-attributed trail) — the first is the user's own
 * billing history, the second is who did it, for the admin audit.
 */
export async function applyPlanAction(
  targetUserId: string,
  type: PlanActionType,
  extendDays?: number
): Promise<ActionResult> {
  const actor = await requireActor();
  if ("error" in actor) return { ok: false, error: actor.error };

  const client = await supabaseServer(true);
  if (!client) return { ok: false, error: "Not configured." };

  const { data: existing } = await client
    .from("user_subscriptions")
    .select("id, status, current_period_end, plan:subscription_plans(id, slug)")
    .eq("user_id", targetUserId)
    .eq("status", "active")
    .maybeSingle();
  const oldPlan = (existing as any)?.plan?.slug ?? "free";

  const { data: plans } = await client.from("subscription_plans").select("id, slug");
  const planId = (slug: string) => ((plans as any[]) ?? []).find((p) => p.slug === slug)?.id ?? null;

  let newPlan = oldPlan;
  let eventType: string;
  let actionType: string;

  if (type === "upgrade" || type === "downgrade") {
    newPlan = type === "upgrade" ? "pro" : "free";
    actionType = type === "upgrade" ? "plan_upgraded" : "plan_downgraded";
    eventType = actionType === "plan_upgraded" ? "upgraded" : "downgraded";
    if (newPlan === "free") {
      await client
        .from("user_subscriptions")
        .update({ status: "cancelled", cancel_at_period_end: false })
        .eq("user_id", targetUserId)
        .eq("status", "active");
    } else {
      const pid = planId(newPlan);
      if (!pid) return { ok: false, error: `No ${newPlan} plan row found.` };
      await client
        .from("user_subscriptions")
        .upsert(
          { user_id: targetUserId, plan_id: pid, status: "active", provider: "manual", started_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
    }
  } else if (type === "cancel") {
    actionType = "plan_cancelled";
    eventType = "cancelled";
    await client
      .from("user_subscriptions")
      .update({ status: "cancelled", cancel_at_period_end: false })
      .eq("user_id", targetUserId)
      .eq("status", "active");
    newPlan = "free";
  } else if (type === "extend") {
    actionType = "plan_extended";
    eventType = "renewed";
    const days = extendDays ?? 30;
    const base = (existing as any)?.current_period_end
      ? new Date((existing as any).current_period_end)
      : new Date();
    const next = new Date(Math.max(base.getTime(), Date.now()) + days * 86_400_000);
    await client
      .from("user_subscriptions")
      .update({ current_period_end: next.toISOString() })
      .eq("user_id", targetUserId)
      .eq("status", "active");
  } else {
    // reset: end the current row outright — the "start clean" action.
    actionType = "plan_reset";
    eventType = "cancelled";
    await client
      .from("user_subscriptions")
      .update({ status: "expired" })
      .eq("user_id", targetUserId)
      .eq("status", "active");
    newPlan = "free";
  }

  await client.from("subscription_events").insert({
    user_id: targetUserId,
    event_type: eventType,
    old_plan: oldPlan,
    new_plan: newPlan,
    metadata: { actor_id: actor.id, source: "admin" },
  });
  await logAction(actor.id, targetUserId, actionType, `${oldPlan} -> ${newPlan}`);

  revalidatePath("/admin/users");
  revalidatePath("/admin/subscriptions");
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

export async function addNote(targetUserId: string, note: string, flag?: string): Promise<ActionResult> {
  const actor = await requireActor();
  if ("error" in actor) return { ok: false, error: actor.error };
  if (!note.trim()) return { ok: false, error: "Note cannot be empty." };

  const client = await supabaseServer(true);
  if (!client) return { ok: false, error: "Not configured." };
  const { error } = await client
    .from("user_notes")
    .insert({ target_user_id: targetUserId, author_id: actor.id, note: note.trim(), flag: flag || null });
  if (error) return { ok: false, error: error.message };

  await logAction(actor.id, targetUserId, "note_added", note.trim().slice(0, 80));
  revalidatePath(`/admin/users/${targetUserId}`);
  return { ok: true };
}

// ── Confidence band analytics (read-only) ───────────────────────────────────
//
// This page must never calculate a statistic itself — every number here was
// already computed by the shared engine in beta/backend/src/lib/confidenceBand.ts
// and written by jobs/archiveReadinessHistory.ts / jobs/backtestConfidenceBands.ts.
// These functions are SELECT * equivalents, nothing more.

export interface LeagueBandCell {
  leagueName: string;
  band: string;
  totalPicks: number;
  hitRateStrict: number | null;
  hitRateLenient: number | null;
  baselineRate: number | null;
  liftOverBaseline: number | null;
  versatilityCoverage: number | null;
}

export interface LeagueBandSummaryRow {
  leagueName: string;
  totalPicks: number;
  hitRateStrict: number | null;
  liftOverBaseline: number | null;
  bandStatus: string | null;
  meetsSampleGate: boolean;
}

export async function getLeagueBandCells(): Promise<LeagueBandCell[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("league_gap_analytics")
      .select("league_name, gap_tier, total_picks, hit_rate_strict, hit_rate_lenient, baseline_rate, lift_over_baseline, versatility_coverage")
      .order("total_picks", { ascending: false });
    return ((data as any[]) ?? []).map((r) => ({
      leagueName: r.league_name,
      band: r.gap_tier, // column name predates the migration; now holds Elite/Strong/Moderate/Risky/Avoid
      totalPicks: r.total_picks,
      hitRateStrict: r.hit_rate_strict,
      hitRateLenient: r.hit_rate_lenient,
      baselineRate: r.baseline_rate,
      liftOverBaseline: r.lift_over_baseline,
      versatilityCoverage: r.versatility_coverage,
    }));
  } catch {
    return [];
  }
}

export async function getLeagueBandSummary(): Promise<LeagueBandSummaryRow[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("league_gap_summary")
      .select("league_name, total_picks, hit_rate_strict, lift_over_baseline, band_status, meets_sample_gate")
      .order("total_picks", { ascending: false });
    return ((data as any[]) ?? []).map((r) => ({
      leagueName: r.league_name,
      totalPicks: r.total_picks,
      hitRateStrict: r.hit_rate_strict,
      liftOverBaseline: r.lift_over_baseline,
      bandStatus: r.band_status,
      meetsSampleGate: r.meets_sample_gate,
    }));
  } catch {
    return [];
  }
}

// ── Confidence band drilldown — upcoming fixtures, live data ───────────────
//
// Deliberately NOT the readiness_history/historical-accuracy path above. An
// upcoming, not-yet-played match has no frozen snapshot to read — there is
// nothing to protect against lookahead bias here, because there is no
// "later" data to leak into a "past" measurement. Reading
// match_intelligence.confidence_band directly for a match that hasn't
// happened yet is the correct and only source; it would only be wrong to use
// it for scoring a match that already has a result, which this never does.

export interface UpcomingBandMatch {
  matchId: number;
  date: string;
  competition: string | null;
  leagueName: string | null;
  homeName: string;
  awayName: string;
  band: string | null;
  confidenceScore: number | null;
}

/**
 * One query, grouped by the caller as needed — the band drilldown page calls
 * this with a band filter and shows every league; the league drilldown page
 * calls it with a league filter and groups the result by band itself. Same
 * function either way — no second implementation of "which upcoming matches
 * fall in which band".
 */
export async function getUpcomingMatchesByBand(filters: {
  band?: string;
  league?: string;
  daysAhead?: number;
}): Promise<UpcomingBandMatch[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const now = new Date();
    const to = new Date(now.getTime() + (filters.daysAhead ?? 7) * 86_400_000);

    let query = client
      .from("matches")
      .select(
        "id, date, competition, tournament:tournaments(name), home:teams!matches_home_team_id_fkey(name, short_name), away:teams!matches_away_team_id_fkey(name, short_name)"
      )
      .gte("date", now.toISOString())
      .lte("date", to.toISOString())
      .order("date", { ascending: true });
    if (filters.league) query = query.eq("competition", filters.league);

    const { data: matches } = await query;
    if (!matches || matches.length === 0) return [];
    const ids = (matches as any[]).map((m) => m.id);

    const { data: intel } = await client
      .from("match_intelligence")
      .select("match_id, confidence_band, confidence_score")
      .in("match_id", ids);
    const intelByMatch = new Map(((intel as any[]) ?? []).map((r) => [r.match_id, r]));

    return (matches as any[])
      .map((m: any) => {
        const i = intelByMatch.get(m.id);
        return {
          matchId: m.id,
          date: m.date,
          competition: m.competition ?? null,
          leagueName: m.tournament?.name ?? m.competition ?? null,
          homeName: m.home?.short_name || m.home?.name || "—",
          awayName: m.away?.short_name || m.away?.name || "—",
          band: (i as any)?.confidence_band ?? null,
          confidenceScore: (i as any)?.confidence_score ?? null,
        };
      })
      .filter((m) => !filters.band || m.band === filters.band);
  } catch {
    return [];
  }
}

export async function exportUsersCsv(filters: UserListFilters = {}): Promise<string> {
  const actor = await requireActor();
  if ("error" in actor) return "";
  const { rows } = await listUsers({ ...filters, page: 1, pageSize: 100 });
  const header = "email,display_name,role,provider,plan,status,suspended,created_at,last_login_at";
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [r.email, r.displayName, r.role, r.provider, r.plan, r.status, String(r.suspended), r.createdAt, r.lastLoginAt]
      .map((v) => esc(v))
      .join(",")
  );
  return [header, ...lines].join("\n");
}
