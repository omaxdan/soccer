# 01 — Design Tokens

> **Source of truth:** `beta/v2-frontend/src/app/globals.css` and
> `beta/live-frontend/src/app/globals.css` — **byte-for-byte identical**
> (5,716 bytes, sha256 `942d940b042d5b4316bbf32a1d2fca9272edf68fcff80b51dd227593f565ec6d`).
> Tailwind color/radius/font aliases: `beta/{v2,live}-frontend/tailwind.config.ts`
> — also **byte-for-byte identical**.
>
> Everything below was read from those files. Nothing here is invented. Where a
> name is a Tailwind alias rather than a CSS variable, it says so.

The system is **dark-only**. `html { color-scheme: dark; }` is declared and there
is no `@media (prefers-color-scheme: light)` block and no `[data-theme]` switch.
There is exactly one theme.

---

## Color tokens (CSS custom properties on `:root`)

All defined in `globals.css` `:root { … }`.

| Token | Exact value | Purpose | Example current usage |
|---|---|---|---|
| `--ink` | `#0b0f14` | Canvas / page background; sticky header background | `body { background: var(--ink); }`; header `bg-ink`; `viewport.themeColor: "#0b0f14"` |
| `--panel` | `#121821` | Default surface for cards/panels | `.panel { background: var(--panel); }` |
| `--raised` | `#1a222e` | Raised surface — group-header rows, hover fills, `.panel-raised`, zebra base | `.panel-raised`; `hover:bg-raised`; zebra `color-mix(… var(--raised) …)` |
| `--line` | `#1d2633` | Borders / hairlines / dividers (decorative framing) | `.panel { border: 1px solid var(--line); }`; `border-line`; scrollbar thumb |
| `--text` | `#f4f6f9` | **Primary** text — values, scores, names, numbers (16.5:1 on panel) | `body { color: var(--text); }`; `text-text` |
| `--text-secondary` | `#c3cbd6` | **Secondary** — descriptions, body copy (10.9:1) | Tailwind alias `secondary`; verdict/body copy |
| `--muted` | `#90a0b4` | **Muted** — labels, metadata, timestamps (6.7:1). Color of `.eyebrow` and `.label-cap`. | `.eyebrow`, `.label-cap`; nav item color |
| `--faint` | `#7e8aa0` | **Faint** — quietest tier, still ≥4.5:1 AA-normal on every surface incl. `--raised` (5.1:1) | em-dash placeholders; counts; captions |
| `--amber` | `#ffb020` | Primary accent — brand mark, active tab/chip, focus ring | focus `outline`; active chip bg; logo `text-amber` |
| `--amber-dim` | `rgba(255, 176, 32, 0.22)` | Dim amber wash — captain badge bg, glow shadow ring | captain "C" badge; `shadow.glow` |
| `--edge` | `#2fbf87` | Positive / "supports" / win / stronger-side (green) | `FormBadge` W; module `SUPPORTS`; leading metric |
| `--risk` | `#f0544f` | Negative / "contradicts" / loss / doubt (red) | `FormBadge` L; module `CONTRADICTS`; "DOUBT" |
| `--warn` | `#f5b301` | Caution / live / medium band (yellow) | `StatusChip` live; status fallback |
| `--cool` | `#4c8dff` | Informational / links / "context" tag (blue) | breadcrumb links; standings team links; `context` tag |

### Semantic aliases (additive only)

Defined at the end of `:root`. They point at the accent tokens above; the accent
names were **not** mass-renamed (100+ existing call sites keep `var(--edge)` etc.).

| Token | Resolves to | Value |
|---|---|---|
| `--success` | `var(--edge)` | `#2fbf87` |
| `--warning` | `var(--warn)` | `#f5b301` |
| `--danger` | `var(--risk)` | `#f0544f` |
| `--info` | `var(--cool)` | `#4c8dff` |

> **Text-tier note (verbatim intent from `globals.css`):** all four text tiers are
> **solid, no alpha**, so composited contrast cannot silently drift. Each clears
> WCAG AA-normal (4.5:1) on `--panel`, `--ink` **and** `--raised`.

---

## Radius

| Token | Value | Where |
|---|---|---|
| `--` (Tailwind `borderRadius.term`) | `4px` | `tailwind.config.ts` → utility `rounded-term`. Also the hard-coded `border-radius: 4px` on `.panel`, `.panel-raised`, `:focus-visible`, scrollbar thumb. |

There is **no** CSS `--radius` variable — 4px is expressed as the literal `4px`
in `globals.css` and as `borderRadius.term` in Tailwind. `rounded` (Tailwind's
default 0.25rem = 4px) and `rounded-term` (4px) coincide at 4px; both appear in
components. Larger radii (`borderRadius: 8`) appear inline on a few components
(`ReadingCard`, `CompetitionMonogram`) — these are per-component inline styles,
not tokens.

---

## Typography variables (Tailwind `fontFamily`, `fontSize`)

Fonts are not CSS variables; they are Tailwind theme values referenced by
`globals.css` via `theme("fontFamily.*")` and loaded from Google Fonts in
`beta/v2-frontend/src/app/layout.tsx`.

