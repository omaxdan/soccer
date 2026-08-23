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
  readonly intelligence: { readonly home: ApiTeamIntelligence; readonly away: ApiTeamIntelligence };
  readonly teamFeatures: { readonly home: ApiTeamFeatures; readonly away: ApiTeamFeatures };
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

/** Uniform error body. */
export interface ApiError {
  readonly error: string;
}
