// ─── READINESS HISTORY ARCHIVER ─────────────────────────────────────────────
// Two append-only stages that together form the platform's accountability
// layer (see docs/league-gap-analytics-spec.md):
//
//   1. archiveReadinessSnapshot() — writes an IMMUTABLE pre-match snapshot of
//      every upcoming, not-yet-started fixture that has readiness computed.
//      Insert-if-absent: a match that already has a snapshot is skipped
//      entirely, so the stored prediction is always the FIRST complete
//      pre-match reading, never a later one contaminated by results or
//      re-processing. This is the immutability guarantee the whole accuracy
//      layer depends on.
//
//   2. linkReadinessResults() — for snapshots whose match has since finished,
//      writes ONLY the result-derived columns (scores, outcome, correctness).
//      Never touches the frozen prediction columns.
//
// Neither stage makes an external API call — pure DB derivation, consistent
// with this platform's precompute-everything principle.

import { db } from '../db/client';
import { logger } from '../utils/logger';
import { zoneOfPositionCode } from '../lib/lineups';
import {
  derivePick, outcomeOf, scoreHistoricalRows, summariseHistoricalRows,
  strictRate, SAMPLE_THRESHOLDS, type Pick, type RawFrozenRow,
} from '../lib/confidenceBand';

const READINESS_FORMULA_VERSION = 'v1';

/** Average per-player predicted-lineup confidence within each position area,
 *  → department confidence: the mean confidence of that team's predicted-XI
 *  players in each area, across BOTH teams (a single per-match figure per
 *  department). Returns null for a department with no players (e.g. no
 *  predicted lineup that night) — never 0, which would be a fabricated signal.
 *
 *  Zone comes from match_predicted_lineups.position_group. Before migration
 *  025 the broad letter lived in position_code, and this function read it with
 *  a prefix match — which now MUST NOT be used, because position_code carries
 *  the tactical slot: 'RB' starts with 'R' and 'LCB' with 'L', so every
 *  full-back and half the centre-backs would silently drop out of the defence
 *  bucket. zoneOfPositionCode() handles the legacy rows. */
function deriveDepartmentConfidence(
  rows: Array<{ position_code: string | null; position_group?: string | null; confidence: number | null }>,
): { defense: number | null; midfield: number | null; attack: number | null } {
  const buckets: Record<'defense' | 'midfield' | 'attack', number[]> = { defense: [], midfield: [], attack: [] };
  for (const r of rows) {
    if (r.confidence == null) continue;
    const zone = r.position_group ?? zoneOfPositionCode(r.position_code);
    if (zone === 'G' || zone === 'D') buckets.defense.push(r.confidence);
    else if (zone === 'M') buckets.midfield.push(r.confidence);
    else if (zone === 'F') buckets.attack.push(r.confidence);
  }
  const avg = (a: number[]) => (a.length === 0 ? null : Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10);
  return { defense: avg(buckets.defense), midfield: avg(buckets.midfield), attack: avg(buckets.attack) };
}

