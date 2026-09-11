// ─────────────────────────────────────────────────────────────────────────────
// GATE E-ii — team_momentum ADVERSARIAL MATRIX
//
// Pure-calculator tests pin the recovered V1 rule: last-5 minus prior-5 points
// (3/1/0) over the ten most-recent completed, result-bearing fixtures, ordered by
// kickoff, with the strict `< as_of` boundary, the NO VALUE floor at ten, and the
// window separation that keeps a match out of both halves. The V1 formula and
// population are carried unchanged (doc 81), so these are V1-valid goldens.
//
// DB tests prove the ALL_COMPETITIONS write (edition NULL), persistence,
// idempotency and provenance against a dedicated committed rig. They SKIP without
// a V2 database, exactly like the rest of the feature suite.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { teamMomentum } from '../calculators/teamMomentum';
import { COMPETITION_SCOPED_CONTEXT_KIND, type CalculationContext, type CandidateValue, type CompletedFixture } from '../calculators/types';
import { toNumericString } from '../write/scale';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../registry/load';
import { readCompletedFixtures } from '../read/fixtures';
import { writeValues } from '../write/values';
import { seedFeatureRegistry } from '../../seed/featureRegistry';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { findByProviderId, insertAppendOnly, upsertMutable } from '../../ingestion/write/index';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;

const MOMENTUM = 'team.momentum';
const AS_OF = new Date('2027-02-01T00:00:00Z');
const TEAM = '100';

// ─── pure calculator ─────────────────────────────────────────────────────────

let seq = 0;
/** A completed fixture with a result. Kickoff drives ordering; side is irrelevant. */
function fx(kickoffIso: string, goalsFor: number | null, goalsAgainst: number | null, isHome = true): CompletedFixture {
  seq += 1;
  return {
    fixtureId: String(seq),
    fixturePartitionOn: kickoffIso.slice(0, 10),
    kickoffAt: new Date(kickoffIso),
    isHome,
    goalsFor,
    goalsAgainst,
    venueId: '1',
  };
}
const WIN = (iso: string, isHome = true) => fx(iso, 2, 0, isHome);
const DRAW = (iso: string, isHome = true) => fx(iso, 1, 1, isHome);
const LOSS = (iso: string, isHome = true) => fx(iso, 0, 2, isHome);

function contextFor(fixtures: CompletedFixture[], asOf = AS_OF, teamId = TEAM): CalculationContext {
  return {
    definitions: new Map(),
    subjects: [{ teamId, asOf }],
    fixturesByTeam: new Map([[teamId, { teamId, fixtures }]]),
    homeVenueByTeam: new Map(),
    venuesById: new Map(),
    priorValues: new Map(),
  };
}
function momentum(fixtures: CompletedFixture[], asOf = AS_OF): CandidateValue | undefined {
  return teamMomentum.calculate(contextFor(fixtures, asOf)).find((c) => c.featureKey === MOMENTUM && c.teamId === TEAM);
}

// Ten fixtures, oldest→newest: five losses then five wins. last5 (newest) = 15,
// prior5 (older) = 0 → +15. Dates ascending so the calculator must sort desc.
function fiveLossesThenFiveWins(): CompletedFixture[] {
  return [
    LOSS('2026-09-01T14:00:00Z'), LOSS('2026-09-08T14:00:00Z'), LOSS('2026-09-15T14:00:00Z'),
    LOSS('2026-09-22T14:00:00Z'), LOSS('2026-09-29T14:00:00Z'),
    WIN('2026-10-06T14:00:00Z'), WIN('2026-10-13T14:00:00Z'), WIN('2026-10-20T14:00:00Z'),
    WIN('2026-10-27T14:00:00Z'), WIN('2026-11-03T14:00:00Z'),
  ];
}

