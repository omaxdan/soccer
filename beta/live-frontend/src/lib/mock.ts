import type { TeamSeasonStats } from "./performance";
import type { TournamentStanding, TeamFixtureDifficulty } from "./types";
import type {
  MatchRow,
  TeamLite,
  TournamentLite,
  TeamIntelligence,
  TeamGoalDependency,
  TeamInjuryImpact,
  TeamFormQuality,
  TeamVenuePerformance,
  TeamMomentum,
  PositionDepth,
  PredictedLineupPlayer,
  PlayerLite,
  LeagueIntelligence,
  LeagueGapSummary,
} from "./types";

// ── Tournaments ──────────────────────────────────────────
const serieB: TournamentLite = {
  id: 1, external_id: 390, name: "Brasileirão Série B", slug: "serie-b",
  country: "Brazil", category: "Football",
};
const serieC: TournamentLite = {
  id: 2, external_id: 391, name: "Brasileirão Série C", slug: "serie-c",
  country: "Brazil", category: "Football",
};
const eredivisie: TournamentLite = {
  id: 3, external_id: 78, name: "Eredivisie", slug: "eredivisie",
  country: "Netherlands", category: "Football",
};

export const MOCK_TOURNAMENTS = [serieB, serieC, eredivisie];

// ── Teams ────────────────────────────────────────────────
function team(id: number, name: string, short: string, slug: string, country = "Brazil"): TeamLite {
  return { id, external_id: 1000 + id, name, short_name: short, slug, crest_storage_path: null, country };
}

const T = {
  novorizontino: team(1, "Novorizontino", "NOV", "novorizontino"),
  sport: team(2, "Sport Recife", "SPT", "sport-recife"),
  chapecoense: team(3, "Chapecoense", "CHA", "chapecoense"),
  goias: team(4, "Goiás", "GOI", "goias"),
  operario: team(5, "Operário-PR", "OPE", "operario-pr"),
  cuiaba: team(6, "Cuiabá", "CUI", "cuiaba"),
  ferroviaria: team(7, "Ferroviária", "FER", "ferroviaria"),
  londrina: team(8, "Londrina", "LON", "londrina"),
  ajax: team(9, "Ajax", "AJA", "ajax", "Netherlands"),
  twente: team(10, "FC Twente", "TWE", "twente", "Netherlands"),
};

export const MOCK_TEAMS = Object.values(T);

// ── Players + lineups ────────────────────────────────────
function player(id: number, name: string, pos: string, opts: Partial<PlayerLite> = {}): PlayerLite {
  return {
    id, name, position: pos, current_injury: false, market_value: 800_000,
    intelligence: {
      player_id: id, readiness_score: 88, fatigue_score: 22, importance_score: 70,
      load_index: 55, minutes_last_30_days: 540, matches_last_30_days: 6,
      goal_share_pct: 12, assist_share_pct: 9, player_strength_score: 74,
    },
    ...opts,
  };
}

const novLineup: PredictedLineupPlayer[] = [
  { team_id: 1, player_id: 101, position_code: "G", rank_in_position: 1, confidence: 0.95, player: player(101, "Jordi", "G") },
  { team_id: 1, player_id: 102, position_code: "D", rank_in_position: 1, confidence: 0.9, player: player(102, "Rafael Donato", "D") },
  { team_id: 1, player_id: 103, position_code: "D", rank_in_position: 2, confidence: 0.88, player: player(103, "Patrick", "D") },
  { team_id: 1, player_id: 104, position_code: "D", rank_in_position: 3, confidence: 0.82, player: player(104, "Reniê", "D") },
  { team_id: 1, player_id: 105, position_code: "M", rank_in_position: 1, confidence: 0.9, player: player(105, "Jean Mota", "M", { market_value: 1_400_000 }) },
  { team_id: 1, player_id: 106, position_code: "M", rank_in_position: 2, confidence: 0.86, player: player(106, "Rômulo", "M") },
  { team_id: 1, player_id: 107, position_code: "M", rank_in_position: 3, confidence: 0.8, player: player(107, "Careca", "M") },
  { team_id: 1, player_id: 108, position_code: "F", rank_in_position: 1, confidence: 0.93, player: player(108, "Waguininho", "F", { market_value: 2_100_000, intelligence: { player_id: 108, readiness_score: 92, fatigue_score: 18, importance_score: 94, load_index: 61, minutes_last_30_days: 610, matches_last_30_days: 7, goal_share_pct: 34, assist_share_pct: 12, player_strength_score: 88 } }) },
  { team_id: 1, player_id: 109, position_code: "F", rank_in_position: 2, confidence: 0.85, player: player(109, "Neto Pessoa", "F") },
  { team_id: 1, player_id: 110, position_code: "F", rank_in_position: 3, confidence: 0.78, player: player(110, "Douglas Baggio", "F") },
];