export async function archiveReadinessSnapshot(): Promise<{ candidates: number; written: number; skipped: number }> {
  logger.info('archiveReadinessSnapshot started — pre-match snapshot (insert-if-absent)');

  const nowIso = new Date().toISOString();

  // Upcoming, not-yet-started fixtures with readiness computed. Left-joined to
  // match_intelligence; a match with no intelligence row is skipped (no
  // readiness = nothing to snapshot).
  const { data: matches, error } = await db
    .from('matches')
    .select(`
      id, external_match_id, date, competition, home_team_id, away_team_id, status,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name),
      mi:match_intelligence!match_id(home_readiness, away_readiness, confidence_score)
    `)
    .eq('status', 'scheduled')
    .gt('date', nowIso);

  if (error) throw new Error(`snapshot candidate query: ${error.message}`);
  if (!matches || matches.length === 0) {
    logger.info('No upcoming fixtures to snapshot');
    return { candidates: 0, written: 0, skipped: 0 };
  }

  // Which of these already have a frozen snapshot? Those are skipped — the
  // first pre-match reading is preserved, never overwritten.
  const matchIds = matches.map((m: any) => m.id);
  const { data: existing } = await db
    .from('readiness_history')
    .select('match_id')
    .in('match_id', matchIds);
  const alreadySnapshotted = new Set((existing ?? []).map((r: any) => r.match_id));

  // Predicted-lineup confidence rows for the un-snapshotted matches, for
  // department-confidence derivation.
  const toWrite = matches.filter((m: any) => {
    const mi = toOne(m.mi);
    return !alreadySnapshotted.has(m.id) && mi?.home_readiness != null && mi?.away_readiness != null;
  });

  const lineupByMatch = new Map<number, Array<{ position_code: string | null; position_group: string | null; confidence: number | null }>>();
  if (toWrite.length > 0) {
    const { data: lineups } = await db
      .from('match_predicted_lineups')
      .select('match_id, position_code, position_group, confidence')
      .in('match_id', toWrite.map((m: any) => m.id));
    for (const l of lineups ?? []) {
      if (!lineupByMatch.has(l.match_id)) lineupByMatch.set(l.match_id, []);
      lineupByMatch.get(l.match_id)!.push({ position_code: l.position_code, position_group: l.position_group, confidence: l.confidence });
    }
  }

  let written = 0;
  for (const m of toWrite) {
    const mi = toOne(m.mi);
    // toWrite is pre-filtered to rows with both readiness values present, so
    // this is never actually null here — the guard is defensive, matching this
    // file's own discipline elsewhere of rejecting rather than assuming.
    const { pick, gap } = derivePick(mi.home_readiness, mi.away_readiness);
    if (!pick || gap == null) continue;
    const dept = deriveDepartmentConfidence(lineupByMatch.get(m.id) ?? []);

    const { error: insErr } = await db.from('readiness_history').insert({
      match_id: m.id,
      match_external_id: m.external_match_id,
      snapshot_at: nowIso,
      match_date: m.date,
      readiness_formula_version: READINESS_FORMULA_VERSION,
      league_name: m.competition ?? 'Unknown',
      home_team: toOne(m.home_team)?.name ?? 'Home',
      away_team: toOne(m.away_team)?.name ?? 'Away',
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      home_readiness: mi.home_readiness,
      away_readiness: mi.away_readiness,
      predicted_gap: gap,
      predicted_pick: pick,
      confidence_pct: mi.confidence_score ?? 0,
      // squad_versatility intentionally omitted → stored NULL. It is a
      // frontend-derived lineup metric today, not persisted per-match; until
      // a backend job persists it, the archive honestly records its absence
      // rather than fabricating a value.
      defense_confidence_pct: dept.defense,
      midfield_confidence_pct: dept.midfield,
      attack_confidence_pct: dept.attack,
    });

    // Unique(match_id) means a race could still reject a duplicate — treat a
    // uniqueness violation as an expected skip, not an error.
    if (insErr) {
      if (insErr.code === '23505') continue; // unique_violation — already snapshotted
      logger.warn({ matchId: m.id, err: insErr.message }, 'snapshot insert failed');
      continue;
    }
    written++;
  }

  const skipped = matches.length - written;
  logger.info({ candidates: matches.length, written, skipped }, 'archiveReadinessSnapshot completed');
  return { candidates: matches.length, written, skipped };
}

/**
 * Backfill snapshot for matches on a specific date.
 * Unlike the nightly archive which only snapshots future matches,
 * this captures matches from a past date that were missed.
 * Same insert-if-absent guarantee — won't overwrite existing snapshots.
 */
