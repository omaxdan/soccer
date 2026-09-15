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
  intelligence: TeamIntelligence;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM INTELLIGENCE WORKSPACE — the getTeamDetail `intelligence` projection.
// Mirror of the backend read model (RAW evidence + read-model arithmetic ONLY —
// participation counts, registrations, availability, valuations, recent/upcoming
// fixtures, home/away fixture context, per-key DERIVED statistic aggregates,
// explicit-only next-fixture availability). NO governed verdict/score/prediction.
// ─────────────────────────────────────────────────────────────────────────────

export type CoverageState = 'present' | 'absent' | 'partial' | 'not-supported';

export interface TeamParticipation {
  competitionEditionId: string;
  seasonLabel: string;
  competition: { id: string; name: string; slug: string };
  fixturesTotal: number;
  completed: number;
  scheduled: number;
  postponed: number;
  registered: boolean;
  firstKickoff: string | null;
  lastKickoff: string | null;
}

export interface TeamAvailabilityRecord {
  playerId: string;
  fullName: string;
  unavailabilityKindCode: string;
  from: string | null;
  to: string | null;
  expectedReturnOn: string | null;
  reason: string | null;
  severityRank: number | null;
  current: boolean;
}

export interface TeamFixtureLine {
  fixtureId: string;
  kickoffAt: string;
  competition: { id: string; name: string; slug: string };
  opponent: { id: string; name: string; slug: string };
  isHome: boolean;
  status: string;
  score: { home: number; away: number } | null;
}

export interface TeamIntelligence {
  participation: TeamParticipation[];
  squad: {
    playerId: string; fullName: string; shortName: string | null; slug: string;
    registrationKindCode: string; registrationFrom: string | null; registrationTo: string | null;
  }[];
  availability: TeamAvailabilityRecord[];
  valuations: { playerId: string; fullName: string; amount: string; currencyCode: string | null; asOfOn: string; sourceCode: string | null }[];
  fixtures: { recent: TeamFixtureLine[]; upcoming: TeamFixtureLine[] };
  homeAwayContext: { home: TeamFixtureLine[]; away: TeamFixtureLine[] };
  playerStatistics: { playersWithStats: number; statisticKeys: { statisticKey: string; valueType: string | null; fixtures: number; players: number; numericTotal: string | null; numericMean: string | null }[] };
  playerPerformances: { fixture: TeamFixtureLine | null; performances: { playerId: string; fullName: string; statistics: { key: string; value: string | null; valueType: string | null }[] }[] };
  nextFixture: {
    fixture: TeamFixtureLine;
    registeredCount: number;
    explicitlyUnavailable: { playerId: string; fullName: string; unavailabilityKindCode: string; reason: string | null; expectedReturnOn: string | null }[];
    availabilityUnknown: { playerId: string; fullName: string }[];
  } | null;
  coverage: {
    registrations: CoverageState; availability: CoverageState; valuations: CoverageState;
    playerMatchStatistics: CoverageState; appearances: CoverageState; perPlayerCards: CoverageState;
    standings: CoverageState; managerReferee: CoverageState; statisticsAreDerivedAggregates: true;
  };
}

// ─── TEAM PERFORMANCE — descriptive persisted features (NOT governed intelligence) ──

export type MetricDirection = 'HIGHER_IS_STRONGER' | 'LOWER_IS_STRONGER' | 'UNSIGNED';

export interface PerformanceMetric {
  value: number;
  unit: string;
  direction: MetricDirection;
  sample: { matches: number; meetsThreshold: boolean };
  asOf: string;
}

export interface TeamPerformanceOverall {
  homeForm: PerformanceMetric | null;
  awayForm: PerformanceMetric | null;
  momentum: PerformanceMetric | null;
  goalMarginVolatility: PerformanceMetric | null;
  giantKillerPpg: PerformanceMetric | null;
}

export interface CompetitionPerformance {
  edition: { id: string; seasonLabel: string; competition: { id: string; name: string; slug: string } };
  homeWinRate: PerformanceMetric | null;
  awayWinRate: PerformanceMetric | null;
}

export interface TeamPerformanceResponse {
  team: ApiTeamSummary;
  overall: TeamPerformanceOverall;
  byCompetition: CompetitionPerformance[];
  coverage: { overall: 'present' | 'partial' | 'absent'; performanceIsDescriptive: true };
}

// ─── TEAM READINESS — the GOVERNED reading (readiness_tracker) ───────────────────────

export interface TeamReadinessReading {
  moduleKey: string;
  status: string;
  strength: number | null;
  confidence: number | null;
  sample: { matches: number; meetsThreshold: boolean };
  verdictText: string | null;
  inactiveReason: string | null;
  asOf: string;
  evidence: ApiModuleEvidence | null;
}

