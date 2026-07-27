"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, getSessionUser } from "./supabase/server";

// ─────────────────────────────────────────────────────────────────────────────
// Favourites and watchlist.
//
// Every write goes through the SESSION client, so the RLS policies from
// migration 035 decide what lands. The user_id is never taken from an argument
// — it comes from the session — which is why a forged request cannot write to
// somebody else's list.
// ─────────────────────────────────────────────────────────────────────────────

export type WatchEntity = "match" | "team" | "league";

export async function getFavouriteLeagueIds(): Promise<number[]> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client.from("user_favourite_leagues").select("tournament_id");
    return ((data as any[]) ?? []).map((r) => r.tournament_id);
  } catch {
    return [];
  }
}

export async function toggleFavouriteLeague(tournamentId: number): Promise<void> {
  const user = await getSessionUser();
  const client = await supabaseServer(true);
  if (!user || !client) return;

  const { data: existing } = await client
    .from("user_favourite_leagues")
    .select("id")
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (existing) {
    await client.from("user_favourite_leagues").delete().eq("id", (existing as any).id);
  } else {
    // The unique constraint makes a double-submit a no-op rather than a
    // duplicate row, so a fast second click cannot corrupt the list.
    await client
      .from("user_favourite_leagues")
      .upsert(
        { user_id: user.id, tournament_id: tournamentId },
        { onConflict: "user_id,tournament_id" }
      );
  }
  revalidatePath("/", "layout");
}

export async function getWatchlist(): Promise<
  { entityType: WatchEntity; entityId: number; createdAt: string }[]
> {
  const client = await supabaseServer();
  if (!client) return [];
  try {
    const { data } = await client
      .from("watchlists")
      .select("entity_type, entity_id, created_at")
      .order("created_at", { ascending: false });
    return ((data as any[]) ?? []).map((r) => ({
      entityType: r.entity_type,
      entityId: r.entity_id,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function isWatched(entityType: WatchEntity, entityId: number): Promise<boolean> {
  const client = await supabaseServer();
  if (!client) return false;
  try {
    const { data } = await client
      .from("watchlists")
      .select("id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function toggleWatch(entityType: WatchEntity, entityId: number): Promise<void> {
  const user = await getSessionUser();
  const client = await supabaseServer(true);
  if (!user || !client) return;

  const { data: existing } = await client
    .from("watchlists")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();

  if (existing) {
    await client.from("watchlists").delete().eq("id", (existing as any).id);
  } else {
    await client
      .from("watchlists")
      .upsert(
        { user_id: user.id, entity_type: entityType, entity_id: entityId },
        { onConflict: "user_id,entity_type,entity_id" }
      );
  }
  revalidatePath("/", "layout");
}
