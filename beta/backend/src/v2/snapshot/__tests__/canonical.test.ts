// SNAPSHOT CANONICAL CHECKSUM TESTS (S-7 v1) — DB-free.
//
// Proves the v1 canonical serialisation is deterministic and content-sensitive:
// identical content → identical digest; any governed content change → a different
// digest; null distinct from "null"; decimals preserved verbatim; timestamps in
// microsecond ISO; object keys lexicographic; arrays kept in caller order; the
// seven sections hashed in the declared order.

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canon, canonicalString, contentChecksumHex, canonicalTimestamp, decimal,
  CHECKSUM_ALGORITHM_DESIGNATION, CHECKSUM_DIGEST_ALGORITHM, type SnapshotContent,
} from '../canonical';

describe('canonical primitives', () => {
  test('null is the bare token, distinct from the quoted string "null"', () => {
    assert.equal(canon(null), 'null');
    assert.equal(canon('null'), '"null"');
    assert.notEqual(canon(null), canon('null'));
  });

  test('booleans and integers', () => {
    assert.equal(canon(true), 'true');
    assert.equal(canon(false), 'false');
    assert.equal(canon(0), '0');
    assert.equal(canon(-12), '-12');
  });

  test('a non-integer number is rejected (float-format hazard barred from the digest)', () => {
    assert.throws(() => canon(0.1 + 0.2), /non-integer/);
  });

  test('decimals are carried verbatim, scale preserved, and are distinct from ints/strings', () => {
    assert.equal(canon(decimal('80.00')), '#80.00');
    assert.equal(canon(decimal('0')), '#0');
    assert.equal(canon(decimal('-12')), '#-12');
    assert.notEqual(canon(decimal('80')), canon(80));
    assert.notEqual(canon(decimal('80')), canon('80'));
    assert.throws(() => decimal('8e1'), /plain numeric text/);
    assert.throws(() => decimal('80.00 '), /plain numeric text/);
  });

  test('timestamps serialise as ISO-8601 UTC microseconds', () => {
    assert.equal(canonicalTimestamp(new Date('2027-07-01T00:00:00.000Z')), '2027-07-01T00:00:00.000000Z');
    assert.equal(canon(new Date('2027-07-01T00:00:00Z')), '"2027-07-01T00:00:00.000000Z"');
  });

  test('object keys are lexicographic, regardless of insertion order', () => {
    assert.equal(canon({ b: 1, a: 2, c: 3 }), canon({ c: 3, a: 2, b: 1 }));
    assert.equal(canon({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  test('arrays preserve caller order (content is ordered by the caller, not re-sorted)', () => {
    assert.notEqual(canon([1, 2, 3]), canon([3, 2, 1]));
    assert.equal(canon([1, 2, 3]), '[1,2,3]');
  });

  test('the algorithm identity is v1 / sha256', () => {
    assert.equal(CHECKSUM_ALGORITHM_DESIGNATION, 'v1');
    assert.equal(CHECKSUM_DIGEST_ALGORITHM, 'sha256');
  });
});

describe('snapshot content checksum', () => {
  const base: SnapshotContent = {
    header: { fixtureId: '2557', snapshotPointCode: 'KICKOFF', snapshotAsOf: new Date('2027-07-01T00:00:00Z'), verdictComposition: '1.0.0' },
    versionManifest: [{ componentKind: 'MODULE_VERSION', componentVersionId: '1' }, { componentKind: 'FEATURE_VERSION', componentVersionId: '5' }],
    featureState: [{ featureValueId: '10', value: decimal('80.00'), sampleMeetsThreshold: true }],
    moduleReadings: [{ readingId: '100', moduleKey: 'home_away_split', status: 'SUPPORTS' }],
    modelOutputs: [],
    completenessItems: [{ absenceKind: 'MODULE_INACTIVE', moduleDefinitionId: '7' }],
    verdict: { evidenceCount: 2, consensusSupportsCount: 2, readinessEdge: null, riskScore: null, confidence: null },
  };

  test('identical content → identical checksum (deterministic)', () => {
    assert.equal(contentChecksumHex(base), contentChecksumHex(structuredClone(base)));
  });

  test('reordering object keys within a section does not change the checksum', () => {
    const reordered: SnapshotContent = {
      ...base,
      verdict: { confidence: null, riskScore: null, readinessEdge: null, consensusSupportsCount: 2, evidenceCount: 2 },
    };
    assert.equal(contentChecksumHex(reordered), contentChecksumHex(base));
  });

  test('changing a cited value changes the checksum', () => {
    const tampered: SnapshotContent = { ...base, featureState: [{ featureValueId: '10', value: decimal('81.00'), sampleMeetsThreshold: true }] };
    assert.notEqual(contentChecksumHex(tampered), contentChecksumHex(base));
  });

  test('changing a reading status changes the checksum', () => {
    const tampered: SnapshotContent = { ...base, moduleReadings: [{ readingId: '100', moduleKey: 'home_away_split', status: 'NEUTRAL' }] };
    assert.notEqual(contentChecksumHex(tampered), contentChecksumHex(base));
  });

  test('changing a consensus count changes the checksum', () => {
    const tampered: SnapshotContent = { ...base, verdict: { ...(base.verdict as object), consensusSupportsCount: 1 } as any };
    assert.notEqual(contentChecksumHex(tampered), contentChecksumHex(base));
  });

  test('section ORDER is load-bearing: swapping two sections changes the checksum', () => {
    // Manually build the ordered array in the wrong order and confirm it differs.
    const correct = canonicalString(base);
    const swapped = canon([
      base.header,
      [...base.featureState],           // sections 2 and 3 swapped
      [...base.versionManifest],
      [...base.moduleReadings],
      [...base.modelOutputs],
      [...base.completenessItems],
      base.verdict,
    ] as any);
    assert.notEqual(swapped, correct);
  });

  test('a NULL graded field is part of the hashed content (distinct from absent)', () => {
    // Two verdicts identical except confidence null vs a value must differ.
    const withConfidence: SnapshotContent = { ...base, verdict: { ...(base.verdict as object), confidence: decimal('0.50') } as any };
    assert.notEqual(contentChecksumHex(withConfidence), contentChecksumHex(base));
  });
});
