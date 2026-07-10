# ============================================================
#  NINETYDATA RIP - SYNC FUNCTIONS (beta backend)
#  Daily budget: 200 API calls (2 keys combined)
#
#  !! SHARED QUOTA WARNING !!
#  The server crons (premium68) now run daily against the SAME
#  two API keys: fixtures ~4 (01:00 srv) + squads ~10-30 (03:00)
#  + stats ~80 max (Mon/Wed/Fri 02:00) + weekly ~49 (Mon).
#  Manual syncs from this machine SHARE that budget. DB-only
#  commands (process:*, archive:*, analytics:*) are always free.
#
#  COST GUIDE (approximate, per run):
#    sync:today        =  1 call   (always)
#    sync:tomorrow     =  1 call   (always)
#    sync:squads:v2 2  = ~10-30    (today+tomorrow teams, 7-day cooldown)
#    sync:player-stats = ~40 max   (21-day cooldown, 40 teams/run cap)
#    sync:team-stats   = ~40 max   (21-day cooldown, 40 teams/run cap)
#    sync:standings    = ~42       (all tracked leagues - weekly only)
#    sync:week         =  7        (7 days - weekly only)
#    process:all-db    =  0        (pure DB, no API calls)
#    archive:*         =  0        (pure DB, no API calls)
# ============================================================

function Go-Backend {
    Set-Location C:\wamp64\www\soccer\beta\backend
    Write-Host 'Backend (BETA): C:\wamp64\www\soccer\beta\backend' -ForegroundColor Cyan
}

function Go-Backend-Legacy {
    Set-Location C:\wamp64\www\soccer\backend
    Write-Host 'Backend (LEGACY - rollback reference only, has known truncation bugs)' -ForegroundColor DarkYellow
}

function Daily-Sync {
    Write-Host ''
    Write-Host '=== DAILY SYNC STARTED ===' -ForegroundColor Green
    Write-Host '  Cost: ~12-32 API calls (stats moved to Stats-Sync)' -ForegroundColor DarkGray
    Write-Host '  NOTE: server crons already do this daily - manual runs share quota' -ForegroundColor DarkYellow
    Write-Host ''

    Write-Host '[1/7] sync:today (1 call)' -ForegroundColor White
    npx ts-node src/cli.ts sync:today
    Write-Host ''

    Write-Host '[2/7] sync:tomorrow (1 call)' -ForegroundColor White
    npx ts-node src/cli.ts sync:tomorrow
    Write-Host ''

    Write-Host '[3/7] sync:squads:v2 2 (today + tomorrow teams only)' -ForegroundColor White
    npx ts-node src/cli.ts sync:squads:v2 2
    Write-Host ''

    Write-Host '[4/7] process:all-db (0 API calls - pure DB)' -ForegroundColor White
    npx ts-node src/cli.ts process:all-db
    Write-Host ''

    Write-Host '[5/7] archive:readiness-snapshot (0 API calls)' -ForegroundColor White
    npx ts-node src/cli.ts archive:readiness-snapshot
    Write-Host ''

    Write-Host '[6/7] archive:link-results (0 API calls)' -ForegroundColor White
    npx ts-node src/cli.ts archive:link-results
    Write-Host ''

    Write-Host '[7/7] analytics:refresh-league-gap (0 API calls)' -ForegroundColor White
    npx ts-node src/cli.ts analytics:refresh-league-gap
    Write-Host ''

    Write-Host '=== DAILY SYNC COMPLETED ===' -ForegroundColor Green
    Write-Host ''
}

function Process-Only {
    # Mirrors the server's rip-intel.sh - the free half of Daily-Sync.
    # Run anytime: recomputes all intelligence from what's in the DB.
    Write-Host ''
    Write-Host '=== PROCESS-ONLY (0 API calls) ===' -ForegroundColor Green
    npx ts-node src/cli.ts process:all-db
    npx ts-node src/cli.ts archive:readiness-snapshot
    npx ts-node src/cli.ts archive:link-results
    npx ts-node src/cli.ts analytics:refresh-league-gap
    Write-Host '=== PROCESS-ONLY COMPLETED ===' -ForegroundColor Green
    Write-Host ''
}

function Player-Stats {
    param([int]$Days = 2)
    Write-Host ''
    Write-Host "=== PLAYER STATS SYNC (window: ${Days}d) ===" -ForegroundColor Cyan
    Write-Host '  Cost: ~40 calls max (21-day cooldown, 40 teams/run cap)' -ForegroundColor DarkGray
    Write-Host ''
    npx ts-node src/cli.ts sync:player-stats $Days
    Write-Host ''
    Write-Host '=== PLAYER STATS COMPLETED ===' -ForegroundColor Cyan
    Write-Host ''
}

