/**
 * PREDICTED LINEUPS ENGINE — tests
 *
 * Covers the parts where a silent wrong answer is plausible: the assignment
 * solver (which is the whole point of the rewrite), the goalkeeper gate, the
 * exactly-eleven guarantee, and the formation tie-break.
 *
 * Run: npm test
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { FORMATIONS, getFormation } from './formations';
import { maximumWeightAssignment, FORBIDDEN } from './optimizer';
import { normalizePosition, positionSuitability, zoneOfPositionCode } from './positions';
import { calculateWeightedScore, buildTeamNormalizers, type RawPlayerStats } from './playerScoring';
import { buildCandidates, type CandidateInput } from './candidates';
import { evaluateFormation, selectBestFormation } from './formationScoring';
import { checkAvailability } from './availability';

// ─── Optimizer ───────────────────────────────────────────────────────────────

test('optimizer beats greedy on the classic counter-example', () => {
  // Rows = slots [RB, CB], columns = players [A, B].
  //   A: RB 0.95, CB 1.00
  //   B: RB 0.94, CB 0.30
  // Greedy fills RB first, takes A (0.95), leaves B at CB (0.30) => 1.25.
  // Optimal is B at RB and A at CB => 1.94.
  const score = [
    [0.95, 0.94],
    [1.00, 0.30],
  ];
  const assignment = maximumWeightAssignment(score);
  assert.deepEqual(assignment, [1, 0], 'RB should take player B, CB should take player A');

  const total = assignment.reduce((sum, col, row) => sum + score[row][col], 0);
  assert.ok(Math.abs(total - 1.94) < 1e-9, `expected 1.94, got ${total}`);
});

test('optimizer never selects a forbidden pairing when a legal one exists', () => {
  const score = [
    [FORBIDDEN, 5, 4],
    [9, FORBIDDEN, 3],
  ];
  const assignment = maximumWeightAssignment(score);
  assert.notEqual(assignment[0], 0);
  assert.notEqual(assignment[1], 1);
  for (let i = 0; i < assignment.length; i++) {
    assert.ok(Number.isFinite(score[i][assignment[i]]));
  }
});

test('optimizer assigns every row exactly once and never reuses a column', () => {
  const rows = 11;
  const cols = 25;
  const score: number[][] = [];
  for (let i = 0; i < rows; i++) {
    score.push(Array.from({ length: cols }, (_, j) => ((i * 7 + j * 13) % 19) + 1));
  }
  const assignment = maximumWeightAssignment(score);
  assert.equal(assignment.length, rows);
  assert.equal(new Set(assignment).size, rows, 'no column may be used twice');
  assert.ok(assignment.every((c) => c >= 0 && c < cols));
});

// ─── Positions ───────────────────────────────────────────────────────────────

test('SofaScore notation normalizes into the canonical vocabulary', () => {
  assert.equal(normalizePosition('DR'), 'RB');
  assert.equal(normalizePosition('DC'), 'CB');
  assert.equal(normalizePosition('MC'), 'CM');
  assert.equal(normalizePosition('RCB'), 'CB', 'tactical slot codes fold to their base');
  assert.equal(normalizePosition('LCM'), 'CM');
  assert.equal(normalizePosition('unknown'), null);
});

test('zoneOfPositionCode handles tactical codes and legacy broad letters', () => {
  assert.equal(zoneOfPositionCode('RCB'), 'D');
  assert.equal(zoneOfPositionCode('RB'), 'D');
  assert.equal(zoneOfPositionCode('LCM'), 'M');
  assert.equal(zoneOfPositionCode('LW'), 'F');
  assert.equal(zoneOfPositionCode('D'), 'D', 'pre-025 rows still resolve');
  assert.equal(zoneOfPositionCode('M'), 'M');
});

test('the goalkeeper slot is closed to outfielders and vice versa', () => {
  assert.equal(positionSuitability('GK', ['CM', null, null], 'M'), 0);
  assert.equal(positionSuitability('GK', ['GK', null, null], 'G'), 1);
  assert.equal(positionSuitability('CB', ['GK', null, null], 'G'), 0);
});

test('suitability respects tier and left/right asymmetry', () => {
  const primaryRB = positionSuitability('RB', ['RB', null, null], 'D');
  const secondaryRB = positionSuitability('RB', ['CM', 'RB', null], 'M');
  const crossSide = positionSuitability('RB', ['LB', null, null], 'D');

  assert.equal(primaryRB, 1);
  assert.ok(Math.abs(secondaryRB - 0.9) < 1e-9, 'secondary listing is worth 90%');
  assert.ok(crossSide < 0.7, `an inverted full-back should be costly, got ${crossSide}`);
});

// ─── Weighted score ──────────────────────────────────────────────────────────

test('weighted score is 0-100 and ranks an ever-present above a cameo substitute', () => {
  const starter: RawPlayerStats = {
    matchesStarted: 20, appearances: 20, minutesPlayed: 1780,
    totalRating: 140, countRating: 20, goals: 3, assists: 4,
  };
  const cameo: RawPlayerStats = {
    matchesStarted: 1, appearances: 19, minutesPlayed: 210,
    totalRating: 125, countRating: 19, goals: 1, assists: 1,
  };
  const norm = buildTeamNormalizers([starter, cameo]);

  const starterScore = calculateWeightedScore(starter, norm);
  const cameoScore = calculateWeightedScore(cameo, norm);

  assert.ok(starterScore > cameoScore, 'starts and minutes must dominate raw appearance count');
  assert.ok(starterScore <= 100 && starterScore >= 0);
  assert.ok(cameoScore <= 100 && cameoScore >= 0);
});

// ─── Availability ────────────────────────────────────────────────────────────

const basePlayer = {
  id: 1,
  teamId: 10,
  currentInjury: true,
  injuryStatus: 'out',
  injuryReturnDays: null,
  injuryEndTimestamp: null,
  injuryUpdatedTimestamp: null,
};

test('a player due back before kickoff is available for that fixture', () => {
  const kickoff = new Date('2026-03-14T15:00:00Z');
  const returnsBefore = Math.floor(new Date('2026-03-10T00:00:00Z').getTime() / 1000);

  const result = checkAvailability(
    { ...basePlayer, injuryEndTimestamp: returnsBefore },
    undefined,
    kickoff,
    10,
    undefined,
  );
  assert.equal(result.available, true);
});

test('a player due back after kickoff is unavailable for that fixture', () => {
  const kickoff = new Date('2026-03-14T15:00:00Z');
  const returnsAfter = Math.floor(new Date('2026-03-20T00:00:00Z').getTime() / 1000);

  const result = checkAvailability(
    { ...basePlayer, injuryEndTimestamp: returnsAfter },
    undefined,
    kickoff,
    10,
    undefined,
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, 'returns-after-kickoff');
});

test('a player whose latest transfer moved him elsewhere is excluded', () => {
  const result = checkAvailability(
    { ...basePlayer, currentInjury: false, injuryStatus: null },
    undefined,
    new Date('2026-03-14T15:00:00Z'),
    10,
    99,
  );
  assert.equal(result.available, false);
  assert.equal(result.reason, 'transferred');
});

// ─── End to end ──────────────────────────────────────────────────────────────

/** Squad builder: `spec` is a list of [primary position, count]. */
function makeSquad(spec: Array<[string, number]>): CandidateInput[] {
  const inputs: CandidateInput[] = [];
  let id = 1;
  for (const [pos, count] of spec) {
    for (let i = 0; i < count; i++) {
      inputs.push({
        playerId: id++,
        teamId: 1,
        rawPositions: [pos, null, null],
        broadPosition: null,
        stats: {
          // Deterministic spread so the pool has a clear pecking order.
          matchesStarted: 20 - i * 2,
          appearances: 22 - i * 2,
          minutesPlayed: 1800 - i * 180,
          totalRating: 140 - i * 8,
          countRating: 20,
          goals: 2,
          assists: 2,
        },
      });
    }
  }
  return inputs;
}

