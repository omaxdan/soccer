import Link from "next/link";
import { globalSearch, type SearchHit } from "@/lib/queries";
import { NavSearch, NavTeams, NavPlayers, NavLeagues, NavMatches } from "@/components/icons/NavIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

/**
 * Server-rendered results from a plain GET form.
 *
 * No client component and no debounced fetch: the query lives in the URL, so a
 * result set is shareable, bookmarkable, and survives a refresh. A search that
 * only exists in component state cannot be linked to.
 */
const META: Record<
  SearchHit["entityType"],
  { label: string; href: (h: SearchHit) => string; Icon: (p: { size?: number }) => React.ReactElement }
> = {
  team: { label: "Team", href: (h) => `/team/${slugify(h.title)}-${h.entityId}`, Icon: NavTeams },
  player: { label: "Player", href: (h) => `/player/${slugify(h.title)}-${h.entityId}`, Icon: NavPlayers },
  league: { label: "Competition", href: (h) => `/league/${slugify(h.title)}-${h.entityId}`, Icon: NavLeagues },
  match: { label: "Fixture", href: (h) => `/match/${slugify(h.title)}-${h.entityId}`, Icon: NavMatches },
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const term = (q ?? "").trim();
  const hits = term.length >= 2 ? await globalSearch(term, 30) : [];

  const grouped = new Map<SearchHit["entityType"], SearchHit[]>();
  for (const h of hits) grouped.set(h.entityType, [...(grouped.get(h.entityType) ?? []), h]);

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Tools</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Search</h1>

        <form action="/search" method="get" className="mt-3 flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search teams, players, competitions and fixtures</span>
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">
              <NavSearch size={14} />
            </span>
            <input
              name="q"
              type="search"
              defaultValue={term}
              autoComplete="off"
              placeholder="Team, player, competition or fixture"
              className="mono w-full rounded-term border border-line bg-raised py-2 pl-8 pr-2.5 text-[0.78rem] text-text outline-none focus:border-amber"
            />
          </label>
          <button
            type="submit"
            className="mono shrink-0 rounded-term px-3 py-2 text-[0.64rem] font-semibold tracking-widest"
            style={{ color: "var(--ink)", background: "var(--amber)" }}
          >
            SEARCH
          </button>
        </form>
      </header>

      {term.length === 0 ? (
        <div className="panel p-4">
          <p className="text-[0.76rem] leading-relaxed text-muted">
            Search across every tracked team, player, competition and fixture.
          </p>
        </div>
      ) : term.length < 2 ? (
        <div className="panel p-4">
          <p className="text-[0.76rem] text-muted">Enter at least two characters.</p>
        </div>
      ) : hits.length === 0 ? (
        <div className="panel p-4">
          <p className="mono text-[0.76rem] text-muted">
            Nothing found for &ldquo;{term}&rdquo;.
          </p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-faint">
            Matching is fuzzy, so a near-miss should still surface — if this is empty the name
            is probably not tracked.
          </p>
        </div>
      ) : (
        <>
          <p className="mono px-1 text-[0.6rem] tracking-wide text-faint">
            {hits.length} result{hits.length === 1 ? "" : "s"} for &ldquo;{term}&rdquo;
          </p>
          {(["team", "player", "league", "match"] as const).map((type) => {
            const list = grouped.get(type);
            if (!list?.length) return null;
            const meta = META[type];
            return (
              <section key={type}>
                <h2 className="label-cap mb-1 px-1">
                  {meta.label}
                  <span className="ml-1.5 tnum">{list.length}</span>
                </h2>
                <ul className="panel divide-y divide-line">
                  {list.map((h) => (
                    <li key={`${h.entityType}-${h.entityId}`}>
                      <Link
                        href={meta.href(h)}
                        className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-raised"
                      >
                        <span className="shrink-0 text-faint">
                          <meta.Icon size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="mono block truncate text-[0.78rem] font-semibold text-text">
                            {h.title}
                          </span>
                          {h.subtitle && (
                            <span className="mono block truncate text-[0.62rem] text-faint">
                              {h.subtitle}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
