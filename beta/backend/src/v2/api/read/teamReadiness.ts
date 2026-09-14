// ─────────────────────────────────────────────────────────────────────────────
// TEAM READINESS — read model (governed module reading), evidence-honest
//
// Projects a team's GOVERNED readiness reading from module.module_reading
// (module_key = 'readiness_tracker'), reusing the existing current-reading reader.
// It CALCULATES NOTHING and re-implements no selection/quarantine logic. Layers:
//
//   GOVERNED MODULE READING — the readiness_tracker reading: a governed status +
//     verdict over team.momentum, with sample and provenance.
//   READ-MODEL SHAPING       — nesting sample and attaching persisted evidence.
//   NOT here                 — no numeric score is manufactured; no descriptive
//     feature (team.readiness_score) is substituted; no prediction/probability.
//
// Governance rules enforced by construction:
//   • The authoritative source is the governed module reading, NEVER the orphan
//     DERIVED feature team.readiness_score.
//   • Current-reading selection and quarantine exclusion are delegated ENTIRELY to
//     readCurrentTeamReadings (035-aware). A quarantined reading never surfaces.
//   • strength/confidence are exposed exactly as persisted (NULL at 1.0.0) — never
//     fabricated. INACTIVE surfaces as status + inactiveReason, not as absence.
//   • No valid non-quarantined reading → readiness null, coverage 'absent'.
//   • asOf is the reading's effective instant (module_reading.as_of), NOT calculated_at.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readCurrentTeamReadings, type TeamModuleReading } from '../../module/read/readings';
import { readCurrentReadingEvidence, type ReadingEvidence } from '../../module/read/evidence';
import type { ApiModuleEvidence } from '../contract';

/** The governed module whose reading is "team readiness". ALL_COMPETITIONS. */
export const READINESS_MODULE_KEY = 'readiness_tracker';
const ALL_COMPETITIONS = 'ALL_COMPETITIONS';

// ── contract view types ─────────────────────────────────────────────────────────

export interface TeamReadinessReading {
  readonly moduleKey: string;                // 'readiness_tracker'
  readonly status: string;                   // module_status_code (SUPPORTS/CONTRADICTS/NEUTRAL/INACTIVE)
  readonly strength: number | null;          // persisted; NULL at 1.0.0 — exposed honestly
  readonly confidence: number | null;        // persisted; NULL at 1.0.0
  readonly sample: { readonly matches: number; readonly meetsThreshold: boolean };
  readonly verdictText: string | null;
  readonly inactiveReason: string | null;    // set iff status = INACTIVE
  readonly asOf: string;                     // ISO — the reading's effective instant (module_reading.as_of)
  readonly evidence: ApiModuleEvidence | null;
}

export type ReadinessCoverageState = 'present' | 'absent';
export interface TeamReadinessCoverage {
  readonly readiness: ReadinessCoverageState;
  /** Marks this as a GOVERNED module reading, not a descriptive/derived feature. */
  readonly readinessIsGoverned: true;
}

export interface TeamReadiness {
  readonly readiness: TeamReadinessReading | null;
  readonly coverage: TeamReadinessCoverage;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return new Date(d).toISOString();
}

/** Map a persisted reading's evidence set to the wire shape, or null when absent. Pure. */
export function mapReadinessEvidence(e: ReadingEvidence | undefined): ApiModuleEvidence | null {
  if (!e) return null;
  return {
    declaredInputCount: e.declaredInputCount,
    presentInputCount: e.presentInputCount,
    belowThresholdInputCount: e.belowThresholdInputCount,
    estimatedInputCount: e.estimatedInputCount,
    items: e.items.map((i) => ({
      featureKey: i.featureKey,
      displayName: i.displayName,
      value: i.value,
      asOf: i.asOf === null ? null : iso(i.asOf),
      contributionDirection: i.contributionDirection,
    })),
  };
}

/** Map a governed reading (+ its evidence) to the readiness view. Pure. */
export function mapReadinessReading(r: TeamModuleReading, evidence: ReadingEvidence | undefined): TeamReadinessReading {
  return {
    moduleKey: r.moduleKey,
    status: r.moduleStatusCode,
    strength: r.strength,                    // persisted NULL preserved
    confidence: r.confidence,                // persisted NULL preserved
    sample: { matches: r.sampleObservationCount, meetsThreshold: r.sampleMeetsThreshold },
    verdictText: r.verdictText,
    inactiveReason: r.inactiveReason,
    asOf: iso(r.asOf),                       // NOT calculated_at
    evidence: mapReadinessEvidence(evidence),
  };
}

/** Build the projection. No reading → readiness null, coverage 'absent'. Pure. */
export function buildTeamReadiness(reading: TeamModuleReading | undefined, evidence: ReadingEvidence | undefined): TeamReadiness {
  if (!reading) {
    return { readiness: null, coverage: { readiness: 'absent', readinessIsGoverned: true } };
  }
  return { readiness: mapReadinessReading(reading, evidence), coverage: { readiness: 'present', readinessIsGoverned: true } };
}

// ── DB read (reuses the governed current-reading + evidence readers) ─────────────

export async function readTeamReadiness(tx: PoolClient, teamId: string): Promise<TeamReadiness> {
  const asOf = new Date();
  // Current-reading selection + quarantine exclusion are delegated to the existing reader.
  const readings = await readCurrentTeamReadings(tx, { teamIds: [teamId], asOf, moduleKeys: [READINESS_MODULE_KEY] });
  const reading = readings.find(
    (r) => r.teamId === teamId && r.moduleKey === READINESS_MODULE_KEY && r.contextKindCode === ALL_COMPETITIONS,
  );

  let evidence: ReadingEvidence | undefined;
  if (reading) {
    const ev = await readCurrentReadingEvidence(tx, { teamIds: [teamId], asOf, moduleKeys: [READINESS_MODULE_KEY] });
    evidence = ev.find((e) => e.teamId === teamId && e.moduleKey === READINESS_MODULE_KEY);
  }

  return buildTeamReadiness(reading, evidence);
}
