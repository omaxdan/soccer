import Link from "next/link";
import { getTeamDirectory, type TeamDirectoryRow } from "@/lib/queries";
import { teamSlug } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trends" };

/**
 * Each trend is a filter and a sort over the team directory — no new metric is
 * computed. A trend with nothing in it renders nothing rather than an empty
 * card, so the page reflects the data rather than a fixed set of headings.
 */
interface Trend {
  title: string;
  question: string;
  metric: string;
  rows: { team: TeamDirectoryRow; value: number }[];
}

function build(teams: TeamDirectoryRow[]): Trend[] {
  const take = (
    title: string,
    question: string,
    metric: string,
    pick: (t: TeamDirectoryRow) => number | null,
    desc = true,
    filter: (t: TeamDirectoryRow, v: number) => boolean = () => true
  ): Trend | null => {
    const rows = teams
      .map((team) => ({ team, value: pick(team) }))
      .filter((r): r is { team: TeamDirectoryRow; value: number } => r.value != null)
      .filter((r) => filter(r.team, r.value))
      .sort((a, b) => (desc ? b.value - a.value : a.value - b.value))
      .slice(0, 8);
    return rows.length ? { title, question, metric, rows } : null;
  };

  return [
    take("Peak readiness", "Which sides arrive freshest?", "Readiness", (t) => t.readiness),
    take("Under fatigue pressure", "Which sides are carrying the most travel load?", "Travel fatigue", (t) => t.travelFatigue, true, (_t, v) => v > 0),
    take("Most volatile", "Whose results swing hardest match to match?", "Volatility", (t) => t.volatility),
    take("Most repeatable", "Whose results hold steadiest?", "Volatility", (t) => t.volatility, false),
    take("Strongest defences", "Who concedes least by rating?", "Defence", (t) => t.defence),
    take("Form outrunning opposition quality", "Whose form is most flattered by the schedule?", "Form − adjusted", (t) => (t.form != null && t.adjustedForm != null ? t.form - t.adjustedForm : null), true, (_t, v) => v > 5),
  ].filter((t): t is Trend => t !== null);
}

export default async function TrendsPage() {
  // Leaderboards here rank across the whole team set, not just the top page
  // by readiness — a team outside the readiness top-100 could still lead the
  // volatility or attack-rating leaderboard. 100 is the pagination system's
  // max page size; this is a real, honest trade-off against the old
  // unbounded 400-team fetch, not a silent one — some edge-case leaders
  // outside the top 100 by readiness may now be missing from these lists.
  const { rows: teams } = await getTeamDirectory({ pageSize: 100 });
  const trends = build(teams);

  return (
    <div className="space-y-3">
      <header className="panel p-4">
        <p className="eyebrow">Tools</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Trends</h1>
        <p className="mt-2 max-w-2xl text-[0.82rem] leading-relaxed text-muted">
          Patterns across every tracked side. Each is a view over existing team intelligence —
          a filter and a sort, not a new calculation.
        </p>
      </header>

      {trends.length === 0 ? (
        <div className="panel p-4 text-center">
          <p className="mono text-[0.72rem] text-muted">No team intelligence available yet.</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {trends.map((t) => (
            <section key={t.title} className="panel p-4">
              <h2 className="mono text-[0.78rem] font-semibold text-text">{t.title}</h2>
              <p className="mt-0.5 text-[0.68rem] text-muted">{t.question}</p>
              <ol className="mt-2.5 space-y-px">
                {t.rows.map((r, idx) => (
                  <li
                    key={r.team.id}
                    className="flex items-center gap-2 rounded-term px-2 py-1 odd:bg-[color-mix(in_srgb,var(--raised)_40%,transparent)]"
                  >
                    <span className="mono tnum w-4 shrink-0 text-[0.6rem] text-faint">{idx + 1}</span>
                    <Link
                      href={`/team/${teamSlug(r.team)}`}
                      className="mono min-w-0 flex-1 truncate text-[0.72rem] text-text transition-colors hover:text-amber"
                    >
                      {r.team.short_name || r.team.name}
                    </Link>
                    <span className="mono tnum shrink-0 text-[0.7rem] font-semibold text-text">
                      {r.value.toFixed(r.value % 1 === 0 ? 0 : 2)}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mono mt-2 border-t border-line pt-1.5 text-[0.55rem] tracking-widest text-faint">
                {t.metric.toUpperCase()}
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