describe('team_momentum — pure calculator (recovered V1 rule)', () => {
  it('1. exact recovered V1 calc: last5(15) − prior5(0) = 15', () => {
    const c = momentum(fiveLossesThenFiveWins());
    assert.ok(c);
    assert.equal(toNumericString(c!.value), '15');
  });

  it('2+3+4. last-5 / prior-5 selection and chronological separation', () => {
    // Newest five all wins (15), older five all losses (0). If windows leaked or
    // mis-ordered, the delta would not be +15.
    assert.equal(toNumericString(momentum(fiveLossesThenFiveWins())!.value), '15');
    // Reverse: newest five losses, older five wins → −15.
    const reversed = [
      WIN('2026-09-01T14:00:00Z'), WIN('2026-09-08T14:00:00Z'), WIN('2026-09-15T14:00:00Z'),
      WIN('2026-09-22T14:00:00Z'), WIN('2026-09-29T14:00:00Z'),
      LOSS('2026-10-06T14:00:00Z'), LOSS('2026-10-13T14:00:00Z'), LOSS('2026-10-20T14:00:00Z'),
      LOSS('2026-10-27T14:00:00Z'), LOSS('2026-11-03T14:00:00Z'),
    ];
    assert.equal(toNumericString(momentum(reversed)!.value), '-15', 'declining form is a real negative value');
  });

  it('5. mixed W/D/L: last5(10) − prior5(5) = 5', () => {
    // prior5 (older): D,D,L,W,L = 1+1+0+3+0 = 5 ; last5 (newer): W,W,D,L,W = 3+3+1+0+3 = 10
    const fixtures = [
      DRAW('2026-09-01T14:00:00Z'), DRAW('2026-09-08T14:00:00Z'), LOSS('2026-09-15T14:00:00Z'),
      WIN('2026-09-22T14:00:00Z'), LOSS('2026-09-29T14:00:00Z'),
      WIN('2026-10-06T14:00:00Z'), WIN('2026-10-13T14:00:00Z'), DRAW('2026-10-20T14:00:00Z'),
      LOSS('2026-10-27T14:00:00Z'), WIN('2026-11-03T14:00:00Z'),
    ];
    assert.equal(toNumericString(momentum(fixtures)!.value), '5');
  });

  it('6. all wins → 0 (15 − 15), a real "form held level"', () => {
    const wins = Array.from({ length: 10 }, (_, i) => WIN(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    assert.equal(toNumericString(momentum(wins)!.value), '0');
  });
  it('7. all draws → 0 (5 − 5)', () => {
    const draws = Array.from({ length: 10 }, (_, i) => DRAW(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    assert.equal(toNumericString(momentum(draws)!.value), '0');
  });
  it('8. all losses → 0 (0 − 0)', () => {
    const losses = Array.from({ length: 10 }, (_, i) => LOSS(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    assert.equal(toNumericString(momentum(losses)!.value), '0');
  });

  it('9. a fixture exactly at as_of is excluded (strict < as_of)', () => {
    // Ten qualifying before as_of (all draws → 0), plus a win exactly at as_of.
    const base = Array.from({ length: 10 }, (_, i) => DRAW(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    const atBoundary = WIN(AS_OF.toISOString());
    const c = momentum([...base, atBoundary]);
    assert.ok(c);
    assert.equal(toNumericString(c!.value), '0', 'the boundary win must not enter last5');
  });
  it('10. a future fixture cannot influence the value', () => {
    const base = Array.from({ length: 10 }, (_, i) => DRAW(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    const future = WIN('2027-06-01T14:00:00Z');
    assert.equal(toNumericString(momentum([...base, future])!.value), '0');
  });
  it('11. result-less fixtures are excluded, not counted as points', () => {
    // Ten wins (would be 0 delta) plus two recent result-less fixtures. If the
    // result-less ones counted, they would displace a win from last5.
    const wins = Array.from({ length: 10 }, (_, i) => WIN(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    const resultless = [fx('2026-10-20T14:00:00Z', null, null), fx('2026-10-27T14:00:00Z', null, null)];
    const c = momentum([...wins, ...resultless]);
    assert.ok(c, 'ten result-bearing fixtures remain → a value');
    assert.equal(toNumericString(c!.value), '0', 'result-less fixtures contribute no points and do not enter a window');
  });

  it('12. fewer than ten qualifying → NO VALUE (never a zero)', () => {
    const nine = Array.from({ length: 9 }, (_, i) => WIN(`2026-09-${String(i + 1).padStart(2, '0')}T14:00:00Z`));
    assert.equal(momentum(nine), undefined);
  });
  it('13. exactly ten qualifying → a value', () => {
    assert.ok(momentum(fiveLossesThenFiveWins()));
  });
  it('14. more than ten → only the ten most recent are used', () => {
    // Twelve: two oldest are wins (should be ignored), then 5 losses, then 5 wins.
    // If the oldest two leaked into prior5, the delta would change.
    const twelve = [
      WIN('2026-08-01T14:00:00Z'), WIN('2026-08-08T14:00:00Z'), // oldest — must be dropped
      ...fiveLossesThenFiveWins(),
    ];
    assert.equal(toNumericString(momentum(twelve)!.value), '15', 'the two oldest wins are outside the ten-match window');
  });
  it('15. window separation: no match appears in both last5 and prior5', () => {
    // Distinct point totals per window prove disjointness: last5 all wins (15),
    // prior5 all losses (0). A shared match would perturb one of the sums.
    const c = momentum(fiveLossesThenFiveWins());
    assert.equal(toNumericString(c!.value), '15');
  });
  it('16. observation count is the ten matches the delta rests on', () => {
    assert.equal(momentum(fiveLossesThenFiveWins())!.sampleObservationCount, 10);
  });
  it('17. value is an integer at scale 0 (a points differential)', () => {
    const v = toNumericString(momentum(fiveLossesThenFiveWins())!.value);
    assert.match(v, /^-?\d+$/, 'no fractional part');
  });

  it('20+22. Layer 1: consumes no feature (no lineage, no circular dependency)', () => {
    assert.deepEqual(momentum(fiveLossesThenFiveWins())!.consumed, []);
  });
  it('21. independent of venue side — identical results home or away give the same momentum', () => {
    const home = fiveLossesThenFiveWins();
    const away = [
      LOSS('2026-09-01T14:00:00Z', false), LOSS('2026-09-08T14:00:00Z', false), LOSS('2026-09-15T14:00:00Z', false),
      LOSS('2026-09-22T14:00:00Z', false), LOSS('2026-09-29T14:00:00Z', false),
      WIN('2026-10-06T14:00:00Z', false), WIN('2026-10-13T14:00:00Z', false), WIN('2026-10-20T14:00:00Z', false),
      WIN('2026-10-27T14:00:00Z', false), WIN('2026-11-03T14:00:00Z', false),
    ];
    assert.equal(toNumericString(momentum(home)!.value), toNumericString(momentum(away)!.value));
  });
  it('23. is an ALL_COMPETITIONS calculator (not COMPETITION_SCOPED)', () => {
    assert.notEqual(teamMomentum.contextKind, COMPETITION_SCOPED_CONTEXT_KIND);
    assert.equal(teamMomentum.contextKind, undefined, 'omitted contextKind = ALL_COMPETITIONS default');
    assert.deepEqual(teamMomentum.featureKeys, [MOMENTUM]);
  });
});

// ─── DB: ALL_COMPETITIONS persistence, idempotency, provenance ───────────────

const MOM_PREFIX = 'S6MOM';
const MOM_AS_OF = new Date('2027-04-01T00:00:00Z'); // dedicated instant, dedicated team

/** Ten completed mom-home fixtures: five older losses, five recent wins → +15. */
const MOM_FIXTURES: readonly { iso: string; momWins: boolean }[] = [
  { iso: '2026-09-01T14:00:00Z', momWins: false }, { iso: '2026-09-15T14:00:00Z', momWins: false },
  { iso: '2026-09-29T14:00:00Z', momWins: false }, { iso: '2026-10-13T14:00:00Z', momWins: false },
  { iso: '2026-10-27T14:00:00Z', momWins: false }, { iso: '2026-11-10T14:00:00Z', momWins: true },
  { iso: '2026-11-24T14:00:00Z', momWins: true }, { iso: '2026-12-08T14:00:00Z', momWins: true },
  { iso: '2026-12-22T14:00:00Z', momWins: true }, { iso: '2027-01-05T14:00:00Z', momWins: true },
];

async function seedMomentumRig(tx: PoolClient): Promise<{ momTeamId: string }> {
  const competition = await upsertMutable(tx, {
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code'],
    values: [PROVIDER_CODE, `${MOM_PREFIX}-COMP`, 'S6 Momentum League', `${MOM_PREFIX}-league`.toLowerCase(), 'GB'],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });
  const edition = await upsertMutable(tx, {
    relation: 'football.competition_edition',
    columns: ['competition_id', 'season_label', 'season_period'],
    values: [competition.id, '2026/2027', '[2026-07-01,2027-07-01)'],
    conflictTarget: ['competition_id', 'season_period'],
  });
  const venue = await upsertMutable(tx, {
    relation: 'football.venue',
    columns: ['provider_external_id', 'name', 'country_code'],
    values: [`${MOM_PREFIX}-V`, 'Momentum Park', 'GB'],
    conflictTarget: ['provider_external_id'],
  });
  const mom = await upsertMutable(tx, {
    relation: 'football.team',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
    values: [PROVIDER_CODE, `${MOM_PREFIX}-T-MOM`, 'Momentum FC', `${MOM_PREFIX}-t-mom`.toLowerCase(), 'GB', venue.id],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });
  const opp = await upsertMutable(tx, {
    relation: 'football.team',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
    values: [PROVIDER_CODE, `${MOM_PREFIX}-T-OPP`, 'Opponent FC', `${MOM_PREFIX}-t-opp`.toLowerCase(), 'GB', venue.id],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  for (let i = 0; i < MOM_FIXTURES.length; i += 1) {
    const { iso, momWins } = MOM_FIXTURES[i];
    const kickoff = new Date(iso);
    const partitionOn = iso.slice(0, 10);
    const externalId = `${MOM_PREFIX}-F${String(i + 1).padStart(2, '0')}`;
    const existing = await findByProviderId(tx, 'football.fixture', PROVIDER_CODE, externalId);
    const stored = await upsertMutable(tx, {
      relation: 'football.fixture',
      columns: [
        'provider_code', 'provider_external_id', 'fixture_partition_on',
        'competition_edition_id', 'venue_id', 'is_neutral_venue',
        'home_team_id', 'away_team_id', 'scheduled_kickoff_at', 'lifecycle_state_code',
      ],
      values: [
        PROVIDER_CODE, externalId, partitionOn,
        edition.id, venue.id, false,
        mom.id, opp.id, kickoff, 'COMPLETED',
      ],
      conflictTarget: ['provider_code', 'provider_external_id', 'fixture_partition_on'],
      immutableColumns: ['fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    // mom is home; a mom win is 2-0, a mom loss is 0-2.
    await upsertMutable(tx, {
      relation: 'football.result',
      columns: ['fixture_id', 'fixture_partition_on', 'home_goals', 'away_goals', 'confirmed_at'],
      values: [stored.id, partitionOn, momWins ? 2 : 0, momWins ? 0 : 2, kickoff],
      conflictTarget: ['fixture_partition_on', 'fixture_id'],
      immutableColumns: ['fixture_id', 'fixture_partition_on'],
      existedBeforeWrite: existing !== null,
    });
    await insertAppendOnly(tx, {
      relation: 'football.fixture_lifecycle_transition',
      columns: ['fixture_id', 'fixture_partition_on', 'from_state_code', 'to_state_code', 'transitioned_at'],
      rows: [[stored.id, partitionOn, null, 'COMPLETED', kickoff]],
      conflictTarget: ['fixture_partition_on', 'fixture_id', 'transitioned_at'],
    });
  }
  return { momTeamId: String(mom.id) };
}

describe('team_momentum — ALL_COMPETITIONS against the DB', { skip: !hasDatabase }, () => {
  let momTeamId: string;

  before(async () => {
    // Ensure the new feature registry row exists (idempotent), then seed the rig.
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    ({ momTeamId } = await withConnection(INGESTION_ROLE, (tx) => seedMomentumRig(tx)));
  });

  after(async () => {
    await closeAllPools();
  });

  async function inRolledBackFeatureTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(FEATURE_ROLE, async (tx) => {
      await tx.query('BEGIN');
      try {
        return await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  async function computeMomentum(tx: PoolClient): Promise<readonly CandidateValue[]> {
    const fixturesByTeam = await readCompletedFixtures(tx, [momTeamId], MOM_AS_OF);
    const context: CalculationContext = {
      definitions: new Map(),
      subjects: [{ teamId: momTeamId, asOf: MOM_AS_OF }],
      fixturesByTeam,
      homeVenueByTeam: new Map(),
      venuesById: new Map(),
      priorValues: new Map(),
    };
    return teamMomentum.calculate(context);
  }

  it('18. computes +15 over the real rig and persists at ALL_COMPETITIONS with NULL edition', async () => {
    await inRolledBackFeatureTx(async (tx) => {
      const registry = await loadRegistry(tx);
      const produced = await computeMomentum(tx);
      const value = produced.find((c) => c.featureKey === MOMENTUM && c.teamId === momTeamId);
      assert.ok(value, 'a momentum value is produced');
      assert.equal(toNumericString(value!.value), '15');
      assert.equal(value!.sampleObservationCount, 10);

      const result = await writeValues(tx, registry, produced, MOM_AS_OF); // default = ALL_COMPETITIONS
      assert.equal(result.written, 1);
      const { rows } = await tx.query(
        `SELECT d.feature_key, v.value::text AS value, v.context_kind_code,
                v.context_competition_edition_id AS ed, v.subject_kind_code,
                v.sample_observation_count, v.provenance_class_code, v.sample_meets_threshold
           FROM feature.feature_value v
           JOIN feature.feature_definition d ON d.id = v.feature_definition_id
          WHERE v.subject_team_id = $1 AND v.as_of = $2 AND d.feature_key = $3`,
        [momTeamId, MOM_AS_OF, MOMENTUM]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].value, '15');
      assert.equal(rows[0].context_kind_code, 'ALL_COMPETITIONS');
      assert.equal(rows[0].ed, null, 'ALL_COMPETITIONS momentum carries no edition');
      assert.equal(rows[0].subject_kind_code, 'TEAM');
      assert.equal(rows[0].sample_observation_count, 10);
      assert.equal(rows[0].provenance_class_code, 'DERIVED');
      assert.equal(rows[0].sample_meets_threshold, true);
    });
  });

  it('19. a rerun is idempotent (second write skipped)', async () => {
    await inRolledBackFeatureTx(async (tx) => {
      const registry = await loadRegistry(tx);
      const produced = await computeMomentum(tx);
      const first = await writeValues(tx, registry, produced, MOM_AS_OF);
      const again = await writeValues(tx, registry, produced, MOM_AS_OF);
      assert.equal(first.written, 1);
      assert.equal(again.written, 0);
      assert.equal(again.skipped, 1);
    });
  });

  it('24. the ALL_COMPETITIONS write carries no edition on any produced row (path regression)', async () => {
    await inRolledBackFeatureTx(async (tx) => {
      const registry = await loadRegistry(tx);
      const produced = await computeMomentum(tx);
      await writeValues(tx, registry, produced, MOM_AS_OF);
      const { rows } = await tx.query(
        `SELECT count(*)::int AS n FROM feature.feature_value
          WHERE subject_team_id = $1 AND as_of = $2 AND context_competition_edition_id IS NOT NULL`,
        [momTeamId, MOM_AS_OF]
      );
      assert.equal(rows[0].n, 0, 'ALL_COMPETITIONS momentum never writes a scoped row');
    });
  });
});
