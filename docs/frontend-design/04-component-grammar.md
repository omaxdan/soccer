# 04 — Component Grammar

> Reusable visual patterns already present in the repo. Each entry names its real
> source, the tokens it uses, and its reusable purpose. Nothing here is a new or
> modified component — this is documentation of what exists.

Sources: `beta/v2-frontend/src/components/v2/{ui,competition,entity,nav,matchWorkspace}.tsx`,
`beta/live-frontend/src/components/{PredictedXI,FeedTable}.tsx`, `globals.css`.

---

## Panel / card

- **Source:** `.panel` and `.panel-raised` (`globals.css`); used everywhere.
- **Visual:** `--panel` (or `--raised`) surface, `1px solid var(--line)`, 4px
  radius. Inner padding is inline px (`12` compact, `16` header, `20`/`24`
  state).
- **Purpose:** the single framing primitive. Cards, headers, tables, empty
  states, list items are all `.panel` variants.

## Entity header

- **Source:** `CompetitionHeader` (`competition.tsx`), `CompetitionHeaderPanel` /
  `CountryHeaderPanel` / `VenueHeaderPanel` (`entity.tsx`).
- **Visual:** `<header className="panel" style={{ padding: 16 }}>` with an
  `.eyebrow` kicker, an `<h1>` at `fontSize: 22, fontWeight: 700, color: var(--text)`,
  and a `.label-cap` subline in `var(--muted)` (slug / code / season). Detail
  variants add a left **monogram** and a right-aligned stats/season row.
- **Tokens:** `--text`, `--muted`, `--faint`, `--line`, `--amber` (monogram).
- **Purpose:** the top-of-page identity block for any entity.

## Monogram / logo treatment

- **Source:** `CompetitionMonogram` (`competition.tsx`), `CompetitionMark`
  (`ui.tsx`), V1 `Crest`.
- **Visual:** an honest **initials** mark when no logo exists — inline-flex box,
  `borderRadius` 3–8px, `.mono` bold, `color: var(--amber)` (competition) or
  `var(--muted)` (compact), `border: 1px solid var(--line)`. The full name stays
  in `title` + `aria-label`.
- **Purpose:** identity mark without inventing/fetching an external image.

## Section header (eyebrow + count + tag)

- **Source:** `SectionEyebrow` (`entity.tsx`), the eyebrow rows in
  `competition.tsx` / `ui.tsx`.
- **Visual:** `flex items-baseline gap-8px`: `.eyebrow` label, optional
  `context` tag, optional `.label-cap .tnum` count in `var(--faint)`.
- **Purpose:** consistent labelling above every panel/list section.

## Status chip

- **Source:** `StatusChip` (`ui.tsx`).
- **Visual:** `.label-cap`, colored text + `1px solid` border of the same color,
  4px radius, `padding: 1px 6px`, `fontSize: 10`. Color by lifecycle:
  COMPLETED → `--muted`, IN_PROGRESS → `--warn`, else `--cool`. Text is
  lower-cased and de-underscored.
- **Purpose:** fixture lifecycle state — **text + color, never color alone**.

## Context tag

- **Source:** `ContextTag` (`entity.tsx`), the `context` / `absent` / `per match`
  badges.
- **Visual:** `.label-cap`, `var(--cool)` (or `var(--faint)`), `1px` border, 4px
  radius, `padding: 0 5px`, `fontSize: 9`.
- **Purpose:** marks a panel as descriptive context or an honest unavailable
  state.

## Form badge / result letter

- **Source:** `FormBadge`, `FormStrip`, `ResultLetter` (`ui.tsx`); V1 legend
  dots in `PredictedXI`.
- **Visual:** 22×22 inline-flex square, 4px radius, `.mono` bold, color-coded
  W→`--edge` / D→`--muted` / L→`--risk` / none→`--faint`, background
  `color-mix(… 15%, transparent)`, border `color-mix(… 40%, transparent)`.
  Always carries `aria-label`/`title` (full word), so it never relies on color.
- **Purpose:** compact recent-form / result visualisation.

## Score

- **Source:** `Score` (`ui.tsx`).
- **Visual:** `.mono .tnum` bold `home`–`away`; the dash is `var(--faint)`;
  a missing result is a single em dash in `var(--faint)` with `aria-label="no score"`.
- **Purpose:** the canonical scoreline; **missing ≠ 0–0**.

## Reading card (module reading)

- **Source:** `ReadingCard` + `EvidencePanel` + `EvidenceItemRow` (`ui.tsx`).
- **Visual:** `.panel-raised` `padding: 12`, `.eyebrow` title + `.label-cap`
  status colored by SUPPORTS/CONTRADICTS/NEUTRAL/INACTIVE, a verdict/body line
  in `--text-secondary` (or `--faint` when inactive), a `sample N` footnote, and
  an optional "Why? · Module substrate" evidence block with a top hairline.
