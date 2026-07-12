# PitchTerminal Transformation — Batch 1 Integration Spec

Delivers the three-phase plan as confirmed: (1) Historical Context Engine,
(2) form-quality intelligence on top of it, (3) the betting layer — risk
engine, opportunity/executive brief, calibrated market signals, backtest
harness — plus the Terminal dashboard and match-page components.

**Legacy engine untouched.** Nothing modifies readiness, NBSI, or any
existing table's writers. The new layer only reads them. All existing
pages keep working; `/rip` analytics remain the Advanced/Legacy layer.

## Contents

| File | What it is |
|---|---|
| `migrations/028_historical_context_engine.sql` | `team_match_snapshots`, `match_opponent_context`, `team_form_quality` |
| `migrations/029_risk_opportunity_backtest.sql` | `match_risk_intelligence`, `match_opportunity`, `signal_backtests`, `match_signals.rule_key` |
| `backend/src/jobs/processHistoricalContext.ts` | Replay engine: pre-kickoff table state + opponent quality per match |
| `backend/src/jobs/processFormQuality.ts` | OAF, SoS, tier splits, giant-killer/flat-track, xPts, volatility |
| `backend/src/jobs/backtestSignals.ts` | Rule registry + calibration harness (the credibility layer) |
| `backend/src/jobs/processRiskOpportunity.ts` | Risk score, opportunity score, executive brief, signal writer |
| `frontend/src/app/terminal/page.tsx` | Betting Dashboard — opportunity-ranked cards |
| `frontend/src/components/terminal/ExecutiveBrief.tsx` | Match-page brief header |
| `frontend/src/components/terminal/MarketSignalPanel.tsx` | Per-market signals with receipts |

## Order of operations

1. Run **028** then **029** in Supabase SQL editor. Both additive/idempotent.
2. Backend one-time backfill, in this exact order (each depends on the last):
   ```
   node dist/cli.js process:historical-context:backfill
   node dist/cli.js process:form-quality
   node dist/cli.js backtest:signals
   node dist/cli.js process:risk-opportunity
   ```
3. Check the verification queries at the bottom of 028 and 029.
4. Add the cron lines (below) to `rip-daily-v2.sh`.
5. Frontend: deploy the three files; add nav entry (below).

## CLI patch — `beta/backend/src/cli.ts`

Imports (with the other job imports at the top):

```ts
import { processHistoricalContextBackfill, processHistoricalContextRecent } from './jobs/processHistoricalContext';
import { processFormQuality } from './jobs/processFormQuality';
import { backtestSignals } from './jobs/backtestSignals';
import { processRiskOpportunity } from './jobs/processRiskOpportunity';
```

Case blocks (anywhere in the switch; suggested: after `analytics:refresh-league-gap`):

```ts
      case 'process:historical-context:backfill': {
        // One-time (or repair) full replay: reconstructs the league table as
        // it stood before EVERY finished match, per (tournament, season), and
        // writes pre-kickoff snapshots + opponent context. No future leakage
        // by construction. Idempotent — safe to re-run after data repairs.
        logger.info('Backfilling historical context (full replay)...');
        const r = await processHistoricalContextBackfill();
        logger.info(r, 'Historical context backfill complete');
        break;
      }

      case 'process:historical-context': {
        // Incremental: replays only tournament groups touched in the window
        // (default 3 days), writes window + upcoming rows. Also captures live
        // strength_rating_before for matches near kickoff — the only moment
        // that value can honestly be recorded.
        const days = args[0] ? parseInt(args[0], 10) : 3;
        logger.info({ days }, 'Processing recent historical context...');
        const r = await processHistoricalContextRecent(days);
        logger.info(r, 'Historical context complete');
        break;
      }

      case 'process:form-quality': {
        // Opponent-adjusted form, strength of schedule, tier splits,
        // giant-killer/flat-track, expected-vs-actual points, volatility.
        // Depends on historical context. DB-only.
        logger.info('Processing form quality...');
        const r = await processFormQuality();
        logger.info(r, 'Form quality complete');
        break;
      }

      case 'backtest:signals': {
        // Replays the shared rule registry over all finished matches using
        // ONLY pre-kickoff features; stores hit rate vs base rate per rule.
        // The signal writer refuses to publish uncalibrated rules.
        logger.info('Backtesting signal rules...');
        const r = await backtestSignals();
        logger.info(r, 'Signal backtest complete');
        break;
      }

      case 'process:risk-opportunity': {
        // Risk engine + opportunity score + executive brief + calibrated
        // market signals for upcoming matches (PT_HORIZON_DAYS, default 7).
        // Writes only its own signal_group ('pitchterminal').
        logger.info('Processing risk/opportunity layer...');
        const r = await processRiskOpportunity();
        logger.info(r, 'Risk/opportunity complete');
        break;
      }
```

## Cron patch — `beta/scripts/rip-daily-v2.sh`

Append to TIER 3, after `analytics:refresh-league-gap` (order matters —
context before form quality before signals):

