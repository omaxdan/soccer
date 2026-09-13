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

import type { CitedEvidenceItem, IntelligenceModuleReading, IntelligenceVerdict, PreparednessSide } from './types';

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
