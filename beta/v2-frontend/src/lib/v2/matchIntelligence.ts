// MATCH INTELLIGENCE — PURE PRESENTATION LOGIC (DB-free, no React).
//
// The renderer-side helpers for the sealed Match Intelligence surface. They
// COMPUTE NOTHING about football — they only decide how already-governed sealed
// values are DISPLAYED, and they enforce the product's honesty rules at the
// presentation boundary:
//
//   • NUMERIC TEXT stays text. Preparedness points, edges and cited values cross
//     the wire as exact PostgreSQL numeric text; these helpers format for display
//     without ever re-deriving a governed number.
//   • NULL ≠ ZERO. A null edge/confidence/risk is an honest "not governed / not yet
//     calibrated" state, never rendered as 0 or a fabricated percentage.
//   • ABSENT ≠ ZERO. A preparedness component with no cited value is "No data";
//     a component cited with a zero value is a real, displayed 0. The two are
//     distinguished by whether the feature appears in citedEvidence at all.
//
// The preparedness component catalog below is a PRESENTATION MIRROR of the governed
// composition (backend src/v2/snapshot/preparedness.ts: Form 30 · Congestion 15 ·
// Venue 10 · Squad Stability 5 = 60). It carries labels, declared weights and the
// per-side feature key only — presence and values are read exclusively from the
// API's citedEvidence. It invents no component and no score.

import type {
  ApiModuleReading, CitedEvidenceItem, IntelligenceModuleReading, IntelligenceVerdict,
  LifecycleTransition, MatchDetailResponse, PreparednessSide,
} from './types';

// ── null-honest numeric text formatting ─────────────────────────────────────────

/** True when a numeric-text value is exactly zero (e.g. '0', '0.00', '0.0000'). */
export function isZeroText(value: string): boolean {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n === 0;
}

/**
 * A ratio in numeric text (e.g. '0.9167') as a percentage string ('91.67%').
 * Returns '—' for an unparseable ratio. Used for coverage and completeness — the
 * raw ratio is preserved in the data; this is presentation only.
 */
