import { getBoard } from "@/lib/queries";
import { buildFeed, sortEntries } from "@/components/ModuleFeed";
import {
  FeedTable,
  ColumnKey,
  DateNav,
  buildDayOptions,
  dayKeyOf,
} from "@/components/FeedTable";
import { currentTier } from "@/lib/tier";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fixtures" };

export default async function FixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ date: dateParam }, matches] = await Promise.all([
    searchParams,
    getBoard(40),
  ]);
  const viewer = currentTier();

  // Same grid the board uses, grouped by match day instead of competition —
  // this page's job is the schedule, so kickoff order is fixed rather than
  // offered as a sort. No betting card is fetched: the card only ever back-
  // filled a missing form_index, and getBoard now carries team_intelligence
  // in full.
  const all = sortEntries(buildFeed(matches, []), "kickoff");
  const dayOptions = buildDayOptions(all);
  // Only honour ?date= when that day actually has fixtures, so a stale link
  // shows the full schedule rather than an empty table.
  const activeDay =
    dateParam && dayOptions.some((d) => d.key === dateParam) ? dateParam : null;
  const entries = activeDay
    ? all.filter((e) => dayKeyOf(e.match.date) === activeDay)
    : all;

  return (
    <div className="space-y-4">
      <header className="panel p-5">
        <p className="eyebrow">Fixtures</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Every tracked match, in kickoff order.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          The board ranks by consensus; this is the schedule view. Same{" "}
          {MODULES.length} modules, same colour key — supports, neutral,
          contradicts, did not fire.
        </p>
        <p className="mono mt-3 text-[0.6rem] tracking-wide text-faint">
          {entries.length} fixture{entries.length === 1 ? "" : "s"}
          {activeDay ? " on this day" : ` · ${dayOptions.length} match days`}
        </p>
      </header>

      <DateNav days={dayOptions} active={activeDay} total={all.length} />

      <ColumnKey />

      {entries.length === 0 ? (
        <div className="panel p-5 text-center">
          <p className="mono text-[0.72rem] text-muted">No fixtures in the window.</p>
        </div>
      ) : (
        <FeedTable
          entries={entries}
          viewer={viewer}
          groupBy="day"
          maxHeight="calc(100vh - 14rem)"
        />
      )}
    </div>
  );
}