const sptLineup: PredictedLineupPlayer[] = [
  { team_id: 2, player_id: 201, position_code: "G", rank_in_position: 1, confidence: 0.94, player: player(201, "Caíque França", "G") },
  { team_id: 2, player_id: 202, position_code: "D", rank_in_position: 1, confidence: 0.6, player: player(202, "Rafael Thyere", "D", { current_injury: true, injury_status: "OUT", injury_reason: "Hamstring strain", injury_return_days: 14, market_value: 1_800_000 }) },
  { team_id: 2, player_id: 203, position_code: "D", rank_in_position: 2, confidence: 0.72, player: player(203, "Chico", "D", { current_injury: true, injury_status: "DOUBTFUL", injury_reason: "Knock", injury_return_days: 3 }) },
  { team_id: 2, player_id: 204, position_code: "D", rank_in_position: 3, confidence: 0.8, player: player(204, "Luciano Castán", "D") },
  { team_id: 2, player_id: 205, position_code: "M", rank_in_position: 1, confidence: 0.88, player: player(205, "Fabinho", "M") },
  { team_id: 2, player_id: 206, position_code: "M", rank_in_position: 2, confidence: 0.84, player: player(206, "Lucas Lima", "M", { market_value: 1_200_000 }) },
  { team_id: 2, player_id: 207, position_code: "M", rank_in_position: 3, confidence: 0.79, player: player(207, "Titi Ortiz", "M") },
  { team_id: 2, player_id: 208, position_code: "F", rank_in_position: 1, confidence: 0.9, player: player(208, "Gustavo Coutinho", "F", { market_value: 1_600_000, intelligence: { player_id: 208, readiness_score: 74, fatigue_score: 58, importance_score: 89, load_index: 78, minutes_last_30_days: 720, matches_last_30_days: 8, goal_share_pct: 41, assist_share_pct: 8, player_strength_score: 82 } }) },
  { team_id: 2, player_id: 209, position_code: "F", rank_in_position: 2, confidence: 0.82, player: player(209, "Barletta", "F") },
  { team_id: 2, player_id: 210, position_code: "F", rank_in_position: 3, confidence: 0.7, player: player(210, "Zé Roberto", "F") },
];

export const MOCK_LINEUPS: Record<number, PredictedLineupPlayer[]> = {
  1: novLineup,
  2: sptLineup,
};

// ── Team intelligence ────────────────────────────────────
function ti(team_id: number, o: Partial<TeamIntelligence>): TeamIntelligence {
  return {
    team_id, readiness_score: 70, fatigue_index: 40, form_index: 60,
    last_5_points: 9, last_10_points: 17, last_5_results: "WWDLW",
    congestion_score: 45, rest_days_avg: 5.5, travel_load_km: 400,
    squad_stability_score: 80, injury_burden_score: 20, squad_depth_score: 72,
    active_competitions: 1, ...o,
  };
}

export const MOCK_TEAM_INTEL: Record<number, TeamIntelligence> = {
  1: ti(1, { readiness_score: 89, fatigue_index: 18, form_index: 82, last_5_results: "WWWDW", last_5_points: 13, squad_stability_score: 91, injury_burden_score: 8, travel_load_km: 0, rest_days_avg: 6.2, congestion_score: 22 }),
  2: ti(2, { readiness_score: 74, fatigue_index: 61, form_index: 58, last_5_results: "WLDWL", last_5_points: 7, squad_stability_score: 70, injury_burden_score: 44, travel_load_km: 840, rest_days_avg: 2.8, congestion_score: 71, active_competitions: 2 }),
  3: ti(3, { readiness_score: 63, fatigue_index: 52, form_index: 47, last_5_results: "LDLWL", last_5_points: 5, injury_burden_score: 38 }),
  4: ti(4, { readiness_score: 81, fatigue_index: 30, form_index: 74, last_5_results: "WWDWD", last_5_points: 11, squad_stability_score: 85 }),
  5: ti(5, { readiness_score: 66, fatigue_index: 48, form_index: 55, last_5_results: "DWLDW", last_5_points: 8 }),
  6: ti(6, { readiness_score: 78, fatigue_index: 34, form_index: 69, last_5_results: "WDWWL", last_5_points: 10 }),
};

export const MOCK_GOAL_DEP: Record<number, TeamGoalDependency> = {
  1: { team_id: 1, total_goals: 41, top_scorer_player_id: 108, top_scorer_goals: 14, top_scorer_pct: 34, top_2_scorers_pct: 52, top_scorer_no_backup: false },
  2: { team_id: 2, total_goals: 33, top_scorer_player_id: 208, top_scorer_goals: 14, top_scorer_pct: 42, top_2_scorers_pct: 55, top_scorer_no_backup: true },
};

export const MOCK_INJURY_IMPACT: Record<number, TeamInjuryImpact> = {
  1: { team_id: 1, injured_count: 2, total_importance_lost: 40, goals_lost: 2, assists_lost: 1, worst_absence_player_id: null, worst_absence_importance: 40 },
  2: { team_id: 2, injured_count: 7, total_importance_lost: 210, goals_lost: 9, assists_lost: 6, worst_absence_player_id: 202, worst_absence_importance: 96 },
};

