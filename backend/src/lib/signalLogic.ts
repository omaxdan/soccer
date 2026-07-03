// ─── BETTING SIGNAL LOGIC — backend port ─────────────────────────────────────
// Exact port of frontend/src/lib/signals.ts's computeMatchSignals(). That
// function is pure (input object -> output array, no React/browser
// dependencies) — moved here so it can run once per sync cycle and write to
// match_signals, instead of recomputing fresh in every browser on every page
// load. See migration 013_match_signals.sql for the full reasoning.
//
// IMPORTANT: keep this in sync with frontend/src/lib/signals.ts's
// computeMatchSignals() by hand — this is a genuine duplication (no shared
// package between backend/ and frontend/ in this monorepo), not a shared
// import. The frontend copy still exists as a live-compute FALLBACK for any
// match that doesn't have a precomputed row yet (see matches/[slug]/page.tsx
// and betting/page.tsx) — that fallback intentionally still uses its own
// local copy, so a bug fix here needs mirroring there too, and vice versa.

export interface MatchSignalInput {
  home_readiness?: number | null;
  away_readiness?: number | null;
  readiness_gap?: number | null;
  congestion_factor?: number | null;
  home_rest_days?: number | null;
  away_rest_days?: number | null;
  home_travel_distance_km?: number | null;
  away_travel_distance_km?: number | null;
  travel_advantage_km?: number | null;
  home_active_competitions?: number | null;
  away_active_competitions?: number | null;
  home_form_index?: number | null;
  away_form_index?: number | null;
  home_travel_fatigue?: number | null;
  away_travel_fatigue?: number | null;
  home_congestion?: number | null;
  away_congestion?: number | null;
  home_last_5_pts?: number | null;
  away_last_5_pts?: number | null;
  home_squad_depth?: number | null;
  away_squad_depth?: number | null;
  home_injury_burden?: number | null;
  away_injury_burden?: number | null;
  home_squad_stability?: number | null;
  away_squad_stability?: number | null;
  home_goals_for_5?: number | null;
  home_goals_against_5?: number | null;
  away_goals_for_5?: number | null;
  away_goals_against_5?: number | null;
  home_clean_sheets_10?: number | null;
  away_clean_sheets_10?: number | null;
}

export interface Signal {
  market: string;
  group: '1x2' | 'goals' | 'competition' | 'halftime' | 'cards';
  signal: string;
  direction: 'home' | 'away' | 'neutral' | 'avoid';
  strength: number;
  drivers: string;
  dataSource?: 'squad' | 'form' | 'travel' | 'mixed';
  locked?: boolean;
}

