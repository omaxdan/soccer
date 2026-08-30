// ─────────────────────────────────────────────────────────────────────────────
// S-6 Phase 2 — team.goal_margin_volatility (feature substrate for consistency_index)
//
// PURE tests pin the V1-exact unweighted sample stddev of signed goal margin
// (sqrt(Σ(m−mean)²/(n−1))), the n≥3 emit-or-absent gate, order-independence
// (proving NO recency weighting), incomplete-result exclusion, determinism, and
// that the calculator reads the ADDITIVE longWindowFixturesByTeam (not the shared
// windowed fixturesByTeam). DB tests pin the long-window read: strict kickoff <
// as_of (exact-as_of and future excluded), the 730-day lower bound, completed +
// result only, and correct home/away margin orientation.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { seedFeatureRegistry } from '../../seed/featureRegistry';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { readCompletedFixturesInWindow, LONG_WINDOW_DAYS } from '../read/fixtures';
import { goalMarginVolatility } from '../calculators/goalMarginVolatility';
import { compare, fromInt, toNumericString, ZERO } from '../write/scale';
import type { CalculationContext, CompletedFixture } from '../calculators/types';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;

const KEY = 'team.goal_margin_volatility';
const TEAM = '900';
const AS_OF = new Date('2027-05-02T00:00:00Z');

// ─── pure calculator ─────────────────────────────────────────────────────────

/** A completed fixture whose subject-oriented margin is `m` (goalsFor − goalsAgainst). */
function marginFixture(m: number | null, isHome = true, id = 'F'): CompletedFixture {
  const goalsFor = m === null ? null : m + 5; // +5 base keeps both goal counts ≥ 0
  const goalsAgainst = m === null ? null : 5;
  return { fixtureId: id, fixturePartitionOn: '2027-01-01', kickoffAt: AS_OF, isHome, goalsFor, goalsAgainst, venueId: null };
}

function contextFor(fixtures: readonly CompletedFixture[], opts?: { emptyLong?: boolean }): CalculationContext {
  const history = { teamId: TEAM, fixtures };
  return {
    definitions: new Map(),
    subjects: [{ teamId: TEAM, asOf: AS_OF }],
    // Deliberately EMPTY: proves the calculator does NOT read the shared window.
    fixturesByTeam: new Map([[TEAM, history]]),
    longWindowFixturesByTeam: opts?.emptyLong ? new Map() : new Map([[TEAM, history]]),
    homeVenueByTeam: new Map(),
    venuesById: new Map(),
    priorValues: new Map(),
  };
}

function volFor(margins: readonly (number | null)[], isHomePattern?: readonly boolean[]) {
  const fixtures = margins.map((m, i) => marginFixture(m, isHomePattern?.[i] ?? true, `F${i}`));
  return goalMarginVolatility.calculate(contextFor(fixtures));
}

