// ─────────────────────────────────────────────────────────────────────────────
// TEAM GOVERNED INTELLIGENCE — read model (governed module readings), evidence-honest
//
// Projects a team's GOVERNED home_away_split and consistency_index readings from
// module.module_reading, reusing the EXISTING quarantine-aware current-reading reader
// (readCurrentTeamReadings, 035-aware). It CALCULATES NOTHING and re-implements no
// selection/quarantine logic — the same pattern as teamReadiness.ts, for two more
// governed modules. Team Readiness stays on its own endpoint; this exposes only the
// two surfaces the Team page was missing.
//
//   home_away_split   — COMPETITION_SCOPED (one reading per governed edition). Status
//                       is directional (SUPPORTS/NEUTRAL/CONTRADICTS/INACTIVE); strength
//                       is NULL at 1.0.0 (exposed honestly). The governed verdict text is
//                       the interpretation — NOT a home-minus-away win-rate arithmetic.
//   consistency_index — ALL_COMPETITIONS. Status MEASURED (033: a valid non-directional
//                       measured result) or INACTIVE. `strength` is the governed measured
//                       magnitude (goal-margin volatility; higher = less consistent),
//                       exposed exactly as persisted — never recomputed, never a 0–100.
//
// Governance rules enforced by construction:
//   • The authoritative source is the governed module reading, never a descriptive
//     feature (team.home_win_rate/away_win_rate, team.goal_margin_volatility).
//   • Current-reading selection + quarantine exclusion are delegated ENTIRELY to
//     readCurrentTeamReadings. A quarantined reading never surfaces.
//   • strength/confidence are exposed exactly as persisted — never fabricated. INACTIVE
//     surfaces as status + inactiveReason, not as absence.
//   • No valid non-quarantined reading → that surface is null / coverage 'absent'.
//   • asOf is the reading's effective instant (module_reading.as_of), NOT calculated_at.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { readCurrentTeamReadings, type TeamModuleReading } from '../../module/read/readings';
import { readCurrentReadingEvidence, type ReadingEvidence } from '../../module/read/evidence';
import type { ApiModuleEvidence } from '../contract';
import { mapReadinessEvidence } from './teamReadiness';

/** The two governed modules this read model surfaces on the Team page. */
export const HOME_AWAY_SPLIT_MODULE_KEY = 'home_away_split';
export const CONSISTENCY_MODULE_KEY = 'consistency_index';
const ALL_COMPETITIONS = 'ALL_COMPETITIONS';

// ── contract view types ─────────────────────────────────────────────────────────

export interface TeamGovernedReading {
  readonly moduleKey: string;                // 'home_away_split' | 'consistency_index'
  readonly status: string;                   // module_status_code (SUPPORTS/NEUTRAL/CONTRADICTS/INACTIVE/MEASURED)
  readonly strength: number | null;          // governed magnitude where published; else null (never fabricated)
  readonly confidence: number | null;        // persisted; null where not published
  readonly sample: { readonly matches: number; readonly meetsThreshold: boolean };
  readonly verdictText: string | null;       // the governed interpretation
  readonly inactiveReason: string | null;    // set iff status = INACTIVE
  readonly asOf: string;                     // ISO — module_reading.as_of, NOT calculated_at
  readonly scope: { readonly kind: string; readonly competitionEditionId: string | null };
  readonly evidence: ApiModuleEvidence | null;
}

export type GovernedCoverageState = 'present' | 'absent';
export interface TeamGovernedCoverage {
  readonly homeAwaySplit: GovernedCoverageState;
  readonly consistency: GovernedCoverageState;
  /** Marks these as GOVERNED module readings, not descriptive/derived features. */
  readonly isGoverned: true;
}

