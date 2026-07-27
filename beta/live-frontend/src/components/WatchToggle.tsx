"use client";

import React, { useState, useTransition } from "react";
import { toggleWatch, toggleFavouriteLeague, type WatchEntity } from "@/lib/preferences";
import { IconStar, IconStarFilled } from "./icons/ModuleIcons";

/**
 * Optimistic star. The server action is the source of truth; local state only
 * removes the round-trip flicker, and reverts if the write fails.
 *
 * Signed-out visitors see the control but it links to sign-in rather than
 * failing silently — a star that does nothing when clicked reads as broken.
 */
export function WatchToggle({
  entityType,
  entityId,
  initial,
  authenticated,
  label = "watchlist",
}: {
  entityType: WatchEntity;
  entityId: number;
  initial: boolean;
  authenticated: boolean;
  label?: string;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  if (!authenticated) {
    return (
      <a
        href="/login"
        className="mono inline-flex items-center gap-1.5 rounded-term px-2 py-1 text-[0.62rem] tracking-widest text-faint transition-colors hover:text-amber"
        title={`Sign in to use your ${label}`}
      >
        <IconStar size={13} />
        SIGN IN TO WATCH
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          try {
            if (entityType === "league") await toggleFavouriteLeague(entityId);
            else await toggleWatch(entityType, entityId);
          } catch {
            setOn(!next);
          }
        });
      }}
      className="mono inline-flex items-center gap-1.5 rounded-term px-2 py-1 text-[0.62rem] tracking-widest transition-colors disabled:opacity-60"
      style={{ color: on ? "var(--amber)" : "var(--faint)" }}
    >
      {on ? <IconStarFilled size={13} /> : <IconStar size={13} />}
      {on ? "WATCHING" : "ADD TO WATCHLIST"}
    </button>
  );
}

/** Compact star for a list row, where the label would crowd the layout. */
export function FavouriteStar({
  tournamentId,
  initial,
  authenticated,
}: {
  tournamentId: number;
  initial: boolean;
  authenticated: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  if (!authenticated) return null;

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove from favourites" : "Add to favourites"}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          try {
            await toggleFavouriteLeague(tournamentId);
          } catch {
            setOn(!next);
          }
        });
      }}
      className="shrink-0 rounded-term p-1 transition-colors disabled:opacity-60"
      style={{ color: on ? "var(--amber)" : "var(--faint)" }}
    >
      {on ? <IconStarFilled size={14} /> : <IconStar size={14} />}
    </button>
  );
}


/**
 * Compact star for a table row.
 *
 * The whole row is a link, so this must stop propagation AND prevent default —
 * without preventDefault the click still activates the enclosing anchor and the
 * board navigates away mid-toggle.
 *
 * Signed-out visitors get a link to sign in rather than a dead control.
 */
export function RowStar({
  matchId,
  initial,
  authenticated,
}: {
  matchId: number;
  initial: boolean;
  authenticated: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  if (!authenticated) {
    return (
      <a
        href="/login"
        onClick={stop}
        aria-label="Sign in to save matches"
        title="Sign in to save matches"
        className="flex h-8 w-8 items-center justify-center rounded-term text-faint transition-colors hover:text-amber"
      >
        <IconStar size={14} />
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove from saved matches" : "Save match"}
      title={on ? "Saved" : "Save match"}
      onClick={(e) => {
        stop(e);
        const next = !on;
        setOn(next);
        start(async () => {
          try {
            await toggleWatch("match", matchId);
          } catch {
            setOn(!next);
          }
        });
      }}
      // 32px box inside a 36px column: a comfortable target without widening
      // the table.
      className="flex h-8 w-8 items-center justify-center rounded-term transition-colors disabled:opacity-50"
      style={{ color: on ? "var(--amber)" : "var(--faint)" }}
    >
      {on ? <IconStarFilled size={14} /> : <IconStar size={14} />}
    </button>
  );
}