export function computeMatchSignals(m: MatchSignalInput): Signal[] {
  const signals: Signal[] = [];

  const gap        = m.readiness_gap ?? ((m.home_readiness ?? 0) - (m.away_readiness ?? 0));
  const homeRest   = m.home_rest_days ?? 0;
  const awayRest   = m.away_rest_days ?? 0;
  const restDiff   = homeRest - awayRest;
  const awayKm     = m.away_travel_distance_km ?? 0;
  const homeKm     = m.home_travel_distance_km ?? 0;
  const congestion = m.congestion_factor ?? 0;
  const homeComps  = m.home_active_competitions ?? 0;
  const awayComps  = m.away_active_competitions ?? 0;
  const homeForm   = m.home_form_index ?? 0;
  const awayForm   = m.away_form_index ?? 0;
  const homeFat    = m.home_travel_fatigue ?? 0;
  const awayFat    = m.away_travel_fatigue ?? 0;
  const homeCong   = m.home_congestion ?? 0;
  const awayCong   = m.away_congestion ?? 0;

  const homeDepth    = m.home_squad_depth ?? null;
  const awayDepth    = m.away_squad_depth ?? null;
  const homeInjury   = m.home_injury_burden ?? null;
  const awayInjury   = m.away_injury_burden ?? null;
  const homeStab     = m.home_squad_stability ?? null;
  const awayStab     = m.away_squad_stability ?? null;
  const hasSquadData = homeDepth != null || homeInjury != null || homeStab != null;

  const homeAdvantage = (m.home_readiness ?? 0) > (m.away_readiness ?? 0);
  const favDir: 'home' | 'away' = homeAdvantage ? 'home' : 'away';
  const favLabel = homeAdvantage ? 'HOME WIN' : 'AWAY WIN';

  // ── 1X2 ──────────────────────────────────────────────────────────────────
  {
    let str = 0;
    const driv: string[] = [];
    if (gap > 15)                        { str += 2; driv.push(`Readiness gap ${Math.round(gap)}pts`); }
    else if (gap > 8)                    { str += 1; driv.push(`Readiness gap ${Math.round(gap)}pts`); }
    if (Math.abs(restDiff) > 2)          { str += 2; driv.push(`Rest +${Math.abs(restDiff).toFixed(1)}d`); }
    else if (Math.abs(restDiff) > 1)     { str += 1; }
    if (awayKm > 800)                    { str += 1; driv.push(`Travel ${Math.round(awayKm)}km`); }
    if (awayKm > 1500)                   { str += 1; }
    if (homeForm > 70)                   { str += 1; driv.push(`Form ${Math.round(homeForm)}`); }
    if (homeInjury != null && awayInjury != null) {
      const injDiff = awayInjury - homeInjury;
      if (injDiff > 20)   { str += 2; driv.push(`Away injury burden +${Math.round(injDiff)}`); }
      else if (injDiff > 10) { str += 1; driv.push(`Away injury burden +${Math.round(injDiff)}`); }
    }

    signals.push({
      market: 'Match Result (1X2)', group: '1x2',
      signal: gap < 8 ? 'No Edge' : favLabel,
      direction: gap < 8 ? 'neutral' : favDir,
      strength: Math.min(6, str),
      drivers: driv.join(', ') || 'Insufficient gap',
      dataSource: hasSquadData ? 'mixed' : 'form',
    });

    signals.push({
      market: 'Double Chance (1X)', group: '1x2',
      signal: homeForm > 70 ? 'Home / Draw' : gap < 5 ? 'Draw ✓' : `${homeAdvantage ? 'Home' : 'Away'} / Draw`,
      direction: homeAdvantage ? 'home' : 'away',
      strength: Math.min(6, Math.round(str * 0.8) + 1),
      drivers: `Form index ${Math.round(homeForm)}/100`,
    });
  }

  // ── OVER / UNDER ─────────────────────────────────────────────────────────
  {
    const underSignal = congestion > 65 && awayFat > 60;
    const overSignal  = ((m.home_readiness ?? 0) + (m.away_readiness ?? 0)) / 2 > 70
                        && (homeForm + awayForm) / 2 > 65;

    let str = 0;
    let sig = 'No Edge'; let dir: 'home' | 'away' | 'neutral' = 'neutral';

    if (underSignal) {
      str = 2;
      if (congestion > 75) str++;
      if (awayFat > 70)    str++;
      if (awayKm > 800)    str++;
      sig = 'Under 2.5 ↓'; dir = 'neutral';
    } else if (overSignal) {
      str = 3;
      sig = 'Over 2.5 ↑'; dir = 'neutral';
    }

    signals.push({
      market: 'Over/Under Goals', group: 'goals',
      signal: sig, direction: dir, strength: Math.min(6, str),
      drivers: underSignal
        ? `Congestion ${Math.round(congestion)}/100, travel fatigue ${Math.round(awayFat)}/100`
        : `Avg readiness ${Math.round(((m.home_readiness ?? 0) + (m.away_readiness ?? 0)) / 2)}/100`,
    });

    signals.push({
      market: 'Total Goals O/U', group: 'goals',
      signal: congestion > 65 ? 'Under 2.5' : 'Over 2.5',
      direction: 'neutral', strength: Math.min(6, underSignal ? 3 : 2),
      drivers: `Congestion factor ${Math.round(congestion)}/100`,
    });

    const homePts5 = m.home_last_5_pts ?? 0;
    signals.push({
      market: 'Home Team Goals', group: 'goals',
      signal: homePts5 >= 9 ? 'Over 1.5' : 'No Edge',
      direction: homePts5 >= 9 ? 'home' : 'neutral',
      strength: homePts5 >= 12 ? 4 : homePts5 >= 9 ? 3 : 1,
      drivers: `Home form: ${homePts5}/15 pts`,
    });

    signals.push({
      market: 'Away Team Goals', group: 'goals',
      signal: awayFat > 70 ? 'Under 1.5' : 'No Edge',
      direction: 'neutral',
      strength: awayFat > 80 ? 4 : awayFat > 70 ? 3 : 1,
      drivers: `Travel fatigue ${Math.round(awayFat)}/100, ${Math.round(awayKm)}km traveled`,
    });
  }

  // ── BTTS ─────────────────────────────────────────────────────────────────
  {
    const homeScored   = (m.home_goals_for_5 ?? 5) >= 4;
    const awayScored   = (m.away_goals_for_5 ?? 5) >= 4;
    const homeClean    = (m.home_goals_against_5 ?? 5) <= 2;
    const awayStruggle = awayFat > 70;
    const bttsSig      = homeScored && awayScored && !awayStruggle;

    signals.push({
      market: 'BTTS', group: 'goals',
      signal: bttsSig ? 'Yes' : (homeClean || awayStruggle) ? 'No' : 'No Edge',
      direction: 'neutral', strength: bttsSig ? 3 : homeClean ? 3 : 2,
      drivers: awayStruggle
        ? `Away travel fatigue ${Math.round(awayFat)}/100`
        : `Both teams scoring form analysis`,
    });
  }

  // ── COMPETITION MARKETS ───────────────────────────────────────────────────
  {
    const compDiff = awayComps - homeComps;
    signals.push({
      market: 'Competition Load', group: 'competition',
      signal: compDiff > 1 ? 'Away Disadvantage' : compDiff < -1 ? 'Home Disadvantage' : 'Balanced',
      direction: compDiff > 1 ? 'home' : compDiff < -1 ? 'away' : 'neutral',
      strength: Math.min(6, Math.abs(compDiff) * 2 + 1),
      drivers: `Away in ${awayComps} competitions vs Home in ${homeComps}`,
    });

    {
      let sig = 'No signal'; let dir: 'home' | 'away' | 'neutral' = 'neutral'; let str = 2;
      const driv: string[] = [];

      if (hasSquadData && homeStab != null && awayStab != null) {
        const stabDiff = homeStab - awayStab;
        if (stabDiff > 15)       { sig = 'Away Rotating'; dir = 'home'; str = 4; driv.push(`Stability H:${Math.round(homeStab)} A:${Math.round(awayStab)}`); }
        else if (stabDiff < -15) { sig = 'Home Rotating'; dir = 'away'; str = 4; driv.push(`Stability H:${Math.round(homeStab)} A:${Math.round(awayStab)}`); }
        else                     { sig = 'Stable'; driv.push(`Both stable: H:${Math.round(homeStab)} A:${Math.round(awayStab)}`); }
      } else if (awayComps > 2) {
        sig = 'Away rotating (estimated)'; dir = 'home'; str = 3;
        driv.push(`Away in ${awayComps} competitions — squad data pending`);
      }

      signals.push({
        market: 'Rotation Pressure', group: 'competition',
        signal: sig, direction: dir, strength: str,
        drivers: driv.join(', ') || `${awayComps > 2 ? 'Away' : 'No team'} in ${Math.max(homeComps, awayComps)} competitions`,
        dataSource: hasSquadData ? 'squad' : 'form',
        locked: true,
      });
    }
  }

  // ── SQUAD DEPTH ADVANTAGE ─────────────────────────────────────────────────
  if (hasSquadData && homeDepth != null && awayDepth != null) {
    const depthDiff = homeDepth - awayDepth;
    const dir: 'home' | 'away' | 'neutral' = Math.abs(depthDiff) < 10 ? 'neutral' : depthDiff > 0 ? 'home' : 'away';
    signals.push({
      market: 'Squad Depth', group: 'competition',
      signal: Math.abs(depthDiff) < 10 ? 'Even'
        : depthDiff > 20 ? 'Home Depth Advantage'
        : depthDiff < -20 ? 'Away Depth Advantage'
        : `${depthDiff > 0 ? 'Home' : 'Away'} Slight Edge`,
      direction: dir,
      strength: Math.min(6, Math.round(Math.abs(depthDiff) / 10) + 1),
      drivers: `Squad depth H:${Math.round(homeDepth)} A:${Math.round(awayDepth)}`,
      dataSource: 'squad',
      locked: true,
    });
  }

  // ── KEY INJURY BURDEN ─────────────────────────────────────────────────────
  if (hasSquadData && homeInjury != null && awayInjury != null) {
    const injDiff  = awayInjury - homeInjury;
    const worstSide = injDiff > 0 ? 'Away' : 'Home';
    const dir: 'home' | 'away' | 'neutral' = Math.abs(injDiff) < 10 ? 'neutral' : injDiff > 0 ? 'home' : 'away';
    signals.push({
      market: 'Injury Burden', group: 'competition',
      signal: Math.abs(injDiff) < 10 ? 'Both Healthy'
        : `${worstSide} Injury Risk`,
      direction: dir,
      strength: Math.min(6, Math.round(Math.abs(injDiff) / 10) + 1),
      drivers: `Injury burden H:${Math.round(homeInjury)} A:${Math.round(awayInjury)}`,
      dataSource: 'squad',
      locked: true,
    });
  }

  // ── HALF-TIME MARKETS ─────────────────────────────────────────────────────
  {
    const htHomeWin = restDiff > 1 && homeAdvantage;
    signals.push({
      market: 'First Half Result', group: 'halftime',
      signal: htHomeWin ? 'Home Win HT' : 'No Edge',
      direction: htHomeWin ? 'home' : 'neutral',
      strength: htHomeWin ? 3 : 1,
      drivers: `Rest differential ${restDiff.toFixed(1)}d, form ${Math.round(homeForm)}/100`,
    });

    {
      let sig = 'No Edge'; let dir: 'home' | 'away' | 'neutral' = 'neutral'; let str = 2;
      let driv = 'Signal quality improves with player data';
      if (htHomeWin) {
        sig = 'Home/Home'; dir = 'home'; str = 3;
        driv = `Rest ${restDiff.toFixed(1)}d advantage`;
        if (hasSquadData && homeStab != null && homeStab > 70) {
          str = 4;
          driv += `, squad stability ${Math.round(homeStab)}/100`;
        }
      }
      signals.push({
        market: 'HT/FT', group: 'halftime',
        signal: sig, direction: dir, strength: str,
        drivers: driv,
        dataSource: hasSquadData ? 'mixed' : 'form',
        locked: true,
      });
    }

    signals.push({
      market: '2nd Half Goals', group: 'halftime',
      signal: awayFat > 60 ? 'Over 1.5' : 'No Edge',
      direction: 'neutral', strength: awayFat > 70 ? 4 : 2,
      drivers: `Tired away side opens up — fatigue ${Math.round(awayFat)}/100`,
    });
  }

  // ── CARDS ─────────────────────────────────────────────────────────────────
  {
    const cardSignal = awayKm > 1000 && congestion > 60 && homeComps >= 2 && awayComps >= 2;
    signals.push({
      market: 'Cards Issued', group: 'cards',
      signal: cardSignal ? 'Over 3.5' : 'No Edge',
      direction: 'neutral',
      strength: cardSignal ? (awayKm > 1500 ? 5 : 4) : 1,
      drivers: cardSignal
        ? `Away traveled ${Math.round(awayKm)}km, congestion ${Math.round(congestion)}/100`
        : 'Travel/congestion below threshold',
    });
  }

  // ── CLEAN SHEET ───────────────────────────────────────────────────────────
  {
    const homeCS = awayFat > 65 && awayCong > 70 && homeForm > 65;
    signals.push({
      market: 'Clean Sheet (Home)', group: '1x2',
      signal: homeCS ? 'Yes Lean' : 'No Edge',
      direction: homeCS ? 'home' : 'neutral',
      strength: homeCS ? (awayFat > 75 ? 4 : 3) : 1,
      drivers: homeCS
        ? `Away fatigue ${Math.round(awayFat)}/100, congestion ${Math.round(awayCong)}/100`
        : 'Away fatigue below threshold',
    });

    signals.push({
      market: 'Away Win (Avoid)', group: '1x2',
      signal: awayKm > 1500 && awayCong > 70 ? 'Avoid' : 'No Flag',
      direction: awayKm > 1500 && awayCong > 70 ? 'avoid' : 'neutral',
      strength: awayKm > 1500 && awayCong > 70 ? 5 : 1,
      drivers: `${Math.round(awayKm)}km traveled, congestion ${Math.round(awayCong)}/100`,
    });
  }

  // ── ASIAN HANDICAP ────────────────────────────────────────────────────────
  {
    let handicap = 'Level'; let str = 1;
    if (gap >= 30)      { handicap = `${favDir === 'home' ? 'Home' : 'Away'} -1.5`; str = 5; }
    else if (gap >= 20) { handicap = `${favDir === 'home' ? 'Home' : 'Away'} -1`;   str = 4; }
    else if (gap >= 10) { handicap = `${favDir === 'home' ? 'Home' : 'Away'} -0.5`; str = 3; }

    signals.push({
      market: 'Asian Handicap', group: '1x2',
      signal: handicap, direction: gap >= 10 ? favDir : 'neutral',
      strength: Math.min(6, str),
      drivers: `Readiness gap ${Math.round(gap)}pts`,
      locked: true,
    });
  }

  // ── SPECIALS ──────────────────────────────────────────────────────────────
  {
    signals.push({
      market: 'Win to Nil (Home)', group: '1x2',
      signal: homeForm > 75 && awayFat > 65 ? 'Yes Lean' : 'No Edge',
      direction: homeForm > 75 && awayFat > 65 ? 'home' : 'neutral',
      strength: homeForm > 80 && awayFat > 70 ? 4 : 2,
      drivers: `Home form ${Math.round(homeForm)}/100, away fatigue ${Math.round(awayFat)}/100`,
      locked: true,
    });

    signals.push({
      market: 'First to Score', group: '1x2',
      signal: homeForm > awayForm + 15 ? 'Home Lean' : awayForm > homeForm + 15 ? 'Away Lean' : 'No Edge',
      direction: homeForm > awayForm + 15 ? 'home' : awayForm > homeForm + 15 ? 'away' : 'neutral',
      strength: Math.min(6, Math.round(Math.abs(homeForm - awayForm) / 10)),
      drivers: `Form differential H:${Math.round(homeForm)} A:${Math.round(awayForm)}`,
      locked: true,
    });
  }

  return signals;
}
