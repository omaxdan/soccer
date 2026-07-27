import { getBoard, getBandBacktests } from "@/lib/queries";
import { buildFeed, sortEntries } from "@/components/ModuleFeed";
import {
  FeedTable,
  DateNav,
  buildDayOptions,
  dayKeyOf,
} from "@/components/FeedTable";
import { currentTier } from "@/lib/tier";
import { getAccessContext, boardLimit } from "@/lib/access";
import { UpgradePrompt } from "@/components/FeatureGate";
import { tally, overallVerdict } from "@/lib/modules";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fixtures" };

export default async function FixturesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  // Three days back, four forward — the strip needs past days to navigate to,
  // and getBoard is forward-only unless given a window. Limit is raised to
  // cover a full week rather than truncating mid-Saturday.
  const [{ date: dateParam }, matches] = await Promise.all([
    searchParams,
    getBoard(300, { daysBack: 3, daysForward: 3 }),
  ]);
  const viewer = currentTier();
  const access = await getAccessContext();
  const bandBacktests = await getBandBacktests();

  // Same grid AND the same grouping as the board — country then competition.
  // The date strip is this page's day axis, so grouping is free to match the
  // dashboard. No betting card is fetched: the card only ever back-
  // filled a missing form_index, and getBoard now carries team_intelligence
  // in full.
  const all = sortEntries(buildFeed(matches, [], bandBacktests, access), "kickoff");
  const dayOptions = buildDayOptions(all);
  // Only honour ?date= when that day actually has fixtures, so a stale link
  // shows the full schedule rather than an empty table.
  const limit = boardLimit(access);

  // Today is the default rather than "All". A board that opens on every
  // tracked fixture is a database listing; opening on today is a match board.
  const today = dayKeyOf(new Date());
  const fallbackDay =
    dayOptions.find((d) => d.key === today)?.key ?? dayOptions[0]?.key ?? null;
  const requested = dateParam && dayOptions.some((d) => d.key === dateParam) ? dateParam : null;
  const activeDay = requested ?? (limit.allowAllDays && dateParam === "all" ? null : fallbackDay);
  const dayEntries = activeDay
    ? all.filter((e) => dayKeyOf(e.match.date) === activeDay)
    : all;

  // Capped BEFORE render, ranked by consensus so the strongest intelligence of
  // the day is what survives the cut.
  const CONSENSUS_RANK: Record<string, number> = {
    STRONG: 0, MODERATE: 1, NEUTRAL: 2, WEAK: 3, "NO READ": 4,
  };
  const ranked =
    limit.perDay == null
      ? dayEntries
      : [...dayEntries].sort(
          (a, b) =>
            (CONSENSUS_RANK[overallVerdict(tally(a.readings)).label] ?? 9) -
            (CONSENSUS_RANK[overallVerdict(tally(b.readings)).label] ?? 9)
        );
  const entries = limit.perDay == null ? ranked : ranked.slice(0, limit.perDay);
  const hiddenCount = dayEntries.length - entries.length;

  return (
    <div className="space-y-3">
      <header className="panel p-4">
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

      <DateNav
        days={dayOptions}
        active={activeDay}
        total={all.length}
        showAll={limit.allowAllDays}
      />


      {entries.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No fixtures in the window.</p>
        </div>
      ) : (
        <FeedTable
          entries={entries}
          viewer={viewer}
          groupBy="league"
        />
      )}

      {hiddenCount > 0 && (
        <div className="panel p-4">
          <p className="text-[0.8rem] leading-relaxed text-text">
            {hiddenCount} more {hiddenCount === 1 ? "fixture" : "fixtures"} on this day are
            available with PitchTerminal Pro.
          </p>
          <p className="mt-1.5 text-[0.74rem] leading-relaxed text-muted">
            Pro opens the full match board, every tracked league and all intelligence signals.
          </p>
          <a
            href="/subscription"
            className="mono mt-3 inline-block rounded-term px-3 py-2 text-[0.64rem] font-semibold tracking-widest"
            style={{ color: "var(--ink)", background: "var(--amber)" }}
          >
            UPGRADE TO PRO
          </a>
        </div>
      )}
    </div>
  );
}
