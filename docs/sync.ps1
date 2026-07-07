# ============================================================
#  NINETYDATA RIP — SYNC FUNCTIONS
#  Daily budget: 200 API calls (2 keys combined)
#
#  COST GUIDE (approximate, per run):
#    sync:today        =  1 call   (always)
#    sync:tomorrow     =  1 call   (always)
#    sync:squads:v2 2  = ~10-30    (today+tomorrow teams only)
#    sync:player-stats = ~40 max   (21-day cooldown per team)
#    sync:team-stats   = ~40 max   (21-day cooldown per team)
#    sync:standings    = ~42       (all tracked leagues — weekly only)
#    sync:week         =  7        (7 days — weekly only)
#    process:all-db    =  0        (pure DB, no API calls)
#    archive:*         =  0        (pure DB, no API calls)
#
#  Daily-Sync:   ~42-72 calls  (well under 200)
#  Weekly-Sync:  ~49 extra     (run Monday only — adds standings + week)
# ============================================================

function Go-Backend {
    Set-Location C:\wamp64\www\soccer\backend
    Write-Host "📁 Backend: C:\wamp64\www\soccer\backend" -ForegroundColor Cyan
}

function Daily-Sync {
    Write-Host ""
    Write-Host "=== DAILY SYNC STARTED ===" -ForegroundColor Green
    Write-Host "  Cost: ~42-72 API calls" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "[1/7] sync:today (1 call)" -ForegroundColor White
    npx ts-node src/cli.ts sync:today
    Write-Host ""

    Write-Host "[2/7] sync:tomorrow (1 call)" -ForegroundColor White
    npx ts-node src/cli.ts sync:tomorrow
    Write-Host ""

    # Squads for today + tomorrow only — ~10-30 calls, not 766.
    # Use 2 to cover today's late matches and tomorrow's early ones.
    # Increase to 3 on Friday for weekend coverage.
    Write-Host "[3/7] sync:squads:v2 2  (today + tomorrow teams only, ~10-30 calls)" -ForegroundColor White
    npx ts-node src/cli.ts sync:squads:v2 2
    Write-Host ""

    Write-Host "[4/7] process:all-db  (0 API calls — pure DB computation)" -ForegroundColor White
    npx ts-node src/cli.ts process:all-db
    Write-Host ""

    Write-Host "[5/7] archive:readiness-snapshot  (0 API calls)" -ForegroundColor White
    npx ts-node src/cli.ts archive:readiness-snapshot
    Write-Host ""

    Write-Host "[6/7] archive:link-results  (0 API calls)" -ForegroundColor White
    npx ts-node src/cli.ts archive:link-results
    Write-Host ""

    Write-Host "[7/7] analytics:refresh-league-gap  (0 API calls)" -ForegroundColor White
    npx ts-node src/cli.ts analytics:refresh-league-gap
    Write-Host ""

    Write-Host "=== DAILY SYNC COMPLETED ===" -ForegroundColor Green
    Write-Host ""
}

function Player-Stats {
    # 21-day cooldown per team, capped at 40 teams/run.
    # Run daily — cooldown + cap self-throttle across ~19 days.
    # Cost: ~40 calls max per run.
    Write-Host ""
    Write-Host "=== PLAYER STATS SYNC ===" -ForegroundColor Cyan
    Write-Host "  Cost: ~40 calls max (21-day cooldown per team, 40 teams/run cap)" -ForegroundColor DarkGray
    Write-Host ""
    npx ts-node src/cli.ts sync:player-stats
    Write-Host ""
    Write-Host "=== PLAYER STATS COMPLETED ===" -ForegroundColor Cyan
    Write-Host ""
}

function Team-Stats {
    # Same pattern as Player-Stats: 21-day cooldown, 40 teams/run cap.
    Write-Host ""
    Write-Host "=== TEAM STATS SYNC ===" -ForegroundColor Magenta
    Write-Host "  Cost: ~40 calls max (21-day cooldown per team, 40 teams/run cap)" -ForegroundColor DarkGray
    Write-Host ""
    npx ts-node src/cli.ts sync:team-stats
    Write-Host ""
    Write-Host "=== TEAM STATS COMPLETED ===" -ForegroundColor Magenta
    Write-Host ""
}

