// ─────────────────────────────────────────────────────────────────────────────
// Navigation icons.
//
// Separate from ModuleIcons on purpose. Those glyphs stand for analytical
// modules — a house-with-arrow means Home/Away Split, a flask means Method —
// and reusing them for navigation produced a flask beside "Sign out", a target
// beside "Trends" and a house beside "Users". A reader has no way to decode
// that, and it makes the module glyphs mean two different things.
//
// Same construction as the module set: 24x24, stroke, currentColor.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className = "", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Dashboard — a panelled layout. */
export const NavToday = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M9 9v11" />
  </Svg>
);

/** Fixtures — a calendar. */
export const NavMatches = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

/** Saved — a star. */
export const NavSaved = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" />
  </Svg>
);

/** Leagues — a trophy. */
export const NavLeagues = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 5.5H4.5V7a3 3 0 0 0 3 3M17 5.5h2.5V7a3 3 0 0 1-3 3" />
    <path d="M12 14v3M9 20h6M10 17h4l.5 3h-5z" />
  </Svg>
);

/** Teams — a group. */
export const NavTeams = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 19a5.4 5.4 0 0 0-2-4.2" />
  </Svg>
);

/** Players — one person. */
export const NavPlayers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Svg>
);

/** Users — accounts, not football sides. Deliberately distinct from NavTeams:
 *  sharing a glyph would mean the same mark stands for a squad in one part of
 *  the navigation and an account list in another. */
export const NavUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10" cy="8" r="3.2" />
    <path d="M4 19.5a6 6 0 0 1 12 0" />
    <circle cx="18.5" cy="6" r="1.6" />
    <path d="M18.5 9v2M17 10h3" strokeWidth={1.2} />
  </Svg>
);

/** Search — a magnifier. */
export const NavSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);

/** Trends — a rising line. */
export const NavTrends = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17.5L9 11l3.5 3.5L20 6" />
    <path d="M15.5 6H20v4.5" />
    <path d="M3 21h18" />
  </Svg>
);

/** Module library — a grid. */
export const NavModules = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </Svg>
);

/** Method — a book. */
export const NavMethod = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2z" />
    <path d="M4 5.5v15" />
    <path d="M8 8h7M8 11.5h7" />
  </Svg>
);

/** Subscription — a card. */
export const NavSubscription = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
    <path d="M2.5 10h19" />
    <path d="M6 14.5h4" />
  </Svg>
);

/** Settings — a cog. */
export const NavSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
  </Svg>
);

/** Sign out — arrow leaving a door. */
export const NavSignOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
    <path d="M17.5 8.5L21 12l-3.5 3.5" />
    <path d="M21 12h-10" />
  </Svg>
);

/** Sign in — arrow entering a door. */
export const NavSignIn = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 4.5h7.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H10" />
    <path d="M6.5 8.5L3 12l3.5 3.5" />
    <path d="M3 12h10" />
  </Svg>
);

/** Admin — a shield. */
export const NavAdmin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5L20 6v6.5c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z" />
    <path d="M9.5 11.5h5M12 9v5" />
  </Svg>
);

/** Feature flags — toggles. */
export const NavFlags = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="6" rx="3" />
    <circle cx="7.5" cy="8" r="1.6" fill="currentColor" stroke="none" />
    <rect x="2.5" y="13" width="19" height="6" rx="3" />
    <circle cx="16.5" cy="16" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

/** More — a horizontal ellipsis. */
export const NavMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);
