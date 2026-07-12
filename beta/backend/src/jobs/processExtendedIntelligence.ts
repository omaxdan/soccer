// ─── EXTENDED INTELLIGENCE SUITE ─────────────────────────────────────────────
// 14 processors extending the core readiness/lineup pipeline. All DB-only,
// zero API calls. Kept in a separate file from processDbOnly.ts (already
// very large) — imports the same db/logger/fetchAllRows primitives.
//
// AUDIT NOTE: every processor here was checked against the ACTUAL schema
// (29 migrations, verified column-by-column) before being written — several
// bugs in the original drafts were fixed in the process:
//   - processTeamFormQuality: rewritten to use REAL tables (team_form_history
//     + match_results + team_strength_ratings). A draft version assumed
//     team_match_snapshots/match_opponent_context, which do not exist
//     anywhere in this project's migration history (verified by grep across
//     all 28 prior migration files before writing this one).
//   - processHTFTProbabilities: computed directly from match_results'
//     half_time_home_score/away_score (real, since migration 001) — NOT
//     from a "team_ht_profile" view, which also does not exist. A draft
//     also attempted `db.query(CREATE TABLE ...)` at runtime — the db
//     client wrapper has no .query() method; the table is created by
//     migration 029 instead, like every other table in this project.
//   - processTeamFormQuality (first draft): `new Map<number, {...}>` was
//     missing its constructor call `()` — a real syntax bug.
//   - processPlayerMatchImpact: `const isHome` was declared twice in the
//     same scope (duplicate block-scoped declaration — compile error).
//   - processTeamMotivation: `tournamentSizes.get(standing.position > 0
//     ? 20 : 20)` — both ternary branches were the literal 20, always
//     resolving to the wrong bucket. Standings now retain tournament_id so
//     the lookup is real.
//   - processSubstitutionImpact: "bench" was an arbitrary DB-order slice of
//     the roster, not the real predicted lineup. Rewritten to be genuinely
//     match-scoped: bench = team roster minus THIS match's real
//     match_predicted_lineups XI, bench quality from player_strength_score
//     (migration 027) instead of a vague importance heuristic.
//   - processSquadDepthComparison: relied on team_position_depth.strength_
//     score/quality_rating, columns nothing writes. Computes depth inline
//     from available_count/player_count + total_market_value instead.
//   - processFormationMatchup: "detected formation" is derived from OUR OWN
//     fixed 1-4-4-2 predicted-lineup template (see processPredictedLineups),
//     so it will read close to 4-4-2 on most matches — documented in
//     migration 028's table comment rather than presented as literal
//     historical tactical detection.
//   - processTeamVersatility: genuinely complements (not duplicates)
//     team_intelligence.lineup_versatility_score (migration 020) — that one
//     is a team-level ROLLING scalar from the latest predicted-XI
//     occurrence per player across ALL matches; this one is a per-MATCH
//     snapshot from that match's own predicted lineup. Both kept.
//
// All formula weights throughout are heuristic/provisional — flagged
// per this project's migration-022 ethos (NBSI), not backtested. Revisit
// once readiness_history accumulates enough matches.

import { db } from '../db/client';
import { logger } from '../utils/logger';
import { fetchAllRows } from '../db/fetchAllRows';

const WEEK_MS = 7 * 86400000;
function upcomingWindow() {
  const now = new Date().toISOString();
  const weekOut = new Date(Date.now() + WEEK_MS).toISOString();
  return { now, weekOut };
}
async function upsertChunked(table: string, rows: any[], onConflict: string): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) { logger.error({ table, error: error.message }, 'upsert chunk failed'); continue; }
    written += chunk.length;
  }
  return written;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. TEAM FORM QUALITY — opponent-adjusted form, tier splits