export const MOCK_FORM_QUALITY: Record<number, TeamFormQuality> = {
  1: { team_id: 1, opponent_adjusted_form: 76, strength_of_schedule: 58, giant_killer_score: 62, flat_track_bully_score: 40, expected_points: 10.2, actual_points: 13, performance_delta: 2.8, volatility: 18, ppg_vs_top: 1.9, ppg_vs_middle: 2.1, ppg_vs_bottom: 2.4 },
  2: { team_id: 2, opponent_adjusted_form: 52, strength_of_schedule: 61, giant_killer_score: 44, flat_track_bully_score: 66, expected_points: 8.9, actual_points: 7, performance_delta: -1.9, volatility: 34, ppg_vs_top: 0.6, ppg_vs_middle: 1.3, ppg_vs_bottom: 2.2 },
};

export const MOCK_VENUE: Record<number, TeamVenuePerformance> = {
  1: { team_id: 1, home_win_pct: 72, away_win_pct: 38, home_points_per_game: 2.1, away_points_per_game: 1.2, venue_advantage_score: 78 },
  2: { team_id: 2, home_win_pct: 61, away_win_pct: 44, home_points_per_game: 1.8, away_points_per_game: 1.5, venue_advantage_score: 55 },
};

export const MOCK_MOMENTUM: Record<number, TeamMomentum> = {
  1: { team_id: 1, momentum_score: 78, last_5_points: 13, prior_5_points: 8, trend: "rising" },
  2: { team_id: 2, momentum_score: 42, last_5_points: 7, prior_5_points: 11, trend: "falling" },
};

export const MOCK_DEPTH: Record<number, PositionDepth[]> = {
  1: [
    { team_id: 1, position_code: "G", player_count: 3, injured_count: 0, available_count: 3, total_market_value: 900_000 },
    { team_id: 1, position_code: "D", player_count: 8, injured_count: 1, available_count: 7, total_market_value: 5_200_000 },
    { team_id: 1, position_code: "M", player_count: 7, injured_count: 0, available_count: 7, total_market_value: 6_800_000 },
    { team_id: 1, position_code: "F", player_count: 6, injured_count: 1, available_count: 5, total_market_value: 8_100_000 },
  ],
  2: [
    { team_id: 2, position_code: "G", player_count: 3, injured_count: 0, available_count: 3, total_market_value: 1_100_000 },
    { team_id: 2, position_code: "D", player_count: 8, injured_count: 4, available_count: 4, total_market_value: 6_400_000 },
    { team_id: 2, position_code: "M", player_count: 6, injured_count: 1, available_count: 5, total_market_value: 5_900_000 },
    { team_id: 2, position_code: "F", player_count: 5, injured_count: 2, available_count: 3, total_market_value: 7_300_000 },
  ],
};

// ── Matches ──────────────────────────────────────────────
const H = 36e5;
const now = Date.now();

function matchBase(
  id: number, ext: number, hoursFromNow: number, t: TournamentLite,
  home: TeamLite, away: TeamLite, venue: string, city: string
): MatchRow {
  return {
    id, external_match_id: ext, date: new Date(now + hoursFromNow * H).toISOString(),
    status: "scheduled", competition: t.name, tournament: t, home, away,
    venue, city, capacity: 22_000,
    weather: { temperature_c: 24, humidity: 62, wind_speed_kmh: 11, weather_condition: "Clear" },
  };
}

