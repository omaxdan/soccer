import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlayerById } from "@/lib/queries";
import { idFromParam, teamSlug } from "@/lib/slug";
import { Crest } from "@/components/Crest";
import { NavPlayers } from "@/components/icons/NavIcons";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = idFromParam(slug);
  const p = id != null ? await getPlayerById(id) : null;
  return { title: p ? p.name : "Player" };
}

const n = (v: unknown): number | null => {
  if (v == null) return null;
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : null;
};

export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = idFromParam(slug);
  const p = id != null ? await getPlayerById(id) : null;
  if (!p) notFound();

  const intel = (p.intelligence ?? {}) as Record<string, unknown>;
  const season = (p.season ?? {}) as Record<string, unknown>;

  // Every stat is optional. A row that renders "—" for eight metrics tells a
  // reader nothing, so a missing value produces no row at all.
  const stats: { label: string; value: string }[] = [];
  const add = (label: string, v: unknown, fmt: (x: number) => string = (x) => `${Math.round(x)}`) => {
    const x = n(v);
    if (x != null) stats.push({ label, value: fmt(x) });
  };
  add("Appearances", season.appearances);
  add("Goals", season.goals);
  add("Assists", season.assists);
  add("Minutes", season.minutes_played, (x) => x.toLocaleString());
  add("Rating", season.rating, (x) => x.toFixed(2));
  add("Importance", intel.importance_score);
  add("Form", intel.form_rating);
  add("Goal threat", intel.goal_threat);
  add("Creativity", intel.creativity_score);
  add("Defensive contribution", intel.defensive_contribution);
  if (p.versatility != null) stats.push({ label: "Versatility", value: `${Math.round(p.versatility)}` });

  const positions = [p.position, p.secondary_position].filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      <Link href="/players" className="mono inline-flex items-center gap-1 text-[0.65rem] text-muted hover:text-text">
        ← Players
      </Link>

      <header className="panel p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-faint">
            <NavPlayers size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{p.name}</h1>
            <p className="mono mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-muted">
              {p.jersey_number != null && <span className="tnum">#{p.jersey_number}</span>}
              {positions.length > 0 && <span>{positions.join(" · ")}</span>}
              {p.team && (
                <Link
                  href={`/team/${teamSlug(p.team)}`}
                  className="inline-flex items-center gap-1.5 text-text transition-colors hover:text-amber"
                >
                  <Crest team={p.team as any} size={16} />
                  {p.team.name}
                </Link>
              )}
            </p>
          </div>
        </div>

        {p.injury && (
          <p
            className="mono mt-3 inline-block rounded px-2 py-1 text-[0.62rem] tracking-wide"
            style={{
              color: "var(--risk)",
              background: "color-mix(in srgb, var(--risk) 12%, transparent)",
            }}
          >
            UNAVAILABLE
            {p.injury.reason ? ` · ${p.injury.reason}` : ""}
            {p.injury.expectedReturnDays != null ? ` · ~${p.injury.expectedReturnDays}d` : ""}
          </p>
        )}
      </header>

      {stats.length > 0 ? (
        <section className="panel p-4">
          <h2 className="label-cap mb-2">Season and intelligence</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="label-cap">{s.label}</dt>
                <dd className="mono tnum text-[0.85rem] font-semibold text-text">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="panel p-4">
          <p className="text-[0.74rem] text-muted">
            No season statistics or player intelligence recorded for {p.name} yet.
          </p>
        </section>
      )}

      <p className="text-[0.66rem] leading-relaxed text-faint">
        Per-fixture impact — goal threat, creativity and defensive contribution against a
        specific opponent — appears in the key player battles on each match report.
      </p>
    </div>
  );
}
