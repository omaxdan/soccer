import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { BottomNav, SideNav } from "@/components/Nav";
import { StatusDot } from "@/components/StatusDot";
import { LIVE } from "@/lib/supabase";

export const metadata: Metadata = {
  title: {
    default: "PitchTerminal — Football Betting Intelligence",
    template: "%s · PitchTerminal",
  },
  description:
    "The Bloomberg Terminal for football betting intelligence. See where the edge is, where the market may be mispricing, and where the risk hides — before you place a bet.",
  applicationName: "PitchTerminal",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <body className="min-h-dvh pb-16 md:pb-0">
        {/* Terminal header */}
        <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Link href="/" className="flex items-baseline gap-1.5">
              <span className="mono text-base font-bold tracking-tight text-text">
                Pitch<span className="text-amber">Terminal</span>
              </span>
              <span className="mono hidden text-[0.55rem] tracking-widest text-faint sm:inline">
                v1.0
              </span>
            </Link>
            <span className="hidden h-4 w-px bg-line sm:block" />
            <span className="mono hidden text-[0.6rem] tracking-wide text-muted sm:block">
              Football betting intelligence
            </span>
            <div className="ml-auto">
              <StatusDot live={LIVE} />
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-6xl gap-6 px-4 py-4 md:py-6">
          <aside className="hidden w-44 shrink-0 md:block">
            <SideNav />
            <MethodNote />
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>

        <BottomNav />
      </body>
    </html>
  );
}

function MethodNote() {
  return (
    <div className="panel mt-6 p-3">
      <p className="mono text-[0.6rem] leading-relaxed text-muted">
        The data is the engine. The explanation is the product. PitchTerminal
        translates the warehouse into a decision — never a raw stat dump.
      </p>
    </div>
  );
}
