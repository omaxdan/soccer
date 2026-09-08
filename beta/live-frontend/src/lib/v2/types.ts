// V2 API WIRE TYPES (frontend-local mirror of the backend B.2/B.3 contract).
// A deliberate copy, not a cross-package import: the frontend is a decoupled
// consumer of the V2 HTTP API. These shapes must match src/v2/api/contract.ts.

export interface ApiTeam { id: string; name: string; slug: string }
export interface ApiScore { home: number; away: number }

export interface ApiFormFixture {
  fixtureId: string;
  kickoffAt: string;
  isHome: boolean;
  goalsFor: number | null;
  goalsAgainst: number | null;
}

// PD-11 Recent Venue Form — CONTEXT ONLY. Not a module input, not a feature, not
// the substrate of home_away_split. W/D/L is a presentation-only derivation.
export interface ApiRecentFormRow {
  fixtureId: string;
  kickoffAt: string;
  isHome: boolean;
  goalsFor: number | null;
  goalsAgainst: number | null;
  opponent: ApiTeam;
  venueName: string | null;
  competition: { id: string; name: string; slug: string };
}

export interface ApiTeamRecentVenueForm {
  lastHome: ApiRecentFormRow[];
  lastAway: ApiRecentFormRow[];
}

export type ApiContributionDirection = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

export interface ApiEvidenceItem {
  featureKey: string | null;
  displayName: string | null;
  value: number | null;
  asOf: string | null;
  contributionDirection: ApiContributionDirection;
}

export interface ApiModuleEvidence {
  declaredInputCount: number;
  presentInputCount: number;
  belowThresholdInputCount: number;
  estimatedInputCount: number;
  items: ApiEvidenceItem[];
}

export interface ApiModuleReading {
  moduleKey: string;
  status: string;
  strength: number | null;
  confidence: number | null;
  sampleObservationCount: number;
  sampleMeetsThreshold: boolean;
  asOf: string;
  verdictText: string | null;
  inactiveReason: string | null;
  evidence: ApiModuleEvidence | null;
}

export interface ApiTeamIntelligence {
  readiness: ApiModuleReading | null;
  homeAwaySplit: ApiModuleReading | null;
}

export interface ApiMatchHeader {
  fixtureId: string;
  kickoffAt: string;
  status: string;
  competition: { id: string; name: string; slug: string };
  edition: { id: string; seasonLabel: string };
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  score: ApiScore | null;
}

export interface ApiFeatureValue {
  value: number;
  sampleObservationCount: number;
  sampleMeetsThreshold: boolean;
  asOf: string;
}

export interface ApiTeamFeatures {
  homeForm: ApiFeatureValue | null;
  awayForm: ApiFeatureValue | null;
  momentum: ApiFeatureValue | null;
  rest: ApiFeatureValue | null;
  congestion: ApiFeatureValue | null;
}

export interface MatchDetailResponse {
  match: ApiMatchHeader;
  form: { home: ApiFormFixture[]; away: ApiFormFixture[] };
  recentVenueForm: { home: ApiTeamRecentVenueForm; away: ApiTeamRecentVenueForm };
  intelligence: { home: ApiTeamIntelligence; away: ApiTeamIntelligence };
  teamFeatures: { home: ApiTeamFeatures; away: ApiTeamFeatures };
}

export interface ApiEditionFixture {
  fixtureId: string;
  kickoffAt: string;
  status: string;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  score: ApiScore | null;
}

export interface EditionFixtureListResponse {
  edition: { id: string; seasonLabel: string; competition: { id: string; name: string; slug: string } };
  fixtures: ApiEditionFixture[];
}

export interface ApiEditionSummary {
  id: string;
  seasonLabel: string;
  competition: { id: string; name: string; slug: string };
  fixtureCount: number;
}

export interface EditionListResponse {
  editions: ApiEditionSummary[];
}

/** Presentation-only W/D/L derivation (not intelligence). Works for any row that
 *  carries subject-oriented goals — plain recent form and enriched venue-form rows
 *  alike. Never a prediction or a match-result inference. */
export type FormResult = 'W' | 'D' | 'L' | null;
export function formResult(f: { goalsFor: number | null; goalsAgainst: number | null }): FormResult {
  if (f.goalsFor === null || f.goalsAgainst === null) return null;
  if (f.goalsFor > f.goalsAgainst) return 'W';
  if (f.goalsFor < f.goalsAgainst) return 'L';
  return 'D';
}