| Name | Value | Where |
|---|---|---|
| `fontFamily.sans` | `Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif` | `body { font-family: theme("fontFamily.sans"); }` |
| `fontFamily.mono` | `JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace` | `.mono`, `.eyebrow`, `.label-cap` |
| `fontSize.2xs` | `0.6875rem` / lh `0.9rem` / tracking `0.04em` | Tailwind alias `text-2xs` |
| `.eyebrow` size | `0.625rem`, letter-spacing `0.16em`, uppercase | `globals.css` |
| `.label-cap` size | `0.625rem`, letter-spacing `0.1em`, uppercase | `globals.css` |

Fonts loaded: `Inter` weights 400;500;600;700 and `JetBrains Mono` 400;500;600;700
(`layout.tsx`, Google Fonts `<link>`).

---

## Background grid effect (verified, in source)

`body` carries a **faint terminal grid**, from `globals.css`:

```css
background-image:
  linear-gradient(to right, rgba(255,255,255,0.014) 1px, transparent 1px),
  linear-gradient(to bottom, rgba(255,255,255,0.014) 1px, transparent 1px);
background-size: 40px 40px;
```

A separate, opt-in **scanline** texture exists as `.scanlines` (used on the
dashboard hero only, per the source comment): a `::after` overlay of
`repeating-linear-gradient` in `rgba(255,176,32,0.035)`, `mix-blend-mode: screen`,
`opacity: 0.5`.

---

## Shadow tokens (Tailwind `boxShadow`)

| Name | Value |
|---|---|
| `shadow-panel` | `0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)` |
| `shadow-glow` | `0 0 0 1px var(--amber-dim), 0 0 24px -8px var(--amber)` |

---

## Motion tokens (Tailwind `keyframes` / `animation`)

| Name | Definition |
|---|---|
| `animate-pulse-dot` | `pulse-dot 1.8s ease-in-out infinite` (opacity 1 → 0.35) |
| `animate-meter-fill` | `meter-fill 0.7s cubic-bezier(0.22,1,0.36,1) both` (scaleX 0 → 1) |
| `animate-fade-up` | `fade-up 0.4s ease both` (opacity+translateY 6px → 0) |

All motion is suppressed under `@media (prefers-reduced-motion: reduce)` in
`globals.css` (animation/transition durations forced to `0.001ms`).

---

## Utility classes (only those that actually exist)

### Defined in `globals.css`

| Class | What it does |
|---|---|
| `.mono` | `font-family: theme("fontFamily.mono")` + `font-variant-numeric: tabular-nums` |
| `.tnum` | `font-variant-numeric: tabular-nums` (tabular figures only) |
| `.eyebrow` | mono, `0.625rem`, tracking `0.16em`, uppercase, `color: var(--muted)` |
| `.label-cap` | mono, `0.625rem`, tracking `0.1em`, uppercase, `color: var(--muted)` |
| `.panel` | `background: var(--panel)`, `1px solid var(--line)`, radius `4px` |
| `.panel-raised` | `background: var(--raised)`, `1px solid var(--line)`, radius `4px` |
| `.hairline` | `border-color: var(--line)` (a border-color helper only — does not set border-width) |
| `.scanlines` | relative wrapper + amber scanline `::after` overlay |
| `.no-scrollbar` | hides scrollbars (webkit + firefox + IE) |

### Defined in Tailwind (`tailwind.config.ts`), not `globals.css`

| Class | Source |
|---|---|
| `rounded-term` | `borderRadius.term: "4px"` |
| `bg-ink` / `bg-panel` / `bg-raised`, `border-line`, `text-text` / `text-secondary` / `text-muted` / `text-faint` / `text-amber` / `text-cool` … | `colors: { … }` mapping each to its `var(--*)` |
| `text-2xs` | `fontSize["2xs"]` |
| `shadow-panel` / `shadow-glow` | `boxShadow` |
| `animate-pulse-dot` / `animate-meter-fill` / `animate-fade-up` | `animation` |

> **`.rounded-term` clarification:** the task brief listed `.rounded-term` among
> utilities to check. It **exists**, but as a Tailwind `borderRadius.term` alias,
> **not** as a hand-written class in `globals.css`.

> **Tailwind alpha-modifier caveat (verbatim from `tailwind.config.ts`):** the
> color tokens are plain `var()` references, so Tailwind **cannot** inject an alpha
> channel. Slash modifiers like `border-line/70` compile to nothing and fall back
> to Tailwind's default near-white border. Use the bare class or an inline
> `color-mix()` instead.

---

## Tokens that DO NOT exist (do not use / do not invent)

- No `--radius` variable (radius is the literal `4px` / `borderRadius.term`).
- No light theme, no `[data-theme]`, no `prefers-color-scheme: light` block.
- No spacing-scale variables (spacing is Tailwind's default scale / inline px).
- No `--shadow-*` CSS variables (shadows are Tailwind `boxShadow` only).
- No elevation, z-index, or breakpoint **variables** (z-index/breakpoints are
  Tailwind defaults used inline, e.g. `z-30`, `md:`).
