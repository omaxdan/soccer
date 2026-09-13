import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

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
        <header className="sticky top-0 z-30 border-b border-line bg-ink">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Link href="/" className="flex items-baseline gap-1.5">
              <span className="mono text-base font-bold tracking-tight text-text">
                Pitch<span className="text-amber">Terminal</span>
              </span>
              <span className="mono hidden text-[0.55rem] tracking-widest text-faint sm:inline">
                v2
              </span>
            </Link>
            <span className="hidden h-4 w-px bg-line sm:block" />
            <span className="mono hidden text-[0.6rem] tracking-wide text-muted sm:block">
              Football Intelligence
            </span>
          </div>
        </header>

        <main className="mx-auto min-w-0 max-w-6xl px-3 py-4 md:px-4">{children}</main>
      </body>
    </html>
  );
}
