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
// Enable debug logging for image sync
const DEBUG_IMAGE_SYNC = process.env.DEBUG_IMAGE_SYNC === 'true';
const BUCKET = 'crests';
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function ensureBucket(): Promise<void> {
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b: any) => b.name === BUCKET)) {
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 1024 * 1024 }); // 1MB cap per file
    logger.info({ bucket: BUCKET }, 'Created storage bucket');
  }
}

async function downloadAndUpload(path: string, externalId: number, type: 'team' | 'tournament' = 'team'): Promise<string | null> {
  try {
    const url = `${process.env.SPORTSAPI_BASE_URL}${path}`;
    logger.debug({ url, externalId, type }, `Fetching ${type} image...`);
    
    const response = await fetch(url, {
      headers: { 'x-api-key': process.env.SPORTSAPI_KEY || '' },
    });

    // Log the response details
    logger.debug({
      status: response.status,
      statusText: response.statusText,
      url,
      externalId,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
    }, `API Response for ${type} ${externalId}`);
      if (DEBUG_IMAGE_SYNC) {
        logger.debug({ 
          responseHeaders: Object.fromEntries(response.headers.entries()),
          requestUrl: url,
          apiKeyPresent: !!process.env.SPORTSAPI_KEY,
        }, 'Detailed debug information');
      }
    if (!response.ok) {
      // Try to get error body
      let errorBody = 'No response body';
      try {
        const text = await response.text();
        errorBody = text.substring(0, 500); // First 500 chars
      } catch (_) {
        // Ignore - body might not be readable
      }
      
      logger.error({
        externalId,
        type,
        status: response.status,
        statusText: response.statusText,
        url,
        errorBody,
      }, `Failed to fetch ${type} image - API returned ${response.status}`);
      return null;
    }

    // Get the image data
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Detect content type
    const contentType = response.headers.get('content-type') || 'image/png';
    let ext = 'png';
    if (contentType.includes('svg')) ext = 'svg';
    else if (contentType.includes('jpeg')) ext = 'jpg';
    else if (contentType.includes('png')) ext = 'png';
    else if (contentType.includes('webp')) ext = 'webp';
    
    // Determine storage folder
    const folder = type === 'team' ? 'teams' : 'tournaments';
    const storagePath = `${folder}/${externalId}.${ext}`;

    logger.debug({ 
      externalId, 
      type, 
      folder,
      storagePath, 
      contentType, 
      fileSize: buffer.length,
      ext 
    }, `Uploading ${type} image to storage...`);

    // Upload to Supabase
    const { error, data } = await db.storage.from(BUCKET).upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

    if (error) {
      logger.error({
        error: error.message,
        errorDetails: error,
        externalId,
        type,
        storagePath,
      }, `Supabase storage upload failed for ${type} ${externalId}`);
      return null;
    }

    logger.info({
      externalId,
      type,
      storagePath,
      fileSize: buffer.length,
      publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`,
    }, `✅ Successfully uploaded ${type} image to storage`);

    return storagePath;
  } catch (error: any) {
    logger.error({
      error: error.message,
      stack: error.stack,
      externalId,
      type,
      path,
    }, `Unexpected error downloading ${type} image`);
    return null;
  }
}

export async function syncTeamImages(externalIds?: number[]): Promise<{ teamsProcessed: number; written: number; errors: number }> {
  const targeted = externalIds != null && externalIds.length > 0;
  logger.info(targeted ? { externalIds } : {}, targeted ? 'syncTeamImages started — targeted re-sync' : 'syncTeamImages started — one-time backfill');
  await ensureBucket();

  const q = db.from('teams').select('id, external_id, name, crest_storage_path');
  // Targeted mode re-syncs the given teams regardless of whether they
  // already have an image (the real use case: a club rebrand, or
  // confirming a specific team's crest looks right). Default mode keeps
  // the original backfill-only-missing behavior unchanged.
  const { data: teams } = targeted ? await q.in('external_id', externalIds!) : await q.is('crest_storage_path', null);

  if (!teams || teams.length === 0) {
    logger.info('No teams to sync');
    return { teamsProcessed: 0, written: 0, errors: 0 };
  }

  let written = 0, errors = 0;
  for (const team of teams) {
    const storagePath = await downloadAndUpload(`/teams/${team.external_id}/image`, team.external_id);
    if (storagePath) {
      await db.from('teams').update({ crest_storage_path: storagePath }).eq('id', team.id);
      written++;
      logger.debug({ teamId: team.id, teamName: team.name, storagePath }, 'Team crest synced');
    } else {
      errors++;
    }
    await delay(THROTTLE_MS);
  }

  logger.info({ teamsProcessed: teams.length, written, errors }, 'syncTeamImages completed');
  return { teamsProcessed: teams.length, written, errors };
}

/**
 * Tournament/league logo backfill — syncs tournament logos to Supabase Storage.
 *
 * Source: GET /images/tournaments/{tournamentId}
 *
 * Downloads the image once per tournament and re-hosts it in Supabase
 * Storage, rather than storing a source URL. This decouples image-serving
 * from the API rate-limit budget entirely — the frontend never calls
 * SportsAPI Pro for images after this runs, regardless of traffic volume.
 *
 * CADENCE: one-time backfill, not a recurring sync. Tournament logos rarely
 * change — re-run manually if a league rebrands, not on any schedule.
 */
export async function syncTournamentImages(externalIds?: number[]): Promise<{ tournamentsProcessed: number; written: number; errors: number }> {
  const targeted = externalIds != null && externalIds.length > 0;
  logger.info(targeted ? { externalIds } : {}, targeted ? 'syncTournamentImages started — targeted re-sync' : 'syncTournamentImages started — one-time backfill');
  await ensureBucket();

  // Get tournaments that need logos
  const q = db.from('tournaments').select('id, external_id, name, logo_storage_path');
  const { data: tournaments, error: queryError } = targeted ? await q.in('external_id', externalIds!) : await q.is('logo_storage_path', null);

  if (queryError) {
    logger.error({ error: queryError }, 'Failed to query tournaments');
    return { tournamentsProcessed: 0, written: 0, errors: 0 };
  }

  if (!tournaments || tournaments.length === 0) {
    logger.info('No tournaments to sync');
    return { tournamentsProcessed: 0, written: 0, errors: 0 };
  }

  // Add a type definition for the tournament
type Tournament = {
  id: number;
  external_id: number;
  name: string;
  logo_storage_path: string | null;
};

// Or use inline typing
logger.info({ 
  count: tournaments.length, 
  tournamentIds: tournaments.map((t: { external_id: number }) => t.external_id)
}, `Found ${tournaments.length} tournaments to sync`);

// Or use 'as' assertion
logger.info({ 
  count: tournaments.length, 
  tournamentIds: tournaments.map((t: Tournament) => t.external_id)
}, `Found ${tournaments.length} tournaments to sync`);

  let written = 0, errors = 0;
  const errorDetails: any[] = [];

  for (const t of tournaments) {
    try {
      logger.debug({ tournamentId: t.id, externalId: t.external_id, name: t.name }, `Processing tournament: ${t.name}`);
      
      // ✅ FIXED: Using the correct tournament image endpoint
      const storagePath = await downloadAndUpload(
        `/tournament/${t.external_id}/image`,  // ← This is the key fix
        t.external_id,
        'tournament'
      );
      
      if (storagePath) {
        // Update the database
        const { error: updateError } = await db
          .from('tournaments')
          .update({ logo_storage_path: storagePath })
          .eq('id', t.id);

        if (updateError) {
          logger.error({
            error: updateError,
            tournamentId: t.id,
            externalId: t.external_id,
            name: t.name,
          }, 'Failed to update tournament record');
          errors++;
          errorDetails.push({ id: t.external_id, name: t.name, error: updateError.message });
        } else {
          written++;
          logger.info({
            tournamentId: t.id,
            externalId: t.external_id,
            name: t.name,
            storagePath,
          }, `✅ Tournament logo synced: ${t.name}`);
        }
      } else {
        errors++;
        errorDetails.push({ id: t.external_id, name: t.name, error: 'Failed to download image' });
        logger.warn({
          tournamentId: t.id,
          externalId: t.external_id,
          name: t.name,
        }, `❌ Failed to sync tournament logo: ${t.name}`);
      }
    } catch (error: any) {
      errors++;
      errorDetails.push({ id: t.external_id, name: t.name, error: error.message });
      logger.error({
        error: error.message,
        stack: error.stack,
        tournamentId: t.id,
        externalId: t.external_id,
        name: t.name,
      }, `Unexpected error processing tournament: ${t.name}`);
    }

    // Throttle between requests
    await delay(THROTTLE_MS);
  }

  // Log summary with detailed errors
  if (errors > 0) {
    logger.error({
      total: tournaments.length,
      written,
      errors,
      errorDetails: errorDetails.slice(0, 10), // First 10 errors
    }, `❌ Tournament sync completed with ${errors} failures`);
  } else {
    logger.info({
      total: tournaments.length,
      written,
      errors,
    }, `✅ Tournament sync completed successfully`);
  }

  return { tournamentsProcessed: tournaments.length, written, errors };
}
