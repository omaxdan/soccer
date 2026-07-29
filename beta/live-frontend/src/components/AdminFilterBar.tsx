"use client";

import React, { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────────
// One URL-construction path, not two.
//
// The previous filter forms used a native <form method="get"> for select
// changes and a hand-built qs()/URLSearchParams string for pagination links —
// two mechanisms that could drift out of sync. This component is the only
// place a filter mutates the URL: every select fires onChange, every keypress
// in search debounces, both go through the identical setParam() below, which
// always uses URLSearchParams — the one thing guaranteed to percent-encode a
// league name like "Brasileirão Série B" correctly regardless of what's in it.
//
// Changing a filter always resets page back to 1 (or removes it), since a
// stale page number from a larger result set is exactly the "URL looks fine,
// page renders empty" edge case worth eliminating by construction rather than
// clamping after the fact everywhere it could occur.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectField {
  type: "select";
  name: string;
  label: string;
  options: { value: string; label: string }[];
}
export interface SearchField {
  type: "search";
  name: string;
  placeholder: string;
}
export type FilterField = SelectField | SearchField;

export function AdminFilterBar({ fields, basePath }: { fields: FilterField[]; basePath: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const searchFieldNames = new Set(fields.filter((f) => f.type === "search").map((f) => f.name));
  const [localSearch, setLocalSearch] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const name of searchFieldNames) init[name] = searchParams.get(name) ?? "";
    return init;
  });

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    // Any filter change invalidates whatever page you were on.
    next.delete("page");
    startTransition(() => {
      router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`);
    });
  };

  // Debounced search — 350ms, mid the requested 300-500ms range. Executes on
  // Enter immediately too, for anyone who types fast and expects it to just work.
  useEffect(() => {
    const timers = Object.entries(localSearch).map(([name, value]) => {
      const current = searchParams.get(name) ?? "";
      if (value === current) return null;
      return setTimeout(() => setParam(name, value), 350);
    });
    return () => timers.forEach((t) => t && clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSearch]);

  const active = fields.some((f) => searchParams.get(f.name));

  return (
    <div className="panel flex flex-wrap items-end gap-2 p-3">
      {fields.map((f) => {
        if (f.type === "search") {
          return (
            <label key={f.name} className="relative min-w-0 flex-1">
              <span className="sr-only">{f.placeholder}</span>
              <input
                value={localSearch[f.name] ?? ""}
                onChange={(e) => setLocalSearch((s) => ({ ...s, [f.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setParam(f.name, localSearch[f.name] ?? "");
                }}
                placeholder={f.placeholder}
                autoComplete="off"
                className="mono w-full rounded-term border border-line bg-raised py-1.5 px-2.5 text-[0.7rem] text-text outline-none focus:border-amber"
              />
            </label>
          );
        }
        return (
          <select
            key={f.name}
            defaultValue={searchParams.get(f.name) ?? ""}
            onChange={(e) => setParam(f.name, e.target.value)}
            aria-label={f.label}
            className="mono rounded-term border border-line bg-raised px-2 py-1.5 text-[0.68rem] text-text"
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      })}
      {pending && <span className="mono text-[0.6rem] text-faint">updating…</span>}
      {active && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(basePath))}
          className="mono text-[0.62rem] tracking-widest text-faint"
        >
          CLEAR
        </button>
      )}
    </div>
  );
}