export interface TeamReadinessResponse {
  team: ApiTeamSummary;
  readiness: TeamReadinessReading | null;
  coverage: { readiness: 'present' | 'absent'; readinessIsGoverned: true };
}

// ─── PLAYER detail views — mirror of the backend read model (raw evidence only) ─────

export interface PlayerRegistrationView {
  teamId: string;
  registrationKindCode: string;
  registrationFrom: string | null;
  registrationTo: string | null;
  competitionEditionId: string | null;
  seasonLabel: string | null;
}

export interface PlayerAvailabilityView {
  unavailabilityKindCode: string;
  from: string | null;
  to: string | null;
  expectedReturnOn: string | null;
  reason: string | null;
  severityRank: number | null;
  current: boolean;
}

export interface PlayerValuationView {
  amount: string;
  currencyCode: string | null;
  asOfOn: string;
  sourceCode: string | null;
}

/** DERIVED arithmetic aggregate over stored rows for one provider statistic key
 *  (computed by the backend — never recomputed in the UI). total/mean null for json keys. */
export interface PlayerStatAggregate {
  statisticKey: string;
  valueType: string | null;
  matchesWithValue: number;
  numericTotal: string | null;
  numericMean: string | null;
}

export interface PlayerEditionParticipation {
  competitionEditionId: string;
  seasonLabel: string;
  competition: { id: string; name: string; slug: string };
  matches: number;
}

export interface PlayerMatchStatLine {
  fixtureId: string;
  kickoffAt: string;
  competitionEditionId: string;
  seasonLabel: string;
  teamId: string;
  opponentTeamId: string;
  opponentName: string;
  isHome: boolean;
  score: { home: number; away: number } | null;
  statistics: { key: string; value: string | null; valueType: string | null }[];
}

export interface PlayerStatistics {
  matchesRepresented: number;
  availableStatisticKeys: string[];
  summary: PlayerStatAggregate[];
  editions: PlayerEditionParticipation[];
  recentMatches: PlayerMatchStatLine[];
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
  registration: PlayerRegistrationView | null;
  availability: PlayerAvailabilityView | null;
  valuation: PlayerValuationView | null;
  statistics: PlayerStatistics;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY KEYSTONES — Competition / Country / Venue read-model responses.
// Mirror of the backend contract (CompetitionResponse / CountryResponse /
// VenueResponse). Layer-1 identity/context ONLY — no intelligence, no derived
// scores. Nullable fields stay nullable (never zero-filled).
// ─────────────────────────────────────────────────────────────────────────────

/** One competition, identity only, for navigation/cross-links. */
export interface ApiCompetitionSummary {
  id: string;
  name: string;
  slug: string;
}

export interface CompetitionResponse {
  competition: { id: string; name: string; slug: string; countryCode: string | null };
  editions: ApiEditionSummary[];
  coverage: { competition: 'present'; editions: 'present' | 'absent' };
}

export interface CountryResponse {
  country: { code: string; name: string; alpha3Code: string | null };
  teams: ApiTeamSummary[];
  competitions: ApiCompetitionSummary[];
  coverage: { country: 'present'; teams: 'present' | 'absent'; competitions: 'present' | 'absent' };
}

export interface VenueResponse {
  venue: {
    id: string;
    name: string;
    city: string | null;
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
    elevationMetres: number | null;
    timezoneName: string | null;
    capacity: number | null;
    surface: string | null;
  };
  homeTeams: ApiTeamSummary[];
  coverage: { venue: 'present'; homeTeams: 'present' | 'absent' };
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

/** One SEALED, governed module reading (from snapshot_module_reading → module_reading)
 *  — the per-module intelligence the verdict was tallied from, surfaced as an
 *  individual governed component. NOT the live module reading (which the API composes
 *  separately as context). Numeric fields stay exact text or null (null at v1.0.0). */
export interface IntelligenceModuleReading {
  moduleKey: string;
  displayName: string;
  displayNumber: number;
  moduleVersion: string;        // module_version.designation, e.g. '1.0.0'
  subjectKindCode: string;      // 'TEAM' | 'FIXTURE' | …
  subjectTeamId: string | null; // set for TEAM-subject readings
  status: string;               // SUPPORTS / NEUTRAL / CONTRADICTS / INACTIVE
  strength: string | null;      // numeric text or null
  confidence: string | null;    // numeric text or null (S-9 out of scope → null)
  sampleObservationCount: number;
  sampleMeetsThreshold: boolean;
  asOf: string;                 // ISO-8601 UTC
  verdictText: string | null;
}

/** The consolidated sealed Match Intelligence for one fixture (sealed content only). */
export interface MatchIntelligence {
  provenance: IntelligenceProvenance;
  verdict: IntelligenceVerdict;
  modules: IntelligenceModuleReading[];
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
