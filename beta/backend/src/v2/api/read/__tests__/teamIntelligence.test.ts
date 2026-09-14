// TEAM INTELLIGENCE read-model tests (DB-free, pure).
//
// Proves the evidence-honest projection against the anchor corpus shape
// (Fluminense 67, Red Bull Bragantino 64, fixture 61, edition 18):
//   • raw participation/squad/availability/valuation/fixture mapping
//   • fixture classification (completed → recent desc; scheduled/postponed → upcoming asc)
//   • home/away context split
//   • per-key statistic coverage: numeric total/mean ONLY for value_type='number'
//     (non-numeric keys keep null totals — never a fabricated 0); missing stays absent;
//     present-but-zero stays a real 0
//   • deterministic ordering
//   • next-fixture availability: an explicit covering spell ⇒ EXPLICITLY UNAVAILABLE,
//     everyone else ⇒ UNKNOWN (never "available", never a card-inferred suspension)
//   • coverage flags mark unsupported substrate honestly
// and that NO governed intelligence (verdict/score/confidence/readiness/predicted XI)
// is produced by any pure function.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapParticipation, mapSquadMember, mapAvailability, mapValuation, mapFixture,
  classifyTeamFixtures, splitHomeAway, aggregateStatKeys, groupPerformances,
  spellCoversDate, classifyNextFixtureSquad, buildCoverage,
  type ParticipationRow, type SquadRow, type AvailabilityRow, type ValuationRow,
  type FixtureRow, type StatKeyRow, type PerformanceRow,
  type TeamSquadMember, type TeamAvailabilityRecord,
} from '../teamIntelligence';

// ── mappers ──────────────────────────────────────────────────────────────────────

describe('mapParticipation', () => {
  const r: ParticipationRow = {
    competition_edition_id: '18', season_label: 'Brasileiro Serie A 2026',
    competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano',
    fixtures_total: '25', completed: '20', scheduled: '4', postponed: '1',
    registered: true, first_kickoff: '2026-04-01T18:00:00.000Z', last_kickoff: '2026-11-30T20:00:00.000Z',
  };
  const p = mapParticipation(r);

  test('coerces count strings to numbers and carries registration evidence separately', () => {
    assert.equal(p.fixturesTotal, 25);
    assert.equal(p.completed, 20);
    assert.equal(p.scheduled, 4);
    assert.equal(p.postponed, 1);
    assert.equal(p.registered, true);
    assert.deepEqual(p.competition, { id: '9', name: 'Brasileirão Betano', slug: 'brasileirao-betano' });
  });

  test('null kickoff bounds stay null, present ones become ISO', () => {
    assert.equal(p.firstKickoff, '2026-04-01T18:00:00.000Z');
    const nulls = mapParticipation({ ...r, first_kickoff: null, last_kickoff: null });
    assert.equal(nulls.firstKickoff, null);
    assert.equal(nulls.lastKickoff, null);
  });

  test('fixture participation is distinct from registration (fixtures without registration)', () => {
    const noReg = mapParticipation({ ...r, registered: false });
    assert.equal(noReg.registered, false);
    assert.equal(noReg.fixturesTotal, 25); // still surfaced via fixture evidence
  });
});