export function formatRatioPercent(ratio: string, fractionDigits = 2): string {
  const n = Number.parseFloat(ratio);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

/** Trims a numeric-text value's trailing scale zeros for compact display, keeping
 *  its exact value ('13.5000' → '13.5', '55' → '55', '0.00' → '0'). Never rounds. */
export function trimNumericText(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return value;
  return value.trim().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

// ── graded-field honesty (edges / risk / confidence) ────────────────────────────

export interface FieldDisplay {
  /** Whether the field carries a governed value. */
  readonly present: boolean;
  /** The value text when present; otherwise the honest unavailable label. */
  readonly text: string;
}

/**
 * Confidence display. A null confidence means calibration (S-9) has not produced a
 * value — an honest product state, NEVER 0% and never inferred from anything else.
 */
export function confidenceDisplay(value: string | null): FieldDisplay {
  return value === null ? { present: false, text: 'Not yet calibrated' } : { present: true, text: value };
}

/** A governed comparative edge (S-8, home-relative). Null → "No governed value". */
export function governedEdgeDisplay(value: string | null): FieldDisplay {
  return value === null ? { present: false, text: 'No governed value' } : { present: true, text: value };
}

/** An ungoverned/not-yet-built graded field. Null → "Not available". */
export function ungovernedFieldDisplay(value: string | null): FieldDisplay {
  return value === null ? { present: false, text: 'Not available' } : { present: true, text: value };
}

/** The kind of honesty each verdict graded field gets, so a row renders the right
 *  unavailable label. Governed edges are distinguished from not-yet-calibrated ones. */
export type VerdictFieldKind = 'governedEdge' | 'ungoverned' | 'confidence';

export interface VerdictFieldSpec {
  readonly label: string;
  readonly pick: (v: IntelligenceVerdict) => string | null;
  readonly kind: VerdictFieldKind;
}

/** The graded verdict fields, in display order, each with its honesty kind. Counts
 *  (supports/contradicts/neutral/inactive, evidence, completeness) are rendered
 *  separately — they are always-present integers/ratios, not graded fields. */
export const VERDICT_GRADED_FIELDS: readonly VerdictFieldSpec[] = [
  { label: 'Form edge', pick: (v) => v.formEdge, kind: 'governedEdge' },
  { label: 'Rest edge', pick: (v) => v.restEdge, kind: 'governedEdge' },
  { label: 'Readiness edge', pick: (v) => v.readinessEdge, kind: 'ungoverned' },
  { label: 'Travel edge', pick: (v) => v.travelEdge, kind: 'ungoverned' },
  { label: 'Congestion edge', pick: (v) => v.congestionEdge, kind: 'ungoverned' },
  { label: 'Availability edge', pick: (v) => v.availabilityEdge, kind: 'ungoverned' },
  { label: 'Risk score', pick: (v) => v.riskScore, kind: 'ungoverned' },
  { label: 'Confidence', pick: (v) => v.confidence, kind: 'confidence' },
];

/** Resolve one graded verdict field to its display, applying the right honest
 *  unavailable label for its kind. */
export function verdictFieldDisplay(spec: VerdictFieldSpec, verdict: IntelligenceVerdict): FieldDisplay {
  const raw = spec.pick(verdict);
  switch (spec.kind) {
    case 'governedEdge': return governedEdgeDisplay(raw);
    case 'confidence': return confidenceDisplay(raw);
    case 'ungoverned': return ungovernedFieldDisplay(raw);
  }
}

// ── preparedness component catalog (presentation mirror of the composition) ──────

export interface PreparednessComponentSpec {
  readonly label: string;
  /** Declared weight (points) — governed composition constant, for context. */
  readonly declaredPoints: number;
  /** Feature key on the HOME side and the AWAY side (identical for shared inputs). */
  readonly homeFeatureKey: string;
  readonly awayFeatureKey: string;
  /** Short established-semantics note (never a prediction). */
  readonly note: string;
}

export const PREPAREDNESS_COMPONENTS: readonly PreparednessComponentSpec[] = [
  { label: 'Form', declaredPoints: 30, homeFeatureKey: 'team.home_form', awayFeatureKey: 'team.away_form', note: 'venue-appropriate recent form · 0–100' },
  { label: 'Fixture congestion', declaredPoints: 15, homeFeatureKey: 'team.congestion_index', awayFeatureKey: 'team.congestion_index', note: 'schedule density · lower is stronger' },
  { label: 'Venue win rate', declaredPoints: 10, homeFeatureKey: 'team.home_win_rate', awayFeatureKey: 'team.away_win_rate', note: 'edition-scoped venue win rate · 0–100' },
  { label: 'Squad stability', declaredPoints: 5, homeFeatureKey: 'team.squad_stability', awayFeatureKey: 'team.squad_stability', note: 'lineup continuity · 0–1 ratio' },
];

export type ComponentPresence = 'present' | 'present-zero' | 'absent';

export interface ResolvedComponent {
  readonly label: string;
  readonly declaredPoints: number;
  readonly note: string;
  readonly featureKey: string;
  readonly presence: ComponentPresence;
  /** Exact cited numeric text when present (a zero cited value is '0.00'), else null. */
  readonly value: string | null;
  readonly sampleObservationCount: number | null;
  readonly sampleMeetsThreshold: boolean | null;
}

/** The feature key this component uses on the given side. */
export function componentFeatureKey(spec: PreparednessComponentSpec, side: PreparednessSide): string {
  return side === 'HOME' ? spec.homeFeatureKey : spec.awayFeatureKey;
}

/**
 * Resolve one side's preparedness components from the CITED evidence only.
 *
 * A component is `present` when the calculation cited its feature for this team
 * with a non-zero value, `present-zero` when it cited a zero value (a real 0, to be
 * shown as 0 — not "No data"), and `absent` when the feature was not cited at all
 * (to be shown as "No data" — never a fabricated 0). Matching is by feature key and,
 * when both the side's team id and the item's subject team id are known, by team —
 * so a shared-key component (congestion, squad stability) is attributed to the right
 * side. Nothing is computed or redistributed; absence stays absence.
 */
export function resolveTeamComponents(
  side: PreparednessSide,
  teamId: string | null,
  cited: readonly CitedEvidenceItem[],
): ResolvedComponent[] {
  return PREPAREDNESS_COMPONENTS.map((spec) => {
    const key = componentFeatureKey(spec, side);
    const item = cited.find(
      (c) => c.featureKey === key && (teamId === null || c.subjectTeamId === null || c.subjectTeamId === teamId),
    );
    if (!item) {
      return {
        label: spec.label, declaredPoints: spec.declaredPoints, note: spec.note, featureKey: key,
        presence: 'absent', value: null, sampleObservationCount: null, sampleMeetsThreshold: null,
      };
    }
    return {
      label: spec.label, declaredPoints: spec.declaredPoints, note: spec.note, featureKey: key,
      presence: isZeroText(item.value) ? 'present-zero' : 'present',
      value: item.value,
      sampleObservationCount: item.sampleObservationCount,
      sampleMeetsThreshold: item.sampleMeetsThreshold,
    };
  });
}

// ── small display helpers used by the UI ─────────────────────────────────────────

/** Preparedness score as "points / declared", preserving exact text; null points
 *  (no component present) become an honest "No score" flag. */
export function preparednessScoreDisplay(points: string | null, declared: string): { present: boolean; text: string } {
  return points === null
    ? { present: false, text: 'No score' }
    : { present: true, text: `${trimNumericText(points)} / ${trimNumericText(declared)}` };
}

/** A friendly UTC provenance timestamp, e.g. "13 Sep 2026 12:30 UTC". */
export function formatProvenanceTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  });
  return `${s} UTC`;
}

