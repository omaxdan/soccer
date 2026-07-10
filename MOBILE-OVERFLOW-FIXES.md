# Mobile Layout Overflow Fixes — Integration Guide

## Section 10: League Analytics Page
**File:** `frontend-section10-leagues-analytics.tsx`  
**Target:** `/frontend/src/app/leagues/analytics/page.tsx`

### Changes
- Summary cards: horizontal scroll with `overflow-x: auto; WebkitOverflowScrolling: touch`
- Filter pill row: same scroll behavior, flex nowrap
- Main table: strict `minWidth: auto`, tight cell padding (`0.375rem 0.5rem`)
- Column widths: League name `min-w-[40%] max-w-[45%]`, stats `0.75rem` fonts
- Nested tier table: responsive inner scroll, compressed spacing
- Typography: reduced font sizes (0.625rem headers, 0.75rem data cells)

### Key Mobile Fixes
✓ Metric cards no longer shrink to unreadable sizes  
✓ Filter pills horizontally scrollable on narrow screens  
✓ League name wraps naturally inside 40–45% width boundary  
✓ All numerical columns lock to right-aligned, non-wrapping text  
✓ Status badges compressed and inline  

---

## Section 11: Match Center Page
**File:** `frontend-section11-matches-center.tsx`  
**Target:** `/frontend/src/app/matches/page.tsx` (lines 205–360)

### Changes
- Table uses `tableLayout: fixed` with explicit column width percentages
- Column allocation:
  - Star (watchlist): `1.5rem`
  - Time: `1.75rem`
  - Match (teams): `38%` — expands safely, team names truncated via `text-overflow: ellipsis`
  - Score: `1.5rem`
  - HOME/AWAY/GAP: `11%` each, center-aligned
  - PICK: `12%`
  - CONF%: `14%`
- Table container: `overflow-x: auto; WebkitOverflowScrolling: touch`, max-width 100%
- Cell padding: `0.375rem 0.1875rem` for stats columns, `0.375rem 0.375rem` for match column
- Row height: fixed `3.125rem` prevents vertical clipping
- Font sizes compressed to `0.75rem` body, `0.625rem` headers, `0.8125rem` readiness scores

### Key Mobile Fixes
✓ All 9 columns fit within viewport or scroll horizontally  
✓ Team names never overflow cell or cause layout bleed  
✓ Score columns locked to center alignment  
✓ Readiness/GAP/PICK/CONF% metrics remain right-aligned and compact  
✓ No global body horizontal overflow  
✓ Touch-friendly scroll with momentum on iOS (`-webkit-overflow-scrolling: touch`)  

---

## How to Apply

### Option 1: Full Replacement
1. **Section 10:** Replace entire `/frontend/src/app/leagues/analytics/page.tsx` with `frontend-section10-leagues-analytics.tsx`
2. **Section 11:** Replace lines 205–360 in `/frontend/src/app/matches/page.tsx` with the content of `frontend-section11-matches-center.tsx`

### Option 2: Surgical Merge (Recommended)
1. Copy the refactored `SummaryCard`, `Th`, `Td`, `DetailTd` function signatures and implementations from Section 10
2. Update the summary cards grid to use horizontal scroll container
3. Update the filter pill row to use horizontal scroll container
4. Update the main table to use strict column widths and tight padding
5. For Section 11, replace only the `<table>` JSX block (keeping data queries intact) with the refactored table from Section 11

---

## Testing Checklist

- [ ] Mobile (375px width): no horizontal scrollbar on body
- [ ] Mobile (375px width): metric cards scroll horizontally (can tap to view all)
- [ ] Mobile (375px width): filter pills scroll horizontally
- [ ] Mobile (375px width): all 9 match columns visible OR scrollable within card boundary
- [ ] Tablet (768px): all columns render without internal scroll
- [ ] Desktop (1200px): full table visible without scroll
- [ ] Text wrapping: league names wrap cleanly in analytics table
- [ ] Text wrapping: team names in match table truncate with `…`
- [ ] Touch scroll on iOS: momentum scroll active (visual: scroll continues after finger lift)
- [ ] Metrics alignment: HOME/AWAY/GAP/CONF% all right-aligned and non-wrapping
- [ ] Status badges: render inline, no layout breaks

---

## CSS Variables Required (Already in `/frontend/src/design/tokens.ts`)
- `COLORS.surface`
- `COLORS.surface2`
- `COLORS.border`
- `COLORS.text`
- `COLORS.text2`
- `COLORS.muted`
- `COLORS.dim`
- `COLORS.bg`
- `COLORS.green`
- `COLORS.orange`
- `COLORS.amber`
- `COLORS.red`
- `COLORS.blue`
- `COLORS.purple`

No new color imports required.

---

## Fallback Notes

If `WebkitOverflowScrolling: touch` is not supported on older iOS, graceful degradation: scroll still works, just without momentum (acceptable on 2024+ devices).

All widths computed in `rem` and `%` — scales with user font size preference.

Fixed `tableLayout: 'fixed'` prevents dynamic column width recalculation on content change (safe here — team names are fixed-length after initial fetch).