export async function archiveReadinessSnapshotForDate(dateStr: string): Promise<{ candidates: number; written: number; skipped: number }> {
  logger.info({ date: dateStr }, 'archiveReadinessSnapshotForDate started — backfill snapshot');

  const nowIso = new Date().toISOString();
  const dayStart = `${dateStr}T00:00:00.000Z`;
  const dayEnd   = `${dateStr}T23:59:59.999Z`;

  // Matches on that date with readiness computed — regardless of status.
  // Using the date range instead of status filter so we catch finished,
  // in-progress, and scheduled matches from that day.
  const { data: matches, error } = await db
    .from('matches')
    .select(`
      id, external_match_id, date, competition, home_team_id, away_team_id, status,
      home_team:teams!home_team_id(name),
      away_team:teams!away_team_id(name),
      mi:match_intelligence!match_id(home_readiness, away_readiness, confidence_score)
    `)
    .gte('date', dayStart)
    .lte('date', dayEnd);

  if (error) throw new Error(`snapshot candidate query: ${error.message}`);
  if (!matches || matches.length === 0) {
    logger.info({ date: dateStr }, 'No matches found for date');
    return { candidates: 0, written: 0, skipped: 0 };
  }

  // Which already have a snapshot? Skip those — first reading preserved.
  const matchIds = matches.map((m: any) => m.id);
  const { data: existing } = await db
    .from('readiness_history')
    .select('match_id')
    .in('match_id', matchIds);
  const alreadySnapshotted = new Set((existing ?? []).map((r: any) => r.match_id));

  const toWrite = matches.filter((m: any) => {
    const mi = toOne(m.mi);
    return !alreadySnapshotted.has(m.id) && mi?.home_readiness != null && mi?.away_readiness != null;
  });

  // Department confidence from predicted lineups
  const lineupByMatch = new Map<number, Array<{ position_code: string | null; position_group: string | null; confidence: number | null }>>();
  if (toWrite.length > 0) {
    const { data: lineups } = await db
      .from('match_predicted_lineups')
      .select('match_id, position_code, position_group, confidence')
      .in('match_id', toWrite.map((m: any) => m.id));
    for (const l of lineups ?? []) {
      if (!lineupByMatch.has(l.match_id)) lineupByMatch.set(l.match_id, []);
      lineupByMatch.get(l.match_id)!.push({ position_code: l.position_code, position_group: l.position_group, confidence: l.confidence });
    }
  }

  let written = 0;
  for (const m of toWrite) {
    const mi = toOne(m.mi);
    // toWrite is pre-filtered to rows with both readiness values present, so
    // this is never actually null here — the guard is defensive, matching this
    // file's own discipline elsewhere of rejecting rather than assuming.
    const { pick, gap } = derivePick(mi.home_readiness, mi.away_readiness);
    if (!pick || gap == null) continue;
    const dept = deriveDepartmentConfidence(lineupByMatch.get(m.id) ?? []);

    const { error: insErr } = await db.from('readiness_history').insert({
      match_id: m.id,
      match_external_id: m.external_match_id,
      snapshot_at: nowIso,
      match_date: m.date,
      readiness_formula_version: READINESS_FORMULA_VERSION,
      league_name: m.competition ?? 'Unknown',
      home_team: toOne(m.home_team)?.name ?? 'Home',
      away_team: toOne(m.away_team)?.name ?? 'Away',
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      home_readiness: mi.home_readiness,
      away_readiness: mi.away_readiness,
      predicted_gap: gap,
      predicted_pick: pick,
      confidence_pct: mi.confidence_score ?? 0,
      defense_confidence_pct: dept.defense,
      midfield_confidence_pct: dept.midfield,
      attack_confidence_pct: dept.attack,
    });

    if (insErr) {
      if (insErr.code === '23505') continue;
      logger.warn({ matchId: m.id, err: insErr.message }, 'snapshot insert failed');
      continue;
    }
    written++;
  }

  const skipped = matches.length - written;
  logger.info({ date: dateStr, candidates: matches.length, written, skipped }, 'archiveReadinessSnapshotForDate completed');
  return { candidates: matches.length, written, skipped };
}