const m1 = matchBase(1, 900001, 20, serieB, T.novorizontino, T.sport, "Jorjão", "Novo Horizonte");
m1.intel = {
  match_id: 1, home_readiness: 89, away_readiness: 74, readiness_gap: 15,
  home_rest_days: 6.2, away_rest_days: 2.8, home_travel_distance_km: 0, away_travel_distance_km: 840,
  home_injury_score: 8, away_injury_score: 44, home_squad_stability: 91, away_squad_stability: 70,
  home_strength_rating: 78, away_strength_rating: 71, home_positional_depth: 82, away_positional_depth: 64,
  predicted_home_goals: 1.9, predicted_away_goals: 0.9,
  predicted_scorelines: [
    { score: "2-0", probability: 17 }, { score: "2-1", probability: 14 },
    { score: "1-0", probability: 13 }, { score: "1-1", probability: 10 }, { score: "3-1", probability: 8 },
  ],
  confidence_score: 84, confidence_band: "HIGH",
  win_probability_home: 62, win_probability_draw: 23, win_probability_away: 15,
  net_battle_index: 1.6, home_xi_strength: 84, away_xi_strength: 71,
};
m1.opportunity = {
  match_id: 1, opportunity_score: 86,
  executive_brief:
    "Novorizontino hold a clear readiness advantage (15 pts), and they lead across most head-to-head intelligence categories. Tempering that: Sport Recife are projected to field a notably weakened eleven. Overall risk reads LOW (18/100).",
  signals: [
    { key: "readiness_edge", text: "Novorizontino hold a clear readiness advantage (15 pts)" },
    { key: "battle_superiority", text: "Novorizontino lead across most head-to-head intelligence categories" },
    { key: "giant_killer", text: "Home side rested while Sport travelled 840 km after a midweek cup tie" },
  ],
  warnings: [
    { key: "weakened_xi", text: "Sport Recife are projected to field a notably weakened eleven" },
    { key: "dependency", text: "Sport lean 42% of goals on a single striker" },
  ],
  score_components: {
    readiness_contrast: 20, battle_contrast: 18, goal_environment: 0,
    injury_asymmetry: 10, mispricing: 8, giant_killer_angle: 6,
  },
};
m1.risk = {
  match_id: 1, risk_score: 18, risk_band: "LOW", predictability_score: 82,
  risk_factors: [
    { key: "weakened_xi", label: "Sport Recife are projected to field a notably weakened eleven", points: 8 },
    { key: "away_dependency", label: "Away attack leans heavily on one scorer", points: 6 },
    { key: "small_sample", label: "Slight form volatility in the visitors' recent run", points: 4 },
  ],
};
m1.signals = [
  { match_id: 1, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "Novorizontino readiness + venue edge points home", direction: "home", strength: 5, drivers: "Readiness gap 15 · venue advantage 78" },
  { match_id: 1, market: "Draw No Bet", signal_group: "1x2", signal_text: "Safer route to the home lean given congestion asymmetry", direction: "home", strength: 5, drivers: "Away rest 2.8d · 840 km travel" },
  { match_id: 1, market: "Over/Under Goals", signal_group: "goals", signal_text: "Model projects 2.8 total — leans slightly over", direction: "neutral", strength: 3, drivers: "xG 1.9 vs 0.9" },
  { match_id: 1, market: "Away Win (Avoid)", signal_group: "1x2", signal_text: "Congestion + injuries make the away side hard to trust", direction: "avoid", strength: 4, drivers: "7 injuries · 2 CB out" },
  { match_id: 1, market: "BTTS", signal_group: "goals", signal_text: "Home clean-sheet profile suppresses both-teams-score", direction: "neutral", strength: 3, drivers: "Home CS rate 34%" },
];

const m2 = matchBase(2, 900002, 44, serieB, T.goias, T.chapecoense, "Serrinha", "Goiânia");
m2.intel = {
  match_id: 2, home_readiness: 81, away_readiness: 63, readiness_gap: 18,
  home_rest_days: 5.5, away_rest_days: 4, home_travel_distance_km: 0, away_travel_distance_km: 1320,
  home_injury_score: 15, away_injury_score: 38, home_squad_stability: 85, away_squad_stability: 66,
  home_strength_rating: 80, away_strength_rating: 62, home_positional_depth: 76, away_positional_depth: 58,
  predicted_home_goals: 2.1, predicted_away_goals: 1.0,
  predicted_scorelines: [
    { score: "2-1", probability: 16 }, { score: "2-0", probability: 15 },
    { score: "1-0", probability: 12 }, { score: "3-1", probability: 10 }, { score: "1-1", probability: 9 },
  ],
  confidence_score: 79, confidence_band: "HIGH",
  win_probability_home: 58, win_probability_draw: 24, win_probability_away: 18,
  net_battle_index: 1.4, home_xi_strength: 80, away_xi_strength: 63,
};
m2.opportunity = {
  match_id: 2, opportunity_score: 74,
  executive_brief:
    "Goiás carry an 18-point readiness advantage into a home fixture against a long-travelled, thin Chapecoense. Goal-friendly profile with a stronger, more stable home XI. Overall risk reads LOW (24/100).",
  signals: [
    { key: "readiness_edge", text: "Goiás hold a clear readiness advantage (18 pts)" },
    { key: "goal_environment", text: "Goal-friendly matchup — models project 3.1 total goals" },
  ],
  warnings: [{ key: "travel", text: "Nothing major — visitors simply travel 1,320 km" }],
  score_components: { readiness_contrast: 23, battle_contrast: 16, goal_environment: 8, injury_asymmetry: 8, mispricing: 0, giant_killer_angle: 0 },
};
m2.risk = {
  match_id: 2, risk_score: 24, risk_band: "LOW", predictability_score: 76,
  risk_factors: [
    { key: "travel", label: "Visitors travel 1,320 km — fatigue partially offsets rest", points: 6 },
    { key: "sample", label: "Chapecoense form is volatile match to match", points: 6 },
  ],
};
m2.signals = [
  { match_id: 2, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "Goiás readiness + home edge", direction: "home", strength: 5, drivers: "Gap 18 · strength 80 vs 62" },
  { match_id: 2, market: "Over/Under Goals", signal_group: "goals", signal_text: "3.1 projected total leans over", direction: "neutral", strength: 4, drivers: "xG 2.1 vs 1.0" },
  { match_id: 2, market: "Home Team Goals", signal_group: "goals", signal_text: "Home attack in strong scoring form", direction: "home", strength: 4, drivers: "Last-5 points 11" },
];

