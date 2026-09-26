// HISTORICAL PATTERNS v1 — Historical Response tests (DB-free: pure + captured-tx).
// Descriptive only; "bounce back" etc. appear ONLY in test names, never in output.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  outcomeOf, computeHistoricalResponse, readTeamHistoricalResponse,
  TEAM_RESULT_SEQUENCE_SQL, SAMPLE_GATE, HISTORICAL_RESPONSE_VERSION,
  type TeamOutcome,
} from '../teamHistoricalResponse';

// build a chronological outcome sequence, then a trigger followed by `count` responses
function seq(...o: TeamOutcome[]): TeamOutcome[] { return o; }
// Exactly `count` clean triggers: [trigger, DRAW] repeated. Each trigger is followed by a
// DRAW (a non-trigger), so no accidental chaining — POST_<trigger> n == count, response all draws.
function triggersWithBreak(trigger: 'WIN' | 'LOSS', count: number): TeamOutcome[] {
  const out: TeamOutcome[] = [];
  for (let i = 0; i < count; i++) { out.push(trigger); out.push('DRAW'); }
  return out;
}

// ── pure outcome ────────────────────────────────────────────────────────────────

describe('historical · team-perspective outcome', () => {
  test('WIN / DRAW / LOSS from goals', () => {
    assert.equal(outcomeOf(2, 1), 'WIN');
    assert.equal(outcomeOf(1, 1), 'DRAW');
    assert.equal(outcomeOf(0, 3), 'LOSS');
  });
});

// ── Sequence A/B, triggers, first-subsequent ─────────────────────────────────────

describe('historical · triggers & first-subsequent response (Sequence A/B)', () => {
  test('POST_WIN tallies the FIRST subsequent fixture only', () => {
    // W, W, L, D : index0 W→resp W(idx1); idx1 W→resp L(idx2); idx2 L→resp D(idx3)
    const r = computeHistoricalResponse(seq('WIN', 'WIN', 'LOSS', 'DRAW'));
    assert.equal(r.POST_WIN.n, 2);
    assert.deepEqual(r.POST_WIN.response, { wins: 1, draws: 0, losses: 1 }); // W→W, W→L
    assert.equal(r.POST_LOSS.n, 1);
    assert.deepEqual(r.POST_LOSS.response, { wins: 0, draws: 1, losses: 0 }); // L→D
  });
  test('a DRAW is neither trigger', () => {
    const r = computeHistoricalResponse(seq('DRAW', 'DRAW', 'DRAW'));
    assert.equal(r.POST_WIN.n, 0);
    assert.equal(r.POST_LOSS.n, 0);
  });
  test('a trigger at the final position has no response and is not counted', () => {
    // ...ends on WIN with nothing after → that WIN is not a counted POST_WIN
    const r = computeHistoricalResponse(seq('LOSS', 'WIN')); // idx0 L→resp W(idx1); idx1 W has no next
    assert.equal(r.POST_LOSS.n, 1);
    assert.deepEqual(r.POST_LOSS.response, { wins: 1, draws: 0, losses: 0 });
    assert.equal(r.POST_WIN.n, 0); // the trailing WIN is uncounted
  });
  test('deterministic: same input → same output', () => {
    const s = seq('WIN', 'LOSS', 'WIN', 'DRAW', 'LOSS');
    assert.deepEqual(computeHistoricalResponse(s), computeHistoricalResponse(s));
  });
});

// ── sample gate ─────────────────────────────────────────────────────────────────

describe('historical · sample gate (n>=10, never lowered)', () => {
  test('SAMPLE_GATE is 10', () => assert.equal(SAMPLE_GATE, 10));
  test('n = 9 → NOT engaged ("bounce back" not claimed)', () => {
    const r = computeHistoricalResponse(triggersWithBreak('WIN', 9));
    assert.equal(r.POST_WIN.n, 9);
    assert.equal(r.POST_WIN.engaged, false);
  });
  test('n = 10 → engaged', () => {
    const r = computeHistoricalResponse(triggersWithBreak('WIN', 10));
    assert.equal(r.POST_WIN.n, 10);
    assert.equal(r.POST_WIN.engaged, true);
  });
  test('no qualifying trigger → neither engaged (no fabricated empty pattern)', () => {
    const r = computeHistoricalResponse(triggersWithBreak('WIN', 3));
    assert.equal(r.POST_WIN.engaged, false);
    assert.equal(r.POST_LOSS.engaged, false);
  });
});

