# RIP Phase 1 - Football Intelligence Warehouse Foundation

This is a production-ready data warehouse system that serves as the foundation for the **Readiness Intelligence Platform (RIP)**.

## What This Does

**Phase 1 focuses ONLY on the data warehouse foundation.**

- Automatically discovers tournaments, seasons, teams, and players
- Syncs historical and future fixtures from SportsAPI Pro
- Tracks match results and squad composition
- Precomputes team form history (first intelligence layer)
- Stores normalized relational data in Supabase
- Positions the system for Phase 2+ intelligence (readiness scores, fatigue models, etc.)

**What it does NOT do:**

- NO predictive modeling
- NO readiness scores
- NO fatigue calculations
- NO on-demand intelligence generation

All future intelligence will be precomputed in background jobs, never at request time.

---

## Architecture

### Data Flow

```
SportsAPI Pro
    ↓
Ingestion Jobs (Cron)
    ↓
Normalized Tables (Supabase)
    ↓
Processing Jobs (Form Processor)
    ↓
Precomputed Intelligence Tables
    ↓
API / Frontend (READ-ONLY)
```

### Key Components

- **sportsApiClient.ts**: HTTP client with exponential backoff and retry logic
- **repositories/**: Data access layer (clean separation of concerns)
- **transformers/**: Convert SportsAPI responses to normalized models
- **jobs/**: Ingestion and processing cron jobs
- **cronOrchestrator.ts**: Manages all scheduled jobs

---

## Prerequisites

1. **Node.js** >= 18.0.0
2. **npm** or **yarn**
3. **Supabase** project (free tier is fine for Phase 1)
4. **SportsAPI Pro** API key (get from https://sportsapi.football/)

---

## Setup

### 1. Clone and Install

```bash
git clone <repo>
cd rip-phase1
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
SPORTSAPI_KEY=your_api_key_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_key_here

NODE_ENV=development
LOG_LEVEL=debug
CRON_ENABLED=false
```

**Important**: For local development, set `CRON_ENABLED=false`. Enable cron only in production.

### 3. Create Supabase Schema

Run the migration on your Supabase project:

```sql
-- Copy-paste src/db/migrations/001_initial_schema.sql
-- into the SQL Editor in Supabase Dashboard
-- OR use Supabase CLI:
supabase db push
```

---

## Running Locally

### Start the Application (with cron jobs disabled)

```bash
npm run dev
```

This will:
- Load configuration
- Initialize Supabase client
- Log available jobs

### Run Jobs Manually

Use the CLI to test jobs before enabling cron:

```bash
# Sync tournaments
npm run jobs:sync-tournaments

# Sync schedule for a specific date
npx ts-node src/cli.ts sync:schedule 2024-01-15

# Sync all team rosters
npm run jobs:sync-teams-players

# Process form for recent matches
npm run jobs:process-form

# Backfill ALL form history
npx ts-node src/cli.ts process:form:backfill
```

---

## Deployment on cPanel

### 1. Upload to cPanel

1. In cPanel, navigate to **File Manager**
2. Upload the project to your public_html or a subdirectory
3. SSH into your hosting account

### 2. Install Dependencies

```bash
cd /home/yourusername/public_html/rip-phase1
npm install --production
npm run build
```

### 3. Configure Environment

```bash
cp .env.example .env
nano .env
# Fill in production values
```

### 4. Create cPanel Cron Jobs

In cPanel, go to **Cron Jobs**:

**Option A: Run main server (starts scheduler automatically)**

```
# Every hour, restart the server
0 * * * * cd /home/yourusername/public_html/rip-phase1 && npm start >> logs/cron.log 2>&1
```

**Option B: Run individual jobs**

```
# Daily tournaments sync at 0 AM
0 0 * * * cd /home/yourusername/public_html/rip-phase1 && npx ts-node src/cli.ts sync:tournaments >> logs/cron.log 2>&1

# Daily schedule sync at 2 AM
0 2 * * * cd /home/yourusername/public_html/rip-phase1 && npx ts-node src/cli.ts sync:schedule 2024-01-15 >> logs/cron.log 2>&1

# Daily teams/players sync at 3 AM
0 3 * * * cd /home/yourusername/public_html/rip-phase1 && npx ts-node src/cli.ts sync:teams-players >> logs/cron.log 2>&1

# Every 6 hours, process form
0 */6 * * * cd /home/yourusername/public_html/rip-phase1 && npx ts-node src/cli.ts process:form:recent >> logs/cron.log 2>&1
```

**OR Option C: Use environment variable to enable built-in scheduler**

In `.env`:
```env
CRON_ENABLED=true
```

Then in cPanel Cron:
```
*/5 * * * * cd /home/yourusername/public_html/rip-phase1 && npm start >> logs/cron.log 2>&1
```

### 5. Create Logs Directory

```bash
mkdir -p logs
chmod 755 logs
```

### 6. Monitor Logs

```bash
tail -f logs/cron.log
```

---

## Project Structure

```
/rip-phase1
├── src/
│   ├── config/              # Configuration loading
│   ├── db/                  # Supabase client & types
│   ├── services/            # SportsAPI client
│   ├── repositories/        # Data access layer
│   ├── transformers/        # Data transformation
│   ├── jobs/                # Cron jobs & processing
│   ├── utils/               # Logger, helpers
│   ├── types/               # TypeScript interfaces
│   ├── constants/           # Endpoint registry
│   ├── server.ts            # Main entry point
│   └── cli.ts               # CLI utility
├── supabase/
│   └── migrations/          # SQL migrations
├── logs/                    # Cron job logs
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Key Concepts