export async function linkReadinessResults(): Promise<{ pending: number; linked: number }> {
  logger.info('linkReadinessResults started — finalizing unlinked snapshots');

  // Unlinked snapshots.
  const { data: unlinked, error } = await db
    .from('readiness_history')
    .select('id, match_id, predicted_pick, home_readiness, away_readiness')
    .is('result_linked_at', null);

  if (error) throw new Error(`unlinked query: ${error.message}`);
  if (!unlinked || unlinked.length === 0) {
    logger.info('No unlinked snapshots');
    return { pending: 0, linked: 0 };
  }

  // Their finished results, if any.
  const { data: results } = await db
    .from('match_results')
    .select('match_id, home_score, away_score, status')
    .in('match_id', unlinked.map((r: any) => r.match_id));
  const resultByMatch = new Map<number, any>();
  for (const r of results ?? []) {
    if (r.home_score != null && r.away_score != null) resultByMatch.set(r.match_id, r);
  }

  let linked = 0;
  const nowIso = new Date().toISOString();
  for (const snap of unlinked) {
    const res = resultByMatch.get(snap.match_id);
    if (!res) continue; // not finished yet — leave unlinked

    const outcome: Pick = outcomeOf(res.home_score, res.away_score);

    // Strict: pick matches outcome exactly (draw is its own outcome).
    const strict = snap.predicted_pick === outcome;
    // Lenient: the higher-readiness side did not LOSE. Determine the
    // higher-readiness side from the frozen snapshot readiness (not the
    // pick, which may be DRAW in the near-zero band).
    const higherSide: Pick = snap.home_readiness > snap.away_readiness ? 'HOME'
      : snap.home_readiness < snap.away_readiness ? 'AWAY' : 'DRAW';
    const lenient = higherSide === 'DRAW' ? (outcome === 'DRAW')
      : (outcome === higherSide || outcome === 'DRAW');

    const { error: updErr } = await db.from('readiness_history').update({
      result_linked_at: nowIso,
      final_home_score: res.home_score,
      final_away_score: res.away_score,
      final_outcome: outcome,
      pick_correct_strict: strict,
      pick_correct_lenient: lenient,
    }).eq('id', snap.id);

    if (updErr) { logger.warn({ id: snap.id, err: updErr.message }, 'result link failed'); continue; }
    linked++;
  }

  logger.info({ pending: unlinked.length, linked }, 'linkReadinessResults completed');
  return { pending: unlinked.length, linked };
}

// Local to-one normalizer (backend has no shared relations helper like the
// frontend's toOne). PostgREST embeds a to-one relation as an object, but a
// to-many or an ambiguous embed can arrive as an array — handle both.
function toOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// ─── LEAGUE GAP ANALYTICS AGGREGATION ───────────────────────────────────────
// Nightly rebuild of the precomputed per-(league × gap tier) accuracy
// aggregates + per-league roll-up, over RESULT-LINKED readiness_history rows
// only. TRUNCATE-and-rebuild: these tables are pure derivations of
// readiness_history, so a full rebuild is always correct and simplest (no
// incremental-update drift to reason about). Reads the frozen archive, writes
// the summaries the analytics page consumes — the page itself does zero
// aggregation at request time, per this platform's precompute principle.

// Sourced from lib/confidenceBand.ts's SAMPLE_THRESHOLDS.historicalRate — kept
// as local names for readability at each call site below, but no longer a
// second independently-chosen pair of numbers. Values unchanged (30/10).
const SAMPLE_GATE_HEADLINE = SAMPLE_THRESHOLDS.historicalRate.provisional;    // 30 — spec §2.6, confident badge threshold
const SAMPLE_GATE_PROVISIONAL = SAMPLE_THRESHOLDS.historicalRate.minimum;    // 10 — spec §2.6, softer "provisional" band