describe('mapSquadMember / mapAvailability / mapValuation', () => {
  test('squad member carries raw registration kind + period bounds', () => {
    const r: SquadRow = { player_id: '1001', full_name: 'Germán Cano', short_name: 'Cano', slug: 'german-cano', registration_kind_code: 'PERMANENT', registration_from: '2026-01-01', registration_to: null };
    assert.deepEqual(mapSquadMember(r), {
      playerId: '1001', fullName: 'Germán Cano', shortName: 'Cano', slug: 'german-cano',
      registrationKindCode: 'PERMANENT', registrationFrom: '2026-01-01', registrationTo: null,
    });
  });

  test('availability severity rank coerces, null stays null; is_current preserved', () => {
    const withRank = mapAvailability({ player_id: '1', full_name: 'X', unavailability_kind_code: 'INJURY', spell_from: '2026-07-01', spell_to: '2026-08-01', expected_return_on: '2026-08-01', reason: 'hamstring', severity_rank: '3', is_current: true });
    assert.equal(withRank.severityRank, 3);
    assert.equal(withRank.current, true);
    const noRank = mapAvailability({ player_id: '1', full_name: 'X', unavailability_kind_code: 'INJURY', spell_from: null, spell_to: null, expected_return_on: null, reason: null, severity_rank: null, is_current: false });
    assert.equal(noRank.severityRank, null);
  });

  test('valuation carries exact numeric text amount (never a float)', () => {
    const v: ValuationRow = { player_id: '1', full_name: 'X', amount: '12000000.50', currency_code: 'EUR', as_of_on: '2026-06-01', source_code: 'TM' };
    assert.equal(mapValuation(v).amount, '12000000.50');
  });

  // ── Issue 1: epoch/zero expected-return sentinel must not surface as 1970-01-01 ──
  test('availability: valid expectedReturnOn survives; current independent of it', () => {
    const v = mapAvailability({ player_id: '2', full_name: 'Cano', unavailability_kind_code: 'INJURY', spell_from: '2026-07-01', spell_to: null, expected_return_on: '2026-08-01', reason: 'hamstring', severity_rank: '3', is_current: true });
    assert.equal(v.expectedReturnOn, '2026-08-01');
    assert.equal(v.current, true);
  });

  test('availability: a stored epoch (1970-01-01) expected-return becomes null, current stays true', () => {
    const v = mapAvailability({ player_id: '2', full_name: 'Cano', unavailability_kind_code: 'INJURY', spell_from: '2026-07-01', spell_to: null, expected_return_on: '1970-01-01', reason: 'hamstring', severity_rank: '3', is_current: true });
    assert.equal(v.expectedReturnOn, null); // not '1970-01-01'
    assert.equal(v.current, true);
    assert.equal(v.from, '2026-07-01');
  });

  test('availability: absent expected-return stays null', () => {
    const v = mapAvailability({ player_id: '3', full_name: 'X', unavailability_kind_code: 'SUSPENSION', spell_from: '2026-07-01', spell_to: '2026-07-15', expected_return_on: null, reason: null, severity_rank: null, is_current: false });
    assert.equal(v.expectedReturnOn, null);
  });
});

// ── fixtures ───────────────────────────────────────────────────────────────────────

function fx(over: Partial<FixtureRow> & { fixture_id: string; scheduled_kickoff_at: string; status: string; is_home: boolean }): FixtureRow {
  return {
    competition_id: '9', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano',
    opp_id: '64', opp_name: 'Red Bull Bragantino', opp_slug: 'red-bull-bragantino',
    goals_for: null, goals_against: null,
    ...over,
  };
}