// ═══════════════════════════════════════════════════════════════════════════
export async function processTeamFormQuality(): Promise<{ teamsProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processTeamFormQuality started — DB only, zero API calls');
  try {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000).toISOString();

    const matches = await fetchAllRows(
      db.from('matches')
        .select('id, home_team_id, away_team_id, date, match_results!inner(home_score, away_score)')
        .eq('status', 'finished')
        .gte('date', twoYearsAgo)
        .order('date', { ascending: false })
    );
    if (!matches || matches.length === 0) return { teamsProcessed: 0, rowsWritten: 0 };

    const strengthRows = await fetchAllRows(db.from('team_strength_ratings').select('team_id, strength_score'));
    const strengthMap = new Map<number, number>(strengthRows.map((r: any) => [r.team_id, r.strength_score ?? 50]));

    type Tier = { matches: number; points: number };
    type TeamStat = {
      matches: number; points: number;
      byTier: { top: Tier; middle: Tier; bottom: Tier };
      opponentStrengths: number[];
      results: Array<{ points: number; expectedPoints: number }>;
    };
    const teamStats = new Map<number, TeamStat>();

    const record = (teamId: number, gf: number, ga: number, oppStrength: number, isHome: boolean) => {
      if (!teamStats.has(teamId)) {
        teamStats.set(teamId, {
          matches: 0, points: 0,
          byTier: { top: { matches: 0, points: 0 }, middle: { matches: 0, points: 0 }, bottom: { matches: 0, points: 0 } },
          opponentStrengths: [], results: [],
        });
      }
      const s = teamStats.get(teamId)!;
      const points = gf > ga ? 3 : gf === ga ? 1 : 0;
      s.matches++; s.points += points; s.opponentStrengths.push(oppStrength);
      const tier: 'top' | 'middle' | 'bottom' = oppStrength >= 70 ? 'top' : oppStrength >= 45 ? 'middle' : 'bottom';
      s.byTier[tier].matches++; s.byTier[tier].points += points;
      const strengthDiff = isHome ? 10 : -10;
      const expectedPoints = 3 / (1 + Math.exp(-(strengthDiff + (50 - oppStrength)) / 20));
      s.results.push({ points, expectedPoints });
    };

    for (const m of matches as any[]) {
      const hs = m.match_results?.[0]?.home_score ?? m.match_results?.home_score;
      const as_ = m.match_results?.[0]?.away_score ?? m.match_results?.away_score;
      if (hs == null || as_ == null) continue;
      const homeStrength = strengthMap.get(m.home_team_id) ?? 50;
      const awayStrength = strengthMap.get(m.away_team_id) ?? 50;
      record(m.home_team_id, hs, as_, awayStrength, true);
      record(m.away_team_id, as_, hs, homeStrength, false);
    }

    const rows: any[] = [];
    for (const [teamId, s] of teamStats) {
      if (s.matches < 10) continue;
      const { top, middle, bottom } = s.byTier;
      const ppg = (t: Tier) => (t.matches > 0 ? t.points / t.matches : null);
      const ppgTop = ppg(top), ppgMiddle = ppg(middle), ppgBottom = ppg(bottom);

      const expectedPoints = s.results.reduce((sum, r) => sum + r.expectedPoints, 0);
      const performanceDelta = expectedPoints > 0 ? s.points - expectedPoints : 0;
      const avgOpponentStrength = s.opponentStrengths.length > 0
        ? s.opponentStrengths.reduce((a, b) => a + b, 0) / s.opponentStrengths.length : 50;
      const adjustedForm = (s.points / s.matches) * (50 / (avgOpponentStrength || 50));

      const pts = s.results.map(r => r.points);
      const mean = s.points / s.matches;
      const volatility = pts.length > 1
        ? Math.sqrt(pts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / pts.length) : 0;

      const giantKillerScore = ppgTop !== null && ppgMiddle ? (ppgTop / (ppgMiddle || 1)) * 100 : null;
      const flatTrackBullyScore = ppgBottom !== null && ppgMiddle ? (ppgBottom / (ppgMiddle || 1)) * 100 : null;

      rows.push({
        team_id: teamId, window_matches: s.matches,
        opponent_adjusted_form: Math.round(adjustedForm * 100) / 100,
        strength_of_schedule: Math.round(avgOpponentStrength * 10) / 10,
        ppg_vs_top: ppgTop !== null ? Math.round(ppgTop * 100) / 100 : null, matches_vs_top: top.matches,
        ppg_vs_middle: ppgMiddle !== null ? Math.round(ppgMiddle * 100) / 100 : null, matches_vs_middle: middle.matches,
        ppg_vs_bottom: ppgBottom !== null ? Math.round(ppgBottom * 100) / 100 : null, matches_vs_bottom: bottom.matches,
        giant_killer_score: giantKillerScore !== null ? Math.round(giantKillerScore * 10) / 10 : null,
        flat_track_bully_score: flatTrackBullyScore !== null ? Math.round(flatTrackBullyScore * 10) / 10 : null,
        expected_points: Math.round(expectedPoints * 100) / 100,
        actual_points: s.points,
        performance_delta: Math.round(performanceDelta * 100) / 100,
        volatility: Math.round(volatility * 100) / 100,
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('team_form_quality', rows, 'team_id');
    logger.info({ teamsProcessed: teamStats.size, rowsWritten: written }, 'processTeamFormQuality completed');
    return { teamsProcessed: teamStats.size, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamFormQuality failed');
    return { teamsProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. TEAM BETTING INTELLIGENCE — attack/defence ratings, market scores
// ═══════════════════════════════════════════════════════════════════════════
export async function processTeamBettingIntelligence(): Promise<{ teamsProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processTeamBettingIntelligence started — DB only, zero API calls');
  try {
    const seasonStats = await fetchAllRows(
      db.from('team_season_statistics')
        .select(`team_id, season_external_id, matches, goals_scored, goals_conceded, clean_sheets,
          shots, shots_on_target, big_chances, big_chances_created, big_chances_missed, big_chances_against,
          shots_against, shots_on_target_against, yellow_cards, red_cards, avg_possession, accurate_passes_pct`)
        .order('season_external_id', { ascending: false })
    );
    if (!seasonStats || seasonStats.length === 0) {
      logger.warn('No season statistics found — run sync:team-stats first (needs migration 026 columns)');
      return { teamsProcessed: 0, rowsWritten: 0 };
    }

    const statsByTeam = new Map<number, any>();
    for (const s of seasonStats) {
      const existing = statsByTeam.get(s.team_id);
      if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
      statsByTeam.set(s.team_id, s);
    }

    const venueRows = await fetchAllRows(db.from('team_venue_performance').select('team_id, home_win_pct, away_win_pct'));
    const venueMap = new Map<number, any>(venueRows.map((r: any) => [r.team_id, r]));
    const intelRows = await fetchAllRows(db.from('team_intelligence').select('team_id, form_index'));
    const intelMap = new Map<number, any>(intelRows.map((r: any) => [r.team_id, r]));

    const rows: any[] = [];
    for (const [teamId, stats] of statsByTeam) {
      const matches = stats.matches || 1;
      const goalsScored = stats.goals_scored || 0;
      const goalsConceded = stats.goals_conceded || 0;
      const cleanSheets = stats.clean_sheets || 0;
      const shots = stats.shots || 1;
      const shotsOnTarget = stats.shots_on_target || 1;
      const bigChancesCreated = stats.big_chances_created || 0;
      const bigChancesMissed = stats.big_chances_missed || 0;
      const shotsOnTargetAgainst = stats.shots_on_target_against || 0;
      const bigChancesAgainst = stats.big_chances_against || 0;
      const intel = intelMap.get(teamId);
      const venue = venueMap.get(teamId);

      const goalsPerMatch = goalsScored / matches;
      const shotsPerMatch = shots / matches;
      const shotAccuracy = (shotsOnTarget / shots) * 100;
      const shotConversion = (goalsScored / shots) * 100;
      const goalsPerSOT = shotsOnTarget > 0 ? goalsScored / shotsOnTarget : 0;
      const bigChancesPerMatch = bigChancesCreated / matches;
      const bigChanceConversion = bigChancesCreated > 0
        ? ((bigChancesCreated - bigChancesMissed) / bigChancesCreated) * 100 : 0;

      const attackRating = Math.min(100, Math.round(
        (goalsPerMatch / 3) * 25 + (shotsPerMatch / 20) * 20 + (shotAccuracy / 50) * 15 +
        (shotConversion / 20) * 20 + (bigChanceConversion / 50) * 20
      ));

      const goalsConcededPerMatch = goalsConceded / matches;
      const cleanSheetPct = (cleanSheets / matches) * 100;
      const shotsOnTargetAgainstPerMatch = shotsOnTargetAgainst / matches;
      const bigChancesAgainstPerMatch = bigChancesAgainst / matches;

      const defenceRating = Math.min(100, Math.max(0, Math.round(
        (100 - Math.min(100, goalsConcededPerMatch * 30)) * 0.35 +
        (cleanSheetPct * 0.35) +
        (100 - Math.min(100, shotsOnTargetAgainstPerMatch * 10)) * 0.15 +
        (100 - Math.min(100, bigChancesAgainstPerMatch * 20)) * 0.15
      )));

      const qualityScore = Math.round((attackRating + defenceRating) / 2);
      const finishingEfficiency = Math.min(100, Math.round((goalsPerSOT / 0.5) * 100));
      const shotAccuracyScore = Math.min(100, Math.round(shotAccuracy * 2));
      const shotConversionRate = Math.min(100, Math.round(shotConversion * 4));
      const bigChanceConversionScore = Math.min(100, Math.max(0, Math.round(bigChanceConversion)));
      const goalCreationScore = Math.min(100, Math.round((goalsPerMatch / 3) * 60 + (bigChancesPerMatch / 3) * 40));
      const goalPreventionScore = Math.min(100, Math.max(0, Math.round(
        (100 - (goalsConcededPerMatch / 3) * 100) * 0.6 + (cleanSheetPct * 0.4)
      )));
      const defensiveFragilityScore = 100 - defenceRating;
      const cleanSheetReliability = Math.min(100, Math.round(cleanSheetPct));
      const attackSustainabilityScore = Math.min(100, Math.round((shotsPerMatch / 20) * 50 + (bigChanceConversion / 50) * 50));

      const consistencyScore = intel?.form_index != null ? Math.min(100, Math.round(intel.form_index * 0.7 + 30)) : 50;
      const volatilityScore = intel?.form_index != null ? Math.min(100, Math.round((100 - intel.form_index) * 0.7 + 30)) : 50;
      const predictabilityScore = Math.min(100, Math.round(consistencyScore * 0.4 + defenceRating * 0.3 + attackRating * 0.3));
      const sustainabilityScore = Math.min(100, Math.round(attackSustainabilityScore * 0.5 + cleanSheetReliability * 0.5));

      const homeAttackRating = venue?.home_win_pct != null ? Math.min(100, Math.round(attackRating * (1 + (venue.home_win_pct - 50) / 200))) : attackRating;
      const homeDefenceRating = venue?.home_win_pct != null ? Math.min(100, Math.round(defenceRating * (1 + (venue.home_win_pct - 50) / 300))) : defenceRating;
      const awayAttackRating = venue?.away_win_pct != null ? Math.min(100, Math.round(attackRating * (1 + (venue.away_win_pct - 50) / 200))) : attackRating;
      const awayDefenceRating = venue?.away_win_pct != null ? Math.min(100, Math.round(defenceRating * (1 + (venue.away_win_pct - 50) / 300))) : defenceRating;

      const winnerMarketScore = Math.min(100, Math.round(qualityScore * 0.4 + consistencyScore * 0.3 + predictabilityScore * 0.3));
      const goalsMarketScore = Math.min(100, Math.round((goalsPerMatch / 3) * 40 + attackRating * 0.3 + (100 - defenceRating) * 0.3));
      const bttsScore = Math.min(100, Math.round(attackRating * 0.4 + (100 - defenceRating) * 0.4 + consistencyScore * 0.2));
      const cardsMarketScore = Math.min(100, Math.round(((stats.yellow_cards || 0) / matches) * 20 + ((stats.red_cards || 0) / matches) * 40));

      rows.push({
        team_id: teamId, season_external_id: stats.season_external_id,
        attack_rating: attackRating, defence_rating: defenceRating, team_quality_score: qualityScore,
        finishing_efficiency: finishingEfficiency, shot_accuracy: shotAccuracyScore, shot_conversion_rate: shotConversionRate,
        big_chance_conversion: bigChanceConversionScore, goal_creation_score: goalCreationScore, goal_prevention_score: goalPreventionScore,
        defensive_fragility_score: defensiveFragilityScore, clean_sheet_reliability: cleanSheetReliability,
        attack_sustainability_score: attackSustainabilityScore, consistency_score: consistencyScore, volatility_score: volatilityScore,
        predictability_score: predictabilityScore, sustainability_score: sustainabilityScore,
        overperformance_score: null, underperformance_score: null,
        home_attack_rating: homeAttackRating, home_defence_rating: homeDefenceRating,
        away_attack_rating: awayAttackRating, away_defence_rating: awayDefenceRating,
        winner_market_score: winnerMarketScore, goals_market_score: goalsMarketScore, btts_score: bttsScore, cards_market_score: cardsMarketScore,
        updated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('team_betting_intelligence', rows, 'team_id,season_external_id');
    logger.info({ teamsProcessed: statsByTeam.size, rowsWritten: written }, 'processTeamBettingIntelligence completed');
    return { teamsProcessed: statsByTeam.size, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamBettingIntelligence failed');
    return { teamsProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. HALF-TIME/FULL-TIME PROBABILITIES — from real match_results columns
// ═══════════════════════════════════════════════════════════════════════════
export async function processHTFTProbabilities(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processHTFTProbabilities started — DB only, zero API calls');
  try {
    const htMatches = await fetchAllRows(
      db.from('matches')
        .select('id, home_team_id, away_team_id, match_results!inner(half_time_home_score, half_time_away_score, home_score, away_score)')
        .eq('status', 'finished')
        .not('match_results.half_time_home_score', 'is', null)
    );
    if (!htMatches || htMatches.length === 0) {
      logger.warn('No matches with half-time data found');
      return { matchesProcessed: 0, rowsWritten: 0 };
    }

    type Transitions = { total: number; HH: number; HD: number; HA: number; DH: number; DD: number; DA: number; AH: number; AD: number; AA: number };
    const blank = (): Transitions => ({ total: 0, HH: 0, HD: 0, HA: 0, DH: 0, DD: 0, DA: 0, AH: 0, AD: 0, AA: 0 });
    const teamTransitions = new Map<number, Transitions>();

    const bump = (t: Transitions, combo: string) => { t.total++; (t as any)[combo] = ((t as any)[combo] || 0) + 1; };
    const outcome = (a: number, b: number) => (a > b ? 'H' : a === b ? 'D' : 'A');

    for (const m of htMatches as any[]) {
      const mr = m.match_results?.[0] ?? m.match_results;
      const htH = mr?.half_time_home_score, htA = mr?.half_time_away_score, ftH = mr?.home_score, ftA = mr?.away_score;
      if (htH == null || htA == null || ftH == null || ftA == null) continue;

      if (!teamTransitions.has(m.home_team_id)) teamTransitions.set(m.home_team_id, blank());
      bump(teamTransitions.get(m.home_team_id)!, outcome(htH, htA) + outcome(ftH, ftA));

      if (!teamTransitions.has(m.away_team_id)) teamTransitions.set(m.away_team_id, blank());
      bump(teamTransitions.get(m.away_team_id)!, outcome(htA, htH) + outcome(ftA, ftH));
    }

    const withData = [...teamTransitions.values()].filter(t => t.total >= 5);
    const KEYS = ['HH', 'HD', 'HA', 'DH', 'DD', 'DA', 'AH', 'AD', 'AA'] as const;
    const leagueAvg: Record<string, number> = {};
    for (const k of KEYS) {
      leagueAvg[k] = withData.length > 0
        ? withData.reduce((s, t) => s + (t as any)[k] / t.total, 0) / withData.length : 1 / 9;
    }

    const { now, weekOut } = upcomingWindow();
    const upcoming = await fetchAllRows(
      db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut)
    );
    if (!upcoming || upcoming.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const matchIds = upcoming.map((m: any) => m.id);
    const matchIntel = await fetchAllRows(
      db.from('match_intelligence').select('match_id, home_readiness, away_readiness, confidence_score').in('match_id', matchIds)
    );
    const intelMap = new Map<number, any>(matchIntel.map((r: any) => [r.match_id, r]));

    const rows: any[] = [];
    for (const match of upcoming as any[]) {
      const intel = intelMap.get(match.id);
      const homeData = teamTransitions.get(match.home_team_id);
      const awayData = teamTransitions.get(match.away_team_id);

      const getProb = (teamData: Transitions | undefined, key: string): number =>
        teamData && teamData.total >= 5 ? (teamData as any)[key] / teamData.total : leagueAvg[key];

      const homeWeight = intel?.home_readiness != null ? intel.home_readiness / 100 : 0.5;
      const awayWeight = intel?.away_readiness != null ? intel.away_readiness / 100 : 0.5;
      const totalWeight = homeWeight + awayWeight || 1;
      const blend = (homeKey: string, awayMirrorKey: string) =>
        (getProb(homeData, homeKey) * homeWeight + getProb(awayData, awayMirrorKey) * awayWeight) / totalWeight;

      const hh = blend('HH', 'AA'), hd = blend('HD', 'AD'), ha = blend('HA', 'AH');
      const dh = blend('DH', 'DA'), dd = blend('DD', 'DD'), da = blend('DA', 'DH');
      const ah = blend('AH', 'HA'), ad = blend('AD', 'HD'), aa = blend('AA', 'HH');

      const total = hh + hd + ha + dh + dd + da + ah + ad + aa;
      const norm = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);

      const htHomeProb = norm(hh + hd + ha);
      const htDrawProb = norm(dh + dd + da);
      const htAwayProb = norm(ah + ad + aa);

      const dataConfidence = Math.min(100, Math.round(
        (homeData && homeData.total >= 5 ? 30 : 10) +
        (awayData && awayData.total >= 5 ? 30 : 10) +
        (intel?.confidence_score || 0) * 0.4
      ));

      rows.push({
        match_id: match.id,
        home_ht_win_prob: htHomeProb, draw_ht_prob: htDrawProb, away_ht_win_prob: htAwayProb,
        predicted_ht_goals_home: null, predicted_ht_goals_away: null,
        hh_prob: norm(hh), hd_prob: norm(hd), ha_prob: norm(ha),
        dh_prob: norm(dh), dd_prob: norm(dd), da_prob: norm(da),
        ah_prob: norm(ah), ad_prob: norm(ad), aa_prob: norm(aa),
        home_2h_goals: null, away_2h_goals: null,
        over_0_5_2h_prob: null, over_1_5_2h_prob: null, btts_2h_prob: null,
        confidence_score: dataConfidence,
        confidence_band: dataConfidence >= 75 ? 'High' : dataConfidence >= 60 ? 'Moderate' : 'Low',
        calculated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('match_half_time_intelligence', rows, 'match_id');
    logger.info({ matchesProcessed: upcoming.length, rowsWritten: written }, 'processHTFTProbabilities completed');
    return { matchesProcessed: upcoming.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processHTFTProbabilities failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. PLAYER MATCH IMPACT
// ═══════════════════════════════════════════════════════════════════════════
export async function processPlayerMatchImpact(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processPlayerMatchImpact started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(
      db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut)
    );
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const matchIds = matches.map((m: any) => m.id);
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups')
        .select('match_id, team_id, player_id, position_code, rank_in_position, confidence, players:player_id(id, name, position, primary_position, secondary_position, tertiary_position, market_value, current_injury)')
        .in('match_id', matchIds)
    );
    if (!lineups || lineups.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const playerIds = [...new Set(lineups.map((p: any) => p.player_id))];
    const playerIntel = await fetchAllRows(
      db.from('player_intelligence').select('player_id, importance_score, readiness_score, fatigue_score, goal_share_pct, assist_share_pct').in('player_id', playerIds)
    );
    const intelMap = new Map<number, any>(playerIntel.map((r: any) => [r.player_id, r]));

    const seasonStats = await fetchAllRows(
      db.from('player_season_statistics').select('player_id, season_external_id, goals, assists, total_rating, count_rating, appearances').in('player_id', playerIds)
    );
    const statsMap = new Map<number, any>();
    for (const s of seasonStats) {
      const existing = statsMap.get(s.player_id);
      if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
      statsMap.set(s.player_id, s);
    }

    const formQualityRows = await fetchAllRows(
      db.from('team_form_quality').select('team_id, giant_killer_score').in('team_id', teamIds)
    );
    const formQualityMap = new Map<number, any>(formQualityRows.map((r: any) => [r.team_id, r]));

    const lineupsByMatch = new Map<number, any[]>();
    for (const l of lineups) {
      if (!lineupsByMatch.has(l.match_id)) lineupsByMatch.set(l.match_id, []);
      lineupsByMatch.get(l.match_id)!.push(l);
    }

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const matchLineups = lineupsByMatch.get(match.id) || [];
      if (matchLineups.length === 0) continue;
      const homePlayers = matchLineups.filter((p: any) => p.team_id === match.home_team_id);
      const awayPlayers = matchLineups.filter((p: any) => p.team_id === match.away_team_id);

      for (const lineup of matchLineups) {
        const intel = intelMap.get(lineup.player_id);
        const stats = statsMap.get(lineup.player_id);
        if (!intel) continue;

        const isHomePlayer = lineup.team_id === match.home_team_id;
        const formQuality = formQualityMap.get(lineup.team_id);

        // ─── Calculate values ────────────────────────────────────────────────
        const importanceScore = intel.importance_score ?? 50;
        const readinessScore = intel.readiness_score ?? 50;
        const fatigueScore = intel.fatigue_score ?? 0;
        const fatigueAdjusted = Math.max(0, 100 - fatigueScore);

        const avgRating = (stats?.count_rating > 0 && stats?.total_rating > 0) ? stats.total_rating / stats.count_rating : 6.0;
        const formRating = Math.min(100, Math.max(0, Math.round(((avgRating - 5.0) / 3.5) * 100)));

        const appearances = stats?.appearances || 1;
        const goalsPerApp = (stats?.goals || 0) / appearances;
        const goalThreat = Math.min(100, Math.round(goalsPerApp * 50 + (intel.goal_share_pct || 0) * 0.5));
        const assistsPerApp = (stats?.assists || 0) / appearances;
        const assistThreat = Math.min(100, Math.round(assistsPerApp * 50 + (intel.assist_share_pct || 0) * 0.5));

        const isDefender = ['G', 'D', 'GK', 'DC', 'DR', 'DL'].includes(lineup.position_code || '');
        const defensiveContribution = isDefender
          ? Math.min(100, Math.round(formRating * 0.6 + fatigueAdjusted * 0.4))
          : Math.min(100, Math.round(formRating * 0.3 + fatigueAdjusted * 0.2 + 30));

        const isCreative = ['M', 'AM', 'CM', 'LM', 'RM', 'LW', 'RW'].includes(lineup.position_code || '');
        const creativityScore = isCreative
          ? Math.min(100, Math.round(formRating * 0.5 + assistThreat * 0.5))
          : Math.min(100, Math.round(formRating * 0.3 + 20));

        const experienceScore = Math.min(100, Math.round(Math.min(appearances / 50, 1) * 100));
        const bigGamePerformance = formQuality?.giant_killer_score
          ? Math.min(100, Math.max(0, Math.round(formQuality.giant_killer_score * 1.2))) : 50;

        const opponentPlayers = isHomePlayer ? awayPlayers : homePlayers;
        const opponentAvgRating = opponentPlayers.reduce((sum: number, p: any) => {
          const s = statsMap.get(p.player_id);
          return sum + ((s?.count_rating > 0 && s?.total_rating > 0) ? s.total_rating / s.count_rating : 6.0);
        }, 0) / Math.max(1, opponentPlayers.length);
        const matchupAdvantage = Math.min(100, Math.max(-100, Math.round(((avgRating - opponentAvgRating) / 1.5) * 50)));

        const impactScore = Math.min(100, Math.round(
          importanceScore * 0.25 + readinessScore * 0.15 + fatigueAdjusted * 0.10 +
          formRating * 0.15 + goalThreat * 0.15 + assistThreat * 0.10 + defensiveContribution * 0.10
        ));
        const impactBand = impactScore >= 80 ? 'HIGH' : impactScore >= 65 ? 'GOOD' : impactScore >= 45 ? 'NEUTRAL' : impactScore >= 30 ? 'LOW' : 'VERY_LOW';

        // ─── INSERT ROUNDED VALUES ──────────────────────────────────────────
        rows.push({
          match_id: match.id,
          player_id: lineup.player_id,
          impact_score: Math.round(impactScore),
          importance_score: Math.round(importanceScore),
          readiness_score: Math.round(readinessScore),
          fatigue_score: Math.round(fatigueScore),
          form_rating: Math.round(formRating),
          goal_threat: Math.round(goalThreat),
          assist_threat: Math.round(assistThreat),
          defensive_contribution: Math.round(defensiveContribution),
          creativity_score: Math.round(creativityScore),
          experience_score: Math.round(experienceScore),
          big_game_performance: Math.round(bigGamePerformance),
          matchup_advantage: Math.round(matchupAdvantage),
          matchup_disadvantage: Math.round(-matchupAdvantage),
          impact_band: impactBand,
          expected_contribution: expectedContribution(impactBand, lineup.position_code),
          calculated_at: new Date().toISOString(),
        });
      }
    }

    // ─── Only upsert if we have rows ────────────────────────────────────────
    if (rows.length === 0) {
      logger.info({ matchesProcessed: matches.length, rowsWritten: 0 }, 'processPlayerMatchImpact completed - no rows generated');
      return { matchesProcessed: matches.length, rowsWritten: 0 };
    }

    const written = await upsertChunked('player_match_impact', rows, 'match_id,player_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processPlayerMatchImpact completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processPlayerMatchImpact failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}
function expectedContribution(band: string, position: string): string {
  const isAttacker = ['F', 'ST', 'CF', 'LW', 'RW', 'AM'].includes(position || '');
  const isMidfielder = ['M', 'CM', 'DM', 'LM', 'RM'].includes(position || '');
  if (band === 'HIGH') return isAttacker ? 'Expected to score or assist' : isMidfielder ? 'Expected to control the game' : 'Expected to be a defensive anchor';
  if (band === 'GOOD') return isAttacker ? 'Likely to influence the attack' : isMidfielder ? 'Likely to contribute in midfield' : 'Likely to be solid defensively';
  if (band === 'NEUTRAL') return 'Expected to play a role but not decisive';
  if (band === 'LOW') return 'Limited impact expected';
  return 'Minimal impact expected';
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. MATCH PERFORMANCE COMPARISON
// ═══════════════════════════════════════════════════════════════════════════
export async function processMatchPerformanceComparison(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processMatchPerformanceComparison started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(
      db.from('matches').select('id, home_team_id, away_team_id, competition').eq('status', 'scheduled').gte('date', now).lte('date', weekOut)
    );
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];
    const matchIds = matches.map((m: any) => m.id);

    const [bettingIntel, formQuality, momentum, matchIntel, scorelines] = await Promise.all([
      fetchAllRows(db.from('team_betting_intelligence').select('team_id, attack_rating, defence_rating, team_quality_score, consistency_score, home_attack_rating, home_defence_rating, away_attack_rating, away_defence_rating').in('team_id', teamIds)),
      fetchAllRows(db.from('team_form_quality').select('team_id, opponent_adjusted_form').in('team_id', teamIds)),
      fetchAllRows(db.from('team_momentum').select('team_id, momentum_score').in('team_id', teamIds)),
      fetchAllRows(db.from('match_intelligence').select('match_id, confidence_score, net_battle_index').in('match_id', matchIds)),
      fetchAllRows(db.from('match_intelligence').select('match_id, predicted_home_goals, predicted_away_goals').in('match_id', matchIds)),
    ]);
    const bettingMap = new Map<number, any>(bettingIntel.map((r: any) => [r.team_id, r]));
    const formMap = new Map<number, any>(formQuality.map((r: any) => [r.team_id, r]));
    const momentumMap = new Map<number, any>(momentum.map((r: any) => [r.team_id, r]));
    const matchIntelMap = new Map<number, any>(matchIntel.map((r: any) => [r.match_id, r]));
    const scorelineMap = new Map<number, any>(scorelines.map((r: any) => [r.match_id, r]));

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const homeId = match.home_team_id, awayId = match.away_team_id;
      const homeBetting = bettingMap.get(homeId), awayBetting = bettingMap.get(awayId);
      const homeForm = formMap.get(homeId), awayForm = formMap.get(awayId);
      const homeMomentum = momentumMap.get(homeId), awayMomentum = momentumMap.get(awayId);
      const matchIntelRow = matchIntelMap.get(match.id);
      const scoreline = scorelineMap.get(match.id);

      const homeAttack = homeBetting?.home_attack_rating ?? homeBetting?.attack_rating ?? 50;
      const awayAttack = awayBetting?.away_attack_rating ?? awayBetting?.attack_rating ?? 50;
      const homeDefence = homeBetting?.home_defence_rating ?? homeBetting?.defence_rating ?? 50;
      const awayDefence = awayBetting?.away_defence_rating ?? awayBetting?.defence_rating ?? 50;
      const midfieldHomeScore = Math.round((homeAttack + homeDefence) / 2);
      const midfieldAwayScore = Math.round((awayAttack + awayDefence) / 2);

      const homeTactical = Math.min(100, Math.max(0, Math.round(((homeForm?.opponent_adjusted_form || 1.5) / 3) * 50 + (homeMomentum?.momentum_score || 0) / 2 + 25)));
      const awayTactical = Math.min(100, Math.max(0, Math.round(((awayForm?.opponent_adjusted_form || 1.5) / 3) * 50 + (awayMomentum?.momentum_score || 0) / 2 + 25)));

      const setPieceHomeScore = Math.min(100, Math.round((homeAttack * 0.4 + homeDefence * 0.6) * 0.8 + 20));
      const setPieceAwayScore = Math.min(100, Math.round((awayAttack * 0.4 + awayDefence * 0.6) * 0.8 + 20));

      const formHomeScore = Math.min(100, Math.round(((homeForm?.opponent_adjusted_form || 1.5) / 3) * 100));
      const formAwayScore = Math.min(100, Math.round(((awayForm?.opponent_adjusted_form || 1.5) / 3) * 100));

      const overallHomeScore = Math.round(homeAttack * 0.20 + homeDefence * 0.20 + midfieldHomeScore * 0.20 + homeTactical * 0.15 + setPieceHomeScore * 0.10 + formHomeScore * 0.15);
      const overallAwayScore = Math.round(awayAttack * 0.20 + awayDefence * 0.20 + midfieldAwayScore * 0.20 + awayTactical * 0.15 + setPieceAwayScore * 0.10 + formAwayScore * 0.15);
      const overallAdvantage = overallHomeScore - overallAwayScore;

      let homeWinProb = 0.35, drawProb = 0.30, awayWinProb = 0.35;
      if (scoreline?.predicted_home_goals != null && scoreline?.predicted_away_goals != null) {
        const ph = scoreline.predicted_home_goals, pa = scoreline.predicted_away_goals, total = ph + pa || 1;
        homeWinProb = Math.min(0.85, 0.3 + (ph / total) * 0.5);
        awayWinProb = Math.min(0.85, 0.3 + (pa / total) * 0.5);
        drawProb = Math.max(0.15, 1 - homeWinProb - awayWinProb);
      }
      const advantageFactor = overallAdvantage / 100;
      homeWinProb = Math.min(0.85, Math.max(0.15, homeWinProb + advantageFactor * 0.3));
      awayWinProb = Math.min(0.85, Math.max(0.15, awayWinProb - advantageFactor * 0.3));
      drawProb = Math.max(0.15, 1 - homeWinProb - awayWinProb);

      const confidenceScore = Math.min(100, Math.round(
        (Math.abs(overallAdvantage) / 10) * 30 +
        (matchIntelRow?.confidence_score || 50) * 0.3 +
        (matchIntelRow?.net_battle_index ? Math.abs(matchIntelRow.net_battle_index) * 10 : 0)
      ));
      const confidenceBand = confidenceScore >= 85 ? 'HIGH' : confidenceScore >= 70 ? 'MODERATE' : confidenceScore >= 55 ? 'LOW' : 'VERY_LOW';

      const homeGoals = scoreline?.predicted_home_goals != null ? Math.round(scoreline.predicted_home_goals) : 1;
      const awayGoals = scoreline?.predicted_away_goals != null ? Math.round(scoreline.predicted_away_goals) : 1;

      rows.push({
        match_id: match.id, home_team_id: homeId, away_team_id: awayId,
        overall_home_score: overallHomeScore, overall_away_score: overallAwayScore, overall_advantage: overallAdvantage,
        overall_advantage_team_id: overallAdvantage > 0 ? homeId : awayId,
        attacking_home_score: homeAttack, attacking_away_score: awayAttack, attacking_advantage: homeAttack - awayAttack,
        defensive_home_score: homeDefence, defensive_away_score: awayDefence, defensive_advantage: homeDefence - awayDefence,
        midfield_home_score: midfieldHomeScore, midfield_away_score: midfieldAwayScore, midfield_advantage: midfieldHomeScore - midfieldAwayScore,
        tactical_home_score: homeTactical, tactical_away_score: awayTactical, tactical_advantage: homeTactical - awayTactical,
        set_piece_home_score: setPieceHomeScore, set_piece_away_score: setPieceAwayScore, set_piece_advantage: setPieceHomeScore - setPieceAwayScore,
        form_home_score: formHomeScore, form_away_score: formAwayScore, form_advantage: formHomeScore - formAwayScore,
        home_win_probability: Math.round(homeWinProb * 1000) / 10, draw_probability: Math.round(drawProb * 1000) / 10, away_win_probability: Math.round(awayWinProb * 1000) / 10,
        predicted_winner_id: homeWinProb > awayWinProb ? homeId : awayId, prediction_confidence: confidenceScore,
        expected_goal_difference: Math.round((homeGoals - awayGoals) * 10) / 10, most_likely_score: `${homeGoals}-${awayGoals}`,
        match_significance: Math.min(100, Math.round((matchIntelRow?.confidence_score || 50) * 0.5 + (Math.abs(overallAdvantage) / 2) * 0.5)),
        confidence_band: confidenceBand, home_goals: homeGoals, away_goals: awayGoals,
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('match_performance_comparison', rows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processMatchPerformanceComparison completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processMatchPerformanceComparison failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. TEAM VERSATILITY (per-match)
// ═══════════════════════════════════════════════════════════════════════════
export async function processTeamVersatility(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processTeamVersatility started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const matchIds = matches.map((m: any) => m.id);

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups')
        .select('match_id, team_id, player_id, position_code, players:player_id(id, primary_position, secondary_position, tertiary_position)')
        .in('match_id', matchIds)
    );
    if (!lineups || lineups.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const groupByMatchTeam = new Map<string, any[]>();
    for (const l of lineups) {
      const key = `${l.match_id}:${l.team_id}`;
      if (!groupByMatchTeam.has(key)) groupByMatchTeam.set(key, []);
      groupByMatchTeam.get(key)!.push(l);
    }

    const rows: any[] = [];
    for (const [key, teamLineups] of groupByMatchTeam) {
      const [matchIdStr, teamIdStr] = key.split(':');
      const matchId = Number(matchIdStr), teamId = Number(teamIdStr);

      let versatileCount = 0, multiZoneCount = 0;
      const positionCounts = new Map<string, number>();
      for (const lineup of teamLineups) {
        const player = lineup.players;
        const positions = [player?.primary_position, player?.secondary_position, player?.tertiary_position].filter(Boolean);
        if (positions.length >= 2) versatileCount++;
        const zones = new Set(positions.map((p: string) => {
          const c = p.toUpperCase();
          if (['G', 'GK', 'D', 'DC', 'DR', 'DL', 'DM'].includes(c)) return 'D';
          if (['M', 'MC', 'ML', 'MR', 'AM', 'RW', 'LW'].includes(c)) return 'M';
          if (['F', 'ST', 'CF'].includes(c)) return 'F';
          return null;
        }).filter(Boolean));
        if (zones.size >= 2) multiZoneCount++;
        const pos = lineup.position_code || 'M';
        positionCounts.set(pos, (positionCounts.get(pos) || 0) + 1);
      }
      const totalPlayers = teamLineups.length || 1;
      const versatilePct = (versatileCount / totalPlayers) * 100;
      const multiZonePct = (multiZoneCount / totalPlayers) * 100;
      const overallVersatility = Math.min(100, Math.round(versatilePct * 0.6 + multiZonePct * 0.4));

      const positionCount = positionCounts.size;
      const tacticalVersatility = Math.min(100, Math.round((positionCount / 4) * 25 + versatilePct * 0.3));
      const positionalVersatility = Math.min(100, Math.round(versatilePct));

      const hasWingers = positionCounts.has('LW') || positionCounts.has('RW') || positionCounts.has('LM') || positionCounts.has('RM');
      const hasCentralMids = (positionCounts.get('CM') || 0) >= 2 || (positionCounts.get('DM') || 0) >= 1;
      const hasStrikers = (positionCounts.get('ST') || 0) >= 1 || (positionCounts.get('CF') || 0) >= 1;
      const hasDefenders = (positionCounts.get('CB') || 0) >= 2 || (positionCounts.get('LB') || 0) >= 1 || (positionCounts.get('RB') || 0) >= 1;
      let formationCount = 1;
      if (hasWingers) formationCount++;
      if (hasCentralMids) formationCount++;
      if (hasStrikers && hasWingers) formationCount++;
      if (hasDefenders && hasCentralMids) formationCount++;
      const formationFlexibility = Math.min(100, Math.round((formationCount / 6) * 100));

      const playerAdaptability = Math.min(100, Math.round(versatilePct * 0.5 + multiZonePct * 0.5));
      const systemCompatibility = Math.min(100, Math.round(
        (positionCount / 8) * 50 + (1 - (positionCounts.size > 0 ? Math.max(...positionCounts.values()) / totalPlayers : 0)) * 50
      ));

      let band = 'RIGID';
      if (overallVersatility >= 80) band = 'EXCELLENT';
      else if (overallVersatility >= 65) band = 'GOOD';
      else if (overallVersatility >= 45) band = 'AVERAGE';
      else if (overallVersatility >= 25) band = 'POOR';

      const preferredFormations = ['4-4-2'];
      if (hasWingers) preferredFormations.push('4-3-3');
      if (hasCentralMids && hasStrikers) preferredFormations.push('3-5-2');

      const strengths = [];
      if (overallVersatility >= 80) strengths.push('EXCELLENT_OVERALL');
      if (versatilePct >= 70) strengths.push('MANY_VERSATILE_PLAYERS');
      if (multiZonePct >= 50) strengths.push('CROSS_ZONE_FLEXIBILITY');
      const weaknesses = [];
      if (overallVersatility < 40) weaknesses.push('LOW_OVERALL_VERSATILITY');
      if (versatilePct < 30) weaknesses.push('FEW_VERSATILE_PLAYERS');
      if (multiZonePct < 20) weaknesses.push('LOW_CROSS_ZONE_FLEXIBILITY');

      rows.push({
        match_id: matchId, team_id: teamId,
        overall_versatility_score: overallVersatility, tactical_versatility_score: tacticalVersatility,
        positional_versatility_score: positionalVersatility, formation_flexibility_score: formationFlexibility,
        player_adaptability_score: playerAdaptability, system_compatibility_score: systemCompatibility,
        versatility_band: band, strengths: strengths.length ? strengths : ['BALANCED'], weaknesses: weaknesses.length ? weaknesses : ['NO_WEAKNESSES'],
        preferred_formations: preferredFormations, alternative_formations: ['3-4-3', '4-2-3-1', '5-3-2'],
        formation_changes_per_match: formationCount > 3 ? 1.5 : 0.5,
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('team_versatility', rows, 'match_id,team_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processTeamVersatility completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamVersatility failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. FORMATION MATCHUP — see migration 028 comment re: detection accuracy
// ═══════════════════════════════════════════════════════════════════════════
export async function processFormationMatchup(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processFormationMatchup started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const matchIds = matches.map((m: any) => m.id);

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups')
        .select('match_id, team_id, player_id, position_code, confidence, players:player_id(id, name)')
        .in('match_id', matchIds)
        .order('rank_in_position', { ascending: true })
    );
    if (!lineups || lineups.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];
    const teamIntel = await fetchAllRows(db.from('team_intelligence').select('team_id, readiness_score').in('team_id', teamIds));
    const intelMap = new Map<number, any>(teamIntel.map((r: any) => [r.team_id, r]));

    const lineupsByMatch = new Map<number, Map<number, any[]>>();
    for (const l of lineups) {
      if (!lineupsByMatch.has(l.match_id)) lineupsByMatch.set(l.match_id, new Map());
      const mm = lineupsByMatch.get(l.match_id)!;
      if (!mm.has(l.team_id)) mm.set(l.team_id, []);
      mm.get(l.team_id)!.push(l);
    }

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const mm = lineupsByMatch.get(match.id);
      if (!mm) continue;
      const homeLineup = mm.get(match.home_team_id) || [];
      const awayLineup = mm.get(match.away_team_id) || [];
      if (homeLineup.length < 9 || awayLineup.length < 9) continue;

      const homeFormation = detectFormation(homeLineup);
      const awayFormation = detectFormation(awayLineup);
      const homeZones = mapToZones(homeLineup);
      const awayZones = mapToZones(awayLineup);

      const homeAdvantages: string[] = [], awayAdvantages: string[] = [], neutralAreas: string[] = [];
      const keyMatchups: any[] = [];
      for (const zone of ['GK', 'DEF', 'MID', 'ATT']) {
        const homeQuality = zoneQuality(homeZones, zone, intelMap.get(match.home_team_id));
        const awayQuality = zoneQuality(awayZones, zone, intelMap.get(match.away_team_id));
        if (homeQuality > awayQuality + 10) homeAdvantages.push(`${zone} superiority (+${Math.round(homeQuality - awayQuality)})`);
        else if (awayQuality > homeQuality + 10) awayAdvantages.push(`${zone} superiority (+${Math.round(awayQuality - homeQuality)})`);
        else neutralAreas.push(`${zone} is evenly matched`);

        const hp = homeZones.filter(p => p.zone === zone), ap = awayZones.filter(p => p.zone === zone);
        for (let i = 0; i < Math.min(hp.length, ap.length); i++) {
          const h = hp[i], a = ap[i];
          if (h && a) {
            const advantage = (h.quality || 50) - (a.quality || 50);
            keyMatchups.push({ home_player: h.name, away_player: a.name, zone, advantage: Math.round(advantage), advantage_team_id: advantage > 0 ? match.home_team_id : match.away_team_id });
          }
        }
      }

      const totalAdvantage = homeAdvantages.length - awayAdvantages.length;
      const matchupEffectiveness = Math.min(100, Math.max(0, 50 + totalAdvantage * 10));

      rows.push({
        match_id: match.id,
        home_formation_vs_away: `${homeFormation} vs ${awayFormation}`, away_formation_vs_home: `${awayFormation} vs ${homeFormation}`,
        matchup_effectiveness: matchupEffectiveness,
        home_advantages: homeAdvantages.length ? homeAdvantages : ['No clear advantages'],
        away_advantages: awayAdvantages.length ? awayAdvantages : ['No clear advantages'],
        neutral_areas: neutralAreas.length ? neutralAreas : ['All zones contested'],
        key_matchups: keyMatchups,
        tactical_notes: tacticalNotes(homeAdvantages, awayAdvantages, homeFormation, awayFormation),
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('formation_matchup', rows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processFormationMatchup completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processFormationMatchup failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}
function detectFormation(lineup: any[]): string {
  const positions = lineup.map(l => l.position_code || 'M');
  const defs = positions.filter(p => ['LB', 'CB', 'RB', 'LWB', 'RWB', 'D'].includes(p)).length;
  const mids = positions.filter(p => ['LM', 'CM', 'RM', 'DM', 'AM', 'LW', 'RW', 'M'].includes(p)).length;
  const atts = positions.filter(p => ['ST', 'CF', 'F'].includes(p)).length;
  if (defs === 4 && mids === 4 && atts === 2) return '4-4-2';
  if (defs === 4 && mids === 3 && atts === 3) return '4-3-3';
  if (defs === 3 && mids === 5 && atts === 2) return '3-5-2';
  return '4-4-2';
}
function mapToZones(lineup: any[]): any[] {
  return lineup.map(l => {
    const pos = l.position_code || 'M';
    let zone = 'MID';
    if (['GK', 'G'].includes(pos)) zone = 'GK';
    else if (['LB', 'CB', 'RB', 'LWB', 'RWB', 'D'].includes(pos)) zone = 'DEF';
    else if (['LW', 'RW', 'ST', 'CF', 'F'].includes(pos)) zone = 'ATT';
    return { player_id: l.player_id, name: l.players?.name || 'Unknown', position: pos, zone, quality: (l.confidence || 0.5) * 100 };
  });
}
function zoneQuality(zones: any[], zone: string, intel: any): number {
  const players = zones.filter(p => p.zone === zone);
  if (players.length === 0) return 50;
  const avgQuality = players.reduce((sum, p) => sum + (p.quality || 50), 0) / players.length;
  const readinessBoost = intel?.readiness_score != null ? intel.readiness_score / 2 : 25;
  return Math.min(100, avgQuality * 0.6 + readinessBoost * 0.4);
}
function tacticalNotes(homeAdv: string[], awayAdv: string[], homeForm: string, awayForm: string): string {
  const notes: string[] = [];
  if (homeAdv.length > awayAdv.length) notes.push(`Home team's ${homeForm} formation appears to counter the away team's ${awayForm} effectively.`);
  else if (awayAdv.length > homeAdv.length) notes.push(`Away team's ${awayForm} formation may neutralize the home team's ${homeForm} setup.`);
  else notes.push(`Both ${homeForm} and ${awayForm} formations are evenly matched tactically.`);
  return notes.join(' ');
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. POSITION ADAPTABILITY
// ═══════════════════════════════════════════════════════════════════════════
export async function processPositionAdaptability(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processPositionAdaptability started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const matchIds = matches.map((m: any) => m.id);
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups')
        .select('match_id, team_id, player_id, position_code, players:player_id(id, primary_position, secondary_position, tertiary_position)')
        .in('match_id', matchIds)
    );
    if (!lineups || lineups.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const positionDepth = await fetchAllRows(db.from('team_position_depth').select('team_id, position_code, player_count, available_count').in('team_id', teamIds));
    const depthMap = new Map<string, any>();
    for (const d of positionDepth) depthMap.set(`${d.team_id}:${d.position_code}`, d);

    const groupByMatch = new Map<string, any[]>();
    for (const l of lineups) {
      const key = `${l.match_id}:${l.team_id}`;
      if (!groupByMatch.has(key)) groupByMatch.set(key, []);
      groupByMatch.get(key)!.push(l);
    }
    const matchById = new Map<number, any>(matches.map((m: any) => [m.id, m]));

    const perTeamRows: any[] = [];
    for (const [key, matchLineups] of groupByMatch) {
      const [matchIdStr, teamIdStr] = key.split(':');
      const matchId = Number(matchIdStr), teamId = Number(teamIdStr);

      let multiPositionPlayers = 0, utilityPlayers = 0, specialistPlayers = 0;
      const playerPositions: string[] = [];
      for (const lineup of matchLineups) {
        const player = lineup.players;
        const positions = [player?.primary_position, player?.secondary_position, player?.tertiary_position].filter(Boolean);
        playerPositions.push(...positions);
        if (positions.length >= 3) { multiPositionPlayers++; utilityPlayers++; }
        else if (positions.length >= 2) multiPositionPlayers++;
        else if (positions.length === 1) specialistPlayers++;
      }
      const avgPositions = playerPositions.length / Math.max(1, matchLineups.length);
      const positionVersatility = Math.min(100, Math.round((avgPositions / 3) * 100));

      const distinctPositions = new Set(playerPositions);
      let qualitySum = 0, qualityCount = 0;
      for (const pos of distinctPositions) {
        const depth = depthMap.get(`${teamId}:${pos}`);
        if (depth && depth.player_count > 0) { qualitySum += (depth.available_count / depth.player_count) * 100; qualityCount++; }
      }
      const coverageQuality = qualityCount > 0 ? Math.round(qualitySum / qualityCount) : 50;

      const isHome = matchById.get(matchId)?.home_team_id === teamId;
      const oppTeamId = isHome ? matchById.get(matchId)?.away_team_id : matchById.get(matchId)?.home_team_id;
      const oppositeData = groupByMatch.get(`${matchId}:${oppTeamId}`);
      let adaptabilityAdvantage = 0;
      if (oppositeData) {
        const oppPositions = oppositeData.flatMap(l => [l.players?.primary_position, l.players?.secondary_position, l.players?.tertiary_position].filter(Boolean));
        const oppAvg = oppPositions.length / Math.max(1, oppositeData.length);
        adaptabilityAdvantage = Math.round((avgPositions - oppAvg) * 20);
      }

      perTeamRows.push({
        match_id: matchId, team_id: teamId, isHome,
        position_versatility: positionVersatility, multi_position_players: multiPositionPlayers,
        utility_players: utilityPlayers, specialist_players: specialistPlayers,
        adaptability_advantage: adaptabilityAdvantage, position_coverage_score: coverageQuality,
      });
    }

    const matchRows = new Map<number, any>();
    for (const r of perTeamRows) {
      if (!matchRows.has(r.match_id)) {
        matchRows.set(r.match_id, {
          match_id: r.match_id,
          home_position_versatility: 0, away_position_versatility: 0,
          home_multi_position_players: 0, away_multi_position_players: 0,
          home_utility_players: 0, away_utility_players: 0,
          home_specialist_players: 0, away_specialist_players: 0,
          adaptability_advantage: 0, position_coverage_score: 0,
        });
      }
      const e = matchRows.get(r.match_id);
      const prefix = r.isHome ? 'home' : 'away';
      e[`${prefix}_position_versatility`] = r.position_versatility;
      e[`${prefix}_multi_position_players`] = r.multi_position_players;
      e[`${prefix}_utility_players`] = r.utility_players;
      e[`${prefix}_specialist_players`] = r.specialist_players;
      e.adaptability_advantage = r.isHome ? r.adaptability_advantage : e.adaptability_advantage;
      e.position_coverage_score = Math.max(e.position_coverage_score, r.position_coverage_score);
    }
    const finalRows = [...matchRows.values()].map((r) => ({ ...r, calculated_at: new Date().toISOString() }));

    const written = await upsertChunked('position_adaptability', finalRows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processPositionAdaptability completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processPositionAdaptability failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. TACTICAL FLEXIBILITY
// ═══════════════════════════════════════════════════════════════════════════
export async function processTacticalFlexibility(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processTacticalFlexibility started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const matchIds = matches.map((m: any) => m.id);
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups')
        .select('match_id, team_id, player_id, position_code, players:player_id(id, primary_position, secondary_position, tertiary_position)')
        .in('match_id', matchIds)
    );
    if (!lineups || lineups.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };

    const teamIntel = await fetchAllRows(db.from('team_intelligence').select('team_id, squad_depth_score, lineup_versatility_score, squad_stability_score').in('team_id', teamIds));
    const intelMap = new Map<number, any>(teamIntel.map((r: any) => [r.team_id, r]));
    const bettingIntel = await fetchAllRows(db.from('team_betting_intelligence').select('team_id, team_quality_score').in('team_id', teamIds));
    const bettingMap = new Map<number, any>(bettingIntel.map((r: any) => [r.team_id, r]));

    const groupByMatch = new Map<string, any[]>();
    for (const l of lineups) {
      const key = `${l.match_id}:${l.team_id}`;
      if (!groupByMatch.has(key)) groupByMatch.set(key, []);
      groupByMatch.get(key)!.push(l);
    }
    const matchById = new Map<number, any>(matches.map((m: any) => [m.id, m]));

    const matchRows = new Map<number, any>();
    for (const [key, matchLineups] of groupByMatch) {
      const [matchIdStr, teamIdStr] = key.split(':');
      const matchId = Number(matchIdStr), teamId = Number(teamIdStr);
      const intel = intelMap.get(teamId), betting = bettingMap.get(teamId);

      const positions = matchLineups.map(l => l.position_code || 'M');
      const uniquePositions = new Set(positions);
      let systemCount = 1;
      if (uniquePositions.has('LW') && uniquePositions.has('RW')) systemCount++;
      if (uniquePositions.has('DM')) systemCount++;
      if (uniquePositions.has('AM')) systemCount++;
      if (positions.filter(p => ['ST', 'CF'].includes(p)).length >= 2) systemCount++;
      if (positions.filter(p => ['CB', 'DC'].includes(p)).length >= 3) systemCount++;

      const versatilePlayers = matchLineups.filter(l => {
        const p = l.players;
        return [p?.primary_position, p?.secondary_position, p?.tertiary_position].filter(Boolean).length >= 2;
      }).length;
      const formationAdaptability = Math.min(100, Math.round((versatilePlayers / Math.max(1, matchLineups.length)) * 60 + (systemCount / 5) * 40));

      const inGameAdaptability = Math.min(100, Math.round(
        (intel?.squad_depth_score ?? 50) * 0.25 + (intel?.lineup_versatility_score ?? 50) * 0.25 +
        (intel?.squad_stability_score ?? 50) * 0.25 + (betting?.team_quality_score ?? 50) * 0.25
      ));
      const flexibilityScore = Math.min(100, Math.round(formationAdaptability * 0.5 + inGameAdaptability * 0.5));

      if (!matchRows.has(matchId)) {
        matchRows.set(matchId, {
          match_id: matchId, home_flexibility_score: 0, away_flexibility_score: 0,
          home_system_count: 0, away_system_count: 0, home_formation_adaptability: 0, away_formation_adaptability: 0,
          home_in_game_adaptability: 0, away_in_game_adaptability: 0, flexibility_advantage: 0, flexibility_notes: '',
        });
      }
      const isHome = matchById.get(matchId)?.home_team_id === teamId;
      const e = matchRows.get(matchId);
      const prefix = isHome ? 'home' : 'away';
      e[`${prefix}_flexibility_score`] = flexibilityScore;
      e[`${prefix}_system_count`] = systemCount;
      e[`${prefix}_formation_adaptability`] = formationAdaptability;
      e[`${prefix}_in_game_adaptability`] = inGameAdaptability;
      e.flexibility_notes = flexibilityNotes(flexibilityScore, systemCount);
    }
    for (const e of matchRows.values()) e.flexibility_advantage = e.home_flexibility_score - e.away_flexibility_score;
    const finalRows = [...matchRows.values()].map(r => ({ ...r, calculated_at: new Date().toISOString() }));

    const written = await upsertChunked('tactical_flexibility', finalRows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processTacticalFlexibility completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processTacticalFlexibility failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}
function flexibilityNotes(flexibility: number, systemCount: number): string {
  if (flexibility >= 80) return `Highly flexible team with ${systemCount} systems. Can adapt to any tactical situation.`;
  if (flexibility >= 60) return `Moderately flexible with ${systemCount} systems. Has plan B and C.`;
  if (flexibility >= 40) return 'Limited flexibility. Best with primary system.';
  return 'Rigid tactical setup. Struggles when forced to adapt.';
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. SUBSTITUTION IMPACT — bench = real predicted-XI complement (fixed)
// ═══════════════════════════════════════════════════════════════════════════
export async function processSubstitutionImpact(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processSubstitutionImpact started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const matchIds = matches.map((m: any) => m.id);
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const lineups = await fetchAllRows(
      db.from('match_predicted_lineups').select('match_id, team_id, player_id').in('match_id', matchIds)
    );
    const xiByMatchTeam = new Map<string, Set<number>>();
    for (const l of lineups) {
      const key = `${l.match_id}:${l.team_id}`;
      if (!xiByMatchTeam.has(key)) xiByMatchTeam.set(key, new Set());
      xiByMatchTeam.get(key)!.add(l.player_id);
    }

    const players = await fetchAllRows(db.from('players').select('id, team_id, position, current_injury').in('team_id', teamIds));
    const playerIntel = await fetchAllRows(db.from('player_intelligence').select('player_id, player_strength_score').in('team_id', teamIds));
    const strengthMap = new Map<number, number>(playerIntel.map((r: any) => [r.player_id, r.player_strength_score ?? 30]));
    const playersByTeam = new Map<number, any[]>();
    for (const p of players) {
      if (p.current_injury) continue;
      if (!playersByTeam.has(p.team_id)) playersByTeam.set(p.team_id, []);
      playersByTeam.get(p.team_id)!.push(p);
    }

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const compute = (teamId: number) => {
        const xi = xiByMatchTeam.get(`${match.id}:${teamId}`);
        const roster = playersByTeam.get(teamId) || [];
        const bench = xi ? roster.filter(p => !xi.has(p.id)) : roster;
        if (bench.length === 0) return null;

        let importanceSum = 0, gameChangers = 0, tacticalSubOptions = 0;
        for (const p of bench) {
          const score = strengthMap.get(p.id) ?? 30;
          importanceSum += score;
          if (score > 60) gameChangers++;
          if (p.position && ['AM', 'LW', 'RW', 'ST', 'CF'].includes(p.position)) tacticalSubOptions++;
        }
        const benchStrength = Math.min(100, Math.round((importanceSum / bench.length) * 1.2));
        const subQuality = Math.min(100, Math.round(benchStrength * 0.6 + (gameChangers / bench.length) * 100 * 0.4));
        const depthScore = Math.min(100, Math.round((bench.length / 11) * 50 + benchStrength * 0.5));
        return { benchStrength, subQuality, tacticalSubOptions, gameChangers, depthScore };
      };

      const home = compute(match.home_team_id), away = compute(match.away_team_id);
      if (!home || !away) continue;
      const substitutionAdvantage = home.benchStrength - away.benchStrength;

      rows.push({
        match_id: match.id,
        home_bench_strength: home.benchStrength, away_bench_strength: away.benchStrength,
        home_substitution_quality: home.subQuality, away_substitution_quality: away.subQuality,
        home_tactical_sub_options: home.tacticalSubOptions, away_tactical_sub_options: away.tacticalSubOptions,
        home_game_changers: home.gameChangers, away_game_changers: away.gameChangers,
        home_depth_score: home.depthScore, away_depth_score: away.depthScore,
        substitution_advantage: substitutionAdvantage,
        impact_notes: subImpactNotes(substitutionAdvantage, home, away),
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('substitution_impact', rows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processSubstitutionImpact completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processSubstitutionImpact failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}
function subImpactNotes(advantage: number, home: any, away: any): string {
  const notes: string[] = [];
  if (advantage > 15) notes.push(`Home team has significant bench advantage (+${advantage})`);
  else if (advantage < -15) notes.push(`Away team has significant bench advantage (+${Math.abs(advantage)})`);
  else notes.push('Bench quality is evenly matched');
  if (home.gameChangers > 2) notes.push('Home team has multiple game-changers on bench');
  if (away.gameChangers > 2) notes.push('Away team has multiple game-changers on bench');
  return notes.join('. ');
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. SQUAD DEPTH COMPARISON — depth computed inline (fixed)
// ═══════════════════════════════════════════════════════════════════════════
export async function processSquadDepthComparison(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processSquadDepthComparison started — DB only, zero API calls');
  try {
    const { now, weekOut } = upcomingWindow();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id').eq('status', 'scheduled').gte('date', now).lte('date', weekOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const positionDepth = await fetchAllRows(
      db.from('team_position_depth').select('team_id, position_code, player_count, available_count, injured_count, total_market_value').in('team_id', teamIds)
    );
    const depthByTeam = new Map<number, any[]>();
    for (const d of positionDepth) {
      if (!depthByTeam.has(d.team_id)) depthByTeam.set(d.team_id, []);
      depthByTeam.get(d.team_id)!.push(d);
    }
    const teamIntel = await fetchAllRows(db.from('team_intelligence').select('team_id, squad_depth_score, injury_burden_score').in('team_id', teamIds));
    const intelMap = new Map<number, any>(teamIntel.map((r: any) => [r.team_id, r]));

    const depthScores = new Map<number, any>();
    for (const [teamId, depths] of depthByTeam) {
      const intel = intelMap.get(teamId);
      const posScores = depths.filter(d => d.player_count > 0).map(d => {
        const availability = (d.available_count / d.player_count) * 100;
        const mvScore = d.total_market_value > 0 ? Math.min(100, Math.log10(d.total_market_value + 1) * 10) : 40;
        return availability * 0.6 + mvScore * 0.4;
      });
      const overallDepth = posScores.length > 0 ? Math.round(posScores.reduce((a, b) => a + b, 0) / posScores.length) : 40;
      const depthRating = overallDepth >= 80 ? 'EXCELLENT' : overallDepth >= 65 ? 'GOOD' : overallDepth >= 45 ? 'AVERAGE' : overallDepth >= 25 ? 'POOR' : 'CRITICAL';

      const sorted = [...posScores].sort((a, b) => b - a);
      const qualityDropOff = sorted.length > 1 ? Math.round((sorted[0] - sorted[sorted.length - 1]) / 2) : 20;
      const coverageCompleteness = Math.min(100, Math.round((depths.length / 10) * 100));
      const avgDepth = posScores.length > 0 ? posScores.reduce((a, b) => a + b, 0) / posScores.length : 50;
      const variance = posScores.length > 0 ? posScores.reduce((s, v) => s + (v - avgDepth) ** 2, 0) / posScores.length : 0;
      const positionBalance = Math.max(0, Math.min(100, 100 - Math.sqrt(variance) * 2));

      const rotationCapability = Math.min(100, Math.round(overallDepth * 0.3 + coverageCompleteness * 0.3 + positionBalance * 0.2 + (intel?.squad_depth_score ?? 50) * 0.2));
      const substitutionImpactScore = Math.min(100, Math.round(overallDepth * 0.4 + (intel?.squad_depth_score ?? 50) * 0.3 + (100 - (intel?.injury_burden_score ?? 0)) * 0.3));

      depthScores.set(teamId, { overallDepth, depthRating, qualityDropOff, coverageCompleteness, positionBalance, rotationCapability, substitutionImpact: substitutionImpactScore });
    }

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const homeDepth = depthScores.get(match.home_team_id), awayDepth = depthScores.get(match.away_team_id);
      if (!homeDepth || !awayDepth) continue;
      const depthAdvantageScore = homeDepth.overallDepth - awayDepth.overallDepth;
      const band = Math.abs(depthAdvantageScore) > 25 ? 'STRONG' : Math.abs(depthAdvantageScore) > 15 ? 'MODERATE' : Math.abs(depthAdvantageScore) > 5 ? 'SLIGHT' : 'NEUTRAL';

      rows.push({
        match_id: match.id, home_team_id: match.home_team_id, away_team_id: match.away_team_id,
        home_overall_depth_score: homeDepth.overallDepth, away_overall_depth_score: awayDepth.overallDepth,
        home_depth_rating: homeDepth.depthRating, away_depth_rating: awayDepth.depthRating,
        home_quality_drop_off: homeDepth.qualityDropOff, away_quality_drop_off: awayDepth.qualityDropOff,
        depth_advantage_score: depthAdvantageScore, depth_advantage_team_id: depthAdvantageScore > 0 ? match.home_team_id : match.away_team_id,
        depth_advantage_margin: Math.abs(depthAdvantageScore), depth_advantage_band: band,
        home_rotation_capability: homeDepth.rotationCapability, away_rotation_capability: awayDepth.rotationCapability,
        home_substitution_impact: homeDepth.substitutionImpact, away_substitution_impact: awayDepth.substitutionImpact,
        rotation_advantage: homeDepth.rotationCapability - awayDepth.rotationCapability,
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('match_squad_depth_comparison', rows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processSquadDepthComparison completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processSquadDepthComparison failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. TEAM MOTIVATION — league-table context (tournament_id bug fixed)
// ═══════════════════════════════════════════════════════════════════════════
export async function processTeamMotivation(): Promise<{ teamsProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processTeamMotivation started — DB only, zero API calls');
  try {
    const teams = await fetchAllRows(db.from('teams').select('id'));
    if (!teams || teams.length === 0) return { teamsProcessed: 0, rowsWritten: 0 };
    const teamIds = teams.map((t: any) => t.id);

    const teamIntel = await fetchAllRows(db.from('team_intelligence').select('team_id, readiness_score, congestion_score, travel_fatigue_score').in('team_id', teamIds));
    const intelMap = new Map<number, any>(teamIntel.map((r: any) => [r.team_id, r]));
    const momentumRows = await fetchAllRows(db.from('team_momentum').select('team_id, momentum_score').in('team_id', teamIds));
    const momentumMap = new Map<number, any>(momentumRows.map((r: any) => [r.team_id, r]));
    const formQualityRows = await fetchAllRows(db.from('team_form_quality').select('team_id, opponent_adjusted_form').in('team_id', teamIds));
    const formQualityMap = new Map<number, any>(formQualityRows.map((r: any) => [r.team_id, r]));
    const venueRows = await fetchAllRows(db.from('team_venue_performance').select('team_id, venue_advantage_score').in('team_id', teamIds));
    const venueMap = new Map<number, any>(venueRows.map((r: any) => [r.team_id, r]));

    const standings = await fetchAllRows(
      db.from('tournament_standings').select('team_id, tournament_id, position, matches, points').in('team_id', teamIds).order('season_external_id', { ascending: false })
    );
    const standingsMap = new Map<number, { tournament_id: number; position: number; matches: number; points: number }>();
    const tournamentSizes = new Map<number, number>();
    for (const s of standings) {
      if (!standingsMap.has(s.team_id)) {
        standingsMap.set(s.team_id, { tournament_id: s.tournament_id, position: s.position || 0, matches: s.matches || 0, points: s.points || 0 });
      }
      tournamentSizes.set(s.tournament_id, Math.max(tournamentSizes.get(s.tournament_id) || 0, s.position || 0));
    }

    const rows: any[] = [];
    for (const teamId of teamIds) {
      const intel = intelMap.get(teamId);
      if (!intel) continue;
      const momentum = momentumMap.get(teamId), formQuality = formQualityMap.get(teamId), venue = venueMap.get(teamId), standing = standingsMap.get(teamId);

      const momentumFactor = momentum?.momentum_score != null ? Math.min(100, Math.max(0, 50 + momentum.momentum_score * 2)) : 50;
      const qualityFactor = Math.min(100, Math.round(((formQuality?.opponent_adjusted_form || 1.5) / 3) * 60 + (intel.readiness_score || 50) * 0.4));
      const venueFactor = venue?.venue_advantage_score != null ? Math.min(100, Math.round(venue.venue_advantage_score)) : 50;
      const fatigueFactor = Math.max(0, Math.min(100, 100 - ((intel.congestion_score || 0) * 0.5 + (intel.travel_fatigue_score || 0) * 0.5)));

      let externalMotivation = 50;
      if (standing) {
        const leagueSize = tournamentSizes.get(standing.tournament_id) || 20;
        if (standing.position <= 3) externalMotivation = 95;
        else if (standing.position <= 6) externalMotivation = 85;
        else if (standing.position <= leagueSize * 0.6) externalMotivation = 40;
        else if (standing.position > leagueSize - 5) externalMotivation = 90;
        const gamesRemaining = 38 - (standing.matches || 0);
        if (gamesRemaining > 10 && (standing.position <= 3 || standing.position > leagueSize - 5)) externalMotivation = Math.min(100, externalMotivation + 5);
      }

      const overallMotivation = Math.min(100, Math.round(momentumFactor * 0.25 + qualityFactor * 0.20 + venueFactor * 0.15 + fatigueFactor * 0.15 + externalMotivation * 0.25));
      const band = overallMotivation >= 75 ? 'HIGH' : overallMotivation >= 60 ? 'GOOD' : overallMotivation >= 45 ? 'NEUTRAL' : overallMotivation >= 30 ? 'LOW' : 'VERY_LOW';

      rows.push({
        team_id: teamId, overall_motivation_score: overallMotivation, motivation_band: band,
        momentum_factor: Math.round(momentumFactor), quality_factor: qualityFactor, venue_factor: venueFactor,
        fatigue_factor: Math.round(fatigueFactor), external_motivation: externalMotivation,
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('team_motivation', rows, 'team_id');
    logger.info({ teamsProcessed: teamIds.length, rowsWritten: written }, 'processTeamMotivation completed');
    return { teamsProcessed: teamIds.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processTeamMotivation failed');
    return { teamsProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. MATCH IMPACT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
export async function processMatchImpactSummary(): Promise<{ matchesProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processMatchImpactSummary started — DB only, zero API calls');
  try {
    const now = new Date().toISOString();
    const twoWeeksOut = new Date(Date.now() + 14 * 86400000).toISOString();
    const matches = await fetchAllRows(db.from('matches').select('id, home_team_id, away_team_id, competition').eq('status', 'scheduled').gte('date', now).lte('date', twoWeeksOut));
    if (!matches || matches.length === 0) return { matchesProcessed: 0, rowsWritten: 0 };
    const teamIds = [...new Set(matches.flatMap((m: any) => [m.home_team_id, m.away_team_id]))];

    const motivationRows = await fetchAllRows(db.from('team_motivation').select('team_id, overall_motivation_score, motivation_band').in('team_id', teamIds));
    const motivationMap = new Map<number, any>(motivationRows.map((r: any) => [r.team_id, r]));
    const teamIntel = await fetchAllRows(db.from('team_intelligence').select('team_id, form_index').in('team_id', teamIds));
    const intelMap = new Map<number, any>(teamIntel.map((r: any) => [r.team_id, r]));
    const standings = await fetchAllRows(db.from('tournament_standings').select('team_id, position, points').in('team_id', teamIds).order('season_external_id', { ascending: false }));
    const standingsMap = new Map<number, { position: number; points: number }>();
    for (const s of standings) if (!standingsMap.has(s.team_id)) standingsMap.set(s.team_id, { position: s.position || 0, points: s.points || 0 });

    const rows: any[] = [];
    for (const match of matches as any[]) {
      const homeMotivation = motivationMap.get(match.home_team_id), awayMotivation = motivationMap.get(match.away_team_id);
      const homeIntel = intelMap.get(match.home_team_id), awayIntel = intelMap.get(match.away_team_id);
      const homeStanding = standingsMap.get(match.home_team_id), awayStanding = standingsMap.get(match.away_team_id);

      let significanceScore = 50;
      if (homeStanding && awayStanding) {
        const posDiff = Math.abs(homeStanding.position - awayStanding.position);
        significanceScore += posDiff <= 3 ? 20 : posDiff <= 6 ? 10 : 5;
        const pointsDiff = Math.abs(homeStanding.points - awayStanding.points);
        significanceScore += pointsDiff <= 3 ? 15 : pointsDiff <= 6 ? 10 : pointsDiff <= 10 ? 5 : 0;
      }
      const avgMotivation = ((homeMotivation?.overall_motivation_score || 50) + (awayMotivation?.overall_motivation_score || 50)) / 2;
      significanceScore += avgMotivation >= 75 ? 20 : avgMotivation >= 60 ? 15 : avgMotivation >= 45 ? 10 : 5;
      const formDiff = Math.abs((homeIntel?.form_index || 50) - (awayIntel?.form_index || 50));
      significanceScore += formDiff <= 10 ? 15 : formDiff <= 20 ? 10 : 5;
      const comp = match.competition || '';
      significanceScore += /Champions League|World Cup/.test(comp) ? 20 : /Europa|Copa/.test(comp) ? 15 : /Cup|Derby/.test(comp) ? 10 : 5;

      let rivalryScore = 0;
      if (/Derby/.test(comp)) rivalryScore += 20;
      if (/Classico|El Clasico/.test(comp)) rivalryScore += 25;
      if (homeStanding && awayStanding && Math.abs(homeStanding.position - awayStanding.position) <= 2) rivalryScore += 10;

      const finalSignificance = Math.min(100, Math.round(significanceScore + Math.min(20, rivalryScore)));
      const importanceBand = finalSignificance >= 80 ? 'HIGH' : finalSignificance >= 60 ? 'MODERATE' : finalSignificance >= 40 ? 'LOW' : 'VERY_LOW';

      let momentumAtStake = 50;
      if (homeStanding && awayStanding) {
        const posDiff = Math.abs(homeStanding.position - awayStanding.position);
        momentumAtStake += posDiff <= 2 ? 30 : posDiff <= 5 ? 20 : posDiff <= 10 ? 10 : 0;
      }
      if (finalSignificance >= 70) momentumAtStake += 10;

      rows.push({
        match_id: match.id, significance_score: finalSignificance, importance_band: importanceBand,
        rivalry_score: Math.min(100, rivalryScore), momentum_at_stake: Math.min(100, momentumAtStake),
        calculated_at: new Date().toISOString(),
      });
    }

    const written = await upsertChunked('match_impact_summary', rows, 'match_id');
    logger.info({ matchesProcessed: matches.length, rowsWritten: written }, 'processMatchImpactSummary completed');
    return { matchesProcessed: matches.length, rowsWritten: written };
  } catch (error: any) {
    logger.error({ error: error.message }, 'processMatchImpactSummary failed');
    return { matchesProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. PLAYER VERSATILITY — individual player positional flexibility
// ═══════════════════════════════════════════════════════════════════════════
export async function processPlayerVersatility(): Promise<{ playersProcessed: number; rowsWritten: number; error?: string }> {
  logger.info('processPlayerVersatility started — DB only, zero API calls');
  try {
    // ─── 1. Get all players with position data ──────────────────────────────
    const players = await fetchAllRows(
      db.from('players')
        .select('id, primary_position, secondary_position, tertiary_position, position_detailed')
    );
    if (!players || players.length === 0) {
      logger.warn('No players found — run sync:squads:v2 first');
      return { playersProcessed: 0, rowsWritten: 0 };
    }

    // ─── 2. Get player season stats for games at position ──────────────────
    const seasonStats = await fetchAllRows(
      db.from('player_season_statistics')
        .select('player_id, appearances, matches_started, minutes_played')
        .order('season_external_id', { ascending: false })
    );

    // Keep most recent season per player
    const statsMap = new Map<number, any>();
    for (const s of seasonStats) {
      const existing = statsMap.get(s.player_id);
      if (existing && existing.season_external_id >= (s.season_external_id ?? 0)) continue;
      statsMap.set(s.player_id, s);
    }

    // ─── 3. Get player intelligence for context ─────────────────────────────
    const playerIntel = await fetchAllRows(
      db.from('player_intelligence')
        .select('player_id, importance_score, readiness_score, fatigue_score')
    );
    const intelMap = new Map<number, any>(playerIntel.map((r: any) => [r.player_id, r]));

    // ─── 4. Compute versatility per player ──────────────────────────────────
    const rows: any[] = [];

    for (const player of players) {
      const primary = player.primary_position;
      const secondary = player.secondary_position;
      const tertiary = player.tertiary_position;
      const positionDetailed = player.position_detailed;

      // ─── Collect all positions ─────────────────────────────────────────────
      let allPositions: string[] = [];
      
      // Parse position_detailed (comma-separated like "DR,DC" or "MC,DM,AM")
      if (positionDetailed && positionDetailed.trim()) {
        const parsed = positionDetailed.split(',').map((p: string) => p.trim()).filter(Boolean);
        allPositions = [...allPositions, ...parsed];
      }
      
      // Add primary/secondary/tertiary if not already in the list
      if (primary && !allPositions.includes(primary)) allPositions.push(primary);
      if (secondary && !allPositions.includes(secondary)) allPositions.push(secondary);
      if (tertiary && !allPositions.includes(tertiary)) allPositions.push(tertiary);

      // Fallback: if no positions found, use a default
      if (allPositions.length === 0) {
        allPositions = ['MID'];
      }

      // ─── Count unique positions ────────────────────────────────────────────
      const uniquePositions = [...new Set(allPositions)];
      const positionsCount = uniquePositions.length;

      // ─── Calculate versatility score ──────────────────────────────────────
      // 1 position = 0, 2 positions = 50, 3+ positions = 100
      const versatilityScore = Math.min(100, Math.round(((positionsCount - 1) / 3) * 100));

      // ─── Zone coverage ─────────────────────────────────────────────────────
      const zones = new Set();
      for (const pos of uniquePositions) {
        const zone = codeToZone(pos);
        if (zone) zones.add(zone);
      }
      const zonesCovered = zones.size;
      const adaptabilityScore = Math.min(100, Math.round((zonesCovered / 3) * 100));

      // ─── Utility rating ────────────────────────────────────────────────────
      // A player who can play in multiple zones is more useful
      const utilityRating = Math.min(100, Math.round(
        (positionsCount / 5) * 50 +
        (zonesCovered / 3) * 50
      ));

      // ─── Primary position rating ──────────────────────────────────────────
      const stats = statsMap.get(player.id);
      const appearances = stats?.appearances || 0;
      const matchesStarted = stats?.matches_started || 0;
      const minutesPlayed = stats?.minutes_played || 0;

      // Rating based on playing time
      const gamesAtPosition = Math.max(1, appearances || 1);
      const positionRating = Math.min(100, Math.round(
        (matchesStarted / Math.max(1, appearances)) * 50 +
        Math.min(1, minutesPlayed / 1000) * 50
      ));

      // ─── Overall versatility ──────────────────────────────────────────────
      const intel = intelMap.get(player.id);
      const importance = intel?.importance_score || 50;
      
      const overallVersatility = Math.min(100, Math.round(
        versatilityScore * 0.30 +
        adaptabilityScore * 0.25 +
        utilityRating * 0.20 +
        positionRating * 0.15 +
        importance * 0.10
      ));

      // ─── Determine if player is a specialist or utility ──────────────────
      const specialistThreshold = 70;
      const isSpecialist = overallVersatility < specialistThreshold && positionsCount <= 2;

      rows.push({
        player_id: player.id,
        positions_played: uniquePositions,
        primary_position_rating: positionRating,
        secondary_position_rating: positionsCount >= 2 ? Math.round(positionRating * 0.8) : null,
        tertiary_position_rating: positionsCount >= 3 ? Math.round(positionRating * 0.6) : null,
        versatility_score: versatilityScore,
        adaptability_score: adaptabilityScore,
        utility_rating: utilityRating,
        games_at_position: appearances || 0,
        position_rating: positionRating,
        overall_versatility: overallVersatility,
        calculated_at: new Date().toISOString(),
      });
    }

    // ─── 5. Upsert ─────────────────────────────────────────────────────────────
    const written = await upsertChunked('player_versatility', rows, 'player_id');
    logger.info({ playersProcessed: players.length, rowsWritten: written }, 'processPlayerVersatility completed');
    return { playersProcessed: players.length, rowsWritten: written };

  } catch (error: any) {
    logger.error({ error: error.message }, 'processPlayerVersatility failed');
    return { playersProcessed: 0, rowsWritten: 0, error: error.message };
  }
}

// ─── Helper: Convert position code to zone ──────────────────────────────────
function codeToZone(code: string): string | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (['G', 'GK'].includes(c)) return 'GK';
  if (['D', 'DC', 'DR', 'DL', 'CB', 'LB', 'RB', 'SW', 'LWB', 'RWB'].includes(c)) return 'DEF';
  if (['M', 'MC', 'CM', 'DM', 'AM', 'LM', 'RM', 'CDM', 'CAM'].includes(c)) return 'MID';
  if (['F', 'ST', 'CF', 'LW', 'RW', 'SS', 'WF'].includes(c)) return 'ATT';
  return null;
}
