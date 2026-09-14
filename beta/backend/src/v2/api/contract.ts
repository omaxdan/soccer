// ─────────────────────────────────────────────────────────────────────────────
// V2 READ API — WIRE CONTRACT (Phase B.2)
//
// The typed JSON shapes the first Match page and League fixture-list consume. This
// is the V2 product boundary: it is assembled only from PERSISTED V2 state
// (football reality + module.module_reading), never from V1, never from a runtime
// calculation, never from the provider.
//
// Dates cross the wire as ISO-8601 strings so the contract is explicit and stable
// for the UI. "No reading yet" is represented as `null`, distinct from a reading
// that exists — the API never fabricates a default reading or score.
// ─────────────────────────────────────────────────────────────────────────────

import type { MatchIntelligence } from '../snapshot/read/matchIntelligence';
import type {
  PlayerRegistrationView, PlayerAvailabilityView, PlayerValuationView, PlayerStatistics,
} from './read/playerStatistics';
import type { TeamIntelligence } from './read/teamIntelligence';
import type { EditionStandings } from './read/editionStandings';
import type { MatchLineups } from './read/matchLineups';
import type { MatchTeamStatistics } from './read/matchTeamStatistics';
import type { MatchResult, MatchResultCoverage } from './read/matchResult';
import type { MatchLifecycle } from './read/matchLifecycle';
import type { MatchVenue } from './read/matchVenue';
import type { TeamPerformanceOverall, CompetitionPerformance, TeamPerformanceCoverage } from './read/teamPerformance';
import type { TeamReadinessReading, TeamReadinessCoverage } from './read/teamReadiness';
import type { Venue } from './read/matchVenue';
import type { VenueCoverage } from './read/venue';
import type { CountryIdentity, CountryCoverage } from './read/country';
import type { CompetitionIdentity, CompetitionCoverage } from './read/competition';

export type {
  PlayerRegistrationView, PlayerAvailabilityView, PlayerValuationView, PlayerStatistics,
  PlayerStatAggregate, PlayerEditionParticipation, PlayerMatchStatLine,
} from './read/playerStatistics';

export type {
  TeamIntelligence, TeamParticipation, TeamSquadMember, TeamAvailabilityRecord,
  TeamValuationRecord, TeamFixtureLine, TeamStatKeyCoverage, TeamPlayerPerformance,
  TeamNextFixtureContext, TeamCoverageMeta, CoverageState,
} from './read/teamIntelligence';

export type {
  EditionStandings, StandingTable, StandingLine, EditionStandingsCoverage, StandingsCoverageState,
} from './read/editionStandings';

export type {
  MatchLineups, TeamLineup, LineupPlayer, MatchLineupsCoverage, LineupCoverageState, TeamRef,
} from './read/matchLineups';

export type {
  MatchTeamStatistics, PeriodStatistics, TeamStatLine, TeamStatValue,
  MatchTeamStatisticsCoverage, TeamStatisticsCoverageState,
} from './read/matchTeamStatistics';

export type {
  MatchResult, ResultScore, MatchResultCoverage, ResultCoverageState, MatchResultProjection,
} from './read/matchResult';

export type {
  MatchLifecycle, LifecycleTransition, LifecycleState, MatchLifecycleCoverage, LifecycleCoverageState,
} from './read/matchLifecycle';

export type {
  MatchVenue, Venue, MatchVenueCoverage, VenueCoverageState,
} from './read/matchVenue';

export type {
  TeamPerformance, TeamPerformanceOverall, CompetitionPerformance, EditionRef,
  PerformanceMetric, MetricDirection, TeamPerformanceCoverage, PerformanceCoverageState,
} from './read/teamPerformance';

export type {
  TeamReadiness, TeamReadinessReading, TeamReadinessCoverage, ReadinessCoverageState,
} from './read/teamReadiness';

export type {
  VenueDetail, VenueCoverage,
} from './read/venue';

export type {
  CountryDetail, CountryIdentity, CountryCoverage,
} from './read/country';

export type {
  CompetitionDetail, CompetitionIdentity, CompetitionCoverage,
} from './read/competition';

