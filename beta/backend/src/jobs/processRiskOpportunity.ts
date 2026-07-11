import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';
import { SIGNAL_RULES, PreMatchFeatures, Market } from './backtestSignals';

/**
 * RISK ENGINE + OPPORTUNITY LAYER + SIGNAL WRITER  (migration 029)
 *
 * For every upcoming match (next HORIZON_DAYS) with match_intelligence:
 *
 *   match_risk_intelligence — 0–100 risk score from named, weighted factors.
 *     Every factor ships with the sentence explaining it. Bands:
 *     ≤33 LOW, ≤66 MEDIUM, else HIGH. predictability = 100 − risk.
 *
 *   match_opportunity — 0–100 CONTRAST composite (how much exploitable
 *     asymmetry exists, not who wins), executive brief, headline signals
 *     and warnings.
 *
 *   match_signals (signal_group='pitchterminal') — per-market directional
 *     signals from the SHARED rule registry in backtestSignals.ts.
 *     CALIBRATION GATE: a rule is only published if signal_backtests marks
 *     it is_calibrated. PT_PUBLISH_UNCALIBRATED=1 overrides (dev only) and
 *     tags the row's drivers with '[UNCALIBRATED]'. Legacy signal groups
 *     are never touched — the writer deletes and rewrites ONLY its group.
 *
 * Reads (never writes): match_intelligence, team_intelligence,
 * team_goal_dependency, team_injury_impact, team_form_quality,
 * team_strength_ratings, team_match_snapshots, signal_backtests.
 * The legacy engine stays untouched.
 *
 * DB-only. Idempotent.
 */

const HORIZON_DAYS = Number(process.env.PT_HORIZON_DAYS ?? 7);
const PUBLISH_UNCALIBRATED = process.env.PT_PUBLISH_UNCALIBRATED === '1';

interface RiskFactor { key: string; label: string; points: number; }
interface Headline { key: string; text: string; }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r0 = (v: number) => Math.round(v);
const num = (v: any): number | null => (v == null ? null : Number(v));

function riskBand(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  return score <= 33 ? 'LOW' : score <= 66 ? 'MEDIUM' : 'HIGH';
}

