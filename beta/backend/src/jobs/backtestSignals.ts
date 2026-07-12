import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';

/**
 * SIGNAL BACKTEST HARNESS  (migration 029, signal_backtests)
 *
 * The credibility layer. Every directional rule the platform might publish
 * is replayed over historical matches using ONLY features that existed
 * before kickoff (team_match_snapshots, match_opponent_context,
 * readiness_history, prior team_form_history rows). For each rule we store:
 *
 *   hit_rate       — how often the rule's market landed when it fired
 *   baseline_rate  — how often that market lands across the WHOLE evaluated
 *                    population (the honest denominator for lift)
 *   lift           — hit_rate / baseline_rate
 *   is_calibrated  — sample ≥ PT_MIN_SAMPLE and lift ≥ PT_MIN_LIFT
 *
 * processRiskOpportunity's signal writer REFUSES to publish any rule that
 * is not calibrated here (PT_PUBLISH_UNCALIBRATED=1 overrides for dev).
 * "The market may be wrong" is only a claim this platform gets to make
 * about rules it has measured.
 *
 * Anti-leakage invariants:
 *   - snapshot features are pre-kickoff by construction (replay engine)
 *   - form-trend features use only rows strictly BEFORE the match date
 *   - no rule may read match_results except through the outcome evaluator
 *
 * Depends on: process:historical-context. DB-only. Idempotent.
 */

const MIN_SAMPLE = Number(process.env.PT_MIN_SAMPLE ?? 200);
const MIN_LIFT = Number(process.env.PT_MIN_LIFT ?? 1.05);
const MIN_GAMES_FOR_POSITION_RULES = 6;

export type Market = 'HOME_WIN' | 'AWAY_WIN' | 'DRAW' | 'OVER_2_5' | 'UNDER_2_5' | 'BTTS';

/** Everything a rule is allowed to see. All pre-kickoff. */
export interface PreMatchFeatures {
  readinessGap: number | null;          // home − away, from readiness_history
  homePos: number | null;  awayPos: number | null;
  homeGames: number;       awayGames: number;
  homeLast5: number | null; awayLast5: number | null;   // points
  homeOver25InLast5: number | null;     // count of prior-5 matches with total ≥3
  awayOver25InLast5: number | null;
  homeBttsInLast5: number | null;
  awayBttsInLast5: number | null;
  homePriorMatches: number;             // how many prior form rows existed
  awayPriorMatches: number;
}

export interface SignalRule {
  key: string;
  market: Market;
  /** Human sentence used verbatim as the published signal's drivers text. */
  rationale: string;
  fires: (f: PreMatchFeatures) => boolean;
}

/**
 * RULE REGISTRY v1 — shared with the live signal writer so the thing being
 * backtested is byte-identical to the thing being published.
 */