### Idempotency

Every job is idempotent - safe to run multiple times. Uses `ON CONFLICT ... DO UPDATE` patterns.

### No Runtime Calculations

The system STRICTLY separates:

- **Ingestion Layer**: Raw data from API
- **Processing Layer**: Background jobs compute intelligence
- **API Layer**: Read-only access to precomputed data

Future API endpoints will NEVER calculate on-demand. All intelligence is precomputed.

### Endpoint Registry

All SportsAPI endpoints are registered in one place:

```typescript
// src/constants/endpoints.ts
export const ENDPOINT_REGISTRY = {
  schedule: "/schedule/{date}",
  match: "/match/{id}",
  team_players: "/teams/{id}/players",
  // ... etc
};

// Usage:
const path = resolveEndpoint('schedule', { date: '2024-01-15' });
// => "/schedule/2024-01-15"
```

Adding new endpoints requires only updating the registry - no code rewrites needed.

---

## Database Schema (Phase 1)

### Raw Tables

- **countries**: Tournament countries
- **tournaments**: Leagues/competitions
- **seasons**: League seasons
- **teams**: Football teams
- **players**: Players with squad assignments
- **matches**: Match fixtures
- **match_results**: Match outcomes (truth layer)
- **team_squads_snapshot**: Squad composition snapshots

### Derived Tables (Precomputed Intelligence)

- **team_form_history**: W-D-L records, points (Phase 1 only intelligence)

Phase 2+ will add:
- team_intelligence (readiness scores, fatigue, etc.)
- player_intelligence (load, fatigue per player)
- match_intelligence (intensity metrics)

---

## Cron Job Schedule

| Job | Schedule | Purpose |
|-----|----------|---------|
| syncTournaments | Daily 0 AM | Discover tournaments |
| syncSeasons | Daily 1 AM | Sync league seasons |
| syncNextWeekSchedule | Daily 2 AM | Sync next 7 days of fixtures |
| syncAllTeamsPlayers | Daily 3 AM | Sync team rosters |
| processFormRecent | Every 6 hours | Compute form for finished matches |

---

## Error Handling

### Exponential Backoff

API calls automatically retry with exponential backoff on rate limits and server errors:

```
Attempt 1: Wait 1s
Attempt 2: Wait 2s
Attempt 3: Wait 4s
Max: 3 retries
```

### Structured Logging

All logs are structured (JSON-compatible):

```json
{
  "level": "info",
  "timestamp": "2024-01-15T10:30:00Z",
  "jobName": "syncTournaments",
  "message": "Tournaments sync completed",
  "tournamentsProcessed": 142
}
```

View logs:
```bash
tail -f logs/app.log | jq '.' # Pretty-print JSON logs
```

---

## Troubleshooting

### "Missing environment variables"

```bash
# Check .env file exists and has all required keys
cat .env
```

### "Failed to connect to Supabase"

```bash
# Verify Supabase credentials
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_KEY
```

### "External_id not unique" error

This means you're trying to insert duplicate records. Jobs are idempotent and should use `ON CONFLICT`. If you see this, check the job logic.

### Cron jobs not running

1. Check cPanel Cron Jobs page
2. Verify command paths (use absolute paths)
3. Check logs: `tail -f logs/cron.log`
4. Test job manually: `npx ts-node src/cli.ts sync:tournaments`

---

## Testing

Before going to production:

1. **Test locally** with `CRON_ENABLED=false`
2. **Run individual jobs** via CLI
3. **Check logs** for errors
4. **Verify data** in Supabase dashboard
5. **Enable cron** only after validation

---

## Phase 1 → Phase 2 Roadmap

**Phase 1 (Current)**
- Data warehouse foundation
- Raw + normalized tables
- Team form history (only intelligence)

**Phase 2**
- Readiness Intelligence Engine (precomputed)
- Fatigue Index calculation
- Squad Stability Index
- Match Intensity Score
- Multi-table denormalization for speed

**Phase 3**
- Predictive models (ML)
- Betting edge detection
- Public SaaS API

---

## Support

- **Logs**: Check `/logs/` directory
- **Errors**: Structured logs with stack traces
- **Manual Runs**: Use CLI: `npx ts-node src/cli.ts help`

---

## License

Copyright © 2024 NinetyData. All rights reserved.

---

**Last Updated**: January 2024  
**Version**: Phase 1.0  
**Status**: Production-Ready
