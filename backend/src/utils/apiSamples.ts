import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * Captures ONE representative raw API response per (endpoint, group key)
 * pair, written to backend/docs/api-samples/{endpoint}/{group}.json — for
 * reference when writing/debugging parsing logic against real data
 * instead of guessing.
 *
 * The "group" key means something different per endpoint, by design:
 *   - standings, player-stats, team-stats: tier BAND (A/B/C/Mandated/
 *     Discovery from TRACKED_LEAGUES, resolved via getBandBySlug()) — the
 *     question these endpoints need answered is "does response richness
 *     differ by competition tier".
 *   - squad: team COUNTRY — this sync runs per-team without otherwise
 *     resolving which tracked tournament/tier a team belongs to, so
 *     country is what's cheaply available without extra plumbing. Still
 *     a real, useful signal, just a different question answered.
 *
 * IMPORTANT: for the standings/stats endpoints, this must be the TIER BAND
 * from TRACKED_LEAGUES, NOT tournaments.category from the DB — that DB
 * column actually stores COUNTRY (e.g. 'Brazil', 'England'), a completely
 * different field. Confirmed by reading the actual schema and config
 * during this feature's development, not assumed. Mixing these up would
 * organize samples by country when the goal was comparing by tier.
 *
 * Design decisions, and why:
 *
 * - SKIP IF EXISTS, not overwrite-every-call. Logging every response would
 *   create near-identical noise (hundreds of near-duplicate Premier League
 *   team-stats samples) with zero added value. One clean sample per group
 *   is enough to see the real shape. Use `refresh:api-samples` (clears
 *   existing files) if a provider changes their response shape and
 *   samples go stale — deliberate refresh, not silent overwrite, so git
 *   diffs on these files are meaningful when they do change.
 *
 * - SOFT-FAIL, never breaks a real sync. This is a diagnostic nice-to-have,
 *   not core functionality. Any failure (disk permission on cPanel shared
 *   hosting, whatever) logs a warning and the actual sync continues
 *   completely unaffected — same principle as every other defensive
 *   pattern in this codebase (fetchAllRows, graceful score fallbacks, etc).
 *
 * - Taps EXISTING API calls, zero additional requests. Called from
 *   directly inside each sync job right where the raw response is already
 *   being received — this does not fire its own API calls.
 *
 * Usage (inside any sync job, right after receiving `response`):
 *   await logApiSample('standings', getBandBySlug(tournament.slug), response);
 *   await logApiSample('squad', team.country, rawResponse);
 */
const SAMPLES_DIR = path.join(__dirname, '..', '..', 'docs', 'api-samples');

export async function logApiSample(
  endpoint: string,
  group: string | null | undefined,
  response: any
): Promise<void> {
  try {
    const groupLabel = (group ?? 'unknown').toUpperCase().replace(/\s+/g, '_');
    const dir = path.join(SAMPLES_DIR, endpoint);
    const filePath = path.join(dir, `${groupLabel}.json`);

    // Skip if a sample already exists for this endpoint+group — this is
    // what keeps the feature to "one clean reference per combination"
    // rather than growing unbounded on every sync run.
    if (fs.existsSync(filePath)) return;

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(response, null, 2), 'utf-8');
    logger.info({ endpoint, group: groupLabel, filePath }, 'API sample captured');
  } catch (error: any) {
    // Never let a diagnostic feature break a real sync run.
    logger.warn({ endpoint, group, error: error.message }, 'logApiSample failed — sync continues unaffected');
  }
}

/**
 * Clears all captured samples so the next normal sync cycle recaptures
 * fresh ones. Deliberate action (CLI command), not automatic — see
 * design notes above for why this isn't just an overwrite-on-every-call.
 */
export function clearApiSamples(): { deleted: number } {
  let deleted = 0;
  try {
    if (!fs.existsSync(SAMPLES_DIR)) return { deleted: 0 };
    const endpoints = fs.readdirSync(SAMPLES_DIR);
    for (const endpoint of endpoints) {
      const dir = path.join(SAMPLES_DIR, endpoint);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
        deleted++;
      }
    }
  } catch (error: any) {
    logger.warn({ error: error.message }, 'clearApiSamples failed');
  }
  return { deleted };
}
