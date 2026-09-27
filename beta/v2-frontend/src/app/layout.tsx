import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { PrimaryNav, BottomNav } from "@/components/v2/nav";
import { routes } from "@/lib/v2/routes";

// PitchTerminal V2 shell.
//
// A deliberately minimal, self-owned shell for the V2 intelligence terminal — no
// authentication, no tier gating, and none of the legacy betting navigation. V2 is
// a pre-match football INTELLIGENCE product, not a betting product, so the chrome
// carries no odds/market/betting language. Auth/tier gating can be added later as a
// separate, explicitly-authorized step.
export const metadata: Metadata = {
  title: {
    default: "PitchTerminal — Football Intelligence",
    template: "%s · PitchTerminal",
  },
  description:
    "A pre-match football intelligence terminal: governed, sealed Match Intelligence with full provenance, evidence, and honest treatment of what is and isn't yet known.",
  applicationName: "PitchTerminal",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Header entry-point buttons. Sign in → /login, Get access → /pricing (both exist).
const GHOST_BTN =
  "mono flex h-8 items-center rounded-term border border-line px-3 text-[0.625rem] font-medium uppercase tracking-[0.1em] text-text no-underline";
const AMBER_BTN =
  "mono flex h-8 items-center rounded-term border border-amber bg-amber px-3 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink no-underline";

/** The global Search control. Search is a product-wide control, but there is no
 *  search backend yet (Phase I), so this is the honest designed affordance only: it
 *  is present and labelled but performs no action and fabricates nothing. The `/`
 *  hint is visual guidance (no keyboard shortcut is wired). `compact` is the mobile
 *  icon-only form. */
function SearchControl({ compact = false }: { compact?: boolean }) {
  const icon = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <circle cx="5" cy="5" r="3.8" />
      <line x1="8" y1="8" x2="11" y2="11" />
    </svg>
  );
  if (compact) {
    return (
      <button type="button" title="Search — coming soon" aria-label="Search (coming soon)"
        className="flex h-9 w-9 items-center justify-center rounded-term border border-line text-muted">
        {icon}
      </button>
    );
  }
  return (
    <button type="button" title="Search — coming soon" aria-label="Search (coming soon)"
      className="flex h-8 w-44 items-center gap-2 rounded-term border border-line bg-panel px-2.5 text-muted">
      {icon}
      <span className="text-[0.75rem]">Search</span>
      <span className="mono ml-auto rounded-term border border-line px-1 text-[0.6rem] text-faint">/</span>
    </button>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh">
        {/* Global application header — the permanent chrome shared by every surface
            (Landing, Fixtures, Competitions, Teams, Players, Match, …). It is NOT a
            page-specific header: individual workspaces add their own breadcrumbs/tabs
            below it. Brand → /, primary nav is the four exploration surfaces, plus the
            global Search control and the Sign in / Get access entry points. */}
        <header className="sticky top-0 z-30 border-b border-line bg-ink">
          <div className="mx-auto max-w-6xl px-4">
            {/* Row 1 */}
            <div className="flex h-14 items-center gap-3">
              <Link href={routes.home()} className="flex items-baseline gap-1.5" aria-label="PitchTerminal home">
                <span className="mono text-base font-bold tracking-tight text-text">
                  Pitch<span className="text-amber">Terminal</span>
                </span>
                <span className="mono hidden rounded-term border border-line px-1 text-[0.5rem] font-medium tracking-[0.1em] text-faint sm:inline">
                  V2
                </span>
              </Link>
              <span className="hidden h-4 w-px bg-line sm:block" />
              <span className="eyebrow hidden sm:block">Football Intelligence</span>

              {/* Desktop: primary nav + search + auth */}
              <div className="ml-auto hidden items-center gap-3 self-stretch md:flex">
                <PrimaryNav variant="desktop" />
                <SearchControl />
                <Link href={routes.login()} className={GHOST_BTN}>Sign in</Link>
                <Link href={routes.pricing()} className={AMBER_BTN}>Get access</Link>
              </div>

              {/* Mobile: compact search + access entry points. The primary
                  navigation lives in the fixed bottom bar (BottomNav), so there is no
                  second header row on mobile. */}
              <div className="ml-auto flex items-center gap-2 md:hidden">
                <SearchControl compact />
                <Link href={routes.login()} className={GHOST_BTN}>Sign in</Link>
                <Link href={routes.pricing()} className={AMBER_BTN}>Get access</Link>
              </div>
            </div>
          </div>
        </header>

        {/* The shell provides the header/nav only; each page owns its own <main>
            landmark and content container, so this wrapper is a plain div (never a
            second <main>). On mobile the fixed bottom navigation overlaps content, so
            reserve its height (plus the safe-area inset) below every page. */}
        <div className="min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">{children}</div>

        {/* Persistent mobile primary navigation (hidden on desktop). */}
        <BottomNav />
      </body>
    </html>
  );
}