function Weekly-Sync {
    # Run on MONDAY only — these commands re-fetch unconditionally every run.
    # sync:standings = ~42 calls (one per tracked league)
    # sync:week      =  7 calls  (one per day, next 7 days)
    # Running these daily wastes ~49 calls/day for data that changes weekly.
    Write-Host ""
    Write-Host "=== WEEKLY SYNC STARTED (Monday only) ===" -ForegroundColor Yellow
    Write-Host "  Cost: ~49 API calls (standings ~42 + week 7)" -ForegroundColor DarkGray
    Write-Host ""

    Write-Host "[1/2] sync:standings (~42 calls — all tracked leagues)" -ForegroundColor White
    npx ts-node src/cli.ts sync:standings
    Write-Host ""

    Write-Host "[2/2] sync:week (7 calls — fixtures for next 7 days)" -ForegroundColor White
    npx ts-node src/cli.ts sync:week
    Write-Host ""

    Write-Host "=== WEEKLY SYNC COMPLETED ===" -ForegroundColor Yellow
    Write-Host ""
}

function Full-Sync {
    # Everything: Daily + Player + Team + Weekly.
    # Use on first setup or after a long gap — budget: ~171 calls max.
    # Tight but within the 200 limit. Don't run Full-Sync daily.
    Write-Host ""
    Write-Host "=== FULL SYNC STARTED ===" -ForegroundColor Green
    Write-Host "  Budget: ~171 calls max (within 200 limit)" -ForegroundColor DarkGray
    Write-Host ""
    Daily-Sync
    Player-Stats
    Team-Stats
    Weekly-Sync
    Write-Host ""
    Write-Host "=== FULL SYNC COMPLETED ===" -ForegroundColor Green
    Write-Host ""
}

function Monday-Sync {
    # Recommended Monday run: daily + weekly combined.
    Daily-Sync
    Weekly-Sync
}

function Sync-Help {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor White
    Write-Host "  NINETYDATA SYNC — COMMAND REFERENCE                       " -ForegroundColor White
    Write-Host "  Daily budget: 200 calls (2 keys)                          " -ForegroundColor DarkGray
    Write-Host "============================================================" -ForegroundColor White
    Write-Host ""
    Write-Host "  DAILY COMMANDS (run every day):" -ForegroundColor White
    Write-Host "    Daily-Sync    ~42-72 calls  Fixtures + squads + DB processing" -ForegroundColor Green
    Write-Host "    Player-Stats  ~40 calls max  Player season stats (21-day cooldown)" -ForegroundColor Cyan
    Write-Host "    Team-Stats    ~40 calls max  Team season stats   (21-day cooldown)" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  WEEKLY COMMANDS (Monday only):" -ForegroundColor White
    Write-Host "    Weekly-Sync   ~49 calls      Standings + 7-day fixtures" -ForegroundColor Yellow
    Write-Host "    Monday-Sync                  Daily-Sync + Weekly-Sync combined" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  SPECIAL COMMANDS:" -ForegroundColor White
    Write-Host "    Full-Sync     ~171 calls max  Everything (first setup / after long gap)" -ForegroundColor White
    Write-Host "    Go-Backend                    Navigate to backend folder" -ForegroundColor Cyan
    Write-Host "    Sync-Help                     Show this help" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  SQUAD SYNC OPTIONS:" -ForegroundColor White
    Write-Host "    sync:squads:v2       Today only (default, ~10-20 calls)" -ForegroundColor Gray
    Write-Host "    sync:squads:v2 2     Today + tomorrow (~10-30 calls)" -ForegroundColor Gray
    Write-Host "    sync:squads:v2 4     Next 4 days (weekend coverage)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  BUDGET BREAKDOWN:" -ForegroundColor White
    Write-Host "    sync:today/tomorrow   2 calls  (always re-fetches)" -ForegroundColor DarkGray
    Write-Host "    sync:squads:v2 2    ~30 calls  (date-scoped, 7-day cooldown)" -ForegroundColor DarkGray
    Write-Host "    sync:player-stats   ~40 calls  (21-day cooldown, 40/run cap)" -ForegroundColor DarkGray
    Write-Host "    sync:team-stats     ~40 calls  (21-day cooldown, 40/run cap)" -ForegroundColor DarkGray
    Write-Host "    sync:standings      ~42 calls  (all leagues, weekly only)" -ForegroundColor DarkGray
    Write-Host "    sync:week             7 calls  (7 days, weekly only)" -ForegroundColor DarkGray
    Write-Host "    process:all-db        0 calls  (pure DB, free to run anytime)" -ForegroundColor DarkGray
    Write-Host "    archive:*             0 calls  (pure DB, free to run anytime)" -ForegroundColor DarkGray
    Write-Host ""
}