const m3 = matchBase(3, 900003, 6, serieC, T.operario, T.cuiaba, "Germano Krüger", "Ponta Grossa");
m3.intel = {
  match_id: 3, home_readiness: 66, away_readiness: 78, readiness_gap: -12,
  home_rest_days: 4, away_rest_days: 6, home_travel_distance_km: 0, away_travel_distance_km: 210,
  home_injury_score: 30, away_injury_score: 22, home_squad_stability: 68, away_squad_stability: 82,
  home_strength_rating: 60, away_strength_rating: 74, home_positional_depth: 55, away_positional_depth: 70,
  predicted_home_goals: 1.1, predicted_away_goals: 1.4,
  predicted_scorelines: [
    { score: "1-1", probability: 15 }, { score: "1-2", probability: 12 },
    { score: "0-1", probability: 11 }, { score: "1-0", probability: 10 }, { score: "2-1", probability: 8 },
  ],
  confidence_score: 58, confidence_band: "MEDIUM",
  win_probability_home: 33, win_probability_draw: 29, win_probability_away: 38,
  net_battle_index: -0.9, home_xi_strength: 61, away_xi_strength: 73,
};
m3.opportunity = {
  match_id: 3, opportunity_score: 51,
  executive_brief:
    "Cuiabá edge the readiness and squad-stability picture on the road, but a 66-vs-78 gap in a tight Série C fixture keeps confidence in the medium band. A live, close match rather than a clear lean. Overall risk reads MEDIUM (46/100).",
  signals: [{ key: "readiness_edge", text: "Cuiabá hold the readiness edge (12 pts) away from home" }],
  warnings: [
    { key: "close", text: "Win probabilities are tightly bunched" },
    { key: "low_conf", text: "The readiness model itself flags medium confidence here" },
  ],
  score_components: { readiness_contrast: 16, battle_contrast: 13, goal_environment: 0, injury_asymmetry: 4, mispricing: 0, giant_killer_angle: 0 },
};
m3.risk = {
  match_id: 3, risk_score: 46, risk_band: "MEDIUM", predictability_score: 54,
  risk_factors: [
    { key: "tight", label: "Home and away win probabilities are within 5 points", points: 12 },
    { key: "low_model_confidence", label: "The readiness model flags medium confidence here", points: 7 },
    { key: "away_form_gap", label: "Away side stronger on paper but inconsistent away", points: 6 },
  ],
};
m3.signals = [
  { match_id: 3, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "Too close to lean — tight probabilities", direction: "neutral", strength: 2, drivers: "H 33 / D 29 / A 38" },
  { match_id: 3, market: "Double Chance (X2)", signal_group: "1x2", signal_text: "Visitors' quality makes draw-or-away the value route", direction: "away", strength: 3, drivers: "Strength 74 vs 60" },
  { match_id: 3, market: "Under 2.5 Goals", signal_group: "goals", signal_text: "Low projected total in a cagey tie", direction: "neutral", strength: 3, drivers: "xG 1.1 vs 1.4" },
];

const m4 = matchBase(4, 900004, 70, eredivisie, T.ajax, T.twente, "Johan Cruijff Arena", "Amsterdam");
m4.capacity = 55_000;
m4.intel = {
  match_id: 4, home_readiness: 84, away_readiness: 71, readiness_gap: 13,
  home_rest_days: 4, away_rest_days: 3, home_travel_distance_km: 0, away_travel_distance_km: 160,
  home_injury_score: 20, away_injury_score: 28, home_squad_stability: 82, away_squad_stability: 74,
  home_strength_rating: 86, away_strength_rating: 74, home_positional_depth: 88, away_positional_depth: 70,
  predicted_home_goals: 2.3, predicted_away_goals: 1.1,
  predicted_scorelines: [
    { score: "2-1", probability: 15 }, { score: "3-1", probability: 13 },
    { score: "2-0", probability: 12 }, { score: "3-0", probability: 9 }, { score: "1-1", probability: 8 },
  ],
  confidence_score: 77, confidence_band: "HIGH",
  win_probability_home: 64, win_probability_draw: 20, win_probability_away: 16,
  net_battle_index: 1.5, home_xi_strength: 87, away_xi_strength: 72,
};
m4.opportunity = {
  match_id: 4, opportunity_score: 69,
  executive_brief:
    "Ajax combine a readiness edge, deeper squad and elite home record into a strong home profile against Twente. Goal-rich matchup projected at 3.4 total. Overall risk reads LOW (28/100).",
  signals: [
    { key: "readiness_edge", text: "Ajax hold a readiness advantage (13 pts)" },
    { key: "goal_environment", text: "Goal-friendly matchup — models project 3.4 total goals" },
  ],
  warnings: [{ key: "congestion", text: "Both sides played midweek European fixtures" }],
  score_components: { readiness_contrast: 17, battle_contrast: 16, goal_environment: 12, injury_asymmetry: 4, mispricing: 0, giant_killer_angle: 0 },
};
m4.risk = {
  match_id: 4, risk_score: 28, risk_band: "LOW", predictability_score: 72,
  risk_factors: [
    { key: "rivalry", label: "Historic rivalry raises variance above the model baseline", points: 8 },
    { key: "congestion", label: "Both teams carry midweek European minutes", points: 6 },
  ],
};
m4.signals = [
  { match_id: 4, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "Ajax strength + depth at home", direction: "home", strength: 5, drivers: "Strength 86 vs 74" },
  { match_id: 4, market: "Over 2.5 Goals", signal_group: "goals", signal_text: "3.4 projected total strongly leans over", direction: "neutral", strength: 5, drivers: "xG 2.3 vs 1.1" },
  { match_id: 4, market: "BTTS", signal_group: "goals", signal_text: "Both attacks live; both defences leak", direction: "neutral", strength: 4, drivers: "Away xG 1.1" },
];

