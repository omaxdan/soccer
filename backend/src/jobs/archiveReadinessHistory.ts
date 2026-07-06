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

const READINESS_FORMULA_VERSION = 'v1';

// Near-zero readiness gap band within which the pick is recorded as DRAW
// rather than being forced onto a side. A documented constant, not a magic
// number buried in a branch — surfaced here for the team to tune (spec §5).
const DRAW_GAP_BAND = 3;

type Pick = 'HOME' | 'AWAY' | 'DRAW';

/** Derive the analytical pick + the pick-oriented signed gap from a match's
 *  readiness numbers. The pick is HOME/AWAY for a meaningful gap, DRAW inside
 *  the near-zero band. predicted_gap is SIGNED RELATIVE TO THE PICK: positive
 *  when the picked side had the higher readiness, negative when the pick is
 *  the lower-readiness side (only possible if a future non-readiness factor
 *  ever overrides — with the current pure-readiness pick it will be >= 0 for
 *  HOME/AWAY picks, but the column and orientation exist so the "Negative
 *  Edge" tier is populatable the moment such a factor is introduced). */
function derivePick(homeReadiness: number, awayReadiness: number): { pick: Pick; gap: number } {
  const rawGap = homeReadiness - awayReadiness; // + favors home, − favors away
  if (Math.abs(rawGap) <= DRAW_GAP_BAND) {
    return { pick: 'DRAW', gap: rawGap }; // gap near zero by definition
  }
  if (rawGap > 0) return { pick: 'HOME', gap: rawGap };        // + = home advantage, agrees
  return { pick: 'AWAY', gap: Math.abs(rawGap) };              // magnitude in favor of away pick
}

/** Average per-player predicted-lineup confidence within each position area,
 *  → department confidence. match_predicted_lineups stores a coarse
 *  position_code (G/D/M/F) + a per-player confidence; department confidence
 *  is the mean confidence of that team's predicted-XI players in each area,
 *  across BOTH teams (a single per-match figure per department). Returns null
 *  for a department with no players (e.g. no predicted lineup that night) —
 *  never 0, which would be a fabricated signal. */
