// Every metric shown anywhere in PitchTerminal answers three questions:
// what it is, why it matters, and what betting question it answers. This
// is the single source of truth for that copy — pulled directly from the
// product's own methodology brief, not paraphrased or invented per-usage.
// If a metric can't answer these three things, per that brief, it
// shouldn't be in the UI — so every key added here should have real
// backing data on the page it's used on.

export interface GlossaryEntry {
  label: string;
  what: string;
  why: string;
  question: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  readiness: {
    label: "Readiness",
    what: "A single 0–100 score blending form, opponent strength, congestion, travel, venue, squad stability and motivation for this specific fixture.",
    why: "Raw form ignores fixture congestion, travel, and who's actually fit to play. Readiness accounts for all of it at once.",
    question: "Is this team entering the match in a stronger competitive state than their opponent?",
  },
  attack_rating: {
    label: "Attack Rating",
    what: "Built from goals per match, shots per match, shot accuracy, shot conversion, and big-chance conversion.",
    why: "Tells you if the attack can consistently create and finish chances — not just whether it got lucky in one game.",
    question: "Can this team consistently create and finish chances?",
  },
  defence_rating: {
    label: "Defence Rating",
    what: "Built from goals conceded, clean sheets, shots allowed, and big chances allowed.",
    why: "Separates a defence that's genuinely hard to break down from one that's been riding good luck or a hot goalkeeper.",
    question: "Can this team hold a lead, or keep a game close?",
  },
  finishing_efficiency: {
    label: "Finishing Efficiency",
    what: "Goals divided by shots on target, adjusted for big-chance conversion.",
    why: "Distinguishes a clinical attack from a wasteful one creating plenty of chances but not scoring.",
    question: "Are they clinical in front of goal, or wasteful?",
  },
  shot_accuracy: {
    label: "Shot Accuracy",
    what: "Share of shots that are on target.",
    why: "An attack that doesn't test the keeper isn't actually threatening, regardless of how many shots it takes.",
    question: "Do their attacks actually end in dangerous attempts?",
  },
  shot_conversion_rate: {
    label: "Shot Conversion Rate",
    what: "Goals divided by total shots.",
    why: "The most direct measure of attacking efficiency — how often a shot actually becomes a goal.",
    question: "Is this attack efficient, or just busy?",
  },
  big_chance_conversion: {
    label: "Big Chance Conversion",
    what: "Big chances scored versus big chances missed.",
    why: "Shows what happens in the moments that matter most — the clearest scoring opportunities.",
    question: "Are they clinical when it counts, or wasteful?",
  },
  goal_creation_score: {
    label: "Goal Creation Score",
    what: "Built from assists, key passes, and big chances created.",
    why: "Separates teams that can manufacture goals consistently from those riding a hot streak.",
    question: "Is this a sustainable attack, or a lucky one?",
  },
  goal_prevention_score: {
    label: "Goal Prevention Score",
    what: "Built from shots allowed, big chances allowed, and saves.",
    why: "Tests whether a low-conceding record reflects genuine defensive effectiveness or a lucky run.",
    question: "Is this a strong defence, or a lucky one?",
  },
  clean_sheet_reliability: {
    label: "Clean Sheet Reliability",
    what: "Clean sheet percentage weighted against goals conceded per game.",
    why: "Tells you how often this defence genuinely shuts an opponent out, not just its average.",
    question: "Is Win-to-Nil a realistic market here?",
  },
  team_quality_score: {
    label: "Team Quality Score",
    what: "Strength rating combining squad depth, player quality, and season-long performance — independent of recent form.",
    why: "Recent results can hide a genuinely strong or weak team. This strips form out to show the underlying level.",
    question: "Is this genuinely a strong team, or are recent results hiding weaknesses?",
  },
  consistency_score: {
    label: "Consistency Score",
    what: "Measures variance in results and home/away reliability.",
    why: "A team can average well while being wildly unpredictable match-to-match — this flags that risk.",
    question: "Can I trust this team to perform to expectation?",
  },
  opponent_adjusted_form: {
    label: "Opponent-Adjusted Form",
    what: "Points per game weighted by the strength of opposition faced, not raw results.",
    why: "Five wins against relegation candidates aren't the same signal as five wins against the top half.",
    question: "Is recent form actually impressive, or padded against weak opposition?",
  },
  giant_killer_score: {
    label: "Giant Killer Score",
    what: "Points-per-game against top-quartile opposition, relative to their average.",
    why: "Identifies teams that consistently punch above their league position against strong sides.",
    question: "Is this a dangerous underdog against a stronger side?",
  },
  flat_track_bully_score: {
    label: "Flat Track Bully Score",
    what: "Points-per-game against bottom-quartile opposition, relative to their average.",
    why: "Flags a record that's inflated by beating up on weak teams rather than genuine quality.",
    question: "Is this team's record inflated by a soft run of fixtures?",
  },
  performance_delta: {
    label: "Performance Delta",
    what: "Actual points earned minus expected points, given the strength of opposition faced.",
    why: "A team significantly overperforming its underlying numbers is a candidate for regression.",
    question: "Is this team due a correction — good or bad?",
  },
  squad_stability: {
    label: "Squad Stability",
    what: "How consistent the starting lineup has been recently — retention, transfer churn, and availability.",
    why: "A settled team plays with more cohesion than one shuffling personnel every week.",
    question: "Is this a predictable lineup, or constant rotation?",
  },
  xi_strength: {
    label: "XI Strength",
    what: "The projected starting lineup compared to the strongest eleven this team could field.",
    why: "A club's reputation doesn't play the match — the actual eleven on the pitch does.",
    question: "Is this their best XI, or a heavily rotated one?",
  },
  team_versatility: {
    label: "Team Versatility",
    what: "How many players can cover multiple positions, built from primary, secondary and tertiary position data.",
    why: "A tactically flexible squad can adapt mid-match; a rigid one can't respond if the game state changes.",
    question: "Can this team adapt if the match doesn't go to plan?",
  },
  goal_dependency: {
    label: "Goal Dependency",
    what: "Share of total goals scored by the top scorer (and top two combined).",
    why: "A concentrated attack is one injury away from losing its main scoring threat.",
    question: "What happens if this team's top scorer is neutralised?",
  },
  btts_score: {
    label: "BTTS Score",
    what: "Built from both teams' attack rating, defence rating, and consistency.",
    why: "Answers whether both attacks can create enough and whether either defence can keep a clean sheet.",
    question: "Are both teams likely to score?",
  },
  goals_market_score: {
    label: "Goals Market Score",
    what: "Built from expected goals, attack rating, and goal prevention on both sides.",
    why: "Combines both teams' attacking and defensive numbers into a single goal-environment read.",
    question: "Should I be looking at Over or Under 2.5 goals?",
  },
  winner_market_score: {
    label: "Winner Market Score",
    what: "Blends readiness, quality, form, venue, fatigue, and projected lineup strength.",
    why: "No single stat tells you who wins — this is the combined edge across every evidence stream.",
    question: "Which side has the strongest overall edge to win?",
  },
  cards_market_score: {
    label: "Cards Market Score",
    what: "Built from yellow cards, red cards, fouls, and duels won per match.",
    why: "Physical, duel-heavy matches produce more cards regardless of the scoreline.",
    question: "Is this likely to be a physical, card-heavy match?",
  },
  power_ranking: {
    label: "Power Ranking",
    what: "A composite of readiness, form, quality, squad strength, and venue performance across the league.",
    why: "The official table only reflects points. This reflects who's actually playing well right now.",
    question: "Who is currently the strongest team in this league?",
  },
  fixture_difficulty: {
    label: "Fixture Difficulty",
    what: "A 0-100 score for a team's next 5 matches, based on opponent strength and venue.",
    why: "A team on a hot streak can still be heading into a brutal run of fixtures — this flags that before it shows up in the results.",
    question: "Is this team's form about to be tested, or given an easy ride?",
  },
  opportunity_score: {
    label: "Opportunity Score",
    what: "Weighs the size of a detected edge against the risk and uncertainty around it.",
    why: "A big edge with high uncertainty isn't automatically worth acting on — this balances both.",
    question: "Is there enough evidence here to be worth investigating?",
  },
  signal_strength: {
    label: "Signal Strength",
    what: "A 0–6 score the model assigns to how strongly the underlying data points one way for this specific market — not a count of the bullet points shown above it.",
    why: "Two signals can list the same number of supporting facts but disagree on how decisive those facts actually are. This is the model's own confidence in this particular lean.",
    question: "How strongly does the data support this specific market, on a 0–6 scale?",
  },
  match_confidence: {
    label: "Match Confidence",
    what: "How strongly the independent readiness components — form, opponent strength, injuries, congestion, travel, stability, venue, motivation — all agree with each other on the same side.",
    why: "A big readiness gap where every other signal points the same way is trustworthy. The same gap contradicted by strength, injuries, or venue is much less so.",
    question: "Do the different pieces of evidence behind this match actually agree with each other, or are they pulling in different directions?",
  },
};

export type GlossaryKey = keyof typeof GLOSSARY;
