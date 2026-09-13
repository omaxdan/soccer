// MATCH INTELLIGENCE READ-MODEL TESTS (S-7/S-8/B3 serving) — DB-free.
//
// Exercises the PURE mappers/assembler of snapshot/read/matchIntelligence.ts against
// the shapes of the two production-validated sealed snapshots (1163/1164). No DB.
// Proves: governed VCV + snapshot_as_of surfaced; HOME/AWAY preparedness mapped with
// the scored team; partial 55/60 stays 55/60 and 0.9167 stays 0.9167; absent
// squad_stability stays absent (never zero-filled); cited evidence is a separate
// array (no context mixed in); ungoverned graded fields stay null; numerics stay
// exact text.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapProvenance,
  mapVerdict,
  mapCitedEvidence,
  attachPreparednessTeams,
  assembleMatchIntelligence,
  type SnapshotHeadRow,
  type VerdictRow,
  type CitedEvidenceRow,
} from '../read/matchIntelligence';
import type { SnapshotPreparednessSide } from '../read/snapshotPreparedness';

// ── shared shapes modelled on snapshot 1163 (fixture 1384, home 599 / away 602) ──

const HEAD_1163: SnapshotHeadRow = {
  match_snapshot_id: '1163',
  fixture_id: '1384',
  fixture_partition_on: '2026-09-13',
  snapshot_point_code: 'T_MINUS_7D',
  snapshot_as_of: new Date('2026-09-13T12:30:00.000Z'),
  sealed_at: new Date('2026-09-13T12:36:35.000Z'),
  content_checksum_hex: 'deadbeef',
  verdict_composition_version: '1.3.0',
  checksum_algorithm_version: 'v1',
};

// Verdict with governed edges present and every ungoverned graded field NULL.
const VERDICT_1163: VerdictRow = {
  consensus_supports_count: 1,
  consensus_contradicts_count: 0,
  consensus_neutral_count: 1,
  consensus_inactive_count: 2,
  evidence_count: 2,
  completeness_ratio: '0.500000',
  form_edge: '5.2000',
  rest_edge: null,
  readiness_edge: null,
  travel_edge: null,
  congestion_edge: null,
  availability_edge: null,
  risk_score: null,
  confidence: null,
  historical_reliability_baseline_id: null,
};

describe('match intelligence — provenance', () => {
  test('surfaces governed VCV, snapshot_as_of, sealed_at, checksum, immutability', () => {
    const p = mapProvenance(HEAD_1163);
    assert.equal(p.matchSnapshotId, '1163');
    assert.equal(p.fixtureId, '1384');
    assert.equal(p.verdictCompositionVersion, '1.3.0');
    assert.equal(p.checksumAlgorithmVersion, 'v1');
    assert.equal(p.snapshotAsOf, '2026-09-13T12:30:00.000Z');
    assert.equal(p.sealedAt, '2026-09-13T12:36:35.000Z');
    assert.equal(p.contentChecksumHex, 'deadbeef');
    assert.equal(p.immutable, true);
  });
});

describe('match intelligence — verdict', () => {
  test('maps counts to numbers; keeps governed edges; ungoverned graded fields stay null', () => {
    const v = mapVerdict(VERDICT_1163);
    assert.equal(v.consensusSupportsCount, 1);
    assert.equal(v.consensusInactiveCount, 2);
    assert.equal(v.evidenceCount, 2);
    assert.equal(v.completenessRatio, '0.500000'); // exact text, not a float
    assert.equal(v.formEdge, '5.2000'); // governed edge, verbatim text
    assert.equal(v.restEdge, null);
    // No governed substrate → null, never fabricated 0.
    for (const nullField of [v.readinessEdge, v.travelEdge, v.congestionEdge, v.availabilityEdge, v.riskScore, v.confidence, v.historicalReliabilityBaselineId]) {
      assert.equal(nullField, null);
    }
  });

  test('confidence is null (calibration not producing) — never a fabricated percentage', () => {
    assert.equal(mapVerdict(VERDICT_1163).confidence, null);
  });
});

