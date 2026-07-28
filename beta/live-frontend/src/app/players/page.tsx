import Link from "next/link";
import { getPlayerDirectory } from "@/lib/queries";
import { playerSlug, teamSlug } from "@/lib/slug";
import { Crest } from "@/components/Crest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Players" };

export default async function PlayersPage() {
  const players = await getPlayerDirectory();

  // Grouped by squad rather than listed flat: a 500-row alphabetical list of
  // names is a database dump, and nobody browses players without a club in mind.
  const squads = new Map<
    number,
    { name: string; crest: string | null; players: typeof players }
  >();
  for (const p of players) {
    if (p.team_id == null) continue;
    const squad = squads.get(p.team_id) ?? {
      name: p.team_name ?? `Team ${p.team_id}`,
      crest: p.team_crest,
      players: [],
    };
    squad.players.push(p);
    squads.set(p.team_id, squad);
  }
  const ordered = [...squads.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Intelligence</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Players</h1>
        <p className="mt-2 max-w-2xl text-[0.8rem] leading-relaxed text-muted">
          Squads across every tracked competition. Open a player for season statistics,
          intelligence ratings and availability.
        </p>
        <p className="mono mt-2 text-[0.6rem] tracking-wide text-faint">
          {players.length.toLocaleString()} players · {ordered.length} squads
        </p>
      </header>

      {ordered.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No squad data available.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordered.map(([teamId, squad]) => (
            <details key={teamId} className="panel p-3">
              <summary className="mono flex cursor-pointer list-none items-center gap-2 text-[0.78rem] font-semibold text-text [&::-webkit-details-marker]:hidden">
                <span className="inline-block text-faint transition-transform group-open:rotate-90">
                  ›
                </span>
                <Crest team={{ id: teamId, name: squad.name, crest_storage_path: squad.crest } as any} size={18} />
                <span className="min-w-0 flex-1 truncate">{squad.name}</span>
                <span className="mono tnum shrink-0 text-[0.6rem] text-faint">
                  {squad.players.length}
                </span>
              </summary>

              <ul className="mt-2 grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
                {squad.players.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/player/${playerSlug(p)}`}
                      className="flex items-center gap-2 rounded-term px-2 py-1.5 transition-colors hover:bg-raised"
                    >
                      <span className="mono tnum w-5 shrink-0 text-right text-[0.6rem] text-faint">
                        {p.jersey_number ?? "—"}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[0.72rem] text-text">
                        {p.short_name || p.name}
                      </span>
                      {p.injured && (
                        <span
                          className="mono shrink-0 text-[0.5rem] tracking-widest"
                          style={{ color: "var(--risk)" }}
                        >
                          OUT
                        </span>
                      )}
                      {p.position && (
                        <span className="mono shrink-0 text-[0.56rem] text-faint">
                          {p.position}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>

              <Link
                href={`/team/${teamSlug({ id: teamId, name: squad.name })}`}
                className="mono mt-2 inline-block text-[0.62rem] tracking-widest text-amber"
              >
                TEAM INTELLIGENCE →
              </Link>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
