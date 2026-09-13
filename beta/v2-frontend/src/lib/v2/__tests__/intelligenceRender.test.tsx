// MATCH INTELLIGENCE — RENDER TESTS (DB-free; react-dom/server, no network, no DOM).
//
// Renders the sealed-intelligence components to static markup with the canary
// shapes (snapshot 1163) and asserts the product-critical guarantees that live in
// the RENDERED output rather than in a pure helper:
//   • provenance + immutable status are surfaced from the sealed object (#9);
//   • cited evidence is its own clearly-labelled surface, distinct from context (#6);
//   • no betting language appears anywhere in the sealed surfaces (#8);
//   • honest states render literally: "No data", "Not yet calibrated" (#3/#7).
//
// Runs under tsconfig.test.json (jsx: react-jsx) so the component .tsx files, which
// do not import React, transform with the automatic runtime.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ProvenanceBar, VerdictBand, PreparednessBand, CitedEvidencePanel, IntelligenceUnavailable,
} from '@/components/v2/intelligence';
import type { MatchIntelligence } from '@/lib/v2/types';

const INTEL: MatchIntelligence = {
  provenance: {
    fixtureId: '1384', matchSnapshotId: '1163', fixturePartitionOn: '2026-09-13',
    snapshotPointCode: 'T_MINUS_7D', snapshotAsOf: '2026-09-13T12:30:00.000Z',
    sealedAt: '2026-09-13T12:36:35.000Z', verdictCompositionVersion: '1.3.0',
    checksumAlgorithmVersion: 'v1', contentChecksumHex: 'deadbeef', immutable: true,
  },
  verdict: {
    consensusSupportsCount: 1, consensusContradictsCount: 0, consensusNeutralCount: 1,
    consensusInactiveCount: 2, evidenceCount: 2, completenessRatio: '0.500000',
    formEdge: '5.2000', restEdge: null, readinessEdge: null, travelEdge: null,
    congestionEdge: null, availabilityEdge: null, riskScore: null, confidence: null,
    historicalReliabilityBaselineId: null,
  },
  preparedness: [
    { side: 'HOME', preparednessPoints: '13.5000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167', teamId: '599' },
    { side: 'AWAY', preparednessPoints: '28.6000', availablePoints: '55', declaredPoints: '60', coverageRatio: '0.9167', teamId: '602' },
  ],
  citedEvidence: [
    { featureKey: 'team.home_form', subjectTeamId: '599', value: '0.00', featureVersionId: '11', featureValueId: '903', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 5, sampleMeetsThreshold: true },
    { featureKey: 'team.congestion_index', subjectTeamId: '599', value: '10.00', featureVersionId: '13', featureValueId: '902', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 3, sampleMeetsThreshold: true },
    { featureKey: 'team.away_win_rate', subjectTeamId: '602', value: '100.00', featureVersionId: '12', featureValueId: '901', citedAsOf: '2026-08-30T00:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 4, sampleMeetsThreshold: false },
  ],
};

/** Strip tags and decode the handful of entities renderToStaticMarkup emits, so
 *  assertions run against human-visible text. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

const sealedText = visibleText(
  renderToStaticMarkup(
    <div>
      <ProvenanceBar provenance={INTEL.provenance} />
      <VerdictBand verdict={INTEL.verdict} />
      <PreparednessBand intelligence={INTEL} homeName="Flamengo" awayName="Botafogo" />
      <CitedEvidencePanel citedEvidence={INTEL.citedEvidence} />
    </div>,
  ),
);

describe('provenance / immutable rendered from the sealed object (#9)', () => {
  const p = visibleText(renderToStaticMarkup(<ProvenanceBar provenance={INTEL.provenance} />));
  test('surfaces snapshot identity, as-of, sealed-at, VCV and immutable status', () => {
    assert.match(p, /Match Intelligence/);
    assert.match(p, /#1163/);                          // snapshot identity
    assert.match(p, /Composition 1\.3\.0/);            // VCV designation
    assert.match(p, /As of 13 Sept 2026, 12:30 UTC/);  // snapshot_as_of
    assert.match(p, /immutable/i);                     // immutable status
    assert.match(p, /sealed · governed/i);             // marks it as the sealed calculation
  });
});

describe('cited evidence is its own labelled surface, separate from context (#6)', () => {
  const cited = visibleText(renderToStaticMarkup(<CitedEvidencePanel citedEvidence={INTEL.citedEvidence} />));
  test('labelled "Cited by calculation" and lists the cited feature lineage', () => {
    assert.match(cited, /Cited by calculation/);
    assert.match(cited, /team\.home_form/);   // the actual cited feature key
    assert.match(cited, /v11/);               // feature version
  });
  test('the cited surface carries no contextual-only labels (no blending)', () => {
    // Context surfaces (rendered elsewhere on the page) use these labels; they must
    // NOT appear inside the cited-by-calculation panel.
    assert.doesNotMatch(cited, /Recent venue form/i);
    assert.doesNotMatch(cited, /Live module readings/i);
    assert.doesNotMatch(cited, /Team comparison/i);
    assert.doesNotMatch(cited, /not part of calculation/i);
  });
});

describe('honest states render literally (#3 / #7)', () => {
  test('absent squad stability renders "No data"; null confidence renders "Not yet calibrated"', () => {
    assert.match(sealedText, /Squad stability/i);
    assert.match(sealedText, /No data/);            // absence, not a zero
    assert.match(sealedText, /Not yet calibrated/); // null confidence, not a meter
    assert.match(sealedText, /13\.5 \/ 60/);        // exact preparedness score preserved
    assert.match(sealedText, /91\.67%/);            // coverage rendered as percentage
  });
});

describe('no betting language in the sealed surfaces (#8)', () => {
  const unavailable = visibleText(renderToStaticMarkup(<IntelligenceUnavailable />));
  const all = `${sealedText} ${unavailable}`.toLowerCase();
  test('renders none of the betting/odds/market lexicon', () => {
    const banned = ['odds', 'bookmaker', 'bookie', 'stake', 'wager', 'accumulator', 'acca', 'payout', 'implied probability', 'best bet', 'place a bet', 'betting', 'bet slip'];
    for (const term of banned) {
      assert.equal(all.includes(term), false, `sealed surfaces must not contain betting term "${term}"`);
    }
    // guard the standalone word "bet" with a boundary so "better"/"between" don't trip it
    assert.doesNotMatch(all, /\bbet\b/);
  });
  test('uses analyst framing instead (evidence / governed / preparedness)', () => {
    assert.match(sealedText, /evidence/i);
    assert.match(sealedText, /governed/i);
    assert.match(sealedText, /preparedness/i);
  });
});
