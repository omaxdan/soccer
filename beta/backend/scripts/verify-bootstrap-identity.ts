// ─────────────────────────────────────────────────────────────────────────────
// verify-bootstrap-identity.ts — FINAL LIVE BOOTSTRAP IDENTITY CHECK (READ-ONLY)
//
// Run on the operator machine, where the pt_pipeline_ingestion database exists:
//     npx tsx scripts/verify-bootstrap-identity.ts
//
// Proves the live database state matches the already-verified planner model BEFORE any
// paid provider quota is spent. It is strictly read-only:
//   • uses currentBudget + admit (PREVIEW) — NEVER admitAndReserve;
//   • issues only SELECTs (the bootstrap reader, the squad and standings queries);
//   • makes NO provider call, NO INSERT/UPDATE/DELETE, NO schema/env change;
//   • prints no secrets.
// It prints PASS/FAIL for all 15 gate conditions and a final READY / BLOCKED verdict.
// It executes NO enrichment and reserves nothing — the paid bootstrap is a later step.
// ─────────────────────────────────────────────────────────────────────────────

import '../src/v2/config/env'; // load env (DB config) FIRST, matching every V2 entry point
import { withConnection } from '../src/v2/db/tx';
import { readBootstrapEnrichmentDemand, planBootstrapBatches } from '../src/v2/ingestion/enrichment/enrichmentPlanner';
import { currentBudget, admit } from '../src/v2/ingestion/enrichment/budgetGovernor';

const AUTHORIZED_EDITIONS = ['18', '143', '147', '148'] as const;
const ENRICHMENT_ESTIMATE = 582;

// Deduplicated squad demand across ALL authorized editions (DISTINCT team_id → no fan-out).
const SQUAD_SQL = `
  WITH ed(edition_id) AS (VALUES (18),(143),(147),(148)),
  teams AS (
    SELECT DISTINCT v.team_id
      FROM football.fixture f
      JOIN ed ON ed.edition_id = f.competition_edition_id
      CROSS JOIN LATERAL (VALUES (f.home_team_id),(f.away_team_id)) v(team_id))
  SELECT
    count(*)::int AS distinct_authorized_teams,
    count(*) FILTER (WHERE     EXISTS (SELECT 1 FROM football.player_registration r WHERE r.team_id = teams.team_id))::int AS teams_with_registration,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM football.player_registration r WHERE r.team_id = teams.team_id))::int AS teams_requiring_squad
  FROM teams`;

// Standings existence per authorized edition (append-only convention: fresh-current = one per edition).
const STANDINGS_SQL = `
  WITH ed(edition_id) AS (VALUES (18),(143),(147),(148))
  SELECT
    count(*)::int AS authorized_editions,
    count(*) FILTER (WHERE     EXISTS (SELECT 1 FROM football.standing s WHERE s.competition_edition_id = ed.edition_id))::int AS with_snapshot,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM football.standing s WHERE s.competition_edition_id = ed.edition_id))::int AS missing_snapshot
  FROM ed`;

interface SquadRow { distinct_authorized_teams: number; teams_with_registration: number; teams_requiring_squad: number }
interface StandingsRow { authorized_editions: number; with_snapshot: number; missing_snapshot: number }

async function main(): Promise<void> {
  await withConnection('pt_pipeline_ingestion', async (tx) => {
    const asOf = new Date();

    // 1. LIVE bootstrap demand (SELECT-only)
    const demand = await readBootstrapEnrichmentDemand(tx, [...AUTHORIZED_EDITIONS], { asOf, batchSize: 25 });
    const per = new Map(demand.perEdition.map((e) => [e.editionId, e.enrichmentCalls]));

    // 2. LIVE budget (actualUsedToday from operations.api_usage; committed/retry pinned to 0 for the preview)
    const budget = await currentBudget(tx, { asOf, committed: 0, retryReserve: 0 });

    // 3. Admission PREVIEW for the 582 enrichment calls (never admitAndReserve)
    const decision = admit(ENRICHMENT_ESTIMATE, budget);

    // 4. Global deduplicated squad demand
    const squad = (await tx.query<SquadRow>(SQUAD_SQL)).rows[0];

    // 5. Standings existence
    const standings = (await tx.query<StandingsRow>(STANDINGS_SQL)).rows[0];

    // 6. Batch reconciliation (pure)
    const batches = planBootstrapBatches(demand.fixtures, 25);
    const batchSum = batches.reduce((s, b) => s + b.estimatedCalls, 0);

    // ── report ────────────────────────────────────────────────────────────────
    console.log('── LIVE DEMAND ──');
    console.log({
      selected: demand.selectedFixtureIds.length, estimatedCalls: demand.estimatedCalls,
      missingBoth: demand.missingBoth, missingLineupOnly: demand.missingLineupOnly, missingStatsOnly: demand.missingStatsOnly,
    });
    console.table(demand.perEdition);
    console.log('── LIVE BUDGET ──');
    console.log({
      dailyQuota: budget.dailyQuota, actualUsedToday: budget.actualUsedToday, committed: budget.committed,
      retryReserve: budget.retryReserve, available: budget.available, availableAfter582: budget.available - ENRICHMENT_ESTIMATE,
      admit582: decision.code,
    });
    console.log('── SQUAD ──', squad);
    console.log('── STANDINGS ──', standings,
      `\n   fresh-current policy → 4 calls ; only-if-absent policy → ${standings.missing_snapshot} calls`);
    console.log('── BATCHES ──', { count: batches.length, sumEstimatedCalls: batchSum });
    console.table(batches.map((b) => ({
      batchIndex: b.batchIndex, fixtureCount: b.fixtureCount, lineupCalls: b.lineupCalls,
      statCalls: b.statCalls, estimatedCalls: b.estimatedCalls,
    })));

    const checks: ReadonlyArray<readonly [string, boolean]> = [
      ['1  selectedFixtureIds.length === 291', demand.selectedFixtureIds.length === 291],
      ['2  estimatedCalls === 582', demand.estimatedCalls === 582],
      ['3  missingBoth === 291', demand.missingBoth === 291],
      ['4  missingLineupOnly === 0', demand.missingLineupOnly === 0],
      ['5  missingStatsOnly === 0', demand.missingStatsOnly === 0],
      ['6  edition 18 === 426', per.get('18') === 426],
      ['7  edition 143 === 60', per.get('143') === 60],
      ['8  edition 147 === 60', per.get('147') === 60],
      ['9  edition 148 === 36', per.get('148') === 36],
      ['10 squad requiring === 67', squad.teams_requiring_squad === 67],
      ['11 dailyQuota === 7600', budget.dailyQuota === 7600],
      ['12 actualUsedToday is a finite live number', Number.isFinite(budget.actualUsedToday)],
      ['13 admit(582) === ADMITTED', decision.code === 'ADMITTED'],
      ['14 batch count === 12', batches.length === 12],
      ['15 batch sum === 582', batchSum === 582],
    ];
    console.log('── GATE CONDITIONS ──');
    for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);

    const ready = checks.every(([, ok]) => ok);
    console.log(`\n=== ${ready ? 'READY FOR CONTROLLED PAID BOOTSTRAP' : 'BLOCKED'} ===`);
    if (!ready) console.log('Failed:', checks.filter(([, ok]) => !ok).map(([l]) => l.trim()).join('  |  '));
  });
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('BLOCKED — identity check could not run:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