function deriveDepartmentConfidence(
  rows: Array<{ position_code: string | null; confidence: number | null }>,
): { defense: number | null; midfield: number | null; attack: number | null } {
  const buckets: Record<'defense' | 'midfield' | 'attack', number[]> = { defense: [], midfield: [], attack: [] };
  for (const r of rows) {
    if (r.confidence == null) continue;
    const code = (r.position_code ?? '').toUpperCase();
    if (code.startsWith('G') || code.startsWith('D')) buckets.defense.push(r.confidence);
    else if (code.startsWith('M')) buckets.midfield.push(r.confidence);
    else if (code.startsWith('F')) buckets.attack.push(r.confidence);
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

  const lineupByMatch = new Map<number, Array<{ position_code: string | null; confidence: number | null }>>();
  if (toWrite.length > 0) {
    const { data: lineups } = await db
      .from('match_predicted_lineups')
      .select('match_id, position_code, confidence')
      .in('match_id', toWrite.map((m: any) => m.id));
    for (const l of lineups ?? []) {
      if (!lineupByMatch.has(l.match_id)) lineupByMatch.set(l.match_id, []);
      lineupByMatch.get(l.match_id)!.push({ position_code: l.position_code, confidence: l.confidence });
    }
  }

  let written = 0;
  for (const m of toWrite) {
    const mi = toOne(m.mi);
    const { pick, gap } = derivePick(mi.home_readiness, mi.away_readiness);
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

    const outcome: Pick = res.home_score > res.away_score ? 'HOME'
      : res.home_score < res.away_score ? 'AWAY' : 'DRAW';

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

const SAMPLE_GATE_HEADLINE = 30;    // spec §2.6 — confident badge threshold
const SAMPLE_GATE_PROVISIONAL = 10; // spec §2.6 — softer "provisional" band

type GapTier = 'strong' | 'moderate' | 'small' | 'negative';

function gapTier(predictedGap: number): GapTier {
  if (predictedGap < 0) return 'negative';
  if (predictedGap >= 20) return 'strong';
  if (predictedGap >= 10) return 'moderate';
  return 'small';
}

export async function refreshLeagueGapAnalytics(): Promise<{ rowsScanned: number; leagues: number; cells: number }> {
  logger.info('refreshLeagueGapAnalytics started — rebuilding aggregates');

  // Only result-linked rows contribute to accuracy. An unlinked row (match
  // not finished, or postponed/cancelled and never linked) has no outcome to
  // score and is simply excluded — consistent with how the platform treats
  // inactive matches elsewhere.
  const { data: rows, error } = await db
    .from('readiness_history')
    .select('league_name, predicted_gap, pick_correct_strict, pick_correct_lenient, final_outcome, squad_versatility, home_readiness, away_readiness')
    .not('result_linked_at', 'is', null);

  if (error) throw new Error(`analytics source query: ${error.message}`);
  const linked = rows ?? [];

  // ── per-league baseline: the naive accuracy with NO model. Defined here as
  //    the league's base rate of the most common single outcome (home/draw/
  //    away) — "how often would you be right by always guessing this league's
  //    modal result." Lift is then how much the readiness pick beats that. ──
  const outcomesByLeague = new Map<string, { HOME: number; DRAW: number; AWAY: number; total: number }>();
  for (const r of linked) {
    if (!r.final_outcome) continue;
    const o = outcomesByLeague.get(r.league_name) ?? { HOME: 0, DRAW: 0, AWAY: 0, total: 0 };
    o[r.final_outcome as 'HOME' | 'DRAW' | 'AWAY']++;
    o.total++;
    outcomesByLeague.set(r.league_name, o);
  }
  const baselineByLeague = new Map<string, number>();
  for (const [league, o] of outcomesByLeague) {
    const modal = Math.max(o.HOME, o.DRAW, o.AWAY);
    baselineByLeague.set(league, o.total > 0 ? modal / o.total : 0);
  }

  // ── per (league × tier) cells ──
  type Cell = {
    league: string; tier: GapTier; total: number;
    correctStrict: number; correctLenient: number;
    winningGaps: number[]; losingGaps: number[]; versatilityPresent: number;
  };
  const cells = new Map<string, Cell>();
  for (const r of linked) {
    const tier = gapTier(Number(r.predicted_gap));
    const key = `${r.league_name}::${tier}`;
    const c: Cell = cells.get(key) ?? {
      league: r.league_name, tier, total: 0,
      correctStrict: 0, correctLenient: 0,
      winningGaps: [], losingGaps: [], versatilityPresent: 0,
    };
    c.total++;
    if (r.pick_correct_strict) { c.correctStrict++; c.winningGaps.push(Number(r.predicted_gap)); }
    else { c.losingGaps.push(Number(r.predicted_gap)); }
    if (r.pick_correct_lenient) c.correctLenient++;
    if (r.squad_versatility != null) c.versatilityPresent++;
    cells.set(key, c);
  }

  const mean = (a: number[]) => (a.length === 0 ? null : Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 100) / 100);
  const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10); // one-decimal %

  // Rebuild league_gap_analytics.
  await db.from('league_gap_analytics').delete().neq('id', 0); // TRUNCATE-equivalent via delete-all
  const analyticsRows = [...cells.values()].map(c => {
    const hitStrict = rate(c.correctStrict, c.total);
    const baseline = (baselineByLeague.get(c.league) ?? 0) * 100;
    return {
      league_name: c.league, gap_tier: c.tier, total_picks: c.total,
      hit_rate_strict: hitStrict,
      hit_rate_lenient: rate(c.correctLenient, c.total),
      avg_winning_gap: mean(c.winningGaps),
      avg_losing_gap: mean(c.losingGaps),
      baseline_rate: Math.round(baseline * 10) / 10,
      lift_over_baseline: hitStrict != null ? Math.round((hitStrict - baseline) * 10) / 10 : null,
      versatility_coverage: rate(c.versatilityPresent, c.total),
    };
  });
  if (analyticsRows.length > 0) {
    const { error: insErr } = await db.from('league_gap_analytics').insert(analyticsRows);
    if (insErr) throw new Error(`league_gap_analytics insert: ${insErr.message}`);
  }

  // ── per-league roll-up ──
  type LeagueAgg = { total: number; correctStrict: number; correctLenient: number; winningGaps: number[]; tierHitRates: number[] };
  const leagueAgg = new Map<string, LeagueAgg>();
  for (const c of cells.values()) {
    const g: LeagueAgg = leagueAgg.get(c.league) ?? { total: 0, correctStrict: 0, correctLenient: 0, winningGaps: [], tierHitRates: [] };
    g.total += c.total;
    g.correctStrict += c.correctStrict;
    g.correctLenient += c.correctLenient;
    g.winningGaps.push(...c.winningGaps);
    const cellHit = c.total > 0 ? c.correctStrict / c.total : null;
    if (cellHit != null && c.total >= SAMPLE_GATE_PROVISIONAL) g.tierHitRates.push(cellHit);
    leagueAgg.set(c.league, g);
  }

  await db.from('league_gap_summary').delete().neq('id', 0);
  const summaryRows = [...leagueAgg.entries()].map(([league, g]) => {
    const hitStrict = rate(g.correctStrict, g.total);
    const baseline = (baselineByLeague.get(league) ?? 0) * 100;
    const lift = hitStrict != null ? Math.round((hitStrict - baseline) * 10) / 10 : null;
    const meetsGate = g.total >= SAMPLE_GATE_HEADLINE;

    // readiness_status — factual, sample-gated. "insufficient" until the
    // headline gate is met (never a confident badge on thin data, spec §2.6).
    // Among gated leagues: consistent = beats baseline with low tier
    // variance; volatile = erratic across tiers or below baseline; mixed
    // otherwise. Variance measured as the spread of per-tier hit rates.
    let status: string;
    if (!meetsGate) {
      status = 'insufficient';
    } else {
      const hr = g.tierHitRates;
      const variance = hr.length >= 2
        ? hr.reduce((s, x) => s + (x - hr.reduce((a, b) => a + b, 0) / hr.length) ** 2, 0) / hr.length
        : 0;
      const beatsBaseline = (lift ?? 0) > 0;
      if (beatsBaseline && variance < 0.02) status = 'consistent';
      else if (!beatsBaseline || variance > 0.05) status = 'volatile';
      else status = 'mixed';
    }

    return {
      league_name: league, total_picks: g.total,
      hit_rate_strict: hitStrict,
      hit_rate_lenient: rate(g.correctLenient, g.total),
      avg_winning_gap: mean(g.winningGaps),
      baseline_rate: Math.round(baseline * 10) / 10,
      lift_over_baseline: lift,
      readiness_status: status,
      meets_sample_gate: meetsGate,
    };
  });
  if (summaryRows.length > 0) {
    const { error: insErr } = await db.from('league_gap_summary').insert(summaryRows);
    if (insErr) throw new Error(`league_gap_summary insert: ${insErr.message}`);
  }

  logger.info({ rowsScanned: linked.length, leagues: leagueAgg.size, cells: cells.size }, 'refreshLeagueGapAnalytics completed');
  return { rowsScanned: linked.length, leagues: leagueAgg.size, cells: cells.size };
}
