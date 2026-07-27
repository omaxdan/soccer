// ─────────────────────────────────────────────────────────────────────────────
// InjuryPanel — who is unavailable, per side.
//
// Renders nothing at all when neither team has an active injury record, so the
// match page shows an empty panel rather than "no injuries" on fixtures where
// the truth is that nobody has told us either way. Absence of data and absence
// of injuries are different claims.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import type { MatchRow, PlayerInjuryRow, TeamInjuryImpact } from "@/lib/types";
import { Crest } from "./Crest";

/** Higher severity first, then longest out — worst news at the top. */
function rank(a: PlayerInjuryRow, b: PlayerInjuryRow) {
  const s = (r: PlayerInjuryRow) => r.injury_severity_score ?? -1;
  if (s(b) !== s(a)) return s(b) - s(a);
  return (b.days_out ?? 0) - (a.days_out ?? 0);
}

function severityColor(score: number | null): string {
  if (score == null) return "var(--muted)";
  if (score >= 70) return "var(--risk)";
  if (score >= 40) return "var(--warn)";
  return "var(--muted)";
}

function TeamInjuries({
  team,
  rows,
  impact,
}: {
  team: MatchRow["home"];
  rows: PlayerInjuryRow[];
  impact: TeamInjuryImpact | null;
}) {
  const name = team.short_name || team.name;
  return (
    <div>
      <header className="flex items-center gap-2 border-b border-line pb-2">
        <Crest team={team} size={20} />
        <span className="mono text-[0.78rem] font-semibold text-text">{name}</span>
        <span className="mono ml-auto tnum text-[0.65rem] text-muted">
          {rows.length} out
        </span>
      </header>

      {impact && (impact.goals_lost != null || impact.total_importance_lost != null) && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {impact.total_importance_lost != null && (
            <div>
              <dt className="label-cap">Importance lost</dt>
              <dd className="mono tnum text-[0.72rem] text-text">
                {impact.total_importance_lost.toFixed(0)}
              </dd>
            </div>
          )}
          {impact.goals_lost != null && (
            <div>
              <dt className="label-cap">Goals lost</dt>
              <dd className="mono tnum text-[0.72rem] text-text">{impact.goals_lost}</dd>
            </div>
          )}
          {impact.assists_lost != null && (
            <div>
              <dt className="label-cap">Assists lost</dt>
              <dd className="mono tnum text-[0.72rem] text-text">{impact.assists_lost}</dd>
            </div>
          )}
        </dl>
      )}

      {rows.length === 0 ? (
        <p className="mt-2 text-[0.7rem] text-faint">No active injury records.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {[...rows].sort(rank).map((r) => (
            <li key={r.player_id} className="flex items-baseline gap-2 text-[0.72rem]">
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: severityColor(r.injury_severity_score) }}
                aria-hidden="true"
              />
              <span className="mono text-text">{r.short_name || r.name}</span>
              <span className="text-faint">{r.injury_reason ?? r.injury_status ?? "Unavailable"}</span>
              <span className="mono ml-auto shrink-0 tnum text-[0.65rem] text-muted">
                {r.expected_return_days != null
                  ? `~${r.expected_return_days}d`
                  : r.days_out != null
                    ? `${r.days_out}d out`
                    : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function InjuryPanel({ match: m }: { match: MatchRow }) {
  const home = m.homeInjuries ?? [];
  const away = m.awayInjuries ?? [];
  const homeImpact = m.homeInjuryImpact ?? null;
  const awayImpact = m.awayInjuryImpact ?? null;

  // Previously this returned null when both sides came back empty, which made
  // the section vanish on most fixtures. That was over-cautious: the query DID
  // run for both teams, so "no active injury records" is a true statement
  // rather than a guess, and each card already says exactly that. The section
  // only disappears now when the fixture itself has no intelligence at all.
  const known = m.intel != null || home.length > 0 || away.length > 0 || homeImpact || awayImpact;
  if (!known) return null;

  return (
    <section>
      <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
        Unavailable players
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <TeamInjuries team={m.home} rows={home} impact={homeImpact} />
        </div>
        <div className="panel p-4">
          <TeamInjuries team={m.away} rows={away} impact={awayImpact} />
        </div>
      </div>
    </section>
  );
}