// two lower-signal fixtures to fill the board
const m5 = matchBase(5, 900005, 92, serieB, T.ferroviaria, T.londrina, "Fonte Luminosa", "Araraquara");
m5.intel = {
  match_id: 5, home_readiness: 70, away_readiness: 67, readiness_gap: 3,
  home_rest_days: 5, away_rest_days: 5, home_travel_distance_km: 0, away_travel_distance_km: 380,
  home_injury_score: 22, away_injury_score: 26, home_squad_stability: 76, away_squad_stability: 72,
  home_strength_rating: 66, away_strength_rating: 63, home_positional_depth: 64, away_positional_depth: 60,
  predicted_home_goals: 1.3, predicted_away_goals: 1.2,
  predicted_scorelines: [{ score: "1-1", probability: 16 }, { score: "1-0", probability: 12 }, { score: "0-1", probability: 11 }, { score: "2-1", probability: 9 }, { score: "0-0", probability: 8 }],
  confidence_score: 49, confidence_band: "LOW",
  win_probability_home: 39, win_probability_draw: 31, win_probability_away: 30,
  net_battle_index: 0.2, home_xi_strength: 66, away_xi_strength: 63,
};
m5.opportunity = { match_id: 5, opportunity_score: 34, executive_brief: "No side holds a decisive intelligence edge here — a coin-flip fixture the model declines to lean on. Overall risk reads MEDIUM (57/100).", signals: [], warnings: [{ key: "flat", text: "Readiness, strength and form are near-level" }], score_components: { readiness_contrast: 4, battle_contrast: 3, goal_environment: 0, injury_asymmetry: 2, mispricing: 0, giant_killer_angle: 0 } };
m5.risk = { match_id: 5, risk_score: 57, risk_band: "MEDIUM", predictability_score: 43, risk_factors: [{ key: "flat", label: "All intelligence categories are near-level", points: 20 }, { key: "low_model_confidence", label: "The readiness model flags low confidence here", points: 7 }] };
m5.signals = [{ match_id: 5, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "No lean — level matchup", direction: "neutral", strength: 1, drivers: "Gap 3" }];

const m6 = matchBase(6, 900006, 116, serieC, T.cuiaba, T.operario, "Arena Pantanal", "Cuiabá");
m6.intel = {
  match_id: 6, home_readiness: 80, away_readiness: 64, readiness_gap: 16,
  home_rest_days: 6, away_rest_days: 3.5, home_travel_distance_km: 0, away_travel_distance_km: 990,
  home_injury_score: 18, away_injury_score: 34, home_squad_stability: 83, away_squad_stability: 66,
  home_strength_rating: 76, away_strength_rating: 60, home_positional_depth: 72, away_positional_depth: 55,
  predicted_home_goals: 1.8, predicted_away_goals: 0.8,
  predicted_scorelines: [{ score: "2-0", probability: 18 }, { score: "1-0", probability: 14 }, { score: "2-1", probability: 12 }, { score: "3-0", probability: 9 }, { score: "1-1", probability: 8 }],
  confidence_score: 81, confidence_band: "HIGH",
  win_probability_home: 63, win_probability_draw: 22, win_probability_away: 15,
  net_battle_index: 1.5, home_xi_strength: 79, away_xi_strength: 61,
};
m6.opportunity = { match_id: 6, opportunity_score: 72, executive_brief: "Cuiabá turn the earlier road fixture around at home: 16-point readiness edge, rested legs and a much deeper XI against a long-travelled Operário. Overall risk reads LOW (22/100).", signals: [{ key: "readiness_edge", text: "Cuiabá hold a clear readiness advantage (16 pts)" }, { key: "battle_superiority", text: "Cuiabá lead across most head-to-head categories" }], warnings: [{ key: "travel", text: "Visitors on a 990 km trip with short rest" }], score_components: { readiness_contrast: 21, battle_contrast: 15, goal_environment: 0, injury_asymmetry: 8, mispricing: 0, giant_killer_angle: 0 } };
m6.risk = { match_id: 6, risk_score: 22, risk_band: "LOW", predictability_score: 78, risk_factors: [{ key: "away_travel", label: "Visitors travel 990 km on short rest", points: 7 }, { key: "sample", label: "Operário form is streaky", points: 6 }] };
m6.signals = [{ match_id: 6, market: "Match Result (1X2)", signal_group: "1x2", signal_text: "Cuiabá readiness + home edge", direction: "home", strength: 5, drivers: "Gap 16" }, { match_id: 6, market: "Under 2.5 Goals", signal_group: "goals", signal_text: "Home control profile trends under", direction: "neutral", strength: 3, drivers: "xG 1.8 vs 0.8" }];

