"use client";

import React, { useState, useTransition } from "react";
import { toggleFavouriteLeague } from "@/lib/preferences";
import { IconStar, IconStarFilled } from "./icons/ModuleIcons";

/**
 * Favourite management for Settings.
 *
 * Optimistic: the row flips immediately and reverts if the write fails. With a
 * long competition list, waiting for a round trip per click makes selecting six
 * leagues feel broken even when every write succeeds.
 */
export function FavouriteLeagues({
  leagues,
  initial,
}: {
  leagues: { id: number; name: string; country: string | null }[];
  initial: number[];
}) {
  const [ids, setIds] = useState<Set<number>>(new Set(initial));
  const [pending, start] = useTransition();

  const toggle = (id: number) => {
    const next = new Set(ids);
    const had = next.has(id);
    had ? next.delete(id) : next.add(id);
    setIds(next);
    start(async () => {
      try {
        await toggleFavouriteLeague(id);
      } catch {
        const revert = new Set(next);
        had ? revert.add(id) : revert.delete(id);
        setIds(revert);
      }
    });
  };

  const chosen = leagues.filter((l) => ids.has(l.id));
  const rest = leagues.filter((l) => !ids.has(l.id));

  return (
    <div>
      <p className="text-[0.74rem] leading-relaxed text-muted">
        {ids.size > 0
          ? `${ids.size} selected. Your leagues sort to the top of the board and fixtures.`
          : `${leagues.length} competitions are tracked. Select the ones you follow to sort them to the top.`}
      </p>

      {chosen.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {chosen.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(l.id)}
                className="mono inline-flex items-center gap-1.5 rounded-term px-2 py-1 text-[0.64rem] transition-opacity disabled:opacity-60"
                style={{
                  color: "var(--amber)",
                  background: "color-mix(in srgb, var(--amber) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
                }}
              >
                <IconStarFilled size={11} />
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 max-h-64 overflow-y-auto rounded-term border border-line">
        <ul className="divide-y divide-line">
          {rest.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(l.id)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-raised disabled:opacity-60"
              >
                <span className="text-faint">
                  <IconStar size={12} />
                </span>
                <span className="mono min-w-0 flex-1 truncate text-[0.7rem] text-text">
                  {l.name}
                </span>
                {l.country && (
                  <span className="mono shrink-0 text-[0.58rem] text-faint">{l.country}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
