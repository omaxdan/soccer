/**
 * Regression tests for the confidence blend's travel component.
 *
 * The bug: the travel gap read match_travel_intelligence, whose home distance
 * is forced to 0 for a true home match. A side playing at home after two long
 * away trips therefore scored as untravelled and gained a travel edge in its
 * own favour, while readiness — reading the cumulative score — said the
 * opposite about the same team on the same fixture.
 *
 * Run: npm test
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { computeConfidence, componentTable, type ConfidenceInputs } from './confidenceComponents';

/** Everything neutral, so a test can move one component and see only that. */
const NEUTRAL: ConfidenceInputs = {
  readinessGap: 0,
  strengthGap: 0,
  injuryGap: 0,
  congestionGap: 0,
  travelFatigueGap: 0,
  stabilityGap: 0,
  venueGap: 0,
  motivationGap: 0,
};

const travelEdge = (inputs: ConfidenceInputs, pickSign: 1 | -1) => {
  const [gap, sat] = componentTable(inputs)[4];
  return gap === null ? null : Math.max(-1, Math.min(1, (gap * pickSign) / sat));
};

test('travel component is wired to cumulative fatigue, not trip distance', () => {
  const [, saturation, weight] = componentTable(NEUTRAL)[4];
  assert.equal(saturation, 40, 'saturation must match the 0-100 fatigue unit');
  assert.equal(weight, 10, 'weight is unchanged by the fix');
});

test('home after two away matches: fatigue counts against the home side', () => {
  // Home side carrying 74 fatigue from two recent away trips; away side rested.
  // Under the old km-based component the home side read 0 km travelled and
  // gained an edge. Under cumulative fatigue the edge runs the other way.
  const inputs = { ...NEUTRAL, travelFatigueGap: 12 - 74 }; // away − home
  const edge = travelEdge(inputs, 1)!;
  assert.ok(edge < 0, `home pick should be penalised, got edge ${edge}`);

  const home = computeConfidence(inputs, 1).score!;
  const rested = computeConfidence(NEUTRAL, 1).score!;
  assert.ok(
    home < rested,
    `travel-laden home side should score below a rested one (${home} vs ${rested})`
  );
});

test('home after two away matches: the away side gains the mirror edge', () => {
  const inputs = { ...NEUTRAL, travelFatigueGap: 12 - 74 };
  const homeEdge = travelEdge(inputs, 1)!;
  const awayEdge = travelEdge(inputs, -1)!;
  assert.equal(awayEdge, -homeEdge, 'edge must be symmetric about the pick side');
  assert.ok(awayEdge > 0, 'away pick benefits from the home side being travelled');
});

test('consecutive away matches: the travelling side is penalised, and it saturates', () => {
  const twoTrips = { ...NEUTRAL, travelFatigueGap: 55 - 5 }; // away heavily travelled
  const fourTrips = { ...NEUTRAL, travelFatigueGap: 95 - 5 };

  assert.ok(travelEdge(twoTrips, -1)! < 0, 'away pick penalised for away travel');
  assert.ok(
    travelEdge(fourTrips, -1)! <= travelEdge(twoTrips, -1)!,
    'more accumulated travel is never better for the travelling side'
  );
  assert.equal(
    travelEdge(fourTrips, -1),
    -1,
    'a 90-point fatigue gap clamps at the saturation floor'
  );
});

test('two fully rested home teams: travel contributes nothing either way', () => {
  const bothRested = { ...NEUTRAL, travelFatigueGap: 0 };
  assert.equal(travelEdge(bothRested, 1), 0);
  assert.equal(
    computeConfidence(bothRested, 1).score,
    computeConfidence(bothRested, -1).score,
    'with every gap at zero the score is side-independent'
  );
  assert.equal(computeConfidence(bothRested, 1).score, 50, 'neutral inputs give a neutral score');
});

test('missing fatigue renormalises rather than counting as zero', () => {
  const missing = { ...NEUTRAL, travelFatigueGap: null };
  const present = { ...NEUTRAL, travelFatigueGap: 0 };
  const a = computeConfidence(missing, 1);
  const b = computeConfidence(present, 1);
  assert.equal(a.componentsWithData, b.componentsWithData - 1);
  assert.equal(a.weightUsed, b.weightUsed - 10, 'the weight is removed, not zeroed');
  assert.equal(a.score, b.score, 'renormalisation leaves a neutral blend unchanged');
});

test('the component gate still holds', () => {
  const sparse: ConfidenceInputs = {
    ...NEUTRAL,
    strengthGap: null,
    injuryGap: null,
    congestionGap: null,
    travelFatigueGap: null,
    stabilityGap: null,
    venueGap: null,
  };
  assert.equal(computeConfidence(sparse, 1).score, null, 'below 4 components emits nothing');
});

test('a kilometre-scale value in the fatigue slot would clamp — the units differ', () => {
  // Guards the unit change: if someone re-points this at a distance column,
  // every fixture with any travel pins to the clamp and the component stops
  // discriminating. That failure is silent in production; it is loud here.
  const asKm = { ...NEUTRAL, travelFatigueGap: 720 };
  assert.equal(travelEdge(asKm, 1), 1, 'km-scale input saturates immediately');
});
