import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';
import {
  bandFor,
  derivePick,
  outcomeOf,
  wilson,
  BAND_ORDER,
  BAND_COMPONENTS,
  ARCHIVABLE_WEIGHT,
  TOTAL_WEIGHT,
  type ConfidenceBand,
  type Pick,
} from '../lib/confidenceBand';

/**
 * CONFIDENCE BAND BACKTEST  (signal_backtests, rule_key = CBAND_*)
 *
 * WHY THIS EXISTS
 * ───────────────
 * The published band accuracy table (Elite 95.7 / Strong 97.9 / Moderate 78.4
 * / Risky 46.2 / Avoid 29.4 over 1,893 matches) was produced by joining
 * match_intelligence.confidence_band against finished results. That band is
 * derived from readiness, which is derived from team_intelligence.form_index —
 * a CURRENT-STATE table with one row per team and no snapshot_date.
 *
 * So a finished match from three months ago was scored using form that already
 * contains that match's result. A side on a long unbeaten run carries a high
 * form index today, and every match in that run is counted as a correct call.
 * The distortion concentrates exactly where the gap is widest, which is why the
 * table reads plausibly at the bottom (Avoid 29.4, Risky 46.2 are roughly what
 * draws-as-losses produces near a zero gap) and impossibly at the top. 97.9% on
 * 1X2 outcomes is not a football number, and Strong outranking Elite is a band
 * inversion that a clean measurement does not produce.
 *
 * WHAT THIS JOB MEASURES
 * ──────────────────────
 *   MODE ARCHIVED  — the honest number. Population is readiness_history rows
 *                    written BEFORE kickoff (snapshot_at < match_date) and
 *                    since linked to a result. confidence_pct was frozen at
 *                    snapshot time, so re-banding it cannot see the future.
 *                    Only this mode is written to signal_backtests.
 *
 *   MODE CURRENT   — the leaky number, reproduced deliberately. Same banding
 *                    applied to match_intelligence as it stands now. NOT
 *                    persisted. It exists so the delta between the two modes
 *                    can be logged, because that delta IS the leakage estimate.
 *
 * FIDELITY CAVEAT — read before quoting the archived figure
 * ─────────────────────────────────────────────────────────
 * Six of the eight components feeding the confidence score (strength, injury,
 * congestion, stability, venue, motivation — 60 of 100 weight) have no
 * pre-kickoff historical source anywhere in the warehouse. For matches
 * archived by archiveReadinessSnapshot the frozen confidence_pct DOES include
 * all eight, because it was computed live before kickoff. For anything older
 * than that job, no honest reconstruction is possible at any fidelity, and
 * this harness excludes those matches rather than approximating them.
 *
 * The practical consequence: the archived population is smaller than 1,893 and
 * grows only forward. That is the cost of having measured the wrong thing
 * first. Migration 033 archives the component vector so the next iteration can
 * attribute band performance to individual components.
 *
 * Depends on: archive:readiness (snapshot + link). DB-only. Idempotent.
 */

const MIN_SAMPLE = Number(process.env.PT_MIN_SAMPLE ?? 200);
const MIN_LIFT = Number(process.env.PT_MIN_LIFT ?? 1.05);

/** Bands are published claims; a small-sample band is not publishable. */
const BAND_MARKET = 'PICK_STRICT';

interface Scored {
  band: ConfidenceBand;
  pick: Pick;
  outcome: Pick;
  /** Pick landed exactly, draw counted as its own outcome. */
  strict: boolean;
  /** Higher-readiness side did not lose. */
  lenient: boolean;
}

interface BandStat {
  band: ConfidenceBand;
  n: number;
  hitsStrict: number;
  hitsLenient: number;
  rateStrict: number;
  rateLenient: number;
  ciLow: number;
  ciHigh: number;
  baseline: number;
  lift: number;
  calibrated: boolean;
}

