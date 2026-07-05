import { supabase } from '@/lib/supabase';

// ─── CREST/LOGO STORAGE URL ──────────────────────────────────────────────────
// teams.crest_storage_path and tournaments.logo_storage_path store a
// relative path inside the 'crests' Supabase Storage bucket (e.g.
// "teams/12345.png"), written by backend/src/jobs/syncTeamImages.ts. That
// path is NOT a usable URL by itself - a real fix, not a style preference:
// PredictedLineup.tsx was doing `<img src={team.crest_storage_path}>`
// directly, which resolves to a relative path on whatever page it's on and
// 404s every time, even for a team whose crest synced correctly.
//
// Uses the Supabase SDK's own getPublicUrl() rather than hand-building the
// "https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>"
// string - stays correct if Supabase ever changes that URL scheme, since
// the SDK owns the pattern, not this file.
const BUCKET = 'crests';

export function getCrestUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl ?? null;
}