export interface TeamGovernedIntelligence {
  /** One governed reading per COMPETITION_SCOPED edition the team has (0..n). */
  readonly homeAwaySplit: readonly TeamGovernedReading[];
  /** The ALL_COMPETITIONS consistency reading, or null when none is valid. */
  readonly consistency: TeamGovernedReading | null;
  readonly coverage: TeamGovernedCoverage;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function iso(d: Date): string {
  return new Date(d).toISOString();
}

/** Map a governed reading (+ its evidence) to the wire view. Pure. Recomputes nothing. */
export function mapGovernedReading(r: TeamModuleReading, evidence: ReadingEvidence | undefined): TeamGovernedReading {
  return {
    moduleKey: r.moduleKey,
    status: r.moduleStatusCode,
    strength: r.strength,                    // persisted magnitude/NULL preserved
    confidence: r.confidence,                // persisted NULL preserved
    sample: { matches: r.sampleObservationCount, meetsThreshold: r.sampleMeetsThreshold },
    verdictText: r.verdictText,
    inactiveReason: r.inactiveReason,
    asOf: iso(r.asOf),                       // NOT calculated_at
    scope: { kind: r.contextKindCode, competitionEditionId: r.contextCompetitionEditionId },
    evidence: mapReadinessEvidence(evidence),
  };
}

/**
 * Assemble the projection from the current readings + their evidence. Pure.
 * home_away_split readings are ordered by edition id for determinism.
 */
export function buildTeamGovernedIntelligence(
  readings: readonly TeamModuleReading[],
  evidenceByKeyEdition: ReadonlyMap<string, ReadingEvidence>,
): TeamGovernedIntelligence {
  const evKey = (moduleKey: string, editionId: string | null) => `${moduleKey}|${editionId ?? ''}`;

  const homeAwaySplit = readings
    .filter((r) => r.moduleKey === HOME_AWAY_SPLIT_MODULE_KEY)
    .sort((a, b) => (a.contextCompetitionEditionId ?? '').localeCompare(b.contextCompetitionEditionId ?? ''))
    .map((r) => mapGovernedReading(r, evidenceByKeyEdition.get(evKey(r.moduleKey, r.contextCompetitionEditionId))));

  const consistencyRow = readings.find(
    (r) => r.moduleKey === CONSISTENCY_MODULE_KEY && r.contextKindCode === ALL_COMPETITIONS,
  );
  const consistency = consistencyRow
    ? mapGovernedReading(consistencyRow, evidenceByKeyEdition.get(evKey(CONSISTENCY_MODULE_KEY, null)))
    : null;

  return {
    homeAwaySplit,
    consistency,
    coverage: {
      homeAwaySplit: homeAwaySplit.length > 0 ? 'present' : 'absent',
      consistency: consistency ? 'present' : 'absent',
      isGoverned: true,
    },
  };
}

// ── DB read (reuses the governed current-reading + evidence readers) ─────────────

export async function readTeamGovernedIntelligence(tx: PoolClient, teamId: string): Promise<TeamGovernedIntelligence> {
  const asOf = new Date();
  const moduleKeys = [HOME_AWAY_SPLIT_MODULE_KEY, CONSISTENCY_MODULE_KEY];
  // No contextCompetitionEditionId filter: return every scoped home_away_split edition
  // plus the ALL_COMPETITIONS consistency reading. Selection + quarantine exclusion are
  // delegated to the existing reader.
  const readings = (await readCurrentTeamReadings(tx, { teamIds: [teamId], asOf, moduleKeys }))
    .filter((r) => r.teamId === teamId);

  const evidenceByKeyEdition = new Map<string, ReadingEvidence>();
  if (readings.length > 0) {
    const evidence = await readCurrentReadingEvidence(tx, { teamIds: [teamId], asOf, moduleKeys });
    for (const e of evidence) {
      if (e.teamId !== teamId) continue;
      // Keyed by (moduleKey, edition) so a per-edition home_away_split reading gets its
      // own evidence rather than another edition's.
      evidenceByKeyEdition.set(`${e.moduleKey}|${e.contextCompetitionEditionId ?? ''}`, e);
    }
  }

  return buildTeamGovernedIntelligence(readings, evidenceByKeyEdition);
}
