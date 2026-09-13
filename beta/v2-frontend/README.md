# PitchTerminal V2 frontend (`pitchterminal-v2-frontend`)

The isolated V2 product frontend: a pre-match football **intelligence** terminal —
**not** a betting product. It renders the governed, sealed **Match Intelligence**
served by the V2 HTTP API and keeps governed calculation strictly separate from
live context.

## What lives here

- `src/app/v2/**` — the V2 routes (matches, editions, teams, players), re-homed
  from the legacy frontend with their URLs unchanged during migration.
- `src/app/layout.tsx` — a minimal V2 shell: no auth, no tier gating, no legacy
  betting navigation.
- `src/components/v2/**`, `src/lib/v2/**` — V2 components, API client, wire types,
  and pure presentation logic (formatting only).
- `src/app/globals.css`, `tailwind.config.ts` — the design system, copied in so the
  V2 app is self-contained.

## Architectural rules (do not break)

The frontend **displays** governed intelligence; it **must not recreate** governed
calculations. Team Preparedness scores, VCV/provenance, and cited evidence come
only from the sealed backend via `GET /api/v2/matches/:id/intelligence`. The
frontend may format/present values but never recalculates. **Absence stays
absence** ("No data", never 0); **NULL is never coerced to zero**; **cited evidence
is never mixed with contextual evidence**.

## Boundary

This app is self-contained: it imports nothing from the legacy frontend. Its only
backend contact is the V2 HTTP API (`src/lib/v2/api.ts`, env `PITCHTERMINAL_V2_API`).

## Deployment

Final intent: this app owns the root domain (`https://www.pitchterminal.com/`), so
it ships with **no basePath** (routes serve from root). `/v2` and `/pitch` are not
permanent namespaces; a temporary migration/testing slot may be set with
`NEXT_PUBLIC_BASE_PATH` (see `next.config.ts` and `.env.local.example`).

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm test` — DB-free presentation-logic tests (`tsx --test`)
