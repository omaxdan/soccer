"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The one place a kickoff timestamp becomes a wall-clock day/time.
//
// Every one of kickoff()'s callers (lib/intel.ts) runs as a server component
// — confirmed by checking all five call sites, not assumed. A server has no
// way to know a visitor's timezone; toLocaleDateString/toLocaleTimeString
// without an explicit `timeZone` silently fall back to the SERVER's system
// timezone, which is the entire bug. Only a browser genuinely knows the
// visitor's local zone, which is why this has to be a client component, not
// a smarter server function.
//
// HYDRATION: rendering the real local time on this component's very first
// paint would produce different HTML server-side (which knows nothing) vs.
// client-side (which knows the real timezone) — React would throw a
// hydration mismatch. The fix is the standard one for this exact class of
// problem: render a stable, server-safe placeholder first, then swap in the
// real local time after mount via useEffect. The placeholder flashes for a
// frame; that's the honest cost of a value the server cannot know.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

export type KickoffFormat = "day" | "time" | "dayTime";

function format(iso: string, kind: KickoffFormat): string {
  const d = new Date(iso);
  // No explicit timeZone: this deliberately uses whatever timezone the
  // runtime it executes in resolves to. Called only after mount (browser),
  // so that's the visitor's real local zone — DST included automatically,
  // since the browser's own IANA zone database handles it, never a manual
  // offset.
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (kind === "day") return day;
  if (kind === "time") return time;
  return `${day} ${time}`;
}

/**
 * Renders a kickoff instant as the VISITOR's local wall-clock day/time.
 *
 * Placeholder before mount is deliberately blank-ish (an em dash) rather
 * than a guessed timezone — showing a wrong time with confidence is worse
 * than a one-frame placeholder, the same principle the historical-integrity
 * fix already established for missing snapshots.
 */
export function LocalKickoff({
  iso,
  format: kind = "dayTime",
  className,
}: {
  iso: string;
  format?: KickoffFormat;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(format(iso, kind));
  }, [iso, kind]);
  return <span className={className}>{text ?? "—"}</span>;
}