/**
 * Rebuilds league_gap_analytics (league x band cells) and league_gap_summary
 * (per-league roll-up) from readiness_history, using the SHARED engine —
 * scoreHistoricalRows() for the row-level pick/band/hit, summariseHistoricalRows()
 * for the aggregation. This function used to do both of those itself, with its
 * own gapTier() bucketing by readiness-gap magnitude; it now differs from
 * jobs/backtestConfidenceBands.ts's platform aggregation only in its groupKey
 * and its baseline's pool — same statistics, same Wilson interval, same lift
 * formula, same defensive pre-kickoff check.
 *
 * BASELINE, now shared with the platform backtest's methodology rather than
 * the previous "guess the league's most common outcome" naive rate: each
 * band's hit rate is measured against ITS OWN LEAGUE's overall strict hit
 * rate across all bands. "Is Elite better than this league's picks on
 * average" rather than "is Elite better than blind guessing" — the same
 * self-referential baseline concept backtestConfidenceBands.ts already used
 * for the platform-wide numbers, now applied at league scope. This is a real
 * change in what the stored lift_over_baseline MEANS, not just how it is
 * computed; the number for a given league will differ from what it showed
 * before this migration ran, even though its unit and format do not.
 *
 * LIFT, STORED AS A PERCENTAGE — explicit product decision, not an oversight.
 * summariseHistoricalRows() computes lift internally as a ratio (rate /
 * baseline). What gets written to lift_over_baseline is liftPct =
 * (ratio - 1) * 100 — e.g. a 48% hit rate over a 40% baseline is ratio 1.20,
 * stored as +20. This keeps every existing frontend render site
 * (app/leagues/page.tsx, app/league/[slug]/page.tsx) working unmodified: the
 * column is still a signed percentage number, same as it always was. Only
 * the FORMULA feeding it changed, not its shape.
 */
