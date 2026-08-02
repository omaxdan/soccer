// ─────────────────────────────────────────────────────────────────────────────
// Evidence Maturity Framework — the shared policy.
//
// Mirrors beta/backend/src/lib/confidenceBand.ts's SAMPLE_THRESHOLDS/
// sampleQuality() exactly — same shape, same named presets, same values
// where the same claim applies. NOT literally the same file: frontend and
// backend share no import graph anywhere in this codebase (confirmed before
// writing this — no root package.json, no workspaces field, no Turborepo/
// Lerna/Nx config anywhere in the repo). A genuine shared package would mean
// introducing new monorepo tooling and verifying it doesn't break the
// frontend's Next.js standalone build for its cPanel deployment — a real
// infrastructure change with no live environment here to validate it
// against, not a safe thing to do blind in the same pass as a UI feature.
//
// This mirroring is the same considered choice already made once for
// bandForFrozenScore() (app/match/[slug]/page.tsx's frozen-snapshot read
// path): a pure, stateless classification, duplicated deliberately and
// documented as a mirror rather than silently reimplemented differently.
// If the values ever drift, THIS comment is where to notice it.
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceQuality = "STRONG" | "ADEQUATE" | "LIMITED" | "INSUFFICIENT";

export interface EvidenceThresholds {
  /** Below this: no historical claim is defensible at all. */
  insufficient: number;
  /** Below this (but >= insufficient): defensible but should read as limited, not confident. */
  limited: number;
  /** Below this (but >= limited): adequate, not yet the strongest tier. */
  adequate: number;
}

/**
 * Named presets. The request's own stated minimums (MIN_TOTAL_MATCHES=5,
 * MIN_HOME_MATCHES=5, MIN_AWAY_MATCHES=5, MIN_HEAD_TO_HEAD=3,
 * MIN_POPULATION=5, MIN_BACKTEST_SAMPLE=50) map onto the `insufficient`
 * boundary specifically, not `limited` — verified against the request's own
 * worked example before choosing: Basel/Lausanne at 3 matches each must
 * classify as INSUFFICIENT, and 3 < 5 only produces that result if 5 is the
 * insufficient/limited line, not the limited/adequate one. `limited` and
 * `adequate` above MIN_X aren't specified by the request; 2x and 4x the
 * stated minimum is the convention used here — a reasonable default, not a
 * value taken from anywhere else, worth revisiting with real season-length
 * data once this is live.
 */
export const EVIDENCE_THRESHOLDS = {
  /** A team's overall historical sample — Historical Advantage, Historical Confidence, Consensus. */
  totalMatches: { insufficient: 5, limited: 10, adequate: 20 } as EvidenceThresholds,
  /** A venue-specific split (Home/Away Split module, venue performance claims). */
  homeMatches: { insufficient: 5, limited: 10, adequate: 20 } as EvidenceThresholds,
  awayMatches: { insufficient: 5, limited: 10, adequate: 20 } as EvidenceThresholds,
  /** Head-to-head history between two specific teams. */
  headToHead: { insufficient: 3, limited: 6, adequate: 12 } as EvidenceThresholds,
  /** A population size for a z-score mean/stddev — matches the backend's own MIN_POPULATION=5. */
  population: { insufficient: 5, limited: 10, adequate: 20 } as EvidenceThresholds,
  /** A backtest/calibration sample — matches the backend's own historicalRate preset. */
  backtestSample: { insufficient: 50, limited: 100, adequate: 200 } as EvidenceThresholds,
} as const;

export interface EvidenceResult {
  matchesAvailable: number;
  threshold: EvidenceThresholds;
  quality: EvidenceQuality;
  /** True only for ADEQUATE or STRONG — the boundary between "show it, caveated" and "state it plainly". */
  sufficient: boolean;
}

export function evaluateEvidence(matchesAvailable: number, threshold: EvidenceThresholds): EvidenceResult {
  const quality: EvidenceQuality =
    matchesAvailable < threshold.insufficient ? "INSUFFICIENT"
    : matchesAvailable < threshold.limited ? "LIMITED"
    : matchesAvailable < threshold.adequate ? "ADEQUATE"
    : "STRONG";
  return {
    matchesAvailable,
    threshold,
    quality,
    sufficient: quality === "ADEQUATE" || quality === "STRONG",
  };
}
