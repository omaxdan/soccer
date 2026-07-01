# NinetyData RIP — Frontend

Built exactly per the RIP Frontend Design Prompt specification.

---

## Run Locally (5 minutes)

```bash
# 1. Install
cd rip-frontend
npm install

# 2. Create credentials file
cp .env.local.example .env.local
# Edit .env.local — paste your Supabase URL + anon key
# From: Supabase Dashboard → Settings → API

# 3. Enable read access in Supabase SQL Editor (one-time):
#    See RLS_SETUP.sql below

# 4. Start
npm run dev
# → http://localhost:3000
```

---

## Supabase RLS Setup (run once in SQL Editor)

```sql
-- Enable RLS and allow public reads on all intelligence tables
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'countries','tournaments','seasons','teams','matches','match_results',
    'match_intelligence','match_travel_intelligence','team_intelligence',
    'team_form_history','team_fixture_load','team_travel_load',
    'team_locations','stadiums','team_squads_snapshot','players'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('
      DO $inner$
      BEGIN
        CREATE POLICY "allow_read" ON %I FOR SELECT USING (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END
      $inner$', t);
  END LOOP;
END;
$$;
```

---

## Pages

| URL | Page |
|-----|------|
| `/` | Dashboard — hero strip, matches, right panels |
| `/matches` | Match Center |
| `/matches/[id]` | Match Intelligence (flagship) |
| `/teams` | Teams list by readiness |
| `/teams/[id]` | Team Intelligence — all 6 tabs |
| `/intel/travel` | Travel Intelligence Hub |
| `/intel/congestion` | Fixture Congestion Hub + heatmap |
| `/intel/form` | Form Power Rankings |
| `/betting` | Betting Signals Hub — 7 market tabs |
| `/search` | Global search |

---

## Design System

Implemented exactly per spec:

- **Colors**: `#0a0a0f` bg, `#111118` surface, exact score banding
- **Score banding**: 85+=#00e676+glow, 65-84=#69f0ae, 45-64=#ffb300, 25-44=#ff6d00, 0-24=#ff1744, null=#555570
- **Typography**: Inter body + JetBrains Mono for all data values and scores
- **ReadinessGauge**: SVG arc 225°→270° sweep, glow on 85+, dashed null ring, showChange prop
- **Skeleton loaders**: dark shimmer — no spinners
- **Data freshness**: footer pill on every page (green <2h, amber 2-12h, red >12h)
- **Mobile**: bottom tab bar [Today / Matches / Intel / Betting / Search]
- **Monetisation**: free tier shows data, blurs signals row 4+ with PRO upgrade CTA

---

## Deploy to cPanel

```bash
npm run build
# Upload to /home/mybrzklx/public_html/rip-frontend/
# Set startup file: node_modules/.bin/next start
# Port: assigned by cPanel
```

Or deploy free on Vercel:
```bash
npx vercel
# Set env vars: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
```