/** Humanize a feature key for a cited-evidence row, e.g. 'team.home_form' →
 *  'Home form'. Falls back to the raw key so nothing is ever hidden. */
export function humanizeFeatureKey(key: string): string {
  const tail = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  if (!tail) return key;
  const words = tail.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── sealed governed module readings (Intelligence Modules) ───────────────────────
//
// Grouping/labelling for the sealed per-module readings the verdict was tallied
// from (e.g. Home/Away Split). Pure presentation: it groups the readings by module
// and resolves each reading to the HOME or AWAY side, and it maps the governed
// module_status_code to an analyst-framed descriptor (never betting language). It
// computes no football and invents no reading.

/** One module's sealed readings, resolved to sides for a home-vs-away view. */
export interface GroupedModule {
  readonly moduleKey: string;
  readonly displayName: string;
  readonly displayNumber: number;
  readonly moduleVersion: string;
  readonly home: IntelligenceModuleReading | null;
  readonly away: IntelligenceModuleReading | null;
  /** Readings not resolvable to home/away (e.g. a FIXTURE-subject module). */
  readonly other: readonly IntelligenceModuleReading[];
}

/**
 * Group sealed module readings by module (in governed display order) and resolve
 * each reading to HOME/AWAY by subject team. Readings whose subject is neither team
 * (or has no team) fall into `other` — never dropped, never mis-assigned. Pure.
 */
export function groupModuleReadings(
  modules: readonly IntelligenceModuleReading[],
  homeTeamId: string | null,
  awayTeamId: string | null,
): GroupedModule[] {
  const order: string[] = [];
  const byKey = new Map<string, IntelligenceModuleReading[]>();
  for (const m of modules) {
    if (!byKey.has(m.moduleKey)) { byKey.set(m.moduleKey, []); order.push(m.moduleKey); }
    byKey.get(m.moduleKey)!.push(m);
  }
  const groups = order.map((key) => {
    const readings = byKey.get(key)!;
    const first = readings[0];
    const home = homeTeamId ? readings.find((r) => r.subjectTeamId === homeTeamId) ?? null : null;
    const away = awayTeamId ? readings.find((r) => r.subjectTeamId === awayTeamId) ?? null : null;
    const other = readings.filter((r) => r !== home && r !== away);
    return { moduleKey: key, displayName: first.displayName, displayNumber: first.displayNumber, moduleVersion: first.moduleVersion, home, away, other };
  });
  return groups.sort((a, b) => a.displayNumber - b.displayNumber);
}

export type ModuleTone = 'positive' | 'negative' | 'neutral' | 'inactive';

export interface ModuleStatusDescriptor {
  /** Human, analyst-framed label — never betting language. */
  readonly label: string;
  readonly tone: ModuleTone;
  /** Whether the module produced an engaged reading (i.e. not INACTIVE). */
  readonly engaged: boolean;
}

/**
 * Map a governed module_status_code to a descriptor. Statuses are the non-directional
 * consensus classes (SUPPORTS/NEUTRAL/CONTRADICTS/INACTIVE) — analytical signal
 * language, never a betting pick or an odds implication. Unknown codes fall back to
 * a neutral, honestly-labelled descriptor rather than being hidden.
 */
export function moduleStatusDescriptor(status: string): ModuleStatusDescriptor {
  switch (status) {
    case 'SUPPORTS': return { label: 'Signal', tone: 'positive', engaged: true };
    case 'CONTRADICTS': return { label: 'Counter-signal', tone: 'negative', engaged: true };
    case 'NEUTRAL': return { label: 'Neutral', tone: 'neutral', engaged: true };
    case 'INACTIVE': return { label: 'Not enough data', tone: 'inactive', engaged: false };
    default: return { label: status.toLowerCase(), tone: 'neutral', engaged: status !== 'INACTIVE' };
  }
}

// ── user-facing helpers for the reconciled Match Intelligence surface ─────────────
//
// These translate the read contract into product language WITHOUT exposing internal
// ids, checksums, versions or the words snapshot/sealed/governed/provenance. They
// compute no football — only date formatting, subject labelling and code→word maps.

import type { IntelligenceProvenance } from './types';

/** A compact UTC date, e.g. "7 Sep 2026" (no time) for the reading provenance line. */
export function shortUtcDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The three user-facing dates for the reading: when it was taken (kickoff), when it
 *  was locked, and the date its evidence runs to. No ids/checksums/versions. */
export function readingDates(
  provenance: IntelligenceProvenance,
  modules: readonly IntelligenceModuleReading[],
  cited: readonly CitedEvidenceItem[],
): { takenAt: string; lockedAt: string; evidenceAsOf: string | null } {
  const times: number[] = [];
  for (const m of modules) { const t = Date.parse(m.asOf); if (!Number.isNaN(t)) times.push(t); }
  for (const c of cited) { const t = Date.parse(c.citedAsOf); if (!Number.isNaN(t)) times.push(t); }
  const evidenceAsOf = times.length ? new Date(Math.max(...times)).toISOString() : null;
  return { takenAt: provenance.snapshotAsOf, lockedAt: provenance.sealedAt, evidenceAsOf };
}

/** The subject a module/evidence row is about: the home or away team name, or, for a
 *  fixture-subject reading, "Fixture". Never an internal id. */
export function subjectLabel(
  subjectKindCode: string, subjectTeamId: string | null,
  homeTeamId: string | null, homeName: string, awayTeamId: string | null, awayName: string,
): string {
  if (subjectKindCode !== 'TEAM') return 'Fixture';
  if (subjectTeamId && subjectTeamId === homeTeamId) return homeName;
  if (subjectTeamId && subjectTeamId === awayTeamId) return awayName;
  return 'Fixture';
}

/** Provenance class → a plain word. RECORDED → "Recorded", DERIVED → "Derived". */
export function evidenceKindLabel(code: string): string {
  const c = code.toUpperCase();
  if (c === 'RECORDED') return 'Recorded';
  if (c === 'DERIVED') return 'Derived';
  return c.charAt(0) + c.slice(1).toLowerCase();
}

export interface StatusWord { word: string; color: string; engaged: boolean }
/** A module consensus status as a plain word + semantic colour. Follows the
 *  authoritative Match wireframe vocabulary: SUPPORTS→Supports, CONTRADICTS→Counters,
 *  NEUTRAL→Neutral, INACTIVE→Inactive. Colours per the wireframe token map
 *  (Supports=edge, Counters=risk, Neutral=cool, Inactive=faint). Never betting jargon. */
export function moduleStatusWord(status: string): StatusWord {
  switch (status.toUpperCase()) {
    case 'SUPPORTS': return { word: 'Supports', color: 'var(--edge)', engaged: true };
    case 'CONTRADICTS': return { word: 'Counters', color: 'var(--risk)', engaged: true };
    case 'NEUTRAL': return { word: 'Neutral', color: 'var(--cool)', engaged: true };
    case 'INACTIVE': return { word: 'Inactive', color: 'var(--faint)', engaged: false };
    default: return { word: status.charAt(0) + status.slice(1).toLowerCase(), color: 'var(--muted)', engaged: status.toUpperCase() !== 'INACTIVE' };
  }
}

// ── comparative edges (home-relative sign → "Favours <team>") ─────────────────────
//
// The sealed comparative edges are HOME-RELATIVE by contract (a positive value favours
// the home side, a negative the away side, zero is level). This is documented verdict
// semantics — not an inference — so surfacing "Favours <team>" from the sign is a
// faithful read, never a fabricated direction. A null edge stays an honest
// "Not available"; nothing is computed.

export interface EdgeDisplay {
  /** True when the edge carries a governed value. */
  readonly present: boolean;
  /** Signed magnitude text (trimmed), or the honest unavailable label. */
  readonly magnitude: string;
  /** The favoured side's name, or null when absent/level. */
  readonly favours: string | null;
}

/** Resolve a home-relative edge value to a magnitude + favoured side. */
export function edgeFavours(value: string | null, homeName: string, awayName: string): EdgeDisplay {
  if (value === null) return { present: false, magnitude: 'Not available', favours: null };
  const n = Number.parseFloat(value);
  const favours = !Number.isFinite(n) || n === 0 ? null : n > 0 ? homeName : awayName;
  return { present: true, magnitude: trimNumericText(value), favours };
}

/** The six comparative edges, in the wireframe's display order, each with the
 *  home-relative field it reads. Governed today: form, rest (others are null). */
export const EDGE_FIELDS: readonly { label: string; pick: (v: IntelligenceVerdict) => string | null }[] = [
  { label: 'Form', pick: (v) => v.formEdge },
  { label: 'Rest', pick: (v) => v.restEdge },
  { label: 'Travel', pick: (v) => v.travelEdge },
  { label: 'Readiness', pick: (v) => v.readinessEdge },
  { label: 'Congestion', pick: (v) => v.congestionEdge },
  { label: 'Availability', pick: (v) => v.availabilityEdge },
];

// ── consensus segment bar (12 segments, one per module tallied) ───────────────────

export type ConsensusClass = 'supports' | 'counters' | 'neutral' | 'inactive';
export interface ConsensusSegment { readonly kind: ConsensusClass; readonly color: string }

/** Build the ordered segment list for the consensus bar: supports, then counters,
 *  then neutral, then inactive — one segment per tallied module. Pure; counts come
 *  straight from the sealed verdict. */
export function consensusSegments(verdict: IntelligenceVerdict): ConsensusSegment[] {
  const out: ConsensusSegment[] = [];
  const push = (n: number, kind: ConsensusClass, color: string) => {
    for (let i = 0; i < n; i++) out.push({ kind, color });
  };
  push(verdict.consensusSupportsCount, 'supports', 'var(--edge)');
  push(verdict.consensusContradictsCount, 'counters', 'var(--risk)');
  push(verdict.consensusNeutralCount, 'neutral', 'var(--cool)');
  push(verdict.consensusInactiveCount, 'inactive', 'var(--line)');
  return out;
}

// ── Overview "Match factors" (live readings, 7 rows) ──────────────────────────────
//
// The factor rows are the live/contextual match readings the Overview surfaces:
// the fixture-subject modules (matchModules) plus each team's home/away split and
// readiness. Assembled straight from MatchDetailResponse — nothing computed. A row
// whose reading is absent renders an honest unavailable slot, never a zero.

export interface MatchFactor {
  readonly key: string;
  readonly label: string;
  /** The side a team-subject factor is about; null for a fixture-subject factor. */
  readonly subject: string | null;
  readonly reading: ApiModuleReading | null;
}

/** Assemble the Overview match-factor rows in the wireframe's order: the three
 *  fixture modules, then each team's home/away split, then each team's readiness. */
export function buildMatchFactors(detail: MatchDetailResponse): MatchFactor[] {
  const byKey = new Map(detail.matchModules.map((m) => [m.moduleKey, m]));
  const home = detail.match.homeTeam.name;
  const away = detail.match.awayTeam.name;
  const hi = detail.intelligence.home;
  const ai = detail.intelligence.away;
  return [
    { key: 'travel_impact', label: 'Travel Impact', subject: null, reading: byKey.get('travel_impact') ?? null },
    { key: 'rest_advantage', label: 'Rest Advantage', subject: null, reading: byKey.get('rest_advantage') ?? null },
    { key: 'form_gap_accuracy', label: 'Form Gap Accuracy', subject: null, reading: byKey.get('form_gap_accuracy') ?? null },
    { key: 'home_away_split_home', label: 'Home/Away Split', subject: home, reading: hi.homeAwaySplit },
    { key: 'home_away_split_away', label: 'Home/Away Split', subject: away, reading: ai.homeAwaySplit },
    { key: 'readiness_home', label: 'Readiness', subject: home, reading: hi.readiness },
    { key: 'readiness_away', label: 'Readiness', subject: away, reading: ai.readiness },
  ];
}

// ── merged lifecycle timeline (status + kickoff + lock + result confirmation) ─────
//
// The Timeline tab merges the observed lifecycle transitions with three other known
// instants — kickoff, the intelligence lock, and result confirmation — into one
// chronological list. Every event comes from a real payload field; nothing is
// fabricated, and a missing source simply contributes no event.

export interface TimelineEvent {
  readonly at: string;
  readonly title: string;
  readonly detail: string | null;
  /** A status change gets a filled dot; contextual markers an outline dot. */
  readonly filled: boolean;
}

/** Merge lifecycle transitions with kickoff / lock / confirmation instants, sorted
 *  ascending by time. `lockedAt` and `confirmedAt` are optional (null when absent). */
export function mergeTimeline(
  transitions: readonly LifecycleTransition[],
  kickoffAt: string,
  lockedAt: string | null,
  confirmedAt: string | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  events.push({ at: kickoffAt, title: 'Kickoff', detail: null, filled: false });
  for (const t of transitions) {
    const to = t.toState.displayName ?? t.toState.code;
    const from = t.fromState?.displayName ?? t.fromState?.code ?? null;
    events.push({ at: t.transitionedAt, title: to, detail: from ? `from ${from}` : null, filled: true });
  }
  if (lockedAt) events.push({ at: lockedAt, title: 'Intelligence locked', detail: 'reading taken at kickoff', filled: false });
  if (confirmedAt) events.push({ at: confirmedAt, title: 'Result confirmed', detail: null, filled: false });
  return events.sort((a, b) => {
    const ta = Date.parse(a.at); const tb = Date.parse(b.at);
    if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return 0;
    return ta - tb;
  });
}