export const MOCK_MATCHES: MatchRow[] = [m3, m1, m2, m4, m5, m6];

// ── League intelligence ──────────────────────────────────
export const MOCK_LEAGUE_INTEL: LeagueIntelligence[] = [
  { tournament_id: 1, team_count: 20, avg_readiness: 71, avg_form: 55, avg_congestion: 48, avg_travel_14d: 620, avg_rest_days: 5.1, tournament: serieB },
  { tournament_id: 2, team_count: 20, avg_readiness: 68, avg_form: 52, avg_congestion: 44, avg_travel_14d: 540, avg_rest_days: 5.4, tournament: serieC },
  { tournament_id: 3, team_count: 18, avg_readiness: 76, avg_form: 60, avg_congestion: 55, avg_travel_14d: 410, avg_rest_days: 4.6, tournament: eredivisie },
];

export const MOCK_LEAGUE_GAP: LeagueGapSummary[] = [
  { league_name: "Brasileirão Série B", total_picks: 214, hit_rate_strict: 0.58, hit_rate_lenient: 0.71, lift_over_baseline: 0.12, baseline_rate: 0.46, readiness_status: "calibrated", meets_sample_gate: true },
  { league_name: "Brasileirão Série C", total_picks: 168, hit_rate_strict: 0.54, hit_rate_lenient: 0.67, lift_over_baseline: 0.08, baseline_rate: 0.46, readiness_status: "calibrated", meets_sample_gate: true },
  { league_name: "Eredivisie", total_picks: 92, hit_rate_strict: 0.61, hit_rate_lenient: 0.73, lift_over_baseline: 0.15, baseline_rate: 0.46, readiness_status: "monitoring", meets_sample_gate: false },
];

// ── Season statistics (raw) for the performance engine ───
// Team 2 uses the exact SofaScore-style block from the product docs so the
// engine visibly reproduces the worked examples (4.7% finishing, 25.7%
// defensive conversion, 24% clean sheets, discipline risk, direct profile).

export const MOCK_SEASON_STATS: Record<number, TeamSeasonStats> = {
  2: {
    matches: 33, goals_scored: 15, goals_conceded: 35, clean_sheets: 8,
    avg_possession: 42.7, avg_rating: 6.69, accurate_passes_pct: 68.74,
    duels_won_pct: 48.4, aerial_duels_won_pct: 48.33,
    yellow_cards: 62, red_cards: 6,
    big_chances_created: 7, big_chances_missed: 10, big_chances: 15,
    shots: 319, shots_on_target: 94, shots_inside_box: 188,
    goals_inside_box: 11, goals_outside_box: 4, headed_goals: 2,
    left_foot_goals: 5, right_foot_goals: 8,
    long_balls_pct: 43.14, crosses_pct: 22.03,
    shots_against: 418, shots_on_target_against: 136,
    big_chances_against: 19, errors_leading_to_goal: 1,
  },
  1: {
    matches: 33, goals_scored: 41, goals_conceded: 20, clean_sheets: 15,
    avg_possession: 55.2, avg_rating: 7.08, accurate_passes_pct: 82.1,
    duels_won_pct: 53.1, aerial_duels_won_pct: 52.0,
    yellow_cards: 40, red_cards: 2,
    big_chances_created: 14, big_chances_missed: 8, big_chances: 22,
    shots: 360, shots_on_target: 140, shots_inside_box: 210,
    goals_inside_box: 30, goals_outside_box: 11, headed_goals: 7,
    left_foot_goals: 15, right_foot_goals: 19,
    long_balls_pct: 30.4, crosses_pct: 28.2,
    shots_against: 300, shots_on_target_against: 95,
    big_chances_against: 10, errors_leading_to_goal: 0,
  },
};

