import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';
import {
  bandFor, derivePick, outcomeOf, computeConfidenceScore,
  BAND_ORDER, ARCHIVABLE_COMPONENTS, ARCHIVABLE_WEIGHT, TOTAL_WEIGHT,
  scoreHistoricalRows, summariseHistoricalRows, strictRate,
  type ConfidenceBand, type Pick, type ComponentKey,
} from '../lib/confidenceBand';

/**
 * CONFIDENCE BAND BACKTEST  (signal_backtests, rule_key = CBAND_*)
 *
 * WHY
 * ---
 * The published band table (Elite 95.7 / Strong 97.9 / Moderate 78.4 /
 * Risky 46.2 / Avoid 29.4 over 1,893 matches) was produced by joining
 * match_intelligence.confidence_band against finished results. That band comes
 * from readiness, which comes from team_intelligence.form_index - one row per
 * team, no snapshot_date. A match from three months ago is therefore scored
 * using form that already contains that match's result. Inflation concentrates
 * where the gap is widest, which is why the low bands read plausibly and the
 * top ones do not, and why Strong outranks Elite.
 *
 * THREE MODES
 * -----------
 *   RECONSTRUCTED - the headline. Rebuilds the score per match from tables
 *                   that carry genuine pre-kickoff values:
 *                     readiness  <- team_match_snapshots.readiness_before
 *                     injury     <- team_intelligence_history.injury_burden_score
 *                     congestion <- team_intelligence_history.congestion_score
 *                     stability  <- team_intelligence_history.squad_stability_score
 *                     travel     <- team_intelligence_history.travel_fatigue_score
 *                   That is 70 of 100 weight and 5 components, clearing
 *                   processDbOnly's >= 4 gate. Strength (20), venue (7) and
 *                   motivation (3) have no historical source anywhere and are
 *                   renormalised out - exactly what the live blend does when a
 *                   component is missing. Only this mode is persisted.
 *
 *   FROZEN        - readiness_history.confidence_pct, written before kickoff by
 *                   archiveReadinessSnapshot. Smaller population but it is the
 *                   real live score at full 8-component fidelity. Used to
 *                   VALIDATE the reconstruction: on matches present in both,
 *                   the two should broadly agree. If they do not, the
 *                   reconstruction is wrong and its numbers are worthless.
 *
 *   CURRENT       - deliberately reproduces the leaky methodology. Logged for
 *                   the delta, never written. Persisting it would let a leaked
 *                   number reach the signal writer's calibration gate, which is
 *                   the exact failure this layer exists to prevent.
 *
 * ANTI-LEAKAGE INVARIANTS
 *   - team_intelligence_history rows must have snapshot_date STRICTLY BEFORE
 *     the match date. snapshot_date is a DATE, so a same-day row cannot be
 *     proven pre-kickoff and is rejected rather than assumed.
 *   - snapshots older than STALE_DAYS are rejected, not carried forward.
 *   - readiness_history rows must satisfy snapshot_at < match_date.
 *   - no mode reads match_results except through the outcome evaluator.
 *
 * THE RECONSTRUCTION CANNOT OUTGROW THE ARCHIVE — verified, do not retry
 * ─────────────────────────────────────────────────────────────────────────
 * team_match_snapshots.readiness_before is populated from readiness_history
 * and is NULL wherever no archive row exists (processHistoricalContext.ts:524).
 * That is correct: the replay can rebuild league position, points and form
 * from results, but readiness needs the injury, congestion and travel state as
 * it stood that day, and nothing recorded it. The replay declines to invent it.
 *
 * The consequence is structural. A full backfill was run — 160 groups, 1,999
 * matches replayed, 4,436 snapshots written — and no_readiness stayed at
 * exactly 1,587. The reconstruction is bounded by the same archive FROZEN
 * reads from, so its whole justification (a larger population) cannot be
 * realised: 329 against frozen's 325.
 *
 * Running the backfill again will not move it. The honest sample grows only
 * forward, through archive:readiness. Frozen is the source; the reconstruction
 * is a fidelity cross-check and nothing more.
 *
 * Depends on: process:historical-context, archive:readiness.
 * DB-only. Idempotent.
 */

