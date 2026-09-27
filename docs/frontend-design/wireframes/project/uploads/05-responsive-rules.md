# 05 — Responsive Rules

> Read from actual source. VERIFIED = present now; PROPOSED = recommendation for
> future wireframes.

---

## Breakpoints (VERIFIED — Tailwind defaults)

No custom breakpoints; `tailwind.config.ts` extends only colors/fonts/etc.

| Prefix | Min width | Observed use |
|---|---|---|
| `sm:` | 640px | Toggles header chrome (`v2` tag, divider, tagline) |
| `md:` | 768px | Primary grid collapse point (1 → 2 / 4 cols) |
| `lg:` | 1024px | Occasional 2-col grid (`lg:grid-cols-2`) |
| `xl:` | 1280px | Unused |

Frequency in V2: `md:grid-cols-2` ×15, `md:grid-cols-4` ×3, `lg:grid-cols-2` ×2,
`sm:block` ×2, `sm:inline` ×1.

---

## Grid collapse (VERIFIED)

- Default: `grid grid-cols-1 md:grid-cols-2` — single column on mobile, two from
  768px. This is the dominant responsive behavior (team lists, venue-form pair,
  entity link grids, `RecentVenueForm`).
- 4-up field rows use `md:grid-cols-4` (single column on mobile).
- Inline auto-fit grid `repeat(auto-fit, minmax(120px, 1fr))` self-wraps the
  venue geography tiles with no media query.
- Fixed comparison track `1fr auto 1fr` does **not** collapse — it stays
  three-column at all widths (home / center / away), relying on truncation.

## Content hidden / reordered on mobile (VERIFIED)

From `layout.tsx`:
- `v2` version tag: `hidden … sm:inline`.
- Vertical divider `h-4 w-px bg-line`: `hidden … sm:block`.
- "Football Intelligence" tagline: `hidden … sm:block`.

Only decorative/secondary chrome is hidden below 640px; primary nav and brand
stay visible. No content is reordered (no `order-*` usage).

## Mobile navigation (VERIFIED)

- Primary nav is a plain horizontal `flex gap-14px` of three text links; it does
  **not** collapse into a hamburger/menu. It stays inline and right-aligned via
  `ml-auto` at every width.
- Tab bars (`MatchTabNav`, `EditionTabNav`) and chip rows (`DateNav`) use
  `overflowX: auto` (with hidden scrollbar via `.no-scrollbar` / inline
  `[&::-webkit-scrollbar]:hidden`) so they scroll horizontally rather than wrap.

## Table behavior (VERIFIED)

- `FeedTable`: `table-fixed` with a `<colgroup>`; some columns widen at `md:`
  (`w-16 md:w-[5.5rem]`, `w-[4.5rem] md:w-[8rem]`). Designed to fit **375px with
  no horizontal scroll** (per source comment). Long names truncate.
- `StandingsTable`: wrapped in `overflow-x: auto` — the wide 10-column table
  **scrolls horizontally** on narrow screens rather than shrinking.

## Card stacking (VERIFIED)

- Panels/cards in a `grid-cols-1 md:grid-cols-2` collapse to a single stacked
  column on mobile with `gap-2`/`gap-3` preserved.
- `RecentVenueForm` explicitly stacks its two team panels to one full-width
  column on narrow viewports (`grid grid-cols-1 md:grid-cols-2 gap-3`).

## Typography changes (VERIFIED)

- Minimal. One instance of responsive type: `FeedTable` team name
  `text-[0.7rem] … md:text-[0.76rem]`. Otherwise font sizes are fixed across
  breakpoints; the layout adapts, not the type scale.

## Truncation strategy (VERIFIED)

- Long text (team/competition/player names) uses
  `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` plus
  `min-w-0` on the flex item so it shrinks instead of pushing fixed columns out
  of alignment. This is applied consistently across `FeedTable`, `ui.tsx`,
  `entity.tsx`, `competition.tsx`.

---

## PROPOSED responsive rules (future wireframes — NOT yet convention)

1. **Default collapse is `md:grid-cols-2`.** New multi-column surfaces should use
   it rather than inventing new breakpoints.
2. **Wide data tables scroll, they don't shrink.** Follow `StandingsTable`:
   wrap in `overflow-x: auto`; keep `.tnum` numerics legible.
3. **Compact bars scroll horizontally** (tabs, chips) with a hidden scrollbar —
   already the pattern; keep it.
4. **Keep the type scale fixed;** adapt layout, not font size (matching current
   behavior). Reserve responsive type for a single hero/headline if ever needed.
5. **A mobile nav menu is not currently needed** (three items). If nav grows,
   introduce a menu at `sm:`; do not retrofit one before it's warranted.