export async function refreshLeagueGapAnalytics(): Promise<{ rowsScanned: number; leagues: number; cells: number }> {
  logger.info('refreshLeagueGapAnalytics started — rebuilding aggregates (band dimension)');

  // Only result-linked rows contribute to accuracy — a match not yet finished
  // has no outcome to score. confidence_pct and snapshot_at are now selected
  // too: the old query did not need them (gapTier read predicted_gap only,
  // and there was no defensive pre-kickoff re-check). scoreHistoricalRows()
  // needs both.
  const { data: rows, error } = await db
    .from('readiness_history')
    .select('match_id, league_name, snapshot_at, match_date, confidence_pct, predicted_gap, predicted_pick, final_outcome, pick_correct_strict, pick_correct_lenient, squad_versatility')
    .not('result_linked_at', 'is', null);

  if (error) throw new Error(`analytics source query: ${error.message}`);

  const raw: RawFrozenRow[] = (rows ?? []).map((r: any) => ({
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
  }));

  const { scored, rejected } = scoreHistoricalRows(raw);
  logger.info(
    { candidates: raw.length, scored: scored.length, rejected },
    'refreshLeagueGapAnalytics: rows scored'
  );

  // ONE baseline, computed once, used for every cell and every league below —
  // the platform-wide overall strict rate. This is deliberately NOT scoped
  // per-league. A first pass here measured each league's cells against that
  // league's own average, which is the wrong analogy to draw from
  // backtestConfidenceBands.ts: that job uses ONE baseline for its entire
  // call (the whole platform), not a baseline that varies by group. A
  // per-league summary row's lift against ITS OWN average is also
  // tautologically ~0 by construction, which would have made
  // league_gap_summary.lift_over_baseline a useless constant — a regression
  // in information, not just a different formula. Using the platform-wide
  // rate everywhere answers a real, useful question instead: is this
  // league/band combination better or worse than the platform as a whole.
  const platformBaseline = strictRate(scored);

  // ── league x band cells -> league_gap_analytics ──────────────────────────
  const cellStats = summariseHistoricalRows(
    scored,
    r => `${r.leagueName}::${r.band}`,
    {
      minSample: SAMPLE_GATE_PROVISIONAL,
      minLift: 1.0, // cells are informational, not calibration-gated; the real gate is on the summary roll-up below
      baselineOf: () => platformBaseline,
    }
  );

  await db.from('league_gap_analytics').delete().neq('id', 0); // TRUNCATE-equivalent via delete-all
  const analyticsRows = cellStats.map(c => {
    const [leagueName, band] = c.key.split('::');
    return {
      league_name: leagueName,
      gap_tier: band, // column name kept; now stores Elite/Strong/Moderate/Risky/Avoid
      total_picks: c.n,
      hit_rate_strict: Math.round(c.rate * 1000) / 10,
      hit_rate_lenient: Math.round(c.rateLenient * 1000) / 10,
      avg_winning_gap: mean(scored.filter(r => r.leagueName === leagueName && r.band === band && r.strict).map(r => r.predictedGap)),
      avg_losing_gap: mean(scored.filter(r => r.leagueName === leagueName && r.band === band && !r.strict).map(r => r.predictedGap)),
      baseline_rate: Math.round(c.baseline * 1000) / 10,
      lift_over_baseline: c.liftPct,
      versatility_coverage: (() => {
        const cell = scored.filter(r => r.leagueName === leagueName && r.band === band);
        return cell.length > 0
          ? Math.round((cell.filter(r => r.squadVersatility != null).length / cell.length) * 1000) / 10
          : null;
      })(),
    };
  });
  if (analyticsRows.length > 0) {
    const { error: insErr } = await db.from('league_gap_analytics').insert(analyticsRows);
    if (insErr) throw new Error(`league_gap_analytics insert: ${insErr.message}`);
  }

  // ── per-league roll-up -> league_gap_summary ─────────────────────────────
  const leagueStats = summariseHistoricalRows(
    scored,
    r => r.leagueName,
    {
      minSample: SAMPLE_GATE_HEADLINE,
      minLift: 1.0,
      baselineOf: () => platformBaseline,
    }
  );

  await db.from('league_gap_summary').delete().neq('id', 0);
  const summaryRows = leagueStats.map(s => {
    const league = s.key;
    const cellsForLeague = cellStats.filter(c => c.key.startsWith(`${league}::`));
    const meetsGate = s.n >= SAMPLE_GATE_HEADLINE;

    // band_status (was readiness_status) — factual, sample-gated. No live
    // consumer read the old column's values (confirmed before this migration:
    // grep found zero render sites), so this rename and this recomputation
    // are both safe. Same variance-based logic as before — beats the
    // platform baseline with low spread across its own band cells =
    // consistent; below baseline or high spread = volatile — now measured
    // across BAND cells instead of gap-tier cells.
    let status: string;
    if (!meetsGate) {
      status = 'insufficient';
    } else {
      const cellRates = cellsForLeague.filter(c => c.n >= SAMPLE_GATE_PROVISIONAL).map(c => c.rate);
      const variance = cellRates.length >= 2
        ? cellRates.reduce((acc, x) => acc + (x - cellRates.reduce((a, b) => a + b, 0) / cellRates.length) ** 2, 0) / cellRates.length
        : 0;
      const beatsBaseline = s.liftPct > 0;
      if (beatsBaseline && variance < 0.02) status = 'consistent';
      else if (!beatsBaseline || variance > 0.05) status = 'volatile';
      else status = 'mixed';
    }

    return {
      league_name: league,
      total_picks: s.n,
      hit_rate_strict: Math.round(s.rate * 1000) / 10,
      hit_rate_lenient: Math.round(s.rateLenient * 1000) / 10,
      avg_winning_gap: mean(scored.filter(r => r.leagueName === league && r.strict).map(r => r.predictedGap)),
      baseline_rate: Math.round(s.baseline * 1000) / 10,
      lift_over_baseline: s.liftPct,
      band_status: status,
      meets_sample_gate: meetsGate,
    };
  });
  if (summaryRows.length > 0) {
    const { error: insErr } = await db.from('league_gap_summary').insert(summaryRows);
    if (insErr) throw new Error(`league_gap_summary insert: ${insErr.message}`);
  }

  logger.info(
    { rowsScanned: scored.length, leagues: leagueStats.length, cells: cellStats.length },
    'refreshLeagueGapAnalytics completed'
  );
  return { rowsScanned: scored.length, leagues: leagueStats.length, cells: cellStats.length };
}

function mean(a: number[]): number | null {
  return a.length === 0 ? null : Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100;
}
