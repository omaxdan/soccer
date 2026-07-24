// ─────────────────────────────────────────────────────────────────────────────
// TeamModuleProfile — the body of /team/[slug].
//
// Four team-scope modules (1–4) as a profile strip plus full cards. The strip
// doubles as the filter rail: each tag links to the module directory entry so
// a reader can see every fixture where that module is firing.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  evaluateTeamModules,
  statusColor,
  type TeamModuleContext,
} from "@/lib/modules";
import { canSee, type Tier } from "@/lib/tier";
import { ModuleCard } from "./ModuleCard";
import { ModuleIcon, StatusIcon, IconLock } from "./icons/ModuleIcons";

export function TeamModuleProfile({
  ctx,
  viewer,
  teamName,
}: {
  ctx: TeamModuleContext;
  viewer: Tier;
  teamName: string;
}) {
  const readings = evaluateTeamModules(ctx);
  const firing = readings.filter((r) => r.status !== "inactive");

  return (
    <div className="space-y-4">
      {/* Profile strip */}
      <section className="panel p-4">
        <h2 className="mono mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text">
          Module profile
        </h2>
        {firing.length === 0 ? (
          <p className="text-[0.73rem] text-faint">
            No team module has enough history for {teamName} yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {readings.map((r) => {
              const unlocked = canSee(r.def, viewer);
              const color = unlocked ? statusColor(r.status) : "var(--faint)";
              return (
                <li key={r.def.key}>
                  <Link
                    href="/modules"
                    className="mono inline-flex items-center gap-1.5 rounded-term px-2 py-1.5 text-[0.65rem] transition-colors hover:bg-raised"
                    style={{
                      color,
                      border: `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
                      background: `color-mix(in srgb, ${color} 8%, transparent)`,
                    }}
                    title={r.def.question}
                  >
                    {unlocked ? (
                      <ModuleIcon moduleKey={r.def.key} size={13} />
                    ) : (
                      <IconLock size={12} />
                    )}
                    <span className="font-semibold">{r.def.name}</span>
                    {unlocked && r.status !== "inactive" && (
                      <StatusIcon status={r.status} size={11} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Full cards */}
      <div className="grid gap-3 lg:grid-cols-2">
        {readings.map((r) => (
          <ModuleCard key={r.def.key} reading={r} viewer={viewer} />
        ))}
      </div>
    </div>
  );
}
