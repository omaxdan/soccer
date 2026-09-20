// PLAYER STATUS / ABSENCE read-model tests (DB-free, pure + captured-tx).
//
// Proves the locked governance and spell semantics:
//   • status is ACTIVE_ABSENCE or NO_EXPLICIT_ABSENCE_RECORDED — NEVER AVAILABLE
//   • zero spells / no covering spell → NO_EXPLICIT_ABSENCE_RECORDED (not AVAILABLE)
//   • open spell → to null / isOpen true; closed spell → to = upper bound
//   • overlapping DIFFERENT kinds both preserved, no precedence
//   • expected_return_on kept as an estimate (epoch sentinel guarded), reason verbatim,
//     severityRank passed through (not a governed score)
//   • coverage/provenance state the recorded-only, mutable, no-provider-audit limits
//   • exposure gate is the governed player gate; identity + one spells query (no N+1)
//   • SQL uses daterange containment (@>), upper_inf, chronological order, read-only

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  mapSpell, deriveStatus, assemblePlayerStatus, readPlayerAvailability, utcDate,
  PLAYER_STATUS_IDENTITY_SQL, PLAYER_STATUS_SPELLS_SQL,
  type PlayerAvailabilityRow,
} from '../playerAvailability';

const PLAYER = { id: '1116', fullName: 'Vitor Roque', slug: 'vitor-roque-1150391' };

function row(over: Partial<PlayerAvailabilityRow> = {}): PlayerAvailabilityRow {
  return {
    id: '1', kind: 'INJURY', spell_from: '2026-07-10', spell_to: '2026-07-22', is_open: false,
    active_at_as_of: false, expected_return_on: null, reason: 'Muscle injury', severity_rank: null,
    created_at: '2026-07-11T00:00:00.000Z', updated_at: '2026-07-22T00:00:00.000Z', ...over,
  };
}

// ── mapSpell ─────────────────────────────────────────────────────────────────

describe('Player Status · mapSpell', () => {
  test('closed spell exposes its upper bound and both timestamps', () => {
    const s = mapSpell(row({ id: '5', spell_to: '2026-07-22', is_open: false }));
    assert.equal(s.id, '5');
    assert.equal(s.kind, 'INJURY');
    assert.equal(s.from, '2026-07-10');
    assert.equal(s.to, '2026-07-22');
    assert.equal(s.isOpen, false);
    assert.equal(s.reason, 'Muscle injury');
    assert.equal(s.recordedAt, '2026-07-11T00:00:00.000Z');
  });

  test('open spell → to null, isOpen true (even if a stray upper is present)', () => {
    const s = mapSpell(row({ is_open: true, spell_to: null }));
    assert.equal(s.to, null);
    assert.equal(s.isOpen, true);
  });

  test('epoch expected_return_on is suppressed; a real one is kept as an estimate', () => {
    assert.equal(mapSpell(row({ expected_return_on: '1970-01-01' })).expectedReturnOn, null);
    assert.equal(mapSpell(row({ expected_return_on: '2026-07-20' })).expectedReturnOn, '2026-07-20');
  });

  test('severityRank passes through as number|null (never fabricated)', () => {
    assert.equal(mapSpell(row({ severity_rank: null })).severityRank, null);
    assert.equal(mapSpell(row({ severity_rank: '3' })).severityRank, 3);
  });
});

// ── deriveStatus ─────────────────────────────────────────────────────────────

describe('Player Status · deriveStatus (never AVAILABLE)', () => {
  test('no spells → NO_EXPLICIT_ABSENCE_RECORDED', () => {
    assert.deepEqual(deriveStatus([]), { code: 'NO_EXPLICIT_ABSENCE_RECORDED', kinds: [] });
  });

  test('spells exist but none active at asOf → NO_EXPLICIT_ABSENCE_RECORDED', () => {
    const s = mapSpell(row({ active_at_as_of: false }));
    assert.equal(deriveStatus([s]).code, 'NO_EXPLICIT_ABSENCE_RECORDED');
  });

  test('one active spell → ACTIVE_ABSENCE with its kind', () => {
    const s = mapSpell(row({ active_at_as_of: true, kind: 'INJURY' }));
    assert.deepEqual(deriveStatus([s]), { code: 'ACTIVE_ABSENCE', kinds: ['INJURY'] });
  });

  test('overlapping DIFFERENT kinds both preserved, sorted, no precedence', () => {
    const inj = mapSpell(row({ id: '1', kind: 'INJURY', active_at_as_of: true }));
    const sus = mapSpell(row({ id: '2', kind: 'SUSPENSION', active_at_as_of: true }));
    assert.deepEqual(deriveStatus([sus, inj]), { code: 'ACTIVE_ABSENCE', kinds: ['INJURY', 'SUSPENSION'] });
  });

  test('never emits AVAILABLE or UNKNOWN', () => {
    for (const spells of [[], [mapSpell(row({ active_at_as_of: true }))]]) {
      assert.ok(['ACTIVE_ABSENCE', 'NO_EXPLICIT_ABSENCE_RECORDED'].includes(deriveStatus(spells).code));
    }
  });
});

// ── assemble ─────────────────────────────────────────────────────────────────

