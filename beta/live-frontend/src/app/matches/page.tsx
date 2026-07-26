import { getBoard } from "@/lib/queries";
import { buildFeed, sortEntries } from "@/components/ModuleFeed";
import { FeedTable } from "@/components/FeedTable";
import { currentTier } from "@/lib/tier";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fixtures" };

export default async function FixturesPage() {
  const matches = await getBoard(40);
  const viewer = currentTier();

  // Same grid the board uses, grouped by match day instead of competition —
  // this page's job is the schedule, so kickoff order is fixed rather than
  // offered as a sort. No betting card is fetched: the card only ever back-
  // filled a missing form_index, and getBoard now carries team_intelligence
  // in full.
  const entries = sortEntries(buildFeed(matches, []), "kickoff");
  const days = new Set(
    entries.map((e) => new Date(e.match.date).toDateString())
  ).size;

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
          {entries.length} fixtures · {days} match days
        </p>
      </header>

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
