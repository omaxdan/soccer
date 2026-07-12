# PitchTerminal

**The Bloomberg Terminal for football betting intelligence.**

PitchTerminal is a mobile-first Next.js 15 frontend that reads a precomputed
football-intelligence warehouse (Supabase / PostgREST, populated by the
NinetyData RIP backend) and turns it into betting *decisions* — never a raw
stat dump. For every fixture it answers three questions: where is the edge,
where is the market mispricing, and where is the risk.

## Design — "Phosphor Terminal"

A dark trading-desk aesthetic with an amber-phosphor CRT accent and
monospace-driven data typography. Three recurring signatures carry the
identity:

- **Opportunity ÷ Risk meter** — a single split track: opportunity fills from
  the left (amber → emerald), risk hatches in from the right (coral). The gap
  between them is the edge window.
- **Signal ledger rows** — each market signal rendered as a terminal ticker
  line with a direction glyph and a 6-segment strength meter.
- **Monospace match codes** and tabular numerics throughout.

No web-font network fetches (system + monospace stacks only), so it builds and
renders fully offline.

## Pages

| Route | Purpose |
| --- | --- |
| `/` | **Board** — every fixture ranked by opportunity, with lens + league filters |
| `/matches` | Fixtures in kickoff order, grouped by match day |
| `/matches/[id]` | **Match Intelligence Hub** — the flagship report (executive decision, prediction center, head-to-head intelligence, market signals, availability, risk engine, edge drivers) |
| `/teams/[id]` | Team dashboard — readiness, attacking profile, form quality, venue splits, momentum, injuries, squad depth |
| `/leagues` | League conditions + model hit-rate by competition |
| `/method` | How the engine scores opportunity and risk |

## Data

The frontend is **read-only** against the warehouse. Set credentials to go live:

```bash
cp .env.local.example .env.local
# then fill in:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Without credentials, PitchTerminal runs on built-in **demo intelligence** so
the terminal is always explorable. A live/demo indicator sits in the header.

Team crests and tournament logos are served from the public `crests` Supabase
storage bucket.

### Tables consumed

`matches`, `teams`, `tournaments`, `match_intelligence`, `match_opportunity`,
`match_risk_intelligence`, `match_signals`, `match_predicted_lineups`,
`match_weather`, `match_results`, `team_intelligence`, `team_goal_dependency`,
`team_injury_impact`, `team_form_quality`, `team_venue_performance`,
`team_momentum`, `team_position_depth`, `players`, `league_intelligence`,
`league_gap_summary`.

## Develop

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the build
```

## Stack

Next.js 15 (App Router, server components) · React 18 · TypeScript ·
Tailwind CSS 3 · `@supabase/supabase-js`. Server pages use
`dynamic = "force-dynamic"` since intelligence updates continuously.

---

*PitchTerminal is an intelligence tool, not a tipping service. Every number is
precomputed and read-only. Nothing here is betting advice.*