```sh
  run best-effort process:historical-context 3
  run best-effort process:form-quality
  run best-effort process:risk-opportunity
```

`backtest:signals` is NOT daily. Weekly is plenty (rules and history move
slowly) — add to `rip-weekly.sh`:

```sh
  run best-effort backtest:signals
```

## The calibration gate (read before touching thresholds)

`match_signals` rows in group `pitchterminal` exist only for rules where
`signal_backtests.is_calibrated = true`: **sample ≥ 200 fired instances AND
lift ≥ 1.05 over the market's base rate across the whole population.**
Env-tunable: `PT_MIN_SAMPLE`, `PT_MIN_LIFT`. Dev override:
`PT_PUBLISH_UNCALIBRATED=1` (rows get a visible `[UNCALIBRATED]` prefix).

Expect most rules to be gated at first — that is the system working, not
failing. The dashboard and signal panel are designed for sparse signals:
"No calibrated signal" is a rendered, honest state. As history accumulates
(and the readiness archive already has months of linked results), rules
cross the sample threshold on their own. Resist lowering the gate to make
the UI look busier; the product's entire trust story is that every
published claim carries its measured record.

The registry lives in `backtestSignals.ts` (`SIGNAL_RULES`) and is imported
by the live writer — **the rule being backtested is byte-identical to the
rule being published.** Add new rules there and only there.

Known v1 seam: the two trend rules (OVER25/UNDER25/BTTS_TREND) backtest
fine but don't fire live yet — the live feature builder passes `null` for
prior-5 trend features rather than approximating them with non-identical
aggregates. Wiring the same `prior5()` computation into the live path is a
small follow-up; it was left out rather than shipped inconsistent.

## Frontend integration

1. Nav: add `{ href: '/terminal', label: 'Terminal' }` to NavBar/Sidebar/
   MobileNav — suggested as the FIRST entry (it's the new primary surface).
2. Match page, above the existing hero/readiness content:

```tsx
import ExecutiveBrief from '@/components/terminal/ExecutiveBrief';
import MarketSignalPanel from '@/components/terminal/MarketSignalPanel';

const [{ data: opp }, { data: risk }, { data: ptSignals }] = await Promise.all([
  supabase.from('match_opportunity').select('*').eq('match_id', matchId).maybeSingle(),
  supabase.from('match_risk_intelligence').select('*').eq('match_id', matchId).maybeSingle(),
  supabase.from('match_signals').select('*').eq('match_id', matchId).eq('signal_group', 'pitchterminal'),
]);

{opp && <ExecutiveBrief opp={opp} risk={risk} />}
{opp && <MarketSignalPanel signals={ptSignals ?? []} />}
```

3. RLS: the three new read tables (`match_risk_intelligence`,
   `match_opportunity`, `signal_backtests`) need the same anon-read policy
   as the rest (see `SUPABASE_RLS_SETUP.sql` pattern). Snapshots/context
   tables are backend-only; no anon policy needed unless a page reads them.

This supersedes the open "Match Risk column" question from the UI audit:
the risk engine's band + score replaces the placeholder column outright.

## Deliberately deferred (next batches)

- **Attack style profiles / PQI sub-scores** — inputs land via 026's stat
  expansion; the processor is a clean follow-up once a sync cycle has
  populated the new columns.
- **Cards/corners/handicap markets** — need 026 data (cards/corners) and an
  odds source (handicap). No rule ships without a backtestable outcome.
- **Player matchup intelligence** — builds on Key Player Battle + 027.
- **Live trend features** for the three trend rules (seam noted above).
- **Rebrand mechanics** — pitchterminal.com registration, basePath change,
  and legacy `/rip` redirect strategy are a deployment decision, not code.

## Verification after first full run

```sql
-- Snapshot coverage (expect 0)
SELECT count(*) FROM match_results r
  JOIN matches m ON m.id = r.match_id
  LEFT JOIN team_match_snapshots s ON s.match_id = m.id
 WHERE r.home_score IS NOT NULL AND s.id IS NULL;

-- Calibration board
SELECT rule_key, market, sample_size, round(hit_rate*100,1) hit_pct,
       round(baseline_rate*100,1) base_pct, round(lift,3) lift, is_calibrated
  FROM signal_backtests ORDER BY lift DESC;

-- No uncalibrated signals leaked (expect 0 without the dev override)
SELECT count(*) FROM match_signals s
 WHERE s.signal_group='pitchterminal'
   AND NOT EXISTS (SELECT 1 FROM signal_backtests b
                    WHERE b.rule_key=s.rule_key AND b.is_calibrated);

-- Every upcoming match in horizon has a brief
SELECT count(*) FROM matches m
  JOIN match_intelligence mi ON mi.match_id=m.id
  LEFT JOIN match_opportunity o ON o.match_id=m.id
 WHERE m.date BETWEEN now() AND now()+interval '7 days'
   AND m.status='scheduled' AND o.id IS NULL;   -- expect 0 after process run
```