// ── League standings (real-table shape) ──────────────────
function stand(pos: number, tm: TeamLite, p: number, w: number, d: number, l: number, gf: number, ga: number): TournamentStanding {
  return { position: pos, team: tm, matches: p, wins: w, draws: d, losses: l, scores_for: gf, scores_against: ga, points: w * 3 + d };
}
export const MOCK_STANDINGS: Record<number, TournamentStanding[]> = {
  1: [
    stand(1, T.novorizontino, 24, 14, 6, 4, 38, 20),
    stand(2, T.goias, 24, 13, 6, 5, 34, 22),
    stand(3, T.chapecoense, 24, 12, 7, 5, 31, 21),
    stand(4, T.cuiaba, 24, 11, 7, 6, 29, 23),
    stand(5, T.operario, 24, 10, 8, 6, 27, 24),
    stand(6, T.ferroviaria, 24, 9, 8, 7, 25, 26),
    stand(7, T.londrina, 24, 8, 7, 9, 22, 28),
    stand(8, T.sport, 24, 6, 6, 12, 15, 35),
  ],
  3: [
    stand(1, T.ajax, 20, 15, 3, 2, 48, 18),
    stand(2, T.twente, 20, 13, 4, 3, 40, 22),
  ],
};

// ── Fixture difficulty (next-N opponent difficulty) ──────
export const MOCK_FIXTURE_DIFFICULTY: Record<number, TeamFixtureDifficulty> = {
  1: { team_id: 1, next_5_difficulty: 44, next_10_difficulty: 51, next_5_matches: 5, next_10_matches: 10 },
  2: { team_id: 2, next_5_difficulty: 71, next_10_difficulty: 68, next_5_matches: 5, next_10_matches: 10 },
};

// ── Key players (demo) — shape matches getTeamKeyPlayers' return type ────
export const MOCK_KEY_PLAYERS: Record<number, {
  id: number; name: string; short_name: string | null; position: string | null;
  jersey_number: number | null; current_injury: boolean | null;
  importance_score: number | null; readiness_score: number | null; fatigue_score: number | null;
  goal_share_pct: number | null; assist_share_pct: number | null; versatility_score: number | null;
}[]> = {
  2: [
    { id: 901, name: "Rickson Alves", short_name: "R. Alves", position: "F", jersey_number: 9, current_injury: false,
      importance_score: 27.3, readiness_score: 68, fatigue_score: 42, goal_share_pct: 35, assist_share_pct: 12, versatility_score: 38 },
    { id: 902, name: "Wagner Balotelli", short_name: "W. Balotelli", position: "M", jersey_number: 8, current_injury: false,
      importance_score: 21.1, readiness_score: 74, fatigue_score: 38, goal_share_pct: 10, assist_share_pct: 24, versatility_score: 55 },
    { id: 903, name: "Diego Torres", short_name: "D. Torres", position: "D", jersey_number: 4, current_injury: true,
      importance_score: 15.4, readiness_score: 40, fatigue_score: 61, goal_share_pct: 0, assist_share_pct: 3, versatility_score: 22 },
  ],
};

// ── Recent form (demo) — shape matches TeamRecentFormRow ─────────────────
export const MOCK_RECENT_FORM: Record<number, {
  match_date: string; result: string; goals_for: number | null; goals_against: number | null;
  points: number | null; is_home: boolean | null; btts: boolean | null;
  half_time_score_for: number | null; half_time_score_against: number | null;
}[]> = {
  2: [
    { match_date: "2026-07-06T19:00:00Z", result: "L", goals_for: 0, goals_against: 1, points: 0, is_home: true, btts: false, half_time_score_for: 0, half_time_score_against: 1 },
    { match_date: "2026-06-29T19:00:00Z", result: "L", goals_for: 0, goals_against: 1, points: 0, is_home: false, btts: false, half_time_score_for: null, half_time_score_against: null },
    { match_date: "2026-06-22T19:00:00Z", result: "W", goals_for: 4, goals_against: 0, points: 3, is_home: true, btts: false, half_time_score_for: 2, half_time_score_against: 0 },
    { match_date: "2026-06-15T19:00:00Z", result: "L", goals_for: 0, goals_against: 1, points: 0, is_home: true, btts: false, half_time_score_for: 0, half_time_score_against: 1 },
    { match_date: "2026-06-08T19:00:00Z", result: "W", goals_for: 3, goals_against: 0, points: 3, is_home: false, btts: false, half_time_score_for: 2, half_time_score_against: 0 },
  ],
};

// ── Motivation (demo) — shape matches TeamMotivationData ──────────────────
export const MOCK_MOTIVATION: Record<number, {
  team_id: number; overall_motivation_score: number | null; motivation_band: string | null;
  momentum_factor: number | null; quality_factor: number | null;
  venue_factor: number | null; external_motivation: number | null;
}> = {
  2: { team_id: 2, overall_motivation_score: 64, motivation_band: "GOOD", momentum_factor: 50, quality_factor: 55, venue_factor: 44, external_motivation: 85 },
  1: { team_id: 1, overall_motivation_score: 78, motivation_band: "HIGH", momentum_factor: 74, quality_factor: 80, venue_factor: 66, external_motivation: 60 },
};
