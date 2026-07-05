/**
 * TEAM/TOURNAMENT IMAGE SYNC — one-time backfill, self-hosted.
 *
 * Source: GET /teams/{teamId}/image
 *
 * Downloads the image once per team/tournament and re-hosts it in Supabase
 * Storage, rather than storing a source URL. This decouples image-serving
 * from the API rate-limit budget entirely — the frontend never calls
 * SportsAPI Pro for images after this runs, regardless of traffic volume.
 * (We don't know whether the source endpoint is itself rate-limited per
 * fetch — self-hosting is the only architecture that's safe to put in
 * front of real user traffic either way.)
 *
 * CADENCE: one-time backfill, not a recurring sync. Crests/badges rarely
 * change — re-run manually if a club rebrands, not on any schedule.
 */

import { sportsApiClient } from '../services/sportsApiClient';
import { db } from '../db/client';
import { logger } from '../utils/logger';

const THROTTLE_MS = 2000;
const BUCKET = 'crests';
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function ensureBucket(): Promise<void> {
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === BUCKET)) {
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 1024 * 1024 }); // 1MB cap per file
    logger.info({ bucket: BUCKET }, 'Created storage bucket');
  }
}

async function downloadAndUpload(path: string, externalId: number): Promise<string | null> {
  try {
    // sportsApiClient.get() expects JSON; image bytes need a raw fetch through
    // the same base URL + auth header pattern, so we go around the JSON client.
    const response = await fetch(`${process.env.SPORTSAPI_BASE_URL}${path}`, {
      headers: { 'x-api-key': process.env.SPORTSAPI_KEY || '' },
    });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/png';
    const ext = contentType.includes('svg') ? 'svg' : contentType.includes('jpeg') ? 'jpg' : 'png';
    const storagePath = `${path.includes('teams') ? 'teams' : 'tournaments'}/${externalId}.${ext}`;

    const { error } = await db.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
    if (error) {
      logger.error({ error: error.message, externalId }, 'Storage upload failed');
      return null;
    }
    return storagePath;
  } catch (error: any) {
    logger.error({ error: error.message, externalId }, 'Image download failed');
    return null;
  }
}

export async function syncTeamImages(): Promise<{ teamsProcessed: number; written: number; errors: number }> {
  logger.info('syncTeamImages started — one-time backfill');
  await ensureBucket();

  const { data: teams } = await db
    .from('teams')
    .select('id, external_id, name, crest_storage_path')
    .is('crest_storage_path', null); // only teams without an image yet

  if (!teams || teams.length === 0) {
    logger.info('No teams need image backfill');
    return { teamsProcessed: 0, written: 0, errors: 0 };
  }

  let written = 0, errors = 0;
  for (const team of teams) {
    const storagePath = await downloadAndUpload(`/teams/${team.external_id}/image`, team.external_id);
    if (storagePath) {
      await db.from('teams').update({ crest_storage_path: storagePath }).eq('id', team.id);
      written++;
      logger.info({ teamId: team.id, teamName: team.name, storagePath }, 'Team crest synced');
    } else {
      errors++;
    }
    await delay(THROTTLE_MS);
  }

  logger.info({ teamsProcessed: teams.length, written, errors }, 'syncTeamImages completed');
  return { teamsProcessed: teams.length, written, errors };
}

/** Tournament/league logo backfill — the half of this file's own
 *  docstring ("TEAM/TOURNAMENT IMAGE SYNC") that was never actually
 *  implemented. tournaments.logo_storage_path existed as a column with
 *  nothing ever writing to it until this function.
 *
 *  UNVERIFIED ENDPOINT, flagged honestly rather than presented as
 *  confirmed: no api-samples/ capture exists for a tournament/league
 *  image endpoint anywhere in this codebase (checked before writing
 *  this), so `/tournaments/{id}/image` below is an assumption mirroring
 *  the team endpoint's REST convention, not a verified path. Fails
 *  gracefully if wrong — downloadAndUpload() already returns null and
 *  logs an error on any non-ok response rather than throwing, so a
 *  wrong endpoint here shows up clearly as "0 written, N errors" in the
 *  job's own return value, not a crash. Test this against a small batch
 *  before trusting it at full scale. */
export async function syncTournamentImages(): Promise<{ tournamentsProcessed: number; written: number; errors: number }> {
  logger.info('syncTournamentImages started — one-time backfill (endpoint unverified, test before full run)');
  await ensureBucket();

  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, external_id, name, logo_storage_path')
    .is('logo_storage_path', null); // only tournaments without a logo yet

  if (!tournaments || tournaments.length === 0) {
    logger.info('No tournaments need logo backfill');
    return { tournamentsProcessed: 0, written: 0, errors: 0 };
  }

  let written = 0, errors = 0;
  for (const t of tournaments) {
    const storagePath = await downloadAndUpload(`/tournaments/${t.external_id}/image`, t.external_id);
    if (storagePath) {
      await db.from('tournaments').update({ logo_storage_path: storagePath }).eq('id', t.id);
      written++;
      logger.info({ tournamentId: t.id, tournamentName: t.name, storagePath }, 'Tournament logo synced');
    } else {
      errors++;
    }
    await delay(THROTTLE_MS);
  }

  logger.info({ tournamentsProcessed: tournaments.length, written, errors }, 'syncTournamentImages completed');
  return { tournamentsProcessed: tournaments.length, written, errors };
}
