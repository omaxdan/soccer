import { crestUrl } from "@/lib/supabase";
import type { TeamLite } from "@/lib/types";

const PALETTE = [
  "#2FBF87", "#4C8DFF", "#FFB020", "#E5787A", "#9B8CFF", "#48C7D8", "#E0A458",
];

function monogram(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Crest({
  team,
  size = 32,
}: {
  team: Pick<TeamLite, "name" | "short_name" | "crest_storage_path" | "id">;
  size?: number;
}) {
  const url = crestUrl(team.crest_storage_path);
  const color = PALETTE[team.id % PALETTE.length];
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="mono grid shrink-0 place-items-center rounded font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        color,
        background: `color-mix(in srgb, ${color} 14%, var(--raised))`,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {monogram(team.short_name || team.name)}
    </span>
  );
}
