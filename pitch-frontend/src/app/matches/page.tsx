import { getBoard } from "@/lib/queries";
import { MatchCard } from "@/components/MatchCard";
import type { MatchRow } from "@/lib/types";
import { kickoff } from "@/lib/intel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fixtures" };

function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default async function FixturesPage() {
  const matches = await getBoard(40);
  // chronological, then grouped by day
  const chrono = [...matches].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const groups = new Map<string, MatchRow[]>();
  for (const m of chrono) {
    const key = dayKey(m.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return (
    <div className="space-y-5">
      <header className="panel p-5">
        <p className="eyebrow">Fixtures</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
          Every tracked match, in kickoff order.
        </h1>
        <p className="mt-2 max-w-lg text-[0.85rem] leading-relaxed text-muted">
          The board ranks by edge; this is the schedule view. Each card still
          carries its opportunity and risk read.
        </p>
        <p className="mono mt-3 text-[0.6rem] tracking-wide text-faint">
          {chrono.length} fixtures · {groups.size} match days
        </p>
      </header>

      {[...groups.entries()].map(([day, dayMatches]) => (
        <section key={day}>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-amber">
              {day}
            </h2>
            <span className="h-px flex-1 bg-line" />
            <span className="mono text-[0.6rem] text-faint">
              {kickoff(dayMatches[0].date).rel}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {dayMatches.map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