test('every formation fields exactly eleven players, one of them a goalkeeper', () => {
  const { candidates } = buildCandidates(
    1,
    makeSquad([['GK', 3], ['DR', 3], ['DC', 5], ['DL', 3], ['DM', 3], ['MC', 5], ['AM', 3], ['RW', 3], ['LW', 3], ['ST', 4]]),
  );

  for (const formation of FORMATIONS) {
    const evaluation = evaluateFormation(formation, candidates);
    assert.equal(evaluation.feasible, true, `${formation.name} should be feasible: ${evaluation.reason}`);
    assert.equal(evaluation.assignments.length, 11, `${formation.name} must field 11`);

    const playerIds = evaluation.assignments.map((a) => a.candidate.playerId);
    assert.equal(new Set(playerIds).size, 11, `${formation.name} must not field a player twice`);

    const keeperSlot = evaluation.assignments.find((a) => a.slot.base === 'GK')!;
    assert.equal(keeperSlot.candidate.isGoalkeeper, true, `${formation.name} put an outfielder in goal`);
  }
});

test('a squad with no fit goalkeeper produces no lineup rather than an improvised one', () => {
  const { candidates } = buildCandidates(
    1,
    makeSquad([['DR', 4], ['DC', 5], ['DL', 4], ['MC', 5], ['ST', 4]]),
  );
  assert.equal(selectBestFormation(candidates), null);

  const evaluation = evaluateFormation(getFormation('4-3-3')!, candidates);
  assert.equal(evaluation.feasible, false);
  assert.equal(evaluation.reason, 'no available goalkeeper');
});