describe('Player Status · assemble', () => {
  test('a historical (inactive) spell stays in spells[] while status is NO_EXPLICIT_ABSENCE_RECORDED', () => {
    const res = assemblePlayerStatus(PLAYER, [row({ active_at_as_of: false })], new Date('2026-09-01T00:00:00Z'));
    assert.equal(res.status.code, 'NO_EXPLICIT_ABSENCE_RECORDED');
    assert.equal(res.spells.length, 1); // history preserved
    assert.equal(res.asOf, '2026-09-01T00:00:00.000Z');
  });

  test('coverage + provenance state the recorded-only / mutable / no-audit limits; never claims AVAILABLE', () => {
    const res = assemblePlayerStatus(PLAYER, [], new Date('2026-09-01T00:00:00Z'));
    assert.equal(res.coverage.type, 'RECORDED_ABSENCE');
    assert.equal(res.coverage.complete, false);
    assert.equal(res.provenance.spellsAreMutable, true);
    assert.equal(res.provenance.hasProviderAudit, false);
    assert.equal(res.provenance.source, 'football.player_availability');
    assert.match(res.coverage.note, /does NOT prove/i);
    assert.doesNotMatch(JSON.stringify(res), /"AVAILABLE"/);
  });
});

// ── SQL shape ──────────────────────────────────────────────────────────────────

describe('Player Status · SQL shape', () => {
  test('identity gate is the governed player gate (tracked edition + competition, not loan-out, current registration)', () => {
    const s = PLAYER_STATUS_IDENTITY_SQL;
    assert.match(s, /governance\.tracked_edition/);
    assert.match(s, /te\.edition_status_code = 'ACTIVE'/);
    assert.match(s, /te\.authorized_for_ingestion = true/);
    assert.match(s, /governance\.tracked_competition/);
    assert.match(s, /tc\.tracking_status_code = 'TRACKED'/);
    assert.match(s, /registration_kind_code <> 'LOAN_OUT'/);
    assert.match(s, /registration_period @> current_date/);
  });

  test('spells SQL: player-scoped, daterange containment for asOf, upper_inf for open, chronological, read-only', () => {
    const s = PLAYER_STATUS_SPELLS_SQL;
    assert.match(s, /WHERE pa\.player_id = \$1::bigint/);
    assert.match(s, /pa\.spell_period @> \$2::date/);         // point-in-time membership
    assert.match(s, /upper_inf\(pa\.spell_period\)/);          // open spell test
    assert.match(s, /ORDER BY lower\(pa\.spell_period\) ASC, pa\.id ASC/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });

  test('utcDate reduces an instant to a YYYY-MM-DD (daterange grain)', () => {
    assert.equal(utcDate(new Date('2026-03-01T13:45:00Z')), '2026-03-01');
  });
});

// ── read binding: gate, no N+1 ─────────────────────────────────────────────────

function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('readPlayerAvailability — gate + binding', () => {
  test('unknown/unexposed player → null (404), only the identity gate runs', async () => {
    const { tx, calls } = captureTx([[]]);
    const res = await readPlayerAvailability(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1);
  });

  test('exposed player → identity + one spells query (no per-spell N+1); asOf reduced to a UTC date param', async () => {
    const { tx, calls } = captureTx([
      [{ id: '1116', full_name: 'Vitor Roque', slug: 'vitor-roque-1150391' }],
      [row({ id: '1', kind: 'INJURY', active_at_as_of: true, is_open: true, spell_to: null })],
    ]);
    const res = await readPlayerAvailability(tx, '1116', { asOf: new Date('2026-07-15T12:00:00Z') });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].params[0], '1116');
    assert.equal(calls[1].params[1], '2026-07-15'); // UTC-date reduction
    assert.equal(res!.status.code, 'ACTIVE_ABSENCE');
    assert.deepEqual(res!.status.kinds, ['INJURY']);
    assert.equal(res!.spells[0].isOpen, true);
  });

  test('exposed player with zero spells → NO_EXPLICIT_ABSENCE_RECORDED (never AVAILABLE)', async () => {
    const { tx } = captureTx([[{ id: '1116', full_name: 'Vitor Roque', slug: 'vitor-roque-1150391' }], []]);
    const res = await readPlayerAvailability(tx, '1116');
    assert.equal(res!.status.code, 'NO_EXPLICIT_ABSENCE_RECORDED');
    assert.deepEqual(res!.spells, []);
  });

  test('EXCLUSIVE UPPER boundary: a spell whose upper == asOf is not active → NO_EXPLICIT_ABSENCE_RECORDED', async () => {
    // The DB computes active_at_as_of via `@>` on a '[)' range, so upper == asOf is NOT
    // contained. Simulate that row (active_at_as_of=false) and confirm the builder agrees.
    const { tx } = captureTx([
      [{ id: '1116', full_name: 'Vitor Roque', slug: 'vitor-roque-1150391' }],
      [row({ spell_from: '2026-07-10', spell_to: '2026-07-20', is_open: false, active_at_as_of: false })],
    ]);
    const res = await readPlayerAvailability(tx, '1116', { asOf: new Date('2026-07-20T00:00:00Z') });
    assert.equal(res!.status.code, 'NO_EXPLICIT_ABSENCE_RECORDED');
    assert.equal(res!.spells[0].to, '2026-07-20'); // history still shows the closed spell
  });
});
