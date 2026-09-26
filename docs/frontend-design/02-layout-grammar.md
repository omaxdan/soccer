# 02 — Layout Grammar

> Read from actual source. Each pattern is tagged **VERIFIED CURRENT PATTERN**
> (present in the repo now) or **PROPOSED PITCHTERMINAL DESIGN RULE** (an inference
> for future pages, not yet a convention). Nothing inferred is presented as
> existing.

Primary references:
- Shell: `beta/v2-frontend/src/app/layout.tsx`
- Page containers: `beta/v2-frontend/src/app/v2/**/page.tsx`
- State pages: `beta/v2-frontend/src/app/v2/{loading,error,not-found}.tsx`
- Match main class: `beta/v2-frontend/src/components/v2/matchWorkspace.tsx`

---

## App shell (VERIFIED CURRENT PATTERN)

From `layout.tsx`:

- `<body className="min-h-dvh">` on `var(--ink)`.
- Sticky header: `sticky top-0 z-30 border-b border-line bg-ink`.
- Header inner rail: `mx-auto flex h-14 max-w-6xl items-center gap-3 px-4`
  - **Header height:** `h-14` = 56px.
  - **Max width:** `max-w-6xl` = 72rem (1152px).
  - **Side gutter:** `px-4` = 16px.
- Brand lockup: `Pitch` (text) + `Terminal` (`text-amber`) + `v2` tag
  (`hidden … sm:inline`).
- A vertical divider `h-4 w-px bg-line` and the tagline are `hidden … sm:block`
  (mobile hides secondary chrome).
- Primary nav pushed right with `ml-auto`.
- The shell renders header only; **each page owns its own `<main>` landmark** —
  the wrapper is a plain `<div className="min-w-0">`.

---

## Page container widths (VERIFIED CURRENT PATTERN)

There are **two** container conventions in the codebase, split by page type:

### A. Detail / entity / workspace pages → `max-w-6xl`

```
<main className="space-y-4 mx-auto w-full max-w-6xl px-4 py-4">
```
Used by (verified): editions, teams/[slug], players/[slug], competitions/[slug],
venues/[slug], countries/[code], and matches/[slug] (via
`MATCH_MAIN_CLASS = 'space-y-4 mx-auto w-full max-w-6xl px-4 py-4'`).
- Max width `max-w-6xl` (1152px) — **matches the header rail exactly**.
- Gutter `px-4` (16px), vertical `py-4` (16px).
- Vertical rhythm `space-y-4` (16px) or `space-y-5` (20px) between sections.

### B. List / index / state pages → 760px

```
<main className="space-y-4" style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
```
Used by (verified): v2 root, teams (list), players (list), and all three state
pages (`loading`/`error`/`not-found`).
- Narrower reading column (760px) for simple lists and system messages.
- `padding: 16` all sides; `space-y-4`.

> **Observation (not a rule):** width is chosen by page role — dense multi-panel
> workspaces use the full 1152px rail; simple lists and status pages use the
> 760px reading column. This split is consistent in the repo but is **not**
> centralized in a single constant (only the match page's width is a named
> constant, `MATCH_MAIN_CLASS`).

---

## Section rhythm & panel spacing (VERIFIED CURRENT PATTERN)

- Between top-level sections: `space-y-4` / `space-y-5` on `<main>`.
- Inside a section: `space-y-2` (label + body) and `space-y-1` / `space-y-3`
  for grouped lists (e.g. fixtures grouped by day in `competition.tsx`).
- Panel internal padding: `padding: 12` (compact panels/cards) or `padding: 16`
  (headers), `padding: 20`/`24` (empty/state panels). These are inline px, not a
  token scale.
- Panel-to-panel gaps in grids: `gap-2` (8px) / `gap-3` (12px).

---

## Grid patterns (VERIFIED CURRENT PATTERN)

Responsive grids are almost entirely a **1 → 2 column** collapse:

- `grid grid-cols-1 md:grid-cols-2 gap-2|3` — the dominant pattern
  (team lists, venue-form pair, `RecentVenueForm`, entity team links).
  15 occurrences of `md:grid-cols-2` in the V2 tree.
- `lg:grid-cols-2` — used where the second column should appear only at the
  large breakpoint (2 occurrences; e.g. V1 `PredictedXI` grid `lg:grid-cols-2`).
- `md:grid-cols-4` — a 4-up metric/field row (3 occurrences).
- `repeat(auto-fit, minmax(120px, 1fr))` — inline CSS grid for the venue
  geography fields (self-wrapping tile row).

Fixed 3-column comparison track (inline): `gridTemplateColumns: '1fr auto 1fr'`
— home / center / away, used by `FixtureRow` and `TeamIntelligencePanel`.

---

## Breakpoints (VERIFIED — Tailwind defaults, used inline)

No custom breakpoints are defined; the config only extends colors/fonts/etc.
Tailwind defaults are in force:

| Prefix | Min width |
|---|---|
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `xl:` | 1280px |

Observed usage frequency in V2: `md:` dominates (grid collapse), `sm:` toggles
header chrome, `lg:` is rare, `xl:` unused.

---

## Breadcrumb treatment (VERIFIED CURRENT PATTERN)

From `nav.tsx` `Breadcrumb`:
- `flex flex-wrap items-baseline gap-6px`.
- Non-final crumbs: `.label-cap` in `var(--cool)`, linked.
- Separator: `.label-cap` "/" in `var(--faint)`.
- Final crumb: `.label-cap` in `var(--muted)`, `aria-current="page"`,
  truncates at `maxWidth: 60vw`.

---

## PROPOSED PITCHTERMINAL DESIGN RULE (future pages — NOT yet convention)

These are recommendations for Claude Design wireframes, explicitly not existing
conventions:

1. **Adopt one container helper.** New pages should use the detail-page rail
   (`mx-auto w-full max-w-6xl px-4 py-4`) for anything with more than a single
   list, and reserve the 760px column for pure index/status pages — matching the
   header rail width for visual alignment.
2. **Prefer `md:grid-cols-2` as the default collapse.** It's the established
   pattern; new comparison/list surfaces should follow it rather than introducing
   new breakpoints.
3. **Keep `<main>` per-page** (the shell intentionally provides no second
   landmark). Each wireframe page should declare its own `<main>` + section
   headings.
4. **Section vertical rhythm:** default to `space-y-4`; use `space-y-5` only for
   pages with heavier standalone panels (entity pages already do this).
