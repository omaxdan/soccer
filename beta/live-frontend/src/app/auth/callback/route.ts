import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * OAuth return leg.
 *
 * Supabase sends the browser here with ?code=. Exchanging it sets the session
 * cookies, which is why this is a Route Handler rather than a page — cookies
 * cannot be written during render.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/app";
  // basePath is not part of request.url, so it has to be re-applied or every
  // redirect lands outside the app.
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  // The provider reports its own failures here — a denied consent screen
  // arrives as ?error=access_denied with no code.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}${base}/login?error=${encodeURIComponent(providerError)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}${base}/login?error=Missing+authorisation+code`);
  }

  const client = await supabaseServer(true);
  if (!client) {
    return NextResponse.redirect(
      `${origin}${base}/login?error=Authentication+is+not+configured`
    );
  }

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}${base}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Records the sign-in and backfills display name, avatar and provider from
  // the OAuth metadata. The signup trigger already created the row; this fills
  // anything still null without overwriting what the user has edited.
  try {
    await client.rpc("touch_last_login");
  } catch {
    // A profile that did not update is not a reason to fail a valid sign-in.
  }

  // Only same-app paths, so ?next= cannot be used as an open redirect.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  return NextResponse.redirect(`${origin}${base}${safeNext}`);
}
