import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Session-aware Supabase client.
//
// The anon client in lib/supabase.ts stays exactly as it is — every
// intelligence read still goes through it, unauthenticated, and none of that
// changes. This one exists solely so auth.uid() is populated on requests that
// need to know who is asking: the access context, the admin toggle, and the
// RLS policies from migration 033 that depend on is_admin().
// ─────────────────────────────────────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const AUTH_LIVE = Boolean(url && anon);

/**
 * `writable` must be false in Server Components. Next.js forbids setting
 * cookies during render, and Supabase's refresh flow tries to — the write is
 * swallowed there and performed in Server Actions and Route Handlers instead,
 * where it is allowed.
 */
export async function supabaseServer(writable = false): Promise<SupabaseClient | null> {
  if (!AUTH_LIVE) return null;
  const store = await cookies();
  return createServerClient(url as string, anon as string, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        if (!writable) return;
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Render context — the refresh will be persisted by the next action.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const client = await supabaseServer();
  if (!client) return null;
  try {
    // getUser() revalidates against the auth server. getSession() trusts the
    // cookie, which is not safe to authorise against.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}
