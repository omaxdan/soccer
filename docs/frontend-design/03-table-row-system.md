# 03 — Table / Row System

> Read from actual source. CSS/classes below are quoted verbatim, not paraphrased.
> Two distinct patterns exist in the repo: a **border-separated table** and a
> **zebra list row**. They are used on different surfaces.

---

## A. Border-separated table

The primary tabular pattern. Two verified implementations:

### A1. `FeedTable` (V1) — `beta/live-frontend/src/components/FeedTable.tsx`

| Aspect | Exact implementation |
|---|---|
| Wrapper | `<div className="panel">` around the table |
| Table element | `<table className="w-full table-fixed border-collapse">` |
| Column widths | Declared in `<colgroup>` (applied before first row, so nothing reflows): `w-9`, `w-16 md:w-[5.5rem]`, `<col />` (flex), `w-[4.5rem] md:w-[8rem]` |
| Header cell (`head` const) | `whitespace-nowrap px-2 py-2 text-left font-normal` |
| Header label | wrapped in `<span className="label-cap">` |
| Header row border | `<tr className="border-b border-line">` |
| Group header row | `<td colSpan> … className="mono border-y border-line bg-raised px-2 py-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted">` + trailing count `<span className="ml-2 tnum text-faint">` |
| Body row | `<tr className="border-t border-line transition-colors hover:bg-raised">` |
| Row cell padding | `px-2 py-2 align-middle` (varies per cell: `px-0.5`, `pl-2 pr-4`) |
| Numeric alignment | `.mono .tnum` + `text-right`, fixed-width column (`w-5`) |
| Hover | `hover:bg-raised` (fills row with `--raised`) |
| Row-as-link | each cell wraps a full-size `<Link className="block h-full w-full">` (whole row is the target); only one link per row carries the `aria-label`, the rest are `aria-hidden`/`tabIndex=-1` |
| No sticky header, no internal scroll | intentional — the board "flows with the page" |

### A2. `StandingsTable` (V2) — `beta/v2-frontend/src/components/v2/competition.tsx`

The league table. Uses inline style objects rather than Tailwind classes:

| Aspect | Exact implementation |
|---|---|
| Section wrapper | `<section className="space-y-2">` with an eyebrow header row (`Standings` + variant + `as of {asOf}`) |
| Table wrapper | `<div className="panel" style={{ padding: 8, overflowX: 'auto' }}>` — **horizontal scroll** on narrow viewports |
| Table | `<table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>` |
| Header cell `stTh` | `{ textAlign: 'right', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' }` (first two columns override to `textAlign: 'left'`) |
| Body cell `stTd` | `{ textAlign: 'right', padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap' }` |
| Position cell | `stTd` + `textAlign:'left'` + `color: var(--faint)` |
| Team cell | `stTd` + `textAlign:'left'`, link in `var(--cool)` |
| Points cell | `stTd` + `fontWeight: 700` (emphasised) |
| GD cell | signed (`+n` / `n`) — a labelled read-layer derivation (GF − GA) |
| Row height | driven by `4px 6px` cell padding + `fontSize: 11` |
| Borders | `borderCollapse: 'collapse'`; no per-row rule line (the panel frames it) |
| Empty state | `absent` badge + "No standings snapshot has been ingested…" |

> **No zebra** in `StandingsTable` — it relies on cell padding + right-alignment
> + a bold Pts column, not striping.

Components using the border-separated table pattern: `FeedTable` (V1 board/schedule),
`StandingsTable` (V2 league table).

---

## B. Zebra row

The zebra treatment is a **list-item row** pattern (not `<table>`), captured
verbatim from the two components that use it:

### B1. `PredictedXI` (V1) — `beta/live-frontend/src/components/PredictedXI.tsx:69`

```
<li className="flex items-center gap-2 rounded-term px-2 py-1.5 odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]">
```

### B2. `ui.tsx` `RecentVenueForm` note

The V2 `TeamStatisticalAttributes` panel and other compact list rows follow the
same grammar; the **canonical, confirmed** zebra source is `PredictedXI.tsx`.

| Aspect | Exact behavior |
|---|---|
| Element | `<li>` inside a `<ul className="space-y-px">` |
| Layout | `flex items-center gap-2` |
| Radius | `rounded-term` (4px) |
| Padding | `px-2 py-1.5` (8px horizontal, 6px vertical) |
| **Zebra fill (odd rows)** | `odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]` |
| Hover | none in `PredictedXI` (rows are static list items); compact interactive lists elsewhere add `hover:bg-raised` |
| Numeric alignment | fixed-width columns, right-aligned: `w-6 text-right` (shirt), `w-10 text-right` (pct), all `.mono .tnum` |
| Typography | `.mono`, small sizes (`text-[0.62rem]` … `text-[0.74rem]`) |

> **Exact color-mix (verbatim):**
> `color-mix(in_srgb, var(--raised) 40%, transparent)`.
> The **40%** figure is the value in the confirmed `PredictedXI` source.
> (A **30%** variant of the same expression exists elsewhere for larger/looser
> lists; **40%** is the value for the compact list rows shown in the reference
> screenshot.)

---

## Numeric alignment convention (VERIFIED, both patterns)

- Numbers always render with `.tnum` (tabular figures) — usually via `.mono`
  which includes `font-variant-numeric: tabular-nums`.
- Numeric columns are **right-aligned** and given a **fixed width** so digits
  line up and long adjacent text (names) cannot push them out of the column.
- Missing numeric values render as an em dash `—` in `var(--faint)`, never `0`
  (see `Score`, `TeamLine score ?? "–"`).

## Group headers (VERIFIED)

- Table group header: full-width `<td colSpan>` band in `bg-raised`, `.mono`,
  `uppercase tracking-[0.14em] text-muted`, with a right-side count in
  `.tnum text-faint`.
- List group header (`PredictedXI`, `competition.tsx`): a `.label-cap` /
  `.eyebrow` line above the rows, with an optional `.tnum` count.

---

## PROPOSED row system for future V2 pages (NOT yet standardized)

Marked PROPOSED — these are recommendations, not existing conventions:

1. **Zebra = compact scannable lists** (lineups, per-player rows, attribute
   lists). Use the verbatim
   `odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]` on `<li>` rows in
   a `space-y-px` list, `rounded-term px-2 py-1.5`.
2. **Border-separated table = dense multi-column data** (standings, fixtures,
   statistics grids). Wrap in `.panel`, `border-collapse`, `border-t border-line`
   row rules, `hover:bg-raised`, `.label-cap` header cells, right-aligned `.tnum`
   numerics with fixed column widths.
3. **Never both** on the same table (zebra + row-rules reads as noise).
4. **Horizontal scroll** for wide tables uses `overflow-x: auto` on the `.panel`
   wrapper (as `StandingsTable` does) rather than shrinking columns below
   legibility.
5. **Whole-row links** (as `FeedTable` does) with a single labelled `<Link>` and
   the rest `aria-hidden` — preserves one tab stop per row.