export interface ApiTeam {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ApiScore {
  readonly home: number;
  readonly away: number;
}

/** One completed fixture in a team's recent form, oriented to that team. */
export interface ApiFormFixture {
  readonly fixtureId: string;
  readonly kickoffAt: string;      // ISO-8601
  readonly isHome: boolean;
  /** null when the fixture has no result row (counted for congestion, not form). */
  readonly goalsFor: number | null;
  readonly goalsAgainst: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECENT VENUE FORM — CONTEXT ONLY (PD-11).
//
// A descriptive context surface: each team's five most recent completed HOME and
// AWAY fixtures, enriched with opponent / venue / competition. It is NOT a module
// input, NOT a feature, and NOT the substrate of `home_away_split` (which consumes
// the edition-cumulative venue population, unchanged). W/D/L is derived by the
// consumer from goalsFor/goalsAgainst — presentation only, never an intelligence
// claim. Every row is strictly before the fixture's kickoff (PD-7).
// ─────────────────────────────────────────────────────────────────────────────

/** One enriched completed fixture in a team's recent venue form, oriented to that team. */
export interface ApiRecentFormRow {
  readonly fixtureId: string;
  readonly kickoffAt: string;      // ISO-8601
  readonly isHome: boolean;
  /** null when the completed fixture has no persisted result. */
  readonly goalsFor: number | null;
  readonly goalsAgainst: number | null;
  readonly opponent: ApiTeam;
  /** null when the fixture has no venue recorded. */
  readonly venueName: string | null;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
}

/** One team's recent venue form, split by venue side — at most five rows each. */
export interface ApiTeamRecentVenueForm {
  readonly lastHome: readonly ApiRecentFormRow[];
  readonly lastAway: readonly ApiRecentFormRow[];
}

/** The direction a cited value contributed to a reading (module_evidence_item). */
export type ApiContributionDirection = 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL';

/**
 * One cited feature value's contribution to a reading — the item-level evidence
 * (module_evidence_item joined to its feature value). `value`/`asOf` are null only
 * when the cited value cannot be resolved; a zero value is preserved as 0. The
 * direction is the persisted one, never derived on the wire.
 */
export interface ApiEvidenceItem {
  readonly featureKey: string | null;
  readonly displayName: string | null;
  readonly value: number | null;
  readonly asOf: string | null;             // ISO-8601 or null
  readonly contributionDirection: ApiContributionDirection;
}

/**
 * A reading's persisted evidence — the set-level input counts (module_evidence)
 * and each cited value (module_evidence_item). Present only for an engaged reading
 * that recorded evidence; a reading with none carries `evidence: null`. Counts are
 * the persisted values, never recomputed — a zero count stays zero.
 */
export interface ApiModuleEvidence {
  readonly declaredInputCount: number;
  readonly presentInputCount: number;
  readonly belowThresholdInputCount: number;
  readonly estimatedInputCount: number;
  readonly items: readonly ApiEvidenceItem[];
}

/** A persisted module reading, projected for the wire. Null means "no reading yet". */
export interface ApiModuleReading {
  readonly moduleKey: string;
  readonly status: string;                 // module_status_code (SUPPORTS/NEUTRAL/INACTIVE/…)
  readonly strength: number | null;
  readonly confidence: number | null;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly asOf: string;                    // ISO-8601
  readonly verdictText: string | null;
  readonly inactiveReason: string | null;
  /** The persisted evidence behind this reading; null when the reading recorded none. */
  readonly evidence: ApiModuleEvidence | null;
}

/** The two ACTIVE modules for one team. Either may be null if not yet computed. */
export interface ApiTeamIntelligence {
  readonly readiness: ApiModuleReading | null;      // readiness_tracker (ALL_COMPETITIONS)
  readonly homeAwaySplit: ApiModuleReading | null;  // home_away_split (this edition)
}

export interface ApiMatchHeader {
  readonly fixtureId: string;
  readonly kickoffAt: string;               // ISO-8601
  readonly status: string;                  // fixture lifecycle_state_code
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly homeTeam: ApiTeam;
  readonly awayTeam: ApiTeam;
  /** null until a result is persisted. */
  readonly score: ApiScore | null;
}

/**
 * One persisted feature value, projected for the wire. Null means "no value yet".
 * `value` is the raw persisted number (never fabricated); `sampleMeetsThreshold`
 * distinguishes a low-sample value from a trusted one. Direction/units are the
 * feature's established semantics — see ApiTeamFeatures.
 */
export interface ApiFeatureValue {
  readonly value: number;
  readonly sampleObservationCount: number;
  readonly sampleMeetsThreshold: boolean;
  readonly asOf: string;                    // ISO-8601
}

/**
 * The five ALL_COMPETITIONS features the Team Intelligence panel compares, per team.
 * Any may be null when not yet computed (e.g. momentum needs 10 completed fixtures).
 * Established semantics: homeForm/awayForm 0-100 higher-better; momentum Δ points
 * higher-better; rest days-since-last-fixture higher-better; congestion 0-100
 * higher-worse.
 */
export interface ApiTeamFeatures {
  readonly homeForm: ApiFeatureValue | null;
  readonly awayForm: ApiFeatureValue | null;
  readonly momentum: ApiFeatureValue | null;
  readonly rest: ApiFeatureValue | null;
  readonly congestion: ApiFeatureValue | null;
}

export interface MatchDetailResponse {
  readonly match: ApiMatchHeader;
  readonly form: { readonly home: readonly ApiFormFixture[]; readonly away: readonly ApiFormFixture[] };
  /** PD-11 context surface — each team's last five home and last five away completed fixtures. */
  readonly recentVenueForm: { readonly home: ApiTeamRecentVenueForm; readonly away: ApiTeamRecentVenueForm };
  readonly intelligence: { readonly home: ApiTeamIntelligence; readonly away: ApiTeamIntelligence };
  readonly teamFeatures: { readonly home: ApiTeamFeatures; readonly away: ApiTeamFeatures };
}

/**
 * The Match Intelligence wire contract (Slice 2). Two strictly separate top-level
 * properties, so the UI can never confuse the two:
 *   • `intelligence` — the SEALED, governed calculation output, sourced exclusively
 *     from the sealed-snapshot read model (`readMatchIntelligence`). It carries its
 *     own provenance (snapshot id, snapshot_as_of, sealed_at, VCV designation,
 *     checksum, immutable), the governed verdict + edges, Team Preparedness, and the
 *     evidence the calculation actually CITED (`intelligence.citedEvidence`).
 *   • `context` — supporting live/contextual match information for the product
 *     surface (the existing MatchDetailResponse: header, recent form, venue form,
 *     live module readings, team features). It is NOT calculation substrate and must
 *     never be presented as cited evidence. `null` only in the pathological case
 *     where the fixture header cannot be composed.
 * The endpoint is sealed-only for intelligence: no sealed snapshot ⇒ 404, never a
 * live-data fabrication of an intelligence object.
 */
export interface MatchIntelligenceResponse {
  readonly intelligence: MatchIntelligence;
  readonly context: MatchDetailResponse | null;
}

/**
 * A fixture's ACTUAL reported lineups (football.lineup / lineup_selection): each
 * team's formation, starting XI and substitutes, with position and shirt number.
 * Observed evidence only — NEVER a predicted XI (`coverage.lineupsAreObserved`).
 * A team with no reported lineup is null (a coverage fact), never fabricated.
 * Null (→ 404) only when the fixture does not exist.
 */
export interface MatchLineupsResponse {
  readonly match: {
    readonly fixtureId: string;
    readonly kickoffAt: string;               // ISO-8601
    readonly status: string;                  // fixture lifecycle_state_code
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
    readonly homeTeam: ApiTeam;
    readonly awayTeam: ApiTeam;
  };
  readonly lineups: MatchLineups;
}

/**
 * A fixture's TEAM-level match statistics (football.team_match_statistic): the
 * provider's observed statistics per period, each carrying both teams' raw value and
 * display strings, oriented to match.homeTeam / match.awayTeam. Observed evidence
 * only — raw provider strings passed through, nothing parsed or recomputed, and no
 * verdict/score/probability (`coverage.statisticsAreObserved`). A fixture with no
 * statistics yields empty periods and coverage 'absent'. Null (→ 404) only when the
 * fixture does not exist.
 */
export interface MatchTeamStatisticsResponse {
  readonly match: {
    readonly fixtureId: string;
    readonly kickoffAt: string;               // ISO-8601
    readonly status: string;                  // fixture lifecycle_state_code
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
    readonly homeTeam: ApiTeam;
    readonly awayTeam: ApiTeam;
  };
  readonly teamStatistics: MatchTeamStatistics;
}

/**
 * A fixture's COMPLETE observed scoreline (football.result): final, half-time,
 * extra-time and penalty scores plus the confirmation instant, oriented to
 * match.homeTeam / match.awayTeam. Observed evidence only — no derived W/D/L or
 * outcome label. A phase the provider did not report is null (never a fabricated
 * 0-0); `result` is null and `coverage.result` is 'absent' when no result is
 * persisted. Null (→ 404) only when the fixture does not exist.
 */
export interface MatchResultResponse {
  readonly match: {
    readonly fixtureId: string;
    readonly kickoffAt: string;               // ISO-8601
    readonly status: string;                  // fixture lifecycle_state_code
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
    readonly homeTeam: ApiTeam;
    readonly awayTeam: ApiTeam;
  };
  readonly result: MatchResult | null;
  readonly coverage: MatchResultCoverage;
}

/**
 * A fixture's APPEND-ONLY lifecycle history (football.fixture_lifecycle_transition):
 * each observed state transition (from→to, when, provider raw status), chronological.
 * Observed evidence only — no risk score, postponement prediction, or verdict
 * (`lifecycle.coverage.transitionsAreObserved`). The initial transition has
 * fromState null. Empty history + coverage 'absent' when none recorded. Null (→ 404)
 * only when the fixture does not exist.
 */
export interface MatchLifecycleResponse {
  readonly match: {
    readonly fixtureId: string;
    readonly kickoffAt: string;               // ISO-8601
    readonly status: string;                  // fixture lifecycle_state_code (current)
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
    readonly homeTeam: ApiTeam;
    readonly awayTeam: ApiTeam;
  };
  readonly lifecycle: MatchLifecycle;
}

/**
 * A fixture's ACTUAL recorded venue (football.venue via football.fixture.venue_id)
 * and its neutral-venue flag. Observed evidence only — every field is a stored
 * provider fact; nullable fields are null when absent (never fabricated), and
 * `isNeutralVenue` is the OBSERVED fixture attribute, not a derived home-advantage
 * conclusion (`coverage.venueIsObserved`). `venue` is null and `coverage.venue` is
 * 'absent' when the fixture has no recorded venue. Null (→ 404) only when the
 * fixture does not exist.
 */
export interface MatchVenueResponse {
  readonly match: {
    readonly fixtureId: string;
    readonly kickoffAt: string;               // ISO-8601
    readonly status: string;                  // fixture lifecycle_state_code
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
    readonly homeTeam: ApiTeam;
    readonly awayTeam: ApiTeam;
  };
  readonly venue: MatchVenue['venue'];
  readonly isNeutralVenue: boolean;
  readonly coverage: MatchVenue['coverage'];
}

/** One fixture in a league/edition list. */
export interface ApiEditionFixture {
  readonly fixtureId: string;
  readonly kickoffAt: string;               // ISO-8601
  readonly status: string;
  readonly homeTeam: ApiTeam;
  readonly awayTeam: ApiTeam;
  readonly score: ApiScore | null;
}

export interface EditionFixtureListResponse {
  readonly edition: {
    readonly id: string;
    readonly seasonLabel: string;
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  };
  readonly fixtures: readonly ApiEditionFixture[];
}

/** One tracked/materialized edition, for the league-entry list. */
export interface ApiEditionSummary {
  readonly id: string;
  readonly seasonLabel: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly fixtureCount: number;
}

export interface EditionListResponse {
  readonly editions: readonly ApiEditionSummary[];
}

/**
 * An edition's league table(s), projected from `football.standing`. Observed
 * point-in-time snapshots (latest as-of per variant) — NOT governed intelligence,
 * NOT a ranking projection. `goalDifference` inside each row is a labeled read-layer
 * derivation (goalsFor − goalsAgainst). `standings.tables` is empty and
 * `coverage.standings` is 'absent' when no standings have been ingested for the
 * edition. Null (→ 404) only when the edition is not a governed-exposed edition.
 */
export interface EditionStandingsResponse {
  readonly edition: {
    readonly id: string;
    readonly seasonLabel: string;
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  };
  readonly standings: EditionStandings;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAMS & PLAYERS — factual/context directory surfaces (V2 Teams/Players pages).
//
// Assembled only from persisted V2 football reality (football.team / player /
// registration), scoped to the governed authorized-active edition(s) — the same
// Day-1 exposure gate as the edition list. These are CONTEXT surfaces: identity
// and biography only, no intelligence reading, no prediction, no fabricated stat.
// ─────────────────────────────────────────────────────────────────────────────

/** One team, identity only, for the directory and cross-links. */
export interface ApiTeamSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly shortName: string | null;
  readonly countryCode: string | null;
}

export interface TeamListResponse {
  readonly teams: readonly ApiTeamSummary[];
}

/** One competition, identity only, for country navigation and cross-links. */
export interface ApiCompetitionSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** One player, identity only, for the directory and squad lists. */
export interface ApiPlayerSummary {
  readonly id: string;
  readonly fullName: string;
  readonly shortName: string | null;
  readonly slug: string;
  /** The team the player is currently registered to within a governed edition, when known. */
  readonly team: ApiTeamSummary | null;
}

export interface PlayerListResponse {
  readonly players: readonly ApiPlayerSummary[];
}

/** A completed result in a team's recent history, oriented to that team (context). */
export interface ApiTeamResult {
  readonly fixtureId: string;
  readonly kickoffAt: string;               // ISO-8601
  readonly isHome: boolean;
  readonly opponent: ApiTeam;
  readonly goalsFor: number | null;
  readonly goalsAgainst: number | null;
}

export interface TeamDetailResponse {
  readonly team: ApiTeamSummary & { readonly homeVenueName: string | null };
  /** Governed edition(s) this team is registered in — competition/season context. */
  readonly competitions: readonly {
    readonly editionId: string;
    readonly seasonLabel: string;
    readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  }[];
  /** Current squad — players registered to this team today (context, not intelligence). */
  readonly squad: readonly ApiPlayerSummary[];
  /** A short tail of recent completed results, oriented to the team (context). */
  readonly recentResults: readonly ApiTeamResult[];
  /**
   * The Team Intelligence workspace projection — participation, current governed squad,
   * availability, valuations, recent/upcoming fixtures, home/away context, per-key
   * DERIVED statistic aggregates over stored `player_match_statistic` rows, latest
   * per-player performances, and explicit-only next-fixture availability. RAW evidence +
   * read-model arithmetic only; NO governed intelligence (no verdict/score/readiness/
   * predicted XI/derived suspension) is produced here. See `intelligence.coverage`.
   */
  readonly intelligence: TeamIntelligence;
}

/**
 * A team's DESCRIPTIVE performance evidence, projected from persisted
 * feature.feature_value (no recalculation). `overall` carries ALL_COMPETITIONS
 * metrics (form, momentum, goal-margin volatility, giant-killer PPG); `byCompetition`
 * carries COMPETITION_SCOPED venue win rates per governed edition. Every metric is
 * null when not persisted (never zero-filled). This is descriptive/derived evidence —
 * NOT a governed reading, verdict, prediction, or readiness
 * (`coverage.performanceIsDescriptive`). Null (→ 404) only when the team is not in a
 * governed authorized edition. (congestion/rest/travel/squad-stability/readiness are
 * deliberately excluded — condition/readiness/context/governed domains.)
 */
export interface TeamPerformanceResponse {
  readonly team: ApiTeamSummary;
  readonly overall: TeamPerformanceOverall;
  readonly byCompetition: readonly CompetitionPerformance[];
  readonly coverage: TeamPerformanceCoverage;
}

/**
 * A team's GOVERNED readiness reading (module.module_reading, module_key
 * 'readiness_tracker', ALL_COMPETITIONS) — a governed status + verdict over
 * momentum, with sample, provenance and cited evidence. This is governed
 * intelligence, NOT descriptive Performance and NOT the orphan `team.readiness_score`
 * feature. There is deliberately no numeric score: `strength`/`confidence` are
 * exposed exactly as persisted (NULL at 1.0.0). `readiness` is null and
 * `coverage.readiness` is 'absent' when no valid non-quarantined reading exists;
 * an INACTIVE reading surfaces with `status: 'INACTIVE'` + `inactiveReason`, not as
 * absence. Null (→ 404) only when the team is not a governed authorized team.
 */
export interface TeamReadinessResponse {
  readonly team: ApiTeamSummary;
  readonly readiness: TeamReadinessReading | null;
  readonly coverage: TeamReadinessCoverage;
}

/**
 * The canonical Venue entity — the geospatial keystone. Identity + geography
 * (football.venue: coordinates, elevation, timezone, capacity, surface, city,
 * country) plus the teams whose canonical home_venue_id points here. Observed
 * Evidence/Context ONLY — no travel distance, no travel impact, no map calculation,
 * no governed reading. Nullable geographic fields are null when absent (never
 * fabricated or inferred). Null (→ 404) only when the venue does not exist.
 */
export interface VenueResponse {
  readonly venue: Venue;
  readonly homeTeams: readonly ApiTeamSummary[];
  readonly coverage: VenueCoverage;
}

/**
 * The canonical Country entity — the parent keystone of the entity hierarchy.
 * Identity (football.country: ISO alpha-2 code, display name, ISO alpha-3) plus its
 * canonical members: teams whose `team.country_code` is this country and competitions
 * whose `competition.country_code` is this country. Membership is the canonical FK,
 * never match/venue/fixture inference; both collections are exposed through the SAME
 * Day-1 governed gate as the teams directory and edition list (no ungoverned leaks,
 * no broken cross-links). Identity/Context ONLY — no geography, ranking, readiness,
 * performance, prediction, or travel. Empty collections are truthful absences (never
 * zero-filled, never a 404). Null (→ 404) only when the country code is unknown.
 */
export interface CountryResponse {
  readonly country: CountryIdentity;
  readonly teams: readonly ApiTeamSummary[];
  readonly competitions: readonly ApiCompetitionSummary[];
  readonly coverage: CountryCoverage;
}

/**
 * The canonical Competition entity — the Country → Competition → Edition keystone.
 * Identity (football.competition: id, name, slug, country_code) plus its canonical
 * editions: competition_edition rows whose competition_id is this competition,
 * exposed through the SAME Day-1 governed gate as the edition list and projected to
 * the shared ApiEditionSummary. Editions come from the canonical competition_id
 * relationship, never inferred from fixtures/matches/standings. Identity/Context
 * ONLY — no standings, no league intelligence, ranking, readiness, or prediction.
 * Empty editions are a truthful absence (never zero-filled, never a 404). Null
 * (→ 404 competition_not_found) when the competition is unknown or has no governed
 * edition — nonexistent and unauthorized are not distinguished externally.
 */
export interface CompetitionResponse {
  readonly competition: CompetitionIdentity;
  readonly editions: readonly ApiEditionSummary[];
  readonly coverage: CompetitionCoverage;
}

export interface PlayerDetailResponse {
  readonly player: {
    readonly id: string;
    readonly fullName: string;
    readonly shortName: string | null;
    readonly slug: string;
    readonly dateOfBirth: string | null;     // ISO date
    readonly nationalityCode: string | null;
    readonly heightCm: number | null;
    readonly preferredFoot: string | null;
  };
  /** The team the player is currently registered to (within a governed edition), when known. */
  readonly currentTeam: ApiTeamSummary | null;
  /** Governed competition/season context for the current registration, when known. */
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string; readonly seasonLabel: string } | null;
  /** The player's current governed registration (kind, period, edition), or null. Raw evidence. */
  readonly registration: PlayerRegistrationView | null;
  /** The current/most-recent availability spell (injury/suspension), or null. Raw evidence. */
  readonly availability: PlayerAvailabilityView | null;
  /** The latest stored valuation, or null. Raw evidence. */
  readonly valuation: PlayerValuationView | null;
  /**
   * Statistics projected from stored `player_match_statistic` rows only: which keys
   * exist, per-key DERIVED arithmetic aggregates (never a governed score), editions
   * participated, and recent match-by-match lines with fixture/opponent context.
   * Empty (matchesRepresented 0, empty arrays) when the player has no stored stats.
   */
  readonly statistics: PlayerStatistics;
}

/** Uniform error body. */
export interface ApiError {
  readonly error: string;
}
