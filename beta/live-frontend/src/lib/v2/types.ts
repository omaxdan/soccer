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

// Teams & Players — factual directory / identity surfaces (mirror of the backend
// contract). Context only: identity + biography + current registration; no
// intelligence reading, no prediction.
export interface ApiTeamSummary {
  id: string;
  name: string;
  slug: string;
  shortName: string | null;
  countryCode: string | null;
}

export interface TeamListResponse {
  teams: ApiTeamSummary[];
}

export interface ApiPlayerSummary {
  id: string;
  fullName: string;
  shortName: string | null;
  slug: string;
  team: ApiTeamSummary | null;
}

export interface PlayerListResponse {
  players: ApiPlayerSummary[];
}

export interface ApiTeamResult {
  fixtureId: string;
  kickoffAt: string;
  isHome: boolean;
  opponent: ApiTeam;
  goalsFor: number | null;
  goalsAgainst: number | null;
}

export interface TeamDetailResponse {
  team: ApiTeamSummary & { homeVenueName: string | null };
  competitions: { editionId: string; seasonLabel: string; competition: { id: string; name: string; slug: string } }[];
  squad: ApiPlayerSummary[];
  recentResults: ApiTeamResult[];
}

export interface PlayerDetailResponse {
  player: {
    id: string;
    fullName: string;
    shortName: string | null;
    slug: string;
    dateOfBirth: string | null;
    nationalityCode: string | null;
    heightCm: number | null;
    preferredFoot: string | null;
  };
  currentTeam: ApiTeamSummary | null;
  competition: { id: string; name: string; slug: string; seasonLabel: string } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCH INTELLIGENCE — sealed-snapshot wire types (mirror of the backend
// src/v2/snapshot/read/matchIntelligence.ts contract). This is the SEALED,
// GOVERNED calculation output — never a live/contextual read. Numerics that are
// PostgreSQL numeric cross the wire as EXACT TEXT (scale preserved, never parsed
// to a float on the backend), so they are typed `string` here and must stay text
// until the moment of display. Only genuine integer counts are numbers. `null`
// means "no governed value" and is never a zero.
// ─────────────────────────────────────────────────────────────────────────────

/** What the snapshot IS and under which governed versions it was sealed. */
export interface IntelligenceProvenance {
  fixtureId: string;
  matchSnapshotId: string;
  fixturePartitionOn: string;
  snapshotPointCode: string;
  snapshotAsOf: string;   // ISO-8601 UTC
  sealedAt: string;       // ISO-8601 UTC (distinct from snapshotAsOf)
  verdictCompositionVersion: string; // designation, e.g. '1.3.0'
  checksumAlgorithmVersion: string;  // designation, e.g. 'v1'
  contentChecksumHex: string;
  immutable: true;
}

/** The sealed verdict — non-directional counts + completeness + governed edges.
 *  Graded fields with no governed substrate are `null`, never fabricated. */
export interface IntelligenceVerdict {
  consensusSupportsCount: number;
  consensusContradictsCount: number;
  consensusNeutralCount: number;
  consensusInactiveCount: number;
  evidenceCount: number;
  completenessRatio: string;          // numeric text
  formEdge: string | null;            // governed comparative edge (S-8), numeric text
  restEdge: string | null;            // governed comparative edge (S-8), numeric text
  readinessEdge: string | null;       // ungoverned → null
  travelEdge: string | null;          // ungoverned → null
  congestionEdge: string | null;      // ungoverned → null
  availabilityEdge: string | null;    // ungoverned → null
  riskScore: string | null;           // ungoverned → null
  confidence: string | null;          // null until calibration (S-9) produces it
  historicalReliabilityBaselineId: string | null;
}

export type PreparednessSide = 'HOME' | 'AWAY';

/** One side's sealed Team Preparedness, with the team it scores.
 *  `preparednessPoints` is null when no component was present. */
export interface PreparednessSideView {
  side: PreparednessSide;
  preparednessPoints: string | null; // numeric text or null (never a fabricated 0)
  availablePoints: string;           // numeric text — sum of PRESENT component weights
  declaredPoints: string;            // numeric text — sum of ALL declared weights (60)
  coverageRatio: string;             // numeric text, e.g. '0.9167'
  teamId: string | null;
}

/** One feature value the sealed calculation CITED (snapshot_feature_state). */
export interface CitedEvidenceItem {
  featureKey: string;
  subjectTeamId: string | null;
  value: string;                     // numeric text, scale preserved (a cited 0 is '0.00')
  featureVersionId: string;
  featureValueId: string;
  citedAsOf: string;                 // ISO-8601 UTC
  provenanceClassCode: string;
  sampleObservationCount: number;
  sampleMeetsThreshold: boolean;
}

/** The consolidated sealed Match Intelligence for one fixture (sealed content only). */
export interface MatchIntelligence {
  provenance: IntelligenceProvenance;
  verdict: IntelligenceVerdict;
  preparedness: PreparednessSideView[];
  citedEvidence: CitedEvidenceItem[];
}

/** The /api/v2/matches/:id/intelligence wire contract — two strictly separate
 *  properties. `intelligence` is the sealed, governed calculation; `context` is
 *  live/contextual match information and is NEVER calculation substrate. */
export interface MatchIntelligenceResponse {
  intelligence: MatchIntelligence;
  context: MatchDetailResponse | null;
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
