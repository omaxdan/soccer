// MATCH INTELLIGENCE — RENDER TESTS (DB-free; react-dom/server, no network, no DOM).
//
// Locks the reconciled, user-facing Match Intelligence surface (Phase F):
//   • the reading at kickoff shows its dates, consensus counts, completeness and the
//     recorded edges — with un-recorded edges/risk/confidence stated, never zeroed;
//   • module readings show name · subject · status word · verbatim verdict · sample;
//   • cited evidence shows input · team · value · kind · sample, with NO feature ids,
//     versions or checksums;
//   • historical response shows after-win / after-loss with an APPLIES marker;
//   • CRITICAL: the surface exposes none of the internal vocabulary (sealed, governed,
//     snapshot, provenance, checksum, immutable, composition, feature version) and no
//     betting lexicon.
//
// Runs under tsconfig.test.json (jsx: react-jsx) so the component .tsx files, which do
// not import React, transform with the automatic runtime.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ReadingAtKickoff, ModuleReadings, CitedEvidenceTable, HistoricalResponse, NearFutureNote, IntelligenceUnavailable,
} from '@/components/v2/intelligence';
import type { MatchIntelligence, HistoricalResponseSide } from '@/lib/v2/types';

const INTEL: MatchIntelligence = {
  provenance: {
    fixtureId: '354', matchSnapshotId: '1091', fixturePartitionOn: '2026-09-07',
    snapshotPointCode: 'KICKOFF', snapshotAsOf: '2026-09-07T23:00:00.000Z',
    sealedAt: '2026-09-08T07:25:04.000Z', verdictCompositionVersion: '1.2.0',
    checksumAlgorithmVersion: 'v1', contentChecksumHex: 'deadbeef', immutable: true,
  },
  verdict: {
    consensusSupportsCount: 3, consensusContradictsCount: 2, consensusNeutralCount: 0,
    consensusInactiveCount: 7, evidenceCount: 5, completenessRatio: '0.500000',
    formEdge: '34.00', restEdge: '-6.1', readinessEdge: null, travelEdge: null,
    congestionEdge: null, availabilityEdge: null, riskScore: null, confidence: null,
    historicalReliabilityBaselineId: null,
  },
  modules: [
    { moduleKey: 'home_away_split', displayName: 'Home/Away Split', displayNumber: 1, moduleVersion: '1.0.0', subjectKindCode: 'TEAM', subjectTeamId: '66', status: 'SUPPORTS', strength: null, confidence: null, sampleObservationCount: 2, sampleMeetsThreshold: true, asOf: '2026-08-31T23:00:00.000Z', verdictText: 'Pronounced home/away split.' },
    { moduleKey: 'travel_impact', displayName: 'Travel Impact', displayNumber: 5, moduleVersion: '1.0.0', subjectKindCode: 'FIXTURE', subjectTeamId: null, status: 'CONTRADICTS', strength: null, confidence: null, sampleObservationCount: 2, sampleMeetsThreshold: true, asOf: '2026-08-31T23:00:00.000Z', verdictText: 'Home travelled 1669 km farther.' },
    { moduleKey: 'readiness_tracker', displayName: 'Readiness Tracker', displayNumber: 2, moduleVersion: '1.0.0', subjectKindCode: 'TEAM', subjectTeamId: '71', status: 'INACTIVE', strength: null, confidence: null, sampleObservationCount: 0, sampleMeetsThreshold: false, asOf: '2026-08-31T23:00:00.000Z', verdictText: null },
  ],
  preparedness: [],
  citedEvidence: [
    { featureKey: 'team.away_form', subjectTeamId: '66', value: '0.00', featureVersionId: '2', featureValueId: '7779', citedAsOf: '2026-08-31T23:00:00.000Z', provenanceClassCode: 'DERIVED', sampleObservationCount: 3, sampleMeetsThreshold: false },
    { featureKey: 'team.rest_days', subjectTeamId: '71', value: '9.1', featureVersionId: '4', featureValueId: '7780', citedAsOf: '2026-08-31T23:00:00.000Z', provenanceClassCode: 'RECORDED', sampleObservationCount: 1, sampleMeetsThreshold: true },
  ],
};

const HISTORICAL: { home: HistoricalResponseSide | null; away: HistoricalResponseSide | null } = {
  home: { subjectId: '71', scope: 'ALL_COMPETITIONS', asOf: '2026-09-07T23:00:00.000Z', anyEngaged: true, triggers: {
    POST_WIN: { engaged: false, n: 8, response: { wins: 0, draws: 3, losses: 5 } },
    POST_LOSS: { engaged: true, n: 11, response: { wins: 5, draws: 2, losses: 4 } },
  } },
  away: { subjectId: '66', scope: 'ALL_COMPETITIONS', asOf: '2026-09-07T23:00:00.000Z', anyEngaged: false, triggers: {
    POST_WIN: { engaged: false, n: 6, response: { wins: 2, draws: 1, losses: 3 } },
    POST_LOSS: { engaged: false, n: 9, response: { wins: 3, draws: 3, losses: 3 } },
  } },
};

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