export const SIGNAL_RULES: SignalRule[] = [
  {
    key: 'READY_GAP10_HOME', market: 'HOME_WIN',
    rationale: 'Home side enters with a readiness advantage of 10+ points',
    fires: f => f.readinessGap != null && f.readinessGap >= 10,
  },
  {
    key: 'READY_GAP10_AWAY', market: 'AWAY_WIN',
    rationale: 'Away side enters with a readiness advantage of 10+ points',
    fires: f => f.readinessGap != null && f.readinessGap <= -10,
  },
  {
    key: 'READY_GAP15_HOME', market: 'HOME_WIN',
    rationale: 'Home side enters with a readiness advantage of 15+ points',
    fires: f => f.readinessGap != null && f.readinessGap >= 15,
  },
  {
    key: 'READY_GAP15_AWAY', market: 'AWAY_WIN',
    rationale: 'Away side enters with a readiness advantage of 15+ points',
    fires: f => f.readinessGap != null && f.readinessGap <= -15,
  },
  {
    key: 'POSGAP8_HOME', market: 'HOME_WIN',
    rationale: 'Home side sat 8+ league places above the opponent at kickoff',
    fires: f => f.homePos != null && f.awayPos != null &&
      f.homeGames >= MIN_GAMES_FOR_POSITION_RULES && f.awayGames >= MIN_GAMES_FOR_POSITION_RULES &&
      (f.awayPos - f.homePos) >= 8,
  },
  {
    key: 'POSGAP8_AWAY', market: 'AWAY_WIN',
    rationale: 'Away side sat 8+ league places above the opponent at kickoff',
    fires: f => f.homePos != null && f.awayPos != null &&
      f.homeGames >= MIN_GAMES_FOR_POSITION_RULES && f.awayGames >= MIN_GAMES_FOR_POSITION_RULES &&
      (f.homePos - f.awayPos) >= 8,
  },
  {
    key: 'FORM5_DIFF9_HOME', market: 'HOME_WIN',
    rationale: 'Home side out-pointed the opponent by 9+ over the last five',
    fires: f => f.homeLast5 != null && f.awayLast5 != null &&
      (f.homeLast5 - f.awayLast5) >= 9,
  },
  {
    key: 'FORM5_DIFF9_AWAY', market: 'AWAY_WIN',
    rationale: 'Away side out-pointed the opponent by 9+ over the last five',
    fires: f => f.homeLast5 != null && f.awayLast5 != null &&
      (f.awayLast5 - f.homeLast5) >= 9,
  },
  {
    key: 'OVER25_TREND_BOTH', market: 'OVER_2_5',
    rationale: 'Both teams cleared 2.5 total goals in 4+ of their last five',
    fires: f => (f.homeOver25InLast5 ?? 0) >= 4 && (f.awayOver25InLast5 ?? 0) >= 4 &&
      f.homePriorMatches >= 5 && f.awayPriorMatches >= 5,
  },
  {
    key: 'UNDER25_TREND_BOTH', market: 'UNDER_2_5',
    rationale: 'Both teams stayed under 2.5 total goals in 4+ of their last five',
    fires: f => f.homePriorMatches >= 5 && f.awayPriorMatches >= 5 &&
      (5 - (f.homeOver25InLast5 ?? 5)) >= 4 && (5 - (f.awayOver25InLast5 ?? 5)) >= 4,
  },
  {
    key: 'BTTS_TREND_BOTH', market: 'BTTS',
    rationale: 'Both teams saw BTTS land in 4+ of their last five',
    fires: f => (f.homeBttsInLast5 ?? 0) >= 4 && (f.awayBttsInLast5 ?? 0) >= 4 &&
      f.homePriorMatches >= 5 && f.awayPriorMatches >= 5,
  },
];

function marketLanded(market: Market, hs: number, as: number): boolean {
  switch (market) {
    case 'HOME_WIN':  return hs > as;
    case 'AWAY_WIN':  return as > hs;
    case 'DRAW':      return hs === as;
    case 'OVER_2_5':  return hs + as >= 3;
    case 'UNDER_2_5': return hs + as <= 2;
    case 'BTTS':      return hs > 0 && as > 0;
  }
}

interface FormPoint { ts: number; total: number; btts: boolean; }

/** Prior-5 window strictly before matchTs (arrays sorted asc). */
function prior5(list: FormPoint[] | undefined, matchTs: number) {
  if (!list || list.length === 0) return { over: null as number | null, btts: null as number | null, n: 0 };
  let lo = 0, hi = list.length - 1, last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts < matchTs) { last = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (last === -1) return { over: null, btts: null, n: 0 };
  const win = list.slice(Math.max(0, last - 4), last + 1);
  return {
    over: win.filter(p => p.total >= 3).length,
    btts: win.filter(p => p.btts).length,
    n: last + 1,
  };
}

