# PitchTerminal — Frontend Design Source Pack

This directory is the **PitchTerminal visual design source pack**: a portable,
read-only extraction of the *existing* visual system, prepared for use with
Claude Design (wireframes + visual design) alongside the real API payload JSON
files.

PitchTerminal V2 is a football **intelligence / evidence** product — **not** a
betting, tipster, odds, or predictions product. No design produced from this pack
should introduce odds, tips, predictions, confidence/probability framing, or
backend jargon.

---

## Source hierarchy

```
actual globals.css  (beta/{live,v2}-frontend/src/app/globals.css — identical)
        +  tailwind.config.ts  (beta/{live,v2}-frontend — identical)
            ↓
token documentation            01-design-tokens.md
            ↓
component / layout documentation
    02-layout-grammar.md
    03-table-row-system.md
    04-component-grammar.md
    05-responsive-rules.md
    06-accessibility-rules.md
            ↓
page-specific wireframes        (produced in Claude Design)
```

The two `globals-*.css` files here are **byte-for-byte reference copies** of the
current source, for portable upload. They are not built or imported by any app.

---

## What's in this pack

| File | Contents |
|---|---|
| `01-design-tokens.md` | Every CSS variable + Tailwind alias, with exact values, source, purpose, usage. Utilities. |
| `02-layout-grammar.md` | Shell, container widths, grids, breakpoints, spacing, breadcrumbs. |
| `03-table-row-system.md` | Border-separated tables and zebra rows, verbatim classes (incl. the exact zebra `color-mix` %). |
| `04-component-grammar.md` | Reusable visual patterns (panel, header, chip, tabs, reading card, empty/error states, …). |
| `05-responsive-rules.md` | Breakpoints, grid collapse, table behavior, truncation. |
| `06-accessibility-rules.md` | Focus, contrast, semantics, ARIA, "missing ≠ zero". |
| `globals-v1.css` | Byte-for-byte copy of `beta/live-frontend/src/app/globals.css`. |
| `globals-v2.css` | Byte-for-byte copy of `beta/v2-frontend/src/app/globals.css`. |

Each doc distinguishes **VERIFIED CURRENT PATTERN** (present in the repo now)
from **PROPOSED** (a recommendation for future pages, not yet a convention).

---

## Rules for using this pack

- **These are design references. Claude Design should not modify them.** They
  document the locked visual system; they are inputs, not editable artifacts.
- **Application implementation stays in the real frontend** (`beta/v2-frontend`,
  and `beta/live-frontend` for V1). Wireframes and visual explorations do not
  ship as production code; a human ports the approved design into the real app,
  reusing the existing tokens/components — never a new palette or copied V1 JSX.
- **API payload JSON files are separate data-context artifacts.** They live
  elsewhere (see `docs/api-samples/` and the operator-captured payloads) and
  describe the real data contracts. Do not invent API fields, tokens, endpoints,
  or wireframe fields not present in a real payload.
- **The theme is dark-only.** There is exactly one theme; do not introduce a
  light mode or alternate palette.

---

## Key facts (verified this extraction)

- `beta/live-frontend/src/app/globals.css` and
  `beta/v2-frontend/src/app/globals.css` are **byte-for-byte identical**
  (5,716 bytes, sha256 `942d940b042d5b4316bbf32a1d2fca9272edf68fcff80b51dd227593f565ec6d`).
- The two `tailwind.config.ts` files are also **byte-for-byte identical**.
- Radius is `4px` (`rounded-term` / `borderRadius.term`); accent is `--amber`
  `#ffb020`; the four solid text tiers are `--text` / `--text-secondary` /
  `--muted` / `--faint`.
- The exact zebra fill is
  `odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]`
  (from `PredictedXI.tsx`).
