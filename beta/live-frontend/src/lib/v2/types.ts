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

export interface MatchDetailResponse {
  match: ApiMatchHeader;
  form: { home: ApiFormFixture[]; away: ApiFormFixture[] };
  intelligence: { home: ApiTeamIntelligence; away: ApiTeamIntelligence };
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

/** Presentation-only W/D/L derivation (not intelligence). */
export type FormResult = 'W' | 'D' | 'L' | null;
export function formResult(f: ApiFormFixture): FormResult {
  if (f.goalsFor === null || f.goalsAgainst === null) return null;
  if (f.goalsFor > f.goalsAgainst) return 'W';
  if (f.goalsFor < f.goalsAgainst) return 'L';
  return 'D';
}
