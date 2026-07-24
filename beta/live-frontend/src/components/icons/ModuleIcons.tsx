// ─────────────────────────────────────────────────────────────────────────────
// Icon set — no emoji anywhere in PitchTerminal.
//
// All icons are 24×24, stroke-based, and inherit `currentColor`, so they take
// their colour from the module status token without any per-icon plumbing.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { ModuleKey, ModuleStatus } from "@/lib/modules";

type IconProps = { size?: number; className?: string; strokeWidth?: number };

function Svg({
  size = 18,
  className = "",
  strokeWidth = 1.5,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
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

// ── Module 1 · Home/Away Split ───────────────────────────
export const IconHomeAway = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 8 6l5 4.5V19H3z" />
    <path d="M16 8h5v11h-5" />
    <path d="M13 13.5h6" />
    <path d="M17 11.5 19 13.5 17 15.5" />
  </Svg>
);

// ── Module 2 · Readiness Tracker ─────────────────────────
export const IconReadiness = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17.5 8 12l3.5 3L20 6" />
    <path d="M15.5 6H20v4.5" />
    <path d="M3 21h18" />
  </Svg>
);

// ── Module 3 · Consistency Index ─────────────────────────
export const IconConsistency = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12h3l2.5-5 3 10 3-7.5 2.5 4.5H21" />
    <path d="M2 4.5h20" strokeDasharray="2 3" />
    <path d="M2 19.5h20" strokeDasharray="2 3" />
  </Svg>
);

// ── Module 4 · Giant Killer Index ────────────────────────
export const IconGiantKiller = (p: IconProps) => (
  <Svg {...p}>
    <rect x="14" y="4" width="6" height="16" rx="1" />
    <rect x="4" y="12" width="6" height="8" rx="1" />
    <path d="M7 9.5 4.5 6.5h5z" />
  </Svg>
);

// ── Module 5 · Travel Impact ─────────────────────────────
export const IconTravel = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="18" r="2.25" />
    <circle cx="19" cy="6" r="2.25" />
    <path d="M6.9 16.3C10 13.5 10.5 6.9 16.8 6.2" strokeDasharray="3 2.5" />
  </Svg>
);

// ── Module 6 · Rest Advantage ────────────────────────────
export const IconRest = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
    <path d="M2.5 4.5 5 6.5" />
    <path d="M21.5 4.5 19 6.5" />
  </Svg>
);

// ── Module 7 · League Goal Profile ───────────────────────
export const IconLeagueGoals = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h18v11H3z" />
    <path d="M7 8v11M11 8v11M15 8v11M19 8v11" strokeWidth={0.9} />
    <path d="M3 12h18M3 15.5h18" strokeWidth={0.9} />
    <circle cx="12" cy="4.5" r="2" />
  </Svg>
);

// ── Module 8 · Form Gap Accuracy ─────────────────────────
export const IconFormGap = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="4.5" height="14" rx="1" />
    <rect x="16.5" y="12" width="4.5" height="7" rx="1" />
    <path d="M9.5 9.5h5" />
    <path d="M9.5 7.5v4M14.5 7.5v4" />
  </Svg>
);

// ── Module 9 · BTTS by Fatigue ───────────────────────────
export const IconBtts = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="4.5" />
    <circle cx="16" cy="12" r="4.5" />
    <path d="M8 10v4M6 12h4" />
    <path d="M16 10v4M14 12h4" />
  </Svg>
);

// ── Module 10 · Confidence Calibration ───────────────────
export const IconConfidence = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
  </Svg>
);

// ── Module 11 · Half-Time Trends ─────────────────────────
export const IconHalftime = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M12 5v14" strokeDasharray="2.5 2.5" />
    <path d="M6.5 12h3" />
    <path d="M14.5 9.5h3M14.5 14.5h3" />
  </Svg>
);

// ── Module 12 · Clean Sheet Probability ──────────────────
export const IconCleanSheet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5 20 6v6.5c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z" />
    <path d="M8.75 12.2 11 14.5l4.5-4.75" />
  </Svg>
);

export const MODULE_ICONS: Record<ModuleKey, (p: IconProps) => React.ReactElement> = {
  home_away: IconHomeAway,
  readiness: IconReadiness,
  consistency: IconConsistency,
  giant_killer: IconGiantKiller,
  travel: IconTravel,
  rest: IconRest,
  league_goals: IconLeagueGoals,
  form_gap: IconFormGap,
  btts_fatigue: IconBtts,
  confidence: IconConfidence,
  halftime: IconHalftime,
  clean_sheet: IconCleanSheet,
};

export function ModuleIcon({
  moduleKey,
  ...rest
}: IconProps & { moduleKey: ModuleKey }) {
  const C = MODULE_ICONS[moduleKey];
  return <C {...rest} />;
}

// ── Status glyphs ────────────────────────────────────────

export const IconSupports = (p: IconProps) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Svg>
);

export const IconNeutral = (p: IconProps) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M5 12h14" />
  </Svg>
);

export const IconContradicts = (p: IconProps) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconInactive = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="2 3" />
  </Svg>
);

export function StatusIcon({
  status,
  ...rest
}: IconProps & { status: ModuleStatus }) {
  if (status === "supports") return <IconSupports {...rest} />;
  if (status === "contradicts") return <IconContradicts {...rest} />;
  if (status === "neutral") return <IconNeutral {...rest} />;
  return <IconInactive {...rest} />;
}

// ── Utility glyphs ───────────────────────────────────────

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.5" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconUnverified = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12h15" />
    <path d="M14 7l5 5-5 5" />
  </Svg>
);

export const IconGate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5v14M20 5v14" />
    <path d="M8 12h8" />
    <path d="M8 9v6M16 9v6" />
  </Svg>
);

// ── Nav glyphs (replace the ▚ ◫ ⬗ ƒ literals) ────────────

export const IconBoard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18" />
    <path d="M9 9v11" />
  </Svg>
);

export const IconModules = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
  </Svg>
);

export const IconFixtures = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="1.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);

export const IconMethod = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 4h12" />
    <path d="M10 4v6L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5-9V4" />
    <path d="M7.5 15h9" />
  </Svg>
);