export async function backtestSignals() {
  logger.info({ minSample: MIN_SAMPLE, minLift: MIN_LIFT }, 'Backtest: loading population');

  const matches = await fetchAllRows<any>(
    db.from('matches').select('id, home_team_id, away_team_id, date')
  );
  const matchById = new Map(matches.map((m: any) => [m.id, m]));

  const results = await fetchAllRows<any>(
    db.from('match_results')
      .select('match_id, home_score, away_score, status')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
  );

  const snapshots = await fetchAllRows<any>(
    db.from('team_match_snapshots')
      .select('match_id, team_id, is_home, league_position_before, games_played_before, points_last5_before')
  );
  const snapByKey = new Map(snapshots.map((s: any) => [`${s.match_id}:${s.team_id}`, s]));

  const readiness = await fetchAllRows<any>(
    db.from('readiness_history').select('match_id, home_readiness, away_readiness')
  );
  const readyByMatch = new Map(readiness.map((r: any) => [r.match_id, r]));

  const formRows = await fetchAllRows<any>(
    db.from('team_form_history')
      .select('team_id, match_date, goals_for, goals_against, btts')
      .not('match_date', 'is', null)
  );
  const formByTeam = new Map<number, FormPoint[]>();
  for (const f of formRows) {
    const list = formByTeam.get(f.team_id) ?? [];
    list.push({
      ts: new Date(f.match_date).getTime(),
      total: Number(f.goals_for ?? 0) + Number(f.goals_against ?? 0),
      btts: f.btts === true,
    });
    formByTeam.set(f.team_id, list);
  }
  for (const list of formByTeam.values()) list.sort((a, b) => a.ts - b.ts);

  // ── Build features per finished match ─────────────────────────────────────
  type Sample = { features: PreMatchFeatures; hs: number; as: number };
  const population: Sample[] = [];

  for (const r of results) {
    const m = matchById.get(r.match_id);
    if (!m) continue;
    const matchTs = new Date(m.date).getTime();
    const hSnap = snapByKey.get(`${m.id}:${m.home_team_id}`);
    const aSnap = snapByKey.get(`${m.id}:${m.away_team_id}`);
    const ready = readyByMatch.get(m.id);
    const hP5 = prior5(formByTeam.get(m.home_team_id), matchTs);
    const aP5 = prior5(formByTeam.get(m.away_team_id), matchTs);

    population.push({
      hs: Number(r.home_score), as: Number(r.away_score),
      features: {
        readinessGap: ready != null
          ? Number(ready.home_readiness) - Number(ready.away_readiness)
          : null,
        homePos: hSnap?.league_position_before ?? null,
        awayPos: aSnap?.league_position_before ?? null,
        homeGames: hSnap?.games_played_before ?? 0,
        awayGames: aSnap?.games_played_before ?? 0,
        homeLast5: hSnap?.points_last5_before ?? null,
        awayLast5: aSnap?.points_last5_before ?? null,
        homeOver25InLast5: hP5.over, awayOver25InLast5: aP5.over,
        homeBttsInLast5: hP5.btts,   awayBttsInLast5: aP5.btts,
        homePriorMatches: hP5.n,     awayPriorMatches: aP5.n,
      },
    });
  }

  logger.info({ population: population.length }, 'Backtest: evaluating rules');

  // ── Baselines per market over the full population ─────────────────────────
  const baselineFor = (market: Market) => {
    let landed = 0;
    for (const s of population) if (marketLanded(market, s.hs, s.as)) landed++;
    return population.length > 0 ? landed / population.length : 0;
  };
  const baselines = new Map<Market, number>();
  for (const market of ['HOME_WIN','AWAY_WIN','DRAW','OVER_2_5','UNDER_2_5','BTTS'] as Market[]) {
    baselines.set(market, baselineFor(market));
  }

  // ── Evaluate each rule ─────────────────────────────────────────────────────
  const rows: any[] = [];
  const nowIso = new Date().toISOString();
  for (const rule of SIGNAL_RULES) {
    let fired = 0, hits = 0;
    for (const s of population) {
      if (!rule.fires(s.features)) continue;
      fired++;
      if (marketLanded(rule.market, s.hs, s.as)) hits++;
    }
    const hitRate = fired > 0 ? hits / fired : 0;
    const base = baselines.get(rule.market) ?? 0;
    const lift = base > 0 ? hitRate / base : 0;
    const calibrated = fired >= MIN_SAMPLE && lift >= MIN_LIFT;

    rows.push({
      rule_key: rule.key,
      market: rule.market,
      sample_size: fired,
      hits,
      hit_rate: Math.round(hitRate * 10000) / 10000,
      baseline_rate: Math.round(base * 10000) / 10000,
      lift: Math.round(lift * 1000) / 1000,
      is_calibrated: calibrated,
      window_days: null,
      notes: calibrated ? null
        : fired < MIN_SAMPLE ? `sample ${fired} < ${MIN_SAMPLE}`
        : `lift ${lift.toFixed(3)} < ${MIN_LIFT}`,
      evaluated_at: nowIso,
    });
    logger.info(
      { rule: rule.key, market: rule.market, fired, hitRate: hitRate.toFixed(3), base: base.toFixed(3), lift: lift.toFixed(3), calibrated },
      'Backtest: rule evaluated'
    );
  }

  const { error } = await db.from('signal_backtests')
    .upsert(rows, { onConflict: 'rule_key,market' });
  if (error) throw new Error(`signal_backtests upsert failed: ${error.message}`);

  const calibratedCount = rows.filter(r => r.is_calibrated).length;
  logger.info({ rules: rows.length, calibrated: calibratedCount }, 'Backtest: complete');
  return { rules: rows.length, calibrated: calibratedCount, population: population.length };
}
