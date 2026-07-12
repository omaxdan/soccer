import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';

/**
 * FORM QUALITY ENGINE  (migration 028, team_form_quality)
 *
 * Answers the questions raw form strings can't:
 *   - Who did those results come against?           (opponent-adjusted form)
 *   - How hard was the schedule?                    (strength of schedule)
 *   - Does the team beat quality or only bully weak sides?
 *                                    (tier splits, giant killer, flat-track)
 *   - Is the points haul sustainable?               (expected vs actual)
 *   - How swingy are the scorelines?                (volatility → risk engine)
 *
 * Window: each team's last WINDOW_SIZE matches that carry valid opponent
 * context (opponent_rank_band non-null, i.e. opponent had ≥4 games when
 * they met). Early-season noise is excluded by construction.
 *
 * Formulas (single source of truth, mirrored in 028 column comments):
 *   weight w  = 0.5 + opponent_quality/100                (0.5×..1.5×)
 *   OAF       = 100 × Σ(points·w) / (3 × Σw)
 *   SoS       = mean(opponent_quality)
 *   GiantKiller = 100 × ppg_vs_top / 3                    (≥3 top samples)
 *   FlatTrack   = 100 × max(0, ppg_bottom − ppg_top) / 3  (≥3 in BOTH tiers)
 *   xPts baseline(band) = league-wide mean points earned vs that band,
 *     computed per tournament over ALL context rows — so "expected" reflects
 *     that league's real difficulty structure, not a global guess.
 *   expected_points = Σ baseline(band_i) over the team's window
 *   volatility = population std-dev of goal margin (gf−ga) over the window
 *
 * Depends on: process:historical-context having run (reads its output).
 * DB-only. Idempotent — upserts on team_id.
 */

const WINDOW_SIZE = 10;
const MIN_TIER_SAMPLE = 3;
const UPSERT_BATCH = 500;