describe('mapFixture', () => {
  test('score is present only when both goals present; a real 0-0 is kept', () => {
    assert.equal(mapFixture(fx({ fixture_id: '1', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', status: 'SCHEDULED', is_home: true })).score, null);
    assert.deepEqual(mapFixture(fx({ fixture_id: '2', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', status: 'COMPLETED', is_home: true, goals_for: 0, goals_against: 0 })).score, { home: 0, away: 0 });
    assert.deepEqual(mapFixture(fx({ fixture_id: '3', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', status: 'COMPLETED', is_home: false, goals_for: '1', goals_against: '2' })).score, { home: 1, away: 2 });
  });
});

describe('classifyTeamFixtures', () => {
  const rows: FixtureRow[] = [
    fx({ fixture_id: '61', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', status: 'COMPLETED', is_home: true, goals_for: 1, goals_against: 1 }),
    fx({ fixture_id: '40', scheduled_kickoff_at: '2026-05-03T21:30:00.000Z', status: 'COMPLETED', is_home: false, goals_for: 0, goals_against: 2 }),
    fx({ fixture_id: '80', scheduled_kickoff_at: '2026-09-01T20:00:00.000Z', status: 'SCHEDULED', is_home: false }),
    fx({ fixture_id: '85', scheduled_kickoff_at: '2026-08-20T20:00:00.000Z', status: 'POSTPONED', is_home: true }),
  ];
  const { recent, upcoming } = classifyTeamFixtures(rows);

  test('completed → recent, newest first', () => {
    assert.deepEqual(recent.map((f) => f.fixtureId), ['61', '40']);
  });

  test('scheduled + postponed → upcoming, soonest first', () => {
    assert.deepEqual(upcoming.map((f) => f.fixtureId), ['85', '80']);
  });

  test('does not mutate input and classifies every row exactly once', () => {
    assert.equal(rows[0].fixture_id, '61');
    assert.equal(recent.length + upcoming.length, rows.length);
  });

  test('splitHomeAway partitions recent by venue side', () => {
    const { home, away } = splitHomeAway(recent);
    assert.deepEqual(home.map((f) => f.fixtureId), ['61']);
    assert.deepEqual(away.map((f) => f.fixtureId), ['40']);
  });
});

// ── statistic coverage ───────────────────────────────────────────────────────────

describe('aggregateStatKeys', () => {
  const rows: StatKeyRow[] = [
    // numeric key with rows → total + mean derived
    { statistic_key: 'rating', value_type: 'number', fixtures: '2', players: '22', numeric_sum: '270.0', numeric_count: '40' },
    // numeric key present-but-all-zero → total 0, mean 0 (a real 0, not absence)
    { statistic_key: 'goals', value_type: 'number', fixtures: '2', players: '22', numeric_sum: '0', numeric_count: '20' },
    // JSON / non-numeric key → null totals, never fabricated 0
    { statistic_key: 'ratingVersions', value_type: 'json', fixtures: '2', players: '22', numeric_sum: null, numeric_count: '0' },
    // numeric key declared but with NO parseable numeric rows → absence stays null
    { statistic_key: 'note', value_type: 'number', fixtures: '1', players: '1', numeric_sum: null, numeric_count: '0' },
  ];
  const keys = aggregateStatKeys(rows);
  const by = (k: string) => keys.find((x) => x.statisticKey === k)!;

  test('numeric total and mean derived only from numeric rows', () => {
    assert.equal(by('rating').numericTotal, '270');
    assert.equal(by('rating').numericMean, '6.75');
  });

  test('present-but-zero is a real 0 total/mean, not absence', () => {
    assert.equal(by('goals').numericTotal, '0');
    assert.equal(by('goals').numericMean, '0');
  });

  test('non-numeric (json) key keeps null totals — never fabricated to 0', () => {
    assert.equal(by('ratingVersions').numericTotal, null);
    assert.equal(by('ratingVersions').numericMean, null);
    assert.equal(by('ratingVersions').valueType, 'json');
  });

  test('numeric-typed key with no parseable rows stays absent (null), never 0', () => {
    assert.equal(by('note').numericTotal, null);
    assert.equal(by('note').numericMean, null);
  });

  test('coverage keys ordered deterministically by key', () => {
    assert.deepEqual(keys.map((k) => k.statisticKey), ['goals', 'note', 'rating', 'ratingVersions']);
  });
});

// ── performances grouping ──────────────────────────────────────────────────────────

describe('groupPerformances', () => {
  const rows: PerformanceRow[] = [
    { player_id: '2', full_name: 'Zubeldía', statistic_key: 'rating', statistic_value: '6.0', value_type: 'number' },
    { player_id: '1', full_name: 'Arias', statistic_key: 'rating', statistic_value: '7.5', value_type: 'number' },
    { player_id: '1', full_name: 'Arias', statistic_key: 'assists', statistic_value: '1', value_type: 'number' },
    { player_id: '1', full_name: 'Arias', statistic_key: 'ratingVersions', statistic_value: '{"alt":7.4}', value_type: 'json' },
  ];
  const grouped = groupPerformances(rows);

  test('one entry per player, players ordered by name, stats ordered by key', () => {
    assert.deepEqual(grouped.map((g) => g.fullName), ['Arias', 'Zubeldía']);
    assert.deepEqual(grouped[0].statistics.map((s) => s.key), ['assists', 'rating', 'ratingVersions']);
  });

  test('raw values pass through unchanged (json string preserved, no aggregation)', () => {
    const versions = grouped[0].statistics.find((s) => s.key === 'ratingVersions')!;
    assert.equal(versions.value, '{"alt":7.4}');
    assert.equal(versions.valueType, 'json');
  });
});

// ── next-fixture availability (explicit only) ──────────────────────────────────────

describe('spellCoversDate', () => {
  test('closed spell covers [from, to)', () => {
    assert.equal(spellCoversDate('2026-07-01', '2026-08-01', '2026-07-17'), true);
    assert.equal(spellCoversDate('2026-07-01', '2026-08-01', '2026-08-01'), false); // upper exclusive
    assert.equal(spellCoversDate('2026-07-01', '2026-08-01', '2026-06-30'), false);
  });
  test('null bounds are open-ended', () => {
    assert.equal(spellCoversDate(null, null, '2026-07-17'), true);
    assert.equal(spellCoversDate('2026-07-01', null, '2030-01-01'), true);
    assert.equal(spellCoversDate(null, '2026-08-01', '2026-07-17'), true);
  });
});

describe('classifyNextFixtureSquad', () => {
  const fixture = mapFixture(fx({ fixture_id: '90', scheduled_kickoff_at: '2026-07-17T23:00:00.000Z', status: 'SCHEDULED', is_home: true }));
  const squad: TeamSquadMember[] = [
    { playerId: '1', fullName: 'Arias', shortName: null, slug: 'arias', registrationKindCode: 'PERMANENT', registrationFrom: null, registrationTo: null },
    { playerId: '2', fullName: 'Cano', shortName: null, slug: 'cano', registrationKindCode: 'PERMANENT', registrationFrom: null, registrationTo: null },
    { playerId: '3', fullName: 'Nonato', shortName: null, slug: 'nonato', registrationKindCode: 'PERMANENT', registrationFrom: null, registrationTo: null },
  ];
  const availability: TeamAvailabilityRecord[] = [
    // Cano — injury spell covers the fixture date → EXPLICITLY UNAVAILABLE
    { playerId: '2', fullName: 'Cano', unavailabilityKindCode: 'INJURY', from: '2026-07-01', to: '2026-08-01', expectedReturnOn: '2026-08-01', reason: 'hamstring', severityRank: 3, current: true },
    // Nonato — a spell that ENDED before the fixture (does not cover the date)
    { playerId: '3', fullName: 'Nonato', unavailabilityKindCode: 'INJURY', from: '2026-05-01', to: '2026-06-01', expectedReturnOn: '2026-06-01', reason: 'knock', severityRank: 1, current: false },
  ];
  const ctx = classifyNextFixtureSquad(fixture, squad, availability);

  test('only a spell covering the fixture date marks EXPLICITLY UNAVAILABLE', () => {
    assert.deepEqual(ctx.explicitlyUnavailable.map((p) => p.playerId), ['2']);
    assert.equal(ctx.explicitlyUnavailable[0].unavailabilityKindCode, 'INJURY');
    assert.equal(ctx.explicitlyUnavailable[0].expectedReturnOn, '2026-08-01');
  });

  test('all other registered players are UNKNOWN — never inferred "available"', () => {
    assert.deepEqual(ctx.availabilityUnknown.map((p) => p.playerId).sort(), ['1', '3']);
    // The read model never emits an "available" status field.
    assert.equal((ctx as unknown as Record<string, unknown>).available, undefined);
  });

  test('registered count equals the squad size; no predicted XI is produced', () => {
    assert.equal(ctx.registeredCount, 3);
    assert.equal(ctx.explicitlyUnavailable.length + ctx.availabilityUnknown.length, 3);
    // No lineup / predicted XI / probability surface exists on the context.
    for (const forbidden of ['lineup', 'predictedXi', 'predictedXI', 'startingXi', 'probability']) {
      assert.equal((ctx as unknown as Record<string, unknown>)[forbidden], undefined);
    }
  });

  test('an ended (non-covering) spell must NOT become an inferred suspension', () => {
    // Nonato had a spell but it ended before the fixture: he is UNKNOWN, not unavailable.
    assert.equal(ctx.explicitlyUnavailable.some((p) => p.playerId === '3'), false);
    assert.equal(ctx.availabilityUnknown.some((p) => p.playerId === '3'), true);
  });
});

// ── coverage metadata ──────────────────────────────────────────────────────────────

describe('buildCoverage', () => {
  test('present when rows exist, absent when empty — honest, never fabricated', () => {
    const cov = buildCoverage({ squad: [{}], availability: [], valuations: [{}], playersWithStats: 22 });
    assert.equal(cov.registrations, 'present');
    assert.equal(cov.availability, 'absent');
    assert.equal(cov.valuations, 'present');
    assert.equal(cov.playerMatchStatistics, 'present');
  });

  test('unsupported substrate is marked not-supported (no writer / no read model)', () => {
    const cov = buildCoverage({ squad: [], availability: [], valuations: [], playersWithStats: 0 });
    assert.equal(cov.appearances, 'not-supported');
    assert.equal(cov.perPlayerCards, 'not-supported');
    assert.equal(cov.standings, 'not-supported');
    assert.equal(cov.managerReferee, 'not-supported');
    assert.equal(cov.playerMatchStatistics, 'absent');
  });

  test('statistic totals are flagged as derived aggregates, not governed intelligence', () => {
    assert.equal(buildCoverage({ squad: [], availability: [], valuations: [], playersWithStats: 0 }).statisticsAreDerivedAggregates, true);
  });
});

// ── governance guard: no governed-intelligence language leaks into the projection ──

describe('no governed intelligence is produced', () => {
  test('serialized coverage + aggregates contain no verdict/score/readiness/prediction fields', () => {
    const keys = aggregateStatKeys([
      { statistic_key: 'rating', value_type: 'number', fixtures: '1', players: '11', numeric_sum: '77', numeric_count: '11' },
    ]);
    const cov = buildCoverage({ squad: [{}], availability: [{}], valuations: [{}], playersWithStats: 11 });
    const blob = JSON.stringify({ keys, cov }).toLowerCase();
    for (const term of ['verdict', 'confidence', 'readiness', 'preparedness', 'predicted', 'probability', 'odds', 'score']) {
      assert.equal(blob.includes(term), false, `team read model must not emit "${term}"`);
    }
  });
});