function summarise(rows: Scored[], population: Scored[]): BandStat[] {
  // Baseline is the strict hit rate across the WHOLE evaluated population —
  // the same denominator convention backtestSignals.ts uses for lift.
  const baseline =
    population.length > 0
      ? population.filter((r) => r.strict).length / population.length
      : 0;

  return BAND_ORDER.map((band) => {
    const inBand = rows.filter((r) => r.band === band);
    const n = inBand.length;
    const hitsStrict = inBand.filter((r) => r.strict).length;
    const hitsLenient = inBand.filter((r) => r.lenient).length;
    const rateStrict = n > 0 ? hitsStrict / n : 0;
    const [ciLow, ciHigh] = wilson(hitsStrict, n);
    const lift = baseline > 0 ? rateStrict / baseline : 0;

    return {
      band,
      n,
      hitsStrict,
      hitsLenient,
      rateStrict,
      rateLenient: n > 0 ? hitsLenient / n : 0,
      ciLow,
      ciHigh,
      baseline,
      lift,
      calibrated: n >= MIN_SAMPLE && lift >= MIN_LIFT,
    };
  });
}

// ── MODE ARCHIVED — pre-kickoff snapshots only ──────────────────────────────

async function archivedPopulation(): Promise<{
  scored: Scored[];
  rejected: Record<string, number>;
}> {
  const rows = await fetchAllRows<any>(
    db
      .from('readiness_history')
      .select(
        'match_id, snapshot_at, match_date, confidence_pct, predicted_pick, ' +
          'home_readiness, away_readiness, final_outcome, ' +
          'pick_correct_strict, pick_correct_lenient, result_linked_at'
      )
      .not('result_linked_at', 'is', null)
  );

  const rejected: Record<string, number> = {
    unlinked_or_unfinished: 0,
    snapshot_not_before_kickoff: 0,
    missing_confidence: 0,
    missing_pick_or_outcome: 0,
  };

  const scored: Scored[] = [];

  for (const r of rows) {
    // ── ANTI-LEAKAGE INVARIANT ──────────────────────────────────────────
    // The snapshot must predate kickoff. A row written after the whistle is
    // indistinguishable from the current-state path and is discarded, not
    // salvaged. This check is the entire point of the job; do not relax it
    // to grow the sample.
    const snapTs = r.snapshot_at ? new Date(r.snapshot_at).getTime() : null;
    const kickTs = r.match_date ? new Date(r.match_date).getTime() : null;
    if (snapTs == null || kickTs == null || snapTs >= kickTs) {
      rejected.snapshot_not_before_kickoff++;
      continue;
    }

    if (r.confidence_pct == null) {
      rejected.missing_confidence++;
      continue;
    }
    if (!r.predicted_pick || !r.final_outcome) {
      rejected.missing_pick_or_outcome++;
      continue;
    }

    const band = bandFor(Number(r.confidence_pct));
    if (!band) {
      rejected.missing_confidence++;
      continue;
    }

    scored.push({
      band,
      pick: r.predicted_pick as Pick,
      outcome: r.final_outcome as Pick,
      // Trust the stored verdicts — they were computed by linkReadinessResults
      // against the frozen snapshot. Recomputing here would risk drifting from
      // the definition the rest of the platform reports against.
      strict: r.pick_correct_strict === true,
      lenient: r.pick_correct_lenient === true,
    });
  }

  return { scored, rejected };
}

// ── MODE CURRENT — reproduces the leaky methodology, for comparison only ────