interface JoinedRow {
  team_id: number;
  match_id: number;
  match_ts: number;
  tournament_key: string;
  band: 'top' | 'middle' | 'bottom';
  quality: number;
  points: number;
  goal_margin: number;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

export async function processFormQuality() {
  logger.info('Form quality: loading inputs');

  const contexts = await fetchAllRows<any>(
    db.from('match_opponent_context')
      .select('match_id, team_id, opponent_rank_band, opponent_quality_score')
      .not('opponent_rank_band', 'is', null)
  );

  const formRows = await fetchAllRows<any>(
    db.from('team_form_history')
      .select('match_id, team_id, points, goals_for, goals_against, match_date')
  );
  const formByKey = new Map<string, any>(
    formRows.map((f: any) => [`${f.match_id}:${f.team_id}`, f])
  );

  const matchIds = [...new Set(contexts.map((c: any) => c.match_id))];
  const matchRows = await fetchAllRows<any>(
    db.from('matches').select('id, tournament_id, competition, season')
  );
  const tournamentByMatch = new Map<number, string>(
    matchRows.map((m: any) => [
      m.id,
      m.tournament_id != null ? `t${m.tournament_id}` : `c${m.competition ?? '?'}::${m.season ?? '?'}`,
    ])
  );

  // ── Join context ↔ form (finished matches only, by construction of form) ──
  const joined: JoinedRow[] = [];
  for (const c of contexts) {
    const f = formByKey.get(`${c.match_id}:${c.team_id}`);
    if (!f || f.points == null) continue;
    joined.push({
      team_id: c.team_id,
      match_id: c.match_id,
      match_ts: f.match_date ? new Date(f.match_date).getTime() : 0,
      tournament_key: tournamentByMatch.get(c.match_id) ?? '?',
      band: c.opponent_rank_band,
      quality: Number(c.opponent_quality_score ?? 50),
      points: Number(f.points),
      goal_margin: Number(f.goals_for ?? 0) - Number(f.goals_against ?? 0),
    });
  }
  logger.info({ contextRows: contexts.length, joined: joined.length, matches: matchIds.length },
    'Form quality: join complete');

  // ── League baselines: mean points earned vs each band, per tournament ─────
  const baselineAgg = new Map<string, { sum: number; n: number }>();
  for (const r of joined) {
    const key = `${r.tournament_key}|${r.band}`;
    const b = baselineAgg.get(key) ?? { sum: 0, n: 0 };
    b.sum += r.points; b.n += 1;
    baselineAgg.set(key, b);
  }
  const baseline = (tournamentKey: string, band: string): number | null => {
    const b = baselineAgg.get(`${tournamentKey}|${band}`);
    return b && b.n >= 10 ? b.sum / b.n : null; // require a real sample
  };

  // ── Per-team windows ───────────────────────────────────────────────────────
  const byTeam = new Map<number, JoinedRow[]>();
  for (const r of joined) {
    const list = byTeam.get(r.team_id) ?? [];
    list.push(r);
    byTeam.set(r.team_id, list);
  }

  const out: any[] = [];
  const nowIso = new Date().toISOString();

  for (const [teamId, rows] of byTeam) {
    rows.sort((a, b) => b.match_ts - a.match_ts || b.match_id - a.match_id);
    const win = rows.slice(0, WINDOW_SIZE);
    if (win.length === 0) continue;

    // OAF + SoS
    let wSum = 0, wpSum = 0, qSum = 0;
    for (const r of win) {
      const w = 0.5 + r.quality / 100;
      wSum += w; wpSum += r.points * w; qSum += r.quality;
    }
    const oaf = wSum > 0 ? round2(100 * wpSum / (3 * wSum)) : null;
    const sos = round2(qSum / win.length);

    // Tier splits
    const tier = (band: string) => win.filter(r => r.band === band);
    const tierPpg = (rows2: JoinedRow[]) =>
      rows2.length >= MIN_TIER_SAMPLE
        ? round2(rows2.reduce((s, r) => s + r.points, 0) / rows2.length)
        : null;
    const top = tier('top'), mid = tier('middle'), bot = tier('bottom');
    const ppgTop = tierPpg(top), ppgMid = tierPpg(mid), ppgBot = tierPpg(bot);

    const giantKiller = ppgTop != null ? round2(100 * ppgTop / 3) : null;
    const flatTrack = (ppgTop != null && ppgBot != null)
      ? round2(100 * Math.max(0, ppgBot - ppgTop) / 3)
      : null;

    // Expected vs actual (only over matches whose baseline exists)
    let expected = 0, actual = 0, xptsN = 0;
    for (const r of win) {
      const b = baseline(r.tournament_key, r.band);
      if (b == null) continue;
      expected += b; actual += r.points; xptsN += 1;
    }
    const hasXpts = xptsN >= 5;

    // Volatility: population std-dev of goal margin
    const margins = win.map(r => r.goal_margin);
    const mean = margins.reduce((s, v) => s + v, 0) / margins.length;
    const variance = margins.reduce((s, v) => s + (v - mean) ** 2, 0) / margins.length;
    const volatility = round2(Math.sqrt(variance));

    out.push({
      team_id: teamId,
      window_matches: win.length,
      opponent_adjusted_form: oaf,
      strength_of_schedule: sos,
      ppg_vs_top: ppgTop,       matches_vs_top: top.length,
      ppg_vs_middle: ppgMid,    matches_vs_middle: mid.length,
      ppg_vs_bottom: ppgBot,    matches_vs_bottom: bot.length,
      giant_killer_score: giantKiller,
      flat_track_bully_score: flatTrack,
      expected_points: hasXpts ? round2(expected) : null,
      actual_points: hasXpts ? actual : null,
      performance_delta: hasXpts ? round2(actual - expected) : null,
      volatility,
      calculated_at: nowIso,
    });
  }

  for (let i = 0; i < out.length; i += UPSERT_BATCH) {
    const slice = out.slice(i, i + UPSERT_BATCH);
    const { error } = await db.from('team_form_quality').upsert(slice, { onConflict: 'team_id' });
    if (error) throw new Error(`team_form_quality upsert failed at ${i}: ${error.message}`);
  }

  logger.info({ teams: out.length }, 'Form quality: complete');
  return { teams: out.length };
}