// ── W/D/L conservation ───────────────────────────────────────────────────────────

describe('historical · invariant wins+draws+losses = n', () => {
  test('holds across a mixed sequence', () => {
    const r = computeHistoricalResponse(seq('WIN', 'DRAW', 'WIN', 'LOSS', 'LOSS', 'WIN', 'DRAW'));
    for (const t of [r.POST_WIN, r.POST_LOSS]) {
      assert.equal(t.response.wins + t.response.draws + t.response.losses, t.n);
    }
  });
});

// ── SQL contract: eligibility, strict asOf, orientation, ordering, read-only ─────

describe('historical · SQL contract', () => {
  test('COMPLETED only, strict `< asOf`, team-perspective goals, chronological, read-only', () => {
    assert.match(TEAM_RESULT_SEQUENCE_SQL, /lifecycle_state_code = 'COMPLETED'/);
    assert.match(TEAM_RESULT_SEQUENCE_SQL, /scheduled_kickoff_at < \$2::timestamptz/);
    assert.ok(!/<=\s*\$2/.test(TEAM_RESULT_SEQUENCE_SQL)); // never kickoff = asOf or future
    assert.match(TEAM_RESULT_SEQUENCE_SQL, /JOIN football\.result r/);      // result must exist
    assert.match(TEAM_RESULT_SEQUENCE_SQL, /home_team_id = \$1::bigint THEN r\.home_goals ELSE r\.away_goals/); // orientation
    assert.match(TEAM_RESULT_SEQUENCE_SQL, /ORDER BY f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(TEAM_RESULT_SEQUENCE_SQL));
  });
  test('excludes non-completed states by construction (only COMPLETED admitted)', () => {
    for (const state of ['SCHEDULED', 'POSTPONED', 'IN_PROGRESS', 'CANCELLED', 'ABANDONED']) {
      assert.ok(!TEAM_RESULT_SEQUENCE_SQL.includes(state)); // none are whitelisted
    }
  });
  test('does not touch historical_advantage / H2H', () => {
    assert.ok(!/historical_advantage|head.?to.?head|h2h/i.test(TEAM_RESULT_SEQUENCE_SQL));
  });
});

// ── reader binding ───────────────────────────────────────────────────────────────

function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows }; } } as unknown as PoolClient;
  return { tx, calls };
}

describe('historical · reader', () => {
  test('composes ALL_COMPETITIONS TEAM reading; one query (no N+1); no provider', async () => {
    // 12 (W→W) pairs → POST_WIN n=12 engaged, all wins
    const rows = [];
    for (let i = 0; i < 12; i++) { rows.push({ fixture_id: `t${i}`, kickoff_at: `2026-01-${(i % 28) + 1}T00:00:00Z`, goals_for: 2, goals_against: 0 }); rows.push({ fixture_id: `r${i}`, kickoff_at: `2026-02-${(i % 28) + 1}T00:00:00Z`, goals_for: 3, goals_against: 1 }); }
    const { tx, calls } = captureTx(rows);
    const out = await readTeamHistoricalResponse(tx, '72', { asOf: new Date('2026-09-01T00:00:00Z') });
    assert.equal(out.subjectKind, 'TEAM');
    assert.equal(out.subjectId, '72');
    assert.equal(out.scope, 'ALL_COMPETITIONS');
    assert.equal(out.version, HISTORICAL_RESPONSE_VERSION);
    assert.equal(out.provenance.mode, 'READ_MODEL');
    assert.equal(out.triggers.POST_WIN.engaged, true);
    assert.ok(out.triggers.POST_WIN.n >= 10);
    assert.equal(out.anyEngaged, true);
    assert.equal(calls.length, 1);          // single set-based query, no N+1
    assert.equal(calls[0].params[0], '72'); // team
  });

  test('output carries no predictive/probability fields', async () => {
    const { tx } = captureTx([]);
    const out = await readTeamHistoricalResponse(tx, '72', { asOf: new Date() });
    const json = JSON.stringify(out).toLowerCase();
    for (const banned of ['probab', 'percent', 'confidence', 'likely', 'expected', 'forecast', 'predict']) {
      assert.ok(!json.includes(banned), `output must not contain "${banned}"`);
    }
    assert.equal(out.anyEngaged, false); // empty history → nothing engaged
  });
});