const MIN_SAMPLE = Number(process.env.PT_MIN_SAMPLE ?? 200);
const MIN_LIFT = Number(process.env.PT_MIN_LIFT ?? 1.05);
/**
 * Both bands in a pair must reach this before their ordering is testable.
 * Below it, an out-of-order pair says nothing about the score.
 */
const MIN_MONOTONIC_SAMPLE = Number(process.env.PT_MIN_MONOTONIC_SAMPLE ?? 30);

/** How stale a team_intelligence_history row may be and still be used. */
const STALE_DAYS = Number(process.env.PT_BAND_STALE_DAYS ?? 14);

const BAND_MARKET = 'PICK_STRICT';
const DAY_MS = 86_400_000;

type Mode = 'RECONSTRUCTED' | 'FROZEN' | 'CURRENT';

interface Scored {
  matchId: number;
  band: ConfidenceBand;
  score: number;
  pick: Pick;
  outcome: Pick;
  strict: boolean;
  lenient: boolean;
  componentsWithData?: number;
}

interface BandStat {
  band: ConfidenceBand;
  n: number;
  hits: number;
  rate: number;
  rateLenient: number;
  ciLow: number;
  ciHigh: number;
  baseline: number;
  lift: number;
  calibrated: boolean;
}

/**
 * Adapter over the shared engine, not a second implementation of it.
 *
 * summariseHistoricalRows() returns GroupStat[] keyed by a generic string and
 * exposing liftPct (the percentage form) alongside liftRatio (internal only,
 * never persisted per the product decision that lift_over_baseline's public
 * meaning must not change). This file's BandStat shape and every downstream
 * consumer of it (agreement checks, monotonic-pair checks, the signal_backtests
 * persist step) is UNCHANGED — signal_backtests.lift has always stored the
 * ratio and has no frontend consumer today (confirmed before this migration),
 * so there was no reason to touch its contract. Only the computation this
 * function used to duplicate — grouping, Wilson interval, lift, the
 * calibration gate — now runs once, shared with the league aggregation.
 */
function summarise(rows: Scored[]): BandStat[] {
  const baseline = strictRate(rows);
  const stats = summariseHistoricalRows(rows, r => r.band, {
    minSample: MIN_SAMPLE,
    minLift: MIN_LIFT,
    baselineOf: () => baseline,
  });
  const byBand = new Map(stats.map(s => [s.key as ConfidenceBand, s]));
  return BAND_ORDER.map(band => {
    const s = byBand.get(band);
    if (!s) return { band, n: 0, hits: 0, rate: 0, rateLenient: 0, ciLow: 0, ciHigh: 0, baseline, lift: 0, calibrated: false };
    return {
      band, n: s.n, hits: s.hits, rate: s.rate, rateLenient: s.rateLenient,
      ciLow: s.ciLow, ciHigh: s.ciHigh, baseline: s.baseline,
      lift: s.liftRatio, // signal_backtests.lift stays a ratio — see note above
      calibrated: s.calibrated,
    };
  });
}

/** Latest history row strictly before `beforeTs`, within STALE_DAYS. */
interface HistPoint {
  ts: number;
  injury: number | null;
  congestion: number | null;
  stability: number | null;
  readiness: number | null;
  travelFatigue: number | null;
}
function latestBefore(list: HistPoint[] | undefined, beforeTs: number): HistPoint | null {
  if (!list || list.length === 0) return null;
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].ts < beforeTs) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found === -1) return null;
  const row = list[found];
  if (beforeTs - row.ts > STALE_DAYS * DAY_MS) return null;
  return row;
}

const nOrNull = (v: any): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function verdicts(pick: Pick, homeReady: number, awayReady: number, outcome: Pick) {
  const higher: Pick = homeReady > awayReady ? 'HOME' : homeReady < awayReady ? 'AWAY' : 'DRAW';
  return {
    strict: pick === outcome,
    lenient: higher === 'DRAW' ? outcome === 'DRAW' : outcome === higher || outcome === 'DRAW',
  };
}