test('a squad with fewer than eleven available players produces no lineup', () => {
  const { candidates } = buildCandidates(1, makeSquad([['GK', 1], ['DC', 4], ['MC', 3], ['ST', 2]]));
  assert.equal(candidates.length, 10);
  assert.equal(selectBestFormation(candidates), null);
});

test('formation is inferred from the squad, not hardcoded', () => {
  // Wingers and one centre-forward, no second striker and no wing-backs:
  // a front three, not the 4-4-2 the v1 engine gave everybody.
  const wideSquad = buildCandidates(
    1,
    makeSquad([['GK', 2], ['DR', 2], ['DC', 4], ['DL', 2], ['DM', 2], ['MC', 4], ['RW', 3], ['LW', 3], ['ST', 2]]),
  ).candidates;
  const wide = selectBestFormation(wideSquad)!;
  assert.ok(
    wide.best.formation.name === '4-3-3' || wide.best.formation.name === '3-4-3',
    `expected a front three for a winger-heavy squad, got ${wide.best.formation.name}`,
  );

  // Five centre-backs, wing-backs, two strikers, no natural wingers.
  const backThreeSquad = buildCandidates(
    1,
    makeSquad([['GK', 2], ['DC', 6], ['RWB', 2], ['LWB', 2], ['DM', 2], ['MC', 4], ['ST', 4]]),
  ).candidates;
  const backThree = selectBestFormation(backThreeSquad)!;
  assert.ok(
    backThree.best.formation.name.startsWith('3-') || backThree.best.formation.name.startsWith('5-'),
    `expected a back three/five for a centre-back-heavy squad, got ${backThree.best.formation.name}`,
  );
});

test('the winning formation is reported with a real score and margin', () => {
  const { candidates } = buildCandidates(
    1,
    makeSquad([['GK', 2], ['DR', 2], ['DC', 4], ['DL', 2], ['DM', 2], ['MC', 4], ['RW', 2], ['LW', 2], ['ST', 3]]),
  );
  const selection = selectBestFormation(candidates)!;

  assert.ok(selection.best.totalScore > 0);
  assert.ok(selection.margin >= 0 && selection.margin <= 1);
  assert.equal(selection.ranked[0].totalScore >= selection.best.totalScore, true);
  // Every ranked entry is feasible and complete.
  for (const e of selection.ranked) {
    assert.equal(e.assignments.length, 11);
  }
});

test('a shortage at one position is covered from secondary positions, not left empty', () => {
  // One natural centre-back, but several full-backs and holding midfielders
  // who list CB as a secondary position.
  const inputs = makeSquad([['GK', 2], ['DC', 1], ['DR', 3], ['DL', 3], ['MC', 4], ['RW', 2], ['LW', 2], ['ST', 2]]);
  for (const input of inputs) {
    if (input.rawPositions[0] === 'DR' || input.rawPositions[0] === 'DL') {
      input.rawPositions[1] = 'DC';
    }
  }
  const { candidates } = buildCandidates(1, inputs);
  const selection = selectBestFormation(candidates)!;

  assert.equal(selection.best.assignments.length, 11);
  const centreBacks = selection.best.assignments.filter((a) => a.slot.base === 'CB');
  assert.ok(centreBacks.length >= 2, 'a back four must still field two centre-backs');
  assert.ok(
    centreBacks.every((a) => a.suitability > 0),
    'cover must come from a compatible player, never a zero-suitability filler',
  );
});