async function currentPopulation(): Promise<Scored[]> {
  const intel = await fetchAllRows<any>(
    db
      .from('match_intelligence')
      .select('match_id, confidence_score, confidence_band, home_readiness, away_readiness')
      .not('confidence_band', 'is', null)
  );
  const intelByMatch = new Map(intel.map((i: any) => [i.match_id, i]));

  const results = await fetchAllRows<any>(
    db
      .from('match_results')
      .select('match_id, home_score, away_score')
      .not('home_score', 'is', null)
      .not('away_score', 'is', null)
  );

  const scored: Scored[] = [];
  for (const res of results) {
    const i = intelByMatch.get(res.match_id);
    if (!i) continue;

    const band = bandFor(Number(i.confidence_score));
    if (!band) continue;

    const { pick } = derivePick(i.home_readiness, i.away_readiness);
    if (!pick) continue;

    const outcome = outcomeOf(Number(res.home_score), Number(res.away_score));
    const higher: Pick =
      i.home_readiness > i.away_readiness
        ? 'HOME'
        : i.home_readiness < i.away_readiness
          ? 'AWAY'
          : 'DRAW';

    scored.push({
      band,
      pick,
      outcome,
      strict: pick === outcome,
      lenient: higher === 'DRAW' ? outcome === 'DRAW' : outcome === higher || outcome === 'DRAW',
    });
  }
  return scored;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function backtestConfidenceBands() {
  logger.info(
    {
      minSample: MIN_SAMPLE,
      minLift: MIN_LIFT,
      archivableWeight: `${ARCHIVABLE_WEIGHT}/${TOTAL_WEIGHT}`,
    },
    'Confidence band backtest: starting'
  );

  const { scored: archived, rejected } = await archivedPopulation();
  const current = await currentPopulation();

  const archivedStats = summarise(archived, archived);
  const currentStats = summarise(current, current);

  logger.info(
    {
      archivedPopulation: archived.length,
      currentPopulation: current.length,
      rejected,
    },
    'Confidence band backtest: populations built'
  );

  // ── Side-by-side comparison — the leakage estimate ────────────────────────
  const currentByBand = new Map(currentStats.map((s) => [s.band, s]));
  for (const a of archivedStats) {
    const c = currentByBand.get(a.band);
    const delta = c ? (c.rateStrict - a.rateStrict) * 100 : null;
    logger.info(
      {
        band: a.band,
        archived_n: a.n,
        archived_pct: (a.rateStrict * 100).toFixed(1),
        archived_ci: a.n > 0 ? `${a.ciLow.toFixed(1)}–${a.ciHigh.toFixed(1)}` : '—',
        current_n: c?.n ?? 0,
        current_pct: c ? (c.rateStrict * 100).toFixed(1) : '—',
        leakage_delta_pts: delta != null ? delta.toFixed(1) : '—',
        calibrated: a.calibrated,
      },
      'Confidence band: archived vs current'
    );
  }

  const inverted = archivedStats.some((s, idx) => {
    const next = archivedStats[idx + 1];
    return next && s.n > 0 && next.n > 0 && next.rateStrict > s.rateStrict;
  });
  if (inverted) {
    logger.warn(
      'Band ordering is not monotonic in the archived population — a higher band ' +
        'scored worse than the band below it. Either the sample is too small or the ' +
        'score formula does not separate. Do not publish band rates until resolved.'
    );
  }

  // ── Persist ARCHIVED only ────────────────────────────────────────────────
  // The current-state figures are diagnostics. Writing them to
  // signal_backtests would let a leaked number reach the signal writer's
  // calibration gate, which is the failure this whole layer exists to prevent.
  const nowIso = new Date().toISOString();
  const componentNote =
    `pre-kickoff snapshots only; ${ARCHIVABLE_WEIGHT}/${TOTAL_WEIGHT} weight ` +
    `has an archived source (${BAND_COMPONENTS.filter((c) => c.archivedSource)
      .map((c) => c.key)
      .join(', ')})`;

  const rows = archivedStats.map((s) => ({
    rule_key: `CBAND_${s.band.toUpperCase()}`,
    market: BAND_MARKET,
    sample_size: s.n,
    hits: s.hitsStrict,
    hit_rate: Math.round(s.rateStrict * 10000) / 10000,
    baseline_rate: Math.round(s.baseline * 10000) / 10000,
    lift: Math.round(s.lift * 1000) / 1000,
    is_calibrated: s.calibrated,
    window_days: null,
    notes: s.calibrated
      ? componentNote
      : s.n < MIN_SAMPLE
        ? `sample ${s.n} < ${MIN_SAMPLE}; ${componentNote}`
        : `lift ${s.lift.toFixed(3)} < ${MIN_LIFT}; ${componentNote}`,
    evaluated_at: nowIso,
  }));

  const { error } = await db
    .from('signal_backtests')
    .upsert(rows, { onConflict: 'rule_key,market' });
  if (error) throw new Error(`signal_backtests upsert failed: ${error.message}`);

  const calibrated = rows.filter((r) => r.is_calibrated).length;
  logger.info(
    {
      bands: rows.length,
      calibrated,
      archivedPopulation: archived.length,
      currentPopulation: current.length,
    },
    'Confidence band backtest: complete'
  );

  return {
    bands: rows.length,
    calibrated,
    archivedPopulation: archived.length,
    currentPopulation: current.length,
    rejected,
    archivedStats,
    currentStats,
  };
}