function Team-Stats {
    param([int]$Days = 2)
    Write-Host ''
    Write-Host "=== TEAM STATS SYNC (window: ${Days}d) ===" -ForegroundColor Magenta
    Write-Host '  Cost: ~40 calls max (21-day cooldown, 40 teams/run cap)' -ForegroundColor DarkGray
    Write-Host ''
    npx ts-node src/cli.ts sync:team-stats $Days
    Write-Host ''
    Write-Host '=== TEAM STATS COMPLETED ===' -ForegroundColor Magenta
    Write-Host ''
}

function Stats-Sync {
    # Server equivalent: rip-stats.sh, Mon/Wed/Fri 02:00 srv.
    # Friday uses -Days 3 - a 2-day window on M/W/F NEVER covers Sunday,
    # the busiest matchday. Same trick applies manually before weekends.
    param([int]$Days = 2)
    Player-Stats -Days $Days
    Team-Stats -Days $Days
}

function Weekly-Sync {
    Write-Host ''
    Write-Host '=== WEEKLY SYNC STARTED (Monday only) ===' -ForegroundColor Yellow
    Write-Host '  Cost: ~49 API calls (standings ~42 + week 7)' -ForegroundColor DarkGray
    Write-Host ''

    Write-Host '[1/2] sync:standings (~42 calls - all tracked leagues)' -ForegroundColor White
    npx ts-node src/cli.ts sync:standings
    Write-Host ''

    Write-Host '[2/2] sync:week (7 calls - fixtures for next 7 days)' -ForegroundColor White
    npx ts-node src/cli.ts sync:week
    Write-Host ''

    Write-Host '=== WEEKLY SYNC COMPLETED ===' -ForegroundColor Yellow
    Write-Host ''
}

function Full-Sync {
    Write-Host ''
    Write-Host '=== FULL SYNC STARTED ===' -ForegroundColor Green
    Write-Host '  Budget: ~171 calls max (within 200 - but remember server crons share it)' -ForegroundColor DarkGray
    Write-Host ''
    Daily-Sync
    Stats-Sync -Days 3
    Weekly-Sync
    Write-Host ''
    Write-Host '=== FULL SYNC COMPLETED ===' -ForegroundColor Green
    Write-Host ''
}

function Monday-Sync {
    Daily-Sync
    Weekly-Sync
}

function Sync-Help {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor White
    Write-Host '  NINETYDATA SYNC - COMMAND REFERENCE (BETA BACKEND)        ' -ForegroundColor White
    Write-Host '  Daily budget: 200 calls (2 keys) - SHARED with server     ' -ForegroundColor DarkGray
    Write-Host '============================================================' -ForegroundColor White
    Write-Host ''
    Write-Host '  SERVER CRONS (premium68, US-Eastern time) already run:' -ForegroundColor White
    Write-Host '    every 2h  form:recent + link-results        0 calls' -ForegroundColor DarkGray
    Write-Host '    01:00     fixtures (today+tomorrow)        ~4 calls' -ForegroundColor DarkGray
    Write-Host '    02:00 MWF stats (Fri window=3 for Sunday) ~80 calls max' -ForegroundColor DarkGray
    Write-Host '    03:00     squads:v2 2                    ~10-30 calls' -ForegroundColor DarkGray
    Write-Host '    04:00     process:all-db + archives + gap   0 calls' -ForegroundColor DarkGray
    Write-Host '    Mon 04:30 standings + week                ~49 calls' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host '  MANUAL COMMANDS (this machine):' -ForegroundColor White
    Write-Host '    Process-Only        0 calls   Recompute intelligence anytime (safe)' -ForegroundColor Green
    Write-Host '    Daily-Sync    ~12-32 calls   Fixtures + squads + full DB processing' -ForegroundColor Green
    Write-Host '    Stats-Sync       ~80 max     Player + team stats (-Days 3 pre-weekend)' -ForegroundColor Cyan
    Write-Host '    Weekly-Sync      ~49 calls   Standings + 7-day fixtures (Monday)' -ForegroundColor Yellow
    Write-Host '    Full-Sync       ~171 max     Everything (first setup / long gap)' -ForegroundColor White
    Write-Host '    Go-Backend                   Beta backend folder (the live code)' -ForegroundColor Cyan
    Write-Host '    Go-Backend-Legacy            Old backend (rollback reference only)' -ForegroundColor DarkYellow
    Write-Host '    Sync-Help                    Show this help' -ForegroundColor Gray
    Write-Host ''
    Write-Host '  SQUAD SYNC OPTIONS:' -ForegroundColor White
    Write-Host '    sync:squads:v2       Today only (default, ~10-20 calls)' -ForegroundColor Gray
    Write-Host '    sync:squads:v2 2     Today + tomorrow (~10-30 calls)' -ForegroundColor Gray
    Write-Host '    sync:squads:v2 4     Next 4 days (weekend coverage)' -ForegroundColor Gray
    Write-Host ''
}