describe('match intelligence — preparedness (partial 55/60, absent squad stays absent)', () => {
  // Sealed rows exactly as production 1163: PARTIAL 55/60, squad absent.
  const PREP_1163: readonly SnapshotPreparednessSide[] = [
    { side: 'AWAY', preparednessPoints: '28.6000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167' },
    { side: 'HOME', preparednessPoints: '13.5000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167' },
  ];

  test('attaches the scored team (HOME→home 599, AWAY→away 602) and preserves values', () => {
    const view = attachPreparednessTeams(PREP_1163, { homeTeamId: '599', awayTeamId: '602' });
    const home = view.find((v) => v.side === 'HOME');
    const away = view.find((v) => v.side === 'AWAY');
    assert.ok(home && away);
    assert.equal(home!.teamId, '599');
    assert.equal(away!.teamId, '602');
    assert.equal(home!.preparednessPoints, '13.5000'); // verbatim, not 13.5
    assert.equal(away!.preparednessPoints, '28.6000');
    assert.equal(home!.availablePoints, '55'); // 55/60 stays 55/60 — not promoted to 60
    assert.equal(home!.declaredPoints, '60');
    assert.equal(home!.coverageRatio, '0.9167'); // stays 0.9167, not recomputed
  });

  test('zero-coverage shape: NULL points stay NULL (never fabricated 0)', () => {
    const zero: readonly SnapshotPreparednessSide[] = [
      { side: 'HOME', preparednessPoints: null, availablePoints: '0', declaredPoints: '60', coverageRatio: '0.0000' },
    ];
    const view = attachPreparednessTeams(zero, { homeTeamId: '10', awayTeamId: '20' });
    assert.equal(view[0].preparednessPoints, null);
    assert.equal(view[0].availablePoints, '0');
  });
});

describe('match intelligence — cited evidence vs context separation', () => {
  // The 6 preparedness inputs 1163 would cite; squad_stability deliberately ABSENT.
  const CITED_ROWS: CitedEvidenceRow[] = [
    { feature_key: 'team.away_form', subject_team_id: '602', value: '28.60', feature_version_id: '11', feature_value_id: '900', cited_as_of: new Date('2026-08-30T00:00:00.000Z'), provenance_class_code: 'DERIVED', sample_observation_count: 6, sample_meets_threshold: true },
    { feature_key: 'team.away_win_rate', subject_team_id: '602', value: '100.00', feature_version_id: '12', feature_value_id: '901', cited_as_of: new Date('2026-08-30T00:00:00.000Z'), provenance_class_code: 'DERIVED', sample_observation_count: 4, sample_meets_threshold: false },
    { feature_key: 'team.congestion_index', subject_team_id: '599', value: '10.00', feature_version_id: '13', feature_value_id: '902', cited_as_of: new Date('2026-08-30T00:00:00.000Z'), provenance_class_code: 'DERIVED', sample_observation_count: 3, sample_meets_threshold: true },
    { feature_key: 'team.home_form', subject_team_id: '599', value: '0.00', feature_version_id: '11', feature_value_id: '903', cited_as_of: new Date('2026-08-30T00:00:00.000Z'), provenance_class_code: 'DERIVED', sample_observation_count: 5, sample_meets_threshold: true },
  ];

  test('cited evidence maps to its own array with lineage; value kept as exact text', () => {
    const items = CITED_ROWS.map(mapCitedEvidence);
    const homeForm = items.find((i) => i.featureKey === 'team.home_form' && i.subjectTeamId === '599');
    assert.ok(homeForm);
    assert.equal(homeForm!.value, '0.00'); // present-but-zero preserved verbatim, not dropped
    assert.equal(homeForm!.featureVersionId, '11');
    assert.equal(homeForm!.provenanceClassCode, 'DERIVED');
    assert.equal(homeForm!.citedAsOf, '2026-08-30T00:00:00.000Z');
    // below-threshold flag preserved honestly
    const awayWin = items.find((i) => i.featureKey === 'team.away_win_rate');
    assert.equal(awayWin!.sampleMeetsThreshold, false);
  });

  test('absent squad_stability stays absent — it is simply not in citedEvidence', () => {
    const items = CITED_ROWS.map(mapCitedEvidence);
    assert.equal(items.some((i) => i.featureKey === 'team.squad_stability'), false);
    // and no synthetic squad component is fabricated elsewhere in the model
  });

  test('assembled object exposes citedEvidence only — no context array is mixed in', () => {
    const mi = assembleMatchIntelligence({
      provenance: mapProvenance(HEAD_1163),
      verdict: mapVerdict(VERDICT_1163),
      preparedness: attachPreparednessTeams(
        [{ side: 'HOME', preparednessPoints: '13.5000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167' }],
        { homeTeamId: '599', awayTeamId: '602' }
      ),
      citedEvidence: CITED_ROWS.map(mapCitedEvidence),
    });
    assert.ok(Array.isArray(mi.citedEvidence));
    assert.equal(mi.citedEvidence.length, 4);
    // The sealed model must NOT carry a `context` field — context is composed at the
    // API layer from live reads and kept strictly separate.
    assert.equal((mi as unknown as Record<string, unknown>).context, undefined);
    // verdict/edges come only from the sealed verdict source.
    assert.equal(mi.verdict.formEdge, '5.2000');
    assert.equal(mi.provenance.verdictCompositionVersion, '1.3.0');
  });
});
