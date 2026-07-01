# NinetyData RIP — Readiness Intelligence Platform

Football analytics SaaS: precomputed team/match intelligence (readiness, form,
congestion, travel fatigue, squad stability) driving a betting-signals and
match-picks product.

## Structure

```
.
├── backend/     Node.js/TypeScript + Supabase — sync jobs, DB-only processors, CLI
├── frontend/    Next.js 15 App Router — dashboard, match/team/league intelligence UI
└── css/         Legacy standalone CSS experiment (pre-dates this project)
```

## Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in SPORTSAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
npx ts-node src/cli.ts sync:today
npx ts-node src/cli.ts process:all-db:today
```

See `backend/README.md` for the full CLI command reference.

## Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in Supabase URL + anon key
npm run dev
```

See `frontend/README.md` for page structure and design system notes.

## Zero-runtime-calculation rule

Everything the frontend displays is precomputed by backend CLI jobs into
Supabase tables. The frontend only reads — it never calculates readiness,
form, congestion, or any other intelligence score at request time.
