// FIXTURE READINESS — pure formatter tests (DB-free).
//
// The DB queries are exercised by the operator against a live database; here we
// prove the pure formatter renders honest substrate counts (absence as 0, never
// fabricated) and never emits governed-intelligence language.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { formatReadinessReport, type ReadinessReport } from '../fixtureReadiness';

const REPORT: ReadinessReport = {
  fixture: {
    id: '61', competition: 'Brasileirão Betano', editionId: '18', season: 'Brasileiro Serie A 2026',
    kickoff: '2026-07-17T23:00:00Z', status: 'COMPLETED',
    home: { id: '67', name: 'Fluminense' }, away: { id: '64', name: 'Red Bull Bragantino' },
  },
  teams: [
    { teamId: '67', name: 'Fluminense', side: 'HOME', completedHistory: 25, competitionsViaFixtures: 3, competitionsViaRegistration: 1, editionsViaFixtures: 3, teamFeatureKeys: 12 },
    { teamId: '64', name: 'Red Bull Bragantino', side: 'AWAY', completedHistory: 25, competitionsViaFixtures: 2, competitionsViaRegistration: 1, editionsViaFixtures: 2, teamFeatureKeys: 12 },
  ],
  players: [
    { teamId: '67', name: 'Fluminense', side: 'HOME', registeredPlayers: 0, playersWithMatchStats: 22, distinctStatisticKeys: 34, availabilityRecords: 0, valuationRecords: 0, appearanceRecords: 0 },
    { teamId: '64', name: 'Red Bull Bragantino', side: 'AWAY', registeredPlayers: 0, playersWithMatchStats: 20, distinctStatisticKeys: 33, availabilityRecords: 0, valuationRecords: 0, appearanceRecords: 0 },
  ],
  match: { snapshots: 0, sealedSnapshots: 0, citedEvidenceRows: 0, governedModuleReadings: 0 },
};

describe('formatReadinessReport', () => {
  const out = formatReadinessReport(REPORT);

  test('renders fixture identity, team and player coverage counts', () => {
    assert.match(out, /REFERENCE FIXTURE/);
    assert.match(out, /Fluminense \(67\)/);
    assert.match(out, /completed history\s+25/);
    assert.match(out, /players with match stats\s+22/);
    assert.match(out, /distinct statistic keys\s+34/);
  });

  test('absence renders as an honest 0, not a fabricated value', () => {
    assert.match(out, /registered players\s+0/);
    assert.match(out, /appearance records\s+0/);
    assert.match(out, /snapshots\s+0/);
  });

  test('separates competition evidence by source (fixtures vs registration)', () => {
    assert.match(out, /competitions \(fixtures\)\s+3/);
    assert.match(out, /competitions \(registration\)\s+1/);
  });

  test('missing fixture renders an honest not-found, not an empty fabricated report', () => {
    const nf = formatReadinessReport({ ...REPORT, fixture: null });
    assert.match(nf, /not found/i);
  });

  test('emits no governed-intelligence language (it is a substrate audit only)', () => {
    const low = out.toLowerCase();
    for (const term of ['verdict', 'confidence', 'readiness score', 'preparedness', 'odds']) {
      assert.equal(low.includes(term), false, `readiness audit must not contain "${term}"`);
    }
    // word-boundary so a sponsor name like "Betano" in real competition data is not a false hit
    assert.doesNotMatch(low, /\bbet\b/);
  });
});
