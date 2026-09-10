// ─────────────────────────────────────────────────────────────────────────────
// THIN ONBOARDING TESTS — pure planner + read-only orchestrator, no DB, no network.
//
// The orchestrator's DB and provider seams are injected, so these prove the
// governance gate and the no-mutation guarantee without touching either. The
// season fixtures are the real captured shapes; `now` is always injected.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normaliseSeasons, resolveCurrentSeason } from '../../provider/seasons';
import {
  planOnboarding,
  runOnboarding,
  type ExistingEdition,
  type OnboardDeps,
} from '../onboard';
import type { SeasonDiscoveryResult } from '../seasonDiscovery';

const NOW = new Date('2026-09-10T00:00:00Z');
const PROVIDER = 'SPORTSAPI_API';

// Real England catalogue (tournament 17), trimmed.
const ENGLAND = {
  seasons: [
    { id: 96668, name: 'Premier League 26/27', year: '26/27', tournamentId: 17 },
    { id: 76986, name: 'Premier League 25/26', year: '25/26', tournamentId: 17 },
  ],
};

function englandDiscovery(overrideSeasonId?: string): SeasonDiscoveryResult {
  const seasons = normaliseSeasons(ENGLAND);
  return {
    tournamentId: '17',
    seasons,
    resolution: resolveCurrentSeason(seasons, NOW, { overrideSeasonId }),
  };
}

const EDITION_143: ExistingEdition = {
  competitionEditionId: '143',
  competitionId: '153',
  seasonLabel: 'Premier League 26/27',
};

describe('planOnboarding · pure decision table', () => {
  test('untracked tournament → UNTRACKED (before any provider/governance action)', () => {
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '999999',
      isTracked: false,
      discovery: null,
      edition: null,
      authorizationCount: 0,
    });
    assert.equal(plan.state, 'UNTRACKED');
  });

  test('resolved + authorized + existing edition → GOVERNANCE_SATISFIED, edition reused', () => {
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '17',
      isTracked: true,
      discovery: englandDiscovery(),
      edition: EDITION_143,
      authorizationCount: 1,
    });
    assert.equal(plan.state, 'GOVERNANCE_SATISFIED');
    assert.equal(plan.season?.id, '96668');
    assert.equal(plan.edition?.competitionEditionId, '143');
    // Suggested window derived from the split year 26/27.
    assert.equal(plan.suggestedFrom, '2026-07-01');
    assert.equal(plan.suggestedTo, '2027-06-30');
  });

  test('resolved but NOT authorized → GOVERNANCE_REQUIRED (never silently upgraded)', () => {
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '17',
      isTracked: true,
      discovery: englandDiscovery(),
      edition: null,
      authorizationCount: 0,
    });
    assert.equal(plan.state, 'GOVERNANCE_REQUIRED');
    assert.equal(plan.season?.id, '96668');
  });

  test('more than one authorized row → GOVERNANCE_AMBIGUOUS (fail-closed)', () => {
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '17',
      isTracked: true,
      discovery: englandDiscovery(),
      edition: EDITION_143,
      authorizationCount: 2,
    });
    assert.equal(plan.state, 'GOVERNANCE_AMBIGUOUS');
  });

  test('discovery unresolved → DISCOVERY_UNRESOLVED (nothing to govern or ingest)', () => {
    const empty: SeasonDiscoveryResult = {
      tournamentId: '17',
      seasons: [],
      resolution: resolveCurrentSeason([], NOW),
    };
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '17',
      isTracked: true,
      discovery: empty,
      edition: null,
      authorizationCount: 0,
    });
    assert.equal(plan.state, 'DISCOVERY_UNRESOLVED');
  });

  test('existing edition is reported REUSED even before authorization', () => {
    const plan = planOnboarding({
      providerCode: PROVIDER,
      tournamentId: '17',
      isTracked: true,
      discovery: englandDiscovery(),
      edition: EDITION_143,
      authorizationCount: 0, // materialised historically but authorization since absent
    });
    assert.equal(plan.state, 'GOVERNANCE_REQUIRED');
    assert.equal(plan.edition?.competitionEditionId, '143'); // still reused, not duplicated
  });
});

describe('runOnboarding · read-only orchestration with injected seams', () => {
  test('untracked id short-circuits BEFORE the provider is called', async () => {
    let resolverCalls = 0;
    const deps: OnboardDeps = {
      resolveSeason: async () => {
        resolverCalls += 1;
        return englandDiscovery();
      },
      readAuthorization: async () => 1,
      readEdition: async () => EDITION_143,
    };
    const plan = await runOnboarding(
      { providerCode: PROVIDER, tournamentId: '424242', now: NOW },
      deps
    );
    assert.equal(plan.state, 'UNTRACKED');
    assert.equal(resolverCalls, 0, 'no provider discovery for an untracked id');
  });

  test('tracked + authorized → GOVERNANCE_SATISFIED; only reads happen', async () => {
    const calls: string[] = [];
    const deps: OnboardDeps = {
      resolveSeason: async (t) => {
        calls.push(`resolve:${t}`);
        return englandDiscovery();
      },
      readAuthorization: async (_p, _t, s) => {
        calls.push(`auth:${s}`);
        return 1;
      },
      readEdition: async (s) => {
        calls.push(`edition:${s}`);
        return EDITION_143;
      },
    };
    const plan = await runOnboarding({ providerCode: PROVIDER, tournamentId: '17', now: NOW }, deps);
    assert.equal(plan.state, 'GOVERNANCE_SATISFIED');
    assert.equal(plan.season?.id, '96668');
    assert.equal(plan.edition?.competitionEditionId, '143');
    // Exactly the read seams were exercised — no ingestion seam exists on this path.
    assert.deepEqual(calls.sort(), ['auth:96668', 'edition:96668', 'resolve:17'].sort());
  });

  test('tracked + unauthorized → GOVERNANCE_REQUIRED; still only reads', async () => {
    const deps: OnboardDeps = {
      resolveSeason: async () => englandDiscovery(),
      readAuthorization: async () => 0,
      readEdition: async () => null,
    };
    const plan = await runOnboarding({ providerCode: PROVIDER, tournamentId: '17', now: NOW }, deps);
    assert.equal(plan.state, 'GOVERNANCE_REQUIRED');
  });

  test('discovery failure never reaches governance/edition reads', async () => {
    let authCalls = 0;
    const deps: OnboardDeps = {
      resolveSeason: async () => ({
        tournamentId: '17',
        seasons: [],
        resolution: resolveCurrentSeason([], NOW),
      }),
      readAuthorization: async () => {
        authCalls += 1;
        return 1;
      },
      readEdition: async () => null,
    };
    const plan = await runOnboarding({ providerCode: PROVIDER, tournamentId: '17', now: NOW }, deps);
    assert.equal(plan.state, 'DISCOVERY_UNRESOLVED');
    assert.equal(authCalls, 0, 'no governance read when discovery did not resolve');
  });

  test('historical override flows through the existing explicit path', async () => {
    const deps: OnboardDeps = {
      resolveSeason: async (_t, _now, override) => englandDiscovery(override),
      readAuthorization: async () => 1,
      readEdition: async () => EDITION_143,
    };
    const plan = await runOnboarding(
      { providerCode: PROVIDER, tournamentId: '17', now: NOW, overrideSeasonId: '76986' },
      deps
    );
    // Override selects the historical season explicitly; governance still gates it.
    assert.equal(plan.season?.id, '76986');
    assert.equal(plan.state, 'GOVERNANCE_SATISFIED');
  });
});
