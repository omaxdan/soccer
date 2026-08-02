import Link from "next/link";
import { getWatchlist } from "@/lib/preferences";
import { getViewerIdentity } from "@/lib/access";
import { getBoard, getMatchesByIds, getLeagues } from "@/lib/queries";
import { matchSlug, teamSlug, leagueSlug } from "@/lib/slug";
import { LocalKickoff } from "@/components/LocalKickoff";
import { kickoff } from "@/lib/intel";
import type { MatchRow } from "@/lib/types";
import { IconStar, IconArrowRight } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watchlist" };

function FixtureRow({ m }: { m: MatchRow }) {
  const k = kickoff(m.date);
  const finished = m.home_score != null && m.away_score != null;
  return (
    <li>
      <Link href={`/match/${matchSlug(m)}`} className="panel flex items-center gap-3 p-3">
        <span className="mono w-14 shrink-0 text-[0.62rem] text-faint">
          {k.rel === "LIVE" ? (
            <span style={{ color: "var(--risk)" }}>LIVE</span>
          ) : finished ? (
            "FT"
          ) : (
            <LocalKickoff iso={m.date} format="dayTime" />
          )}
        </span>
        <span className="mono min-w-0 flex-1 truncate text-[0.76rem] font-semibold text-text">
          {m.home.short_name || m.home.name} v {m.away.short_name || m.away.name}
        </span>
        {finished && (
          <span className="mono tnum shrink-0 text-[0.72rem] text-muted">
            {m.home_score}–{m.away_score}
          </span>
        )}
        <span className="mono hidden shrink-0 text-[0.6rem] text-muted sm:block">
          {m.competition ?? m.tournament?.name ?? ""}
        </span>
        <IconArrowRight size={12} />
      </Link>
    </li>
  );
}

export default async function WatchlistPage() {
  const identity = await getViewerIdentity();

  if (!identity.authenticated) {
    return (
      <div className="panel mx-auto max-w-lg p-4 text-center">
        <span className="text-faint">
          <IconStar size={20} />
        </span>
        <h1 className="mono mt-2 text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Sign in to use your watchlist
        </h1>
        <p className="mt-2 text-[0.76rem] leading-relaxed text-muted">
          Save matches, teams and competitions to follow their intelligence.
        </p>
        <Link href="/login" className="mono mt-4 inline-block text-[0.64rem] tracking-widest text-amber">
          SIGN IN →
        </Link>
      </div>
    );
  }

  const items = await getWatchlist();
  const matchIds = items.filter((i) => i.entityType === "match").map((i) => i.entityId);
  const teamIds = new Set(items.filter((i) => i.entityType === "team").map((i) => i.entityId));
  const leagueIds = new Set(items.filter((i) => i.entityType === "league").map((i) => i.entityId));

  // Individually-starred matches, unbounded by date — this is the fix. The
  // page previously cross-referenced every saved item against a 7-day board
  // window; anything saved outside it was silently invisible while still
  // being counted, which is exactly the "2 saved / 1 upcoming" bug.
  const [savedMatches, board, leagues] = await Promise.all([
    getMatchesByIds(matchIds),
    // Still date-windowed here, deliberately: this is ONLY for a watched
    // TEAM's upcoming fixtures, not for individually-saved matches. Nobody
    // who follows a team expects their entire multi-season history dumped
    // on this page — that's a different, much larger ask than "show me what
    // I starred."
    getBoard(200, { daysBack: 1, daysForward: 6 }),
    getLeagues(),
  ]);

  const teamFixtures = board.filter((m) => teamIds.has(m.home.id) || teamIds.has(m.away.id));
  const savedIds = new Set(savedMatches.map((m) => m.id));
  const allMatches = [...savedMatches, ...teamFixtures.filter((m) => !savedIds.has(m.id))];

  const upcoming = allMatches.filter((m) => kickoff(m.date).rel !== "FT" && kickoff(m.date).rel !== "LIVE");
  const live = allMatches.filter((m) => kickoff(m.date).rel === "LIVE");
  const finished = allMatches.filter((m) => kickoff(m.date).rel === "FT");

  const watchedLeagues = leagues.filter((l) => leagueIds.has(l.tournament_id));
  const empty = items.length === 0;

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Main</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Watchlist</h1>
        <p className="mono mt-2 text-[0.62rem] tracking-wide text-faint">
          {items.length} saved · {upcoming.length} upcoming
          {live.length > 0 && ` · ${live.length} live`}
          {finished.length > 0 && ` · ${finished.length} completed`}
        </p>
      </header>

      {empty ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.74rem] text-muted">Nothing saved yet.</p>
          <p className="mt-1 text-[0.7rem] leading-relaxed text-faint">
            Use the star on a match, team or competition to follow its intelligence.
          </p>
          <Link href="/matches" className="mono mt-3 inline-block text-[0.64rem] tracking-widest text-amber">
            BROWSE THE MATCH BOARD →
          </Link>
        </div>
      ) : (
        <>
          {live.length > 0 && (
            <section>
              <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--risk)" }}>
                Live
              </h2>
              <ul className="space-y-2">{live.map((m) => <FixtureRow key={m.id} m={m} />)}</ul>
            </section>
          )}

          <section>
            <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
              Upcoming
            </h2>
            {upcoming.length === 0 ? (
              <div className="panel p-4">
                <p className="text-[0.74rem] text-muted">Nothing upcoming among what you follow.</p>
              </div>
            ) : (
              <ul className="space-y-2">{upcoming.map((m) => <FixtureRow key={m.id} m={m} />)}</ul>
            )}
          </section>

          {/* Finished saved matches stay visible — they were saved on
              purpose, and hiding them the moment they end would silently
              discard exactly the intent behind saving them. */}
          {finished.length > 0 && (
            <section>
              <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-faint">
                Finished
              </h2>
              <ul className="space-y-2">{finished.map((m) => <FixtureRow key={m.id} m={m} />)}</ul>
            </section>
          )}

          {teamIds.size > 0 && (
            <section>
              <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
                Teams
              </h2>
              <ul className="flex flex-wrap gap-2">
                {[...teamIds].map((id) => {
                  const found =
                    allMatches.find((m) => m.home.id === id)?.home ??
                    allMatches.find((m) => m.away.id === id)?.away ??
                    null;
                  return (
                    <li key={id}>
                      <Link
                        href={found ? `/team/${teamSlug(found)}` : "/teams"}
                        className="panel mono block px-3 py-1.5 text-[0.72rem] text-text"
                      >
                        {found ? found.short_name || found.name : `Team ${id}`}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {watchedLeagues.length > 0 && (
            <section>
              <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
                Competitions
              </h2>
              <ul className="flex flex-wrap gap-2">
                {watchedLeagues.map((l) => (
                  <li key={l.tournament_id}>
                    <Link
                      href={l.tournament ? `/league/${leagueSlug(l.tournament)}` : "/leagues"}
                      className="panel mono block px-3 py-1.5 text-[0.72rem] text-text"
                    >
                      {l.tournament?.name ?? `League ${l.tournament_id}`}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-[0.66rem] leading-relaxed text-faint">
            Intelligence-change alerts need a record of what moved between runs, which nothing
            writes yet. The notification tables exist; the comparison that fills them does not.
          </p>
        </>
      )}
    </div>
  );
}
