import Link from "next/link";
import { getBoard, getBettingCard, getBandBacktests } from "@/lib/queries";
import { buildFeed } from "@/components/ModuleFeed";
import { getAccessContext } from "@/lib/access";
import { MODULES, tally, overallVerdict, derivePickSide } from "@/lib/modules";
import { LocalKickoff } from "@/components/LocalKickoff";
import { matchSlug } from "@/lib/slug";
import { kickoff } from "@/lib/intel";
import { Crest } from "@/components/Crest";
import { IconArrowRight, IconSupports } from "@/components/icons/ModuleIcons";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PitchTerminal — football intelligence from historical match patterns",
  description:
    "Understand why a side holds an edge, where risk is hidden, and which signals matter before kickoff. Evidence, not predictions.",
};

export default async function LandingPage() {
  // The preview is real fixtures. A landing page carrying invented matches
  // would contradict the claim it is making three sections further down.
  const [matches, card, bands] = await Promise.all([
    getBoard(12),
    getBettingCard(),
    getBandBacktests(),
  ]);
  const access = await getAccessContext();
  const preview = buildFeed(matches, card.singles, bands, access).slice(0, 3);

  return (
    <div className="space-y-3">
      {/* Hero */}
      <section className="panel scanlines p-4 sm:p-5">
        <p className="eyebrow">PitchTerminal</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
          Football intelligence built from historical match patterns.
        </h1>
        <ul className="mt-4 space-y-1.5">
          {[
            "Why a side holds an edge",
            "Where risk is hidden",
            "Which signals matter before kickoff",
          ].map((l) => (
            <li key={l} className="flex items-center gap-2 text-[0.85rem] text-muted">
              <span style={{ color: "var(--edge)" }}>
                <IconSupports size={13} />
              </span>
              {l}
            </li>
          ))}
        </ul>
        <p className="mono mt-4 text-[0.72rem] tracking-wide" style={{ color: "var(--amber)" }}>
          Not predictions. Evidence.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/app"
            className="mono inline-flex items-center gap-1.5 rounded-term px-3 py-2 text-[0.68rem] font-semibold tracking-widest"
            style={{ color: "var(--ink)", background: "var(--amber)" }}
          >
            EXPLORE MATCH INTELLIGENCE
            <IconArrowRight size={13} />
          </Link>
          <Link
            href="/modules"
            className="mono inline-flex items-center gap-1.5 rounded-term px-3 py-2 text-[0.68rem] font-semibold tracking-widest"
            style={{
              color: "var(--amber)",
              border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
            }}
          >
            SEE THE ENGINE
          </Link>
        </div>
      </section>

      {/* Live preview — real fixtures */}
      {preview.length > 0 && (
        <section>
          <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
            Upcoming intelligence
          </h2>
          <div className="grid gap-3 lg:grid-cols-3">
            {preview.map((e) => {
              const m = e.match;
              const t = tally(e.readings);
              const overall = overallVerdict(t);
              const firing = e.readings.filter((r) => r.status !== "inactive").length;
              const side = derivePickSide(m);
              const lean =
                side === "home"
                  ? m.home.short_name || m.home.name
                  : side === "away"
                    ? m.away.short_name || m.away.name
                    : "No edge";
              const k = kickoff(m.date);
              return (
                <Link key={m.id} href={`/match/${matchSlug(m)}`} className="panel block p-4">
                  <div className="mono flex items-center gap-2 text-[0.6rem] text-muted">
                    <span className="truncate">{m.competition ?? m.tournament?.name ?? "—"}</span>
                    <span className="ml-auto shrink-0 text-faint">
                      <LocalKickoff iso={m.date} format="dayTime" />
                    </span>
                  </div>
                  <div className="mt-2.5 space-y-1.5">
                    {[m.home, m.away].map((team) => (
                      <div key={team.id} className="flex items-center gap-2">
                        <Crest team={team} size={18} />
                        <span className="mono truncate text-[0.78rem] font-semibold text-text">
                          {team.short_name || team.name}
                        </span>
                      </div>
                    ))}
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5">
                    <div>
                      <dt className="label-cap">Evidence</dt>
                      <dd className="mono tnum text-[0.75rem] text-text">
                        {firing}
                        <span className="text-[0.6rem] text-faint">/{MODULES.length}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Consensus</dt>
                      <dd className="mono text-[0.7rem] font-semibold" style={{ color: overall.color }}>
                        {overall.label}
                      </dd>
                    </div>
                    <div>
                      <dt className="label-cap">Lean</dt>
                      <dd className="mono truncate text-[0.7rem] text-text">{lean}</dd>
                    </div>
                  </dl>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Problem */}
      <section className="panel p-4">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Stats tell you what happened. PitchTerminal explains why it matters.
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label-cap mb-1.5">Traditional</div>
            <p className="mono text-[0.95rem] tracking-widest text-muted">WWWWW</p>
            <p className="mt-1 text-[0.72rem] text-faint">
              Five wins. Against whom, how rested, how repeatable — unanswered.
            </p>
          </div>
          <div>
            <div className="label-cap mb-1.5">PitchTerminal</div>
            <ul className="space-y-0.5">
              {[
                "Form quality",
                "Opponent context",
                "Readiness",
                "Confidence calibration",
                "Risk detection",
              ].map((l) => (
                <li key={l} className="text-[0.76rem] text-text">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Engine */}
      <section className="panel p-4">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          {MODULES.length} modules. Each answers one historical question.
        </h2>
        <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((mod) => (
            <li key={mod.key}>
              <span className="mono block text-[0.74rem] font-semibold text-text">{mod.name}</span>
              <span className="block text-[0.68rem] leading-relaxed text-muted">{mod.question}</span>
            </li>
          ))}
        </ul>
        <Link
          href="/modules"
          className="mono mt-4 inline-flex items-center gap-1.5 text-[0.64rem] tracking-widest text-amber"
        >
          MODULE LIBRARY
          <IconArrowRight size={12} />
        </Link>
      </section>

      {/* Trust */}
      <section className="panel p-4">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
          Every figure arrives with its limits attached.
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            "Historical sample size",
            "Observed frequency",
            "95% confidence interval",
            "Data limitations, stated not hidden",
          ].map((l) => (
            <li key={l} className="flex items-center gap-2 text-[0.78rem] text-text">
              <span style={{ color: "var(--edge)" }}>
                <IconSupports size={13} />
              </span>
              {l}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[0.7rem] leading-relaxed text-muted">
          A rule below our sample gate is marked, not withheld and not dressed up. Where a band
          has too few matches to measure, we publish no rate for it at all.
        </p>
      </section>
    </div>
  );
}
