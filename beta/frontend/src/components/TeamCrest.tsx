import { getCrestUrl } from '@/lib/images';

// ─── TEAM CREST — image with graceful initials-badge fallback ──────────────
// Consolidates a pattern that was previously copy-pasted (with slightly
// different styling each time) across 7+ files: a colored box showing a
// team's short_name initials as a logo stand-in. Shows the REAL crest once
// synced (getCrestUrl handles converting the stored path to a usable
// Supabase Storage URL); falls back to the initials box when a team simply
// doesn't have a crest synced yet — display never depends on 100% sync
// coverage, matching the same graceful-fallback principle used throughout
// this codebase for missing data generally.
export default function TeamCrest({
  team, size = 24, borderRadius = 4,
}: {
  team: { short_name?: string | null; name?: string | null; crest_storage_path?: string | null } | null | undefined;
  size?: number;
  borderRadius?: number;
}) {
  const url = getCrestUrl(team?.crest_storage_path);
  const initials = team?.short_name?.slice(0, 3) ?? team?.name?.slice(0, 3) ?? '?';

  if (url) {
    return (
      <img
        src={url}
        alt={team?.name ?? 'Team'}
        width={size}
        height={size}
        style={{ objectFit: 'contain', borderRadius, flexShrink: 0 }}
      />
    );
  }

  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"JetBrains Mono",monospace', fontSize: Math.max(8, Math.round(size * 0.35)),
      fontWeight: 700, color: 'var(--text)',
    }}>
      {initials}
    </div>
  );
}
