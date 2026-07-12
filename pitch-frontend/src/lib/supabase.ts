import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// When credentials are absent, PitchTerminal runs on built-in demo
// intelligence so the terminal is always explorable. Live warehouse data
// flows the moment NEXT_PUBLIC_SUPABASE_* are set.
export const LIVE = Boolean(url && anon);

let client: SupabaseClient | null = null;

export function db(): SupabaseClient | null {
  if (!LIVE) return null;
  if (!client) {
    client = createClient(url as string, anon as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const STORAGE_BASE = url
  ? `${url.replace(/\/$/, "")}/storage/v1/object/public/crests`
  : "";

export function crestUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  if (!STORAGE_BASE) return null;
  return `${STORAGE_BASE}/${path}`;
}
