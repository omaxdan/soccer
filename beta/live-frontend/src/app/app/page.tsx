import { getBoard, getBettingCard, getBandBacktests } from "@/lib/queries";
import Link from "next/link";
import {
  DateNav,
  buildDayOptions,
  dayKeyOf,
} from "@/components/FeedTable";
import {
  ModuleFeed,
  SortControl,
  buildFeed,
  filterFeed,
  parseSort,
} from "@/components/ModuleFeed";
import { MODULES, moduleFromSlug } from "@/lib/modules";
import { currentTier } from "@/lib/tier";
import { getAccessContext } from "@/lib/access";
import { getFavouriteLeagueIds } from "@/lib/preferences";
import {
  IconConfidence,
  IconModules,
  IconGate,
  ModuleIcon,
  IconContradicts,
} from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; sort?: string; date?: string }>;
}) {
  const [{ module: moduleParam, sort: sortParam, date: dateParam }, matches, bettingCard] =
    await Promise.all([
    searchParams,
    getBoard(24),
    getBettingCard(),
  ]);
  const bandBacktests = await getBandBacktests();
  const viewer = currentTier();
  const access = await getAccessContext();
  // Favourite competitions sort ahead of the rest. Ordering only — nothing is
  // filtered out, so a favourite selection never hides intelligence.
  const favIds = new Set(await getFavouriteLeagueIds());

  // ?module=m5 — set by the VIEW ACTIVATIONS links in the module directory.
  const focus = moduleFromSlug(moduleParam);
  const sort = parseSort(sortParam);
  const allEntries = buildFeed(matches, bettingCard.singles, bandBacktests, access);
  const dayOptions = buildDayOptions(allEntries);
  const activeDay =
    dateParam && dayOptions.some((d) => d.key === dateParam) ? dateParam : null;
  const dayFiltered = activeDay
    ? allEntries.filter((e) => dayKeyOf(e.match.date) === activeDay)
    : allEntries;
  const filtered = filterFeed(dayFiltered, focus?.key ?? null);
  // Favourites sort ahead of everything else. Ordering only — nothing is
  // removed, so a favourite selection can never hide intelligence from the
  // person who set it.
  const entries = favIds.size
    ? [...filtered].sort(
        (a, b) =>
          Number(favIds.has(b.match.tournament?.id ?? -1)) -
          Number(favIds.has(a.match.tournament?.id ?? -1))
      )
    : filtered;

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const bankers = bettingCard.singles.filter((s) => s.confidence === "BANKER");
  const strong = bettingCard.singles.filter((s) => s.confidence === "STRONG");
  const covered = new Set(bettingCard.singles.map((s) => s.match_id)).size;

  return (
    <div className="space-y-4">
      {/* ── Hero: intelligence briefing ───────────────────── */}
      <section className="panel scanlines p-5">
        <div className="flex items-center gap-2">
          <span className="text-amber">
            <IconModules size={16} />
          </span>
          <h1 className="mono text-[0.8rem] font-semibold uppercase tracking-[0.16em] text-text">
            Intelligence briefing
          </h1>
        </div>
        <p className="mono mt-1 text-[0.68rem] text-muted">{today}</p>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="label-cap">Modules active</div>
            <div className="mono tnum text-xl font-semibold text-text">
              {MODULES.length}
            </div>
          </div>
          <div>
            <div className="label-cap">Fixtures covered</div>
            <div className="mono tnum text-xl font-semibold text-text">{covered}</div>
          </div>
          <div>
            <div className="label-cap">Window</div>
            <div className="mono text-xl font-semibold text-text">3 days</div>
          </div>
          <div>
            <div className="label-cap">Banker picks</div>
            <div className="mono tnum text-xl font-semibold" style={{ color: "var(--edge)" }}>
              {bankers.length}
            </div>
          </div>
          <div>
            <div className="label-cap">Strong picks</div>
            <div className="mono tnum text-xl font-semibold" style={{ color: "var(--amber)" }}>
              {strong.length}
            </div>
          </div>
        </div>

        {/* Calibration status — deliberately on the hero, not buried */}
        <div className="mt-4 flex items-start gap-2.5 border-t border-line pt-3">
          <span className="mt-0.5 text-warn">
            <IconGate size={14} />
          </span>
          <p className="text-[0.68rem] leading-relaxed text-muted">
            Confidence-band accuracy is currently derived from present-day team form applied
            to historical fixtures. Until the point-in-time replay lands, band rates are shown
            with their intervals and marked accordingly — see{" "}
            <a href="/method" className="text-amber underline underline-offset-2">
              Method
            </a>
            .
          </p>
        </div>
      </section>

      {/* ── Module activation feed ────────────────────────── */}
      <section>
        <header className="mb-3 flex items-center gap-2">
          <span className="text-amber">
            <IconConfidence size={14} />
          </span>
          <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
            Module activations
          </h2>
          <span className="ml-auto">
            <SortControl current={sort} moduleParam={moduleParam} />
          </span>
        </header>

        {focus && (
          <div
            className="panel mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
            style={{ borderColor: "color-mix(in srgb, var(--amber) 30%, var(--line))" }}
          >
            <span className="text-amber">
              <ModuleIcon moduleKey={focus.key} size={15} />
            </span>
            <span className="mono text-[0.72rem] font-semibold text-text">
              M{focus.n} {focus.name}
            </span>
            <span className="mono tnum text-[0.66rem] text-muted">
              {entries.length} of {allEntries.length} fixtures firing
            </span>
            <Link
              href={`/app?sort=${sort}`}
              className="mono ml-auto inline-flex items-center gap-1 text-[0.6rem] tracking-widest text-faint transition-colors hover:text-text"
            >
              <IconContradicts size={10} />
              CLEAR FILTER
            </Link>
          </div>
        )}
        <DateNav
          days={dayOptions}
          active={activeDay}
          total={allEntries.length}
          basePath="/app"
          extraParams={{ sort, ...(moduleParam ? { module: moduleParam } : {}) }}
        />


        <div className="mt-3">
          <ModuleFeed entries={entries} viewer={viewer} sort={sort} />
        </div>
      </section>
    </div>
  );
}