describe('team.goal_margin_volatility — pure V1-exact unweighted sample stddev', () => {
  it('declares itself: calculatorKey, featureKey, needsLongWindowHistory', () => {
    assert.equal(goalMarginVolatility.calculatorKey, 'goal_margin_volatility');
    assert.deepEqual([...goalMarginVolatility.featureKeys], [KEY]);
    assert.equal(goalMarginVolatility.needsLongWindowHistory, true);
  });

  it('1. exactly 3 observations [-2,0,2] → volatility 2, sample 3', () => {
    const [c] = volFor([-2, 0, 2]);
    assert.ok(c, 'a candidate is produced at n=3');
    assert.equal(compare(c.value, fromInt(2)), 0, 'sqrt((4+0+4)/2) = 2');
    assert.equal(c.sampleObservationCount, 3);
    assert.equal(c.featureKey, KEY);
    assert.deepEqual([...c.consumed], []);
  });

  it('2. fewer than 3 → feature ABSENT (no candidate), never fabricated', () => {
    assert.equal(volFor([1, -1]).length, 0, 'n=2 → absent');
    assert.equal(volFor([3]).length, 0, 'n=1 → absent');
    assert.equal(volFor([]).length, 0, 'n=0 → absent');
  });

  it('3. uses the SAMPLE stddev (n−1), not the population (n)', () => {
    // [0,0,3]: mean 1, Σdev² = 1+1+4 = 6 → /(n−1)=3 → sqrt(3)=1.7320508…
    // The population form would be 6/3=2 → sqrt(2)=1.4142…, which must NOT appear.
    const [c] = volFor([0, 0, 3]);
    const s = toNumericString(c.value);
    assert.ok(s.startsWith('1.7320508'), `expected sqrt(3), got ${s}`);
    assert.ok(!s.startsWith('1.41'), 'must not be the population (÷n) form');
  });

  it('zero volatility: n≥3 with all margins equal → 0 (a real value, not absence)', () => {
    const [c] = volFor([2, 2, 2]);
    assert.ok(c);
    assert.equal(compare(c.value, ZERO), 0);
  });

  it('no recency weighting: reordering the margins yields an identical result (order-independent)', () => {
    const a = toNumericString(volFor([-2, 0, 2])[0].value);
    const b = toNumericString(volFor([2, 0, -2])[0].value);
    const d = toNumericString(volFor([0, 2, -2])[0].value);
    assert.equal(a, b);
    assert.equal(a, d);
  });

  it('4. mixed home/away contribute by signed margin; incomplete results are skipped', () => {
    // Three valid margins (home & away mixed) plus one null-goals fixture skipped.
    const [c] = volFor([-2, 0, 2, null], [true, false, true, false]);
    assert.ok(c);
    assert.equal(c.sampleObservationCount, 3, 'the incomplete-result fixture is excluded');
    assert.equal(compare(c.value, fromInt(2)), 0);
  });

  it('an incomplete result dropping the count below 3 → ABSENT', () => {
    assert.equal(volFor([1, 2, null]).length, 0, '2 valid + 1 incomplete → n=2 → absent');
  });

  it('11. deterministic: identical input yields an identical value', () => {
    assert.equal(toNumericString(volFor([-3, 1, 4, 0, -1])[0].value), toNumericString(volFor([-3, 1, 4, 0, -1])[0].value));
  });

  it('12. reads longWindowFixturesByTeam, not the shared fixturesByTeam', () => {
    // longWindow empty but the (short) fixturesByTeam populated → NO candidate,
    // proving the calculator ignores the shared window entirely.
    const fixtures = [-2, 0, 2].map((m, i) => marginFixture(m, true, `F${i}`));
    const ctx = contextFor(fixtures, { emptyLong: true });
    assert.equal(goalMarginVolatility.calculate(ctx).length, 0, 'empty long window → absent even though fixturesByTeam is full');
  });
});

// ─── DB: the additive long-window read ───────────────────────────────────────

const TAG = 'S6GMV' + (Date.now() % 1_000_000);

