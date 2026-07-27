"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer, getSessionUser } from "./supabase/server";

// Server Actions run in a context where cookies CAN be written, which is why
// every one of these passes writable = true.

export type AuthState = { error: string } | null;

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const client = await supabaseServer(true);
  if (!client) return { error: "Authentication is not configured on this deployment." };

  const { error } = await client.auth.signInWithPassword({ email, password });
  // Supabase deliberately does not distinguish a wrong password from an unknown
  // address, and neither should this — it would confirm which emails exist.
  if (error) return { error: "Those credentials were not accepted." };

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const client = await supabaseServer(true);
  if (!client) return { error: "Authentication is not configured on this deployment." };

  // The migration 033 trigger creates the user_profiles row; nothing is
  // inserted here, so a profile cannot be missed or duplicated.
  const { error } = await client.auth.signUp({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/app");
}

export async function signOut() {
  const client = await supabaseServer(true);
  if (client) await client.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Flips subscriptions_enabled.
 *
 * Authorisation is enforced twice: here, and by the ps_admin_write RLS policy
 * from migration 033. The check below is a courtesy that produces a readable
 * error — the policy is what actually protects the row, and it would reject
 * this write even if this function were called some other way.
 */
export async function setSubscriptionsEnabled(enabled: boolean): Promise<{ error?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Not signed in." };

  const client = await supabaseServer(true);
  if (!client) return { error: "Authentication is not configured." };

  const { data: profile } = await client
    .from("user_profiles").select("role").eq("user_id", user.id).maybeSingle();
  if ((profile as any)?.role !== "admin") return { error: "Admin role required." };

  // Turning it ON with no admin would be unrecoverable. Only an admin reaches
  // this line, so an admin always exists — but the count is checked anyway,
  // because "the only person who can undo this" should not be an assumption.
  if (enabled) {
    const { count } = await client
      .from("user_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (!count || count < 1)
      return { error: "Refusing to enable: no admin account exists to turn it back off." };
  }

  const { error } = await client
    .from("platform_settings")
    .update({ value: enabled ? "true" : "false", updated_at: new Date().toISOString() })
    .eq("key", "subscriptions_enabled");
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return {};
}