const HOME = 'Vitória', AWAY = 'Grêmio';
const fullMarkup = renderToStaticMarkup(
  <div>
    <ReadingAtKickoff intelligence={INTEL} />
    <ModuleReadings modules={INTEL.modules} homeTeamId="71" homeName={HOME} awayTeamId="66" awayName={AWAY} />
    <CitedEvidenceTable citedEvidence={INTEL.citedEvidence} homeTeamId="71" homeName={HOME} awayTeamId="66" awayName={AWAY} />
    <HistoricalResponse historicalResponse={HISTORICAL} homeName={HOME} awayName={AWAY} />
    <NearFutureNote />
  </div>,
);
const fullText = visibleText(fullMarkup);

describe('reading at kickoff', () => {
  const t = visibleText(renderToStaticMarkup(<ReadingAtKickoff intelligence={INTEL} />));
  test('shows dates, consensus counts, completeness and recorded edges', () => {
    assert.match(t, /Reading at kickoff/);
    assert.match(t, /Taken at kickoff 7 Sept 2026/);
    assert.match(t, /Locked 8 Sept 2026/);
    assert.match(t, /Supports/); assert.match(t, /Contradicts/);
    assert.match(t, /50\.00%/);              // completeness
    assert.match(t, /Form edge/); assert.match(t, /34/);   // recorded edge
    assert.match(t, /Rest edge/);
  });
  test('un-recorded edges/risk/confidence are stated, never zeroed', () => {
    assert.match(t, /not recorded/i);
    assert.doesNotMatch(t, /readiness edge\s*0/i);
  });
});

describe('module readings', () => {
  const t = visibleText(renderToStaticMarkup(<ModuleReadings modules={INTEL.modules} homeTeamId="71" homeName={HOME} awayTeamId="66" awayName={AWAY} />));
  test('name · subject · status word · verbatim verdict, in display order, no version', () => {
    assert.match(t, /Home\/Away Split/);
    assert.match(t, /Grêmio/);                       // subject team (66 = away)
    assert.match(t, /Travel Impact/); assert.match(t, /Fixture/);  // fixture-subject module
    assert.match(t, /Supports/); assert.match(t, /Contradicts/);
    assert.match(t, /Home travelled 1669 km farther\./); // verbatim verdict
    assert.match(t, /Not enough data/);              // INACTIVE readiness
    assert.doesNotMatch(t, /v1\.0\.0/);              // no module version
  });
});

describe('cited evidence — no internal ids', () => {
  const t = visibleText(renderToStaticMarkup(<CitedEvidenceTable citedEvidence={INTEL.citedEvidence} homeTeamId="71" homeName={HOME} awayTeamId="66" awayName={AWAY} />));
  test('shows input, team, value, kind, sample', () => {
    assert.match(t, /Away form/);       // humanized featureKey
    assert.match(t, /Derived/); assert.match(t, /Recorded/);
    assert.match(t, /Vitória/); assert.match(t, /Grêmio/);
  });
  test('never shows raw keys, feature versions or value ids', () => {
    assert.doesNotMatch(t, /team\.away_form/);
    assert.doesNotMatch(t, /7779/);          // featureValueId
    assert.doesNotMatch(t, /\bv2\b/);        // featureVersionId
  });
});

describe('historical response (past)', () => {
  const t = visibleText(renderToStaticMarkup(<HistoricalResponse historicalResponse={HISTORICAL} homeName={HOME} awayName={AWAY} />));
  test('after-win / after-loss counts with APPLIES on the engaged trigger', () => {
    assert.match(t, /Historical response/);
    assert.match(t, /After a win/); assert.match(t, /After a loss/);
    assert.match(t, /W5 D2 L4/);       // Vitória after a loss
    assert.match(t, /APPLIES/);
    assert.match(t, /not part of the kickoff reading/i);
  });
  test('renders nothing when historical response is absent', () => {
    assert.equal(renderToStaticMarkup(<HistoricalResponse historicalResponse={null} homeName={HOME} awayName={AWAY} />), '');
  });
});

describe('NO internal vocabulary is exposed (Phase F §16 / §83)', () => {
  const all = `${fullText} ${visibleText(renderToStaticMarkup(<IntelligenceUnavailable />))}`.toLowerCase();
  test('never exposes sealed/governed/snapshot/provenance/checksum/immutable/composition/version ids', () => {
    for (const term of ['sealed', 'governed', 'snapshot', 'provenance', 'checksum', 'immutable', 'composition', 'feature version', 'deadbeef', '1091']) {
      assert.equal(all.includes(term), false, `must not expose internal term "${term}"`);
    }
  });
  test('no betting lexicon', () => {
    for (const term of ['odds', 'bookmaker', 'stake', 'wager', 'accumulator', 'payout', 'best bet', 'betting', 'tip']) {
      assert.equal(all.includes(term), false, `must not contain betting term "${term}"`);
    }
    assert.doesNotMatch(all, /\bbet\b/);
  });
});