describe('readCompletedFixturesInWindow (additive 730-day read)', { skip: !hasDatabase }, () => {
  const DB_AS_OF = new Date('2027-05-02T00:00:00Z');
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const daysBefore = (n: number) => new Date(DB_AS_OF.getTime() - n * 86_400_000);
  let editionId = '', teamId = '', oppId = '';

  before(async () => {
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    await withConnection(INGESTION_ROLE, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,'GMV League',$3,'GB') RETURNING id::text`, [PROVIDER_CODE, `${TAG}-C`, `${TAG}-c`.toLowerCase()]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'GMV', daterange('2024-01-01','2028-01-01')) RETURNING id::text`, [comp.rows[0].id, `${TAG}-S`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${TAG}-T${s}`, `GMV ${s}`, `${TAG}-t${s}`.toLowerCase()])).rows[0].id;
      teamId = await team('A'); oppId = await team('B');

      let seq = 0;
      // helper: insert a fixture (subject home or away) with optional result
      const fixture = async (kickoff: Date, subjectHome: boolean, homeGoals: number | null, awayGoals: number | null, state = 'COMPLETED') => {
        seq += 1;
        const home = subjectHome ? teamId : oppId;
        const away = subjectHome ? oppId : teamId;
        const part = day(kickoff);
        const fx = await tx.query<{ id: string }>(
          `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
             is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
           VALUES ($1,$2,$3::date,$4,false,$5,$6,$7,$8) RETURNING id::text`,
          [PROVIDER_CODE, `${TAG}-F${seq}`, part, editionId, home, away, kickoff.toISOString(), state]);
        if (homeGoals !== null && awayGoals !== null) {
          await tx.query(
            `INSERT INTO football.result (fixture_partition_on, fixture_id, home_goals, away_goals)
             VALUES ($1::date,$2::bigint,$3,$4)`, [part, fx.rows[0].id, homeGoals, awayGoals]);
        }
      };

      // In-window, subject HOME, 1–3 → subject margin −2
      await fixture(daysBefore(10), true, 1, 3);
      // In-window, subject AWAY, home 1 – away 3 → subject (away) margin +2
      await fixture(daysBefore(20), false, 1, 3);
      // In-window, subject HOME, 0–0 → margin 0
      await fixture(daysBefore(30), true, 0, 0);
      // Exactly AT as_of → excluded (strict <)
      await fixture(DB_AS_OF, true, 5, 0);
      // Future → excluded
      await fixture(daysBefore(-5), true, 5, 0);
      // Older than 730 days → excluded
      await fixture(daysBefore(LONG_WINDOW_DAYS + 5), true, 4, 0);
      // COMPLETED but NO result → excluded (INNER JOIN)
      await fixture(daysBefore(40), true, null, null);
      // Not completed (SCHEDULED) in-window → excluded
      await fixture(daysBefore(3), true, 2, 2, 'SCHEDULED');
    });
  });
  after(async () => { await closeAllPools(); });

  async function read(tx: PoolClient) {
    const map = await readCompletedFixturesInWindow(tx, [teamId], DB_AS_OF);
    return map.get(teamId)?.fixtures ?? [];
  }

  it('returns only completed-with-result fixtures strictly in [as_of−730d, as_of)', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await read(tx);
      // The three eligible fixtures only (exact-as_of, future, >730d, no-result, SCHEDULED all excluded).
      assert.equal(fixtures.length, 3, `expected 3 eligible, got ${fixtures.length}`);
      assert.ok(fixtures.every((f) => f.kickoffAt.getTime() < DB_AS_OF.getTime()), 'strict < as_of');
      assert.ok(fixtures.every((f) => f.kickoffAt.getTime() >= DB_AS_OF.getTime() - LONG_WINDOW_DAYS * 86_400_000), 'within 730d');
      assert.ok(fixtures.every((f) => f.goalsFor !== null && f.goalsAgainst !== null), 'result present');
    });
  });

  it('orients goals to the subject team for home AND away fixtures', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await read(tx);
      const margins = fixtures.map((f) => (f.goalsFor as number) - (f.goalsAgainst as number)).sort((a, b) => a - b);
      // −2 (home 1–3), +2 (away 1–3 → subject away scored 3), 0 (0–0)
      assert.deepEqual(margins, [-2, 0, 2]);
    });
  });

  it('feeds a volatility of 2 for this team at as_of (end-to-end margins → calculator)', async () => {
    await withConnection(FEATURE_ROLE, async (tx) => {
      const fixtures = await read(tx);
      const ctx: CalculationContext = {
        definitions: new Map(), subjects: [{ teamId, asOf: DB_AS_OF }],
        fixturesByTeam: new Map(), longWindowFixturesByTeam: new Map([[teamId, { teamId, fixtures }]]),
        homeVenueByTeam: new Map(), venuesById: new Map(), priorValues: new Map(),
      };
      const [c] = goalMarginVolatility.calculate(ctx);
      assert.ok(c);
      assert.equal(compare(c.value, fromInt(2)), 0, 'margins [-2,0,2] → mean 0, sqrt((4+0+4)/2) = 2');
    });
  });
});