export async function processRiskOpportunity() {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  logger.info({ horizonDays: HORIZON_DAYS }, 'Risk/opportunity: loading inputs');

  const matches = await fetchAllRows<any>(
    db.from('matches')
      .select('id, home_team_id, away_team_id, date, status, home:teams!matches_home_team_id_fkey(name), away:teams!matches_away_team_id_fkey(name)')
      .gte('date', now.toISOString())
      .lte('date', horizon.toISOString())
      .not('status', 'in', '(postponed,cancelled,canceled,abandoned,finished)')
  );
  if (matches.length === 0) {
    logger.info('Risk/opportunity: no upcoming matches in horizon');
    return { matches: 0 };
  }
  const matchIds = matches.map((m: any) => m.id);
  const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

  const intel = await fetchAllRows<any>(
    db.from('match_intelligence').select('*').in('match_id', matchIds)
  );
  const intelByMatch = new Map(intel.map((i: any) => [i.match_id, i]));

  const asTeamMap = (rows: any[]) => new Map(rows.map((r: any) => [r.team_id, r]));
  const teamIntel   = asTeamMap(await fetchAllRows<any>(db.from('team_intelligence').select('*').in('team_id', teamIds)));
  const dependency  = asTeamMap(await fetchAllRows<any>(db.from('team_goal_dependency').select('*').in('team_id', teamIds)));
  const injuries    = asTeamMap(await fetchAllRows<any>(db.from('team_injury_impact').select('*').in('team_id', teamIds)));
  const formQuality = asTeamMap(await fetchAllRows<any>(db.from('team_form_quality').select('*').in('team_id', teamIds)));
  const strength    = asTeamMap(await fetchAllRows<any>(db.from('team_strength_ratings').select('team_id, strength_score, league_position').in('team_id', teamIds)));

  const snaps = await fetchAllRows<any>(
    db.from('team_match_snapshots')
      .select('match_id, team_id, league_position_before, games_played_before, points_last5_before')
      .in('match_id', matchIds)
  );
  const snapByKey = new Map(snaps.map((s: any) => [`${s.match_id}:${s.team_id}`, s]));

  const backtests = await fetchAllRows<any>(db.from('signal_backtests').select('*'));
  const calibration = new Map(backtests.map((b: any) => [`${b.rule_key}:${b.market}`, b]));

  const riskRows: any[] = [];
  const oppRows: any[] = [];
  const signalRows: any[] = [];
  const nowIso = now.toISOString();

  for (const m of matches) {
    const mi = intelByMatch.get(m.id) ?? {};
    const homeName = m.home?.name ?? 'Home side';
    const awayName = m.away?.name ?? 'Away side';
    const hTI = teamIntel.get(m.home_team_id) ?? {};
    const aTI = teamIntel.get(m.away_team_id) ?? {};
    const hFQ = formQuality.get(m.home_team_id) ?? {};
    const aFQ = formQuality.get(m.away_team_id) ?? {};
    const hStr = num(strength.get(m.home_team_id)?.strength_score);
    const aStr = num(strength.get(m.away_team_id)?.strength_score);
    const favName = (hStr ?? 0) >= (aStr ?? 0) ? homeName : awayName;
    const favId   = (hStr ?? 0) >= (aStr ?? 0) ? m.home_team_id : m.away_team_id;

    // ── RISK FACTORS ─────────────────────────────────────────────────────────
    const factors: RiskFactor[] = [];

    // 1. Scorer dependency of the FAVOURITE (max 15)
    const favDep = dependency.get(favId);
    const depPct = num(favDep?.top_scorer_pct);
    if (depPct != null && depPct >= 35) {
      factors.push({
        key: 'scorer_dependency',
        label: `${favName} rely on one player for ${r0(depPct)}% of their goals` +
          (favDep?.top_scorer_no_backup ? ', with no proven backup' : ''),
        points: r0(clamp((depPct - 35) * 0.75 + (favDep?.top_scorer_no_backup ? 3 : 0), 0, 15)),
      });
    }

    // 2. Injury burden, worse side (max 15)
    const injBurden = Math.max(num(hTI.injury_burden_score) ?? 0, num(aTI.injury_burden_score) ?? 0);
    if (injBurden > 20) {
      const worse = (num(hTI.injury_burden_score) ?? 0) >= (num(aTI.injury_burden_score) ?? 0) ? homeName : awayName;
      factors.push({
        key: 'injury_burden',
        label: `${worse} carry a significant injury burden into this match`,
        points: r0(clamp((injBurden - 20) * 0.19, 0, 15)),
      });
    }

    // 3. Squad instability, worse side (max 10)
    const stab = Math.min(num(hTI.squad_stability_score) ?? 100, num(aTI.squad_stability_score) ?? 100);
    if (stab < 70) {
      const worse = (num(hTI.squad_stability_score) ?? 100) <= (num(aTI.squad_stability_score) ?? 100) ? homeName : awayName;
      factors.push({
        key: 'squad_instability',
        label: `${worse}'s squad has been unstable recently`,
        points: r0(clamp((70 - stab) * 0.25, 0, 10)),
      });
    }

    // 4. Scoreline volatility (max 15)
    const vol = ((num(hFQ.volatility) ?? 0) + (num(aFQ.volatility) ?? 0)) / 2;
    if (vol >= 1.4) {
      factors.push({
        key: 'volatility',
        label: 'Both sides produce swingy scorelines — outcomes here have been hard to pin down',
        points: r0(clamp((vol - 1.4) * 9, 0, 15)),
      });
    }

    // 5. Form vs strength disagreement (max 20): table says one thing,
    //    recent form says the other — classic trap territory.
    const formDiff = (num(hTI.form_index) ?? 0) - (num(aTI.form_index) ?? 0);
    const strDiff = (hStr != null && aStr != null) ? hStr - aStr : null;
    if (strDiff != null && Math.abs(strDiff) >= 5 && Math.abs(formDiff) >= 5 &&
        Math.sign(formDiff) !== Math.sign(strDiff)) {
      factors.push({
        key: 'form_strength_conflict',
        label: 'Season strength and current form point in opposite directions',
        points: r0(clamp(Math.min(Math.abs(formDiff), Math.abs(strDiff)) * 0.7, 5, 20)),
      });
    }

    // 6. Inflated form: favourite overperforming its schedule (max 12)
    const favFQ = favId === m.home_team_id ? hFQ : aFQ;
    const favDelta = num(favFQ.performance_delta);
    if (favDelta != null && favDelta >= 3) {
      factors.push({
        key: 'inflated_form',
        label: `${favName} have taken ${favDelta.toFixed(1)} more points than their schedule normally yields — regression risk`,
        points: r0(clamp((favDelta - 3) * 2 + 4, 4, 12)),
      });
    }

    // 7. Lineup confidence (max 10)
    const xiMin = Math.min(num(mi.home_xi_strength) ?? 101, num(mi.away_xi_strength) ?? 101);
    if (mi.home_xi_strength == null || mi.away_xi_strength == null) {
      factors.push({ key: 'lineup_unknown', label: 'No projected lineups yet — selection risk unquantified', points: 6 });
    } else if (xiMin < 70) {
      const worse = (num(mi.home_xi_strength) ?? 101) <= (num(mi.away_xi_strength) ?? 101) ? homeName : awayName;
      factors.push({
        key: 'weakened_xi',
        label: `${worse} are projected to field a notably weakened eleven`,
        points: r0(clamp((70 - xiMin) * 0.35, 0, 10)),
      });
    }

    // 8. Early-season uncertainty (max 10)
    const hGames = snapByKey.get(`${m.id}:${m.home_team_id}`)?.games_played_before ?? null;
    const aGames = snapByKey.get(`${m.id}:${m.away_team_id}`)?.games_played_before ?? null;
    const minGames = Math.min(hGames ?? 99, aGames ?? 99);
    if (minGames < 6) {
      factors.push({
        key: 'small_sample',
        label: 'Early in the season — table positions and form carry little signal yet',
        points: r0(clamp((6 - minGames) * 2, 2, 10)),
      });
    }

    // 9. Model confidence (max 7)
    if ((mi.confidence_band ?? '').toUpperCase() === 'LOW') {
      factors.push({ key: 'low_model_confidence', label: 'The readiness model itself flags low confidence here', points: 7 });
    }

    const riskScore = r0(clamp(factors.reduce((s, f) => s + f.points, 0), 0, 100));

    riskRows.push({
      match_id: m.id,
      risk_score: riskScore,
      risk_band: riskBand(riskScore),
      predictability_score: 100 - riskScore,
      risk_factors: factors.sort((a, b) => b.points - a.points),
      calculated_at: nowIso,
    });

    // ── OPPORTUNITY SCORE (contrast composite) ──────────────────────────────
    const comp: Record<string, number> = {};
    const gap = Math.abs(num(mi.readiness_gap) ?? 0);
    comp.readiness_contrast = r0(clamp(gap * 1.3, 0, 30));
    comp.battle_contrast = r0(clamp(Math.abs(num(mi.net_battle_index) ?? 0) * 14, 0, 20));
    const predTotal = (num(mi.predicted_home_goals) ?? 0) + (num(mi.predicted_away_goals) ?? 0);
    comp.goal_environment = predTotal >= 2.4 ? r0(clamp((predTotal - 2.4) * 12, 0, 15)) : 0;
    const injAsym = Math.abs((num(mi.home_injury_score) ?? 0) - (num(mi.away_injury_score) ?? 0));
    comp.injury_asymmetry = r0(clamp(injAsym * 0.5, 0, 10));
    // Mispricing angle: favourite overperforming schedule = potentially overrated
    comp.mispricing = favDelta != null && favDelta >= 3 ? r0(clamp(favDelta * 2.5, 0, 15)) : 0;
    // Giant-killer underdog against a favourite
    const dogFQ = favId === m.home_team_id ? aFQ : hFQ;
    const gk = num(dogFQ.giant_killer_score);
    comp.giant_killer_angle = gk != null && gk >= 55 ? r0(clamp((gk - 55) * 0.25, 0, 10)) : 0;

    const opportunityScore = r0(clamp(Object.values(comp).reduce((s, v) => s + v, 0), 0, 100));

    // ── SIGNALS + WARNINGS + BRIEF ───────────────────────────────────────────
    const positives: Headline[] = [];
    const rGap = num(mi.readiness_gap);
    if (rGap != null && Math.abs(rGap) >= 8) {
      positives.push({
        key: 'readiness_edge',
        text: `${rGap > 0 ? homeName : awayName} hold a clear readiness advantage (${Math.abs(rGap).toFixed(0)} pts)`,
      });
    }
    const nbsi = num(mi.net_battle_index);
    if (nbsi != null && Math.abs(nbsi) >= 0.8) {
      positives.push({
        key: 'battle_superiority',
        text: `${nbsi > 0 ? homeName : awayName} lead across most head-to-head intelligence categories`,
      });
    }
    if (predTotal >= 3.0) {
      positives.push({ key: 'goal_environment', text: `Goal-friendly matchup — models project ${predTotal.toFixed(1)} total goals` });
    }
    if (gk != null && gk >= 55) {
      const dogName = favId === m.home_team_id ? awayName : homeName;
      positives.push({ key: 'giant_killer', text: `${dogName} have a record of hurting top-tier opponents` });
    }
    const warnings: Headline[] = factors.slice(0, 3).map(f => ({ key: f.key, text: f.label }));

    const topPos = positives.slice(0, 3);
    const briefParts: string[] = [];
    briefParts.push(
      topPos.length > 0
        ? `${topPos[0].text}${topPos.length > 1 ? `, and ${topPos[1].text.charAt(0).toLowerCase()}${topPos[1].text.slice(1)}` : ''}.`
        : `No single side holds a decisive intelligence edge in ${homeName} vs ${awayName}.`
    );
    briefParts.push(
      warnings.length > 0
        ? `Tempering that: ${warnings[0].text.charAt(0).toLowerCase()}${warnings[0].text.slice(1)}.`
        : 'No major risk factors detected.'
    );
    briefParts.push(`Overall risk reads ${riskBand(riskScore)} (${riskScore}/100).`);

    oppRows.push({
      match_id: m.id,
      opportunity_score: opportunityScore,
      executive_brief: briefParts.join(' '),
      signals: topPos,
      warnings,
      score_components: comp,
      calculated_at: nowIso,
    });

    // ── MARKET SIGNALS via shared, calibrated rule registry ─────────────────
    const features: PreMatchFeatures = {
      readinessGap: rGap,
      homePos: snapByKey.get(`${m.id}:${m.home_team_id}`)?.league_position_before ?? null,
      awayPos: snapByKey.get(`${m.id}:${m.away_team_id}`)?.league_position_before ?? null,
      homeGames: hGames ?? 0,
      awayGames: aGames ?? 0,
      homeLast5: snapByKey.get(`${m.id}:${m.home_team_id}`)?.points_last5_before ?? num(hTI.last_5_points),
      awayLast5: snapByKey.get(`${m.id}:${m.away_team_id}`)?.points_last5_before ?? num(aTI.last_5_points),
      // Live trend features come from the same prior-window logic the
      // backtest used; approximate via last-5 aggregates on team_intelligence
      // is NOT equivalent, so these stay null unless snapshots provide them.
      homeOver25InLast5: null, awayOver25InLast5: null,
      homeBttsInLast5: null,   awayBttsInLast5: null,
      homePriorMatches: hGames ?? 0, awayPriorMatches: aGames ?? 0,
    };

    for (const rule of SIGNAL_RULES) {
      if (!rule.fires(features)) continue;
      const cal = calibration.get(`${rule.key}:${rule.market}`);
      const publishable = cal?.is_calibrated === true || PUBLISH_UNCALIBRATED;
      if (!publishable) continue;
      const liftTxt = cal ? ` Historical hit rate ${(Number(cal.hit_rate) * 100).toFixed(0)}% vs ${(Number(cal.baseline_rate) * 100).toFixed(0)}% base (n=${cal.sample_size}).` : '';
      signalRows.push({
        match_id: m.id,
        market: rule.market,
        signal_group: 'pitchterminal',
        signal_text: rule.market.replace(/_/g, ' '),
        direction: 'positive',
        strength: cal ? r0(clamp((Number(cal.lift) - 1) * 200, 1, 100)) : 1,
        drivers: `${PUBLISH_UNCALIBRATED && !cal?.is_calibrated ? '[UNCALIBRATED] ' : ''}${rule.rationale}.${liftTxt}`,
        rule_key: rule.key,
        data_source: 'pitchterminal_v1',
        calculated_at: nowIso,
      });
    }
  }

  // ── Writes ─────────────────────────────────────────────────────────────────
  const upsert = async (table: string, rows: any[], onConflict: string) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
      if (error) throw new Error(`${table} upsert failed: ${error.message}`);
    }
  };
  await upsert('match_risk_intelligence', riskRows, 'match_id');
  await upsert('match_opportunity', oppRows, 'match_id');

  // Signals: replace ONLY our group for these matches (legacy groups untouched)
  const { error: delErr } = await db.from('match_signals')
    .delete()
    .eq('signal_group', 'pitchterminal')
    .in('match_id', matchIds);
  if (delErr) throw new Error(`match_signals cleanup failed: ${delErr.message}`);
  if (signalRows.length > 0) {
    for (let i = 0; i < signalRows.length; i += 500) {
      const { error } = await db.from('match_signals').insert(signalRows.slice(i, i + 500));
      if (error) throw new Error(`match_signals insert failed: ${error.message}`);
    }
  }

  logger.info(
    { matches: matches.length, risk: riskRows.length, opportunity: oppRows.length, signals: signalRows.length },
    'Risk/opportunity: complete'
  );
  return { matches: matches.length, signalsPublished: signalRows.length };
}
