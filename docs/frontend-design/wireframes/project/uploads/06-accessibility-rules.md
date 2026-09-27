# 06 — Accessibility Rules

> Read from actual source. VERIFIED = present now; PROPOSED = recommendation.

---

## Focus visibility (VERIFIED)

From `globals.css`:

```css
:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
  border-radius: 4px;
}
```

- **Focus ring color:** `var(--amber)` (`#ffb020`) — a 2px outline with 2px
  offset on every focusable element.
- `* { -webkit-tap-highlight-color: transparent; }` removes the mobile tap flash
  (focus-visible remains the affordance).

## Color contrast (VERIFIED, documented intent)

The four text tiers are **solid (no alpha)** and each clears WCAG AA-normal
(4.5:1) on `--panel`, `--ink` **and** `--raised` (per the `globals.css` comment):
`--text` 16.5:1, `--text-secondary` 10.9:1, `--muted` 6.7:1, `--faint` 5.1:1.
Border `--line` is intentionally below the 3:1 non-text floor — treated as
decorative framing (a Gestalt call), not a functional UI boundary.

## Color is never the only signal (VERIFIED)

The codebase consistently pairs color with text/label:

- `StatusChip` — lower-cased status word **and** color **and** a matching
  border.
- `FormBadge` / `ResultLetter` — the letter W/D/L **and** color **and**
  `aria-label`/`title` with the full word ("Win"/"Draw"/"Loss"/"No result").
- Module status (`ReadingCard`) — the status word rendered as text alongside its
  color, with `aria-label={status}`.
- Confidence legend (V1 `PredictedXI`) — dot color **and** text label
  ("High ≥80%" …).

## Semantic HTML (VERIFIED)

- `StandingsTable` and `FeedTable` use real `<table>/<thead>/<tbody>/<th>/<td>`.
- `TeamIntelligencePanel` uses ARIA roles (`role="table"/"row"`) on its
  grid-based comparison (not a native table, but role-annotated).
- Lists use `<ul>/<li>` or `role="list"/"listitem"` (`FormStrip`, `VenueSide`,
  evidence lists).
- One `<h1>` per entity page (entity headers); section titles use `.eyebrow`
  paragraphs rather than nested headings in most panels. V1 `PredictedXI` uses
  `<h2>/<h3>`.
- Each page owns its own `<main>` landmark; the shell provides `<header>` +
  `<nav>` only.
- Time values use `<time dateTime={iso}>` (`Kickoff`).

## ARIA patterns (VERIFIED)

- `aria-label` on landmarks/nav: `primary`, `breadcrumb`, `season`,
  `competition sections`, `match sections`, `match navigation`, `standings`,
  `teams`, `Match day`, `recent form, most recent first`, `team intelligence
  comparison`, etc.
- `aria-current="page"` on the active tab and final breadcrumb crumb;
  `aria-current="true"` on the active season pill.
- `aria-busy="true"` on the loading `<main>`.
- `aria-hidden` + `tabIndex={-1}` on the duplicate row-cell links in `FeedTable`
  (one labelled link per row → one tab stop per row).
- `aria-label="no score"` on the empty `Score` em dash.
- Decorative marks (`CompetitionMonogram`) carry `aria-hidden`; informative marks
  (`CompetitionMark`) carry `title` + `aria-label` with the full name.

## Keyboard navigation (VERIFIED)

- All interactive elements are native `<Link>` (anchors) or `<button>`, so they
  are focusable and operable by keyboard by default.
- Whole-row links keep a single tab stop per row (see `FeedTable` above).
- No custom `tabIndex` traps; no `onClick` on non-interactive elements observed.

## Motion (VERIFIED)

`@media (prefers-reduced-motion: reduce)` forces all animation/transition
durations to `0.001ms` — honors the OS reduced-motion setting globally.

## Missing ≠ zero (VERIFIED — a data-honesty a11y rule)

Nullable values render as an explicit em dash `—` (often with an `aria-label`),
never `0`/`0–0`. Enforced in `Score`, `TeamLine`, `orDash`, `citedValue`,
`GeoField`, `Cell`. This is a product-integrity rule with accessibility impact
(screen readers announce "no score", not a false zero).

---

## PROPOSED accessibility rules (future wireframes — NOT yet convention)

1. **Keep the amber 2px focus ring** on all new interactive elements — it's the
   global affordance; don't suppress `:focus-visible`.
2. **Every status/result must carry text + `aria-label`**, never color alone —
   already the pattern; hold the line for new chips/badges.
3. **Prefer native `<table>` for tabular data**; if a CSS-grid table is used,
   annotate with `role="table"/"row"/"cell"` as `TeamIntelligencePanel` does.
4. **One `<h1>` per page; use a real heading hierarchy** for new content-heavy
   pages (some current panels use `.eyebrow` paragraphs where an `<h2>` would be
   more correct — new pages should prefer headings).
5. **Icon-only controls need an `aria-label`** (monograms/marks already do).
6. **Preserve "missing ≠ zero"** in every new numeric surface.