export async function backtestConfidenceBands() {
  logger.info(
    {
      minSample: MIN_SAMPLE, minLift: MIN_LIFT, staleDays: STALE_DAYS,
      archivableWeight: `${ARCHIVABLE_WEIGHT}/${TOTAL_WEIGHT}`,
      archivableComponents: ARCHIVABLE_COMPONENTS.map(c => c.key),
    },
    'Confidence band backtest: starting'
  );

  // -- Load -----------------------------------------------------------------
  const [matches, results, snaps, hist, readyHist, intel] = await Promise.all([
    fetchAllRows<any>(db.from('matches').select('id, home_team_id, away_team_id, date')),
    fetchAllRows<any>(
      db.from('match_results').select('match_id, home_score, away_score')
        .not('home_score', 'is', null).not('away_score', 'is', null)
    ),
    fetchAllRows<any>(
      db.from('team_match_snapshots').select('match_id, team_id, readiness_before')
    ),
    fetchAllRows<any>(
      db.from('team_intelligence_history')
        .select('team_id, snapshot_date, injury_burden_score, congestion_score, squad_stability_score, readiness_score, travel_fatigue_score')
    ),
    fetchAllRows<any>(
      db.from('readiness_history')
        .select('match_id, league_name, snapshot_at, match_date, confidence_pct, predicted_pick, predicted_gap, home_readiness, away_readiness, final_outcome, pick_correct_strict, pick_correct_lenient, result_linked_at, squad_versatility')
        .not('result_linked_at', 'is', null)
    ),
    fetchAllRows<any>(
      db.from('match_intelligence')
        .select('match_id, confidence_score, home_readiness, away_readiness')
        .not('confidence_score', 'is', null)
    ),
  ]);

  const matchById = new Map<number, any>(matches.map((m: any) => [m.id, m]));
  const snapByKey = new Map<string, any>(snaps.map((s: any) => [`${s.match_id}:${s.team_id}`, s]));
  const intelByMatch = new Map<number, any>(intel.map((i: any) => [i.match_id, i]));

  const histByTeam = new Map<number, HistPoint[]>();
  for (const h of hist) {
    const list = histByTeam.get(h.team_id) ?? [];
    list.push({
      ts: new Date(h.snapshot_date).getTime(),
      injury: nOrNull(h.injury_burden_score),
      congestion: nOrNull(h.congestion_score),
      stability: nOrNull(h.squad_stability_score),
      readiness: nOrNull(h.readiness_score),
      travelFatigue: nOrNull(h.travel_fatigue_score),
    });
    histByTeam.set(h.team_id, list);
  }
  for (const list of histByTeam.values()) list.sort((a, b) => a.ts - b.ts);

  // -- MODE RECONSTRUCTED ---------------------------------------------------
  const reconstructed: Scored[] = [];
  const rejected: Record<string, number> = {
    no_match_row: 0, no_readiness: 0, no_history_window: 0,
    below_component_gate: 0, no_pick: 0,
  };

  for (const r of results) {
    const m = matchById.get(r.match_id);
    if (!m) { rejected.no_match_row++; continue; }

    // Match date at day granularity: snapshot_date is a DATE, so anything on
    // the same day cannot be proven pre-kickoff.
    const kickTs = new Date(m.date).getTime();
    const dayFloor = new Date(new Date(m.date).toISOString().slice(0, 10)).getTime();

    const hSnap = snapByKey.get(`${m.id}:${m.home_team_id}`);
    const aSnap = snapByKey.get(`${m.id}:${m.away_team_id}`);
    const hHist = latestBefore(histByTeam.get(m.home_team_id), dayFloor);
    const aHist = latestBefore(histByTeam.get(m.away_team_id), dayFloor);

    // Readiness: replay snapshot first, dated history as fallback.
    const hReady = nOrNull(hSnap?.readiness_before) ?? hHist?.readiness ?? null;
    const aReady = nOrNull(aSnap?.readiness_before) ?? aHist?.readiness ?? null;
    if (hReady == null || aReady == null) { rejected.no_readiness++; continue; }

    if (!hHist || !aHist) { rejected.no_history_window++; continue; }

    const { pick } = derivePick(hReady, aReady);
    if (!pick) { rejected.no_pick++; continue; }
    const pickSign: 1 | -1 = hReady - aReady >= 0 ? 1 : -1;

    // Each gap signed toward HOME. Sign conventions mirror processDbOnly:
    // an opponent's burden helps you, so injury/congestion are away-minus-home.
    const gaps: Partial<Record<ComponentKey, number | null>> = {
      readiness_gap: hReady - aReady,
      injury_gap:
        hHist.injury != null && aHist.injury != null ? aHist.injury - hHist.injury : null,
      congestion_gap:
        hHist.congestion != null && aHist.congestion != null
          ? aHist.congestion - hHist.congestion : null,
      // Cumulative fatigue, matching the live blend. The distance columns are
      // deliberately not read here: they describe the trip to this venue, not
      // the load the side is carrying into it.
      travel_gap:
        hHist.travelFatigue != null && aHist.travelFatigue != null
          ? aHist.travelFatigue - hHist.travelFatigue
          : null,
      stability_gap:
        hHist.stability != null && aHist.stability != null
          ? hHist.stability - aHist.stability : null,
      // strength / venue / motivation: no historical source, renormalised out.
    };

    const scored = computeConfidenceScore(gaps, pickSign);
    if (!scored) { rejected.below_component_gate++; continue; }

    const outcome = outcomeOf(Number(r.home_score), Number(r.away_score));
    const v = verdicts(pick, hReady, aReady, outcome);
    reconstructed.push({
      matchId: m.id, band: scored.band, score: scored.score, pick, outcome,
      strict: v.strict, lenient: v.lenient,
      componentsWithData: scored.componentsWithData,
    });
    void kickTs;
  }

  // -- MODE FROZEN ------------------------------------------------------------
  // Was a manual loop re-deriving band/pick/hit from readiness_history —
  // exactly what scoreHistoricalRows() now does once, shared with
  // archiveReadinessHistory.ts's league aggregation. The defensive
  // snapshot_at < match_date check that used to live only here is now inside
  // the shared function, so it applies identically everywhere readiness_history
  // is scored.
  const { scored: frozen, rejected: frozenScoreRejections } = scoreHistoricalRows(
    readyHist.map((r: any) => ({
      matchId: r.match_id,
      leagueName: r.league_name,
      snapshotAt: r.snapshot_at,
      matchDate: r.match_date,
      confidencePct: r.confidence_pct,
      predictedGap: r.predicted_gap,
      predictedPick: r.predicted_pick,
      finalOutcome: r.final_outcome,
      pickCorrectStrict: r.pick_correct_strict,
      pickCorrectLenient: r.pick_correct_lenient,
      squadVersatility: r.squad_versatility,
    }))
  );
  const frozenRejectedNotPreKickoff = frozenScoreRejections.notPreKickoff;

  // -- MODE CURRENT ---------------------------------------------------------
  const current: Scored[] = [];
  for (const r of results) {
    const i = intelByMatch.get(r.match_id);
    if (!i) continue;
    const band = bandFor(Number(i.confidence_score));
    if (!band) continue;
    const { pick } = derivePick(i.home_readiness, i.away_readiness);
    if (!pick) continue;
    const outcome = outcomeOf(Number(r.home_score), Number(r.away_score));
    const v = verdicts(pick, Number(i.home_readiness), Number(i.away_readiness), outcome);
    current.push({
      matchId: r.match_id, band, score: Number(i.confidence_score), pick, outcome,
      strict: v.strict, lenient: v.lenient,
    });
  }

  // -- Validation: does the reconstruction agree with the frozen score? ------
  const frozenByMatch = new Map(frozen.map(f => [f.matchId, f]));
  let overlap = 0, bandAgree = 0, scoreAbsErr = 0;
  for (const rec of reconstructed) {
    const f = frozenByMatch.get(rec.matchId);
    if (!f) continue;
    overlap++;
    if (f.band === rec.band) bandAgree++;
    scoreAbsErr += Math.abs(f.score - rec.score);
  }
  const agreement = {
    overlap,
    bandAgreementPct: overlap > 0 ? Number(((bandAgree / overlap) * 100).toFixed(1)) : null,
    meanAbsScoreError: overlap > 0 ? Number((scoreAbsErr / overlap).toFixed(2)) : null,
  };
  if (overlap === 0) {
    logger.warn('No overlap between RECONSTRUCTED and FROZEN — reconstruction is unvalidated.');
  } else if ((agreement.bandAgreementPct ?? 0) < 60) {
    logger.warn(
      agreement,
      'RECONSTRUCTED disagrees with the frozen pre-kickoff score on most matches. ' +
      'The 70%-weight reconstruction is NOT a faithful stand-in for the live band. ' +
      'Do not publish its rates until this is resolved.'
    );
  } else {
    logger.info(agreement, 'Reconstruction validated against frozen pre-kickoff scores');
  }

  // -- Report ---------------------------------------------------------------
  const recStats = summarise(reconstructed);
  const frozenStats = summarise(frozen);
  const curStats = summarise(current);
  const recBy = new Map(recStats.map(s => [s.band, s]));
  const curBy = new Map(curStats.map(s => [s.band, s]));

  logger.info(
    {
      reconstructed: reconstructed.length,
      frozen: frozen.length,
      current: current.length,
      rejected,
      frozenRejectedNotPreKickoff,
    },
    'Confidence band backtest: populations built'
  );

  for (const f of frozenStats) {
    const c = curBy.get(f.band);
    const r = recBy.get(f.band);
    logger.info(
      {
        band: f.band,
        // FROZEN first and its lift/calibrated reported, because frozen is what
        // gets persisted. The log previously led with the reconstruction and
        // reported its lift beside a stored row that came from frozen.
        frozen_n: f.n,
        frozen_pct: f.n > 0 ? (f.rate * 100).toFixed(1) : '-',
        frozen_ci: f.n > 0 ? `${f.ciLow.toFixed(1)}-${f.ciHigh.toFixed(1)}` : '-',
        lift: f.lift.toFixed(3),
        calibrated: f.calibrated,
        stored: true,
        reconstructed_n: r?.n ?? 0,
        reconstructed_pct: r && r.n > 0 ? (r.rate * 100).toFixed(1) : '-',
        current_n: c?.n ?? 0,
        current_pct: c && c.n > 0 ? (c.rate * 100).toFixed(1) : '-',
        leakage_delta_pts: c && c.n > 0 ? ((c.rate - f.rate) * 100).toFixed(1) : '-',
      },
      'Confidence band: frozen (stored) vs reconstructed vs current'
    );
  }

  // -- Monotonicity ----------------------------------------------------------
  //
  // An inversion only counts when the two bands can actually be told apart.
  // The first version tested `n > 0`, which meant Strong at n=5 (0/5, interval
  // 0.0-43.4) "inverted" against Moderate at 37.7 (26.6-50.3) — intervals that
  // overlap across almost their whole range. That warning fired on every run
  // and told the operator to withhold every rate, which is how a warning stops
  // being read.
  //
  // Now a pair must both clear MIN_MONOTONIC_SAMPLE and have Wilson intervals
  // that do not overlap. Bands too thin to judge are reported separately, as
  // information rather than as an alarm.
  const inversions: string[] = [];
  const tooThin: string[] = [];
  for (let i = 0; i < frozenStats.length - 1; i++) {
    const hi = frozenStats[i];
    const lo = frozenStats[i + 1];
    if (hi.n < MIN_MONOTONIC_SAMPLE || lo.n < MIN_MONOTONIC_SAMPLE) {
      if (hi.n > 0 && lo.n > 0 && lo.rate > hi.rate)
        tooThin.push(`${hi.band}(n=${hi.n}) < ${lo.band}(n=${lo.n})`);
      continue;
    }
    if (lo.rate > hi.rate && lo.ciLow > hi.ciHigh)
      inversions.push(
        `${hi.band} ${(hi.rate * 100).toFixed(1)}% [${hi.ciLow.toFixed(1)}-${hi.ciHigh.toFixed(1)}] ` +
        `below ${lo.band} ${(lo.rate * 100).toFixed(1)}% [${lo.ciLow.toFixed(1)}-${lo.ciHigh.toFixed(1)}]`
      );
  }

  if (inversions.length > 0) {
    logger.warn(
      { inversions },
      'Band ordering inverts on non-overlapping intervals - the score does not ' +
      'separate these bands. Do not publish their rates until resolved.'
    );
  } else if (tooThin.length > 0) {
    logger.info(
      { pairs: tooThin, minSample: MIN_MONOTONIC_SAMPLE },
      'Band pairs out of order but below the sample floor - not evidence of an ' +
      'inversion, just too few matches to order them'
    );
  }

  // -- Persist FROZEN ---------------------------------------------------------
  //
  // The first run inverted this: RECONSTRUCTED was persisted and FROZEN was
  // only a validation cross-check. Two results from that run overturned it.
  //
  //   1. The reconstruction failed its own validation — 55.5% band agreement
  //      against frozen over 245 overlapping matches, mean absolute score
  //      error 7.24. It disagrees with the real pre-kickoff score on nearly
  //      half of them, so it is not a faithful stand-in for the live band.
  //
  //   2. It bought nothing. Its whole purpose was a larger population than the
  //      forward-only archive, and it came out at 323 against frozen's 318 —
  //      because 1,587 matches were rejected for having no point-in-time
  //      readiness at all. team_match_snapshots does not cover the history.
  //
  // Frozen is the same size, at full eight-component fidelity, and is the
  // score the product actually computed before kickoff. Reconstruction stays
  // as a logged diagnostic.
  const nowIso = new Date().toISOString();
  const note =
    `frozen pre-kickoff confidence_pct from readiness_history, full ` +
    `${TOTAL_WEIGHT}/${TOTAL_WEIGHT} component fidelity; reconstruction agreed ` +
    `${agreement.bandAgreementPct ?? 'n/a'}% over n=${overlap} and is diagnostic only`;

  const rows = frozenStats.map(s => ({
    rule_key: `CBAND_${s.band.toUpperCase()}`,
    market: BAND_MARKET,
    sample_size: s.n,
    hits: s.hits,
    hit_rate: Math.round(s.rate * 10000) / 10000,
    baseline_rate: Math.round(s.baseline * 10000) / 10000,
    lift: Math.round(s.lift * 1000) / 1000,
    // Already computed inside summarise() -> summariseHistoricalRows() via
    // wilson(hits, n); this is the first thing that persists it rather than
    // discarding it at the end of the run.
    ci_low: Math.round(s.ciLow * 100) / 100,
    ci_high: Math.round(s.ciHigh * 100) / 100,
    is_calibrated: s.calibrated,
    window_days: null,
    notes: s.calibrated ? note
      : s.n < MIN_SAMPLE ? `sample ${s.n} < ${MIN_SAMPLE}; ${note}`
      : `lift ${s.lift.toFixed(3)} < ${MIN_LIFT}; ${note}`,
    evaluated_at: nowIso,
  }));

  const { error } = await db.from('signal_backtests')
    .upsert(rows, { onConflict: 'rule_key,market' });
  if (error) throw new Error(`signal_backtests upsert failed: ${error.message}`);

  const calibrated = rows.filter(r => r.is_calibrated).length;
  logger.info({ bands: rows.length, calibrated }, 'Confidence band backtest: complete');

  return {
    bands: rows.length,
    calibrated,
    reconstructedPopulation: reconstructed.length,
    frozenPopulation: frozen.length,
    currentPopulation: current.length,
    rejected,
    agreement,
    recStats,
    frozenStats,
    curStats,
  };
}