- **Purpose:** one descriptive module reading with its cited evidence; a missing
  reading renders "Not enough data yet", never a fabricated value.

## Comparison row (home vs away)

- **Source:** `TeamIntelligencePanel` (`ui.tsx`), `FixtureRow` (`competition.tsx`).
- **Visual:** `gridTemplateColumns: '1fr auto 1fr'` — right-aligned home /
  centered label+unit / left-aligned away. Leading side highlighted in
  `--edge`, bold, driven by the **governed** direction (not a frontend constant).
- **Purpose:** symmetric two-team comparisons.

## Metric / geo tile

- **Source:** `GeoField` + `VenueGeographyPanel` (`entity.tsx`), the header
  stat row.
- **Visual:** stacked `.label-cap` label (faint) over `.mono .tnum` value;
  laid out in `repeat(auto-fit, minmax(120px, 1fr))`. Nullable → em dash.
- **Purpose:** labelled evidence fields; **null renders `—`, never `0`**.

## Tabs

- **Source:** `MatchTabNav` (`matchWorkspace.tsx`), `EditionTabNav`
  (`competition.tsx`).
- **Visual:** `flex gap-4px` with `borderBottom: 1px solid var(--line)`,
  `overflowX: auto`. Each tab `.label-cap`, `padding: 8px 12px`,
  `whiteSpace: nowrap`; active tab → `color: var(--text)` + `borderBottom: 2px
  solid var(--amber)` with `marginBottom: -1` (sits on the container rule);
  inactive → `var(--muted)`, transparent underline. `aria-current="page"`.
- **Purpose:** in-page section navigation (match tabs, edition tabs). Match tabs
  (verified): Overview · Comparison · Form · Lineups · H2H · Statistics · Venue ·
  Intelligence.

## Chip / pill (selector)

- **Source:** `DateNav` chip (`FeedTable.tsx`), `SeasonSelector` (`competition.tsx`).
- **Visual:** `.mono` / `.label-cap`, `rounded-term`, `padding: ~2px 8px` /
  `px-2.5 py-1.5`; active → `background: var(--amber)`, `color: var(--ink)`,
  amber border; inactive → transparent bg, `var(--muted)` text, `var(--line)`
  border. Overflow row scrolls horizontally with hidden scrollbar.
- **Purpose:** date / season / filter selection.

## Primary nav + breadcrumb + prev/next

- **Source:** `PrimaryNav`, `Breadcrumb`, `MatchNav` (`nav.tsx`).
- **Visual:** `.label-cap` links; nav in `var(--muted)`, breadcrumb links in
  `var(--cool)` with `/` separators in `var(--faint)`; prev/next as two `.panel`
  cells in a `1fr 1fr` grid with a centered "all fixtures" link. Absent
  neighbours render honestly (no fabricated link).
- **Purpose:** shell navigation and intra-edition match stepping.

## Empty state

- **Source:** `EmptyState` (`ui.tsx`) + inline empty states across panels.
- **Visual:** `.panel`, `padding: 24`, centered, message in `var(--muted)`.
  Panel-scoped empties use a `.label-cap` line in `var(--faint)`.
- **Purpose:** honest "no data yet" — distinguished from an error.

## Loading / skeleton

- **Source:** `app/v2/loading.tsx`.
- **Visual:** `<main aria-busy="true">`, `.eyebrow` kicker, `.panel` with
  "Loading…" in `var(--muted)`.
- **Purpose:** route-level loading state. **There is no shimmer/skeleton
  component** — loading is a simple panel message. (PROPOSED: a skeleton block
  could reuse `.panel` + `animate-pulse-dot`, but none exists today.)

## Alert / error

- **Source:** `app/v2/error.tsx`, `app/v2/not-found.tsx`.
- **Visual:** centered `.panel`; error headline in `var(--danger)`, body in
  `var(--muted)`, a Retry `<button>` (`.label-cap`, `bg: var(--raised)`, `1px
  solid var(--line)`); not-found offers a "Back to leagues" `var(--cool)` link.
- **Purpose:** service-unavailable and not-found messaging.

## Button

- **Source:** the Retry button in `error.tsx` (the only real `<button>` styling).
- **Visual:** `.label-cap`, `padding: 6px 14px`, `borderRadius: 6`,
  `border: 1px solid var(--line)`, `background: var(--raised)`,
  `color: var(--text)`, `cursor: pointer`.
- **Purpose:** the one established button treatment. (Most "actions" are links,
  not buttons.)

---

## Patterns NOT present (do not assume they exist)

- No shimmer/skeleton loader component.
- No modal / dialog / drawer / toast components.
- No standalone form-input component in V2 (V1 has `AdminFilterBar` inputs:
  `mono rounded-term border border-line bg-raised … focus:border-amber`).
- No pagination component (lists render in full or top-N slices).
- No avatar/photo component — identity is initials monograms only.
